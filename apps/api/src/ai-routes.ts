import type { FastifyInstance } from "fastify";
import type { ManagedStore } from "./managed-store.js";

type ChatMessage = { role: "user" | "assistant"; content: string };

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://api.elevamkt.digital/v1";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_MODEL = process.env.LLM_MODEL ?? "llmapi/glm-5.3";

function esc(value: unknown): string {
  return String(value ?? "—");
}

/**
 * Serializa todo o estado da plataforma em um contexto estruturado para o LLM.
 * O assistente só conhece o que está aqui — então este snapshot deve cobrir
 * todas as entidades visíveis na interface do coach.
 */
export function buildPlatformContext(store: ManagedStore): string {
  const list = (kind: string) => store.list(kind as never);
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
${athletes.map((a) => `- ${esc(a.name)} (${esc(a.handle)}) · grupo: ${esc(a.group)} · nado: ${esc(a.stroke)} · status: ${esc(a.status)} · e-mail: ${esc(a.email)}`).join("\n")}`);
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

  const audit = store.audit(12);
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
- 28/08 SEX 07:30 · Ritmo de prova · 200 Livre · 5.200 m · RP · Equipe inteira · RPE 7 · publicado
- 28/08 SEX 16:00 · Força máxima · membros inferiores · 55 min · Elite · RPE 8 · publicado
- 29/08 SÁB 08:00 · Aeróbio regenerativo + técnica · 3.800 m · A1 · Equipe inteira · RPE 4 · rascunho
- 31/08 SEG 06:30 · VO₂ · tolerância ao lactato · 4.600 m · AN · Elite · RPE 9 · publicado
- 01/09 TER 07:00 · Base aeróbia · eficiência · 5.800 m · A2 · Equipe inteira · RPE 6 · publicado
- 02/09 QUA 16:30 · Potência e core · FORÇA · Desenvolvimento · RPE 7 · rascunho

## Biblioteca de treinos
Natação: Ritmo de 200 · fechamento forte (5.200m RP) · Aeróbio específico · eficiência (6.100m A2) · Lactato · velocidade sustentada (4.200m AN) · Regenerativo técnico (3.200m A1)
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

const SYSTEM_PROMPT = `Você é o assistente de inteligência do AquaOS Coach, a plataforma de gestão de equipes de natação.

CONTEXTO: você recebe abaixo um snapshot completo e atualizado dos dados da plataforma (dados de gestão + dados de performance). Responda APENAS com base nesses dados.

REGRAS:
1. Responda em português do Brasil, com tom profissional e direto, como um analista de performance experiente conversando com o treinador.
2. Use os dados reais do snapshot: nomes, números, datas, status. Nunca invente atletas, marcas ou treinos.
3. Se o dado não estiver no snapshot, diga explicitamente que não tem essa informação em vez de especular.
4. Seja acionável: quando fizer sentido, sugira o próximo passo (revisar atleta, ajustar treino, checar vídeo).
5. Para perguntas analíticas, calcule com cuidado (médias, somas, comparações) antes de responder.
6. Formate respostas curtas e escaneáveis: use listas quando houver vários itens, negrito para destaques via **texto**.
7. Você pode falar de qualquer tema da plataforma: atletas, prontidão corporal, treinos, biblioteca, temporadas, competições, índices, vídeos, habilidades técnicas, metas, volumes, alertas, conectores, comissão, grupos, zonas e configurações.`;

async function callLLm(messages: Array<{ role: string; content: string }>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 1200, temperature: 0.4, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM respondeu ${response.status}`);
    const raw = await response.text();
    // Alguns gateways ignoram stream:false e devolvem SSE — tratar ambos os formatos.
    const contentType = response.headers.get("content-type") ?? "";
    if (raw.startsWith("data:") || contentType.includes("text/event-stream")) {
      const chunks = raw.split("\n").filter((line) => line.startsWith("data:") && !line.includes("[DONE]"));
      let assembled = "";
      for (const chunk of chunks) {
        try {
          const parsed = JSON.parse(chunk.slice(5).trim()) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
          assembled += parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
        } catch { /* linha keep-alive ignorada */ }
      }
      if (assembled.trim()) return assembled;
      throw new Error("Stream sem conteúdo");
    }
    const payload = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Resposta vazia do modelo");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export function registerAiRoutes(app: FastifyInstance, store: ManagedStore) {
  app.get("/api/v1/ai/status", async () => ({
    available: Boolean(LLM_API_KEY),
    model: LLM_API_KEY ? LLM_MODEL : null,
    gateway: LLM_API_KEY ? LLM_BASE_URL : null,
  }));

  app.post("/api/v1/ai/chat", async (request, reply) => {
    const body = (await request.body) as { messages?: ChatMessage[] } | null;
    const history = Array.isArray(body?.messages) ? body!.messages!.slice(-12) : [];
    if (!history.length || history.some((m) => typeof m.content !== "string" || !m.content.trim())) {
      return reply.code(400).send({ error: "Envie ao menos uma mensagem válida." });
    }
    if (!LLM_API_KEY) {
      return reply.code(503).send({ error: "Assistente indisponível: configure LLM_API_KEY no ambiente da API." });
    }

    const context = `${buildPlatformContext(store)}\n\n${buildPerformanceContext()}`;
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
}
