"use client";

import { CheckCircle2Icon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Stagger } from "@/components/motion/stagger";
import { SuccessPulse } from "@/components/motion/success-pulse";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { ProgressBar } from "@/components/shared/progress-bar";
import type { Tone } from "@/components/shared/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { type DriverRow, isLate, type TourPhase } from "@/domain/day-overview";
import { parseCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { type AppFormatters, createAppFormatters } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DayOverviewView } from "@/server/day-overview";

/** The phase chip: yolk for the drivers who are out now, green only for a finished tour. */
const PHASE_TONES: Record<TourPhase, Tone> = {
  planning: "neutral",
  waiting: "neutral",
  onRoad: "primary",
  done: "success",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The office overview of today (redesign RD2, step 3), built for two or three drivers out at once:
 * the day's figures in one strip, every reported problem as a red row above everything else, and
 * one lane per driver with his progress, a bead per stop, the next stop and whether he is on time.
 * Re-reads the server data every `pollIntervalMs` while a tour is still open.
 *
 * There is no live GPS: "where" is the stop that was ticked off last (see `domain/day-overview`).
 */
export function DayBoard({
  overview,
  nextDay,
  lateOrderCount,
  pollIntervalMs,
  aside,
}: {
  overview: DayOverviewView;
  /** Confirmed orders and open drafts of the next delivery day. */
  nextDay: { date: string; confirmed: number; drafts: number };
  /** Confirmed orders for today that are in no tour (NUD-099). */
  lateOrderCount: number;
  pollIntervalMs: number;
  /** Shown beside the lanes from `xl` (the map of the drivers' last stops). */
  aside?: ReactNode;
}) {
  const t = useTranslations("admin.dashboard");
  const tc = useTranslations("common");
  const fmt = createAppFormatters(useFormatter(), overview.timezone);
  const { rows, totals, problems } = overview;
  const tourHref = (tourId?: string) =>
    `/admin/tours?date=${overview.date}${tourId ? `&tour=${tourId}` : ""}`;
  const live = rows.length === 0 || rows.some((row) => row.phase !== "done");

  return (
    <section
      className="flex flex-col gap-4"
      aria-label={t("today.title")}
      data-testid="today-card"
      data-tours={rows.length}
    >
      <LiveRefresh intervalMs={pollIntervalMs} enabled={live} />

      <dl
        aria-label={t("board.kpiTitle")}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs lg:grid-cols-5"
      >
        <Figure
          testId="kpi-stops"
          className="col-span-2 lg:col-span-1"
          label={t("board.stops")}
          value={
            totals.total > 0
              ? t("board.stopsValue", { done: totals.done, total: totals.total })
              : "—"
          }
          sub={
            totals.total > 0 ? (
              <ProgressBar
                delivered={totals.delivered}
                problems={totals.problems}
                total={totals.total}
                label={t("today.progressLabel")}
                valueText={t("today.progress", { done: totals.done, total: totals.total })}
              />
            ) : (
              t("board.stopsNone")
            )
          }
        />
        <Figure
          testId="kpi-drivers"
          label={t("board.drivers")}
          value={t("board.driversValue", { onRoad: totals.onRoad, tours: totals.tours })}
          sub={t("board.driversSub", { tours: totals.tours })}
        />
        <Figure
          testId="kpi-problems"
          label={t("board.problems")}
          tone={totals.problems > 0 ? "destructive" : undefined}
          value={
            <span className="inline-flex items-center gap-2">
              {totals.problems > 0 ? <TriangleAlertIcon className="size-5" aria-hidden /> : null}
              {totals.problems}
            </span>
          }
          sub={totals.problems > 0 ? t("board.problemsSome") : t("board.problemsNone")}
        />
        <Figure
          testId="kpi-back"
          label={t("board.back")}
          value={
            totals.lastFinishAt
              ? t("board.backValue", { time: fmt.time(totals.lastFinishAt) })
              : "—"
          }
          sub={totals.lastFinishAt ? t("board.backSub") : t("board.backNone")}
        />
        <Figure
          testId="kpi-next-day"
          className="relative transition-colors duration-150 ease-out hover:bg-muted"
          label={t("tiles.nextDay")}
          value={
            // The whole cell opens the orders of that day (the link stretches over it).
            <Link
              href={`/admin/orders?from=${nextDay.date}&to=${nextDay.date}`}
              aria-label={t("tiles.nextDayValue", { count: nextDay.confirmed })}
              className="outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            >
              {nextDay.confirmed}
            </Link>
          }
          sub={t("tiles.nextDaySub", {
            date: fmt.calendarDate(parseCalendarDate(nextDay.date) ?? new Date(nextDay.date)),
            drafts: nextDay.drafts,
          })}
        />
      </dl>

      {problems.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label={t("today.problemsHeading")}>
          {problems.map((problem) => (
            <li
              key={problem.stopId}
              data-testid="day-problem"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-destructive-soft-foreground"
            >
              <TriangleAlertIcon className="size-5 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 text-base">
                <strong className="font-semibold">
                  {problem.reason
                    ? tc(`problemReasons.${problem.reason}`)
                    : t("attention.reasonUnknown")}
                </strong>{" "}
                {t("board.problemAt", { name: problem.name })}
                {problem.driverName ? ` · ${problem.driverName}` : ""}
                {problem.at ? ` · ${t("board.reported", { time: fmt.time(problem.at) })}` : ""}
              </p>
              <Link
                href={tourHref(problem.tourId)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("board.view")}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {lateOrderCount > 0 ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-base text-warning-soft-foreground"
          role="status"
          data-testid="today-late-orders"
        >
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{t("today.lateOrders", { count: lateOrderCount })}</p>
        </div>
      ) : null}

      <h2 className="-mb-1 text-lg font-semibold tracking-tight">{t("board.lanesTitle")}</h2>
      <div
        className={cn(
          "grid items-start gap-4",
          aside ? "xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]" : null,
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {rows.length === 0 ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-xs"
              data-testid="today-no-tour"
            >
              <p className="text-base">{t("today.noTour")}</p>
              <Link
                href={tourHref()}
                data-testid="today-link"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("today.openPlanning")}
              </Link>
            </div>
          ) : (
            <Stagger as="ul" className="flex flex-col gap-3">
              {rows.map((row) => (
                <Lane key={row.tourId} row={row} href={tourHref(row.tourId)} fmt={fmt} />
              ))}
            </Stagger>
          )}
        </div>
        {aside}
      </div>
    </section>
  );
}

/** One figure of the strip: a label, one number and a line below it. */
function Figure({
  testId,
  label,
  value,
  sub,
  tone,
  className,
}: {
  testId: string;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: "destructive";
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1 bg-card p-4",
        tone === "destructive" && "bg-destructive-soft text-destructive-soft-foreground",
        className,
      )}
    >
      <dt className={cn("text-sm", tone ? null : "text-muted-foreground")}>{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className={cn("text-sm", tone ? null : "text-muted-foreground")}>{sub}</dd>
    </div>
  );
}

/** One driver: who, in what, how far, where it went wrong, where he goes next and when he is done. */
function Lane({
  row,
  href,
  fmt,
  className,
  style,
}: {
  row: DriverRow;
  href: string;
  fmt: AppFormatters;
  /** Set by `<Stagger>`. */
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useTranslations("admin.dashboard");
  const tc = useTranslations("common");
  const { progress } = row;
  const handed = row.phase !== "planning";
  const late = isLate(row.delayMinutes);
  const name = row.driverName ?? t("board.noDriver");

  return (
    <li
      data-testid="driver-lane"
      data-tour-id={row.tourId}
      data-phase={row.phase}
      data-status={row.status}
      style={style}
      className={cn(
        // The whole lane opens the tour (the link below stretches over it); 0.99 on press.
        "relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs transition-[transform,border-color] duration-[140ms] ease-out hover:border-input has-[a:active]:scale-[.99]",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
        >
          {row.driverName ? initials(row.driverName) : row.number}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-base font-semibold">
            <Link
              href={href}
              aria-label={`${name}, ${t("board.openTour", { number: row.number })}`}
              className="rounded-xl outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
            >
              {name}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {[t("board.tourNumber", { number: row.number }), row.vehicleName]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {/* A phone has no room for name, state and count in one line: there the state moves below,
            so the driver's name is never cut. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-sm:order-last max-sm:w-full max-sm:justify-start">
          {progress.problems > 0 ? (
            <span data-testid="lane-problems">
              <StatusBadge tone="destructive" icon={TriangleAlertIcon}>
                {t("board.problemChip", { count: progress.problems })}
              </StatusBadge>
            </span>
          ) : null}
          <span data-testid="lane-status">
            <StatusBadge tone={PHASE_TONES[row.phase]}>
              {/* A finished tour reads the same as on the tour page. */}
              {row.phase === "done" ? tc("statuses.tour.COMPLETED") : t(`board.phase.${row.phase}`)}
            </StatusBadge>
          </span>
        </div>
        <div className="flex flex-col items-end">
          <SuccessPulse count={progress.delivered} className="rounded-md">
            <span
              className="text-2xl font-semibold tabular-nums"
              data-testid="lane-progress"
              aria-label={t("today.progress", { done: progress.done, total: progress.total })}
            >
              {t("board.progress", { done: progress.done, total: progress.total })}
            </span>
          </SuccessPulse>
          <span className="text-sm text-muted-foreground" data-testid="lane-finish">
            {!handed
              ? t("board.notHanded")
              : row.finishAt
                ? t("board.finish", { time: fmt.time(row.finishAt) })
                : progress.pending === 0 && progress.total > 0
                  ? t("board.finished")
                  : ""}
          </span>
        </div>
      </div>

      {progress.total > 0 ? (
        <ol
          role="img"
          aria-label={t("today.countsBreakdown", {
            delivered: progress.delivered,
            problems: progress.problems,
            open: progress.pending,
          })}
          className="flex flex-wrap items-center gap-1.5"
          data-testid="lane-beads"
        >
          {row.beads.map((bead) => (
            <li
              key={bead.id}
              data-testid="lane-bead"
              data-status={bead.status}
              data-next={bead.next ? "" : undefined}
              className={cn(
                "size-3 rounded-full transition-colors duration-200 ease-out",
                bead.status === "DELIVERED" && "bg-success",
                // A second cue besides the colour: a problem is a square.
                bead.status === "PROBLEM" && "rounded-[3px] bg-destructive",
                bead.status === "PENDING" &&
                  (bead.next && handed
                    ? "bg-primary ring-[1.5px] ring-foreground"
                    : "border border-input"),
              )}
            />
          ))}
        </ol>
      ) : null}

      {handed && progress.total > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {row.nextStop ? (
            <p className="min-w-0">
              <span className="text-muted-foreground">{t("today.next")}: </span>
              <span className="font-medium" data-testid="lane-next-name">
                {row.nextStop.name}
              </span>
              {row.nextStop.etaAt ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {t("today.eta", { time: fmt.time(row.nextStop.etaAt) })}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 font-medium" data-testid="lane-all-done">
              <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
              {t("today.allDone")}
            </p>
          )}
          {row.nextStop && row.delayMinutes !== null ? (
            <p
              data-testid="lane-delay"
              data-late={late ? "" : undefined}
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                late ? "text-warning" : "text-muted-foreground",
              )}
            >
              <ClockIcon className="size-4 shrink-0" aria-hidden />
              {late ? t("board.late", { minutes: row.delayMinutes }) : t("board.onTime")}
            </p>
          ) : null}
          <p className="text-muted-foreground" data-testid="lane-last">
            {row.lastStop
              ? t("board.last", { name: row.lastStop.name, time: fmt.time(row.lastStop.at) })
              : t("board.lastNone")}
          </p>
        </div>
      ) : null}
    </li>
  );
}
