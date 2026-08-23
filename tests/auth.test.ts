import { beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { queryOne } from "@/lib/db";
import { authenticate, registerUser, EmailTakenError } from "@/lib/repo/users";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import { freshDatabase } from "./helpers";

const PASSWORD = "correct-horse-battery";

beforeEach(async () => {
  await freshDatabase();
});

describe("registration", () => {
  it("creates an account that can then sign in", async () => {
    const user = await registerUser({
      email: "sam@example.com",
      password: PASSWORD,
      displayName: "Sam",
    });

    expect(user.id).toBeTruthy();
    expect(user.locale).toBe("en");
    expect(user.role).toBe("trainee");
    expect(user.photoVisibility).toBe("private"); // §7: private by default

    const signedIn = await authenticate("sam@example.com", PASSWORD);
    expect(signedIn?.id).toBe(user.id);
  });

  it("never stores the password in a recoverable form", async () => {
    await registerUser({
      email: "sam@example.com",
      password: PASSWORD,
      displayName: "Sam",
    });

    const row = (await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      ["sam@example.com"],
    ))!;

    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.password_hash).toMatch(/^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(await verifyPassword(PASSWORD, row.password_hash)).toBe(true);
  });

  it("rejects a duplicate email regardless of case", async () => {
    await registerUser({ email: "sam@example.com", password: PASSWORD, displayName: "Sam" });
    await expect(
      registerUser({ email: "SAM@Example.com", password: PASSWORD, displayName: "Sam" }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("rejects a password under 10 characters", async () => {
    await expect(
      registerUser({ email: "short@example.com", password: "nine char", displayName: "S" }),
    ).rejects.toThrow();
  });
});

describe("sign in", () => {
  beforeEach(async () => {
    await registerUser({ email: "sam@example.com", password: PASSWORD, displayName: "Sam" });
  });

  it("returns null for a wrong password", async () => {
    expect(await authenticate("sam@example.com", "wrong-password-here")).toBeNull();
  });

  it("returns null for an unknown address", async () => {
    expect(await authenticate("nobody@example.com", PASSWORD)).toBeNull();
  });

  it("matches the address case-insensitively", async () => {
    expect(await authenticate("SAM@EXAMPLE.COM", PASSWORD)).not.toBeNull();
  });
});

describe("password hashing", () => {
  it("salts, so identical passwords hash differently", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });
});

describe("session tokens", () => {
  it("round-trips the user id", async () => {
    const token = await createSessionToken("user-123");
    expect(await readSessionToken(token)).toEqual({ userId: "user-123" });
  });

  it("rejects a missing, tampered, or expired token", async () => {
    expect(await readSessionToken(undefined)).toBeNull();

    const token = await createSessionToken("user-123");
    expect(await readSessionToken(`${token}x`)).toBeNull();

    const expired = await new SignJWT({ userId: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(0)
      .setExpirationTime(1)
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    expect(await readSessionToken(expired)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const foreign = await new SignJWT({ userId: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret-entirely"));
    expect(await readSessionToken(foreign)).toBeNull();
  });
});
