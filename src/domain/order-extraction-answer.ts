import { z } from "zod";

/**
 * The exact JSON answer of the order-extraction model (NUD-150, D26). A leaf module on purpose:
 * `src/domain/order.ts` stores the answer with the order and `src/domain/order-extraction.ts` maps it
 * to catalog products, so the schema must not import either of them (no import cycle).
 */

export const MAX_EXTRACTION_LINES = 100;

/** Pasted customer messages are short; WhatsApp/WeChat texts stay far below this. */
export const MAX_SOURCE_TEXT = 4000;

/**
 * The requested delivery window. Models answer the object the prompt describes *or*, very often, the
 * words they read ("morgen vormittag") as a plain string. Both are accepted: a string is not an
 * error, it is a hint the office resolves by hand (`OrderDraft.windowNote`) - refusing the whole
 * answer because of it would throw away lines that are perfectly fine (measured against
 * deepseek/deepseek-v4.1-flash-1017 on 2026-10-28).
 */
export const extractionWindowSchema = z.union([
  z.object({
    from: z.string().trim().max(10).nullish(),
    to: z.string().trim().max(10).nullish(),
    fromTime: z.string().trim().max(5).nullish(),
    toTime: z.string().trim().max(5).nullish(),
    confidence: z.number().min(0).max(1).default(0.5),
  }),
  z.string().trim().max(200),
]);

export const extractionAnswerSchema = z.object({
  lines: z
    .array(
      z.object({
        /** The product words as they appear in the message, e.g. "Nudeln Kiste" or "面条 箱". */
        label: z.string().trim().min(1).max(120),
        quantity: z.number().int().min(1).max(99_999),
        confidence: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(MAX_EXTRACTION_LINES),
  window: extractionWindowSchema.nullish(),
  /**
   * The sender's name as it stands on the photo (chat title, signature, letterhead), NUD-210. The
   * words, never an id: `matchCustomer` and the office decide which customer that is.
   */
  customer: z.string().trim().max(200).nullish(),
  /** Free text (notes, delivery hints) the office may want; never filled into the order by itself. */
  note: z.string().trim().max(1000).nullish(),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ExtractionAnswer = z.output<typeof extractionAnswerSchema>;
