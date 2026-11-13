import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Text input (redesign RD2, DESIGN.md). `size` picks the 40 px admin or 48 px driver height. White
 * with a visible border (3:1); the shared `field` utility adds the hover, the focus state (ink
 * border plus a yolk halo) and the `aria-invalid` styling. The localized error text lives in
 * `FormField`.
 */
const inputVariants = cva(
  "flex w-full min-w-0 field rounded-md border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      size: {
        default: "h-10",
        sm: "h-9 text-sm",
        lg: "min-h-12",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function Input({
  className,
  type,
  size,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
