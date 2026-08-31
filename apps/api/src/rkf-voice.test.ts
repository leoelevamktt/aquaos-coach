import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRkfRoutes } from "./rkf-routes.js";
import { ManagedStore } from "./managed-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";
import { extractPostTrainingFields, validateVoiceExtraction, voicePipelineEvidence, VOICE_NEXT } from "./rkf-voice.js";

const app = Fastify({ logger: false });
const testRoot = mkdtempSync(join(tmpdir(), "rkf-voice-"));
const store = new ManagedStore(join(testRoot, "rkf.json"));
await app.register(multipart);
registerRkfRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

const fullDictation = "Pós-treino de hoje: atleta Ana Souza, PSE 7, duração de 90 minutos, nadei 5700 metros, dor 1, técnica 4";

describe("extração de campos do ditado", () => {
  it("extrai PSE, duração, volume, dor e técnica do ditado completo", () => {
    const extraction = extractPostTrainingFields(fullDictation);
    expect(extraction.pse).toBe(7);
    expect(extraction.durationMinutes).toBe(90);
    expect(extraction.executedVolumeM).toBe(5700);
    expect(extraction.pain).toBe(1);
    expect(extraction.technique).toBe(4);
    expect(extraction.athleteId).toBe("ana-souza");
    expect(extraction.missingCritical).toEqual([]);
  });

  it("ditado incompleto marca campos críticos ausentes sem inventar", () => {
    const extraction = extractPostTrainingFields("treino leve hoje de manhã");
    expect(extraction.missingCritical).toContain("pse");
    expect(extraction.missingCritical).toContain("durationMinutes");
    expect(extraction.pse).toBeUndefined();
    expect(extraction.confidence).toBeLessThan(0.9);
  });

  it("valida ranges e rejeita PSE fora de 0–10", () => {
    const extraction = extractPostTrainingFields(fullDictation);
    expect(validateVoiceExtraction(extraction).valid).toBe(true);
    expect(validateVoiceExtraction({ ...extraction, pse: 12 }).valid).toBe(false);
    expect(validateVoiceExtraction({ ...extraction, technique: 0 }).valid).toBe(false);
  });
});

describe("pipeline de voz ponta a ponta (LOCAL → COMMIT)", () => {
  it("cria ingestão de voz com transcrição direta e extrai campos", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions", headers: { cookie: coachCookie },
      payload: { title: "Ditado pós-treino quarta", transcript: fullDictation, provider: "stt-manual", confidence: 0.88 },
    });
    expect(created.statusCode).toBe(201);
    const record = created.json();
    expect(record.channel).toBe("VOICE");
    expect(record.voiceState).toBe("REVIEW");
    expect(record.transcript.sha256).toHaveLength(64);
    expect(record.extraction.pse).toBe(7);
    return record;
  });

  it("transcrição é imutável: segunda tentativa recebe 409 (VAL-014)", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions", headers: { cookie: coachCookie },
      payload: { title: "Ditado imutável", transcript: fullDictation },
    });
    const record = created.json();
    const second = await app.inject({
      method: "POST", url: `/api/v1/rkf/voice/ingestions/${record.id}/transcript`, headers: { cookie: coachCookie },
      payload: { text: "transcrição alterada", provider: "stt" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain("imutável");
  });

  it("correção por campo cria versão da extração sem tocar o transcript", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions", headers: { cookie: coachCookie },
      payload: { title: "Ditado com erro", transcript: "PSE 9, duração de 80 minutos, nadei 4000 metros" },
    });
    const record = created.json();
    const corrected = await app.inject({
      method: "PATCH", url: `/api/v1/rkf/voice/ingestions/${record.id}/extraction`, headers: { cookie: coachCookie },
      payload: { pse: 7, athleteId: "ana-souza", date: "2026-09-02", correctionNote: "PSE corrigido no review" },
    });
    expect(corrected.statusCode).toBe(200);
    const body = corrected.json();
    expect(body.extraction.pse).toBe(7);
    expect(body.corrections).toBe(1);
    expect(body.voiceState).toBe("VALIDATED");
    expect(body.transcript.raw).toContain("PSE 9"); // transcript original preservado
  });

  it("commit sem confirmação é rejeitado (VAL-013)", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions", headers: { cookie: coachCookie },
      payload: { title: "Ditado não confirmado", transcript: fullDictation },
    });
    const record = created.json();
    const commit = await app.inject({ method: "POST", url: `/api/v1/rkf/voice/ingestions/${record.id}/commit`, headers: { cookie: coachCookie }, payload: {} });
    expect(commit.statusCode).toBe(409);
    expect(commit.json().error).toContain("confirmação humana");
  });

  it("confirmação exige campos críticos completos (422 com missing)", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions", headers: { cookie: coachCookie },
      payload: { title: "Ditado incompleto", transcript: "treino leve" },
    });
    const record = created.json();
    const confirm = await app.inject({ method: "POST", url: `/api/v1/rkf/voice/ingestions/${record.id}/confirm`, headers: { cookie: coachCookie }, payload: {} });
    expect(confirm.statusCode).toBe(422);
    expect(confirm.json().missing).toEqual(expect.arrayContaining(["athleteId", "date", "pse", "durationMinutes"]));
  });

  it("fluxo completo: transcript → correção → confirmação → commit gera atividade de carga", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions", headers: { cookie: coachCookie },
      payload: { title: "Ditado completo", transcript: "PSE 6, duração de 75 minutos, nadei 5200 metros, dor 0, técnica 5" },
    });
    const record = created.json();
    // Correção adiciona athleteId e date ausentes do ditado
    await app.inject({
      method: "PATCH", url: `/api/v1/rkf/voice/ingestions/${record.id}/extraction`, headers: { cookie: coachCookie },
      payload: { athleteId: "ana-souza", date: "2026-09-02" },
    });
    const confirmed = await app.inject({ method: "POST", url: `/api/v1/rkf/voice/ingestions/${record.id}/confirm`, headers: { cookie: coachCookie }, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ voiceState: "CONFIRMED", confirmedBy: "user-coach" });
    const committed = await app.inject({ method: "POST", url: `/api/v1/rkf/voice/ingestions/${record.id}/commit`, headers: { cookie: coachCookie }, payload: {} });
    expect(committed.statusCode).toBe(201);
    const body = committed.json();
    expect(body.ok).toBe(true);
    expect(body.record.voiceState).toBe("COMMITTED");
    expect(body.activity).toMatchObject({ type: "rkf-load-session", athleteId: "ana-souza", pse: 6, durationMinutes: 75, source: "voice" });
  });

  it("áudio enviado por multipart fica LOCAL/DRAFT sem inventar transcrição", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/voice/ingestions",
      headers: { cookie: coachCookie, "content-type": "multipart/form-data; boundary=---voxbound" },
      payload: `-----voxbound\r\nContent-Disposition: form-data; name="file"; filename="ditado.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFfakeaudio\r\n-----voxbound--\r\n`,
    });
    expect(response.statusCode).toBe(201);
    const record = response.json();
    expect(record.voiceState).toBe("LOCAL");
    expect(record.sttStatus).toBe("PENDING");
    expect(record.transcript).toBeNull();
  });
});

describe("prova de pipeline para os gates", () => {
  it("voicePipelineEvidence cobre máquina de estados completa", () => {
    const evidence = voicePipelineEvidence();
    expect(evidence.pipelineComplete).toBe(true);
    expect(evidence.completeFields).toBe(true);
    expect(evidence.validation.valid).toBe(true);
    expect(evidence.incompleteDetected).toBe(true);
    expect(evidence.pipelineOrder).toBe("LOCAL → DRAFT → REVIEW → VALIDATED → CONFIRMED → COMMITTED");
    expect(VOICE_NEXT.CONFIRMED).toBe("COMMITTED");
  });

  it("gates G11 e G26 passam com a prova executável", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/release-gates", headers: { cookie: coachCookie } });
    const gates = response.json().gates;
    expect(gates.find((gate: { id: string }) => gate.id === "G11").status).toBe("PASS");
    expect(gates.find((gate: { id: string }) => gate.id === "G26").status).toBe("PASS");
  });
});
