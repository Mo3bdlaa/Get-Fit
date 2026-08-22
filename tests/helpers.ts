import { getDb } from "@/lib/db";
import { seedCatalogue } from "@/lib/repo/exercises";
import { actorFor, registerUser } from "@/lib/repo/users";
import type { Actor } from "@/lib/authz";

export function freshDatabase(): void {
  const db = getDb();
  for (const table of ["audit_log", "workout_logs", "exercises", "users"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  seedCatalogue();
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
    getDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(overrides.role, user.id);
    return { id: user.id, role: overrides.role };
  }
  return actorFor(user);
}
