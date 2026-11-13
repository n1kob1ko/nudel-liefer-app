"use client";

import * as m from "motion/react-m";

import { cn } from "@/lib/utils";

import { EASE_IN_OUT, MOVE_SECONDS } from "./motion-tokens";

/**
 * The moving highlight behind the selected option of a segmented control, a tab list or a
 * navigation (motion rule 20: the same `layoutId` is reused, so the highlight travels from the old
 * option to the new one instead of disappearing here and appearing there).
 *
 * Render it inside the selected option only; the option needs `relative` and its label a higher
 * stacking order. `layoutId` must be unique per control (use `useId()`), otherwise the thumbs of two
 * controls on one page would fly into each other.
 *
 * `stretch` makes the thumb 12 % wider on the way (rule 5, for knobs that travel). Pass it only
 * after the user has changed the value, so nothing wobbles on page load.
 */
export function LayoutThumb({
  layoutId,
  className,
  stretch = false,
  "data-slot": slot = "layout-thumb",
}: {
  layoutId: string;
  className?: string;
  stretch?: boolean;
  "data-slot"?: string;
}) {
  return (
    <m.span
      layoutId={layoutId}
      aria-hidden
      data-slot={slot}
      className="pointer-events-none absolute inset-0"
      transition={{ type: "tween", duration: MOVE_SECONDS, ease: EASE_IN_OUT }}
    >
      <span className={cn("absolute inset-0", stretch && "knob-stretch", className)} />
    </m.span>
  );
}
