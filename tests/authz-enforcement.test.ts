import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Makes the authorisation layer self-enforcing.
 *
 * `assertCan` was correct but optional: nothing failed when a code path skipped
 * it, and "the missing audit row would show up" is not detection while nobody is
 * looking. These checks read the source and fail the build instead.
 *
 * Three rules:
 *   1. Containment — only the database module, the repositories, and the
 *      authorisation layer may issue SQL. Elsewhere, importing `query` and its
 *      siblings, or a driver, is the violation. Migration helpers are not: the
 *      hazard is unmediated data access, not opening a connection.
 *   2. Mediation — every exported repository function that reaches the database
 *      must call `assertCan`, unless it is named below with a reason.
 *   3. No stale waivers — an exemption that no longer describes a real function
 *      fails, so the list cannot quietly become a blanket one.
 *
 * A lint rule can state rule 1. It cannot state rule 2, which is about what a
 * function *does* rather than what it imports, and it would need a custom plugin
 * package to say anything at all. This runs in the existing suite, in
 * milliseconds, and fails the same way in CI as it does locally.
 */

const SRC = join(process.cwd(), "src");

/** Functions that reach the database without an actor, and why that is right. */
const EXEMPT: Record<string, string> = {
  "repo/users.ts:registerUser":
    "creates the actor; there is nobody to authorise yet",
  "repo/users.ts:authenticate":
    "the credential check that establishes the actor",
  "repo/users.ts:findUserById":
    "resolves the session cookie into the actor itself",
  "repo/exercises.ts:seedCatalogue":
    "reference data, seeded at startup where there is no actor",
  "repo/exercises.ts:findExerciseById":
    "reference-data lookup, used to validate submitted input",
  "repo/exercises.ts:findExerciseBySlug":
    "reference-data lookup by slug, used by seeds and tests",
};

/** The functions that actually issue SQL. */
const DB_ENTRY_POINTS = new Set(["query", "queryOne", "execute"]);

const DB_MODULE = "@/lib/db";
const DRIVERS = ["pg", "@electric-sql/pglite", "@electric-sql/pglite-socket"];

/** Only these may import the database module or a driver. */
const MAY_REACH_THE_DATABASE = [
  join("lib", "db"),
  join("lib", "repo"),
  join("lib", "authz.ts"),
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

async function parse(path: string): Promise<ts.SourceFile> {
  return ts.createSourceFile(
    path,
    await readFile(path, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

type FunctionInfo = {
  name: string;
  exported: boolean;
  calls: Set<string>;
};

/** Every named function in a file, with the names it calls. */
function functionsIn(source: ts.SourceFile): FunctionInfo[] {
  const found: FunctionInfo[] = [];

  const record = (name: string, exported: boolean, body: ts.Node) => {
    const calls = new Set<string>();
    walk(body, (node) => {
      if (!ts.isCallExpression(node)) return;
      const target = node.expression;
      if (ts.isIdentifier(target)) calls.add(target.text);
      else if (ts.isPropertyAccessExpression(target)) calls.add(target.name.text);
    });
    found.push({ name, exported, calls });
  };

  source.forEachChild((node) => {
    const exported = Boolean(
      ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      record(node.name.text, exported, node.body);
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          record(declaration.name.text, exported, initializer.body);
        }
      }
    }
  });

  return found;
}

/** Functions that reach the database, directly or through a local helper. */
function databaseReaching(functions: FunctionInfo[]): Set<string> {
  const reaching = new Set(
    functions
      .filter((fn) => [...fn.calls].some((call) => DB_ENTRY_POINTS.has(call)))
      .map((fn) => fn.name),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (reaching.has(fn.name)) continue;
      if ([...fn.calls].some((call) => reaching.has(call))) {
        reaching.add(fn.name);
        changed = true;
      }
    }
  }
  return reaching;
}

type Import = { specifier: string; names: string[]; wholeModule: boolean };

function importsIn(source: ts.SourceFile): Import[] {
  const found: Import[] = [];

  source.forEachChild((node) => {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier)
    ) {
      return;
    }
    const bindings = node.importClause?.namedBindings;
    const names =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => element.name.text)
        : [];
    const wholeModule = Boolean(
      node.importClause?.name || (bindings && ts.isNamespaceImport(bindings)),
    );
    found.push({ specifier: node.moduleSpecifier.text, names, wholeModule });
  });

  // `await import("pg")` reaches just as far as a static import.
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({
        specifier: node.arguments[0].text,
        names: [],
        wholeModule: true,
      });
    }
  });

  return found;
}

describe("rule 1 — only the repositories reach the database", () => {
  it("finds no database import outside src/lib/db, src/lib/repo, and authz", async () => {
    const offenders: string[] = [];

    for (const path of await sourceFiles(SRC)) {
      const relativePath = relative(SRC, path);
      if (MAY_REACH_THE_DATABASE.some((allowed) => relativePath.startsWith(allowed))) {
        continue;
      }
      const file = relativePath.split(sep).join("/");
      for (const entry of importsIn(await parse(path))) {
        if (DRIVERS.includes(entry.specifier)) {
          offenders.push(`${file} imports the driver ${entry.specifier}`);
          continue;
        }
        if (entry.specifier !== DB_MODULE) continue;

        if (entry.wholeModule) {
          offenders.push(`${file} imports all of ${DB_MODULE}`);
          continue;
        }
        for (const name of entry.names) {
          if (DB_ENTRY_POINTS.has(name)) {
            offenders.push(`${file} imports ${name} from ${DB_MODULE}`);
          }
        }
      }
    }

    expect(
      offenders,
      "Reach the database through src/lib/repo/*, which authorises first",
    ).toEqual([]);
  });
});

describe("rule 2 — a repository function that reaches the database authorises first", () => {
  it("finds no exported repository function that skips assertCan", async () => {
    const offenders: string[] = [];

    for (const path of await sourceFiles(join(SRC, "lib", "repo"))) {
      const key = `repo/${relative(join(SRC, "lib", "repo"), path).split(sep).join("/")}`;
      const functions = functionsIn(await parse(path));
      const reaching = databaseReaching(functions);

      for (const fn of functions) {
        if (!fn.exported || !reaching.has(fn.name)) continue;
        if (EXEMPT[`${key}:${fn.name}`]) continue;
        if (fn.calls.has("assertCan")) continue;
        offenders.push(`${key}:${fn.name}`);
      }
    }

    expect(
      offenders,
      "Call assertCan, or add a documented exemption in tests/authz-enforcement.test.ts",
    ).toEqual([]);
  });
});

describe("rule 3 — no stale waivers", () => {
  it("every exemption still names a real function that reaches the database", async () => {
    const live = new Set<string>();

    for (const path of await sourceFiles(join(SRC, "lib", "repo"))) {
      const key = `repo/${relative(join(SRC, "lib", "repo"), path).split(sep).join("/")}`;
      const functions = functionsIn(await parse(path));
      const reaching = databaseReaching(functions);
      for (const fn of functions) {
        if (fn.exported && reaching.has(fn.name)) live.add(`${key}:${fn.name}`);
      }
    }

    const stale = Object.keys(EXEMPT).filter((name) => !live.has(name));
    expect(stale, "Remove the exemption; the function it named is gone").toEqual([]);
  });

  it("states a reason for every exemption", () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(20);
    }
  });
});

describe("rule 4 — server actions establish who is acting", () => {
  it("finds no action that skips requireUser", async () => {
    // These three run before there is a session: they are what create one.
    const preAuth = new Set(["registerAction", "loginAction", "signOutAction"]);
    const source = await parse(join(SRC, "app", "actions.ts"));
    const offenders = functionsIn(source)
      .filter((fn) => fn.exported && !preAuth.has(fn.name))
      .filter((fn) => !fn.calls.has("requireUser"))
      .map((fn) => `actions.ts:${fn.name}`);

    expect(
      offenders,
      "A server action must call requireUser() before it touches user data",
    ).toEqual([]);
  });
});
