import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
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

export async function registerUser(input: Registration): Promise<User> {
  const parsed = registrationSchema.parse(input);
  const db = getDb();

  const existing = db
    .prepare(
      "SELECT id FROM users WHERE lower(email) = lower(?) AND deleted_at IS NULL",
    )
    .get(parsed.email);
  if (existing) throw new EmailTakenError();

  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, locale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, parsed.email, await hashPassword(parsed.password), parsed.displayName, parsed.locale, now, now);

  return findUserById(id)!;
}

export async function authenticate(
  email: string,
  password: string,
): Promise<User | null> {
  const row = getDb()
    .prepare(
      `SELECT id, email, display_name, locale, role, photo_visibility, password_hash
       FROM users WHERE lower(email) = lower(?) AND deleted_at IS NULL`,
    )
    .get(email.trim()) as (UserRow & { password_hash: string }) | undefined;

  if (!row) return null;
  return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
}

export function findUserById(id: string): User | null {
  const row = getDb()
    .prepare(`${SELECT_USER} WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function actorFor(user: User): Actor {
  return { id: user.id, role: user.role };
}
