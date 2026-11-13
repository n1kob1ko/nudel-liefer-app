/**
 * App icon (redesign RD2, the product is called Routenplanner): a route in ink on yolk. It starts
 * at a ring (the depot), winds through two bends and ends in a filled dot (the stop). `maskable`
 * keeps the whole glyph inside the central 60 % so launchers can crop it to a circle / squircle;
 * the plain variant has rounded corners and a larger glyph. Rendered to PNG by
 * `scripts/generate-pwa-icons.ts`.
 */
export const ICON_BACKGROUND = "#ffc72c";
export const ICON_INK = "#15171a";

function glyph(): string {
  return `
  <g fill="none" stroke="${ICON_INK}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="150" cy="372" r="32" stroke-width="30"/>
    <path d="M197 372h103a58 58 0 0 0 0-116h-88a58 58 0 0 1 0-116h104" stroke-width="36"/>
  </g>
  <circle cx="362" cy="140" r="40" fill="${ICON_INK}"/>`;
}

export function iconSvg(variant: "any" | "maskable"): string {
  const scale = variant === "maskable" ? 0.78 : 1;
  const offset = (512 - 512 * scale) / 2;
  const radius = variant === "any" ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${radius}" fill="${ICON_BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${glyph()}
  </g>
</svg>`;
}
