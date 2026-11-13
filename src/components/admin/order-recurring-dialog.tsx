"use client";

import { RepeatIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  newRuleDraft,
  type RecurringRuleDraft,
  RecurringRuleForm,
  type RuleFormError,
  ruleInputFromDraft,
  useRuleErrorText,
} from "@/components/admin/recurring-rule-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseCalendarDate } from "@/domain/order";
import { isoWeekday } from "@/domain/settings";
import { useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { createRecurringOrderAction } from "@/server/recurring-actions";

/** One product line of the order as the rule takes it over (quantity already parsed). */
export type RecurringDialogLine = {
  productId: string;
  quantity: number;
  /** Catalogue label, e.g. "Nudeln (Kiste)". */
  label: string;
  unit: "KG" | "PACK" | "CRATE" | "PIECE";
};

type FormError = RuleFormError | "customerInactive" | "generic" | null;

/**
 * Turns the order the office is just taking into a recurring order (NUD-166, D25/NUD-149). The
 * customer, the products and the quantities come from the form and are only shown here; the dialog
 * asks for the schedule alone. The delivery day of the order that is being entered is left out by
 * default: otherwise the manual order and the rule would both produce an order for that day, and
 * the stop would carry the quantities twice (all confirmed orders of a customer are merged).
 *
 * The schedule fields themselves are the shared `RecurringRuleForm` (NUD-171), the same form the
 * customer page uses, so the two entry points cannot drift apart.
 */
export function OrderRecurringDialog({
  customerId,
  customerLabel,
  lines,
  startDate,
  skipDate,
  onClose,
}: {
  customerId: string;
  /** Shown so the office sees which customer the rule belongs to. */
  customerLabel: string;
  lines: readonly RecurringDialogLine[];
  /** `YYYY-MM-DD`: default start day of the rule (first day of the requested window). */
  startDate: string;
  /** `YYYY-MM-DD` of the order being entered, or null when the day is not known yet. */
  skipDate: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.orders.form.recurring");
  const tc = useTranslations("common");
  const tu = useTranslations("driver.units");
  const errorText = useRuleErrorText();
  const fmt = createAppFormatters(useFormatter());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<RecurringRuleDraft>(() => {
    const start = parseCalendarDate(startDate);
    return newRuleDraft({
      startDate,
      weekdays: [start ? isoWeekday(start) : 1],
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });
  });
  const [skipOrderDay, setSkipOrderDay] = useState(skipDate !== null);
  const [error, setError] = useState<FormError>(null);

  const skipText = skipDate ? fmt.calendarDate(parseCalendarDate(skipDate) ?? new Date(0)) : "";
  // Day-specific quantities can use the products of the order the rule is built from.
  const products = lines.map((line) => ({
    id: line.productId,
    label: line.label,
    unit: line.unit,
  }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = ruleInputFromDraft(draft, {
      customerId,
      extraExceptions: skipOrderDay && skipDate ? [skipDate] : [],
    });
    if (!built.ok) return setError(built.error);
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createRecurringOrderAction(built.input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        return setError(result.error === "customer_inactive" ? "customerInactive" : "generic");
      }
      toast.success(t("created", { count: result.generated }));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="order-recurring-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RepeatIcon className="size-5" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("hint", { customer: customerLabel })}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
          <div className="flex flex-col gap-1 rounded-md border border-input p-3">
            <p className="text-base font-medium">{t("products")}</p>
            <ul className="flex flex-col gap-0.5 text-base" data-testid="order-recurring-lines">
              {lines.map((line) => (
                <li key={line.productId} className="tabular-nums">
                  {line.quantity} {tu(line.unit, { count: line.quantity })} {line.label}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{t("productsHint")}</p>
          </div>

          {skipDate ? (
            <div className="flex flex-col gap-1">
              <label className="flex items-start gap-2 text-base">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 accent-foreground"
                  checked={skipOrderDay}
                  onChange={(e) => setSkipOrderDay(e.target.checked)}
                  data-testid="order-recurring-skip-day"
                />
                <span>{t("skipDay", { date: skipText })}</span>
              </label>
              <p className="text-sm text-muted-foreground pl-7">{t("skipDayHint")}</p>
            </div>
          ) : null}

          <RecurringRuleForm
            key="order-recurring-rule"
            draft={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            products={products}
            prefix="order-recurring"
            startOn={startDate}
            baseLines="readonly"
          />

          {error ? (
            <Alert variant="destructive" data-testid="order-recurring-error" data-code={error}>
              <AlertDescription>{errorText(error)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="order-recurring-save">
              {pending ? t("saving") : t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
