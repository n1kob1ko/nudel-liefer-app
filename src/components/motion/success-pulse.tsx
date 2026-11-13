"use client";

import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A short ring that expands and fades around its child when `active` turns true (motion rule 8):
 * the confirmation that an action went through ("Geliefert", saved, released). It plays once per
 * change and never on mount, so a list of already-delivered stops stays still.
 *
 * The wrapper takes the child's radius through `className` (`rounded-md`, `rounded-full`); the ring
 * inherits it.
 */
export function SuccessPulse({
  active,
  children,
  className,
  tone = "success",
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  tone?: "success" | "primary";
}) {
  // Derived during render (no effect): count the changes to "active" and key the ring by the
  // count, so every confirmation restarts the animation and nothing needs a timer.
  const [previous, setPrevious] = useState(active);
  const [pulses, setPulses] = useState(0);
  if (previous !== active) {
    setPrevious(active);
    if (active) setPulses((count) => count + 1);
  }

  return (
    <span data-slot="success-pulse" className={cn("relative inline-flex", className)}>
      {children}
      {pulses > 0 ? (
        <span
          key={pulses}
          aria-hidden
          data-slot="pulse-ring"
          className={cn("pulse-ring", tone === "primary" && "[--pulse-color:var(--primary)]")}
        />
      ) : null}
    </span>
  );
}
