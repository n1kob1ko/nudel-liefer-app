"use client";

import {
  CheckIcon,
  CircleSlashIcon,
  MapIcon,
  MoveVerticalIcon,
  PlusIcon,
  PrinterIcon,
  SaveIcon,
  SearchIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type KeyboardEvent, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { TourMapLazy } from "@/components/maps/lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DayPlan, DayPlanRow, PlanProduct, RouteState } from "@/domain/standing-day";
import { Link, useRouter } from "@/i18n/navigation";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";
import {
  saveStandingDayAction,
  sendDayAction,
  setStandingTourDriverAction,
  setStandingTourVehicleAction,
} from "@/server/standing-actions";

import { RoutePlaceDialog } from "./route-place-dialog";

/**
 * Day plan ("Tagesplanung", NUD-186): one table per standing tour with the same customers every
 * delivery day, one column per product and the quantities of that day as editable fields. 0 means
 * "nothing that day"; the row keeps its order so the office sees it in the orders list (D32).
 *
 * The bottom list holds the active customers of no standing tour: their orders of the day (editable
 * like every row) and "add for this delivery day" for the rest — a one-off order, the membership of
 * a standing tour never changes here.
 *
 * The quantity fields are deliberately strings: an empty field is 0, and only digits are accepted
 * (no decimals, no thousands separators — a wrong delivery quantity is worse than a rejected one).
 *
 * NUD-212: every standing tour is the route of the day. Its card shows where it stands, the driver
 * and the vehicle, the load against the capacity, the stop numbers and the extras of the day
 * ("Zusatz", movable). "An Fahrer senden" saves typed quantities and sends every route; later
 * changes go out with "Änderungen senden".
 */

type Vehicle = { id: string; name: string; capacityKg: number };

const STATE_BADGE: Record<RouteState, "secondary" | "warning" | "info" | "success"> = {
  empty: "secondary",
  ready: "warning",
  sent: "info",
  changed: "warning",
  running: "info",
  done: "success",
};

type Values = Record<string, Record<string, string>>;

function rowValues(rows: ReadonlyArray<DayPlanRow>, products: ReadonlyArray<PlanProduct>): Values {
  const out: Values = {};
  for (const row of rows) {
    const quantities: Record<string, string> = {};
    for (const product of products) {
      quantities[product.id] = String(row.quantities[product.id] ?? 0);
    }
    out[row.customerId] = quantities;
  }
  return out;
}

/** Digits only, at most 5 (whole numbers up to 99999, D23): an empty field is "0". */
function cleanQuantity(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 5)
    .replace(/^0+(?=\d)/, "");
}

function quantityOf(value: string | undefined): number {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits === "" ? 0 : Math.min(Number(digits), 99_999);
}

function productLabel(product: PlanProduct, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(product.name);
  return parsed.success ? pick(parsed.data, locale) : product.sku;
}

export function StandingPlan({
  plan,
  drivers,
  vehicles,
  tiles,
}: {
  plan: DayPlan;
  drivers: ReadonlyArray<{ id: string; displayName: string }>;
  vehicles: ReadonlyArray<Vehicle>;
  tiles: MapTileConfig;
}) {
  const t = useTranslations("admin.planning");
  const tc = useTranslations("common");
  // Quantities next to a product name use the word forms ("22 Sackerl"), like the order totals.
  const tu = useTranslations("driver.unitsTotal");
  const format = useFormatter();
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [values, setValues] = useState<Values>(() =>
    rowValues([...plan.routes.flatMap((route) => route.rows), ...plan.offRoute], plan.products),
  );
  const [added, setAdded] = useState<ReadonlyArray<string>>([]);
  const [search, setSearch] = useState("");
  const [onlyWithOrder, setOnlyWithOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [overload, setOverload] = useState<{ route: string; overKg: number } | null>(null);
  const [moving, setMoving] = useState<{ row: DayPlanRow; routeId: string } | null>(null);
  const [maps, setMaps] = useState<ReadonlyArray<string>>([]);
  // A new plan (another delivery day, or the page after a save / a colleague's change) replaces the
  // edited quantities: the server state is the truth, unsaved typing belongs to the old day.
  const [seen, setSeen] = useState(plan);
  if (seen !== plan) {
    setSeen(plan);
    setValues(
      rowValues([...plan.routes.flatMap((route) => route.rows), ...plan.offRoute], plan.products),
    );
    setAdded([]);
    setError(null);
  }

  const productIds = plan.products.map((product) => product.id);
  const unitLabels = useMemo(
    () =>
      Object.fromEntries(
        plan.products.map((product) => [product.id, tc(`units.${product.unit}`)]),
      ) as Record<string, string>,
    [plan.products, tc],
  );

  const kgOf = (quantities: Record<string, string>): number => {
    const total = plan.products.reduce(
      (sum, product) => sum + quantityOf(quantities[product.id]) * Number(product.weightKgPerUnit),
      0,
    );
    // Whole hundredths, so 0.1 + 0.2 kg cannot show up as 0.30000000000000004.
    return Math.round(total * 100) / 100;
  };

  function setQuantity(customerId: string, productId: string, raw: string) {
    setValues((current) => ({
      ...current,
      [customerId]: { ...current[customerId], [productId]: cleanQuantity(raw) },
    }));
    setError(null);
  }

  function addOffRoute(customerId: string) {
    setAdded((current) => (current.includes(customerId) ? current : [...current, customerId]));
  }

  const editableOffRoute = plan.offRoute.filter(
    (row) => row.orderId !== null || added.includes(row.customerId),
  );
  const visibleOffRoute = plan.offRoute.filter((row) => {
    const term = search.trim().toLowerCase();
    const matches =
      term === "" ||
      row.name.toLowerCase().includes(term) ||
      row.customerNumber.toLowerCase().includes(term) ||
      row.city.toLowerCase().includes(term);
    return matches && (!onlyWithOrder || row.orderId !== null);
  });

  // Everything the save button writes: the rows of every standing tour and the off-route customers
  // that have (or just got) an order for this day.
  const savedRows = [...plan.routes.flatMap((route) => route.rows), ...editableOffRoute];
  const changedCount = savedRows.filter(
    (row) =>
      added.includes(row.customerId) ||
      productIds.some(
        (productId) =>
          quantityOf(values[row.customerId]?.[productId]) !== (row.quantities[productId] ?? 0),
      ),
  ).length;
  const dayTotals = plan.products.map((product) => ({
    product,
    quantity: savedRows.reduce(
      (sum, row) => sum + quantityOf(values[row.customerId]?.[product.id]),
      0,
    ),
  }));
  const dayWeight = savedRows.reduce((sum, row) => sum + kgOf(values[row.customerId] ?? {}), 0);

  const hasQuantity = (customerId: string) =>
    productIds.some((productId) => quantityOf(values[customerId]?.[productId]) > 0);
  const routeName = (id: string | undefined) =>
    plan.routes.find((route) => route.id === id)?.name ?? "";
  const anySent = plan.routes.some((route) => route.tourId !== null);
  const toSend =
    changedCount > 0 ||
    plan.routes.some((route) => route.state === "ready" || route.state === "changed");

  function rowsToSave() {
    return savedRows.map((row) => ({
      customerId: row.customerId,
      lines: productIds.map((productId) => ({
        productId,
        quantity: quantityOf(values[row.customerId]?.[productId]),
      })),
    }));
  }

  /** Saves the typed quantities; `false` when it failed (the error is shown). */
  async function saveRows(quiet: boolean): Promise<boolean> {
    let result;
    try {
      result = await saveStandingDayAction({ date: plan.date, rows: rowsToSave() });
    } catch {
      setError(t("errors.generic"));
      return false;
    }
    if (!result.ok) {
      setError(t(`errors.${result.error}`));
      return false;
    }
    setError(null);
    if (!quiet) {
      if (result.written === 0) toast.success(t("savedNothing"));
      else toast.success(t("saved", { count: result.written }));
    }
    if (result.merged > 0) toast.info(t("savedMerged", { count: result.merged }));
    return true;
  }

  function save() {
    startTransition(async () => {
      if (await saveRows(false)) router.refresh();
    });
  }

  function send(overrideOverload = false) {
    setOverload(null);
    startTransition(async () => {
      if (!overrideOverload && changedCount > 0 && !(await saveRows(true))) return;
      let result;
      try {
        result = await sendDayAction(
          overrideOverload ? { date: plan.date, overrideOverload: true } : { date: plan.date },
        );
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) {
        router.refresh();
        if (result.error === "overloaded") {
          return setOverload({
            route: routeName(result.standingTourId),
            overKg: result.overKg ?? 0,
          });
        }
        return setError(
          t(`send.errors.${result.error}`, { route: routeName(result.standingTourId) }),
        );
      }
      setError(null);
      const moved = result.routes.filter((r) => r.outcome === "sent" || r.outcome === "updated");
      if (moved.length === 0) toast.success(t("send.nothing"));
      else toast.success(t("send.done", { count: moved.length }));
      for (const warning of result.warnings) {
        toast.warning(t("send.noLocation", { name: warning.name }));
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6" data-plan-root>
      {plan.readOnly ? (
        <Card data-testid="planning-read-only" className="border-warning/40 bg-warning-soft/40">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">
              {t(`readOnly.${plan.readOnly}.title`)}
            </h2>
            <CardDescription>{t(`readOnly.${plan.readOnly}.body`)}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {plan.routes.length === 0 ? (
        <Card data-testid="planning-no-routes">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">{t("noRoutes.title")}</h2>
            <CardDescription>{t("noRoutes.body")}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {plan.routes.map((route) => {
        const rows = route.rows;
        const totals = Object.fromEntries(productIds.map((id) => [id, 0])) as Record<
          string,
          number
        >;
        for (const row of rows) {
          for (const productId of productIds) {
            const quantity = quantityOf(values[row.customerId]?.[productId]);
            totals[productId] = (totals[productId] ?? 0) + quantity;
          }
        }
        const weight = rows.reduce((sum, row) => sum + kgOf(values[row.customerId] ?? {}), 0);
        // The stop numbers of the day: the rows with a quantity, in delivery order.
        const numbers = new Map<string, number>();
        for (const row of rows) {
          // A customer without any location is on no tour (the send reports him).
          if (hasQuantity(row.customerId) && row.location !== null) {
            numbers.set(row.customerId, numbers.size + 1);
          }
        }
        const over = route.capacityKg !== null && weight > route.capacityKg;
        const mapOpen = maps.includes(route.id);
        return (
          <Card key={route.id} data-testid={`standing-route-${route.id}`}>
            <CardHeader>
              <div className="flex flex-col gap-3" data-testid={`route-head-${route.id}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">{route.name}</h2>
                  <Badge variant={STATE_BADGE[route.state]} data-testid={`route-state-${route.id}`}>
                    {t(`routeState.${route.state}`)}
                  </Badge>
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-muted-foreground">
                  <span>{t("route.stops", { count: numbers.size })}</span>
                  <span
                    data-testid={`route-load-${route.id}`}
                    data-over={over}
                    className={cn(
                      "tabular-nums",
                      over && "flex items-center gap-1 font-semibold text-destructive",
                    )}
                  >
                    {over ? <TriangleAlertIcon className="size-4" aria-hidden /> : null}
                    {route.capacityKg !== null
                      ? t("route.load", {
                          weight: format.number(Math.round(weight * 100) / 100, {
                            maximumFractionDigits: 1,
                          }),
                          capacity: format.number(route.capacityKg, { maximumFractionDigits: 0 }),
                        })
                      : t("dayWeight", {
                          weight: format.number(Math.round(weight * 100) / 100, {
                            maximumFractionDigits: 1,
                          }),
                        })}
                  </span>
                  {route.tourId ? (
                    <span className="text-foreground">
                      {t("route.progress", { done: route.delivered, count: route.stopCount })}
                    </span>
                  ) : null}
                  {route.problems > 0 ? (
                    <Badge variant="destructive">
                      {t("route.problems", { count: route.problems })}
                    </Badge>
                  ) : null}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <RouteSelect
                    label={t("route.driver")}
                    testId={`driver-${route.id}`}
                    value={route.driverId}
                    none={t("route.noDriver")}
                    options={drivers.map((d) => ({ id: d.id, label: d.displayName }))}
                    disabled={pending || !plan.editable}
                    saved={t("route.driverSaved")}
                    onSave={(id) => setStandingTourDriverAction(route.id, id)}
                    onChanged={() => router.refresh()}
                  />
                  <RouteSelect
                    label={t("route.vehicle")}
                    testId={`vehicle-${route.id}`}
                    value={route.vehicleId}
                    none={t("route.noVehicle")}
                    options={vehicles.map((v) => ({
                      id: v.id,
                      label: `${v.name} · ${format.number(v.capacityKg, { maximumFractionDigits: 0 })} kg`,
                    }))}
                    disabled={pending || !plan.editable}
                    saved={t("route.vehicleSaved")}
                    onSave={(id) => setStandingTourVehicleAction(route.id, id)}
                    onChanged={() => router.refresh()}
                  />
                  <div className="flex flex-wrap gap-2">
                    {numbers.size > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        aria-pressed={mapOpen}
                        onClick={() =>
                          setMaps((current) =>
                            current.includes(route.id)
                              ? current.filter((id) => id !== route.id)
                              : [...current, route.id],
                          )
                        }
                        data-testid={`route-map-${route.id}`}
                      >
                        <MapIcon aria-hidden />
                        {mapOpen ? t("route.hideMap") : t("route.map")}
                      </Button>
                    ) : null}
                    {route.tourId ? (
                      <Button asChild variant="outline">
                        <Link
                          href={{
                            pathname: `/admin/tours/${route.tourId}/print`,
                            query: { locale },
                          }}
                          data-testid={`load-sheet-${route.id}`}
                        >
                          <PrinterIcon aria-hidden />
                          {t("route.loadSheet")}
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {mapOpen ? (
                <TourMapLazy
                  className="[&_.leaflet-container]:h-80"
                  stops={rows.flatMap((row) => {
                    const number = numbers.get(row.customerId);
                    return number && row.location
                      ? [
                          {
                            id: row.customerId,
                            sequence: number,
                            lat: row.location.lat,
                            lng: row.location.lng,
                            label: row.name,
                            status: row.stop?.status,
                          },
                        ]
                      : [];
                  })}
                  depot={
                    plan.depot
                      ? { lat: plan.depot.lat, lng: plan.depot.lng, label: plan.depot.name }
                      : null
                  }
                  geometry={route.state === "changed" ? null : route.geometry}
                  tiles={tiles}
                />
              ) : null}
              {rows.length === 0 ? (
                <p className="text-base text-muted-foreground">{t("route.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="max-md:hidden">
                      <TableRow>
                        <TableHead className="w-12 text-center">{t("columns.stop")}</TableHead>
                        <TableHead className="min-w-52">{t("columns.customer")}</TableHead>
                        {plan.products.map((product) => (
                          <TableHead key={product.id} className="w-24 text-right">
                            <span className="block">{productLabel(product, locale)}</span>
                            <span className="block text-xs font-normal text-muted-foreground">
                              {unitLabels[product.id]}
                            </span>
                          </TableHead>
                        ))}
                        <TableHead className="w-20 text-right">{t("columns.weight")}</TableHead>
                        <TableHead className="w-40">{t("columns.state")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <PlanRow
                          key={row.customerId}
                          row={row}
                          number={numbers.get(row.customerId) ?? null}
                          noLocation={row.location === null && hasQuantity(row.customerId)}
                          products={plan.products}
                          locale={locale}
                          values={values[row.customerId] ?? {}}
                          // A stop the driver completed is history (what the customer got).
                          editable={
                            plan.editable && (row.stop === null || row.stop.status === "PENDING")
                          }
                          weight={kgOf(values[row.customerId] ?? {})}
                          onChange={setQuantity}
                          onMove={
                            row.extra && plan.editable && !pending && !row.stop
                              ? () => setMoving({ row, routeId: route.id })
                              : undefined
                          }
                        />
                      ))}
                    </TableBody>
                    <TableFooter className="max-md:hidden">
                      <TableRow>
                        <TableCell />
                        <TableCell className="font-semibold">{t("columns.total")}</TableCell>
                        {plan.products.map((product) => (
                          <TableCell
                            key={product.id}
                            className="text-right text-base font-semibold tabular-nums"
                          >
                            {format.number(totals[product.id] ?? 0, {
                              maximumFractionDigits: 0,
                            })}
                          </TableCell>
                        ))}
                        <TableCell className="text-right text-base font-semibold tabular-nums">
                          {format.number(Math.round(weight * 100) / 100, {
                            maximumFractionDigits: 1,
                          })}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
              {rows.some((row) => row.source === "rule") ? (
                <p className="text-sm text-muted-foreground">{t("route.ruleHint")}</p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {moving ? (
        <RoutePlaceDialog
          key={moving.row.customerId}
          date={plan.date}
          row={moving.row}
          routeId={moving.routeId}
          routes={plan.routes}
          open
          onOpenChange={(open) => (open ? null : setMoving(null))}
          onMoved={() => router.refresh()}
        />
      ) : null}

      <Dialog open={overload !== null} onOpenChange={(open) => (open ? null : setOverload(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("send.overloadTitle")}</DialogTitle>
            <DialogDescription>
              {overload
                ? t("send.overloadBody", {
                    route: overload.route,
                    kg: format.number(overload.overKg, { maximumFractionDigits: 0 }),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOverload(null)}>
              {t("send.overloadCancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => send(true)}
              data-testid="overload-confirm"
            >
              {t("send.overloadConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card data-testid="planning-off-route">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            {t("offRoute.title")}
            <InfoTip>{t("offRoute.body")}</InfoTip>
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("offRoute.search")}
                aria-label={t("offRoute.search")}
                className="pl-9"
                data-testid="off-route-search"
              />
            </div>
            <Button
              type="button"
              variant={onlyWithOrder ? "secondary" : "outline"}
              aria-pressed={onlyWithOrder}
              onClick={() => setOnlyWithOrder((value) => !value)}
            >
              {t("offRoute.onlyWithOrder")}
            </Button>
          </div>
          {visibleOffRoute.length === 0 ? (
            <p className="text-base text-muted-foreground">{t("offRoute.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="max-md:hidden">
                  <TableRow>
                    <TableHead className="min-w-52">{t("columns.customer")}</TableHead>
                    {plan.products.map((product) => (
                      <TableHead key={product.id} className="w-24 text-right">
                        <span className="block">{productLabel(product, locale)}</span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          {unitLabels[product.id]}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="w-20 text-right">{t("columns.weight")}</TableHead>
                    <TableHead className="w-40">{t("columns.state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleOffRoute.map((row) => {
                    const editable = row.orderId !== null || added.includes(row.customerId);
                    if (!editable) {
                      return (
                        <TableRow
                          key={row.customerId}
                          data-testid={`off-route-${row.customerId}`}
                          className="max-md:flex max-md:h-auto max-md:items-center max-md:gap-3 max-md:py-2"
                        >
                          <CustomerCell row={row} />
                          {plan.products.map((product) => (
                            <TableCell
                              key={product.id}
                              className="text-right text-base tabular-nums text-muted-foreground max-md:hidden"
                            >
                              —
                            </TableCell>
                          ))}
                          <TableCell className="text-right text-base tabular-nums text-muted-foreground max-md:hidden">
                            —
                          </TableCell>
                          <TableCell className="max-md:p-0">
                            {plan.editable ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => addOffRoute(row.customerId)}
                                data-testid={`off-route-add-${row.customerId}`}
                              >
                                <PlusIcon aria-hidden />
                                {t("offRoute.add")}
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <PlanRow
                        key={row.customerId}
                        row={row}
                        products={plan.products}
                        locale={locale}
                        values={values[row.customerId] ?? {}}
                        editable={plan.editable}
                        weight={kgOf(values[row.customerId] ?? {})}
                        onChange={setQuantity}
                        testId={`off-route-${row.customerId}`}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {plan.editable ? (
        // A solid bar inside the page column. Below 1025 px it stops above the menu bar at the
        // bottom of the screen: at `bottom-0` the menu covered the totals and the save button.
        <div className="sticky bottom-[5.25rem] z-20 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3 shadow-md min-[1025px]:bottom-4">
          {/* What the kitchen has to make for this day, across every tour, while typing. */}
          <p
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground"
            data-testid="planning-day-total"
          >
            <span className="font-medium text-foreground">{t("dayTotal")}</span>
            {dayTotals.map(({ product, quantity }) => (
              // On a phone the bar keeps the weight only: the route cards carry the details.
              <span key={product.id} className="max-md:hidden">
                {productLabel(product, locale)}{" "}
                <span className="text-base font-semibold text-foreground tabular-nums">
                  {format.number(quantity, { maximumFractionDigits: 0 })}
                </span>{" "}
                {tu(product.unit as "KG" | "PACK" | "CRATE" | "PIECE")}
              </span>
            ))}
            <span className="text-base font-semibold text-foreground tabular-nums">
              {t("dayWeight", {
                weight: format.number(Math.round(dayWeight * 100) / 100, {
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
          </p>
          <div className="ms-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="planning-error">
                {error}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground" role="status">
              {changedCount > 0 ? (
                <span data-testid="planning-dirty">{t("dirty", { count: changedCount })}</span>
              ) : null}
            </p>
            {!toSend && anySent ? (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <CheckIcon className="size-4" aria-hidden />
                {t("send.allSent")}
              </p>
            ) : null}
            {/* On a phone both buttons share one line (short label, no icons). */}
            <div className="flex gap-3 max-md:w-full max-md:[&>button]:flex-1 max-md:[&_svg]:hidden">
              <Button
                type="button"
                variant="outline"
                onClick={save}
                disabled={pending}
                data-testid="planning-save"
              >
                <SaveIcon aria-hidden />
                {pending ? (
                  t("saving")
                ) : (
                  <>
                    <span className="md:hidden">{t("saveShort")}</span>
                    <span className="max-md:hidden">{t("save")}</span>
                  </>
                )}
              </Button>
              {plan.routes.length > 0 ? (
                <Button
                  type="button"
                  onClick={() => send()}
                  disabled={pending || !toSend}
                  data-testid="planning-send"
                >
                  <SendIcon aria-hidden />
                  {anySent ? t("send.changes") : t("send.first")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Enter and the arrow keys walk a product column like a spreadsheet: down to the next customer
 * (also across to the next tour), up to the one before. The last field keeps the focus.
 */
function moveInColumn(event: KeyboardEvent<HTMLInputElement>) {
  const step =
    event.key === "Enter" || event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const field = event.currentTarget;
  const root = field.closest("[data-plan-root]");
  if (!root) return;
  const column = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      `input[data-col="${CSS.escape(field.dataset.col ?? "")}"]:not(:disabled)`,
    ),
  );
  const next = column[column.indexOf(field) + step];
  if (next) {
    next.focus();
    next.select();
  }
}

/** One editable customer row (a standing tour or an off-route customer with an order). */
function PlanRow({
  row,
  number,
  noLocation = false,
  products,
  locale,
  values,
  editable,
  weight,
  onChange,
  onMove,
  testId,
}: {
  row: DayPlanRow;
  /** Stop number on the route (rows with a quantity), `undefined` outside a route. */
  number?: number | null;
  /** Ordered, but without any location: the driver cannot get this customer. */
  noLocation?: boolean;
  products: ReadonlyArray<PlanProduct>;
  locale: AppLocale;
  values: Record<string, string>;
  editable: boolean;
  weight: number;
  onChange: (customerId: string, productId: string, value: string) => void;
  /** "Verschieben" of an extra; without it the row has no move button. */
  onMove?: () => void;
  testId?: string;
}) {
  const t = useTranslations("admin.planning");
  const tc = useTranslations("common");
  const format = useFormatter();
  return (
    // Below `md` a row is a wrapped line (like the orders list): number and customer, then the
    // quantity fields with their product names, then the states. No sideways scrolling on a phone.
    <TableRow
      data-testid={testId ?? `plan-row-${row.customerId}`}
      className="max-md:flex max-md:h-auto max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:py-3"
    >
      {number !== undefined ? (
        <TableCell className="text-center max-md:w-7 max-md:p-0">
          {number !== null ? (
            <span
              className="inline-flex size-7 items-center justify-center rounded-full border border-border text-sm font-semibold tabular-nums"
              data-testid={`stop-number-${row.customerId}`}
            >
              {number}
            </span>
          ) : null}
        </TableCell>
      ) : null}
      <CustomerCell row={row} onMove={onMove} />
      {products.map((product) => (
        <TableCell
          key={product.id}
          className="p-1 text-right max-md:flex max-md:flex-col max-md:items-start max-md:p-0"
        >
          <span className="text-xs text-muted-foreground md:hidden" aria-hidden>
            {productLabel(product, locale)} {tc(`units.${product.unit}`)}
          </span>
          <Input
            value={values[product.id] ?? "0"}
            onChange={(event) => onChange(row.customerId, product.id, event.target.value)}
            // Typing replaces the old quantity instead of landing next to it.
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={moveInColumn}
            disabled={!editable}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${row.name} – ${productLabel(product, locale)}`}
            // A zero recedes, a quantity stands out: the filled rows of a day read at a glance.
            data-filled={quantityOf(values[product.id]) > 0}
            data-col={product.id}
            className="h-9 w-20 text-right tabular-nums max-md:w-16 data-[filled=false]:text-muted-foreground data-[filled=true]:font-semibold"
            data-testid={`qty-${row.customerId}-${product.id}`}
          />
        </TableCell>
      ))}
      <TableCell
        className={cn(
          "text-right text-base tabular-nums max-md:ms-auto max-md:self-end max-md:p-0 max-md:pb-2",
          weight === 0 && "text-muted-foreground",
        )}
      >
        {format.number(weight, { maximumFractionDigits: 1 })}
        <span className="md:hidden"> kg</span>
      </TableCell>
      <TableCell className="max-md:basis-full max-md:p-0 max-md:empty:hidden">
        <div className="flex flex-wrap gap-1 max-md:empty:hidden">
          {noLocation ? (
            <Badge variant="warning" data-testid={`no-location-${row.customerId}`}>
              <TriangleAlertIcon aria-hidden />
              {t("state.noLocation")}
            </Badge>
          ) : null}
          {row.stop?.status === "DELIVERED" ? (
            <Badge variant="success" data-testid={`stop-state-${row.customerId}`}>
              <CheckIcon aria-hidden />
              {t("state.delivered")}
            </Badge>
          ) : null}
          {row.stop?.status === "PROBLEM" ? (
            <Badge variant="destructive" data-testid={`stop-state-${row.customerId}`}>
              <TriangleAlertIcon aria-hidden />
              {t("state.problem")}
            </Badge>
          ) : null}
          {row.orderCount > 1 ? <Badge variant="outline">{t("state.merged")}</Badge> : null}
          {row.cancelled ? <Badge variant="secondary">{t("state.cancelled")}</Badge> : null}
          {row.source === "rule" ? <Badge variant="info">{t("state.fromRule")}</Badge> : null}
          {row.nothing ? (
            <Badge variant="warning" data-testid={`nothing-${row.customerId}`}>
              <CircleSlashIcon aria-hidden />
              {t("state.nothing")}
            </Badge>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CustomerCell({ row, onMove }: { row: DayPlanRow; onMove?: () => void }) {
  const t = useTranslations("admin.planning");
  return (
    <TableCell className="max-md:min-w-0 max-md:flex-1 max-md:basis-[calc(100%-2.5rem)] max-md:p-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex flex-col">
          <span className="flex flex-wrap items-center gap-2 text-base font-medium">
            {row.name}
            {row.extra ? (
              <Badge variant="outline" size="sm" data-testid={`extra-${row.customerId}`}>
                {t("extra.label")}
              </Badge>
            ) : null}
          </span>
          <span className="text-sm text-muted-foreground">
            {row.customerNumber} · {row.city}
          </span>
        </div>
        {onMove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onMove}
            data-testid={`move-${row.customerId}`}
          >
            <MoveVerticalIcon aria-hidden />
            {t("extra.move")}
          </Button>
        ) : null}
      </div>
    </TableCell>
  );
}

/**
 * Driver or vehicle of a standing tour, changeable inline (illness, replacement). The change holds
 * for the following days too; a sent route takes it over with the next send.
 */
function RouteSelect({
  label,
  testId,
  value,
  none,
  options,
  disabled,
  saved,
  onSave,
  onChanged,
}: {
  label: string;
  testId: string;
  value: string | null;
  none: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  disabled: boolean;
  saved: string;
  onSave: (id: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  onChanged: () => void;
}) {
  const t = useTranslations("admin.planning");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const NONE = "__none__";

  function change(next: string) {
    startTransition(async () => {
      let result;
      try {
        result = await onSave(next === NONE ? null : next);
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) {
        return setError(
          t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.generic"),
        );
      }
      setError(null);
      toast.success(saved);
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={testId} className="text-sm font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={value ?? NONE} onValueChange={change} disabled={disabled || pending}>
        <SelectTrigger
          id={testId}
          className="w-56 max-w-full"
          size="sm"
          aria-label={label}
          data-testid={testId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{none}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <span className="text-sm text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
