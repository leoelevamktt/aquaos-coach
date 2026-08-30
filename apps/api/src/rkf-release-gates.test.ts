import { describe, expect, it } from "vitest";
import { evaluateRkfReleaseGates, type ReleaseGateRuntimeEvidence } from "./rkf-release-gates.js";

const baseline: ReleaseGateRuntimeEvidence = {
  seed: { located: true, staged: true, imported: true, sessions: 910, blocks: 6226, prescriptionUnits: 6226, files: 10 },
  apiContractCount: 34,
  entityCount: 20,
  migrationCount: 0,
  eventContractCount: 0,
  resultCount: 1,
  loadSnapshotCount: 1,
  postTrainingSeedCount: 44,
  fatigueSeedCount: 0,
  ingestionSeedCount: 0,
  confirmedIngestionCount: 1,
  ingestionChannelsObserved: ["TEXT"],
  auditableOriginalFormatsObserved: ["txt"],
  assignmentTargetTypesObserved: ["team", "group", "athlete"],
};

describe("release gates RKF", () => {
  it("executa os 36 gates, exclui devices reais e não declara produção pronta", () => {
    const report = evaluateRkfReleaseGates(baseline, new Date("2026-08-30T12:00:00.000Z"));
    expect(report.gates).toHaveLength(36);
    expect(report.summary.total).toBe(36);
    expect(report.decision).toBe("BLOCKED");
    expect(report.gates.find((gate) => gate.id === "G07")).toMatchObject({ status: "EXCLUDED", blocking: false });
    expect(report.gates.find((gate) => gate.id === "G04")).toMatchObject({ status: "BLOCKED", expected: 43, actual: 20 });
    expect(report.gates.find((gate) => gate.id === "G05")).toMatchObject({ status: "BLOCKED", expected: ">=1", actual: 0 });
    expect(report.gates.find((gate) => gate.id === "G34")).toMatchObject({ status: "PASS" });
    expect(report.gates.every((gate) => gate.evidence.length > 0)).toBe(true);
  });

  it("não aprova seed apenas localizada sem importação transacional", () => {
    const report = evaluateRkfReleaseGates({ ...baseline, seed: { ...baseline.seed, imported: false } });
    expect(report.gates.find((gate) => gate.id === "G10")).toMatchObject({ status: "REVIEW", blocking: true });
    expect(report.decision).toBe("BLOCKED");
  });

  it("só aprova cobertura dos cinco canais quando todos foram observados", () => {
    const report = evaluateRkfReleaseGates({ ...baseline, ingestionChannelsObserved: ["TEXT", "PHOTO", "FILE", "VOICE", "API"] });
    expect(report.gates.find((gate) => gate.id === "G29")).toMatchObject({ status: "PASS", actual: 5 });
  });
});
