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
  bootstrap();
  let user: User;
  try {
    user = await registerUser({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      locale: formData.get("locale") === "ar" ? "ar" : "en",
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
  bootstrap();
  const user = await authenticate(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
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
    logSet(actor, {
      exerciseId: String(formData.get("exerciseId") ?? ""),
      weightKg: String(formData.get("weightKg") ?? ""),
      reps: String(formData.get("reps") ?? ""),
      rpe: formData.get("rpe") ? String(formData.get("rpe")) : null,
      notes: formData.get("notes") ? String(formData.get("notes")) : null,
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
