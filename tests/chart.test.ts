import { describe, expect, it } from "vitest";
import { buildChartGeometry } from "@/lib/chart";

const point = (day: string, volumeKg: number) => ({ day, volumeKg, sets: 1 });

describe("volume chart geometry", () => {
  it("returns nothing to draw for an empty series", () => {
    const geometry = buildChartGeometry([]);
    expect(geometry.dots).toEqual([]);
    expect(geometry.polyline).toBe("");
    expect(geometry.maxVolumeKg).toBe(0);
  });

  it("centres a single day rather than drawing a degenerate line", () => {
    const geometry = buildChartGeometry([point("2026-08-20", 500)], 320, 180);
    expect(geometry.dots).toHaveLength(1);
    expect(geometry.dots[0].x).toBe(160);
  });

  it("puts the highest day at the top and the lowest at the bottom", () => {
    const geometry = buildChartGeometry(
      [point("2026-08-20", 200), point("2026-08-21", 800)],
      320,
      180,
    );

    const [first, second] = geometry.dots;
    expect(geometry.maxVolumeKg).toBe(800);
    expect(second.y).toBeLessThan(first.y); // smaller y is higher on screen
    expect(second.y).toBe(24); // top padding
    expect(first.x).toBeLessThan(second.x); // days run left to right
  });

  it("keeps every point inside the viewbox", () => {
    const geometry = buildChartGeometry(
      [point("2026-08-20", 0), point("2026-08-21", 1200), point("2026-08-22", 600)],
      320,
      180,
    );

    for (const dot of geometry.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThanOrEqual(320);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(180);
    }
  });
});
