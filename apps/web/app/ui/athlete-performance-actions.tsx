"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  Activity, BadgeCheck, CalendarDays, Download, FileCheck2, Film, Gauge,
  HeartPulse, Info, LineChart, MessageSquare, Moon, Send, ShieldCheck,
  Sparkles, Target, Timer, Waves, X,
} from "lucide-react";
import type { AthleteProfile } from "./demo-data";
import { zoneDistribution } from "./demo-data";
import { apiRequest, mediaUrl } from "./api";
import { ModalShell, formatNumber } from "./components";

export type AthletePanel = "goal" | "methodology" | "evidence" | "body" | "message" | null;

export type AthleteGoal = {
  event: string;
  course: string;
  currentTime: string;
  targetTime: string;
  meet: string;
  deadline: string;
  priority: string;
  gap: string;
};

type GoalRecord = { id: string; athleteId?: string };

const weekFactors = [.64, .71, .68, .77, .84, .79, .92, 1];

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function timeToSeconds(value: string) {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function calculateGap(currentTime: string, targetTime: string) {
  const current = timeToSeconds(currentTime);
  const target = timeToSeconds(targetTime);
  if (current === undefined || target === undefined) return "A calcular";
  const difference = current - target;
  if (Math.abs(difference) >= 60) {
    const minutes = Math.floor(Math.abs(difference) / 60);
    const seconds = (Math.abs(difference) % 60).toFixed(2).padStart(5, "0");
    return `${difference >= 0 ? "+" : "-"}${minutes}:${seconds}`;
  }
  return `${difference >= 0 ? "+" : "-"}${Math.abs(difference).toFixed(2)} s`;
}

export function initialGoalFor(athlete: AthleteProfile): AthleteGoal {
  return {
    event: athlete.goalEvent ?? "",
    course: athlete.stroke === "Águas abertas" ? "Águas abertas" : "Piscina 50 m",
    currentTime: athlete.bestTime ?? "",
    targetTime: athlete.goalTime ?? "",
    meet: athlete.stroke === "Águas abertas" ? "Circuito Mundial" : "Troféu Brasil",
    deadline: "2026-09-18",
    priority: "A",
    gap: athlete.gap ?? "A calcular",
  };
}

/** Reference date for the demo dataset, so the projection is deterministic. */
const TODAY = "2026-08-28";

export type GoalPacing = {
  weeksLeft: number;
  secondsToDrop: number;
  requiredPerWeek: number;
  observedPerWeek: number;
  projectedTime: string;
  status: "on-track" | "tight" | "off-track";
  label: string;
  advice: string;
};

function secondsToTime(total: number) {
  if (total <= 0) return "--";
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${seconds.toFixed(2).padStart(5, "0")}` : seconds.toFixed(2);
}

/**
 * Estimates whether the athlete is dropping time fast enough to reach the
 * target before the deadline. Demonstrative: the observed rate is derived
 * from the synthetic skill trend, not from a validated progression model.
 */
export function calculateGoalPacing(athlete: AthleteProfile, goal: AthleteGoal): GoalPacing | null {
  const current = timeToSeconds(goal.currentTime);
  const target = timeToSeconds(goal.targetTime);
  if (current === undefined || target === undefined || !goal.deadline) return null;

  const msLeft = new Date(`${goal.deadline}T00:00:00`).getTime() - new Date(`${TODAY}T00:00:00`).getTime();
  const weeksLeft = Math.max(0, Math.round(msLeft / 604800000));
  const secondsToDrop = Math.max(0, current - target);
  const requiredPerWeek = weeksLeft > 0 ? secondsToDrop / weeksLeft : secondsToDrop;

  // Observed rate: mean skill trend scaled to the event distance.
  const meanTrend = athlete.skills.reduce((sum, skill) => sum + skill.trend, 0) / (athlete.skills.length || 1);
  const observedPerWeek = Math.max(0, meanTrend * current * 0.0016);
  const projectedTime = secondsToTime(Math.max(target * 0.94, current - observedPerWeek * weeksLeft));

  const ratio = requiredPerWeek > 0 ? observedPerWeek / requiredPerWeek : 2;
  const status = ratio >= 1 ? "on-track" : ratio >= 0.65 ? "tight" : "off-track";
  return {
    weeksLeft, secondsToDrop, requiredPerWeek, observedPerWeek, projectedTime, status,
    label: status === "on-track" ? "No ritmo da meta" : status === "tight" ? "Ritmo apertado" : "Abaixo do ritmo",
    advice: status === "on-track"
      ? "A evolução recente cobre o que falta até a data limite."
      : status === "tight"
        ? "Falta pouco para o ritmo necessário. Priorize a habilidade mais fraca."
        : "O ritmo atual não fecha a diferença. Revise meta, data ou prescrição.",
  };
}

export function exportAthletePerformance(athlete: AthleteProfile, goal: AthleteGoal) {
  const weekly = weekFactors.map((factor, index) => {
    const completed = Math.round(athlete.weeklyDistance * factor);
    const prescribed = Math.round(completed / (.9 + index * .006));
    return { week: `S${index + 1}`, prescribed, completed, adherence: Math.round(completed / prescribed * 100) };
  });
  const intensity = zoneDistribution.map((zone) => ({
    code: zone.code,
    label: zone.label,
    percent: zone.percent,
    meters: Math.round(athlete.weeklyDistance * zone.percent / 100),
  }));
  const lines = [
    "AQUAOS - VOLUME E INTENSIDADE",
    `Atleta;${athlete.name}`,
    `Prova-meta;${goal.event || "Sem meta"}`,
    `Marca atual;${goal.currentTime || "Sem marca"}`,
    `Marca-meta;${goal.targetTime || "Sem meta"}`,
    "",
    "VOLUME - ULTIMAS 8 SEMANAS",
    "Semana;Prescrito (m);Realizado (m);Aderencia (%)",
    ...weekly.map((row) => `${row.week};${row.prescribed};${row.completed};${row.adherence}`),
    "",
    "DISTRIBUICAO DE INTENSIDADE - SEMANA ATUAL",
    "Zona;Descricao;Percentual;Distancia (m)",
    ...intensity.map((row) => `${row.code};${row.label};${row.percent};${row.meters}`),
    "",
    "Observacao;Indicadores calculados com o RkfLoadEngine V5.1 e dados sinteticos de validacao",
  ];
  downloadCsv(`volume-intensidade-${athlete.id}.csv`, lines);
}

export function GoalEditor({ athlete, goal, onClose, onSaved, onNotify }: {
  athlete: AthleteProfile;
  goal: AthleteGoal;
  onClose: () => void;
  onSaved: (goal: AthleteGoal) => void;
  onNotify: (message: string) => void;
}) {
  const [draft, setDraft] = useState(goal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof AthleteGoal, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.event.trim() || !draft.targetTime.trim() || !draft.currentTime.trim()) {
      setError("Preencha prova, marca atual e marca-meta.");
      return;
    }
    setSaving(true);
    setError("");
    const updated = { ...draft, gap: calculateGap(draft.currentTime, draft.targetTime) };
    const payload = {
      id: `${athlete.id}-primary-goal`, name: `${athlete.name} - ${updated.event}`,
      athleteId: athlete.id, event: updated.event, course: updated.course,
      currentTime: updated.currentTime, targetTime: updated.targetTime, meet: updated.meet,
      deadline: updated.deadline, priority: updated.priority, gap: updated.gap, status: "active",
    };
    try {
      const response = await apiRequest<{ data: GoalRecord[] }>("/api/v1/manage/goals");
      const existing = response.data.find((item) => item.athleteId === athlete.id);
      await apiRequest(existing ? `/api/v1/manage/goals/${existing.id}` : "/api/v1/manage/goals", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(updated);
      onNotify("Meta atualizada e registrada na trilha de auditoria.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a meta.");
    } finally {
      setSaving(false);
    }
  };

  return <ModalShell title="Editar meta de performance" subtitle={`${athlete.name} | objetivo individual`} onClose={onClose}>
    <form className="goal-editor" onSubmit={(event) => void save(event)}>
      <div className="goal-editor-intro"><Target size={21} /><div><b>Objetivo principal</b><p>A alteração atualiza o prontuário e preserva a versão anterior na auditoria.</p></div></div>
      <div className="form-grid">
        <label><span>Prova-meta</span><input value={draft.event} onChange={(event) => update("event", event.target.value)} placeholder="Ex.: 200 m Livre" /></label>
        <label><span>Ambiente</span><select value={draft.course} onChange={(event) => update("course", event.target.value)}><option>Piscina 50 m</option><option>Piscina 25 m</option><option>Águas abertas</option></select></label>
        <label><span>Marca atual</span><input value={draft.currentTime} onChange={(event) => update("currentTime", event.target.value)} placeholder="2:01.32" /></label>
        <label><span>Marca-meta</span><input value={draft.targetTime} onChange={(event) => update("targetTime", event.target.value)} placeholder="1:58.50" /></label>
        <label><span>Competição-alvo</span><input value={draft.meet} onChange={(event) => update("meet", event.target.value)} /></label>
        <label><span>Data limite</span><input type="date" value={draft.deadline} onChange={(event) => update("deadline", event.target.value)} /></label>
        <label><span>Prioridade</span><select value={draft.priority} onChange={(event) => update("priority", event.target.value)}><option value="A">A - principal</option><option value="B">B - controle</option><option value="C">C - preparação</option></select></label>
        <div className="goal-gap-preview"><span>Gap projetado</span><b>{calculateGap(draft.currentTime, draft.targetTime)}</b><small>Calculado a partir das marcas informadas</small></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-footer inline"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar meta"}</button></footer>
    </form>
  </ModalShell>;
}

export function MethodologyDialog({ athlete, onClose }: { athlete: AthleteProfile; onClose: () => void }) {
  const definitions: Record<string, string> = {
    S: "Eficiência e reação no início da prova, incluindo entrada e primeiros ciclos.",
    V: "Velocidade limpa, frequência, distância por ciclo e capacidade de aceleração.",
    T: "Aproximação, contato, impulso, submerso e retomada após cada virada.",
    P: "Estabilidade do ritmo, distribuição de esforço e manutenção técnica.",
    F: "Decisão, frequência e execução técnica nos metros finais.",
  };
  return <ModalShell title="Metodologia das cinco habilidades" subtitle="Contrato demonstrativo, versionado e explicável" onClose={onClose} wide>
    <div className="methodology-panel">
      <section className="methodology-callout"><Sparkles size={22} /><div><span>MOTOR ATIVO</span><b>RkfLoadEngine V5.1</b><p>Método versionado em validação. Pesos, regras e evidências permanecem auditáveis antes da homologação oficial.</p></div><strong>85% confiança</strong></section>
      <section className="methodology-flow">
        {[{ icon: Film, title: "Evidência", body: "Vídeo, prova, treino e registro manual." }, { icon: ShieldCheck, title: "Validação", body: "Recência, qualidade e origem verificável." }, { icon: Gauge, title: "Pontuação", body: "Escala de 0 a 100 por habilidade." }, { icon: LineChart, title: "Tendência", body: "Comparação com a linha de base individual." }].map(({ icon: Icon, title, body }) => <article key={title}><Icon size={18} /><b>{title}</b><p>{body}</p></article>)}
      </section>
      <section className="methodology-skills"><header><div><h3>Leitura atual de {athlete.name}</h3><p>Cada indicador mantém origem, data, confiança e versão de cálculo.</p></div><span>0-100</span></header>{athlete.skills.map((skill) => <div key={skill.key}><span>{skill.key}</span><div><b>{skill.label}</b><p>{definitions[skill.key]}</p></div><strong>{skill.score}</strong><small className={skill.trend >= 0 ? "positive" : "negative"}>{skill.trend >= 0 ? "+" : ""}{skill.trend} {Math.abs(skill.trend) === 1 ? "pt" : "pts"}</small></div>)}</section>
      <section className="methodology-weights"><Info size={18} /><div><b>Composição demonstrativa</b><p>Prova 55% | treino 30% | recência 15%. A confiança considera quantidade, atualidade e concordância entre fontes.</p></div></section>
      <footer className="modal-footer inline"><button className="primary-button" onClick={onClose}>Entendi</button></footer>
    </div>
  </ModalShell>;
}

export function EvidenceDialog({ athlete, onClose, onNotify }: { athlete: AthleteProfile; onClose: () => void; onNotify: (message: string) => void }) {
  const evidence = [
    { icon: Film, type: "Vídeo de prova", title: `${athlete.goalEvent ?? athlete.stroke} | análise técnica`, detail: "23 ago 2026 | 7 marcadores | confiança 92%", skill: "Ritmo + virada", status: "Validado" },
    { icon: Waves, type: "Treino realizado", title: "Série principal em ritmo de prova", detail: "25 ago 2026 | 3 x 100 finalizados | aderência 96%", skill: "Ritmo", status: "Sincronizado" },
    { icon: Timer, type: "Resultado oficial", title: `${athlete.bestTime ?? "Sem marca"} na prova-alvo`, detail: "18 mai 2026 | piscina homologada | cronometragem oficial", skill: "Todas", status: "Oficial" },
    { icon: Activity, type: "Leitura do treinador", title: "Consistência técnica sob fadiga", detail: "26 ago 2026 | observação vinculada ao microciclo", skill: "Chegada", status: "Revisado" },
  ];
  const [selected, setSelected] = useState<(typeof evidence)[number] | null>(null);
  const selectedIndex = selected ? evidence.findIndex((item) => item.title === selected.title) : -1;
  const sourceVideo = selectedIndex === 0
    ? mediaUrl(athlete.id === "caio-martins" ? "/uploads/treino-tecnico-noturno-720p.mp4" : "/uploads/treino-tecnico-diurno-1080p.mp4")
    : undefined;
  const exportEvidence = () => {
    downloadCsv(`evidencias-${athlete.id}.csv`, [
      "AQUAOS - EVIDENCIAS DE PERFORMANCE",
      `Atleta;${athlete.name}`,
      "Tipo;Titulo;Detalhe;Habilidade;Status",
      ...evidence.map((item) => `${item.type};${item.title};${item.detail};${item.skill};${item.status}`),
      "",
      "Observacao;Classificacao demonstrativa, sujeita a validacao do treinador",
    ]);
    onNotify("Evidências exportadas em CSV.");
  };
  return <ModalShell title="Evidências de performance" subtitle={`${athlete.name} | rastreabilidade técnica`} onClose={onClose} wide>
    <div className="evidence-panel">
      <div className="evidence-summary"><div><FileCheck2 size={20} /><span><b>4 fontes ativas</b><small>3 objetivas e 1 observacional</small></span></div><div><BadgeCheck size={20} /><span><b>Alta confiabilidade</b><small>Atualizadas nos últimos 90 dias</small></span></div><div><CalendarDays size={20} /><span><b>Última evidência</b><small>Há 2 dias</small></span></div></div>
      <section className="evidence-list"><header><span>FONTE</span><span>HABILIDADE</span><span>STATUS</span><span /></header>{evidence.map(({ icon: Icon, ...item }) => <article key={item.title} className={selected?.title === item.title ? "active" : ""}><span className="evidence-icon"><Icon size={18} /></span><div><small>{item.type}</small><b>{item.title}</b><p>{item.detail}</p></div><span>{item.skill}</span><strong><BadgeCheck size={14} />{item.status}</strong><button onClick={() => setSelected({ icon: Icon, ...item })}>Abrir fonte</button></article>)}</section>
      {selected && <section className="evidence-source" aria-live="polite">
        <header><div><span>FONTE VERIFICADA</span><h3>{selected.title}</h3><p>{selected.type} | {selected.detail}</p></div><button className="icon-button" aria-label="Fechar fonte" onClick={() => setSelected(null)}><X size={18} /></button></header>
        {sourceVideo ? <video src={sourceVideo} controls playsInline preload="metadata" /> : <div className="evidence-source-record"><span>{selectedIndex === 1 ? <Waves size={24} /> : selectedIndex === 2 ? <Timer size={24} /> : <Activity size={24} />}</span><div><b>{selectedIndex === 1 ? "Atividade normalizada do dispositivo" : selectedIndex === 2 ? "Registro homologado da competição" : "Registro assinado pela comissão técnica"}</b><p>{selectedIndex === 1 ? "Amostra com distância, intervalos, ritmo, frequência cardíaca e aderência preservada no dado bruto." : selectedIndex === 2 ? "Resultado associado à prova, piscina, data, cronometragem e documento de origem." : "Observação longitudinal vinculada ao atleta, microciclo e habilidade avaliada."}</p></div></div>}
        <dl><div><dt>Habilidade</dt><dd>{selected.skill}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div><div><dt>Origem</dt><dd>{selectedIndex === 0 ? "Arquivo de vídeo" : selectedIndex === 1 ? athlete.wearable ?? "Importação manual" : selectedIndex === 2 ? "Resultado oficial" : "Comissão técnica"}</dd></div><div><dt>Integridade</dt><dd>Hash e versão preservados</dd></div></dl>
      </section>}
      <footer className="modal-footer inline"><button className="secondary-button" onClick={exportEvidence}><Download size={16} />Exportar evidências</button><button className="primary-button" onClick={onClose}>Concluir revisão</button></footer>
    </div>
  </ModalShell>;
}

export function BodyReadinessDialog({ athlete, onClose }: { athlete: AthleteProfile; onClose: () => void }) {
  const baseReadiness = athlete.readiness ?? 0;
  const baseSleep = athlete.sleep ?? 0;
  const baseHrv = athlete.hrv ?? 0;
  const history = useMemo(() => {
    const offsets = [-8, -3, 2, -5, 4, -1, 0];
    return ["23 ago", "24 ago", "25 ago", "26 ago", "27 ago", "28 ago", "Hoje"].map((day, index) => ({
      day,
      readiness: Math.max(22, Math.min(98, baseReadiness + offsets[index])),
      sleep: Math.max(4.2, Math.min(9.4, baseSleep + [-.7, -.2, .3, -.4, .5, .1, 0][index])),
      hrv: Math.max(25, baseHrv + [-7, -3, 2, -4, 4, 1, 0][index]),
    }));
  }, [baseHrv, baseReadiness, baseSleep]);
  const status = baseReadiness >= 80 ? "Pronto para carga específica" : baseReadiness >= 65 ? "Pronto, com monitoramento" : "Recuperação prioritária";
  const tone = baseReadiness >= 80 ? "good" : baseReadiness >= 65 ? "watch" : "risk";
  return <ModalShell title="Corpo e prontidão" subtitle={`${athlete.name} | leitura integrada do dia`} onClose={onClose} wide>
    <div className="readiness-dialog">
      <section className={`readiness-decision ${tone}`}><span><HeartPulse size={23} /></span><div><small>DECISÃO DE CAMPO</small><h3>{status}</h3><p>A leitura combina sono, recuperação, VFC, frequência de repouso e tendência individual. A decisão final permanece com a comissão técnica.</p></div><strong>{baseReadiness || "--"}<small>/100</small></strong></section>
      <section className="readiness-metrics">
        <article><span><Gauge size={18} />Prontidão</span><b>{baseReadiness || "--"}<small>/100</small></b><p>{baseReadiness >= 80 ? "Acima da linha de base" : "Abaixo da linha de base"}</p></article>
        <article><span><Moon size={18} />Sono</span><b>{baseSleep || "--"}<small>h</small></b><p>{baseSleep >= 7.5 ? "Duração adequada" : "Déficit de sono"}</p></article>
        <article><span><Activity size={18} />VFC</span><b>{baseHrv || "--"}<small>ms</small></b><p>Tendência individual de 7 dias</p></article>
        <article><span><HeartPulse size={18} />FCR</span><b>{athlete.restingHr || "--"}<small>bpm</small></b><p>Repouso durante o sono</p></article>
      </section>
      <section className="readiness-history"><header><div><h3>Resposta dos últimos 7 dias</h3><p>Prontidão, sono e VFC normalizados para leitura conjunta.</p></div><span>{athlete.wearable ?? "Sem wearable"}<small>Sincronizado {athlete.lastBodySync ?? "sem leitura recente"}</small></span></header><div className="readiness-chart" aria-label="Histórico de prontidão dos últimos sete dias">{history.map((point) => <div key={point.day}><div className="readiness-bar-track"><i style={{ height: `${point.readiness}%` }}><span>{point.readiness}</span></i></div><b>{point.day}</b><small>{point.sleep.toFixed(1)} h | {point.hrv} ms</small></div>)}</div></section>
      <section className="readiness-notes"><Info size={19} /><div><b>Interpretação operacional</b><p>{baseReadiness >= 80 ? "Manter a sessão-chave e observar a resposta entre blocos de alta intensidade." : baseReadiness >= 65 ? "Manter o volume planejado, com checagem de percepção antes da série principal." : "Reavaliar intensidade, dor e fadiga antes de confirmar a prescrição do dia."}</p></div></section>
      <footer className="modal-footer inline"><button className="primary-button" onClick={onClose}>Concluir leitura</button></footer>
    </div>
  </ModalShell>;
}

export function AthleteMessageDialog({ athlete, onClose, onNotify }: { athlete: AthleteProfile; onClose: () => void; onNotify: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const templates = ["Confirme o recebimento do treino de amanhã.", "Como você se sentiu após a série principal?", "Envie seu RPE e qualquer sinal de dor após a sessão."];
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if (!body) { setError("Escreva uma mensagem antes de enviar."); return; }
    setSending(true); setError("");
    try {
      await apiRequest("/api/v1/manage/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "message", athleteId: athlete.id, athlete: athlete.name, body, channel: "RKF Coach", status: "sent", sentAt: new Date().toISOString() }),
      });
      setSent((current) => [...current, body]);
      setMessage("");
      onNotify(`Mensagem enviada para ${athlete.name} e registrada no histórico.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar a mensagem.");
    } finally { setSending(false); }
  };
  return <ModalShell title="Mensagem para atleta" subtitle={`${athlete.name} | canal interno do programa`} onClose={onClose} wide>
    <form className="message-dialog" onSubmit={(event) => void send(event)}>
      <section className="message-contact"><span style={{ background: athlete.color }}>{athlete.initials}</span><div><b>{athlete.name}</b><p>{athlete.handle} | {athlete.group}</p></div><strong><BadgeCheck size={15} />Canal verificado</strong></section>
      <section className="message-thread"><div className="message-system"><MessageSquare size={17} /><p>Esta conversa fica vinculada ao prontuário do atleta e disponível para a comissão autorizada.</p></div>{sent.map((item, index) => <div className="message-bubble outgoing" key={`${item}-${index}`}><p>{item}</p><small>Agora | Entregue</small></div>)}</section>
      <div className="message-templates"><span>RESPOSTAS RÁPIDAS</span><div>{templates.map((template) => <button type="button" key={template} onClick={() => setMessage(template)}>{template}</button>)}</div></div>
      <label className="message-compose"><span>Mensagem</span><textarea autoFocus value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escreva uma orientação objetiva para o atleta..." /><small>{message.length}/500 caracteres</small></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-footer inline"><button type="button" className="secondary-button" onClick={onClose}>Fechar</button><button type="submit" className="primary-button" disabled={sending || !message.trim()}><Send size={16} />{sending ? "Enviando" : "Enviar mensagem"}</button></footer>
    </form>
  </ModalShell>;
}
