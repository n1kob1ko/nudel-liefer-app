import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Multi-line text input (redesign RD-2, re-design.md §5). Same surface and focus treatment as
 * `Input`, so a form mixes both without a visible seam. Errors are localized text shown by the
 * caller (usually inside `FormField`) — `aria-invalid` only styles the border.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full min-w-0 field rounded-md border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
