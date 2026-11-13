"use client";

import { CheckIcon, PrinterIcon, Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { markMonthlyBillPaidAction, unmarkMonthlyBillPaidAction } from "@/server/payment-actions";

/**
 * "Mark that month as paid" / take it back / print (D33, NUD-196). The office decides; the server
 * snapshots the total and the number of orders so a later order edit cannot silently change what
 * was paid.
 */
export function MonthlyBillActions({
  customerId,
  month,
  paid,
}: {
  customerId: string;
  /** `YYYY-MM` */
  month: string;
  paid: boolean;
}) {
  const t = useTranslations("admin.payments");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function mark() {
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await markMonthlyBillPaidAction({ customerId, month, note });
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t(`errors.${result.error}`));
      toast.success(t("toast.marked"));
      router.refresh();
    });
  }

  function unmark() {
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await unmarkMonthlyBillPaidAction({ customerId, month });
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t(`errors.${result.error}`));
      toast.success(t("toast.unmarked"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="monthly-actions">
      {paid ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={unmark}
            disabled={pending}
            data-testid="monthly-unmark"
          >
            <Undo2Icon aria-hidden />
            {t("unmark")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            data-testid="monthly-print"
          >
            <PrinterIcon aria-hidden />
            {t("print")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <label htmlFor="monthly-note" className="text-sm font-medium">
              {t("note")}
            </label>
            <Input
              id="monthly-note"
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("notePlaceholder")}
              data-testid="monthly-note"
            />
          </div>
          <Button type="button" onClick={mark} disabled={pending} data-testid="monthly-mark">
            <CheckIcon aria-hidden />
            {pending ? t("marking") : t("mark")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            data-testid="monthly-print"
          >
            <PrinterIcon aria-hidden />
            {t("print")}
          </Button>
        </div>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert" data-testid="monthly-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
