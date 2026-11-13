import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaJSONOutputFormat,
} from "@anthropic-ai/sdk/resources/beta/messages";

/**
 * The app's one door to the Claude API (NUD-207), built on Anthropic's own SDK. Both the order
 * reader (pasted text or a photo, NUD-150) and the translator sit on it, so the key, the model, the
 * timeout and the error mapping live in exactly one place.
 *
 * The key travels in a request header only (the SDK sets it), never in a URL and never in a log line.
 */

/**
 * Default model: Claude Opus 5.5, the most accurate of the current generation on photos, handwriting
 * and mixed German/Chinese messages. A misread quantity is the one thing that must not happen
 * (backlog §1) and the office reads a handful of photos a day, so accuracy beats the price here.
 * `ANTHROPIC_MODEL` switches to `claude-sonnet-5-5` or `claude-haiku-5-5` without a code change.
 */
export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";

/**
 * How hard the model thinks before it answers. Both jobs are short, well-specified transformations
 * (read an order out of a message, translate a sentence), so `low` is the default; thinking tokens
 * are billed as output.
 */
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Anything unset or unexpected means `low` (the cheap, fast path). */
export function parseEffort(value: string | undefined): ClaudeEffort {
  const normalized = value?.trim().toLowerCase();
  return normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh" ||
    normalized === "max"
    ? normalized
    : "low";
}

export type ClaudeErrorCode =
  "TIMEOUT" | "NETWORK" | "HTTP" | "QUOTA" | "BAD_RESPONSE" | "NOT_CONFIGURED";

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly code: ClaudeErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

/** The image types the Messages API reads; an iPhone HEIC is converted in the browser before upload. */
export type ClaudeImageType = BetaImageBlockParam["source"] extends infer Source
  ? Source extends { type: "base64"; media_type: infer MediaType }
    ? MediaType
    : never
  : never;

const IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** The content type as the API wants it, or `null` for a type Claude cannot read. */
export function claudeImageType(contentType: string): ClaudeImageType | null {
  const normalized = contentType.split(";")[0]!.trim().toLowerCase();
  return IMAGE_TYPES.includes(normalized) ? (normalized as ClaudeImageType) : null;
}

/**
 * When Claude declines a request for policy reasons, the API runs it once more on the model
 * Anthropic recommends for that case instead of handing back nothing. An order message will hardly
 * ever be declined; this only keeps a false alarm from costing the office a retyped order.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Ceiling for thinking plus answer. Far above what an order or a translated note needs, so an answer
 * is never cut off in the middle; only the tokens actually written are billed.
 */
const MAX_TOKENS = 16_000;

export type ClaudeClientOptions = {
  apiKey: string;
  model?: string;
  /** Thinking depth; default `low` (see `ClaudeEffort`). */
  effort?: ClaudeEffort;
  /** Overrides the API address (tests, a proxy). */
  baseUrl?: string;
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error, 5xx or 429. Default 1. */
  retries?: number;
  fetch?: typeof fetch;
};

export type ClaudeRequest = {
  system: string;
  /** The user turn: plain text, or blocks when a photo is part of it. */
  content: string | BetaContentBlockParam[];
  /** JSON schema the answer must follow; without it the answer is plain text. */
  jsonSchema?: BetaJSONOutputFormat["schema"];
};

export type ClaudeAnswer = {
  text: string;
  /** The model that wrote the answer (the fallback model when the first one declined). */
  model: string;
};

export class ClaudeClient {
  readonly model: string;
  readonly effort: ClaudeEffort;
  private sdk: Anthropic | undefined;

  constructor(private readonly options: ClaudeClientOptions) {
    this.model = options.model?.trim() || CLAUDE_DEFAULT_MODEL;
    this.effort = options.effort ?? "low";
  }

  /** One request, one answer. Throws a `ClaudeError`; never returns a declined or cut-off answer. */
  async complete(request: ClaudeRequest): Promise<ClaudeAnswer> {
    if (this.options.apiKey.trim() === "") {
      throw new ClaudeError("ANTHROPIC_API_KEY is not set", "NOT_CONFIGURED");
    }
    let response;
    try {
      response = await this.client().beta.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: request.system,
        messages: [{ role: "user", content: request.content }],
        output_config: {
          effort: this.effort,
          ...(request.jsonSchema
            ? { format: { type: "json_schema" as const, schema: request.jsonSchema } }
            : {}),
        },
      });
    } catch (error) {
      throw toClaudeError(error);
    }
    if (response.stop_reason === "refusal") {
      throw new ClaudeError("The language model declined the request", "BAD_RESPONSE");
    }
    if (response.stop_reason === "max_tokens") {
      throw new ClaudeError("The language model's answer was cut off", "BAD_RESPONSE");
    }
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    return { text, model: response.model };
  }

  private client(): Anthropic {
    this.sdk ??= new Anthropic({
      apiKey: this.options.apiKey.trim(),
      baseURL: this.options.baseUrl?.trim() || undefined,
      timeout: this.options.timeoutMs ?? 60_000,
      maxRetries: this.options.retries ?? 1,
      fetch: this.options.fetch,
    });
    return this.sdk;
  }
}

/**
 * Maps the SDK's typed errors onto the client's codes and writes one log line with what Anthropic
 * answered: status, error type, request id and Anthropic's own short message (it describes the
 * request's shape or the account, e.g. an empty credit balance). The prompt, the photo and the key
 * are never part of it.
 */
function toClaudeError(error: unknown): ClaudeError {
  if (error instanceof ClaudeError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    console.warn("[claude] request timed out");
    return new ClaudeError("The language model timed out", "TIMEOUT");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    console.warn("[claude] request failed: no connection");
    return new ClaudeError("The language model is unreachable", "NETWORK");
  }
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === "number" ? error.status : undefined;
    const reason = apiMessage(error.error);
    console.warn(
      `[claude] request failed: HTTP ${status ?? "?"} ${error.type ?? "unknown_error"}` +
        (error.requestID ? ` (${error.requestID})` : "") +
        (reason ? `: ${reason}` : ""),
    );
    const quota = error instanceof Anthropic.RateLimitError || status === 402;
    return new ClaudeError(
      `The language model answered HTTP ${status ?? "?"}`,
      quota ? "QUOTA" : "HTTP",
      status,
    );
  }
  console.warn("[claude] request failed");
  return new ClaudeError("The language model is unreachable", "NETWORK");
}

/** `error.message` of Anthropic's error body, shortened; empty when the body has another shape. */
function apiMessage(body: unknown): string {
  const inner = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof inner === "string" ? inner.slice(0, 200) : "";
}

/** True when a Claude key is configured; the AI paths stay off without one (D26, NUD-150). */
export function isClaudeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return (env.ANTHROPIC_API_KEY?.trim() ?? "") !== "";
}

/** Client from the environment, or `null` when no key is set. */
export function createClaudeClient(
  env: Record<string, string | undefined> = process.env,
): ClaudeClient | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new ClaudeClient({
    apiKey,
    model: env.ANTHROPIC_MODEL,
    effort: parseEffort(env.ANTHROPIC_EFFORT),
    baseUrl: env.ANTHROPIC_BASE_URL,
  });
}
