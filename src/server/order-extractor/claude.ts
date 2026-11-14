import {
  buildExtractionPrompt,
  type ExtractionAnswer,
  extractionAnswerSchema,
} from "@/domain/order-extraction";

import { type ClaudeClient, ClaudeError, claudeImageType, type ClaudeRequest } from "../claude";
import {
  type OrderExtractionContext,
  type OrderExtractionInput,
  type OrderExtractionResult,
  type OrderExtractor,
  OrderExtractorError,
} from "./types";

/**
 * The shape Claude must answer in (structured output: the API guarantees valid JSON of exactly this
 * form). It mirrors the answer shape of `buildExtractionPrompt`; the limits a JSON schema cannot
 * carry here (whole quantity >= 1, 0..1 confidence, text lengths) are checked afterwards with
 * `extractionAnswerSchema`.
 */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          quantity: { type: "integer" },
          confidence: { type: "number" },
        },
        required: ["label", "quantity", "confidence"],
        additionalProperties: false,
      },
    },
    window: {
      anyOf: [
        {
          type: "object",
          properties: {
            from: { type: ["string", "null"] },
            to: { type: ["string", "null"] },
            fromTime: { type: ["string", "null"] },
            toTime: { type: ["string", "null"] },
            confidence: { type: "number" },
          },
          required: ["from", "to", "fromTime", "toTime", "confidence"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    customer: { type: ["string", "null"] },
    note: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
  required: ["lines", "window", "customer", "note", "confidence"],
  additionalProperties: false,
} satisfies ClaudeRequest["jsonSchema"];

/**
 * The real order extractor (NUD-150, D26; on the Claude API since NUD-207): one request with the
 * catalog and the rules as the system prompt, plus the customer message as text and/or the photo as
 * an image block. The answer is validated with the schema of the order contract - an answer outside
 * it is a `BAD_RESPONSE`, never a half-filled order.
 */
export class ClaudeOrderExtractor implements OrderExtractor {
  readonly kind = "claude" as const;

  constructor(private readonly client: ClaudeClient) {}

  async extract(
    input: OrderExtractionInput,
    context: OrderExtractionContext,
  ): Promise<OrderExtractionResult> {
    const text = (input.text ?? "").trim();
    if (text === "" && !input.image) {
      throw new OrderExtractorError("Nothing to read", "EMPTY_INPUT");
    }
    let completion;
    try {
      completion = await this.client.complete({
        system: buildExtractionPrompt(context.catalog, context.today, context.timezone),
        content: userContent(text, input.image),
        jsonSchema: ANSWER_SCHEMA,
      });
    } catch (error) {
      throw toExtractorError(error);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(completion.text);
    } catch {
      throw new OrderExtractorError("The model did not answer with JSON", "BAD_RESPONSE");
    }
    const parsed = extractionAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OrderExtractorError("The model's answer did not match the contract", "BAD_RESPONSE");
    }
    return { answer: parsed.data as ExtractionAnswer, raw, model: completion.model };
  }
}

/** The photo goes first (the model reads an image best ahead of the words about it). */
function userContent(text: string, image: OrderExtractionInput["image"]): ClaudeRequest["content"] {
  if (!image) return `Customer message:\n${text}`;
  const mediaType = claudeImageType(image.contentType);
  if (!mediaType) {
    throw new OrderExtractorError(
      `The model cannot read ${image.contentType} images`,
      "UNSUPPORTED_IMAGE",
    );
  }
  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: Buffer.from(image.bytes).toString("base64"),
      },
    },
    {
      type: "text",
      text: text === "" ? "Read the order from this screenshot." : `Customer message:\n${text}`,
    },
  ];
}

function toExtractorError(error: unknown): OrderExtractorError {
  if (error instanceof OrderExtractorError) return error;
  if (error instanceof ClaudeError) return new OrderExtractorError(error.message, error.code);
  return new OrderExtractorError("The language model is unreachable", "NETWORK");
}
