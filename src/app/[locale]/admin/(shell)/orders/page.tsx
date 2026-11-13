import { CalendarOffIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LateOrdersNotice } from "@/components/admin/late-orders-notice";
import { OrderFilters } from "@/components/admin/order-filters";
import { OrderTotals } from "@/components/admin/order-totals";
import { OrdersTable } from "@/components/admin/orders-table";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderOverviewQuery } from "@/server/order-queries";
import { type DateTotalsView, OVERVIEW_LIMIT, todayIn } from "@/server/orders";
import { getDefaultDeliveryDate, getFactoryTimezone } from "@/server/settings";

const DAY_MS = 86_400_000;

/**
 * The date of the totals closest to the shown range (both sides): the "there is data elsewhere"
 * hint of the empty state. Derived from the totals the page already fetched — no extra query.
 *
 * `overview.totals` only covers the selected range (`getDateTotals` filters on `from`/`to`), so it
 * can name a date only when the range itself contains confirmed orders (e.g. a status/source
 * filter hides every row of a range that does have confirmed orders). When the range is empty as a
 * whole, no fetched data knows about other days — then `widenRange` offers the one-click jump to
 * the week around the range instead of guessing a date.
 */
function nearestTotalsDay(totals: DateTotalsView[], from: string): DateTotalsView | null {
  const base = parseCalendarDate(from)?.getTime();
  if (base === undefined) return null;
  let best: DateTotalsView | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const day of totals) {
    const time = parseCalendarDate(day.date)?.getTime();
    if (time === undefined) continue;
    const distance = Math.abs(time - base);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = day;
    }
  }
  return best;
}

/**
 * Monday–Sunday of the week around `day` — the same range the "Diese Woche" quick pick sets (see
 * `order-filters.tsx`); the jump of the empty state reuses that preset's URL parameters.
 */
function widenRange(day: string): { from: string; to: string } {
  const date = parseCalendarDate(day) ?? new Date();
  const offset = (date.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(date.getTime() - offset * DAY_MS);
  return {
    from: formatCalendarDate(start),
    to: formatCalendarDate(new Date(start.getTime() + 6 * DAY_MS)),
  };
}

/** Order overview (NUD-032): filters (default = next delivery date), totals per date, rows. */
async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const [overview, defaultDate, timezone, formatter] = await Promise.all([
    orderOverviewQuery(await searchParams),
    getDefaultDeliveryDate(),
    getFactoryTimezone(),
    getFormatter(),
  ]);
  const fmt = createAppFormatters(formatter);
  const today = formatCalendarDate(todayIn(timezone));

  const singleDay = overview.filters.from === overview.filters.to;
  const from = parseCalendarDate(overview.filters.from);
  const to = parseCalendarDate(overview.filters.to);
  const rangeText = {
    from: from ? fmt.calendarDate(from) : overview.filters.from,
    to: to ? fmt.calendarDate(to) : overview.filters.to,
    count: overview.rows.length,
  };

  const empty = overview.rows.length === 0;
  const nearest = empty ? nearestTotalsDay(overview.totals, overview.filters.from) : null;
  const nearestLabel = nearest
    ? fmt.calendarDate(parseCalendarDate(nearest.date) ?? new Date(nearest.date))
    : null;
  const showTotals = !empty || overview.totals.length > 0;
  // The range itself carries no confirmed orders, so no fetched total can name a day with data:
  // the jump widens to the week around the range (the "Diese Woche" quick pick) and names that
  // range instead of guessing a date (re-design.md §8.3, "empty default view fix").
  const week = widenRange(overview.filters.from);
  const weekLabel = {
    from: fmt.calendarDate(parseCalendarDate(week.from) ?? new Date()),
    to: fmt.calendarDate(parseCalendarDate(week.to) ?? new Date()),
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={
          singleDay
            ? t("header.range", { date: rangeText.from, count: rangeText.count })
            : t("header.rangeSpan", rangeText)
        }
        actions={
          <Link href="/admin/orders/new" className={buttonVariants()} data-testid="new-order">
            {t("new")}
          </Link>
        }
      >
        <OrderFilters
          filters={overview.filters}
          customers={overview.customers}
          defaultDate={formatCalendarDate(defaultDate)}
          today={today}
        />
      </PageHeader>

      <LateOrdersNotice orders={overview.rows} />

      {overview.truncated ? (
        <p className="text-sm text-destructive" role="status" data-testid="orders-truncated">
          {t("truncated", { count: OVERVIEW_LIMIT })}
        </p>
      ) : null}

      {/* The sums are one bar above the list, as wide as the list: one column for the whole page
          (review 2026-11-13: a rail next to the table made the page look restless). */}
      <div className="flex flex-col gap-3">
        {showTotals ? <OrderTotals totals={overview.totals} orders={overview.rows} /> : null}

        <div className="min-w-0">
          {empty ? (
            <EmptyState
              icon={CalendarOffIcon}
              title={
                singleDay
                  ? t("empty.rangeTitle", { date: rangeText.from })
                  : t("empty.rangeTitleSpan", { from: rangeText.from, to: rangeText.to })
              }
              description={
                nearest && nearestLabel
                  ? t("empty.lastKnown", { date: nearestLabel, count: nearest.orderCount })
                  : t("empty.hintWeek", weekLabel)
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {nearest && nearestLabel ? (
                    <>
                      <Link
                        href={{
                          pathname: "/admin/orders",
                          query: { from: nearest.date, to: nearest.date },
                        }}
                        className={buttonVariants({ variant: "outline" })}
                        data-testid="empty-goto-day"
                      >
                        {t("empty.goto", { date: nearestLabel })}
                      </Link>
                      <Link
                        href="/admin/orders/new"
                        className={buttonVariants({ variant: "ghost" })}
                        data-testid="empty-new-order"
                      >
                        {t("new")}
                      </Link>
                    </>
                  ) : (
                    <>
                      {/* Only the range itself is known to be empty, so the jump widens it to the
                          week around it (the "Diese Woche" quick pick) and says so on the button. */}
                      <Link
                        href={{
                          pathname: "/admin/orders",
                          query: week,
                        }}
                        className={buttonVariants({ variant: "outline" })}
                        data-testid="empty-widen-week"
                      >
                        {t("empty.widen")}
                      </Link>
                      <Link
                        href="/admin/orders/new"
                        className={buttonVariants()}
                        data-testid="empty-new-order"
                      >
                        {t("new")}
                      </Link>
                    </>
                  )}
                </div>
              }
            />
          ) : (
            <OrdersTable orders={overview.rows} multiDay={!singleDay} today={today} />
          )}
        </div>
      </div>
    </div>
  );
}

export default async function Page({ params, searchParams }: PageProps<"/[locale]/admin/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
