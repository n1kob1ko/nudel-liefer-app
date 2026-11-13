import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import { BillDownloadButtons, MonthExportForm } from "./bill-export";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
// Radix' Select scrolls the active option into view and takes pointer capture, which jsdom does
// not implement.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.setPointerCapture = vi.fn();

const wrap = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="de" messages={de as unknown as AbstractIntlMessages}>
      {node}
    </NextIntlClientProvider>,
  );

const href = (testId: string) => screen.getByTestId(testId).getAttribute("href");

afterEach(cleanup);

describe("BillDownloadButtons", () => {
  it("offers the month of one customer as PDF and as CSV, in the language of the screen", () => {
    wrap(<BillDownloadButtons customerId="c1" month="2099-05" />);

    expect(href("bill-export-pdf")).toBe(
      "/api/admin/payments/export?month=2099-05&format=pdf&locale=de&customer=c1",
    );
    expect(href("bill-export-csv")).toBe(
      "/api/admin/payments/export?month=2099-05&format=csv&locale=de&customer=c1",
    );
    // Short visible words, a full sentence for screen readers.
    expect(screen.getByTestId("bill-export-pdf").textContent).toBe("PDF");
    expect(screen.getByRole("link", { name: "Monatsrechnung als PDF herunterladen" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Monatsrechnung als CSV für Excel herunterladen" }),
    ).toBeTruthy();
  });
});

describe("MonthExportForm", () => {
  const months = [
    { value: "2099-05", label: "Mai 2099" },
    { value: "2099-04", label: "April 2099" },
  ];

  it("links the CSV of all customers for the first month in the list", () => {
    wrap(<MonthExportForm months={months} />);
    expect(href("month-export-download")).toBe(
      "/api/admin/payments/export?month=2099-05&format=csv&locale=de",
    );
  });

  it("starts on the month it is told to: the last finished month, not the running one", () => {
    wrap(<MonthExportForm months={months} defaultMonth="2099-04" />);
    expect(href("month-export-download")).toBe(
      "/api/admin/payments/export?month=2099-04&format=csv&locale=de",
    );
  });

  it("follows the month the office picks", () => {
    wrap(<MonthExportForm months={months} />);
    fireEvent.click(screen.getByTestId("month-export-month"));
    fireEvent.click(screen.getByRole("option", { name: "April 2099" }));
    expect(href("month-export-download")).toBe(
      "/api/admin/payments/export?month=2099-04&format=csv&locale=de",
    );
  });
});
