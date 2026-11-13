"use client";

import { type ComponentProps, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A short pulse on a value that just changed because of something the user did (the total of a
 * bill after a correction was added). It confirms "your change arrived here" without a second
 * toast. Still on the first render: a page that opens must not move.
 *
 * The element is re-keyed on every change, so the CSS animation (`confirm-pulse` in globals.css)
 * restarts instead of being skipped. Reduced motion is handled globally.
 */
export function ConfirmPulse({
  value,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { value: string | number }) {
  const [seen, setSeen] = useState(value);
  const [changes, setChanges] = useState(0);
  if (seen !== value) {
    setSeen(value);
    setChanges(changes + 1);
  }
  return (
    <span
      key={changes}
      className={cn("inline-block", changes > 0 && "confirm-pulse", className)}
      {...props}
    >
      {children}
    </span>
  );
}
