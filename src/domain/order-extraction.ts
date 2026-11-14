import type { LocalizedText } from "@/lib/localized-text";

import { mergeOrderLines, type OrderLine, parseCalendarDate, parseQuantity } from "./order";
import type { ExtractionAnswer } from "./order-extraction-answer";

export {
  type ExtractionAnswer,
  extractionAnswerSchema,
  MAX_EXTRACTION_LINES,
  MAX_SOURCE_TEXT,
} from "./order-extraction-answer";

/**
 * Pure rules of the AI order draft (NUD-150, D26): the shape the language model must answer in
 * (`extractionAnswerSchema`), the mapping from its product labels to catalog products
 * (`matchProduct`, `assembleDraft`) and the prompt built from the catalog. No framework and no
 * network imports - the provider lives in `src/server/order-extractor`.
 *
 * The model never invents catalog ids: it answers with the words it read, and this module decides
 * what they mean. An ambiguous or unknown product is reported, never guessed into a line - a wrong
 * delivery quantity is the one thing that must not happen (backlog §1).
 */

export type ProductUnit = "KG" | "PACK" | "CRATE" | "PIECE";

export type CatalogProduct = { id: string; name: LocalizedText; unit: ProductUnit };

export type MatchedLine = {
  productId: string;
  /** Digits as typed into the form. */
  quantity: string;
  confidence: number;
  /** The words the model read for this line. */
  label: string;
};

export type UnmatchedLine = {
  label: string;
  quantity: number | null;
  reason: "unknown_product" | "ambiguous_product" | "invalid_quantity";
  /** Catalog products that were plausible, for the office to pick from by hand. */
  candidates: string[];
};

export type DraftWindow = { from: string; to: string; fromTime: string; toTime: string };

export type OrderDraft = {
  /** Lines that can be filled into the form as-is. */
  lines: MatchedLine[];
  /** What the model saw but could not be mapped - the office decides. */
  unmatched: UnmatchedLine[];
  /** Requested window, or `null` when the message had none (or an unusable one). */
  window: DraftWindow | null;
  windowConfidence: number;
  /**
   * The words the model used for the window when it named the time in plain language ("morgen
   * vormittag") instead of dates. `window` is then `null` and the office sets it by hand.
   */
  windowNote: string | null;
  /** Note the message carried, if any. */
  note: string | null;
  /** 0..1: the weakest matched line, so one uncertain line pulls the whole draft down. */
  confidence: number;
};

/** One catalog product scored against the words of the message. */
export type ProductMatch = {
  productId: string;
  score: number;
  /** True when two products are equally plausible - the office has to choose. */
  ambiguous: boolean;
  /** Ids of everything that scored, best first. */
  candidates: string[];
};

/** Lowercases, folds accents and turns everything that is not a letter or digit into a space. */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words that mean a packaging unit in one of the five locales (the reader needs no locale code). */
const UNIT_WORDS: ReadonlyArray<{ unit: ProductUnit; words: readonly string[] }> = [
  {
    unit: "PACK",
    words: ["sackerl", "sack", "beutel", "packung", "pack", "bag", "sacek", "袋", "包"],
  },
  {
    unit: "CRATE",
    words: ["kiste", "karton", "carton", "crate", "box", "纸箱", "箱"],
  },
  { unit: "KG", words: ["kg", "kilo", "kilogramm", "公斤", "千克"] },
  { unit: "PIECE", words: ["stuck", "stueck", "stk", "st", "piece", "pcs", "件", "个"] },
];

/** The unit the message mentions, or `null` when it only names a product. */
export function unitHintFromLabel(label: string): ProductUnit | null {
  const normalized = normalizeLabel(label);
  const tokens = normalized.split(" ");
  for (const { unit, words } of UNIT_WORDS) {
    if (tokens.some((token) => words.some((word) => matchesUnitWord(token, word, normalized)))) {
      return unit;
    }
  }
  return null;
}

/**
 * Unit words appear in the plural in real messages ("2 Kisten", "3 Packungen"), so a word of at
 * least four characters also matches as the beginning of a token; the short ones (kg, 箱, 件) must
 * match exactly - or, for Chinese, anywhere in the label, because Chinese is written without spaces
 * ("3 箱面条").
 */
function matchesUnitWord(token: string, word: string, normalized: string): boolean {
  if (token === word) return true;
  if (word.length >= 4 && token.startsWith(word)) return true;
  return !/[a-z]/.test(word) && normalized.includes(word);
}

/** Longest catalog name (any locale) contained in the label, or 0. */
function nameScore(normalizedLabel: string, name: LocalizedText): number {
  let best = 0;
  for (const value of Object.values(name)) {
    if (typeof value !== "string") continue;
    const normalizedName = normalizeLabel(value);
    if (normalizedName.length < 2) continue;
    if (normalizedLabel.includes(normalizedName) && normalizedName.length > best) {
      best = normalizedName.length;
    }
  }
  return best;
}

/**
 * Scores the products of the catalog against the words the model read. The unit decides between
 * products that share a name ("Nudeln" in Sackerl or Kiste), so "2 Karton Nudeln" cannot silently
 * become two Sackerl. Returns `null` when no product name appears at all.
 */
export function matchProduct(
  label: string,
  catalog: readonly CatalogProduct[],
  unitOverride: ProductUnit | null = null,
): ProductMatch | null {
  const normalized = normalizeLabel(label);
  const hint = unitOverride ?? unitHintFromLabel(label);
  const scored = catalog
    .map((product) => {
      const score = nameScore(normalized, product.name) + unitBonus(product, hint);
      return { productId: product.id, score, name: nameScore(normalized, product.name) };
    })
    .filter((entry) => entry.name >= 2 && entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const best = scored[0]!;
  const ambiguous = scored.some(
    (entry) => entry.productId !== best.productId && entry.score === best.score,
  );
  return {
    productId: best.productId,
    score: best.score,
    ambiguous,
    candidates: scored.map((entry) => entry.productId),
  };
}

/** What `matchCustomer` compares the name on the photo with. */
export type CustomerName = {
  id: string;
  name: string;
  companyName?: string | null;
  abbreviation?: string | null;
};

/** Latin names shorter than this only match as the whole name ("Li" is inside too many words). */
const MIN_CONTAINED_NAME = 4;

/**
 * The customer a name read from a photo belongs to (NUD-210), or `null`. Like `matchProduct` it
 * never guesses: the name, the company name or the Abkürzung must be the whole text, or the name
 * must stand in it as whole words ("Wok Palace Küche"); when two customers fit equally well nobody
 * is proposed and the office picks. The result is a proposal, the office confirms it.
 */
export function matchCustomer(
  hint: string | null | undefined,
  customers: readonly CustomerName[],
): string | null {
  const normalized = normalizeLabel(hint ?? "");
  if (normalized === "") return null;
  let best: { id: string; score: number } | null = null;
  let tied = false;
  for (const customer of customers) {
    const score = customerScore(normalized, customer);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: customer.id, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  return best && !tied ? best.id : null;
}

function customerScore(normalizedHint: string, customer: CustomerName): number {
  let best = 0;
  const names = [customer.name, customer.companyName];
  for (const value of [...names, customer.abbreviation]) {
    const name = normalizeLabel(value ?? "");
    if (name === "") continue;
    // The whole text is the name: stronger than any name that is merely contained.
    if (name === normalizedHint) best = Math.max(best, 1000 + name.length);
  }
  for (const value of names) {
    const name = normalizeLabel(value ?? "");
    if (name === "" || name === normalizedHint) continue;
    if (containsName(normalizedHint, name)) best = Math.max(best, name.length);
  }
  return best;
}

/** Whole words for Latin names; anywhere for names without Latin letters (Chinese has no spaces). */
function containsName(normalizedHint: string, name: string): boolean {
  if (!/[a-z]/.test(name)) return name.length >= 2 && normalizedHint.includes(name);
  return name.length >= MIN_CONTAINED_NAME && ` ${normalizedHint} `.includes(` ${name} `);
}

function unitBonus(product: CatalogProduct, hint: ProductUnit | null): number {
  if (!hint) return 0;
  return product.unit === hint ? 2 : -1;
}

/**
 * Validates the window of an answer against the pure order rules; unusable dates are dropped. A
 * window written as words ("morgen vormittag") cannot become a date, so it is returned as a note for
 * the office instead of silently disappearing.
 */
function draftWindow(answer: ExtractionAnswer): {
  window: DraftWindow | null;
  confidence: number;
  note: string | null;
} {
  const raw = answer.window;
  if (!raw) return { window: null, confidence: 0, note: null };
  if (typeof raw === "string") {
    return { window: null, confidence: 0, note: raw.trim() === "" ? null : raw.trim() };
  }
  const from = raw.from ? parseCalendarDate(raw.from) : null;
  const to = raw.to ? parseCalendarDate(raw.to) : from;
  if (!from || !to || to.getTime() < from.getTime()) {
    return { window: null, confidence: 0, note: null };
  }
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    window: {
      from: iso(from),
      to: iso(to),
      fromTime: raw.fromTime ?? "",
      toTime: raw.toTime ?? "",
    },
    confidence: raw.confidence,
    note: null,
  };
}

/**
 * Turns the model's answer into the draft the form shows. Catalog ids come from `matchProduct`
 * only; a line whose product stays unknown lands in `unmatched` with its candidates, and duplicates
 * of the same product are merged exactly like manual entry does.
 */
export function assembleDraft(
  answer: ExtractionAnswer,
  catalog: readonly CatalogProduct[],
): OrderDraft {
  const matched: MatchedLine[] = [];
  const unmatched: UnmatchedLine[] = [];
  for (const line of answer.lines) {
    const quantity = parseQuantity(line.quantity);
    if (quantity === null) {
      unmatched.push({
        label: line.label,
        quantity: null,
        reason: "invalid_quantity",
        candidates: [],
      });
      continue;
    }
    const match = matchProduct(line.label, catalog);
    if (!match) {
      unmatched.push({
        label: line.label,
        quantity,
        reason: "unknown_product",
        candidates: [],
      });
      continue;
    }
    if (match.ambiguous) {
      unmatched.push({
        label: line.label,
        quantity,
        reason: "ambiguous_product",
        candidates: match.candidates,
      });
      continue;
    }
    matched.push({
      productId: match.productId,
      quantity: String(quantity),
      confidence: line.confidence,
      label: line.label,
    });
  }

  const mergedLines = mergeDraftLines(matched);
  const { window, confidence: windowConfidence, note: windowNote } = draftWindow(answer);
  const confidence = mergedLines.length
    ? Math.min(answer.confidence, ...mergedLines.map((line) => line.confidence))
    : 0;
  return {
    lines: mergedLines,
    unmatched,
    window,
    windowConfidence,
    windowNote,
    note: answer.note ?? null,
    confidence,
  };
}

/** Adds up lines of the same product (the model may split "2 Kiste und 1 Sackerl Nudeln" wrongly). */
function mergeDraftLines(lines: readonly MatchedLine[]): MatchedLine[] {
  const order: string[] = [];
  const byProduct = new Map<string, MatchedLine>();
  for (const line of lines) {
    const existing = byProduct.get(line.productId);
    if (!existing) {
      order.push(line.productId);
      byProduct.set(line.productId, { ...line });
      continue;
    }
    const quantity = parseQuantity(existing.quantity) ?? 0;
    const added = parseQuantity(line.quantity) ?? 0;
    existing.quantity = String(quantity + added);
    existing.confidence = Math.min(existing.confidence, line.confidence);
  }
  const merged: OrderLine[] = order.map((productId) => ({
    productId,
    quantity: Number(byProduct.get(productId)!.quantity),
  }));
  const kept = mergeOrderLines(merged);
  if (!kept) return [...byProduct.values()];
  return kept.map((line) => {
    const source = byProduct.get(line.productId)!;
    return { ...source, quantity: String(line.quantity) };
  });
}

/**
 * Prompt for the extraction request: the catalog with its per-locale names and units, today's date
 * (so "morgen" can be resolved), and the exact JSON shape. The message text is appended by the
 * caller as the user message, the screenshot as an image part.
 */
export function buildExtractionPrompt(
  catalog: readonly CatalogProduct[],
  today: string,
  around: string,
): string {
  const products = catalog
    .map((product) => {
      const names = Object.entries(product.name)
        .filter(([, value]) => typeof value === "string" && value.trim() !== "")
        .map(([locale, value]) => `${locale}: ${value}`)
        .join(", ");
      return `- ${names} (unit: ${product.unit})`;
    })
    .join("\n");
  return [
    "You read a customer's order message of a pasta factory and answer with JSON only.",
    `Today is ${today} (factory time zone ${around}). Resolve relative days ("morgen", "明天") against it.`,
    "The catalog (use exactly these names, never invent products):",
    products || "- (the catalog is empty)",
    "",
    "Rules:",
    "- One entry per product line. `label` = the product words as written in the message, locale unchanged.",
    "- `quantity` = whole number only. Never a decimal, never a range; if a range is written, take the lower bound.",
    "- Mention the packaging unit in `label` whenever the message does (Sackerl/Kiste, 袋/箱, kg) - the unit tells the products apart.",
    "- `window`: calendar dates as YYYY-MM-DD plus optional HH:MM times, only if the message asks for a time span. Otherwise null.",
    '- `window` is an object or null, never a string: convert "morgen vormittag" to a date plus 08:00-12:00, and if you cannot, put those words into `note` and set `window` to null.',
    "- Never guess: leave a product out of `lines` when you cannot read it, and put what you understood into `note`.",
    "- `confidence` per line and overall: 0..1, honest.",
    "- `customer`: the sender's name exactly as written on the picture (the chat title at the top of a messenger screenshot, a signature, a letterhead or stamp). Null when no name is visible. Never guess a name and never take one from the catalog.",
    "",
    "Answer shape:",
    '{"lines":[{"label":"Nudeln Kiste","quantity":2,"confidence":0.9}],',
    '"window":{"from":"2026-10-29","to":"2026-10-29","fromTime":"08:00","toTime":"12:00","confidence":0.7},',
    '"customer":"Wok Palace","note":null,"confidence":0.9}',
  ].join("\n");
}
