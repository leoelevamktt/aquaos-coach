import {
  DemoLoadEngine,
  createSimulatedConnector,
  demoAthletes,
  demoCompleted,
  demoGroups,
  demoPools,
  demoWorkout,
  type Athlete,
  type CompletedWorkout,
  type DeviceConnection,
  type LoadSnapshot,
  type Prescription,
  type Provider,
  type SyncJob,
  type TeamGroup,
  type WellnessCheckin,
  type WorkoutTemplate,
} from "@natacao/domain";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export class DemoStore {
  readonly organizationId = "org-demo";
  readonly athletes: Athlete[] = structuredClone(demoAthletes);
  readonly groups: TeamGroup[] = structuredClone(demoGroups);
  readonly pools = structuredClone(demoPools);
  readonly workouts: WorkoutTemplate[] = [structuredClone(demoWorkout)];
  readonly prescriptions: Prescription[] = [{ id: "prescription-1", organizationId: this.organizationId, workoutTemplateId: demoWorkout.id, workoutVersion: demoWorkout.version, targetType: "group", targetId: "group-principal", athleteOverrides: [], publishedAt: now(), status: "started" }];
  readonly completed: CompletedWorkout[] = structuredClone(demoCompleted);
  readonly wellness: WellnessCheckin[] = [{ id: "wellness-1", organizationId: this.organizationId, athleteId: "ath-ana", date: new Date().toISOString().slice(0, 10), sleepHours: 7.5, fatigue: 3, soreness: 2, pain: 0, note: "Boa disposição para a sessão." }];
  readonly loadSnapshots: LoadSnapshot[] = [];
  readonly connections: DeviceConnection[] = [
    { id: "conn-garmin-ath-ana", organizationId: this.organizationId, athleteId: "ath-ana", provider: "garmin", status: "connected", capabilities: createSimulatedConnector("garmin").capabilities, lastSyncedAt: new Date(Date.now() - 3600000).toISOString() },
    { id: "conn-polar-ath-caio", organizationId: this.organizationId, athleteId: "ath-caio", provider: "polar", status: "connected", capabilities: createSimulatedConnector("polar").capabilities, lastSyncedAt: new Date(Date.now() - 86400000).toISOString() },
  ];
  readonly syncJobs: SyncJob[] = [];
  private readonly engine = new DemoLoadEngine();

  dashboard() {
    const totalDistance = this.completed.reduce((sum, item) => sum + item.distanceMeters, 0);
    const averageRpe = this.completed.length ? this.completed.reduce((sum, item) => sum + (item.rpe ?? 0), 0) / this.completed.length : 0;
    const recentLoad = this.loadSnapshots.reduce((sum, item) => sum + item.value, 0);
    return { organization: { id: this.organizationId, name: "Natação Performance" }, kpis: { athletes: this.athletes.length, activeAthletes: this.athletes.length, plannedWorkouts: this.workouts.filter((w) => w.status === "published").length, totalDistance, averageRpe: Math.round(averageRpe * 10) / 10, recentLoad }, agenda: this.workouts.slice().sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)), load: this.loadSnapshots.slice(-10), connections: this.connections };
  }

  createWorkout(input: Pick<WorkoutTemplate, "title" | "scheduledDate" | "objective" | "sportContext" | "blocks"> & { poolId?: string }) {
    const workout: WorkoutTemplate = { ...input, id: id("workout"), organizationId: this.organizationId, poolId: input.poolId, status: "draft", version: 1, createdBy: "user-coach", createdAt: now(), updatedAt: now() };
    this.workouts.push(workout);
    return workout;
  }

  publishWorkout(workoutId: string, targetType: Prescription["targetType"], targetId: string, athleteOverrides: Prescription["athleteOverrides"] = []) {
    const workout = this.workouts.find((item) => item.id === workoutId);
    if (!workout) throw new Error("Treino não encontrado");
    workout.status = "published";
    workout.version += 1;
    workout.updatedAt = now();
    const prescription: Prescription = { id: id("prescription"), organizationId: this.organizationId, workoutTemplateId: workout.id, workoutVersion: workout.version, targetType, targetId, athleteOverrides, publishedAt: now(), status: "scheduled" };
    this.prescriptions.push(prescription);
    return prescription;
  }

  recordCompleted(input: Omit<CompletedWorkout, "id" | "organizationId">) {
    const result: CompletedWorkout = { ...input, id: id("completed"), organizationId: this.organizationId };
    if (input.externalId && this.completed.some((item) => item.externalId === input.externalId)) return this.completed.find((item) => item.externalId === input.externalId)!;
    this.completed.push(result);
    const wellness = this.wellness.find((item) => item.athleteId === input.athleteId && item.date === input.startedAt.slice(0, 10));
    const prescription = input.prescriptionId ? this.prescriptions.find((item) => item.id === input.prescriptionId) : undefined;
    const prescribedWorkout = prescription ? this.workouts.find((item) => item.id === prescription.workoutTemplateId) : undefined;
    const prescribedDistance = prescribedWorkout ? prescribedWorkout.blocks.reduce((sum, block) => sum + block.steps.reduce((stepSum, step) => stepSum + (step.distanceMeters ?? 0) * step.repetitions, 0) * block.repeatCount, 0) : input.distanceMeters;
    const load = this.engine.calculate({ prescribedDistanceMeters: prescribedDistance, completedDistanceMeters: input.distanceMeters, durationSeconds: input.durationSeconds, rpe: input.rpe ?? 5, averageHeartRate: input.averageHeartRate, wellness });
    this.loadSnapshots.push({ id: id("load"), organizationId: this.organizationId, athleteId: input.athleteId, date: input.startedAt.slice(0, 10), value: load.value, acute: load.acute, chronic: load.chronic, components: load.components, explanation: load.explanation, engine: load.engine, engineVersion: load.engineVersion, source: input.source });
    return result;
  }

  addWellness(input: Omit<WellnessCheckin, "id" | "organizationId">) {
    const checkin = { ...input, id: id("wellness"), organizationId: this.organizationId };
    this.wellness.push(checkin);
    return checkin;
  }

  async sync(provider: Provider, athleteId: string, direction: "push" | "pull") {
    let connection = this.connections.find((item) => item.provider === provider && item.athleteId === athleteId);
    if (!connection) {
      connection = { id: id("connection"), organizationId: this.organizationId, athleteId, provider, status: "connected", capabilities: createSimulatedConnector(provider).capabilities, lastSyncedAt: now() };
      this.connections.push(connection);
    }
    const job: SyncJob = { id: id("sync"), connectionId: connection.id, provider, direction, status: "running", idempotencyKey: id("key"), createdAt: now() };
    this.syncJobs.push(job);
    const connector = createSimulatedConnector(provider);
    if (direction === "push") {
      const workout = this.workouts.find((item) => item.status === "published")!;
      const result = await connector.pushWorkout(connection, workout, job.idempotencyKey);
      if (!result.ok) { job.status = "failed"; job.error = result.error; throw new Error(result.error); }
      job.status = "completed"; job.externalId = result.externalId; job.completedAt = now(); connection.lastSyncedAt = now();
      return { job, message: `Treino enviado ao simulador ${provider}.` };
    }
    const result = await connector.pullActivities(connection, new Date(Date.now() - 86400000).toISOString());
    if (!result.ok || !result.data) { job.status = "failed"; job.error = result.error; throw new Error(result.error ?? "Falha de sincronização"); }
    const imported = result.data.map((item) => this.recordCompleted(item));
    job.status = "completed"; job.completedAt = now(); connection.lastSyncedAt = now();
    return { job, imported, message: `${imported.length} atividade(s) importada(s) do simulador ${provider}.` };
  }
}
