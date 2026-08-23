import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { Actor, Role } from "@/lib/authz";

export type User = {
  id: string;
  email: string;
  displayName: string;
  locale: "en" | "ar";
  role: Role;
  photoVisibility: "private" | "team_coaches" | "gender_filtered";
};

export const registrationSchema = z.object({
  email: z.string().trim().min(3).email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  displayName: z.string().trim().min(1).max(80),
  locale: z.enum(["en", "ar"]).default("en"),
});

export type Registration = z.input<typeof registrationSchema>;

export class EmailTakenError extends Error {
  constructor() {
    super("That email address is already registered");
    this.name = "EmailTakenError";
  }
}

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  locale: "en" | "ar";
  role: Role;
  photo_visibility: User["photoVisibility"];
};

const SELECT_USER =
  "SELECT id, email, display_name, locale, role, photo_visibility FROM users";

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    locale: row.locale,
    role: row.role,
    photoVisibility: row.photo_visibility,
  };
}

/**
 * No `assertCan`: registration is the path that creates the actor, so there is
 * no one to authorise yet. `tests/authz-enforcement.test.ts` carries this as a
 * named exemption.
 */
export async function registerUser(input: Registration): Promise<User> {
  const parsed = registrationSchema.parse(input);

  // The partial unique index is the real guard against a race between two
  // simultaneous signups; this check exists to give the nicer error first.
  const existing = await queryOne(
    "SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL",
    [parsed.email],
  );
  if (existing) throw new EmailTakenError();

  const rows = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, locale)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [parsed.email, await hashPassword(parsed.password), parsed.displayName, parsed.locale],
  );
  if (rows.length === 0) throw new EmailTakenError(); // lost the race

  return (await findUserById(rows[0].id))!;
}

/** No `assertCan`: this is the credential check that establishes the actor. */
export async function authenticate(
  email: string,
  password: string,
): Promise<User | null> {
  const row = await queryOne<UserRow & { password_hash: string }>(
    `SELECT id, email, display_name, locale, role, photo_visibility, password_hash
     FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email.trim()],
  );

  if (!row) return null;
  return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
}

/** No `assertCan`: resolves the session cookie into the actor itself. */
export async function findUserById(id: string): Promise<User | null> {
  const row = await queryOne<UserRow>(
    `${SELECT_USER} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return row ? toUser(row) : null;
}

export function actorFor(user: User): Actor {
  return { id: user.id, role: user.role };
}
