"use client";

import {
  CircleParkingIcon,
  CrosshairIcon,
  KeyboardIcon,
  LoaderCircleIcon,
  MapPinIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isValidLatLng, type LatLng, parseCoordinate, roundLatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { enqueueMutation } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

/** NUD-181: the customer's routing point, used as the map centre before a pin exists. */
export type ParkingStop = {
  id: string;
  customerName: string;
  lat?: number | null;
  lng?: number | null;
};

type Mode = "choose" | "locating" | "gps" | "manual" | "map";
type GpsProblem = "denied" | "unavailable" | "timeout" | "unsupported";

const NO_LABELS = {
  locate: "",
  locating: "",
  noAddress: "",
  notFound: "",
  failed: "",
  lowConfidence: "",
};

/**
 * "Parkplatz festlegen" (NUD-144, D27): the driver records where he parks at this customer. Two
 * ways: the device position (map with a draggable marker, confirm) or typed coordinates (comma
 * or point, range-checked, map preview). A refused or failed position switches to typing with a
 * clear message. Confirming queues the point in the offline outbox like a delivery tap; it is
 * saved without approval and is the navigation point at once when the customer had none.
 */
export function ParkingSetButton({
  stop,
  tiles,
  className,
}: {
  stop: ParkingStop;
  tiles: MapTileConfig;
  className?: string;
}) {
  const t = useTranslations("driver.parkingSet");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn("w-full", className)}
        onClick={() => setOpen(true)}
        data-testid="parking-set"
      >
        <CircleParkingIcon className="size-5" aria-hidden />
        {t("button")}
      </Button>
      {open ? <ParkingSheet stop={stop} tiles={tiles} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ParkingSheet({
  stop,
  tiles,
  onClose,
}: {
  stop: ParkingStop;
  tiles: MapTileConfig;
  onClose: () => void;
}) {
  const t = useTranslations("driver.parkingSet");
  const latId = useId();
  const lngId = useId();
  const [mode, setMode] = useState<Mode>("choose");
  // NUD-181 (QA 2026-10-29 F15): the map is a way of its own — the shared PinPickerMap with
  // click-to-place, centred on the customer. Before, the map only appeared once a point existed
  // (GPS or typed), so the man in the street had the worse tool than the office had.
  const fallbackCenter =
    stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : undefined;
  const [problem, setProblem] = useState<GpsProblem | null>(null);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function locate() {
    setProblem(null);
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setProblem("unsupported");
      setMode("manual");
      return;
    }
    setMode("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint(roundLatLng({ lat: position.coords.latitude, lng: position.coords.longitude }));
        setMode("gps");
      },
      (failure) => {
        setProblem(
          failure.code === failure.PERMISSION_DENIED
            ? "denied"
            : failure.code === failure.TIMEOUT
              ? "timeout"
              : "unavailable",
        );
        setMode("manual");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  function typed(nextLat: string, nextLng: string) {
    setLat(nextLat);
    setLng(nextLng);
    const a = parseCoordinate(nextLat);
    const b = parseCoordinate(nextLng);
    setPoint(
      a !== null && b !== null && isValidLatLng({ lat: a, lng: b })
        ? roundLatLng({ lat: a, lng: b })
        : null,
    );
  }

  const latValue = parseCoordinate(lat);
  const lngValue = parseCoordinate(lng);
  const latInvalid = lat.trim() !== "" && (latValue === null || Math.abs(latValue) > 90);
  const lngInvalid = lng.trim() !== "" && (lngValue === null || Math.abs(lngValue) > 180);
  const rangeError = latInvalid || lngInvalid;

  async function confirm() {
    if (!point || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueMutation({
        type: "parking",
        stopId: stop.id,
        lat: point.lat,
        lng: point.lng,
        customerName: stop.customerName,
      });
      toast.success(t("saved", { name: stop.customerName }));
      onClose();
    } catch {
      // IndexedDB unavailable (private mode): nothing was queued, say so.
      setError(t("errors.storage"));
      setBusy(false);
    }
  }

  const map =
    point || mode === "map" ? (
      <div
        className="relative isolate w-full overflow-hidden rounded-lg border [&_.leaflet-container]:h-[260px]!"
        data-testid="parking-map"
      >
        <PinPickerMapLazy
          value={point}
          fallbackCenter={fallbackCenter}
          onChange={(next) => {
            setPoint(next);
            if (mode === "manual" || mode === "map") {
              setLat(String(next.lat));
              setLng(String(next.lng));
            }
          }}
          tiles={tiles}
          markerKind="parking"
          labels={NO_LABELS}
        />
      </div>
    ) : null;

  const modeButton = (icon: React.ReactNode, label: string, onClick: () => void, id: string) => (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="min-h-14 justify-start gap-3 text-lg"
      onClick={onClick}
      data-testid={id}
    >
      {icon}
      {label}
    </Button>
  );

  const fieldClass =
    "block min-h-14 w-full field rounded-lg border border-input bg-card px-3 text-xl font-semibold outline-none aria-invalid:border-destructive";

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
        data-testid="parking-sheet"
      >
        <SheetHeader className="shrink-0 pe-14">
          <SheetTitle className="text-2xl">{t("title")}</SheetTitle>
          <SheetDescription>{t("description", { name: stop.customerName })}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-1 pb-4">
          {mode === "choose" ? (
            <div className="grid gap-2">
              {modeButton(
                <CrosshairIcon className="size-6" aria-hidden />,
                t("modeLocation"),
                locate,
                "parking-mode-gps",
              )}
              {modeButton(
                <KeyboardIcon className="size-6" aria-hidden />,
                t("modeManual"),
                () => setMode("manual"),
                "parking-mode-manual",
              )}
              {modeButton(
                <MapPinIcon className="size-6" aria-hidden />,
                t("modeMap"),
                () => setMode("map"),
                "parking-mode-map",
              )}
            </div>
          ) : null}

          {mode === "locating" ? (
            <p
              className="flex items-center gap-2 text-lg font-medium"
              role="status"
              data-testid="parking-locating"
            >
              <LoaderCircleIcon className="size-6 animate-spin" aria-hidden />
              {t("locating")}
            </p>
          ) : null}

          {mode === "gps" ? (
            <>
              <p className="text-base text-muted-foreground">{t("gpsHint")}</p>
              {map}
              <button
                type="button"
                className="min-h-12 text-base font-semibold underline underline-offset-4"
                onClick={() => {
                  setProblem(null);
                  setMode("manual");
                  if (point) {
                    setLat(String(point.lat));
                    setLng(String(point.lng));
                  }
                }}
                data-testid="parking-switch-manual"
              >
                {t("modeManual")}
              </button>
            </>
          ) : null}

          {mode === "map" ? (
            <>
              <p className="text-base text-muted-foreground" data-testid="parking-map-hint">
                {t("mapHint")}
              </p>
              {map}
              <button
                type="button"
                className="min-h-12 text-base font-semibold underline underline-offset-4"
                onClick={() => setMode("manual")}
                data-testid="parking-switch-manual-from-map"
              >
                {t("modeManual")}
              </button>
            </>
          ) : null}

          {mode === "manual" ? (
            <>
              {problem ? (
                <p
                  role="alert"
                  className="rounded-lg bg-warning-soft p-3 text-base font-medium text-warning-soft-foreground"
                  data-testid="parking-gps-problem"
                  data-problem={problem}
                >
                  {t(`gps.${problem}`)}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor={latId} className="block text-base font-semibold">
                    {t("latitude")}
                  </label>
                  <input
                    id={latId}
                    value={lat}
                    onChange={(event) => typed(event.target.value, lng)}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    aria-invalid={latInvalid || undefined}
                    className={fieldClass}
                    data-testid="parking-lat"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={lngId} className="block text-base font-semibold">
                    {t("longitude")}
                  </label>
                  <input
                    id={lngId}
                    value={lng}
                    onChange={(event) => typed(lat, event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    aria-invalid={lngInvalid || undefined}
                    className={fieldClass}
                    data-testid="parking-lng"
                  />
                </div>
              </div>
              {rangeError ? (
                <p
                  role="alert"
                  className="text-base font-medium text-destructive"
                  data-testid="parking-range-error"
                >
                  {t("invalid")}
                </p>
              ) : null}
              {map}
            </>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="text-base font-medium text-destructive"
              data-testid="parking-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            size="xl"
            disabled={!point || busy || mode === "choose" || mode === "locating"}
            onClick={() => void confirm()}
            data-testid="parking-confirm"
          >
            {t("confirm")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 text-lg"
            disabled={busy}
            onClick={onClose}
            data-testid="parking-cancel"
          >
            {t("cancel")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
