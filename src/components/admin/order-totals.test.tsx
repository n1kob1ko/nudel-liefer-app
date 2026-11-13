import { cleanup, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aggregateTotalsByDate, type TotalsOrder } from "@/domain/order-overview";
import type { DateTotalsView, OrderOverviewRow } from "@/server/orders";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import fragment from "../../../tests/fixtures/locale/orders-totals.json";
import { OrderTotals } from "./order-totals";

type Tree = Record<string, unknown>;
type ProductName = { de: string; "zh-Hans": string };

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children: ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : JSON.stringify(href)} {...rest}>
      {children}
    </a>
  ),
}));

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key];
    out[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object"
        ? merge(current as Tree, value as Tree)
        : value;
  }
  return out;
}

// The fragment is not merged into de.json/zh-Hans.json yet (message-key protocol), so the test
// merges it the same way the orchestrator will.
const LOCALES: Record<string, AbstractIntlMessages> = {
  de: merge(de as unknown as Tree, fragment.de as unknown as Tree) as AbstractIntlMessages,
  "zh-Hans": merge(
    zhHans as unknown as Tree,
    fragment["zh-Hans"] as unknown as Tree,
  ) as AbstractIntlMessages,
};

const D1 = "2099-05-04";
const D2 = "2099-05-05";
const SPAG = "spag";
const PENN = "penn";

/** The same shape the overview page loads: drafts and cancelled orders never count. */
const orders: TotalsOrder[] = [
  {
    deliveryDate: D1,
    status: "CONFIRMED",
    items: [
      { productId: SPAG, quantity: 3 },
      { productId: PENN, quantity: 1 },
    ],
  },
  { deliveryDate: D1, status: "CONFIRMED", items: [{ productId: SPAG, quantity: 4 }] },
  { deliveryDate: D1, status: "DRAFT", items: [{ productId: SPAG, quantity: 77 }] },
  { deliveryDate: D1, status: "CANCELLED", items: [{ productId: SPAG, quantity: 99 }] },
  { deliveryDate: D2, status: "CONFIRMED", items: [{ productId: PENN, quantity: 6 }] },
];

const NAMES: Record<string, ProductName> = {
  [SPAG]: { de: "Spaghetti 5 kg", "zh-Hans": "意大利面 5 公斤" },
  [PENN]: { de: "Penne 5 kg", "zh-Hans": "通心粉 5 公斤" },
};

/** A product name as the database stores it (`LocalizedText` carries its `meta` block). */
const localized = (names: ProductName) => ({
  ...names,
  meta: { source: "de" as const, machine: {}, updatedAt: "2099-01-01T00:00:00.000Z" },
});

/** The server view of the same aggregate: product names and units added, numbers untouched. */
const totals: DateTotalsView[] = aggregateTotalsByDate(orders).map((day) => ({
  date: day.date,
  orderCount: day.orderCount,
  products: day.products.map((p) => ({
    productId: p.productId,
    productName: localized(NAMES[p.productId]),
    sku: p.productId,
    unit: "PACK",
    quantity: p.quantity,
  })),
}));

const rows: OrderOverviewRow[] = [
  {
    id: "o1",
    deliveryDate: new Date(`${D1}T00:00:00.000Z`),
    window: {
      from: new Date(`${D1}T00:00:00.000Z`),
      to: new Date(`${D1}T00:00:00.000Z`),
      fromTime: null,
      toTime: null,
    },
    status: "CONFIRMED",
    source: "MANUAL",
    fromRecurring: false,
    paymentTerm: "MONTHLY",
    amountCents: null,
    customer: { id: "c1", customerNumber: "K-1", name: "Osteria A" },
    items: [],
    tour: {
      tourId: "tour-1",
      stopId: "stop-1",
      date: "2099-07-02",
      tourStatus: "RELEASED",
      stopStatus: "PENDING",
      completedAt: null,
    },
  },
];

const number = (locale: string, value: number) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

/**
 * The unit label the card must render for a quantity. The ICU plural lives once, under
 * `driver.units` ("7 Packungen", "1 Packung"); the card reuses it, so the expectation is
 * resolved through the same catalog instead of hard-coding "Packung".
 */
function unitLabel(locale: string, count: number): string {
  function Probe() {
    return (
      <span data-testid="unit-probe">{useTranslations("driver.units")("PACK", { count })}</span>
    );
  }
  const view = render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
    >
      <Probe />
    </NextIntlClientProvider>,
  );
  const text = view.getByTestId("unit-probe").textContent ?? "";
  view.unmount();
  return text;
}
const calendarDate = (locale: string, date: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );

function renderIn(locale: string, data: DateTotalsView[], allRows: OrderOverviewRow[] = []) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
    >
      <OrderTotals totals={data} orders={allRows} />
    </NextIntlClientProvider>,
  );
}

/** Rendered cells of the row that carries the product name. */
function rowCells(day: HTMLElement, product: string): string[] {
  const row = within(day).getByText(product).closest("tr");
  if (!row) throw new Error(`no row for ${product}`);
  return [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? "");
}

afterEach(cleanup);

describe("the aggregate behind the totals card", () => {
  it("counts confirmed orders only and sums exactly per product and day", () => {
    expect(aggregateTotalsByDate(orders)).toEqual([
      {
        date: D1,
        orderCount: 2,
        products: [
          { productId: PENN, quantity: 1 },
          { productId: SPAG, quantity: 7 },
        ],
      },
      { date: D2, orderCount: 1, products: [{ productId: PENN, quantity: 6 }] },
    ]);
  });
});

describe.each(Object.keys(LOCALES))("OrderTotals (%s)", (locale) => {
  it("renders the aggregate numbers unchanged, one compact table per day", () => {
    renderIn(locale, totals, rows);

    const days = screen.getAllByTestId("totals-day");
    expect(days).toHaveLength(2);
    expect(days[0]).toHaveAttribute("data-date", D1);
    expect(days[1]).toHaveAttribute("data-date", D2);
    expect(days[0].textContent).toContain(calendarDate(locale, D1));

    const unit = unitLabel(locale, 7);
    // The aggregate says 7 / 1 / 6 — never the draft (77) or the cancelled order (99).
    expect(rowCells(days[0], NAMES[SPAG][locale as "de"])).toEqual([
      NAMES[SPAG][locale as "de"],
      `${number(locale, 7)} ${unit}`,
    ]);
    expect(rowCells(days[0], NAMES[PENN][locale as "de"])).toEqual([
      NAMES[PENN][locale as "de"],
      `${number(locale, 1)} ${unitLabel(locale, 1)}`,
    ]);
    expect(rowCells(days[1], NAMES[PENN][locale as "de"])).toEqual([
      NAMES[PENN][locale as "de"],
      `${number(locale, 6)} ${unitLabel(locale, 6)}`,
    ]);
  });

  it("shows the confirmed-order count of the day and links the load sheet of its tour", () => {
    renderIn(locale, totals, rows);
    const days = screen.getAllByTestId("totals-day");
    expect(within(days[0]).getByRole("heading").textContent).toContain("2");
    expect(within(days[1]).getByRole("heading").textContent).toContain("1");

    const print = screen.getByTestId("totals-print");
    expect(print.getAttribute("href")).toContain("/admin/tours/tour-1/print");
    expect(print.getAttribute("href")).toContain(locale);
  });

  it("offers no load-sheet link for a day without a tour", () => {
    renderIn(locale, totals, []);
    expect(screen.queryByTestId("totals-print")).toBeNull();
  });

  it("says so when the range has no confirmed orders", () => {
    renderIn(locale, [], []);
    expect(screen.getByTestId("totals-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("totals-day")).toHaveLength(0);
  });
});
