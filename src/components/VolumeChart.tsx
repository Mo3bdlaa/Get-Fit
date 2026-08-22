import { buildChartGeometry } from "@/lib/chart";
import type { VolumePoint } from "@/lib/repo/workoutLogs";

export default function VolumeChart({
  points,
  label,
}: {
  points: VolumePoint[];
  label: string;
}) {
  const geometry = buildChartGeometry(points);

  return (
    // The chart is a value axis, not a reading direction: it stays LTR in Arabic.
    <div dir="ltr">
      <svg
        className="card"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        width="100%"
        role="img"
        aria-label={label}
      >
        {geometry.dots.length > 1 && (
          <polyline
            points={geometry.polyline}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        {geometry.dots.map((dot) => (
          <circle key={dot.point.day} cx={dot.x} cy={dot.y} r="4" fill="var(--accent)">
            <title>{`${dot.point.day} — ${dot.point.volumeKg} kg`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
