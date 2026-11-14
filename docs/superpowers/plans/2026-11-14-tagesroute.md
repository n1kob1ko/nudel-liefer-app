# Day routes from standing tours (NUD-212) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office sends the day's routes from the day plan with one button; a route is its standing tour in fixed order plus the extras of that day, and the "Touren" tab leaves the menu.

**Architecture:** Pure placement rules in `src/domain/day-route.ts`. `src/server/day-routes.ts` resolves the routes of a day and sends them by reusing `releaseTourWith`, `editTourWith` and `reReleaseTourWith` (the last one gets a customer scope and an order key). `standingDayQuery` and `StandingPlan` carry the route state to the page.

**Tech Stack:** Next.js App Router, TypeScript strict, Prisma + PostgreSQL, zod, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-tagesroute-design.md`

## Global Constraints

- Nothing is merged before the owner has seen before and after (a merge to `main` is live at once).
- Code, identifiers, comments, commits in English; UI text through next-intl in `de`, `en`, `zh-Hans`.
- Every server action starts with `requireRole("ADMIN")` and gets a row in `src/server/authz-matrix.test.ts`; zod strings and arrays on client input need `.max()`.
- No route optimization: `RoutingProvider.route()` only, never `optimize()` or `distribute()` in the new code.
- Yolk (`bg-primary`) only on the one send button; no "…" menus; every screen checked at 390 px and 1280 px.
- Commit message: `NUD-212: <title>`.
- Integration tests: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nudel pnpm vitest run <file>`.

## Review Focus

1. A day with an extra customer and no active standing tour: the page says what is missing, sending is refused with `no_routes`, nothing crashes.
2. An extra is moved to the other route after both routes were sent: its stop leaves the first tour and appears on the second in one "Änderungen senden".
3. A driver completed stops, then the office changes quantities: completed stops stay untouched, open stops stay in route order.
4. A route above its vehicle's capacity: nothing is written for any route until the office confirms.
5. A standing customer without any location has an order: he is reported, the rest of the route is sent.

---

### Task 1: Placement rules

**Files:** Create `src/domain/day-route.ts`, `src/domain/day-route.test.ts`.

**Interfaces (produces):**
```ts
export type RouteMember = { customerId: string; location: LatLng | null };
export type RoutePath = { id: string; members: readonly RouteMember[] };
export type Place = { routeId: string; slot: number };
/** Members in standing order; an extra with slot k follows the k-th member; extras of one slot keep their order. */
export function dayRouteOrder(members: readonly string[], extras: ReadonlyArray<{ customerId: string; slot: number }>): string[];
/** Route and slot with the smallest straight-line detour; `null` without routes; no location -> end of the first route. */
export function suggestPlace(depot: LatLng, routes: readonly RoutePath[], point: LatLng | null): Place | null;
/** The office's place when its route is still there (slot clamped, missing slot = best slot of that route), else the suggestion. */
export function resolvePlace(depot: LatLng, routes: readonly RoutePath[], point: LatLng | null, wanted: { routeId: string | null; slot: number | null }): (Place & { moved: boolean }) | null;
```

- [ ] Tests: order with extras at slot 0, in the middle, past the end (clamped), two extras in one slot; suggestion picks the route whose path passes by and the slot between the two nearest neighbours; members without location are skipped but counted; no routes -> `null`; `resolvePlace` keeps a wanted route, falls back when the route is gone.
- [ ] Run, see them fail, implement, run, commit.

### Task 2: Schema

**Files:** `prisma/schema.prisma`, new migration `prisma/migrations/<ts>_day_routes/migration.sql`, `docs/data-model.md`, backup table lists if the test asks.

- [ ] `Tour.standingTourId String?` (relation `onDelete: SetNull`, `@@index([date, standingTourId])`), `StandingTour.vehicleId String?` (relation `onDelete: SetNull`), `Order.routeStandingTourId String?` (relation `onDelete: SetNull`), `Order.routeSlot Int?`.
- [ ] `pnpm prisma generate`, `pnpm typecheck`, `pnpm test` for the schema guards (backup, user-delete, retention), commit.

### Task 3: Re-release with a scope and an order

**Files:** `src/server/tour-rerelease.ts`, `src/server/tour-rerelease.integration.test.ts`.

**Interfaces (produces):** `ReReleaseDeps.route?: { customerIds: ReadonlySet<string>; orderKey: (customerId: string) => number }`. With it, only orders of these customers count, open stops are written in ascending `orderKey` after the completed ones, and a changed order of the open stops alone is dispatched.

- [ ] Tests: an order of a customer outside the scope is not added; a new customer lands at its key position, not at the end; only the order changed -> `changed: true`, revision +1; without `route` everything behaves as before (existing tests stay green).

### Task 4: Routes of a day and sending

**Files:** Create `src/server/day-routes.ts`, `src/server/day-routes.integration.test.ts`; modify `src/domain/audit.ts` (+ labels) for `tour.day_route`.

**Interfaces (produces):**
```ts
export type DayRoute = { id: string; name: string; driverId: string | null; vehicleId: string | null; members: string[]; extras: Array<{ customerId: string; slot: number; moved: boolean }> };
export async function loadDayRoutes(db, day: Date): Promise<{ depot: LatLng | null; routes: DayRoute[]; places: Map<string, Place & { moved: boolean }> }>;
export type SendDayError = "invalid" | "invalid_date" | "date_in_past" | "depot_not_set" | "no_routes" | "no_stops" | "driver_required" | "driver_invalid" | "vehicle_required" | "vehicle_invalid" | "overloaded" | "conflict";
export type SendDayResult =
  | { ok: true; routes: Array<{ standingTourId: string; tourId: string; outcome: "sent" | "updated" | "unchanged"; stopCount: number }>; warnings: TourWarning[] }
  | { ok: false; error: SendDayError; standingTourId?: string; overKg?: number };
export async function sendDayWith(deps: TourBuilderDeps, rawInput: unknown): Promise<SendDayResult>; // { date, overrideOverload? }
```

- [ ] Tests (Review Focus 1-5 live here): first send creates one released tour per route with stops in standing order and the extra at its slot; second send without changes is `unchanged`; quantity change -> `updated`, driver sees the new items; extra moved to the other route after sending; completed stops frozen; overload refused for all routes, accepted with the override; missing driver / vehicle named with the route; customer without location reported; no active standing tour -> `no_routes`; an unreleased old-flow tour is emptied.

### Task 5: Day plan read and save

**Files:** `src/domain/standing-day.ts`, `src/server/standing-tours.ts`, `src/server/standing-actions.ts`, `src/server/standing-day.integration.test.ts`, `src/server/authz-matrix.test.ts`.

- [ ] `DayPlanRoute` gains `vehicleId`, `capacityKg`, `state: "empty" | "ready" | "sent" | "changed" | "running" | "done"`, `tourId`, `sentAt`; `DayPlanRow` gains `stop: "PENDING" | "DELIVERED" | "PROBLEM" | null`, and for customers of no standing tour `place: (Place & { moved: boolean }) | null`.
- [ ] `dayRowSchema` gains optional `place: { standingTourId, slot }`; a save writes it to the customer's order of the day and flags the day's tours; the `tour_released` refusal goes (past days stay refused).
- [ ] `setStandingTourVehicle` + `setStandingTourVehicleAction`, `sendDayAction`.

### Task 6: Page

**Files:** `src/components/admin/standing-plan.tsx` (+ test), new `src/components/admin/route-place-dialog.tsx`, messages `de`, `en`, `zh-Hans`.

- [ ] Route card header: state, driver, vehicle, load against capacity, stops. Extras inline with "Zusatz" and "Verschieben". Stop numbers on rows with a quantity. Delivered / problem marks. "Ladeliste" and "Karte" once sent. Bottom bar with "Mengen speichern" and the send button; overload confirmation.

### Task 7: Menu and links

**Files:** `src/components/admin/nav-items.ts` (+ tests), every `admin/tours` link outside the old page.

### Task 8: Browser test, docs, ticket

**Files:** `tests/e2e/day-routes.spec.ts`, `backlog.md` (NUD-212, D34, decision log), `docs/tour-planning.md`, `AGENTS.md`.
