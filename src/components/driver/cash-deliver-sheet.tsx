"use client";

import { BanknoteIcon, CheckIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { amountInputValue, parseAmountToCents } from "@/domain/money";
import { enqueueMutation } from "@/lib/offline/outbox-browser";

/**
 * "Geliefert" at a cash stop (owner 2026-11-14): the stop only counts as delivered together with
 * the cash the driver took. The sheet asks for the amount (prefilled with what is due); 0 or an
 * empty field is refused with a message, a smaller amount is allowed and stays open for the office
 * (payments page, "Wer am meisten offen hat"). Confirming queues "delivered" and then "payment"
 * in the offline outbox, so both reach the server in that order, also after a dead spot.
 */
export function CashDeliverSheet({
  stop,
  onClose,
  onDelivered,
}: {
  stop: { id: string; customerName: string; cashDueCents: number };
  onClose: () => void;
  /** Called after both entries are queued (toast, undo, next stop: the caller's business). */
  onDelivered: () => void;
}) {
  const t = useTranslations("driver.payment");
  const locale = useLocale();
  const money = useFormatter();
  const inputId = useId();
  const [value, setValue] = useState(amountInputValue(stop.cashDueCents, locale));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const euro = (cents: number) => money.number(cents / 100, { style: "currency", currency: "EUR" });
  const cents = parseAmountToCents(value);
  const invalid = value.trim() !== "" && cents === null;
  const nothing = cents === null || cents === 0;
  const short = cents !== null && cents > 0 && cents < stop.cashDueCents;

  async function confirm() {
    setTouched(true);
    if (busy || cents === null || cents <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueMutation({
        type: "delivered",
        stopId: stop.id,
        customerName: stop.customerName,
      });
      await enqueueMutation({
        type: "payment",
        stopId: stop.id,
        collectedCents: cents,
        customerName: stop.customerName,
      });
      onDelivered();
      onClose();
    } catch {
      setError(t("errors.storage"));
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
        data-testid="cash-sheet"
      >
        <SheetHeader className="shrink-0 pe-14">
          <SheetTitle className="flex items-center gap-2 text-2xl">
            <BanknoteIcon className="size-7 shrink-0" aria-hidden />
            {t("sheet.title")}
          </SheetTitle>
          <SheetDescription className="text-base">
            {t("sheet.body", { name: stop.customerName, amount: euro(stop.cashDueCents) })}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pt-1 pb-4">
          <label htmlFor={inputId} className="block text-base font-semibold">
            {t("amountLabel")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              onFocus={(event) => event.currentTarget.select()}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              aria-invalid={touched && nothing}
              className="block min-h-14 w-40 field rounded-lg border border-input bg-card px-3 text-2xl font-semibold tabular-nums outline-none"
              data-testid="cash-sheet-amount"
            />
            <span className="text-2xl font-semibold" aria-hidden>
              €
            </span>
          </div>
          {invalid ? (
            <p className="text-base font-medium text-destructive" role="alert">
              {t("errors.amount")}
            </p>
          ) : touched && nothing ? (
            <p
              className="text-base font-medium text-destructive"
              role="alert"
              data-testid="cash-sheet-nothing"
            >
              {t("sheet.nothing")}
            </p>
          ) : short ? (
            <p className="text-base text-warning-soft-foreground" data-testid="cash-sheet-short">
              {t("short", { amount: euro(stop.cashDueCents - (cents ?? 0)) })}
            </p>
          ) : null}
          {error ? (
            <p className="text-base font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="success"
            size="xl"
            className="text-lg font-bold"
            loading={busy}
            onClick={() => void confirm()}
            data-testid="cash-sheet-confirm"
          >
            <CheckIcon className="size-6" aria-hidden />
            {t("sheet.confirm")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 text-lg"
            disabled={busy}
            onClick={onClose}
            data-testid="cash-sheet-cancel"
          >
            {t("cancel")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
