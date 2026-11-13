import { createClaudeClient, isClaudeConfigured } from "../claude";
import { ClaudeOrderExtractor } from "./claude";
import { FakeOrderExtractor } from "./fake";
import type { OrderExtractor } from "./types";

export { ClaudeOrderExtractor } from "./claude";
export { addDays,FakeOrderExtractor } from "./fake";
export * from "./types";

let instance: OrderExtractor | undefined;
let warned = false;

/**
 * Extractor selected from the environment: Claude when `ANTHROPIC_API_KEY` is set (NUD-150, NUD-207),
 * otherwise the `FakeOrderExtractor` and a single warning. The UI checks `isOrderExtractorAvailable`
 * first and hides the button without a key, so the fake never reaches an office user.
 */
export function getOrderExtractor(env: Record<string, string | undefined> = process.env): OrderExtractor {
  if (instance) return instance;
  const client = createClaudeClient(env);
  if (client) {
    instance = new ClaudeOrderExtractor(client);
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[order-extractor] ANTHROPIC_API_KEY not set - AI order drafts are unavailable (the office types orders by hand); using the FakeOrderExtractor",
      );
    }
    instance = new FakeOrderExtractor();
  }
  return instance;
}

/** True when a real model is configured; without it the "Mit KI auslesen" button stays disabled. */
export function isOrderExtractorAvailable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isClaudeConfigured(env);
}

/** Test helper. */
export function setOrderExtractorForTests(extractor: OrderExtractor | undefined) {
  instance = extractor;
  if (!extractor) warned = false;
}
