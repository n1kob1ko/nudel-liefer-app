import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TourMapProps } from "@/components/maps/tour-map";

import de from "../../../messages/de.json";
import { FleetMap, type FleetRow } from "./fleet-map";

// Leaflet needs a layout engine: the map itself is replaced by a list of what it was given.
vi.mock("@/components/maps/lazy", () => ({
  TourMapLazy: ({ stops, depot }: TourMapProps) => (
    <ul data-testid="map" data-depot={depot?.label ?? ""}>
      {stops.map((s) => (
        <li key={s.id} data-testid="marker" data-status={s.status} data-lat={s.lat}>
          {s.sequence} {s.label}
        </li>
      ))}
    </ul>
  ),
}));

const at = (time: string) => new Date(`2099-07-02T${time}:00Z`);

const row = (number: number, extra: Partial<FleetRow> = {}): FleetRow => ({
  tourId: `t${number}`,
  number,
  driverName: `Fahrer ${number}`,
  phase: "onRoad",
  lastStop: {
    id: `s${number}`,
    name: `Kunde ${number}`,
    at: at(`0${6 + number}:05`),
    status: "DELIVERED",
    lat: 48.2 + number / 100,
    lng: 16.3,
  },
  ...extra,
});

function show(rows: FleetRow[]) {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <FleetMap
        rows={rows}
        timezone="UTC"
        depot={{ lat: 48.2, lng: 16.37, label: "Depot" }}
        tiles={{ url: "https://tiles.example/{z}/{x}/{y}.png", attribution: "x" }}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("FleetMap", () => {
  it("puts every driver at the stop he ticked off last, numbered like his tour", () => {
    show([row(1), row(2, { lastStop: { ...row(2).lastStop!, status: "PROBLEM" } })]);
    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveTextContent("1 Fahrer 1 · Kunde 1");
    expect(markers[1]).toHaveAttribute("data-status", "PROBLEM");
    expect(screen.getByTestId("map")).toHaveAttribute("data-depot", "Depot");
  });

  it("says the same in words below the map", () => {
    show([row(1), row(2)]);
    const places = screen.getAllByTestId("fleet-place");
    expect(places).toHaveLength(2);
    expect(within(places[1]!).getByText("Fahrer 2")).toBeInTheDocument();
    expect(places[1]).toHaveTextContent("Kunde 2, 08:05");
  });

  it("leaves out drivers without a ticked stop, finished tours and stops without a pin", () => {
    show([
      row(1),
      row(2, { lastStop: null, phase: "waiting" }),
      row(3, { phase: "done" }),
      row(4, { lastStop: { ...row(4).lastStop!, lat: null, lng: null } }),
    ]);
    expect(screen.getAllByTestId("marker")).toHaveLength(1);
    // Still listed in words: the stop is known, only its pin is not.
    expect(screen.getAllByTestId("fleet-place")).toHaveLength(2);
  });

  it("explains itself while nobody has ticked a stop yet", () => {
    show([row(1, { lastStop: null, phase: "waiting" })]);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByTestId("fleet-empty")).toHaveTextContent(
      "Sobald ein Fahrer einen Stopp abhakt, erscheint er hier.",
    );
  });
});
