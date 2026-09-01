import { z } from "zod";

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Aceita somente datas de calendário reais (AAAA-MM-DD): além do formato,
 * a conversão precisa ser idempotente para rejeitar valores como 2026-99-99.
 */
export const calendarDateSchema = z.string().regex(DATE_PATTERN).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data inválida");

export function isValidCalendarDate(value: unknown): value is string {
  return calendarDateSchema.safeParse(value).success;
}
