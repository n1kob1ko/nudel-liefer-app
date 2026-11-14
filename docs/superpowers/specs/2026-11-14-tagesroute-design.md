# Day routes from standing tours: one page, one button to send (NUD-212)

Date: 2026-11-14. Owner's decision in the project thread ("Eine Seite, ein Knopf zum Senden").

## Intent

The customer has two drivers who drive two fixed standing tours, and that stays. Planning and
optimizing tours is therefore not needed. What the office and the drivers need is clarity: the
route of a day is the standing tour in its fixed order, with only the customers that ordered. A
customer outside the standing tours who orders for a day rides along on one of them.

The owner's words (2026-11-14): the customer "hat immer nur 2 Fahrer und diese fahren 2
Stammrouten und das wird so bleiben", "es geht eher mehr um Übersichtlichkeit für Fahrer und
Büro", a customer outside the standing tour "wird dann dazugenommen", and he wants to remove the
"Touren" tab because "der Prozess geändert werden muss".

## Goals

- The office works on one page, the day plan (`/admin/planning`): quantities, the route of each
  driver, the load, and one button that sends the day to the drivers.
- The stops of a day route follow the standing tour (`StandingTourCustomer.sortOrder`). Nothing
  is computed or reordered.
- A customer of no standing tour is placed where the detour is smallest, is marked as an extra
  ("Zusatz"), and the office can move it or give it to the other route.
- After sending, changes are sent again with the same button ("Änderungen senden").
- The driver app stays as it is.

## Non-goals

- No route optimization, no distribution by capacity or driving time, no reload trips, no
  vehicle switch. A route above the capacity of its vehicle is a warning with a confirmation.
- No reordering of standing customers for one day. The order is edited in the standing tour.
- No change to the driver screens.

## Anti-goals

- A second place where the office has to look or click to get the day out.
- A change that lets a driver see a half-entered day: sending stays a deliberate click.

## Approaches considered

1. **One page, one button to send (chosen).** The "Touren" tab goes. The day plan shows each
   standing tour with driver, vehicle, load and stops and sends them with one click. A fixed
   state for the driver and the load sheet, one page for the office.
2. Fully automatic without sending. Least clicks, but nobody checks before the driver sees it and
   the load sheet can change after loading.
3. Keep the "Touren" tab, slim. Smallest rebuild, but two places remain.

## Design

### Data

- `Tour.standingTourId` (nullable): the standing tour a day route was built from. A tour built
  before this change has none; it is matched to a standing tour by its driver.
- `StandingTour.vehicleId` (nullable): the vehicle of the route, chosen next to the driver.
- `Order.routeStandingTourId`, `Order.routeSlot` (both nullable): where an extra rides when the
  office moved it. `routeSlot` is the number of standing customers delivered before it (0 = first).
  Both empty means "where the detour is smallest". They live on the order, so the retention job
  removes them with the order and no new table is needed.

### Rules (pure, `src/domain/day-route.ts`)

- The order of a day route: the standing customers in standing order; an extra with slot `k` comes
  after the `k`-th standing customer; several extras in one slot in the order given.
- The suggested place of an extra: the route and slot where inserting its point into the path
  depot, all standing customers with a location, depot adds the least straight-line distance. The
  path uses all standing customers, not only today's, so the place does not jump while quantities
  are typed. A customer without a location goes to the end of the first route.

### Server (`src/server/day-routes.ts`)

- `sendDayWith(deps, { date, overrideOverload? })` for every active standing tour:
  - its stops are the confirmed orders of its standing customers and of the extras placed on it
    that are not on a completed tour, in route order; customers without any location are left out
    and reported;
  - no tour yet: create it (driver and vehicle from the standing tour) and release it;
  - an unreleased tour (old flow): rebuild and release it;
  - a released or running tour: update it through the existing re-release (completed stops stay
    frozen), with the open stops in route order; a changed standing driver is taken over;
  - only completed tours and new orders: a further tour for them (the driver app shows a second
    tour of a day already).
  - Legs, arrival times and the line come from `RoutingProvider.route()` for the fixed order.
  - A route needs a driver and a vehicle. Above the capacity it is refused unless confirmed.
  - Unreleased tours of the day that belong to no standing tour (old flow) are emptied, so their
    orders are free for the routes.
- The day plan can be saved after sending (the `tour_released` block goes): the route is then
  "changed" until it is sent again. Past days stay read-only.
- The read model `standingDayQuery` additionally returns, per route: vehicle, capacity, the state
  (not sent, sent, changed, running, done), the tour id for the load sheet, the stops' status, the
  extras placed on it with their slot; and for each customer outside the standing tours the
  suggested route and slot.

### Page (`StandingPlan`)

- Per standing tour one card: name, state, driver, vehicle, load against capacity, number of
  stops. The table keeps every standing customer (quantities are typed there); a row with a
  quantity gets its stop number; extras are rows inside the table at their place, marked
  "Zusatz", with "Verschieben" (route and position).
- "Hinzufügen" on a customer of no standing tour puts the row into the suggested route.
- After sending: delivered and problem marks per row, "Ladeliste" and "Karte" per route.
- The bar at the bottom: "Mengen speichern" (outline) and the one filled button "An Fahrer
  senden" (after sending and a change: "Änderungen senden"). Sending saves first.

### Navigation

- "Touren" leaves the menu. Links that pointed there go to the day plan of that date.
- The old page stays reachable by its address until the cleanup ticket removes it together with
  its tests; nothing links to it.

## Calls made by the builder (not the owner's words)

- One button sends all routes of the day, not one button per route.
- The driver of a route is the standing tour's driver; "Fahrer fällt aus" means choosing another
  driver there, as today. No separate "driver of this day".
- The vehicle is remembered on the standing tour.
- The place of an extra is computed with straight-line distance, like the app's other estimates.
- No reload trips: with two fixed routes a route that does not fit is the office's call.
- Map and load sheet appear once a route was sent (they need the tour).

## Left to the builder

File layout inside the modules, test structure, wording of the labels (German first, `en` and
`zh-Hans` follow), the audit action names.
