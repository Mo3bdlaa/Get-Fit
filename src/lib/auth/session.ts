import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "getfit_session";
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60; // §8/BRD: 24h token

export type SessionClaims = { userId: string };

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    return new TextEncoder().encode("dev-only-insecure-session-secret-change-me");
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret());
}

/** Returns null for anything not currently valid — expired, tampered, or absent. */
export async function readSessionToken(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const userId = payload.userId;
    return typeof userId === "string" ? { userId } : null;
  } catch {
    return null;
  }
}
