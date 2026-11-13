"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  CircleParkingOffIcon,
  DoorClosedIcon,
  EllipsisIcon,
  HandIcon,
  type LucideIcon,
  MapPinOffIcon,
  ScaleIcon,
  Undo2Icon,
  UploadCloudIcon,
  UserXIcon,
  WifiOffIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
  isWithinUndoWindow,
  nextPendingAfter,
  PROBLEM_NOTE_MAX,
  PROBLEM_REASONS,
  type ProblemReasonName,
} from "@/domain/stop-status";
import { Link, useRouter } from "@/i18n/navigation";
import { requestOfflineSync } from "@/lib/offline/browser";
import { planUndo } from "@/lib/offline/outbox";
import { enqueueMutation, undoStopStatus, useOutbox } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

import { driverTime } from "./driver-time";
import { stopText } from "./stop-i18n-fallback";

const REASON_ICONS: Record<ProblemReasonName, LucideIcon> = {
  CLOSED: DoorClosedIcon,
  NOBODY_THERE: UserXIcon,
  NO_PARKING: CircleParkingOffIcon,
  WRONG_QUANTITY: ScaleIcon,
  REFUSED: HandIcon,
  ADDRESS_NOT_FOUND: MapPinOffIcon,
  OTHER: EllipsisIcon,
};

const TOAST_MS = 10_000;

/**
 * Stops the driver completed with a tap on this device a moment ago. The result card of such a stop
 * shows the success ring once (motion rule 8); a stop that was already done when the screen opened
 * stays still. Module state on purpose: the actions remount when the status changes (their `key`).
 */
const justDelivered = new Set<string>();

type StopForStatus = {
  id: string;
  customerName: string;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  problemReason: string | null;
  completedAt: string | null;
};

type TourStopForStatus = { id: string; sequence: number; status: string };

/** `Date.now()` that re-renders every `intervalMs`, so the undo button disappears by itself. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The big "Delivered" / "Problem" buttons of the stop screen (NUD-053), the problem sheet, the
 * result card with Undo, and the toast with Undo after a success.
 *
 * Offline queue (NUD-082): a tap is written to the outbox on the device (IndexedDB) and the screen
 * changes at once (the stop counts as done, the next one opens); the outbox sends it to
 * `POST /api/driver/sync` as soon as it can. Online this takes a fraction of a second, offline it
 * happens when the connection is back. Every tap has its own `clientMutationId`, so a resend can
 * never book a stop twice. Undo of a tap that is still queued removes it from the queue instead of
 * sending a delivered + undo pair; undo of a confirmed stop queues an undo.
 */
export function StopStatusActions({
  stop,
  tourStops,
  tourStatus,
  timezone,
  offline = false,
}: {
  stop: StopForStatus;
  /** All stops of the tour (queued taps already applied): decides which stop opens next. */
  tourStops: readonly TourStopForStatus[];
  tourStatus: string;
  timezone: string;
  /** Offline copy (NUD-081): an amber hint says that the tap is kept on the device. */
  offline?: boolean;
}) {
  const t = useTranslations("driver.status");
  const tReasons = useTranslations("common.problemReasons");
  const tNext = useTranslations("driver.stop");
  const locale = useLocale();
  const fmtTime = driverTime(useFormatter(), timezone);
  const router = useRouter();
  const now = useNow(15_000);
  const outbox = useOutbox();

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState<ProblemReasonName | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Read once when the result card mounts; cleared afterwards so a later visit stays still.
  const [celebrate] = useState(() => stop.status === "DELIVERED" && justDelivered.has(stop.id));
  useEffect(() => {
    if (stop.status !== "PENDING") justDelivered.delete(stop.id);
  }, [stop.id, stop.status]);

  /** Runs `task` once at a time (a double tap is one tap); shows a message if the device cannot store. */
  async function guarded<T>(task: () => Promise<T>): Promise<T | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch {
      setError(t("errors.storage"));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function undo(stopId: string, name: string) {
    const result = await guarded(() => undoStopStatus(stopId, name));
    if (!result || result === "none") return;
    requestOfflineSync();
    toast.success(t("undone"));
    router.push(`/driver/stops/${stopId}`);
  }

  async function complete(
    type: "delivered" | "problem",
    extra: { reason?: ProblemReasonName; note?: string } = {},
  ) {
    const entry = await guarded(() =>
      enqueueMutation({ type, stopId: stop.id, customerName: stop.customerName, ...extra }),
    );
    if (!entry) return;
    if (type === "delivered") justDelivered.add(stop.id);
    setSheetOpen(false);
    setReason(null);
    setNote("");
    const next = nextPendingAfter(
      tourStops.map((s) => ({ ...s, status: s.id === stop.id ? type.toUpperCase() : s.status })),
      stop.id,
    );
    toast(
      type === "delivered"
        ? t("deliveredToast", { name: stop.customerName })
        : t("problemToast", { name: stop.customerName }),
      {
        duration: TOAST_MS,
        style: { fontSize: 16 },
        // The last stop closes the tour and a completed tour cannot be reopened (NUD-053).
        action: next
          ? {
              label: t("undo"),
              onClick: () => void undo(stop.id, stop.customerName),
            }
          : undefined,
        actionButtonStyle: { height: 48, minWidth: 48, fontSize: 16, padding: "0 16px" },
      },
    );
    // NUD-176 (QA 2026-10-29, F1): NO automatic jump to the next stop. The only durable undo lived
    // in the toast, and the push in the same tick took the screen — and with it the reachable undo —
    // away from the driver. The result card of this stop now offers "Weiter zu Stopp n" and
    // "Rückgängig" until the server's 5-minute window closes.
  }

  const queuedEntries = outbox.entries.filter((e) => e.stopId === stop.id);
  const waiting = queuedEntries.some((e) => !outbox.inFlight.has(e.clientMutationId));
  // The stop the driver actually walks to next (queued taps applied). `null` = nothing open.
  const next = nextPendingAfter(tourStops, stop.id);

  if (stop.status !== "PENDING") {
    const completedAt = stop.completedAt ? new Date(stop.completedAt) : null;
    // A completion that is still queued can always be taken back (the server never saw it); a
    // confirmed one only inside the window and while the tour is not completed (NUD-053).
    const tourDone = tourStops.every((s) => s.status !== "PENDING");
    const cancelable = planUndo(outbox.entries, stop.id, outbox.inFlight).action === "cancel";
    const canUndo =
      cancelable ||
      (!tourDone &&
        tourStatus !== "COMPLETED" &&
        completedAt !== null &&
        isWithinUndoWindow(completedAt, new Date(now)));
    const delivered = stop.status === "DELIVERED";
    return (
      <>
        <section
          className={cn(
            "relative space-y-3 rounded-xl border p-4",
            delivered
              ? "border-success/45 bg-success-soft text-success-soft-foreground"
              : "border-destructive/40 bg-destructive-soft text-destructive-soft-foreground",
          )}
          data-testid="stop-result"
          data-status={stop.status}
          aria-label={t("actionsLabel")}
        >
          {celebrate ? (
            // 3 % is enough on a card this wide, and it stays inside the page padding.
            <span aria-hidden data-slot="pulse-ring" className="pulse-ring [--pulse-scale:1.03]" />
          ) : null}
          <p className="flex items-center gap-3 text-2xl font-bold" data-testid="stop-result-text">
            {delivered ? (
              <CheckCircle2Icon className="size-8 shrink-0" aria-hidden />
            ) : (
              <AlertTriangleIcon className="size-8 shrink-0" aria-hidden />
            )}
            <span>
              {delivered
                ? t("doneDelivered")
                : t("doneProblem", {
                    reason: stop.problemReason
                      ? tReasons(stop.problemReason as ProblemReasonName)
                      : t("problem"),
                  })}
            </span>
          </p>
          {completedAt ? (
            <p className="text-base" data-testid="stop-result-time">
              {t("doneAt", { time: fmtTime(completedAt) })}
            </p>
          ) : null}
          {waiting ? (
            <p
              className="flex items-center gap-2 text-base font-semibold"
              data-testid="stop-pending-sync"
            >
              <UploadCloudIcon className="size-5 shrink-0" aria-hidden />
              {t("queuedHint")}
            </p>
          ) : null}
          {canUndo ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-14 w-full text-lg"
              disabled={busy}
              onClick={() => void undo(stop.id, stop.customerName)}
              data-testid="undo"
            >
              <Undo2Icon className="size-6" aria-hidden />
              {t("undo")}
            </Button>
          ) : null}
          {error ? (
            <p role="alert" className="text-base font-medium" data-testid="status-error">
              {error}
            </p>
          ) : null}
        </section>

        <div
          // In the page flow, after the stop's details (review 2026-10-31: the fixed bar read as a
          // misplaced band over the content). Same card look as the sections above it.
          className="space-y-2 rounded-xl border bg-card p-4"
          data-testid="stop-action-bar"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
            {delivered ? (
              <CheckCircle2Icon
                className="size-5 shrink-0 text-success-soft-foreground"
                aria-hidden
              />
            ) : (
              <AlertTriangleIcon
                className="size-5 shrink-0 text-destructive-soft-foreground"
                aria-hidden
              />
            )}
            <span data-testid="stop-strip">
              {delivered
                ? completedAt
                  ? stopText(tNext, locale, "deliveredStrip", { time: fmtTime(completedAt) })
                  : t("doneDelivered")
                : stopText(tNext, locale, "problemStrip")}
            </span>
            {canUndo ? (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void undo(stop.id, stop.customerName)}
                  data-testid="strip-undo"
                  className="inline-flex min-h-12 items-center gap-1.5 rounded-md px-1 text-base font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Undo2Icon className="size-5 shrink-0" aria-hidden />
                  {t("undo")}
                </button>
              </>
            ) : null}
          </p>
          {next ? (
            <Button asChild size="xl" className="w-full">
              <Link
                href={`/driver/stops/${next.id}`}
                data-testid="next-stop-action"
                aria-label={stopText(tNext, locale, "nextStop", { number: next.sequence })}
              >
                <ChevronRightIcon className="size-6" aria-hidden />
                {stopText(tNext, locale, "nextStop", { number: next.sequence })}
              </Link>
            </Button>
          ) : (
            <Button asChild size="xl" variant="outline" className="w-full">
              <Link href="/driver" data-testid="back-to-tour-action">
                {stopText(tNext, locale, "backToTourAction")}
              </Link>
            </Button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <section
        // Empty unless there is an offline hint or an error: then it takes no room in the column.
        className="space-y-3 empty:hidden"
        data-testid="stop-actions"
        aria-label={t("actionsLabel")}
      >
        {offline ? (
          <p
            className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-base font-semibold text-warning-soft-foreground"
            data-testid="status-offline-notice"
          >
            <WifiOffIcon className="size-5 shrink-0" aria-hidden />
            {t("offlineNotice")}
          </p>
        ) : null}
        {error && !sheetOpen ? (
          <p
            role="alert"
            className="text-base font-medium text-destructive"
            data-testid="status-error"
          >
            {error}
          </p>
        ) : null}
      </section>

      {/* Action card (re-design.md §7.1/§7.3): two rows on purpose — "Problem" must never be hit
          by accident. It sits at the end of the stop in the page flow, as a card like the sections
          above it (review 2026-10-31: the fixed bar read as a misplaced band over the content). */}
      <div className="space-y-2 rounded-xl border bg-card p-4" data-testid="stop-action-bar">
        <Button
          type="button"
          variant="success"
          size="xl"
          className="w-full text-lg font-bold"
          loading={busy}
          onClick={() => void complete("delivered")}
          data-testid="btn-delivered"
        >
          <CheckIcon className="size-7" aria-hidden />
          {t("delivered")}
        </Button>
        <Button
          type="button"
          variant="warning"
          size="lg"
          className="min-h-14 w-full text-lg font-bold disabled:border-muted-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
          disabled={busy}
          onClick={() => {
            setError(null);
            setSheetOpen(true);
          }}
          data-testid="btn-problem"
        >
          <AlertTriangleIcon className="size-6" aria-hidden />
          {t("problem")}
        </Button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
          data-testid="problem-sheet"
        >
          <SheetHeader className="shrink-0 pe-14">
            <SheetTitle className="text-2xl">{t("problemTitle")}</SheetTitle>
            <SheetDescription>{t("problemDescription")}</SheetDescription>
          </SheetHeader>
          {/*
           * The body is the only scrolling region (design review point 6). The sheet's `max-h`
           * comes from the viewport (`dvh`), so the seven reason chips, the textarea and the actions
           * below all stay reachable at 375 x 667 — in German as well as in Czech or Chinese.
           */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1">
            <div className="space-y-4">
              <div
                role="group"
                aria-label={t("problemTitle")}
                className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2"
                data-testid="problem-reasons"
              >
                {PROBLEM_REASONS.map((value) => {
                  const Icon = REASON_ICONS[value];
                  const selected = reason === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setReason(value)}
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-lg border p-3 text-start text-base font-semibold outline-none transition-[background-color,border-color,transform] duration-[140ms] ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[.97]",
                        value === "OTHER" && "col-span-full",
                        selected
                          ? "border-foreground bg-primary text-primary-foreground"
                          : "border-input/60 bg-card hover:border-input hover:bg-muted/60",
                      )}
                      data-testid={`reason-${value}`}
                    >
                      <Icon className="size-6 shrink-0" aria-hidden />
                      {/* No `break-words`: a long German word wraps at its own boundaries and is
                          hyphenated only when it does not fit (§9.3). 16 px (not 18 px) keeps
                          "Geschlossen" whole inside the 2-column chip grid at 375 px. */}
                      <span className="min-w-0 hyphens-auto" lang={locale}>
                        {tReasons(value)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <label className="block space-y-1.5">
                <span className="text-base font-semibold">{t("noteLabel")}</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={PROBLEM_NOTE_MAX}
                  rows={3}
                  placeholder={t("notePlaceholder")}
                  className="field block w-full resize-none rounded-lg border border-input bg-card p-3 text-base outline-none"
                  data-testid="problem-note"
                />
              </label>
              {error ? (
                <p
                  role="alert"
                  className="text-base font-medium text-destructive"
                  data-testid="sheet-error"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>
          {/* Fixed at the sheet's bottom edge: the thumb finds the actions without scrolling. */}
          <div className="grid shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              size="xl"
              variant="destructive"
              // Disabled stays readable (design review point 8): a token-based boundary and icon at
              // >= 3:1, muted text on the muted fill, no extra opacity on top and no tactile edge.
              className="text-lg font-bold disabled:border disabled:border-muted-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
              disabled={busy || reason === null}
              onClick={() => {
                if (!reason) return;
                const text = note.trim();
                void complete("problem", { reason, ...(text ? { note: text } : {}) });
              }}
              data-testid="problem-submit"
            >
              <AlertTriangleIcon className="size-6" aria-hidden />
              {t("submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-14 text-lg"
              disabled={busy}
              onClick={() => setSheetOpen(false)}
              data-testid="problem-cancel"
            >
              {t("cancel")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
