import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import { PaymentHistoryFilters } from "./payment-history-filters";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.setPointerCapture = vi.fn();

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/payments/history",
}));

function renderFilters(values: { q: string; year: number | null } = { q: "", year: null }) {
  return render(
    <NextIntlClientProvider locale="de" messages={de as unknown as AbstractIntlMessages}>
      <PaymentHistoryFilters values={values} years={[2099, 2098]} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PaymentHistoryFilters", () => {
  it("searches after a short pause, back on the first page", () => {
    renderFilters();
    fireEvent.change(screen.getByTestId("history-search"), { target: { value: "gelso" } });
    expect(replace).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(250));
    expect(replace).toHaveBeenCalledWith({
      pathname: "/admin/payments/history",
      query: { q: "gelso" },
    });
  });

  it("filters by the year the office picks and keeps the search", () => {
    renderFilters({ q: "gelso", year: null });
    fireEvent.click(screen.getByTestId("history-year"));
    fireEvent.click(screen.getByRole("option", { name: "2098" }));
    expect(replace).toHaveBeenCalledWith({
      pathname: "/admin/payments/history",
      query: { q: "gelso", year: "2098" },
    });
  });

  it("offers a reset only while a filter is set", () => {
    renderFilters();
    expect(screen.queryByTestId("history-reset")).toBeNull();
    cleanup();

    renderFilters({ q: "gelso", year: 2099 });
    fireEvent.click(screen.getByTestId("history-reset"));
    expect(replace).toHaveBeenCalledWith({ pathname: "/admin/payments/history", query: {} });
  });
});
