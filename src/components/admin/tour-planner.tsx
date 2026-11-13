"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ClockIcon,
  GripVerticalIcon,
  ImageOffIcon,
  InfoIcon,
  LockIcon,
  LockOpenIcon,
  MapPinIcon,
  MapPinOffIcon,
  PencilIcon,
  PrinterIcon,
  RefreshCwIcon,
  RocketIcon,
  RouteIcon,
  TriangleAlertIcon,
  UserIcon,
  WarehouseIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { TourMapLazy } from "@/components/maps/lazy";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { ProgressBar } from "@/components/shared/progress-bar";
import { EmptyState } from "@/components/shared/states";
import {
  stopIcon,
  stopTone,
  stopToneWithNext,
  toneClasses,
  tourIcon,
  tourTone,
} from "@/components/shared/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { StopNumberBadge } from "@/components/shared/stop-number-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { StatTile } from "@/components/ui/stat-tile";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { canEditTour } from "@/domain/tour-edit";
import { durationParts, isTourEditable, moveItem, releaseBlocker } from "@/domain/tour-plan";
import { isLiveStatus, showsStopResults, summarizeProgress } from "@/domain/tour-progress";
import { isReReleasable } from "@/domain/tour-status";
import { worstTripLoad } from "@/domain/vehicle";
import { Link, useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";
import {
  assignDriverAction,
  assignVehicleAction,
  editTourAction,
  generateTourAction,
  releaseTourAction,
  reorderStopsAction,
  reReleaseTourAction,
  setTourLockedAction,
} from "@/server/tour-actions";
import type { PlanStop, TourPlan } from "@/server/tour-planning";

import { LateOrdersBanner, TourTabs } from "./late-orders-banner";
import { PlanDayDialog } from "./plan-day-dialog";
import { ProblemNote } from "./problem-note";
import { ShiftWarning } from "./shift-warning";
import { TourDiffList } from "./tour-diff-list";
import { TourEditDialog, type TourEditPayload } from "./tour-edit-dialog";
import { TourLoad } from "./tour-load";

const selectClass = "h-10 min-w-56 field rounded-md border border-input bg-card px-3 text-base";

/**
 * One compact KPI row at ≥ 1280 px (round-3 review: two rows of full-height tiles filled the whole
 * 1280×800 viewport, so the map and the stop list started below the fold). `StatTile` is a shared
 * kit component and has no density prop, so the strip scales its internals down from the outside —
 * the arbitrary variants win on specificity, not on class order.
 */
const KPI_TILE = "xl:[&_span.text-3xl]:text-lg xl:[&_.size-10]:size-8 xl:[&_svg]:size-4";

/** The four office steps (re-design.md §8.4); a released tour is on step 3 of 4. */
const TOUR_STEPS = [
  { id: "DRAFT", label: "draft" },
  { id: "OPTIMIZED", label: "assigned" },
  { id: "RELEASED", label: "released" },
  { id: "COMPLETED", label: "completed" },
] as const;

function stepIndex(status: string): number {
  if (status === "DRAFT") return 0;
  if (status === "OPTIMIZED" || status === "PLANNED") return 1;
  if (status === "RELEASED" || status === "IN_PROGRESS") return 2;
  if (status === "COMPLETED") return 3;
  return 0;
}

/** Up to two initials for a name ("Anna Berger" -> "AB"); empty string for an empty name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

/**
 * Planning screen of one delivery day (NUD-042): generate, review on the map and in the ordered
 * list, reorder (drag and drop, or the up / down buttons), re-optimize, lock, assign a driver and
 * release. All state-changing calls are server actions (ADMIN only); the page re-reads the plan
 * after every change, so what is shown is what is stored.
 *
 * Presentation follows re-design.md §8.4: status stepper, KPI strip, sticky map beside a compact
 * stop list (rows and markers highlight each other) and the released notice as an info alert.
 * Behaviour, server actions and every test id stay unchanged.
 */
export function TourPlanner({
  plan,
  tiles,
  pollIntervalMs,
}: {
  plan: TourPlan;
  tiles: MapTileConfig;
  /** How often a live (released / in progress) tour is re-read from the server. */
  pollIntervalMs: number;
}) {
  const t = useTranslations("admin.tours");
  const ts = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const tm = useTranslations("maps");
  const format = useFormatter();
  const locale = useLocale();
  const fmt = createAppFormatters(format, plan.timezone);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { tour } = plan;

  // Local, not yet confirmed state; dropped as soon as the server rendered a new tour version.
  const [syncKey, setSyncKey] = useState(tour?.version ?? "");
  const [order, setOrder] = useState<string[] | null>(null);
  const [driverValue, setDriverValue] = useState(tour?.driverId ?? "");
  const [vehicleValue, setVehicleValue] = useState(tour?.vehicleId ?? "");
  const [overrideOverload, setOverrideOverload] = useState(false);
  const [error, setError] = useState<{ code: string; max?: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [reReleaseOpen, setReReleaseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // List <-> map linkage (re-design.md §6): purely visual, it never changes the stored plan.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  if ((tour?.version ?? "") !== syncKey) {
    setSyncKey(tour?.version ?? "");
    setOrder(null);
    setDriverValue(tour?.driverId ?? "");
    setVehicleValue(tour?.vehicleId ?? "");
  }

  // Tapping a marker brings the matching row into view.
  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const errorText = (code: string, max?: number) => {
    if (code === "depot_not_set") return ts("errors.depotNotSet");
    return t.has(`errors.${code}`) ? t(`errors.${code}`, { max: max ?? 0 }) : t("errors.generic");
  };

  /** Runs one server call; `onOk` runs for `{ok: true}`, anything else is shown as an error. */
  function run<R extends { ok: boolean }>(
    call: () => Promise<R>,
    onOk: (result: Extract<R, { ok: true }>) => void,
    onFail?: (code: string) => void,
  ) {
    setError(null);
    startTransition(async () => {
      let result: R;
      try {
        result = await call();
      } catch {
        onFail?.("generic");
        return setError({ code: "generic" });
      }
      if (!result.ok) {
        const failure = result as unknown as { error: string; maxStops?: number };
        onFail?.(failure.error);
        setError({ code: failure.error, max: failure.maxStops });
        if (["stops_changed", "conflict", "tour_not_editable"].includes(failure.error)) {
          router.refresh();
        }
        return;
      }
      onOk(result as Extract<R, { ok: true }>);
    });
  }

  function generate() {
    run(
      () => generateTourAction({ date: plan.date }),
      (result) => {
        const r = result as unknown as {
          mode: string;
          stopCount: number;
          addedCustomerIds: string[];
          removedCustomerIds: string[];
          deferred: unknown[];
        };
        toast.success(
          r.mode === "locked_extended"
            ? t("toast.generatedLocked", {
                added: r.addedCustomerIds.length,
                removed: r.removedCustomerIds.length,
              })
            : t("toast.generated", { count: r.stopCount }),
        );
        if (r.deferred.length > 0) {
          toast.warning(t("toast.deferred", { count: r.deferred.length }), { duration: 15_000 });
        }
        router.refresh();
      },
    );
  }

  if (!tour) {
    return (
      <div className="flex flex-col gap-6">
        <Warnings plan={plan} />
        <Unplanned plan={plan} />
        <ErrorAlert error={error} errorText={errorText} />
        <EmptyState
          icon={RouteIcon}
          title={t("noTourTitle")}
          description={t("noTourBody", { count: plan.confirmedOrderCount })}
        >
          <Button
            type="button"
            onClick={generate}
            disabled={pending || plan.confirmedOrderCount === 0}
            data-testid="tour-generate"
          >
            <RouteIcon aria-hidden />
            {pending ? t("generating") : t("generate")}
          </Button>
          <PlanDayDialog plan={plan} disabled={pending || plan.confirmedOrderCount === 0} />
        </EmptyState>
      </div>
    );
  }

  const editable = isTourEditable(tour.status);
  const results = showsStopResults(tour.status);
  const progress = summarizeProgress(tour.stops);
  const stopById = new Map(tour.stops.map((s) => [s.id, s]));
  const stops: PlanStop[] = order
    ? order.flatMap((id) => (stopById.get(id) ? [stopById.get(id)!] : []))
    : tour.stops;
  const recalculating = order !== null;
  const locked = tour.locked;
  const busy = pending || recalculating;
  const blocker = releaseBlocker({
    status: tour.status,
    stopCount: tour.stops.length,
    driverId: driverValue || null,
    vehicleId: vehicleValue || null,
    isOutdated: tour.isOutdated,
  });
  const driver = plan.drivers.find((d) => d.id === (driverValue || tour.driverId));
  const vehicle = plan.vehicles.find((v) => v.id === (vehicleValue || tour.vehicleId));
  // With reload trips (NUD-147) the capacity applies to each trip, against the vehicle that drives
  // it (NUD-158: after a vehicle switch that is another one); the worst trip is compared.
  const tripVehicles = (tour.tripLoadsKg.length > 0 ? tour.tripLoadsKg : [tour.loadKg]).map(
    (_, index) =>
      plan.vehicles.find((v) => v.id === (tour.tripVehicleIds[index] ?? vehicle?.id)) ?? null,
  );
  const load = worstTripLoad(
    tour.tripLoadsKg.length > 0 ? tour.tripLoadsKg : [tour.loadKg],
    tripVehicles.map((v) => v?.capacityKg ?? null),
  );
  const heaviestTripKg = load.loadKg;
  const duration = durationParts(tour.totalDurationS ?? 0);
  // "Gesamtdauer 0 Min." next to "Strecke —" claimed a value the routing data does not have (the
  // round-3 review: the tour was released without any routing result). Without a duration the tile
  // says so, exactly like the distance tile next to it.
  const durationText = tour.totalDurationS === null ? "–" : t("summary.durationValue", duration);
  const currentStep = stepIndex(tour.status);
  const hasStops = tour.stops.length > 0;

  function applyOrder(next: string[]) {
    setOrder(next);
    run(
      () => reorderStopsAction({ tourId: tour!.id, orderedStopIds: next }),
      (result) => {
        const r = result as unknown as { changed: boolean };
        if (!r.changed) return setOrder(null);
        toast.success(t("toast.reordered"));
        router.refresh();
      },
      () => setOrder(null),
    );
  }

  function move(id: string, to: number) {
    const ids = stops.map((s) => s.id);
    const from = ids.indexOf(id);
    if (from < 0 || from === to || to < 0 || to >= ids.length) return;
    applyOrder(moveItem(ids, from, to));
  }

  function toggleLock() {
    run(
      () => setTourLockedAction({ tourId: tour!.id, locked: !locked }),
      () => {
        toast.success(locked ? t("toast.unlocked") : t("toast.locked"));
        router.refresh();
      },
    );
  }

  function changeDriver(id: string) {
    setDriverValue(id);
    run(
      () => assignDriverAction({ tourId: tour!.id, driverId: id || null }),
      () => {
        toast.success(id ? t("toast.driverSet") : t("toast.driverCleared"));
        router.refresh();
      },
      () => setDriverValue(tour!.driverId ?? ""),
    );
  }

  function changeVehicle(id: string) {
    setVehicleValue(id);
    run(
      () => assignVehicleAction({ tourId: tour!.id, vehicleId: id || null }),
      () => {
        toast.success(id ? t("toast.vehicleSet") : t("toast.vehicleCleared"));
        router.refresh();
      },
      () => setVehicleValue(tour!.vehicleId ?? ""),
    );
  }

  function edit(payload: TourEditPayload) {
    run(
      () => editTourAction({ tourId: tour!.id, version: tour!.version, ...payload }),
      (result) => {
        const r = result as unknown as { changed: boolean; revision: number };
        setEditOpen(false);
        toast.success(
          !r.changed
            ? t("edit.toast.nothingChanged")
            : isReReleasable(tour!.status)
              ? t("edit.toast.savedReleased", { revision: r.revision })
              : t("edit.toast.saved"),
        );
        router.refresh();
      },
      // The page is out of date: close the form; the page is re-read and shows the error. Any other
      // refusal (inactive driver, customer already on the target tour) keeps the form for a fix.
      (code) => {
        if (["stops_changed", "conflict", "tour_not_editable", "not_found"].includes(code)) {
          setEditOpen(false);
        }
      },
    );
  }

  function release() {
    run(
      () =>
        releaseTourAction({
          tourId: tour!.id,
          version: tour!.version,
          ...(load.status === "over" && overrideOverload ? { overrideOverload: true } : {}),
        }),
      () => {
        setReleaseOpen(false);
        toast.success(t("toast.released"));
        router.refresh();
      },
      (code) => {
        // An overload is answered in the dialog (checkbox); every other refusal closes it.
        if (code !== "overloaded") setReleaseOpen(false);
      },
    );
  }

  function reRelease() {
    run(
      () => reReleaseTourAction({ tourId: tour!.id, version: tour!.version }),
      (result) => {
        const r = result as unknown as {
          changed: boolean;
          revision: number;
          completedChanged: number;
        };
        setReReleaseOpen(false);
        toast.success(
          r.changed
            ? t("change.toast.reReleased", { revision: r.revision })
            : t("change.toast.nothingChanged"),
        );
        if (r.completedChanged > 0) {
          toast.warning(t("change.toast.completedChanged", { count: r.completedChanged }));
        }
        router.refresh();
      },
      () => setReReleaseOpen(false),
    );
  }

  const changeBanner = tour.isOutdated && isReReleasable(tour.status);
  const diffEmpty =
    !tour.diff ||
    tour.diff.added.length +
      tour.diff.removed.length +
      tour.diff.changed.length +
      tour.diff.completedChanged.length ===
      0;

  const canEdit = canEditTour(tour.status);
  const editButton = canEdit ? (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        setError(null);
        setEditOpen(true);
      }}
      disabled={busy}
      aria-label={tc("actions.edit")}
      data-testid="tour-edit"
    >
      <PencilIcon aria-hidden />
      {tc("actions.edit")}
    </Button>
  ) : null;

  const printLink = (
    <Button asChild variant={editable ? "outline" : "primary"}>
      {/*
       * next-intl's `Link`, not a raw <a>: a root-absolute href is missing the deployment's base path
       * (/delivery-app), which is why "Ladeliste drucken" 404'd on the server (NUD-134). Opens in a new
       * tab so the planner stays where it was (owner request).
       */}
      <Link
        href={{ pathname: `/admin/tours/${tour.id}/print`, query: { locale } }}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="tour-print-link"
      >
        <PrinterIcon aria-hidden />
        {t("print.open")}
      </Link>
    </Button>
  );

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6" data-testid="tour-planner" data-tour-id={tour.id}>
        <LiveRefresh intervalMs={pollIntervalMs} enabled={isLiveStatus(tour.status)} />
        <TourTabs plan={plan} />
        <LateOrdersBanner plan={plan} />
        <Warnings plan={plan} />
        <Unplanned plan={plan} />
        <ShiftWarning
          warning={tour.shiftWarning}
          driverName={plan.drivers.find((d) => d.id === tour.driverId)?.displayName ?? null}
          timezone={plan.timezone}
        />
        <ErrorAlert error={error} errorText={errorText} />
        {tour.isOutdated && editable ? (
          <Alert variant="destructive" data-testid="tour-outdated">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>{t("outdatedTitle")}</AlertTitle>
            <AlertDescription>{t("outdatedBody")}</AlertDescription>
          </Alert>
        ) : null}

        {changeBanner ? (
          <Alert variant="destructive" data-testid="tour-changed-banner">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>{t("change.title")}</AlertTitle>
            <AlertDescription className="gap-3">
              <p>{diffEmpty ? t("change.noDifference") : t("change.body")}</p>
              {tour.diff && !diffEmpty ? <TourDiffList diff={tour.diff} /> : null}
              <div>
                <Button
                  type="button"
                  onClick={() => setReReleaseOpen(true)}
                  disabled={busy}
                  data-testid="tour-rerelease"
                >
                  <RocketIcon aria-hidden />
                  {t("change.button")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Header block (§8.4): state, stepper, the state's primary action and the tool row. */}
        <section className="flex flex-col gap-4" aria-label={t("title")}>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={tourTone(tour.status)} icon={tourIcon(tour.status)} size="lg">
              <span data-testid="tour-status">{tc(`statuses.tour.${tour.status}`)}</span>
            </StatusBadge>
            {locked ? (
              <Badge variant="outline" className="gap-1" data-testid="tour-locked-badge">
                <LockIcon className="size-3.5" aria-hidden />
                {t("lockedBadge")}
              </Badge>
            ) : null}
            {tour.releasedAt ? (
              <span className="text-sm text-muted-foreground" data-testid="tour-released-at">
                {t("releasedAt", { time: fmt.dateTime(new Date(tour.releasedAt)) })}
              </span>
            ) : null}
            {tour.reReleasedAt ? (
              <span className="text-sm text-muted-foreground" data-testid="tour-rereleased-at">
                {t("change.reReleasedAt", {
                  time: fmt.dateTime(new Date(tour.reReleasedAt)),
                  revision: tour.releaseRevision,
                })}
              </span>
            ) : null}
          </div>

          <StatusStepper current={currentStep} />

          <div className="flex flex-wrap items-center gap-2">
            {!editable ? (
              <>
                {editButton}
                {printLink}
              </>
            ) : hasStops ? (
              <>
                <Button
                  type="button"
                  onClick={() => {
                    setOverrideOverload(false);
                    setReleaseOpen(true);
                  }}
                  disabled={busy || blocker !== null}
                  data-testid="tour-release"
                >
                  <RocketIcon aria-hidden />
                  {t("release")}
                </Button>
                {editButton}
                {printLink}
              </>
            ) : (
              <>
                {editButton}
                <Button
                  type="button"
                  onClick={generate}
                  disabled={busy || plan.confirmedOrderCount === 0}
                  data-testid="tour-generate"
                >
                  <RouteIcon aria-hidden />
                  {pending ? t("generating") : t("generate")}
                </Button>
              </>
            )}
            {editable && (blocker === "driver_required" || blocker === "vehicle_required") ? (
              <p className="basis-full text-sm text-muted-foreground" data-testid="release-hint">
                {t(`errors.${blocker}`)}
              </p>
            ) : null}
          </div>

          {!editable ? (
            <Alert variant="info" data-testid="tour-readonly">
              <InfoIcon aria-hidden />
              <AlertTitle>{t("releasedNotice")}</AlertTitle>
              {driver || vehicle ? (
                <AlertDescription>
                  {driver ? `${t("driver")}: ${driver.displayName}` : null}
                  {driver && vehicle ? " · " : null}
                  {vehicle ? `${t("vehicle")}: ${vehicle.name}` : null}
                </AlertDescription>
              ) : null}
            </Alert>
          ) : (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <PlanDayDialog plan={plan} disabled={busy || locked} />
              <Button
                type="button"
                variant="outline"
                onClick={generate}
                disabled={busy}
                title={locked ? t("refreshLockedHint") : t("reoptimizeHint")}
                data-testid="tour-reoptimize"
              >
                <RefreshCwIcon aria-hidden />
                {locked ? t("refreshLocked") : t("reoptimize")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={toggleLock}
                disabled={busy}
                aria-pressed={locked}
                data-testid="tour-lock"
              >
                {locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
                {locked ? t("unlock") : t("lock")}
              </Button>
              <div className="flex flex-col gap-1">
                <label htmlFor="tour-driver" className="text-sm font-medium">
                  {t("driver")}
                </label>
                <select
                  id="tour-driver"
                  className={selectClass}
                  value={driverValue}
                  disabled={busy}
                  onChange={(e) => changeDriver(e.target.value)}
                  data-testid="tour-driver"
                >
                  <option value="">{t("driverNone")}</option>
                  {plan.drivers.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.active}>
                      {d.active ? d.displayName : t("driverInactive", { name: d.displayName })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="tour-vehicle" className="text-sm font-medium">
                  {t("vehicle")}
                </label>
                <select
                  id="tour-vehicle"
                  className={selectClass}
                  value={vehicleValue}
                  disabled={busy}
                  onChange={(e) => changeVehicle(e.target.value)}
                  data-testid="tour-vehicle"
                >
                  <option value="">{t("vehicleNone")}</option>
                  {plan.vehicles.map((v) => (
                    <option key={v.id} value={v.id} disabled={!v.active}>
                      {v.active
                        ? t("vehicleOption", { name: v.name, kg: v.capacityKg })
                        : t("vehicleInactive", { name: v.name })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>

        <TourLoad
          loadKg={tour.loadKg}
          tripLoadsKg={tour.tripLoadsKg}
          capacityKg={vehicle?.capacityKg ?? null}
          vehicleName={vehicle?.name ?? null}
          tripVehicles={tripVehicles.map((v) =>
            v ? { name: v.name, capacityKg: v.capacityKg } : null,
          )}
        />

        {/* KPI strip (§8.4): one row from 1280 px on so the map and the stop list stay above the
            fold (round-3 review); the "Näherungswerte" hint lives in a tooltip on Dauer / Strecke. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="tour-kpis">
          <StatTile
            label={t("stopsHeading")}
            value={tour.stops.length}
            icon={MapPinIcon}
            className={KPI_TILE}
          />
          <StatTile
            label={t("summary.duration")}
            value={durationText}
            sub={
              tour.approximate ? (
                <ApproximateHint
                  label={t("approximate")}
                  hint={t("approximateHint")}
                  testId="tour-approximate"
                />
              ) : undefined
            }
            icon={ClockIcon}
            tone="info"
            className={KPI_TILE}
          />
          <StatTile
            label={t("summary.distance")}
            value={
              tour.totalDistanceM !== null
                ? t("summary.distanceValue", {
                    km: format.number(tour.totalDistanceM / 1000, { maximumFractionDigits: 1 }),
                  })
                : "–"
            }
            sub={
              tour.approximate ? (
                // NUD-145: the same words as under "Gesamtdauer" instead of a bare warning icon —
                // an icon alone never explained what is approximate.
                <ApproximateHint
                  label={t("approximate")}
                  hint={t("approximateHint")}
                  testId="tour-approximate-distance"
                />
              ) : undefined
            }
            icon={RouteIcon}
            className={KPI_TILE}
          />
          <StatTile
            label={t("driver")}
            value={driver ? driver.displayName : t("driverNone")}
            sub={
              driver ? (
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                    toneClasses.primary,
                  )}
                >
                  {initials(driver.displayName)}
                </span>
              ) : undefined
            }
            icon={UserIcon}
            className={KPI_TILE}
          />
          <StatTile
            label={t("progress.shortLabel")}
            value={`${progress.done}/${progress.total}`}
            sub={t("progress.problems", { count: progress.problems })}
            icon={CircleDashedIcon}
            tone={progress.problems > 0 ? "destructive" : "neutral"}
            className={KPI_TILE}
          />
        </div>

        {hasStops ? (
          <div className="flex flex-col gap-2">
            {results ? (
              <ProgressBar
                delivered={progress.delivered}
                problems={progress.problems}
                total={progress.total}
                label={t("progress.label")}
                valueText={t("progress.summary", { done: progress.done, total: progress.total })}
              />
            ) : null}
            <p className="text-base font-medium" data-testid="tour-progress-text">
              {t("progress.summary", { done: progress.done, total: progress.total })}
              {" · "}
              {t("progress.problems", { count: progress.problems })}
            </p>
          </div>
        ) : null}

        {/* Two-pane body (§8.4): sticky map on the left, compact stop list on the right. */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
          <div
            className="xl:sticky xl:top-20 xl:self-start"
            aria-label={t("mapLabel")}
            data-testid="tour-map-pane"
          >
            <TourMapLazy
              className="[&_.leaflet-container]:h-80 xl:[&_.leaflet-container]:h-[calc(100vh-200px)] xl:[&_.leaflet-container]:min-h-[360px]"
              stops={stops.map((s, index) => ({
                id: s.id,
                sequence: index + 1,
                lat: s.lat,
                lng: s.lng,
                label: results ? `${s.name} · ${tc(`statuses.stop.${s.status}`)}` : s.name,
                status: results ? s.status : undefined,
                isNext: results && s.id === progress.nextStopId,
              }))}
              depot={
                tour.depot
                  ? { lat: tour.depot.lat, lng: tour.depot.lng, label: tour.depot.name }
                  : null
              }
              geometry={recalculating ? null : tour.geometry}
              tiles={tiles}
              selectedId={hoverId ?? selectedId}
              onSelect={setSelectedId}
              onHover={setHoverId}
              onClusterSelect={(ids) => setSelectedId(ids[0] ?? null)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="text-xl font-semibold">{t("stopsHeading")}</h2>
            <ol className="flex flex-col" data-testid="stop-list" aria-busy={recalculating}>
              {stops.map((stop, index) => {
                const next = results && stop.id === progress.nextStopId;
                // Reload trips (NUD-147): the boundaries are positions of the tour, so they stay put
                // while the list is reordered locally.
                const tripHere = tour.stops[index]?.trip ?? 1;
                const reloadBefore = index > 0 && tripHere > (tour.stops[index - 1]?.trip ?? 1);
                // NUD-158: another vehicle on the next trip = a vehicle switch, not a reload.
                const switchTo =
                  reloadBefore &&
                  (tour.tripVehicleIds[tripHere - 1] ?? null) !==
                    (tour.tripVehicleIds[tripHere - 2] ?? null)
                    ? tripVehicles[tripHere - 1]
                    : null;
                return (
                  <Fragment key={stop.id}>
                    {reloadBefore ? (
                      <li
                        className="flex min-h-14 items-center gap-3 border-b border-border bg-warning-soft px-2 py-2 text-warning-soft-foreground"
                        data-testid="reload-stop"
                        data-trip={tripHere}
                        data-switch={switchTo ? "true" : undefined}
                      >
                        <WarehouseIcon className="size-5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 font-medium">
                          {switchTo
                            ? t("reload.switchTitle", { vehicle: switchTo.name })
                            : t("reload.title")}
                        </span>
                        <span className="shrink-0 tabular-nums" data-testid="reload-load">
                          {t("reload.load", {
                            trip: tripHere,
                            load: format.number(tour.tripLoadsKg[tripHere - 1] ?? 0, {
                              maximumFractionDigits: 2,
                            }),
                          })}
                        </span>
                      </li>
                    ) : null}
                    <li
                      ref={(node) => {
                        if (node) rowRefs.current.set(stop.id, node);
                        else rowRefs.current.delete(stop.id);
                      }}
                      draggable={editable && !busy}
                      onMouseEnter={() => setHoverId(stop.id)}
                      onMouseLeave={() =>
                        setHoverId((current) => (current === stop.id ? null : current))
                      }
                      onFocus={() => setHoverId(stop.id)}
                      onBlur={() => setHoverId((current) => (current === stop.id ? null : current))}
                      onDragStart={(e) => {
                        setDragId(stop.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", stop.id);
                      }}
                      onDragOver={(e) => {
                        if (dragId) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId && dragId !== stop.id) move(dragId, index);
                        setDragId(null);
                      }}
                      onDragEnd={() => setDragId(null)}
                      className={cn(
                        "group flex min-h-14 items-center gap-3 border-b border-border px-2 py-2 transition-colors last:border-b-0",
                        next && "bg-primary-soft/50",
                        hoverId === stop.id && "bg-muted",
                        selectedId === stop.id && "ring-1 ring-ring ring-inset",
                        dragId === stop.id && "opacity-50",
                      )}
                      data-testid="stop-row"
                      data-stop-id={stop.id}
                      data-customer-id={stop.customerId}
                      data-sequence={index + 1}
                      data-status={results ? stop.status : undefined}
                    >
                      {editable ? (
                        <span className="flex w-5 shrink-0 justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <GripVerticalIcon
                            className="size-5 cursor-grab text-muted-foreground"
                            aria-label={t("stop.drag", { name: stop.name })}
                            role="img"
                            data-testid="stop-handle"
                          />
                        </span>
                      ) : null}

                      <StopNumberBadge
                        number={index + 1}
                        tone={stopToneWithNext(results ? stop.status : "PENDING", next)}
                        isNext={next}
                        label={tm("stopMarker", { n: index + 1, name: stop.name })}
                        data-testid="stop-number"
                      />

                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="min-w-0 flex-1 truncate font-medium"
                            data-testid="stop-name"
                          >
                            {stop.name}
                          </span>
                          {results ? (
                            <StatusBadge tone={stopTone(stop.status)} icon={stopIcon(stop.status)}>
                              <span data-testid="stop-status" data-status={stop.status}>
                                {tc(`statuses.stop.${stop.status}`)}
                              </span>
                            </StatusBadge>
                          ) : null}
                          <span
                            className="w-14 shrink-0 text-right text-base font-semibold tabular-nums"
                            data-testid="stop-eta"
                          >
                            {recalculating
                              ? t("stop.recalculating")
                              : stop.etaAt
                                ? fmt.time(new Date(stop.etaAt))
                                : "–"}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {stop.customerNumber} · {stop.street}, {stop.postalCode} {stop.city}
                          </span>
                          <span className="shrink-0 tabular-nums" data-testid="stop-items">
                            {t("stop.items", { count: stop.itemCount })}
                          </span>
                          {stop.parkingMissing ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 text-warning-soft-foreground"
                              data-testid="stop-missing-parking-spot"
                            >
                              <MapPinOffIcon className="size-4" aria-hidden />
                              {t("stop.noParkingSpot")}
                            </span>
                          ) : null}
                          {stop.timeWindow ? (
                            <span
                              className={
                                "inline-flex shrink-0 items-center gap-1 tabular-nums " +
                                (stop.windowIssue ? "text-warning-soft-foreground" : "")
                              }
                              data-testid="stop-time-window"
                              data-issue={stop.windowIssue ?? "none"}
                            >
                              <ClockIcon className="size-4" aria-hidden />
                              {stop.windowIssue
                                ? t(`stop.windowIssue.${stop.windowIssue}`, {
                                    from: stop.timeWindow.from,
                                    to: stop.timeWindow.to,
                                  })
                                : t("stop.window", {
                                    from: stop.timeWindow.from,
                                    to: stop.timeWindow.to,
                                  })}
                            </span>
                          ) : null}
                          {!stop.hasStorePhoto ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 text-warning-soft-foreground"
                              data-testid="stop-missing-store"
                            >
                              <ImageOffIcon className="size-4" aria-hidden />
                              {t("stop.missingStore")}
                            </span>
                          ) : null}
                          {!stop.hasParkingPhoto ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 text-warning-soft-foreground"
                              data-testid="stop-missing-parking"
                            >
                              <ImageOffIcon className="size-4" aria-hidden />
                              {t("stop.missingParking")}
                            </span>
                          ) : null}
                          {stop.changeKind ? (
                            <Badge
                              variant="outline"
                              data-testid="stop-change"
                              data-change={stop.changeKind}
                            >
                              {t(`change.stop.${stop.changeKind}`)}
                            </Badge>
                          ) : null}
                          {next ? (
                            <Badge data-testid="stop-next">{t("progress.next")}</Badge>
                          ) : null}
                        </div>
                        {results && stop.completedAt ? (
                          <div
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                            data-testid="stop-result"
                          >
                            <span data-testid="stop-completed-at">
                              {t("progress.completedAt", {
                                time: fmt.time(new Date(stop.completedAt)),
                              })}
                            </span>
                            {stop.status === "PROBLEM" ? (
                              <>
                                <span className="font-medium" data-testid="stop-problem-reason">
                                  {stop.problemReason
                                    ? t("progress.reason", {
                                        reason: tc(`problemReasons.${stop.problemReason}`),
                                      })
                                    : t("progress.reasonUnknown")}
                                </span>
                                {stop.problemNote ? <ProblemNote note={stop.problemNote} /> : null}
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {editable ? (
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={busy || index === 0}
                                aria-label={t("stop.moveUp", { name: stop.name })}
                                onClick={() => move(stop.id, index - 1)}
                                data-testid="stop-up"
                              >
                                <ArrowUpIcon aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("stop.moveUp", { name: stop.name })}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={busy || index === stops.length - 1}
                                aria-label={t("stop.moveDown", { name: stop.name })}
                                onClick={() => move(stop.id, index + 1)}
                                data-testid="stop-down"
                              >
                                <ArrowDownIcon aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("stop.moveDown", { name: stop.name })}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      ) : null}
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </div>
        </div>

        <TourEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          plan={plan}
          tour={tour}
          pending={pending}
          error={<ErrorAlert error={error} errorText={errorText} />}
          onSave={edit}
        />

        <Dialog open={reReleaseOpen} onOpenChange={setReReleaseOpen}>
          <DialogContent data-testid="rerelease-dialog">
            <DialogHeader>
              <DialogTitle>{t("change.dialog.title")}</DialogTitle>
              <DialogDescription>{t("change.dialog.description")}</DialogDescription>
            </DialogHeader>
            {tour.diff ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
                <dt className="text-muted-foreground">
                  {t("change.sections.added", { count: 0 })}
                </dt>
                <dd className="font-medium" data-testid="rerelease-added">
                  {tour.diff.added.length}
                </dd>
                <dt className="text-muted-foreground">
                  {t("change.sections.removed", { count: 0 })}
                </dt>
                <dd className="font-medium" data-testid="rerelease-removed">
                  {tour.diff.removed.length}
                </dd>
                <dt className="text-muted-foreground">
                  {t("change.sections.changed", { count: 0 })}
                </dt>
                <dd className="font-medium" data-testid="rerelease-changed">
                  {tour.diff.changed.length}
                </dd>
              </dl>
            ) : null}
            <ErrorAlert error={error} errorText={errorText} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReReleaseOpen(false)}>
                {tc("actions.cancel")}
              </Button>
              <Button
                type="button"
                onClick={reRelease}
                disabled={pending}
                data-testid="rerelease-confirm"
              >
                {t("change.dialog.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
          <DialogContent data-testid="release-dialog">
            <DialogHeader>
              <DialogTitle>{t("dialog.title")}</DialogTitle>
              <DialogDescription>{t("dialog.description")}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
              <dt className="text-muted-foreground">{t("dialog.stops")}</dt>
              <dd className="font-medium" data-testid="release-stops">
                {t("summary.stops", { count: tour.stops.length })}
              </dd>
              <dt className="text-muted-foreground">{t("dialog.duration")}</dt>
              <dd className="font-medium" data-testid="release-duration">
                {durationText}
              </dd>
              <dt className="text-muted-foreground">{t("dialog.driver")}</dt>
              <dd className="font-medium" data-testid="release-driver">
                {driver?.displayName ?? "–"}
              </dd>
              <dt className="text-muted-foreground">{t("dialog.vehicle")}</dt>
              <dd className="font-medium" data-testid="release-vehicle">
                {vehicle?.name ?? "–"}
              </dd>
              <dt className="text-muted-foreground">{t("dialog.load")}</dt>
              <dd className="font-medium tabular-nums" data-testid="release-load">
                {load.status === "none"
                  ? t("load.noVehicle", { load: format.number(tour.loadKg) })
                  : t("load.value", {
                      load: format.number(heaviestTripKg),
                      capacity: format.number(load.capacityKg ?? 0),
                    })}
              </dd>
            </dl>
            {load.status === "over" ? (
              <Alert variant="destructive" data-testid="release-overload">
                <TriangleAlertIcon aria-hidden />
                <AlertTitle>{t("dialog.overloadTitle")}</AlertTitle>
                <AlertDescription className="gap-2">
                  <p>{t("dialog.overloadBody", { over: format.number(load.overKg) })}</p>
                  <label className="flex min-h-10 items-center gap-2 text-base font-medium">
                    <input
                      type="checkbox"
                      className="size-5 accent-destructive"
                      checked={overrideOverload}
                      disabled={pending}
                      onChange={(e) => setOverrideOverload(e.target.checked)}
                      data-testid="release-overload-confirm"
                    />
                    {t("dialog.overloadConfirm")}
                  </label>
                </AlertDescription>
              </Alert>
            ) : null}
            <ErrorAlert error={error} errorText={errorText} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReleaseOpen(false)}>
                {tc("actions.cancel")}
              </Button>
              <Button
                type="button"
                onClick={release}
                disabled={pending || (load.status === "over" && !overrideOverload)}
                data-testid="release-confirm"
              >
                {t("dialog.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/** Four connected pills: passed steps carry a check, the current one the tour's tone. */
function StatusStepper({ current }: { current: number }) {
  const t = useTranslations("admin.tours.stepper");
  return (
    <ol
      className="flex flex-wrap items-center gap-1"
      aria-label={t("label")}
      data-testid="tour-stepper"
    >
      {TOUR_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="flex items-center gap-1">
            {index > 0 ? (
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
            <span
              aria-current={active ? "step" : undefined}
              data-step={step.id}
              data-state={active ? "current" : done ? "done" : "upcoming"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
                active
                  ? cn("border-current", toneClasses[tourTone(step.id)])
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3.5" aria-hidden /> : null}
              {t(step.label)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small inline hint that explains itself in a tooltip (replaces the standalone badge). */
function ApproximateHint({
  label,
  hint,
  testId,
  iconOnly = false,
}: {
  label: string;
  hint: string;
  testId: string;
  iconOnly?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
          {iconOnly ? null : label}
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function ErrorAlert({
  error,
  errorText,
}: {
  error: { code: string; max?: number } | null;
  errorText: (code: string, max?: number) => string;
}) {
  const t = useTranslations("admin.tours");
  if (!error) return null;
  return (
    <Alert variant="destructive" data-testid="tour-error" data-code={error.code}>
      <TriangleAlertIcon aria-hidden />
      <AlertDescription>
        <p>{errorText(error.code, error.max)}</p>
        {error.code === "depot_not_set" ? (
          <Link href="/admin/settings" className="underline">
            {t("errors.settingsLink")}
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** Orders of a planned day that are on no tour (more stops than one planning run can take). */
function Unplanned({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours");
  if (plan.unplanned.length === 0) return null;
  return (
    <Alert variant="warning" data-testid="tour-unplanned">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{t("unplanned.title", { count: plan.unplanned.length })}</AlertTitle>
      <AlertDescription>
        <p>{t("unplanned.body", { max: plan.stopLimit })}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {plan.unplanned.map((w) => (
            <li
              key={w.customerId}
              data-testid="tour-unplanned-customer"
              data-customer-id={w.customerId}
            >
              <Link href={`/admin/customers/${w.customerId}`} className="font-medium underline">
                {w.name} ({w.customerNumber})
              </Link>{" "}
              – {t("unplanned.orders", { count: w.orderIds.length })}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function Warnings({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours");
  if (plan.warnings.length === 0) return null;
  return (
    <Alert data-testid="tour-warnings">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{t("warningsTitle")}</AlertTitle>
      <AlertDescription>
        <p>{t("warningsBody")}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {plan.warnings.map((w) => (
            <li key={w.customerId} data-testid="tour-warning" data-customer-id={w.customerId}>
              <Link href={`/admin/customers/${w.customerId}`} className="font-medium underline">
                {w.name} ({w.customerNumber})
              </Link>{" "}
              – {t("warningLink")}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
