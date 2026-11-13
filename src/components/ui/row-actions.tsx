"use client";

import { type LucideIcon, MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Row overflow menu for admin tables (redesign RD-3, re-design.md §5/§8.10).
 *
 * One icon-only trigger per row (36 px) with an `aria-label` and a matching tooltip; the menu opens
 * aligned to the end so it never leaves the viewport. The children are the `DropdownMenuItem`s, so
 * no action is duplicated inside this component. Never more than one visible button plus this menu.
 * Rows with only a few actions use `RowButtons` below instead: no menu at all.
 *
 * The provider is mounted here so a table can use `RowActions` without remembering to wrap the
 * screen; Radix tolerates nested providers.
 */
export function RowActions({
  label,
  children,
  className,
}: {
  /** Accessible name of the trigger, e.g. "Aktionen für Bestellung 4711". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={label}
                className={cn("size-9", className)}
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}

/**
 * Direct row actions: the few things one does with a row, visible as buttons instead of behind a
 * "…" menu (owner feedback 2026-11-13: the three dots are one tap too many, above all on a phone).
 *
 * One element per action, two looks: on a phone a labelled button (the word is the target, 44 px
 * high, the group sits below the row's text); from 768 px an icon button with the same word as
 * its accessible name and the longer `hint` as tooltip. On a phone the buttons wrap and share each
 * line evenly, so no word is ever cut. Use it for up to five actions; a row with more keeps
 * `RowActions`.
 */
export function RowButtons({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TooltipProvider>
      <div
        data-slot="row-buttons"
        className={cn(
          "flex flex-wrap gap-2 md:flex-nowrap md:items-center md:justify-end md:gap-0.5",
          className,
        )}
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

export function RowButton({
  icon: Icon,
  label,
  hint,
  subject,
  destructive = false,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "variant" | "size"> & {
  icon: LucideIcon;
  /** The word on the button (phone) and its accessible name (everywhere). Keep it to one word or two. */
  label: string;
  /** Tooltip from 768 px, where only the icon shows; defaults to `label`. */
  hint?: string;
  /** Whom or what the row is about, e.g. the driver's name: makes the name unique for a screen reader. */
  subject?: string;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={subject ? `${label}: ${subject}` : undefined}
          className={cn(
            "h-11 gap-1.5 px-3 text-sm max-md:flex-1 md:size-9 md:border-transparent md:bg-transparent md:px-0 md:shadow-none md:hover:border-transparent md:hover:bg-muted",
            destructive && "text-destructive",
            className,
          )}
          {...props}
        >
          <Icon aria-hidden className="max-md:hidden" />
          <span className="md:sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      {/* A tooltip repeats the name for the pointer; a phone shows the word itself. */}
      <TooltipContent className="max-md:hidden">{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}
