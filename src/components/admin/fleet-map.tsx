"use client";

import { useFormatter, useTranslations } from "next-intl";

import { TourMapLazy } from "@/components/maps/lazy";
import { stopTone } from "@/components/shared/status";
import { StopNumberBadge } from "@/components/shared/stop-number-badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { DriverRow } from "@/domain/day-overview";
import type { LatLng } from "@/lib/coords";
import { createAppFormatters } from "@/lib/format";
import type { MapTileConfig } from "@/lib/map-config";

export type FleetRow = Pick<DriverRow, "tourId" | "number" | "driverName" | "phase" | "lastStop">;

/**
 * "Wo sind die Fahrer?" (redesign RD2, step 3): one marker per driver at the stop he ticked off
 * last, numbered like his tour. The app has no live GPS, and the card says so in its subtitle. The
 * list below the map says the same in words, so the map is never the only carrier.
 *
 * Finished tours are left out: that driver is back at the depot.
 */
export function FleetMap({
  rows,
  timezone,
  depot,
  tiles,
}: {
  rows: readonly FleetRow[];
  timezone: string;
  depot: (LatLng & { label?: string }) | null;
  tiles: MapTileConfig;
}) {
  const t = useTranslations("admin.dashboard.board");
  const fmt = createAppFormatters(useFormatter(), timezone);
  const seen = rows.filter(
    (row): row is FleetRow & { lastStop: NonNullable<FleetRow["lastStop"]> } =>
      row.phase !== "done" && row.lastStop !== null,
  );
  const name = (row: FleetRow) => row.driverName ?? t("tourNumber", { number: row.number });

  return (
    <Card className="gap-3 py-4" data-testid="fleet-card" aria-labelledby="fleet-title">
      <CardHeader className="px-4">
        <h2 id="fleet-title" className="text-lg font-semibold tracking-tight">
          {t("mapTitle")}
        </h2>
        <CardDescription>{t("mapHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {seen.length === 0 ? (
          <p className="text-base text-muted-foreground" data-testid="fleet-empty">
            {t("mapEmpty")}
          </p>
        ) : (
          <>
            <TourMapLazy
              className="overflow-hidden rounded-lg [&_.leaflet-container]:h-72"
              stops={seen.flatMap((row) =>
                row.lastStop.lat !== null && row.lastStop.lng !== null
                  ? [
                      {
                        id: row.tourId,
                        sequence: row.number,
                        lat: row.lastStop.lat,
                        lng: row.lastStop.lng,
                        label: `${name(row)} · ${row.lastStop.name}`,
                        status: row.lastStop.status,
                      },
                    ]
                  : [],
              )}
              depot={depot}
              tiles={tiles}
            />
            <ul className="flex flex-col gap-2">
              {seen.map((row) => (
                <li
                  key={row.tourId}
                  data-testid="fleet-place"
                  className="flex items-center gap-3 text-sm"
                >
                  <StopNumberBadge
                    number={row.number}
                    tone={stopTone(row.lastStop.status)}
                    label={t("tourNumber", { number: row.number })}
                    className="scale-75"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{name(row)}</span>
                    <span className="truncate text-muted-foreground">
                      {row.lastStop.name}, {fmt.time(row.lastStop.at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
