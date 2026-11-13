"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Select (redesign RD-2, re-design.md §5): the shadcn/Radix select, sized for a **drop-in native
 * `<select>` replacement** in filters and language pickers. `size="lg"` is the 48 px driver height,
 * the default 40 px is the admin height.
 *
 * Radix renders a real `role="combobox"` trigger, so an accessible name comes from `aria-label` or
 * an external `<Label htmlFor>` pointing at `SelectTrigger`'s `id`. The selected value is announced
 * through `SelectValue`; the visible label always accompanies the colour.
 */
function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

const selectTriggerVariants = cva(
  "flex w-full items-center justify-between gap-2 field cursor-pointer rounded-md border border-input bg-card px-3 py-2 text-base whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none data-[placeholder]:text-muted-foreground data-[state=open]:border-foreground [&>span]:line-clamp-1",
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

function SelectTrigger({
  className,
  children,
  size,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(selectTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon
          className="size-4 shrink-0 opacity-70 transition-transform duration-200 ease-out in-data-[state=open]:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          "pop relative z-50 max-h-72 min-w-32 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md [--pop-origin:var(--radix-select-content-transform-origin)]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-10 w-full cursor-default items-center gap-2 rounded-sm py-1.5 ps-2 pe-8 text-base outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted",
        className,
      )}
      {...props}
    >
      <span className="absolute end-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  selectTriggerVariants,
  SelectValue,
};
