/**
 * Reads the colour tokens out of `globals.css` and measures WCAG contrast between two of them
 * (redesign RD2). The tokens are HSL channel triples ("44 100% 58.6%"), which is also the format
 * these helpers take. Used by the token contrast test, so a palette change that breaks legibility
 * fails `pnpm test` instead of being found on a phone in the sun.
 */
export type TokenSet = Record<string, string>;

const TOKEN = /--([a-z0-9-]+):\s*(-?[\d.]+\s+[\d.]+%\s+[\d.]+%)\s*;/g;

function block(css: string, selector: string): string {
  const start = css.search(new RegExp(`(^|\\n)${selector.replace(".", "\\.")}\\s*\\{`));
  if (start < 0) throw new Error(`No "${selector}" block in the stylesheet`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open + 1, close);
}

function tokens(source: string): TokenSet {
  const result: TokenSet = {};
  for (const match of source.matchAll(TOKEN)) result[match[1]!] = match[2]!.replace(/\s+/g, " ");
  return result;
}

/** Light tokens from `:root`, dark tokens from `.dark` (falling back to light where not redefined). */
export function readTokens(css: string): { light: TokenSet; dark: TokenSet } {
  const light = tokens(block(css, ":root"));
  return { light, dark: { ...light, ...tokens(block(css, ".dark")) } };
}

function toRgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.split(" ").map((part) => Number.parseFloat(part)) as [
    number,
    number,
    number,
  ];
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance(hsl: string): number {
  const [r, g, b] = toRgb(hsl).map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio (1 to 21) between two HSL channel triples. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
