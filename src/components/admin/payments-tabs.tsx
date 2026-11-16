"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";

export const PAYMENTS_TABS = ["schulden", "monat"] as const;
export type PaymentsTab = (typeof PAYMENTS_TABS)[number];

/**
 * The two tabs of the payments page (owner 2026-11-16: "Schulden-Tab mit !!!"): who still owes
 * cash, and the monthly bills. Both panels are rendered on the server; switching is instant and
 * only writes `?reiter=` into the address (no reload), so a reload or a shared link opens the same
 * tab. The debts tab carries a red "!!!" while anybody owes money.
 */
export function PaymentsTabs({
  initial,
  debtAlert,
  debts,
  monthly,
}: {
  initial: PaymentsTab;
  /** Somebody owes cash: show "!!!" on the tab. */
  debtAlert: boolean;
  debts: ReactNode;
  monthly: ReactNode;
}) {
  const t = useTranslations("admin.payments.tabs");
  const [tab, setTab] = useState<PaymentsTab>(initial);

  function change(next: string) {
    const value = (PAYMENTS_TABS as readonly string[]).includes(next)
      ? (next as PaymentsTab)
      : "schulden";
    setTab(value);
    try {
      const url = new URL(window.location.href);
      if (value === "schulden") url.searchParams.delete("reiter");
      else url.searchParams.set("reiter", value);
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // the address simply keeps the old tab
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        value={tab}
        onValueChange={change}
        ariaLabel={t("label")}
        className="sm:w-auto sm:self-start"
        wrapLabels
        options={[
          {
            value: "schulden",
            testId: "payments-tab-debts",
            label: (
              <span className="flex flex-wrap items-baseline justify-center gap-x-2">
                {t("debts")}
                {debtAlert ? (
                  <span
                    className="font-bold tracking-tight text-destructive"
                    data-testid="payments-debt-alert"
                  >
                    <span aria-hidden>!!!</span>
                    <span className="sr-only">{t("alert")}</span>
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            value: "monat",
            testId: "payments-tab-monthly",
            label: t("monthly"),
          },
        ]}
      />
      <div hidden={tab !== "schulden"} className="flex flex-col gap-6" data-testid="payments-debts">
        {debts}
      </div>
      <div hidden={tab !== "monat"} className="flex flex-col gap-6" data-testid="payments-monthly">
        {monthly}
      </div>
    </div>
  );
}
