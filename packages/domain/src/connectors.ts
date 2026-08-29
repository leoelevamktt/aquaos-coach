import type { ConnectorCapabilities, CompletedWorkout, DeviceConnection, Provider, WorkoutTemplate } from "./types.js";

export interface ConnectorResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  externalId?: string;
}

export interface DeviceConnector {
  readonly provider: Provider;
  readonly capabilities: ConnectorCapabilities;
  authorize(athleteId: string): Promise<ConnectorResult<DeviceConnection>>;
  pushWorkout(connection: DeviceConnection, workout: WorkoutTemplate, idempotencyKey: string): Promise<ConnectorResult<{ acceptedAt: string }>>;
  pullActivities(connection: DeviceConnection, since?: string): Promise<ConnectorResult<CompletedWorkout[]>>;
  revoke(connection: DeviceConnection): Promise<ConnectorResult<void>>;
}

const capabilities: Record<Provider, ConnectorCapabilities> = {
  garmin: { readActivities: true, writeWorkouts: true, webhooks: true, realtime: false, note: "Simulador de Garmin Connect: bidirecional no piloto." },
  polar: { readActivities: true, writeWorkouts: false, webhooks: true, realtime: false, note: "Simulador de Polar AccessLink: leitura no piloto; envio depende de autorização." },
  apple: { readActivities: true, writeWorkouts: true, webhooks: false, realtime: true, note: "Simulador Apple HealthKit/WorkoutKit; requer app iOS para relógio real." },
};

export class SimulatedConnector implements DeviceConnector {
  constructor(readonly provider: Provider) {}
  get capabilities(): ConnectorCapabilities { return capabilities[this.provider]; }

  async authorize(athleteId: string): Promise<ConnectorResult<DeviceConnection>> {
    return { ok: true, data: { id: `conn-${this.provider}-${athleteId}`, organizationId: "org-demo", athleteId, provider: this.provider, status: "connected", capabilities: this.capabilities } };
  }

  async pushWorkout(connection: DeviceConnection, _workout: WorkoutTemplate, idempotencyKey: string): Promise<ConnectorResult<{ acceptedAt: string }>> {
    if (!this.capabilities.writeWorkouts) return { ok: false, error: "Este conector não oferece envio de treinos no modo atual." };
    return { ok: true, externalId: `${this.provider}-workout-${idempotencyKey}`, data: { acceptedAt: new Date().toISOString() } };
  }

  async pullActivities(connection: DeviceConnection, since?: string): Promise<ConnectorResult<CompletedWorkout[]>> {
    const start = since ?? new Date(Date.now() - 86400000).toISOString();
    const end = new Date(Date.parse(start) + 3600000).toISOString();
    return { ok: true, data: [{ id: `activity-${this.provider}-${connection.athleteId}`, organizationId: connection.organizationId, athleteId: connection.athleteId, startedAt: start, endedAt: end, distanceMeters: 4200, durationSeconds: 3600, completedSteps: 8, totalSteps: 8, averageHeartRate: 148, averagePaceSecondsPer100m: 92, rpe: 7, source: this.provider, externalId: `external-${this.provider}-${connection.athleteId}`, rawPayload: { simulator: true, provider: this.provider } }] };
  }

  async revoke(_connection: DeviceConnection): Promise<ConnectorResult<void>> {
    return { ok: true };
  }
}

export function createSimulatedConnector(provider: Provider): DeviceConnector {
  return new SimulatedConnector(provider);
}
