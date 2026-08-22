import { requireUser } from "@/lib/auth/current";
import { volumeByDay } from "@/lib/repo/workoutLogs";
import { messages } from "@/lib/i18n";
import VolumeChart from "@/components/VolumeChart";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const { user, actor } = await requireUser();
  const m = messages(user.locale);
  const points = await volumeByDay(actor, user.id);

  return (
    <>
      <h1>{m.progressTitle}</h1>
      <p>{m.progressSubtitle}</p>

      {points.length === 0 ? (
        <p>{m.progressEmpty}</p>
      ) : (
        <>
          <VolumeChart points={points} label={m.progressTitle} />
          <ul className="set-list">
            {points
              .slice()
              .reverse()
              .map((point) => (
                <li key={point.day}>
                  <span>{point.day}</span>
                  <strong>
                    {point.volumeKg} {m.progressKg}
                    <span className="meta">
                      {" "}
                      · {m.progressSetsLabel}: {point.sets}
                    </span>
                  </strong>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}
