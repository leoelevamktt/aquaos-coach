"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, Calendar, Database, Download, Dumbbell, Eye, FileText, Film, History,
  Layers, LoaderCircle, Pencil, Plus, Search, ShieldCheck, Target, Trash2, Trophy,
  Upload, UserRound, Users, Waves, Settings,
} from "lucide-react";
import { apiRequest, importFile, uploadFile } from "./api";
import { ModalShell } from "./components";

type RecordValue = Record<string, unknown> & { id: string; createdAt?: string; updatedAt?: string; status?: string; name?: string; title?: string };
export type ManagementKind = "athletes" | "groups" | "workouts" | "seasons" | "meets" | "videos" | "documents" | "staff" | "zones" | "goals" | "activities" | "settings";
type Kind = ManagementKind;

const modules: { id: Kind; label: string; icon: typeof Users; fields: { key: string; label: string; type?: "date" | "number" | "select"; options?: string[] }[] }[] = [
  { id: "athletes", label: "Atletas", icon: UserRound, fields: [{ key: "name", label: "Nome" }, { key: "email", label: "E-mail" }, { key: "handle", label: "@usuário" }, { key: "group", label: "Grupo" }, { key: "stroke", label: "Especialidade" }, { key: "status", label: "Status", type: "select", options: ["active", "invited", "inactive"] }] },
  { id: "groups", label: "Grupos", icon: Users, fields: [{ key: "name", label: "Nome" }, { key: "color", label: "Cor" }, { key: "members", label: "Membros", type: "number" }, { key: "status", label: "Status", type: "select", options: ["active", "archived"] }] },
  { id: "workouts", label: "Treinos", icon: Waves, fields: [{ key: "title", label: "Título" }, { key: "date", label: "Data", type: "date" }, { key: "distanceMeters", label: "Distância (m)", type: "number" }, { key: "zone", label: "Zona" }, { key: "status", label: "Status", type: "select", options: ["draft", "published", "completed", "archived"] }] },
  { id: "seasons", label: "Temporadas", icon: Calendar, fields: [{ key: "name", label: "Nome" }, { key: "startsOn", label: "Início", type: "date" }, { key: "endsOn", label: "Fim", type: "date" }, { key: "status", label: "Status", type: "select", options: ["planning", "active", "completed", "archived"] }] },
  { id: "meets", label: "Competições", icon: Trophy, fields: [{ key: "name", label: "Nome" }, { key: "startsOn", label: "Data", type: "date" }, { key: "priority", label: "Prioridade", type: "select", options: ["A", "B", "C"] }, { key: "pool", label: "Piscina" }, { key: "status", label: "Status", type: "select", options: ["planned", "open", "completed", "archived"] }] },
  { id: "videos", label: "Vídeos", icon: Film, fields: [{ key: "title", label: "Título" }, { key: "athleteId", label: "Atleta" }, { key: "event", label: "Prova/sessão" }, { key: "status", label: "Status", type: "select", options: ["processing", "ready", "reviewed", "archived"] }] },
  { id: "documents", label: "Documentos", icon: FileText, fields: [{ key: "title", label: "Título" }, { key: "category", label: "Categoria" }, { key: "status", label: "Status", type: "select", options: ["ready", "archived"] }] },
  { id: "staff", label: "Comissão", icon: ShieldCheck, fields: [{ key: "name", label: "Nome" }, { key: "email", label: "E-mail" }, { key: "role", label: "Função" }, { key: "access", label: "Acesso", type: "select", options: ["full", "write", "read"] }, { key: "status", label: "Status", type: "select", options: ["active", "invited", "inactive"] }] },
  { id: "zones", label: "Zonas", icon: Layers, fields: [{ key: "name", label: "Nome" }, { key: "code", label: "Código" }, { key: "pace", label: "Ritmo" }, { key: "color", label: "Cor" }, { key: "status", label: "Status", type: "select", options: ["active", "retired"] }] },
  { id: "goals", label: "Metas", icon: Target, fields: [{ key: "name", label: "Nome" }, { key: "athleteId", label: "Atleta" }, { key: "event", label: "Prova" }, { key: "targetTime", label: "Marca-meta" }, { key: "status", label: "Status", type: "select", options: ["active", "achieved", "archived"] }] },
  { id: "activities", label: "Atividades", icon: Activity, fields: [{ key: "title", label: "Título" }, { key: "athleteId", label: "Atleta" }, { key: "source", label: "Origem" }, { key: "distanceMeters", label: "Distância (m)", type: "number" }, { key: "status", label: "Status" }] },
  { id: "settings", label: "Parâmetros", icon: Settings, fields: [{ key: "name", label: "Nome" }, { key: "organizationName", label: "Organização" }, { key: "locale", label: "Idioma" }, { key: "primaryPool", label: "Piscina principal" }, { key: "loadEngine", label: "Motor de carga" }, { key: "status", label: "Status" }] },
];

const labelOf = (record: RecordValue) => String(record.name ?? record.title ?? record.originalName ?? record.id);
/**
 * Os status chegam da API em inglês e alimentam a classe CSS do marcador; aqui
 * traduzimos só o texto visível, para a tabela não destoar do resto da interface.
 */
const STATUS_LABELS: Record<string, string> = {
  active: "Ativo", inactive: "Inativo", invited: "Convidado", archived: "Arquivado",
  draft: "Rascunho", published: "Publicado", completed: "Concluído", planning: "Planejamento",
  planned: "Planejado", open: "Aberto", processing: "Processando", ready: "Pronto",
  reviewed: "Revisado", retired: "Descontinuado", achieved: "Alcançado",
  sent: "Enviado", pending: "Pendente", failed: "Falhou", synced: "Sincronizado",
};
const statusLabel = (value?: unknown) => {
  const key = String(value ?? "active");
  return STATUS_LABELS[key] ?? key;
};
/** Rótulo visível das opções de um select; o valor enviado à API continua em inglês. */
const ACCESS_LABELS: Record<string, string> = { full: "Total", write: "Edição", read: "Leitura" };
const optionLabel = (value: string) => ACCESS_LABELS[value] ?? STATUS_LABELS[value] ?? value;
const dateOf = (value?: string) => {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : value;
};

export function ManagementCenter({ onClose, onNotify, initialKind = "athletes", createOnOpen = false }: { onClose: () => void; onNotify: (message: string) => void; initialKind?: ManagementKind; createOnOpen?: boolean }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [records, setRecords] = useState<RecordValue[]>([]);
  const [audit, setAudit] = useState<RecordValue[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RecordValue | null>(createOnOpen ? { id: "" } : null);
  const [viewing, setViewing] = useState<RecordValue | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const module = modules.find((item) => item.id === kind) ?? modules[0];

  const load = async (selected = kind) => {
    setLoading(true);
    try {
      const [items, history] = await Promise.all([apiRequest<{ data: RecordValue[] }>(`/api/v1/manage/${selected}`), apiRequest<{ data: RecordValue[] }>("/api/v1/manage/audit?limit=25")]);
      setRecords(items.data); setAudit(history.data);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Falha ao carregar gestão"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(kind); }, [kind]);

  const filtered = useMemo(() => records.filter((record) => JSON.stringify(record).toLowerCase().includes(query.toLowerCase())), [records, query]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget).entries());
    const numeric = module.fields.filter((field) => field.type === "number");
    for (const field of numeric) if (data[field.key] !== "") data[field.key] = Number(data[field.key]);
    try {
      if (editing?.id) await apiRequest(`/api/v1/manage/${kind}/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      else await apiRequest(`/api/v1/manage/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      setEditing(null); onNotify(editing?.id ? "Registro atualizado e auditado." : "Registro criado e auditado."); await load();
    } catch (error) { onNotify(error instanceof Error ? error.message : "Não foi possível salvar"); }
  };
  const remove = async (record: RecordValue) => {
    if (!window.confirm(`Excluir “${labelOf(record)}”? A ação ficará na auditoria.`)) return;
    try { await apiRequest(`/api/v1/manage/${kind}/${record.id}`, { method: "DELETE" }); onNotify("Registro excluído."); await load(); } catch (error) { onNotify(error instanceof Error ? error.message : "Não foi possível excluir"); }
  };
  const handleImport = async (file?: File) => {
    if (!file) return;
    try { const result = await importFile(file, kind); onNotify(`${result.imported} registro(s) importado(s).`); await load(); } catch (error) { onNotify(error instanceof Error ? error.message : "Falha na importação"); }
  };
  const handleUpload = async (file?: File) => {
    if (!file) return;
    try { await uploadFile(file, kind === "videos" ? "videos" : "documents"); onNotify("Arquivo armazenado com sucesso."); await load(); } catch (error) { onNotify(error instanceof Error ? error.message : "Falha no upload"); }
  };

  return <ModalShell title="Central de gestão" subtitle="Cadastros, arquivos, integrações e auditoria em um só lugar" onClose={onClose} wide className="management-modal">
    <div className="management-shell">
      <aside className="management-nav"><span>OBJETOS DO PROGRAMA</span>{modules.map((item) => <button type="button" key={item.id} className={kind === item.id ? "active" : ""} onClick={() => { setKind(item.id); setViewing(null); setEditing(null); }}><item.icon size={15} /><b>{item.label}</b><small>{kind === item.id ? records.length : ""}</small></button>)}</aside>
      <section className="management-main">
        <div className="management-toolbar"><div><h3>{module.label}</h3><p>{records.length} registros · persistência e auditoria ativas</p></div><div className="local-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar registros" /></div><input ref={importInput} hidden type="file" accept=".csv,.json,.fit" onChange={(event) => void handleImport(event.target.files?.[0])} /><button className="secondary-button" onClick={() => importInput.current?.click()}><Download size={15} />Importar</button>{(kind === "videos" || kind === "documents") && <><input ref={uploadInput} hidden type="file" accept={kind === "videos" ? "video/*" : ".pdf,.doc,.docx,.xls,.xlsx,.csv,.json,image/*"} onChange={(event) => void handleUpload(event.target.files?.[0])} /><button className="secondary-button" onClick={() => uploadInput.current?.click()}><Upload size={15} />Upload</button></>}<button className="primary-button" onClick={() => setEditing({ id: "" })}><Plus size={15} />Novo</button></div>
        {loading ? <div className="management-loading"><LoaderCircle size={24} className="spin" />Carregando registros…</div> : <div className="management-table"><div className="management-head"><span>REGISTRO</span><span>STATUS</span><span>ATUALIZAÇÃO</span><span>AÇÕES</span></div>{filtered.map((record) => <div className="management-row" key={record.id}><span className="management-record"><b>{labelOf(record)}</b><small>{String(record.email ?? record.event ?? record.role ?? record.source ?? record.filename ?? record.id)}</small></span><span className="management-status"><i className={`record-status ${record.status ?? "active"}`} />{statusLabel(record.status)}</span><span className="management-updated"><small>Atualizado</small>{dateOf(record.updatedAt)}</span><span className="management-actions"><button title="Ver" aria-label={`Ver ${labelOf(record)}`} onClick={() => setViewing(record)}><Eye size={17} /><em>Ver</em></button><button title="Editar" aria-label={`Editar ${labelOf(record)}`} onClick={() => setEditing(record)}><Pencil size={17} /><em>Editar</em></button><button title="Excluir" aria-label={`Excluir ${labelOf(record)}`} className="danger" onClick={() => void remove(record)}><Trash2 size={17} /><em>Excluir</em></button></span></div>)}{!filtered.length && <div className="management-empty"><Database size={24} /><b>Nenhum registro encontrado</b><p>Crie, importe ou ajuste os filtros.</p></div>}</div>}
      </section>
      <aside className="management-audit"><div><History size={16} /><b>Atividade recente</b></div>{audit.slice(0, 8).map((entry) => <article key={entry.id}><i /><span><b>{String(entry.summary)}</b><small>{dateOf(entry.createdAt)}</small></span></article>)}</aside>
    </div>
    {editing && <div className="nested-panel"><div className="nested-panel-head"><div><h3>{editing.id ? "Editar registro" : `Novo em ${module.label}`}</h3><p>Campos principais e controle operacional</p></div><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Fechar</button></div><form onSubmit={(event) => void save(event)}><div className="form-grid">{module.fields.map((field) => <label key={field.key}><span>{field.label}</span>{field.type === "select" ? <select name={field.key} defaultValue={String(editing[field.key] ?? field.options?.[0] ?? "")}>{field.options?.map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}</select> : <input name={field.key} type={field.type ?? "text"} defaultValue={String(editing[field.key] ?? "")} required={field.key === "name" || field.key === "title"} />}</label>)}</div><div className="nested-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-button">Salvar registro</button></div></form></div>}
    {viewing && <div className="nested-panel record-view"><div className="nested-panel-head"><div><h3>{labelOf(viewing)}</h3><p>ID {viewing.id}</p></div><button type="button" className="secondary-button" onClick={() => setViewing(null)}>Fechar</button></div><div className="record-details">{Object.entries(viewing).filter(([key]) => !["id", "createdAt", "updatedAt", "analysis"].includes(key)).map(([key, value]) => <div key={key}><span>{key}</span><b>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}</b></div>)}</div></div>}
  </ModalShell>;
}
