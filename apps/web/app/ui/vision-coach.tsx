"use client";

/**
 * Painel do treinador de IA na revisão de vídeo: relatório completo do vídeo
 * (contexto total enviado ao modelo) e observações ao vivo sincronizadas com
 * a reprodução - uma janela por ~6 s, sem chamadas sobrepostas.
 */

import { useEffect, useRef, useState } from "react";
import { Radio, Sparkles } from "lucide-react";
import { apiRequest } from "./api";

type LiveNote = { t: number; text: string };

export const LIVE_WINDOW_SECONDS = 4;
const LIVE_INTERVAL_MS = 6000;
const LIVE_NOTES_LIMIT = 12;

export function VisionCoachPanel({ videoId, hasAnalysis, playing, currentTime, seek, engine }: {
  videoId: string;
  hasAnalysis: boolean;
  playing: boolean;
  currentTime: number;
  seek: (time: number) => void;
  engine?: string;
}) {
  const [report, setReport] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [notes, setNotes] = useState<LiveNote[]>([]);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;

  const requestReport = async () => {
    setReportBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ reply: string }>("/api/v1/ai/vision-coach/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      setReport(response.reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar o relatório do treinador.");
    } finally {
      setReportBusy(false);
    }
  };

  useEffect(() => {
    if (!live || !playing || !hasAnalysis) return;
    const tick = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const response = await apiRequest<{ reply: string }>("/api/v1/ai/vision-coach/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId, currentTime: timeRef.current, windowSeconds: LIVE_WINDOW_SECONDS }),
        });
        setNotes((current) => [{ t: timeRef.current, text: response.reply }, ...current].slice(0, LIVE_NOTES_LIMIT));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "A análise ao vivo foi interrompida.");
        setLive(false);
      } finally {
        busyRef.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), LIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [live, playing, hasAnalysis, videoId]);

  return <div className="vision-coach">
    <div className="coach-toolbar">
      <button type="button" className="marker-ai-button" disabled={reportBusy || !hasAnalysis} onClick={() => void requestReport()}>
        <Sparkles size={14} />{reportBusy ? "Analisando o vídeo…" : "Relatório do treinador"}
      </button>
      <button type="button" className={`marker-ai-button ${live ? "active" : ""}`} disabled={!hasAnalysis} aria-pressed={live} onClick={() => { setError(""); setLive((value) => !value); }}>
        <Radio size={14} />{live ? (playing ? "Ao vivo · comentando" : "Ao vivo · pause para retomar") : "Análise ao vivo"}
      </button>
      {engine ? <em className="coach-engine">IA sobre {engine}</em> : null}
    </div>
    {error ? <div className="ai-summary ai-summary-error" role="alert">{error}</div> : null}
    {report ? <div className="ai-summary" role="status"><b>Relatório do treinador de seleção</b><p>{report}</p></div> : null}
    {live ? <div className="coach-live-feed" aria-live="polite">
      {notes.length
        ? notes.map((note) => <button type="button" className="coach-live-entry" key={`${note.t}-${note.text.slice(0, 12)}`} onClick={() => seek(note.t)}>
            <span>{note.t.toFixed(1)}s</span><p>{note.text}</p>
          </button>)
        : <p className="coach-live-empty">Dê play: a cada janela de {LIVE_WINDOW_SECONDS} s o treinador comenta o que os dados mostram agora.</p>}
    </div> : null}
  </div>;
}
