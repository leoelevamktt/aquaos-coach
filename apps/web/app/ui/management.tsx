"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity, Calendar, Database, Download, Dumbbell, Eye, FileText, Film, Gauge, HeartPulse, History,
  Layers, LoaderCircle, Pencil, Plus, RefreshCw, Search, ShieldCheck, Target, Trash2, TrendingUp, Trophy,
  Upload, UserRound, Users, Watch, Waves, Settings,
} from "lucide-react";
import { apiRequest, importFile, mediaUrl, uploadFile } from "./api";
import { ModalShell } from "./components";

type RecordValue = Record<string, unknown> & { id: string; createdAt?: string; updatedAt?: string; status?: string; name?: string; title?: string };
export type ManagementKind = "athletes" | "groups" | "workouts" | "seasons" | "meets" | "videos" | "documents" | "staff" | "zones" | "goals" | "activities" | "settings" | "teams" | "athleteProfiles" | "athleteCalibrations" | "trainingZones" | "macrocycles" | "mesocycles" | "microcycles" | "trainingSessions" | "sessionBlocks" | "sessionPrescriptions" | "prescriptionBlocks" | "sessionExecutions" | "athleteResponses" | "deviceSamples" | "readinessScores" | "performanceBenchmarks" | "evolutionAssessments" | "loadCalculations" | "syncJobs" | "trainingIngestions" | "trainingSourceAssets" | "trainingExtractions" | "trainingReviewItems" | "importedTrainingSessions" | "importedTrainingBlocks" | "athleteSessionAssignments" | "rkfMaterials" | "rkfSkills" | "rkfRules" | "rkfExercises" | "rkfBlockSummaries" | "sessionResults" | "setResults" | "repetitionResults" | "splitResults" | "rkfCatalog";
type Kind = ManagementKind;

type ManagementModule = { id: Kind; label: string; icon: typeof Users; readOnly?: boolean; source?: "imported"; collection?: "catalog"; fields: { key: string; label: string; type?: "date" | "number" | "select"; options?: string[] }[] };
const modules: ManagementModule[] = [
  { id: "rkfCatalog", label: "Acervo mestre RKF", icon: Database, readOnly: true, source: "imported", collection: "catalog", fields: [] },
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
  { id: "teams", label: "Equipes", icon: Users, fields: [{ key: "name", label: "Nome" }, { key: "poolLength", label: "Piscina" }, { key: "inviteCode", label: "Código de convite" }, { key: "status", label: "Status" }] },
  { id: "macrocycles", label: "Macrociclos", icon: Layers, fields: [{ key: "name", label: "Nome" }, { key: "startsOn", label: "Início", type: "date" }, { key: "endsOn", label: "Fim", type: "date" }, { key: "focus", label: "Foco" }, { key: "status", label: "Status" }] },
  { id: "mesocycles", label: "Mesociclos", icon: Calendar, fields: [{ key: "name", label: "Nome" }, { key: "startsOn", label: "Início", type: "date" }, { key: "endsOn", label: "Fim", type: "date" }, { key: "focus", label: "Foco" }, { key: "status", label: "Status" }] },
  { id: "microcycles", label: "Microciclos", icon: Calendar, fields: [{ key: "name", label: "Nome" }, { key: "date", label: "Data", type: "date" }, { key: "loadTarget", label: "Carga-alvo", type: "number" }, { key: "status", label: "Status" }] },
  { id: "trainingSessions", label: "Sessões normalizadas", icon: Waves, readOnly: true, fields: [{ key: "title", label: "Título" }, { key: "distanceMeters", label: "Distância (m)", type: "number" }, { key: "sessionType", label: "Tipo" }, { key: "objective", label: "Objetivo" }, { key: "status", label: "Status" }] },
  { id: "sessionBlocks", label: "Blocos de sessão", icon: Layers, readOnly: true, fields: [{ key: "name", label: "Nome" }, { key: "sessionId", label: "Sessão" }, { key: "order", label: "Ordem", type: "number" }, { key: "distanceMeters", label: "Distância (m)", type: "number" }, { key: "status", label: "Status" }] },
  { id: "sessionPrescriptions", label: "Prescrições por sessão", icon: FileText, readOnly: true, fields: [{ key: "title", label: "Título" }, { key: "sessionId", label: "Sessão" }, { key: "totalVolumeM", label: "Volume (m)", type: "number" }, { key: "primaryZone", label: "Zona primária" }, { key: "status", label: "Status" }] },
  { id: "prescriptionBlocks", label: "Unidades de prescrição", icon: Layers, readOnly: true, fields: [{ key: "sessionId", label: "Sessão" }, { key: "blockId", label: "Bloco" }, { key: "repetitions", label: "Repetições", type: "number" }, { key: "distanceMeters", label: "Distância (m)", type: "number" }, { key: "status", label: "Status" }] },
  { id: "trainingSourceAssets", label: "Fontes RKF", icon: FileText, readOnly: true, fields: [{ key: "title", label: "Arquivo" }, { key: "rows", label: "Linhas", type: "number" }, { key: "sizeBytes", label: "Tamanho", type: "number" }, { key: "sha256", label: "SHA-256" }, { key: "status", label: "Status" }] },
  { id: "trainingReviewItems", label: "Auditoria de normalização", icon: ShieldCheck, readOnly: true, fields: [{ key: "title", label: "Registro" }, { key: "sessionId", label: "Sessão" }, { key: "normalizedBlocks", label: "Blocos", type: "number" }, { key: "normalizationMethod", label: "Método" }, { key: "status", label: "Status" }] },
  { id: "rkfBlockSummaries", label: "Resumos de blocos", icon: Gauge, readOnly: true, fields: [{ key: "title", label: "Registro" }, { key: "sessionId", label: "Sessão" }, { key: "blockCount", label: "Blocos", type: "number" }, { key: "blockDistanceMeters", label: "Volume (m)", type: "number" }, { key: "status", label: "Status" }] },
  { id: "rkfMaterials", label: "Materiais RKF", icon: Dumbbell, readOnly: true, fields: [{ key: "name", label: "Material" }, { key: "code", label: "Código" }, { key: "category", label: "Categoria" }, { key: "primaryUse", label: "Uso principal" }, { key: "constraint", label: "Restrição RKF" }] },
  { id: "rkfSkills", label: "Habilidades RKF", icon: Target, readOnly: true, fields: [{ key: "name", label: "Habilidade" }, { key: "code", label: "Código" }, { key: "category", label: "Categoria" }, { key: "technicalSequence", label: "Sequência técnica" }] },
  { id: "rkfRules", label: "Regras RKF", icon: ShieldCheck, readOnly: true, fields: [{ key: "name", label: "Regra" }, { key: "code", label: "Código" }, { key: "severity", label: "Severidade" }, { key: "description", label: "Descrição" }] },
  { id: "rkfExercises", label: "Exercícios RKF", icon: Activity, readOnly: true, fields: [{ key: "name", label: "Exercício" }, { key: "code", label: "Código" }, { key: "category", label: "Categoria" }, { key: "strokeScope", label: "Nados" }, { key: "definition", label: "Definição" }] },
  { id: "trainingIngestions", label: "Ingestões normalizadas", icon: Download, readOnly: true, fields: [{ key: "title", label: "Entrada" }, { key: "channel", label: "Canal" }, { key: "state", label: "Estado" }, { key: "confidence", label: "Confiança", type: "number" }, { key: "status", label: "Status" }] },
  { id: "trainingExtractions", label: "Extrações estruturadas", icon: FileText, readOnly: true, fields: [{ key: "title", label: "Extração" }, { key: "ingestionId", label: "Ingestão" }, { key: "sourceName", label: "Origem" }, { key: "confidence", label: "Confiança", type: "number" }, { key: "status", label: "Status" }] },
  { id: "athleteSessionAssignments", label: "Atribuições de sessões", icon: UserRound, readOnly: true, fields: [{ key: "title", label: "Prescrição" }, { key: "athleteId", label: "Atleta" }, { key: "sessionId", label: "Sessão" }, { key: "assignmentStatus", label: "Estado" }, { key: "status", label: "Status" }] },
  { id: "sessionResults", label: "Resultados de sessão", icon: Trophy, readOnly: true, fields: [{ key: "event", label: "Evento" }, { key: "athleteId", label: "Atleta" }, { key: "date", label: "Data", type: "date" }, { key: "status", label: "Status" }] },
  { id: "setResults", label: "Resultados por série", icon: Layers, readOnly: true, fields: [{ key: "label", label: "Série" }, { key: "athleteId", label: "Atleta" }, { key: "sessionResultId", label: "Resultado da sessão" }] },
  { id: "repetitionResults", label: "Resultados por repetição", icon: Activity, readOnly: true, fields: [{ key: "repetition", label: "Repetição", type: "number" }, { key: "distanceM", label: "Distância (m)", type: "number" }, { key: "timeSeconds", label: "Tempo (s)", type: "number" }, { key: "athleteId", label: "Atleta" }] },
  { id: "splitResults", label: "Parciais de prova", icon: Gauge, readOnly: true, fields: [{ key: "distanceM", label: "Distância (m)", type: "number" }, { key: "timeSeconds", label: "Tempo (s)", type: "number" }, { key: "athleteId", label: "Atleta" }, { key: "repetitionResultId", label: "Repetição" }] },
  { id: "sessionExecutions", label: "Execuções", icon: Activity, fields: [{ key: "title", label: "Título" }, { key: "athleteId", label: "Atleta" }, { key: "date", label: "Data", type: "date" }, { key: "distanceMeters", label: "Distância (m)", type: "number" }, { key: "rpe", label: "RPE", type: "number" }, { key: "status", label: "Status" }] },
  { id: "athleteResponses", label: "Respostas", icon: Activity, fields: [{ key: "athleteId", label: "Atleta" }, { key: "date", label: "Data", type: "date" }, { key: "rpe", label: "RPE", type: "number" }, { key: "notes", label: "Notas" }, { key: "status", label: "Status" }] },
  { id: "deviceSamples", label: "Amostras wearable", icon: Watch, fields: [{ key: "athleteId", label: "Atleta" }, { key: "capturedAt", label: "Capturado em" }, { key: "metric", label: "Métrica" }, { key: "value", label: "Valor", type: "number" }, { key: "source", label: "Origem" }] },
  { id: "readinessScores", label: "Readiness", icon: HeartPulse, fields: [{ key: "athleteId", label: "Atleta" }, { key: "date", label: "Data", type: "date" }, { key: "score", label: "Score", type: "number" }, { key: "confidence", label: "Confiança", type: "number" }, { key: "source", label: "Origem" }] },
  { id: "performanceBenchmarks", label: "Benchmarks", icon: Target, fields: [{ key: "name", label: "Nome" }, { key: "athleteId", label: "Atleta" }, { key: "event", label: "Prova" }, { key: "time", label: "Marca" }, { key: "status", label: "Status" }] },
  { id: "evolutionAssessments", label: "Evolução", icon: TrendingUp, fields: [{ key: "name", label: "Nome" }, { key: "athleteId", label: "Atleta" }, { key: "date", label: "Data", type: "date" }, { key: "classification", label: "Classificação" }, { key: "status", label: "Status" }] },
  { id: "loadCalculations", label: "Cálculos de carga", icon: Gauge, fields: [{ key: "athleteId", label: "Atleta" }, { key: "date", label: "Data", type: "date" }, { key: "value", label: "Carga", type: "number" }, { key: "engineVersion", label: "Versão do motor" }, { key: "status", label: "Status" }] },
  { id: "syncJobs", label: "Jobs de sincronização", icon: RefreshCw, fields: [{ key: "provider", label: "Provedor" }, { key: "athleteId", label: "Atleta" }, { key: "direction", label: "Direção" }, { key: "status", label: "Status" }, { key: "externalId", label: "ID externo" }] },
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

const PAGE_SIZE = 100;

type CatalogSheetCount = { name: string; rows: number };
type CatalogResponse = { data: RecordValue[]; total?: number; offset?: number; limit?: number; sheets?: CatalogSheetCount[]; source?: { version?: string; packageHash?: string; importedAt?: string } };

export function ManagementCenter({ onClose, onNotify, initialKind = "athletes", createOnOpen = false }: { onClose: () => void; onNotify: (message: string) => void; initialKind?: ManagementKind; createOnOpen?: boolean }) {
  const normalizedInitialKind = modules.some((item) => item.id === initialKind) ? initialKind : "athletes";
  const [kind, setKind] = useState<Kind>(normalizedInitialKind);
  const [records, setRecords] = useState<RecordValue[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [audit, setAudit] = useState<RecordValue[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RecordValue | null>(createOnOpen && !modules.find((item) => item.id === normalizedInitialKind)?.readOnly ? { id: "" } : null);
  const [viewing, setViewing] = useState<RecordValue | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  // "rkfCatalog" navega o Catálogo Mestre importado; fallback explícito quando
  // initialKind inválido/futuro não corresponde a nenhum módulo conhecido.
  const module = modules.find((item) => item.id === kind) ?? modules.find((item) => item.id === "athletes")!;
  const isCatalog = module.collection === "catalog";
  const [catalogSheet, setCatalogSheet] = useState("ATLETAS");
  const catalogSheetRef = useRef("ATLETAS");
  const [catalogSheets, setCatalogSheets] = useState<{ name: string; rows: number }[]>([]);
  const catalogSheetTotals = Object.fromEntries(catalogSheets.map((sheet) => [sheet.name, sheet.rows])) as Record<string, number>;
  const [catalogSource, setCatalogSource] = useState<{ version?: string; packageHash?: string; importedAt?: string } | null>(null);
  const requestSeq = useRef(0);

  const load = async (selected = kind, selectedOffset = offset, search = query, sheet?: string) => {
    // Toda requisição recebe um número de série; respostas de chamadas antigas
    // (módulo/busca/página superssedados) são descartadas e não sobrescrevem o
    // estado atual, e o loading só termina com a última requisição.
    const requestId = ++requestSeq.current;
    const target = modules.find((item) => item.id === selected);
    const requestedQuery = search.trim();
    if (target?.collection === "catalog") {
      catalogSheetRef.current = sheet ?? catalogSheetRef.current;
    }
    setLoading(true);
    try {
      if (target?.collection === "catalog") {
        const catalog = await apiRequest<CatalogResponse>(`/api/v1/rkf/catalog?sheet=${encodeURIComponent(catalogSheetRef.current)}&q=${encodeURIComponent(requestedQuery)}&offset=${selectedOffset}&limit=${PAGE_SIZE}`);
        if (requestId !== requestSeq.current) return;
        setRecords(catalog.data);
        setTotal(catalog.total ?? catalog.data.length);
        setOffset(catalog.offset ?? selectedOffset);
        setCatalogSheets(catalog.sheets ?? []);
        setCatalogSource(catalog.source ?? null);
      } else {
        const params = `limit=${PAGE_SIZE}&offset=${selectedOffset}&q=${encodeURIComponent(requestedQuery)}`;
        const [items, history] = await Promise.all([
          apiRequest<{ data: RecordValue[]; total?: number; offset?: number; limit?: number }>(`/api/v1/manage/${selected}?${params}`),
          apiRequest<{ data: RecordValue[] }>("/api/v1/manage/audit?limit=25"),
        ]);
        if (requestId !== requestSeq.current) return;
        setRecords(items.data); setTotal(items.total ?? items.data.length); setOffset(items.offset ?? selectedOffset); setAudit(history.data);
      }
    } catch (error) { if (requestId === requestSeq.current) onNotify(error instanceof Error ? error.message : "Falha ao carregar gestão"); }
    finally { if (requestId === requestSeq.current) setLoading(false); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { setOffset(0); void load(kind, 0, query); }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [kind, query]);

  const filtered = records;
  const catalogCountLabel = `${total} ${total === 1 ? "registro" : "registros"}`;
  const catalogSearchLabel = `${total} ${total === 1 ? "resultado filtrado" : "resultados filtrados"}`;
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
    try {
      const record = await uploadFile(file, kind === "videos" ? "videos" : "documents");
      const extractionStatus = String(record.extractionStatus ?? "");
      onNotify(extractionStatus === "needs_ocr"
        ? "Arquivo preservado, mas sem texto detectado. OCR não está habilitado neste ambiente."
        : extractionStatus === "unsupported"
          ? "Arquivo preservado; este formato não possui extração automática."
          : record.extraction && typeof record.extraction === "object" && (record.extraction as { format?: string }).format === "zip"
            ? "ZIP inspecionado e conteúdo compatível extraído com segurança."
            : "Arquivo armazenado com sucesso.");
      await load();
    } catch (error) { onNotify(error instanceof Error ? error.message : "Falha no upload"); }
  };

  return <ModalShell title="Central de gestão" subtitle="Cadastros, arquivos, integrações e auditoria em um só lugar" onClose={onClose} wide className="management-modal">
    <div className="management-shell">
      <aside className="management-nav"><span>OBJETOS DO PROGRAMA</span>{modules.map((item) => <button type="button" key={item.id} className={kind === item.id ? "active" : ""} onClick={() => { setKind(item.id); setQuery(""); setOffset(0); setViewing(null); setEditing(null); }}><item.icon size={15} /><b>{item.label}</b><small>{kind === item.id ? total : ""}</small></button>)}</aside>
      <section className="management-main">
        <div className="management-toolbar"><div><h3>{module.label}{isCatalog ? <span className="management-source-lock catalog">Acervo importado · validação conforme registro</span> : module.readOnly ? <span className="management-source-lock">Fonte canônica</span> : null}</h3><p>{isCatalog ? (query.trim() ? `${catalogSearchLabel} de ${catalogSheetTotals[catalogSheet] ?? total} na aba ${catalogSheet}` : `${catalogCountLabel} na aba ${catalogSheet}`) : `${total} registros no banco`}{total ? ` · exibindo ${offset + 1}–${Math.min(offset + records.length, total)}` : ""}{query.trim() && !isCatalog ? ` · filtro “${query.trim()}”` : ""}</p>{isCatalog && catalogSource?.version && <small className="catalog-source">Acervo importado em {dateOf(catalogSource.importedAt)} · versão {catalogSource.version} · hash {String(catalogSource.packageHash ?? "-").slice(0, 12)}</small>}</div><div className="local-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar registros" /></div>{!module.readOnly&&<><input ref={importInput} hidden type="file" accept=".csv,.json,.xlsx,.zip,.fit,.txt" onChange={(event) => void handleImport(event.target.files?.[0])} /><button className="secondary-button" onClick={() => importInput.current?.click()}><Download size={15} />Importar</button>{(kind === "videos" || kind === "documents") && <><input ref={uploadInput} hidden type="file" accept={kind === "videos" ? "video/*" : ".pdf,.doc,.docx,.xls,.xlsx,.csv,.json,.zip,image/*"} onChange={(event) => void handleUpload(event.target.files?.[0])} /><button className="secondary-button" onClick={() => uploadInput.current?.click()}><Upload size={15} />Upload</button></>}<button className="primary-button" onClick={() => setEditing({ id: "" })}><Plus size={15} />Novo</button></>}</div>
        {isCatalog && catalogSheets.length > 0 && <div className="catalog-sheets" role="tablist" aria-label="Abas do Catálogo Mestre">{catalogSheets.map((sheet) => <button type="button" key={sheet.name} role="tab" aria-selected={catalogSheet === sheet.name} className={catalogSheet === sheet.name ? "active" : ""} onClick={() => { setCatalogSheet(sheet.name); catalogSheetRef.current = sheet.name; setQuery(""); setOffset(0); setViewing(null); setEditing(null); void load(kind, 0, "", sheet.name); }}><b>{sheet.name}</b><small>{sheet.rows}</small></button>)}</div>}
        {loading ? <div className="management-loading"><LoaderCircle size={24} className="spin" />Carregando registros…</div> : isCatalog ? <div className="management-table catalog-table"><div className="management-head"><span>REGISTRO</span><span>STATUS</span><span>ATUALIZAÇÃO</span><span>AÇÕES</span></div>{filtered.map((record) => <div className="management-row" key={record.id}><span className="management-record"><b>{labelOf(record)}</b><small>{String(record.id)}</small></span><span className="management-status"><i className={`record-status ${record.status ?? "active"}`} />{statusLabel(record.status)}</span><span className="management-updated"><small>Atualizado</small>{dateOf((record.payload as { updatedAt?: string } | undefined)?.updatedAt ?? record.updatedAt)}</span><span className="management-actions"><button title="Ver" aria-label={`Ver ${labelOf(record)}`} onClick={() => setViewing(record)}><Eye size={17} /><em>Ver</em></button></span></div>)}{!filtered.length && <div className="management-empty"><Database size={24} /><b>Nenhum registro encontrado</b><p>Crie, importe ou ajuste os filtros.</p></div>}</div> : <div className="management-table"><div className="management-head"><span>REGISTRO</span><span>STATUS</span><span>ATUALIZAÇÃO</span><span>AÇÕES</span></div>{filtered.map((record) => <div className="management-row" key={record.id}><span className="management-record"><b>{labelOf(record)}</b><small>{String(record.email ?? record.event ?? record.role ?? record.source ?? record.filename ?? record.id)}</small></span><span className="management-status"><i className={`record-status ${record.status ?? "active"}`} />{statusLabel(record.status)}</span><span className="management-updated"><small>Atualizado</small>{dateOf(record.updatedAt)}</span><span className="management-actions"><button title="Ver" aria-label={`Ver ${labelOf(record)}`} onClick={() => setViewing(record)}><Eye size={17} /><em>Ver</em></button>{!module.readOnly&&<><button title="Editar" aria-label={`Editar ${labelOf(record)}`} onClick={() => setEditing(record)}><Pencil size={17} /><em>Editar</em></button><button title="Excluir" aria-label={`Excluir ${labelOf(record)}`} className="danger" onClick={() => void remove(record)}><Trash2 size={17} /><em>Excluir</em></button></>}</span></div>)}{!filtered.length && <div className="management-empty"><Database size={24} /><b>Nenhum registro encontrado</b><p>Crie, importe ou ajuste os filtros.</p></div>}</div>}
        {!loading&&total>PAGE_SIZE&&<nav className="management-pagination" aria-label="Paginação dos registros"><button disabled={offset===0} onClick={()=>{const next=Math.max(0,offset-PAGE_SIZE);setOffset(next);void load(kind,next,query);}}>Página anterior</button><span>Página {Math.floor(offset/PAGE_SIZE)+1} de {Math.ceil(total/PAGE_SIZE)}</span><button disabled={offset+records.length>=total} onClick={()=>{const next=offset+PAGE_SIZE;setOffset(next);void load(kind,next,query);}}>Próxima página</button></nav>}
      </section>
      <aside className="management-audit"><div><History size={16} /><b>Atividade recente</b></div>{audit.slice(0, 8).map((entry) => <article key={entry.id}><i /><span><b>{String(entry.summary)}</b><small>{dateOf(entry.createdAt)}</small></span></article>)}</aside>
    </div>
     {editing && !module.readOnly && <div className="nested-panel"><div className="nested-panel-head"><div><h3>{editing.id ? "Editar registro" : `Novo em ${module.label}`}</h3><p>Campos principais e controle operacional</p></div><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Fechar</button></div><form key={`${kind}-${editing.id || "new"}`} onSubmit={(event) => void save(event)}><div className="form-grid">{module.fields.map((field) => <label key={field.key}><span>{field.label}</span>{field.type === "select" ? <select name={field.key} defaultValue={String(editing[field.key] ?? field.options?.[0] ?? "")}>{field.options?.map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}</select> : <input name={field.key} type={field.type ?? "text"} defaultValue={String(editing[field.key] ?? "")} required={field.key === "name" || field.key === "title"} />}</label>)}</div><div className="nested-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-button">Salvar registro</button></div></form></div>}
     {viewing && <div className="nested-panel record-view"><div className="nested-panel-head"><div><h3>{labelOf(viewing)}</h3><p>ID {viewing.id}</p></div><button type="button" className="secondary-button" onClick={() => setViewing(null)}>Fechar</button></div>{typeof viewing.url === "string" && <div className="record-media-preview">{String(viewing.mimeType ?? "").startsWith("video/") ? <video controls preload="metadata" src={mediaUrl(viewing.url)} poster={mediaUrl(typeof viewing.thumbnailUrl === "string" ? viewing.thumbnailUrl : undefined)} /> : String(viewing.mimeType ?? "").startsWith("image/") ? <img src={mediaUrl(viewing.url)} alt={labelOf(viewing)} /> : <div className="record-file-preview"><FileText size={22} /><span><b>Arquivo disponível</b><small>{String(viewing.originalName ?? viewing.filename ?? "Documento")}</small></span></div>}<a className="secondary-button" href={mediaUrl(viewing.url)} target="_blank" rel="noreferrer">Abrir arquivo</a></div>}<div className="record-details">{isCatalog
        ? Object.entries({ sheet: viewing.sheet, ...(viewing.payload ?? {}) } as Record<string, unknown>).map(([key, value]) => <div key={key}><span>{key}</span><b>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}</b></div>)
        : Object.entries(viewing).filter(([key]) => !["id", "createdAt", "updatedAt", "analysis", "url", "thumbnailUrl"].includes(key)).map(([key, value]) => <div key={key}><span>{key}</span><b>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}</b></div>)}</div></div>}
  </ModalShell>;
}
