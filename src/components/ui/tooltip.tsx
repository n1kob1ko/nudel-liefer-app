"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tooltip (redesign RD-2, re-design.md §5/§9.2): shadcn convention over Radix.
 *
 * Required in the admin app on icon-only controls (the tooltip repeats what `aria-label` says).
 * `TooltipProvider` is mounted once near the top of a screen; Radix keeps the keyboard behaviour
 * (`Esc` closes, the tooltip is not in the tab order) and skips touch devices where a hover
 * tooltip would be unreachable.
 */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "pop z-50 w-fit max-w-xs rounded-sm bg-foreground px-2.5 py-1.5 text-sm font-medium text-background shadow-md [--dur-pop-out:120ms] [--dur-pop:150ms] [--pop-from:0.97] [--pop-origin:var(--radix-tooltip-content-transform-origin)]",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
