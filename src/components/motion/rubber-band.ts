/**
 * Resistance past a limit (motion rule 19): the further something is dragged beyond where it can
 * go, the less it follows the finger. Nothing in the real world stops dead at an invisible wall.
 *
 * `distance` is how far past the limit the pointer is, `dimension` the size of the thing being
 * dragged. The result grows with the distance but never exceeds `dimension`; `constant` (0.55 is
 * the value iOS uses) sets how stiff the band is.
 */
export function rubberBand(distance: number, dimension: number, constant = 0.55): number {
  if (distance <= 0 || dimension <= 0) return 0;
  return (distance * dimension * constant) / (dimension + constant * distance);
}

/** Leaves `value` alone between `min` and `max` and applies the rubber band outside of them. */
export function clampWithRubberBand(
  value: number,
  min: number,
  max: number,
  dimension: number,
  constant = 0.55,
): number {
  if (value < min) return min - rubberBand(min - value, dimension, constant);
  if (value > max) return max + rubberBand(value - max, dimension, constant);
  return value;
}

/**
 * Should a drag that was let go dismiss the thing? Either it was dragged far enough, or it was
 * flicked: a quick, short flick must be enough (velocity in px per ms).
 */
export function shouldDismiss(
  distance: number,
  elapsedMs: number,
  dimension: number,
  { threshold = 0.35, velocity = 0.5 }: { threshold?: number; velocity?: number } = {},
): boolean {
  if (distance <= 0) return false;
  if (distance >= dimension * threshold) return true;
  return elapsedMs > 0 && distance > 12 && distance / elapsedMs > velocity;
}
