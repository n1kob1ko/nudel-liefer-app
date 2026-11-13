"use client";

import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A short ring that expands and fades around its child when `active` turns true or `count` grows
 * (motion rule 8): the confirmation that an action went through ("Geliefert", saved, released). It
 * plays once per change and never on mount, so a list of already-delivered stops stays still.
 *
 * The wrapper takes the child's radius through `className` (`rounded-md`, `rounded-full`); the ring
 * inherits it.
 */
export function SuccessPulse({
  active = false,
  count = 0,
  children,
  className,
  tone = "success",
  as: Tag = "span",
}: {
  /** `div` when the child is a block (a ring, a card); the default `span` fits buttons and text. */
  as?: "span" | "div";
  /** Pulses each time this turns true. */
  active?: boolean;
  /** Pulses each time this number grows (a progress count); a smaller number stays still. */
  count?: number;
  children: ReactNode;
  className?: string;
  tone?: "success" | "primary";
}) {
  // Derived during render (no effect): count the changes to "active" and key the ring by the
  // count, so every confirmation restarts the animation and nothing needs a timer.
  const [previous, setPrevious] = useState(active);
  const [pulses, setPulses] = useState(0);
  const [previousCount, setPreviousCount] = useState(count);
  if (previous !== active) {
    setPrevious(active);
    if (active) setPulses((n) => n + 1);
  }
  if (previousCount !== count) {
    setPreviousCount(count);
    if (count > previousCount) setPulses((n) => n + 1);
  }

  return (
    <Tag data-slot="success-pulse" className={cn("relative inline-flex", className)}>
      {children}
      {pulses > 0 ? (
        <span
          key={pulses}
          aria-hidden
          data-slot="pulse-ring"
          className={cn("pulse-ring", tone === "primary" && "[--pulse-color:var(--primary)]")}
        />
      ) : null}
    </Tag>
  );
}
