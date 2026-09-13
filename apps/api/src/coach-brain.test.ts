import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ManagedStore } from "./managed-store.js";
import { buildAthleteBrainContext, buildCoachDecisionEvidence, derivePlanningInputs } from "./coach-brain.js";
import { buildCoachBrainInjection } from "./coach-brain-llm-injection.js";
import { RKF_CONSTITUTION_RULES, RKF_BRAIN_SOURCES, buildRkfConstitutionContext } from "./rkf-brain-contracts.js";

const root = mkdtempSync(join(tmpdir(), "rkf-coach-brain-"));
const store = new ManagedStore(join(root, "data.json"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Cérebro RKF personalizado", () => {
  it("isola o contexto longitudinal por organização e atleta", () => {
    store.update("athletes", "ana-souza", { age: 16, specialty: "meio_fundo", poolLengthM: 50, developmentLevel: "rendimento", organizationId: "org-demo" });
    store.create("athleteResponses", { athleteId: "ana-souza", readiness: 81, pain: 1, note: "resposta-confirmada-ana", organizationId: "org-demo" });
    store.create("athleteResponses", { athleteId: "ana-souza", readiness: 5, note: "SEGREDO-OUTRO-TENANT", organizationId: "org-outro" });
    store.create("athleteResponses", { athleteId: "caio-martins", readiness: 40, note: "DADO-CAIO", organizationId: "org-demo" });

    const context = buildAthleteBrainContext(store, "org-demo", "ana-souza");
    expect(context).toContain("resposta-confirmada-ana");
    expect(context).not.toContain("SEGREDO-OUTRO-TENANT");
    expect(context).not.toContain("DADO-CAIO");
  });

  it("deriva inputs somente de dados confirmados/overrides e mantém proveniência", () => {
    store.update("athletes", "ana-souza", { age: 16, specialty: "meio_fundo", poolLengthM: 50, developmentLevel: "rendimento", organizationId: "org-demo" });
    store.create("prescriptions", {
      id: "coach-brain-published",
      athleteId: "ana-souza",
      title: "Sessão aprovada",
      status: "PUBLISHED",
      approvedBy: "coach",
      publishedSnapshot: { phase: "TRANSFORMACAO", objective: "Ritmo específico 200 livre", primaryZone: "A3", totalVolumeM: 5200, source: { librarySessionId: "S001" } },
      organizationId: "org-demo",
    });
    store.create("readinessScores", { athleteId: "ana-souza", score: 78, organizationId: "org-demo" });

    const derived = derivePlanningInputs(store, "org-demo", "ana-souza");
    expect(derived.missing).toEqual([]);
    expect(derived.athlete).toMatchObject({ athleteId: "ana-souza", age: 16, specialty: "meio_fundo", poolLengthM: 50 });
    expect(derived.request).toMatchObject({ phase: "TRANSFORMACAO", primaryZone: "A3", targetVolumeM: 5200, readiness: 78 });
    expect(derived.provenance.join(" ")).toContain("última prescrição confirmada");
  });

  it("injeta constituição, memória decisória e Planning Engine sem alegar identidade do treinador", () => {
    const brain = buildCoachBrainInjection(store, "org-demo", "Qual treino para Ana Souza hoje?");
    expect(brain).toContain("CONSTITUIÇÃO OPERACIONAL DO CÉREBRO RKF");
    expect(brain).toContain("RKF-C001");
    expect(brain).toContain("CÉREBRO RKF — MEMÓRIA DECISÓRIA");
    expect(brain).toContain("ana-souza");
    expect(brain).toContain("sem alegar ser o treinador");
    expect(brain).toContain("EVIDÊNCIA HISTÓRICA DO PADRÃO DECISÓRIO DO COACH");
    expect(brain).toContain("CANDIDATO NORMATIVO DO PLANNING ENGINE");
  });

  it("mantém decisões históricas como evidência e não como regra metodológica", () => {
    const evidence = buildCoachDecisionEvidence(store, "org-demo", "ana-souza");
    expect(evidence).toContain("Não transforme correlação histórica em regra metodológica");
    expect(evidence).toContain("coach-brain-published");
  });

  it("registra todas as fontes do cérebro e mantém os contratos não negociáveis", () => {
    expect(RKF_BRAIN_SOURCES.map((item) => item.id)).toEqual(expect.arrayContaining([
      "MASTER_COMPANY_HANDOFF_V1",
      "IMPLEMENTATION_MANUAL_V1",
      "OFFICIAL_IMPLEMENTATION_PACKAGE_V4",
      "PRIVATE_KNOWLEDGE_BASE_V1",
      "MASTER_CATALOG_V1",
      "RKF_V5_1",
      "COACH_DECISION_MEMORY",
    ]));
    expect(RKF_CONSTITUTION_RULES.length).toBeGreaterThanOrEqual(25);
    const constitution = buildRkfConstitutionContext();
    expect(constitution).toContain("XLSX é fonte editorial/contratual");
    expect(constitution).toContain("UNKNOWN/lacuna");
    expect(constitution).toContain("treinador permanece no comando");
  });
});
