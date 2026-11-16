import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DriverToday, TodayStop } from "@/server/driver-today";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { TodayTour } from "./today-tour";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  entries: [] as unknown[],
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/maps/lazy", () => ({ TourMapLazy: () => <div data-testid="tour-map" /> }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/offline/outbox-browser", () => ({
  enqueueMutation: mocks.enqueue,
  useOutbox: () => ({
    userId: "u1",
    entries: mocks.entries,
    inFlight: new Set<string>(),
    notices: [],
    flushing: false,
    failure: null,
    confirmed: {},
  }),
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  en,
  "sr-Latn": srLatn,
  cs,
  "zh-Hans": zhHans,
};

function renderIn(locale: string, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const item = (productId: string, unit: string, quantity: number, name: string) => ({
  productId,
  name,
  germanName: null,
  unit,
  quantity,
  previousQuantity: null,
});

const stop = (sequence: number, extra: Partial<TodayStop> = {}): TodayStop => ({
  id: `s${sequence}`,
  sequence,
  trip: 1,
  status: "PENDING",
  problemReason: null,
  completedAt: null,
  etaAt: `2099-07-02T0${5 + sequence}:15:00Z`,
  legDurationS: 600,
  change: null,
  changedInRevision: null,
  customerId: `c${sequence}`,
  customerNumber: `K${sequence}`,
  customerName: `KundeTest${sequence}`,
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  lat: 48.2,
  lng: Number((16.3 + sequence / 100).toFixed(2)),
  noteText: null,
  hasKey: sequence === 2 ? true : false,
  keyNumber: sequence === 2 ? "12" : null,
  items: [
    item("karton", "CRATE", 7, "Nudeln"),
    item("beutel", "PACK", 11, "Nudeln"),
    item("teig", "PIECE", sequence, "Wantan-Teig"),
  ],
  ...extra,
});

const today = (stops: TodayStop[], extra: Partial<DriverToday> = {}): DriverToday => ({
  tourId: "t1",
  date: "2099-07-02",
  tourStatus: "RELEASED",
  revision: 1,
  updated: false,
  removedCustomers: [],
  stops,
  depot: null,
  geometry: null,
  serviceSecondsPerStop: 600,
  timezone: "Europe/Vienna",
  loadingStartedAt: null,
  departedAt: null,
  checklist: [{ id: "c1", text: "Lieferscheine" }],
  ...extra,
});

const TILES = { url: "x", attribution: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entries = [];
  mocks.enqueue.mockResolvedValue({ clientMutationId: "m1" });
  window.localStorage.clear();
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("departure checklist in %s", (locale) => {
  const stops = () => [stop(1), stop(2)];

  it("offers the card before the first stop", () => {
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    expect(screen.getByTestId("departure-card")).toBeInTheDocument();
    expect(screen.getByTestId("departure-open")).toBeInTheDocument();
    expect(screen.getByTestId("departure-skip")).toBeInTheDocument();
  });

  it("opening it records the loading start and lists keys and fixed items, no totals", async () => {
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("departure-open"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "loading",
      stopId: "s1",
      customerName: "KundeTest1",
    });
    const sheet = within(screen.getByTestId("departure-sheet"));
    // No product totals (owner 2026-11-16): the driver sees quantities at the stop only.
    expect(sheet.queryByTestId("departure-product")).toBeNull();
    // One line per needed key: only the customer whose key exists.
    const keys = sheet.getAllByTestId("departure-key");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toHaveTextContent("12");
    expect(keys[0]).toHaveTextContent("KundeTest2");
    expect(sheet.getAllByTestId("departure-fixed-item")).toHaveLength(1);
    expect(sheet.getByTestId("departure-fixed-item")).toHaveTextContent("Lieferscheine");
  });

  it("ticks are one tap each, counted, and remembered on the device", () => {
    const view = renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("departure-open"));
    const sheet = within(screen.getByTestId("departure-sheet"));
    expect(sheet.getByTestId("departure-progress")).toHaveAttribute("data-total", "2");
    const first = sheet.getAllByTestId("departure-key")[0]!;
    expect(first).toHaveAttribute("aria-checked", "false");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-checked", "true");
    expect(sheet.getByTestId("departure-progress")).toHaveAttribute("data-done", "1");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-checked", "false");
    fireEvent.click(first);
    view.unmount();
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("departure-open"));
    expect(
      within(screen.getByTestId("departure-sheet")).getAllByTestId("departure-key")[0],
    ).toHaveAttribute("aria-checked", "true");
  });

  it("'Losfahren' records the departure and removes the card", async () => {
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("departure-open"));
    fireEvent.click(screen.getByTestId("departure-go"));
    await waitFor(() => expect(screen.queryByTestId("departure-sheet")).not.toBeInTheDocument());
    expect(mocks.enqueue).toHaveBeenLastCalledWith({
      type: "depart",
      stopId: "s1",
      customerName: "KundeTest1",
    });
    expect(screen.queryByTestId("departure-card")).not.toBeInTheDocument();
  });

  it("skipping records the departure only", async () => {
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("departure-skip"));
    await waitFor(() => expect(screen.queryByTestId("departure-card")).not.toBeInTheDocument());
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "depart",
      stopId: "s1",
      customerName: "KundeTest1",
    });
  });

  it("says so when nothing could be stored and keeps the card", async () => {
    mocks.enqueue.mockRejectedValue(new Error("no storage"));
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("departure-skip"));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(screen.getByTestId("departure-card")).toBeInTheDocument();
  });

  it("works from a queued (offline) departure: the card is gone at once", () => {
    mocks.entries = [
      {
        clientMutationId: "m9",
        userId: "u1",
        type: "depart",
        stopId: "s1",
        createdAt: "2099-07-02T05:55:00.000Z",
        seq: 1,
        customerName: "KundeTest1",
      },
    ];
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} offline />);
    expect(screen.queryByTestId("departure-card")).not.toBeInTheDocument();
    // A queued departure tap is no stop completion: the stop row does not show "waiting"; a queued
    // delivery of the same stop does (positive control).
    const waiting = (LOCALES[locale] as { driver: { today: { waiting: string } } }).driver.today
      .waiting;
    expect(screen.queryByText(waiting)).not.toBeInTheDocument();
    cleanup();
    mocks.entries = [{ ...(mocks.entries[0] as object), type: "problem", reason: "CLOSED" }];
    renderIn(locale, <TodayTour today={today(stops())} tiles={TILES} offline />);
    expect(screen.getAllByText(waiting).length).toBeGreaterThan(0);
  });

  it("is not offered after departure, after the first stop, or on screens without the data", () => {
    const left = renderIn(
      locale,
      <TodayTour
        today={today(stops(), { departedAt: "2099-07-02T05:55:00.000Z" })}
        tiles={TILES}
      />,
    );
    expect(screen.queryByTestId("departure-card")).not.toBeInTheDocument();
    left.unmount();
    const started = renderIn(
      locale,
      <TodayTour
        today={today([
          stop(1, { status: "DELIVERED", completedAt: "2099-07-02T06:00:00Z" }),
          stop(2),
        ])}
        tiles={TILES}
      />,
    );
    expect(screen.queryByTestId("departure-card")).not.toBeInTheDocument();
    started.unmount();
    renderIn(locale, <TodayTour today={today(stops(), { departedAt: undefined })} tiles={TILES} />);
    expect(screen.queryByTestId("departure-card")).not.toBeInTheDocument();
  });

  it("a reload trip has its own checklist with 'Fertig' and no departure", async () => {
    const trips = [stop(1), stop(2), stop(3, { trip: 2, hasKey: true, keyNumber: "31" })];
    renderIn(locale, <TodayTour today={today(trips)} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("reload-checklist"));
    // Only the stops of trip 2: its key line, no product lines, no 'Losfahren'.
    const sheet = within(screen.getByTestId("departure-sheet"));
    expect(sheet.queryByTestId("departure-product")).toBeNull();
    expect(sheet.getByTestId("departure-key")).toHaveTextContent("31");
    expect(sheet.queryByTestId("departure-go")).not.toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    fireEvent.click(sheet.getByTestId("departure-finish"));
    await waitFor(() => expect(screen.queryByTestId("departure-sheet")).not.toBeInTheDocument());
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
