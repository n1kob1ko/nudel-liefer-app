import { addDays, format as formatDate, startOfWeek } from "date-fns";
import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  ImageOffIcon,
  MapPinOffIcon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { createFormatter } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { TodayCard } from "@/components/admin/today-card";
import { TourGauge } from "@/components/admin/tour-gauge";
import { WeekOrdersChart, type WeekOrdersDay } from "@/components/admin/week-orders-chart";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { tourTone } from "@/components/shared/status";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { showsStopResults } from "@/domain/tour-progress";
import { Link } from "@/i18n/navigation";
import { type AppFormatters, createAppFormatters } from "@/lib/format";
import { tourHistoryQuery } from "@/server/audit-queries";
import { requirePageActor } from "@/server/auth/page-guards";
import { listCustomersQuery } from "@/server/customer-queries";
import { orderOverviewQuery } from "@/server/order-queries";
import { getDefaultDeliveryDate, getFactoryTimezone } from "@/server/settings";
import {
  getLivePollIntervalMs,
  type TodayProgress,
  todayProgressQuery,
} from "@/server/tour-progress";

/**
 * Dashboard "Übersicht" (re-design.md §8.2): an operations cockpit built from the data this page
 * already reads (`todayProgressQuery`) plus the audit history of today's tour. Stat tiles, today's
 * tour, what needs attention and the latest changes.
 *
 * The "Zu erledigen" groups of §8.2.3 additionally reuse two existing read queries unchanged —
 * `orderOverviewQuery` (drafts of the next delivery day) and `listCustomersQuery` (customers whose
 * photos or Parkplatz are missing) — passed with filter inputs and read for their counts only
 * (`pageSize: 1`). No new aggregate and no new SQL: the same queries the Bestellungen and Kunden
 * pages use.
 *
 * Colour refresh 2026-10: a hero tile, a tile for the next delivery day, the week's confirmed orders
 * per day (`getDateTotals` through `orderOverviewQuery`, read for its `totals` only) and a
 * half-circle gauge of today's tour. Still no new aggregate and no new SQL.
 */
async function Dashboard({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale });
  const formatter = await getFormatter({ locale });
  const fmt = createAppFormatters(formatter, await getFactoryTimezone());
  const nextDeliveryDate = await getDefaultDeliveryDate();
  const nextDeliveryDay = formatCalendarDate(nextDeliveryDate);
  const today = await todayProgressQuery();
  const week = weekOf(today.date);
  const [missingPhotos, parkingMissing, drafts, weekOrders] = await Promise.all([
    listCustomersQuery({ status: "active", photosMissing: true, pageSize: 1 }),
    listCustomersQuery({ status: "active", parkingMissing: true, pageSize: 1 }),
    orderOverviewQuery({
      from: nextDeliveryDay,
      to: nextDeliveryDay,
      status: "DRAFT",
    }),
    orderOverviewQuery({ from: week[0], to: week[week.length - 1] }),
  ]);
  // Newest first, capped to the five shown. Only today's tour: a cross-tour feed has no query yet.
  const activity = today.tour ? (await tourHistoryQuery(today.tour.id)).slice(0, 5) : [];
  const attention = {
    missingPhotos: missingPhotos.total,
    parkingMissing: parkingMissing.total,
    drafts: { count: drafts.rows.length, date: nextDeliveryDay },
  };
  const nextDay = {
    date: nextDeliveryDay,
    // `totals` counts confirmed orders only, whatever the status filter of the listing.
    confirmed: drafts.totals.find((day) => day.date === nextDeliveryDay)?.orderCount ?? 0,
    drafts: drafts.rows.length,
  };
  const weekDays = weekChartDays(week, today.date, weekOrders.totals, formatter, t);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.dashboard.title")}
        description={t("admin.dashboard.description")}
        titleTestId="admin-title"
      />
      <StatTiles today={today} nextDay={nextDay} fmt={fmt} t={t} />
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2" data-testid="week-card">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("admin.dashboard.week.title")}
            </h2>
            <CardDescription>{t("admin.dashboard.week.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <WeekOrdersChart
              days={weekDays}
              labels={{
                past: t("admin.dashboard.week.past"),
                today: t("admin.dashboard.week.today"),
                upcoming: t("admin.dashboard.week.upcoming"),
                table: t("admin.dashboard.week.table"),
                day: t("admin.dashboard.week.day"),
                orders: t("admin.dashboard.week.orders"),
              }}
            />
          </CardContent>
        </Card>
        <GaugePanel today={today} t={t} />
      </div>
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <TodayCard today={today} pollIntervalMs={getLivePollIntervalMs()} />
        </div>
        <AttentionPanel today={today} attention={attention} fmt={fmt} t={t} />
      </div>
      <ActivityPanel entries={activity} fmt={fmt} t={t} />
    </div>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/** Monday to Saturday of the week that contains `date` (`YYYY-MM-DD`), as `YYYY-MM-DD` strings. */
function weekOf(date: string): string[] {
  const monday = startOfWeek(new Date(`${date}T12:00:00Z`), { weekStartsOn: 1 });
  return Array.from({ length: 6 }, (_, index) => formatDate(addDays(monday, index), "yyyy-MM-dd"));
}

/** Chart rows for `WeekOrdersChart`: one per day, confirmed orders from the day totals. */
function weekChartDays(
  week: string[],
  todayDate: string,
  totals: Array<{ date: string; orderCount: number }>,
  formatter: ReturnType<typeof createFormatter>,
  t: Translate,
): WeekOrdersDay[] {
  return week.map((date) => {
    const at = new Date(`${date}T12:00:00Z`);
    const count = totals.find((day) => day.date === date)?.orderCount ?? 0;
    const day = formatter.dateTime(at, {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      timeZone: "UTC",
    });
    return {
      date,
      label: formatter.dateTime(at, { weekday: "short", timeZone: "UTC" }),
      description: t("admin.dashboard.week.bar", { day, count }),
      count,
      when: date < todayDate ? "past" : date === todayDate ? "today" : "upcoming",
    };
  });
}

/**
 * The four KPI tiles (re-design.md §8.2, colour refresh 2026-10): today's progress as the hero tile,
 * problems, the next delivery day and today's tour status. All but the next-day tile link to today's
 * tour.
 */
function StatTiles({
  today,
  nextDay,
  fmt,
  t,
}: {
  today: TodayProgress;
  nextDay: { date: string; confirmed: number; drafts: number };
  fmt: AppFormatters;
  t: Translate;
}) {
  const { tour } = today;
  const tourHref = `/admin/tours?date=${today.date}`;
  const progress = tour?.progress;
  const problems = progress?.problems ?? 0;
  const statusLabel = tour
    ? t(`common.statuses.tour.${tour.status}`)
    : t("admin.dashboard.tiles.noTour");

  return (
    <section
      aria-label={t("admin.dashboard.tiles.title")}
      // Four tiles: 2 × 2 up to 1279 px (incl. the 1024 px tablet width), one row from `xl`. On a
      // phone the hero tile takes the full width and the other three share two columns below it.
      className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
    >
      {/* "erledigt" (delivered + problems) is the numerator of the percentage the card below shows
          as well — "geliefert" used to leave the tile at "2 / 6 (50 %)" while the card said
          "3 von 6 Stopps erledigt (50 %)" (round-3 review). NUD-183: a quotient without a base
          ("0 / 0") is not a number — without a tour (or with a tour of no stops) the tile says so. */}
      <StatTile
        data-testid="stat-delivered"
        variant="hero"
        className="col-span-2 sm:col-span-1"
        label={t("admin.dashboard.tiles.done")}
        value={progress && progress.total > 0 ? `${progress.done} / ${progress.total}` : "—"}
        sub={
          progress && progress.total > 0
            ? t("admin.dashboard.today.percent", { percent: progress.percent })
            : t("admin.dashboard.tiles.noTour")
        }
        icon={CircleCheckIcon}
        href={tourHref}
      />
      <StatTile
        data-testid="stat-problems"
        label={t("admin.dashboard.tiles.problems")}
        value={problems}
        sub={t("admin.dashboard.tiles.problemsSub")}
        icon={problems > 0 ? TriangleAlertIcon : CircleAlertIcon}
        tone={problems > 0 ? "destructive" : "neutral"}
        href={tourHref}
      />
      <StatTile
        data-testid="stat-next-day"
        label={t("admin.dashboard.tiles.nextDay")}
        value={nextDay.confirmed}
        sub={t("admin.dashboard.tiles.nextDaySub", {
          date: fmt.calendarDate(parseCalendarDate(nextDay.date) ?? new Date(nextDay.date)),
          drafts: nextDay.drafts,
        })}
        icon={CalendarDaysIcon}
        tone="primary"
        href={`/admin/orders?from=${nextDay.date}&to=${nextDay.date}`}
      />
      <StatTile
        data-testid="stat-tour"
        className="col-span-2 sm:col-span-1"
        label={t("admin.dashboard.tiles.tour")}
        value={<span className="text-2xl">{statusLabel}</span>}
        sub={tour ? undefined : t("admin.dashboard.tiles.tourSub")}
        icon={RouteIcon}
        tone={tour ? tourTone(tour.status) : "neutral"}
        href={tourHref}
      />
    </section>
  );
}

/** Half-circle progress of today's tour; before the release there is nothing to show yet. */
function GaugePanel({ today, t }: { today: TodayProgress; t: Translate }) {
  const progress = today.tour && showsStopResults(today.tour.status) ? today.tour.progress : null;
  return (
    <Card className="h-full" data-testid="gauge-card">
      <CardHeader>
        <h2 className="text-lg font-semibold tracking-tight">{t("admin.dashboard.gauge.title")}</h2>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center">
        {progress && progress.total > 0 ? (
          <TourGauge
            delivered={progress.delivered}
            problems={progress.problems}
            total={progress.total}
            percent={progress.percent}
            labels={{
              summary: t("admin.dashboard.gauge.summary", {
                done: progress.done,
                total: progress.total,
                delivered: progress.delivered,
                problems: progress.problems,
                open: progress.pending,
              }),
              center: t("admin.dashboard.gauge.center", {
                done: progress.done,
                total: progress.total,
              }),
              delivered: t("admin.dashboard.gauge.delivered", { count: progress.delivered }),
              problems: t("admin.dashboard.gauge.problems", { count: progress.problems }),
              open: t("admin.dashboard.gauge.open", { count: progress.pending }),
            }}
          />
        ) : (
          <EmptyState
            icon={RouteIcon}
            title={t("admin.dashboard.tiles.noTour")}
            description={t("admin.dashboard.gauge.empty")}
            className="border-0 p-0"
          />
        )}
      </CardContent>
    </Card>
  );
}

/** "Zu erledigen" — the three groups §8.2.3 asks for, all from existing read queries. */
function AttentionPanel({
  today,
  attention,
  fmt,
  t,
}: {
  today: TodayProgress;
  attention: {
    missingPhotos: number;
    parkingMissing: number;
    drafts: { count: number; date: string };
  };
  fmt: AppFormatters;
  t: Translate;
}) {
  const problems = today.tour?.problemStops ?? [];
  const late = today.lateOrderCount;
  const tourHref = `/admin/tours?date=${today.date}`;
  const { missingPhotos, parkingMissing, drafts } = attention;
  const empty =
    problems.length === 0 &&
    late === 0 &&
    missingPhotos === 0 &&
    parkingMissing === 0 &&
    drafts.count === 0;

  return (
    <Card className="h-full" data-testid="attention-card">
      <CardHeader>
        {/* Card titles are `h2` so the outline never skips a level (re-design.md §9.2). */}
        <h2 className="text-lg font-semibold tracking-tight">
          {t("admin.dashboard.attention.title")}
        </h2>
      </CardHeader>
      <CardContent>
        {empty ? (
          <EmptyState
            icon={CheckCircle2Icon}
            title={t("admin.dashboard.attention.emptyTitle")}
            description={t("admin.dashboard.attention.emptyDescriptionAll")}
            className="border-0 p-0"
          />
        ) : (
          <ul className="flex flex-col">
            {problems.map((problem) => (
              <li
                key={problem.id}
                data-testid="attention-problem"
                className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={tourHref}
                    className="truncate rounded-sm font-medium outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {problem.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {problem.reason
                      ? t(`common.problemReasons.${problem.reason}`)
                      : t("admin.dashboard.attention.reasonUnknown")}
                  </span>
                </div>
              </li>
            ))}
            {drafts.count > 0 ? (
              <AttentionItem
                testId="attention-draft-orders"
                icon={ClipboardListIcon}
                href={{
                  pathname: "/admin/orders" as const,
                  query: { from: drafts.date, to: drafts.date, status: "DRAFT" },
                }}
                label={t("admin.dashboard.attention.unconfirmedOrders", { count: drafts.count })}
                hint={t("admin.dashboard.attention.unconfirmedOrdersHint", {
                  date: fmt.calendarDate(parseCalendarDate(drafts.date) ?? new Date(drafts.date)),
                })}
              />
            ) : null}
            {late > 0 ? (
              <AttentionItem
                testId="attention-late-orders"
                icon={ClipboardListIcon}
                href={tourHref}
                label={t("admin.dashboard.attention.lateOrders", { count: late })}
                hint={t("admin.dashboard.attention.lateOrdersHint")}
              />
            ) : null}
            {missingPhotos > 0 ? (
              <AttentionItem
                testId="attention-missing-photos"
                icon={ImageOffIcon}
                href={{
                  pathname: "/admin/customers" as const,
                  query: { photos: "missing" },
                }}
                label={t("admin.dashboard.attention.missingPhotos", { count: missingPhotos })}
                hint={t("admin.dashboard.attention.missingPhotosHint")}
              />
            ) : null}
            {parkingMissing > 0 ? (
              <AttentionItem
                testId="attention-parking-missing"
                icon={MapPinOffIcon}
                href="/admin/customers/parking"
                label={t("admin.dashboard.attention.parkingMissing", { count: parkingMissing })}
                hint={t("admin.dashboard.attention.parkingMissingHint")}
              />
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** One "Zu erledigen" row: an icon, a linked count and a one-line explanation. */
function AttentionItem({
  testId,
  icon: Icon,
  href,
  label,
  hint,
}: {
  testId: string;
  icon: typeof TriangleAlertIcon;
  href: React.ComponentProps<typeof Link>["href"];
  label: string;
  hint: string;
}) {
  return (
    <li
      data-testid={testId}
      className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex min-w-0 flex-col">
        <Link
          href={href}
          className="rounded-sm font-medium outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </Link>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
    </li>
  );
}

/** Last five audit entries of today's tour, timeline-style compact list (re-design.md §8.2/§8.4). */
function ActivityPanel({
  entries,
  fmt,
  t,
}: {
  entries: Array<{ id: string; at: string; action: string; actor: { name: string } | null }>;
  fmt: AppFormatters;
  t: Translate;
}) {
  return (
    <Card data-testid="activity-card">
      <CardHeader>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("admin.dashboard.activity.title")}
        </h2>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-base text-muted-foreground">{t("admin.dashboard.activity.empty")}</p>
        ) : (
          <ol className="flex flex-col">
            {entries.map((entry) => (
              <li
                key={entry.id}
                data-testid="activity-entry"
                data-action={entry.action}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-border py-2.5 last:border-b-0"
              >
                <time
                  dateTime={entry.at}
                  className="w-40 shrink-0 text-sm tabular-nums text-muted-foreground"
                >
                  {fmt.dateTime(new Date(entry.at))}
                </time>
                <span className="min-w-0 flex-1 text-base">
                  {t(`admin.history.actions.${entry.action.replace(".", "_")}`)}
                </span>
                {entry.actor ? (
                  <span className="shrink-0 text-sm text-muted-foreground">{entry.actor.name}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboardPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Dashboard locale={locale} />
    </Suspense>
  );
}
