"use client";

import { useActionState } from "react";
import Link from "next/link";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/formState";
import type { Messages } from "@/lib/i18n/en";

type Mode = "login" | "register";

export default function AuthForm({
  mode,
  action,
  m,
}: {
  mode: Mode;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  m: Messages;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const isRegister = mode === "register";

  return (
    <>
      <h1>{isRegister ? m.authRegisterTitle : m.authLoginTitle}</h1>
      <p>{m.tagline}</p>

      <form action={formAction}>
        {isRegister && (
          <>
            <label>
              {m.authDisplayName}
              <input name="displayName" autoComplete="name" required />
            </label>
            <label>
              {m.authLanguage}
              <select name="locale" defaultValue="en">
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </label>
          </>
        )}

        <label>
          {m.authEmail}
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
          />
        </label>

        <label>
          {m.authPassword}
          <input
            name="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? 10 : undefined}
            required
          />
        </label>

        {state.error && <p className="error">{m[state.error]}</p>}

        <button type="submit" disabled={pending}>
          {isRegister ? m.authRegisterCta : m.authLoginCta}
        </button>
      </form>

      <p>
        {isRegister ? m.authHaveAccount : m.authNeedAccount}{" "}
        <Link href={isRegister ? "/login" : "/register"}>
          {isRegister ? m.authLoginCta : m.authRegisterCta}
        </Link>
      </p>
    </>
  );
}
