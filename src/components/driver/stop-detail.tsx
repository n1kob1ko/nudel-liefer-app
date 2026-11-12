"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleParkingIcon,
  ClockIcon,
  CopyIcon,
  MapPinIcon,
  NavigationIcon,
  PackageIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { stopIcon, stopTone } from "@/components/shared/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { StopNumberBadge } from "@/components/shared/stop-number-badge";
import { Button } from "@/components/ui/button";
import { formatAddress } from "@/domain/driver-stop";
import { summarizeItems } from "@/domain/driver-today";
import type { ProblemReasonName } from "@/domain/stop-status";
import { Link } from "@/i18n/navigation";
import { isIosDevice } from "@/lib/device";
import type { DriverStopDetail, TodayItem, TodayStop } from "@/lib/driver-tour-model";
import { type AppFormatters, createAppFormatters } from "@/lib/format";
import type { MapTileConfig } from "@/lib/map-config";
import { stopAppleNavigationUrl, stopGoogleNavigationUrl } from "@/lib/navigation";
import { useOverlaidStop, useOverlaidStops } from "@/lib/offline/use-overlay";
import { useOverlaidPhotos } from "@/lib/offline/use-photo-overlay";
import { isPieceUnit } from "@/lib/units";
import { cn } from "@/lib/utils";

import { AbbreviationChip } from "./customer-abbreviation";
import { KeyChip } from "./customer-key";
import { localizeDeliveryHours } from "./delivery-hours";
import { driverTime } from "./driver-time";
import { ParkingSetButton } from "./parking-setter";
import { RefreshOnFocus } from "./refresh-on-focus";
import { stopText } from "./stop-i18n-fallback";
import { StopPayment } from "./stop-payment";
import { StopPhotos } from "./stop-photos";
import { StopStatusActions } from "./stop-status-actions";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

const subscribeNothing = () => () => {};
/** True on iPhone / iPad (detected in the browser; false during server rendering). */
function useIsIos(): boolean {
  return useSyncExternalStore(subscribeNothing, isIosDevice, () => false);
}

/**
 * Stop detail (redesign RD-2, re-design.md §7.3).
 *
 * Order top to bottom: sticky top bar (back + "Stopp n von N" + previous/next), header block on the
 * page background (badge, customer, address + copy, ETA/hours line, status badge, "Navigation
 * starten"), the note callout, the delivery card, the photos card with the fullscreen viewer and the
 * action card at the end. Nothing about the status/offline logic changed: the buttons still render
 * the existing `StopStatusActions`, only the presentation moved into the action card at the end.
 */
export function StopDetail({
  detail,
  tiles,
  offline = false,
}: {
  detail: DriverStopDetail;
  /** Map tiles of the Parkplatz sheet (NUD-144). */
  tiles: MapTileConfig;
  /** Rendered from the offline copy (NUD-081): taps are queued on the device (NUD-082). */
  offline?: boolean;
}) {
  const t = useTranslations("driver");
  const tStop = useTranslations("driver.stop");
  const tReasons = useTranslations("common.problemReasons");
  const locale = useLocale();
  const fmt = createAppFormatters(useFormatter(), detail.timezone);
  const fmtTime = driverTime(useFormatter(), detail.timezone);
  const ios = useIsIos();
  // Queued taps the server has not confirmed yet count as done on this screen (NUD-082).
  const stop = useOverlaidStop(detail.stop);
  const tourStops = useOverlaidStops(detail.tourStops);
  // A photo taken here shows at once from the local blob while it waits to be sent (NUD-083).
  const photos = useOverlaidPhotos(stop.customerId, detail.photos);
  const hasPin = stop.lat !== null && stop.lng !== null;
  const address = formatAddress(stop);
  // Free text from the office: weekdays and the "Uhr" suffix are localized (run 3 review point 3),
  // the rest of the string is shown as stored.
  const hours = detail.deliveryHoursInfo
    ? localizeDeliveryHours(detail.deliveryHoursInfo, (key) => tStop(key), tStop("clockSuffix"))
    : null;

  return (
    <div
      className="pb-[max(2rem,env(safe-area-inset-bottom))]"
      data-testid="stop-detail"
      data-stop-id={stop.id}
    >
      {offline ? null : <RefreshOnFocus />}

      {/* Sticky top bar variant (§7.3): back, position, previous/next. The "Weiter"/"Zurück" names
          stay on the chevrons the e2e specs click, and the texts also appear in the bottom bar. */}
      <header
        className="sticky top-14 z-20 -mx-4 mb-2 flex min-h-14 items-center gap-1 border-b bg-background px-2 py-1"
        data-testid="stop-topbar"
      >
        <Button
          asChild
          variant="ghost"
          size="icon-lg"
          className="shrink-0"
          aria-label={stopText(tStop, locale, "backToTour")}
        >
          <Link href="/driver" data-testid="back">
            <ChevronLeftIcon className="size-6" aria-hidden />
          </Link>
        </Button>
        <p
          className="min-w-0 flex-1 text-center text-base font-semibold"
          data-testid="stop-position"
        >
          {tStop("position", { position: detail.position, total: detail.total })}
        </p>
        <StopNavLink
          id={detail.prevStopId}
          direction="prev"
          label={tStop("previous")}
          testId="prev-stop"
        />
        <StopNavLink
          id={detail.nextStopId}
          direction="next"
          label={tStop("next")}
          testId="next-stop"
        />
      </header>

      <header className="space-y-3" data-testid="stop-header">
        <div className="flex items-start gap-3">
          <StopNumberBadge
            number={stop.sequence}
            tone={stopTone(stop.status)}
            size={48}
            label={t("today.stopLabel", { number: stop.sequence })}
            data-testid="stop-number"
          />
          <h1
            className="min-w-0 text-2xl leading-tight font-bold text-balance break-words"
            data-testid="stop-name"
          >
            {stop.customerName}
          </h1>
        </div>

        <CopyAddress address={address} />

        {stop.hasKey !== undefined || stop.abbreviation !== undefined ? (
          <div className="flex flex-wrap items-center gap-2">
            <KeyChip stop={stop} interactive />
            <AbbreviationChip stop={stop} interactive />
          </div>
        ) : null}

        {stop.etaAt || hours ? (
          <p className="flex items-start gap-2 text-base">
            <ClockIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words">
              {stop.etaAt ? (
                <span data-testid="stop-eta">
                  {t("today.eta", { time: fmtTime(new Date(stop.etaAt)) })}
                </span>
              ) : null}
              {stop.etaAt && hours ? <span aria-hidden> · </span> : null}
              {hours ? <span data-testid="stop-hours">{hours}</span> : null}
            </span>
          </p>
        ) : null}

        <div data-testid="stop-status" data-status={stop.status}>
          <StatusBadge tone={stopTone(stop.status)} icon={stopIcon(stop.status)} size="lg">
            {stop.status === "DELIVERED"
              ? stop.completedAt
                ? stopText(tStop, locale, "statusDeliveredAt", {
                    time: fmtTime(new Date(stop.completedAt)),
                  })
                : t("today.statusDelivered")
              : stop.status === "PROBLEM"
                ? stopText(tStop, locale, "statusProblem", {
                    reason: stop.problemReason
                      ? tReasons(stop.problemReason as ProblemReasonName)
                      : t("today.statusProblem"),
                  })
                : t("today.statusPending")}
          </StatusBadge>
          {/* NUD-177 (QA 2026-10-29 F5): the driver could not read back what he wrote. Read-only —
              the note is his report to the office, not an editable field. */}
          {stop.status === "PROBLEM" && stop.problemNote ? (
            <p
              className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-base whitespace-pre-wrap"
              data-testid="stop-problem-note"
            >
              <span className="block text-sm font-medium text-muted-foreground">
                {tStop("problemNoteLabel")}
              </span>
              {stop.problemNote.text}
            </p>
          ) : null}
        </div>
      </header>

      {/* The note callout is the first card under the header and comes *before* the navigation
          button (re-design.md §7.3: "this is the thing drivers must not miss"). */}
      {detail.notes ? (
        <div className="mt-3">
          <NoteCallout
            text={detail.notes.text}
            lang={detail.notes.lang}
            showLangBadge={detail.notes.lang === "de" && detail.locale !== "de"}
          />
        </div>
      ) : null}

      <div className="mt-3 grid gap-2" data-testid="navigation">
        {hasPin ? (
          <>
            <Button asChild size="xl" className="w-full">
              <a
                href={stopGoogleNavigationUrl(stop)!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  toast(stopText(tStop, locale, "navigateStarting"), { duration: 2000 })
                }
                data-testid="navigate"
              >
                <NavigationIcon className="size-6" aria-hidden />
                {t("today.navigate")}
              </a>
            </Button>
            {ios ? (
              <Button asChild variant="outline" size="lg" className="w-full">
                <a
                  href={stopAppleNavigationUrl(stop)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    toast(stopText(tStop, locale, "navigateStarting"), { duration: 2000 })
                  }
                  data-testid="navigate-apple"
                >
                  <NavigationIcon className="size-5" aria-hidden />
                  {tStop("appleMaps")}
                </a>
              </Button>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2 text-base" data-testid="no-pin">
            <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
            {t("today.noPin")}
          </p>
        )}
      </div>

      <ParkingSpotsCard spots={stop.parkingSpots ?? []} stop={stop} tiles={tiles} />

      <DeliveryCard items={stop.items} fmt={fmt} locale={locale} />

      <StopPayment stop={stop} />

      <StopPhotos
        photos={photos}
        customerName={stop.customerName}
        stopId={stop.id}
        customerId={stop.customerId}
      />

      {/* Kept for the offline e2e, which compares this container's text between the online and the
          offline render; the visible delivery hours moved into the header line above. */}
      <section className="hidden" data-testid="stop-info" aria-hidden>
        {hours ? <span>{hours}</span> : null}
      </section>

      <div data-testid="status-actions-slot">
        <StopStatusActions
          key={`${stop.id}:${stop.status}`}
          stop={stop}
          tourStops={tourStops}
          tourStatus={detail.tourStatus}
          timezone={detail.timezone}
          offline={offline}
        />
      </div>
    </div>
  );
}

/**
 * The customer's Parkplätze (NUD-126): label + note, the first one is where the single
 * "Navigation starten" button guides to first (D30). Hidden when the customer has none.
 */
function ParkingSpotsCard({
  spots,
  stop,
  tiles,
}: {
  spots: NonNullable<TodayStop["parkingSpots"]>;
  stop: TodayStop;
  tiles: MapTileConfig;
}) {
  const t = useTranslations("driver.stop");
  if (spots.length === 0) {
    return (
      <section className="mt-3 rounded-xl border bg-card p-4" data-testid="parking-empty">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CircleParkingIcon className="size-5 shrink-0" aria-hidden />
          {t("parkingTitle")}
        </h2>
        <p className="mt-1 mb-3 text-base text-muted-foreground">{t("parkingNone")}</p>
        <ParkingSetButton stop={stop} tiles={tiles} />
      </section>
    );
  }
  return (
    <section className="mt-3 rounded-xl border bg-card p-4" data-testid="parking-spots">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CircleParkingIcon className="size-5 shrink-0" aria-hidden />
        {t("parkingTitle")}
      </h2>
      <p className="mt-1 text-base text-muted-foreground">{t("parkingHint")}</p>
      <ol className="mt-2 grid gap-2">
        {spots.map((spot, index) => (
          <li
            key={`${spot.lat},${spot.lng},${index}`}
            className="min-w-0 rounded-lg bg-muted px-3 py-2"
            data-testid="parking-spot"
            data-default={index === 0 ? "true" : "false"}
          >
            <p className="text-base font-semibold break-words">
              {spot.label || t("parkingSpotNumber", { number: index + 1 })}
              {index === 0 ? (
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  {t("parkingFirst")}
                </span>
              ) : null}
            </p>
            {spot.note ? (
              <p className="text-base break-words whitespace-pre-line" data-testid="parking-note">
                {spot.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <ParkingSetButton stop={stop} tiles={tiles} className="mt-3" />
    </section>
  );
}

/** One row of the delivery card: product name left, 28 px bold tabular quantity + unit right. */
function ItemRow({
  item,
  unitLabel,
  fmt,
}: {
  item: TodayItem;
  unitLabel: (unit: string, count: number) => string;
  fmt: AppFormatters;
}) {
  const quantity = item.quantity;
  const piece = isPieceUnit(item.unit);
  const qty = (
    <strong className="font-sans text-3xl font-bold tabular-nums" data-testid="item-quantity-value">
      {fmt.quantity(quantity)}
    </strong>
  );
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3" data-testid="stop-item">
      {/* "3 × Wantan-Teig": a piece line has no unit word, so the quantity leads the name. */}
      {piece ? (
        <p className="flex min-w-0 items-baseline gap-2" data-testid="item-quantity">
          {qty}
          <span aria-hidden className="text-2xl">
            ×
          </span>
          <span className="min-w-0">
            <span
              className="block text-lg leading-snug font-semibold break-words"
              data-testid="item-name"
            >
              {item.name}
            </span>
            {item.germanName && item.germanName !== item.name ? (
              <span
                className="block text-base font-normal text-muted-foreground break-words"
                data-testid="item-name-de"
              >
                <span lang="de">{item.germanName}</span>
              </span>
            ) : null}
          </span>
        </p>
      ) : (
        <>
          <div className="min-w-0">
            <p className="text-lg leading-snug font-semibold break-words" data-testid="item-name">
              {item.name}
            </p>
            {item.germanName && item.germanName !== item.name ? (
              <p className="text-base text-muted-foreground break-words" data-testid="item-name-de">
                <span lang="de">{item.germanName}</span>
              </p>
            ) : null}
          </div>
          {/* "<qty> <unit>" — no multiplication sign between value and unit (design review point 7). */}
          <p className="shrink-0 text-end" data-testid="item-quantity">
            {qty} <span className="text-base">{unitLabel(item.unit, quantity)}</span>
          </p>
        </>
      )}
    </li>
  );
}

/**
 * The "Lieferung" card: one row per product and a total row when there is more than one.
 *
 * The total is summed **per unit** (design review point 7): kg and crates are never added into one
 * "17,5 × Kisten". With a single unit the row reads "12,5 kg"; with several units it is labelled
 * "Gesamt je Einheit" and lists one value per unit, so a driver can act on each of them.
 */
function DeliveryCard({
  items,
  fmt,
  locale,
}: {
  items: TodayItem[];
  fmt: AppFormatters;
  locale: string;
}) {
  const t = useTranslations("driver");
  const tStop = useTranslations("driver.stop");
  const unitLabel = (unit: string, count: number) => t(`units.${unit as UnitKey}`, { count });
  const { totals } = summarizeItems(items);
  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="stop-items">
      <h2 className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-base font-semibold">
        <PackageIcon className="size-5 shrink-0" aria-hidden />
        {tStop("items")}
      </h2>
      <ul className="divide-y">
        {items.map((item) => (
          <ItemRow key={item.productId} item={item} unitLabel={unitLabel} fmt={fmt} />
        ))}
      </ul>
      {items.length > 1 ? (
        <p
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-4 py-3 text-base font-semibold"
          data-testid="summary-total"
        >
          <span>
            {totals.length > 1
              ? tStop("summaryTotalMixed")
              : stopText(tStop, locale, "summaryTotal")}
          </span>
          <span className="flex flex-wrap items-baseline justify-end gap-x-2 text-end">
            {totals.map((total, index) => (
              <span key={total.unit} className="whitespace-nowrap" data-unit={total.unit}>
                {index > 0 ? <span aria-hidden>· </span> : null}
                <strong className="font-sans text-3xl font-bold tabular-nums">
                  {fmt.quantity(total.quantity)}
                </strong>{" "}
                <span className="text-base">{t(`unitsTotal.${total.unit as UnitKey}`)}</span>
              </span>
            ))}
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** The amber note callout: the one thing a driver must not miss, directly under the header. */
function NoteCallout({
  text,
  lang,
  showLangBadge,
}: {
  text: string;
  lang: string;
  showLangBadge: boolean;
}) {
  const t = useTranslations("driver.stop");
  return (
    <section
      className="space-y-1.5 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-warning-soft-foreground"
      data-testid="stop-notes"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlertIcon className="size-5 shrink-0" aria-hidden />
        {t("notes")}
        {showLangBadge ? (
          <span
            className="rounded border border-current px-1.5 text-sm font-medium"
            data-testid="notes-lang"
            title={t("notesGerman")}
          >
            DE
          </span>
        ) : null}
      </h2>
      <p className="text-[17px] leading-relaxed whitespace-pre-wrap break-words" lang={lang}>
        {text}
      </p>
    </section>
  );
}

/** Address line; tapping the copy button copies it to the clipboard (e.g. to paste into maps). */
function CopyAddress({ address }: { address: string }) {
  const t = useTranslations("driver.stop");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      return; // clipboard not available (insecure context, denied): nothing was copied
    }
    setCopied(true);
    toast(t("copied"), { duration: 2000 });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <p className="flex min-h-12 items-center gap-2">
      <MapPinIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      {/* The address itself keeps the `stop-address` id the e2e specs read (text + font size). */}
      <span className="min-w-0 flex-1 text-lg break-words" data-testid="stop-address">
        {address}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        className="shrink-0"
        onClick={() => void copy()}
        aria-label={`${t("copyAddress")}: ${address}`}
      >
        {copied ? (
          <CheckIcon className="text-success-soft-foreground" aria-hidden />
        ) : (
          <CopyIcon aria-hidden />
        )}
      </Button>
      {copied ? (
        <span className="sr-only" role="status" data-testid="address-copied">
          {t("copied")}
        </span>
      ) : null}
    </p>
  );
}

function StopNavLink({
  id,
  direction,
  label,
  testId,
}: {
  id: string | null;
  direction: "prev" | "next";
  label: string;
  testId: string;
}) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  const className = cn("shrink-0");
  if (!id) {
    return (
      <Button
        variant="ghost"
        size="icon-lg"
        className={className}
        disabled
        aria-label={label}
        data-testid={testId}
      >
        <Icon className="size-6" aria-hidden />
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="icon-lg" className={className} aria-label={label}>
      <Link href={`/driver/stops/${id}`} data-testid={testId}>
        <Icon className="size-6" aria-hidden />
      </Link>
    </Button>
  );
}
