"use client";

import { useState, type FormEvent } from "react";
import { CircleCheck, Dumbbell, FileText, Save, Send, Waves } from "lucide-react";
import { ModalShell } from "./components";
import { apiRequest } from "./api";

export type WorkoutSeed = {
  id?: string;
  persistedId?: string;
  title: string;
  prompt: string;
  distanceMeters: number;
  zone: string;
  kind: "swim" | "strength";
  scheduledAt?: string;
  target?: string;
  source?: string;
};

export function WorkoutTemplateEditor({ initial, onClose, onUse, onNotify, onSaved }: {
  initial?: WorkoutSeed;
  onClose: () => void;
  onUse: (seed: WorkoutSeed) => void;
  onNotify: (message: string) => void;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<"swim" | "strength">(initial?.kind ?? "swim");
  const [distance, setDistance] = useState(String(initial?.distanceMeters ?? 0));
  const [zone, setZone] = useState(initial?.zone ?? "A1");
  const [content, setContent] = useState(initial?.prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const seed = (): WorkoutSeed => ({
    title: title.trim(),
    prompt: content.trim(),
    distanceMeters: Math.max(0, Number(distance) || 0),
    zone: kind === "strength" ? "FORÇA" : zone,
    kind,
  });

  const valid = title.trim().length >= 3 && content.trim().length >= 10;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) { setError("Informe um título e descreva ao menos um bloco do modelo."); return; }
    setSaving(true); setError("");
    const draft = seed();
    try {
      const payload = {
          id: initial?.id,
          title: draft.title,
          kind: draft.kind,
          distanceMeters: draft.distanceMeters,
          zone: draft.zone,
          prescriptionText: draft.prompt,
          blocks: draft.prompt.split("\n").map((line) => line.trim()).filter(Boolean),
          source: "library",
          status: "template",
        };
      if (initial?.id) {
        const listing = await apiRequest<{ data: Array<{ id: string }> }>("/api/v1/manage/workouts");
        if (listing.data.some((item) => item.id === initial.id)) {
          await apiRequest(`/api/v1/manage/workouts/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        } else {
          await apiRequest("/api/v1/manage/workouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        }
      } else {
        await apiRequest("/api/v1/manage/workouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      onSaved?.();
      onNotify("Modelo salvo na biblioteca com trilha de auditoria.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo.");
    } finally { setSaving(false); }
  };

  return <ModalShell title={initial ? "Editar modelo de treino" : "Novo modelo de treino"} subtitle="Biblioteca técnica do programa" onClose={onClose} wide>
    <form className="library-editor" onSubmit={(event) => void save(event)}>
      <div className="library-editor-lead">
        <span>{kind === "swim" ? <Waves size={22} /> : <Dumbbell size={22} />}</span>
        <div><b>Modelo reutilizável</b><p>Edite a estrutura, salve na biblioteca ou envie uma cópia para o calendário sem alterar o original.</p></div>
      </div>
      <div className="form-grid library-editor-fields">
        <label className="wide"><span>Título do modelo</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Ritmo de 200 com fechamento forte" /></label>
        <label><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value as "swim" | "strength")}><option value="swim">Natação</option><option value="strength">Força</option></select></label>
        <label><span>{kind === "swim" ? "Metragem total" : "Duração estimada"}</span><input inputMode="numeric" value={distance} onChange={(event) => setDistance(event.target.value)} /></label>
        {kind === "swim" && <label><span>Zona principal</span><select value={zone} onChange={(event) => setZone(event.target.value)}><option>VALAT</option><option>A1</option><option>A2</option><option>A3</option><option>AN1</option><option>AN2</option></select></label>}
        <label className={kind === "swim" ? "" : "wide"}><span>Estado</span><input readOnly value="Modelo da biblioteca" /></label>
        <label className="wide"><span>Estrutura do treino</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={kind === "swim" ? "Um bloco por linha: repetições, distância, nado, intervalo, zona e observações" : "Um exercício por linha: séries, repetições, carga e observações"} /></label>
      </div>
      <div className="library-editor-status"><FileText size={17} /><span><b>{content.split("\n").filter((line) => line.trim()).length} blocos descritos</b><small>O editor preserva o texto original e a versão publicada.</small></span>{valid && <CircleCheck size={18} />}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-footer inline"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="secondary-button" disabled={saving || !valid}><Save size={16} />{saving ? "Salvando" : "Salvar modelo"}</button><button type="button" className="primary-button" disabled={!valid} onClick={() => onUse(seed())}><Send size={16} />Usar no calendário</button></footer>
    </form>
  </ModalShell>;
}
