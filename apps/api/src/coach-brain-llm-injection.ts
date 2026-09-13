import { AsyncLocalStorage } from "node:async_hooks";
import type { ManagedStore } from "./managed-store.js";
import { buildAthleteBrainContext, buildCoachDecisionEvidence, COACH_BRAIN_POLICY_VERSION } from "./coach-brain.js";

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
  const athletes = store.list("athletes").filter((record) => record.organizationId === organizationId);
  const exact = athletes.find((athlete) => q.includes(normalize(athlete.id)) || (String(athlete.name ?? "").length >= 3 && q.includes(normalize(athlete.name))));
  return exact?.id;
}

export function buildCoachBrainInjection(store: ManagedStore, organizationId: string, question: string) {
  const athleteId = relevantAthleteId(store, organizationId, question);
  const athleteContext = athleteId ? buildAthleteBrainContext(store, organizationId, athleteId) : "";
  const decisionEvidence = buildCoachDecisionEvidence(store, organizationId, athleteId);
  const policy = `=== CÉREBRO RKF — MEMÓRIA DECISÓRIA ===
Versão ${COACH_BRAIN_POLICY_VERSION}.
Raciocine conforme a metodologia RKF e o padrão de decisões humanas confirmadas, sem alegar ser o treinador.
Prioridade: segurança/restrições e HARD rules > decisão humana/rule set publicado > Planning Engine e DB RKF V5.1 > fatos confirmados do atleta > histórico do coach > inferência explicitamente marcada.
Nunca altere por texto livre objetivo, zona, volume ou fundamento de uma prescrição já calculada pelo Planning Engine. Planejado, executado e resposta são fatos distintos. Não invente dados ausentes. Toda recomendação crítica exige aprovação humana.
Para treino personalizado, use estado longitudinal do atleta, readiness, carga, aderência, resultados, evolução, restrições, fase ATR, meta/prova e histórico de decisões; explique quais sinais influenciaram a sugestão.`;
  return [policy, athleteContext, decisionEvidence].filter(Boolean).join("\n\n");
}

/**
 * Última camada antes do provider: acrescenta memória decisória e contexto
 * longitudinal a todas as chamadas /chat/completions da área /api/v1/ai/*.
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
