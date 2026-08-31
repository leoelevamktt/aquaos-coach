export type AthleteProfile = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  age: number;
  stroke: string;
  group: string;
  account: "active" | "invited" | "offline";
  readiness?: number;
  sleep?: number;
  recovery?: number;
  hrv?: number;
  restingHr?: number;
  weeklyDistance: number;
  previousDistance: number;
  attendance: number;
  goalEvent?: string;
  goalTime?: string;
  bestTime?: string;
  gap?: string;
  wearable?: string;
  lastBodySync?: string;
  skills: { key: string; label: string; score: number; trend: number }[];
};

export const athletes: AthleteProfile[] = [
  {
    id: "ana-souza", name: "Ana Souza", handle: "@anaswim", initials: "AS", color: "#7357ef", age: 24,
    stroke: "Livre", group: "Elite · Raia 4", account: "active", readiness: 86, sleep: 8.1, recovery: 82,
    hrv: 72, restingHr: 48, weeklyDistance: 28600, previousDistance: 26400, attendance: 96,
    goalEvent: "200 m Livre", goalTime: "1:58.50", bestTime: "2:01.32", gap: "+2.82", wearable: "Garmin Fēnix 8",
    lastBodySync: "Hoje, 06:42", skills: [
      { key: "S", label: "Saída", score: 78, trend: 3 }, { key: "V", label: "Velocidade", score: 91, trend: 5 },
      { key: "T", label: "Virada", score: 74, trend: -1 }, { key: "P", label: "Ritmo", score: 88, trend: 4 },
      { key: "F", label: "Chegada", score: 82, trend: 2 },
    ],
  },
  {
    id: "caio-martins", name: "Caio Martins", handle: "@caiobfly", initials: "CM", color: "#0da98b", age: 22,
    stroke: "Borboleta", group: "Elite · Raia 4", account: "active", readiness: 72, sleep: 6.8, recovery: 68,
    hrv: 59, restingHr: 52, weeklyDistance: 27100, previousDistance: 28200, attendance: 91,
    goalEvent: "100 m Borboleta", goalTime: "52.90", bestTime: "54.18", gap: "+1.28", wearable: "Polar Vantage V3",
    lastBodySync: "Hoje, 07:03", skills: [
      { key: "S", label: "Saída", score: 86, trend: 4 }, { key: "V", label: "Velocidade", score: 88, trend: 2 },
      { key: "T", label: "Virada", score: 69, trend: -2 }, { key: "P", label: "Ritmo", score: 76, trend: 1 },
      { key: "F", label: "Chegada", score: 71, trend: 0 },
    ],
  },
  {
    id: "luiza-costa", name: "Luiza Costa", handle: "@luizaback", initials: "LC", color: "#f09a3e", age: 20,
    stroke: "Costas", group: "Desenvolvimento · Raia 3", account: "active", readiness: 58, sleep: 5.9, recovery: 54,
    hrv: 46, restingHr: 61, weeklyDistance: 21200, previousDistance: 24500, attendance: 87,
    goalEvent: "100 m Costas", goalTime: "1:01.20", bestTime: "1:03.86", gap: "+2.66", wearable: "WHOOP 5.0",
    lastBodySync: "Ontem, 22:48", skills: [
      { key: "S", label: "Saída", score: 66, trend: -1 }, { key: "V", label: "Velocidade", score: 79, trend: 3 },
      { key: "T", label: "Virada", score: 63, trend: 0 }, { key: "P", label: "Ritmo", score: 72, trend: 2 },
      { key: "F", label: "Chegada", score: 68, trend: 1 },
    ],
  },
  {
    id: "pedro-lima", name: "Pedro Lima", handle: "@pedrobreast", initials: "PL", color: "#e35f65", age: 23,
    stroke: "Peito", group: "Desenvolvimento · Raia 3", account: "active", readiness: 79, sleep: 7.6, recovery: 77,
    hrv: 64, restingHr: 51, weeklyDistance: 23400, previousDistance: 22600, attendance: 94,
    goalEvent: "200 m Peito", goalTime: "2:12.00", bestTime: "2:15.41", gap: "+3.41", wearable: "Garmin Forerunner 965",
    lastBodySync: "Hoje, 06:18", skills: [
      { key: "S", label: "Saída", score: 81, trend: 2 }, { key: "V", label: "Velocidade", score: 73, trend: 1 },
      { key: "T", label: "Virada", score: 84, trend: 4 }, { key: "P", label: "Ritmo", score: 78, trend: 2 },
      { key: "F", label: "Chegada", score: 76, trend: 1 },
    ],
  },
  {
    id: "gabriel-rocha", name: "Gabriel Rocha", handle: "@gabrielmedley", initials: "GR", color: "#397ac4", age: 19,
    stroke: "Medley", group: "Base · Raia 2", account: "invited", weeklyDistance: 16800, previousDistance: 17400, attendance: 78,
    wearable: undefined, lastBodySync: undefined, skills: [
      { key: "S", label: "Saída", score: 59, trend: 1 }, { key: "V", label: "Velocidade", score: 64, trend: 2 },
      { key: "T", label: "Virada", score: 61, trend: 1 }, { key: "P", label: "Ritmo", score: 58, trend: 0 },
      { key: "F", label: "Chegada", score: 56, trend: 1 },
    ],
  },
  {
    id: "marina-alves", name: "Marina Alves", handle: "@marinawater", initials: "MA", color: "#1e9bb2", age: 25,
    stroke: "Águas abertas", group: "Águas abertas", account: "offline", readiness: 67, sleep: 7.0, recovery: 63,
    hrv: 55, restingHr: 54, weeklyDistance: 31800, previousDistance: 30100, attendance: 89,
    goalEvent: "10 km", goalTime: "2:01:00", bestTime: "2:05:48", gap: "+4:48", wearable: "Suunto Race S",
    lastBodySync: "Há 4 dias", skills: [
      { key: "S", label: "Largada", score: 76, trend: 2 }, { key: "V", label: "Velocidade", score: 70, trend: 1 },
      { key: "T", label: "Boia", score: 82, trend: 3 }, { key: "P", label: "Ritmo", score: 87, trend: 4 },
      { key: "F", label: "Chegada", score: 74, trend: 1 },
    ],
  },
];

export function hydrateAthlete(record: Record<string, unknown>): AthleteProfile {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const id = String(record.id ?? "athlete");
  const name = String(record.name ?? "Atleta sem nome");
  const fallback = athletes.find((athlete) => normalize(athlete.id) === normalize(id) || normalize(athlete.name) === normalize(name));
  const initials = name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "AN";
  const numeric = (key: string, fallbackValue: number) => typeof record[key] === "number" && Number.isFinite(record[key]) ? Number(record[key]) : fallbackValue;
  const status = String(record.status ?? "active");
  const birthDate = typeof record.birthDate === "string" ? new Date(record.birthDate) : undefined;
  const calculatedAge = birthDate && !Number.isNaN(birthDate.getTime()) ? Math.max(0, Math.floor((Date.now() - birthDate.getTime()) / 31_557_600_000)) : 0;
  return {
    id,
    name,
    handle: String(record.handle ?? fallback?.handle ?? `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
    initials,
    color: String(record.color ?? record.avatarColor ?? fallback?.color ?? "#397ac4"),
    age: numeric("age", fallback?.age ?? calculatedAge),
    stroke: String(record.stroke ?? fallback?.stroke ?? "Natação"),
    group: String(record.group ?? fallback?.group ?? "Sem grupo"),
    account: status === "active" ? "active" : status === "invited" ? "invited" : "offline",
    ...(typeof record.readiness === "number" || fallback?.readiness !== undefined ? { readiness: numeric("readiness", fallback?.readiness ?? 0) } : {}),
    ...(typeof record.sleep === "number" || fallback?.sleep !== undefined ? { sleep: numeric("sleep", fallback?.sleep ?? 0) } : {}),
    ...(typeof record.recovery === "number" || fallback?.recovery !== undefined ? { recovery: numeric("recovery", fallback?.recovery ?? 0) } : {}),
    ...(typeof record.hrv === "number" || fallback?.hrv !== undefined ? { hrv: numeric("hrv", fallback?.hrv ?? 0) } : {}),
    ...(typeof record.restingHr === "number" || fallback?.restingHr !== undefined ? { restingHr: numeric("restingHr", fallback?.restingHr ?? 0) } : {}),
    weeklyDistance: numeric("weeklyDistance", fallback?.weeklyDistance ?? 0),
    previousDistance: numeric("previousDistance", fallback?.previousDistance ?? 0),
    attendance: numeric("attendance", fallback?.attendance ?? 0),
    ...(record.goalEvent || fallback?.goalEvent ? { goalEvent: String(record.goalEvent ?? fallback?.goalEvent) } : {}),
    ...(record.goalTime || fallback?.goalTime ? { goalTime: String(record.goalTime ?? fallback?.goalTime) } : {}),
    ...(record.bestTime || fallback?.bestTime ? { bestTime: String(record.bestTime ?? fallback?.bestTime) } : {}),
    ...(record.gap || fallback?.gap ? { gap: String(record.gap ?? fallback?.gap) } : {}),
    ...(record.wearable || fallback?.wearable ? { wearable: String(record.wearable ?? fallback?.wearable) } : {}),
    ...(record.lastBodySync || fallback?.lastBodySync ? { lastBodySync: String(record.lastBodySync ?? fallback?.lastBodySync) } : {}),
    skills: Array.isArray(record.skills) ? record.skills.filter((skill): skill is { key: string; label: string; score: number; trend: number } => Boolean(skill) && typeof skill === "object" && typeof (skill as { key?: unknown }).key === "string").map((skill) => ({ key: skill.key, label: skill.label, score: Number(skill.score ?? 0), trend: Number(skill.trend ?? 0) })) : (fallback?.skills ?? []),
  };
}

export const practices = [
  { id: "p1", date: "2026-08-28", day: "SEX", title: "Ritmo de prova · 200 Livre", distance: 5200, zone: "AN2", type: "swim", time: "07:30", status: "published", group: "Equipe inteira", rpe: 7 },
  { id: "p2", date: "2026-08-28", day: "SEX", title: "Força máxima · membros inferiores", distance: 0, zone: "FORÇA", type: "strength", time: "16:00", status: "published", group: "Elite", rpe: 8 },
  { id: "p3", date: "2026-08-29", day: "SÁB", title: "Aeróbio regenerativo + técnica", distance: 3800, zone: "A1", type: "swim", time: "08:00", status: "draft", group: "Equipe inteira", rpe: 4 },
  { id: "p4", date: "2026-08-31", day: "SEG", title: "VO₂ · tolerância ao lactato", distance: 4600, zone: "AN1", type: "swim", time: "06:30", status: "published", group: "Elite", rpe: 9 },
  { id: "p5", date: "2026-09-01", day: "TER", title: "Base aeróbia · eficiência", distance: 5800, zone: "A2", type: "swim", time: "07:00", status: "published", group: "Equipe inteira", rpe: 6 },
  { id: "p6", date: "2026-09-02", day: "QUA", title: "Potência e core", distance: 0, zone: "FORÇA", type: "strength", time: "16:30", status: "draft", group: "Desenvolvimento", rpe: 7 },
];

export const workoutLibrary = [
  { id: "lib1", title: "Ritmo de 200 · fechamento forte", distance: 5200, zone: "AN2", duration: "1h42", favorite: true, blocks: ["800 aquecimento misto", "12×50 técnica @1:00", "3× [4×100 AN2 @1:35 + 200 A1]", "600 soltura"] },
  { id: "lib2", title: "Aeróbio específico · eficiência", distance: 6100, zone: "A2", duration: "1h48", favorite: false, blocks: ["1000 aquecimento", "8×100 crawl @1:35", "4×800 A2 negativo", "700 recuperação"] },
  { id: "lib3", title: "Lactato · velocidade sustentada", distance: 4200, zone: "AN1", duration: "1h30", favorite: true, blocks: ["900 aquecimento", "8×25 submerso", "3× [4×50 máximo + 300 leve]", "700 soltura"] },
  { id: "lib4", title: "Regenerativo técnico", distance: 3200, zone: "A1", duration: "1h05", favorite: false, blocks: ["600 livre", "16×50 educativos", "8×100 nado completo", "600 soltura"] },
];

export const strengthLibrary = [
  { id: "s1", title: "Potência de saída", duration: "55 min", tonnage: "6,4 t", focus: "Membros inferiores", exercises: ["Trap bar jump 5×4", "Agachamento 4×5", "Box jump 5×3", "Core antirotação 4×8"] },
  { id: "s2", title: "Estabilidade de ombro", duration: "42 min", tonnage: "2,8 t", focus: "Prevenção", exercises: ["Y-T-W 3×10", "Landmine press 4×8", "Remada unilateral 4×10", "Rotação externa 3×15"] },
  { id: "s3", title: "Força máxima geral", duration: "70 min", tonnage: "10,2 t", focus: "Força máxima", exercises: ["Agachamento 5×3", "Supino 5×3", "Barra fixa 4×6", "RDL 4×5"] },
];

export const season = {
  name: "Temporada Olímpica 2026/27", starts: "04 ago 2026", ends: "19 jul 2027", week: 4, totalWeeks: 50,
  phases: [
    { name: "Base geral", focus: "BASE", start: "04 AGO", end: "20 SET", color: "#4e8ed0", progress: 45 },
    { name: "Construção específica", focus: "BUILD", start: "21 SET", end: "13 DEZ", color: "#16a085", progress: 0 },
    { name: "Competição de inverno", focus: "PEAK", start: "14 DEZ", end: "31 JAN", color: "#d36455", progress: 0 },
    { name: "Transição", focus: "RECOVERY", start: "01 FEV", end: "14 FEV", color: "#9c78cc", progress: 0 },
  ],
};

export const meets = [
  { id: "meet1", name: "Troféu Brasil - José Finkel", priority: "A", date: "18 SET", days: 21, location: "São Paulo · SP", pool: "50 m", qualified: 4, entries: 12 },
  { id: "meet2", name: "Campeonato Estadual Absoluto", priority: "B", date: "24 OUT", days: 57, location: "Curitiba · PR", pool: "25 m", qualified: 6, entries: 19 },
  { id: "meet3", name: "Open Internacional", priority: "A", date: "12 DEZ", days: 106, location: "Rio de Janeiro · RJ", pool: "50 m", qualified: 2, entries: 8 },
];

export const videos = [
  { id: "video-treino-diurno", athlete: "Ana Souza", initials: "AS", color: "#7357ef", event: "Técnica de crawl · sessão diurna", time: "16,95 s", date: "28 ago", status: "review", duration: "00:17", markers: 9, real: true, url: "/uploads/treino-tecnico-diurno-1080p.mp4", thumbnailUrl: "/uploads/treino-tecnico-diurno-1080p-thumb.jpg" },
  { id: "video-treino-noturno", athlete: "Caio Martins", initials: "CM", color: "#0da98b", event: "Ritmo e eficiência · sessão noturna", time: "24,88 s", date: "28 ago", status: "review", duration: "00:25", markers: 11, real: true, url: "/uploads/treino-tecnico-noturno-720p.mp4", thumbnailUrl: "/uploads/treino-tecnico-noturno-720p-thumb.jpg" },
  { id: "v3", athlete: "Pedro Lima", initials: "PL", color: "#e35f65", event: "200 m Peito", time: "2:15.41", date: "17 ago", status: "done", duration: "02:32", markers: 11 },
  { id: "v4", athlete: "Luiza Costa", initials: "LC", color: "#f09a3e", event: "100 m Costas", time: "1:03.86", date: "17 ago", status: "done", duration: "01:15", markers: 6 },
];

export const insights = [
  { id: "i1", type: "critical", title: "Readiness abaixo do padrão", body: "Luiza está 18% abaixo da média de 28 dias. Sono curto e HRV em queda.", time: "há 12 min", action: "Revisar atleta", target: "luiza-costa" },
  { id: "i2", type: "warning", title: "Volume caiu 14%", body: "Caio completou 3,9 km menos que a semana anterior.", time: "há 36 min", action: "Ver volume", target: "caio-martins" },
  { id: "i3", type: "video", title: "2 provas aguardam revisão", body: "Ana e Caio têm vídeos recentes sem feedback técnico.", time: "há 2 h", action: "Abrir fila", target: "videos" },
  { id: "i4", type: "success", title: "Pedro está perto da meta", body: "A diferença para 2:12.00 caiu 1,08 s nas últimas três provas.", time: "ontem", action: "Ver progresso", target: "pedro-lima" },
  { id: "i5", type: "account", title: "Convite pendente", body: "Gabriel ainda não ativou a conta enviada há quatro dias.", time: "há 4 dias", action: "Reenviar convite", target: "gabriel-rocha" },
];

export const connectors = [
  { id: "garmin", name: "Garmin Connect", mark: "G", category: "Relógios", status: "connected", read: true, write: true, athletes: 3, note: "Atividades, saúde e treinos estruturados" },
  { id: "polar", name: "Polar Flow", mark: "P", category: "Relógios e sensores", status: "connected", read: true, write: false, athletes: 1, note: "Atividades, sono e training targets" },
  { id: "google", name: "Google Health", mark: "GH", category: "Hub Android/iOS", status: "ready", read: true, write: false, athletes: 0, note: "Fitbit, Pixel, Xiaomi, Samsung e Amazfit" },
  { id: "oura", name: "Oura", mark: "O", category: "Anéis", status: "ready", read: true, write: false, athletes: 0, note: "Sono, HRV, readiness e recuperação" },
  { id: "whoop", name: "WHOOP", mark: "W", category: "Pulseiras", status: "connected", read: true, write: false, athletes: 1, note: "Recovery, strain, sono e exercícios" },
  { id: "apple", name: "Apple Health", mark: "A", category: "iPhone e Watch", status: "native", read: true, write: true, athletes: 0, note: "HealthKit/WorkoutKit exige app iOS" },
  { id: "withings", name: "Withings", mark: "WI", category: "Relógios e balanças", status: "ready", read: true, write: false, athletes: 0, note: "Sono, atividade e medidas corporais" },
  { id: "strava", name: "Strava", mark: "S", category: "Agregador", status: "ready", read: true, write: false, athletes: 0, note: "Ponte alternativa para atividades" },
];

export const zoneDistribution = [
  { code: "VALAT", label: "Velocidade alática", color: "#8f3db5", percent: 5, pace: "individual" },
  { code: "A1", label: "Regenerativo", color: "#2da7c7", percent: 25, pace: "1:38-1:48" },
  { code: "A2", label: "Aeróbio", color: "#174a8c", percent: 32, pace: "1:26-1:37" },
  { code: "A3", label: "Limiar", color: "#5572c8", percent: 18, pace: "1:18-1:25" },
  { code: "AN1", label: "Tolerância anaeróbia", color: "#df6b45", percent: 12, pace: "individual" },
  { code: "AN2", label: "Potência anaeróbia", color: "#c13d4d", percent: 8, pace: "individual" },
];
