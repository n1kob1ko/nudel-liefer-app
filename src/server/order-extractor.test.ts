// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { assembleDraft, type CatalogProduct } from "@/domain/order-extraction";
import { createLocalizedText } from "@/lib/localized-text";

import { CLAUDE_DEFAULT_MODEL, ClaudeClient, type ClaudeClientOptions, parseEffort } from "./claude";
import {
  FakeOrderExtractor,
  getOrderExtractor,
  isOrderExtractorAvailable,
  setOrderExtractorForTests,
} from "./order-extractor";
import { ClaudeOrderExtractor } from "./order-extractor/claude";
import { getTranslator, setTranslatorForTests } from "./translator";
import { ClaudeTranslator } from "./translator/claude";

const CATALOG: CatalogProduct[] = [
  {
    id: "pack",
    name: createLocalizedText({ de: "Nudeln", "zh-Hans": "面条" }, "de"),
    unit: "PACK",
  },
  {
    id: "crate",
    name: createLocalizedText({ de: "Nudeln", "zh-Hans": "面条" }, "de"),
    unit: "CRATE",
  },
  {
    id: "wantan",
    name: createLocalizedText({ de: "Wantan-Teig", "zh-Hans": "馄饨皮" }, "de"),
    unit: "PIECE",
  },
];

const CONTEXT = { catalog: CATALOG, today: "2026-10-28", timezone: "Europe/Vienna" };

/** A Messages API answer of Claude whose single text block is `text`. */
const message = (text: string, overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: CLAUDE_DEFAULT_MODEL,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const answer = (content: unknown, overrides: Record<string, unknown> = {}) =>
  message(JSON.stringify(content), overrides);

const apiError = (status: number, type: string) =>
  new Response(JSON.stringify({ type: "error", error: { type, message: "nope" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type FetchCall = { url: string; headers: Headers; body: Record<string, unknown> };

/** A fetch stand-in that answers with `respond()` and records what the SDK sent. */
function recordingFetch(respond: () => Response) {
  const calls: FetchCall[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return respond();
  };
  return { calls, fetchFn };
}

/** The sandbox and a developer's shell may set `ANTHROPIC_BASE_URL`; tests pin the public one. */
const client = (options: Partial<ClaudeClientOptions> & { fetch: unknown }) =>
  new ClaudeClient({
    apiKey: "test-key",
    baseUrl: "https://api.anthropic.com",
    retries: 0,
    ...options,
    fetch: options.fetch as typeof fetch,
  });

const EMPTY_ANSWER = { lines: [], window: null, note: null, confidence: 0.5 };

describe("FakeOrderExtractor (NUD-150 acceptance example)", () => {
  it("reads '2 Karton Nudeln, 5 Beutel, morgen vormittag' into a draft", async () => {
    const extractor = new FakeOrderExtractor();
    const { answer } = await extractor.extract(
      { text: "2 Karton Nudeln, 5 Beutel, morgen vormittag" },
      CONTEXT,
    );
    const draft = assembleDraft(answer, CATALOG);
    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["crate", "2"],
      ["pack", "5"],
    ]);
    expect(draft.window).toEqual({
      from: "2026-10-29",
      to: "2026-10-29",
      fromTime: "08:00",
      toTime: "12:00",
    });
  });

  it("reads a Chinese message", async () => {
    const extractor = new FakeOrderExtractor();
    const { answer } = await extractor.extract(
      { text: "3 箱 面条，2 袋 面条，明天" },
      CONTEXT,
    );
    const draft = assembleDraft(answer, CATALOG);
    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["crate", "3"],
      ["pack", "2"],
    ]);
    expect(draft.window?.from).toBe("2026-10-29");
    expect(draft.window?.fromTime).toBe("");
  });

  it("returns no lines for a screenshot-only request (a text stand-in cannot read it)", async () => {
    const extractor = new FakeOrderExtractor();
    const { answer } = await extractor.extract(
      { image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" } },
      CONTEXT,
    );
    expect(answer.lines).toEqual([]);
  });
});

describe("ClaudeOrderExtractor", () => {
  it("sends the catalog as the system prompt and the message as the user turn", async () => {
    const { calls, fetchFn } = recordingFetch(() =>
      answer({
        lines: [{ label: "Nudeln Kiste", quantity: 4, confidence: 0.9 }],
        window: null,
        note: null,
        confidence: 0.9,
      }),
    );
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    const result = await extractor.extract({ text: "4 Kiste Nudeln" }, CONTEXT);
    expect(assembleDraft(result.answer, CATALOG).lines[0]).toMatchObject({
      productId: "crate",
      quantity: "4",
    });
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.system).toContain("unit: CRATE");
    expect(JSON.stringify(body.messages)).toContain("4 Kiste Nudeln");
  });

  it("records the model that answered, not the one that was asked", async () => {
    const { fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER, { model: "claude-opus-5" }));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    const result = await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    expect(result.model).toBe("claude-opus-5");
  });

  it("asks Claude Opus 5.5 at low effort for JSON in the answer's schema", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = calls[0]!.body as {
      model: string;
      output_config: { effort: string; format: { type: string; schema: { required: string[] } } };
    };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toEqual([
      "lines",
      "window",
      "note",
      "confidence",
    ]);
  });

  it("sends none of the parameters the current models reject", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = calls[0]!.body;
    for (const rejected of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) {
      expect(body).not.toHaveProperty(rejected);
    }
  });

  it("opts into the server-side fallback for a declined request", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    expect(calls[0]!.body.fallbacks).toBe("default");
    expect(calls[0]!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("uses the configured model and effort", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(
      client({ fetch: fetchFn, model: "claude-haiku-5-5", effort: "medium" }),
    );
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = calls[0]!.body as { model: string; output_config: { effort: string } };
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config.effort).toBe("medium");
  });

  it("sends the key in a request header and never in the URL or the body", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn, apiKey: "secret-key" }));
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer secret-key");
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("secret-key");
  });

  it("sends the screenshot as a base64 image block before the instruction", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await extractor.extract(
      { image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" } },
      CONTEXT,
    );
    const messages = calls[0]!.body.messages as { role: string; content: unknown[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AQID" },
    });
    expect(messages[0]!.content[1]).toMatchObject({ type: "text" });
  });

  it("sends the pasted text together with the screenshot", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await extractor.extract(
      {
        text: "bitte bis Freitag",
        image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" },
      },
      CONTEXT,
    );
    const content = (calls[0]!.body.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content.map((block) => block.type)).toEqual(["image", "text"]);
    expect(JSON.stringify(content)).toContain("bitte bis Freitag");
  });

  it("refuses an image type Claude cannot read without calling the API", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(
      extractor.extract(
        { image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/heic" } },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an empty request", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({}, CONTEXT)).rejects.toMatchObject({ code: "EMPTY_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("turns an answer outside the contract into BAD_RESPONSE instead of a half-filled order", async () => {
    const { fetchFn } = recordingFetch(() =>
      answer({
        lines: [{ label: "Nudeln Kiste", quantity: 0, confidence: 0.9 }],
        window: null,
        note: null,
        confidence: 0.9,
      }),
    );
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({ text: "?" }, CONTEXT)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("turns an answer that is not JSON into BAD_RESPONSE", async () => {
    const { fetchFn } = recordingFetch(() => message("Ich habe es nicht verstanden."));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({ text: "?" }, CONTEXT)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("treats a declined request as BAD_RESPONSE and does not read its content", async () => {
    const { fetchFn } = recordingFetch(() =>
      answer(
        { lines: [{ label: "Nudeln Kiste", quantity: 2, confidence: 1 }], window: null, note: null, confidence: 1 },
        { stop_reason: "refusal" },
      ),
    );
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("treats an answer cut off at the token limit as BAD_RESPONSE", async () => {
    const { fetchFn } = recordingFetch(() => message('{"lines":[', { stop_reason: "max_tokens" }));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("reports a missing key as NOT_CONFIGURED without calling the API", async () => {
    const { calls, fetchFn } = recordingFetch(() => answer(EMPTY_ANSWER));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn, apiKey: "  " }));
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [429, "rate_limit_error", "QUOTA"],
    [402, "billing_error", "QUOTA"],
    [401, "authentication_error", "HTTP"],
    [400, "invalid_request_error", "HTTP"],
    [529, "overloaded_error", "HTTP"],
  ])("maps HTTP %i (%s) to %s", async (status, type, code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchFn } = recordingFetch(() => apiError(status, type));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code,
    });
    warn.mockRestore();
  });

  it("maps a network failure to NETWORK", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn }));
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code: "NETWORK",
    });
    warn.mockRestore();
  });

  it("retries a failed request once by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempt = 0;
    const { calls, fetchFn } = recordingFetch(() =>
      attempt++ === 0 ? apiError(500, "api_error") : answer(EMPTY_ANSWER),
    );
    const extractor = new ClaudeOrderExtractor(
      new ClaudeClient({
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.com",
        fetch: fetchFn as typeof fetch,
      }),
    );
    const result = await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    expect(result.answer.lines).toEqual([]);
    expect(calls).toHaveLength(2);
    warn.mockRestore();
  });

  it("logs the failure without the customer's message or the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchFn } = recordingFetch(() => apiError(400, "invalid_request_error"));
    const extractor = new ClaudeOrderExtractor(client({ fetch: fetchFn, apiKey: "secret-key" }));
    await expect(
      extractor.extract({ text: "Geheime Kundennachricht" }, CONTEXT),
    ).rejects.toMatchObject({ code: "HTTP" });
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("400");
    expect(logged).toContain("invalid_request_error");
    expect(logged).not.toContain("Geheime Kundennachricht");
    expect(logged).not.toContain("secret-key");
    warn.mockRestore();
  });
});

describe("parseEffort (thinking depth of the client)", () => {
  it.each([
    [undefined, "low"],
    ["", "low"],
    ["nonsense", "low"],
    ["off", "low"],
    ["  LOW ", "low"],
    ["Medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
  ])("maps %j to %s", (input, expected) => {
    expect(parseEffort(input)).toBe(expected);
  });
});

describe("provider selection from the environment", () => {
  it("reads orders with Claude once ANTHROPIC_API_KEY is set", () => {
    setOrderExtractorForTests(undefined);
    expect(isOrderExtractorAvailable({ ANTHROPIC_API_KEY: "sk-test" })).toBe(true);
    expect(getOrderExtractor({ ANTHROPIC_API_KEY: "sk-test" }).kind).toBe("claude");
    setOrderExtractorForTests(undefined);
  });

  it("keeps the AI draft off without the key, also when the retired OpenRouter key is still set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOrderExtractorForTests(undefined);
    const env = { ANTHROPIC_API_KEY: " ", OPENROUTER_API_KEY: "sk-or-old" };
    expect(isOrderExtractorAvailable(env)).toBe(false);
    expect(getOrderExtractor(env).kind).toBe("fake");
    expect(String(warn.mock.calls[0]![0])).toContain("ANTHROPIC_API_KEY");
    setOrderExtractorForTests(undefined);
    warn.mockRestore();
  });

  it("translates all five languages with Claude when only its key is set", () => {
    setTranslatorForTests(undefined);
    expect(getTranslator({ ANTHROPIC_API_KEY: "sk-test" }).kind).toBe("claude");
    setTranslatorForTests(undefined);
  });

  it("gives Claude the Serbian slot next to DeepL", async () => {
    setTranslatorForTests(undefined);
    const translator = getTranslator({ DEEPL_API_KEY: "abc:fx", ANTHROPIC_API_KEY: " " });
    expect(translator.kind).toBe("deepl");
    await expect(translator.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
    setTranslatorForTests(undefined);
  });
});

describe("ClaudeTranslator (Serbian slot, NUD-150)", () => {
  it("translates through the model and trims the answer", async () => {
    const { calls, fetchFn } = recordingFetch(() => message("  Nudle\n"));
    const translator = new ClaudeTranslator(client({ fetch: fetchFn }));
    expect(await translator.translate("Nudeln", "de", "sr-Latn")).toBe("Nudle");
    expect(translator.kind).toBe("claude");
    const body = calls[0]!.body as {
      system: string;
      messages: unknown;
      output_config: Record<string, unknown>;
    };
    expect(body.system).toContain("from German to Serbian written in the Latin alphabet");
    expect(JSON.stringify(body.messages)).toContain("Nudeln");
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("returns the text unchanged for the same locale", async () => {
    const { calls, fetchFn } = recordingFetch(() => message("x"));
    const translator = new ClaudeTranslator(client({ fetch: fetchFn }));
    expect(await translator.translate("Nudeln", "de", "de")).toBe("Nudeln");
    expect(calls).toHaveLength(0);
  });

  it("reports an empty answer as BAD_RESPONSE", async () => {
    const { fetchFn } = recordingFetch(() => message("   "));
    const translator = new ClaudeTranslator(client({ fetch: fetchFn }));
    await expect(translator.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      name: "TranslatorError",
      code: "BAD_RESPONSE",
    });
  });

  it("reports a declined request as BAD_RESPONSE", async () => {
    const { fetchFn } = recordingFetch(() => message("Nudle", { stop_reason: "refusal" }));
    const translator = new ClaudeTranslator(client({ fetch: fetchFn }));
    await expect(translator.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      name: "TranslatorError",
      code: "BAD_RESPONSE",
    });
  });

  it("reports an exhausted quota as a TranslatorError", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchFn } = recordingFetch(() => apiError(429, "rate_limit_error"));
    const translator = new ClaudeTranslator(client({ fetch: fetchFn }));
    await expect(translator.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      name: "TranslatorError",
      code: "QUOTA",
      status: 429,
    });
    warn.mockRestore();
  });
});
