"use client";

import { ReceiptTextIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { FridgeIcon } from "./fridge-icon";

type Mark = "invoice" | "fridge";

/**
 * Two reminders on the driver screens (owner 2026-11-14): the snowflake when the goods go into the
 * customer's fridge and a receipt when the invoice goes with the delivery. Only the symbols show
 * (owner 2026-11-15); a tap on one opens a small box right at it that says what it means.
 *
 * `interactive` symbols (next-stop card, stop detail) are popover buttons with a 48 px touch target.
 * In stop-list rows, which are links as a whole, they are display only (no button inside a link);
 * screen readers get the meaning as text either way. Stops without either show nothing.
 */
export function StopMarks({
  stop,
  interactive = false,
  className,
}: {
  stop: { intoFridge?: boolean; handInvoice?: boolean };
  interactive?: boolean;
  className?: string;
}) {
  if (!stop.intoFridge && !stop.handInvoice) return null;
  return (
    <>
      {stop.handInvoice ? (
        <MarkSymbol mark="invoice" interactive={interactive} className={className} />
      ) : null}
      {stop.intoFridge ? (
        <MarkSymbol mark="fridge" interactive={interactive} className={className} />
      ) : null}
    </>
  );
}

function markIcon(mark: Mark, size: string): ReactNode {
  return mark === "fridge" ? (
    <FridgeIcon className={size} />
  ) : (
    <ReceiptTextIcon className={cn(size, "shrink-0")} aria-hidden />
  );
}

function MarkSymbol({
  mark,
  interactive,
  className,
}: {
  mark: Mark;
  interactive: boolean;
  className?: string;
}) {
  const t = useTranslations("driver.marks");
  const testId = `mark-${mark}`;

  if (!interactive) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-input/50 bg-card px-1.5 py-0.5 text-foreground",
          className,
        )}
        data-testid={testId}
      >
        {markIcon(mark, "size-5")}
        <span className="sr-only">{t(mark)}</span>
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={t(mark)}
        className={cn(
          // 48 px to the finger, like the key chip next to it.
          "inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-input/50 bg-card px-2 text-foreground outline-none transition-[border-color,transform] duration-[140ms] ease-out hover:border-input focus-visible:ring-2 focus-visible:ring-ring active:scale-[.97] data-[state=open]:border-foreground",
          className,
        )}
        data-testid={testId}
      >
        {markIcon(mark, "size-7")}
      </PopoverTrigger>
      <PopoverContent
        // Right under the symbol: on a phone the symbols sit at the right edge, so a box to the
        // side would be cut off; below it always fits and slides sideways into the screen.
        side="bottom"
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="flex w-auto max-w-64 items-start gap-2.5 p-3"
        data-testid={`${testId}-info`}
      >
        {markIcon(mark, "mt-0.5 size-6")}
        <span className="min-w-0 space-y-0.5">
          <span className="block text-lg leading-tight font-bold">{t(mark)}</span>
          <span className="block text-base leading-snug text-muted-foreground">
            {t(`${mark}Info`)}
          </span>
        </span>
      </PopoverContent>
    </Popover>
  );
}
