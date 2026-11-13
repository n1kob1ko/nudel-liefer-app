"use client";

import { BanknoteIcon, CheckIcon, PencilLineIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { amountInputValue, parseAmountToCents } from "@/domain/money";
import { cashState } from "@/domain/payment";
import { enqueueMutation } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

/**
 * Cash at the stop (D33, NUD-196). Shown only when the stop carries ON_DELIVERY orders: what to
 * collect, an editable amount (the customer may pay in part or with change) and a "Kassiert"
 * button. The tap goes into the offline outbox like every other driver value (NUD-082), so it works
 * in a cellar and cannot be booked twice; the amount shows at once through the overlay.
 *
 * Recording needs the stop to be DELIVERED (money changes hands with the goods): before that the
 * card says so instead of offering the button.
 */
export function StopPayment({
  stop,
}: {
  stop: {
    id: string;
    customerName: string;
    status: "PENDING" | "DELIVERED" | "PROBLEM";
    cashDueCents?: number;
    collectedCents?: number | null;
  };
}) {
  const t = useTranslations("driver.payment");
  const money = useFormatter();
  const inputId = useId();
  const due = stop.cashDueCents ?? 0;
  const collected = stop.collectedCents ?? null;
  const [editing, setEditing] = useState(collected === null);
  const [value, setValue] = useState(amountInputValue(collected ?? due));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (due <= 0 && collected === null) return null;

  const euro = (cents: number | null) =>
    cents === null ? "—" : money.number(cents / 100, { style: "currency", currency: "EUR" });
  const state = cashState(due, collected);
  const cents = parseAmountToCents(value);
  const canSave = stop.status === "DELIVERED" && cents !== null && !busy;

  async function save() {
    if (!canSave || cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueMutation({
        type: "payment",
        stopId: stop.id,
        collectedCents: cents,
        customerName: stop.customerName,
      });
      setEditing(false);
      toast.success(t("saved", { name: stop.customerName }));
    } catch {
      // IndexedDB unavailable (private mode): nothing was queued, say so instead of pretending.
      setError(t("errors.storage"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-labelledby={`${inputId}-heading`}
      data-testid="stop-payment"
      data-state={state}
    >
      <div className="flex items-start gap-3">
        <BanknoteIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id={`${inputId}-heading`} className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="text-base text-muted-foreground" data-testid="payment-due">
            {t("due", { amount: euro(due) })}
          </p>
        </div>
        {collected !== null ? (
          <span className="shrink-0 rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success-soft-foreground">
            {t("collectedBadge", { amount: euro(collected) })}
          </span>
        ) : null}
      </div>

      {collected !== null && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-base">
            <span className="font-semibold" data-testid="payment-collected">
              {t("collected", { amount: euro(collected) })}
            </span>
            {state === "short" ? (
              <span className="block text-warning-soft-foreground">
                {t("short", { amount: euro(Math.max(due - collected, 0)) })}
              </span>
            ) : null}
            {state === "over" ? (
              <span className="block text-muted-foreground">
                {t("over", { amount: euro(collected - due) })}
              </span>
            ) : null}
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12"
            onClick={() => {
              setValue(amountInputValue(collected));
              setEditing(true);
            }}
            data-testid="payment-edit"
          >
            <PencilLineIcon aria-hidden />
            {t("change")}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-base font-semibold">
            {t("amountLabel")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              className="block min-h-14 w-32 field rounded-lg border border-input bg-card px-3 text-xl font-semibold tabular-nums outline-none"
              data-testid="payment-amount"
            />
            <span className="text-xl font-semibold" aria-hidden>
              €
            </span>
            <Button
              type="button"
              variant="success"
              size="lg"
              className="min-h-14 flex-1 text-lg font-bold"
              disabled={!canSave}
              loading={busy}
              onClick={() => void save()}
              data-testid="payment-save"
            >
              <CheckIcon className="size-6" aria-hidden />
              {t("save")}
            </Button>
          </div>
          {stop.status !== "DELIVERED" ? (
            <p className="text-base text-muted-foreground" data-testid="payment-need-delivery">
              {t("needDelivery")}
            </p>
          ) : value.trim() !== "" && cents === null ? (
            <p className="text-base font-medium text-destructive" role="alert">
              {t("errors.amount")}
            </p>
          ) : null}
          {error ? (
            <p
              className="text-base font-medium text-destructive"
              role="alert"
              data-testid="payment-error"
            >
              {error}
            </p>
          ) : null}
          {collected !== null ? (
            <button
              type="button"
              className={cn("min-h-12 text-base font-medium underline underline-offset-4")}
              onClick={() => {
                setValue(amountInputValue(collected));
                setEditing(false);
              }}
            >
              {t("cancel")}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
