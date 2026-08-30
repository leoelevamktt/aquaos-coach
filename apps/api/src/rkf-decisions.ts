import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedStore, ManagedRecord } from "./managed-store.js";

export type DecisionStatus = "PASS" | "REVIEW" | "BLOCKED" | "DEFERRED";

export type MethodDecision = {
  id: string;
  title: string;
  status: DecisionStatus;
  decision?: string;
  evidence: string[];
  owner: string;
  updatedAt?: string;
  updatedBy?: string;
};

const defaults: MethodDecision[] = [
  { id: "DEC-01", title: "Versão canônica RKF V5.0 versus V5.1", status: "REVIEW", evidence: ["Manifesto e seed usam RKF_V5.1; referência legada ainda exige migration formal."], owner: "Metodologia" },
  { id: "DEC-02", title: "Voz e dispositivos no escopo", status: "DEFERRED", decision: "Voz permanece em homologação; dispositivos reais estão fora deste ciclo.", evidence: ["Feature flags separadas para voz, leitura wearable e comandos."], owner: "Produto" },
  { id: "DEC-03", title: "Compatibilidade de versões de documentos", status: "REVIEW", evidence: ["Contratos runtime versionados; matriz editorial v1.4/RKF 3.4.0 ainda não congelada."], owner: "Metodologia" },
  { id: "DEC-04", title: "Separação entre biblioteca e sessões planejadas", status: "PASS", decision: "Biblioteca canônica é imutável e separada dos workouts/prescriptions operacionais.", evidence: ["Seed em rkf_seed_rows; planejamento em resources.workouts/prescriptions."], owner: "Arquitetura" },
  { id: "DEC-05", title: "Enum do modelo LINEAR_RKF", status: "PASS", decision: "LINEAR_RKF é o identificador canônico para atletas até 13 anos.", evidence: ["Motor de periodização e teste de seleção automática."], owner: "Metodologia" },
  { id: "DEC-06", title: "Treino externo incompleto", status: "REVIEW", evidence: ["Pipeline preserva original e exige revisão humana; representação final ainda deve ser homologada."], owner: "Metodologia" },
  { id: "DEC-07", title: "Tolerância de parciais e plausibilidade de tempo", status: "PASS", decision: "Tempos, repetições únicas e parciais inválidas bloqueiam confirmação.", evidence: ["VAL-015, VAL-016 e VAL-017 cobertos por testes."], owner: "Metodologia" },
  { id: "DEC-08", title: "Múltiplas sessões por dia e dias válidos", status: "PASS", decision: "Sessões do mesmo atleta/dia são agregadas antes da série crônica.", evidence: ["Teste de agregação diária do motor de carga."], owner: "Metodologia" },
  { id: "DEC-09", title: "TSB e inicialização EWMA", status: "PASS", decision: "ATL inicia no 7º dia ativo, CTL no 42º e TSB usa a convenção versionada do motor.", evidence: ["Teste de reprodução do workbook e convenção exposta na API."], owner: "Metodologia" },
  { id: "DEC-10", title: "Curadoria de campos, materiais e exercícios incompletos", status: "REVIEW", evidence: ["Catálogo preserva todas as linhas e indica campos ausentes; curadoria humana permanece necessária."], owner: "Comissão técnica" },
  { id: "DEC-11", title: "Retenção LGPD de mídia e transcrições", status: "BLOCKED", evidence: ["Não há política formal aprovada de retenção e descarte por classe de mídia."], owner: "DPO/Operação" },
  { id: "DEC-12", title: "Referências a abas deprecated", status: "REVIEW", evidence: ["98_FORMULA_STATICIZED foi excluída da evidência de readiness; referências restantes precisam de inventário formal."], owner: "Dados" },
];

function storedDecisions(record: ManagedRecord | undefined): MethodDecision[] {
  const value = record?.decisions;
  if (!Array.isArray(value)) return structuredClone(defaults);
  const overrides = new Map((value as MethodDecision[]).map((decision) => [decision.id, decision]));
  return defaults.map((decision) => ({ ...decision, ...overrides.get(decision.id), id: decision.id, title: decision.title }));
}

async function requireStaff(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!user) { void reply.code(401).send({ error: "Autenticação necessária" }); return undefined; }
  if (!roleAllows(user, ["coach", "admin"])) { void reply.code(403).send({ error: "Registro restrito à comissão técnica" }); return undefined; }
  return user;
}

export function decisionRegister(store: ManagedStore) {
  const record = store.get("governance", "rkf-decisions");
  const decisions = storedDecisions(record);
  return {
    revision: Number(record?.revision ?? 1),
    status: decisions.some((item) => item.status === "BLOCKED") ? "BLOCKED" : decisions.some((item) => item.status === "REVIEW") ? "REVIEW" : "PASS",
    summary: {
      total: decisions.length,
      pass: decisions.filter((item) => item.status === "PASS").length,
      review: decisions.filter((item) => item.status === "REVIEW").length,
      blocked: decisions.filter((item) => item.status === "BLOCKED").length,
      deferred: decisions.filter((item) => item.status === "DEFERRED").length,
    },
    decisions,
  };
}

export function registerRkfDecisionRoutes(app: FastifyInstance, store: ManagedStore) {
  app.get("/api/v1/rkf/governance/decisions", async (request, reply) => {
    if (!await requireStaff(request, reply)) return;
    return decisionRegister(store);
  });

  app.patch("/api/v1/rkf/governance/decisions/:id", async (request, reply) => {
    const user = await requireStaff(request, reply);
    if (!user) return;
    const params = z.object({ id: z.enum(defaults.map((item) => item.id) as [string, ...string[]]) }).safeParse(request.params);
    const body = z.object({
      revision: z.number().int().positive(),
      status: z.enum(["PASS", "REVIEW", "BLOCKED", "DEFERRED"]),
      decision: z.string().trim().min(3).max(2000),
      evidence: z.array(z.string().trim().min(3).max(1000)).min(1).max(20),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Decisão inválida", details: body.success ? params.error?.flatten() : body.error.flatten() });
    const current = decisionRegister(store);
    if (body.data.revision !== current.revision) return reply.code(409).send({ error: "Registro alterado por outra sessão", currentRevision: current.revision });
    const updatedAt = new Date().toISOString();
    const decisions = current.decisions.map((item) => item.id === params.data.id ? { ...item, ...body.data, updatedAt, updatedBy: user.id } : item);
    const record = store.get("governance", "rkf-decisions");
    const payload = { id: "rkf-decisions", title: "Registro formal de decisões RKF", revision: current.revision + 1, decisions, status: "active", organizationId: user.organizationId, actorId: user.id };
    if (record) store.update("governance", record.id, payload);
    else store.create("governance", payload);
    return reply.send(decisionRegister(store));
  });
}
