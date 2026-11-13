/**
 * The office overview of one delivery day with several drivers out at once (redesign RD2, step 3).
 * Pure rules, no framework imports: one row per tour and the sums over all of them.
 *
 * The app has no live GPS. "Where is the driver" is answered by the stop he ticked off last, with
 * the time of that tap; "when is he back" by the arrival time at his last open stop plus the
 * service time there (the same rule as the driver's own screen, `tourFinishAt`).
 */
import { sortDayTours } from "./day-tours";
import { tourFinishAt } from "./driver-today";
import { summarizeProgress, type TourProgress } from "./tour-progress";

export type OverviewStop = {
  id: string;
  sequence: number;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  /** Customer name. */
  name: string;
  etaAt: Date | null;
  completedAt: Date | null;
  problemReason: string | null;
  lat: number | null;
  lng: number | null;
};

export type OverviewTour = {
  id: string;
  status: "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED";
  createdAt: Date;
  driverName: string | null;
  vehicleName: string | null;
  departedAt: Date | null;
  stops: OverviewStop[];
};

/**
 * What a tour is doing right now, in the office's words: still being planned, released but the
 * driver has not left, on the road, or finished.
 */
export type TourPhase = "planning" | "waiting" | "onRoad" | "done";

export type DriverRow = {
  tourId: string;
  /** "Tour 1", "Tour 2": creation order of the day, as on the planning tabs. */
  number: number;
  status: OverviewTour["status"];
  phase: TourPhase;
  driverName: string | null;
  vehicleName: string | null;
  departedAt: Date | null;
  progress: TourProgress;
  /** First open stop in tour order. */
  nextStop: { id: string; name: string; etaAt: Date | null } | null;
  /** The stop that was ticked off last: the driver's last known place. */
  lastStop: {
    id: string;
    name: string;
    at: Date;
    status: "DELIVERED" | "PROBLEM";
    lat: number | null;
    lng: number | null;
  } | null;
  /** Expected end of the tour; `null` when nothing is open or no arrival time is known. */
  finishAt: Date | null;
};

export type DayProblem = {
  tourId: string;
  driverName: string | null;
  stopId: string;
  name: string;
  reason: string | null;
  at: Date | null;
};

export type DayTotals = {
  tours: number;
  /** Tours whose driver is out right now. */
  onRoad: number;
  total: number;
  delivered: number;
  problems: number;
  done: number;
  pending: number;
  percent: number;
};

export type DayOverview = { rows: DriverRow[]; totals: DayTotals; problems: DayProblem[] };

export function tourPhase(tour: {
  status: string;
  departedAt: Date | null;
  /** Stops that are not PENDING any more. */
  done: number;
}): TourPhase {
  if (tour.status === "COMPLETED") return "done";
  if (tour.status !== "RELEASED" && tour.status !== "IN_PROGRESS") return "planning";
  return tour.departedAt !== null || tour.done > 0 ? "onRoad" : "waiting";
}

/** The office looks at the drivers who are out first, the finished tours last. */
const PHASE_ORDER: Record<TourPhase, number> = { onRoad: 0, waiting: 1, planning: 2, done: 3 };

function rowOf(tour: OverviewTour, number: number, serviceSecondsPerStop: number): DriverRow {
  const progress = summarizeProgress(tour.stops);
  const next = tour.stops.find((s) => s.id === progress.nextStopId) ?? null;
  const last = tour.stops
    .filter((s) => s.status !== "PENDING" && s.completedAt !== null)
    .reduce<OverviewStop | null>(
      (a, s) => (a === null || s.completedAt!.getTime() > a.completedAt!.getTime() ? s : a),
      null,
    );
  const lastOpenEta =
    [...tour.stops]
      .sort((a, b) => b.sequence - a.sequence)
      .find((s) => s.status === "PENDING" && s.etaAt !== null)?.etaAt ?? null;
  return {
    tourId: tour.id,
    number,
    status: tour.status,
    phase: tourPhase({ status: tour.status, departedAt: tour.departedAt, done: progress.done }),
    driverName: tour.driverName,
    vehicleName: tour.vehicleName,
    departedAt: tour.departedAt,
    progress,
    nextStop: next ? { id: next.id, name: next.name, etaAt: next.etaAt } : null,
    lastStop: last
      ? {
          id: last.id,
          name: last.name,
          at: last.completedAt!,
          status: last.status === "PROBLEM" ? "PROBLEM" : "DELIVERED",
          lat: last.lat,
          lng: last.lng,
        }
      : null,
    finishAt: tourFinishAt(lastOpenEta, serviceSecondsPerStop),
  };
}

/**
 * One row per tour of the day and the sums over the tours that were handed to a driver. A tour that
 * is still being planned has a row (the office sees that it exists) but its stops do not count as
 * today's work yet.
 */
export function summarizeDay(
  tours: readonly OverviewTour[],
  serviceSecondsPerStop: number,
): DayOverview {
  const ordered = sortDayTours(tours);
  const rows = ordered
    .map((tour, index) => rowOf(tour, index + 1, serviceSecondsPerStop))
    .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.number - b.number);

  const handed = rows.filter((row) => row.phase !== "planning");
  const sum = (pick: (progress: TourProgress) => number) =>
    handed.reduce((total, row) => total + pick(row.progress), 0);
  const total = sum((p) => p.total);
  const done = sum((p) => p.done);

  const problems = ordered
    .flatMap((tour) =>
      tour.stops
        .filter((s) => s.status === "PROBLEM")
        .map((s) => ({
          tourId: tour.id,
          driverName: tour.driverName,
          stopId: s.id,
          name: s.name,
          reason: s.problemReason,
          at: s.completedAt,
        })),
    )
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return {
    rows,
    totals: {
      tours: rows.length,
      onRoad: rows.filter((row) => row.phase === "onRoad").length,
      total,
      delivered: sum((p) => p.delivered),
      problems: sum((p) => p.problems),
      done,
      pending: sum((p) => p.pending),
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    },
    problems,
  };
}
