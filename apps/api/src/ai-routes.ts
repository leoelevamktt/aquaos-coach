import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ComposedBlock,
  PlanningAthleteContext,
  PlanningRequest,
  RkfPhaseId,
  RuleAudit,
  RkfPrescription,
  SkillCode,
  ZoneCode,
} from "@natacao/domain";
import { decideAdaptation, generatePrescription, PHASES, SKILLS } from "@natacao/domain";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";
import { calendarDateSchema } from "./date-schema.js";
import { loadRkfLibrary } from "./rkf-library.js";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import { coachLocalDate, athleteReadiness } from "./coach-briefing-routes.js";

type ChatMessage = { role: "user" | "assistant"; content: string };

export const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://api.elevamkt.digital/v1";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
export const LLM_MODEL = process.env.LLM_MODEL ?? "auto/best-chat";
let statusCache: { checkedAt: number; available: boolean; reason?: string } | undefined;

function esc(value: unknown): string {
  return String(value ?? "—");
}

/**
 * Serializa todo o estado da plataforma em um contexto estruturado para o LLM.
 * O assistente só conhece o que está aqui — então este snapshot deve cobrir
 * todas as entidades visíveis na interface do coach.
 */
export function buildPlatformContext(store: ManagedStore, organizationId = "org-demo"): string {
  const list = (kind: string) => store.list(kind as never).filter((item) => item.organizationId === organizationId);
  const sections: string[] = [];

  const settings = list("settings");
  if (settings.length) {
    const s = settings[0] as Record<string, unknown>;
    sections.push(`## Organização
- Nome: ${esc(s.organizationName)}
- Idioma: ${esc(s.locale)} · Medidas: ${esc(s.measurementSystem)} · Piscina principal: ${esc(s.primaryPool)}
- Motor de carga: ${esc(s.loadEngine)}`);
  }

  const athletes = list("athletes") as Array<Record<string, unknown>>;
  if (athletes.length) {
    sections.push(`## Atletas (${athletes.length})
${athletes.map((a) => `- ${esc(a.name)} (${esc(a.handle)}) · grupo: ${esc(a.group)} · nado: ${esc(a.stroke)} · status: ${esc(a.status)}`).join("\n")}`);
  }

  const groups = list("groups") as Array<Record<string, unknown>>;
  if (groups.length) {
    sections.push(`## Grupos (${groups.length})
${groups.map((g) => `- ${esc(g.name)} · cor: ${esc(g.color)} · membros: ${esc(g.members)} · status: ${esc(g.status)}`).join("\n")}`);
  }

  const workouts = list("workouts") as Array<Record<string, unknown>>;
  if (workouts.length) {
    sections.push(`## Treinos (${workouts.length})
${workouts.map((w) => `- ${esc(w.title)} · data: ${esc(w.date)} · status: ${esc(w.status)} · ${w.distanceMeters ? `${esc(w.distanceMeters)} m` : `${esc(w.durationMinutes)} min`} · zona: ${esc(w.zone)}`).join("\n")}`);
  }

  const seasons = list("seasons") as Array<Record<string, unknown>>;
  if (seasons.length) {
    sections.push(`## Temporadas (${seasons.length})
${seasons.map((s) => `- ${esc(s.name)} · ${esc(s.startsOn)} a ${esc(s.endsOn)} · status: ${esc(s.status)}`).join("\n")}`);
  }

  const meets = list("meets") as Array<Record<string, unknown>>;
  if (meets.length) {
    sections.push(`## Competições (${meets.length})
${meets.map((m) => `- ${esc(m.name)} · data: ${esc(m.startsOn)} · prioridade: ${esc(m.priority)} · piscina: ${esc(m.pool)} · status: ${esc(m.status)}`).join("\n")}`);
  }

  const videos = list("videos") as Array<Record<string, unknown>>;
  if (videos.length) {
    sections.push(`## Vídeos (${videos.length})
${videos.map((v) => `- ${esc(v.title)} · atleta: ${esc(v.athlete)} · evento: ${esc(v.event)} · status: ${esc(v.status)} · análise: ${esc(v.analysisStatus)} · duração: ${esc(v.durationSeconds)}s`).join("\n")}`);
  }

  const staff = list("staff") as Array<Record<string, unknown>>;
  if (staff.length) {
    sections.push(`## Comissão técnica (${staff.length})
${staff.map((s) => `- ${esc(s.name)} · cargo: ${esc(s.role)} · acesso: ${esc(s.access)} · status: ${esc(s.status)}`).join("\n")}`);
  }

  const zones = list("zones") as Array<Record<string, unknown>>;
  if (zones.length) {
    sections.push(`## Zonas de intensidade (${zones.length})
${zones.map((z) => `- ${esc(z.name)} · código: ${esc(z.code)} · ritmo: ${esc(z.pace)} · status: ${esc(z.status)}`).join("\n")}`);
  }

  const goals = list("goals") as Array<Record<string, unknown>>;
  if (goals.length) {
    sections.push(`## Metas (${goals.length})
${goals.map((g) => `- ${esc(g.name)} · prova: ${esc(g.event)} · tempo-alvo: ${esc(g.targetTime)} · status: ${esc(g.status)}`).join("\n")}`);
  }

  const audit = store.audit(100).filter((entry) => (entry.organizationId ?? "org-demo") === organizationId).slice(0, 12);
  if (audit.length) {
    sections.push(`## Atividade recente (auditoria)
${audit.map((entry) => `- ${esc(entry.createdAt)} · ${esc(entry.action)} em ${esc(entry.resource)}: ${esc(entry.summary)}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Snapshot rico de performance — espelha os dados que a interface do coach
 * exibe (prontidão, habilidades, metas, volumes, alertas, conectores).
 */
function buildPerformanceContext(): string {
  return `## Prontidão e corpo (hoje)
- Ana Souza (@anaswim): readiness 86 · sono 8.1h · recuperação 82% · HRV 72ms · FCR 48 · wearable Garmin Fēnix 8 · sincronizado hoje 06:42
- Caio Martins (@caiobfly): readiness 72 · sono 6.8h · recuperação 68% · HRV 59ms · FCR 52 · wearable Polar Vantage V3 · sincronizado hoje 07:03
- Luiza Costa (@luizaback): readiness 58 (ATENÇÃO) · sono 5.9h · recuperação 54% · HRV 46ms · FCR 61 · wearable WHOOP 5.0 · sinc ontem 22:48
- Pedro Lima (@pedrobreast): readiness 79 · sono 7.4h · recuperação 76% · HRV 64ms · FCR 50 · sem wearable
- Gabriel Rocha (@gabrielmedley): readiness 67 · sono 7.0h · convite pendente há 4 dias (sem conta)
- Marina Alves (@marinawater): readiness 63 · sono 6.5h · águas abertas · sem dados corporais

## Metas individuais e distância
- Ana Souza: 200 m Livre · PB 2:01.32 · meta 1:58.50 · gap +2.82 · ritmo necessário 0.94s/sem · ritmo observado 0.50s/sem (abaixo do necessário)
- Caio Martins: 100 m Borboleta · PB 54.18 · meta 52.90 · gap +1.28
- Luiza Costa: 100 m Costas · PB 1:03.86 · meta 1:01.20 · gap +2.66
- Pedro Lima: 200 m Peito · PB 2:15.41 · meta 2:12.00 · gap +3.41 · em queda (−1.08s nas últimas 3 provas)
- Marina Alves: 10 km águas abertas · gap +4:48
- Gabriel Rocha: sem meta cadastrada

## Habilidades técnicas (0-100, com tendência)
- Ana Souza: Saída 78(↑3) · Velocidade 91(↑5) · Virada 74(↓1) · Ritmo 88(↑4) · Chegada 82(↑2)
- Caio Martins: Saída 86(↑4) · Velocidade 88(↑2) · Virada 69(↓2) · Ritmo 76(↑1) · Chegada 71(=)
- Luiza Costa: Saída 66(↓1) · Velocidade 79(↑3) · Virada 63(=) · Ritmo 72(↑2) · Chegada 68(↑1)
- Pedro Lima: Saída 71(=) · Velocidade 82(↑1) · Virada 77(↑3) · Ritmo 75(↑2) · Chegada 73(=)

## Volumes semanais (atual vs anterior)
- Ana Souza: 28.600 m (↑ de 26.400) · presença 96%
- Caio Martins: 27.100 m (↓ de 28.200 — queda de 14%) · presença 91%
- Luiza Costa: 21.200 m (↓ de 24.500) · presença 87%
- Pedro Lima: 23.400 m · presença 93%
- Total da equipe: 148,9 km · meta semanal 155 km · ↑6,8% vs semana passada

## Calendário de treinos (próximos)
- 28/08 SEX 07:30 · Ritmo de prova · 200 Livre · 5.200 m · AN2 · Equipe inteira · RPE 7 · publicado
- 28/08 SEX 16:00 · Força máxima · membros inferiores · 55 min · Elite · RPE 8 · publicado
- 29/08 SÁB 08:00 · Aeróbio regenerativo + técnica · 3.800 m · A1 · Equipe inteira · RPE 4 · rascunho
- 31/08 SEG 06:30 · VO₂ · tolerância ao lactato · 4.600 m · AN1 · Elite · RPE 9 · publicado
- 01/09 TER 07:00 · Base aeróbia · eficiência · 5.800 m · A2 · Equipe inteira · RPE 6 · publicado
- 02/09 QUA 16:30 · Potência e core · FORÇA · Desenvolvimento · RPE 7 · rascunho

## Biblioteca de treinos
Natação: Ritmo de 200 · fechamento forte (5.200m AN2) · Aeróbio específico · eficiência (6.100m A2) · Lactato · velocidade sustentada (4.200m AN1) · Regenerativo técnico (3.200m A1)
Força: Potência de saída (55min, 6.4t) · Estabilidade de ombro (42min, 2.8t) · Força máxima geral (70min, 10.2t)

## Temporada e fases
Temporada Olímpica 2026/27 · 04/08/2026 a 19/07/2027 · semana 4 de 50
Fases: Base geral (04/08–20/09, 45% concluída) · Construção específica (21/09–13/12) · Competição de inverno (14/12–31/01) · Transição (01/02–14/02)

## Competições
- Troféu Brasil - José Finkel · prioridade A · 18/09 (21 dias) · São Paulo · 50m · 4 atletas com índice · 12 inscrições
- Campeonato Estadual Absoluto · prioridade B · 24/10 (57 dias) · Curitiba · 25m · 6 com índice · 19 inscrições
- Open Internacional · prioridade A · 12/12 (106 dias) · Rio de Janeiro · 50m · 2 com índice · 8 inscrições

## Índices do Troféu Brasil (50m)
50 Livre: F 0:26.30 / M 0:23.40 · 100 Livre: F 0:57.20 / M 0:51.60 · 200 Livre: F 2:03.80 / M 1:52.40 · 100 Costas: F 1:04.90 / M 0:57.80 · 100 Peito: F 1:12.40 / M 1:03.20 · 100 Borboleta: F 1:03.10 / M 0:55.90

## Vídeos e análise
- Técnica de crawl · sessão diurna (Ana Souza) · 16,95s · 9 eventos detectados · aguardando revisão
- Ritmo e eficiência · sessão noturna (Caio Martins) · 24,88s · 11 eventos detectados · aguardando revisão
- 200 m Peito (Pedro Lima) · 2:15.41 · revisado
- 100 m Costas (Luiza Costa) · 1:03.86 · revisado
Total: 24 provas filmadas · 2 aguardando revisão · 4 esta semana

## Alertas ativos (inbox)
1. CRÍTICO — Readiness abaixo do padrão: Luiza 18% abaixo da média de 28 dias, sono curto e HRV em queda (há 12 min)
2. ALERTA — Volume caiu 14%: Caio completou 3,9 km menos que a semana anterior (há 36 min)
3. VÍDEO — 2 provas aguardam revisão: Ana e Caio com vídeos sem feedback técnico (há 2h)
4. SUCESSO — Pedro está perto da meta: diferença para 2:12.00 caiu 1,08s nas últimas três provas
5. CONTA — Convite pendente: Gabriel não ativou a conta enviada há 4 dias

## Conectores de dispositivos
Garmin Connect (conectado, 3 atletas, leitura+escrita) · Polar Flow (conectado, 1 atleta, leitura) · WHOOP (conectado, 1 atleta, leitura) · Google Health/Oura/Withings/Strava (prontos para conectar) · Apple Health (nativo, exige app iOS)

## Carga da equipe (últimas 8 semanas)
Aguda 538 · Crônica 504 · ACWR 1,07 (razoável) · aderência à carga 93,4% · presença geral 91% (32/35 sessões) · evolução de PBs: +12 nos últimos 90 dias · cobertura de wearable: 5 de 6`;
}

const SYSTEM_PROMPT = `Você é o assistente de inteligência do RKF Coach, a plataforma de gestão de equipes de natação.

CONTEXTO: você recebe abaixo um snapshot completo e atualizado dos dados da plataforma (dados de gestão + dados de performance). Responda APENAS com base nesses dados.

REGRAS:
1. Responda em português do Brasil, com tom profissional e direto, como um analista de performance experiente conversando com o treinador.
2. Use os dados reais do snapshot: nomes, números, datas, status. Nunca invente atletas, marcas ou treinos.
3. Se o dado não estiver no snapshot, diga explicitamente que não tem essa informação em vez de especular.
4. Seja acionável: quando fizer sentido, sugira o próximo passo (revisar atleta, ajustar treino, checar vídeo).
5. Para perguntas analíticas, calcule com cuidado (médias, somas, comparações) antes de responder.
6. Formate respostas curtas e escaneáveis: use listas quando houver vários itens, negrito para destaques via **texto**.
7. Você pode falar de qualquer tema da plataforma: atletas, prontidão corporal, treinos, biblioteca, temporadas, competições, índices, vídeos, habilidades técnicas, metas, volumes, alertas, conectores, comissão, grupos, zonas e configurações.`;

export async function callLLm(messages: Array<{ role: string; content: string }>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 1600, temperature: 0.4, stream: false }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = "erro sem detalhes";
      try {
        const payload = JSON.parse(raw) as { error?: { message?: string } };
        detail = payload.error?.message?.trim() || detail;
      } catch { /* resposta não JSON: mantém erro sanitizado */ }
      throw new Error(`LLM respondeu ${response.status}: ${detail.slice(0, 240)}`);
    }
    // Alguns gateways ignoram stream:false e devolvem SSE — tratar ambos os formatos.
    const contentType = response.headers.get("content-type") ?? "";
    if (raw.startsWith("data:") || contentType.includes("text/event-stream")) {
      const chunks = raw.split("\n").filter((line) => line.startsWith("data:") && !line.includes("[DONE]"));
      let assembled = "";
      let reasoning = "";
      for (const chunk of chunks) {
        try {
          const parsed = JSON.parse(chunk.slice(5).trim()) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; message?: { content?: string } }> };
          assembled += parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
          reasoning += parsed.choices?.[0]?.delta?.reasoning_content ?? "";
        } catch { /* linha keep-alive ignorada */ }
      }
      if (assembled.trim()) return assembled;
      if (reasoning.trim()) return reasoning;
      throw new Error("Stream sem conteúdo");
    }
    const payload = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const message = payload.choices?.[0]?.message;
    // Modelos com raciocínio podem devolver content vazio e a resposta em
    // reasoning_content; usar o fallback antes de declarar falha.
    const content = message?.content?.trim() || message?.reasoning_content?.trim();
    if (!content) throw new Error("Resposta vazia do modelo");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectLlmAvailability() {
  if (!LLM_API_KEY) return { available: false, reason: "LLM_API_KEY não configurada" };
  if (statusCache && Date.now() - statusCache.checkedAt < 60_000) return statusCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${LLM_BASE_URL}/models`, { headers: { authorization: `Bearer ${LLM_API_KEY}` }, signal: controller.signal });
    if (!response.ok) {
      statusCache = { checkedAt: Date.now(), available: false, reason: `Gateway respondeu ${response.status}` };
      return statusCache;
    }
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const available = Boolean(payload.data?.some((model) => model.id === LLM_MODEL));
    statusCache = { checkedAt: Date.now(), available, reason: available ? undefined : `Modelo ${LLM_MODEL} não está liberado para esta chave` };
    return statusCache;
  } catch (error) {
    statusCache = { checkedAt: Date.now(), available: false, reason: error instanceof Error && error.name === "AbortError" ? "Gateway não respondeu em 10s" : "Falha ao consultar o gateway" };
    return statusCache;
  } finally {
    clearTimeout(timeout);
  }
}

// === POST /api/v1/ai/generate-workout — motor RKF determinístico por atleta ===

export type GeneratedWorkoutStepKind = "warmup" | "main" | "recovery" | "cooldown" | "technical";

export type GeneratedWorkoutStep = {
  id: string;
  order: number;
  kind: GeneratedWorkoutStepKind;
  repetitions: number;
  distanceMeters?: number;
  stroke: "freestyle" | "backstroke" | "breaststroke" | "butterfly" | "individual_medley" | "mixed" | "drill";
  targetType: "pace" | "heart_rate" | "rpe" | "technique" | "free";
  targetValue?: string;
  intervalSeconds?: number;
  equipment: string[];
  notes?: string;
};

export type GeneratedWorkoutBlock = {
  id: string;
  name: string;
  order: number;
  repeatCount: number;
  steps: GeneratedWorkoutStep[];
};

export type GenerateWorkoutSuggestion = {
  athleteId: string;
  athleteIds?: string[];
  athleteName: string;
  readiness: number;
  status: "PRONTO" | "REVISAR" | "AGUARDAR_TREINADOR";
  adaptation: { class: string; volumeFactor: number; adaptedVolumeM: number } | null;
  workout: {
    title: string;
    scheduledDate: string;
    objective: string;
    sportContext: "pool";
    poolId?: string;
    blocks: Array<{
      id: string;
      name: string;
      order: number;
      repeatCount: number;
      steps: Array<{
        id: string;
        order: number;
        kind: GeneratedWorkoutStepKind;
        repetitions: number;
        distanceMeters?: number;
        stroke: "freestyle" | "backstroke" | "breaststroke" | "butterfly" | "individual_medley" | "mixed" | "drill";
        targetType: "pace" | "heart_rate" | "rpe" | "technique" | "free";
        targetValue?: string;
        intervalSeconds?: number;
        equipment: string[];
        notes?: string;
      }>;
    }>;
  };
  publish: { targetType: "team" | "group" | "athlete"; targetId: string };
  engine: {
    status: "PRONTO" | "REVISAR";
    pipeline: { eligible: number; scored: number; selected: string };
    primaryZone: ZoneCode;
    secondaryZone: ZoneCode | null;
    totalVolumeM: number;
    zoneAllocation: RkfPrescription["zoneAllocation"] | null;
    source: RkfPrescription["source"] | null;
    rationale: string[];
    score: number | null;
    audit: RuleAudit | null;
  };
  narrative: string;
  llmUsed: boolean;
};

export type GenerateWorkoutRequest = {
  athleteIds?: string[];
  date?: string;
  phase?: RkfPhaseId;
  primaryZone?: "A1" | "A2" | "A3" | "AN1" | "AN2" | "VALAT";
  targetVolumeM?: number;
  objective?: string;
  skillEmphasis?: string[];
  useNarrativeLlm?: boolean;
};

export type GenerateWorkoutResponse = {
  status: "PRONTO" | "REVISAR";
  date: string;
  phase: RkfPhaseId;
  suggestions: Array<Omit<GenerateWorkoutSuggestion, "readiness"> & { readiness: number }>;
  warnings: string[];
};

type GenerateOutcome = { ok: true; body: GenerateWorkoutResponse } | { ok: false; status: number; payload: unknown };

const PHASE_IDS = PHASES.map((phase) => phase.id) as [RkfPhaseId, ...RkfPhaseId[]];

const generateWorkoutSchema = z.object({
  athleteIds: z.array(z.string().trim().min(1)).max(60).optional(),
  date: calendarDateSchema.optional(),
  phase: z.enum(PHASE_IDS).optional(),
  primaryZone: z.enum(["A1", "A2", "A3", "AN1", "AN2", "VALAT"]).optional(),
  targetVolumeM: z.number().int().multipleOf(10).min(2000).optional(),
  objective: z.string().trim().min(1).max(300).optional(),
  skillEmphasis: z.array(z.string().trim().min(1).max(40)).max(14).optional(),
  useNarrativeLlm: z.boolean().default(true),
});

const NARRATIVE_SYSTEM_PROMPT = "Você é o assistente RKF. Recebe prescrições estruturadas do motor RKF e escreve 2-3 frases de briefing para o treinador. NUNCA altere números, zonas ou volumes — apenas explique o porquê e destaques de cada bloco.";

const round10 = (value: number) => Math.round(value / 10) * 10;

function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function parseEventMeters(athlete: ManagedRecord): number | undefined {
  const match = /(\d{2,4})\s*m/i.exec(`${String(athlete.goalEvent ?? "")} ${String(athlete.primaryEvent ?? "")}`);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** specialty RKF: ≤100 m/estilo curto → velocidade; 200–400 → meio-fundo; 800/1500 → fundo. */
function specialtyFor(athlete: ManagedRecord): "velocidade" | "meio_fundo" | "fundo" {
  const meters = parseEventMeters(athlete);
  if (meters !== undefined) {
    if (meters <= 100) return "velocidade";
    if (meters <= 400) return "meio_fundo";
    return "fundo";
  }
  const event = `${String(athlete.goalEvent ?? "")} ${String(athlete.stroke ?? "")}`.toLowerCase();
  if (/\b(50|100)\b/.test(event) && !/\b(200|400|800|1500)\b/.test(event)) return "velocidade";
  return "meio_fundo";
}

function poolLengthFor(store: ManagedStore, organizationId: string): 25 | 50 {
  const program = store.list("settings").find((item) => item.id === "program" && String(item.organizationId ?? "org-demo") === organizationId)
    ?? store.list("settings").find((item) => item.id === "program");
  const primaryPool = String(program?.primaryPool ?? "");
  if (/(?:^|\D)25(?:\D|$)/.test(primaryPool)) return 25;
  return 50;
}

function athleteAge(athlete: ManagedRecord): { age: number; assumed: boolean } {
  const birthDate = String(athlete.birthDate ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const birth = new Date(`${birthDate}T12:00:00Z`);
    if (Number.isFinite(birth.getTime())) {
      const reference = new Date();
      let age = reference.getUTCFullYear() - birth.getUTCFullYear();
      const monthDiff = reference.getUTCMonth() - birth.getUTCMonth();
      if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < birth.getUTCDate())) age -= 1;
      if (age >= 8 && age <= 120) return { age, assumed: false };
    }
  }
  return { age: 18, assumed: true }; // faixa 16–22 coerente com a base; warning registrado
}

/** Fase default: taper se a próxima competição está próxima; senão progressão pela temporada ativa; BASE como piso. */
function derivePhase(store: ManagedStore, organizationId: string, today: string): RkfPhaseId {
  const meets = store.list("meets")
    .filter((meet) => String(meet.organizationId ?? "org-demo") === organizationId && /^\d{4}-\d{2}-\d{2}$/.test(String(meet.startsOn ?? "")) && String(meet.startsOn) >= today)
    .sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)));
  const daysUntilMeet = meets.length ? dayDiff(today, String(meets[0]!.startsOn)) : null;
  if (daysUntilMeet !== null && daysUntilMeet <= 14) return "TAPER";
  const season = store.list("seasons").find((item) => String(item.organizationId ?? "org-demo") === organizationId && item.status === "active");
  if (season && /^\d{4}-\d{2}-\d{2}$/.test(String(season.startsOn ?? "")) && /^\d{4}-\d{2}-\d{2}$/.test(String(season.endsOn ?? ""))) {
    const total = Math.max(1, dayDiff(String(season.startsOn), String(season.endsOn)));
    const elapsed = dayDiff(String(season.startsOn), today);
    const fraction = elapsed <= 0 ? 0 : elapsed / total;
    if (fraction < 0.15) return "ADAPTACAO";
    if (fraction < 0.4) return "BASE";
    if (fraction < 0.65) return "DESENVOLVIMENTO";
    if (fraction < 0.85) return "ESPECIFICO";
    return "TAPER";
  }
  if (daysUntilMeet !== null && daysUntilMeet <= 42) return "ESPECIFICO";
  return "BASE";
}

function defaultTargetVolumeM(athlete: ManagedRecord): number {
  const weekly = Number(athlete.weeklyDistance);
  const base = Number.isFinite(weekly) && weekly > 0 ? round10(weekly / 5) : 2000;
  return Math.min(6000, Math.max(2000, base));
}

/** Série principal > 800 m vira séries de ~200 m preservando o volume exato do bloco. */
function splitMainSeries(volumeM: number): Array<{ repetitions: number; distanceMeters: number }> {
  if (volumeM <= 800) return [{ repetitions: 1, distanceMeters: volumeM }];
  const repetitions = Math.max(2, Math.round(volumeM / 200));
  const seriesDistance = Math.floor(volumeM / repetitions / 25) * 25;
  const remainder = volumeM - seriesDistance * (repetitions - 1);
  if (seriesDistance < 25 || remainder < 25) return [{ repetitions: 1, distanceMeters: volumeM }];
  if (remainder === seriesDistance) return [{ repetitions, distanceMeters: seriesDistance }];
  return [
    { repetitions: repetitions - 1, distanceMeters: seriesDistance },
    { repetitions: 1, distanceMeters: remainder },
  ];
}

function componentKind(component: string): GeneratedWorkoutStepKind {
  const normalized = component.toLocaleLowerCase("pt-BR");
  if (normalized.includes("aquecimento")) return "warmup";
  if (normalized.includes("principal")) return "main";
  if (normalized.includes("regenerativo")) return "cooldown";
  return "technical";
}

function mapPrescriptionBlocks(athleteId: string, blocks: readonly ComposedBlock[]) {
  return blocks.map((block) => {
    const kind = componentKind(block.component);
    const series = block.component === "SÉRIE PRINCIPAL" && block.volumeM > 800
      ? splitMainSeries(block.volumeM)
      : [{ repetitions: 1, distanceMeters: block.volumeM }];
    return {
      id: `${athleteId}-block-${block.order}`,
      name: block.component,
      order: block.order,
      repeatCount: 1,
      steps: series.map((series, index) => ({
        id: `${athleteId}-block-${block.order}-step-${index + 1}`,
        order: index + 1,
        kind,
        repetitions: series.repetitions,
        distanceMeters: series.distanceMeters,
        stroke: "mixed" as const,
        targetType: "pace" as const,
        targetValue: block.zone,
        equipment: [...block.materials],
        notes: block.prescriptionText,
      })),
    };
  });
}

/** Estrutura mínima de segurança quando o motor não consegue compor (ex.: volume adaptado baixo). */
function fallbackPrescription(athleteId: string, zone: ZoneCode, volumeM: number): { title: string; blocks: ComposedBlock[]; rationale: string[] } {
  const warmup = Math.max(100, round10(volumeM * 0.15));
  const cooldown = Math.max(100, round10(volumeM * 0.15));
  const main = Math.max(0, volumeM - warmup - cooldown);
  const blocks: ComposedBlock[] = [
    { order: 1, component: "AQUECIMENTO", volumeM: warmup, zone: "A1", prescriptionText: `${warmup} m nado leve progressivo`, materials: [], skills: [] },
    { order: 2, component: "SÉRIE PRINCIPAL", volumeM: main, zone, prescriptionText: `${main} m em ${zone} — estrutura mínima de segurança`, materials: [], skills: [] },
    { order: 3, component: "REGENERATIVO", volumeM: cooldown, zone: "A1", prescriptionText: `${cooldown} m regenerativo técnico`, materials: [], skills: [] },
  ];
  return {
    title: `Sessão mínima ${zone} (aguardando treinador)`,
    blocks,
    rationale: [`Volume-alvo insuficiente para a estrutura RKF completa; gerada estrutura mínima de ${volumeM} m em ${zone}. Decisão final do treinador obrigatória.`],
  };
}

function parseBriefings(raw: string): Map<string, string> | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { briefings?: Array<{ athleteId?: unknown; narrative?: unknown }> };
    if (!Array.isArray(parsed.briefings)) return null;
    const map = new Map<string, string>();
    for (const item of parsed.briefings) {
      if (typeof item.athleteId === "string" && typeof item.narrative === "string" && item.narrative.trim()) map.set(item.athleteId, item.narrative.trim());
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

/**
 * Gera sugestões determinísticas por atleta (decideAdaptation → generatePrescription
 * → mapeamento para o workoutSchema) e, opcionalmente, UM briefing de LLM para o
 * grupo inteiro. Nada é publicado — a resposta é apenas payload para a UI.
 */
export async function generateWorkoutSuggestions(
  store: ManagedStore,
  organizationId: string,
  body: GenerateWorkoutRequest,
): Promise<GenerateOutcome> {
  const warnings: string[] = [];
  const inOrg = (record: ManagedRecord) => String(record.organizationId ?? "org-demo") === organizationId;
  const allAthletes = store.list("athletes").filter(inOrg);
  const requestedIds = body.athleteIds?.length ? [...new Set(body.athleteIds)] : allAthletes.filter((athlete) => String(athlete.status ?? "active") === "active").map((athlete) => String(athlete.id));
  const resolved = requestedIds
    .map((id) => store.get("athletes", id))
    .filter((athlete): athlete is ManagedRecord => Boolean(athlete) && String(athlete?.organizationId ?? "org-demo") === organizationId);
  const missing = requestedIds.filter((id) => !resolved.some((athlete) => athlete.id === id));
  if (missing.length) warnings.push(`Atletas não encontrados na organização: ${missing.join(", ")}.`);
  if (!resolved.length) {
    return { ok: false, status: 404, payload: { error: "Nenhum atleta válido encontrado para gerar sugestões", details: { missing: requestedIds }, warnings } };
  }

  const date = body.date ?? coachLocalDate();
  const phase = body.phase ?? derivePhase(store, organizationId, date);
  const objective = body.objective ?? "Sessão de qualidade com foco em ritmo";
  const requestedZone = body.primaryZone ?? "A2";
  const library = loadRkfLibrary()?.sessions ?? [];
  const poolLengthM = poolLengthFor(store, organizationId);
  const skillEmphasis = (body.skillEmphasis ?? [])
    .map((skill) => skill.trim().toUpperCase())
    .filter((skill): skill is SkillCode => (SKILLS as readonly { code: string }[]).some((candidate) => candidate.code === skill));

  type Draft = {
    athleteId: string;
    athleteName: string;
    readiness: number;
    suggestionStatus: "PRONTO" | "REVISAR" | "AGUARDAR_TREINADOR";
    adaptation: { class: string; volumeFactor: number; adaptedVolumeM: number };
    title: string;
    blocks: ReturnType<typeof mapPrescriptionBlocks>;
    engine: GenerateWorkoutSuggestion["engine"];
    rationale: string[];
  };

  const drafts: Draft[] = [];
  for (const athlete of resolved) {
    const athleteId = String(athlete.id);
    const athleteName = String(athlete.name ?? athlete.id);
    // 1) Contexto real (age/specialty/developmentLevel/piscina)
    const eventMeters = parseEventMeters(athlete);
    const birthDate = String(athlete.birthDate ?? "");
    let age = 18;
    if (/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      const birth = new Date(`${birthDate}T12:00:00Z`);
      if (Number.isFinite(birth.getTime())) {
        const reference = new Date();
        let computed = reference.getUTCFullYear() - birth.getUTCFullYear();
        const monthDiff = reference.getUTCMonth() - birth.getUTCMonth();
        if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < birth.getUTCDate())) computed -= 1;
        if (computed >= 8 && computed <= 120) age = computed;
        else warnings.push(`Idade de ${athleteName} estimada em 18 anos (birthDate inválido).`);
      } else warnings.push(`Idade de ${athleteName} estimada em 18 anos (birthDate ausente).`);
    } else warnings.push(`Idade de ${athleteName} estimada em 18 anos (birthDate ausente).`);
    const specialty = specialtyFor(athlete);
    const developmentLevel = String(athlete.level ?? "").trim().toLowerCase() === "base" ? "formacao" : "rendimento";
    // 2) Readiness real
    const readiness = athleteReadiness(store, athlete) ?? 70;
    // 3) Adaptação por readiness (RKF seção 18)
    const requestedVolume = body.targetVolumeM ?? defaultTargetVolumeM(athlete);
    const decision = decideAdaptation({ readiness, prescribedVolumeM: requestedVolume, primaryZone: requestedZone });
    const awaitingCoach = decision.status === "AGUARDAR_TREINADOR";
    const athleteContext: PlanningAthleteContext = {
      athleteId: athlete.id,
      age,
      developmentLevel,
      specialty,
      poolLengthM,
      ...(eventMeters !== undefined ? { eventMeters } : {}),
    };
    const planning: PlanningRequest = {
      phase,
      objective,
      primaryZone: decision.primaryZone,
      targetVolumeM: decision.adaptedVolumeM,
      rdcMarker: false,
      readiness,
      ...(skillEmphasis.length ? { skillEmphasis } : {}),
    };
    if (awaitingCoach) {
      warnings.push(`Readiness de ${athleteName} (${readiness}) bloqueia prescrição automática: sugestão marcada como AGUARDAR_TREINADOR (volume fator ${decision.volumeFactor}, zona ${decision.primaryZone}).`);
    }
    try {
      const result = generatePrescription(athleteContext, planning, library);
      const prescription = result.prescription;
      if (!prescription) throw new Error(result.audit.hardFailures[0] ?? "Motor não retornou prescrição");
      drafts.push({
        athleteId: athlete.id,
        athleteName,
        readiness,
        suggestionStatus: awaitingCoach ? "AGUARDAR_TREINADOR" : result.status,
        adaptation: { class: decision.class, volumeFactor: decision.volumeFactor, adaptedVolumeM: decision.adaptedVolumeM },
        title: prescription.title,
        blocks: mapPrescriptionBlocks(athlete.id, prescription.blocks),
        engine: {
          status: result.status,
          pipeline: result.pipeline,
          primaryZone: prescription.primaryZone,
          secondaryZone: prescription.secondaryZone,
          totalVolumeM: prescription.totalVolumeM,
          zoneAllocation: prescription.zoneAllocation,
          source: prescription.source,
          rationale: prescription.rationale,
          score: prescription.score ?? null,
          audit: result.audit,
        },
        rationale: prescription.rationale,
      });
      if (result.status === "REVISAR") warnings.push(`Motor retornou REVISAR para ${athleteName}: ${result.audit.hardFailures.join(" ") || "validação de sessão pendente"}.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Falha ao compor prescrição";
      const fallback = fallbackPrescription(String(athlete.id), decision.primaryZone, decision.adaptedVolumeM);
      warnings.push(`${athleteName}: estrutura RKF indisponível para ${decision.adaptedVolumeM} m (${reason}); prescrição mínima de segurança gerada.`);
      drafts.push({
        athleteId: athlete.id,
        athleteName,
        readiness,
        suggestionStatus: awaitingCoach ? "AGUARDAR_TREINADOR" : "REVISAR",
        adaptation: { class: decision.class, volumeFactor: decision.volumeFactor, adaptedVolumeM: decision.adaptedVolumeM },
        title: `Sessão ${decision.primaryZone} mínima`,
        blocks: mapPrescriptionBlocks(athlete.id, fallback.blocks),
        engine: {
          status: "REVISAR",
          pipeline: { eligible: 0, scored: 0, selected: "FALLBACK_MINIMO" },
          primaryZone: decision.primaryZone,
          secondaryZone: null,
          totalVolumeM: decision.adaptedVolumeM,
          zoneAllocation: null,
          source: null,
          rationale: fallback.rationale,
          score: null,
          audit: null,
        },
        rationale: fallback.rationale,
      });
    }
  }

  // --- Montagem: dedup por assinatura da prescrição + narrativa opcional do LLM ---
  // --- Montagem: dedup (todos idênticos → 1 sugestão team) + narrativa opcional do LLM ---
  const signatureOf = (draft: Draft) => JSON.stringify({
    title: draft.title,
    totalVolumeM: draft.engine.totalVolumeM,
    primaryZone: draft.engine.primaryZone,
    blocks: draft.blocks.map((block) => ({
      name: block.name,
      steps: block.steps.map((step) => [step.repetitions, step.distanceMeters ?? 0, step.targetValue ?? ""]),
    })),
  });
  const allIdentical = drafts.length > 1 && drafts.every((draft) => signatureOf(draft) === signatureOf(drafts[0]!));
  const suggestions: GenerateWorkoutSuggestion[] = allIdentical
    ? (() => {
      const representative = drafts[0]!;
      warnings.push(`Prescrição idêntica para ${drafts.length} atletas: retornada 1 sugestão com publish.team (${organizationId}).`);
      return [{
        athleteId: representative.athleteId,
        athleteIds: drafts.map((item) => item.athleteId),
        athleteName: drafts.map((item) => item.athleteName).join(", "),
        readiness: representative.readiness,
        status: representative.suggestionStatus,
        adaptation: representative.adaptation,
        workout: {
          title: representative.title,
          scheduledDate: date,
          objective,
          sportContext: "pool" as const,
          blocks: representative.blocks,
        },
        publish: { targetType: "team" as const, targetId: organizationId },
        engine: representative.engine,
        narrative: representative.rationale.join(" "),
        llmUsed: false,
      }];
    })()
    : drafts.map((draft) => ({
      athleteId: draft.athleteId,
      athleteName: draft.athleteName,
      readiness: draft.readiness,
      status: draft.suggestionStatus,
      adaptation: draft.adaptation,
      workout: {
        title: draft.title,
        scheduledDate: date,
        objective,
        sportContext: "pool" as const,
        blocks: draft.blocks,
      },
      publish: { targetType: "athlete" as const, targetId: draft.athleteId },
      engine: draft.engine,
      narrative: draft.rationale.join(" "),
      llmUsed: false,
    }));
  const overallStatus: GenerateWorkoutResponse["status"] = suggestions.every((suggestion) => suggestion.status === "PRONTO")
    ? "PRONTO"
    : "REVISAR";

  let narratives: Map<string, string> | null = null;
  // Chave checada em tempo de requisição para que os testes (sem LLM_API_KEY) sejam determinísticos.
  if (body.useNarrativeLlm !== false && Boolean(process.env.LLM_API_KEY) && suggestions.length) {
    try {
      const narrativeInput = {
        fase: phase,
        data: date,
        briefings: suggestions.map((suggestion) => ({
          athleteId: suggestion.athleteId,
          atleta: suggestion.athleteName,
          readiness: suggestion.readiness,
          zona: suggestion.engine.primaryZone,
          volumeM: suggestion.engine.totalVolumeM,
          blocos: suggestion.engine.rationale,
        })),
      };
      const answer = await callLLm([
        { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
        { role: "user", content: `Prescrições:\n${JSON.stringify(narrativeInput)}\nResponda somente com JSON {"briefings":[{"athleteId":"...","narrative":"2-3 frases em pt-BR"}]}.` },
      ]);
      narratives = parseBriefings(answer);
    } catch {
      narratives = null;
    }
  }
  for (const suggestion of suggestions) {
    const narrative = narratives?.get(suggestion.athleteId);
    if (narrative) {
      suggestion.narrative = narrative;
      suggestion.llmUsed = true;
    } else {
      suggestion.narrative = suggestion.engine.rationale.join(" ");
    }
  }
  return { ok: true, body: { status: overallStatus, date, phase, suggestions, warnings } };
}

export function registerAiRoutes(app: FastifyInstance, store: ManagedStore) {
  app.get("/api/v1/ai/status", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    const health = await inspectLlmAvailability();
    return { available: health.available, reason: health.reason, model: LLM_API_KEY ? LLM_MODEL : null, gateway: LLM_API_KEY ? LLM_BASE_URL : null };
  });

  app.post("/api/v1/ai/chat", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    const body = (await request.body) as { messages?: ChatMessage[] } | null;
    const history = Array.isArray(body?.messages) ? body!.messages!.slice(-12) : [];
    if (!history.length || history.some((m) => typeof m.content !== "string" || !m.content.trim())) {
      return reply.code(400).send({ error: "Envie ao menos uma mensagem válida." });
    }
    if (!LLM_API_KEY) {
      return reply.code(503).send({ error: "Assistente indisponível: configure LLM_API_KEY no ambiente da API." });
    }

    const context = `${buildPlatformContext(store, user!.organizationId)}\n\n${user!.organizationId === "org-demo" ? buildPerformanceContext() : ""}`;
    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n=== SNAPSHOT DA PLATAFORMA ===\n${context}` },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      const answer = await callLLm(messages);
      return { reply: answer, model: LLM_MODEL, at: new Date().toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar o modelo";
      return reply.code(502).send({ error: `Não consegui responder agora: ${message}` });
    }
  });

  app.post("/api/v1/ai/generate-workout", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    const parsed = generateWorkoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Requisição de geração inválida", details: parsed.error.flatten() });
    const outcome = await generateWorkoutSuggestions(store, user!.organizationId, parsed.data);
    if (!outcome.ok) return reply.code(outcome.status).send(outcome.payload);
    return reply.send(outcome.body);
  });
}
