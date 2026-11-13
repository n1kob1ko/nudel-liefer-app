"use client";

import { RouteIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { planDayAction } from "@/server/tour-actions";
import type { TourPlan } from "@/server/tour-planning";

/**
 * "Touren planen" (NUD-147, D24): the office picks the vehicles and drivers that are available for
 * the day (default: all active ones); the server distributes the day's stops across the vehicles by
 * capacity and adds reload trips where the load still does not fit. With fewer drivers than
 * vehicles a driver switches into the next loaded vehicle at the depot (NUD-158). Unreleased tours
 * of the day are rebuilt.
 */
export function PlanDayDialog({
  plan,
  disabled = false,
  variant = "outline",
}: {
  plan: TourPlan;
  disabled?: boolean;
  variant?: "outline" | "primary";
}) {
  const t = useTranslations("admin.tours");
  const tc = useTranslations("common");
  const ts = useTranslations("admin.settings");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const vehicles = plan.vehicles.filter((v) => v.active);
  const drivers = plan.drivers.filter((d) => d.active);
  const [open, setOpen] = useState(false);
  // Everything is selected by default; the state holds only what the office switched off, so a
  // vehicle added meanwhile is selected too.
  const [offVehicles, setOffVehicles] = useState<string[]>([]);
  const [offDrivers, setOffDrivers] = useState<string[]>([]);
  const vehicleIds = vehicles.map((v) => v.id).filter((id) => !offVehicles.includes(id));
  const driverIds = drivers.map((d) => d.id).filter((id) => !offDrivers.includes(id));
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [maxStops, setMaxStops] = useState(0);

  const toggle = (list: string[], set: (next: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function submit() {
    setErrorCode(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof planDayAction>>;
      try {
        result = await planDayAction({ date: plan.date, vehicleIds, driverIds });
      } catch {
        return setErrorCode("generic");
      }
      if (!result.ok) {
        setMaxStops(result.maxStops ?? 0);
        setErrorCode(result.error);
        if (result.error === "conflict" || result.error === "tour_not_editable") router.refresh();
        return;
      }
      setOpen(false);
      toast.success(
        result.vehicleSwitches > 0
          ? t("planDay.toast.plannedSwitch", {
              count: result.tours.length,
              switches: result.vehicleSwitches,
              reloads: result.reloadTrips,
            })
          : result.reloadTrips > 0
            ? t("planDay.toast.plannedReload", {
                count: result.tours.length,
                reloads: result.reloadTrips,
              })
            : t("planDay.toast.planned", { count: result.tours.length }),
      );
      if (result.deferred.length > 0) {
        toast.warning(t("toast.deferred", { count: result.deferred.length }), {
          duration: 15_000,
        });
      }
      if (result.oversizedCustomerIds.length > 0) {
        toast.warning(t("planDay.toast.oversized", { count: result.oversizedCustomerIds.length }));
      }
      // Show the first planned tour (the default tour would be the newest, possibly an emptied one).
      const first = result.tours[0];
      if (first) {
        router.push({ pathname: "/admin/tours", query: { date: plan.date, tour: first.tourId } });
      }
      router.refresh();
    });
  }

  const errorText = (code: string) => {
    if (code === "depot_not_set") return ts("errors.depotNotSet");
    return t.has(`errors.${code}`) ? t(`errors.${code}`, { max: maxStops }) : t("errors.generic");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          disabled={disabled}
          title={t("planDay.hint")}
          data-testid="tour-plan-day"
        >
          <RouteIcon aria-hidden />
          {t("planDay.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="plan-day-dialog">
        <DialogHeader>
          <DialogTitle>{t("planDay.title")}</DialogTitle>
          <DialogDescription>{t("planDay.description")}</DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">{t("planDay.vehicles")}</legend>
          {vehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="plan-day-no-vehicles">
              {t("planDay.noVehicles")}
            </p>
          ) : (
            vehicles.map((v) => (
              <label key={v.id} className="flex min-h-10 items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="size-5 accent-foreground"
                  checked={vehicleIds.includes(v.id)}
                  disabled={pending}
                  onChange={() => toggle(offVehicles, setOffVehicles, v.id)}
                  data-testid="plan-day-vehicle"
                  data-vehicle-id={v.id}
                />
                <span>
                  {v.name}
                  {v.plate ? ` (${v.plate})` : ""}
                </span>
                <span className="ms-auto tabular-nums text-muted-foreground">
                  {t("planDay.capacity", { capacity: format.number(v.capacityKg) })}
                </span>
              </label>
            ))
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">{t("planDay.drivers")}</legend>
          <p className="text-sm text-muted-foreground">{t("planDay.driversHint")}</p>
          {drivers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("planDay.noDrivers")}</p>
          ) : (
            drivers.map((d) => (
              <label key={d.id} className="flex min-h-10 items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="size-5 accent-foreground"
                  checked={driverIds.includes(d.id)}
                  disabled={pending}
                  onChange={() => toggle(offDrivers, setOffDrivers, d.id)}
                  data-testid="plan-day-driver"
                  data-driver-id={d.id}
                />
                {d.displayName}
              </label>
            ))
          )}
        </fieldset>

        <p className="text-sm text-muted-foreground">{t("planDay.replaceNote")}</p>
        {errorCode ? (
          <Alert variant="destructive" data-testid="plan-day-error" data-code={errorCode}>
            <AlertDescription>{errorText(errorCode)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || vehicleIds.length === 0}
            data-testid="plan-day-confirm"
          >
            {pending ? t("planDay.planning") : t("planDay.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
