import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DayPlan, PlanProduct } from "@/domain/standing-day";
import {
  moveExtraAction,
  saveStandingDayAction,
  sendDayAction,
  setStandingTourDriverAction,
  setStandingTourVehicleAction,
} from "@/server/standing-actions";

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
  setStandingTourVehicleAction: vi.fn(),
  moveExtraAction: vi.fn(),
  sendDayAction: vi.fn(),
}));
vi.mock("@/components/maps/lazy", () => ({
  TourMapLazy: ({ stops }: { stops: unknown[] }) => (
    <div data-testid="route-map-stub">{stops.length}</div>
  ),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({
    children,
    href,
    ...rest
  }: { children?: React.ReactNode; href?: unknown } & Record<string, unknown>) => (
    <a {...rest} href={typeof href === "string" ? href : JSON.stringify(href)}>
      {children}
    </a>
  ),
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

type Route = DayPlan["routes"][number];
type Row = Route["rows"][number];

const EXTRA: Row = {
  customerId: "c5",
  customerNumber: "C5",
  name: "Café Zusatz",
  city: "Wien",
  orderId: "o5",
  orderCount: 1,
  cancelled: false,
  source: "order",
  quantities: { "p-pack": 1, "p-crate": 0 },
  nothing: false,
  weightKg: 3,
  extra: { moved: false, slot: 1 },
  stop: null,
  location: { lat: 48.22, lng: 16.42 },
};

function plan(overrides: Partial<DayPlan> = {}, routeOverrides: Partial<Route> = {}): DayPlan {
  return {
    date: "2099-06-15",
    products: PRODUCTS,
    routes: [
      {
        id: "r1",
        name: "Stammtour 1",
        driverId: "u1",
        driverName: "Anna",
        vehicleId: "v1",
        capacityKg: 1000,
        state: "ready",
        tourId: null,
        stopCount: 0,
        delivered: 0,
        problems: 0,
        geometry: null,
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
            extra: null,
            stop: null,
            location: { lat: 48.2, lng: 16.4 },
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
            extra: null,
            stop: null,
            location: { lat: 48.21, lng: 16.41 },
          },
        ],
        ...routeOverrides,
      },
      {
        id: "r2",
        name: "Stammtour 2",
        driverId: "u2",
        driverName: "Bernd",
        vehicleId: "v2",
        capacityKg: 800,
        state: "empty",
        tourId: null,
        stopCount: 0,
        delivered: 0,
        problems: 0,
        geometry: null,
        rows: [],
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
        extra: null,
        stop: null,
        location: null,
      },
    ],
    editable: true,
    readOnly: null,
    depot: { lat: 48.25, lng: 16.46, name: "Nudelfabrik" },
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
        vehicles={[
          { id: "v1", name: "Van 1", capacityKg: 1000 },
          { id: "v2", name: "Van 2", capacityKg: 800 },
        ]}
        tiles={{ url: "https://tiles.example/{z}/{x}/{y}.png", attribution: "x" }}
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

  it("is read-only for a past day, without a send button", () => {
    renderPlan(plan({ editable: false, readOnly: "past" }));

    expect(screen.getByTestId("planning-read-only")).toBeInTheDocument();
    expect(screen.getByTestId("qty-c1-p-pack")).toBeDisabled();
    expect(screen.queryByTestId("planning-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("planning-send")).not.toBeInTheDocument();
    expect(screen.queryByTestId("off-route-add-c3")).not.toBeInTheDocument();
  });

  it("shows the server error instead of saving silently", async () => {
    vi.mocked(saveStandingDayAction).mockResolvedValue({ ok: false, error: "customer_inactive" });
    renderPlan();

    fireEvent.click(screen.getByTestId("planning-save"));

    await waitFor(() => expect(screen.getByTestId("planning-error")).toBeInTheDocument());
    expect(screen.getByTestId("planning-error").textContent).toContain("inaktiv");
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

describe("StandingPlan day routes (NUD-212)", () => {
  it("shows state, load against the vehicle and the stop numbers of a route", () => {
    renderPlan();
    const header = screen.getByTestId("route-head-r1");
    expect(header).toHaveTextContent("Nicht gesendet");
    expect(header).toHaveTextContent("6 / 1.000 kg");
    expect(header).toHaveTextContent("1 Stopp");
    // Only a row with a quantity is a stop.
    expect(screen.getByTestId("stop-number-c1")).toHaveTextContent("1");
    expect(screen.queryByTestId("stop-number-c2")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-head-r2")).toHaveTextContent("Keine Bestellung");
  });

  it("numbers no customer without a location and marks him (simulation 17.11.)", () => {
    const base = plan();
    const route = base.routes[0]!;
    renderPlan({
      ...base,
      routes: [
        { ...route, rows: [{ ...EXTRA, location: null }, route.rows[0]!, route.rows[1]!] },
        base.routes[1]!,
      ],
    });
    expect(screen.queryByTestId("stop-number-c5")).not.toBeInTheDocument();
    expect(screen.getByTestId("stop-number-c1")).toHaveTextContent("1");
    expect(screen.getByTestId("no-location-c5")).toHaveTextContent("Kein Ort");
    expect(screen.getByTestId("route-head-r1")).toHaveTextContent("1 Stopp");
  });

  it("warns when a route is heavier than its vehicle", () => {
    renderPlan(plan({}, { capacityKg: 5 }));
    expect(screen.getByTestId("route-load-r1")).toHaveAttribute("data-over", "true");
  });

  it("shows an extra inline and moves it to another route and position", async () => {
    vi.mocked(moveExtraAction).mockResolvedValue({ ok: true });
    const base = plan();
    const route = base.routes[0]!;
    renderPlan({
      ...base,
      routes: [{ ...route, rows: [route.rows[0]!, EXTRA, route.rows[1]!] }, base.routes[1]!],
    });

    expect(screen.getByTestId("extra-c5")).toHaveTextContent("Zusatz");
    expect(screen.getByTestId("stop-number-c5")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("move-c5"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Café Zusatz");
    fireEvent.click(screen.getByTestId("move-route-r2"));
    fireEvent.click(screen.getByTestId("move-save"));

    await waitFor(() =>
      expect(moveExtraAction).toHaveBeenCalledWith({
        date: "2099-06-15",
        customerId: "c5",
        standingTourId: "r2",
        slot: 0,
      }),
    );
  });

  it("sends the routes to the drivers, saving typed quantities first", async () => {
    vi.mocked(saveStandingDayAction).mockResolvedValue({
      ok: true,
      written: 1,
      created: 0,
      updated: 1,
      merged: 0,
    });
    vi.mocked(sendDayAction).mockResolvedValue({
      ok: true,
      routes: [{ standingTourId: "r1", tourId: "t1", outcome: "sent", stopCount: 1 }],
      warnings: [],
    });
    renderPlan();

    expect(screen.getByTestId("planning-send")).toHaveTextContent("An Fahrer senden");
    fireEvent.change(screen.getByTestId("qty-c1-p-pack"), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("planning-send"));

    await waitFor(() => expect(sendDayAction).toHaveBeenCalledWith({ date: "2099-06-15" }));
    expect(saveStandingDayAction).toHaveBeenCalled();
    expect(vi.mocked(saveStandingDayAction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendDayAction).mock.invocationCallOrder[0]!,
    );
  });

  it("asks before sending an overloaded route and sends it on confirmation", async () => {
    vi.mocked(sendDayAction)
      .mockResolvedValueOnce({ ok: false, error: "overloaded", standingTourId: "r1", overKg: 200 })
      .mockResolvedValueOnce({ ok: true, routes: [], warnings: [] });
    renderPlan();

    fireEvent.click(screen.getByTestId("planning-send"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Stammtour 1");
    expect(dialog).toHaveTextContent("200 kg");
    fireEvent.click(screen.getByTestId("overload-confirm"));

    await waitFor(() =>
      expect(sendDayAction).toHaveBeenLastCalledWith({
        date: "2099-06-15",
        overrideOverload: true,
      }),
    );
    expect(saveStandingDayAction).not.toHaveBeenCalled();
  });

  it("names the route that has no driver", async () => {
    vi.mocked(sendDayAction).mockResolvedValue({
      ok: false,
      error: "driver_required",
      standingTourId: "r1",
    });
    renderPlan();
    fireEvent.click(screen.getByTestId("planning-send"));
    await waitFor(() =>
      expect(screen.getByTestId("planning-error")).toHaveTextContent("Stammtour 1"),
    );
  });

  it("shows progress, delivered stops and the load sheet once a route is sent", () => {
    const base = plan({}, { state: "running", tourId: "t1", stopCount: 1, delivered: 1 });
    const route = base.routes[0]!;
    renderPlan({
      ...base,
      routes: [
        {
          ...route,
          rows: [{ ...route.rows[0]!, stop: { number: 1, status: "DELIVERED" } }, route.rows[1]!],
        },
        base.routes[1]!,
      ],
    });
    const header = screen.getByTestId("route-head-r1");
    expect(header).toHaveTextContent("Unterwegs");
    expect(header).toHaveTextContent("1 von 1 geliefert");
    expect(screen.getByTestId("stop-state-c1")).toHaveTextContent("geliefert");
    // What the driver delivered is history: no field to change it.
    expect(screen.getByTestId("qty-c1-p-pack")).toBeDisabled();
    expect(screen.getByTestId("qty-c2-p-pack")).toBeEnabled();
    expect(screen.getByTestId("load-sheet-r1")).toBeInTheDocument();
    expect(screen.getByTestId("planning-send")).toHaveTextContent("Änderungen senden");
  });

  it("changes the vehicle of a standing tour", async () => {
    vi.mocked(setStandingTourVehicleAction).mockResolvedValue({ ok: true, id: "r1", active: true });
    renderPlan();
    fireEvent.click(screen.getByTestId("vehicle-r1"));
    const option = await screen.findByRole("option", { name: /Van 2/ });
    fireEvent.pointerDown(option, { button: 0 });
    fireEvent.pointerUp(option, { button: 0 });
    fireEvent.click(option);
    await waitFor(() => expect(setStandingTourVehicleAction).toHaveBeenCalledWith("r1", "v2"));
  });

  it("opens the map of a route with its stops", () => {
    renderPlan();
    fireEvent.click(screen.getByTestId("route-map-r1"));
    expect(screen.getByTestId("route-map-stub")).toHaveTextContent("1");
  });
});
