"use client";

import { CheckIcon, ClipboardCheckIcon, KeyRoundIcon, PackageIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  buildDepartureChecklist,
  checklistLineIds,
  parseTicked,
} from "@/domain/departure-checklist";
import type { TodayStop } from "@/lib/driver-tour-model";
import { createAppFormatters } from "@/lib/format";
import { enqueueMutation } from "@/lib/offline/outbox-browser";
import { isPieceUnit } from "@/lib/units";
import { cn } from "@/lib/utils";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

/** Where the ticks of one checklist live on the device (a per-driver convenience, never required). */
const tickKey = (tourId: string, trip: number) => `nudel.driver.checklist.${tourId}.${trip}`;

function readTicks(tourId: string, trip: number, valid: ReadonlySet<string>): Set<string> {
  try {
    const raw = window.localStorage.getItem(tickKey(tourId, trip));
    return parseTicked(raw ? JSON.parse(raw) : null, valid);
  } catch {
    return new Set();
  }
}

function writeTicks(tourId: string, trip: number, ticked: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(tickKey(tourId, trip), JSON.stringify([...ticked]));
  } catch {
    // no storage: the ticks simply start empty on the next visit
  }
}

/**
 * Queues a tour-level departure entry (NUD-151). The entry names the tour's first stop (the
 * outbox is keyed by stops); the server resolves the tour from it.
 */
export async function queueDeparture(
  type: "loading" | "depart",
  stops: ReadonlyArray<Pick<TodayStop, "id" | "customerName">>,
): Promise<boolean> {
  const first = stops[0];
  if (!first) return false;
  try {
    await enqueueMutation({ type, stopId: first.id, customerName: first.customerName });
    return true;
  } catch {
    // IndexedDB unavailable (private mode): nothing was queued.
    return false;
  }
}

/**
 * "Abfahrt vorbereiten" (NUD-151): an optional card on the driver's home before the first stop.
 * Opening the checklist records `loadingStartedAt`, "Überspringen" records `departedAt` only. The
 * card disappears once the driver has left (or has started working on the stops).
 */
export function DepartureCard({
  onOpen,
  onSkip,
  busy,
}: {
  onOpen: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const t = useTranslations("driver.departure");
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      aria-labelledby="departure-card-title"
      data-testid="departure-card"
    >
      <div className="flex items-start gap-3">
        <ClipboardCheckIcon className="mt-0.5 size-7 shrink-0 text-foreground" aria-hidden />
        <div className="min-w-0">
          <h2 id="departure-card-title" className="text-xl font-bold">
            {t("cardTitle")}
          </h2>
          <p className="text-base text-muted-foreground">{t("cardHint")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* Voluntary, so neither is yolk: the one yolk button of this screen is "Navigation
            starten" on the next-stop card (redesign RD2). */}
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={busy}
          onClick={onOpen}
          data-testid="departure-open"
        >
          {t("open")}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          disabled={busy}
          onClick={onSkip}
          data-testid="departure-skip"
        >
          {t("skip")}
        </Button>
      </div>
    </section>
  );
}

function TickRow({
  checked,
  onToggle,
  testId,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        data-testid={testId}
        data-checked={checked}
        className={cn(
          "flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start outline-none transition-[background-color,border-color,transform] duration-[140ms] ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[.97]",
          checked
            ? "border-success/45 bg-success-soft text-success-soft-foreground"
            : "border-input/60 bg-card",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-[140ms] ease-out",
            // The empty box is a control boundary: `input` keeps it at 3:1 against the card.
            checked ? "border-success bg-success text-success-foreground" : "border-input",
          )}
        >
          {checked ? <CheckIcon className="size-6" /> : null}
        </span>
        <span className="min-w-0 flex-1">{children}</span>
      </button>
    </li>
  );
}

/**
 * The checklist of one trip: the products to load (same totals as the load sheet), the keys to
 * take and the office's fixed items; one tap per line. The first trip ends with "Losfahren"
 * (`departedAt`), later trips (after a reload at the depot) only with "Fertig".
 */
export function DepartureSheet({
  tourId,
  trip,
  stops,
  fixedItems,
  firstTrip,
  onClose,
  onDeparted,
}: {
  tourId: string;
  trip: number;
  stops: readonly TodayStop[];
  fixedItems: ReadonlyArray<{ id: string; text: string }>;
  firstTrip: boolean;
  onClose: () => void;
  onDeparted: () => void;
}) {
  const t = useTranslations("driver.departure");
  const tUnits = useTranslations("driver.units");
  const fmt = createAppFormatters(useFormatter());
  const checklist = useMemo(
    () =>
      buildDepartureChecklist(
        stops.map((stop) => ({
          trip: stop.trip,
          customerId: stop.customerId,
          customerName: stop.customerName,
          hasKey: stop.hasKey,
          keyNumber: stop.keyNumber,
          items: stop.items,
        })),
        trip,
      ),
    [stops, trip],
  );
  const lineIds = useMemo(() => checklistLineIds(checklist, fixedItems), [checklist, fixedItems]);
  const [ticked, setTicked] = useState<Set<string>>(() =>
    readTicks(tourId, trip, new Set(lineIds)),
  );
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(
    (id: string) => {
      setTicked((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeTicks(tourId, trip, next);
        return next;
      });
    },
    [tourId, trip],
  );

  async function depart() {
    if (busy) return;
    setBusy(true);
    const queued = await queueDeparture("depart", stops);
    if (!queued) {
      toast.error(t("storageError"));
      setBusy(false);
      return;
    }
    onDeparted();
    onClose();
  }

  const total = lineIds.length;
  const done = lineIds.filter((id) => ticked.has(id)).length;

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
        data-testid="departure-sheet"
      >
        <SheetHeader className="shrink-0 pe-14">
          <SheetTitle className="text-2xl">
            {firstTrip ? t("sheetTitle") : t("sheetTitleTrip", { trip })}
          </SheetTitle>
          <SheetDescription>{t("sheetDescription")}</SheetDescription>
          {total > 0 ? (
            <p
              className="text-base font-semibold"
              data-testid="departure-progress"
              data-done={done}
              data-total={total}
            >
              {t("progress", { done, total })}
            </p>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-1 pb-4">
          {total === 0 ? (
            <p className="text-base text-muted-foreground" data-testid="departure-empty">
              {firstTrip ? t("empty") : t("emptyTrip")}
            </p>
          ) : null}

          {checklist.products.length > 0 ? (
            <section aria-labelledby="departure-products">
              <h3
                id="departure-products"
                className="mb-2 flex items-center gap-2 text-lg font-semibold"
              >
                <PackageIcon className="size-5 shrink-0" aria-hidden />
                {t("productsHeading")}
              </h3>
              <ul className="flex flex-col gap-2" data-testid="departure-products">
                {checklist.products.map((line) => (
                  <TickRow
                    key={line.id}
                    checked={ticked.has(line.id)}
                    onToggle={() => toggle(line.id)}
                    testId="departure-product"
                  >
                    <span
                      className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                      data-unit={line.unit}
                      data-quantity={line.quantity}
                    >
                      <strong className="font-sans text-3xl font-bold tabular-nums">
                        {fmt.quantity(line.quantity)}
                      </strong>
                      {isPieceUnit(line.unit) ? (
                        <span aria-hidden className="text-2xl">
                          ×
                        </span>
                      ) : (
                        <span className="text-lg">
                          {tUnits(line.unit as UnitKey, { count: line.quantity })}
                        </span>
                      )}
                      <span className="min-w-0 text-lg font-semibold break-words">{line.name}</span>
                    </span>
                  </TickRow>
                ))}
              </ul>
            </section>
          ) : null}

          {checklist.keys.length > 0 ? (
            <section aria-labelledby="departure-keys">
              <h3
                id="departure-keys"
                className="mb-2 flex items-center gap-2 text-lg font-semibold"
              >
                <KeyRoundIcon className="size-5 shrink-0" aria-hidden />
                {t("keysHeading")}
              </h3>
              <ul className="flex flex-col gap-2" data-testid="departure-keys">
                {checklist.keys.map((line) => (
                  <TickRow
                    key={line.id}
                    checked={ticked.has(line.id)}
                    onToggle={() => toggle(line.id)}
                    testId="departure-key"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-lg">
                      <KeyRoundIcon className="size-5 shrink-0" aria-hidden />
                      <strong className="font-sans font-bold tabular-nums">
                        {line.keyNumber ?? t("keyNoNumber")}
                      </strong>
                      <span aria-hidden>·</span>
                      <span className="min-w-0 font-semibold break-words">{line.customerName}</span>
                    </span>
                  </TickRow>
                ))}
              </ul>
            </section>
          ) : null}

          {fixedItems.length > 0 ? (
            <section aria-labelledby="departure-fixed">
              <h3 id="departure-fixed" className="mb-2 text-lg font-semibold">
                {t("fixedHeading")}
              </h3>
              <ul className="flex flex-col gap-2" data-testid="departure-fixed">
                {fixedItems.map((item) => (
                  <TickRow
                    key={item.id}
                    checked={ticked.has(`f:${item.id}`)}
                    onToggle={() => toggle(`f:${item.id}`)}
                    testId="departure-fixed-item"
                  >
                    <span className="text-lg font-semibold break-words">{item.text}</span>
                  </TickRow>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {firstTrip ? (
            <Button
              type="button"
              size="xl"
              variant="success"
              disabled={busy}
              onClick={() => void depart()}
              data-testid="departure-go"
            >
              {t("depart")}
            </Button>
          ) : (
            <Button
              type="button"
              size="xl"
              disabled={busy}
              onClick={onClose}
              data-testid="departure-finish"
            >
              {t("finish")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
