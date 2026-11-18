---
covers:
  - src/server/tour-*.ts
  - src/server/tours.ts
  - src/domain/tour*.ts
  - src/domain/day-tours.ts
  - src/domain/routing.ts
  - src/domain/load-sheet.ts
stamp: 9a6e423cf24ebe1ac3bcf106a4e7027506c1c9da42cacbb2181c18cdc3b57755
status: fresh
stale_since: null
---

# Tour planning

The tour-planning module turns a day's **CONFIRMED orders** into tours, releases them to drivers,
and keeps a released tour in sync when the orders behind it change. It is split into pure domain
rules (under `src/domain`) and server-side orchestration with the database and the routing provider
(under `src/server`).

**Since NUD-212 (D34) the office does not plan tours by hand any more.** The customer has two
drivers on two fixed standing tours. The day plan (`/admin/planning`) builds each route from its
standing tour in fixed order, adds the extras of the day where the straight-line detour is smallest
(`src/domain/day-route.ts`), and "An Fahrer senden" creates, rebuilds or re-releases the tours
(`src/server/day-routes.ts`, `sendDayWith`). `Tour.standingTourId` names the standing tour a route
came from. The builder, re-release, driver read model and load sheet below are still the ones
used; the optimizing planner and the `/admin/tours` pages are only reachable by address and no
longer linked.

## Domain rules (`src/domain`)

These are pure TypeScript modules with no framework or database imports.

### `tour.ts` — building stops from orders (NUD-041)

- `StopOrderInput` is one confirmed order: `id`, `customerId`, `items`. `PlannedStop` merges every
  order of a customer into one stop, keeping `orderIds` and summing quantities per product.
- Quantities are whole numbers (NUD-137): `StopOrderInput.items[].quantity` is an `Int` and
  `buildStops` sums them per product.
- `buildStops(orders)` produces one stop per customer (input order of first appearance); the caller
  passes only CONFIRMED orders of one day.
- `routingPoint(customer)` (`src/domain/parking.ts`, D22): the first active Parkplatz by `sortOrder`,
  else the geocoded Lieferadresse (`Customer.lat/lng`), else `null`. `partitionByLocation` splits the
  stops into `routable`, `unrouted` (no location at all: reported, never silently dropped) and
  `withoutParking` (routable stops that go to the address because the customer has no Parkplatz: a
  flag, not a gate). There is no pin confirmation any more (NUD-141).
- `mergeLockedOrder` reorders a LOCKED tour: stops that still have a routable stop keep their
  position, new customers are appended, customers with nothing left are reported as removed.
- `departureInstant` / `computeSchedule`: ETAs are departure + cumulative driving legs + service
  time at every earlier stop. `departureInstant(date, time, timeZone)` converts the wall-clock
  departure time to an instant (handles daylight-saving offset once more at the corrected instant).

### `tour-diff.ts` — what changed since release (NUD-043)

- `SnapshotStop` is a stored stop: `items` is the snapshot released to the driver, `orderIds` the
  linked orders, `completed` true for DELIVERED / PROBLEM.
- `sameItems` / `itemChanges` compare quantity lists as per-product totals (order-insensitive, zero
  entries dropped).
- `planReRelease(stops, orders)` returns a `ReleasePlan` (`diff` + reordered `entries` +
  `removedStopIds`). Completed stops are frozen (status, completion data, quantities, order links —
  edits to their orders are reported in `diff.completedChanged` and never re-dispatched). Open
  stops keep their position and are updated; open stops without orders are removed; a customer
  without an open stop gets a new one at the end (a completed customer that ordered again becomes a
  second visit).
- `outdatedTourDates(before, after)` returns the delivery days whose tours become outdated when an
  order changes. Only CONFIRMED orders count on either side; a change that leaves a confirmed
  order's customer, day and quantities untouched flags nothing. `null` means the order did not
  exist / was deleted.

### `tour-status.ts` — status machine (NUD-043)

`TOUR_STATUSES` = `DRAFT -> OPTIMIZED -> RELEASED -> IN_PROGRESS -> COMPLETED`. `canTransition`
allows staying in place where an action repeats (re-optimizing, re-releasing, another stop done);
COMPLETED is final. `isReReleasable` is RELEASED / IN_PROGRESS. `deriveTourStatus` advances a
released tour: first stop done -> IN_PROGRESS, all done -> COMPLETED, and it never moves backwards.
A stop is done as soon as its status is not PENDING (`isStopDone`).

### `tour-plan.ts` — planning-screen rules (NUD-042)

- `EDITABLE_TOUR_STATUSES` = `DRAFT`, `OPTIMIZED`; `isTourEditable` gates office edits.
- `moveItem` (manual reorder), `isPermutation` (exact id set, any order), `sameOrder`.
- `releaseBlocker(tour)` says why a tour cannot be released: not editable, no stops, no driver, or
  outdated (orders changed after it was built — it must be rebuilt first).

### `tour-progress.ts` — live progress (NUD-054)

- `summarizeProgress(stops)` counts delivered / problem / done / pending, whole-percent of done
  stops (0 for an empty tour) and the first PENDING stop in tour order.
- `isLiveStatus` (RELEASED / IN_PROGRESS) and `showsStopResults` (also COMPLETED) decide which
  screens show live data.
- `parsePollInterval` reads `LIVE_POLL_INTERVAL_MS` (default 30 s, allowed 1 s–5 min; invalid
  values fall back).

### `day-tours.ts` — several tours on one day (NUD-099)

`Tour.date` has no unique constraint: a day gets a **follow-up tour** when confirmed orders arrive
after its tour is COMPLETED. `sortDayTours` numbers them oldest first ("Tour 1", "Tour 2");
`pickDefaultTour` is the newest open tour for the planning screen / dashboard; `pickDriverTour`
is the driver's newest RELEASED / IN_PROGRESS tour (a follow-up wins over the completed one),
else the newest COMPLETED. `findLateOrderIds` / `canCreateFollowUp`: a follow-up is allowed only
when every tour of the day is COMPLETED and there are confirmed orders on no stop.
`deliveredStopConflicts` reports stops of completed tours whose orders were edited after the tour
ran (via `planReRelease`).

### `routing.ts` — fallback routing (NUD-040)

Pure heuristics used by the local fallback of the `RoutingProvider`: `haversineM` (great-circle),
`estimatedRoadDistanceM` (`ROAD_FACTOR = 1.3`), `estimatedDurationS` (`AVERAGE_SPEED_KMH = 30`),
`distanceMatrix` (node 0 is the depot), `tourLength`, `nearestNeighbourOrder` (deterministic, ties
to lowest index), `twoOpt` (symmetric matrix), `estimateLegs`, and `heuristicOrder` (nearest
neighbour then 2-opt; returns indices into the stops).

### `load-sheet.ts` — printable packing list (NUD-091)

The sheet is built from the quantities the TOUR carries (`Stop.items`), never from live orders.
`loadSheetTotals` sums per product and unit with `sumQuantities` (units are never added together)
sorted by `LOAD_SHEET_UNIT_ORDER` (`KG, PACK, CRATE, PIECE`), then catalog order. `loadOrder` lists
stops in LOAD order = reverse delivery order (`loadPosition` counts from 1, the last stop loaded
first).

## Server layer (`src/server`)

### `tour-builder.ts` — building / rebuilding a tour

`generateTourWith(deps, rawDate, { followUp })` (application entry `generateTour`, plus
`generateFollowUpTour`) reads the day's CONFIRMED orders via `listConfirmedOrdersForDate`, merges
them with `buildStops`, routes with the `RoutingProvider` (`route()`) and writes a `Tour` with its
stops in a transaction. Rules:

- Requires a confirmed depot (`depot_not_set`) and refuses past days (`date_in_past`); invalid input
  gives `invalid_date`.
- An unreleased tour (DRAFT / OPTIMIZED) is re-optimized and its stops replaced (`replaced`). A
  LOCKED one keeps the order of its stops (`locked_extended`): existing customers stay, new ones are
  appended, customers without orders are removed. Released / running / completed tours are refused
  (`tour_not_editable`); a released tour is updated by the re-release, not the builder.
- Every stop is routed to the customer's default Parkplatz, else to the address point. Customers
  with no location at all are left out and returned as `warnings` (`NO_LOCATION`); customers on the
  tour without a Parkplatz are returned as `parkingMissing` (flag "Parkplatz fehlt" in the planner,
  non-blocking).
- `maxStops` (`too_many_stops`) and order-change conflicts (`conflict`) come from routing.
- ETAs = `Settings.departureTime` in the factory time zone + legs + `serviceMinutesPerStop` at each
  earlier stop; `Tour.totalDurationS` is driving plus service. Every stop stores the quantities it
  was built with in `Stop.items` (the base of the change diff).
- A follow-up tour (`followUp`) is a NEW tour created only when every tour of the day is COMPLETED
  and there are late orders (`follow_up_not_allowed`, `no_late_orders`); it never rebuilds a tour.
- Writes audit events `tour.generate` / `tour.reoptimize` / `tour.followup` with the date, mode,
  stop counts, added / removed customer ids, `approximate` and unrouted customers.

### `tour-planning.ts` — planning-screen actions

Defines `PlanResult` and the tour query / write helpers: `getTourPlan` (the planning read model,
picking the default tour of the day) and the mutations `releaseTourWith`, `assignDriverWith`
(driver must be active), `setTourLockedWith`, `reorderStopsWith`. The mutations all record audit
events and return `PlanResult` errors (`invalid_tour`, `not_editable`, `conflict`, ...) rather than
throwing.

### `tour-actions.ts` — server actions (the ADMIN gate)

Each action calls `requireRole("ADMIN")` first, then the corresponding helper with the real
database, routing provider and settings:

- `generateTourAction` (build/rebuild a day) and `createFollowUpTourAction` (NUD-099 follow-up).
- `reorderStopsAction` (manual reorder of an unreleased tour; recomputes legs / ETAs / geometry via
  `route()`, not optimized), `setTourLockedAction` (`{tourId, locked}`),
  `assignDriverAction` (`{tourId, driverId}`, `null` clears), `releaseTourAction`
  (`{tourId, version}`), `reReleaseTourAction` (re-release, below).

### `tour-rerelease.ts` — re-release of a released tour (NUD-043)

`loadReleasePlan` compares a released tour with the day's CONFIRMED orders (customers without a
location at all are left out; orders linked to a completed stop are always kept so their edits are
reported). `getTourDiffView` builds the admin banner diff with customer and product names.
`reReleaseTourWith(deps, input)` applies `planReRelease` in a transaction: completed stops are
frozen, open stops are updated in place (order kept, new customers appended, empty ones removed),
legs / ETAs are recomputed with `route()` over the whole sequence and written to open stops only.
It bumps `releaseRevision` (+1 for every re-release that changed something driver-visible —
`isDispatchable`), sets `reReleasedAt`, `lastChange` (with the removed customers) and clears
`isOutdated`; a re-release that changes nothing the driver sees only clears the flag. Stop markers
(`changeKind` ADDED / CHANGED, `changedInRevision`, `previousItems`, `adminChangedAt`) and order
links (`StopOrder`) are written per stop; the tour status is advanced with `deriveTourStatus`
(a re-release that completes the tour sets `completedAt`). It records `tour.rerelease` in the audit
log and returns `conflict` when the order or stop signatures changed during the run.

### `tour-driver.ts` — the driver's read model (NUD-051)

`getDriverTour(db, driverId, date)` returns the driver's tour for a day, or `null`. Only released
tours (RELEASED / IN_PROGRESS / COMPLETED) assigned to this driver are visible; with several on the
day, `pickDriverTour` chooses the active one. Quantities come from the `Stop.items` snapshot, which
changes only when the office (re-)releases, so the driver never sees half-updated numbers. After a
re-release, `updated` is true, `revision` identifies it, stops carry `change` /
`changedInRevision` / `previousItems` for the highlight, and `removedCustomers` names dropped stops.
The caller has already checked `requireRole("DRIVER")`.

### `tour-print.ts` and `tour-queries.ts` — printing and reads

`getTourPrint(db, rawId)` is the read model of the printable load sheet: the tour, its stops in
delivery order with customer addresses and the `Stop.items` snapshot (never live orders), plus the
products and the `Tour.depotSnapshot`. `isOutdated` warns instead of silently printing newer
numbers. `parseSheetLocale` (`lib/load-sheet-locale.ts`, NUD-134) resolves `?locale=`: `de` prints
German, any `zh…` tag (`zh`, `zh-Hans`, `zh-CN`, `zh-Hant-TW`) prints the simplified
(`zh-Hans`) sheet, and anything else (missing, empty, `en`, junk) prints German regardless of the
admin UI language. `tourPlanQuery` and `tourPrintQuery` are the ADMIN-only queries
(`requireRole("ADMIN")`); `tourPlanQuery` falls back to the next delivery date for a bad or missing
`date`.

### `tour-progress.ts` — dashboard "Today" card (NUD-054)

`getTodayProgress` (read entry `todayProgressQuery`, ADMIN-only) picks the day's default tour with
`pickDefaultTour`, summarizes stop progress with `summarizeProgress`, attaches the first open stop
and the problem stops, and — for a COMPLETED tour only — reports `lateOrderCount` from
`getLateOrdersView`. `getLivePollIntervalMs` exposes the poll interval from
`LIVE_POLL_INTERVAL_MS` (default 30 s).

### `tour-service.ts` — orders ↔ tours hook (NUD-032 / NUD-043)

`createTourService(db).markOutdatedForDate(date, client?)` flags the not-yet-completed tours of a
date as `isOutdated`. Order mutations call it (passing the transaction client of the order write,
so the flag is atomic with it) after deciding which days a change really affects with
`outdatedTourDates`; completed tours are left alone. `syncTourProgress(tx, tourId)` advances a
released tour along its status machine after stops change (a stop completed, or a re-release added /
removed stops) and throws on an illegal transition; driver actions call it inside the transaction
that writes the stop status.

## Database / storage

- Writes `Tour` (status, `isOutdated`, `releaseRevision`, `reReleasedAt`, `completedAt`, `locked`,
  `geometry`, `totalDistanceM`, `totalDurationS`, `approximate`, `depotSnapshot`, `lastChange`) and
  `Stop` (sequence, status, `etaAt`, `legDurationS`, `items` JSON snapshot, `previousItems`,
  `changeKind`, `changedInRevision`, `adminChangedAt`, `completedAt`, `problemReason`) with
  `StopOrder` links and audit rows (`recordAudit`). No photo storage is touched by this module.
- Only CONFIRMED orders end up on a tour. Callers pass only those, and the day is always in the
  factory time zone (`getFactoryTimezone`).
