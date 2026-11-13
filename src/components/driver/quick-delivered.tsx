"use client";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { nextPendingAfter } from "@/domain/stop-status";
import { requestOfflineSync } from "@/lib/offline/browser";
import { enqueueMutation, undoStopStatus } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

const TOAST_MS = 10_000;

/**
 * "Delivered" straight from the next-stop card (NUD-195): the drivers who know the way do not need
 * the stop screen — one tap here marks the stop delivered and the card moves to the next stop.
 *
 * It is exactly the same tap as the big button of the stop screen: the mutation goes into the
 * offline outbox (IndexedDB) with its own `clientMutationId`, is retried when the connection is back
 * and cannot be booked twice; the list here is the overlaid copy, so the card moves on immediately.
 * The toast offers the undo for 10 s — except after the last stop, because completing the last stop
 * closes the tour and a completed tour cannot be reopened (NUD-053).
 */
export function QuickDeliveredButton({
  stop,
  stops,
  className,
}: {
  stop: { id: string; customerName: string };
  /** All stops of the tour (queued taps already applied): decides whether an undo is possible. */
  stops: ReadonlyArray<{ id: string; sequence: number; status: string }>;
  className?: string;
}) {
  const t = useTranslations("driver.status");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function undo(stopId: string, name: string) {
    try {
      const result = await undoStopStatus(stopId, name);
      if (!result || result === "none") return;
      requestOfflineSync();
      toast.success(t("undone"));
    } catch {
      toast.error(t("errors.storage"));
    }
  }

  async function tap() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await enqueueMutation({
        type: "delivered",
        stopId: stop.id,
        customerName: stop.customerName,
      });
      const next = nextPendingAfter(
        stops.map((s) => (s.id === stop.id ? { ...s, status: "DELIVERED" } : s)),
        stop.id,
      );
      toast(t("deliveredToast", { name: stop.customerName }), {
        duration: TOAST_MS,
        style: { fontSize: 16 },
        action: next
          ? { label: t("undo"), onClick: () => void undo(stop.id, stop.customerName) }
          : undefined,
        actionButtonStyle: { height: 48, minWidth: 48, fontSize: 16, padding: "0 16px" },
      });
    } catch {
      toast.error(t("errors.storage"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="success"
      size="xl"
      className={cn("relative z-10 shrink-0 text-lg font-bold whitespace-nowrap", className)}
      loading={busy}
      onClick={() => void tap()}
      data-testid="btn-quick-delivered"
    >
      <CheckIcon className="size-6" aria-hidden />
      {t("delivered")}
    </Button>
  );
}
