import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button (redesign RD2 "Dotter", DESIGN.md).
 *
 * Colour carries the importance, so the action that matters is found without reading:
 * - `default` / `primary`: yolk fill with ink text. The ONE important action of a view.
 * - `success`: green fill. "Geliefert" and other "this step is done" confirmations.
 * - `destructive`: red fill. Delete and other irreversible actions.
 * - `warning`: soft red fill. "Problem melden": visible, but not competing with the green button.
 * - `secondary`: pale yolk tint. The second-most important action.
 * - `outline`: white with a border. Everything else. `ghost` / `link`: toolbars and inline.
 *
 * Filled variants carry a tactile edge (`btn-edge`) that flattens while pressed; every variant
 * scales to 0.97 while pressed (motion rule 4). The focus ring is an outline, so it never fights
 * the edge's box-shadow, and it is ink in light mode and yolk in dark mode (`--ring`).
 *
 * Sizes: `lg` (48 px) is the driver size, `xl` (56 px) the driver primary size: touch targets
 * >= 48 px stay intact even when callers override `min-h-14 text-lg` (tailwind-merge lets the
 * caller's className win). `icon`/`icon-lg` are icon-only and therefore need an `aria-label`
 * (plus a `Tooltip` in the admin app).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-base font-semibold whitespace-nowrap outline-none select-none transition-[color,background-color,border-color,box-shadow,transform,filter] duration-[140ms] ease-out active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "btn-edge bg-primary text-primary-foreground hover:bg-primary-hover",
        primary: "btn-edge bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive:
          "btn-edge bg-destructive text-destructive-foreground hover:brightness-110 dark:hover:brightness-105",
        warning:
          "border border-destructive/25 bg-destructive-soft text-destructive-soft-foreground hover:border-destructive/45",
        outline:
          "border border-input/60 bg-card text-foreground shadow-xs hover:border-input hover:bg-muted/60",
        secondary:
          "bg-primary-soft text-primary-soft-foreground hover:brightness-[.97] dark:hover:brightness-125",
        ghost: "font-medium hover:bg-muted",
        success:
          "btn-edge bg-success text-success-foreground hover:brightness-110 dark:hover:brightness-105",
        link: "link active:scale-100",
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
