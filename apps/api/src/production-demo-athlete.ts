import type { User } from "@natacao/domain";
import type { ManagedStore } from "./managed-store.js";

const DEMO_ATHLETE_ID = "ana-souza";
const DEMO_USER_ID = "user-prod-athlete";
const DEMO_PLAN_ID = "prod-demo-rkf-planning-anchor";
const RKF_PHASES = new Set(["ADAPTACAO", "BASE", "DESENVOLVIMENTO", "ESPECIFICO", "ACUMULACAO", "TRANSFORMACAO", "REALIZACAO", "TAPER", "COMPETICAO"]);
const RKF_ZONES = new Set(["VALAT", "A1", "A2", "A3", "AN1", "AN2"]);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isCompletePlanningAnchor(row: Record<string, unknown>) {
  const snapshot = objectValue(row.publishedSnapshot ?? row.prescription ?? row);
  const phase = String(snapshot.phase ?? row.phase ?? "").toUpperCase();
  const zone = String(snapshot.primaryZone ?? row.primaryZone ?? "").toUpperCase();
  const volume = Number(snapshot.totalVolumeM ?? row.totalVolumeM);
  return RKF_PHASES.has(phase) && RKF_ZONES.has(zone) && Number.isFinite(volume) && volume > 0;
}

/**
 * The AUTH_ATHLETE_* production account is an operational smoke/demo account.
 * It must be able to exercise the RKF athlete flow end-to-end, while real
 * invited athletes keep the strict UNKNOWN/no-inference policy.
 *
 * This fixture is deliberately scoped to the provisioned production demo user
 * and never runs for invited/real athlete accounts. Values are demo data, not
 * inferred observations about a real athlete.
 */
export function ensureProductionDemoAthletePlanning(store: ManagedStore, user: User) {
  if (process.env.NODE_ENV !== "production") return { applied: false, reason: "not-production" };
  if (user.id !== DEMO_USER_ID || user.role !== "athlete" || user.athleteId !== DEMO_ATHLETE_ID) {
    return { applied: false, reason: "not-demo-athlete" };
  }

  const configuredEmail = process.env.AUTH_ATHLETE_EMAIL?.trim().toLowerCase();
  if (configuredEmail && user.email.trim().toLowerCase() !== configuredEmail) {
    return { applied: false, reason: "demo-email-mismatch" };
  }

  const athlete = store.get("athletes", DEMO_ATHLETE_ID);
  if (!athlete) return { applied: false, reason: "profile-missing" };

  const profilePatch: Record<string, unknown> = {};
  if (!athlete.birthDate && !athlete.age) profilePatch.birthDate = "2002-04-18";
  if (!athlete.developmentLevel) profilePatch.developmentLevel = "rendimento";
  if (!athlete.specialty) profilePatch.specialty = "meio_fundo";
  if (athlete.poolLengthM !== 25 && athlete.poolLengthM !== 50) profilePatch.poolLengthM = 50;
  if (!athlete.primaryEvent && !athlete.goalEvent) profilePatch.primaryEvent = "200 m Livre";
  if (!(Number(athlete.weeklyDistance) > 0)) profilePatch.weeklyDistance = 28_600;
  if (!athlete.category) profilePatch.category = "Absoluto";

  if (Object.keys(profilePatch).length) {
    store.update("athletes", DEMO_ATHLETE_ID, {
      ...profilePatch,
      profileCompleteness: "DEMO_FIXTURE_READY",
      dataQuality: "PRODUCTION_DEMO_FIXTURE",
      demoFixture: true,
    }, "update");
  }

  const organizationId = user.organizationId;
  const existingCoachAnchor = store.list("prescriptions").find((row) =>
    String(row.organizationId ?? "org-demo") === organizationId
      && row.athleteId === DEMO_ATHLETE_ID
      && (row.status === "PUBLISHED" || Boolean(row.approvedBy) || Boolean(row.publishedSnapshot))
      && row.id !== DEMO_PLAN_ID
      && isCompletePlanningAnchor(row));

  if (existingCoachAnchor) {
    return { applied: true, profilePatched: Object.keys(profilePatch).length > 0, planCreated: false, reason: "existing-complete-coach-anchor" };
  }

  const publishedSnapshot = {
    phase: "BASE",
    objective: "Base aeróbia técnica do ciclo demonstrativo",
    primaryZone: "A2",
    totalVolumeM: 4_800,
    expectedPse: 6,
    durationMinutes: 90,
    source: { kind: "PRODUCTION_DEMO_FIXTURE" },
  };

  const existingDemo = store.get("prescriptions", DEMO_PLAN_ID);
  if (existingDemo) {
    store.update("prescriptions", DEMO_PLAN_ID, {
      athleteId: DEMO_ATHLETE_ID,
      targetType: "athlete",
      targetId: DEMO_ATHLETE_ID,
      title: "Âncora demonstrativa RKF · A2",
      objective: publishedSnapshot.objective,
      primaryZone: publishedSnapshot.primaryZone,
      totalVolumeM: publishedSnapshot.totalVolumeM,
      status: "PUBLISHED",
      approvalRequired: false,
      approvedBy: "production-demo-bootstrap",
      immutable: true,
      publishedSnapshot,
      source: "PRODUCTION_DEMO_FIXTURE",
      demoFixture: true,
      organizationId,
      actorId: "production-demo-bootstrap",
    }, "update");
    return { applied: true, profilePatched: Object.keys(profilePatch).length > 0, planCreated: false, reason: "demo-anchor-refreshed" };
  }

  store.create("prescriptions", {
    id: DEMO_PLAN_ID,
    athleteId: DEMO_ATHLETE_ID,
    targetType: "athlete",
    targetId: DEMO_ATHLETE_ID,
    title: "Âncora demonstrativa RKF · A2",
    objective: publishedSnapshot.objective,
    primaryZone: publishedSnapshot.primaryZone,
    totalVolumeM: publishedSnapshot.totalVolumeM,
    status: "PUBLISHED",
    approvalRequired: false,
    approvedBy: "production-demo-bootstrap",
    approvedAt: new Date().toISOString(),
    immutable: true,
    publishedSnapshot,
    source: "PRODUCTION_DEMO_FIXTURE",
    demoFixture: true,
    organizationId,
    actorId: "production-demo-bootstrap",
  }, "create");

  return { applied: true, profilePatched: Object.keys(profilePatch).length > 0, planCreated: true, reason: "demo-anchor-created" };
}
