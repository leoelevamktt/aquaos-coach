import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { extractDocument } from "./document-extraction.js";
import { tokenizeForSearch } from "./rkf-catalog-store.js";

export type RkfKnowledgeChunk = {
  id: string;
  text: string;
  normalized: string;
  tokens: string[];
};

type KnowledgeCache = {
  path: string;
  mtimeMs: number;
  chunks: RkfKnowledgeChunk[];
};

const DEFAULT_MAX_CHARS = 1_800;
const DEFAULT_MAX_CONTEXT_CHARS = 10_500;
const CORE_QUERY = "regras futuro agente governança fato método princípio decisão preferência hipótese inferência conflito lacuna aprovação humana não inventar unknown";
let cache: KnowledgeCache | undefined;
let installed = false;
let lastWarningAt = 0;

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function knowledgePath() {
  const configured = process.env.RKF_KNOWLEDGE_PATH?.trim();
  if (configured) return resolve(configured);
  const storageRoot = process.env.STORAGE_PATH?.trim();
  if (storageRoot) return resolve(storageRoot, "knowledge", "rkf-base.docx");
  return new URL("../storage/knowledge/rkf-base.docx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
}

function knowledgeRequired() {
  return /^(1|true|yes)$/i.test(process.env.RKF_KNOWLEDGE_REQUIRED ?? "");
}

function splitOversizedParagraph(paragraph: string, maxChars: number) {
  if (paragraph.length <= maxChars) return [paragraph];
  const parts: string[] = [];
  let remaining = paragraph;
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const candidates = [window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf("\n"), window.lastIndexOf(" ")];
    const splitAt = Math.max(...candidates.filter((value) => value >= Math.floor(maxChars * 0.55)));
    const boundary = splitAt > 0 ? splitAt + 1 : maxChars;
    parts.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function chunkKnowledgeText(text: string, maxChars = DEFAULT_MAX_CHARS): RkfKnowledgeChunk[] {
  const paragraphs = text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((value) => value.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .flatMap((value) => splitOversizedParagraph(value, maxChars));

  const chunks: RkfKnowledgeChunk[] = [];
  let current: string[] = [];
  let currentLength = 0;
  const flush = () => {
    if (!current.length) return;
    const chunkText = current.join("\n\n").trim();
    const normalized = normalize(chunkText);
    const tokens: string[] = tokenizeForSearch(chunkText);
    chunks.push({ id: `KB-${String(chunks.length + 1).padStart(3, "0")}`, text: chunkText, normalized, tokens: [...new Set(tokens)] });
    current = [];
    currentLength = 0;
  };

  for (const paragraph of paragraphs) {
    const extra = paragraph.length + (current.length ? 2 : 0);
    if (current.length && currentLength + extra > maxChars) flush();
    current.push(paragraph);
    currentLength += extra;
  }
  flush();
  return chunks;
}

function scoreChunk(chunk: RkfKnowledgeChunk, terms: string[]) {
  if (!terms.length) return 0;
  let matched = 0;
  let score = 0;
  const tokenSet = new Set(chunk.tokens);
  for (const term of terms) {
    if (tokenSet.has(term)) {
      matched += 1;
      score += 4;
    } else if (chunk.normalized.includes(term)) {
      matched += 1;
      score += 2;
    }
  }
  if (!matched) return 0;
  const coverage = matched / terms.length;
  if (coverage >= 0.6) score += 8;
  else if (coverage >= 0.35) score += 4;
  return score;
}

export function rankKnowledgeChunks(chunks: RkfKnowledgeChunk[], query: string, limit = 6): RkfKnowledgeChunk[] {
  const queryTokens: string[] = tokenizeForSearch(query);
  const terms = [...new Set(queryTokens)].slice(0, 36);
  if (!terms.length) return [];
  return chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.chunk);
}

export function buildKnowledgeContextFromChunks(chunks: RkfKnowledgeChunk[], query: string, maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
  if (!chunks.length) return "";
  const selected = [...rankKnowledgeChunks(chunks, CORE_QUERY, 2), ...rankKnowledgeChunks(chunks, query, 6)];
  const unique = selected.filter((chunk, index, all) => all.findIndex((candidate) => candidate.id === chunk.id) === index);
  if (!unique.length) return "";

  const header = [
    "=== BASE DE CONHECIMENTO RKF V1.0 — TRECHOS RECUPERADOS ===",
    "Fonte privada fornecida pelo usuário. Use estes trechos como conhecimento metodológico, preservando os marcadores originais de certeza.",
    "FATO/MÉTODO/METODOLOGIA/ESTRATÉGIA/PRINCÍPIO/DECISÃO/PREFERÊNCIA podem orientar a resposta conforme o contexto. HIPÓTESE, INFERÊNCIA, NÃO CONFIRMADO, CONFLITO e LACUNA nunca devem ser promovidos a fato.",
    "Quando a base indicar conflito, lacuna, identidade ambígua, unidade ausente ou decisão crítica, sinalize a limitação e peça/registre aprovação humana em vez de inventar.",
  ].join("\n");

  let output = header;
  for (const chunk of unique) {
    const addition = `\n\n[${chunk.id}]\n${chunk.text}`;
    if (output.length + addition.length > maxChars) break;
    output += addition;
  }
  return output;
}

async function loadKnowledgeChunks(): Promise<RkfKnowledgeChunk[] | undefined> {
  const target = knowledgePath();
  try {
    const info = await stat(target);
    if (cache && cache.path === target && cache.mtimeMs === info.mtimeMs) return cache.chunks;
    const buffer = await readFile(target);
    const extraction = await extractDocument(buffer, target);
    if (extraction.status !== "extracted" || !extraction.text?.trim()) {
      throw new Error(`base RKF não pôde ser extraída (${extraction.status})`);
    }
    const chunks = chunkKnowledgeText(extraction.text);
    if (!chunks.length) throw new Error("base RKF sem conteúdo textual recuperável");
    cache = { path: target, mtimeMs: info.mtimeMs, chunks };
    return chunks;
  } catch (error) {
    if (knowledgeRequired()) throw error;
    const now = Date.now();
    if (now - lastWarningAt > 60_000) {
      const message = error instanceof Error ? error.message : "falha desconhecida";
      console.warn(`[rkf-knowledge] Base privada indisponível; seguindo sem RAG: ${message}`);
      lastWarningAt = now;
    }
    return undefined;
  }
}

export async function buildRkfKnowledgeContext(query: string) {
  const chunks = await loadKnowledgeChunks();
  return chunks ? buildKnowledgeContextFromChunks(chunks, query) : "";
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Injeta RAG da Base RKF nas chamadas OpenAI-compatible do processo.
 * O wrapper é instalado uma única vez e só altera /chat/completions.
 * A base permanece no filesystem privado do servidor; nenhum conteúdo é
 * versionado no repositório público.
 */
export function installRkfKnowledgeInjection() {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    if (!url.includes("/chat/completions") || typeof init?.body !== "string") return originalFetch(input, init);

    let payload: { messages?: Array<{ role?: string; content?: unknown }>; [key: string]: unknown };
    try {
      payload = JSON.parse(init.body) as typeof payload;
    } catch {
      return originalFetch(input, init);
    }
    if (!Array.isArray(payload.messages) || !payload.messages.length) return originalFetch(input, init);

    const latestUser = [...payload.messages].reverse().find((message) => message.role === "user" && typeof message.content === "string");
    const query = typeof latestUser?.content === "string" ? latestUser.content : "Método RKF natação treinamento planejamento análise";
    const knowledge = await buildRkfKnowledgeContext(query);
    if (!knowledge) return originalFetch(input, init);

    const messages = payload.messages.map((message) => ({ ...message }));
    const systemIndex = messages.findIndex((message) => message.role === "system" && typeof message.content === "string");
    if (systemIndex >= 0) {
      messages[systemIndex] = { ...messages[systemIndex], content: `${String(messages[systemIndex].content)}\n\n${knowledge}` };
    } else {
      messages.unshift({ role: "system", content: knowledge });
    }

    return originalFetch(input, { ...init, body: JSON.stringify({ ...payload, messages }) });
  }) as typeof globalThis.fetch;
}
