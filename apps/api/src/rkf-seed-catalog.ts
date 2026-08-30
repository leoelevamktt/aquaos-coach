import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import { parseDelimited } from "./managed-store.js";

const seedRoot = fileURLToPath(new URL("../../../data/rkf/RKF_V5_1/", import.meta.url));

const catalog = {
  "sessions.csv": { label: "Sessões", expectedRows: 910, use: "Biblioteca e seleção de candidatos", operational: true },
  "blocks.csv": { label: "Blocos", expectedRows: 6226, use: "Composição e auditoria de sessões", operational: true },
  "prescription_units.csv": { label: "Unidades de prescrição", expectedRows: 6226, use: "Rastreabilidade da atomização", operational: false },
  "normalization_audit.csv": { label: "Auditoria de normalização", expectedRows: 910, use: "Evidência de fidelidade da seed", operational: true },
  "block_summary.csv": { label: "Resumo dos blocos", expectedRows: 910, use: "Reconciliação de volume", operational: true },
  "zones.csv": { label: "Zonas", expectedRows: 6, use: "Vocabulário do motor", operational: true },
  "materials.csv": { label: "Materiais", expectedRows: 11, use: "Dicionário de prescrição", operational: true },
  "skills.csv": { label: "Habilidades", expectedRows: 14, use: "Dicionário técnico", operational: true },
  "rules_rkf.csv": { label: "Regras RKF", expectedRows: 18, use: "Hard rules e validações", operational: true },
  "exercises.csv": { label: "Exercícios", expectedRows: 15, use: "Biblioteca técnica", operational: true },
} as const;

export type SeedFileName = keyof typeof catalog;

type LoadedFile = {
  rows: Record<string, unknown>[];
  columns: string[];
  sha256: string;
  sizeBytes: number;
};

const cache = new Map<SeedFileName, LoadedFile>();

function load(name: SeedFileName): LoadedFile {
  const current = cache.get(name);
  if (current) return current;
  const buffer = readFileSync(`${seedRoot}${name}`);
  const rows = parseDelimited(buffer.toString("utf8"));
  const value = {
    rows,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.length,
  };
  cache.set(name, value);
  return value;
}

async function requireStaff(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!user) { void reply.code(401).send({ error: "Autenticação necessária" }); return undefined; }
  if (!roleAllows(user, ["coach", "admin"])) { void reply.code(403).send({ error: "Catálogo restrito à comissão técnica" }); return undefined; }
  return user;
}

export function seedCatalogSummary() {
  const files = (Object.keys(catalog) as SeedFileName[]).map((name) => {
    const source = catalog[name];
    const loaded = load(name);
    return {
      name,
      ...source,
      rows: loaded.rows.length,
      columns: loaded.columns,
      sha256: loaded.sha256,
      sizeBytes: loaded.sizeBytes,
      integrity: loaded.rows.length === source.expectedRows ? "PASS" : "BLOCKED",
      activation: source.operational ? "OPERATIONAL" : "PRESERVED_REVIEW",
    };
  });
  return {
    version: "RKF_V5.1",
    status: files.every((file) => file.integrity === "PASS") ? "INTEGRITY_PASS" : "BLOCKED",
    totalRows: files.reduce((sum, file) => sum + file.rows, 0),
    operationalFiles: files.filter((file) => file.operational).length,
    reviewFiles: files.filter((file) => !file.operational).length,
    files,
  };
}

export function registerRkfSeedCatalogRoutes(app: FastifyInstance) {
  app.get("/api/v1/rkf/seed/files", async (request, reply) => {
    if (!await requireStaff(request, reply)) return;
    return seedCatalogSummary();
  });

  app.get("/api/v1/rkf/seed/files/:name", async (request, reply) => {
    if (!await requireStaff(request, reply)) return;
    const params = z.object({ name: z.string() }).safeParse(request.params);
    const query = z.object({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(250).default(50),
      search: z.string().trim().max(120).optional(),
    }).safeParse(request.query);
    if (!params.success || !query.success || !(params.data.name in catalog)) return reply.code(404).send({ error: "Arquivo RKF não encontrado" });
    const name = params.data.name as SeedFileName;
    const loaded = load(name);
    const needle = query.data.search?.toLocaleLowerCase("pt-BR");
    const filtered = needle
      ? loaded.rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(needle)))
      : loaded.rows;
    const data = filtered.slice(query.data.offset, query.data.offset + query.data.limit);
    return {
      file: { name, ...catalog[name], columns: loaded.columns, sha256: loaded.sha256, rows: loaded.rows.length },
      page: { offset: query.data.offset, limit: query.data.limit, returned: data.length, matched: filtered.length, total: loaded.rows.length },
      data,
    };
  });
}
