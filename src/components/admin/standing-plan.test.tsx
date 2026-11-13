import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DayPlan, PlanProduct } from "@/domain/standing-day";
import { saveStandingDayAction, setStandingTourDriverAction } from "@/server/standing-actions";

import de from "../../../messages/de.json";
import { StandingPlan } from "./standing-plan";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
// Radix' Select (the driver picker) scrolls the active option into view and takes pointer capture,
// which jsdom does not implement.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.setPointerCapture = vi.fn();

vi.mock("@/server/standing-actions", () => ({
  saveStandingDayAction: vi.fn(),
  setStandingTourDriverAction: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const text = (value: string) => ({
  de: value,
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00.000Z" },
});

const PRODUCTS: PlanProduct[] = [
  {
    id: "p-pack",
    sku: "NUDELN-BEUTEL",
    name: text("Nudeln (Sackerl)"),
    unit: "PACK",
    weightKgPerUnit: "3",
    sortOrder: 1,
  },
  {
    id: "p-crate",
    sku: "NUDELN-KARTON",
    name: text("Nudeln (Kiste)"),
    unit: "CRATE",
    weightKgPerUnit: "10",
    sortOrder: 2,
  },
];

function plan(overrides: Partial<DayPlan> = {}): DayPlan {
  return {
    date: "2099-06-15",
    products: PRODUCTS,
    routes: [
      {
        id: "r1",
        name: "Stammtour 1",
        driverId: "u1",
        driverName: "Anna",
        rows: [
          {
            customerId: "c1",
            customerNumber: "C1",
            name: "Bistro Eins",
            city: "Wien",
            orderId: "o1",
            orderCount: 1,
            cancelled: false,
            source: "order",
            quantities: { "p-pack": 2, "p-crate": 0 },
            nothing: false,
            weightKg: 6,
          },
          {
            customerId: "c2",
            customerNumber: "C2",
            name: "Gasthaus Zwei",
            city: "Wien",
            orderId: "o2",
            orderCount: 2,
            cancelled: false,
            source: "order",
            quantities: { "p-pack": 0, "p-crate": 0 },
            nothing: true,
            weightKg: 0,
          },
        ],
      },
    ],
    offRoute: [
      {
        customerId: "c3",
        customerNumber: "C3",
        name: "Pizzeria Drei",
        city: "Wien",
        orderId: null,
        orderCount: 0,
        cancelled: false,
        source: "none",
        quantities: { "p-pack": 0, "p-crate": 0 },
        nothing: false,
        weightKg: 0,
      },
    ],
    editable: true,
    readOnly: null,
    ...overrides,
  };
}

function renderPlan(value: DayPlan = plan()) {
  render(
    <NextIntlClientProvider
      locale="de"
      messages={de as unknown as AbstractIntlMessages}
      onError={(error) => {
        throw error;
      }}
    >
      <StandingPlan
        plan={value}
        drivers={[
          { id: "u1", displayName: "Anna" },
          { id: "u2", displayName: "Bernd" },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

const lastInput = (mock: { mock: { calls: unknown[][] } }, argument = 0) =>
  mock.mock.calls.at(-1)?.[argument] as Record<string, unknown>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StandingPlan (NUD-194)", () => {
  it("renders one table per standing tour with a column per product and the day's quantities", () => {
    renderPlan();

    expect(screen.getByText("Stammtour 1")).toBeInTheDocument();
    // One product column per table (the standing tour and the off-route list).
    expect(screen.getAllByRole("columnheader", { name: /Nudeln \(Sackerl\)/ })).toHaveLength(2);
    expect(screen.getByText("Bistro Eins")).toBeInTheDocument();
    expect(screen.getByTestId("qty-c1-p-pack")).toHaveValue("2");
    expect(screen.getByTestId("qty-c1-p-crate")).toHaveValue("0");
    // Several orders of one customer and "nothing ordered" are marked.
    expect(screen.getByTestId("nothing-c2")).toBeInTheDocument();
    expect(screen.getByText("mehrere Bestellungen")).toBeInTheDocument();
  });

  it("saves the edited quantities of every route row, 0 included", async () => {
    vi.mocked(saveStandingDayAction).mockResolvedValue({
      ok: true,
      written: 1,
      created: 0,
      updated: 1,
      merged: 0,
    });
    renderPlan();

    fireEvent.change(screen.getByTestId("qty-c1-p-pack"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("qty-c1-p-crate"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("planning-save"));

    await waitFor(() => expect(saveStandingDayAction).toHaveBeenCalled());
    expect(lastInput(vi.mocked(saveStandingDayAction))).toEqual({
      date: "2099-06-15",
      rows: [
        {
          customerId: "c1",
          lines: [
            { productId: "p-pack", quantity: 5 },
            { productId: "p-crate", quantity: 1 },
          ],
        },
        {
          customerId: "c2",
          lines: [
            { productId: "p-pack", quantity: 0 },
            { productId: "p-crate", quantity: 0 },
          ],
        },
      ],
    });
  });

  it("adds an off-route customer for this delivery day only", async () => {
    vi.mocked(saveStandingDayAction).mockResolvedValue({
      ok: true,
      written: 1,
      created: 1,
      updated: 0,
      merged: 0,
    });
    renderPlan();

    // Before "Hinzufügen" the row has no fields at all.
    expect(screen.queryByTestId("qty-c3-p-pack")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("off-route-add-c3"));
    fireEvent.change(screen.getByTestId("qty-c3-p-pack"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("planning-save"));

    await waitFor(() => expect(saveStandingDayAction).toHaveBeenCalled());
    const input = lastInput(vi.mocked(saveStandingDayAction)) as {
      rows: Array<{ customerId: string; lines: Array<{ productId: string; quantity: number }> }>;
    };
    expect(input.rows.at(-1)).toEqual({
      customerId: "c3",
      lines: [
        { productId: "p-pack", quantity: 3 },
        { productId: "p-crate", quantity: 0 },
      ],
    });
  });

  it("is read-only once a tour of the day is released", () => {
    renderPlan(plan({ editable: false, readOnly: "released" }));

    expect(screen.getByTestId("planning-read-only")).toBeInTheDocument();
    expect(screen.getByTestId("qty-c1-p-pack")).toBeDisabled();
    expect(screen.queryByTestId("planning-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("off-route-add-c3")).not.toBeInTheDocument();
  });

  it("shows the server error instead of saving silently", async () => {
    vi.mocked(saveStandingDayAction).mockResolvedValue({ ok: false, error: "tour_released" });
    renderPlan();

    fireEvent.click(screen.getByTestId("planning-save"));

    await waitFor(() => expect(screen.getByTestId("planning-error")).toBeInTheDocument());
    expect(screen.getByTestId("planning-error").textContent).toContain("freigegeben");
  });

  it("changes the default driver of a standing tour", async () => {
    vi.mocked(setStandingTourDriverAction).mockResolvedValue({
      ok: true,
      id: "r1",
      active: true,
    });
    renderPlan();

    // The Radix select opens in a portal; picking another driver triggers the action.
    fireEvent.click(screen.getByTestId("driver-r1"));
    const option = await screen.findByRole("option", { name: "Bernd" });
    fireEvent.pointerDown(option, { button: 0 });
    fireEvent.pointerUp(option, { button: 0 });
    fireEvent.click(option);

    await waitFor(() => expect(setStandingTourDriverAction).toHaveBeenCalledWith("r1", "u2"));
  });
  it("keeps a zero quiet and marks a field that holds a quantity", () => {
    renderPlan();

    expect(screen.getByTestId("qty-c1-p-pack")).toHaveAttribute("data-filled", "true");
    expect(screen.getByTestId("qty-c1-p-crate")).toHaveAttribute("data-filled", "false");
  });

  it("moves down and up in the same column with Enter and the arrow keys", () => {
    renderPlan();
    const first = screen.getByTestId("qty-c1-p-crate");
    const second = screen.getByTestId("qty-c2-p-crate");

    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    // The last row has nowhere to go: the focus stays where it is.
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(second).toHaveFocus();
  });

  it("counts the customers whose quantities differ from the saved ones", () => {
    renderPlan();
    expect(screen.queryByTestId("planning-dirty")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("qty-c1-p-pack"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("qty-c1-p-crate"), { target: { value: "1" } });
    expect(screen.getByTestId("planning-dirty")).toHaveTextContent("1 Kunde geändert");

    fireEvent.change(screen.getByTestId("qty-c2-p-pack"), { target: { value: "3" } });
    expect(screen.getByTestId("planning-dirty")).toHaveTextContent("2 Kunden geändert");

    // Typing the saved quantity again is no change.
    fireEvent.change(screen.getByTestId("qty-c2-p-pack"), { target: { value: "0" } });
    fireEvent.change(screen.getByTestId("qty-c1-p-pack"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("qty-c1-p-crate"), { target: { value: "" } });
    expect(screen.queryByTestId("planning-dirty")).not.toBeInTheDocument();
  });

  it("sums the whole day next to the save button, across every tour", () => {
    renderPlan();
    const total = screen.getByTestId("planning-day-total");
    expect(total).toHaveTextContent("Nudeln (Sackerl) 2");
    expect(total).toHaveTextContent("Nudeln (Kiste) 0");
    expect(total).toHaveTextContent("6 kg");

    fireEvent.change(screen.getByTestId("qty-c2-p-crate"), { target: { value: "2" } });
    expect(total).toHaveTextContent("Nudeln (Kiste) 2");
    expect(total).toHaveTextContent("26 kg");
  });
});
