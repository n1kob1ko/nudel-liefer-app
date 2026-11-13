import type { CatalogProduct,ExtractionAnswer } from "@/domain/order-extraction";

/**
 * Contract of the AI order draft (NUD-150, D26): turn a pasted customer message and/or a screenshot
 * into the structured answer of `extractionAnswerSchema`. The interface keeps the provider (and its
 * key) out of the order service, so tests and a missing key fall back to the `FakeOrderExtractor`.
 */
export type OrderExtractionInput = {
  /** Pasted message text (German or Chinese); empty when only a screenshot was given. */
  text?: string;
  /** Screenshot bytes, already loaded from the object storage. */
  image?: { bytes: Uint8Array; contentType: string };
};

export type OrderExtractionContext = {
  /** Active catalog products; the only products an answer may be mapped to. */
  catalog: readonly CatalogProduct[];
  /** Today in the factory time zone, `YYYY-MM-DD` (relative days are resolved against it). */
  today: string;
  /** IANA zone of the factory, for the prompt only. */
  timezone: string;
};

export type OrderExtractionResult = {
  /** Validated answer (the provider already checked it against the schema). */
  answer: ExtractionAnswer;
  /** The raw JSON the model sent, stored on the `Screenshot` row for later review. */
  raw: unknown;
  /** Model that answered, for the audit/history and for the evaluation script. */
  model: string;
};

export interface OrderExtractor {
  /** `"claude"` for the real model, `"fake"` for the offline stand-in. */
  readonly kind: "claude" | "fake";
  extract(
    input: OrderExtractionInput,
    context: OrderExtractionContext,
  ): Promise<OrderExtractionResult>;
}

export type OrderExtractorErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "NETWORK"
  | "QUOTA"
  | "HTTP"
  | "BAD_RESPONSE"
  | "EMPTY_INPUT"
  | "UNSUPPORTED_IMAGE";

export class OrderExtractorError extends Error {
  constructor(
    message: string,
    readonly code: OrderExtractorErrorCode,
  ) {
    super(message);
    this.name = "OrderExtractorError";
  }
}
