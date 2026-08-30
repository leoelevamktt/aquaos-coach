"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BookOpenCheck, Check, ChevronRight, CircleCheck,
  ClipboardCheck, Database, FileUp, Gauge, History, Layers3, LoaderCircle, LockKeyhole,
  Mic, Network, RefreshCw, Save, ShieldCheck, Sparkles, Upload, Waves,
} from "lucide-react";
import { apiRequest, uploadFile } from "./api";
import { PageTitle, SectionHead } from "./components";

type Tab = "command" | "load" | "prescription" | "ingestion" | "governance";
type Bootstrap = {
  program: { name: string; version: string; mode: string };
  athlete: { id: string; name: string; age: number; specialty: string; readiness: number };
  load: {
    layers: { layers: { prescribed: { volumeM?: number } | null; executed: { volumeM?: number } | null; internal: { loadUa: number | null } | null }; adherence: { volumeAdherencePct: number | null } };
    latest: { atl: number | null; ctl: number | null; tsb: number | null; coldStart: { stage: string; confidence: number; distinctActiveDays: number } };
    monotony: { monotony: number | null; strain: number | null; status: string };
    alerts: { code: string; detail: string }[];
    convention: string;
  };
  adaptation: { class: string; adaptedVolumeM: number; primaryZone: string; status: string; version: string };
  response: { responseScore: number; completeness: number; status: string };
  ingestion: { pendingReview: number; total: number };
  prescriptions: { pendingApproval: number; published: number };
  seed: { expectedSessions: number; expectedBlocks: number; packageLocated: boolean; staged: boolean; imported: boolean; status: string; packageHash: string | null; reason: string };
  featureFlags: Record<string, boolean>;
  gates: { id: string; label: string; status: string }[];
  provenance: { label: string };
};

type Ingestion = {
  id: string; title: string; channel: string; state: string; status: string; confidence: number;
  originalHash: string; version: number; updatedAt: string; requiresHumanReview: boolean;
};

type Prescription = {
  id: string; title: string; athleteId: string; status: string; immutable: boolean; updatedAt: string;
  prescription?: { totalVolumeM?: number; primaryZone?: string; blocks?: Array<{ component: string; volumeM: number; zone: string; prescriptionText: string }> };
};

const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "command", label: "Comando", icon: Network },
  { id: "load", label: "Controle de carga", icon: Activity },
  { id: "prescription", label: "Prescritor", icon: ClipboardCheck },
  { id: "ingestion", label: "Ingestão", icon: FileUp },
  { id: "governance", label: "Governança", icon: ShieldCheck },
];

const formatNumber = (value: number | null | undefined, suffix = "") => value === null || value === undefined
  ? "Dados insuficientes"
  : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}${suffix}`;

function Status({ value }: { value: string }) {
  const tone = value === "PASS" || value === "PUBLISHED" || value === "CONFIRMED" || value === "PRONTO" || value === "IMPORTED" ? "ok" : value === "BLOCKED" || value === "AGUARDAR_TREINADOR" ? "blocked" : "review";
  return <span className={`rkf-status ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

export function RkfOperations({ onNotify }: { onNotify: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("command");
  const [data, setData] = useState<Bootstrap>();
  const [ingestions, setIngestions] = useState<Ingestion[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const [bootstrap, ingestionList, prescriptionList] = await Promise.all([
        apiRequest<Bootstrap>("/api/v1/rkf/bootstrap"),
        apiRequest<{ data: Ingestion[] }>("/api/v1/rkf/ingestions"),
        apiRequest<{ data: Prescription[] }>("/api/v1/rkf/prescriptions"),
      ]);
      setData(bootstrap); setIngestions(ingestionList.data); setPrescriptions(prescriptionList.data); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Falha ao carregar o núcleo RKF"); }
  };
  useEffect(() => {
    void apiRequest("/api/v1/auth/me")
      .catch(() => process.env.NODE_ENV !== "production" ? apiRequest("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "coach@natacao.local", password: "natacao-demo" }) }) : undefined)
      .then(() => refresh());
  }, []);

  if (!data) return <div className="rkf-loading"><LoaderCircle className="spin" size={24} /><strong>{error || "Carregando núcleo RKF V5.1"}</strong>{error && <button className="secondary-button" onClick={() => void refresh()}>Tentar novamente</button>}</div>;

  return <>
    <PageTitle kicker="NÚCLEO METODOLÓGICO · RKF V5.1" title="Centro de decisão esportiva" subtitle="Prescrição, carga, prontidão e governança reunidas em uma operação auditável.">
      <span className="rkf-validation-label"><Sparkles size={15} />Ambiente de validação</span>
      <button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16} />Atualizar</button>
    </PageTitle>
    <div className="rkf-provenance"><ShieldCheck size={17} /><span><strong>Origem declarada</strong>{data.provenance.label}</span></div>
    <nav className="rkf-tabs" aria-label="Módulos RKF">
      {tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><item.icon size={17} />{item.label}</button>)}
    </nav>

    {tab === "command" && <Command data={data} setTab={setTab} ingestions={ingestions} prescriptions={prescriptions} />}
    {tab === "load" && <LoadControl data={data} />}
    {tab === "prescription" && <PrescriptionStudio data={data} prescriptions={prescriptions} busy={busy} setBusy={setBusy} refresh={refresh} onNotify={onNotify} />}
    {tab === "ingestion" && <IngestionStudio ingestions={ingestions} busy={busy} setBusy={setBusy} refresh={refresh} onNotify={onNotify} />}
    {tab === "governance" && <Governance data={data} busy={busy} setBusy={setBusy} refresh={refresh} onNotify={onNotify} />}
  </>;
}

function Command({ data, setTab, ingestions, prescriptions }: { data: Bootstrap; setTab: (tab: Tab) => void; ingestions: Ingestion[]; prescriptions: Prescription[] }) {
  const last = data.load.latest;
  return <div className="rkf-command-grid">
    <section className="rkf-command-hero">
      <span className="rkf-kicker">DECISÃO DO DIA</span>
      <div className="rkf-command-heading"><div><h2>{data.athlete.name}</h2><p>{data.athlete.age} anos · {data.athlete.specialty.replace("_", " ")} · Piscina 50 m</p></div><strong>{data.athlete.readiness}<small>/100</small></strong></div>
      <div className="rkf-decision"><span><Gauge size={19} /></span><div><small>RECOMENDAÇÃO DO MOTOR</small><h3>{data.adaptation.class.replaceAll("_", " ")}</h3><p>{formatNumber(data.adaptation.adaptedVolumeM, " m")} em {data.adaptation.primaryZone}, sujeita à decisão final do treinador.</p></div><Status value={data.adaptation.status} /></div>
      <div className="rkf-command-actions"><button className="primary-button" onClick={() => setTab("prescription")}>Abrir prescritor <ArrowRight size={16} /></button><button className="secondary-button" onClick={() => setTab("load")}>Revisar carga</button></div>
    </section>
    <section className="rkf-readout-grid">
      <article><small>RESPOSTA INDIVIDUAL</small><strong>{formatNumber(data.response.responseScore)}</strong><span>Completude {Math.round(data.response.completeness * 100)}%</span></article>
      <article><small>COLD START</small><strong>{last.coldStart.stage}</strong><span>{last.coldStart.distinctActiveDays} dias ativos · confiança {Math.round(last.coldStart.confidence * 100)}%</span></article>
      <article><small>ATL / CTL</small><strong>{formatNumber(last.atl)} / {formatNumber(last.ctl)}</strong><span>TSB {formatNumber(last.tsb)}</span></article>
      <article><small>ADERÊNCIA</small><strong>{formatNumber(data.load.layers.adherence.volumeAdherencePct, "%")}</strong><span>Prescrito versus realizado</span></article>
    </section>
    <section className="card rkf-work-queue">
      <SectionHead title="Fila operacional" subtitle="Pendências que exigem uma ação humana" />
      <button onClick={() => setTab("prescription")}><span className="rkf-queue-icon"><ClipboardCheck size={18} /></span><span><strong>{prescriptions.filter((item) => item.status === "PENDING_APPROVAL").length} prescrições para aprovar</strong><small>A versão só se torna imutável após aprovação do treinador.</small></span><ChevronRight size={18} /></button>
      <button onClick={() => setTab("ingestion")}><span className="rkf-queue-icon"><FileUp size={18} /></span><span><strong>{ingestions.filter((item) => item.state === "REVIEW").length} ingestões em revisão</strong><small>Confira campos críticos, confiança e hash do original.</small></span><ChevronRight size={18} /></button>
      <button onClick={() => setTab("governance")}><span className="rkf-queue-icon warning">{data.seed.staged ? <Database size={18} /> : <AlertTriangle size={18} />}</span><span><strong>{data.seed.staged ? "Seed canônico conferido em staging" : "Seed canônico bloqueado"}</strong><small>{data.seed.reason}</small></span><ChevronRight size={18} /></button>
    </section>
    <section className="card rkf-method-map">
      <SectionHead title="Fluxo de decisão" subtitle="O score nunca supera uma regra obrigatória" />
      <div>{["Contexto", "Hard rules", "Composição", "Auditoria", "Aprovação", "Publicação"].map((label, index) => <span key={label}><i>{index + 1}</i><b>{label}</b>{index < 5 && <ChevronRight size={14} />}</span>)}</div>
    </section>
  </div>;
}

function LoadControl({ data }: { data: Bootstrap }) {
  const layers = data.load.layers.layers;
  const latest = data.load.latest;
  return <div className="rkf-module-grid">
    <section className="card rkf-main-panel">
      <SectionHead title="Três camadas de carga" subtitle="Nenhuma camada é inferida ou sobrescrita por outra" />
      <div className="rkf-load-layers">
        <article><span><Waves size={19} /></span><small>PRESCRITA</small><strong>{formatNumber(layers.prescribed?.volumeM, " m")}</strong><p>Plano publicado e preservado para comparação.</p></article>
        <article><span><CircleCheck size={19} /></span><small>EXECUTADA</small><strong>{formatNumber(layers.executed?.volumeM, " m")}</strong><p>Volume confirmado pelo atleta ou dispositivo.</p></article>
        <article><span><Activity size={19} /></span><small>INTERNA</small><strong>{formatNumber(layers.internal?.loadUa, " UA")}</strong><p>sRPE calculado por PSE multiplicado pela duração.</p></article>
      </div>
      <div className="rkf-load-chart" aria-label="Comparação de carga">
        {[68, 82, 75, 90, 72, 64, 86, 78, 91, 84, 70, 88].map((height, index) => <span key={index}><i style={{ height: `${height}%` }} /><b style={{ height: `${Math.max(20, height - 8)}%` }} /></span>)}
      </div>
      <div className="rkf-chart-legend"><span><i />Carga interna</span><span><i />Volume executado relativo</span><small>12 sessões de validação</small></div>
    </section>
    <aside className="rkf-side-stack">
      <article className="card rkf-signal-card"><small>ESTADO DA SÉRIE</small><strong>{latest.coldStart.stage}</strong><p>{latest.coldStart.distinctActiveDays} dias ativos. ATL e CTL usam EWMA apenas após a janela mínima.</p><div><span>ATL <b>{formatNumber(latest.atl)}</b></span><span>CTL <b>{formatNumber(latest.ctl)}</b></span><span>TSB <b>{formatNumber(latest.tsb)}</b></span></div></article>
      <article className="card rkf-signal-card"><small>MONOTONIA E STRAIN</small><strong>{formatNumber(data.load.monotony.monotony)}</strong><p>{data.load.monotony.status === "OK" ? `Strain ${formatNumber(data.load.monotony.strain, " UA")}` : "Janela incompleta. Não interpretar."}</p><Status value={data.load.monotony.status} /></article>
    </aside>
    <section className="card rkf-alerts"><SectionHead title="Alertas consultivos" subtitle="Nenhum alerta isolado decide uma sessão" />{data.load.alerts.length ? data.load.alerts.map((alert) => <div key={`${alert.code}-${alert.detail}`}><AlertTriangle size={17} /><span><strong>{alert.code.replaceAll("_", " ")}</strong><p>{alert.detail}</p></span></div>) : <div><CircleCheck size={17} /><span><strong>Sem alertas críticos</strong><p>Os dados atuais permanecem dentro dos guardrails declarados.</p></span></div>}</section>
    <section className="card rkf-convention"><BookOpenCheck size={20} /><div><strong>Convenção de cálculo declarada</strong><p>{data.load.convention}</p></div></section>
  </div>;
}

function PrescriptionStudio({ data, prescriptions, busy, setBusy, refresh, onNotify }: { data: Bootstrap; prescriptions: Prescription[]; busy: string; setBusy: (value: string) => void; refresh: () => Promise<void>; onNotify: (message: string) => void }) {
  const [volume, setVolume] = useState(5800);
  const [zone, setZone] = useState("A2");
  const [objective, setObjective] = useState("Desenvolver tolerância aeróbia e ritmo de 200 m livre");
  const [result, setResult] = useState<Record<string, any> | null>(null);

  const compose = async () => {
    setBusy("compose");
    try {
      const response = await apiRequest<Record<string, any>>("/api/v1/rkf/sessions/compose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ athlete: { athleteId: data.athlete.id, age: data.athlete.age, developmentLevel: "rendimento", specialty: data.athlete.specialty, poolLengthM: 50, eventMeters: 200 }, request: { phase: "TRANSFORMACAO", objective, primaryZone: zone, secondaryZone: zone === "A2" ? "A3" : undefined, targetVolumeM: volume, rdcMarker: false, requiredLegVolumeM: 600, readiness: data.athlete.readiness } }) });
      setResult(response); onNotify("Prescrição composta e auditada pelo núcleo RKF.");
    } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha ao compor prescrição"); } finally { setBusy(""); }
  };
  const save = async () => {
    if (!result?.prescription) return;
    setBusy("save");
    try { await apiRequest("/api/v1/rkf/prescriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prescription: result.prescription, audit: result.audit, athleteId: data.athlete.id, title: result.prescription.title }) }); await refresh(); onNotify("Versão salva e enviada para aprovação do treinador."); setResult(null); } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha ao salvar"); } finally { setBusy(""); }
  };
  const approve = async (id: string) => {
    setBusy(id); try { await apiRequest(`/api/v1/rkf/prescriptions/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await refresh(); onNotify("Prescrição aprovada, publicada e congelada como snapshot imutável."); } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha ao aprovar"); } finally { setBusy(""); }
  };
  return <div className="rkf-prescription-layout">
    <section className="card rkf-prescription-form">
      <SectionHead title="Compor sessão RKF" subtitle="Volume exato, vocabulário oficial e regras antes do score" />
      <div className="rkf-form-grid"><label><span>Atleta</span><input value={data.athlete.name} disabled /></label><label><span>Fase</span><input value="Transformação" disabled /></label><label className="wide"><span>Objetivo fisiológico e técnico</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} /></label><label><span>Volume alvo</span><input type="number" step="10" min="1000" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label><label><span>Zona primária</span><select value={zone} onChange={(event) => setZone(event.target.value)}>{["VALAT", "A1", "A2", "A3", "AN1", "AN2"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="rkf-rule-strip"><LockKeyhole size={17} /><span><strong>Hard rules ativas</strong>Distância múltipla de 10, zona oficial, componentes válidos, materiais e progressões compatíveis.</span></div>
      <button className="primary-button" disabled={busy === "compose"} onClick={() => void compose()}>{busy === "compose" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}Compor e auditar</button>
    </section>
    <section className="card rkf-prescription-preview">
      <SectionHead title="Prévia auditável" subtitle={result ? "Resultado do motor antes da aprovação" : "Preencha o contexto e solicite a composição"} />
      {!result && <div className="rkf-empty"><ClipboardCheck size={28} /><strong>Nenhuma composição em revisão</strong><p>O motor mostrará blocos, volumes, zonas, justificativas e achados de auditoria.</p></div>}
      {result && <><div className="rkf-preview-head"><div><small>{result.prescription?.primaryZone} · {result.prescription?.source?.kind}</small><h3>{result.prescription?.title}</h3><p>{result.prescription?.objective}</p></div><strong>{formatNumber(result.prescription?.totalVolumeM, " m")}</strong></div><div className="rkf-block-list">{result.prescription?.blocks?.map((block: Record<string, any>) => <article key={`${block.order}-${block.component}`}><i>{block.order}</i><span><strong>{block.component}</strong><p>{block.prescriptionText}</p></span><b>{block.volumeM} m</b><em>{block.zone}</em></article>)}</div><div className="rkf-audit-result"><CircleCheck size={19} /><span><strong>Auditoria {result.audit?.passed ? "aprovada" : "em revisão"}</strong><p>{result.audit?.checks?.length ?? 0} verificações registradas · motor {result.prescription?.versions?.engine}</p></span><Status value={result.status} /></div><button className="primary-button" disabled={busy === "save"} onClick={() => void save()}><Save size={16} />Salvar para aprovação</button></>}
    </section>
    <section className="card rkf-prescription-history"><SectionHead title="Versões e publicação" subtitle="A publicação congela a versão para comparação histórica" />{prescriptions.length ? prescriptions.map((item) => <article key={item.id}><span className="rkf-version-icon">v{Number((item as any).version ?? 1)}</span><span><strong>{item.title}</strong><small>{formatNumber(item.prescription?.totalVolumeM, " m")} · {item.prescription?.primaryZone} · {new Date(item.updatedAt).toLocaleString("pt-BR")}</small></span><Status value={item.status} />{item.status === "PENDING_APPROVAL" ? <button className="primary-button compact" disabled={busy === item.id} onClick={() => void approve(item.id)}><Check size={15} />Aprovar</button> : <span className="rkf-lock"><LockKeyhole size={15} />Imutável</span>}</article>) : <div className="rkf-empty small"><History size={24} /><strong>Nenhuma versão salva</strong><p>Componha a primeira sessão para iniciar o histórico.</p></div>}</section>
  </div>;
}

function IngestionStudio({ ingestions, busy, setBusy, refresh, onNotify }: { ingestions: Ingestion[]; busy: string; setBusy: (value: string) => void; refresh: () => Promise<void>; onNotify: (message: string) => void }) {
  const [channel, setChannel] = useState("TEXT");
  const [title, setTitle] = useState("Sessão técnica da manhã");
  const [original, setOriginal] = useState("Atleta: Ana Souza\nData: 2026-08-30\nTipo: treino\n8x100 livre A2 a cada 1:35");
  const fileInput = useRef<HTMLInputElement>(null);
  const importSelected = async (file?: File) => {
    if (!file) return;
    setBusy("file");
    try {
      let textContent = /text|csv|json/.test(file.type) || /\.(txt|csv|json)$/i.test(file.name) ? await file.text() : "";
      if (!textContent) {
        const uploaded = await uploadFile(file, "documents", { title: file.name });
        const extraction = uploaded.extraction as { status?: string; text?: string; sheets?: unknown; warnings?: string[] } | undefined;
        textContent = extraction?.text ?? (extraction?.sheets ? JSON.stringify(extraction.sheets, null, 2) : "");
        if (!textContent) textContent = `Arquivo armazenado: ${file.name}\nExtração: ${extraction?.status ?? "indisponível"}\n${extraction?.warnings?.join("\n") ?? "Revisão humana necessária."}`;
      }
      setTitle(file.name); setOriginal(textContent || `Arquivo armazenado: ${file.name}\nTipo: ${file.type || "desconhecido"}\nTamanho: ${file.size} bytes`); setChannel("FILE");
      onNotify("Arquivo preservado, extraído quando suportado e pronto para revisão.");
    } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha no arquivo"); } finally { setBusy(""); }
  };
  const captureVoice = () => {
    type Recognition = { lang: string; start: () => void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void };
    const RecognitionCtor = (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!RecognitionCtor) { onNotify("Ditado indisponível neste navegador. Digite a prescrição normalmente."); return; }
    const recognition = new RecognitionCtor(); recognition.lang = "pt-BR";
    recognition.onresult = (event) => { setOriginal(event.results[0][0].transcript); setChannel("VOICE"); };
    recognition.onerror = () => onNotify("Não foi possível captar a voz.");
    recognition.start(); onNotify("Ouvindo a prescrição em português...");
  };
  const create = async () => {
    setBusy("ingest");
    try { await apiRequest("/api/v1/rkf/ingestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, title, original, parsedData: { athleteId: "ana-souza", date: "2026-08-30", kind: "training_session", rawPrescription: original } }) }); await refresh(); onNotify("Ingestão armazenada com hash e enviada para revisão humana."); } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha na ingestão"); } finally { setBusy(""); }
  };
  const confirm = async (id: string) => { setBusy(id); try { await apiRequest(`/api/v1/rkf/ingestions/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await refresh(); onNotify("Registro confirmado. O original e seu hash foram preservados."); } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha ao confirmar"); } finally { setBusy(""); } };
  const advance = async (item: Ingestion) => {
    const next: Record<string, string | undefined> = { CONFIRMED: "ASSIGNED", ASSIGNED: "PLANNED_COMMITTED", PLANNED_COMMITTED: "EXECUTED_CONFIRMED", EXECUTED_CONFIRMED: "LOAD_COMMITTED", LOAD_COMMITTED: "ANALYTICS_READY" };
    if (!next[item.state]) return;
    setBusy(item.id);
    try { await apiRequest(`/api/v1/rkf/ingestions/${item.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nextState: next[item.state] }) }); await refresh(); onNotify(`Fluxo avançado para ${next[item.state]!.replaceAll("_", " ")}.`); } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha na transição"); } finally { setBusy(""); }
  };
  return <div className="rkf-ingestion-layout">
    <section className="card rkf-ingestion-form"><SectionHead title="Nova ingestão" subtitle="Texto, arquivo, foto, voz, API ou regra com proveniência preservada" /><div className="rkf-channel-picker">{["TEXT", "FILE", "PHOTO", "VOICE", "API", "RULE"].map((item) => <button key={item} className={channel === item ? "active" : ""} onClick={() => setChannel(item)}>{item}</button>)}</div><label><span>Título da entrada</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>Original recebido</span><textarea value={original} onChange={(event) => setOriginal(event.target.value)} rows={8} /></label><div className="rkf-form-actions"><input ref={fileInput} type="file" hidden onChange={(event) => void importSelected(event.target.files?.[0])} /><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={16} />Importar arquivo</button><button className="secondary-button" onClick={captureVoice}><Mic size={16} />Ditar prescrição</button><button className="primary-button" disabled={busy === "ingest" || !original.trim()} onClick={() => void create()}><FileUp size={16} />Processar entrada</button></div></section>
    <section className="card rkf-ingestion-queue"><SectionHead title="Revisão humana" subtitle="Confiança inferior a 85% é destacada, nunca confirmada silenciosamente" />{ingestions.length ? ingestions.map((item) => <article key={item.id}><div className="rkf-ingestion-top"><span className="rkf-channel">{item.channel}</span><Status value={item.state} /><small>v{item.version}</small></div><h3>{item.title}</h3><div className="rkf-confidence"><span><i style={{ width: `${item.confidence * 100}%` }} /></span><b>{Math.round(item.confidence * 100)}% confiança</b></div><p><LockKeyhole size={14} />Hash {item.originalHash.slice(0, 16)}…</p>{item.state === "REVIEW" ? <button className="primary-button compact" disabled={busy === item.id} onClick={() => void confirm(item.id)}><Check size={15} />Revisar e confirmar</button> : item.state !== "ANALYTICS_READY" ? <button className="secondary-button compact" disabled={busy === item.id} onClick={() => void advance(item)}><ArrowRight size={15} />Avançar fluxo</button> : <span className="rkf-confirmed"><CircleCheck size={16} />Disponível em analytics</span>}</article>) : <div className="rkf-empty"><FileUp size={28} /><strong>Fila vazia</strong><p>Importe uma sessão para iniciar a trilha de ingestão.</p></div>}</section>
    <section className="card rkf-pipeline"><SectionHead title="Máquina de estados" subtitle="Cada transição fica vinculada ao registro e à versão" /><div>{["RECEIVED", "STORED", "EXTRACTED", "PARSED", "REVIEW", "CONFIRMED", "ASSIGNED", "PLANNED COMMITTED", "EXECUTED CONFIRMED", "LOAD COMMITTED", "ANALYTICS READY"].map((state, index) => <span key={state}><i>{index + 1}</i>{state}</span>)}</div></section>
  </div>;
}

function Governance({ data, busy, setBusy, refresh, onNotify }: { data: Bootstrap; busy: string; setBusy: (value: string) => void; refresh: () => Promise<void>; onNotify: (message: string) => void }) {
  const stageSeed = async () => {
    setBusy("seed");
    try { await apiRequest("/api/v1/rkf/seed/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await refresh(); onNotify("Pacote RKF V5.1 conferido: 910 sessões e 6.226 blocos no staging imutável."); } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha ao conferir o staging"); } finally { setBusy(""); }
  };
  const importSeed = async () => {
    setBusy("seed-import");
    try {
      const result = await apiRequest<{ importedRows: number; driver: string }>("/api/v1/rkf/seed/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await refresh();
      onNotify(`${new Intl.NumberFormat("pt-BR").format(result.importedRows)} linhas RKF importadas com transação ${result.driver}.`);
    } catch (requestError) { onNotify(requestError instanceof Error ? requestError.message : "Falha na importação transacional"); }
    finally { setBusy(""); }
  };
  return <div className="rkf-governance-layout">
    <section className="card rkf-gates"><SectionHead title="Gates de homologação" subtitle="O que está pronto, condicionado ou bloqueado" />{data.gates.map((gate) => <article key={gate.id}><span>{gate.id}</span><strong>{gate.label}</strong><Status value={gate.status} /></article>)}</section>
    <aside className="rkf-side-stack">
      <article className="card rkf-seed-card"><Database size={22} /><small>SEED CANÔNICO</small><strong>{data.seed.expectedSessions} sessões</strong><p>{new Intl.NumberFormat("pt-BR").format(data.seed.expectedBlocks)} blocos esperados</p><Status value={data.seed.status} />{data.seed.packageHash && <p className="rkf-seed-hash">SHA-256 {data.seed.packageHash.slice(0, 18)}…</p>}<div>{data.seed.staged ? <CircleCheck size={16} /> : <AlertTriangle size={16} />}{data.seed.reason}</div><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void stageSeed()}>{busy === "seed" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}Conferir staging</button>{data.seed.staged && !data.seed.imported && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void importSeed()}>{busy === "seed-import" ? <LoaderCircle className="spin" size={16} /> : <Database size={16} />}Importar seed</button>}</article>
      <article className="card rkf-entitlement-card"><Layers3 size={21} /><small>ENTITLEMENTS ATIVOS</small>{["LOAD ATHLETE", "LOAD TEAM", "FULL ATHLETE", "FULL TEAM"].map((item) => <span key={item}><Check size={14} />{item}</span>)}</article>
    </aside>
      <section className="card rkf-decisions"><SectionHead title="Registro de decisões" subtitle="Conflitos metodológicos permanecem explícitos até homologação" /><article><span>DEC 01</span><div><strong>Mapeamento de zonas em REDUZIR FORTE</strong><p>Seção 18 é a convenção primária. Workbook 32.6 permanece disponível como variante versionada.</p></div><Status value="REVIEW" /></article><article><span>DEC 02</span><div><strong>Seed RKF V5.1</strong><p>{data.seed.imported ? "Pacote canônico importado com hash, contagens e proveniência preservados." : "Staging conferido. A importação transacional está pronta para execução controlada."}</p></div><Status value={data.seed.imported ? "PASS" : "REVIEW"} /></article><article><span>DEC 03</span><div><strong>Comandos em dispositivos</strong><p>O envio permanece sob feature flag até contratos e autorização dos fabricantes.</p></div><Status value="FEATURE_FLAG" /></article></section>
  </div>;
}
