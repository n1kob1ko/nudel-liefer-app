import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrderFilters as Filters } from "@/domain/order-overview";

import de from "../../../messages/de.json";
import { OrderFilters } from "./order-filters";

const replace = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/admin/orders",
  useRouter: () => ({ replace }),
}));

const DAY = "2099-07-01";
const base: Filters = { from: DAY, to: DAY, customerId: null, status: null, source: null };

function renderFilters(filters: Filters = base) {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={de}
      onError={(error) => {
        throw error;
      }}
    >
      <OrderFilters filters={filters} customers={[]} defaultDate={DAY} today={DAY} />
    </NextIntlClientProvider>,
  );
}

const more = () => document.getElementById("order-filters-more")!;

describe("OrderFilters", () => {
  afterEach(() => {
    cleanup();
    replace.mockClear();
  });

  it("shows the day and the customer, and keeps status and source behind one button", () => {
    renderFilters();
    expect(screen.getByTestId("quick-next")).toBeInTheDocument();
    expect(screen.getByTestId("filter-range")).toHaveClass("hidden");
    expect(more()).toHaveClass("hidden");
    const button = screen.getByTestId("filter-more");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "order-filters-more");

    fireEvent.click(button);
    expect(more()).not.toHaveClass("hidden");
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(more()).toHaveClass("hidden");
  });

  it("never hides a filter that is set", () => {
    renderFilters({ ...base, status: "CANCELLED" });
    expect(more()).not.toHaveClass("hidden");
    expect(screen.getByTestId("filter-status-CANCELLED")).toHaveAttribute("aria-checked", "true");
    // Closing is not possible while the filter narrows the list.
    fireEvent.click(screen.getByTestId("filter-more"));
    expect(more()).not.toHaveClass("hidden");
  });

  it("shows Von and Bis only for a date range", () => {
    renderFilters();
    fireEvent.click(screen.getByTestId("quick-custom"));
    expect(screen.getByTestId("filter-range")).not.toHaveClass("hidden");
    expect(screen.getByTestId("filter-from")).toHaveValue(DAY);
  });
});
