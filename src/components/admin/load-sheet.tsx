import { getFormatter, getTranslations } from "next-intl/server";

import { groupByTrip, normalizeTrips } from "@/domain/fleet";
import { deliveryOrder, loadSheetTotals } from "@/domain/load-sheet";
import { type AppLocale } from "@/lib/localized-text";
import { productLabel } from "@/lib/product-label";
import type { TourPrint } from "@/server/tour-print";

const UNITS = ["KG", "PACK", "CRATE", "PIECE"] as const;
type UnitKey = (typeof UNITS)[number];
const isUnit = (u: string): u is UnitKey => (UNITS as readonly string[]).includes(u);

/**
 * The printable packing list / load sheet (NUD-091), rendered in the language of the printout
 * (`locale`). Section 1: total per product (and unit, never mixed). Section 2: per stop in delivery
 * order (stop 1 first). The quantities are the tour's own (`Stop.items`).
 */
export async function LoadSheet({ tour, locale }: { tour: TourPrint; locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.tours.print" });
  // Unit labels ("Sackerl", "Kiste", "×" for pieces) live once, under `driver.units` (§9.3).
  const tu = await getTranslations({ locale, namespace: "driver.units" });
  const format = await getFormatter({ locale });

  const quantity = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const unitText = (unit: string, count: number) =>
    isUnit(unit) ? tu(unit as "KG" | "PACK" | "CRATE" | "PIECE", { count }) : "";
  const products = new Map(tour.products.map((p) => [p.id, p]));
  const label = (productId: string) => {
    const p = products.get(productId);
    return productLabel(p?.name ?? null, p?.sku ?? "?", locale);
  };

  const trips = groupByTrip(
    [...tour.stops].sort((a, b) => a.sequence - b.sequence),
    normalizeTrips([...tour.stops].sort((a, b) => a.sequence - b.sequence).map((x) => x.trip)),
  );
  const dateText = format.dateTime(new Date(`${tour.date}T00:00:00Z`), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const released = tour.status !== "DRAFT" && tour.status !== "OPTIMIZED";

  const renderName = (productId: string) => {
    const l = label(productId);
    return (
      <>
        <span className="font-semibold">{l.primary}</span>
        {l.german ? <span className="block text-[0.85em] text-neutral-700">{l.german}</span> : null}
      </>
    );
  };

  const renderTotals = (sheetStops: TourPrint["stops"], heading: string) => (
    <section className="mb-6" data-testid="load-sheet-totals">
      <h2 className="mb-1 text-lg font-bold">{heading}</h2>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-y-2 border-black text-start">
            <th scope="col" className="w-[30%] py-1 pe-2 text-start">
              {t("quantity")}
            </th>
            <th scope="col" className="w-[70%] py-1 text-start">
              {t("product")}
            </th>
          </tr>
        </thead>
        <tbody>
          {loadSheetTotals(sheetStops, tour.products).map((row) => (
            <tr
              key={`${row.productId}-${row.unit}`}
              className="border-b border-neutral-400"
              data-testid="load-sheet-total-row"
              data-product-id={row.productId}
            >
              {/* "22 Sackerl Nudeln", "3 × Wantan-Teig": quantity and unit lead the name. */}
              <td className="py-1 pe-2 text-lg font-bold whitespace-nowrap">
                <span data-testid="load-sheet-total-qty">{quantity(row.quantity)}</span>{" "}
                <span className="text-[0.85em] font-semibold">
                  {unitText(row.unit, row.quantity)}
                </span>
              </td>
              <td className="break-words py-1">{renderName(row.productId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  const renderStops = (sheetStops: TourPrint["stops"]) => (
    <section data-testid="load-sheet-stops">
      <h2 className="text-lg font-bold">{t("stopsHeading")}</h2>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-y-2 border-black">
            <th scope="col" className="w-[10%] py-1 pe-1 text-start">
              {t("stop")}
            </th>
            <th scope="col" className="w-[38%] py-1 pe-2 text-start">
              {t("customer")}
            </th>
            <th scope="col" className="w-[52%] py-1 text-start">
              {t("items")}
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveryOrder(sheetStops).map((stop) => (
            <tr
              key={stop.id}
              className="border-b border-neutral-500 align-top"
              data-testid="load-sheet-stop-row"
              data-sequence={stop.sequence}
            >
              <td className="py-1.5 pe-1 text-lg font-bold" data-testid="load-sheet-stop-seq">
                {stop.sequence}
              </td>
              <td className="break-words py-1.5 pe-2">
                <span className="font-semibold">{stop.name}</span>
                <span className="block text-[0.85em] text-neutral-700">
                  {stop.customerNumber} · {stop.street}, {stop.postalCode} {stop.city}
                </span>
              </td>
              <td className="py-1.5">
                {stop.items.length === 0 ? (
                  <span className="text-neutral-700">{t("noItems")}</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {stop.items.map((item) => {
                      const unit = products.get(item.productId)?.unit ?? "";
                      return (
                        <li
                          key={item.productId}
                          className="flex items-baseline gap-2"
                          data-testid="load-sheet-item"
                        >
                          <span className="shrink-0 font-bold whitespace-nowrap">
                            {quantity(item.quantity)}{" "}
                            <span className="text-[0.85em] font-semibold">
                              {unitText(unit, item.quantity)}
                            </span>
                          </span>
                          <span className="min-w-0 break-words">{renderName(item.productId)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <article
      lang={locale}
      className="load-sheet mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-[10.5pt] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none"
      data-testid="load-sheet"
      data-locale={locale}
    >
      <header className="mb-4 border-b-2 border-black pb-3">
        <h1 className="text-2xl font-bold" data-testid="load-sheet-title">
          {t("title")}
        </h1>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          <dt className="font-semibold">{t("date")}</dt>
          <dd data-testid="load-sheet-date">{dateText}</dd>
          <dt className="font-semibold">{t("driver")}</dt>
          <dd data-testid="load-sheet-driver">{tour.driverName ?? t("driverNone")}</dd>
          <dt className="font-semibold">{t("depot")}</dt>
          <dd data-testid="load-sheet-depot">
            {tour.depot ? `${tour.depot.name}, ${tour.depot.address}` : "–"}
          </dd>
          <dt className="font-semibold">{t("stops")}</dt>
          <dd data-testid="load-sheet-stop-count">
            {tour.stops.length}
            {released
              ? ` · ${t("version", { revision: tour.releaseRevision })}`
              : ` · ${t("notReleased")}`}
          </dd>
        </dl>
        {tour.isOutdated ? (
          <p
            role="alert"
            className="mt-3 border-4 border-black bg-white p-2 text-base font-bold"
            data-testid="load-sheet-outdated"
          >
            {t("outdated")}
          </p>
        ) : null}
      </header>

      {tour.stops.length === 0 ? (
        <p className="py-6 text-center" data-testid="load-sheet-empty">
          {t("empty")}
        </p>
      ) : trips.length > 1 ? (
        // Reload trips (NUD-147): one block per trip, each with its own totals and load order.
        trips.map((tripStops, index) => (
          <section
            key={index}
            className="mb-8 break-inside-avoid-page"
            data-testid="load-sheet-trip"
            data-trip={index + 1}
          >
            <h2 className="mb-2 border-b-2 border-black pb-1 text-xl font-bold">
              {t("tripHeading", { n: index + 1, count: trips.length })}
              {tripStops[0]?.vehicleName ? ` · ${tripStops[0].vehicleName}` : null}
            </h2>
            {renderTotals(tripStops, t("tripLoad"))}
            {renderStops(tripStops)}
            {index < trips.length - 1 ? (
              <p className="mt-2 font-semibold" data-testid="load-sheet-reload">
                {/* NUD-158: another vehicle on the next trip = the driver switches into it. */}
                {trips[index + 1]![0]?.vehicleName &&
                trips[index + 1]![0]!.vehicleName !== tripStops[0]?.vehicleName
                  ? t("switchNote", { vehicle: trips[index + 1]![0]!.vehicleName! })
                  : t("reloadNote")}
              </p>
            ) : null}
          </section>
        ))
      ) : (
        <>
          {renderTotals(tour.stops, t("totalsHeading"))}
          {renderStops(tour.stops)}
        </>
      )}
    </article>
  );
}
