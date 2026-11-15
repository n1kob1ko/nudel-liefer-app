import { z } from "zod";

/**
 * "Problem" in the driver app (owner 2026-11-14): no report, no reasons, the driver calls this
 * number. The office sets it in the settings; until then a dummy stands in.
 */
export const DEFAULT_PROBLEM_PHONE = "+43 1 000 00 00";

/** A phone number as typed by the office: digits, an optional leading "+", spaces, "/", "-", "()". */
export const problemPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^\+?[0-9 ()/-]+$/)
  .refine((value) => value.replace(/\D/g, "").length >= 3);

/** `tel:` link for a typed number: only the digits and a leading "+" (RFC 3966 global form). */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}
