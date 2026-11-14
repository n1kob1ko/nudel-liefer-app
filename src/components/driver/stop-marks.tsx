"use client";

import { ReceiptTextIcon, RefrigeratorIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Two reminders on the driver screens (owner 2026-11-14): a fridge symbol when the goods go into the
 * customer's fridge (customer setting) and an invoice symbol when the office ticked "Rechnung" for
 * this stop in the day plan. Icon plus word, never the icon alone; a quiet blue chip, no yellow
 * (yolk is for the one main button). Stops without either show nothing.
 */
export function StopMarks({
  stop,
  className,
}: {
  stop: { intoFridge?: boolean; handInvoice?: boolean };
  className?: string;
}) {
  const t = useTranslations("driver.marks");
  if (!stop.intoFridge && !stop.handInvoice) return null;
  const chip =
    "inline-flex max-w-full items-center gap-1 rounded-md bg-info-soft px-2 py-0.5 text-base leading-tight font-semibold text-info-soft-foreground";
  return (
    <>
      {stop.handInvoice ? (
        <span className={cn(chip, className)} data-testid="mark-invoice">
          <ReceiptTextIcon className="size-5 shrink-0" aria-hidden />
          {t("invoice")}
        </span>
      ) : null}
      {stop.intoFridge ? (
        <span className={cn(chip, className)} data-testid="mark-fridge">
          <RefrigeratorIcon className="size-5 shrink-0" aria-hidden />
          {t("fridge")}
        </span>
      ) : null}
    </>
  );
}
