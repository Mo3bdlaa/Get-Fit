import type { VolumePoint } from "@/lib/repo/workoutLogs";

export type ChartGeometry = {
  width: number;
  height: number;
  dots: { x: number; y: number; point: VolumePoint }[];
  polyline: string;
  maxVolumeKg: number;
};

const PADDING = 24;

/**
 * Pure geometry so the chart is unit-testable without a DOM. A single data
 * point renders as one dot on the midline rather than a degenerate line.
 */
export function buildChartGeometry(
  points: VolumePoint[],
  width = 320,
  height = 180,
): ChartGeometry {
  const maxVolumeKg = points.reduce((max, p) => Math.max(max, p.volumeKg), 0);
  const usableWidth = width - PADDING * 2;
  const usableHeight = height - PADDING * 2;

  const dots = points.map((point, index) => {
    const x =
      points.length === 1
        ? width / 2
        : PADDING + (usableWidth * index) / (points.length - 1);
    const ratio = maxVolumeKg === 0 ? 0 : point.volumeKg / maxVolumeKg;
    const y = height - PADDING - usableHeight * ratio;
    return { x, y, point };
  });

  return {
    width,
    height,
    dots,
    polyline: dots.map((dot) => `${dot.x},${dot.y}`).join(" "),
    maxVolumeKg,
  };
}
