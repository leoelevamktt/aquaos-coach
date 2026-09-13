import { AsyncLocalStorage } from "node:async_hooks";
import { buildRkfCatalogContext } from "./rkf-catalog-retrieval.js";
import type { CatalogRow } from "./rkf-catalog-store.js";

type CatalogKnowledgeStore = {
  searchAcrossSheets(organizationId: string, q: string, maxRows: number): CatalogRow[];
  status(organizationId: string): { version: number; packageHash: string } | undefined;
};

type LlmMessage = { role?: string; content?: unknown };
type LlmPayload = { messages?: LlmMessage[]; [key: string]: unknown };

const requestContext = new AsyncLocalStorage<{ organizationId: string }>();
let catalogStore: CatalogKnowledgeStore | undefined;
let installed = false;

export function configureRkfCatalogLlmInjection(store?: CatalogKnowledgeStore) {
  catalogStore = store;
}

/** Vincula a chamada externa do LLM à organização autenticada da requisição atual. */
export function enterRkfAiOrganization(organizationId: string) {
  if (organizationId) requestContext.enterWith({ organizationId });
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function hasCatalogContext(messages: LlmMessage[]) {
  return messages.some((message) => typeof message.content === "string" && message.content.includes("=== CATÁLOGO MESTRE RKF"));
}

function compactCatalogQuery(messages: LlmMessage[]) {
  const latestUser = [...messages].reverse().find((message) => message.role === "user" && typeof message.content === "string");
  const raw = typeof latestUser?.content === "string" ? latestUser.content : "";
  // Vídeo pode gerar um contexto grande; manter apenas uma janela suficiente para
  // recuperar termos técnicos sem transformar o retrieval em varredura de milhares de tokens.
  return raw.replace(/\s+/g, " ").trim().slice(0, 2_000)
    || "natação técnica treino prova braçada cadência saída virada planejamento RKF";
}

export function appendCatalogContextToMessages(
  messages: LlmMessage[],
  store: CatalogKnowledgeStore,
  organizationId: string,
): LlmMessage[] {
  if (!messages.length || hasCatalogContext(messages)) return messages;
  const source = store.status(organizationId);
  if (!source) return messages;
  const question = compactCatalogQuery(messages);
  const rows = store.searchAcrossSheets(organizationId, question, 12);
  if (!rows.length) return messages;
  const catalog = buildRkfCatalogContext(rows, question, source);
  if (!catalog) return messages;

  const enriched = messages.map((message) => ({ ...message }));
  const systemIndex = enriched.findIndex((message) => message.role === "system" && typeof message.content === "string");
  if (systemIndex >= 0) {
    const system = enriched[systemIndex]!;
    enriched[systemIndex] = { ...system, content: `${String(system.content)}\n\n${catalog}` };
  } else {
    enriched.unshift({ role: "system", content: catalog });
  }
  return enriched;
}

/**
 * Camada final de segurança/retrieval para chamadas OpenAI-compatible.
 * O chat já injeta o catálogo no core; nesse caso a marca evita duplicação.
 * Outras rotas (ex.: treinador de vídeo) recebem o mesmo Catálogo Mestre aqui.
 */
export function installRkfCatalogLlmInjection() {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    if (!url.includes("/chat/completions") || typeof init?.body !== "string" || !catalogStore) {
      return originalFetch(input, init);
    }

    const organizationId = requestContext.getStore()?.organizationId;
    if (!organizationId) return originalFetch(input, init);

    let payload: LlmPayload;
    try {
      payload = JSON.parse(init.body) as LlmPayload;
    } catch {
      return originalFetch(input, init);
    }
    if (!Array.isArray(payload.messages) || !payload.messages.length) return originalFetch(input, init);

    const messages = appendCatalogContextToMessages(payload.messages, catalogStore, organizationId);
    if (messages === payload.messages) return originalFetch(input, init);
    return originalFetch(input, { ...init, body: JSON.stringify({ ...payload, messages }) });
  }) as typeof globalThis.fetch;
}
