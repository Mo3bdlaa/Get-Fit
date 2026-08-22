"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { bootstrap } from "@/lib/bootstrap";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/current";
import {
  EmailTakenError,
  authenticate,
  registerUser,
  type User,
} from "@/lib/repo/users";
import { UnknownExerciseError, logSet } from "@/lib/repo/workoutLogs";
import type { MessageKey } from "@/lib/i18n";
import type { FormState } from "@/lib/formState";

/**
 * A form field as a string. `FormData.get` also returns `File`, which would
 * stringify to "[object Object]" and sail into the database as a plausible
 * value — so a non-string field is read as absent.
 */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function startSession(user: User): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function registrationErrorKey(error: unknown): MessageKey {
  if (error instanceof EmailTakenError) return "authEmailTaken";
  if (error instanceof ZodError) {
    const path = error.issues[0]?.path[0];
    if (path === "password") return "authPasswordTooShort";
    if (path === "displayName") return "authNameRequired";
  }
  return "authInvalidEmail";
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await bootstrap();
  let user: User;
  try {
    user = await registerUser({
      email: field(formData, "email"),
      password: field(formData, "password"),
      displayName: field(formData, "displayName"),
      locale: field(formData, "locale") === "ar" ? "ar" : "en",
    });
  } catch (error) {
    return { error: registrationErrorKey(error) };
  }

  await startSession(user);
  redirect("/log");
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await bootstrap();
  const user = await authenticate(
    field(formData, "email"),
    field(formData, "password"),
  );
  if (!user) return { error: "authInvalid" };

  await startSession(user);
  redirect("/log");
}

export async function signOutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function logSetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { actor } = await requireUser();
  try {
    await logSet(actor, {
      exerciseId: field(formData, "exerciseId"),
      weightKg: field(formData, "weightKg"),
      reps: field(formData, "reps"),
      rpe: field(formData, "rpe") || null,
      notes: field(formData, "notes") || null,
    });
  } catch (error) {
    if (error instanceof UnknownExerciseError) return { error: "logUnknownExercise" };
    if (error instanceof ZodError) return { error: "logInvalidNumbers" };
    throw error;
  }

  revalidatePath("/log");
  revalidatePath("/progress");
  return { error: null, ok: true };
}
