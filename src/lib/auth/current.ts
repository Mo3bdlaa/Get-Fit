import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bootstrap } from "@/lib/bootstrap";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { actorFor, findUserById, type User } from "@/lib/repo/users";
import type { Actor } from "@/lib/authz";

/**
 * Reads the cookie before touching the database, for two reasons: an anonymous
 * request never opens a connection at all, and `cookies()` is what marks the
 * route dynamic — reaching for the database first made Next try to prerender
 * `/_not-found` against a database that does not exist at build time.
 */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await readSessionToken(token);
  if (!claims) return null;

  await bootstrap();
  return findUserById(claims.userId);
}

export async function requireUser(): Promise<{ user: User; actor: Actor }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return { user, actor: actorFor(user) };
}
