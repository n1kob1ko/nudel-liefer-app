"use client";

import type { LucideIcon } from "lucide-react";
import * as m from "motion/react-m";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { type ReactNode, useId, useState } from "react";

import { LayoutThumb } from "@/components/motion/layout-thumb";
import { MotionProvider } from "@/components/motion/motion-provider";
import { cn } from "@/lib/utils";

export type SegmentedControlOption = {
  value: string;
  label: ReactNode;
  icon?: LucideIcon;
  /** Forwarded to the option element so specs can target one segment. */
  testId?: string;
};

// Driver sizes (re-design.md §7.2): lg = 48 px high, md = 40 px (admin), sm = 32 px.
// The *items* are the touch targets, so `lg` items must reach 48 px (backlog 4.3) — a 48 px track
// with 44 px items fails the driver layoutAudit. Track 52 px, item 48 px.
const listSizes = { sm: "h-8", md: "h-10", lg: "h-13" } as const;
const itemSizes = { sm: "min-h-7", md: "min-h-9", lg: "min-h-12" } as const;
const iconSizes = { sm: "size-4", md: "size-5", lg: "size-6" } as const;

/**
 * Segmented control for mutually exclusive view switches (Liste/Karte, Heute/Morgen/Woche).
 * Radix `ToggleGroup` provides roving focus and arrow-key navigation; the selection is exposed as
 * `data-state` and the segment label carries the meaning, never the fill colour alone.
 *
 * The white thumb behind the selected segment is one element that travels (motion rules 9 and 20)
 * and stretches by 12 % on the way (rule 5), but only after the user changed the value.
 */
export function SegmentedControl({
  value,
  onValueChange,
  options,
  ariaLabel,
  size = "md",
  className,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedControlOption[];
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  id?: string;
}) {
  const thumbId = useId();
  const [moved, setMoved] = useState(false);
  return (
    <MotionProvider>
      <ToggleGroupPrimitive.Root
        asChild
        id={id}
        type="single"
        value={value}
        // Radix reports "" when the active item is pressed again; keep the current value so the
        // control always has exactly one selection.
        onValueChange={(next) => {
          if (!next) return;
          setMoved(true);
          onValueChange(next);
        }}
        aria-label={ariaLabel}
        role="group"
        data-slot="segmented-control"
        className={cn(
          "inline-flex w-full items-center gap-1 rounded-md bg-muted p-0.5 isolate",
          listSizes[size],
          className,
        )}
      >
        {/*
         * `layoutRoot`: the thumb travels relative to this track (the track itself is a layout
         * node that snaps, duration 0, so only the thumb is animated). Without it a control that itself
         * moves when the value changes (the list/map switch reflows the page) would send the thumb
         * flying in from where the track used to be.
         */}
        <m.div layout layoutRoot transition={{ layout: { duration: 0 } }}>
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <ToggleGroupPrimitive.Item
                key={option.value}
                value={option.value}
                data-testid={option.testId}
                // No `aria-pressed` here: Radix renders each item with `role="radio"` and its own
                // `aria-checked`, and `aria-pressed` is not allowed on `radio` (axe `aria-allowed-attr`,
                // critical — it failed the driver login/picker screens). `aria-checked` carries the state.
                className={cn(
                  "relative inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 self-stretch rounded-sm px-3 font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:hover:text-foreground",
                  size === "sm" ? "text-sm" : "text-base",
                  itemSizes[size],
                )}
              >
                {option.value === value ? (
                  <LayoutThumb
                    layoutId={thumbId}
                    stretch={moved}
                    data-slot="segmented-thumb"
                    className="rounded-sm bg-card shadow-sm"
                  />
                ) : null}
                {Icon ? (
                  <Icon className={cn(iconSizes[size], "relative shrink-0")} aria-hidden />
                ) : null}
                <span className="relative truncate">{option.label}</span>
              </ToggleGroupPrimitive.Item>
            );
          })}
        </m.div>
      </ToggleGroupPrimitive.Root>
    </MotionProvider>
  );
}
