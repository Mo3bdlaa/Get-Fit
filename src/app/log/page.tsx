import { requireUser } from "@/lib/auth/current";
import { listCatalogue } from "@/lib/repo/exercises";
import { listSets } from "@/lib/repo/workoutLogs";
import { messages } from "@/lib/i18n";
import LogSetForm from "@/components/LogSetForm";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const { user, actor } = await requireUser();
  const m = messages(user.locale);
  const exercises = listCatalogue(actor);
  const recent = listSets(actor, user.id, 20);
  const last = recent[0];

  return (
    <>
      <h1>{m.logTitle}</h1>

      <LogSetForm
        exercises={exercises.map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr }))}
        locale={user.locale}
        m={m}
        defaults={{
          exerciseId: last?.exerciseId,
          weightKg: last?.weightKg,
          reps: last?.reps,
        }}
      />

      <h2>{m.logRecent}</h2>
      {recent.length === 0 ? (
        <p>{m.logEmpty}</p>
      ) : (
        <ul className="set-list">
          {recent.map((set) => (
            <li key={set.id}>
              <span>
                {user.locale === "ar" ? set.exerciseNameAr : set.exerciseNameEn}
                <br />
                <span className="meta">
                  {m.logSetNumber} {set.setIndex} · {set.performedAt.slice(0, 10)}
                  {set.rpe !== null ? ` · RPE ${set.rpe}` : ""}
                </span>
              </span>
              <strong>
                {set.weightKg} {m.progressKg} × {set.reps}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
