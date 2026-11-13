import { ChevronDownIcon, PrinterIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { numericCell } from "@/components/ui/table";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import type { DateTotalsView, OrderOverviewRow } from "@/server/orders";

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/**
 * Summen je Liefertag (re-design.md §8.3): one bar above the order list, as wide as the list. When
 * the range is a single day the bar already says the sums ("34 Sackerl Nudeln · 12 Stück
 * Wantan-Teig"); opened, it shows one compact two-column table (product · quantity,
 * `tabular-nums`) per date of the selected range.
 *
 * The numbers come from `aggregateTotalsByDate` through `getDateTotals` — unchanged. The card only
 * presents them; the "Ladeliste drucken" link reuses the existing print route of the tour of that
 * day (no duplicated load-sheet logic), and is omitted while no tour exists for the date.
 * `<details>` keeps the collapse working without JavaScript; it starts **collapsed** so the order
 * rows stay the first thing on the screen (§8.3 + the density review).
 */
export function OrderTotals({
  totals,
  orders,
}: {
  totals: DateTotalsView[];
  /** The rows of the same range — only read to link a day to the print view of its tour. */
  orders: OrderOverviewRow[];
}) {
  const t = useTranslations("admin.orders.totals");
  const tp = useTranslations("admin.tours.print");
  // Quantities without a product name next to them ("22 Sackerl", "3 Stück") use the word forms
  // under `driver.unitsTotal` (§9.3); "×" only exists in front of a product name.
  const tu = useTranslations("driver.unitsTotal");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  const tourByDate = new Map<string, string>();
  for (const order of orders) {
    if (order.tour) tourByDate.set(formatCalendarDate(order.deliveryDate), order.tour.tourId);
  }

  return (
    <Card data-testid="totals" className="@container gap-0 py-3">
      <details aria-labelledby="totals-heading" className="group flex flex-col">
        {/* The card title is an `h2` (the page has the only `h1`; the days are `h3`), so the
            heading order never skips a level. Only the title and the chevron sit in the summary:
            in the narrow rail the description would otherwise be squeezed to a word per line. */}
        <summary
          data-testid="totals-toggle"
          className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id="totals-heading" className="text-base font-semibold">
              {t("heading")}
            </h2>
            {/* One day: the sums are short enough to stand in the bar itself. Hidden while the
                bar is open, where the table below says the same. */}
            {totals.length === 1 && totals[0] ? (
              <span
                className="min-w-0 text-sm text-muted-foreground tabular-nums group-open:hidden"
                data-testid="totals-inline"
              >
                {totals[0].products
                  .map(
                    (p) =>
                      `${fmt.quantity(p.quantity)} ${tu(p.unit as "KG" | "PACK" | "CRATE" | "PIECE")} ${productName(p.productName, locale)}`,
                  )
                  .join(" · ")}
              </span>
            ) : null}
          </span>
          <ChevronDownIcon
            className="size-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
          <span className="sr-only">{t("toggle")}</span>
        </summary>

        {/* Two day tables side by side while the card is wide (above the table) or a day column
            would be left half empty; a single day fills the width. */}
        <div
          className={cn(
            "grid gap-x-8 gap-y-4 px-4 pt-3",
            totals.length > 1 ? "@lg:grid-cols-2 @4xl:grid-cols-3" : "max-w-md",
          )}
        >
          {totals.length === 0 ? (
            <p className="text-base text-muted-foreground" data-testid="totals-empty">
              {t("empty")}
            </p>
          ) : (
            totals.map((day) => {
              const date = parseCalendarDate(day.date);
              const heading = t("dateHeading", {
                date: date ? fmt.calendarDate(date) : day.date,
                count: day.orderCount,
              });
              const tourId = tourByDate.get(day.date);
              return (
                <div
                  key={day.date}
                  className="flex flex-col gap-1.5 border-t border-border pt-3"
                  data-testid="totals-day"
                  data-date={day.date}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-base font-semibold">{heading}</h3>
                    {tourId ? (
                      <Link
                        href={{ pathname: `/admin/tours/${tourId}/print`, query: { locale } }}
                        className="inline-flex items-center gap-1.5 link text-sm"
                        data-testid="totals-print"
                      >
                        <PrinterIcon className="size-4" aria-hidden />
                        {tp("open")}
                      </Link>
                    ) : null}
                  </div>
                  <table className="w-full text-sm">
                    <caption className="sr-only">{heading}</caption>
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">{t("product")}</th>
                        <th scope="col">{t("quantity")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.products.map((p) => (
                        <tr
                          key={p.productId}
                          className="border-b border-border/60 last:border-0"
                          data-testid="totals-product"
                        >
                          {/* `overflow-wrap: anywhere` keeps a long product word inside the narrow
                              rail (14 rem at 1280 px) instead of pushing the quantity column out of
                              the card. */}
                          <td className="py-1 pe-2 [overflow-wrap:anywhere]">
                            {productName(p.productName, locale)}
                          </td>
                          <td className={`${numericCell} py-1 font-medium whitespace-nowrap`}>
                            {fmt.quantity(p.quantity)}{" "}
                            {tu(p.unit as "KG" | "PACK" | "CRATE" | "PIECE")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      </details>
    </Card>
  );
}
