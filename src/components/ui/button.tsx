import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button (redesign RD-2, re-design.md §5).
 *
 * Variants: `default` is the brand/primary filled button and `primary` is an alias of it (both are
 * kept so existing callers keep working). `secondary` is the soft *tinted* variant without a border.
 * Sizes: `lg` (48 px) is the driver size, `xl` (56 px) the driver primary size — touch targets
 * >= 48 px stay intact even when callers override `min-h-14 text-lg` (tailwind-merge lets the
 * caller's className win). `icon`/`icon-lg` are icon-only and therefore need an `aria-label`
 * (plus a `Tooltip` in the admin app).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-base font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none select-none active:scale-[.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-muted",
        secondary: "bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/70",
        ghost: "hover:bg-muted",
        success: "bg-success text-success-foreground hover:brightness-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // `lg` / `xl` / `icon-lg` are the driver sizes: touch targets >= 48 px (backlog 4.3).
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-sm",
        lg: "min-h-12 px-6 py-2 text-center whitespace-normal",
        xl: "min-h-14 px-6 py-3 text-center text-lg whitespace-normal",
        icon: "size-10",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * Shows a spinner, sets `aria-busy` and disables the button. The label stays visible next to the
     * spinner, so the width does not jump and the accessible name does not change while loading.
     */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {/*
       * `Slot` (asChild) requires exactly one React element child, so the loading spinner is only
       * rendered for the real <button>. `asChild` is used for links/`Link`, which are never loading.
       */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2Icon className="size-5 shrink-0 animate-spin" aria-hidden /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
