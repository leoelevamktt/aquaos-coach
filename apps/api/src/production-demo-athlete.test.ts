import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { User } from "@natacao/domain";
import { ManagedStore } from "./managed-store.js";
import { derivePlanningInputs } from "./coach-brain.js";
import { ensureProductionDemoAthletePlanning } from "./production-demo-athlete.js";

const previousNodeEnv = process.env.NODE_ENV;
const previousAthleteEmail = process.env.AUTH_ATHLETE_EMAIL;
const roots: string[] = [];

afterEach(() => {
  process.env.NODE_ENV = previousNodeEnv;
  if (previousAthleteEmail === undefined) delete process.env.AUTH_ATHLETE_EMAIL;
  else process.env.AUTH_ATHLETE_EMAIL = previousAthleteEmail;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), "rkf-prod-demo-"));
  roots.push(root);
  return new ManagedStore(join(root, "data.json"));
}

const demoUser: User = {
  id: "user-prod-athlete",
  organizationId: "org-demo",
  name: "Ana Souza",
  email: "atleta@elevamkt.digital",
  role: "athlete",
  athleteId: "ana-souza",
};

describe("production demo athlete planning fixture", () => {
  it("deixa somente a conta demonstrativa pronta para o Planning Engine", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_ATHLETE_EMAIL = demoUser.email;
    const store = makeStore();

    store.update("athletes", "ana-souza", {
      birthDate: undefined,
      age: undefined,
      developmentLevel: undefined,
      specialty: undefined,
      poolLengthM: undefined,
    }, "update");

    const result = ensureProductionDemoAthletePlanning(store, demoUser);
    const derived = derivePlanningInputs(store, "org-demo", "ana-souza", { poolLengthM: 50 });

    expect(result.applied).toBe(true);
    expect(derived.missing).toEqual([]);
    expect(derived.athlete).toMatchObject({ athleteId: "ana-souza", specialty: "meio_fundo", developmentLevel: "rendimento", poolLengthM: 50 });
    expect(derived.request).toMatchObject({ phase: "BASE", primaryZone: "A2", targetVolumeM: 4800 });
    expect(store.get("prescriptions", "prod-demo-rkf-planning-anchor")).toMatchObject({ source: "PRODUCTION_DEMO_FIXTURE", status: "PUBLISHED", demoFixture: true });
  });

  it("não injeta fixture em atletas reais/convidados", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_ATHLETE_EMAIL = demoUser.email;
    const store = makeStore();
    const realUser: User = { ...demoUser, id: "user-real-athlete", athleteId: "caio-martins", name: "Caio Martins", email: "caio@example.com" };

    const result = ensureProductionDemoAthletePlanning(store, realUser);

    expect(result).toEqual({ applied: false, reason: "not-demo-athlete" });
    expect(store.get("prescriptions", "prod-demo-rkf-planning-anchor")).toBeUndefined();
  });
});
