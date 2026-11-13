"use client";

import { type ReactNode, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const EXIT_MS = 160;

/**
 * Swaps one icon for another by crossfading through a little blur and scale (motion rule 18)
 * instead of cutting. Old and new overlap for a moment (rule 16): the leaving icon stays mounted
 * with `data-state="exit"` while the new one comes in.
 *
 * `iconKey` identifies the icon; the swap runs when it changes, never on mount. The box keeps the
 * size of one icon, so nothing around it moves.
 */
export function IconSwap({
  icon,
  iconKey,
  className,
}: {
  icon: ReactNode;
  iconKey: string;
  className?: string;
}) {
  const [shown, setShown] = useState({ key: iconKey, node: icon });
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  // Derived during render, so the leaving icon is on screen in the same frame as the new one.
  if (shown.key !== iconKey) {
    setLeaving(shown);
    setShown({ key: iconKey, node: icon });
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const swapped = leaving !== null;
  return (
    <span
      data-slot="icon-swap"
      className={cn("relative inline-grid place-items-center", className)}
    >
      {leaving ? (
        <span
          key={leaving.key}
          data-state="exit"
          aria-hidden
          className="icon-exit col-start-1 row-start-1 inline-flex"
        >
          {leaving.node}
        </span>
      ) : null}
      <span
        key={iconKey}
        data-state="enter"
        className={cn("col-start-1 row-start-1 inline-flex", swapped && "icon-enter")}
      >
        {icon}
      </span>
    </span>
  );
}
