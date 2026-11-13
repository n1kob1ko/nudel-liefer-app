"use client";

import { ScaleIcon, TriangleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { loadState, worstTripLoad } from "@/domain/vehicle";
import { cn } from "@/lib/utils";

/**
 * Load indicator of a tour (NUD-146): the weight of everything on the stops against the capacity of
 * the tour's vehicle. Red, with the text "Überladen um N kg" (never colour alone), when the load is
 * above the capacity; without a vehicle only the load is shown.
 */
export function TourLoad({
  loadKg,
  tripLoadsKg = [],
  capacityKg,
  vehicleName,
  tripVehicles = [],
}: {
  loadKg: number;
  /** Kilograms per trip (NUD-147); with more than one entry the capacity applies to each trip. */
  tripLoadsKg?: number[];
  capacityKg: number | null;
  vehicleName: string | null;
  /**
   * Vehicle of each trip (NUD-158: after a vehicle switch another one); a missing entry is the
   * tour's vehicle (`capacityKg`, `vehicleName`).
   */
  tripVehicles?: ReadonlyArray<{ name: string; capacityKg: number } | null>;
}) {
  const t = useTranslations("admin.tours.load");
  const format = useFormatter();
  const kg = (value: number) => format.number(value, { maximumFractionDigits: 2 });
  const trips = tripLoadsKg.length > 1 ? tripLoadsKg : null;
  // Reload trips: each trip against the vehicle that carries it; the worst trip decides.
  const capacityOf = (index: number) =>
    tripVehicles[index] ? tripVehicles[index].capacityKg : capacityKg;
  const switches = trips
    ? trips.some((_, i) => tripVehicles[i]?.name !== tripVehicles[0]?.name)
    : false;
  const state = trips
    ? worstTripLoad(
        trips,
        trips.map((_, i) => capacityOf(i)),
      )
    : loadState(loadKg, capacityKg);
  const over = state.status === "over";
  return (
    <div
      className={cn(
        // A cell of the tour summary (redesign RD2): no frame of its own.
        "flex h-full flex-col gap-2 px-4 py-3",
        over && "bg-destructive/5",
      )}
      data-testid="tour-load"
      data-state={state.status}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ScaleIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm text-muted-foreground">{t("label")}</span>
        {state.status === "none" ? (
          <span className="font-semibold tabular-nums" data-testid="tour-load-text">
            {t("noVehicle", { load: kg(loadKg) })}
          </span>
        ) : (
          <>
            <span className="text-base font-semibold tabular-nums" data-testid="tour-load-text">
              {trips
                ? t("tripsTotal", { load: kg(loadKg), count: trips.length })
                : t("value", { load: kg(loadKg), capacity: kg(state.capacityKg ?? 0) })}
            </span>
            {vehicleName && !switches ? (
              <span className="text-sm text-muted-foreground">{vehicleName}</span>
            ) : null}
            {over ? (
              <span
                className="inline-flex items-center gap-1 text-sm font-semibold text-destructive"
                data-testid="tour-load-over"
              >
                <TriangleAlertIcon className="size-4" aria-hidden />
                {t("over", { over: kg(state.overKg) })}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground" data-testid="tour-load-percent">
                {t("percent", { percent: state.percent })}
              </span>
            )}
          </>
        )}
      </div>
      {trips ? (
        <ul className="flex flex-col gap-0.5 text-sm tabular-nums" data-testid="tour-load-trips">
          {trips.map((tripKg, index) => {
            const tripCapacity = capacityOf(index);
            const tripOver = tripCapacity !== null && tripKg > tripCapacity;
            const name = switches ? (tripVehicles[index]?.name ?? vehicleName) : null;
            return (
              <li
                key={index}
                className={cn(tripOver && "font-semibold text-destructive")}
                data-testid="tour-load-trip"
                data-over={tripOver ? "true" : undefined}
              >
                {tripCapacity === null
                  ? t("tripNoCapacity", { n: index + 1, load: kg(tripKg) })
                  : t("trip", { n: index + 1, load: kg(tripKg), capacity: kg(tripCapacity) })}
                {name ? ` · ${name}` : null}
                {tripOver ? ` · ${t("over", { over: kg(tripKg - tripCapacity) })}` : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {state.status !== "none" ? (
        <div
          role="progressbar"
          aria-label={t("bar")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(state.percent, 100)}
          aria-valuetext={
            over ? t("over", { over: kg(state.overKg) }) : t("percent", { percent: state.percent })
          }
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.min(state.percent, 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
