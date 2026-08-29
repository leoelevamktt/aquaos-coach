export type Role = "admin" | "coach" | "athlete";
export type SportContext = "pool" | "open_water";
export type Stroke = "freestyle" | "backstroke" | "breaststroke" | "butterfly" | "individual_medley" | "mixed" | "drill";
export type TargetType = "pace" | "heart_rate" | "rpe" | "technique" | "free";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  athleteId?: string;
}

export interface Athlete {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  birthDate: string;
  primaryStroke: Stroke;
  level: "base" | "competitivo" | "alto_rendimento";
  groupIds: string[];
  avatarColor: string;
}

export interface TeamGroup {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  athleteIds: string[];
}

export interface Pool {
  id: string;
  organizationId: string;
  name: string;
  lengthMeters: number;
}

export interface WorkoutStep {
  id: string;
  order: number;
  kind: "warmup" | "main" | "recovery" | "cooldown" | "technical";
  repetitions: number;
  distanceMeters?: number;
  durationSeconds?: number;
  stroke: Stroke;
  targetType: TargetType;
  targetValue?: string;
  intervalSeconds?: number;
  equipment: string[];
  notes?: string;
}

export interface WorkoutBlock {
  id: string;
  name: string;
  order: number;
  repeatCount: number;
  steps: WorkoutStep[];
}

export interface WorkoutTemplate {
  id: string;
  organizationId: string;
  title: string;
  sportContext: SportContext;
  scheduledDate: string;
  objective: string;
  poolId?: string;
  blocks: WorkoutBlock[];
  status: "draft" | "published" | "archived";
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AthleteOverride {
  athleteId: string;
  changedFields: Record<string, unknown>;
  note?: string;
}

export interface Prescription {
  id: string;
  organizationId: string;
  workoutTemplateId: string;
  workoutVersion: number;
  targetType: "team" | "group" | "athlete";
  targetId: string;
  athleteOverrides: AthleteOverride[];
  publishedAt: string;
  status: "scheduled" | "started" | "completed" | "cancelled";
}

export interface CompletedWorkout {
  id: string;
  organizationId: string;
  prescriptionId?: string;
  athleteId: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  durationSeconds: number;
  completedSteps: number;
  totalSteps: number;
  averageHeartRate?: number;
  averagePaceSecondsPer100m?: number;
  rpe?: number;
  source: "manual" | "garmin" | "polar" | "apple" | "synthetic";
  externalId?: string;
  rawPayload?: unknown;
}

export interface WellnessCheckin {
  id: string;
  organizationId: string;
  athleteId: string;
  date: string;
  sleepHours?: number;
  fatigue?: number;
  soreness?: number;
  pain?: number;
  note?: string;
}

export interface LoadSnapshot {
  id: string;
  organizationId: string;
  athleteId: string;
  date: string;
  value: number;
  acute: number;
  chronic: number;
  components: Record<string, number>;
  explanation: string;
  engine: string;
  engineVersion: string;
  source: string;
}

export type Provider = "garmin" | "polar" | "apple";
export interface DeviceConnection {
  id: string;
  organizationId: string;
  athleteId: string;
  provider: Provider;
  status: "connected" | "pending" | "error" | "revoked";
  capabilities: ConnectorCapabilities;
  lastSyncedAt?: string;
  lastError?: string;
}

export interface SyncJob {
  id: string;
  connectionId: string;
  provider: Provider;
  direction: "push" | "pull";
  status: "queued" | "running" | "completed" | "failed";
  idempotencyKey: string;
  externalId?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ConnectorCapabilities {
  readActivities: boolean;
  writeWorkouts: boolean;
  webhooks: boolean;
  realtime: boolean;
  note: string;
}

export interface LoadEngineInput {
  prescribedDistanceMeters: number;
  completedDistanceMeters: number;
  durationSeconds: number;
  rpe: number;
  averageHeartRate?: number;
  targetIntensity?: number;
  wellness?: Pick<WellnessCheckin, "fatigue" | "soreness" | "sleepHours">;
}

export interface LoadEngineOutput {
  value: number;
  acute: number;
  chronic: number;
  adherence: number;
  components: Record<string, number>;
  explanation: string;
  engine: string;
  engineVersion: string;
}

export interface LoadEngine {
  readonly name: string;
  readonly version: string;
  calculate(input: LoadEngineInput): LoadEngineOutput;
}
