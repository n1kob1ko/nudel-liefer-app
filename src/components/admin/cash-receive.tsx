"use client";

import { HandCoinsIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RowButton } from "@/components/ui/row-actions";
import { amountInputValue, parseAmountToCents } from "@/domain/money";
import { useRouter } from "@/i18n/navigation";
import { recordOfficeCashAction } from "@/server/payment-actions";

/**
 * "Erhalten" on an open cash row (NUD-209): the office records cash the driver handed in without
 * typing it into the app, or that the customer paid later. The field is the stop's whole amount
 * taken, prefilled with what was due, so the common case is one tap on "Erhalten".
 */
export function CashReceiveButton({
  stopId,
  customerName,
  dateText,
  dueCents,
}: {
  stopId: string;
  customerName: string;
  /** The delivery day, already formatted by the page. */
  dateText: string;
  dueCents: number;
}) {
  const t = useTranslations("admin.payments.cash.receive");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => amountInputValue(dueCents, locale));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set at once, not with the next render: a double tap must not send twice.
  const sending = useRef(false);

  function openDialog() {
    setAmount(amountInputValue(dueCents, locale));
    setError(null);
    setOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) return setError(t("errors.invalid"));
    if (sending.current) return;
    sending.current = true;
    setError(null);
    startTransition(async () => {
      try {
        let result;
        try {
          result = await recordOfficeCashAction({ stopId, collectedCents: cents });
        } catch {
          return setError(t("errors.generic"));
        }
        if (!result.ok) return setError(t(`errors.${result.error}`));
        setOpen(false);
        toast.success(t("toast", { customer: customerName }));
        router.refresh();
      } finally {
        sending.current = false;
      }
    });
  }

  return (
    <>
      <RowButton
        icon={HandCoinsIcon}
        label={t("button")}
        hint={t("hint")}
        subject={customerName}
        onClick={openDialog}
        data-testid={`cash-receive-${stopId}`}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>
                {customerName} · {dateText}
              </DialogDescription>
            </DialogHeader>
            <FormField label={t("amount")} error={error ?? undefined}>
              <Input
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="tabular-nums"
                data-testid="cash-receive-amount"
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending} data-testid="cash-receive-confirm">
                {t("confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
