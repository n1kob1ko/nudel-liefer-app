"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Switch (redesign RD2, DESIGN.md): used inline in tables (Aktiv/Inaktiv) and for "Pin geprüft".
 * Radix provides `role="switch"`, the keyboard toggle and `aria-checked`; the label or `aria-label`
 * always carries the meaning, never the colour alone.
 *
 * On = ink track with a yolk knob (light) or yolk track with an ink knob (dark): both read at well
 * over 3:1 against the card, which a yolk track with a white knob would not. The knob travels on
 * the ease-in-out curve and stretches by 12 % on the way (motion rules 5 and 9), but only when the
 * user toggles it, never on page load.
 *
 * `size="lg"` is the 48 px driver target; `md` is the admin table size. NUD-153 measured the `md`
 * switch at 44x24 px on a tablet: it stays as designed (a 48 px row, the label right next to it) and
 * is recorded as a desktop-density exception in the ticket.
 */
function Switch({
  className,
  size = "md",
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "md" | "lg" }) {
  // Counts the user's toggles; the knob is keyed by it so every toggle replays the stretch.
  const [moves, setMoves] = React.useState(0);
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      onCheckedChange={(checked) => {
        setMoves((count) => count + 1);
        onCheckedChange?.(checked);
      }}
      className={cn(
        "peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors duration-200 ease-out outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-foreground dark:data-[state=checked]:bg-primary",
        size === "lg" ? "h-8 w-14" : "h-6 w-11",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block transition-transform duration-[260ms] ease-in-out motion-reduce:transition-none",
          size === "lg"
            ? "size-6 data-[state=checked]:translate-x-7"
            : "size-5 data-[state=checked]:translate-x-5",
        )}
      >
        <span
          key={moves}
          className={cn(
            "block size-full rounded-full bg-card shadow-sm transition-colors duration-200 group-data-[state=checked]/switch:bg-primary dark:bg-foreground dark:group-data-[state=checked]/switch:bg-primary-foreground",
            moves > 0 && "knob-stretch",
          )}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
