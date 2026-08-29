import type { LoadEngine, LoadEngineInput, LoadEngineOutput } from "./types.js";

/**
 * Demonstration-only calculation. It is intentionally transparent and must not
 * be presented as the coach's proprietary method.
 */
export class DemoLoadEngine implements LoadEngine {
  readonly name = "DemoLoadEngine";
  readonly version = "demo-1.0";

  calculate(input: LoadEngineInput): LoadEngineOutput {
    const distanceKm = input.completedDistanceMeters / 1000;
    const durationMinutes = input.durationSeconds / 60;
    const rpe = Math.max(0, Math.min(10, input.rpe));
    const intensity = Math.max(0.5, Math.min(2, input.targetIntensity ?? 1));
    const completion = input.prescribedDistanceMeters > 0
      ? Math.min(1.2, input.completedDistanceMeters / input.prescribedDistanceMeters)
      : 1;
    const wellnessPenalty = ((input.wellness?.fatigue ?? 0) + (input.wellness?.soreness ?? 0)) * 0.5;
    const distanceComponent = distanceKm * 2;
    const durationComponent = durationMinutes * 0.15;
    const perceivedComponent = rpe * 2.5;
    const value = Math.round(Math.max(0, (distanceComponent + durationComponent + perceivedComponent) * intensity * completion - wellnessPenalty) * 10) / 10;
    const adherence = Math.round(Math.min(1, completion) * 100);

    return {
      value,
      acute: value,
      chronic: Math.round(value * 0.82 * 10) / 10,
      adherence,
      components: {
        distance: Math.round(distanceComponent * 10) / 10,
        duration: Math.round(durationComponent * 10) / 10,
        perceived: Math.round(perceivedComponent * 10) / 10,
        intensity,
        wellnessPenalty: Math.round(wellnessPenalty * 10) / 10,
      },
      explanation: "Demonstração: distância + duração + RPE, ponderados pela intensidade e aderência, com ajuste simples de bem-estar.",
      engine: this.name,
      engineVersion: this.version,
    };
  }
}

/** Extension point reserved for the coach's proprietary formula. */
export class ProprietaryLoadEngine implements LoadEngine {
  readonly name = "ProprietaryLoadEngine";
  readonly version = "pending-method-input";

  calculate(_input: LoadEngineInput): LoadEngineOutput {
    throw new Error("O método proprietário ainda não foi fornecido e validado.");
  }
}
