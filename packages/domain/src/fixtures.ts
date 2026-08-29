import type { Athlete, CompletedWorkout, Pool, TeamGroup, WorkoutTemplate } from "./types.js";

export const demoAthletes: Athlete[] = [
  { id: "ath-ana", organizationId: "org-demo", name: "Ana Souza", email: "ana@natacao.local", birthDate: "2002-04-11", primaryStroke: "freestyle", level: "alto_rendimento", groupIds: ["group-principal"], avatarColor: "#8b5cf6" },
  { id: "ath-caio", organizationId: "org-demo", name: "Caio Martins", email: "caio@natacao.local", birthDate: "2004-09-18", primaryStroke: "butterfly", level: "competitivo", groupIds: ["group-principal"], avatarColor: "#14b8a6" },
  { id: "ath-luiza", organizationId: "org-demo", name: "Luiza Costa", email: "luiza@natacao.local", birthDate: "2005-01-26", primaryStroke: "backstroke", level: "competitivo", groupIds: ["group-base"], avatarColor: "#f59e0b" },
  { id: "ath-pedro", organizationId: "org-demo", name: "Pedro Lima", email: "pedro@natacao.local", birthDate: "2003-07-02", primaryStroke: "breaststroke", level: "competitivo", groupIds: ["group-base"], avatarColor: "#ef4444" },
];

export const demoGroups: TeamGroup[] = [
  { id: "group-principal", organizationId: "org-demo", name: "Principal", description: "Bloco de alto rendimento", athleteIds: ["ath-ana", "ath-caio"] },
  { id: "group-base", organizationId: "org-demo", name: "Base competitiva", description: "Desenvolvimento e consistência", athleteIds: ["ath-luiza", "ath-pedro"] },
];

export const demoPools: Pool[] = [
  { id: "pool-50", organizationId: "org-demo", name: "Parque Aquático - piscina olímpica", lengthMeters: 50 },
  { id: "pool-25", organizationId: "org-demo", name: "Centro de treinamento", lengthMeters: 25 },
];

export const demoWorkout: WorkoutTemplate = {
  id: "workout-intervalos",
  organizationId: "org-demo",
  title: "Aeróbio específico - 4.200 m",
  sportContext: "pool",
  scheduledDate: new Date().toISOString().slice(0, 10),
  objective: "Sustentar ritmo de prova com economia técnica.",
  poolId: "pool-50",
  status: "published",
  version: 3,
  createdBy: "user-coach",
  createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  updatedAt: new Date(Date.now() - 86400000).toISOString(),
  blocks: [
    { id: "block-1", name: "Aquecimento", order: 1, repeatCount: 1, steps: [{ id: "step-1", order: 1, kind: "warmup", repetitions: 1, distanceMeters: 800, stroke: "mixed", targetType: "rpe", targetValue: "RPE 4", intervalSeconds: 900, equipment: [], notes: "Progressivo a cada 200 m" }] },
    { id: "block-2", name: "Série principal", order: 2, repeatCount: 1, steps: [{ id: "step-2", order: 1, kind: "main", repetitions: 8, distanceMeters: 300, stroke: "freestyle", targetType: "pace", targetValue: "ritmo de prova + 5s", intervalSeconds: 300, equipment: ["pull buoy"], notes: "Manter saída controlada" }, { id: "step-3", order: 2, kind: "recovery", repetitions: 4, distanceMeters: 100, stroke: "backstroke", targetType: "rpe", targetValue: "RPE 3", intervalSeconds: 120, equipment: [] }] },
    { id: "block-3", name: "Soltura", order: 3, repeatCount: 1, steps: [{ id: "step-4", order: 1, kind: "cooldown", repetitions: 1, distanceMeters: 1000, stroke: "mixed", targetType: "free", intervalSeconds: 1200, equipment: [], notes: "Soltura com foco respiratório" }] },
  ],
};

export const demoCompleted: CompletedWorkout[] = [{ id: "completed-1", organizationId: "org-demo", prescriptionId: "prescription-1", athleteId: "ath-ana", startedAt: new Date(Date.now() - 3600000).toISOString(), endedAt: new Date().toISOString(), distanceMeters: 4200, durationSeconds: 3600, completedSteps: 8, totalSteps: 8, averageHeartRate: 148, averagePaceSecondsPer100m: 92, rpe: 7, source: "synthetic", externalId: "synthetic-1", rawPayload: { simulator: true } }];
