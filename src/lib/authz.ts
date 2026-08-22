import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";

/**
 * The single server-side authorisation layer (BRD §10).
 *
 * Every read or write of a user-owned record goes through `assertCan`.
 * Per-query filtering inside route handlers is prohibited — a handler that
 * writes its own `WHERE owner_id = ...` is one refactor away from a data leak,
 * and it bypasses the audit log that NFR7 requires.
 */

export type Role = "trainee" | "coach" | "admin";

export type Actor = { id: string; role: Role };

export type Action = "read" | "create" | "update" | "delete";

export type Resource =
  | { type: "profile"; ownerId: string }
  | { type: "workout_log"; ownerId: string }
  | { type: "exercise"; visibility: "global" | "private"; ownerId: string | null };

export class AuthorizationError extends Error {
  constructor(message = "Not authorised") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function decide(actor: Actor, action: Action, resource: Resource): boolean {
  if (resource.type === "exercise") {
    // The catalogue is world-readable; only admins may write to it. AI and
    // coaches propose entries through moderation, never by writing directly (§6).
    if (action === "read") {
      return resource.visibility === "global" || resource.ownerId === actor.id;
    }
    return actor.role === "admin";
  }

  const isOwner = resource.ownerId === actor.id;
  if (isOwner) return true;

  // Coaches only ever see trainees through a team membership. Teams arrive in
  // R3; until then there is no path by which a coach reaches another user's
  // data, and inventing one early is how the coach layer leaks.
  if (actor.role === "admin" && action === "read") return true;

  return false;
}

function recordAudit(actor: Actor, action: Action, resource: Resource): void {
  if (resource.type === "exercise") return; // catalogue reads are not personal data
  if (resource.ownerId === actor.id) return; // NFR7 covers *another* user's data

  getDb()
    .prepare(
      `INSERT INTO audit_log (id, actor_id, subject_id, action, resource_type, resource_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), actor.id, resource.ownerId, action, resource.type, null, nowIso());
}

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  return decide(actor, action, resource);
}

/** Throws unless the actor may perform `action`; records cross-user access. */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (!decide(actor, action, resource)) {
    throw new AuthorizationError(
      `${actor.role} may not ${action} ${resource.type}`,
    );
  }
  recordAudit(actor, action, resource);
}
