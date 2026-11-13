import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrderOverviewRow } from "@/server/orders";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import { OrdersTable } from "./orders-table";

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

const LOCALES: Record<string, AbstractIntlMessages> = {
  de: de as AbstractIntlMessages,
  "zh-Hans": zhHans as AbstractIntlMessages,
};

const localized = (de: string, hans: string) => ({
  de,
  "zh-Hans": hans,
  meta: { source: "de" as const, machine: {}, updatedAt: "2099-01-01T00:00:00.000Z" },
});

const row = (
  id: string,
  date: string,
  overrides: Partial<OrderOverviewRow> = {},
): OrderOverviewRow => ({
  id,
  deliveryDate: new Date(`${date}T00:00:00.000Z`),
  window: {
    from: new Date(`${date}T00:00:00.000Z`),
    to: new Date(`${date}T00:00:00.000Z`),
    fromTime: null,
    toTime: null,
  },
  status: "CONFIRMED",
  source: "MANUAL",
  fromRecurring: false,
  paymentTerm: "MONTHLY",
  amountCents: null,
  customer: { id: `c-${id}`, customerNumber: `K-${id}`, name: `Kunde ${id}` },
  items: [
    {
      id: `i-${id}-1`,
      productName: localized("Spaghetti 5 kg", "意大利面 5 公斤"),
      unit: "PACK",
      quantity: 3,
    },
    {
      id: `i-${id}-2`,
      productName: localized("Penne 5 kg", "通心粉 5 公斤"),
      unit: "PACK",
      quantity: 1,
    },
  ],
  tour: null,
  ...overrides,
});

const D1 = "2099-05-04";
const D2 = "2099-05-05";
const TODAY = "2099-05-04";

function renderIn(locale: string, orders: OrderOverviewRow[], multiDay: boolean) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
    >
      <OrdersTable orders={orders} multiDay={multiDay} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe.each(Object.keys(LOCALES))("OrdersTable (%s)", (locale) => {
  it("groups the rows of a single day under one date header, without the Liefertag column", () => {
    renderIn(locale, [row("a", D1), row("b", D1)], false);

    const groups = screen.getAllByTestId("order-group");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAttribute("data-date", D1);
    expect(screen.getAllByTestId("order-row")).toHaveLength(2);
    // The date column is gone; the day lives in the group header only.
    expect(screen.queryByText(locale === "de" ? "Lieferdatum" : "送货日期")).toBeNull();
  });

  it("shows the Liefertag column instead of group headers when the range spans days", () => {
    renderIn(locale, [row("a", D1), row("b", D2)], true);

    expect(screen.queryAllByTestId("order-group")).toHaveLength(0);
    expect(screen.getByText(locale === "de" ? "Lieferdatum" : "送货日期")).toBeInTheDocument();
  });

  it("keeps the spec ids on every row: count, lines, status, source and tour", () => {
    renderIn(
      locale,
      [
        row("a", D1, {
          source: "SCREENSHOT",
          tour: {
            tourId: "tour-1",
            stopId: "stop-1",
            date: "2099-07-02",
            tourStatus: "RELEASED",
            stopStatus: "PENDING",
            completedAt: null,
          },
        }),
      ],
      false,
    );

    const first = screen.getByTestId("order-row");
    expect(within(first).getByTestId("order-line-count")).toHaveTextContent("2");
    expect(within(first).getAllByTestId("order-item")).toHaveLength(2);
    expect(within(first).getByTestId("order-status").textContent).toContain(
      locale === "de" ? "Bestätigt" : "已确认",
    );
    expect(within(first).getByTestId("order-source")).toHaveAttribute("data-source", "SCREENSHOT");
    expect(within(first).getByTestId("order-in-tour")).toHaveAttribute("data-tour-id", "tour-1");
    expect(within(first).getByTestId("order-open")).toHaveAttribute("href", "/admin/orders/a");
  });

  it("opens the right drawer with the order when the row is clicked", () => {
    renderIn(locale, [row("a", D1)], false);

    expect(screen.queryByTestId("order-drawer")).toBeNull();
    fireEvent.click(screen.getByTestId("order-row"));

    const drawer = screen.getByTestId("order-drawer");
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText(`Kunde a`)).toBeInTheDocument();
    expect(within(drawer).getByTestId("drawer-open-order")).toHaveAttribute(
      "href",
      "/admin/orders/a",
    );
    // TODAY is the delivery day, so the order can still be edited.
    expect(within(drawer).getByTestId("drawer-edit-order")).toHaveAttribute(
      "href",
      "/admin/orders/a/edit",
    );
  });
});
