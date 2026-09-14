"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Clock3,
  Gauge,
  LoaderCircle,
  Medal,
  Plus,
  Target,
  TrendingUp,
  Video,
  Waves,
} from "lucide-react";
import { apiRequest } from "./api";

type PerformancePayload = {
  athlete: { id: string; name?: string; category?: string | null; level?: string | null; primaryEvent?: string | null; objective?: string | null };
  summary: { completedSessions: number; totalDistanceM: number; averageRpe: number | null; recordedResults: number; videoAnalyses: number };
  personalBests: Array<{ event: string; seconds: number; date: string; source: string; time: string | null }>;
  recentSessions: Array<{ id: string; date: string; title?: string; distanceM: number | null; durationMinutes: number | null; rpe: number | null; status?: string }>;
  recentResults: Array<{ id: string; date: string; event: string; time: string; poolLengthM: number | null; meet?: string | null }>;
  load: { value: number | null; atl: number | null; ctl: number | null; tsb: number | null; date: string } | null;
  evolution: { date: string; summary: string; score: number | null } | null;
  aquaVision: Array<{ id: string; title: string; date: string; qualityGrade?: unknown; analyzed: boolean }>;
};

const panel = {
  border: "1px solid rgba(15,55,85,.12)",
  borderRadius: 20,
  background: "#fff",
  padding: 18,
  boxShadow: "0 10px 28px rgba(14,54,77,.05)",
} as const;

function meters(value: number) {
  if (value >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
  return `${value.toLocaleString("pt-BR")} m`;
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default function AthletePerformance() {
  const router = useRouter();
  const [data, setData] = useState<PerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<PerformancePayload>("/api/v1/ai/athlete/performance")
      .then((payload) => { if (active) setData(payload); })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus resultados.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const best = useMemo(() => data?.personalBests ?? [], [data]);
  const hasData = Boolean(data && (data.summary.completedSessions || data.summary.recordedResults || best.length));

  return <main className="athlete-phone light" style={{ background: "#f4f8fb", minHeight: "100vh", paddingBottom: 34 }}>
    <header style={{ display: "grid", gridTemplateColumns: "42px 1fr 42px", alignItems: "center", padding: "18px 18px 8px" }}>
      <button aria-label="Voltar" onClick={() => router.push("/pt/athlete/home")} style={{ border: 0, background: "transparent", color: "#123b54", cursor: "pointer" }}><ArrowLeft size={22} /></button>
      <strong style={{ textAlign: "center", color: "#123b54" }}>Resultados e evolução</strong>
      <span />
    </header>

    <section style={{ padding: "10px 18px 0" }}>
      <div style={{ borderRadius: 24, padding: 20, background: "linear-gradient(135deg,#0d315f,#0c6c7c)", color: "white", boxShadow: "0 16px 36px rgba(10,59,87,.18)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: .9, fontSize: 12, fontWeight: 800 }}><TrendingUp size={17} />PAINEL DO ATLETA</div>
        <h1 style={{ margin: "10px 0 4px", fontSize: 27, lineHeight: 1.05 }}>Acompanhe sua evolução.</h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, opacity: .84 }}>Treinos concluídos, resultados, melhores marcas, carga e análises disponíveis no seu histórico.</p>
      </div>
    </section>

    {loading && <section style={{ padding: 18 }}><div style={{ ...panel, minHeight: 220, display: "grid", placeItems: "center" }}><div style={{ textAlign: "center", color: "#567184" }}><LoaderCircle className="spin" size={28} /><p>Carregando seus dados…</p></div></div></section>}
    {!loading && error && <section style={{ padding: 18 }}><div style={{ ...panel, borderColor: "#e4b9b9", background: "#fff5f5", color: "#8b3e3e" }}>{error}</div></section>}

    {!loading && data && <div style={{ padding: "18px", display: "grid", gap: 16 }}>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
        <article style={panel}><Activity size={18} color="#176b7e" /><small style={{ display: "block", color: "#718997", marginTop: 10 }}>Treinos concluídos</small><strong style={{ display: "block", fontSize: 24, color: "#123b54", marginTop: 3 }}>{data.summary.completedSessions}</strong></article>
        <article style={panel}><Waves size={18} color="#176b7e" /><small style={{ display: "block", color: "#718997", marginTop: 10 }}>Volume acumulado</small><strong style={{ display: "block", fontSize: 24, color: "#123b54", marginTop: 3 }}>{meters(data.summary.totalDistanceM)}</strong></article>
        <article style={panel}><Gauge size={18} color="#176b7e" /><small style={{ display: "block", color: "#718997", marginTop: 10 }}>PSE médio</small><strong style={{ display: "block", fontSize: 24, color: "#123b54", marginTop: 3 }}>{data.summary.averageRpe ?? "—"}</strong></article>
        <article style={panel}><Medal size={18} color="#176b7e" /><small style={{ display: "block", color: "#718997", marginTop: 10 }}>Resultados registrados</small><strong style={{ display: "block", fontSize: 24, color: "#123b54", marginTop: 3 }}>{data.summary.recordedResults}</strong></article>
      </section>

      <button onClick={() => router.push("/pt/athlete/results")} style={{ border: 0, borderRadius: 16, background: "#ffd200", color: "#071d3d", padding: "15px 17px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 900, cursor: "pointer", fontSize: 14 }}><Plus size={18} />Registrar novo resultado</button>

      {!hasData && <section style={{ ...panel, textAlign: "center", padding: "28px 20px" }}><BarChart3 size={30} color="#6b8796" /><h2 style={{ color: "#123b54", fontSize: 18, margin: "10px 0 6px" }}>Seu histórico começa aqui</h2><p style={{ color: "#718997", fontSize: 12, lineHeight: 1.55, margin: 0 }}>Conclua treinos e registre tempos para acompanhar sua evolução neste painel.</p></section>}

      {best.length > 0 && <section style={panel}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Medal size={18} color="#b78a00" /><h2 style={{ margin: 0, color: "#123b54", fontSize: 16 }}>Melhores marcas</h2></div><div style={{ display: "grid", gap: 8 }}>{best.map((item) => <div key={`${item.event}-${item.date}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "11px 0", borderTop: "1px solid #edf1f3" }}><div><strong style={{ display: "block", color: "#173e55", fontSize: 13 }}>{item.event}</strong><small style={{ color: "#8296a1" }}>{dateLabel(item.date)} · {item.source}</small></div><strong style={{ fontSize: 19, color: "#0d6f79" }}>{item.time ?? "—"}</strong></div>)}</div></section>}

      {data.load && <section style={panel}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Gauge size={18} color="#176b7e" /><h2 style={{ margin: 0, color: "#123b54", fontSize: 16 }}>Carga atual</h2></div><div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}><div><small style={{ color: "#8296a1" }}>ATL</small><strong style={{ display: "block", color: "#123b54" }}>{data.load.atl ?? "—"}</strong></div><div><small style={{ color: "#8296a1" }}>CTL</small><strong style={{ display: "block", color: "#123b54" }}>{data.load.ctl ?? "—"}</strong></div><div><small style={{ color: "#8296a1" }}>TSB</small><strong style={{ display: "block", color: "#123b54" }}>{data.load.tsb ?? "—"}</strong></div></div><small style={{ color: "#8aa0ac", display: "block", marginTop: 10 }}>Última atualização: {dateLabel(data.load.date)}</small></section>}

      {data.evolution && <section style={panel}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}><TrendingUp size={18} color="#176b7e" /><h2 style={{ margin: 0, color: "#123b54", fontSize: 16 }}>Avaliação de evolução</h2></div><p style={{ color: "#5d7481", fontSize: 12, lineHeight: 1.55, margin: 0 }}>{String(data.evolution.summary)}</p><small style={{ color: "#8aa0ac", display: "block", marginTop: 8 }}>{dateLabel(data.evolution.date)}</small></section>}

      {data.recentResults.length > 0 && <section style={panel}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><Target size={18} color="#176b7e" /><h2 style={{ margin: 0, color: "#123b54", fontSize: 16 }}>Resultados recentes</h2></div>{data.recentResults.slice(0, 6).map((result) => <div key={result.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", borderTop: "1px solid #edf1f3", padding: "11px 0" }}><div><strong style={{ display: "block", color: "#173e55", fontSize: 12 }}>{result.event}</strong><small style={{ color: "#8296a1" }}>{dateLabel(result.date)}{result.meet ? ` · ${result.meet}` : ""}</small></div><strong style={{ color: "#0d6f79" }}>{result.time}</strong></div>)}</section>}

      {data.recentSessions.length > 0 && <section style={panel}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><Clock3 size={18} color="#176b7e" /><h2 style={{ margin: 0, color: "#123b54", fontSize: 16 }}>Treinos recentes</h2></div>{data.recentSessions.slice(0, 6).map((session) => <div key={session.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", borderTop: "1px solid #edf1f3", padding: "11px 0" }}><div><strong style={{ display: "block", color: "#173e55", fontSize: 12 }}>{session.title}</strong><small style={{ color: "#8296a1" }}>{dateLabel(session.date)} · PSE {session.rpe ?? "—"}</small></div><strong style={{ color: "#173e55" }}>{session.distanceM ? meters(session.distanceM) : "—"}</strong></div>)}</section>}

      {data.aquaVision.some((item) => item.analyzed) && <section style={panel}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><Video size={18} color="#176b7e" /><h2 style={{ margin: 0, color: "#123b54", fontSize: 16 }}>AquaVision</h2></div>{data.aquaVision.filter((item) => item.analyzed).slice(0, 3).map((item) => <button key={item.id} type="button" onClick={() => router.push("/pt/athlete/more")} style={{ width: "100%", border: 0, borderTop: "1px solid #edf1f3", background: "transparent", padding: "11px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", textAlign: "left", cursor: "pointer" }}><span><strong style={{ display: "block", color: "#173e55", fontSize: 12 }}>{item.title}</strong><small style={{ color: "#8296a1" }}>{dateLabel(item.date)}</small></span><ChevronRight size={17} color="#6b8796" /></button>)}</section>}
    </div>}
  </main>;
}
