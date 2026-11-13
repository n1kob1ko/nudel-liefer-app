import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import { BillDownloadButtons, MonthExportForm } from "./bill-export";

const basePath = vi.hoisted(() => ({ value: "" }));
vi.mock("@/lib/base-path", () => ({
  withBasePath: (path: string) => `${basePath.value}${path}`,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

afterEach(() => {
  cleanup();
  basePath.value = "";
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.restoreAllMocks();
  vi.mocked(toast.error).mockReset();
});

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

describe("downloading", () => {
  /** What the browser was asked to save: file name and address of the temporary link. */
  let saved: Array<{ name: string; href: string }>;

  beforeEach(() => {
    saved = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ name: this.download, href: this.getAttribute("href") ?? "" });
    });
    URL.createObjectURL = vi.fn(() => "blob:bill");
    URL.revokeObjectURL = vi.fn();
  });

  const fileResponse = () =>
    new Response("%PDF-", {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="monatsrechnung-D-001-2099-05.pdf"',
      },
    });

  it("fetches the file and hands it to the browser under the name the server gave it", async () => {
    const fetchMock = vi.fn(async () => fileResponse());
    vi.stubGlobal("fetch", fetchMock);
    wrap(<BillDownloadButtons customerId="c1" month="2099-05" />);

    fireEvent.click(screen.getByTestId("bill-export-pdf"));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/payments/export?month=2099-05&format=pdf&locale=de&customer=c1",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(saved[0]).toEqual({ name: "monatsrechnung-D-001-2099-05.pdf", href: "blob:bill" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when the server refuses, instead of saving the error as a file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "unauthenticated" }, { status: 401 })),
    );
    wrap(<MonthExportForm months={[{ value: "2099-05", label: "Mai 2099" }]} />);

    fireEvent.click(screen.getByTestId("month-export-download"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Der Download hat nicht geklappt. Bitte die Seite neu laden und noch einmal versuchen.",
      ),
    );
    expect(saved).toHaveLength(0);
  });

  it("says so when the connection drops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    wrap(<BillDownloadButtons customerId="c1" month="2099-05" />);

    fireEvent.click(screen.getByTestId("bill-export-csv"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(saved).toHaveLength(0);
  });

  it("starts one download per click, not two for a double click", async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    wrap(<BillDownloadButtons customerId="c1" month="2099-05" />);
    const link = screen.getByTestId("bill-export-pdf");

    fireEvent.click(link);
    fireEvent.click(link);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(link.getAttribute("aria-busy")).toBe("true");

    finish(fileResponse());
    await waitFor(() => expect(link.getAttribute("aria-busy")).toBeNull());
    expect(saved).toHaveLength(1);
  });

  it("leaves a click with a modifier key to the browser", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<BillDownloadButtons customerId="c1" month="2099-05" />);

    // jsdom cannot follow a link; stop it after the component had its say.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByTestId("bill-export-pdf"), { ctrlKey: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links below the sub-path the app is served from", () => {
    basePath.value = "/delivery-app";
    wrap(<BillDownloadButtons customerId="c1" month="2099-05" />);
    expect(href("bill-export-pdf")).toBe(
      "/delivery-app/api/admin/payments/export?month=2099-05&format=pdf&locale=de&customer=c1",
    );
  });
});
