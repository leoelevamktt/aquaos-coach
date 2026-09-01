"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Bot, CircleCheck, RefreshCw, Send, Sparkles, Target, UserRound, Users, Waves,
} from "lucide-react";
import { ModalShell, formatNumber } from "./components";
import { apiRequest } from "./api";
import { hydrateAthlete, zoneDistribution, type AthleteProfile } from "./demo-data";
import type { WorkoutSeed } from "./workout-library-actions";

type AiStep = { id: string; order: number; kind: string; repetitions: number; distanceMeters?: number; durationSeconds?: number; stroke: string; targetType: string; targetValue?: string; intervalSeconds?: number; equipment: string[]; notes?: string };
type AiBlock = { id: string; name: string; order: number; repeatCount: number; steps: AiStep[] };
type AiSuggestion = {
  athleteId: string; athleteName: string; readiness: number | null;
  adaptation: { class: string; volumeFactor: number; adaptedVolumeM: number } | null;
  workout: { title: string; scheduledDate: string; objective: string; sportContext: "pool"; blocks: AiBlock[] };
  publish: { targetType: "athlete" | "group" | "team"; targetId: string };
  engine: { status: string; primaryZone: string; secondaryZone: string | null; totalVolumeM: number; zoneAllocation: { tec: number; zones: Record<string, number>; advisory: boolean }; source: string; rationale: string[]; score?: number };
  narrative: string; llmUsed: boolean;
};
type GenerateResponse = { status: "PRONTO" | "REVISAR"; date: string; phase: string; suggestions: AiSuggestion[]; warnings: string[] };

const ZONES = ["A1", "A2", "A3", "AN1", "AN2", "VALAT"];
const zoneColor = (code: string) => zoneDistribution.find((zone) => zone.code === code.toUpperCase())?.color ?? "#397ac4";
const stepLine = (step: AiStep) => `${step.repetitions}×${step.distanceMeters ? `${formatNumber(step.distanceMeters)} m` : step.durationSeconds ? `${Math.max(1, Math.round(step.durationSeconds / 60))} min` : "livre"} ${step.stroke}${step.targetValue ? ` · ${step.targetValue}` : ""}${step.intervalSeconds ? ` @${Math.floor(step.intervalSeconds / 60)}:${String(step.intervalSeconds % 60).padStart(2, "0")}` : ""}`.replace(/\s+/g, " ").trim();
const blocksText = (blocks: AiBlock[]) => blocks.map((block) => `${block.name} ×${block.repeatCount} · ${block.steps.map(stepLine).join(" + ")}`).join("\n");

export function AiWorkoutModal({ onClose, onUseComposer, onNotify, onPublished }: {
  onClose: () => void;
  onUseComposer: (seed: WorkoutSeed) => void;
  onNotify: (message: string, variant?: "success" | "error") => void;
  onPublished?: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [roster, setRoster] = useState<AthleteProfile[]>([]);
  const [target, setTarget] = useState<"team" | "group" | "athlete">("team");
  const [group, setGroup] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [volume, setVolume] = useState("");
  const [zone, setZone] = useState("A2");
  const [phase, setPhase] = useState("");
  const [objective, setObjective] = useState("");
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [publishingId, setPublishingId] = useState("");
  const [published, setPublished] = useState<string[]>([]);
  const [suggestedVolume, setSuggestedVolume] = useState(0);
  const activeRoster = roster.filter((athlete) => athlete.account === "active");
  const groupOptions = [...new Set(activeRoster.map((athlete) => athlete.group).filter(Boolean))];
  const effectiveGroup = group || groupOptions[0] || "";
  const selectedAthlete = activeRoster.find((athlete) => athlete.id === athleteId) ?? activeRoster[0];
  const targetLabel = target === "team" ? "Equipe inteira" : target === "group" ? (effectiveGroup || "Grupo") : selectedAthlete?.name ?? "Atleta";
  const athleteIds = target === "athlete" && selectedAthlete ? [selectedAthlete.id] : target === "group" && effectiveGroup ? activeRoster.filter((athlete) => athlete.group === effectiveGroup).map((athlete) => athlete.id) : [];

  useEffect(() => {
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/athletes")
      .then((response) => {
        const live = response.data.map(hydrateAthlete);
        setRoster(live);
        const firstGroup = live.find((athlete) => athlete.account === "active" && athlete.group)?.group;
        setGroup((current) => current || firstGroup || "");
        setAthleteId((current) => current || live.find((athlete) => athlete.account === "active")?.id || "");
      })
      .catch(() => undefined);
    void apiRequest<{ available: boolean }>("/api/v1/ai/status")
      .then((status) => setOffline(status.available === false))
      .catch(() => setOffline(true));
    void apiRequest<{ todaySessions: Array<{ volumeMeters: number }>; load: { weeklyHistory: Array<{ volumeMeters: number }> } }>("/api/v1/coach/briefing")
      .then((briefing) => setSuggestedVolume(briefing.todaySessions[0]?.volumeMeters || briefing.load.weeklyHistory.at(-1)?.volumeMeters || 0))
      .catch(() => setSuggestedVolume(0));
  }, []);
  const generate = async () => {
    setLoading(true); setError("");
    try {
      const response = await apiRequest<GenerateResponse>("/api/v1/ai/generate-workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ athleteIds: target === "team" ? undefined : athleteIds.length ? athleteIds : undefined, date, phase: phase.trim() || undefined, primaryZone: zone, targetVolumeM: Math.max(0, Number(volume) || suggestedVolume) || undefined, objective: objective.trim() || undefined, useNarrativeLlm: true }) });
      setResult(response);
      setStep(2);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar o treino com IA."); }
    finally { setLoading(false); }
  };
  const publishSuggestion = async (suggestion: AiSuggestion) => {
    setPublishingId(suggestion.athleteId); setError("");
    try {
      await apiRequest("/api/v1/manage/workouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: suggestion.workout.title, date: suggestion.workout.scheduledDate || date, scheduledAt: `${suggestion.workout.scheduledDate || date}T08:00`, distanceMeters: suggestion.adaptation?.adaptedVolumeM ?? suggestion.engine.totalVolumeM, zone: suggestion.engine.primaryZone, kind: "swim", target: suggestion.publish.targetType === "athlete" ? suggestion.athleteName : suggestion.publish.targetType === "group" ? effectiveGroup : "Equipe inteira", targetType: suggestion.publish.targetType, targetId: suggestion.publish.targetId, pool: "Olímpica · 50 m", note: "", status: "published", source: "ai-generate", publishedAt: new Date().toISOString(), prescriptionText: suggestion.narrative || blocksText(suggestion.workout.blocks), blocks: suggestion.workout.blocks }) });
      setPublished((current) => [...current, suggestion.athleteId]);
      onNotify(`Treino de ${suggestion.athleteName} publicado a partir da sugestão de IA.`);
      onPublished?.();
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Não foi possível publicar o treino gerado.", "error"); }
    finally { setPublishingId(""); }
  };
  const openComposer = (suggestion: AiSuggestion) => {
    const text = blocksText(suggestion.workout.blocks) || suggestion.narrative;
    onUseComposer({ title: suggestion.workout.title, prompt: `${suggestion.workout.objective ? `${suggestion.workout.objective}\n` : ""}${text}`, distanceMeters: suggestion.adaptation?.adaptedVolumeM ?? suggestion.engine.totalVolumeM, zone: suggestion.engine.primaryZone, kind: "swim" });
  };
  return <ModalShell title="Gerar treino com IA" subtitle="Alvo, zona e carga combinados pelo engine RKF" onClose={onClose} wide>
    <div className="composer-steps"><span className={step >= 1 ? "active" : ""}><i>1</i>Alvo</span><em /><span className={step >= 2 ? "active" : ""}><i>2</i>Sugestões</span></div>
    {offline && <div className="ai-offline-banner" role="status"><Sparkles size={16} />IA offline — usando engine determinístico local. A narração com LLM é opcional.</div>}
    {step === 1 && <div className="assignment-panel">
      <div className="ai-target-block"><span className="eyebrow accent">GERAR PARA</span>
        <div className="target-options ai-target-grid">{([{ key: "team", icon: Users, label: "Equipe inteira", detail: `${activeRoster.length || "—"} atletas ativos` }, { key: "group", icon: Target, label: "Grupo", detail: effectiveGroup || "elite · desenvolvimento" }, { key: "athlete", icon: UserRound, label: "Atleta específico", detail: selectedAthlete?.name ?? "roster real" }] as Array<{ key: "team" | "group" | "athlete"; icon: typeof Users; label: string; detail: string }>).map(({ key, icon: Icon, label, detail }) => <label key={key}><input type="radio" name="ai-target" checked={target === key} onChange={() => setTarget(key)} /><span><Icon size={18} /><b>{label}</b><small>{detail}</small></span></label>)}</div>
        {target === "group" && <div className="form-grid"><label className="wide"><span>Grupo do roster</span><select value={effectiveGroup} onChange={(event) => setGroup(event.target.value)}>{groupOptions.length ? groupOptions.map((item) => <option key={item}>{item}</option>) : <option>Sem grupos sincronizados</option>}</select></label></div>}
        {target === "athlete" && <div className="form-grid"><label className="wide"><span>Atleta</span><select value={selectedAthlete?.id ?? ""} onChange={(event) => setAthleteId(event.target.value)}>{activeRoster.length ? activeRoster.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name} · {athlete.group}{athlete.readiness == null ? "" : ` · readiness ${athlete.readiness}`}</option>) : <option>Nenhum atleta sincronizado</option>}</select></label></div>}
      </div>
      <div className="form-grid">
        <label><span>Data da sessão</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>Volume-alvo (m){suggestedVolume > 0 ? ` · sugestão ${formatNumber(suggestedVolume)} m` : ""}</span><input type="number" min={0} step={100} value={volume} onChange={(event) => setVolume(event.target.value)} placeholder={suggestedVolume ? String(suggestedVolume) : "5200"} /></label>
        <label><span>Zona principal</span><select value={zone} onChange={(event) => setZone(event.target.value)}>{ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <label><span>Fase</span><input value={phase} onChange={(event) => setPhase(event.target.value)} placeholder="Ex.: preparação geral" /></label>
        <label className="wide"><span>Objetivo da sessão</span><input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Ex.: ritmo de prova para 200 m livre com adaptação por prontidão" /></label>
      </div>
      <div className="override-callout"><Sparkles size={19} /><div><b>Adaptação automática por atleta</b><p>O engine cruza readiness, carga aguda/crônica e zona principal. Cada sugestão mostra a adaptação aplicada e continua sob sua decisão final.</p></div></div>
    </div>}
    {step === 2 && result && <div className="ai-suggestion-list">
      {result.status === "REVISAR" && <div className="ai-review-banner" role="alert"><AlertTriangle size={18} /><div><b>Sugestões marcadas para revisão</b><p>{result.warnings.join(" ") || "Revise volumes, zonas e intensidades antes de publicar."}</p></div></div>}
      {result.warnings.length > 0 && result.status !== "REVISAR" && <div className="ai-review-banner info" role="status"><AlertTriangle size={16} /><div><p>{result.warnings.join(" ")}</p></div></div>}
      {result.suggestions.map((suggestion) => <AiSuggestionCard key={`${suggestion.athleteId}-${suggestion.workout.title}`} suggestion={suggestion} targetLabel={targetLabel} publishing={publishingId === suggestion.athleteId} published={published.includes(suggestion.athleteId)} onPublish={() => void publishSuggestion(suggestion)} onUseComposer={() => openComposer(suggestion)} />)}
      {result.suggestions.length === 0 && <div className="empty-state"><Bot size={27} /><strong>Nenhuma sugestão retornada</strong><p>Ajuste o alvo, o volume ou a zona e gere novamente.</p></div>}
    </div>}
    {error && <p className="composer-error" role="alert">{error}</p>}
    <footer className="modal-footer">
      <button className="secondary-button" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? "Cancelar" : "Ajustar parâmetros"}</button>
      {step === 1 ? <button className="primary-button" disabled={loading || (target === "athlete" && !selectedAthlete) || (target === "group" && !effectiveGroup)} onClick={() => void generate()}>{loading ? <><RefreshCw className="spin" size={16} />Gerando…</> : <><Sparkles size={16} />Gerar sugestões</>}</button> : <button className="primary-button" onClick={onClose}><CircleCheck size={16} />Concluir</button>}
    </footer>
  </ModalShell>;
}

function AiSuggestionCard({ suggestion, targetLabel, publishing, published, onUseComposer, onPublish }: {
  suggestion: AiSuggestion; targetLabel: string; publishing: boolean; published: boolean;
  onUseComposer: () => void; onPublish: () => void;
}) {
  const zoneEntries = [{ code: "TEC", meters: suggestion.engine.zoneAllocation.tec }, ...Object.entries(suggestion.engine.zoneAllocation.zones).map(([code, meters]) => ({ code, meters }))].filter((entry) => entry.meters > 0);
  const total = zoneEntries.reduce((sum, entry) => sum + entry.meters, 0) || 1;
  return <article className="ai-suggestion">
    <div className="ai-suggestion-head">
      <span className="option-icon aqua"><Waves size={18} /></span>
      <div><b>{suggestion.workout.title}</b><small>{formatNumber(suggestion.engine.totalVolumeM)} m · {suggestion.workout.blocks.length} blocos · {targetLabel}</small></div>
      <div className="ai-suggestion-meta"><span className={`zone-tag ${suggestion.engine.primaryZone.toLowerCase()}`}>{suggestion.engine.primaryZone}</span>{suggestion.llmUsed && <span className="ai-badge"><Bot size={12} />IA</span>}</div>
    </div>
    <div className="ai-athlete-line"><b>{suggestion.athleteName}</b><small>{suggestion.readiness == null ? "Readiness indisponível" : `Readiness ${suggestion.readiness}/100`}{suggestion.adaptation ? ` · ${suggestion.adaptation.class.replaceAll("_", " ").toLowerCase()} · ×${suggestion.adaptation.volumeFactor.toFixed(2).replace(".", ",")} → ${formatNumber(suggestion.adaptation.adaptedVolumeM)} m` : " · sem adaptação"}</small><em>{suggestion.workout.objective}</em></div>
    <div className="ai-zone-block"><div className="ai-zone-bars">{zoneEntries.map((entry) => <span key={entry.code} style={{ width: `${(entry.meters / total) * 100}%`, background: zoneColor(entry.code) }} title={`${entry.code}: ${Math.round(entry.meters / total * 100)}%`} />)}</div><div className="ai-zone-legend">{zoneEntries.map((entry) => <span key={entry.code}><i style={{ background: zoneColor(entry.code) }} />{entry.code} {Math.round(entry.meters / total * 100)}% · {formatNumber(entry.meters)} m</span>)}</div></div>
    <div className="ai-block-list">{suggestion.workout.blocks.map((block, index) => <div className="workout-block" key={block.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{block.name} ×{block.repeatCount}</b>{block.steps.map((step) => <p key={step.id}>{stepLine(step)}</p>)}</div></div>)}</div>
    {suggestion.engine.rationale.length > 0 && <ul className="ai-rationale">{suggestion.engine.rationale.map((line) => <li key={line}>{line}</li>)}</ul>}
    {suggestion.narrative && <p className="ai-narrative">{suggestion.narrative}</p>}
    <div className="ai-suggestion-actions"><button className="secondary-button" onClick={onUseComposer}>Abrir no compositor <ArrowRight size={15} /></button><button className="primary-button" disabled={publishing || published} onClick={onPublish}><Send size={15} />{published ? <><CircleCheck size={15} />Publicado</> : publishing ? "Publicando…" : "Publicar direto"}</button></div>
  </article>;
}
