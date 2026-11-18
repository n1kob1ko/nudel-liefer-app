import { addDays, format as formatDate, startOfWeek } from "date-fns";
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  ImageOffIcon,
  MapPinOffIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import type { createFormatter } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { DayBoard } from "@/components/admin/day-board";
import { FleetMap } from "@/components/admin/fleet-map";
import { PageHeader } from "@/components/admin/page-header";
import { WeekOrdersChart, type WeekOrdersDay } from "@/components/admin/week-orders-chart";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { type AppFormatters, createAppFormatters } from "@/lib/format";
import { getMapTileConfig } from "@/lib/map-config";
import { tourHistoryQuery } from "@/server/audit-queries";
import { requirePageActor } from "@/server/auth/page-guards";
import { listCustomersQuery } from "@/server/customer-queries";
import { dayOverviewQuery } from "@/server/day-overview";
import { getDb } from "@/server/db";
import { orderOverviewQuery } from "@/server/order-queries";
import { todayIn } from "@/server/orders";
import { getDefaultDeliveryDate, getFactoryTimezone, getSettings } from "@/server/settings";
import { standingDayQuery } from "@/server/standing-tours";
import {
  getLivePollIntervalMs,
  type TodayProgress,
  todayProgressQuery,
} from "@/server/tour-progress";

/**
 * Dashboard "Übersicht" (redesign RD2, step 3): today at a glance for an office with two or three
 * drivers out at once. `DayBoard` shows the day's figures, every reported problem and one lane per
 * driver (`dayOverviewQuery`); below it the week's confirmed orders, what is still to do in the
 * master data and the latest changes.
 *
 * Besides the overview the page reuses existing read queries unchanged and reads them for their
 * counts only: `orderOverviewQuery` (drafts of the next delivery day, the week's totals),
 * `listCustomersQuery` (customers without photos or Parkplatz) and `todayProgressQuery` (orders
 * that came after the tours were finished, the tour whose history is shown).
 */
async function Dashboard({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale });
  const formatter = await getFormatter({ locale });
  const fmt = createAppFormatters(formatter, await getFactoryTimezone());
  const nextDeliveryDate = await getDefaultDeliveryDate();
  const nextDeliveryDay = formatCalendarDate(nextDeliveryDate);
  const [today, overview, settings] = await Promise.all([
    todayProgressQuery(),
    dayOverviewQuery(),
    getSettings(),
  ]);
  const week = weekOf(today.date);
  const [missingPhotos, parkingMissing, drafts, weekOrders, todayPlan] = await Promise.all([
    listCustomersQuery({ status: "active", photosMissing: true, pageSize: 1 }),
    listCustomersQuery({ status: "active", parkingMissing: true, pageSize: 1 }),
    orderOverviewQuery({
      from: nextDeliveryDay,
      to: nextDeliveryDay,
      status: "DRAFT",
    }),
    orderOverviewQuery({ from: week[0], to: week[week.length - 1] }),
    // NUD-212: routes of today whose orders the drivers do not have yet.
    standingDayQuery(getDb(), today.date, todayIn(await getFactoryTimezone())),
  ]);
  // The five latest changes of all of today's tours, newest first (ISO times sort as text).
  const activity = (await Promise.all(overview.rows.map((row) => tourHistoryQuery(row.tourId))))
    .flat()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 5);
  const attention = {
    missingPhotos: missingPhotos.total,
    parkingMissing: parkingMissing.total,
    drafts: { count: drafts.rows.length, date: nextDeliveryDay },
    unsent: {
      date: today.date,
      routes: todayPlan.routes
        .filter((route) => route.state === "changed" || route.state === "ready")
        .map((route) => route.name),
    },
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
        description={fmt.dateLong(new Date(`${overview.date}T12:00:00Z`))}
        titleTestId="admin-title"
        actions={
          // The one yolk button of this page: taking an order is what the office does most.
          <Link
            href="/admin/orders/new"
            className={buttonVariants()}
            data-testid="dashboard-new-order"
          >
            <PlusIcon aria-hidden />
            {t("admin.orders.new")}
          </Link>
        }
      />
      <DayBoard
        overview={overview}
        nextDay={nextDay}
        lateOrderCount={today.lateOrderCount}
        pollIntervalMs={getLivePollIntervalMs()}
        aside={
          // Only once a tour was handed to a driver: a plan has no "where".
          overview.rows.some((row) => row.phase !== "planning") ? (
            <FleetMap
              rows={overview.rows}
              timezone={overview.timezone}
              depot={
                settings
                  ? { lat: settings.depotLat, lng: settings.depotLng, label: settings.depotName }
                  : null
              }
              tiles={getMapTileConfig()}
            />
          ) : undefined
        }
      />
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2" data-testid="week-card">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("admin.dashboard.week.title")}
            </h2>
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
 * "Zu erledigen": drafts of the next delivery day, late orders and gaps in the master data, all
 * from existing read queries. Reported problems are not repeated here: they are the red rows at
 * the top of the page.
 */
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
    unsent: { date: string; routes: string[] };
  };
  fmt: AppFormatters;
  t: Translate;
}) {
  const late = today.lateOrderCount;
  const tourHref = `/admin/planning?date=${today.date}`;
  const { missingPhotos, parkingMissing, drafts } = attention;
  const { unsent } = attention;
  const empty =
    late === 0 &&
    missingPhotos === 0 &&
    parkingMissing === 0 &&
    drafts.count === 0 &&
    unsent.routes.length === 0;

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
            {unsent.routes.length > 0 ? (
              <AttentionItem
                testId="attention-unsent-routes"
                icon={SendIcon}
                href={`/admin/planning?date=${unsent.date}`}
                label={t("admin.dashboard.attention.unsentRoutes", {
                  count: unsent.routes.length,
                })}
                hint={unsent.routes.join(", ")}
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
  icon: typeof ClipboardListIcon;
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
