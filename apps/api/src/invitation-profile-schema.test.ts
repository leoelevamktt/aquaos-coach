import { describe, expect, it } from "vitest";
import { invitationProfileSchema } from "./invitation-profile-schema.js";

describe("invitationProfileSchema", () => {
  it("aceita um perfil completo e válido", () => {
    const parsed = invitationProfileSchema.safeParse({
      birthDate: "2002-04-11",
      sex: "Feminino",
      category: "Absoluto",
      events: ["50L", "100L"],
      level: "Nacional",
      club: "Clube de referência",
      targetMeet: "Troféu Brasil",
      meetDate: "2026-09-18",
      primaryEvent: "100L",
      objective: "Final nacional",
      availability: { sessionsPerWeek: 6, days: ["SEG", "QUA"], periods: ["Manhã"] },
      consents: {
        medical: { acceptedAt: "2026-09-01T10:00:00.000Z", version: "2026-01", origin: "athlete-app:onboarding" },
        responsibility: { acceptedAt: "2026-09-01T12:00:00.000Z", version: "2026-01", origin: "athlete-app:onboarding" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita datas de calendário impossíveis", () => {
    for (const field of ["birthDate", "meetDate"] as const) {
      expect(invitationProfileSchema.safeParse({ [field]: "2026-99-99" }).success).toBe(false);
      expect(invitationProfileSchema.safeParse({ [field]: "2026-02-30" }).success).toBe(false);
      expect(invitationProfileSchema.safeParse({ [field]: "2026-09-01" }).success).toBe(true);
    }
  });

  it("descarta campos desconhecidos em vez de persisti-los", () => {
    const parsed = invitationProfileSchema.safeParse({ club: "Clube", isAdmin: true, internalNotes: "x" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).not.toContain("isAdmin");
      expect(Object.keys(parsed.data)).not.toContain("internalNotes");
    }
  });
});
