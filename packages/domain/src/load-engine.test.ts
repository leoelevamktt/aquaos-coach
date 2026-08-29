import { describe, expect, it } from "vitest";
import { DemoLoadEngine } from "./load-engine.js";

describe("DemoLoadEngine", () => {
  it("produces a deterministic, explained load value", () => {
    const engine = new DemoLoadEngine();
    const result = engine.calculate({ prescribedDistanceMeters: 4000, completedDistanceMeters: 4000, durationSeconds: 3600, rpe: 7, targetIntensity: 1 });
    expect(result.value).toBe(34.5);
    expect(result.adherence).toBe(100);
    expect(result.engine).toBe("DemoLoadEngine");
    expect(result.explanation).toContain("Demonstração");
  });

  it("caps adherence and applies wellness adjustment", () => {
    const engine = new DemoLoadEngine();
    const result = engine.calculate({ prescribedDistanceMeters: 4000, completedDistanceMeters: 2000, durationSeconds: 1800, rpe: 5, wellness: { fatigue: 8, soreness: 6 } });
    expect(result.adherence).toBe(50);
    expect(result.components.wellnessPenalty).toBe(7);
    expect(result.value).toBeGreaterThan(0);
  });
});
