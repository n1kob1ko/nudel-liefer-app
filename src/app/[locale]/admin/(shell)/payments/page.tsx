import { ArrowRightIcon, BanknoteIcon, FileSpreadsheetIcon, ReceiptTextIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { MonthExportForm } from "@/components/admin/bill-export";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseCalendarDate } from "@/domain/order";
import { addMonths, monthKey, monthStart } from "@/domain/payment";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { todayIn } from "@/server/orders";
import { paidHistoryQuery } from "@/server/payment-history";
import { monthlyOverviewQuery, openCashQuery } from "@/server/payments";
import { getFactoryTimezone } from "@/server/settings";

/**
 * Payments (D33, NUD-196): what is still open — cash the driver did not collect (or collected in
 * part) and customer-months whose accumulated bill is not marked paid yet. Every row links to the
 * place where it is settled: the tour (cash) or the month page (bill).
 */
async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.payments" });
  const formatter = await getFormatter({ locale });
  const fmt = createAppFormatters(formatter);
  const today = todayIn(await getFactoryTimezone());
  const db = getDb();
  const [cash, monthly, paidHistory] = await Promise.all([
    openCashQuery(db, today),
    monthlyOverviewQuery(db, today),
    // The newest paid notes; the full list is the history page (NUD-199).
    paidHistoryQuery(db, { pageSize: 5 }),
  ]);
  const openMonthly = monthly.filter((row) => row.state === "open");
  const cashTotal = cash.reduce((sum, row) => sum + (row.dueCents - (row.collectedCents ?? 0)), 0);
  const monthlyTotal = openMonthly.reduce((sum, row) => sum + row.amountCents, 0);
  // Months offered for the accounting export: the running month and the twelve before it.
  const exportMonths = Array.from({ length: 13 }, (_, index) => {
    const period = addMonths(monthStart(today), -index);
    return {
      value: monthKey(period),
      label: formatter.dateTime(period, { month: "long", year: "numeric", timeZone: "UTC" }),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} titleTestId="payments-title" />

      {/* One strip with a hairline between the two sums, like the figures of the overview. */}
      <dl
        className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs sm:grid-cols-2"
        aria-label={t("summary")}
      >
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-sm text-muted-foreground">
            {t("cash.openTotal", { count: cash.length })}
          </dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="cash-open-total">
            {fmt.amount(cashTotal)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-sm text-muted-foreground">
            {t("monthly.openTotal", { count: openMonthly.length })}
          </dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="monthly-open-total">
            {fmt.amount(monthlyTotal)}
          </dd>
        </div>
      </dl>

      <Card data-testid="cash-open">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BanknoteIcon className="size-5" aria-hidden />
            {t("cash.title")}
          </h2>
          <CardDescription>{t("cash.body")}</CardDescription>
        </CardHeader>
        <CardContent>
          {cash.length === 0 ? (
            <EmptyState
              icon={BanknoteIcon}
              title={t("cash.emptyTitle")}
              description={t("cash.emptyBody")}
              className="border-0 p-0"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.date")}</TableHead>
                    <TableHead>{t("columns.customer")}</TableHead>
                    <TableHead>{t("columns.driver")}</TableHead>
                    <TableHead className="text-right">{t("columns.due")}</TableHead>
                    <TableHead className="text-right">{t("columns.collected")}</TableHead>
                    <TableHead className="text-right">{t("columns.open")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cash.map((row) => (
                    <TableRow key={row.stopId} data-testid={`cash-row-${row.stopId}`}>
                      <TableCell className="tabular-nums">
                        {fmt.calendarDate(parseCalendarDate(row.date) ?? today)}
                      </TableCell>
                      <TableCell>
                        <span className="block font-medium">{row.customerName}</span>
                        <span className="block text-sm text-muted-foreground">
                          {row.customerNumber}
                        </span>
                      </TableCell>
                      <TableCell>{row.driverName ?? t("columns.noDriver")}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.amount(row.dueCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.collectedCents === null ? "—" : fmt.amount(row.collectedCents)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmt.amount(row.dueCents - (row.collectedCents ?? 0))}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/tours?date=${row.date}&tour=${row.tourId}`}
                          className="inline-flex items-center gap-1 text-base link"
                          data-testid={`cash-link-${row.stopId}`}
                        >
                          {t("cash.toTour")}
                          <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="monthly-open">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ReceiptTextIcon className="size-5" aria-hidden />
            {t("monthly.title")}
          </h2>
          <CardDescription>{t("monthly.body")}</CardDescription>
        </CardHeader>
        <CardContent>
          {openMonthly.length === 0 ? (
            <EmptyState
              icon={ReceiptTextIcon}
              title={t("monthly.emptyTitle")}
              description={t("monthly.emptyBody")}
              className="border-0 p-0"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.month")}</TableHead>
                    <TableHead>{t("columns.customer")}</TableHead>
                    <TableHead className="text-right">{t("columns.orders")}</TableHead>
                    <TableHead className="text-right">{t("columns.total")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openMonthly.map((row) => (
                    <TableRow
                      key={`${row.customerId}:${row.periodStart}`}
                      data-testid={`monthly-row-${row.customerId}-${row.monthKey}`}
                    >
                      <TableCell className="tabular-nums">
                        {t("monthLabel", {
                          month: formatter.dateTime(new Date(`${row.periodStart}T00:00:00Z`), {
                            month: "long",
                            year: "numeric",
                            timeZone: "UTC",
                          }),
                        })}
                      </TableCell>
                      <TableCell>
                        <span className="block font-medium">{row.customerName}</span>
                        <span className="block text-sm text-muted-foreground">
                          {row.customerNumber}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatter.number(row.orderCount, { maximumFractionDigits: 0 })}
                        {row.noAmountCount > 0 ? (
                          <Badge variant="warning" size="sm" className="ms-2">
                            {t("monthly.noAmount", { count: row.noAmountCount })}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmt.amount(row.amountCents)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/payments/${row.customerId}?month=${row.monthKey}`}
                          className="inline-flex items-center gap-1 text-base link"
                          data-testid={`monthly-link-${row.customerId}-${row.monthKey}`}
                        >
                          {t("monthly.open")}
                          <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="month-export">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <FileSpreadsheetIcon className="size-5" aria-hidden />
            {t("export.allTitle")}
          </h2>
          <CardDescription>{t("export.allBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthExportForm months={exportMonths} defaultMonth={exportMonths[1]?.value} />
        </CardContent>
      </Card>

      {paidHistory.total > 0 ? (
        <Card data-testid="monthly-paid">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">{t("paid.title")}</h2>
            <CardDescription>{t("paid.body")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col">
              {paidHistory.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline gap-x-3 border-b border-border py-2.5 last:border-b-0"
                >
                  <Badge variant="success">{t("paid.badge")}</Badge>
                  <Link
                    href={`/admin/payments/${row.customerId}?month=${row.monthKey}`}
                    className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline"
                  >
                    {row.customerName}
                  </Link>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t("monthLabel", {
                      month: formatter.dateTime(new Date(`${row.periodStart}T00:00:00Z`), {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }),
                    })}
                  </span>
                  <span className="font-semibold tabular-nums">{fmt.amount(row.amountCents)}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/admin/payments/history"
              className="inline-flex items-center gap-1 self-start text-base link"
              data-testid="payment-history-link"
            >
              {t("paid.all", { count: paidHistory.total })}
              <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/payments">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
