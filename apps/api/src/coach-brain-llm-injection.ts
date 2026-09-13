import { AsyncLocalStorage } from "node:async_hooks";
import { generatePrescription } from "@natacao/domain";
import type { ManagedStore } from "./managed-store.js";
import {
  buildAthleteBrainContext,
  buildCoachDecisionEvidence,
  COACH_BRAIN_POLICY_VERSION,
  derivePlanningInputs,
} from "./coach-brain.js";
import { loadRkfLibrary } from "./rkf-library.js";

type LlmMessage = { role?: string; content?: unknown };
type LlmPayload = { messages?: LlmMessage[]; [key: string]: unknown };

const requestContext = new AsyncLocalStorage<{ organizationId: string }>();
let managedStore: ManagedStore | undefined;
let installed = false;

export function configureCoachBrainLlmInjection(store?: ManagedStore) {
  managedStore = store;
}

export function enterCoachBrainOrganization(organizationId: string) {
  if (organizationId) requestContext.enterWith({ organizationId });
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function hasCoachBrainContext(messages: LlmMessage[]) {
  return messages.some((message) => typeof message.content === "string" && message.content.includes("=== CÉREBRO RKF — MEMÓRIA DECISÓRIA ==="));
}

function latestUserText(messages: LlmMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "user" && typeof message.content === "string");
  return typeof latest?.content === "string" ? latest.content.replace(/\s+/g, " ").trim().slice(0, 6000) : "";
}

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function relevantAthleteId(store: ManagedStore, organizationId: string, question: string) {
  const q = normalize(question);
  if (!q) return undefined;
  const athletes = store.list("athletes").filter((record) => String(record.organizationId ?? "org-demo") === organizationId);
  const exact = athletes.find((athlete) =>
    q.includes(normalize(athlete.id))
    || (String(athlete.name ?? "").length >= 3 && q.includes(normalize(athlete.name))),
  );
  return exact?.id;
}

function asksForTraining(question: string) {
  const q = normalize(question);
  return [
    "treino", "treinar", "sessao", "prescricao", "serie", "microciclo", "mesociclo",
    "planejamento", "workout", "volume", "zona", "intensidade", "aquecimento",
    "soltura", "ritmo de prova", "taper",
  ].some((term) => q.includes(term));
}

function buildPlanningGrounding(store: ManagedStore, organizationId: string, athleteId: string, question: string) {
  if (!asksForTraining(question)) return "";
  const derived = derivePlanningInputs(store, organizationId, athleteId);
  if (!derived.athlete || !derived.request) {
    return `=== GATE DO PLANNING ENGINE ===
O usuário pediu orientação de treino para este atleta, mas faltam dados confirmados: ${derived.missing.join(", ") || "UNKNOWN"}.
Proveniência disponível: ${derived.provenance.join("; ") || "nenhuma"}.
NÃO invente uma sessão completa. Explique a lacuna e peça ao coach os dados necessários para executar o Planning Engine.`;
  }

  const library = loadRkfLibrary();
  if (!library) {
    return `=== GATE DO PLANNING ENGINE ===
Biblioteca operacional RKF indisponível. NÃO invente prescrição. Informe que o motor normativo precisa estar disponível.`;
  }

  const result = generatePrescription(derived.athlete, derived.request, library.sessions);
  if (!result.prescription) {
    return `=== GATE DO PLANNING ENGINE ===
O Planning Engine recusou gerar uma sessão pronta.
Resultado auditável: ${JSON.stringify(result)}
Não contorne bloqueios HARD nem invente alternativa fora do motor. Explique o bloqueio e peça decisão/dado ao coach.`;
  }

  return `=== CANDIDATO NORMATIVO DO PLANNING ENGINE PARA O CHAT ===
Status: ${result.status}
Proveniência de inputs: ${derived.provenance.join("; ")}
${JSON.stringify(result)}
REGRA DE RESPOSTA: use este candidato como prescrição-base. Não altere volume, zonas, blocos ou fundamento por texto livre. Personalize a explicação, execução, critérios de sucesso e alternativas seguras. Mudança de fundamento exige nova execução do Planning Engine. A sessão continua PENDING_APPROVAL até decisão humana.`;
}

export function buildCoachBrainInjection(store: ManagedStore, organizationId: string, question: string) {
  const athleteId = relevantAthleteId(store, organizationId, question);
  const athleteContext = athleteId ? buildAthleteBrainContext(store, organizationId, athleteId) : "";
  const decisionEvidence = buildCoachDecisionEvidence(store, organizationId, athleteId);
  const planningGrounding = athleteId ? buildPlanningGrounding(store, organizationId, athleteId, question) : "";
  const policy = `=== CÉREBRO RKF — MEMÓRIA DECISÓRIA ===
Versão ${COACH_BRAIN_POLICY_VERSION}.
Raciocine conforme a metodologia RKF e o padrão de decisões humanas confirmadas, sem alegar ser o treinador.
Prioridade: segurança/restrições e HARD rules > decisão humana/rule set publicado > Planning Engine e DB RKF V5.1 > fatos confirmados do atleta > histórico do coach > inferência explicitamente marcada.
Nunca altere por texto livre objetivo, zona, volume ou fundamento de uma prescrição já calculada pelo Planning Engine. Planejado, executado e resposta são fatos distintos. Não invente dados ausentes. Toda recomendação crítica exige aprovação humana.
Para treino personalizado, use estado longitudinal do atleta, readiness, carga, aderência, resultados, evolução, restrições, fase ATR, meta/prova e histórico de decisões; explique quais sinais influenciaram a sugestão.
Quando a pergunta pedir treino para um atleta identificado, o bloco CANDIDATO NORMATIVO DO PLANNING ENGINE, se presente, é obrigatório e prevalece sobre geração livre do modelo.`;
  return [policy, athleteContext, decisionEvidence, planningGrounding].filter(Boolean).join("\n\n");
}

/**
 * Última camada antes do provider: acrescenta memória decisória, contexto
 * longitudinal e, em pedidos de treino, a saída normativa do Planning Engine
 * a todas as chamadas /chat/completions da área /api/v1/ai/*.
 * A camada do Catálogo Mestre permanece separada e pode enriquecer a mesma
 * chamada sem duplicação de marcadores.
 */
export function installCoachBrainLlmInjection() {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    if (!url.includes("/chat/completions") || typeof init?.body !== "string" || !managedStore) return originalFetch(input, init);
    const organizationId = requestContext.getStore()?.organizationId;
    if (!organizationId) return originalFetch(input, init);

    let payload: LlmPayload;
    try { payload = JSON.parse(init.body) as LlmPayload; } catch { return originalFetch(input, init); }
    if (!Array.isArray(payload.messages) || !payload.messages.length || hasCoachBrainContext(payload.messages)) return originalFetch(input, init);

    const question = latestUserText(payload.messages);
    const brain = buildCoachBrainInjection(managedStore, organizationId, question);
    if (!brain) return originalFetch(input, init);
    const messages = payload.messages.map((message) => ({ ...message }));
    const systemIndex = messages.findIndex((message) => message.role === "system" && typeof message.content === "string");
    if (systemIndex >= 0) messages[systemIndex] = { ...messages[systemIndex], content: `${String(messages[systemIndex]!.content)}\n\n${brain}` };
    else messages.unshift({ role: "system", content: brain });
    return originalFetch(input, { ...init, body: JSON.stringify({ ...payload, messages }) });
  }) as typeof globalThis.fetch;
}
