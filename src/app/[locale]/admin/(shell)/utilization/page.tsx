import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatScheduleRuns,
  UTILIZATION_PERIODS,
  type UtilizationPeriod,
} from "@/domain/work-time";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { getFactoryTimezone } from "@/server/settings";
import {
  type DriverUtilization,
  factoryToday,
  parsePeriod,
  parseReportDay,
  type PeriodTotals,
  readUtilization,
  shiftDay,
  type TourUtilization,
} from "@/server/utilization";

const REPORT_PATH = "/admin/utilization";

/** One weekday name in the current language; Monday is ISO weekday 1. */
function weekdayName(locale: string, weekday: number): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 4 + weekday)),
  );
}

const hrefFor = (period: UtilizationPeriod, date: string) =>
  `${REPORT_PATH}?period=${period}&date=${date}`;

/** "240 Min." — the unit comes from the message file, the number from the data. */
type Value = (value: number) => string;

/** Utilization percentage of one period, `—` when the driver has no contracted hours. */
function PercentCell({ totals, percent }: { totals: PeriodTotals; percent: Value }) {
  if (totals.percent === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "tabular-nums",
        totals.percent > 100 && "font-semibold text-warning-soft-foreground",
      )}
    >
      {percent(totals.percent)}
    </span>
  );
}

async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Defence in depth behind the proxy and the admin layout.
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.utilization" });
  const format = await getFormatter({ locale });
  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const timezone = await getFactoryTimezone();
  const today = factoryToday(new Date(), timezone);
  const day = parseReportDay(single(params.date), today);
  const period = parsePeriod(single(params.period));
  const report = await readUtilization(getDb(), { date: day, period });
  const fmt = createAppFormatters(format, timezone);
  const minutes: Value = (value) => t("minutes", { minutes: value });
  const percent: Value = (value) => t("percentValue", { percent: value });
  const totalPercent =
    report.totals.contractMinutes > 0
      ? Math.round((report.totals.actualMinutes / report.totals.contractMinutes) * 100)
      : null;
  const from = fmt.calendarDate(new Date(`${report.from}T00:00:00Z`));
  const to = fmt.calendarDate(new Date(`${report.to}T00:00:00Z`));
  const rangeLabel = report.from === report.to ? from : `${from} – ${to}`;
  const periodLabel = t(`periods.${period}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        // NUD-187 (QA 2026-10-29 F22): the page explains Ist/Soll well but never said WHERE working
        // hours are maintained, so every row read "Keine Arbeitszeit hinterlegt" and nobody found
        // the place. The path is named here and linked in the table's empty state below.
        description={
          <>
            {t("description")}{" "}
            <Link
              href="/admin/drivers"
              className="link"
              data-testid="utilization-schedule-hint"
            >
              {t("scheduleHint")}
            </Link>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={hrefFor(period, shiftDay(report.from, -1))}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={t("previous")}
              data-testid="utilization-previous"
            >
              <ArrowLeftIcon aria-hidden />
            </Link>
            <span
              className="min-w-44 text-center text-base font-medium"
              data-testid="utilization-range"
            >
              {rangeLabel}
            </span>
            <Link
              href={hrefFor(period, shiftDay(report.to, 1))}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={t("next")}
              data-testid="utilization-next"
            >
              <ArrowRightIcon aria-hidden />
            </Link>
          </div>
        }
      />

      <nav
        aria-label={t("periodsLabel")}
        className="flex flex-wrap gap-2"
        data-testid="utilization-periods"
      >
        {UTILIZATION_PERIODS.map((entry) => (
          <Link
            key={entry}
            href={hrefFor(entry, day)}
            aria-current={entry === period ? "page" : undefined}
            // The shown period is a selection, not the next action: pale yolk, never the yolk fill.
            className={cn(
              buttonVariants({ variant: entry === period ? "secondary" : "outline" }),
              "min-w-24",
            )}
            data-testid={`utilization-period-${entry}`}
          >
            {t(`periods.${entry}`)}
          </Link>
        ))}
      </nav>

      {/* One strip with hairlines, like the figures of the overview. */}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs sm:grid-cols-3">
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-sm text-muted-foreground">{t("actual")}</dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="utilization-actual">
            {minutes(report.totals.actualMinutes)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-sm text-muted-foreground">{t("contract")}</dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="utilization-contract">
            {minutes(report.totals.contractMinutes)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-sm text-muted-foreground">{t("percent")}</dt>
          <dd className="text-2xl font-semibold tabular-nums" data-testid="utilization-percent">
            {totalPercent === null ? "—" : percent(totalPercent)}
          </dd>
        </div>
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>{t("driversTitle", { period: periodLabel })}</CardTitle>
          <p className="max-w-prose text-base text-muted-foreground">{t("driversHint")}</p>
        </CardHeader>
        <CardContent>
          {report.drivers.length === 0 ? (
            <EmptyState title={t("emptyTitle")} description={t("empty")} />
          ) : (
            <Table data-testid="utilization-drivers" containerClassName="overscroll-x-contain">
              <TableHeader data-sticky>
                <TableRow>
                  <TableHead>{t("columns.driver")}</TableHead>
                  <TableHead>{t("columns.schedule")}</TableHead>
                  <TableHead>{t("columns.day")}</TableHead>
                  <TableHead>{t("columns.week")}</TableHead>
                  <TableHead>{t("columns.month")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.drivers.map((driver) => (
                  <TableRow
                    key={driver.driverId}
                    data-testid={`utilization-row-${driver.driverId}`}
                  >
                    <TableCell className="py-1.5 font-medium">
                      <span className="flex items-center gap-2">
                        {driver.displayName}
                        {driver.active ? null : (
                          <Badge variant="secondary" size="sm">
                            {t("inactive")}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 text-sm text-muted-foreground">
                      {driver.hasSchedule
                        ? formatScheduleRuns(driver.schedule, (weekday) =>
                            weekdayName(locale, weekday),
                          )
                        : t("noSchedule")}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <PercentCell totals={driver.day} percent={percent} />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <PercentCell totals={driver.week} percent={percent} />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <PercentCell totals={driver.month} percent={percent} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("toursTitle", { period: periodLabel })}</CardTitle>
          <p className="max-w-prose text-base text-muted-foreground">{t("toursHint")}</p>
        </CardHeader>
        <CardContent>
          <TourTable
            tours={report.drivers.flatMap((driver) =>
              driver.tours.map((tour) => ({ tour, driver })),
            )}
            minutes={minutes}
            percent={percent}
            fmt={fmt}
            labels={{
              empty: t("toursEmpty"),
              emptyTitle: t("toursEmptyTitle"),
              date: t("columns.date"),
              driver: t("columns.driver"),
              planned: t("columns.planned"),
              actual: t("columns.actual"),
              deviation: t("columns.deviation"),
              percent: t("columns.percent"),
              start: t("columns.start"),
              checklist: t("start.checklist"),
              assumed: t("start.assumed"),
              reasons: {
                no_start: t("reasons.noStart"),
                no_stops: t("reasons.noStops"),
                not_completed: t("reasons.notCompleted"),
                invalid_window: t("reasons.invalidWindow"),
                crosses_midnight: t("reasons.crossesMidnight"),
              },
            }}
          />
        </CardContent>
      </Card>

      {report.withoutSchedule > 0 ? (
        <p className="text-base text-muted-foreground" data-testid="utilization-missing-schedule">
          {t("missingSchedule", { count: report.withoutSchedule })}{" "}
          {/* NUD-187: the way out of the wall of dashes, right where it is read. */}
          <Link
            href="/admin/drivers"
            className="link"
            data-testid="utilization-missing-schedule-link"
          >
            {t("scheduleHint")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

type TourReason = Exclude<TourUtilization["reason"], null>;

type Labels = {
  empty: string;
  emptyTitle: string;
  date: string;
  driver: string;
  planned: string;
  actual: string;
  deviation: string;
  percent: string;
  start: string;
  checklist: string;
  assumed: string;
  reasons: Record<TourReason, string>;
};

/** Cell of the tour table: on phones the column name is printed above the value. */
const CELL =
  "py-1.5 max-md:p-0 max-md:before:block max-md:before:text-xs max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]";

/** Per-tour table: actual vs planned, or why a tour could not be measured (NUD-152). */
function TourTable({
  tours,
  labels,
  minutes,
  percent,
  fmt,
}: {
  tours: Array<{ tour: TourUtilization; driver: DriverUtilization }>;
  labels: Labels;
  minutes: Value;
  percent: Value;
  fmt: ReturnType<typeof createAppFormatters>;
}) {
  if (tours.length === 0) {
    return <EmptyState title={labels.emptyTitle} description={labels.empty} />;
  }
  const signed = (value: number | null) => {
    if (value === null) return "—";
    return `${value > 0 ? "+" : ""}${minutes(value)}`;
  };
  return (
    // Below `md` each tour is a two-column block with the column name above each value (review
    // 2026-10-31: seven columns at 390 px were cut off at the card edge).
    <Table data-testid="utilization-tours" containerClassName="overscroll-x-contain">
      <TableHeader data-sticky className="max-md:hidden">
        <TableRow>
          <TableHead>{labels.date}</TableHead>
          <TableHead>{labels.driver}</TableHead>
          <TableHead>{labels.planned}</TableHead>
          <TableHead>{labels.actual}</TableHead>
          <TableHead>{labels.deviation}</TableHead>
          <TableHead>{labels.percent}</TableHead>
          <TableHead>{labels.start}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tours.map(({ tour, driver }) => (
          <TableRow
            key={tour.tourId}
            data-testid={`utilization-tour-${tour.tourId}`}
            className="max-md:grid max-md:h-auto max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-2 max-md:py-3"
          >
            <TableCell className={cn(CELL, "tabular-nums")} data-label={labels.date}>
              {fmt.calendarDate(new Date(`${tour.date}T00:00:00Z`))}
            </TableCell>
            <TableCell className={CELL} data-label={labels.driver}>
              {driver.displayName}
            </TableCell>
            <TableCell className={cn(CELL, "tabular-nums")} data-label={labels.planned}>
              {signed(tour.plannedMinutes)}
            </TableCell>
            <TableCell className={cn(CELL, "tabular-nums")} data-label={labels.actual}>
              {tour.reason === null ? (
                signed(tour.actualMinutes)
              ) : (
                <span className="text-muted-foreground" title={labels.reasons[tour.reason]}>
                  {labels.reasons[tour.reason]}
                </span>
              )}
            </TableCell>
            <TableCell className={cn(CELL, "tabular-nums")} data-label={labels.deviation}>
              {signed(tour.deltaMinutes)}
            </TableCell>
            <TableCell className={cn(CELL, "tabular-nums")} data-label={labels.percent}>
              {tour.planPercent === null ? "—" : percent(tour.planPercent)}
            </TableCell>
            <TableCell className={cn(CELL, "text-sm max-md:col-span-2")} data-label={labels.start}>
              {tour.startSource === "checklist"
                ? labels.checklist
                : tour.startSource === "assumed"
                  ? labels.assumed
                  : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/utilization">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
