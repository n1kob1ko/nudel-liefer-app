import { cleanup, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type OverviewTour, summarizeDay } from "@/domain/day-overview";
import type { DayOverviewView } from "@/server/day-overview";

import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import zhHans from "../../../messages/zh-Hans.json";
import { DayBoard } from "./day-board";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LOCALES: Record<string, AbstractIntlMessages> = { de, en, "zh-Hans": zhHans };

const at = (time: string) => new Date(`2099-07-02T${time}:00Z`);
const hour = (sequence: number) => String(6 + sequence).padStart(2, "0");

const stop = (
  sequence: number,
  status: "PENDING" | "DELIVERED" | "PROBLEM",
  extra: Partial<OverviewTour["stops"][number]> = {},
): OverviewTour["stops"][number] => ({
  id: `s${sequence}`,
  sequence,
  status,
  name: `Kunde ${sequence}`,
  etaAt: at(`${hour(sequence)}:00`),
  completedAt: status === "PENDING" ? null : at(`${hour(sequence)}:05`),
  problemReason: status === "PROBLEM" ? "CLOSED" : null,
  lat: 48.2,
  lng: 16.3,
  ...extra,
});

const tour = (id: string, extra: Partial<OverviewTour> = {}): OverviewTour => ({
  id,
  status: "IN_PROGRESS",
  createdAt: at("05:00"),
  driverName: `Fahrer ${id.toUpperCase()}`,
  vehicleName: "Transporter 1",
  departedAt: at("06:30"),
  stops: [stop(1, "DELIVERED"), stop(2, "PENDING"), stop(3, "PENDING")],
  ...extra,
});

const view = (tours: OverviewTour[]): DayOverviewView => ({
  date: "2099-07-02",
  timezone: "UTC",
  ...summarizeDay(tours, 600),
});

const threeDrivers = () =>
  view([
    tour("a"),
    tour("b", {
      createdAt: at("05:10"),
      vehicleName: "Transporter 2",
      stops: [
        stop(1, "DELIVERED"),
        stop(2, "PROBLEM", { name: "Cucina Bella", completedAt: at("08:27") }),
        stop(3, "PENDING"),
        stop(4, "PENDING"),
      ],
    }),
    tour("c", {
      createdAt: at("05:20"),
      status: "RELEASED",
      departedAt: null,
      vehicleName: null,
      stops: [stop(1, "PENDING"), stop(2, "PENDING")],
    }),
  ]);

function show(
  overview: DayOverviewView,
  props: Partial<React.ComponentProps<typeof DayBoard>> = {},
  locale = "de",
) {
  const ui = (o: DayOverviewView) => (
    <NextIntlClientProvider locale={locale} messages={LOCALES[locale]} timeZone="UTC">
      <DayBoard
        overview={o}
        nextDay={{ date: "2099-07-03", confirmed: 46, drafts: 2 }}
        lateOrderCount={0}
        pollIntervalMs={30_000}
        {...props}
      />
    </NextIntlClientProvider>
  );
  const result = render(ui(overview));
  return { ...result, update: (next: DayOverviewView) => result.rerender(ui(next)) };
}

afterEach(cleanup);

describe("DayBoard", () => {
  it("gives every driver a lane: name, vehicle, state, progress and the expected end", () => {
    show(threeDrivers());
    const lanes = screen.getAllByTestId("driver-lane");
    expect(lanes.map((lane) => lane.dataset.phase)).toEqual(["onRoad", "onRoad", "waiting"]);

    const first = within(lanes[0]!);
    expect(first.getByRole("link", { name: /Fahrer A/ })).toHaveAttribute(
      "href",
      "/admin/tours?date=2099-07-02&tour=a",
    );
    expect(first.getByText("Tour 1 · Transporter 1")).toBeInTheDocument();
    expect(first.getByTestId("lane-status")).toHaveTextContent("Unterwegs");
    expect(first.getByTestId("lane-progress")).toHaveTextContent("1 von 3");
    // Last open stop arrives 09:00, ten minutes there.
    expect(first.getByTestId("lane-finish")).toHaveTextContent("Ende ca. 09:10");
    expect(first.getByTestId("lane-next-name")).toHaveTextContent("Kunde 2");
    expect(first.getByTestId("lane-last")).toHaveTextContent("Zuletzt: Kunde 1, 07:05");

    expect(within(lanes[2]!).getByTestId("lane-status")).toHaveTextContent(
      "Noch nicht losgefahren",
    );
    expect(within(lanes[2]!).getByTestId("lane-last")).toHaveTextContent(
      "Noch kein Stopp abgehakt",
    );
  });

  it("draws a bead per stop and marks the next one", () => {
    show(threeDrivers());
    const beads = within(screen.getAllByTestId("driver-lane")[1]!).getAllByTestId("lane-bead");
    expect(beads.map((bead) => bead.dataset.status)).toEqual([
      "DELIVERED",
      "PROBLEM",
      "PENDING",
      "PENDING",
    ]);
    expect(beads.map((bead) => bead.dataset.next)).toEqual([undefined, undefined, "", undefined]);
    expect(beads[0]).toHaveClass("bg-success");
    expect(beads[1]).toHaveClass("bg-destructive");
    expect(beads[2]).toHaveClass("bg-primary");
    // The colours are never the only carrier: the chain has the counts as its name.
    expect(screen.getAllByRole("img")[1]).toHaveAccessibleName("1 geliefert · 1 Problem · 2 offen");
  });

  it("says whether a driver is on time or how many minutes behind", () => {
    show(threeDrivers());
    const [onTime, late, waiting] = screen.getAllByTestId("driver-lane");
    expect(within(onTime!).getByTestId("lane-delay")).toHaveTextContent("pünktlich");
    // Planned 08:00 plus ten minutes, ticked off at 08:27.
    const delay = within(late!).getByTestId("lane-delay");
    expect(delay).toHaveTextContent("17 Min. später");
    expect(delay).toHaveClass("text-warning");
    expect(within(waiting!).queryByTestId("lane-delay")).toBeNull();
  });

  it("puts every reported problem in a red row above the lanes, with a way to the tour", () => {
    show(threeDrivers());
    const problem = screen.getByTestId("day-problem");
    expect(problem).toHaveTextContent("Geschlossen");
    expect(problem).toHaveTextContent("bei Cucina Bella · Fahrer B · gemeldet 08:27");
    expect(problem).toHaveClass("bg-destructive-soft");
    expect(within(problem).getByRole("link", { name: "Ansehen" })).toHaveAttribute(
      "href",
      "/admin/tours?date=2099-07-02&tour=b",
    );
    expect(
      problem.compareDocumentPosition(screen.getAllByTestId("driver-lane")[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(screen.getAllByTestId("driver-lane")[1]!).getByTestId("lane-problems"),
    ).toHaveTextContent("1 Problem");
    expect(
      within(screen.getAllByTestId("driver-lane")[0]!).queryByTestId("lane-problems"),
    ).toBeNull();
  });

  it("has no problem row on a day without problems", () => {
    show(view([tour("a")]));
    expect(screen.queryByTestId("day-problem")).toBeNull();
    expect(screen.getByTestId("kpi-problems")).toHaveTextContent("alles in Ordnung");
    expect(screen.getByTestId("kpi-problems")).not.toHaveClass("bg-destructive-soft");
  });

  it("sums the day in one strip", () => {
    show(threeDrivers());
    expect(screen.getByTestId("kpi-stops")).toHaveTextContent("3 von 9");
    expect(screen.getByTestId("kpi-drivers")).toHaveTextContent("2 von 3");
    expect(screen.getByTestId("kpi-problems")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-problems")).toHaveClass("bg-destructive-soft");
    // Tour b ends last: stop 4 at 10:00 plus ten minutes.
    expect(screen.getByTestId("kpi-back")).toHaveTextContent("ca. 10:10");
    expect(
      within(screen.getByTestId("kpi-next-day")).getByRole("link", { name: "46 Bestellungen" }),
    ).toHaveAttribute("href", "/admin/orders?from=2099-07-03&to=2099-07-03");
    expect(screen.getByTestId("kpi-next-day")).toHaveTextContent("2 Entwürfe offen");
  });

  it("shows a tour that is still being planned without counting it as today's work", () => {
    show(view([tour("a", { status: "DRAFT", departedAt: null, stops: [stop(1, "PENDING")] })]));
    const lane = screen.getByTestId("driver-lane");
    expect(within(lane).getByTestId("lane-status")).toHaveTextContent("In Planung");
    expect(within(lane).getByTestId("lane-finish")).toHaveTextContent("noch nicht freigegeben");
    expect(within(lane).queryByTestId("lane-next-name")).toBeNull();
    expect(within(lane).getByTestId("lane-bead")).not.toHaveClass("bg-primary");
    expect(screen.getByTestId("kpi-stops")).toHaveTextContent("noch nichts freigegeben");
  });

  it("offers the planning on a day without a tour and keeps looking for one", () => {
    show(view([]));
    expect(screen.getByTestId("today-no-tour")).toHaveTextContent("Für heute gibt es keine Tour.");
    expect(screen.getByRole("link", { name: "Tour planen" })).toHaveAttribute(
      "href",
      "/admin/tours?date=2099-07-02",
    );
    expect(screen.getByTestId("live-refresh")).toBeInTheDocument();
  });

  it("warns about orders that came after the tours were finished", () => {
    show(view([tour("a", { status: "COMPLETED", stops: [stop(1, "DELIVERED")] })]), {
      lateOrderCount: 2,
    });
    expect(screen.getByTestId("today-late-orders")).toHaveTextContent("2 Bestellungen für heute");
    expect(screen.getByTestId("lane-all-done")).toHaveTextContent("Alle Stopps sind erledigt.");
    expect(screen.getByTestId("lane-status")).toHaveTextContent("Abgeschlossen");
  });

  it("confirms a delivery that arrives while the page is open with one ring, not on load", () => {
    const { update } = show(view([tour("a")]));
    const lane = () => screen.getByTestId("driver-lane");
    expect(lane().querySelector('[data-slot="pulse-ring"]')).toBeNull();
    update(
      view([
        tour("a", { stops: [stop(1, "DELIVERED"), stop(2, "DELIVERED"), stop(3, "PENDING")] }),
      ]),
    );
    expect(within(lane()).getByTestId("lane-progress")).toHaveTextContent("2 von 3");
    expect(lane().querySelector('[data-slot="pulse-ring"]')).not.toBeNull();
  });

  it("puts the map beside the lanes when there is one", () => {
    show(threeDrivers(), { aside: <div data-testid="fleet-map" /> });
    expect(screen.getByTestId("fleet-map")).toBeInTheDocument();
  });

  it.each(["en", "zh-Hans"])("has every text in %s", (locale) => {
    show(threeDrivers(), {}, locale);
    expect(screen.getAllByTestId("driver-lane")).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/admin\.dashboard\./);
  });
});
