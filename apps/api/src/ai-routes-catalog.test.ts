import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalogKnowledgeContext, registerAiRoutes } from "./ai-routes.js";
import { RkfCatalogStore } from "./rkf-catalog-store.js";
import type { RkfCatalogArtifact } from "./rkf-catalog-store.js";
import { attachAuthStore, login } from "./auth.js";
import { ManagedStore } from "./managed-store.js";

function columnar(rows: Array<Record<string, string>>) {
  const columns = Object.keys(rows[0] ?? {});
  const values = rows.map((row) => columns.map((column) => row[column] ?? ""));
  return { columns, rows: values, search: values.map((row) => row.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).join("\u0000") };
}

const app = Fastify({ logger: false });
const testRoot = mkdtempSync(join(tmpdir(), "rkf-ai-retrieval-"));
const managed = new ManagedStore(join(testRoot, "managed.json"));
attachAuthStore(managed);

function fixture(): RkfCatalogArtifact {
  return {
    manifest: {
      artifact: "catalogo-mestre-rkf", version: 1, sourceFile: "fixture.xlsx", sourceSha256: "f".repeat(64), sourceBytes: 1, generatedAt: "2026-09-01T00:00:00.000Z",
      headerRow: 5, sheetCount: 1, rows: { SESSOES: 1 }, sheetSha256: {}, packageHash: "hash-ai",
      sourceCellErrors: [],
    },
    sheets: {
      SESSOES: columnar([{ ID_Sessao: "S-1", Nome_Sessao: "Aeróbio longo A2", Status: "Validado", Fonte: "Diário de treinos 2012" }]),
    },
  };
}

const catalogStore = new RkfCatalogStore(join(testRoot, "sidecar"), fixture());
await catalogStore.import({ organizationId: "org-demo", actorId: "test" });
registerAiRoutes(app, managed, catalogStore);

const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

describe("POST /api/v1/ai/chat com retrieval do catálogo", () => {
  it("usa versão e hash reais da importação no contexto recuperado", () => {
    const context = buildCatalogKnowledgeContext(catalogStore, "org-demo", "aeróbio A2");
    expect(context).toContain("hash da importação: hash-ai");
    expect(context).toContain("importação versão 1");
  });

  it("rejeita mensagem sem LLM_API_KEY antes de construir contexto (sem regressão do contrato)", async () => {
    const previous = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      const response = await app.inject({
        method: "POST", url: "/api/v1/ai/chat", headers: { cookie: coachCookie },
        payload: { messages: [{ role: "user", content: "o que diz o acervo sobre treinos aeróbios longos?" }] },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      if (previous === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = previous;
    }
  });
});
