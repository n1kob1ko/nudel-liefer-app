"use client";

import { ArrowDownIcon, ArrowUpIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isStopMovable, mergePendingOrder } from "@/domain/tour-edit";
import { moveItem } from "@/domain/tour-plan";
import { isReReleasable } from "@/domain/tour-status";
import type { PlanTour, PlanTourTab, TourPlan } from "@/server/tour-planning";

const selectClass = "h-10 w-full field rounded-md border border-input bg-card px-3 text-base";

export type TourEditPayload = {
  driverId: string | null;
  vehicleId: string | null;
  orderedStopIds: string[];
  moves: Array<{ stopId: string; targetTourId: string }>;
};

/**
 * "Bearbeiten" (NUD-135, D29): one form for the driver of the tour, the order of its open stops and
 * the tour each open stop belongs to (the other tours of the same date). Completed stops are listed
 * as locked. The date is not part of the form. Saving is done by the planner (`onSave`), which owns
 * the server call and the error display, like the release dialogs.
 */
export function TourEditDialog({
  open,
  onOpenChange,
  plan,
  tour,
  pending,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: TourPlan;
  tour: PlanTour;
  pending: boolean;
  error: React.ReactNode;
  onSave: (payload: TourEditPayload) => void;
}) {
  const t = useTranslations("admin.tours");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-testid="edit-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
          <DialogDescription>{t("edit.description")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <EditForm
            // The form is rebuilt from the stored state each time it opens (it is unmounted when closed).
            key={tour.id}
            plan={plan}
            tour={tour}
            pending={pending}
            error={error}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  plan,
  tour,
  pending,
  error,
  onCancel,
  onSave,
}: {
  plan: TourPlan;
  tour: PlanTour;
  pending: boolean;
  error: React.ReactNode;
  onCancel: () => void;
  onSave: (payload: TourEditPayload) => void;
}) {
  const t = useTranslations("admin.tours");
  const tt = useTranslations("admin.tours.tabs");
  const tc = useTranslations("common");
  const [driverId, setDriverId] = useState(tour.driverId ?? "");
  const [vehicleId, setVehicleId] = useState(tour.vehicleId ?? "");
  // The pending stops in the requested order (also those that leave for another tour).
  const [order, setOrder] = useState(() => tour.stops.filter(isStopMovable).map((s) => s.id));
  const [targets, setTargets] = useState<Record<string, string>>({});

  const stopById = new Map(tour.stops.map((s) => [s.id, s]));
  const shown = (mergePendingOrder(tour.stops, new Set(), order) ?? []).map((id) =>
    stopById.get(id)!,
  );
  const otherTours = plan.tours.filter((x) => x.id !== tour.id && x.status !== "COMPLETED");
  const label = (tab: PlanTourTab) =>
    tab.driverName
      ? tt("withDriver", { number: tab.number, driver: tab.driverName })
      : tt("tour", { number: tab.number });
  const released = isReReleasable(tour.status);

  function move(id: string, by: number) {
    const from = order.indexOf(id);
    setOrder(moveItem(order, from, from + by));
  }

  function save() {
    const moves = order
      .filter((id) => targets[id])
      .map((id) => ({ stopId: id, targetTourId: targets[id] }));
    onSave({
      driverId: driverId || null,
      vehicleId: vehicleId || null,
      orderedStopIds: order.filter((id) => !targets[id]),
      moves,
    });
  }

  return (
    <>
      {released ? (
        <Alert variant="info" data-testid="edit-released-note">
          <AlertDescription>{t("edit.releasedNote")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-driver" className="text-sm font-medium">
          {t("driver")}
        </label>
        <select
          id="edit-driver"
          className={selectClass}
          value={driverId}
          disabled={pending}
          onChange={(e) => setDriverId(e.target.value)}
          data-testid="edit-driver"
        >
          <option value="" disabled={released}>
            {t("driverNone")}
          </option>
          {plan.drivers.map((d) => (
            <option key={d.id} value={d.id} disabled={!d.active && d.id !== tour.driverId}>
              {d.active ? d.displayName : t("driverInactive", { name: d.displayName })}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-vehicle" className="text-sm font-medium">
          {t("vehicle")}
        </label>
        <select
          id="edit-vehicle"
          className={selectClass}
          value={vehicleId}
          disabled={pending}
          onChange={(e) => setVehicleId(e.target.value)}
          data-testid="edit-vehicle"
        >
          {/* A released tour cannot lose its vehicle; an old one that never had a vehicle may stay without. */}
          <option value="" disabled={released && tour.vehicleId !== null}>
            {t("vehicleNone")}
          </option>
          {plan.vehicles.map((v) => (
            <option key={v.id} value={v.id} disabled={!v.active && v.id !== tour.vehicleId}>
              {v.active
                ? t("vehicleOption", { name: v.name, kg: v.capacityKg })
                : t("vehicleInactive", { name: v.name })}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">{t("stopsHeading")}</h3>
        <ol className="flex flex-col" data-testid="edit-stops">
          {shown.map((stop, index) => {
            const movable = isStopMovable(stop);
            const pendingIndex = order.indexOf(stop.id);
            return (
              <li
                key={stop.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0"
                data-testid="edit-stop"
                data-stop-id={stop.id}
                data-locked={movable ? undefined : "true"}
              >
                <span className="w-6 shrink-0 text-end text-sm tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 basis-48 flex-col">
                  <span className="truncate font-medium" data-testid="edit-stop-name">
                    {stop.name}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {stop.customerNumber} · {stop.street}, {stop.postalCode} {stop.city}
                  </span>
                </div>
                {movable ? (
                  <>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={pending || pendingIndex === 0}
                        aria-label={t("stop.moveUp", { name: stop.name })}
                        onClick={() => move(stop.id, -1)}
                        data-testid="edit-stop-up"
                      >
                        <ArrowUpIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={pending || pendingIndex === order.length - 1}
                        aria-label={t("stop.moveDown", { name: stop.name })}
                        onClick={() => move(stop.id, 1)}
                        data-testid="edit-stop-down"
                      >
                        <ArrowDownIcon aria-hidden />
                      </Button>
                    </div>
                    {otherTours.length > 0 ? (
                      <select
                        className={`${selectClass} sm:w-56`}
                        value={targets[stop.id] ?? ""}
                        disabled={pending}
                        aria-label={t("edit.tourOf", { name: stop.name })}
                        onChange={(e) => setTargets({ ...targets, [stop.id]: e.target.value })}
                        data-testid="edit-stop-tour"
                      >
                        <option value="">{t("edit.stay")}</option>
                        {otherTours.map((tab) => (
                          <option key={tab.id} value={tab.id}>
                            {t("edit.moveTo", { tour: label(tab) })}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </>
                ) : (
                  <Badge variant="outline" className="gap-1" data-testid="edit-stop-locked">
                    <LockIcon className="size-3.5" aria-hidden />
                    {t("edit.locked")}
                  </Badge>
                )}
              </li>
            );
          })}
        </ol>
        {otherTours.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="edit-no-other-tour">
            {t("edit.noOtherTour")}
          </p>
        ) : null}
      </div>

      {error}
      {/* Stays in view: a driver change must not need a scroll past twenty stops to be saved. */}
      <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 border-t border-border bg-card px-6 py-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("actions.cancel")}
        </Button>
        <Button type="button" onClick={save} disabled={pending} data-testid="edit-save">
          {pending ? t("edit.saving") : t("edit.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
