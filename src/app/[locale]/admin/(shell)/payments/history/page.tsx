import { HistoryIcon, SearchXIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import type { CSSProperties } from "react";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { PaymentHistoryFilters } from "@/components/admin/payment-history-filters";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { paidHistoryQueryString, parsePaidHistoryParams } from "@/lib/payment-history-params";
import { cn } from "@/lib/utils";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { paidHistoryQuery } from "@/server/payment-history";
import { getFactoryTimezone } from "@/server/settings";

/**
 * Paid history (NUD-199): every month the office marked as paid, newest note first, with who
 * marked it and the note. Filter by customer and year; count and sum of the hits stand above the
 * list. The amount is the snapshot of the day it was marked (D33), so it can differ from what the
 * month page calculates today.
 */
async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.payments" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const formatter = await getFormatter({ locale });
  const fmt = createAppFormatters(formatter, await getFactoryTimezone());
  const params = parsePaidHistoryParams(await searchParams);
  const result = await paidHistoryQuery(getDb(), {
    q: params.q,
    year: params.year ?? undefined,
    page: params.page,
  });
  const filters = { q: params.q, year: params.year };
  const filtered = params.q.trim() !== "" || params.year !== null;
  const pageHref = (page: number) => ({
    pathname: "/admin/payments/history" as const,
    query: paidHistoryQueryString({ ...filters, page }),
  });
  const monthLabel = (periodStart: string) =>
    formatter.dateTime(new Date(`${periodStart}T00:00:00Z`), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("history.title")}
        description={t("history.description")}
        titleTestId="payment-history-title"
        breadcrumb={
          <Link
            href="/admin/payments"
            className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("backToPayments")}
          </Link>
        }
      >
        <PaymentHistoryFilters values={filters} years={result.years} />
      </PageHeader>

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchXIcon}
            title={t("history.emptyFilteredTitle")}
            description={t("history.emptyFilteredBody")}
            action={
              <Link
                href="/admin/payments/history"
                className={buttonVariants({ variant: "outline" })}
                data-testid="history-empty-reset"
              >
                {t("history.reset")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={HistoryIcon}
            title={t("history.emptyTitle")}
            description={t("history.emptyBody")}
          />
        )
      ) : (
        <>
          <p className="text-base tabular-nums" aria-live="polite" data-testid="history-summary">
            <span className="font-medium">{t("history.count", { count: result.total })}</span>
            <span className="text-muted-foreground">
              {" · "}
              {t("history.sum", { amount: fmt.amount(result.sumCents) })}
            </span>
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("history.columns.paidAt")}</TableHead>
                  <TableHead>{t("columns.customer")}</TableHead>
                  <TableHead>{t("columns.month")}</TableHead>
                  <TableHead className="text-right">{t("columns.orders")}</TableHead>
                  <TableHead className="text-right">{t("columns.amount")}</TableHead>
                  <TableHead>{t("history.columns.paidBy")}</TableHead>
                  <TableHead>{t("history.columns.note")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    className="row-enter"
                    style={{ "--row-index": index } as CSSProperties}
                    data-testid={`history-row-${row.id}`}
                  >
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmt.dayOfMoment(new Date(row.paidAt))}
                      <span className="block text-sm text-muted-foreground">
                        {fmt.time(new Date(row.paidAt))}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-56">
                      <Link
                        href={`/admin/payments/${row.customerId}?month=${row.monthKey}`}
                        className="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("history.openBill", {
                          customer: row.customerName,
                          month: monthLabel(row.periodStart),
                        })}
                      >
                        {row.customerName}
                      </Link>
                      <span className="block text-sm text-muted-foreground">
                        {row.customerNumber}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {monthLabel(row.periodStart)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatter.number(row.orderCount, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                      {fmt.amount(row.amountCents)}
                    </TableCell>
                    <TableCell>{row.paidByName ?? "—"}</TableCell>
                    <TableCell className="max-w-56 text-sm wrap-break-word text-muted-foreground">
                      {row.note ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result.pageCount > 1 ? (
            <nav
              aria-label={t("history.pagination.label")}
              className="flex items-center justify-between gap-3"
              data-testid="history-pagination"
            >
              <PageLink
                disabled={result.page <= 1}
                href={pageHref(result.page - 1)}
                testId="history-prev"
              >
                {tc("actions.back")}
              </PageLink>
              <span className="text-base tabular-nums">
                {t("history.pagination.status", {
                  page: result.page,
                  pageCount: result.pageCount,
                })}
              </span>
              <PageLink
                disabled={result.page >= result.pageCount}
                href={pageHref(result.page + 1)}
                testId="history-next"
              >
                {tc("actions.next")}
              </PageLink>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  testId,
  children,
}: {
  href: { pathname: "/admin/payments/history"; query: Record<string, string> };
  disabled: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  const className = buttonVariants({ variant: "outline" });
  return disabled ? (
    <span
      className={cn(className, "pointer-events-none opacity-50")}
      aria-disabled="true"
      data-testid={testId}
    >
      {children}
    </span>
  ) : (
    <Link href={href} className={className} data-testid={testId}>
      {children}
    </Link>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/payments/history">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" rows={8} />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
