import { createClaudeClient } from "../claude";
import { RoutedTranslator } from "./base";
import { ClaudeTranslator } from "./claude";
import { DeepLTranslator, resolvePlan } from "./deepl";
import { FakeTranslator } from "./fake";
import type { Translator } from "./types";

export { RoutedTranslator } from "./base";
export { ClaudeTranslator } from "./claude";
export { DeepLTranslator, mapDeepLResponse, resolvePlan } from "./deepl";
export { FakeTranslator } from "./fake";
export * from "./types";

let instance: Translator | undefined;
let warned = false;

/**
 * Translator selected from the environment:
 * - `DEEPL_API_KEY` set: DeepL is the primary provider, and `ANTHROPIC_API_KEY` (when set) fills the
 *   Serbian slot, which DeepL cannot serve (NUD-150, NUD-207).
 * - only `ANTHROPIC_API_KEY` set: Claude translates all five locales (no routing needed).
 * - neither: the `FakeTranslator` and a single warning (its output carries a visible `[zh-Hans]` prefix).
 */
export function getTranslator(env: Record<string, string | undefined> = process.env): Translator {
  if (instance) return instance;
  const apiKey = env.DEEPL_API_KEY?.trim();
  const claude = createClaudeClient(env);
  if (apiKey) {
    instance = new RoutedTranslator(
      new DeepLTranslator({ apiKey, plan: resolvePlan(apiKey, env.DEEPL_API_PLAN) }),
      claude ? new ClaudeTranslator(claude) : undefined,
    );
  } else if (claude) {
    instance = new ClaudeTranslator(claude);
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[translator] Neither DEEPL_API_KEY nor ANTHROPIC_API_KEY is set - using the FakeTranslator (texts get a visible [en] / [zh-Hans] ... prefix, they are NOT translated)",
      );
    }
    instance = new FakeTranslator();
  }
  return instance;
}

/** Test helper. */
export function setTranslatorForTests(translator: Translator | undefined) {
  instance = translator;
  if (!translator) warned = false;
}
