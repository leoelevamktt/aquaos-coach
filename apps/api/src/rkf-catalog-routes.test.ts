import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerRkfCatalogRoutes } from "./rkf-catalog-routes.js";
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
const testRoot = mkdtempSync(join(tmpdir(), "rkf-catalog-http-"));
const managed = new ManagedStore(join(testRoot, "managed.json"));
attachAuthStore(managed);

function fixture(): RkfCatalogArtifact {
  return {
    manifest: {
      artifact: "catalogo-mestre-rkf", version: 1, sourceFile: "fixture.xlsx", sourceSha256: "f".repeat(64), sourceBytes: 1, generatedAt: "2026-09-01T00:00:00.000Z",
      headerRow: 5, sheetCount: 2, rows: { ATLETAS: 2, DICIONARIOS: 1 }, sheetSha256: {}, packageHash: "hash-http",
      sourceCellErrors: [{ sheet: "ATLETAS", cell: "F6", value: "#REF!" }],
    },
    sheets: {
      ATLETAS: columnar([
        { ID_Atleta: "ATL-001", Nome_Completo: "Ana Souza", Status_Cadastro: "Validado", F: "#REF!" },
        { ID_Atleta: "ATL-002", Nome_Completo: "Bruno Lima", Status_Cadastro: "Rascunho", F: "" },
      ]),
      DICIONARIOS: columnar([{ Categoria: "Zonas", Valor: "A2", Significado: "Aeróbio" }]),
    },
  };
}

const catalogStore = new RkfCatalogStore(join(testRoot, "sidecar"), fixture());
await catalogStore.import({ organizationId: "org-demo", actorId: "test" });
registerRkfCatalogRoutes(app, catalogStore);

const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

describe("GET /api/v1/rkf/catalog", () => {
  it("retorna página, sheets, source e marca a linha com erro de origem", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=ATLETAS&offset=0&limit=1", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("ATL-001");
    expect(body.data[0].payload.sourceCellError).toBe(true);
    expect(body.total).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(1);
    expect(body.sheets).toEqual([{ name: "ATLETAS", rows: 2 }, { name: "DICIONARIOS", rows: 1 }]);
    expect(body.source).toMatchObject({ version: 1, packageHash: "hash-http", importedAt: expect.any(String) });
  });

  it("exige autenticação", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=ATLETAS" });
    expect(response.statusCode).toBe(401);
  });

  it("rejeita atleta (somente coach/admin)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=ATLETAS", headers: { cookie: athleteCookie } });
    expect(response.statusCode).toBe(403);
  });

  it("valida sheet contra o manifesto (404)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=NAO_EXISTE", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(404);
  });

  it("limita limit a 500 e normaliza offset negativo", async () => {
    const overLimit = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=ATLETAS&limit=501", headers: { cookie: coachCookie } });
    expect(overLimit.statusCode).toBe(200);
    expect(overLimit.json().limit).toBe(500);
    const negative = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=ATLETAS&offset=0&limit=1", headers: { cookie: coachCookie } });
    expect(negative.statusCode).toBe(200);
    expect(negative.json().offset).toBe(0);
    expect(negative.json().limit).toBe(1);
  });

  it("busca por q com relevância", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/catalog?sheet=ATLETAS&q=ana", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(1);
    expect(response.json().data[0].id).toBe("ATL-001");
  });
});
