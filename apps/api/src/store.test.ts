import { describe, expect, it } from "vitest";
import { DemoStore } from "./store.js";

describe("DemoStore", () => {
  it("keeps imported external activities idempotent", () => {
    const store = new DemoStore();
    const base = { athleteId: "ath-ana", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), distanceMeters: 1000, durationSeconds: 900, completedSteps: 1, totalSteps: 1, source: "synthetic" as const, externalId: "same-external-id", rpe: 5 };
    store.recordCompleted(base);
    store.recordCompleted(base);
    expect(store.completed.filter((item) => item.externalId === "same-external-id")).toHaveLength(1);
  });

  it("can push to Garmin and rejects Polar push in the current capability matrix", async () => {
    const store = new DemoStore();
    const garmin = await store.sync("garmin", "ath-ana", "push");
    expect(garmin.job.status).toBe("completed");
    await expect(store.sync("polar", "ath-caio", "push")).rejects.toThrow("não oferece envio");
  });
});
