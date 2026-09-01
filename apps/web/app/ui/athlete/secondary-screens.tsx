"use client";

import { useState, type ComponentType } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Gauge,
  HelpCircle,
  History,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Target,
  Trophy,
  Waves,
} from "lucide-react";
import { AthleteButton, AthleteState, Field } from "./components";
import type { AthleteAppData, AthleteScreen } from "./types";

const number = new Intl.NumberFormat("pt-BR");
const shortDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short" });

function formatMeters(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${number.format(value)} m`;
}

function dateLabel(value?: string) {
  return value ? shortDate.format(new Date(`${value}T12:00:00Z`)).replace(".", "") : "Data a definir";
}

export function WeekView({ data, go }: { data: AthleteAppData; go: (screen: AthleteScreen) => void }) {
  const adherence = data.week.plannedMeters ? Math.min(100, Math.round(data.week.completedMeters / data.week.plannedMeters * 100)) : 0;
  return <>
    <section className="athlete-home-title"><div><h1>Semana {data.phase.currentWeek} de {data.phase.totalWeeks}</h1><p>{dateLabel(data.week.startsOn)} a {dateLabel(data.week.endsOn)} · {adherence}% realizado</p></div></section>
    <div className="week-stat-grid">
      <article><span>Planejado</span><b>{formatMeters(data.week.plannedMeters)}</b></article>
      <article><span>Realizado</span><b>{formatMeters(data.week.completedMeters)}</b></article>
      <article><span>Sessões</span><b>{data.week.completedSessions}<small> / {data.week.plannedSessions}</small></b></article>
      <article><span>Carga interna</span><b>{number.format(data.week.load)}<small> UA</small></b></article>
    </div>
    <div className="week-progress" aria-label={`${adherence}% do volume semanal realizado`}><i style={{ width: `${adherence}%` }} /></div>
    <section className="next-sessions"><h2>Sessões da semana</h2>{data.week.sessions.length ? data.week.sessions.map((session) => <button type="button" onClick={() => go("session")} key={session.id}><span>{dateLabel(session.date)}</span><b>{session.title ?? session.zone}</b><strong>{session.completed ? "Concluída" : formatMeters(session.volumeMeters)}</strong></button>) : <AthleteState title="Semana sem sessões publicadas" description="As sessões aparecerão aqui quando forem liberadas." />}</section>
    <AthleteButton secondary onClick={() => go("phase")}>Ver fase completa</AthleteButton>
  </>;
}

export function PhaseView({ data }: { data: AthleteAppData }) {
  const progress = Math.min(100, Math.round(data.phase.currentWeek / data.phase.totalWeeks * 100));
  const remainingWeeks = Math.max(0, data.phase.totalWeeks - data.phase.currentWeek);
  return <>
    <section className="phase-hero">
      <span>Fase atual</span>
      <h1>{data.phase.name}</h1>
      <p>{data.phase.objective}</p>
      <div><i style={{ width: `${progress}%` }} /></div>
      <small>Semana {data.phase.currentWeek} de {data.phase.totalWeeks}</small>
    </section>
    <div className="phase-metrics">
      <article><CalendarDays size={19}/><span>Período</span><b>{dateLabel(data.phase.startsOn)} – {dateLabel(data.phase.endsOn)}</b></article>
      <article><Target size={19}/><span>Competição-alvo</span><b>{data.phase.targetMeet ?? "A definir"}</b></article>
      <article><Waves size={19}/><span>Volume da semana</span><b>{formatMeters(data.week.plannedMeters)}</b></article>
      <article><Gauge size={19}/><span>Semanas restantes</span><b>{remainingWeeks}</b></article>
    </div>
    <section className="phase-timeline"><h2>Seu caminho</h2>{Array.from({ length: Math.min(data.phase.totalWeeks, 8) }, (_, index) => {
      const week = index + Math.max(1, data.phase.currentWeek - 2);
      if (week > data.phase.totalWeeks) return null;
      return <div className={week === data.phase.currentWeek ? "active" : week < data.phase.currentWeek ? "completed" : ""} key={week}><i>{week < data.phase.currentWeek ? <Check size={12}/> : week}</i><span><b>Semana {week}</b><small>{week === data.phase.currentWeek ? "Você está aqui" : week < data.phase.currentWeek ? "Concluída" : "Planejada"}</small></span></div>;
    })}</section>
  </>;
}

export function Competitions({
  data,
  onResult,
}: {
  data: AthleteAppData;
  onResult: (meetId: string) => void;
}) {
  return <>
    <section className="athlete-home-title"><div><h1>Competições</h1><p>Calendário do seu macrociclo</p></div></section>
    {data.competitions.length ? <div className="athlete-meet-list">{data.competitions.map((meet) => <article key={meet.id}><header><div><b>{meet.name ?? "Competição"}</b><span>{dateLabel(meet.startsOn)}{meet.endsOn && meet.endsOn !== meet.startsOn ? ` a ${dateLabel(meet.endsOn)}` : ""} · {meet.pool ?? "Piscina"}</span></div><em className={meet.target ? "target" : ""}>{meet.target ? "ALVO" : meet.priority ?? "CALENDÁRIO"}</em></header><AthleteButton secondary onClick={() => onResult(meet.id)}>Inserir resultado</AthleteButton></article>)}</div> : <AthleteState icon={Trophy} title="Nenhuma competição vinculada" description="A comissão técnica ainda não adicionou competições ao seu macrociclo." />}
    <p className="athlete-context-note">O calendário é gerenciado pela comissão técnica. Você pode registrar seus resultados após cada prova.</p>
  </>;
}

function seconds(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":").map(Number);
  const result = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

export function CompetitionResult({
  meet,
  feedback,
  saving,
  onSave,
}: {
  meet: AthleteAppData["competitions"][number] | undefined;
  feedback: string;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [event, setEvent] = useState("400 Livre");
  const [time, setTime] = useState("");
  const [raceDate, setRaceDate] = useState(meet?.startsOn ?? "");
  const [placement, setPlacement] = useState("");
  const [markKind, setMarkKind] = useState("Oficial");
  const [notes, setNotes] = useState("");
  const [validation, setValidation] = useState("");
  const distanceM = Math.max(25, Number(event.match(/\d+/)?.[0] ?? 100));
  const meetEndsOn = meet?.endsOn ?? meet?.startsOn;
  return <form className="athlete-form competition-form" onSubmit={(formEvent) => {
    formEvent.preventDefault();
    const timeSeconds = seconds(time);
    if (!timeSeconds) {
      setValidation("Informe o tempo como 3:51.20 ou 231.20.");
      return;
    }
    if (
      !raceDate
      || (meet?.startsOn && raceDate < meet.startsOn)
      || (meetEndsOn && raceDate > meetEndsOn)
    ) {
      setValidation("Informe uma data dentro do período da competição.");
      return;
    }
    setValidation("");
    onSave({
      meetId: meet?.id,
      kind: "competition",
      date: raceDate,
      event,
      poolLengthM: meet?.pool?.includes("25") ? 25 : 50,
      sessionDistanceM: distanceM,
      durationMinutes: Math.max(1, timeSeconds / 60),
      pse: 8,
      protocol: "Resultado oficial",
      placement,
      markKind,
      notes,
      sets: [{ set: 1, label: "Resultado oficial", repetitions: [{ repetition: 1, distanceM, timeSeconds, stroke: "livre", splits: [] }] }],
    });
  }}>
    <div className="athlete-form-intro"><span>{meet ? dateLabel(meet.startsOn) : "Competição"}</span><h1>Resultado da competição</h1><p>{meet?.name ?? "Selecione uma competição na tela anterior."}</p></div>
    <Field label="Prova"><select value={event} onChange={(eventInput) => setEvent(eventInput.target.value)}><option>400 Livre</option><option>200 Livre</option><option>100 Livre</option><option>50 Livre</option></select></Field>
    <Field label="Data da prova"><input required type="date" min={meet?.startsOn} max={meet?.endsOn ?? meet?.startsOn} value={raceDate} onChange={(eventInput) => setRaceDate(eventInput.target.value)} /></Field>
    <Field label="Tempo"><input required inputMode="decimal" value={time} onChange={(eventInput) => setTime(eventInput.target.value)} placeholder="3:51.20" /></Field>
    <Field label="Colocação"><input value={placement} onChange={(eventInput) => setPlacement(eventInput.target.value)} placeholder="Ex.: 2º" /></Field>
    <Field label="Tipo de marca"><select value={markKind} onChange={(eventInput) => setMarkKind(eventInput.target.value)}><option>Oficial</option><option>PB</option><option>SB</option></select></Field>
    <Field label="Parciais / observações"><textarea value={notes} onChange={(eventInput) => setNotes(eventInput.target.value)} maxLength={500} placeholder="100 56.8 / 200 1:55.2 / 300 2:54.9..." /></Field>
    {validation || feedback ? <p className="athlete-feedback" role="alert">{validation || feedback}</p> : null}
    <AthleteButton type="submit" disabled={saving || !meet}>{saving ? "Salvando..." : "Salvar resultado"}</AthleteButton>
  </form>;
}

const items: Array<{ key: string; label: string; icon: ComponentType<{ size?: number }> }> = [
  { key: "profile", label: "Perfil do atleta", icon: CircleUserRound },
  { key: "availability", label: "Disponibilidade semanal", icon: CalendarDays },
  { key: "history", label: "Histórico de treinos", icon: History },
  { key: "load", label: "Controle de carga", icon: Gauge },
  { key: "competitions", label: "Competições do macrociclo", icon: Trophy },
  { key: "terms", label: "Termos e saúde", icon: ShieldCheck },
  { key: "settings", label: "Configurações", icon: Settings },
  { key: "support", label: "Ajuda e suporte", icon: HelpCircle },
];

export function MoreView({
  data,
  go,
  onSignOut,
}: {
  data: AthleteAppData;
  go: (screen: AthleteScreen) => void;
  onSignOut: () => void;
}) {
  const [selected, setSelected] = useState("");
  const open = (key: string) => key === "competitions" ? go("competitions") : setSelected((current) => current === key ? "" : key);
  const profile = data.athlete;
  return <>
    <section className="athlete-home-title"><div><h1>Mais</h1><p>Seus dados e preferências</p></div></section>
    <div className="athlete-more-list">{items.map(({ key, label, icon: Icon }) => <button type="button" aria-expanded={selected === key} key={key} onClick={() => open(key)}><Icon size={19}/><span>{label}</span><ChevronRight size={18}/></button>)}</div>
    {selected === "profile" ? <section className="athlete-more-detail"><b>{profile.name}</b><p>{[profile.category, profile.club, profile.level].filter(Boolean).join(" · ") || "Perfil esportivo em atualização."}</p><dl><div><dt>Prova principal</dt><dd>{profile.primaryEvent ?? "A definir"}</dd></div><div><dt>Objetivo</dt><dd>{profile.objective ?? "A definir"}</dd></div></dl></section> : null}
    {selected === "availability" ? <section className="athlete-more-detail"><b>{profile.availability?.sessionsPerWeek ?? "—"} sessões por semana</b><p>{profile.availability?.days?.join(" · ") || "Dias não informados"}<br/>{profile.availability?.periods?.join(" · ") || "Períodos não informados"}</p></section> : null}
    {selected === "history" ? <section className="athlete-more-detail"><b>Treinos recentes</b><p>{data.recentWorkouts.length ? `${data.recentWorkouts.length} execuções registradas recentemente.` : "Nenhuma execução registrada ainda."}</p><button type="button" onClick={() => go("week")}>Abrir semana</button></section> : null}
    {selected === "load" ? <section className="athlete-more-detail"><b>Carga da semana</b><p>{data.week.load} UA · {formatMeters(data.week.completedMeters)} realizados.</p><button type="button" onClick={() => go("week")}>Ver detalhes</button></section> : null}
    {selected === "terms" ? <section className="athlete-more-detail"><b>Termos e saúde</b><p>{profile.onboardingStatus === "completed" ? "Termos aceitos no onboarding." : "Complete o onboarding para registrar seus consentimentos."}</p></section> : null}
    {selected === "settings" ? <section className="athlete-more-detail"><b>Configurações</b><p>Idioma: Português · Fuso horário: Brasília · Unidades: metros.</p></section> : null}
    {selected === "support" ? <section className="athlete-more-detail"><b>Ajuda e suporte</b><p>Para ajustes no treino ou prontuário, fale com sua comissão técnica.</p></section> : null}
    <button type="button" className="athlete-signout" onClick={onSignOut}><LockKeyhole size={17}/>Sair da conta</button>
  </>;
}
