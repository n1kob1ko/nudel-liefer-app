import { ReceiptTextIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { MonthlyBillActions } from "@/components/admin/monthly-bill-actions";
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
import { addMonths, monthKey, monthStart } from "@/domain/payment";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { todayIn } from "@/server/orders";
import { monthlyBillQuery } from "@/server/payments";
import { getFactoryTimezone } from "@/server/settings";

/**
 * One customer's accumulated monthly bill (D33, NUD-196): every monthly order of the month with its
 * amount, the total, and the office's "paid" note. Printable, and the place where the office marks
 * the month as paid. Without `?month=` it opens on the last month.
 */
async function Guarded({
  locale,
  customerId,
  searchParams,
}: {
  locale: string;
  customerId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.payments" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const formatter = await getFormatter({ locale });
  const fmt = createAppFormatters(formatter, await getFactoryTimezone());
  const { month } = await searchParams;
  const today = todayIn(await getFactoryTimezone());
  const requested = Array.isArray(month) ? month[0] : month;
  const fallback = monthKey(addMonths(monthStart(today), -1));
  const bill = await monthlyBillQuery(getDb(), customerId, requested ?? fallback, today);
  if (!bill) notFound();

  const monthLabel = formatter.dateTime(new Date(`${bill.periodStart}T00:00:00Z`), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const productName = (name: unknown) => {
    const parsed = localizedTextSchema.safeParse(name);
    return parsed.success ? pick(parsed.data, locale as AppLocale) : "";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("bill.title", { customer: bill.customer.name })}
        description={t("bill.description", { month: monthLabel })}
        titleTestId="monthly-bill-title"
        breadcrumb={
          <Link
            href="/admin/payments"
            className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("backToPayments")}
          </Link>
        }
      />

      <Card className="max-w-4xl">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">
                {t("bill.totalHeading")}
              </h2>
              <CardDescription>
                {t("bill.customerLine", {
                  number: bill.customer.customerNumber,
                  city: bill.customer.city,
                })}
              </CardDescription>
            </div>
            <p
              className="text-2xl font-semibold tabular-nums"
              data-testid="monthly-bill-total"
            >
              {fmt.amount(bill.totalCents)}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={bill.state === "paid" ? "success" : "warning"}>
              {t(`state.${bill.state}`)}
            </Badge>
            {bill.noAmountCount > 0 ? (
              <Badge variant="warning" data-testid="monthly-bill-no-amount">
                {t("monthly.noAmount", { count: bill.noAmountCount })}
              </Badge>
            ) : null}
            {!bill.closed ? (
              <span className="text-sm text-muted-foreground">{t("bill.currentMonth")}</span>
            ) : null}
          </div>
          {bill.payment ? (
            <p className="text-base" data-testid="monthly-bill-paid">
              {t("bill.paidOn", {
                date: fmt.calendarDate(new Date(bill.payment.paidAt)),
                amount: fmt.amount(bill.payment.amountCents),
              })}
              {bill.payment.paidByName ? ` · ${bill.payment.paidByName}` : ""}
              {bill.payment.note ? (
                <span className="block text-sm text-muted-foreground">{bill.payment.note}</span>
              ) : null}
            </p>
          ) : null}
          <MonthlyBillActions
            customerId={bill.customer.id}
            month={bill.monthKey}
            paid={bill.payment !== null}
          />
        </CardContent>
      </Card>

      <Card className="max-w-4xl">
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">{t("bill.ordersHeading")}</h2>
          <CardDescription>
            {t("bill.ordersCount", { count: bill.orders.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bill.orders.length === 0 ? (
            <EmptyState
              icon={ReceiptTextIcon}
              title={t("bill.emptyTitle")}
              description={t("bill.emptyBody")}
              className="border-0 p-0"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.date")}</TableHead>
                    <TableHead>{t("columns.items")}</TableHead>
                    <TableHead className="text-right">{t("columns.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bill.orders.map((order) => (
                    <TableRow key={order.id} data-testid={`bill-order-${order.id}`}>
                      <TableCell className="tabular-nums">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="underline underline-offset-4"
                        >
                          {fmt.calendarDate(new Date(`${order.date}T00:00:00Z`))}
                        </Link>
                      </TableCell>
                      <TableCell className="text-base">
                        {order.items
                          .map(
                            (item) =>
                              `${fmt.quantity(item.quantity)} ${tc(
                                `units.${item.unit as "KG" | "PACK" | "CRATE" | "PIECE"}`,
                              )} ${productName(item.productName)}`,
                          )
                          .join(", ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {order.amountCents === null ? (
                          <span className="text-warning-soft-foreground">
                            {t("bill.noAmount")}
                          </span>
                        ) : (
                          fmt.amount(order.amountCents)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/payments/[customerId]">) {
  const { locale, customerId } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} customerId={customerId} searchParams={searchParams} />
    </Suspense>
  );
}
