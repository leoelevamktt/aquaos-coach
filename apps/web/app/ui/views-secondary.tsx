"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Calendar, Check, CircleCheck, Cloud, Database,
  Download, FileText, Film, Gauge, HeartPulse, Lock, MapPin, MoreHorizontal,
  Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Target, Trophy,
  Upload, Users, Video, Watch, Waves,
} from "lucide-react";
import { athletes, connectors, hydrateAthlete, meets, videos, zoneDistribution } from "./demo-data";
import { Avatar, Metric, PageTitle, SectionHead, Skeleton, StatusDot } from "./components";
import type { AppView } from "./views-primary";
import { apiRequest, mediaUrl, subscribeToLiveEvents, uploadFile } from "./api";
import { csvRow, downloadFile } from "./client-utils";

type LiveSeason = { name: string; starts: string; ends: string; week: number; totalWeeks: number; progress: number; phases: Array<{ name: string; focus?: string; start: string; end: string; color: string; progress: number }> };

export function Season({ onMeet, onSettings, onCreateMeet, onNotify, liveVersion = 0 }: { onMeet: (id: string) => void; onSettings: () => void; onCreateMeet: () => void; onNotify: (message: string) => void; liveVersion?: number }) {
  const [liveMeets, setLiveMeets] = useState(meets);
  const [liveSeason, setLiveSeason] = useState<LiveSeason | null>(null);
  const [seasonState, setSeasonState] = useState<"loading" | "ready" | "error">("loading");
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  useEffect(() => {
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/meets")
      .then((response) => setLiveMeets(response.data.map((record, index) => {
        const startsOn = String(record.startsOn ?? "");
        const date = startsOn ? new Date(`${startsOn}T12:00:00`) : new Date();
        return { id: String(record.id ?? `meet-${index}`), name: String(record.name ?? "Competição sem nome"), priority: String(record.priority ?? "B") as "A" | "B" | "C", date: startsOn ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "").toUpperCase() : "A DEFINIR", days: startsOn ? Math.max(0, Math.round((date.getTime() - Date.now()) / 86_400_000)) : 0, location: String(record.location ?? "Local a definir"), pool: String(record.pool ?? "50 m"), qualified: Number(record.qualified ?? 0), entries: Number(record.entries ?? 0) };
      })))
      .catch(() => setLiveMeets(meets));
  }, [liveVersion]);
  useEffect(() => {
    void apiRequest<Briefing>("/api/v1/coach/briefing").then(setBriefing).catch(() => setBriefing(null));
  }, [liveVersion]);
  const loadSeason = useCallback(() => {
    setSeasonState("loading");
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/seasons").then((response) => {
      const active = response.data.find((record) => String(record.status ?? "") === "active") ?? response.data[0];
      if (!active) { setLiveSeason(null); setSeasonState("ready"); return; }
      const startsOn = String(active.startsOn ?? "");
      const endsOn = String(active.endsOn ?? "");
      const start = /^\d{4}-\d{2}-\d{2}$/.test(startsOn) ? new Date(`${startsOn}T12:00:00`) : null;
      const end = /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? new Date(`${endsOn}T12:00:00`) : null;
      const weekMs = 7 * 86_400_000;
      const totalWeeks = start && end && end.getTime() > start.getTime() ? Math.max(1, Math.round((end.getTime() - start.getTime()) / weekMs)) : 0;
      const elapsed = start ? Math.floor((Date.now() - start.getTime()) / weekMs) + 1 : 0;
      setLiveSeason({
        name: String(active.name ?? "Temporada"),
        starts: start ? `${String(start.getDate()).padStart(2, "0")} ${start.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")} ${start.getFullYear()}` : "—",
        ends: end ? `${String(end.getDate()).padStart(2, "0")} ${end.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")} ${end.getFullYear()}` : "—",
        week: start && totalWeeks ? Math.min(totalWeeks, Math.max(1, elapsed)) : 0,
        totalWeeks,
        progress: start && end && end.getTime() > start.getTime() ? Math.min(100, Math.max(0, Math.round(((Date.now() - start.getTime()) / (end.getTime() - start.getTime())) * 100))) : 0,
        phases: Array.isArray(active.phases) ? (active.phases as Array<Record<string, unknown>>).map((phase, index) => {
          const phaseStart = String(phase.startsOn ?? phase.start ?? "");
          const phaseEnd = String(phase.endsOn ?? phase.end ?? "");
          const toShort = (value: string) => { const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : value ? new Date(value) : null; return parsed && !Number.isNaN(parsed.getTime()) ? `${String(parsed.getDate()).padStart(2, "0")} ${parsed.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase()}` : "A DEFINIR"; };
          return { name: String(phase.name ?? `Fase ${index + 1}`), focus: typeof phase.focus === "string" ? phase.focus : undefined, start: phaseStart ? toShort(phaseStart) : "A DEFINIR", end: phaseEnd ? toShort(phaseEnd) : "A DEFINIR", color: String(phase.color ?? "#4e8ed0"), progress: typeof phase.progress === "number" ? Math.min(100, Math.max(0, Math.round(phase.progress))) : 0 };
        }) : [],
      });
      setSeasonState("ready");
    }).catch(() => setSeasonState("error"));
  }, []);
  useEffect(() => { loadSeason(); }, [loadSeason, liveVersion]);
  const principalMeet = [...liveMeets].filter((meet) => meet.days > 0).sort((a, b) => a.days - b.days)[0] ?? liveMeets[0];
  const targetMeet = briefing?.nextMeet ?? (principalMeet ? { name: principalMeet.name, daysUntil: principalMeet.days, pool: principalMeet.pool } : null);
  return <>
    <PageTitle kicker="TEMPORADA" title={seasonState === "ready" && !liveSeason ? "Sem temporada ativa" : liveSeason?.name ?? "Temporada"} subtitle={seasonState === "loading" ? "Carregando temporada…" : seasonState === "error" ? "Não foi possível carregar a temporada ativa." : liveSeason ? `${liveSeason.starts} - ${liveSeason.ends} | semana ${liveSeason.week} de ${liveSeason.totalWeeks}` : "Nenhuma temporada ativa cadastrada."}><button className="secondary-button" onClick={onSettings}><Settings size={17} />Ajustes</button><button className="primary-button" onClick={onCreateMeet}><Plus size={17} />Nova competição</button></PageTitle>
    <section className="card season-overview"><div className="season-progress"><div><span>PROGRESSO DA TEMPORADA</span><strong>{liveSeason ? `${liveSeason.progress}%` : "—"}</strong></div><div className="long-progress"><i style={{ width: `${liveSeason?.progress ?? 0}%` }} /></div><div><small>Início · {liveSeason ? liveSeason.starts : "—"}</small><small>Hoje · {liveSeason ? `semana ${liveSeason.week}` : "sem temporada"}</small><small>Principal · {principalMeet?.date ?? "a definir"}</small><small>Fim · {liveSeason ? liveSeason.ends : "—"}</small></div></div><div className="phase-timeline">{seasonState === "loading" ? <div className="empty-state compact"><Skeleton height={18} /><strong>Carregando fases…</strong></div> : seasonState === "error" ? <div className="empty-state compact"><AlertTriangle size={26} /><strong>Não foi possível carregar a temporada</strong><p>A API de temporadas não respondeu.</p><button className="secondary-button" onClick={() => loadSeason()}>Tentar novamente</button></div> : liveSeason?.phases.length ? liveSeason.phases.map((phase) => <article key={phase.name}><span style={{ background: phase.color }} /><div><em style={{ color: phase.color }}>{phase.focus ?? "FASE"}</em><b>{phase.name}</b><small>{phase.start} - {phase.end}</small></div>{phase.progress > 0 && <i style={{ width: `${phase.progress}%`, background: phase.color }} />}</article>) : <div className="empty-state compact"><Target size={26} /><strong>Temporada sem fases cadastradas</strong><p>Cadastre as fases da temporada para acompanhar a periodização aqui.</p></div>}</div></section>
     <section className="season-columns"><div className="card"><SectionHead title="Próximas competições" subtitle={`${liveMeets.length} eventos no calendário · prioridades, índices e inscrições`} action="Calendário completo" onAction={() => onNotify("Calendário anual exibido com fases e competições.")} /><div className="meet-list">{liveMeets.map((meet) => <button key={meet.id} onClick={() => onMeet(meet.id)}><span className={`meet-priority p${meet.priority.toLowerCase()}`}>{meet.priority}</span><div><b>{meet.name}</b><small><MapPin size={13} />{meet.location} · {meet.pool}</small></div><div><strong>{meet.date}</strong><small>{meet.days ? `em ${meet.days} dias` : "data a definir"}</small></div><div><b>{meet.qualified}</b><small>com índice</small></div><ArrowRight size={16} /></button>)}</div></div><aside className="card readiness-to-meet"><SectionHead title="Prontidão para o alvo" subtitle={targetMeet ? `${targetMeet.name} · ${targetMeet.pool}` : "Sem competição-alvo definida"} />{briefing ? <div className="meet-readiness-score"><strong>{briefing.metrics.averageReadiness != null ? Math.round(briefing.metrics.averageReadiness) : "—"}</strong><span>Readiness médio do elenco</span><em>{briefing.metrics.readyAthletes} prontos · {briefing.metrics.attentionAthletes} em atenção{targetMeet ? ` · alvo em ${targetMeet.daysUntil} dias` : ""}</em></div> : <div className="empty-state compact"><AlertTriangle size={26} /><strong>Prontidão indisponível</strong><p>{targetMeet ? `${targetMeet.name} · ${targetMeet.daysUntil} dias · piscina ${targetMeet.pool}.` : "Sem competição-alvo no calendário."} O briefing de readiness não retornou dados.</p></div>}</aside></section>
  </>;
}

type VideoListItem = { id: string; athlete: string; initials: string; color: string; event: string; time: string; date: string; status: string; duration: string; markers: number; progress?: number; real?: boolean; url?: string; thumbnailUrl?: string };

export function Videos({ onVideo, onNotify, liveVersion = 0 }: { onVideo: (id: string) => void; onNotify: (message: string) => void; liveVersion?: number }) {
  const [filter, setFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<VideoListItem[]>(videos);
  const [uploadAthleteId, setUploadAthleteId] = useState(athletes[0]?.id ?? "");
  const [uploadTitle, setUploadTitle] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const loadVideos = async () => {
    try {
      const result = await apiRequest<{ data: Array<Record<string, unknown> & { id: string }> }>("/api/v1/manage/videos");
      const remote = result.data.map((record, index): VideoListItem => ({ id: record.id, athlete: String(record.athlete ?? athletes.find((athlete) => athlete.id === record.athleteId)?.name ?? "Atleta não definido"), initials: String(record.athlete ?? "AN").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), color: ["#7357ef", "#0da98b", "#397ac4", "#e35f65"][index % 4], event: String(record.event ?? record.title ?? "Sessão técnica"), time: typeof record.durationSeconds === "number" ? `${Number(record.durationSeconds).toFixed(2).replace(".", ",")} s` : "Processando", date: typeof record.createdAt === "string" ? new Date(record.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "agora", status: record.analysisStatus === "ready" ? (record.status === "reviewed" ? "done" : "review") : ["pending", "queued", "processing"].includes(String(record.analysisStatus)) ? "processing" : String(record.status ?? "review"), duration: typeof record.durationSeconds === "number" ? `00:${String(Math.round(Number(record.durationSeconds))).padStart(2, "0")}` : "-", markers: Number((record.analysis as { events?: unknown[] } | undefined)?.events?.length ?? 0), progress: Number(record.analysisProgress ?? 0), real: true, url: String(record.url ?? ""), thumbnailUrl: String(record.thumbnailUrl ?? "") }));
      setCatalog(remote);
    } catch { /* mantém catálogo local se a API estiver indisponível */ }
  };
  useEffect(() => { void loadVideos(); }, [liveVersion]);
  useEffect(() => subscribeToLiveEvents((event) => {
    if (event.resource === "videos" || event.resource === "videoAnalysisJobs") void loadVideos();
  }), []);
  const shown = catalog.filter((video) => (filter === "Todos" || (filter === "Para revisar" && video.status === "review") || (filter === "Revisados" && video.status === "done")) && `${video.athlete} ${video.event}`.toLowerCase().includes(query.toLowerCase()));
  const handleUpload = async (file?: File) => {
    if (!file) return;
    try {
      const record = await uploadFile(file, "videos", { athleteId: uploadAthleteId || undefined, title: uploadTitle.trim() || file.name.replace(/\.[^.]+$/, "") });
      onNotify("Vídeo armazenado. A análise de movimento foi iniciada.");
      if (typeof record.id === "string") await apiRequest(`/api/v1/videos/${record.id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setUploadTitle("");
      await loadVideos();
    } catch (error) { onNotify(error instanceof Error ? error.message : "Falha ao enviar vídeo"); }
  };
  return <><PageTitle kicker="ANÁLISE TÉCNICA" title="Vídeos de prova e treino" subtitle="Movimento, ciclos e evidências técnicas sincronizados ao vídeo real."><button className="secondary-button" onClick={() => onNotify("Modo deck aberto: câmera, cronômetro e registro de prova preparados.")}><Video size={17} />Gravar no deck</button><input ref={uploadInput} hidden type="file" accept=".mp4,.mov,.m4v,video/mp4,video/quicktime" onChange={(event) => void handleUpload(event.target.files?.[0])} /><button className="primary-button" onClick={() => uploadInput.current?.click()}><Upload size={17} />Enviar vídeo</button></PageTitle>
     <div className="video-upload-context"><div><span className="eyebrow accent">CONTEXTO DO ENVIO</span><strong>Associe a gravação a um atleta antes de analisar.</strong></div><label><span>Atleta</span><select value={uploadAthleteId} onChange={(event) => setUploadAthleteId(event.target.value)}>{athletes.map((athlete) => <option value={athlete.id} key={athlete.id}>{athlete.name}</option>)}</select></label><label><span>Título opcional</span><input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Ex.: virada submersa · série 3" /></label></div>
     <div className="video-stats"><div><Film size={19} /><span><b>{catalog.length}</b> provas filmadas</span></div><div><Activity size={19} /><span><b>{catalog.filter((item) => item.status === "review" || item.status === "processing").length}</b> aguardando revisão</span></div><div><BarChart3 size={19} /><span><b>{catalog.filter((item) => item.date.toLowerCase().includes("ago") || item.date.toLowerCase() === "agora").length}</b> esta semana</span></div></div>
    <div className="roster-toolbar video-toolbar"><div className="filter-pills">{["Todos", "Para revisar", "Revisados"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="local-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Atleta ou prova" /></div></div>
     <section className="video-grid">{shown.map((video, index) => <article className="card video-card" key={video.id}><button className="video-thumb" onClick={() => onVideo(video.id)}><div className={`pool-frame frame-${index + 1}`}>{video.thumbnailUrl ? <img src={mediaUrl(video.thumbnailUrl)} alt={`Quadro de ${video.event}`} /> : <><span className="lane-line l1" /><span className="lane-line l2" /><span className="lane-line l3" /></>}<i>▶</i><em>{video.duration}</em><span className="real-video-chip">{video.status === "processing" ? `PROCESSANDO ${video.progress ?? 0}%` : video.real ? "ANÁLISE REAL" : "CATÁLOGO"}</span></div></button><div className="video-meta"><div><Avatar initials={video.initials} color={video.color} small /><span><b>{video.athlete}</b><small>{video.date}</small></span><span className={video.status === "review" ? "review-badge" : video.status === "processing" ? "processing-badge" : "done-badge"}>{video.status === "review" ? "Para revisar" : video.status === "processing" ? "Processando" : "Revisado"}</span></div><h3>{video.event} · {video.time}</h3>{video.status === "processing" && <div className="video-progress"><i style={{ width: `${video.progress ?? 0}%` }} /></div>}<div><span><Sparkles size={14} />{video.markers} eventos detectados</span><button onClick={() => onVideo(video.id)}>Abrir análise<ArrowRight size={15} /></button></div></div></article>)}</section></>;
}

type AnalyticsOverview = {
  metrics: { activeAthletes: number; readinessAverage: number | null; sleepAverage: number | null; attendanceAverage: number | null; healthCoverage: number; videoCoverage: number; videosTotal: number; videosPending: number; resultsCount: number; plannedMeters: number; completedMeters: number; adherence: number | null };
  weekly: Array<{ label: string; plannedMeters: number; completedMeters: number; load: number; zones: Record<string, number> }>;
};

/** Converte gaps como "+2.82", "+1:28.50" ou "+4:48" em segundos para ordenação numérica. */
export function gapToSeconds(gap?: string): number | null {
  if (!gap) return null;
  const parts = gap.replace(/[+\s]/g, "").split(":").map((part) => Number.parseFloat(part.replace(",", ".")));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const zoneColorByCode = new Map(zoneDistribution.map((zone) => [zone.code.toUpperCase(), zone.color]));
const zoneFallbackColors = ["#2da7c7", "#174a8c", "#5572c8", "#df6b45", "#c13d4d", "#8f3db5"];
const zoneColor = (code: string, index: number) => zoneColorByCode.get(code.toUpperCase()) ?? zoneFallbackColors[index % zoneFallbackColors.length];

export function Analytics({ onAthlete, onNotify, liveVersion = 0 }: { onAthlete: (id: string) => void; onNotify: (message: string) => void; liveVersion?: number }) {
  const [weeks, setWeeks] = useState(8);
  const [metric, setMetric] = useState<"volume" | "carga">("volume");
  const [descending, setDescending] = useState(true);
  const [classic, setClassic] = useState(false);
  const [roster, setRoster] = useState(athletes);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  useEffect(() => {
    void Promise.all([
      apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/athletes"),
      apiRequest<AnalyticsOverview>(`/api/v1/analytics/overview?weeks=${weeks}`),
    ]).then(([athleteResponse, analyticsResponse]) => {
      setRoster(athleteResponse.data.map(hydrateAthlete));
      setOverview(analyticsResponse);
    }).catch(() => setRoster(athletes));
  }, [liveVersion, weeks]);
  useEffect(() => {
    void apiRequest<Briefing>("/api/v1/coach/briefing").then(setBriefing).catch(() => setBriefing(null));
  }, [liveVersion]);
  const activeRoster = roster.filter((athlete) => athlete.account === "active");
  const attendance = activeRoster.length ? Math.round(activeRoster.reduce((sum, athlete) => sum + athlete.attendance, 0) / activeRoster.length) : 0;
  const metrics = overview?.metrics;
  const chartSeries = overview?.weekly.length ? overview.weekly : [];
  const chartMax = Math.max(...chartSeries.map((item) => metric === "volume" ? item.plannedMeters : item.load), 1);
  const briefingPerAthlete = new Map((briefing?.perAthlete ?? []).map((row) => [row.athleteId, row]));
  const acuteMax = Math.max(1, ...(briefing?.perAthlete ?? []).map((row) => row.acuteLoadUA ?? 0));
  const goalAthletes = [...roster.filter((athlete) => athlete.gap)].sort((a, b) => { const left = gapToSeconds(a.gap); const right = gapToSeconds(b.gap); if (left == null || right == null) return left == null ? 1 : -1; return descending ? right - left : left - right; });
  const exportReport = () => {
    const rows = [csvRow(["Atleta", "Objetivo", "Gap", "Presença", "Readiness"]), ...roster.map((athlete) => csvRow([athlete.name, athlete.goalEvent ?? "Sem meta", athlete.gap ?? "-", `${athlete.attendance}%`, athlete.readiness ?? "Sem dado"]))];
    downloadFile(`analise-programa-${weeks}-semanas.csv`, rows.join("\n"));
    onNotify("Relatório executivo exportado em CSV.");
  };
  return <><PageTitle kicker="INTELIGÊNCIA DO PROGRAMA" title="Análise" subtitle="Do planejamento à prova: uma leitura executiva do elenco."><button className="secondary-button" onClick={() => setWeeks((value) => value === 4 ? 8 : value === 8 ? 12 : 4)}><Calendar size={17} />Últimas {weeks} semanas</button><button className="primary-button" onClick={exportReport}><Download size={17} />Exportar relatório</button></PageTitle>
     <div className="metric-grid"><Metric label="ADERÊNCIA À CARGA" value={metrics?.adherence == null ? "—" : `${metrics.adherence.toFixed(1).replace(".", ",")}%`} detail={metrics ? `${(metrics.completedMeters / 1000).toFixed(1).replace(".", ",")} km realizados na janela` : "Calculando"} icon={Target} /><Metric label="EVOLUÇÃO DE PBS" value={`+${metrics?.resultsCount ?? 0}`} detail="Resultados no prontuário" icon={Trophy} tone="violet" /><Metric label="SAÚDE DO ELENCO" value={metrics?.readinessAverage == null ? "—" : `${Math.round(metrics.readinessAverage)}%`} detail={metrics ? `${activeRoster.filter((athlete) => (athlete.readiness ?? 100) < 65).length} alertas de recuperação` : "Sem dados de corpo"} icon={HeartPulse} tone="blue" /><Metric label="COBERTURA DE DADOS" value={metrics ? `${metrics.healthCoverage}%` : "—"} detail={metrics ? `${metrics.videosTotal} vídeos · ${metrics.videosPending} pendentes` : "Calculando"} icon={Database} tone="orange" /></div>
     <section className={`analytics-grid ${classic ? "classic-view" : ""}`}><article className="card program-volume"><SectionHead title={metric === "volume" ? "Volume do time por zona" : "Carga interna por semana"} subtitle={`Prescrito × realizado · ${weeks} semanas`} action="Trocar métrica" onAction={() => setMetric((value) => value === "volume" ? "carga" : "volume")} />{chartSeries.length ? <><div className="chart-y-labels">{[1, 0.75, 0.5, 0.25, 0].map((share) => <span key={share}>{metric === "volume" ? `${(chartMax * share / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${Math.round(chartMax * share)} u.a.`}</span>)}</div><div className="stacked-chart">{chartSeries.map((item, i) => { const total = metric === "volume" ? item.plannedMeters : item.load; const height = Math.max(8, total / chartMax * 100); const zones = Object.entries(item.zones ?? {}).filter((pair): pair is [string, number] => typeof pair[1] === "number" && pair[1] > 0); const zonesTotal = zones.reduce((sum, [, value]) => sum + value, 0); return <div key={`${item.label}-${i}`} style={{ height: `${height}%` }}>{metric === "volume" && zones.length ? zones.map(([code, value], zoneIndex) => <span key={code} style={{ height: `${value / zonesTotal * 100}%`, background: zoneColor(code, zoneIndex) }} title={`${code} · ${(value / 1000).toFixed(1).replace(".", ",")} km`} />) : <span style={{ height: "100%", background: metric === "volume" ? "#d8e4e5" : "#0c8f7c" }} title={metric === "volume" ? "Sem distribuição de zonas nesta semana" : undefined} />}<small>{item.label}</small></div>; })}</div><div className="zone-legend">{[...new Set(chartSeries.flatMap((item) => Object.entries(item.zones ?? {}).filter((pair): pair is [string, number] => typeof pair[1] === "number" && pair[1] > 0).map(([code]) => code)))].map((code, index) => <span key={code}><i style={{ background: zoneColor(code, index) }} />{code}</span>)}</div></> : <div className="empty-state compact"><BarChart3 size={26} /><strong>Sem série de carga</strong><p>Nenhuma semana com volume registrado na janela selecionada.</p></div>}</article>
      <article className="card goal-map"><SectionHead title="Distância até a meta" subtitle="Cada atleta contra seu próprio objetivo" action={descending ? "Maior gap primeiro" : "Menor gap primeiro"} onAction={() => setDescending((value) => !value)} /><div className="goal-athletes">{goalAthletes.map((athlete, index) => <button key={athlete.id} onClick={() => onAthlete(athlete.id)}><Avatar initials={athlete.initials} color={athlete.color} small /><div><span><b>{athlete.name}</b><small>{athlete.goalEvent}</small></span><div><i style={{ width: `${82 - index * 8}%` }} /><em style={{ left: `${82 - index * 8}%` }} /></div></div><strong>{athlete.gap}</strong></button>)}</div></article>
       <article className="card roster-performance"><SectionHead title="Visão do elenco" subtitle={`${activeRoster.length} atletas ativos · presença média ${attendance}%`} action={classic ? "Visão executiva" : "Visão clássica"} onAction={() => setClassic((value) => !value)} /><div className="performance-head"><span>ATLETA</span><span>GAP</span><span>PRES.</span><span>HABILIDADES</span></div>{roster.map((athlete) => <button key={athlete.id} onClick={() => onAthlete(athlete.id)}><span><Avatar initials={athlete.initials} color={athlete.color} small /><span><b>{athlete.name}</b><small>{athlete.goalEvent ?? "Sem meta"}</small></span></span><strong>{athlete.gap ?? "-"}</strong><strong>{athlete.attendance ? `${athlete.attendance}%` : "—"}</strong><span className="skill-pills">{athlete.skills.length ? athlete.skills.map((skill) => <i key={skill.key} className={skill.score >= 80 ? "high" : skill.score >= 65 ? "mid" : "low"}>{skill.key}</i>) : <small>Sem evidências</small>}</span></button>)}</article>
       <article className="card recovery-map"><SectionHead title="Recuperação do elenco" subtitle={briefing?.perAthlete.length ? "Readiness × carga aguda · briefing do dia" : "Readiness × carga aguda"} /><div className="quadrant"><span className="axis-label y">READINESS</span><span className="axis-label x">CARGA AGUDA</span><div className="quad-label q1">Pronto para carga</div><div className="quad-label q2">Monitorar</div><div className="quad-label q3">Recuperar</div>{roster.map((athlete, index) => { const entry = briefingPerAthlete.get(athlete.id); const readiness = entry?.readiness ?? athlete.readiness; if (typeof readiness !== "number") return null; const left = typeof entry?.acuteLoadUA === "number" ? Math.min(88, Math.max(8, 8 + entry.acuteLoadUA / acuteMax * 82)) : typeof entry?.acwr === "number" ? Math.min(88, Math.max(8, 8 + (entry.acwr - 0.5) / 1.1 * 82)) : Math.min(84, 28 + index * 10); return <button key={athlete.id} onClick={() => onAthlete(athlete.id)} style={{ left: `${left}%`, bottom: `${22 + readiness * .58}%`, background: athlete.color }} title={`${athlete.name}${typeof entry?.acwr === "number" ? ` · ACWR ${entry.acwr.toFixed(2).replace(".", ",")}` : ""}`}>{athlete.initials}</button>; })}</div></article>
    </section></>;
}

export type BriefingInsight = { id: string; severity: "attention" | "info" | "success"; title: string; detail: string; view?: string; athleteId?: string };

export type Briefing = {
  date: string;
  nextMeet: { id: string; name: string; priority: string; startsOn: string; daysUntil: number; pool: string } | null;
  todaySessions: Array<{ id: string; title: string; date: string; volumeMeters: number; zone: string; blocksCount: number; time: string; targetType: "team" | "group" | "athlete"; targetId: string; prescriptionId?: string }>;
  metrics: { activeAthletes: number; readyAthletes: number; attentionAthletes: number; averageReadiness: number | null; checkinsToday: number; adherencePercent: number | null; pendingVideos: number; pendingInvitations: number; expiringInvitations: number; prescriptionsAwaitingApproval: number };
  load: { acute: number | null; chronic: number | null; acwr: number | null; weeklyHistory: Array<{ label: string; volumeMeters: number }>; source: "activities" | "none" };
  insights: BriefingInsight[];
  perAthlete: Array<{ athleteId: string; name: string; readiness: number | null; weekVolumeMeters: number | null; previousWeekVolumeMeters: number | null; acuteLoadUA: number | null; acwr: number | null; checkinsThisWeek: number; pendingInvite: boolean }>;
};

const RESOLVED_INSIGHTS_KEY = "rkf_resolved_insights";
const VIEW_LABELS: Record<string, string> = { today: "Abrir Hoje", athletes: "Abrir atletas", practices: "Abrir treinos", seasons: "Abrir temporada", videos: "Abrir fila de vídeos", analytics: "Abrir análise", inbox: "Abrir novidades", integrations: "Abrir integrações", settings: "Abrir preferências", rkf: "Abrir operação RKF" };

function readResolvedInsights(): string[] {
  if (typeof window === "undefined") return [];
  try { const parsed: unknown = JSON.parse(window.localStorage.getItem(RESOLVED_INSIGHTS_KEY) ?? "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

export function News({ onNavigate, onAthlete, onNotify }: { onNavigate?: (view: AppView) => void; onAthlete: (id: string) => void; onNotify: (message: string) => void }) {
  const [filter, setFilter] = useState<"Prioridade" | "Todos" | "Resolvidos">("Prioridade");
  const [resolved, setResolved] = useState<string[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingStatus, setBriefingStatus] = useState<"loading" | "ready" | "error">("loading");
  const [briefingError, setBriefingError] = useState("");
  const loadBriefing = useCallback(() => {
    setBriefingStatus("loading");
    apiRequest<Briefing>("/api/v1/coach/briefing").then((response) => { setBriefing(response); setBriefingStatus("ready"); }).catch((error: unknown) => { setBriefing(null); setBriefingError(error instanceof Error ? error.message : "O serviço de briefing não respondeu."); setBriefingStatus("error"); });
  }, []);
  useEffect(() => { loadBriefing(); setResolved(readResolvedInsights()); }, [loadBriefing]);
  const insights = briefing?.insights ?? [];
  const persistResolved = (next: string[]) => { setResolved(next); try { window.localStorage.setItem(RESOLVED_INSIGHTS_KEY, JSON.stringify(next)); } catch { /* armazenamento indisponível: mantém apenas em memória */ } };
  const markAllRead = () => {
    if (!insights.length) { onNotify("Nenhum alerta em aberto para resolver."); return; }
    persistResolved(insights.map((item) => item.id));
    setFilter("Resolvidos");
    onNotify("Todos os alertas foram marcados como resolvidos.");
  };
  const visible = insights.filter((item) => filter === "Todos" || (filter === "Resolvidos" ? resolved.includes(item.id) : !resolved.includes(item.id) && item.severity === "attention"));
  return <><PageTitle kicker="CENTRAL DE DECISÕES" title="Novidades" subtitle="Alertas explicáveis do briefing do dia, sempre ligados a uma ação."><button className="secondary-button" onClick={() => onNavigate?.("settings")}><Settings size={17} />Preferências</button><button className="primary-button" onClick={markAllRead}><Check size={17} />Marcar como lidas</button></PageTitle>
    <section className="inbox-layout"><div className="card inbox-list"><div className="inbox-tabs">{(["Prioridade", "Todos", "Resolvidos"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}{item !== "Resolvidos" && <span>{item === "Prioridade" ? insights.filter((insight) => insight.severity === "attention" && !resolved.includes(insight.id)).length : insights.length}</span>}</button>)}</div>
      {briefingStatus === "loading" && <div className="empty-state"><Skeleton height={16} /><strong>Carregando novidades…</strong><p>Consultando o briefing do dia.</p></div>}
      {briefingStatus === "error" && <div className="empty-state"><AlertTriangle size={28} /><strong>Não foi possível carregar as novidades</strong><p>{briefingError || "O serviço de briefing não respondeu."}</p><button className="secondary-button" onClick={loadBriefing}>Tentar novamente</button></div>}
      {briefingStatus === "ready" && visible.map((item) => <article className="inbox-item" key={item.id}><span className={`insight-icon ${item.severity === "attention" ? "critical" : item.severity === "success" ? "success" : "account"}`}>{item.severity === "attention" ? <HeartPulse size={19} /> : item.severity === "success" ? <Trophy size={19} /> : <Activity size={19} />}</span><div><div><b>{item.title}</b><small>{item.severity === "attention" ? "Atenção" : item.severity === "success" ? "Boa notícia" : "Informativo"}</small></div><p>{item.detail}</p>{(item.view || item.athleteId) && <button onClick={() => item.view ? onNavigate?.(item.view as AppView) : onAthlete(item.athleteId ?? "")}>{item.view ? VIEW_LABELS[item.view] ?? "Abrir visão" : "Abrir atleta"}<ArrowRight size={14} /></button>}</div><button className="icon-button" aria-label={`Resolver alerta: ${item.title}`} onClick={() => { if (!resolved.includes(item.id)) persistResolved([...resolved, item.id]); onNotify(`Alerta resolvido: ${item.title}`); }}><Check size={17} /></button></article>)}
      {briefingStatus === "ready" && !visible.length && <div className="empty-state"><CircleCheck size={28} /><strong>{insights.length ? "Nenhum alerta nesta visão" : "Sem novidades — tudo em ordem"}</strong><p>{insights.length ? "As decisões resolvidas permanecem disponíveis para auditoria." : "Nenhum alerta foi gerado pelo briefing de hoje."}</p></div>}
    </div><aside className="stack"><article className="card weekly-digest"><Sparkles size={22} /><span>RESUMO INTELIGENTE</span><h3>Briefing de hoje</h3>{briefing ? <p>Check-ins hoje: <b>{briefing.metrics.checkinsToday}</b>.{briefing.metrics.adherencePercent != null && <> Aderência à carga: <b>{Math.round(briefing.metrics.adherencePercent)}%</b>.</>}{briefing.nextMeet && <> Próxima competição: <b>{briefing.nextMeet.name}</b> em {briefing.nextMeet.daysUntil} dia{briefing.nextMeet.daysUntil === 1 ? "" : "s"}.</>}</p> : <p>{briefingStatus === "loading" ? "Carregando o briefing do dia…" : "Sem dados de briefing no momento."}</p>}<button className="secondary-button" onClick={() => onNavigate?.("analytics")}>Abrir análise do programa</button></article><article className="card rule-card"><SectionHead title="Motor de regras" subtitle="Automações ativas" action="Configurar" onAction={() => onNavigate?.("settings")} /><div><span><CircleCheck size={16} />Queda de volume</span><em>Ativo</em></div><div><span><CircleCheck size={16} />Readiness crítico</span><em>Ativo</em></div><div><span><CircleCheck size={16} />Sem vídeo recente</span><em>Ativo</em></div><div><span><CircleCheck size={16} />Meta se aproximando</span><em>Ativo</em></div></article></aside></section></>;
}

export function Integrations({ onNotify, onCreateConnection, liveVersion = 0 }: { onNotify: (message: string) => void; onCreateConnection: (provider?: "garmin" | "polar" | "apple") => void; liveVersion?: number }) {
  const [syncStats, setSyncStats] = useState({ connections: 0, events: 0, lastSync: "Sem sincronização" });
  const [providerCounts, setProviderCounts] = useState<Record<string, number>>({});
  const [syncJobs, setSyncJobs] = useState<Array<Record<string, unknown>>>([]);
  const [jobsState, setJobsState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    void Promise.all([
      apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/syncJobs"),
      apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/activities"),
    ]).then(([jobs, activities]) => {
      const counts: Record<string, number> = {};
      for (const job of jobs.data) { const provider = String(job.provider ?? ""); if (provider) counts[provider] = (counts[provider] ?? 0) + 1; }
      const latest = jobs.data.map((job) => String(job.completedAt ?? job.updatedAt ?? "")).filter(Boolean).sort().at(-1);
      setProviderCounts(counts);
      setSyncJobs(jobs.data);
      setSyncStats({ connections: new Set(jobs.data.map((job) => `${job.provider}:${job.athleteId}`)).size, events: activities.data.length, lastSync: latest ? new Date(latest).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Sem sincronização" });
      setJobsState("ready");
    }).catch(() => setJobsState("error"));
  }, [liveVersion]);
  const visibleConnectors = connectors.map((connector) => ({ ...connector, athletes: providerCounts[connector.id] ?? connector.athletes, status: providerCounts[connector.id] ? "connected" : connector.status }));
  const exportLogs = () => {
    if (!syncJobs.length) { onNotify("Nenhum job de sincronização registrado ainda."); return; }
    const stateLabels: Record<string, string> = { success: "sucesso", running: "em andamento", failed: "falha", pending: "pendente" };
    downloadFile("logs-sincronizacao.csv", [csvRow(["Data/hora", "Provedor", "Atleta", "Direção", "Estado"]), ...syncJobs.map((job) => csvRow([String(job.completedAt ?? job.createdAtSource ?? job.createdAt ?? "-"), String(job.provider ?? "-"), String(job.athleteId ?? "-"), String(job.direction ?? "-"), stateLabels[String(job.status ?? "")] ?? String(job.status ?? "-")]))].join("\n"));
    onNotify(`${syncJobs.length} registros de sincronização exportados.`);
  };
  return <><PageTitle kicker="ECOSSISTEMA DE DADOS" title="Integrações" subtitle="Conectores versionados, consentimento por atleta e rastreabilidade total."><button className="secondary-button" onClick={exportLogs}><FileText size={17} />Logs de sincronização</button><button className="primary-button" onClick={() => onCreateConnection()}><Plus size={17} />Nova conexão</button></PageTitle>
     <div className="integration-summary"><div><Cloud size={21} /><span><b>{syncStats.connections || "—"} atletas sincronizados</b><small>Última coleta {syncStats.lastSync}</small></span></div><div><RefreshCw size={21} /><span><b>{syncStats.events} eventos importados</b><small>Idempotência por origem ativa</small></span></div><div><ShieldCheck size={21} /><span><b>Consentimentos válidos</b><small>LGPD · auditoria ativa</small></span></div></div>
     {jobsState === "error" && <p className="form-error">Não foi possível carregar os jobs de sincronização; os números exibidos podem estar incompletos.</p>}
     {jobsState === "ready" && !syncJobs.length && <div className="empty-state compact"><RefreshCw size={24} /><strong>Nenhuma sincronização registrada</strong><p>Os logs serão gerados a partir dos jobs reais assim que um conector importar dados.</p></div>}
     <section className="connector-grid">{visibleConnectors.map((connector) => <article className="card connector-card" key={connector.id}><div className="connector-head"><span className={`connector-mark ${connector.id}`}>{connector.mark}</span><div><h3>{connector.name}</h3><p>{connector.category}</p></div><span className={`connector-status ${connector.status}`}>{connector.status === "connected" ? "Conectado" : connector.status === "native" ? "Requer app" : "Disponível"}</span></div><p className="connector-note">{connector.note}</p><div className="capabilities"><span className={connector.read ? "yes" : "no"}><Download size={14} />Consumir dados</span><span className={connector.write ? "yes" : "no"}><Send size={14} />Enviar treino</span></div><div className="connector-footer"><span><Users size={15} />{connector.athletes} atleta{connector.athletes === 1 ? "" : "s"}</span><button onClick={() => connector.id === "garmin" || connector.id === "polar" || connector.id === "apple" ? onCreateConnection(connector.id) : onNotify(`${connector.name}: conector de leitura preparado para a fase de homologação real.`)}>{connector.status === "connected" ? "Gerenciar" : connector.status === "native" ? "Ver requisitos" : "Conectar"}<ArrowRight size={14} /></button></div></article>)}</section>
    <article className="card sync-architecture"><div className="architecture-copy"><span className="eyebrow accent">ARQUITETURA PREPARADA</span><h2>Uma camada comum, conectores independentes.</h2><p>Cada origem declara suas capacidades. A plataforma preserva o payload bruto, normaliza a atividade e impede duplicidade antes de recalcular carga.</p></div><div className="flow-diagram"><div><Watch size={20} /><span>Dispositivo</span></div><ArrowRight size={18} /><div><Cloud size={20} /><span>Conector</span></div><ArrowRight size={18} /><div><Database size={20} /><span>Normalização</span></div><ArrowRight size={18} /><div><Gauge size={20} /><span>RKF Coach</span></div></div></article>
  </>;
}

export function ProgramSettings({ onNotify }: { onNotify: (message: string) => void }) {
  type ZoneDraft = { code: string; label: string; color: string; pace: string };
  type StaffMember = { id: string; name: string; role: string; access: string; status: string };
  const [tab, setTab] = useState("Programa");
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoName, setLogoName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [programName, setProgramName] = useState("Seleção Nacional de Natação");
  const [programLocale, setProgramLocale] = useState("pt-BR");
  const [primaryPool, setPrimaryPool] = useState("50 m");
  const [identityName, setIdentityName] = useState("Seleção Nacional");
  const [identityColor, setIdentityColor] = useState("#0C8F7C");
  const [zoneDrafts, setZoneDrafts] = useState<ZoneDraft[]>(() => zoneDistribution.map((zone) => ({ code: zone.code, label: zone.label, color: zone.color, pace: zone.pace })));
  const [staff, setStaff] = useState<StaffMember[]>([{ id: "demo-1", name: "Leonardo Martins", role: "Administrador", access: "full", status: "active" }, { id: "demo-2", name: "Camila Ferreira", role: "Treinadora", access: "full", status: "active" }, { id: "demo-3", name: "Rafael Nunes", role: "Fisiologista", access: "readonly", status: "active" }]);
  const [staffDemo, setStaffDemo] = useState(true);
  const [invitations, setInvitations] = useState<Array<Record<string, unknown>> | null>(null);
  const [invitationsError, setInvitationsError] = useState(false);
  useEffect(() => {
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/settings")
      .then((response) => {
        const program = response.data.find((record) => record.id === "program");
        if (!program) return;
        if (typeof program.organizationName === "string") setProgramName(program.organizationName);
        if (typeof program.locale === "string") setProgramLocale(program.locale);
        if (typeof program.primaryPool === "string") setPrimaryPool(program.primaryPool.replace(/.*?(\d+\s*m)$/i, "$1"));
        if (typeof program.identityName === "string") setIdentityName(program.identityName);
        if (typeof program.identityColor === "string") setIdentityColor(program.identityColor);
        if (typeof program.logoUrl === "string") setLogoUrl(program.logoUrl);
      }).catch(() => undefined);
  }, []);
  useEffect(() => {
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/zones")
      .then((response) => {
        if (!response.data.length) return;
        setZoneDrafts(response.data.filter((record) => String(record.status ?? "active") !== "retired").sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)).map((record) => ({ code: String(record.code ?? record.id), label: String(record.name ?? "").replace(/^.*?·\s*/, "") || "Zona personalizada", color: String(record.color ?? "#2da7c7"), pace: String(record.pace ?? "Individual") })));
      }).catch(() => undefined);
  }, []);
  useEffect(() => {
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/staff").then((response) => {
      if (!response.data.length) return;
      setStaff(response.data.map((record, index) => ({ id: String(record.id ?? `staff-${index}`), name: String(record.name ?? "Membro da comissão"), role: String(record.role ?? "Equipe"), access: String(record.access ?? "full"), status: String(record.status ?? "active") })));
      setStaffDemo(false);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    void apiRequest<{ data: Array<Record<string, unknown>> }>("/api/v1/manage/invitations").then((response) => setInvitations(response.data)).catch(() => setInvitationsError(true));
  }, []);
  const inviteSummary = invitationsError ? "Sem registro de convites disponível" : !invitations ? "Carregando convites…" : invitations.length ? (() => { const pending = invitations.filter((record) => String(record.status ?? "") === "pending").length; const accepted = invitations.filter((record) => String(record.status ?? "") === "accepted").length; const statusLabels: Record<string, string> = { pending: "pendente", accepted: "aceito", expired: "expirado", revoked: "revogado" }; const latest = [...invitations].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0]; const expires = typeof latest.expiresAt === "string" && !Number.isNaN(new Date(latest.expiresAt).getTime()) ? new Date(latest.expiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : null; return `${pending} pendente(s) · ${accepted} aceito(s) · mais recente: ${statusLabels[String(latest.status ?? "")] ?? String(latest.status ?? "—")}${expires ? ` · expira em ${expires}` : ""}`; })() : "Nenhum convite registrado";
  const saveProgram = async () => { try { await apiRequest("/api/v1/manage/settings/program", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationName: programName.trim(), locale: programLocale, measurementSystem: "metric", primaryPool, updatedBy: "Leonardo Martins" }) }); onNotify("Configurações do programa salvas e auditadas."); } catch (error) { onNotify(error instanceof Error ? error.message : "Falha ao salvar configurações"); } };
  const uploadLogo = async (file: File) => { try { const record = await uploadFile(file, "documents", { title: `Logo · ${file.name}`, referenceType: "organization", referenceId: "org-demo" }); setLogoName(file.name); setLogoUrl(String(record.url ?? "")); onNotify("Logo armazenado com hash e pronto para publicar."); } catch (error) { onNotify(error instanceof Error ? error.message : "Falha ao armazenar logo"); } };
  const saveIdentity = async () => { try { await apiRequest("/api/v1/manage/settings/program", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityName: identityName.trim(), identityColor, logoUrl }) }); onNotify("Identidade atualizada e registrada na auditoria."); } catch (error) { onNotify(error instanceof Error ? error.message : "Falha ao salvar identidade"); } };
  const updateZone = (index: number, key: keyof ZoneDraft, value: string) => setZoneDrafts((current) => current.map((zone, zoneIndex) => zoneIndex === index ? { ...zone, [key]: value } : zone));
  const addZone = () => setZoneDrafts((current) => [...current, { code: `Z${current.length + 1}`, label: "Nova zona", color: "#7b8bd8", pace: "Individual" }]);
  const saveZones = async () => { try { await Promise.all(zoneDrafts.map(async (zone, index) => { const body = { id: zone.code.toLowerCase(), name: `${zone.code} · ${zone.label}`, code: zone.code, color: zone.color, pace: zone.pace, status: "active", order: index + 1 }; try { return await apiRequest(`/api/v1/manage/zones/${zone.code.toLowerCase()}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch { return apiRequest("/api/v1/manage/zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } })); onNotify("Zonas atualizadas; histórico preservado."); } catch (error) { onNotify(error instanceof Error ? error.message : "Falha ao salvar zonas"); } };
  return <><PageTitle kicker="ADMINISTRAÇÃO" title="Configurações" subtitle="Identidade, método, comissão, zonas, privacidade e operação." />
    <section className="settings-layout"><aside className="settings-menu">{["Programa", "Comissão técnica", "Zonas de intensidade", "Identidade", "Notificações", "Privacidade e LGPD", "Conta"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</aside><div className="card settings-panel">
       {tab === "Programa" && <><SectionHead title="Programa de performance" subtitle="Configurações principais da organização" /><div className="form-grid"><label><span>Nome do programa</span><input value={programName} onChange={(event) => setProgramName(event.target.value)} /></label><label><span>Idioma padrão</span><select value={programLocale} onChange={(event) => setProgramLocale(event.target.value)}><option value="pt-BR">Português (Brasil)</option><option>English</option><option>Español</option><option>Français</option></select></label><label><span>Sistema de medidas</span><select defaultValue="metric"><option value="metric">Métrico · metros</option></select></label><label><span>Piscina principal</span><select value={primaryPool} onChange={(event) => setPrimaryPool(event.target.value)}><option value="50 m">Olímpica · 50 m</option><option value="25 m">Semiolímpica · 25 m</option></select></label></div><div className="settings-callout"><Sparkles size={20} /><div><b>Motor de carga ativo: RkfLoadEngine V5.1</b><p>Determinístico, versionado e em validação com o pacote canônico RKF. Resultados oficiais dependem da homologação do treinador.</p></div><button className="secondary-button" onClick={() => { downloadFile("contrato-motor-carga-rkf.json", JSON.stringify({ version: "RKF_V5.1", status: "validation", inputs: ["prescrição", "execução", "zonas", "feedback"], outputs: ["métricas", "componentes", "explicação"] }, null, 2), "application/json"); onNotify("Contrato versionado do motor RKF exportado."); }}>Ver contrato</button></div><button className="primary-button" onClick={() => void saveProgram()}>Salvar alterações</button></>}
      {tab === "Comissão técnica" && <><SectionHead title="Comissão técnica" subtitle={staffDemo ? "Papéis e acesso por organização · dados de demonstração" : "Papéis e acesso por organização"} action="Convidar profissional" onAction={() => onNotify("Formulário de convite da comissão aberto com papel e nível de acesso.")} /><div className="staff-list">{staff.map((member, index) => <div key={member.id}><Avatar initials={member.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()} color={["#0b927d", "#7357ef", "#397ac4", "#e35f65", "#f09a3e"][index % 5]} /><span><b>{member.name}</b><small>{member.role} · {member.access === "full" ? "acesso total" : member.access === "readonly" ? "somente leitura" : member.access}</small></span><span className="active-access"><StatusDot tone={member.status === "active" ? "good" : "warn"} />{member.status === "active" ? "Ativo" : member.status === "invited" ? "Convite pendente" : "Inativo"}</span><button className="icon-button" aria-label={`Gerenciar ${member.name}`} onClick={() => onNotify(`Permissões de ${member.name} abertas para edição.`)}><MoreHorizontal size={18} /></button></div>)}</div></>}
        {tab === "Zonas de intensidade" && <><SectionHead title="Zonas de intensidade" subtitle="Reordene, personalize ou aposente sem perder o histórico" action="Adicionar zona" onAction={addZone} /><div className="zone-settings">{zoneDrafts.map((zone, index) => <div key={`${zone.code}-${index}`}><span className="drag-handle">⋮⋮</span><i style={{ background: zone.color }} /><input value={zone.code} onChange={(event) => updateZone(index, "code", event.target.value.toUpperCase())} aria-label={`Código da zona ${index + 1}`} /><input value={zone.label} onChange={(event) => updateZone(index, "label", event.target.value)} aria-label={`Nome da zona ${index + 1}`} /><input value={zone.pace} onChange={(event) => updateZone(index, "pace", event.target.value)} aria-label={`Ritmo da zona ${index + 1}`} /><button className="icon-button" aria-label={`Gerenciar zona ${zone.code}`} onClick={() => onNotify(`Opções de ordenar, aposentar e duplicar a zona ${zone.code} abertas.`)}><MoreHorizontal size={17} /></button></div>)}</div><button className="primary-button" onClick={() => void saveZones()}>Salvar zonas</button></>}
       {tab === "Identidade" && <><SectionHead title="Identidade da equipe" subtitle="Visível nos convites e na área do atleta" /><div className="identity-editor"><div className="logo-upload">{logoUrl ? <img src={mediaUrl(logoUrl)} alt="Logo da equipe" /> : <Waves size={30} />}<input ref={logoInput} hidden type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); }} /><button onClick={() => logoInput.current?.click()}>{logoName || logoUrl ? "Trocar logo" : "Alterar logo"}</button>{logoName && <small>{logoName}</small>}</div><div className="form-grid"><label><span>Nome exibido</span><input value={identityName} onChange={(event) => setIdentityName(event.target.value)} /></label><label><span>Cor principal</span><input value={identityColor} onChange={(event) => setIdentityColor(event.target.value)} /></label><label className="wide"><span>Convites de atleta</span><div className="copy-field"><input readOnly value={inviteSummary} aria-label="Situação dos convites de atleta" /></div></label></div></div><button className="primary-button" onClick={() => void saveIdentity()}>Salvar identidade</button></>}
      {tab === "Notificações" && <><SectionHead title="Notificações" subtitle="Tudo permanece no RKF Coach; escolha o que também chega por e-mail" /><div className="toggle-list">{["Feedback em vídeo", "Respostas ao feedback", "Alertas de readiness", "Falhas de sincronização", "Mensagens da equipe", "Resumo semanal"].map((item, index) => <label key={item}><span><b>{item}</b><small>{index < 2 ? "Atletas e comissão" : "Somente comissão"}</small></span><input type="checkbox" defaultChecked={index !== 4} /><i /></label>)}</div><button className="primary-button" onClick={() => onNotify("Preferências de notificação salvas.")}>Salvar preferências</button></>}
      {tab === "Privacidade e LGPD" && <><SectionHead title="Privacidade e LGPD" subtitle="Dados esportivos e de saúde com governança explícita" /><div className="privacy-grid"><div><ShieldCheck size={21} /><b>Consentimentos</b><p>—</p><button onClick={() => onNotify("Registro de consentimentos ainda não exposto pela API.")}>Gerenciar</button></div><div><Download size={21} /><b>Exportações</b><p>Portabilidade por atleta</p><button onClick={() => onNotify("Solicitação de portabilidade criada e auditada.")}>Solicitar</button></div><div><Lock size={21} /><b>Credenciais</b><p>Criptografadas e segregadas</p><button onClick={() => onNotify("Auditoria de credenciais concluída sem exposição de segredos.")}>Auditar</button></div><div><Database size={21} /><b>Retenção</b><p>Política configurável</p><button onClick={() => onNotify("Política de retenção aberta para configuração.")}>Configurar</button></div></div></>}
      {tab === "Conta" && <><SectionHead title="Sua conta" subtitle="Perfil, acesso e preferências pessoais" /><div className="account-profile"><Avatar initials="LM" color="#0b927d" /><div><b>Leonardo Martins</b><small>leonardo@aquaos.app · Brasil</small></div><button className="secondary-button" onClick={() => onNotify("Editor de perfil aberto.")}>Editar perfil</button></div><div className="form-grid"><label><span>Idioma</span><select><option>Português (Brasil)</option></select></label><label><span>Fuso horário</span><select><option>America/Sao_Paulo</option></select></label></div><button className="primary-button" onClick={() => onNotify("Preferências da conta salvas.")}>Salvar conta</button></>}
    </div></section>
  </>;
}
