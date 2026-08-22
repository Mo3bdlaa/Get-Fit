"use client";

import { useActionState, useEffect, useRef } from "react";
import { logSetAction } from "@/app/actions";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/formState";
import type { Messages } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";

export type ExerciseOption = { id: string; nameEn: string; nameAr: string };

export default function LogSetForm({
  exercises,
  locale,
  m,
  defaults,
}: {
  exercises: ExerciseOption[];
  locale: Locale;
  m: Messages;
  defaults: { exerciseId?: string; weightKg?: number; reps?: number };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    logSetAction,
    EMPTY_FORM_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // NFR3: after a set lands the form stays loaded with the same weight and reps,
  // so the next set is two taps. Only the note — which was about that set — clears.
  useEffect(() => {
    if (!state.ok) return;
    const notes = formRef.current?.querySelector("textarea");
    if (notes) notes.value = "";
  }, [state.ok]);

  return (
    <form action={formAction} ref={formRef}>
      <label>
        {m.logExercise}
        <select name="exerciseId" defaultValue={defaults.exerciseId ?? exercises[0]?.id}>
          {exercises.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {locale === "ar" ? exercise.nameAr : exercise.nameEn}
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <label>
          {m.logWeight}
          <input
            name="weightKg"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            defaultValue={defaults.weightKg ?? 20}
            required
          />
        </label>
        <label>
          {m.logReps}
          <input
            name="reps"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            defaultValue={defaults.reps ?? 5}
            required
          />
        </label>
      </div>

      <label>
        {m.logRpe}
        <input name="rpe" type="number" inputMode="decimal" step="0.5" min="1" max="10" />
      </label>

      <label>
        {m.logNotes}
        <textarea name="notes" maxLength={500} />
      </label>

      {state.error && <p className="error">{m[state.error]}</p>}
      {state.ok && !state.error && <p className="status">{m.logSaved}</p>}

      <button type="submit" disabled={pending}>
        {m.logSubmit}
      </button>
    </form>
  );
}
