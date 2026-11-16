"use client";

import { ClipboardCheckIcon, WarehouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * Reload stop (NUD-147): shown between the last stop of one trip and the first stop of the next.
 * The vehicle returns to the depot. The card names the trip only, not the quantities to load: the
 * driver sees what a customer gets at that customer's stop, never totals (owner 2026-11-16). What
 * goes into the vehicle is on the office's load sheet.
 */
export function ReloadStop({
  trip,
  switchTo = null,
  onChecklist,
}: {
  trip: number;
  /**
   * NUD-158: the next trip has another vehicle, already loaded at the depot: the driver changes
   * into it instead of reloading.
   */
  switchTo?: string | null;
  /** Opens the checklist of this trip (NUD-151); without it the card has no button. */
  onChecklist?: () => void;
}) {
  const t = useTranslations("driver");
  return (
    <li
      className="my-1 rounded-lg bg-warning-soft p-3 text-warning-soft-foreground"
      data-testid="reload-stop"
      data-trip={trip}
      data-switch={switchTo ? "true" : undefined}
    >
      <p className="flex items-center gap-2 text-lg font-semibold">
        <WarehouseIcon className="size-6 shrink-0" aria-hidden />
        {switchTo ? t("today.switchTitle") : t("today.reloadTitle")}
      </p>
      <p className="mt-1 text-base">
        {switchTo
          ? t("today.switchHint", { trip, vehicle: switchTo })
          : t("today.reloadHint", { trip })}
      </p>
      {onChecklist ? (
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="mt-3 w-full"
          onClick={onChecklist}
          data-testid="reload-checklist"
        >
          <ClipboardCheckIcon className="size-5" aria-hidden />
          {t("departure.checklistButton")}
        </Button>
      ) : null}
    </li>
  );
}
