/**
 * Moves an element from where it was (`from`) to where it is now along an arc instead of a straight
 * line (motion rule 7). Physical things that are thrown or carried do not travel on a ruler.
 *
 * This is the "FLIP" technique: measure the old box, let the DOM change, then call this with the
 * old box. Horizontal and vertical travel run on different curves, which bends the path. It uses
 * the Web Animations API, so it runs on the compositor and can be interrupted.
 *
 * Returns `null` (and moves nothing) when the user prefers reduced motion or the element did not
 * move.
 */
export function flyTo(
  element: HTMLElement,
  from: Pick<DOMRect, "left" | "top">,
  { duration = 320 }: { duration?: number } = {},
): Animation | null {
  if (typeof window === "undefined" || typeof element.animate !== "function") return null;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;

  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;

  // `translate` is animated per axis through two composed animations: x eases in and out, y leaves
  // early (ease-out). The difference between the two curves is what draws the arc.
  const options = { duration, fill: "none" as const, composite: "add" as const };
  element.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], {
    ...options,
    easing: "cubic-bezier(0.77, 0, 0.175, 1)",
  });
  return element.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
    ...options,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  });
}
