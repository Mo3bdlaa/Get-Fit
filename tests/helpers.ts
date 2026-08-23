import { ensureMigrated, query } from "@/lib/db";
import { seedCatalogue } from "@/lib/repo/exercises";
import { actorFor, registerUser } from "@/lib/repo/users";
import type { Actor } from "@/lib/authz";

/**
 * Each test file runs in its own forked process against its own in-memory
 * PGlite instance, so truncating between cases is enough isolation.
 */
export async function freshDatabase(): Promise<void> {
  await ensureMigrated();
  await query(
    "TRUNCATE audit_log, workout_logs, exercises, users RESTART IDENTITY CASCADE",
  );
  await seedCatalogue();
}

export async function makeUser(
  email: string,
  overrides: Partial<{ role: "trainee" | "coach" | "admin" }> = {},
): Promise<Actor> {
  const user = await registerUser({
    email,
    password: "correct-horse-battery",
    displayName: email.split("@")[0],
  });
  if (overrides.role) {
    await query("UPDATE users SET role = $1 WHERE id = $2", [overrides.role, user.id]);
    return { id: user.id, role: overrides.role };
  }
  return actorFor(user);
}
