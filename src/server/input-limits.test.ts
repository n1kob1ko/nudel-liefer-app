// @vitest-environment node
/**
 * NUD-093: every zod string / array that validates client input must carry a size limit. This scans
 * the source for `z.string()` and `z.array(` chains and fails when a chain has no bound (`max`,
 * `length`, `regex`, `email`, `uuid`, `datetime`, ...). Files in ALLOWED hold schemas for data the
 * server produced itself (API responses, stored JSON, third-party responses), not client input.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ALLOWED: Record<string, string> = {
  "src/lib/driver-tour-model.ts":
    "response of GET /api/driver/tour/today, parsed by our own client",
  "src/lib/localized-text.ts":
    "shape of stored LocalizedText JSON (inputs are bounded before they are stored)",
  "src/server/audit-history.ts": "reads audit rows the server wrote",
  "src/server/routing/ors.ts": "response of OpenRouteService",
  "src/server/geocoder/ors.ts": "response of OpenRouteService",
  "src/server/geocoder/photon.ts": "response of Photon (a self-hosted geocoder)",
  "src/server/routing/google.ts": "response of Google's Routes API",
  "src/server/geocoder/google.ts": "response of Google's Geocoding API",
  "src/server/translator/deepl.ts": "response of DeepL",
    "src/server/driver-tour-payload.ts": "reads stored tour JSON (depot snapshot, geometry)",
};

const BOUNDS = [
  "max(",
  "length(",
  "regex(",
  "email(",
  "uuid(",
  "datetime(",
  "enum(",
  "literal(",
  "pipe(",
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "generated" || e.name === "node_modules") return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** The chained calls after `start` (`.trim().min(1).max(5)`), parentheses balanced. */
function chain(source: string, start: number): string {
  let i = start;
  for (;;) {
    const rest = source.slice(i);
    const m = /^\s*\.\w+\(/.exec(rest);
    if (!m) return source.slice(start, i);
    let depth = 1;
    let j = i + m[0].length;
    while (j < source.length && depth > 0) {
      const c = source[j++];
      if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    i = j;
  }
}

/** `// unbounded-ok-start: reason` ... `// unbounded-ok-end` marks schemas of data the server wrote. */
function inOkRegion(lines: string[], index: number): boolean {
  for (let i = index; i >= 0; i--) {
    if (/unbounded-ok-end/.test(lines[i]!)) return false;
    if (/unbounded-ok-start:/.test(lines[i]!)) return true;
  }
  return false;
}

describe("input size limits", () => {
  const root = process.cwd();
  const files = ["src/server", "src/domain", "src/lib"]
    .flatMap((d) => walk(join(root, d)))
    .filter((f) => /\.ts$/.test(f) && !/\.(test|spec)\.ts$/.test(f))
    .map((f) => relative(root, f).split(sep).join("/"));

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it("bounds every z.string() and z.array() that validates client input", () => {
    const unbounded: string[] = [];
    for (const file of files) {
      if (file in ALLOWED) continue;
      const source = readFileSync(join(root, file), "utf8");
      const lines = source.split("\n");
      for (const match of source.matchAll(/z\.(string|array)\(/g)) {
        const open = match.index! + match[0].length;
        let depth = 1;
        let end = open;
        while (end < source.length && depth > 0) {
          const c = source[end++];
          if (c === "(") depth++;
          else if (c === ")") depth--;
        }
        const calls = chain(source, end);
        // z.string() inside a bounded record/array element is judged on its own chain.
        if (BOUNDS.some((b) => calls.includes(`.${b}`))) continue;
        const line = source.slice(0, match.index).split("\n").length;
        const text = lines[line - 1]!.trim();
        if (/\/\/\s*unbounded-ok:/.test(lines[line - 2] ?? "") || inOkRegion(lines, line - 1))
          continue;
        unbounded.push(`${file}:${line}  ${text}`);
      }
    }
    expect(
      unbounded,
      "add .max()/.regex() or mark with `// unbounded-ok: <reason>` (server-written data only)",
    ).toEqual([]);
  });

  it("every allow-listed file still exists", () => {
    for (const file of Object.keys(ALLOWED).filter((f) => !f.includes("#"))) {
      expect(files, file).toContain(file);
    }
  });
});
