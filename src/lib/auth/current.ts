import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bootstrap } from "@/lib/bootstrap";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { actorFor, findUserById, type User } from "@/lib/repo/users";
import type { Actor } from "@/lib/authz";

export async function currentUser(): Promise<User | null> {
  bootstrap();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await readSessionToken(token);
  return claims ? findUserById(claims.userId) : null;
}

export async function requireUser(): Promise<{ user: User; actor: Actor }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return { user, actor: actorFor(user) };
}
