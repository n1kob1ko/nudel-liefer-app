"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

import { EASE_IN_OUT, MOVE_SECONDS } from "./motion-tokens";

const loadFeatures = () => import("./motion-features").then((module) => module.default);

/**
 * Scope for shared-layout animation (motion rule 20). The `motion` library is used for exactly one
 * thing here: an element that keeps its identity while it moves between two places (the thumb of a
 * segmented control, the indicator under a tab or a navigation entry). Everything predetermined is
 * CSS in `globals.css`.
 *
 * `LazyMotion` keeps the library out of the first load: `m.*` elements render as plain elements
 * until the feature bundle has arrived. `reducedMotion="user"` turns movement off for people who
 * asked their system for less motion. No bounce anywhere (rule 13): tweens only.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ type: "tween", duration: MOVE_SECONDS, ease: EASE_IN_OUT }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
