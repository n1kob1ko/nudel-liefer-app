import {
  ArchiveIcon,
  ImageOffIcon,
  KeyRoundIcon,
  MapPinOffIcon,
  PencilIcon,
  RepeatIcon,
  TagIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CustomerKey, keyDisplay } from "@/domain/customer-key";
import { type PhotoKind, photosMissing as photosMissingFor } from "@/domain/photos";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { MapTileConfig } from "@/lib/map-config";
import type { AbbreviationHistoryEntry } from "@/server/customer-abbreviation";
import type { CustomerDetail, UpcomingOrder } from "@/server/customer-admin";
import type { KeyHistoryEntry } from "@/server/customer-key";
import type { NoteTranslationsView } from "@/server/customer-notes";
import type { ParkingSpotView } from "@/server/parking-spots";
import type { RecurringRuleView } from "@/server/recurring-orders";

import { CustomerArchiveButton } from "./customer-archive-button";
import { CustomerPhotoSlots, type PhotoSlotValue } from "./customer-photo-slots";
import { NoteTranslations } from "./note-translations";
import { PageHeader } from "./page-header";
import { ParkingSpotsManager } from "./parking-spots-manager";
import { RecurringOrdersCard, type RecurringProductChoice } from "./recurring-orders-card";

function Field({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base whitespace-pre-line" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/**
 * Customer detail (re-design.md §8.5 "Detail page", §14.3 header pattern): the shared `PageHeader`
 * (breadcrumb, one `h1`, edit/archive actions), then the details as cards — Stammdaten, Fotos and
 * the upcoming orders. The data sources are untouched; the badges carry text next to the colour.
 */
export function CustomerDetailView({
  customer,
  orders,
  photos,
  noteTranslations,
  parkingSpots,
  keyHistory,
  abbreviationHistory,
  tiles,
  recurringRules,
  recurringProducts,
  today,
}: {
  customer: CustomerDetail;
  orders: UpcomingOrder[];
  photos: Record<PhotoKind, PhotoSlotValue | null>;
  /** The four versions of the driver note; `null` when the customer has no note. */
  noteTranslations: NoteTranslationsView | null;
  /** Active Parkplätze in display order (NUD-125). */
  parkingSpots: ParkingSpotView[];
  /** Key changes, newest first (NUD-142). */
  keyHistory: KeyHistoryEntry[];
  /** Abkürzung changes, newest first (NUD-164). */
  abbreviationHistory: AbbreviationHistoryEntry[];
  tiles: MapTileConfig;
  /** Recurring orders of the customer (NUD-149). */
  recurringRules: RecurringRuleView[];
  recurringProducts: RecurringProductChoice[];
  /** `YYYY-MM-DD` in the factory time zone. */
  today: string;
}) {
  const t = useTranslations("admin.customers");
  const td = useTranslations("admin.customers.detail");
  const tf = useTranslations("admin.customers.form");
  const tt = useTranslations("admin.customers.translations");
  const tc = useTranslations("common");
  // Unit labels ("Sackerl", "Kiste", "×") live once, under `driver.units` (§9.3).
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const tk = useTranslations("admin.customers.detail.key");
  const keyText = (key: CustomerKey) => {
    const display = keyDisplay(key);
    return display.kind === "number"
      ? tk("states.number", { number: display.number })
      : tk(`states.${display.kind}`);
  };
  const ta = useTranslations("admin.customers.detail.abbreviation");
  const abbreviationText = (value: string | null) => value ?? ta("none");
  const actorText = (actor: { name: string; role: "ADMIN" | "DRIVER" } | null) =>
    actor ? tk(`by.${actor.role}`, { name: actor.name }) : tk("by.unknown");
  const photosMissing = photosMissingFor(
    (Object.keys(photos) as PhotoKind[]).filter((kind) => photos[kind] !== null),
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <PageHeader
        back={{ href: "/admin/customers", label: t("title") }}
        title={customer.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-mono" data-testid="detail-number">
              {td("number", { number: customer.customerNumber })}
            </span>
            {photosMissing ? (
              <Badge variant="warning" data-testid="flag-photos-missing">
                <ImageOffIcon aria-hidden />
                {t("flags.photosMissing")}
              </Badge>
            ) : null}
            {parkingSpots.length === 0 ? (
              <Badge variant="warning" data-testid="flag-parking-missing">
                <MapPinOffIcon aria-hidden />
                {t("flags.parkingMissing")}
              </Badge>
            ) : null}
            {!customer.active ? (
              <Badge variant="secondary" data-testid="flag-archived">
                <ArchiveIcon aria-hidden />
                {t("flags.archived")}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link
              href={`/admin/customers/${customer.id}/edit`}
              className={buttonVariants()}
              data-testid="customer-edit"
            >
              <PencilIcon aria-hidden />
              {tc("actions.edit")}
            </Link>
            <CustomerArchiveButton
              customerId={customer.id}
              active={customer.active}
              upcomingOrders={orders.length}
              runningRules={recurringRules.filter((r) => r.state === "active").length}
            />
          </>
        }
      />

      <Tabs defaultValue="details" className="gap-6">
        <TabsList>
          <TabsTrigger value="details" data-testid="tab-details">
            {tt("tabDetails")}
          </TabsTrigger>
          <TabsTrigger value="translations" data-testid="tab-translations">
            {tt("tabTranslations")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <h2 id="d-address" className="text-lg font-semibold">
                {td("addressHeading")}
              </h2>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2" aria-labelledby="d-address">
                <Field label={td("address")} testId="detail-address">
                  {customer.street}
                  {"\n"}
                  {customer.postalCode} {customer.city}, {customer.country}
                </Field>
                <Field label={td("hours")}>{customer.deliveryHoursInfo ?? td("none")}</Field>
                <Field label={td("notes")} testId="detail-notes">
                  {customer.notes || td("none")}
                </Field>
                <Field label={tf("office.companyName")} testId="detail-company">
                  {customer.companyName ?? td("none")}
                </Field>
                <Field label={tf("office.vatId")} testId="detail-vat-id">
                  {customer.vatId ?? td("none")}
                </Field>
                <Field label={td("billingAddress")} testId="detail-billing-address">
                  {customer.billingStreet || customer.billingPostalCode || customer.billingCity ? (
                    <>
                      {customer.billingStreet ?? ""}
                      {"\n"}
                      {[customer.billingPostalCode, customer.billingCity].filter(Boolean).join(" ")}
                    </>
                  ) : (
                    td("billingSameAsDelivery")
                  )}
                </Field>
                <Field label={td("pin")} testId="detail-pin">
                  {customer.lat !== null && customer.lng !== null ? (
                    <span className="font-mono text-sm text-muted-foreground">
                      {customer.lat}, {customer.lng}
                    </span>
                  ) : (
                    td("pinNone")
                  )}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 id="d-key" className="flex items-center gap-2 text-lg font-semibold">
                <KeyRoundIcon className="size-5" aria-hidden />
                {tk("heading")}
              </h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid gap-4 sm:grid-cols-2" aria-labelledby="d-key">
                <Field label={tk("current")} testId="detail-key">
                  {keyText(customer)}
                </Field>
                <Field label={tk("changed")} testId="detail-key-meta">
                  {customer.keyUpdatedAt
                    ? tk("changedBy", {
                        who: actorText(customer.keyUpdatedBy),
                        date: fmt.dateTime(customer.keyUpdatedAt),
                      })
                    : tk("never")}
                </Field>
              </dl>
              {keyHistory.length > 0 ? (
                <details data-testid="key-history">
                  <summary className="cursor-pointer text-base font-medium">
                    {tk("history", { count: keyHistory.length })}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {keyHistory.map((entry) => (
                      <li key={entry.id} className="text-base" data-testid="key-history-row">
                        <span className="block text-sm text-muted-foreground">
                          {fmt.dateTime(new Date(entry.at))} · {actorText(entry.actor)}
                        </span>
                        {tk("change", { from: keyText(entry.from), to: keyText(entry.to) })}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 id="d-abbreviation" className="flex items-center gap-2 text-lg font-semibold">
                <TagIcon className="size-5" aria-hidden />
                {ta("heading")}
              </h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid gap-4 sm:grid-cols-2" aria-labelledby="d-abbreviation">
                <Field label={ta("current")} testId="detail-abbreviation">
                  {abbreviationText(customer.abbreviation)}
                </Field>
                <Field label={ta("changed")} testId="detail-abbreviation-meta">
                  {customer.abbreviationUpdatedAt
                    ? ta("changedBy", {
                        who: actorText(customer.abbreviationUpdatedBy),
                        date: fmt.dateTime(customer.abbreviationUpdatedAt),
                      })
                    : ta("never")}
                </Field>
              </dl>
              {abbreviationHistory.length > 0 ? (
                <details data-testid="abbreviation-history">
                  <summary className="cursor-pointer text-base font-medium">
                    {ta("history", { count: abbreviationHistory.length })}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {abbreviationHistory.map((entry) => (
                      <li
                        key={entry.id}
                        className="text-base"
                        data-testid="abbreviation-history-row"
                      >
                        <span className="block text-sm text-muted-foreground">
                          {fmt.dateTime(new Date(entry.at))} · {actorText(entry.actor)}
                        </span>
                        {ta("change", {
                          from: abbreviationText(entry.from),
                          to: abbreviationText(entry.to),
                        })}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <ParkingSpotsManager
            customerId={customer.id}
            spots={parkingSpots}
            tiles={tiles}
            addressPoint={
              customer.lat !== null && customer.lng !== null
                ? { lat: customer.lat, lng: customer.lng }
                : null
            }
          />

          <RecurringOrdersCard
            customerId={customer.id}
            customerActive={customer.active}
            rules={recurringRules}
            products={recurringProducts}
            today={today}
          />

          <section className="flex flex-col gap-3" aria-labelledby="d-photos">
            <h2 id="d-photos" className="text-lg font-semibold">
              {td("photosHeading")}
            </h2>
            <CustomerPhotoSlots
              customerId={customer.id}
              customerName={customer.name}
              photos={photos}
            />
          </section>

          <Card>
            <CardHeader>
              <h2 id="d-orders" className="text-lg font-semibold">
                {td("ordersHeading")}
              </h2>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <p className="text-base text-muted-foreground" data-testid="orders-empty">
                  {td("ordersEmpty")}
                </p>
              ) : (
                <ul className="flex flex-col" data-testid="orders-list" aria-labelledby="d-orders">
                  {orders.map((order) => (
                    <li
                      key={order.id}
                      className="border-b py-3 first:pt-0 last:border-0 last:pb-0"
                      data-testid="order-row"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{fmt.calendarDate(order.deliveryDate)}</span>
                        {order.fromRecurring ? (
                          <Badge variant="outline" data-testid="order-from-recurring">
                            <RepeatIcon aria-hidden />
                            {td("fromRecurring")}
                          </Badge>
                        ) : null}
                        <Badge variant={order.status === "CONFIRMED" ? "success" : "secondary"}>
                          {tc(`statuses.order.${order.status}`)}
                        </Badge>
                      </div>
                      <ul className="mt-2 flex flex-col gap-0.5 text-base">
                        {order.items.map((item) => (
                          <li key={item.id} className="tabular-nums">
                            {fmt.quantity(item.quantity)}{" "}
                            {tu(item.unit as "KG" | "PACK" | "CRATE" | "PIECE", {
                              count: Number(item.quantity),
                            })}{" "}
                            {productName(item.productName, locale)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="translations">
          <NoteTranslations
            key={noteTranslations?.updatedAt ?? "none"}
            customerId={customer.id}
            view={noteTranslations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
