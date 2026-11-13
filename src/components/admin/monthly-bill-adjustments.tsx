"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { parseAmountToCents } from "@/domain/money";
import { type AdjustmentKind, MAX_ADJUSTMENT_LABEL } from "@/domain/payment";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  addMonthlyAdjustmentAction,
  removeMonthlyAdjustmentAction,
} from "@/server/payment-actions";

export type BillAdjustmentLine = {
  id: string;
  label: string;
  /** Formatted with its sign by the server page, e.g. "-10,00 €" or "+2,50 €". */
  amountText: string;
};

/**
 * The foot of a monthly bill (NUD-197): the orders' subtotal, the correction lines (discount,
 * credit note, surcharge) and the total, plus the small form that adds a line. Read like the foot
 * of a paper invoice, so the lines print with the bill and the form does not.
 *
 * While the month is marked paid the lines are frozen (`locked`): the "paid" note is a snapshot of
 * exactly this total. The server enforces the same rule; this only explains it.
 */
export function MonthlyBillAdjustments({
  customerId,
  month,
  locked,
  hasOrders,
  adjustments,
  ordersTotalText,
  totalText,
}: {
  customerId: string;
  /** `YYYY-MM` */
  month: string;
  locked: boolean;
  /**
   * Whether the month has orders on monthly bill. Without them there is no bill to correct (the
   * server refuses too), so the form is replaced by a sentence; existing lines can still go.
   */
  hasOrders: boolean;
  adjustments: BillAdjustmentLine[];
  ordersTotalText: string;
  totalText: string;
}) {
  const t = useTranslations("admin.payments.adjust");
  const router = useRouter();
  const [kind, setKind] = useState<AdjustmentKind>("deduction");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ label?: string; amount?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set at once, not with the next render: a double click must not send the correction twice.
  const sending = useRef(false);
  const [adding, setAdding] = useState(false);
  // Lines that were on the bill when the page opened stay still; only a line the office adds now
  // slides in, so the eye lands on what just changed.
  const [initialIds] = useState(() => new Set(adjustments.map((line) => line.id)));

  function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const cents = parseAmountToCents(amount);
    const nextErrors = {
      label: label.trim() ? undefined : t("errors.labelRequired"),
      amount: cents === null || cents === 0 ? t("errors.amountInvalid") : undefined,
    };
    setFieldErrors(nextErrors);
    if (nextErrors.label || nextErrors.amount || sending.current) return;

    sending.current = true;
    setAdding(true);
    startTransition(async () => {
      try {
        let result;
        try {
          result = await addMonthlyAdjustmentAction({
            customerId,
            month,
            kind,
            label: label.trim(),
            amount: amount.trim(),
          });
        } catch {
          return setError(t("errors.generic"));
        }
        if (!result.ok) return setError(t(`errors.${result.error}`));
        setLabel("");
        setAmount("");
        // Back to the common case, so a surcharge is never added twice by habit.
        setKind("deduction");
        toast.success(t("toast.added"));
        router.refresh();
      } finally {
        sending.current = false;
        setAdding(false);
      }
    });
  }

  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    startTransition(async () => {
      let result;
      try {
        result = await removeMonthlyAdjustmentAction({ adjustmentId: id });
      } catch {
        setRemovingId(null);
        return setError(t("errors.generic"));
      }
      if (!result.ok) {
        setRemovingId(null);
        return setError(t(`errors.${result.error}`));
      }
      toast.success(t("toast.removed"));
      router.refresh();
    });
  }

  // Subtotal and total line up with the correction amounts, which sit left of a remove button.
  const amountClass = cn("tabular-nums", !locked && "pe-9 print:pe-0");

  return (
    <TooltipProvider>
      <section className="flex flex-col gap-5" aria-label={t("heading")} data-testid="adjustments">
        {adjustments.length > 0 ? (
          <dl className="ms-auto flex w-full max-w-xl flex-col text-base">
            <div
              className="flex items-baseline justify-between gap-4 py-2 text-muted-foreground"
              data-testid="bill-subtotal"
            >
              <dt>{t("subtotal")}</dt>
              <dd className={amountClass}>{ordersTotalText}</dd>
            </div>
            {adjustments.map((line) => (
              <div
                key={line.id}
                data-testid={`adjustment-${line.id}`}
                className={cn(
                  "flex items-center justify-between gap-3 py-1 transition-opacity duration-150 ease-out motion-reduce:transition-none",
                  !initialIds.has(line.id) &&
                    "animate-in duration-200 ease-out fade-in slide-in-from-bottom-1",
                  removingId === line.id && "opacity-40",
                )}
              >
                <dt className="min-w-0 flex-1 wrap-break-word">{line.label}</dt>
                <dd className="flex shrink-0 items-center gap-1 tabular-nums">
                  {line.amountText}
                  {locked ? null : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground print:hidden"
                          aria-label={t("remove", { label: line.label })}
                          disabled={pending}
                          onClick={() => remove(line.id)}
                          data-testid={`adjustment-remove-${line.id}`}
                        >
                          <XIcon className="size-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("remove", { label: line.label })}</TooltipContent>
                    </Tooltip>
                  )}
                </dd>
              </div>
            ))}
            <div
              className="mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-3 text-lg font-semibold"
              data-testid="bill-total"
            >
              <dt>{t("total")}</dt>
              <dd className={amountClass}>{totalText}</dd>
            </div>
          </dl>
        ) : null}

        {locked ? (
          <p className="text-sm text-muted-foreground print:hidden" data-testid="adjustment-locked">
            {t("locked")}
          </p>
        ) : !hasOrders ? (
          <p
            className="text-sm text-muted-foreground print:hidden"
            data-testid="adjustment-no-orders"
          >
            {t("noOrders")}
          </p>
        ) : (
          <form
            onSubmit={add}
            noValidate
            className="flex flex-col gap-3 border-t border-border pt-5 print:hidden"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold">{t("formTitle")}</h3>
              <p className="max-w-prose text-sm text-muted-foreground">{t("formBody")}</p>
            </div>
            <div className="grid items-start gap-3 sm:grid-cols-[13rem_minmax(0,1fr)_11rem_auto]">
              <FormField label={t("kind")} htmlFor="adjustment-kind">
                <SegmentedControl
                  id="adjustment-kind"
                  value={kind}
                  onValueChange={(next) => setKind(next as AdjustmentKind)}
                  ariaLabel={t("kind")}
                  options={[
                    {
                      value: "deduction",
                      label: t("deduction"),
                      testId: "adjustment-kind-deduction",
                    },
                    {
                      value: "surcharge",
                      label: t("surcharge"),
                      testId: "adjustment-kind-surcharge",
                    },
                  ]}
                />
              </FormField>
              <FormField label={t("label")} error={fieldErrors.label}>
                <Input
                  value={label}
                  maxLength={MAX_ADJUSTMENT_LABEL}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={t("labelPlaceholder")}
                  autoComplete="off"
                  data-testid="adjustment-label"
                />
              </FormField>
              <FormField label={t("amount")} error={fieldErrors.amount}>
                <Input
                  value={amount}
                  maxLength={16}
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={t("amountPlaceholder")}
                  autoComplete="off"
                  className="text-right tabular-nums"
                  data-testid="adjustment-amount"
                />
              </FormField>
              {/* The margin is the height of a field label, so the button sits on the input row
                  even when an error text makes a neighbouring field taller. */}
              <Button
                type="submit"
                loading={adding}
                disabled={pending}
                className="sm:mt-7.5"
                data-testid="adjustment-add"
              >
                <PlusIcon aria-hidden />
                {t("add")}
              </Button>
            </div>
          </form>
        )}

        {error ? (
          <p
            className="text-sm font-medium text-destructive print:hidden"
            role="alert"
            data-testid="adjustment-error"
          >
            {error}
          </p>
        ) : null}
      </section>
    </TooltipProvider>
  );
}
