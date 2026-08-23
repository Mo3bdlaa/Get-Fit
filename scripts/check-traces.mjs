#!/usr/bin/env node
/**
 * Fails if the production server output traces a devDependency.
 *
 * This is not hypothetical. `serverExternalPackages` listed `@electric-sql/pglite`
 * — a devDependency used only when there is no DATABASE_URL — and Next duly
 * traced it into every route's file list. The build passed, because
 * devDependencies are installed at build time. Vercel then pruned them and
 * packaged a deployment around files that no longer existed, and the deploy
 * failed with nothing in the app's own output to explain it.
 *
 * Runs after `next build`, reading the trace manifests the build just wrote.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const SERVER_DIR = join(process.cwd(), ".next", "server");

async function traceManifests(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // no build output; the build step reports that itself
  }
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return traceManifests(path);
      return entry.name.endsWith(".nft.json") ? [path] : [];
    }),
  );
  return found.flat();
}

const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
// @types/* are erased at compile time and never appear in a trace.
const devDeps = Object.keys(pkg.devDependencies ?? {}).filter(
  (name) => !name.startsWith("@types/"),
);

const manifests = await traceManifests(SERVER_DIR);
const offenders = new Map();

for (const manifest of manifests) {
  const { files = [] } = JSON.parse(await readFile(manifest, "utf8"));
  for (const file of files) {
    for (const dep of devDeps) {
      if (file.includes(`node_modules/${dep}/`)) {
        offenders.set(dep, (offenders.get(dep) ?? 0) + 1);
      }
    }
  }
}

if (offenders.size > 0) {
  console.error(
    `\ncheck-traces: the production server output traces ${offenders.size} devDependency(ies):\n`,
  );
  for (const [dep, count] of offenders) {
    console.error(`  ${dep} — ${count} traced file reference(s)`);
  }
  console.error(
    "\nVercel prunes devDependencies after the build, so the deployment is packaged\n" +
      "around files that no longer exist and fails. Either move the package to\n" +
      "dependencies, or keep it out of the bundler's reach — see src/lib/db/index.ts\n" +
      "for the assembled-specifier + webpackIgnore pattern.\n",
  );
  process.exit(1);
}

console.log(
  `check-traces: ${manifests.length} trace manifests, no devDependency reaches production`,
);
