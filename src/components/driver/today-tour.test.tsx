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

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), undo: vi.fn() }));
const mapProps = vi.hoisted(() => ({ onSelect: null as null | ((id: string) => void) }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => router,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/maps/lazy", () => ({
  TourMapLazy: (props: { onSelect?: (id: string) => void }) => {
    mapProps.onSelect = props.onSelect ?? null;
    return <div data-testid="tour-map" />;
  },
}));
// The outbox overlay is a view over the (IndexedDB-backed) store: empty in the unit test.
vi.mock("@/lib/offline/outbox-browser", () => ({
  useOutbox: () => ({
    userId: null,
    entries: [],
    inFlight: new Set<string>(),
    notices: [],
    flushing: false,
    failure: null,
    confirmed: {},
  }),
  enqueueMutation: mocks.enqueue,
  undoStopStatus: mocks.undo,
}));
vi.mock("@/lib/offline/browser", () => ({ requestOfflineSync: vi.fn() }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};
const TILES = { url: "x", attribution: "" };

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

const stop = (sequence: number, extra: Partial<TodayStop> = {}): TodayStop => ({
  id: `s${sequence}`,
  sequence,
  status: "PENDING",
  problemReason: null,
  completedAt: null,
  etaAt: `2099-07-02T0${5 + sequence}:15:00Z`,
  legDurationS: 600,
  change: null,
  changedInRevision: null,
  customerId: `c${sequence}`,
  customerNumber: `K${sequence}`,
  customerName: `Trattoria ${sequence}`,
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  lat: 48.2,
  lng: Number((16.3 + sequence / 100).toFixed(2)),
  noteText: null,
  items: [
    {
      productId: "a",
      name: "Spaghetti",
      germanName: null,
      unit: "KG",
      quantity: 13,
      previousQuantity: null,
    },
    {
      productId: "b",
      name: "Penne",
      germanName: null,
      unit: "PACK",
      quantity: 4,
      previousQuantity: null,
    },
  ],
  ...extra,
});

const today = (stops: TodayStop[], extra: Partial<DriverToday> = {}): DriverToday => ({
  tourId: "t1",
  date: "2099-07-02",
  tourStatus: "IN_PROGRESS",
  revision: 1,
  updated: false,
  removedCustomers: [],
  stops,
  depot: null,
  geometry: null,
  serviceSecondsPerStop: 600,
  timezone: "Europe/Vienna",
  ...extra,
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("TodayTour in %s", (locale) => {
  it("shows the lowest-sequence pending stop as next, with a per-unit summary and a pinned Navigate link", () => {
    renderIn(
      locale,
      <TodayTour
        today={today([
          stop(1, { status: "DELIVERED" }),
          stop(2, { status: "PROBLEM" }),
          stop(4),
          stop(3),
        ])}
        tiles={TILES}
      />,
    );
    const next = screen.getByTestId("next-stop");
    expect(within(next).getByTestId("next-stop-name")).toHaveTextContent("Trattoria 3");
    expect(within(next).getByTestId("stop-number")).toHaveTextContent("3");
    expect(screen.getByTestId("progress-count")).toHaveTextContent("2 / 4");
    const totals = within(next).getAllByTestId("summary-total");
    expect(totals.map((el) => el.dataset.unit)).toEqual(["KG", "PACK"]);
    expect(totals[0]).toHaveTextContent("13");
    expect(within(next).getByTestId("navigate")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=48.2,16.33&travelmode=driving",
    );
    expect(within(next).getByTestId("details")).toHaveAttribute("href", "/driver/stops/s3");
    expect(screen.getAllByTestId("stop-row")).toHaveLength(4);
    expect(screen.queryByTestId("updated-banner")).toBeNull();
  });

  it("marks the next stop delivered straight from the card (NUD-195)", async () => {
    mocks.enqueue.mockImplementation(async (mutation: unknown) => ({
      clientMutationId: "m1",
      ...(mutation as object),
    }));
    renderIn(
      locale,
      <TodayTour today={today([stop(1), stop(2, { status: "DELIVERED" })])} tiles={TILES} />,
    );
    const next = screen.getByTestId("next-stop");
    const button = within(next).getByTestId("btn-quick-delivered");
    // The button sits in the same row as "Navigation starten", so no detour over the stop screen.
    expect(within(next).getByTestId("navigate")).toBeInTheDocument();
    expect(button).toHaveAccessibleName(/\S/);

    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith({
        type: "delivered",
        stopId: "s1",
        customerName: "Trattoria 1",
      }),
    );
  });

  it("says on the next-stop card when cash is to be collected there", () => {
    renderIn(
      locale,
      <TodayTour
        today={today([stop(1, { cashDueCents: 15750, collectedCents: null }), stop(2)])}
        tiles={TILES}
      />,
    );
    const cash = within(screen.getByTestId("next-stop")).getByTestId("next-stop-cash");
    expect(cash.textContent).toMatch(/157[,.]50/);
    cleanup();
    renderIn(locale, <TodayTour today={today([stop(1), stop(2)])} tiles={TILES} />);
    expect(screen.queryByTestId("next-stop-cash")).toBeNull();
  });

  it("has a page heading and a named progress bar (NUD-095)", () => {
    renderIn(locale, <TodayTour today={today([stop(1)])} tiles={TILES} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/\S/);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAccessibleName(/\S/);
    expect(bar).toHaveAttribute("aria-valuetext");
  });

  it("shows the all-done card when nothing is pending", () => {
    renderIn(locale, <TodayTour today={today([stop(1, { status: "DELIVERED" })])} tiles={TILES} />);
    expect(screen.getByTestId("all-done")).toBeInTheDocument();
    expect(screen.queryByTestId("next-stop")).toBeNull();
  });

  it("summarizes delivered stops and problems on the finished screen", () => {
    renderIn(
      locale,
      <TodayTour
        today={today([
          stop(1, { status: "DELIVERED" }),
          stop(2, { status: "PROBLEM", problemReason: "CLOSED" }),
          stop(3, { status: "DELIVERED" }),
        ])}
        tiles={TILES}
      />,
    );
    const summary = screen.getByTestId("finished-summary");
    expect(summary).toHaveTextContent("2");
    expect(summary).toHaveTextContent("1");
  });

  it("shows the updated banner and highlights until acknowledged", () => {
    const changed = stop(2, {
      change: "CHANGED",
      changedInRevision: 2,
      items: [
        {
          productId: "a",
          name: "Spaghetti",
          germanName: null,
          unit: "KG",
          quantity: 5,
          previousQuantity: 3,
        },
      ],
    });
    renderIn(
      locale,
      <TodayTour
        today={today([stop(1), changed, stop(3, { change: "ADDED", changedInRevision: 2 })], {
          revision: 2,
          updated: true,
          removedCustomers: [{ customerId: "c9", customerNumber: "K9", name: "Gone GmbH" }],
        })}
        tiles={TILES}
      />,
    );
    expect(screen.getByTestId("updated-banner")).toBeInTheDocument();
    expect(screen.getByTestId("removed-stops")).toHaveTextContent("Gone GmbH");
    const highlights = screen.getAllByTestId("stop-change");
    expect(highlights.map((el) => el.dataset.change)).toEqual(["CHANGED", "ADDED"]);
    expect(screen.getByTestId("change-item")).toHaveTextContent(/3.*→.*5/);

    fireEvent.click(screen.getByTestId("updated-ack"));
    expect(screen.queryByTestId("updated-banner")).toBeNull();
    expect(screen.queryAllByTestId("stop-change")).toHaveLength(0);
    expect(window.localStorage.getItem("nudel.driver.seenRevision.t1")).toBe("2");
  });

  it("does not show the banner for a revision the device has already seen", () => {
    window.localStorage.setItem("nudel.driver.seenRevision.t1", "2");
    renderIn(
      locale,
      <TodayTour
        today={today([stop(1, { change: "CHANGED", changedInRevision: 2 })], {
          revision: 2,
          updated: true,
        })}
        tiles={TILES}
      />,
    );
    expect(screen.queryByTestId("updated-banner")).toBeNull();
    expect(screen.queryByTestId("stop-change")).toBeNull();
  });

  it("labels a second tour of the day and shows no label for a single tour (NUD-118)", () => {
    const { unmount } = renderIn(locale, <TodayTour today={today([stop(1)])} tiles={TILES} />);
    expect(screen.queryByTestId("tour-badge")).toBeNull();
    unmount();
    renderIn(
      locale,
      <TodayTour today={today([stop(1)], { tourNumber: 2, tourCount: 2 })} tiles={TILES} />,
    );
    const badge = screen.getByTestId("tour-badge");
    expect(badge).toHaveAttribute("data-tour-number", "2");
    expect(badge.textContent).toMatch(/2/);
    expect(screen.queryByTestId("all-done")).toBeNull();
  });

  it("lists the other open tour of the day with its pending stops (NUD-163)", () => {
    const other = today([stop(1), stop(2, { status: "DELIVERED" })], {
      tourId: "t0",
      tourNumber: 1,
      tourCount: 2,
    });
    renderIn(
      locale,
      <TodayTour
        today={today([stop(3, { status: "PENDING" })], {
          tourId: "t1",
          tourNumber: 2,
          tourCount: 2,
        })}
        others={[other]}
        tiles={TILES}
      />,
    );
    const section = screen.getByTestId("other-tour");
    expect(section).toHaveAttribute("data-tour-id", "t0");
    expect(within(section).getByTestId("other-tour-title").textContent).toMatch(/1/);
    // The pending stop of tour 1 is reachable, the delivered one hides in its done group.
    const rows = within(section).getAllByTestId("stop-row");
    expect(rows).toHaveLength(2);
    expect(within(section).getByTestId("other-tour-stops").textContent).not.toBe("");
    expect(within(rows[0] as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/driver/stops/s1",
    );
    expect(section.textContent).toContain("Trattoria 1");
    // The active tour keeps the hero card and its own list.
    expect(screen.getByTestId("next-stop")).toBeInTheDocument();
    expect(screen.getByTestId("stop-list")).toBeInTheDocument();
  });

  it("shows nothing extra without a second open tour", () => {
    renderIn(locale, <TodayTour today={today([stop(1)])} tiles={TILES} />);
    expect(screen.queryByTestId("other-tour")).toBeNull();
    expect(screen.queryByTestId("other-tours")).toBeNull();
  });

  it("toggles between list and map", () => {
    renderIn(locale, <TodayTour today={today([stop(1)])} tiles={TILES} />);
    expect(screen.getByTestId("stop-list")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("view-map"));
    expect(screen.getByTestId("tour-map")).toBeInTheDocument();
    expect(screen.queryByTestId("stop-list")).toBeNull();
    // Radix renders the segment as a radio; the selected state is `aria-checked`.
    expect(screen.getByTestId("view-map")).toHaveAttribute("aria-checked", "true");
  });

  it("opens the stop screen when a map marker is selected (NUD-119)", () => {
    router.push.mockClear();
    renderIn(locale, <TodayTour today={today([stop(1), stop(2)])} tiles={TILES} />);
    fireEvent.click(screen.getByTestId("view-map"));
    mapProps.onSelect?.("s2");
    expect(router.push).toHaveBeenCalledWith("/driver/stops/s2");
  });

  it("offers no Navigate link without a confirmed pin", () => {
    renderIn(
      locale,
      <TodayTour today={today([stop(1, { lat: null, lng: null })])} tiles={TILES} />,
    );
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.getByTestId("no-pin")).toBeInTheDocument();
  });
});

describe.each(Object.keys(LOCALES))("next-stop card links (%s)", (locale) => {
  it("the whole card opens the detail through one icon-only link; navigation stays a separate element", () => {
    renderIn(locale, <TodayTour today={today([stop(1)])} tiles={TILES} />);
    const next = screen.getByTestId("next-stop");
    const details = within(next).getByTestId("details");
    const navigate = within(next).getByTestId("navigate");
    // Icon-only: no visible text, but an accessible name; stretched over the card (::after, inset-0).
    expect(details.textContent?.trim()).toBe("");
    expect(details.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    expect(details.className).toContain("after:absolute");
    expect(details.className).toContain("after:inset-0");
    expect(details.className).toContain("active:scale-none");
    expect(next.className).toContain("relative");
    // "Navigation starten" is a sibling, never inside the detail link, and sits above the overlay.
    expect(details.contains(navigate)).toBe(false);
    expect(navigate.closest("a[href^='/driver/stops']")).toBeNull();
    expect(navigate.className).toContain("z-10");
    expect(navigate.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps/);
    // No interactive element is nested inside another one.
    for (const el of next.querySelectorAll("a, button")) {
      expect(el.parentElement?.closest("a, button")).toBeNull();
    }
  });
});

describe("TodayTour, look and motion (redesign RD2)", () => {
  const view = (stops: TodayStop[], extra: Partial<DriverToday> = {}) => (
    <NextIntlClientProvider locale="de" messages={de}>
      <TodayTour today={today(stops, extra)} tiles={TILES} />
    </NextIntlClientProvider>
  );

  it("has exactly one yolk button: Navigation starten on the next-stop card", () => {
    render(
      view([stop(1), stop(2)], {
        tourStatus: "RELEASED",
        departedAt: null,
        loadingStartedAt: null,
      }),
    );
    // The voluntary departure checklist is on the screen and is not yolk.
    expect(screen.getByTestId("departure-open")).not.toHaveClass("bg-primary");
    expect(screen.getByTestId("departure-skip")).not.toHaveClass("bg-primary");
    const yolk = [...document.querySelectorAll("a, button")].filter((el) =>
      el.classList.contains("bg-primary"),
    );
    expect(yolk.map((el) => el.getAttribute("data-testid"))).toEqual(["navigate"]);
  });

  it("keeps yolk to the navigation button and the stop number: the card and the row are not yellow", () => {
    render(view([stop(1), stop(2)]));
    const card = screen.getByTestId("next-stop");
    expect(card).toHaveClass("bg-card", "border-border");
    expect(card).not.toHaveClass("bg-primary-soft");
    expect(card.className).not.toMatch(/border-s-/);
    for (const row of screen.getAllByTestId("stop-row")) {
      expect(row).not.toHaveClass("bg-primary-soft");
    }
    // The next stop is still marked, by the ring around its number.
    expect(within(card).getByTestId("stop-number")).toHaveAttribute("data-next", "true");
  });

  it("lets the stop rows arrive 30 ms apart, capped so a long tour does not keep the driver waiting", () => {
    render(view(Array.from({ length: 20 }, (_, i) => stop(i + 1))));
    const rows = screen.getAllByTestId("stop-row");
    expect(rows[0]).toHaveClass("stagger-item");
    expect(rows[2]!.style.getPropertyValue("--i")).toBe("2");
    expect(rows[19]!.style.getPropertyValue("--i")).toBe("11");
  });

  it("shows a reported problem in red: badge, reason line and progress", () => {
    render(view([stop(1), stop(2, { status: "PROBLEM", problemReason: "CLOSED" })]));
    const row = within(screen.getByTestId("problem-group")).getByTestId("stop-row");
    expect(within(row).getByTestId("stop-status").firstElementChild).toHaveAttribute(
      "data-tone",
      "destructive",
    );
    expect(
      screen.getByRole("progressbar").querySelector('[data-tone="destructive"]'),
    ).not.toBeNull();
  });

  it("keeps the next-stop card still on arrival and lets the following stop rise in", () => {
    const { rerender } = render(view([stop(1), stop(2)]));
    expect(screen.getByTestId("next-stop")).not.toHaveClass("stagger-item");
    const ring = () => screen.getByTestId("progress").querySelector('[data-slot="pulse-ring"]');
    expect(ring()).toBeNull();
    // Stop 1 was ticked off on this screen: the card of stop 2 takes over and the count pulses.
    rerender(view([stop(1, { status: "DELIVERED" }), stop(2)]));
    const card = screen.getByTestId("next-stop");
    expect(card).toHaveAttribute("data-stop-id", "s2");
    expect(card).toHaveClass("stagger-item");
    expect(ring()).not.toBeNull();
  });
});
