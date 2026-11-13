"use client";

import { CircleSlashIcon, PlusIcon, SaveIcon, SearchIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
import type { DayPlan, DayPlanRow, PlanProduct } from "@/domain/standing-day";
import { Link, useRouter } from "@/i18n/navigation";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import { saveStandingDayAction, setStandingTourDriverAction } from "@/server/standing-actions";

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
 */

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
}: {
  plan: DayPlan;
  drivers: ReadonlyArray<{ id: string; displayName: string }>;
}) {
  const t = useTranslations("admin.planning");
  const tc = useTranslations("common");
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

  function save() {
    const standingRows = plan.routes.flatMap((route) => route.rows);
    const rows = [...standingRows, ...editableOffRoute].map((row) => ({
      customerId: row.customerId,
      lines: productIds.map((productId) => ({
        productId,
        quantity: quantityOf(values[row.customerId]?.[productId]),
      })),
    }));
    startTransition(async () => {
      let result;
      try {
        result = await saveStandingDayAction({ date: plan.date, rows });
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t(`errors.${result.error}`));
      setError(null);
      if (result.written === 0) toast.success(t("savedNothing"));
      else toast.success(t("saved", { count: result.written }));
      if (result.merged > 0) toast.info(t("savedMerged", { count: result.merged }));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {plan.readOnly ? (
        <Card data-testid="planning-read-only" className="border-warning/40 bg-warning-soft/40">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">
              {t(`readOnly.${plan.readOnly}.title`)}
            </h2>
            <CardDescription>{t(`readOnly.${plan.readOnly}.body`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/admin/tours?date=${plan.date}`}
              className="text-base font-medium underline underline-offset-4"
            >
              {t("readOnly.toTours")}
            </Link>
          </CardContent>
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
        return (
          <Card key={route.id} data-testid={`standing-route-${route.id}`}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="text-lg font-semibold tracking-tight">{route.name}</h2>
                  <CardDescription>
                    {t("route.summary", {
                      count: rows.length,
                      weight: format.number(Math.round(weight * 100) / 100, {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`driver-${route.id}`}
                    className="text-sm font-medium text-muted-foreground"
                  >
                    {t("route.driver")}
                  </label>
                  <DriverSelect
                    routeId={route.id}
                    value={route.driverId}
                    drivers={drivers}
                    disabled={pending}
                    onChanged={() => router.refresh()}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {rows.length === 0 ? (
                <p className="text-base text-muted-foreground">{t("route.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
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
                      {rows.map((row) => (
                        <PlanRow
                          key={row.customerId}
                          row={row}
                          products={plan.products}
                          locale={locale}
                          values={values[row.customerId] ?? {}}
                          editable={plan.editable}
                          weight={kgOf(values[row.customerId] ?? {})}
                          onChange={setQuantity}
                        />
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
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

      <Card data-testid="planning-off-route">
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">{t("offRoute.title")}</h2>
          <CardDescription>{t("offRoute.body")}</CardDescription>
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
                <TableHeader>
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
                        <TableRow key={row.customerId} data-testid={`off-route-${row.customerId}`}>
                          <CustomerCell row={row} />
                          {plan.products.map((product) => (
                            <TableCell
                              key={product.id}
                              className="text-right text-base tabular-nums text-muted-foreground"
                            >
                              —
                            </TableCell>
                          ))}
                          <TableCell className="text-right text-base tabular-nums text-muted-foreground">
                            —
                          </TableCell>
                          <TableCell>
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
        <div className="sticky bottom-0 z-20 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t bg-card/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          {error ? (
            <p
              className="mr-auto text-sm text-destructive"
              role="alert"
              data-testid="planning-error"
            >
              {error}
            </p>
          ) : null}
          <Button type="button" onClick={save} disabled={pending} data-testid="planning-save">
            <SaveIcon aria-hidden />
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One editable customer row (a standing tour or an off-route customer with an order). */
function PlanRow({
  row,
  products,
  locale,
  values,
  editable,
  weight,
  onChange,
  testId,
}: {
  row: DayPlanRow;
  products: ReadonlyArray<PlanProduct>;
  locale: AppLocale;
  values: Record<string, string>;
  editable: boolean;
  weight: number;
  onChange: (customerId: string, productId: string, value: string) => void;
  testId?: string;
}) {
  const t = useTranslations("admin.planning");
  const format = useFormatter();
  return (
    <TableRow data-testid={testId ?? `plan-row-${row.customerId}`}>
      <CustomerCell row={row} />
      {products.map((product) => (
        <TableCell key={product.id} className="p-1 text-right">
          <Input
            value={values[product.id] ?? "0"}
            onChange={(event) => onChange(row.customerId, product.id, event.target.value)}
            disabled={!editable}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${row.name} – ${productLabel(product, locale)}`}
            className="h-9 w-20 text-right tabular-nums"
            data-testid={`qty-${row.customerId}-${product.id}`}
          />
        </TableCell>
      ))}
      <TableCell className="text-right text-base tabular-nums">
        {format.number(weight, { maximumFractionDigits: 1 })}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
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

function CustomerCell({ row }: { row: DayPlanRow }) {
  return (
    <TableCell>
      <div className="flex flex-col">
        <span className="text-base font-medium">{row.name}</span>
        <span className="text-sm text-muted-foreground">
          {row.customerNumber} · {row.city}
        </span>
      </div>
    </TableCell>
  );
}

/** Default driver of a standing tour, changeable inline (illness, replacement). */
function DriverSelect({
  routeId,
  value,
  drivers,
  disabled,
  onChanged,
}: {
  routeId: string;
  value: string | null;
  drivers: ReadonlyArray<{ id: string; displayName: string }>;
  disabled: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("admin.planning");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const NONE = "__none__";

  function change(next: string) {
    const driverId = next === NONE ? null : next;
    startTransition(async () => {
      let result;
      try {
        result = await setStandingTourDriverAction(routeId, driverId);
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t(`errors.${result.error}`));
      setError(null);
      toast.success(t("route.driverSaved"));
      onChanged();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Select value={value ?? NONE} onValueChange={change} disabled={disabled || pending}>
        <SelectTrigger
          id={`driver-${routeId}`}
          className="w-52"
          size="sm"
          aria-label={t("route.driver")}
          data-testid={`driver-${routeId}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("route.noDriver")}</SelectItem>
          {drivers.map((driver) => (
            <SelectItem key={driver.id} value={driver.id}>
              {driver.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <span className={cn("text-sm text-destructive")} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
