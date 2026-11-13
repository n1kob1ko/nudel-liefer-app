import { describe, expect, it } from "vitest";

import { isLate, type OverviewTour, summarizeDay, tourPhase } from "./day-overview";

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
  lng: 16.3 + sequence / 100,
  ...extra,
});

const tour = (id: string, extra: Partial<OverviewTour> = {}): OverviewTour => ({
  id,
  status: "IN_PROGRESS",
  createdAt: at("05:00"),
  driverName: `Fahrer ${id}`,
  vehicleName: null,
  departedAt: at("06:30"),
  stops: [stop(1, "DELIVERED"), stop(2, "PENDING"), stop(3, "PENDING")],
  ...extra,
});

describe("tourPhase", () => {
  it("separates planning, waiting at the depot, on the road and finished", () => {
    expect(tourPhase({ status: "DRAFT", departedAt: null, done: 0 })).toBe("planning");
    expect(tourPhase({ status: "OPTIMIZED", departedAt: null, done: 0 })).toBe("planning");
    expect(tourPhase({ status: "RELEASED", departedAt: null, done: 0 })).toBe("waiting");
    // "Losfahren" was tapped, or a stop was ticked off without the checklist: the driver is out.
    expect(tourPhase({ status: "RELEASED", departedAt: at("06:30"), done: 0 })).toBe("onRoad");
    expect(tourPhase({ status: "IN_PROGRESS", departedAt: null, done: 1 })).toBe("onRoad");
    expect(tourPhase({ status: "COMPLETED", departedAt: at("06:30"), done: 3 })).toBe("done");
  });
});

describe("summarizeDay", () => {
  it("is empty for a day without tours", () => {
    const day = summarizeDay([], 600);
    expect(day.rows).toEqual([]);
    expect(day.problems).toEqual([]);
    expect(day.totals).toEqual({
      tours: 0,
      onRoad: 0,
      total: 0,
      delivered: 0,
      problems: 0,
      done: 0,
      pending: 0,
      percent: 0,
      lastFinishAt: null,
    });
  });

  it("gives every tour one row: progress, next stop, last ticked stop and the expected end", () => {
    const [row] = summarizeDay([tour("a")], 600).rows;
    expect(row).toMatchObject({
      tourId: "a",
      number: 1,
      driverName: "Fahrer a",
      phase: "onRoad",
      progress: { total: 3, done: 1, delivered: 1, problems: 0, pending: 2, percent: 33 },
      nextStop: { id: "s2", name: "Kunde 2", etaAt: at("08:00") },
      // No live GPS: the driver was last seen where he ticked a stop off.
      lastStop: { id: "s1", name: "Kunde 1", at: at("07:05"), status: "DELIVERED", lat: 48.2 },
    });
    // Arrival at the last open stop plus the service time there (10 min).
    expect(row!.finishAt).toEqual(at("09:10"));
  });

  it("takes the stop that was ticked off last, not the one with the highest number", () => {
    const [row] = summarizeDay(
      [
        tour("a", {
          stops: [
            stop(1, "DELIVERED", { completedAt: at("09:40") }),
            stop(2, "PROBLEM", { completedAt: at("08:10") }),
            stop(3, "PENDING"),
          ],
        }),
      ],
      600,
    ).rows;
    expect(row!.lastStop).toMatchObject({ id: "s1", status: "DELIVERED" });
  });

  it("knows no position before the first stop and no end without an arrival time", () => {
    const [row] = summarizeDay(
      [
        tour("a", {
          status: "RELEASED",
          departedAt: null,
          stops: [stop(1, "PENDING", { etaAt: null }), stop(2, "PENDING", { etaAt: null })],
        }),
      ],
      600,
    ).rows;
    expect(row).toMatchObject({ phase: "waiting", lastStop: null, finishAt: null });
    expect(row!.nextStop).toMatchObject({ id: "s1", etaAt: null });
  });

  it("numbers the tours in creation order and shows the ones on the road first", () => {
    const day = summarizeDay(
      [
        tour("late", { createdAt: at("05:30"), status: "DRAFT", departedAt: null }),
        tour("done", {
          createdAt: at("05:00"),
          status: "COMPLETED",
          stops: [stop(1, "DELIVERED"), stop(2, "DELIVERED")],
        }),
        tour("out", { createdAt: at("05:10") }),
        tour("depot", {
          createdAt: at("05:20"),
          status: "RELEASED",
          departedAt: null,
          stops: [stop(1, "PENDING")],
        }),
      ],
      600,
    );
    expect(day.rows.map((row) => [row.tourId, row.number, row.phase])).toEqual([
      ["out", 2, "onRoad"],
      ["depot", 3, "waiting"],
      ["late", 4, "planning"],
      ["done", 1, "done"],
    ]);
  });

  it("adds the stops of all tours and counts the drivers on the road", () => {
    const day = summarizeDay(
      [
        tour("a"),
        tour("b", {
          createdAt: at("05:10"),
          stops: [stop(1, "DELIVERED"), stop(2, "PROBLEM"), stop(3, "PENDING"), stop(4, "PENDING")],
        }),
        tour("c", { createdAt: at("05:20"), status: "DRAFT", departedAt: null }),
      ],
      600,
    );
    // The draft is not handed to a driver yet: it is a row, but its stops are not "today's work".
    expect(day.totals).toEqual({
      tours: 3,
      onRoad: 2,
      total: 7,
      delivered: 2,
      problems: 1,
      done: 3,
      pending: 4,
      percent: 43,
      // Tour "b" ends last: arrival at its stop 4 at 10:00 plus 10 minutes there.
      lastFinishAt: at("10:10"),
    });
  });

  it("lists the problems of all drivers, newest first, with the driver's name", () => {
    const day = summarizeDay(
      [
        tour("a", {
          stops: [stop(1, "PROBLEM", { completedAt: at("07:10") }), stop(2, "PENDING")],
        }),
        tour("b", {
          createdAt: at("05:10"),
          stops: [
            stop(1, "DELIVERED"),
            stop(2, "PROBLEM", { completedAt: at("08:20"), problemReason: "NOBODY_THERE" }),
          ],
        }),
      ],
      600,
    );
    expect(day.problems).toEqual([
      {
        tourId: "b",
        driverName: "Fahrer b",
        stopId: "s2",
        name: "Kunde 2",
        reason: "NOBODY_THERE",
        at: at("08:20"),
      },
      {
        tourId: "a",
        driverName: "Fahrer a",
        stopId: "s1",
        name: "Kunde 1",
        reason: "CLOSED",
        at: at("07:10"),
      },
    ]);
  });

  it("draws one bead per stop in tour order and marks the next one", () => {
    const [row] = summarizeDay(
      [
        tour("a", {
          stops: [stop(2, "PROBLEM"), stop(1, "DELIVERED"), stop(3, "PENDING"), stop(4, "PENDING")],
        }),
      ],
      600,
    ).rows;
    expect(row?.beads).toEqual([
      { id: "s1", status: "DELIVERED", next: false },
      { id: "s2", status: "PROBLEM", next: false },
      { id: "s3", status: "PENDING", next: true },
      { id: "s4", status: "PENDING", next: false },
    ]);
  });

  it("measures the delay at the last ticked stop against its planned arrival plus the service time", () => {
    // Planned: arrive 07:00, 10 minutes there. Ticked off at 07:05: ahead of the plan, never negative.
    expect(summarizeDay([tour("a")], 600).rows[0]?.delayMinutes).toBe(0);
    const late = tour("b", {
      stops: [stop(1, "DELIVERED", { completedAt: at("07:22") }), stop(2, "PENDING")],
    });
    expect(summarizeDay([late], 600).rows[0]?.delayMinutes).toBe(12);
  });

  it("knows no delay before the first stop or without a planned arrival", () => {
    const fresh = tour("a", { stops: [stop(1, "PENDING")] });
    const unplanned = tour("b", { stops: [stop(1, "DELIVERED", { etaAt: null })] });
    const [a, b] = summarizeDay([fresh, unplanned], 600).rows;
    expect(a?.delayMinutes).toBeNull();
    expect(b?.delayMinutes).toBeNull();
  });

  it("calls a driver late from five minutes behind the plan", () => {
    expect(isLate(null)).toBe(false);
    expect(isLate(4)).toBe(false);
    expect(isLate(5)).toBe(true);
  });

  it("names the time the last driver is expected back, ignoring planning and finished tours", () => {
    const early = tour("a", { stops: [stop(1, "DELIVERED"), stop(2, "PENDING")] });
    const longer = tour("b", {
      createdAt: at("05:10"),
      stops: [stop(1, "PENDING"), stop(2, "PENDING"), stop(3, "PENDING")],
    });
    const draft = tour("c", {
      status: "DRAFT",
      createdAt: at("05:20"),
      departedAt: null,
      stops: [stop(1, "PENDING"), stop(5, "PENDING")],
    });
    // Last open stop of "b": arrival 09:00 plus 10 minutes there.
    expect(summarizeDay([early, longer, draft], 600).totals.lastFinishAt).toEqual(at("09:10"));
    expect(summarizeDay([draft], 600).totals.lastFinishAt).toBeNull();
  });
});
