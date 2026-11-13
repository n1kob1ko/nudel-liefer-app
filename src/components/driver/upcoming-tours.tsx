"use client";

import { CalendarDaysIcon, ChevronDownIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { CSSProperties } from "react";

import { STAGGER_MAX } from "@/components/motion/stagger";
import { StopNumberBadge } from "@/components/shared/stop-number-badge";
import { createAppFormatters } from "@/lib/format";
import { isPieceUnit } from "@/lib/units";
import type { UpcomingTour } from "@/server/driver-upcoming";

import { driverTime } from "./driver-time";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

/**
 * The driver's tours of the coming days (NUD-205), below today's tour or the "no tour today" card.
 * A preview: when, how many stops, where and how much. Nothing can be ticked off here; on the day
 * the tour is the home screen. Each tour is a native `<details>`, closed at first, so the list
 * costs one row per day and works without script.
 */
export function UpcomingTours({ tours, timezone }: { tours: UpcomingTour[]; timezone: string }) {
  const t = useTranslations("driver");
  const format = useFormatter();
  const fmt = createAppFormatters(format, timezone);
  const fmtTime = driverTime(format, timezone);
  if (tours.length === 0) return null;
  // `Tour.date` is a calendar day stored at UTC midnight: format it in UTC, not in the factory zone.
  const dayLabel = (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    });
  return (
    <section
      aria-labelledby="upcoming-title"
      className="mt-3 flex flex-col gap-1.5"
      data-testid="upcoming-tours"
    >
      <h2 id="upcoming-title" className="px-1 text-lg font-semibold">
        {t("upcoming.title")}
      </h2>
      {tours.map((tour) => (
        <details
          key={tour.id}
          className="group rounded-xl border border-border bg-card shadow-sm"
          data-testid="upcoming-tour"
          data-date={tour.date}
        >
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2 outline-none transition-[background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[.99] active:bg-muted motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <CalendarDaysIcon className="size-6 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[17px] leading-tight font-semibold" data-testid="upcoming-day">
                {tour.daysAhead === 1
                  ? t("upcoming.tomorrow", { date: dayLabel(tour.date) })
                  : dayLabel(tour.date)}
              </span>
              <span
                className="text-base text-muted-foreground tabular-nums"
                data-testid="upcoming-summary"
              >
                {t("upcoming.stops", { count: tour.stops.length })}
                {tour.firstEtaAt
                  ? ` · ${t("upcoming.from", { time: fmtTime(new Date(tour.firstEtaAt)) })}`
                  : null}
              </span>
            </span>
            <ChevronDownIcon
              className="size-6 shrink-0 transition-transform duration-200 ease-in-out group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <ol className="list-none border-t border-border px-2" data-testid="upcoming-stops">
            {tour.stops.map((stop, index) => (
              <li
                key={stop.id}
                className="stagger-item flex min-h-16 items-start gap-2 border-b border-border px-1 py-3 last:border-b-0"
                style={{ "--i": Math.min(index, STAGGER_MAX - 1) } as CSSProperties}
                data-testid="upcoming-stop"
              >
                <StopNumberBadge
                  number={stop.sequence}
                  tone="neutral"
                  size={40}
                  label={t("today.stopLabel", { number: stop.sequence })}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[17px] leading-tight font-semibold wrap-anywhere">
                    {stop.customerName}
                  </span>
                  <span className="text-base text-muted-foreground">
                    {stop.street}, {stop.postalCode} {stop.city}
                  </span>
                  {stop.items.length > 0 ? (
                    <span className="text-base tabular-nums" data-testid="upcoming-items">
                      {stop.items
                        .map((item) =>
                          isPieceUnit(item.unit)
                            ? `${fmt.quantity(item.quantity)} × ${item.name}`
                            : `${fmt.quantity(item.quantity)} ${t(`units.${item.unit as UnitKey}`, { count: item.quantity })} ${item.name}`,
                        )
                        .join(" · ")}
                    </span>
                  ) : null}
                </span>
                {stop.etaAt ? (
                  <span className="shrink-0 pt-0.5 text-base tabular-nums">
                    {fmtTime(new Date(stop.etaAt))}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  );
}
