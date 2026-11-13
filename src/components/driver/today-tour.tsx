"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  ListIcon,
  MapIcon,
  MapPinIcon,
  NavigationIcon,
  PackageIcon,
  PartyPopperIcon,
  PencilLineIcon,
  PlusCircleIcon,
  RefreshCwIcon,
  RouteIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { TourMapLazy } from "@/components/maps/lazy";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ProgressRing } from "@/components/shared/progress-ring";
import { toneDot } from "@/components/shared/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { StopNumberBadge } from "@/components/shared/stop-number-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { showDepartureCard } from "@/domain/departure-checklist";
import {
  isUnseenChange,
  nextPendingStop,
  progressOf,
  reloadBeforeStops,
  remainingSeconds,
  roundedMinutes,
  summarizeItems,
  switchVehicle,
  tourFinishAt,
  tripLoadItems,
} from "@/domain/driver-today";
import { Link, useRouter } from "@/i18n/navigation";
import type { DriverToday, TodayItem, TodayStop } from "@/lib/driver-tour-model";
import { createAppFormatters } from "@/lib/format";
import type { MapTileConfig } from "@/lib/map-config";
import { googleMapsNavigationUrl, stopGoogleNavigationUrl } from "@/lib/navigation";
import { isStopStatusEntry, overlayDeparture } from "@/lib/offline/outbox";
import { useOutbox } from "@/lib/offline/outbox-browser";
import { useOverlaidStops } from "@/lib/offline/use-overlay";
import { isPieceUnit } from "@/lib/units";
import { cn } from "@/lib/utils";

import { AbbreviationChip } from "./customer-abbreviation";
import { KeyChip } from "./customer-key";
import { DepartureCard, DepartureSheet, queueDeparture } from "./departure-checklist";
import { driverTime } from "./driver-time";
import { QuickDeliveredButton } from "./quick-delivered";
import { RefreshOnFocus } from "./refresh-on-focus";
import { ReloadStop } from "./reload-stop";
import { useSeenRevision } from "./seen-revision";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

/**
 * Quantities of a stop, as one wrapped line ("5 × Tomatensauce Kisten · 12,5 × Spaghetti lose kg")
 * with the last chip-style fallback for long lists. re-design.md §7.2.2 asks for a compact,
 * wrapping quantity row; the redesign review of run 3 asked for *one* line instead of two stacked
 * chips, because two chips pushed the first stop row out of the 375 px first viewport.
 *
 * `data-testid` `item-summary` / `summary-kinds` / `summary-total` (with `data-unit`) are kept for
 * the e2e specs and `layoutAudit` checks the >= 28 px bold quantity inside `summary-total strong`,
 * so the `<strong>` stays `text-3xl`.
 */
function ItemSummary({ items }: { items: TodayItem[] }) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter());
  const { kinds, totals } = summarizeItems(items);
  const compact = items.length > 4;
  const separator = (
    <span aria-hidden className="text-muted-foreground">
      ·
    </span>
  );
  return (
    <p
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base leading-tight"
      data-testid="item-summary"
    >
      {compact ? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <PackageIcon className="size-5 shrink-0 self-center" aria-hidden />
            <span className="font-medium" data-testid="summary-kinds">
              {t("today.kinds", { count: kinds })}
            </span>
          </span>
          {totals.map((total) => (
            <span
              key={total.unit}
              className="inline-flex min-w-0 items-baseline gap-1.5 whitespace-nowrap"
              data-testid="summary-total"
              data-unit={total.unit}
            >
              {separator}
              <strong className="font-sans text-3xl font-bold tabular-nums">
                {fmt.quantity(total.quantity)}
              </strong>{" "}
              <span>{t(`unitsTotal.${total.unit as UnitKey}`)}</span>
            </span>
          ))}
        </>
      ) : (
        items.map((item, index) => {
          const quantity = item.quantity;
          return (
            // The separator belongs to the *following* item, so a wrapped line never ends with a
            // dangling "·".
            <span
              key={item.productId}
              className="inline-flex min-w-0 items-baseline gap-1.5"
              data-testid="summary-total"
              data-unit={item.unit}
            >
              {index > 0 ? separator : null}
              <strong className="font-sans text-3xl font-bold tabular-nums">
                {fmt.quantity(quantity)}
              </strong>
              <span aria-hidden>×</span>
              <span className="min-w-0 font-medium">{item.name}</span>
              {isPieceUnit(item.unit) ? null : (
                <span className="shrink-0 text-muted-foreground">
                  {t(`units.${item.unit as UnitKey}`, { count: quantity })}
                </span>
              )}
            </span>
          );
        })
      )}
      {compact ? null : (
        // "1 Sorte" stays for screen readers and for the specs, without taking vertical space.
        <span className="sr-only" aria-hidden data-testid="summary-kinds">
          {t("today.kinds", { count: kinds })}
        </span>
      )}
    </p>
  );
}

/**
 * The compact right-hand summary of a *list row* (re-design.md §7.2.4, design review point 1): one
 * short line per unit — "12,5 kg" over "5 Kiste" — at 16 px (the driver floor; §7.2 says 15 px),
 * muted and tabular, so mixed units are never added together and the narrow column never needs a
 * long "12,5 kg · 5 Kiste" line. Display-size numerals stay in the hero card and the stop detail: a
 * 30 px `<strong>` here was what covered the status badge.
 *
 * `summary-total` / `data-unit` stay on the single values (`driver-today.spec` reads them per row),
 * but deliberately without a `<strong>`: the layout audit's "quantities >= 28 px bold" rule targets
 * the hero and stop-detail quantities, not this row.
 */
function RowSummary({ items }: { items: TodayItem[] }) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter());
  const { totals } = summarizeItems(items);
  return (
    <span
      className="flex flex-col items-end font-sans text-base tabular-nums text-muted-foreground"
      data-testid="item-summary"
    >
      {totals.map((total) => {
        const quantity = total.quantity;
        return (
          <span
            key={total.unit}
            className="whitespace-nowrap"
            data-testid="summary-total"
            data-unit={total.unit}
          >
            {/* Same ICU plural form as the hero chip: "5 Kisten", not "5 Kiste" (run 3 review). */}
            {fmt.quantity(quantity)} {t(`unitsTotal.${total.unit as UnitKey}`)}
          </span>
        );
      })}
    </span>
  );
}

/** Status once per row: badge colour *plus* text or icon, never colour alone. */
function StatusLabel({ status }: { status: TodayStop["status"] }) {
  const t = useTranslations("driver.today");
  const Icon = status === "DELIVERED" ? CheckIcon : status === "PROBLEM" ? AlertTriangleIcon : null;
  const tone = status === "DELIVERED" ? "success" : status === "PROBLEM" ? "warning" : "neutral";
  const label =
    status === "DELIVERED"
      ? t("statusDelivered")
      : status === "PROBLEM"
        ? t("statusProblem")
        : t("statusPending");
  return (
    <span data-testid="stop-status" data-status={status}>
      <StatusBadge tone={tone} icon={Icon ?? undefined} size="md" className="text-base">
        {label}
      </StatusBadge>
    </span>
  );
}

/** Marker + changed quantities of a stop the driver has not seen in its new state yet. */
function ChangeHighlight({ stop }: { stop: TodayStop }) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter());
  const added = stop.change === "ADDED";
  const changedItems = stop.items.filter(
    (i) => i.previousQuantity !== null && i.previousQuantity !== i.quantity,
  );
  return (
    <div
      className="rounded-lg bg-warning-soft p-3 text-warning-soft-foreground"
      data-testid="stop-change"
      data-change={stop.change}
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        {added ? (
          <PlusCircleIcon className="size-5 shrink-0" aria-hidden />
        ) : (
          <PencilLineIcon className="size-5 shrink-0" aria-hidden />
        )}
        {added ? t("today.changeAdded") : t("today.changeChanged")}
      </p>
      {!added && changedItems.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {changedItems.map((item) => (
            <li key={item.productId} data-testid="change-item">
              <span className="block text-base">{item.name}</span>
              <span className="text-2xl font-bold tabular-nums">
                <span className="text-muted-foreground line-through decoration-2">
                  {fmt.quantity(item.previousQuantity ?? 0)}
                </span>{" "}
                <span aria-hidden>→</span> {fmt.quantity(item.quantity)}{" "}
                {isPieceUnit(item.unit) ? null : (
                  <span className="text-base font-medium">
                    {t(`units.${item.unit as UnitKey}`, { count: item.quantity })}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Note of the next customer, in an amber strip *inside* the hero card, before the buttons. */
function NoteStrip({ text }: { text: string }) {
  const t = useTranslations("driver.today");
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || text;
  return (
    <p
      className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-base leading-tight font-medium text-warning-soft-foreground"
      data-testid="next-stop-note"
    >
      <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="sr-only">{t("noteLabel")}: </span>
        {firstLine}
      </span>
    </p>
  );
}

function NextStopCard({
  stop,
  stops,
  timezone,
  unseen,
}: {
  stop: TodayStop;
  stops: readonly TodayStop[];
  timezone: string;
  unseen: boolean;
}) {
  const t = useTranslations("driver.today");
  const fmtTime = driverTime(useFormatter(), timezone);
  return (
    <section
      className="relative flex flex-col gap-2 rounded-xl border border-border border-s-4 border-s-primary bg-primary-soft p-3 text-primary-soft-foreground shadow-sm"
      aria-labelledby="next-stop-heading"
      data-testid="next-stop"
      data-stop-id={stop.id}
    >
      {/* The whole card opens the stop detail (NUD-143) without nesting interactive elements in an
          <a>: the icon-only chevron link stretches over the card (::after, inset-0), and the
          separate controls (key chip, "Navigation starten") sit above it with `relative z-10`.
          `active:scale-none`: the button press-scale would make the link the containing block of
          the overlay and shrink it to 48 px while pressed, so the tap would never complete. */}
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-base">
          <span id="next-stop-heading" className="font-bold">
            {t("nextStop")}
          </span>
          {stop.etaAt ? (
            <span className="font-medium text-muted-foreground">
              {t("eta", { time: fmtTime(new Date(stop.etaAt)) })}
            </span>
          ) : null}
        </p>
        <Link
          href={`/driver/stops/${stop.id}`}
          data-testid="details"
          aria-label={t("details")}
          className={buttonVariants({
            size: "icon-lg",
            variant: "outline",
            className:
              "shrink-0 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring active:scale-none",
          })}
        >
          <ChevronRightIcon className="size-6 rtl:rotate-180" aria-hidden />
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <StopNumberBadge
          number={stop.sequence}
          tone="primary"
          size={48}
          isNext
          label={t("stopLabel", { number: stop.sequence })}
          data-testid="stop-number"
        />
        <p
          className="line-clamp-2 min-w-0 flex-1 text-2xl leading-tight font-bold text-balance text-foreground"
          data-testid="next-stop-name"
        >
          {stop.customerName}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <p
          className="flex min-w-0 flex-1 items-start gap-1.5 text-base"
          data-testid="next-stop-address"
        >
          <MapPinIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {stop.street}, {stop.postalCode} {stop.city}
          </span>
        </p>
        <KeyChip stop={stop} interactive className="relative z-10 shrink-0 bg-background" />
      </div>
      {stop.abbreviation !== undefined ? (
        <div>
          <AbbreviationChip stop={stop} interactive className="relative z-10 bg-background" />
        </div>
      ) : null}
      <ItemSummary items={stop.items} />
      {stop.noteText ? <NoteStrip text={stop.noteText} /> : null}
      {unseen ? <ChangeHighlight stop={stop} /> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
        {stopGoogleNavigationUrl(stop) ? (
          <a
            href={stopGoogleNavigationUrl(stop)!}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="navigate"
            className={buttonVariants({
              size: "xl",
              variant: "primary",
              className: "relative z-10 min-h-14 min-w-0 text-center",
            })}
          >
            <NavigationIcon className="size-6 shrink-0" aria-hidden />
            {/* Two words next to the "Geliefert" button on a 375 px phone: wrap, do not squeeze. */}
            <span className="whitespace-normal leading-tight">{t("navigate")}</span>
          </a>
        ) : (
          <p
            className="flex items-center gap-2 self-center text-base"
            data-testid="no-pin"
          >
            <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
            {t("noPin")}
          </p>
        )}
        {/* One tap from the card (NUD-195): drivers who know the way do not open the stop screen. */}
        <QuickDeliveredButton stop={stop} stops={stops} className="relative z-10" />
      </div>
    </section>
  );
}

/**
 * One stop row (re-design.md §7.2.4): >= 76 px, hairline separator instead of a card, the whole row a
 * link. Left `StopNumberBadge` 40, middle name (17 semibold, one line) over address (16 muted, one
 * line) with the status badge beneath, right a reserved 108 px column with the ETA over the compact
 * per-unit summary. The fixed right column is what gives the name its ~20 visible characters and
 * keeps the summary off the status badge (design review point 1).
 *
 * In the map sheet the same row is a *button*: there the row must focus the stop on the map instead
 * of leaving the map view (`onFocus`), which is the list <-> map entry point of re-design.md §7.2(5).
 */
function StopRow({
  stop,
  timezone,
  isNext,
  unseen,
  waiting,
  selected = false,
  onFocus,
}: {
  stop: TodayStop;
  timezone: string;
  isNext: boolean;
  unseen: boolean;
  waiting: boolean;
  /** Highlighted in the map sheet because its marker is selected. */
  selected?: boolean;
  /** Set by the map sheet: the row focuses the stop on the map instead of opening the stop page. */
  onFocus?: (id: string) => void;
}) {
  const t = useTranslations("driver.today");
  const tCommon = useTranslations("common");
  const fmtTime = driverTime(useFormatter(), timezone);
  const problem = stop.status === "PROBLEM";
  const reason = problem
    ? t("problemReason", {
        reason: stop.problemReason
          ? tCommon(`problemReasons.${stop.problemReason}`)
          : t("statusProblem"),
      })
    : null;
  const rowClass =
    "flex min-h-[76px] w-full items-center gap-2 px-1 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted";
  // NUD-180 (QA 2026-10-29 F17): a closed row names the time it was actually done, not the planned
  // arrival — the office already showed "Erledigt um 11:49" while the driver saw "06:30".
  const rowTime = stop.status === "PENDING" ? stop.etaAt : (stop.completedAt ?? stop.etaAt);
  const content = (
    <>
      <StopNumberBadge
        number={stop.sequence}
        tone={
          isNext
            ? "primary"
            : problem
              ? "warning"
              : stop.status === "DELIVERED"
                ? "success"
                : "neutral"
        }
        size={40}
        isNext={isNext}
        done={stop.status === "DELIVERED"}
        label={t("stopLabel", { number: stop.sequence })}
        className="relative z-10 shrink-0"
      />
      <span className={"flex min-w-0 flex-1 flex-col gap-0.5"}>
        <span className="flex items-center gap-1.5">
          <span
            className="min-w-0 truncate text-[17px] leading-tight font-semibold"
            data-testid="stop-row-name"
          >
            {stop.customerName}
          </span>
          {waiting ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-base text-warning-soft-foreground">
              <ClockIcon className="size-4" aria-hidden />
              {t("waiting")}
            </span>
          ) : null}
        </span>
        {reason ? (
          <span className="flex items-center gap-1.5 text-base font-medium text-warning-soft-foreground">
            <span className={cn("size-2.5 shrink-0 rounded-full", toneDot.warning)} aria-hidden />
            <span className="truncate">{reason}</span>
          </span>
        ) : (
          <span className="truncate text-base text-muted-foreground">
            {stop.street}, {stop.postalCode} {stop.city}
          </span>
        )}
        {/* NUD-177 (QA 2026-10-29 F5): the note the driver wrote, at least one line of it. */}
        {stop.problemNote ? (
          <span className="truncate text-sm text-muted-foreground" data-testid="stop-row-note">
            {stop.problemNote.text}
          </span>
        ) : null}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusLabel status={stop.status} />
          <KeyChip stop={stop} />
          <AbbreviationChip stop={stop} />
        </span>
      </span>
      {/* Reserved right column (80 px): the summary stacks inside it, so it can never spill onto
          the status badge or squeeze the customer name below ~20 visible characters. */}
      <span className="flex w-20 shrink-0 flex-col items-end gap-0.5 overflow-hidden">
        {rowTime ? (
          <span className="font-sans text-base tabular-nums" data-testid="stop-row-time">
            {fmtTime(new Date(rowTime))}
          </span>
        ) : null}
        <RowSummary items={stop.items} />
      </span>
    </>
  );
  return (
    <li
      className={cn(
        "border-b border-border last:border-b-0",
        isNext && "bg-primary-soft text-primary-soft-foreground",
        selected && "bg-muted",
      )}
      data-testid="stop-row"
      data-stop-id={stop.id}
      data-status={stop.status}
      data-selected={selected ? "true" : undefined}
    >
      {onFocus ? (
        <button type="button" onClick={() => onFocus(stop.id)} className={rowClass}>
          {content}
          <span className="sr-only">{t("focusOnMap")}</span>
        </button>
      ) : (
        <Link href={`/driver/stops/${stop.id}`} className={rowClass}>
          {content}
        </Link>
      )}
      {unseen ? (
        <div className="px-1 pb-3">
          <ChangeHighlight stop={stop} />
        </div>
      ) : null}
    </li>
  );
}

/** Collapsible group at the end of the list ("Erledigt (3)" / "Probleme (1)"); state per tour. */
function DoneGroup({
  stops,
  open,
  onToggle,
  label,
  testId,
  children,
}: {
  stops: TodayStop[];
  open: boolean;
  onToggle: (open: boolean) => void;
  label?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("driver.today");
  return (
    <li className="border-b border-border">
      <details
        open={open || stops.length === 0}
        onToggle={(event) => onToggle(event.currentTarget.open)}
        data-testid={testId ?? "done-group"}
      >
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-1 py-2 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <ChevronRightIcon
            className={cn(
              "size-5 shrink-0 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          {label ?? t("doneGroup", { count: stops.length })}
        </summary>
        <ol className="list-none">{children}</ol>
      </details>
    </li>
  );
}

/**
 * A second (or third) *open* tour of the day (NUD-163): with two open tours for the driver the home
 * screen showed only the newest one and the pending stops of the other were unreachable. The active
 * tour keeps the whole screen (progress, next stop, map); every other open tour gets this block with
 * its own open/done stops, oldest tour first. Rows are the normal 76 px `StopRow` links to the stop
 * detail, which resolves stops of any tour of the day — online and from the offline copy alike.
 */
function OtherTourSection({ tour }: { tour: DriverToday }) {
  const t = useTranslations("driver.today");
  const stops = useOverlaidStops(tour.stops);
  const { entries } = useOutbox();
  const waitingIds = new Set(
    entries.filter((entry) => isStopStatusEntry(entry.type)).map((entry) => entry.stopId),
  );
  const open = stops.filter((s) => s.status === "PENDING");
  // NUD-180 (QA 2026-10-29 F17): a stop with a reported problem is not a delivery - it gets its own
  // group instead of sitting under "Erledigt".
  const delivered = stops.filter((s) => s.status === "DELIVERED");
  const problemsList = stops.filter((s) => s.status === "PROBLEM");
  const [doneOpen, setDoneOpen] = useState(false);
  const headingId = `other-tour-${tour.tourId}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2 shadow-sm"
      data-testid="other-tour"
      data-tour-id={tour.tourId}
      data-tour-number={tour.tourNumber ?? 1}
    >
      <h2
        id={headingId}
        className="flex min-h-12 items-center gap-2 px-1 text-lg font-semibold"
        data-testid="other-tour-title"
      >
        <RouteIcon className="size-5 shrink-0" aria-hidden />
        {t("tourBadge", { number: tour.tourNumber ?? 1, count: tour.tourCount ?? 1 })}
      </h2>
      <p className="px-1 text-base text-muted-foreground" data-testid="other-tour-hint">
        {t("otherTourHint")}
      </p>
      <p className="px-1 text-base font-semibold">{t("openGroup", { count: open.length })}</p>
      <ol className="list-none" data-testid="other-tour-stops">
        {open.length === 0 ? (
          <li className="border-b border-border px-1 py-4 text-base text-muted-foreground">
            {t("allDoneTitle")}
          </li>
        ) : null}
        {open.map((stop) => (
          <StopRow
            key={stop.id}
            stop={stop}
            timezone={tour.timezone}
            isNext={false}
            unseen={false}
            waiting={waitingIds.has(stop.id)}
          />
        ))}
        {delivered.length > 0 ? (
          <DoneGroup stops={delivered} open={doneOpen} onToggle={setDoneOpen}>
            {delivered.map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                timezone={tour.timezone}
                isNext={false}
                unseen={false}
                waiting={waitingIds.has(stop.id)}
              />
            ))}
          </DoneGroup>
        ) : null}
        {problemsList.length > 0 ? (
          <DoneGroup
            stops={problemsList}
            open={doneOpen}
            onToggle={setDoneOpen}
            label={t("problemGroup", { count: problemsList.length })}
            testId="problem-group"
          >
            {problemsList.map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                timezone={tour.timezone}
                isNext={false}
                unseen={false}
                waiting={waitingIds.has(stop.id)}
              />
            ))}
          </DoneGroup>
        ) : null}
      </ol>
    </section>
  );
}

function formatDuration(
  t: ReturnType<typeof useTranslations<"driver.today">>,
  minutes: number,
): string {
  return minutes >= 60
    ? t("durationHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t("durationMinutes", { minutes });
}

/**
 * The amber part of the progress ring (run 3 review, point 6): the ring is drawn for all handled
 * stops, so without this overlay a tour whose handled stops include problems would show a solid
 * green ring while the bar below shows green *and* amber. Geometry mirrors `ProgressRing`
 * (stroke = 10 % of the size, radius = (size − stroke) / 2) and the whole arc is rotated like the
 * ring, so both start at 12 o'clock.
 */
function ProblemArc({
  delivered,
  problems,
  total,
  size,
}: {
  delivered: number;
  problems: number;
  total: number;
  size: number;
}) {
  if (total <= 0 || problems <= 0) return null;
  const stroke = Math.max(4, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const amber = (problems / total) * circumference;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="pointer-events-none absolute inset-0 -rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={`${amber} ${circumference - amber}`}
        strokeDashoffset={-(delivered / total) * circumference}
        className="stroke-warning"
      />
    </svg>
  );
}

/** The driver's tour for today: progress, next stop, list / map, updated-tour notice. */
export function TodayTour({
  today,
  tiles,
  offline = false,
  others = [],
}: {
  today: DriverToday;
  tiles: MapTileConfig;
  /** Rendered from the offline copy (NUD-081): nothing here asks the server. */
  offline?: boolean;
  /**
   * The other open tours of the day, oldest first (NUD-163): listed as extra blocks so the driver
   * reaches the pending stops of every open tour, not just of the active one.
   */
  others?: DriverToday[];
}) {
  const t = useTranslations("driver.today");
  const tHome = useTranslations("driver.home");
  const tDeparture = useTranslations("driver.departure");
  const stops = useOverlaidStops(today.stops);
  const { entries } = useOutbox();
  // Only taps that change a stop show "waiting" on its row; tour-level departure taps do not.
  const waitingIds = new Set(
    entries.filter((entry) => isStopStatusEntry(entry.type)).map((entry) => entry.stopId),
  );
  // Departure checklist (NUD-151): optional, before the first stop.
  const [checklistTrip, setChecklistTrip] = useState<number | null>(null);
  const [left, setLeft] = useState(false);
  const [departBusy, setDepartBusy] = useState(false);
  const departure = overlayDeparture(
    { loadingStartedAt: today.loadingStartedAt ?? null, departedAt: today.departedAt ?? null },
    entries,
    new Set(today.stops.map((s) => s.id)),
  );
  const [view, setView] = useState<"list" | "map">("list");
  const [listOpen, setListOpen] = useState(false);
  const router = useRouter();
  // List <-> map linkage (re-design.md §7.2(5)): the marker of the row tapped in the sheet (and the
  // marker tapped on the map) is highlighted, so the driver can find the stop he picked.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seen, markSeen] = useSeenRevision(today.tourId, today.revision, today.updated);
  const [doneOpen, setDoneOpen] = useState(() => {
    try {
      return window.sessionStorage.getItem(`nudel.driver.doneGroup.${today.tourId}`) !== "closed";
    } catch {
      return true;
    }
  });

  const fmtTime = driverTime(useFormatter(), today.timezone);
  const next = nextPendingStop(stops);
  const { done, total } = progressOf(stops);
  const remaining = roundedMinutes(remainingSeconds(stops, today.serviceSecondsPerStop));
  const reloadBefore = reloadBeforeStops(stops);
  const open = stops.filter((s) => s.status === "PENDING");
  // NUD-180 (QA 2026-10-29 F17): a stop with a reported problem is not a delivery - it gets its own
  // group instead of sitting under "Erledigt".
  const delivered = stops.filter((s) => s.status === "DELIVERED");
  const problemsList = stops.filter((s) => s.status === "PROBLEM");
  const problems = stops.filter((s) => s.status === "PROBLEM").length;
  const showBanner = today.updated && seen < today.revision;
  const departureCard =
    today.departedAt !== undefined &&
    !left &&
    showDepartureCard({
      tourStatus: today.tourStatus,
      departedAt: departure.departedAt,
      stopStatuses: stops.map((s) => s.status),
    });

  const openChecklist = (trip: number) => {
    // Opening the first checklist starts "loading"; a later trip only shows its lines.
    if (trip === 1 && departure.loadingStartedAt === null) void queueDeparture("loading", stops);
    setChecklistTrip(trip);
  };
  const skipChecklist = async () => {
    setDepartBusy(true);
    if (await queueDeparture("depart", stops)) setLeft(true);
    else toast.error(tDeparture("storageError"));
    setDepartBusy(false);
  };
  const unseen = (stop: TodayStop) => showBanner && isUnseenChange(stop, seen);
  // NUD-172 (QA 2026-10-29 F3): one basis for every time on this screen — the stored ETAs, which
  // the server re-anchors on departure and after every completed stop. The end of the tour is the
  // arrival at the last open stop plus the service time there (see `tourFinishAt`).
  const lastEta = [...open].reverse().find((s) => s.etaAt)?.etaAt ?? null;
  const endAt = tourFinishAt(lastEta, today.serviceSecondsPerStop);
  const totalSeconds = stops.reduce(
    (sum, s) =>
      sum + (s.status === "PENDING" ? (s.legDurationS ?? 0) + today.serviceSecondsPerStop : 0),
    0,
  );
  const elapsed = roundedMinutes(totalSeconds);

  const toggleDone = (isOpen: boolean) => {
    setDoneOpen(isOpen);
    try {
      window.sessionStorage.setItem(
        `nudel.driver.doneGroup.${today.tourId}`,
        isOpen ? "open" : "closed",
      );
    } catch {
      // no storage: the group simply starts open again on the next visit
    }
  };

  /**
   * The grouped stop list. Rendered in the list view and — only while the bottom sheet is expanded —
   * in the map view (re-design.md §7.2.5); in map mode it must not be in the DOM while peeking, so the
   * list toggle of the map sheet is what mounts it. `onFocus` (map sheet only) turns every row into a
   * control that highlights the stop's marker instead of leaving the map view.
   */
  const stopList = (onFocus?: (id: string) => void) => (
    <section aria-labelledby="stops-heading" className="flex flex-col gap-0.5">
      <h2 id="stops-heading" className="px-1 text-lg font-semibold">
        {t("openGroup", { count: open.length })}
      </h2>
      <ol className="list-none" data-testid="stop-list">
        {open.length === 0 ? (
          <li className="border-b border-border px-1 py-4 text-base text-muted-foreground">
            {t("allDoneTitle")}
          </li>
        ) : null}
        {open.map((stop) => (
          <Fragment key={stop.id}>
            {reloadBefore.has(stop.id) ? (
              <ReloadStop
                trip={reloadBefore.get(stop.id)!}
                items={tripLoadItems(stops, reloadBefore.get(stop.id)!)}
                switchTo={switchVehicle(stops, reloadBefore.get(stop.id)!)}
                onChecklist={
                  today.departedAt === undefined
                    ? undefined
                    : () => openChecklist(reloadBefore.get(stop.id)!)
                }
              />
            ) : null}
            <StopRow
              stop={stop}
              timezone={today.timezone}
              isNext={stop.id === next?.id}
              unseen={unseen(stop)}
              waiting={waitingIds.has(stop.id)}
              selected={selectedId === stop.id}
              onFocus={onFocus}
            />
          </Fragment>
        ))}
        {delivered.length > 0 ? (
          <DoneGroup stops={delivered} open={doneOpen} onToggle={toggleDone}>
            {delivered.map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                timezone={today.timezone}
                isNext={false}
                unseen={unseen(stop)}
                waiting={waitingIds.has(stop.id)}
                selected={selectedId === stop.id}
                onFocus={onFocus}
              />
            ))}
          </DoneGroup>
        ) : null}
        {problemsList.length > 0 ? (
          <DoneGroup
            stops={problemsList}
            open={doneOpen}
            onToggle={toggleDone}
            label={t("problemGroup", { count: problemsList.length })}
            testId="problem-group"
          >
            {problemsList.map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                timezone={today.timezone}
                isNext={false}
                unseen={unseen(stop)}
                waiting={waitingIds.has(stop.id)}
                selected={selectedId === stop.id}
                onFocus={onFocus}
              />
            ))}
          </DoneGroup>
        ) : null}
      </ol>
    </section>
  );

  return (
    <div className="flex flex-col gap-1.5" data-testid="today-tour">
      {offline ? null : <RefreshOnFocus />}
      {checklistTrip !== null ? (
        <DepartureSheet
          tourId={today.tourId}
          trip={checklistTrip}
          stops={stops}
          fixedItems={today.checklist ?? []}
          firstTrip={checklistTrip === 1}
          onClose={() => setChecklistTrip(null)}
          onDeparted={() => setLeft(true)}
        />
      ) : null}
      {/* Exactly one h1 per page (QA-03); "Nächster Stopp" and the list heading are h2. */}
      <h1 className="sr-only">{t("pageTitle")}</h1>

      {showBanner ? (
        <div
          role="status"
          className="space-y-3 rounded-xl border border-border bg-warning-soft p-4 text-warning-soft-foreground"
          data-testid="updated-banner"
        >
          <p className="flex items-center gap-2 text-xl font-bold">
            <RefreshCwIcon className="size-6 shrink-0" aria-hidden />
            {t("updatedTitle")}
          </p>
          <p className="text-base">{t("updatedDescription")}</p>
          {today.removedCustomers.length > 0 ? (
            <div data-testid="removed-stops">
              <p className="text-base font-semibold">{t("removedStops")}</p>
              <ul className="list-disc ps-6 text-base">
                {today.removedCustomers.map((customer) => (
                  <li key={customer.customerId}>{customer.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Button
            size="lg"
            className="w-full"
            variant="secondary"
            onClick={markSeen}
            data-testid="updated-ack"
          >
            <CheckIcon className="size-5" aria-hidden />
            {t("updatedConfirm")}
          </Button>
        </div>
      ) : null}

      {/* NUD-118: a driver with a second tour on the same day sees which one this is. */}
      {(today.tourCount ?? 1) > 1 ? (
        <p
          className="flex min-h-12 items-center gap-2 rounded-xl bg-info-soft px-3 text-base font-semibold text-info-soft-foreground"
          data-testid="tour-badge"
          data-tour-number={today.tourNumber ?? 1}
        >
          <RouteIcon className="size-5 shrink-0" aria-hidden />
          <span>
            {t("tourBadge", { number: today.tourNumber ?? 1, count: today.tourCount ?? 1 })}
            {(today.tourNumber ?? 1) > 1 ? ` · ${t("followUpHint")}` : ""}
          </span>
        </p>
      ) : null}

      {view === "list" ? (
        <>
          {/* Progress header (re-design.md §7.2.1). The count is printed exactly once, inside the
              ring; `progress-count` sits on the ring so the specs still read the same text. The word "erledigt"
              sits under the ring (run 3 review, point 6: a bare "3 / 6" next to "3 offen"
              read as "3 offen") and repeats the green/amber split of the bar below. */}
          <section
            aria-label={t("progressLabel")}
            className="flex flex-col gap-2"
            data-testid="progress"
          >
            <div className="flex items-start gap-3">
              <div className="flex shrink-0 flex-col items-center gap-1">
                <div className="relative">
                  <ProgressRing
                    value={done}
                    max={total}
                    size={64}
                    label={<span className="tabular-nums">{t("progress", { done, total })}</span>}
                    data-testid="progress-count"
                    className="[&_circle:last-child]:stroke-success"
                  />
                  {problems > 0 ? (
                    <ProblemArc
                      delivered={done - problems}
                      problems={problems}
                      total={total}
                      size={64}
                    />
                  ) : null}
                </div>
                {/* Outside the ring: the ring is too small for a 16 px word (driver body text >= 16 px). */}
                <span className="text-base font-medium text-muted-foreground">
                  {t("progressDone")}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <p
                  className="flex flex-wrap items-center gap-x-1.5 text-base text-muted-foreground"
                  data-testid="today-count"
                >
                  <span>{tHome("todayCount", { open: open.length, problems })}</span>
                  {endAt ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{tHome("endTime", { time: fmtTime(endAt) })}</span>
                    </>
                  ) : null}
                </p>
                {remaining > 0 ? (
                  <p className="flex items-center gap-1.5 text-base" data-testid="remaining">
                    <ClockIcon className="size-5 shrink-0" aria-hidden />
                    <span>{t("remaining", { duration: formatDuration(t, remaining) })}</span>
                  </p>
                ) : null}
              </div>
            </div>
            <ProgressBar
              total={total}
              segments={[
                { value: done - problems, tone: "success" },
                { value: problems, tone: "warning" },
                { value: open.length, tone: "neutral" },
              ]}
              label={t("progressLabel")}
              valueText={t("progressAria", { done, total })}
            />
          </section>

          {departureCard ? (
            <DepartureCard
              busy={departBusy}
              onOpen={() => openChecklist(1)}
              onSkip={() => void skipChecklist()}
            />
          ) : null}

          {next ? (
            <NextStopCard stop={next} stops={stops} timezone={today.timezone} unseen={unseen(next)} />
          ) : (
            <div
              className="flex flex-col gap-3 rounded-xl border border-border bg-success-soft p-5 text-success-soft-foreground"
              data-testid="all-done"
            >
              <div className="flex items-center gap-3">
                <PartyPopperIcon className="size-12 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-balance">{t("allDoneTitle")}</p>
                  <p className="text-base">{t("allDoneDescription")}</p>
                </div>
              </div>
              <p className="text-lg font-semibold" data-testid="finished-summary">
                {t("finishedSummary", {
                  delivered: stops.filter((s) => s.status === "DELIVERED").length,
                  problems,
                })}
              </p>
              {elapsed > 0 ? (
                <p className="text-base" data-testid="finished-elapsed">
                  {t("finishedElapsed", { duration: formatDuration(t, elapsed) })}
                </p>
              ) : null}
              {today.depot ? (
                <a
                  href={googleMapsNavigationUrl(today.depot.lat, today.depot.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="back-to-depot"
                  className={buttonVariants({
                    size: "xl",
                    variant: "success",
                    className: "w-full",
                  })}
                >
                  <NavigationIcon className="size-6" aria-hidden />
                  {t("backToDepot")}
                </a>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      <div className="sticky top-14 z-20 -mx-4 bg-background px-4 py-1">
        <SegmentedControl
          value={view}
          onValueChange={(next) => setView(next === "map" ? "map" : "list")}
          ariaLabel={t("viewLabel")}
          className="h-12 [&>button]:min-h-12"
          options={[
            { value: "list", label: t("viewList"), icon: ListIcon, testId: "view-list" },
            { value: "map", label: t("viewMap"), icon: MapIcon, testId: "view-map" },
          ]}
        />
      </div>

      {view === "list" && others.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="other-tours">
          {others.map((tour) => (
            <OtherTourSection key={tour.tourId} tour={tour} />
          ))}
        </div>
      ) : null}

      {view === "list" ? (
        stopList()
      ) : (
        /* Map view (re-design.md §7.2.5): the map fills `100dvh - top bar - control` (56 px header
           + 1 px hairline + 12 px main padding-top + 60 px control = 129 px). The progress header and
           the hero card are hidden here — only the segmented control stays above it, and the stop
           list stays reachable through the peeking bottom sheet below.
           `relative z-0` is what makes the map an own stacking context: without it the Leaflet panes
           (z-index 400/600/1000, and `.leaflet-container` is `position: relative; z-index: auto`)
           paint in the page's stacking context and cover the fixed sheet (z-30) — the map sheet was
           invisible in run 3 (review point 2) even though it was in the DOM. */
        <section
          aria-label={t("mapLabel")}
          data-testid="map-view"
          className="relative z-0 isolate -mx-4 -mb-32 [&_.leaflet-container]:h-[calc(100dvh-131px)] [&_.leaflet-container]:rounded-none [&_.leaflet-container]:border-0 [&_.leaflet-bottom.leaflet-right]:mb-18"
        >
          <TourMapLazy
            stops={stops.flatMap((stop) =>
              stop.lat !== null && stop.lng !== null
                ? [
                    {
                      id: stop.id,
                      sequence: stop.sequence,
                      lat: stop.lat,
                      lng: stop.lng,
                      label: stop.customerName,
                      status: stop.status,
                    },
                  ]
                : [],
            )}
            depot={
              today.depot
                ? { lat: today.depot.lat, lng: today.depot.lng, label: today.depot.name }
                : null
            }
            geometry={today.geometry}
            tiles={tiles}
            touch
            selectedId={selectedId}
            onSelect={(id) => {
              // NUD-119: a tap / Enter on a numbered marker opens the stop screen, like a list row
              // does (the offline shell serves the same route from the cached tour).
              setSelectedId(id);
              router.push(`/driver/stops/${id}`);
            }}
            onClusterSelect={() => setListOpen(true)}
          />
        </section>
      )}

      {view === "map" ? (
        /* The stop-list sheet of §7.2(5): a drag handle and "3 offene Stopps" peek 72 px into the
           viewport, expanding to 60 % of it. Every row focuses its stop on the map (`onFocus`),
           which is the list -> map direction of the same entry point. */
        <div
          className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-xl"
          data-testid="map-sheet"
        >
          <div className="flex flex-col rounded-t-xl border-t bg-card shadow-lg">
            <button
              type="button"
              aria-expanded={listOpen}
              onClick={() => setListOpen((open) => !open)}
              className="flex min-h-[72px] w-full flex-col items-center justify-center gap-1.5 px-4 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              data-testid="map-sheet-toggle"
            >
              <span
                className="h-1 w-10 shrink-0 rounded-full bg-muted-foreground/50"
                aria-hidden
                data-testid="map-sheet-handle"
              />
              <span className="flex w-full items-center justify-between gap-2">
                <span>{t("mapSheetCount", { count: open.length })}</span>
                <ChevronUpIcon
                  className={cn(
                    "size-6 shrink-0 transition-transform motion-reduce:transition-none",
                    listOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </span>
            </button>
            {listOpen ? (
              // 60 % of the viewport including the 72 px peek (60dvh − 4.5rem).
              <div className="max-h-[calc(60dvh-4.5rem)] overflow-y-auto border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {stopList((id) => {
                  setSelectedId(id);
                  setListOpen(false);
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="mt-3 w-full"
                  onClick={() => setListOpen(false)}
                  data-testid="map-sheet-close"
                >
                  {t("mapSheetHide")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
