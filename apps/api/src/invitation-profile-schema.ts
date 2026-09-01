import { z } from "zod";
import { calendarDateSchema } from "./date-schema.js";

/**
 * Perfil aceito no aceite de convite (rota pública). Equivalente ao schema do
 * endpoint autenticado do perfil do atleta: datas de calendário reais, limites
 * de arrays/estrutura e campos desconhecidos descartados pelo Zod.
 */
export const invitationProfileSchema = z.object({
  birthDate: calendarDateSchema.optional(),
  sex: z.string().trim().max(40).optional(),
  category: z.string().trim().max(80).optional(),
  events: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
  otherEvent: z.string().trim().max(80).optional(),
  level: z.string().trim().max(80).optional(),
  club: z.string().trim().max(160).optional(),
  targetMeet: z.string().trim().max(160).optional(),
  meetDate: calendarDateSchema.optional(),
  primaryEvent: z.string().trim().max(80).optional(),
  secondaryEvent: z.string().trim().max(80).optional(),
  objective: z.string().trim().max(160).optional(),
  availability: z.object({
    sessionsPerWeek: z.number().int().min(3).max(12),
    days: z.array(z.string()).max(7),
    periods: z.array(z.string()).max(3),
  }).optional(),
  consents: z.object({
    medical: z.object({
      acceptedAt: z.string().datetime(),
      version: z.string().trim().min(1).max(40),
      origin: z.string().trim().min(1).max(80),
    }),
    responsibility: z.object({
      acceptedAt: z.string().datetime(),
      version: z.string().trim().min(1).max(40),
      origin: z.string().trim().min(1).max(80),
    }),
  }).optional(),
});
