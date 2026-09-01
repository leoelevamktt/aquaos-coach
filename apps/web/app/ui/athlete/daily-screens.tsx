"use client";

import { useState } from "react";
import { CheckCircle2, ChevronRight, Gauge, Mic, Plus, Target, Waves } from "lucide-react";
import { AthleteButton, Field, Rating } from "./components";
import type { AthleteAppData, AthleteScreen, AthleteSession } from "./types";

const feelingsList = ["Sono bom", "Sono ruim", "Corpo leve", "Corpo pesado", "Motivada", "Cansada", "Sem dor", "Dor muscular"];

const meters = new Intl.NumberFormat("pt-BR");
const dayFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

function formatMeters(value: number) {
  return `${meters.format(Math.round(value))} m`;
}

function parseTime(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^(?:\d+:)?\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const parts = normalized.split(":").map(Number);
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function stepSummary(step: AthleteSession["blocks"][number]["steps"][number]) {
  const effort = step.distanceMeters ? `${step.repetitions}×${step.distanceMeters} m` : `${step.repetitions}×${Math.round((step.durationSeconds ?? 0) / 60)} min`;
  return [effort, step.stroke, step.target, step.interval ? `int. ${step.interval}` : undefined].filter(Boolean).join(" · ");
}

export function AthleteHome({ data, go }: { data: AthleteAppData; go: (screen: AthleteScreen) => void }) {
  const session = data.today.session;
  const date = dayFormatter.format(new Date(`${data.date}T12:00:00Z`));
  const primaryAction = data.today.status === "check-in-pending"
    ? { screen: "checkin" as const, label: "Fazer check-in diário" }
    : data.today.status === "completed"
      ? { screen: "week" as const, label: "Revisar minha semana" }
      : session
        ? { screen: "session" as const, label: "Ver sessão completa" }
        : { screen: "week" as const, label: "Ver planejamento semanal" };
  return <>
    <section className="athlete-home-title">
      <div><h1>{date}</h1><p>Semana {data.phase.currentWeek} de {data.phase.totalWeeks} · {data.phase.name}</p></div>
      <span>PSR <b>{data.readiness.psr ?? "—"}/10</b></span>
    </section>
    {session ? <button className="athlete-session-hero" onClick={() => go("session")}>
      <small>{data.today.status === "completed" ? "Sessão concluída" : "Sessão prescrita"}</small>
      <strong>{session.title}</strong>
      <span>{formatMeters(session.volumeMeters)} · {session.zone} · PSE alvo {session.expectedPse}</span>
      <ChevronRight size={24} />
    </button> : <section className="athlete-empty-card"><Waves size={24} /><b>Sem sessão prescrita</b><p>A comissão técnica ainda não publicou o treino de hoje.</p></section>}
    <section className="athlete-summary-card">
      <h2>Resumo do dia</h2>
      <p><Target size={16}/>Volume planejado <b>{session ? formatMeters(session.volumeMeters) : "—"}</b></p>
      <p><Waves size={16}/>Intensidade alvo <b>{session?.zone ?? "—"}</b></p>
      <p><Gauge size={16}/>Prontidão <b>{data.readiness.score ? `${data.readiness.score}%` : "Pendente"}</b></p>
    </section>
    {data.today.status === "completed" ? <section className="athlete-complete-card"><CheckCircle2 size={22}/><div><b>Treino registrado</b><p>Os resultados e a carga já estão na sua semana.</p></div></section> : null}
    <AthleteButton onClick={() => go(primaryAction.screen)}>{primaryAction.label}</AthleteButton>
    {session && data.today.status !== "completed" ? <AthleteButton secondary onClick={() => go("results")}>Registrar tempos/resultados</AthleteButton> : null}
  </>;
}

export function CheckInScreen({
  data,
  firstName,
  feedback,
  saving,
  voice,
  onSave,
}: {
  data: AthleteAppData;
  firstName: string;
  feedback: string;
  saving: boolean;
  voice: (target: (value: string) => void) => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [psr, setPsr] = useState(data.checkIn?.psr ?? 8);
  const [sleepHours, setSleepHours] = useState(String(data.checkIn?.sleepHours ?? 8));
  const [fatigue, setFatigue] = useState(data.checkIn?.fatigue ?? 2);
  const [pain, setPain] = useState(data.checkIn?.pain ?? 0);
  const [feelings, setFeelings] = useState<string[]>(data.checkIn?.feelings ?? []);
  const [notes, setNotes] = useState(data.checkIn?.notes ?? "");
  const toggle = (value: string) => setFeelings((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  return <form className="athlete-form checkin-form" onSubmit={(event) => {
    event.preventDefault();
    onSave({ date: data.date, psr, sleepHours: Number(sleepHours), fatigue, soreness: pain, pain, feelings, notes });
  }}>
    <div className="athlete-form-intro"><span>Check-in diário</span><h1>Bom dia, {firstName}!</h1><p>Leva menos de um minuto e ajuda a ajustar seu treino.</p></div>
    <section><b>PSR · Recuperação percebida</b><Rating value={psr} onChange={setPsr} label="Recuperação percebida" /><div className="rating-legend"><span>Muito ruim</span><span>Excelente</span></div></section>
    <Field label="Horas de sono"><div className="unit-field"><input required inputMode="decimal" value={sleepHours} onChange={(event) => setSleepHours(event.target.value)} /><span>h</span></div></Field>
    <section><b>Fadiga percebida</b><Rating value={fatigue} onChange={setFatigue} values={[0, 2, 4, 6, 8, 10]} label="Fadiga percebida" /></section>
    <section><b>Dor muscular ou articular</b><Rating value={pain} onChange={setPain} values={[0, 2, 4, 6, 8, 10]} label="Nível de dor" /></section>
    <section><b>Como você se sente? <small>(opcional)</small></b><div className="feeling-chips">{feelingsList.map((item) => <button type="button" aria-pressed={feelings.includes(item)} className={feelings.includes(item) ? "active" : ""} key={item} onClick={() => toggle(item)}>{item}</button>)}</div></section>
    <AthleteButton secondary onClick={() => voice(setNotes)}><Mic size={18} />Falar por voz</AthleteButton>
    <Field label="Observações (opcional)"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Escreva ou fale sobre como você se sente..." /><small>{notes.length}/500</small></Field>
    {feedback ? <p className="athlete-feedback" role="alert">{feedback}</p> : null}
    <AthleteButton type="submit" disabled={saving}>{saving ? "Salvando..." : data.checkIn ? "Atualizar check-in" : "Iniciar meu dia"}</AthleteButton>
  </form>;
}

export function AthleteSessionView({
  data,
  go,
  voice,
  feedback,
}: {
  data: AthleteAppData;
  go: (screen: AthleteScreen) => void;
  voice: (target: (value: string) => void) => void;
  feedback: string;
}) {
  const [transcript, setTranscript] = useState("");
  const session = data.today.session;
  if (!session) return <section className="athlete-empty-card large"><Waves size={25}/><h1>Sem sessão publicada</h1><p>Volte mais tarde ou fale com sua comissão técnica.</p><AthleteButton onClick={() => go("home")}>Voltar ao início</AthleteButton></section>;
  return <>
    <section className="session-title"><span>Treino de hoje</span><h1>{session.title}</h1><p>{formatMeters(session.volumeMeters)} · {session.zone} · PSE alvo {session.expectedPse}</p><small>{session.objective}</small></section>
    <div className="session-block-list">{session.blocks.map((block, index) => <article className={block.steps.some((step) => step.kind === "main") ? "featured" : ""} key={block.id}>
      <span className={block.steps.some((step) => step.kind === "main") ? "yellow" : "blue"}>{String(index + 1).padStart(2, "0")}</span>
      <div><b>{block.title}{block.repeatCount > 1 ? ` · ${block.repeatCount}×` : ""}</b>{block.steps.map((step) => <p key={step.id}>{stepSummary(step)}{step.equipment.length ? ` · ${step.equipment.join(", ")}` : ""}{step.notes ? <small>{step.notes}</small> : null}</p>)}{block.repeatCount > 1 ? <small>Repetir o bloco {block.repeatCount}×</small> : null}</div>
      <strong>{formatMeters(block.volumeMeters)}</strong>
    </article>)}</div>
    {transcript ? <div className="voice-review"><b>Revise antes de salvar</b><p>{transcript}</p><button type="button" onClick={() => setTranscript("")}>Descartar</button></div> : null}
    {feedback ? <p className="athlete-feedback" role="alert">{feedback}</p> : null}
    <AthleteButton secondary onClick={() => voice(setTranscript)}><Mic size={18}/>Ditado de apoio</AthleteButton>
    <AthleteButton onClick={() => go("results")}>Registrar resultados</AthleteButton>
    <AthleteButton secondary onClick={() => go("checkout")}>Finalizar sessão</AthleteButton>
  </>;
}

export function ResultsForm({
  session,
  feedback,
  saving,
  voice,
  onSave,
}: {
  session: AthleteSession;
  feedback: string;
  saving: boolean;
  voice: (target: (value: string) => void) => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const mainBlock = session.blocks.find((block) => block.steps.some((step) => step.kind === "main")) ?? session.blocks[0];
  const mainStep = mainBlock?.steps.find((step) => step.kind === "main") ?? mainBlock?.steps[0];
  const mainRepeat = Math.max(1, mainBlock?.repeatCount ?? 1);
  const totalRepetitions = (mainStep?.repetitions ?? 1) * mainRepeat;
  const initialCount = Math.min(24, Math.max(1, totalRepetitions));
  const [mode, setMode] = useState<"detailed" | "summary">("detailed");
  const [times, setTimes] = useState(() => Array.from({ length: initialCount }, () => ""));
  const [average, setAverage] = useState("");
  const [best, setBest] = useState("");
  const [last, setLast] = useState("");
  const [pse, setPse] = useState(session.expectedPse);
  const [notes, setNotes] = useState("");
  const [validation, setValidation] = useState("");
  const distanceM = mainStep?.distanceMeters ?? Math.max(25, Math.round(mainBlock.volumeMeters / totalRepetitions));
  const protocol = `${mainStep?.repetitions ?? initialCount}${mainRepeat > 1 ? `×${mainRepeat}` : ""}×${distanceM} ${session.zone}`;
  const submit = () => {
    const source = mode === "detailed" ? times : [best, average, last];
    const parsedTimes = source.map(parseTime);
    if (parsedTimes.some((value) => !value)) {
      setValidation("Use tempos como 1:08.45 ou 68.45 em todos os campos.");
      return;
    }
    setValidation("");
    onSave({
      prescriptionId: session.prescriptionId,
      sessionId: session.id,
      event: `${distanceM} m Livre`,
      poolLengthM: session.poolLengthM === 25 ? 25 : 50,
      sessionDistanceM: session.volumeMeters,
      durationMinutes: Math.max(1, Math.round(session.volumeMeters / 60)),
      pse,
      expectedPse: session.expectedPse,
      protocol,
      notes,
      sets: [{
        set: 1,
        label: protocol,
        zone: session.zone,
        repetitions: parsedTimes.map((timeSeconds, index) => ({
          repetition: index + 1,
          distanceM,
          timeSeconds,
          stroke: mainStep?.stroke ?? "livre",
          note: mode === "summary" ? ["Melhor", "Média", "Última"][index] : undefined,
          splits: [],
        })),
      }],
    });
  };
  return <form className="athlete-form results-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <div className="athlete-form-intro"><span>{mainBlock?.title ?? "Série principal"}</span><h1>Registrar resultados</h1><p>{protocol} · informe somente os tempos medidos.</p></div>
    <div className="segmented result-mode"><button type="button" className={mode === "detailed" ? "active" : ""} onClick={() => setMode("detailed")}>Por repetição</button><button type="button" className={mode === "summary" ? "active" : ""} onClick={() => setMode("summary")}>Resumo rápido</button></div>
    {mode === "detailed" ? <div className="repetition-grid">{times.map((time, index) => <label key={index}><span>Rep. {index + 1}</span><input required inputMode="decimal" value={time} onChange={(event) => setTimes((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="1:08.45" /></label>)}<button type="button" className="add-repetition" onClick={() => setTimes((current) => [...current, ""])}><Plus size={15}/>Adicionar repetição</button></div> : <div className="result-rows"><label><span>Melhor</span><input required value={best} onChange={(event) => setBest(event.target.value)} placeholder="1:06.80" /></label><label><span>Média</span><input required value={average} onChange={(event) => setAverage(event.target.value)} placeholder="1:08.45" /></label><label><span>Última</span><input required value={last} onChange={(event) => setLast(event.target.value)} placeholder="1:09.10" /></label></div>}
    <section><b>PSE da série</b><Rating value={pse} onChange={setPse} values={[2, 4, 6, 7, 8, 9, 10]} label="PSE da série" /></section>
    <AthleteButton secondary onClick={() => voice(setNotes)}><Mic size={18}/>Ditado para observações</AthleteButton>
    <Field label="Observações"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Ex.: aumentei duas braçadas nos últimos 50 m."/><small>{notes.length}/500</small></Field>
    {validation || feedback ? <p className="athlete-feedback" role="alert">{validation || feedback}</p> : null}
    <AthleteButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar resultados"}</AthleteButton>
  </form>;
}

export function CheckoutForm({
  session,
  feedback,
  saving,
  voice,
  onSave,
}: {
  session: AthleteSession;
  feedback: string;
  saving: boolean;
  voice: (target: (value: string) => void) => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [pse, setPse] = useState(session.expectedPse);
  const [volume, setVolume] = useState(String(session.volumeMeters));
  const [duration, setDuration] = useState(String(Math.max(30, Math.round(session.volumeMeters / 60))));
  const [pain, setPain] = useState(0);
  const [notes, setNotes] = useState("");
  return <form className="athlete-form checkout-form" onSubmit={(event) => {
    event.preventDefault();
    onSave({
      date: session.date,
      prescriptionId: session.prescriptionId,
      sessionId: session.id,
      distanceMeters: Number(volume),
      durationMinutes: Number(duration),
      pse,
      pain,
      completedSteps: session.blocks.reduce((sum, block) => sum + block.steps.length, 0),
      totalSteps: session.blocks.reduce((sum, block) => sum + block.steps.length, 0),
      notes,
    });
  }}>
    <div className="athlete-form-intro"><span>{session.title}</span><h1>Fim do treino</h1><p>Confirme o que foi realizado para atualizar sua carga.</p></div>
    <section><b>PSE final</b><Rating value={pse} onChange={setPse} label="PSE final" /><div className="rating-legend"><span>Muito leve</span><span>Muito difícil</span></div></section>
    <div className="athlete-form-grid"><Field label="Volume realizado"><div className="unit-field"><input required type="number" min="1" value={volume} onChange={(event) => setVolume(event.target.value)}/><span>m</span></div></Field><Field label="Duração"><div className="unit-field"><input required type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)}/><span>min</span></div></Field></div>
    <section><b>Nível de dor</b><Rating value={pain} onChange={setPain} values={[0, 2, 4, 6, 8, 10]} label="Nível de dor após treino" /></section>
    <AthleteButton secondary onClick={() => voice(setNotes)}><Mic size={18}/>Ditado para observações</AthleteButton>
    <Field label="Observações do treino"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Como terminou o treino?"/><small>{notes.length}/500</small></Field>
    {feedback ? <p className="athlete-feedback" role="alert">{feedback}</p> : null}
    <AthleteButton type="submit" disabled={saving}>{saving ? "Concluindo..." : "Concluir treino"}</AthleteButton>
  </form>;
}
