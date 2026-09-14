"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Video,
  Waves,
} from "lucide-react";
import { apiRequest } from "./api";

type EquipmentCode = "BOARD" | "PULL" | "FINS" | "SNORKEL" | "PALMAR_P" | "PALMAR_M" | "PALMAR_G" | "PARA" | "DRAG";

type EvidenceSignal = { label: string; value: string; source: string };
type SafetyState = {
  readiness: number | null;
  pain: number | null;
  soreness: number | null;
  fatigue: number | null;
  reductionPct: number;
  zoneDowngrade: string | null;
  blocked: boolean;
  reasons: string[];
  warnings: string[];
};
type WorkoutContext = {
  athlete: { id: string; name?: string };
  targetDate: string;
  coachPlan: { id: string; title?: string; status?: string; date?: string | null } | null;
  safety: SafetyState;
  evidence: { signals: EvidenceSignal[]; videos: Array<Record<string, unknown>> };
  completedToday: boolean;
};
type WorkoutBlock = {
  order: number;
  component: string;
  volumeM: number;
  zone: string;
  prescriptionText: string;
  materials: string[];
  skills: string[];
};
type AiWorkoutProposal = {
  proposalId: string;
  status: string;
  targetDate: string;
  workout: {
    id: string;
    title: string;
    objective: string;
    primaryZone: string;
    secondaryZone: string | null;
    totalVolumeM: number;
    blocks: WorkoutBlock[];
    rationale: string[];
    source: { kind: string; librarySessionId?: string };
    versions: { engine: string; rules: string; seed: string };
  };
  explanation: {
    summary: string;
    why: Array<{ fact: string; influence: string }>;
    successCriteria: string[];
    yellowAlternative: string;
    redAlternative: string;
    stopCriteria: string[];
    warnings: string[];
  };
  evidence: EvidenceSignal[];
  safety: SafetyState;
  warnings: string[];
  loadEstimate: { status: string; value: number | null; durationMinutes?: number; targetRpe?: number; method?: string; reason?: string };
  provenance: string[];
  approval: { required: boolean; status: string; authority: string };
  llmError?: string;
};
type PreviousProposal = { id: string; title?: string; status?: string; scheduledDate?: string; totalVolumeM?: number; primaryZone?: string; generatedAt?: string; submittedAt?: string; approvedAt?: string; rejectedAt?: string };

const equipmentOptions: Array<{ code: EquipmentCode; label: string }> = [
  { code: "BOARD", label: "Prancha" },
  { code: "PULL", label: "Pull buoy" },
  { code: "FINS", label: "Nadadeira" },
  { code: "SNORKEL", label: "Snorkel" },
  { code: "PALMAR_P", label: "Palmar P" },
  { code: "PALMAR_M", label: "Palmar M" },
  { code: "PALMAR_G", label: "Palmar G" },
  { code: "PARA", label: "Paraquedas" },
  { code: "DRAG", label: "Drag" },
];

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const panelStyle = {
  border: "1px solid rgba(15, 55, 85, .12)",
  borderRadius: 20,
  background: "#fff",
  padding: 18,
  boxShadow: "0 10px 30px rgba(15, 55, 85, .06)",
} as const;

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    DRAFT_ATHLETE_AI: "Rascunho",
    DRAFT_REQUIRES_REVIEW: "Requer revisão",
    PENDING_COACH_APPROVAL: "Aguardando treinador",
    PUBLISHED: "Aprovado",
    REJECTED: "Rejeitado",
  };
  return labels[String(status ?? "")] ?? String(status ?? "—");
}

function EvidenceCard({ signal }: { signal: EvidenceSignal }) {
  return <article style={{ ...panelStyle, padding: 14, boxShadow: "none" }}>
    <small style={{ color: "#627b8b", display: "block", marginBottom: 5 }}>{signal.label}</small>
    <strong style={{ color: signal.value === "UNKNOWN" ? "#8a6d3b" : "#123b54", fontSize: 14 }}>{signal.value}</strong>
    <span style={{ display: "block", color: "#8ba0ad", fontSize: 11, marginTop: 5 }}>{signal.source}</span>
  </article>;
}

export default function AthleteAiWorkout() {
  const router = useRouter();
  const [auth, setAuth] = useState<"checking" | "ready" | "denied">("checking");
  const [context, setContext] = useState<WorkoutContext | null>(null);
  const [history, setHistory] = useState<PreviousProposal[]>([]);
  const [date, setDate] = useState(todayInSaoPaulo);
  const [focus, setFocus] = useState("");
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState(90);
  const [poolLengthM, setPoolLengthM] = useState<25 | 50>(50);
  const [equipment, setEquipment] = useState<EquipmentCode[]>(["BOARD", "PULL", "FINS", "SNORKEL"]);
  const [proposal, setProposal] = useState<AiWorkoutProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshContext = async (targetDate = date) => {
    const [nextContext, nextHistory] = await Promise.all([
      apiRequest<WorkoutContext>(`/api/v1/ai/athlete/workout-context?date=${encodeURIComponent(targetDate)}`),
      apiRequest<{ data: PreviousProposal[] }>("/api/v1/ai/athlete/workouts"),
    ]);
    setContext(nextContext);
    setHistory(nextHistory.data ?? []);
  };

  useEffect(() => {
    let active = true;
    void apiRequest<{ user?: { role?: string } }>("/api/v1/auth/me")
      .then(async (session) => {
        if (!active) return;
        if (session.user?.role !== "athlete") {
          setAuth("denied");
          router.replace("/pt/coach/today");
          return;
        }
        setAuth("ready");
        await refreshContext(date);
      })
      .catch(() => {
        if (!active) return;
        setAuth("denied");
        router.replace("/pt/athlete/login");
      });
    return () => { active = false; };
    // A carga inicial deve acontecer uma única vez; mudanças de data são manuais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const safeEvidence = useMemo(() => context?.evidence.signals ?? [], [context]);
  const hasVideo = safeEvidence.some((signal) => signal.label === "AquaVision" && signal.value !== "UNKNOWN");
  const canGenerate = auth === "ready" && context && !context.safety.blocked && !context.completedToday && !loading;

  const changeDate = async (value: string) => {
    setDate(value);
    setProposal(null);
    setError("");
    setNotice("");
    try { await refreshContext(value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o contexto."); }
  };

  const toggleEquipment = (code: EquipmentCode) => {
    setEquipment((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };

  const generate = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const created = await apiRequest<AiWorkoutProposal>("/api/v1/ai/athlete/workouts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          focus: focus.trim() || undefined,
          note: note.trim() || undefined,
          timeAvailableMinutes: minutes,
          poolLengthM,
          availableEquipment: equipment,
        }),
      });
      setProposal(created);
      setNotice("Treino criado como rascunho. Ele só se torna oficial após aprovação do treinador.");
      await refreshContext(date);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o treino.");
    } finally { setLoading(false); }
  };

  const submitToCoach = async () => {
    if (!proposal) return;
    setSubmitting(true);
    setError("");
    try {
      await apiRequest(`/api/v1/ai/athlete/workouts/${encodeURIComponent(proposal.proposalId)}/submit`, { method: "POST" });
      setProposal({ ...proposal, status: "PENDING_COACH_APPROVAL", approval: { required: true, status: "PENDING_COACH_APPROVAL", authority: "coach" } });
      setNotice("Enviado para a comissão técnica. O treino está aguardando aprovação do treinador.");
      await refreshContext(date);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar ao treinador.");
    } finally { setSubmitting(false); }
  };

  if (auth === "checking") return <main className="athlete-phone light"><div style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: "#123b54" }}><div style={{ textAlign: "center" }}><LoaderCircle className="spin" size={30} /><p>Carregando seu contexto de treinamento…</p></div></div></main>;
  if (auth === "denied") return <main className="athlete-phone light"><div style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}><LoaderCircle className="spin" size={28} /></div></main>;

  return <main className="athlete-phone light" style={{ background: "#f4f8fb", minHeight: "100vh", paddingBottom: 36 }}>
    <header style={{ display: "grid", gridTemplateColumns: "42px 1fr 42px", alignItems: "center", padding: "18px 18px 8px" }}>
      <button aria-label="Voltar" onClick={() => router.push("/pt/athlete/home")} style={{ border: 0, background: "transparent", color: "#123b54", cursor: "pointer" }}><ArrowLeft size={22} /></button>
      <strong style={{ textAlign: "center", color: "#123b54" }}>Treino com IA</strong>
      <span />
    </header>

    <section style={{ padding: "10px 18px 0" }}>
      <div style={{ borderRadius: 24, padding: 20, color: "white", background: "linear-gradient(135deg,#0d4969,#097e8b)", boxShadow: "0 18px 40px rgba(8,78,105,.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><Sparkles size={22} /><strong>Aqua Coach AI</strong></div>
        <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.08 }}>Um treino pensado para o seu momento.</h1>
        <p style={{ margin: "12px 0 0", opacity: .86, fontSize: 13, lineHeight: 1.55 }}>O Planning Engine RKF cruza seu planejamento do treinador, histórico, carga, readiness, resultados e métricas disponíveis. A IA explica e personaliza sem substituir as regras do treinador.</p>
      </div>
    </section>

    <section style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
      {context?.coachPlan && <div style={{ ...panelStyle, display: "flex", gap: 12, alignItems: "center", background: "#eef8f6" }}>
        <ShieldCheck size={24} color="#087c70" />
        <div><small style={{ color: "#4c766f" }}>Âncora da comissão técnica</small><strong style={{ display: "block", color: "#123b54", marginTop: 3 }}>{context.coachPlan.title ?? "Plano aprovado"}</strong><span style={{ color: "#64818c", fontSize: 12 }}>{context.coachPlan.date ? `Sessão ${context.coachPlan.date}` : "Última prescrição confirmada"}</span></div>
      </div>}

      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><Database size={18} color="#087c70" /><strong style={{ color: "#123b54" }}>Dados considerados pela IA</strong></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9 }}>{safeEvidence.map((signal) => <EvidenceCard key={`${signal.label}-${signal.source}`} signal={signal} />)}</div>
        <p style={{ color: "#78909c", fontSize: 11, lineHeight: 1.5, margin: "12px 0 0" }}><Video size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />{hasVideo ? "Métricas AquaVision confirmadas também entram no contexto de personalização." : "Sem análise AquaVision confirmada: a IA mantém essa camada como UNKNOWN."}</p>
      </div>

      {context?.safety.reasons.length ? <div style={{ ...panelStyle, borderColor: "#e7c166", background: "#fff9e9" }}><strong style={{ display: "flex", gap: 8, alignItems: "center", color: "#765615" }}><AlertTriangle size={18} />Ajustes de segurança</strong>{context.safety.reasons.map((reason) => <p key={reason} style={{ fontSize: 12, lineHeight: 1.5, color: "#7b6b42" }}>• {reason}</p>)}</div> : null}

      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><Target size={18} color="#087c70" /><strong style={{ color: "#123b54" }}>Contexto para o treino</strong></div>
        <div className="athlete-form compact-form" style={{ padding: 0 }}>
          <label className="athlete-field"><span>Data</span><input type="date" value={date} onChange={(event) => void changeDate(event.target.value)} /></label>
          <label className="athlete-field"><span>Quanto tempo você tem?</span><select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[45,60,75,90,105,120,150,180].map((value) => <option value={value} key={value}>{value} min</option>)}</select></label>
          <label className="athlete-field"><span>Piscina</span><div className="segmented">{([25,50] as const).map((value) => <button type="button" key={value} className={poolLengthM === value ? "active" : ""} onClick={() => setPoolLengthM(value)}>{value} m</button>)}</div></label>
          <label className="athlete-field"><span>Foco desejado <small>(opcional)</small></span><input value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={600} placeholder="Ex.: técnica de crawl, ritmo de 200 m, recuperação…" /></label>
          <label className="athlete-field"><span>Observação para a IA <small>(opcional)</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={800} placeholder="Ex.: hoje só consigo treinar pela manhã; braço um pouco pesado…" /></label>
          <div><span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#34566a", marginBottom: 8 }}>Equipamentos disponíveis</span><div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{equipmentOptions.map((item) => <button type="button" key={item.code} onClick={() => toggleEquipment(item.code)} style={{ border: equipment.includes(item.code) ? "1px solid #087c70" : "1px solid #d6e0e6", background: equipment.includes(item.code) ? "#e6f6f2" : "white", color: equipment.includes(item.code) ? "#087c70" : "#5d7482", borderRadius: 999, padding: "8px 10px", fontSize: 11, fontWeight: 700 }}>{equipment.includes(item.code) ? "✓ " : ""}{item.label}</button>)}</div></div>
        </div>
      </div>

      {context?.completedToday && <div style={{ ...panelStyle, borderColor: "#e6b7b7", background: "#fff5f5", color: "#7e3434" }}><strong>Já existe uma execução confirmada para esta data.</strong><p style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>Uma sessão extra precisa ser definida pela comissão técnica para evitar duplicação de carga.</p></div>}
      {context?.safety.blocked && <div style={{ ...panelStyle, borderColor: "#e6b7b7", background: "#fff5f5", color: "#7e3434" }}><strong>Geração automática bloqueada por segurança.</strong><p style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>O treinador precisa revisar seu contexto antes de uma nova sessão.</p></div>}
      {error && <p role="alert" style={{ margin: 0, padding: "12px 14px", borderRadius: 14, color: "#8b3232", background: "#fff0f0", fontSize: 12 }}>{error}</p>}
      {notice && <p style={{ margin: 0, padding: "12px 14px", borderRadius: 14, color: "#176453", background: "#eaf8f3", fontSize: 12 }}>{notice}</p>}

      <button disabled={!canGenerate} onClick={() => void generate()} className="athlete-primary" style={{ minHeight: 54, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
        {loading ? <><LoaderCircle className="spin" size={19} />Criando treino personalizado…</> : <><BrainCircuit size={20} />Criar meu treino com IA</>}
      </button>
      <p style={{ textAlign: "center", color: "#78909c", fontSize: 11, lineHeight: 1.45, marginTop: -5 }}>O treino nasce como rascunho e não substitui a prescrição oficial do treinador.</p>

      {proposal && <section style={{ display: "grid", gap: 14 }}>
        <div style={{ ...panelStyle, border: "1px solid rgba(8,124,112,.22)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div><small style={{ color: "#087c70", fontWeight: 800 }}>{statusLabel(proposal.status)}</small><h2 style={{ color: "#123b54", margin: "5px 0 4px", fontSize: 20 }}>{proposal.workout.title}</h2><p style={{ color: "#65808f", fontSize: 12, margin: 0 }}>{proposal.workout.objective}</p></div>
            <span style={{ borderRadius: 14, background: "#e7f6f3", color: "#087c70", padding: "8px 10px", fontSize: 12, fontWeight: 800 }}>{proposal.workout.primaryZone}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 16 }}>
            <div style={{ background: "#f5f8fa", padding: 11, borderRadius: 12 }}><small style={{ color: "#78909c" }}>Volume</small><strong style={{ display: "block", color: "#123b54" }}>{proposal.workout.totalVolumeM.toLocaleString("pt-BR")} m</strong></div>
            <div style={{ background: "#f5f8fa", padding: 11, borderRadius: 12 }}><small style={{ color: "#78909c" }}>Carga</small><strong style={{ display: "block", color: "#123b54" }}>{proposal.loadEstimate.value ?? "UNKNOWN"}</strong></div>
            <div style={{ background: "#f5f8fa", padding: 11, borderRadius: 12 }}><small style={{ color: "#78909c" }}>Motor</small><strong style={{ display: "block", color: "#123b54", fontSize: 11 }}>RKF</strong></div>
          </div>
        </div>

        <div style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Waves size={18} color="#087c70" /><strong style={{ color: "#123b54" }}>Sessão estruturada</strong></div>
          <div style={{ display: "grid", gap: 8 }}>{proposal.workout.blocks.map((block) => <article key={`${block.order}-${block.component}`} style={{ border: "1px solid #e5edf1", borderRadius: 14, padding: 12, display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 10, alignItems: "start" }}><span style={{ background: "#edf7f5", color: "#087c70", borderRadius: 10, padding: "7px 5px", textAlign: "center", fontSize: 11, fontWeight: 800 }}>{block.zone}</span><div><strong style={{ color: "#123b54", fontSize: 12 }}>{block.component}</strong><p style={{ color: "#657f8d", fontSize: 11, lineHeight: 1.45, margin: "4px 0" }}>{block.prescriptionText}</p>{block.materials.length > 0 && <small style={{ color: "#8a9ca6" }}>{block.materials.join(" · ")}</small>}</div><strong style={{ color: "#123b54", fontSize: 12 }}>{block.volumeM} m</strong></article>)}</div>
        </div>

        <div style={{ ...panelStyle, background: "linear-gradient(180deg,#fff,#f7fbfc)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={18} color="#087c70" /><strong style={{ color: "#123b54" }}>Por que este treino foi criado para você</strong></div>
          <p style={{ color: "#4f6b79", fontSize: 13, lineHeight: 1.6 }}>{proposal.explanation.summary}</p>
          <div style={{ display: "grid", gap: 8 }}>{proposal.explanation.why.map((item, index) => <div key={`${item.fact}-${index}`} style={{ borderLeft: "3px solid #78c6b7", paddingLeft: 10 }}><strong style={{ color: "#294d60", fontSize: 12 }}>{item.fact}</strong><p style={{ margin: "3px 0 0", color: "#708995", fontSize: 11, lineHeight: 1.45 }}>{item.influence}</p></div>)}</div>
        </div>

        <div style={panelStyle}>
          <strong style={{ color: "#123b54", display: "flex", gap: 7, alignItems: "center" }}><CheckCircle2 size={17} color="#087c70" />Critérios de sucesso</strong>
          {proposal.explanation.successCriteria.map((item) => <p key={item} style={{ color: "#5d7785", fontSize: 12, lineHeight: 1.45 }}>• {item}</p>)}
          <div style={{ borderRadius: 12, padding: 12, background: "#fff8df", color: "#755d18", fontSize: 12, lineHeight: 1.45, marginTop: 10 }}><strong>Plano amarelo</strong><br />{proposal.explanation.yellowAlternative}</div>
          <div style={{ borderRadius: 12, padding: 12, background: "#fff0f0", color: "#7d3434", fontSize: 12, lineHeight: 1.45, marginTop: 8 }}><strong>Plano vermelho</strong><br />{proposal.explanation.redAlternative}</div>
        </div>

        {[...proposal.warnings, ...proposal.explanation.warnings].length > 0 && <div style={{ ...panelStyle, borderColor: "#ead18b", background: "#fffaf0" }}><strong style={{ display: "flex", gap: 7, alignItems: "center", color: "#765615" }}><AlertTriangle size={17} />Pendências para revisão</strong>{[...new Set([...proposal.warnings, ...proposal.explanation.warnings])].map((item) => <p key={item} style={{ color: "#786a48", fontSize: 11, lineHeight: 1.45 }}>• {item}</p>)}</div>}

        {proposal.status !== "PENDING_COACH_APPROVAL" ? <button disabled={submitting} onClick={() => void submitToCoach()} className="athlete-primary" style={{ minHeight: 54, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{submitting ? <><LoaderCircle className="spin" size={18} />Enviando…</> : <><Send size={18} />Enviar ao treinador para aprovação</>}</button> : <div style={{ ...panelStyle, background: "#eef8f6", color: "#176453", display: "flex", gap: 10, alignItems: "center" }}><ShieldCheck size={22} /><div><strong>Aguardando aprovação do treinador</strong><small style={{ display: "block", marginTop: 3 }}>Quando aprovado, o treino passa a integrar sua prescrição oficial.</small></div></div>}
      </section>}

      {history.length > 0 && <section style={{ ...panelStyle, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Clock3 size={17} color="#087c70" /><strong style={{ color: "#123b54" }}>Minhas solicitações recentes</strong></div>
        <div style={{ display: "grid", gap: 4 }}>{history.slice(0, 6).map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "10px 0", borderBottom: "1px solid #edf1f3" }}><div><strong style={{ color: "#34566a", fontSize: 12 }}>{item.title ?? "Treino com IA"}</strong><span style={{ display: "block", color: "#8a9ca6", fontSize: 10, marginTop: 3 }}>{item.scheduledDate} · {item.totalVolumeM?.toLocaleString("pt-BR") ?? "—"} m · {item.primaryZone ?? "—"}</span></div><span style={{ color: item.status === "PUBLISHED" ? "#087c70" : "#6f7e86", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", gap: 3 }}>{statusLabel(item.status)}<ChevronRight size={12} /></span></div>)}</div>
      </section>}

      <div style={{ display: "flex", justifyContent: "center", gap: 6, alignItems: "center", color: "#8ba0ad", fontSize: 10, padding: "8px 0 14px" }}><Gauge size={12} />Planning Engine RKF + dados do atleta + revisão humana</div>
    </section>
  </main>;
}
