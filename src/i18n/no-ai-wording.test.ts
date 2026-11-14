// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * NUD-211, the owner's rule: the app never says "KI" / "AI". Reading an order from a photo is
 * "automatisch"; what matters to the office is that it is read, not how. Internal names (`ai`,
 * test ids) are not texts and stay.
 */
const FORBIDDEN: Record<string, RegExp> = {
  de: /\bKI\b|künstliche Intelligenz|Sprachmodell/i,
  en: /\bAI\b|artificial intelligence|language model/i,
  "zh-Hans": /AI|人工智能|大模型/,
  cs: /\bAI\b|umělá inteligence/i,
  "sr-Latn": /\bAI\b|veštačka inteligencija/i,
};

function texts(node: unknown, path: string, out: [string, string][]) {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node)) texts(value, `${path}.${key}`, out);
}

describe("no AI wording in the texts of the app (NUD-211)", () => {
  it.each(Object.entries(FORBIDDEN))("%s", (locale, forbidden) => {
    const messages: unknown = JSON.parse(
      readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
    );
    const all: [string, string][] = [];
    texts(messages, locale, all);
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter(([, text]) => forbidden.test(text))).toEqual([]);
  });
});
