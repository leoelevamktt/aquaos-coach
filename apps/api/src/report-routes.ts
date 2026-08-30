import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";
import { athleteMayAccess, getSession, roleAllows, sessionToken } from "./auth.js";

type AthleteSnapshot = {
  generatedAt: string;
  organization: string;
  athlete: ManagedRecord;
  period: { from?: string; to?: string };
  summary: { sessions: number; totalVolumeM: number; averagePse: number | null; results: number; videos: number; goals: number };
  zones: Array<{ code: string; volumeM: number }>;
  goals: ManagedRecord[];
  results: ManagedRecord[];
  loads: ManagedRecord[];
  provenance: { engine: string; engineVersion: string; status: string; hash: string };
};

function authorize(request: FastifyRequest, reply: FastifyReply, athleteId: string) {
  const user = getSession(sessionToken(request));
  if (!user) { void reply.code(401).send({ error: "Autenticação necessária" }); return undefined; }
  if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) { void reply.code(403).send({ error: "Acesso restrito ao próprio relatório" }); return undefined; }
  return user;
}

function inPeriod(record: ManagedRecord, from?: string, to?: string) {
  const date = String(record.date ?? record.createdAt).slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}

export function buildAthleteSnapshot(store: ManagedStore, organizationId: string, athleteId: string, period: { from?: string; to?: string }): AthleteSnapshot | undefined {
  const athlete = store.get("athletes", athleteId) ?? store.list("athletes").find((record) => record.id === athleteId || record.athleteId === athleteId);
  if (!athlete || athlete.organizationId !== organizationId) return undefined;
  const belongs = (record: ManagedRecord) => [athleteId, athlete.id].includes(String(record.athleteId ?? "")) && record.organizationId === organizationId && inPeriod(record, period.from, period.to);
  const activities = store.list("activities").filter(belongs);
  const results = store.list("results").filter(belongs).slice(0, 12);
  const loads = store.list("loadSnapshots").filter(belongs).slice(0, 12);
  const goals = store.list("goals").filter((record) => record.organizationId === organizationId && [athleteId, athlete.id].includes(String(record.athleteId ?? "")));
  const videos = store.list("videos").filter((record) => record.organizationId === organizationId && [athleteId, athlete.id].includes(String(record.athleteId ?? "")));
  const volume = activities.reduce((sum, record) => sum + Number(record.executedVolumeM ?? record.distanceMeters ?? record.distanceM ?? 0), 0);
  const pseValues = activities.map((record) => Number(record.pse)).filter(Number.isFinite);
  const zoneMap = new Map<string, number>();
  for (const activity of activities) {
    const code = String(activity.zone ?? activity.primaryZone ?? "SEM ZONA");
    zoneMap.set(code, (zoneMap.get(code) ?? 0) + Number(activity.executedVolumeM ?? activity.distanceMeters ?? 0));
  }
  const snapshotBase = {
    generatedAt: new Date().toISOString(), organization: "Seleção Nacional de Natação", athlete, period,
    summary: { sessions: activities.length, totalVolumeM: volume, averagePse: pseValues.length ? Math.round((pseValues.reduce((sum, value) => sum + value, 0) / pseValues.length) * 10) / 10 : null, results: results.length, videos: videos.length, goals: goals.length },
    zones: [...zoneMap.entries()].map(([code, volumeM]) => ({ code, volumeM })).sort((a, b) => b.volumeM - a.volumeM), goals, results, loads,
    provenance: { engine: "RkfLoadEngine", engineVersion: "RKF_V5.1", status: "VALIDATION", hash: "" },
  };
  const hash = createHash("sha256").update(JSON.stringify(snapshotBase)).digest("hex");
  return { ...snapshotBase, provenance: { ...snapshotBase.provenance, hash } };
}

function pdfBuffer(snapshot: AthleteSnapshot) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margins: { top: 48, right: 48, bottom: 54, left: 48 }, info: { Title: `Relatório RKF - ${String(snapshot.athlete.name)}`, Author: "RKF Coach" } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    const navy = "#0B1E3F"; const blue = "#174A8C"; const yellow = "#FFD700"; const muted = "#637083"; const line = "#DCE4EE";
    document.rect(0, 0, 595.28, 116).fill(navy);
    document.fillColor(yellow).font("Helvetica-Bold").fontSize(11).text("RKF COACH", 48, 38, { characterSpacing: 1.2 });
    document.fillColor("#FFFFFF").fontSize(23).text("Relatório de performance", 48, 60);
    document.fillColor("#C9D8EC").font("Helvetica").fontSize(9).text(`${snapshot.organization}  |  Gerado em ${new Date(snapshot.generatedAt).toLocaleString("pt-BR")}`, 48, 91);
    let y = 144;
    document.fillColor(navy).font("Helvetica-Bold").fontSize(18).text(String(snapshot.athlete.name), 48, y);
    document.fillColor(muted).font("Helvetica").fontSize(10).text(`${String(snapshot.athlete.group ?? "Programa principal")}  |  ${String(snapshot.athlete.stroke ?? "Natação")}`, 48, y + 25);
    y += 61;
    const metrics = [
      ["SESSÕES", String(snapshot.summary.sessions)], ["VOLUME", `${snapshot.summary.totalVolumeM.toLocaleString("pt-BR")} m`],
      ["PSE MÉDIO", snapshot.summary.averagePse === null ? "Sem dados" : String(snapshot.summary.averagePse)], ["RESULTADOS", String(snapshot.summary.results)],
    ];
    metrics.forEach(([label, value], index) => {
      const x = 48 + index * 124;
      document.roundedRect(x, y, 112, 66, 7).fillAndStroke(index === 0 ? "#E6F1FF" : "#F7F9FC", line);
      document.fillColor(muted).font("Helvetica-Bold").fontSize(7).text(label, x + 12, y + 13, { characterSpacing: 0.7 });
      document.fillColor(navy).fontSize(value === "Sem dados" ? 11 : 17).text(value, x + 12, y + 33, { width: 90 });
    });
    y += 91;
    document.fillColor(navy).font("Helvetica-Bold").fontSize(13).text("Distribuição por zona", 48, y);
    document.fillColor(muted).font("Helvetica").fontSize(9).text("Volume executado no período selecionado", 48, y + 18);
    y += 43;
    const zones = snapshot.zones.length ? snapshot.zones.slice(0, 6) : [{ code: "Sem atividades com zona", volumeM: 0 }];
    const max = Math.max(...zones.map((zone) => zone.volumeM), 1);
    zones.forEach((zone) => {
      document.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(zone.code, 48, y + 2, { width: 90 });
      document.roundedRect(140, y, 292, 12, 6).fill("#EDF1F6");
      if (zone.volumeM) document.roundedRect(140, y, Math.max(8, (zone.volumeM / max) * 292), 12, 6).fill(blue);
      document.fillColor(muted).font("Helvetica").fontSize(8).text(`${zone.volumeM.toLocaleString("pt-BR")} m`, 443, y + 2, { width: 84, align: "right" });
      y += 23;
    });
    y += 17;
    document.fillColor(navy).font("Helvetica-Bold").fontSize(13).text("Metas e resultados recentes", 48, y);
    y += 25;
    const rows = [...snapshot.goals.slice(0, 3).map((goal) => ({ label: String(goal.event ?? goal.name), detail: `Meta ${String(goal.targetTime ?? "não definida")}`, status: String(goal.status ?? "active") })), ...snapshot.results.slice(0, 4).map((result) => ({ label: String(result.event ?? result.title), detail: `Melhor ${String(result.bestTimeSeconds ?? "-")} s  |  Média ${String(result.averageTimeSeconds ?? "-")} s`, status: String(result.status ?? "confirmed") }))];
    if (!rows.length) rows.push({ label: "Sem resultados confirmados no período", detail: "O estado sem dados é preservado; nenhum valor foi inferido.", status: "sem dados" });
    rows.slice(0, 6).forEach((row) => {
      document.moveTo(48, y).lineTo(527, y).strokeColor(line).stroke();
      document.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(row.label, 48, y + 10, { width: 255 });
      document.fillColor(muted).font("Helvetica").fontSize(8).text(row.detail, 48, y + 25, { width: 330 });
      document.fillColor(blue).font("Helvetica-Bold").fontSize(7).text(row.status.toUpperCase(), 405, y + 15, { width: 122, align: "right" });
      y += 47;
    });
    document.moveTo(48, y).lineTo(527, y).strokeColor(line).stroke();
    document.fillColor("#475569").font("Helvetica").fontSize(7.5).text(`Motor ${snapshot.provenance.engine} ${snapshot.provenance.engineVersion}  |  Status ${snapshot.provenance.status}`, 48, 754);
    document.fillColor("#64748B").text(`SHA-256 ${snapshot.provenance.hash}`, 48, 769, { width: 479 });
    document.end();
  });
}

function csv(snapshot: AthleteSnapshot) {
  const rows = [["campo", "valor"], ["atleta", snapshot.athlete.name], ["gerado_em", snapshot.generatedAt], ["sessoes", snapshot.summary.sessions], ["volume_m", snapshot.summary.totalVolumeM], ["pse_medio", snapshot.summary.averagePse ?? ""], ["resultados", snapshot.summary.results], ["videos", snapshot.summary.videos], ["motor", snapshot.provenance.engine], ["versao_motor", snapshot.provenance.engineVersion], ["sha256", snapshot.provenance.hash]];
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

export function registerReportRoutes(app: FastifyInstance, store: ManagedStore) {
  const querySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
  app.get("/api/v1/reports/athletes/:athleteId.pdf", async (request, reply) => {
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    const user = authorize(request, reply, athleteId); if (!user) return;
    const period = querySchema.parse(request.query);
    const snapshot = buildAthleteSnapshot(store, user.organizationId, athleteId, period);
    if (!snapshot) return reply.code(404).send({ error: "Atleta não encontrado" });
    const buffer = await pdfBuffer(snapshot);
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename=relatorio-rkf-${athleteId}.pdf`).header("X-Report-SHA256", snapshot.provenance.hash).send(buffer);
  });
  app.get("/api/v1/reports/athletes/:athleteId.csv", async (request, reply) => {
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    const user = authorize(request, reply, athleteId); if (!user) return;
    const period = querySchema.parse(request.query);
    const snapshot = buildAthleteSnapshot(store, user.organizationId, athleteId, period);
    if (!snapshot) return reply.code(404).send({ error: "Atleta não encontrado" });
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename=relatorio-rkf-${athleteId}.csv`).header("X-Report-SHA256", snapshot.provenance.hash).send(`\uFEFF${csv(snapshot)}`);
  });

  /** PDF da sessão prescrita (modelo de piscina): só prescrições publicadas. */
  app.get("/api/v1/rkf/prescriptions/:id.pdf", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const user = getSession(sessionToken(request));
    if (!user) return reply.code(401).send({ error: "Autenticação necessária" });
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(403).send({ error: "PDF de prescrição é exclusivo da comissão técnica" });
    const record = store.get("prescriptions", id);
    if (!record || record.organizationId !== user.organizationId) return reply.code(404).send({ error: "Prescrição não encontrada" });
    if (record.status !== "PUBLISHED") return reply.code(422).send({ error: "PDF disponível somente para prescrições publicadas" });
    const buffer = await prescriptionPdf(record);
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename=prescricao-rkf-${id}.pdf`).header("X-Prescription-SHA256", createHash("sha256").update(buffer).digest("hex")).send(buffer);
  });
}

type PrescriptionRecord = ManagedRecord & {
  prescription?: {
    title?: string; objective?: string; primaryZone?: string; totalVolumeM?: number;
    blocks?: Array<{ order?: number; component?: string; volumeM?: number; zone?: string; prescriptionText?: string }>;
    versions?: { engine?: string; rules?: string; seed?: string }; generatedAtUtc?: string;
  };
  approvedBy?: string; approvedAt?: string; athleteId?: string;
};

function prescriptionPdf(record: PrescriptionRecord) {
  return new Promise<Buffer>((resolve, reject) => {
    const prescription = record.prescription ?? {};
    const blocks = prescription.blocks ?? [];
    const document = new PDFDocument({ size: "A4", margins: { top: 48, right: 48, bottom: 54, left: 48 }, info: { Title: `Prescrição RKF - ${String(prescription.title ?? record.title)}`, Author: "RKF Coach" } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    const navy = "#0B1E3F"; const blue = "#174A8C"; const yellow = "#FFD700"; const muted = "#637083"; const line = "#DCE4EE";

    document.rect(0, 0, 595.28, 110).fill(navy);
    document.fillColor(yellow).font("Helvetica-Bold").fontSize(11).text("RKF COACH", 48, 34, { characterSpacing: 1.2 });
    document.fillColor("#FFFFFF").fontSize(21).text(String(prescription.title ?? record.title ?? "Sessão"), 48, 54);
    document.fillColor("#C9D8EC").font("Helvetica").fontSize(9).text(`Atleta ${String(record.athleteId ?? "-")}  |  Zona primária ${String(prescription.primaryZone ?? "-")}  |  Publicada em ${record.approvedAt ? new Date(String(record.approvedAt)).toLocaleString("pt-BR") : "-"}`, 48, 84);

    let y = 138;
    const summary: Array<[string, string]> = [
      ["VOLUME TOTAL", `${Number(prescription.totalVolumeM ?? 0).toLocaleString("pt-BR")} m`],
      ["OBJETIVO", String(prescription.objective ?? "-").slice(0, 40)],
      ["BLOCOS", String(blocks.length)],
      ["APROVADA POR", String(record.approvedBy ?? "-")],
    ];
    summary.forEach(([label, value], index) => {
      const x = 48 + index * 124;
      document.roundedRect(x, y, 112, 56, 7).fillAndStroke(index === 0 ? "#E6F1FF" : "#F7F9FC", line);
      document.fillColor(muted).font("Helvetica-Bold").fontSize(6.5).text(label, x + 10, y + 11, { characterSpacing: 0.6 });
      document.fillColor(navy).fontSize(11).text(value, x + 10, y + 28, { width: 94 });
    });
    y += 80;

    document.fillColor(navy).font("Helvetica-Bold").fontSize(13).text("Estrutura da sessão", 48, y);
    y += 24;
    document.moveTo(48, y).lineTo(527, y).strokeColor(line).stroke();
    y += 8;
    document.fillColor(muted).font("Helvetica-Bold").fontSize(7).text("#", 48, y, { width: 22 });
    document.text("COMPONENTE", 70, y, { width: 110 });
    document.text("ZONA", 182, y, { width: 48 });
    document.text("VOLUME", 230, y, { width: 60, align: "right" });
    document.text("PRESCRIÇÃO", 298, y, { width: 229 });
    y += 16;
    if (!blocks.length) {
      document.fillColor(muted).font("Helvetica").fontSize(9).text("Prescrição sem blocos registrados no snapshot publicado.", 48, y);
      y += 24;
    }
    for (const block of blocks) {
      if (y > 640) { document.addPage(); y = 60; }
      document.moveTo(48, y).lineTo(527, y).strokeColor(line).stroke();
      y += 8;
      document.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(String(block.order ?? "-"), 48, y, { width: 22 });
      document.text(String(block.component ?? "-"), 70, y, { width: 110 });
      document.fillColor(blue).text(String(block.zone ?? "-"), 182, y, { width: 48 });
      document.fillColor(navy).text(`${Number(block.volumeM ?? 0).toLocaleString("pt-BR")} m`, 230, y, { width: 60, align: "right" });
      document.fillColor("#334155").font("Helvetica").fontSize(8).text(String(block.prescriptionText ?? ""), 298, y, { width: 229 });
      y += 26;
    }
    document.moveTo(48, y).lineTo(527, y).strokeColor(line).stroke();
    y += 10;
    document.fillColor(navy).font("Helvetica-Bold").fontSize(9).text("TOTAL", 230, y, { width: 60, align: "right" });
    document.text(`${Number(prescription.totalVolumeM ?? 0).toLocaleString("pt-BR")} m`, 298, y, { width: 100 });

    const versions = prescription.versions ?? {};
    document.fillColor("#475569").font("Helvetica").fontSize(7.5).text(`Motor ${String(versions.engine ?? "-")}  |  Regras ${String(versions.rules ?? "-")}  |  Seed ${String(versions.seed ?? "-")}`, 48, 754);
    document.fillColor("#64748B").text(`Gerada em ${prescription.generatedAtUtc ? new Date(prescription.generatedAtUtc).toLocaleString("pt-BR") : "-"}  |  Prescrição imutável; nova edição gera nova versão.`, 48, 769, { width: 479 });
    document.end();
  });
}
