"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, ClipboardCheck, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { apiRequest } from "./api";

type Athlete = { id: string; name?: string; group?: string };
type Proposal = {
  id: string;
  athleteId?: string;
  title?: string;
  scheduledDate?: string;
  status?: string;
  source?: string;
  objective?: string;
  primaryZone?: string;
  secondaryZone?: string | null;
  totalVolumeM?: number;
  generatedAt?: string;
  submittedAt?: string;
  requestContext?: { focus?: string; timeAvailableMinutes?: number; poolLengthM?: number };
  safety?: { readiness?: number | null; pain?: number | null; reductionPct?: number; reasons?: string[]; warnings?: string[] };
  warnings?: string[];
  personalizedExplanation?: {
    summary?: string;
    why?: Array<{ fact: string; influence: string }>;
    successCriteria?: string[];
    yellowAlternative?: string;
    redAlternative?: string;
  };
  prescription?: {
    blocks?: Array<{ order?: number; component?: string; volumeM?: number; zone?: string; prescriptionText?: string }>;
    versions?: { engine?: string; rules?: string; seed?: string };
  };
};

const card = { border: "1px solid #e1e8ec", borderRadius: 18, background: "white", padding: 18 } as const;

export default function CoachAthleteAiRequests() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await apiRequest<{ user?: { role?: string } }>("/api/v1/auth/me");
      if (!session.user || !["coach", "admin"].includes(String(session.user.role))) {
        router.replace("/pt/login");
        return;
      }
      const [workoutData, athleteData] = await Promise.all([
        apiRequest<{ prescriptions?: Proposal[] }>("/api/v1/workouts"),
        apiRequest<{ data?: Athlete[] }>("/api/v1/athletes"),
      ]);
      setProposals((workoutData.prescriptions ?? []).filter((item) => item.source === "ATHLETE_AI" && item.status === "PENDING_COACH_APPROVAL"));
      setAthletes(athleteData.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as solicitações.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const athleteById = useMemo(() => new Map(athletes.map((athlete) => [athlete.id, athlete])), [athletes]);

  const review = async (proposalId: string, decision: "approve" | "reject") => {
    setBusy(proposalId);
    setError("");
    try {
      await apiRequest(`/api/v1/ai/athlete/workouts/${encodeURIComponent(proposalId)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[proposalId]?.trim() || undefined }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a decisão.");
    } finally { setBusy(null); }
  };

  return <main style={{ minHeight: "100vh", background: "#f4f7f9", color: "#17394b" }}>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 22px 60px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/pt/coach/today")} aria-label="Voltar" style={{ border: "1px solid #dce5e9", background: "white", width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", cursor: "pointer" }}><ArrowLeft size={19} /></button>
          <div><span style={{ color: "#087c70", fontSize: 12, fontWeight: 800, display: "flex", gap: 6, alignItems: "center" }}><Sparkles size={14} />Aqua Coach AI</span><h1 style={{ margin: "4px 0 0", fontSize: 26 }}>Solicitações de treino dos atletas</h1></div>
        </div>
        <button onClick={() => void load()} disabled={loading} style={{ border: "1px solid #dce5e9", background: "white", borderRadius: 12, padding: "10px 12px", display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}><RefreshCw size={16} />Atualizar</button>
      </header>

      <div style={{ ...card, background: "linear-gradient(135deg,#103f58,#0a7b7c)", color: "white", border: 0, marginBottom: 18 }}>
        <strong style={{ display: "flex", gap: 8, alignItems: "center" }}><ClipboardCheck size={19} />Governança RKF</strong>
        <p style={{ margin: "8px 0 0", opacity: .86, lineHeight: 1.55, fontSize: 13 }}>O atleta pode solicitar um treino personalizado, mas a sessão permanece rascunho até a sua decisão. O Planning Engine define volume, zonas e blocos antes da IA; a IA não publica alterações críticas sozinha.</p>
      </div>

      {error && <div style={{ ...card, borderColor: "#e5b6b6", background: "#fff4f4", color: "#843b3b", marginBottom: 16 }}>{error}</div>}
      {loading ? <div style={{ ...card, minHeight: 180, display: "grid", placeItems: "center" }}><div style={{ textAlign: "center" }}><LoaderCircle className="spin" /><p>Carregando solicitações…</p></div></div> : proposals.length === 0 ? <div style={{ ...card, minHeight: 180, display: "grid", placeItems: "center", textAlign: "center" }}><div><Check size={28} color="#087c70" /><h2 style={{ marginBottom: 6 }}>Nenhuma solicitação pendente</h2><p style={{ margin: 0, color: "#6c8390", fontSize: 13 }}>Quando um atleta enviar um treino criado com IA, ele aparecerá aqui.</p></div></div> : <div style={{ display: "grid", gap: 16 }}>
        {proposals.map((proposal) => {
          const athlete = proposal.athleteId ? athleteById.get(proposal.athleteId) : undefined;
          const blocks = proposal.prescription?.blocks ?? [];
          const warnings = [...(proposal.warnings ?? []), ...(proposal.safety?.warnings ?? [])];
          return <article key={proposal.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
              <div><span style={{ color: "#087c70", fontSize: 11, fontWeight: 800 }}>AGUARDANDO APROVAÇÃO</span><h2 style={{ margin: "5px 0", fontSize: 20 }}>{proposal.title ?? "Treino personalizado"}</h2><p style={{ margin: 0, color: "#6a808c", fontSize: 12 }}>{athlete?.name ?? proposal.athleteId} {athlete?.group ? `· ${athlete.group}` : ""} · {proposal.scheduledDate ?? "data não informada"}</p></div>
              <div style={{ display: "flex", gap: 8 }}><span style={{ background: "#e9f6f3", color: "#087c70", borderRadius: 12, padding: "9px 11px", fontWeight: 800 }}>{proposal.primaryZone ?? "—"}</span><span style={{ background: "#f2f5f7", color: "#35576a", borderRadius: 12, padding: "9px 11px", fontWeight: 800 }}>{proposal.totalVolumeM?.toLocaleString("pt-BR") ?? "—"} m</span></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9, margin: "16px 0" }}>
              <div style={{ background: "#f6f9fa", borderRadius: 12, padding: 11 }}><small style={{ color: "#78909c" }}>Readiness</small><strong style={{ display: "block" }}>{proposal.safety?.readiness ?? "UNKNOWN"}</strong></div>
              <div style={{ background: "#f6f9fa", borderRadius: 12, padding: 11 }}><small style={{ color: "#78909c" }}>Dor</small><strong style={{ display: "block" }}>{proposal.safety?.pain ?? "UNKNOWN"}</strong></div>
              <div style={{ background: "#f6f9fa", borderRadius: 12, padding: 11 }}><small style={{ color: "#78909c" }}>Tempo informado</small><strong style={{ display: "block" }}>{proposal.requestContext?.timeAvailableMinutes ? `${proposal.requestContext.timeAvailableMinutes} min` : "UNKNOWN"}</strong></div>
              <div style={{ background: "#f6f9fa", borderRadius: 12, padding: 11 }}><small style={{ color: "#78909c" }}>Ajuste automático</small><strong style={{ display: "block" }}>{proposal.safety?.reductionPct ? `−${proposal.safety.reductionPct}%` : "Sem redução"}</strong></div>
            </div>

            {proposal.personalizedExplanation?.summary && <div style={{ borderLeft: "3px solid #75c7b7", paddingLeft: 12, marginBottom: 16 }}><strong style={{ fontSize: 12 }}>Justificativa personalizada</strong><p style={{ margin: "5px 0 0", color: "#5c7481", fontSize: 12, lineHeight: 1.55 }}>{proposal.personalizedExplanation.summary}</p></div>}

            {blocks.length > 0 && <div style={{ display: "grid", gap: 6, marginBottom: 15 }}>{blocks.map((block, index) => <div key={`${block.order}-${index}`} style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr) auto", gap: 9, alignItems: "center", border: "1px solid #e7edef", borderRadius: 11, padding: 9 }}><span style={{ color: "#087c70", fontWeight: 800, fontSize: 11 }}>{block.zone ?? "—"}</span><div><strong style={{ fontSize: 11 }}>{block.component ?? `Bloco ${index + 1}`}</strong><span style={{ display: "block", color: "#718792", fontSize: 10, marginTop: 2 }}>{block.prescriptionText}</span></div><strong style={{ fontSize: 11 }}>{block.volumeM ?? "—"} m</strong></div>)}</div>}

            {warnings.length > 0 && <div style={{ background: "#fff8e8", color: "#775c1b", borderRadius: 12, padding: 12, marginBottom: 14 }}><strong style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}><AlertTriangle size={15} />Pontos para revisar</strong>{[...new Set(warnings)].map((warning) => <p key={warning} style={{ margin: "6px 0 0", fontSize: 11 }}>• {warning}</p>)}</div>}

            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}><span style={{ fontSize: 11, fontWeight: 800, color: "#486473" }}>Nota da comissão técnica (opcional)</span><textarea value={notes[proposal.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} maxLength={1200} rows={3} placeholder="Ajustes, motivo da aprovação/reprovação ou orientação para o atleta…" style={{ border: "1px solid #d9e3e7", borderRadius: 12, padding: 11, resize: "vertical", font: "inherit" }} /></label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, flexWrap: "wrap" }}>
              <button disabled={busy === proposal.id} onClick={() => void review(proposal.id, "reject")} style={{ border: "1px solid #e0b5b5", background: "#fff", color: "#923d3d", borderRadius: 12, padding: "10px 14px", display: "flex", gap: 7, alignItems: "center", fontWeight: 800, cursor: "pointer" }}><X size={16} />Rejeitar</button>
              <button disabled={busy === proposal.id} onClick={() => void review(proposal.id, "approve")} style={{ border: 0, background: "#087c70", color: "white", borderRadius: 12, padding: "10px 16px", display: "flex", gap: 7, alignItems: "center", fontWeight: 800, cursor: "pointer" }}>{busy === proposal.id ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Aprovar e publicar</button>
            </div>
          </article>;
        })}
      </div>}
    </div>
  </main>;
}
