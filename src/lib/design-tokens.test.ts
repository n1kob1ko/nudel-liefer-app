import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrast, readTokens } from "./design-tokens";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const schemes = readTokens(css);

/** Text on its surface: WCAG AA for body text. */
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["foreground", "muted"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["primary-soft-foreground", "primary-soft"],
  ["secondary-foreground", "secondary"],
  ["hero-foreground", "hero"],
  ...["success", "warning", "destructive", "info"].flatMap((tone): [string, string][] => [
    [`${tone}-foreground`, tone],
    [`${tone}-soft-foreground`, `${tone}-soft`],
  ]),
  // Status colours are also used as text and icons on a card (`text-destructive`, `text-warning`).
  ["destructive", "card"],
  ["warning", "card"],
  ["success", "card"],
];

/** Boundaries of controls and the focus ring: WCAG 1.4.11, at least 3:1. */
const UI_PAIRS: [string, string][] = [
  ["input", "card"],
  ["input", "background"],
  ["ring", "background"],
  ["ring", "card"],
];

describe.each(["light", "dark"] as const)("design tokens (%s)", (scheme) => {
  const tokens = schemes[scheme];

  it.each(TEXT_PAIRS)("%s on %s reads at 4.5:1 or better", (foreground, surface) => {
    expect(tokens[foreground], `--${foreground}`).toBeDefined();
    expect(tokens[surface], `--${surface}`).toBeDefined();
    expect(contrast(tokens[foreground]!, tokens[surface]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)("%s against %s is visible at 3:1 or better", (edge, surface) => {
    expect(contrast(tokens[edge]!, tokens[surface]!)).toBeGreaterThanOrEqual(3);
  });

  it("uses yolk as the one brand fill, with ink on top", () => {
    expect(tokens.primary).toBe("44 100% 58.6%");
    expect(tokens["primary-foreground"]).toBe("216 11% 9.2%");
  });

  it("keeps the warning clearly apart from the brand yolk", () => {
    const hue = (value: string) => Number.parseFloat(value.split(" ")[0]!);
    expect(Math.abs(hue(tokens.primary!) - hue(tokens.warning!))).toBeGreaterThanOrEqual(15);
  });
});

describe("contrast", () => {
  it("measures black on white as 21:1 and a colour on itself as 1:1", () => {
    expect(contrast("0 0% 0%", "0 0% 100%")).toBeCloseTo(21, 1);
    expect(contrast("44 100% 58.6%", "44 100% 58.6%")).toBeCloseTo(1, 5);
  });
});
