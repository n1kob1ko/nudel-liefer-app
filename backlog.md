# Backlog – Liefermanagement-Software (Nudelfabrik)

> **Audience:** an autonomous AI coding agent (and the human reviewing its work).
> **Source of truth for requirements:** [`projektbeschreibung.md`](./projektbeschreibung.md) + the decisions in §2 of this file.
> If the two disagree, **§2 Decisions wins** (they were clarified with the product owner after the description was written).

---

## 0. How to work with this backlog (read first, every session)

1. Read §1–§6 once per session. They are short and they are binding.
2. Pick the **lowest-numbered ticket with `Status: todo` whose `depends_on` are all `done`**. Work on exactly **one ticket per session**.
3. Set its status to `in-progress` in this file before you start, and to `done` only when every acceptance criterion is ticked and the Definition of Done (§5) passes.
4. Stay inside the ticket's scope. If you notice something missing, **add a new ticket** at the end of the right milestone (next free ID) instead of doing it on the side.
5. If a detail is not specified: choose the simplest option that is consistent with §2, implement it, and append one line to the **Decision log** (§9). Do **not** stall. Exception: anything irreversible (deleting data, changing the DB provider, spending money, touching production) → set `Status: blocked`, explain why under the ticket, stop.
6. Tickets marked **👤 HUMAN** need a person (accounts, API keys, client feedback). Prepare everything you can, write precise instructions under the ticket, set `blocked`, move on to the next ticket.
7. Never commit secrets. All config goes through env vars documented in `.env.example`.

> **⚠️ RETIRED HOST (2026-11-04): `87.106.60.131` is gone.** That vServer hosted the production app until 2026-11-04; it was decommissioned and its data (203 customers, 412 orders, 148 photos, 9 users) migrated to the dedicated server **`65.109.100.79`**, which serves the app at the **root** of <https://nudel.stragas.com> — no `/delivery-app/` prefix, own nginx vhost `/etc/nginx/sites-available/nudel-stragas`, with PostgreSQL, MinIO, ORS and Photon all on that one host. **Never deploy to, tunnel into, or write a fresh setup for the old IP.** `deploy/deploy.ps1`, `deploy/server-setup.sh` and `deploy/local-services/tunnel.ps1` all refuse it — and `server-setup.sh` also refuses the new host, because it builds the obsolete `/delivery-app/` sub-path layout and would overwrite `/etc/delivery-app.env` on the live server. The `87.106.60.131` mentions further down this file are historical records of past deployments: they describe what was true then, not what to do now.

Status values: `todo` · `in-progress` · `blocked` · `done` · `superseded` (replaced by another ticket — never implement; follow the pointer)

---

## 1. Product in one paragraph

A pasta factory delivers to business customers (mostly restaurants). The office enters orders (manually, or while looking at a screenshot of a WhatsApp/WeChat message). For each delivery date the system builds one optimized tour starting and ending at the factory. The driver opens a mobile web app (PWA) **in his own language — German, Simplified Chinese, Traditional Chinese (HK) or Traditional Chinese (TW)** — and immediately sees: today's stops in order, the next customer, the products and quantities to unload, a photo of the shop entrance, a photo of where to park/unload, and a button that starts navigation. He marks each stop as delivered or reports a problem. The office sees progress live.

**Top priorities from the client (never compromise these):**
1. Simple operation (especially for drivers who may not read German).
2. **Correct delivery quantities** shown to the driver.
3. Optimized route.
4. Stored shop and parking photos.

---

## 2. Decisions (binding)

| ID | Topic | Decision |
|---|---|---|
| D1 | Scope | Real client project. Production-ready v1. Milestone M1 must be a demo-able MVP. |
| D2 | Platform | **One** Next.js web app. Admin area for desktop, driver area as mobile-first **PWA**. No native apps. |
| D3 | Stack | Next.js (App Router, Server Actions + Route Handlers), TypeScript `strict`, pnpm, Prisma + PostgreSQL, Tailwind CSS + shadcn/ui, next-intl, zod, Auth.js v5, react-leaflet, Serwist (PWA), Vitest, Playwright. |
| D4 | Hosting | Vercel (EU region `fra1`) + Neon Postgres (EU) + Cloudflare R2 (S3-compatible, EU jurisdiction) for images. Local dev: Docker Compose with Postgres + MinIO. Budget target < €50/month. |
| D5 | Scale | 50–150 customers, 10–30 stops/day, **1 driver / 1 tour per day in v1**. Data model must allow several tours per date later (no unique constraint on `Tour.date`). **Amended by D24 (2026-10-26).** |
| D6 | Order entry | M1: manual entry, optionally with an attached screenshot shown side by side. AI extraction is a **later** epic (M3) and will always require human review before saving. Screenshots may be German or Chinese. **Amended by D26 (2026-10-26).** |
| D7 | Catalog | Admin-managed products with SKU, unit and names in all locales. **No prices**. |
| D8 | Dates | Every order has a `deliveryDate` (date only, factory time zone). Future dates allowed. Recurring orders are M3. **Amended by D25 (2026-10-26).** |
| D9 | Route | Start and end at the depot (factory, configurable). Optimization via **OpenRouteService (ORS)** behind a `RoutingProvider` interface, with a local heuristic fallback. Geocoding via ORS behind a `Geocoder` interface. **Admin must confirm the map pin** for every customer. No hard time windows or capacity in v1; delivery hours are informational text. **Pin confirmation replaced by D22; time windows/capacity by D24/D25 (2026-10-26).** |
| D10 | Route control | Office can reorder stops manually, lock, re-optimize and **release** the tour. Driver cannot reorder; he can only mark stops delivered / problem. |
| D11 | Driver feedback | Per stop: `DELIVERED` or `PROBLEM` (predefined reason + optional free text). Free text is auto-translated to German for the office. No signature / proof photo in v1. |
| D12 | Photos | Shop photo + parking photo per customer. Uploaded by office **or** taken by the driver with the phone camera. Customers can be saved without photos but are flagged **"photos missing"**. |
| D13 | Auth | Roles `ADMIN` and `DRIVER`. Admin: email + password. Driver: username + 6-digit PIN, accounts created by admin, long-lived session (90 days). |
| D14 | Languages | UI locales: `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW` across the **whole app**. Each user has a preferred locale, switchable at any time. Drivers choose on first start. Written standard Chinese (no Cantonese colloquialisms). **Replaced by D21 (2026-10-26).** |
| D15 | Translation method | UI strings: `de` and `zh-Hans` maintained by hand; `zh-Hant-HK` / `zh-Hant-TW` generated with **OpenCC** (`s2hk`, `s2twp`) plus per-key override files. Content (product names, customer notes, driver free text): stored as `LocalizedText` (all four locales). Product names: `de` + `zh-Hans` entered by hand, Hant variants derived by OpenCC and editable. Customer notes: machine-translated (`Translator` interface, DeepL default) de→zh-Hans, then OpenCC; editable. **Hant/OpenCC parts replaced by D21 (2026-10-26).** |
| D16 | Navigation | Deep link to Google Maps (universal URL, works on Android + iOS) with lat/lng. No in-app turn-by-turn. **Amended by D30 (2026-10-26).** |
| D17 | Offline | Driver PWA caches today's tour incl. photos; status changes are queued offline and synced later. |
| D18 | Extras in v1 | CSV/XLSX customer import with pin review; printable packing list / load sheet per tour. |
| D19 | Out of scope | Invoicing, delivery notes for accounting, prices, stock / production planning, payments, customer self-service portal, GPS tracking of drivers. |
| D20 | Code language | Code, identifiers, commits, comments: **English**. UI text: via i18n only. |
| D21 | Languages (2026-10-26) | **Admin:** `de`, `en`, `zh-Hans`. **Driver:** `de`, `en`, `sr-Latn` (Serbian, Latin script), `cs`, `zh-Hans`. Traditional Chinese (`zh-Hant-HK`, `zh-Hant-TW`) and the OpenCC build are removed. All message files are hand-maintained (agent-written first, native review via NUD-073). `LocalizedText` keys follow the five locales. Machine translation: DeepL where supported, otherwise the OpenRouter client (NUD-150). |
| D22 | Routing point (2026-10-26) | Optimisation and navigation use the customer's **default Parkplatz** (`ParkingSpot`, NUD-125); without one, the geocoded **Lieferadresse**. No pin confirmation step; a customer is never excluded from a tour for a missing confirmation, only flagged "Parkplatz fehlt". The parking photo is what identifies the spot. |
| D23 | Catalog & quantities (2026-10-26) | Three products: Nudeln (Sackerl, 3 kg), Nudeln (Kiste, 10 kg), Wantan-Teig (`PIECE`, 5 kg, shown "N ×"). Every product has an admin-editable `weightKgPerUnit`. Quantities are whole numbers (`Int`). Unit labels: `PACK` = Sackerl, `CRATE` = Kiste (German; other locales keep their own words). **Amended 2026-10-27 (NUD-159).** |
| D24 | Fleet & multiple tours (2026-10-26) | Several drivers and tours per day. `Vehicle` with capacity in **kg**; driver and vehicle are assigned per tour per day. When the load does not fit: use all available vehicles first, then reload trips at the depot. **Amended by D31 (2026-10-27).** |
| D25 | Delivery window & recurring orders (2026-10-26) | Orders carry a requested delivery window (hours to days); the planned day is the earliest day inside the window with capacity, movable by the office. Recurring orders are in scope now: a rule is confirmed once, then generates CONFIRMED orders 14 days ahead (configurable). Setting a customer inactive pauses his rules and cancels his future open orders. |
| D26 | AI order entry (2026-10-26) | Pasted customer message text and/or screenshot are turned into a DRAFT order by an LLM via **OpenRouter** behind `OrderExtractor`; the office always reviews and confirms. No WhatsApp/WeChat bots. |
| D27 | Driver-maintained data (2026-10-26) | Drivers may set and correct customer key numbers and Parkplatz coordinates and add photos (camera or gallery). Saved directly with author, timestamp and audit history — no office approval. Drivers' field knowledge outranks the system data. |
| D28 | Working time (2026-10-26) | Each driver has working days/hours. Utilization = tour time incl. loading/checking before departure (from checklist timestamps or a default loading time) vs. planned time and vs. contracted hours. Measured from app events only — no GPS tracking (D19 unchanged). |
| D29 | Tour editing (2026-10-26) | "Bearbeiten" may change driver, vehicle, stop order and move stops between tours of the same date — also on released tours (via the "tour was updated" path). Not the date. Completed stops are locked. |
| D30 | Navigation (2026-10-26) | One "Navigation starten" button. With a Parkplatz: Google Maps link with the Parkplatz as `waypoints` and the Lieferadresse as `destination`, `travelmode=driving`; without: the address point. Apple Maps link: Parkplatz only (one destination supported). |
| D31 | Drivers before reloads (2026-10-27) | There are at most as many tours as available drivers. When there are fewer drivers than loaded vehicles, a driver who is back at the depot **switches into the next vehicle that was loaded in the morning** (5 min) instead of waiting for a reload (20 min); a vehicle is never shared by two drivers. Reload trips remain for what still does not fit. A day with more stops than one planning run can route (50) is planned anyway: the compact cluster around the depot is planned, the rest is shown as "not planned today". |
| D32 | Standing tours & the day plan (2026-11-02) | The office plans a delivery day in **standing tours** ("Stammtour"): fixed, named customer groups with a default driver, each customer in exactly one active group. A standing tour is a planning aid, **not** a `Tour` — tours are still built per delivery day. `/admin/planning` shows one table per group with one column per active product and the quantities of that day, editable in place; the bottom lists the active customers of no group with "add for this delivery day" (a one-off order; membership never changes there). Saving writes normal CONFIRMED orders, so tour planning, the driver app and the packing list are unchanged. A quantity of **0 means "nothing ordered"**: an existing order is kept (without positions) instead of being cancelled, and such an order never becomes a stop; a customer without an order gets none. Prefill comes from the weekday's `RecurringOrder` (a suggestion, stored only on save). The view is read-only once a tour of that day is released, and for past days; several confirmed orders of one customer are merged into the first one on save (the rest are cancelled, audited). |
| D33 | Payments (2026-11-02) | Amends D7/D19 (no prices, payments out of scope). Each **order** has a payment term: `MONTHLY` (accumulated monthly bill, the default) or `ON_DELIVERY` (cash at the stop). There are **no catalog prices**: the office types one amount per order (`Order.amountCents`, optional). On a cash delivery the driver records what he actually collected (`Stop.collectedCents`, prefilled from the stop's cash amounts, editable, offline via the outbox, audited). The office has a **Zahlungen** page: open cash (nothing or too little collected) and open months, plus one **month page per customer** listing the month's orders and total, printable, with a "paid" marker (`MonthlyPayment`, snapshot of total and count, audited, take-back keeps the row with `voidedAt`). A month can only be marked paid once it is over. Amounts are whole euro cents everywhere. |

---

## 3. Glossary (use these words consistently in code and UI)

| Term (code) | German UI | Meaning |
|---|---|---|
| `Customer` | Kunde | A business that receives deliveries. Has exactly one delivery address (**Lieferadresse**) and zero or more parking spots; optional key number. |
| `Product` | Produkt | A sellable article with a unit and a weight per unit (e.g. Nudeln in `CRATE` = Kiste, 10 kg). |
| `Order` | Bestellung | What one customer ordered for one `deliveryDate`. Contains `OrderItem`s. |
| `OrderItem` | Produkt (in an order; plural "Produkte" — **never "Position"**) | Product + whole-number quantity within an order. |
| `Depot` | Fabrik / Depot | Start and end point of every tour. Stored in `Settings`. |
| `Tour` | Tour | One driver's delivery run on one date. Contains ordered `Stop`s. **Don't use "Route" for this entity**; "route" only means the geometry / road path. |
| `Stop` | Stopp | One visit to one customer within a tour. **All confirmed orders of a customer for that date are merged into one stop.** |
| `Release` | Freigabe | The act of making a tour visible to the driver. |
| `ParkingSpot` | Parkplatz | Where the driver parks/unloads; the default one is the routing and navigation point (D22). **The words "Pin" / "Kartenpunkt" are no longer used in the UI.** |
| `Customer.lat/lng` | Lieferadresse (Adresspunkt) | Geocoded point of the delivery address; routing fallback when no Parkplatz exists. |
| `Vehicle` | Fahrzeug | A delivery vehicle with a capacity in kg (D24). |
| `RecurringOrder` | Dauerbestellung | Rule that generates orders on a schedule (D25). |
| delivery window | Lieferzeitraum | The time span in which the customer accepts the delivery (D25). |
| `PACK` / `CRATE` / `PIECE` | Sackerl / Kiste / "N ×" | Unit labels (D23, amended by NUD-159). Say Sackerl and Kiste; never Beutel, Karton or Packung in German UI strings (guarded by `src/lib/forbidden-words.test.ts`). The other locales keep their own words (Bag/Carton, Sáček/Karton, Kesa/Karton, 袋/纸箱). |
| `LocalizedText` | – | JSON value `{ de, en, "sr-Latn", cs, "zh-Hans", meta }` (D21; Hant keys until NUD-140 lands) used for any user-generated text the driver must read. |

---

## 4. Global technical conventions

### 4.1 Repository layout

```
/                         repo root = this folder (nudel-liefer-app)
├─ projektbeschreibung.md
├─ backlog.md
├─ AGENTS.md              conventions for agents (created in NUD-001; keep in sync with §4/§5)
├─ docker-compose.yml     postgres + minio for local dev
├─ prisma/                schema.prisma, migrations/, seed.ts
├─ messages/              de.json, en.json, zh-Hans.json (everything), sr-Latn.json, cs.json (driver namespaces)
│                         (all hand-maintained; only src/lib/fatal-messages.json is generated)
├─ scripts/               i18n-build.ts, i18n-check.ts, ...
├─ src/
│  ├─ app/[locale]/(admin)/...     admin pages
│  ├─ app/[locale]/(driver)/...    driver pages (mobile)
│  ├─ app/api/...                  route handlers (uploads, health, sync)
│  ├─ domain/                      pure business logic, no framework imports (tour building, aggregation, status machines)
│  ├─ server/                      db access, services, auth, providers (geocoder, routing, translator, storage)
│  ├─ components/                  ui/ (shadcn), admin/, driver/, shared/
│  └─ lib/                         utilities (dates, i18n helpers, LocalizedText)
├─ tests/e2e/                      Playwright
└─ docs/                           runbook, ADRs, env setup
```

### 4.2 Commands (must exist after NUD-001 and stay green)

| Command | Purpose |
|---|---|
| `pnpm dev` | local dev server |
| `pnpm lint` | ESLint (no warnings allowed in CI) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit/integration |
| `pnpm test:e2e` | Playwright (desktop + mobile viewport projects) |
| `pnpm i18n:build` | regenerate `src/lib/fatal-messages.json` (global error page texts) from the message files |
| `pnpm i18n:check` | fail if any key is missing/empty in any locale or a generated file is stale |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma migrate + seed |

### 4.3 Rules

- **No hard-coded UI strings.** Every visible text goes through next-intl. `pnpm i18n:check` runs in CI.
- Set `<html lang="…">` to the exact locale (`de`, `en`, `sr-Latn`, `cs`, `zh-Hans`) so the browser picks correct glyph shapes. Use system font stacks (`"PingFang SC"`, `"Noto Sans SC"`, `"Microsoft YaHei"` for Chinese); do **not** bundle multi-MB CJK web fonts.
- Customer names and addresses are **never translated**: the driver must match them to real signage.
- All server mutations: zod validation + role check on the server. Never trust the client.
- Domain logic in `src/domain/` must be pure and unit-tested; providers (geocoder, routing, translator, storage) are injected via interfaces and have a **Fake** implementation used in tests and when the API key is missing (log a warning).
- Dates: `deliveryDate` is a `DATE` column. "Today" is computed in the factory time zone (`Settings.timezone`, default `Europe/Vienna`).
- Quantities: `Int` (whole numbers, D23). No decimals anywhere: no half Sackerl, no half Kiste.
- Driver UI: touch targets ≥ 48 px, body text ≥ 16 px, quantities ≥ 28 px bold, icons alongside text so the screen is understandable even with an unexpected language.
- Accessibility: WCAG AA contrast, keyboard-navigable admin.
- Use soft delete (`active=false` / archive) for customers, products and users. Never hard-delete business data. The one exception is the order retention job (NUD-201, client decision 2026-11-13): it deletes paid orders, their stops and tours and paid monthly bills 30 days after the payment.
- Every service-layer write to orders, tours, stops or customer photos records an audit entry in the same transaction (`recordAudit`, NUD-092); the audit log is append-only.

### 4.4 Environment variables (grow `.env.example` as tickets add them)

`DATABASE_URL`, `AUTH_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `ORS_API_KEY`, `DEEPL_API_KEY`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `SENTRY_DSN` (optional).

---

## 5. Definition of Done (applies to every ticket)

- [ ] All acceptance criteria of the ticket are met and ticked in this file.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` pass. `pnpm test:e2e` passes if the ticket touches UI flows.
- [ ] New UI text exists in `de` and `zh-Hans`; `pnpm i18n:build` was run.
- [ ] New server mutations have an authorization test (wrong role → rejected).
- [ ] New env vars are in `.env.example` and `docs/env.md`.
- [ ] Migrations are committed; `pnpm db:seed` still works on a fresh DB.
- [ ] Screens checked at 375 px (driver) or 1280 px (admin) width; no horizontal scroll.
- [ ] One commit (or a small series) referencing the ticket ID, e.g. `NUD-030: manual order entry`.
- [ ] Short "Implementation notes" added under the ticket (what was built, anything surprising, follow-ups).

---

## 6. Data model (target for v1 – NUD-002 creates the core, later tickets extend)

```prisma
enum Role         { ADMIN DRIVER }
enum Locale       { de en sr_Latn cs zh_Hans }   // map to BCP-47 tags in code (sr-Latn, zh-Hans)
enum Unit         { KG PACK CRATE PIECE }
enum PhotoKind    { STORE PARKING }
enum OrderSource  { MANUAL SCREENSHOT }
enum OrderStatus  { DRAFT CONFIRMED CANCELLED }
enum TourStatus   { DRAFT OPTIMIZED RELEASED IN_PROGRESS COMPLETED }
enum StopStatus   { PENDING DELIVERED PROBLEM }
enum ProblemReason{ CLOSED NOBODY_THERE NO_PARKING WRONG_QUANTITY REFUSED ADDRESS_NOT_FOUND OTHER }

model User      { id, role, email?(unique), username?(unique), passwordHash, locale, localeChosen Boolean, displayName, active, createdAt, updatedAt }
model Settings  { id(singleton), depotName, depotAddress, depotLat, depotLng, depotPinConfirmed Boolean @default(false), timezone, departureTime "07:00",
                  serviceMinutesPerStop Int @default(10), deliveryWeekdays Int[] @default([1,2,3,4,5]) }
model Customer  { id, customerNumber(unique), name, street, postalCode, city, country @default("AT"),
                  lat?, lng?, pinConfirmed Boolean, notes Json? /*LocalizedText*/, deliveryHoursInfo String?,
                  active, createdAt, updatedAt, photos Photo[] }
model Photo     { id, customerId, kind, storageKey, width, height, bytes, uploadedById, isCurrent, createdAt }
model Product   { id, sku(unique), name Json /*LocalizedText*/, unit, active, sortOrder, createdAt, updatedAt }
model Screenshot{ id, storageKey, uploadedById, createdAt, extraction Json? /*M3*/ }
model Order     { id, customerId, deliveryDate @db.Date, status, source, screenshotId?, internalNote?, createdById, createdAt, updatedAt, items OrderItem[] }
model OrderItem { id, orderId, productId, quantity Int }
model Tour      { id, date @db.Date, driverId?, status, isOutdated Boolean, locked Boolean,
                  depotSnapshot Json, geometry Json?, totalDistanceM Int?, totalDurationS Int?,
                  optimizedAt?, releasedAt?, completedAt?, createdAt, updatedAt, stops Stop[] }
model Stop      { id, tourId, customerId, sequence Int, status, etaAt DateTime?, legDistanceM Int?, legDurationS Int?,
                  problemReason?, problemNote Json? /*LocalizedText, source = driver locale*/, completedAt?, clientMutationId? (unique),
                  orders StopOrder[] }
model StopOrder { stopId, orderId  @@id([stopId, orderId]) }
model AuditLog  { id, actorId, entity, entityId, action, diff Json, createdAt }   // NUD-092
```

`LocalizedText` JSON shape (validated with zod):
```ts
type LocalizedText = {
  de?: string; en?: string; "sr-Latn"?: string; cs?: string; "zh-Hans"?: string;
  meta: { source: Locale; machine: Partial<Record<Locale, boolean>>; updatedAt: string };
};
```
Read rule: `pick(text, locale)` returns the requested locale; if empty, the closest Chinese variant (HK↔TW, then Hans), then `de`, then the source.

---

## 7. Ticket index

| ID | Title | MS | depends_on | Status |
|---|---|---|---|---|
| NUD-001 | Repo scaffold, tooling, CI, AGENTS.md | M0 | – | blocked |
| NUD-002 | Database schema v1, local Docker, seed | M0 | 001 | blocked |
| NUD-003 | i18n foundation (4 locales, OpenCC build, LocalizedText) | M0 | 001 | done |
| NUD-004 | Authentication & roles | M0 | 002, 003 | blocked |
| NUD-005 | App shells & UI kit (admin + driver) | M0 | 003, 004 | done |
| NUD-006 | Object storage & image upload pipeline | M0 | 002 | blocked |
| NUD-007 | 👤 Deployment pipeline (Vercel/Neon/R2) | M0 | 002, 004 | blocked |
| NUD-008 | Admin user management (drivers) | M0 | 005 | done |
| NUD-010 | Geocoder interface + ORS + Fake | M1 | 002 | done |
| NUD-011 | Map component with draggable pin | M1 | 005 | done |
| NUD-012 | Depot & general settings page | M1 | 010, 011 | done |
| NUD-013 | Customer list & search | M1 | 005 | done |
| NUD-014 | Customer create/edit with pin confirmation | M1 | 010, 011, 013 | done |
| NUD-015 | Customer photos (admin upload/replace) | M1 | 006, 014 | done |
| NUD-020 | Product catalog CRUD (multilingual names) | M1 | 003, 005 | done |
| NUD-030 | Manual order entry | M1 | 014, 020 | done |
| NUD-031 | Screenshot attachment & split-view entry | M1 | 006, 030 | done |
| NUD-032 | Order overview & editing | M1 | 030 | done |
| NUD-040 | RoutingProvider + ORS optimization + fallback heuristic | M1 | 002 | done |
| NUD-041 | Tour builder (orders → stops → optimized tour) | M1 | 012, 032, 040 | done |
| NUD-042 | Tour planning UI (map, reorder, lock, release) | M1 | 011, 041 | done |
| NUD-043 | Tour lifecycle & change handling (outdated tours) | M1 | 042 | done |
| NUD-050 | Driver first-start language picker | M1 | 005 | done |
| NUD-051 | Driver "today's tour" screen | M1 | 043, 050 | done |
| NUD-052 | Driver stop detail + navigation | M1 | 015, 051 | done |
| NUD-053 | Driver stop status (delivered / problem) | M1 | 052 | done |
| NUD-054 | Admin live tour progress | M1 | 053 | done |
| NUD-060 | MVP demo seed + end-to-end happy path | M1 | 054 | done |
| NUD-070 | Translator interface + DeepL + OpenCC derivation | M2 | 003 | done |
| NUD-071 | Customer notes translation & multilingual editor | M2 | 014, 070 | done |
| NUD-072 | Driver problem text → German for office | M2 | 053, 070 | done |
| NUD-073 | 👤 UI string review workflow for native speakers | M2 | 003 | blocked |
| NUD-080 | PWA installability | M2 | 051 | done |
| NUD-081 | Offline cache of today's tour + photos | M2 | 080, 052 | done |
| NUD-082 | Offline mutation queue for stop status | M2 | 081, 053 | done |
| NUD-083 | Driver photo capture / replace | M2 | 052, 082 | done |
| NUD-090 | Customer import (CSV/XLSX) with pin review | M2 | 014 | done |
| NUD-091 | Packing list / load sheet print view | M2 | 041 | done |
| NUD-092 | Audit log for orders and tours | M2 | 032, 043 | done |
| NUD-093 | Security hardening | M2 | 060 | done |
| NUD-094 | Monitoring, backups, error pages, runbook | M2 | 007 | done |
| NUD-095 | Driver usability & accessibility pass | M2 | 083 | done |
| NUD-096 | 👤 User acceptance test with client & drivers | M2 | 093, 095 | blocked |
| NUD-097 | Silence Auth.js prerender error log | M2 | 004 | done |
| NUD-098 | Keep OpenCC out of the client bundle | M2 | 003 | done |
| NUD-099 | Late orders for an already completed tour | M2 | 043 | done |
| NUD-105 | 👤 Real-device PWA install check + Lighthouse run | M2 | 080 | todo |
| NUD-106 | Installed app opens in the driver's current language | M2 | 080 | done |
| NUD-107 | 👤 Real-device offline check (dead spot, photos, logout) | M2 | 081 | todo |
| NUD-108 | Map view offline (tiles) | M2 | 081 | done |
| NUD-109 | 👤 Real-device check of the offline mutation queue (Background Sync, logout with unsent taps) | M2 | 082 | todo |
| NUD-110 | Nonce-based script CSP | M2 | 093 | done |
| NUD-111 | Audit log retention job | M2 | 093 | done |
| NUD-112 | Retention for orders, tours, stops and driver texts | M2 | 093 | done |
| NUD-113 | 👤 Verify security configuration on the real deployment | M2 | 007, 093 | blocked |
| NUD-114 | 👤 Set up and verify monitoring and backups on the real accounts | M2 | 007, 094 | todo |
| NUD-115 | 👤 Real-device usability check of the driver app (TalkBack, font size, one hand, dark mode, slow network) | M2 | 095 | todo |
| NUD-116 | Warn on the order form when the delivery day's tour is already completed | M2 | 099 | done |
| NUD-117 | Deliver quantity changes on already delivered stops (correction stop) | M2 | 099 | done |
| NUD-118 | Driver app with two tours on one day (offline cache, hint, real device) | M2 | 099, 081 | blocked |
| NUD-119 | Driver map: tap on a marker opens the stop detail | M2 | 081 | done |
| NUD-120 | 👤 Roll out the strict script CSP on the real deployment (report-only first) | M2 | 110, 113 | in-progress |
| NUD-121 | Driver problem text is also copied into the audit log | M2 | 112 | done |
| NUD-122 | Photo upload works on the office and driver path | M2 | – | done |
| NUD-123 | Add driver / customer / order through the GUI | M2 | – | done |
| NUD-124 | Product list: `PACK` → Beutel, six real products, archive the demo ones | M2 | – | superseded → NUD-138 |
| NUD-125 | Parking spots: schema + office UI | M2 | – | done |
| NUD-126 | Parking spots: driver UI, park-first navigation, offline | M2 | 125 | done |
| NUD-127 | 👤 Deploy to the vServer (handoff doc) | M2 | 122, 123, 124, 125, 126 | done |
| NUD-128 | Realign the order e2e assertions with the redesign's plural unit labels | M2 | – | done |
| NUD-129 | Admin order list overflows horizontally at phone width | M2 | – | done |
| NUD-130 | Give the admin-password test teardown the same timeout as its setup | M2 | – | done |
| NUD-131 | The dev server serves 127.0.0.1 a page whose buttons do nothing | M2 | – | done |
| NUD-132 | Brighter design with a light/dark toggle of its own | M2 | – | done |
| NUD-133 | Six committed tests import locale fixtures that are not in git | M2 | – | done |
| NUD-134 | Load sheet: Deutsch/中文 printout, readable in dark mode | M2 | – | done |
| NUD-135 | Edit an existing tour from the admin view | M2 | – | done |
| NUD-136 | Customer master data from the factory list (Firma, UID, billing address) + number-less import | M2 | 090 | done |
| NUD-137 | Whole-number quantities | M2.6 | – | done |
| NUD-138 | Product catalog: 3 real products with weight per unit | M2.6 | 137 | done |
| NUD-139 | Wording: Produkte, Parkplatz/Lieferadresse, day/night toggle | M2.6 | – | done |
| NUD-140 | Languages: Deutsch · English · Srpski · Čeština · 中文 | M2.6 | 139 | done |
| NUD-141 | Parkplatz is the routing point; no more pin confirmation | M2.6 | 125, 139 | done |
| NUD-142 | Customer key number (office + driver) | M2.6 | 139 | done |
| NUD-143 | Driver stop UI: whole card opens details, gallery photos | M2.6 | – | done |
| NUD-144 | Driver sets Parkplatz coordinates | M2.6 | 125, 141 | done |
| NUD-145 | Tour page cleanup + real ORS routing (👤 key) | M2.6 | – | done |
| NUD-146 | Vehicles with kg capacity, one vehicle per tour | M2.6 | 138, 135 | done |
| NUD-147 | Several tours per day: split by capacity, then reload trips | M2.6 | 146 | done |
| NUD-148 | Requested delivery window instead of a delivery date | M2.6 | 147 | done |
| NUD-149 | Recurring orders (Dauerbestellungen) | M2.6 | 148 | done |
| NUD-150 | AI order draft from pasted message text or screenshot (OpenRouter) | M2.6 | 138 | done |
| NUD-151 | Optional departure checklist for the driver | M2.6 | 138, 142 | done |
| NUD-152 | Driver working time and utilization | M2.6 | 146, 151 | done |
| NUD-153 | Tablet layout audit (portrait + landscape), every page — run last | M2.6 | 125, 126, 135, 137–152 | done |
| NUD-154 | A new order is offered to every open tour of its day (several open tours) | M2.6 | 135 | done |
| NUD-155 | One-off day import from CSV (customer number, quantity, Karton, notes) | M2.6 | 138, 142, 148 | done |
| NUD-156 | Self-hosted OpenRouteService (routing/optimization without a quota) | M2.6 | – | done |
| NUD-157 | Geocoding quota: 94 active customers still without an Adresspunkt | M2.6 | – | done |
| NUD-158 | Plan by drivers: vehicle switch instead of reload; plan what fits when a day has too many stops | M2.6 | 147 | done |
| NUD-159 | Wording: Beutel → Sackerl, Karton → Kiste (amends D23 and glossary §3) | M2.6 | – | done |
| NUD-160 | `pnpm db:seed --demo` exits 1 with `Photo D-005/STORE not saved: key_in_use` | M2.6 | – | done |
| NUD-161 | Playwright `CI=1` rebuilds on every run and exceeds the 180 s webServer timeout | M2.6 | – | done |
| NUD-162 | e2e specs `late-orders`, `mvp-happy-path` need an empty "today" and a demo-seeded DB: document/guard a dedicated e2e database | M2.6 | – | done |
| NUD-163 | Driver app picks only the newest open tour when a driver has two open tours on one day | M2.6 | 118 | done |
| NUD-164 | Customer Abkürzung (legacy internal code, optional, driver-editable; same logic as the key number) | M2.6 | 142 | done |
| NUD-165 | 👤 One-off parking-spot import from the 2026-10 captures (archived, not a product feature) | M2.6 | – | done |
| NUD-166 | Dauerbestellung directly from the order form | M2.6 | 149 | done |
| NUD-167 | Scheduled jobs on the vServer never ran (env file unreadable for `deliveryapp`) | M2.6 | – | done |
| NUD-168 | 👤 Production map tiles: replace the dev-only OSM default with a provider key | M2.6 | – | blocked |
| NUD-169 | Fahrer table needs a column decision (scrolls inside its card at tablet sizes) | M2.6 | 153 | done |
| NUD-170 | Inline Aktiv switch: 48 px hit area in the UI kit | M2.6 | 153 | todo |
| NUD-171 | Dauerbestellung: mehr Muster, Zeitfenster, Befristung, Ausnahmen, Vorschau | M2.6 | 149, 152 | done |
| NUD-172 | Zeitmodell: Ankunft/Ende live aus dem Tourfortschritt | M2.7 | – | done |
| NUD-173 | Offline-Queue sendet bei zurückkehrendem Server (Controller auf der Offline-Shell) | M2.7 | – | done |
| NUD-174 | Sync-Pille und Warteschlangen-Panel sagen die Wahrheit | M2.7 | – | done |
| NUD-175 | `/theme.js` in den Service-Worker-Precache | M2.7 | – | done |
| NUD-176 | „Rückgängig" erreichbar machen, Toasts nicht mehr über dem Header | M2.7 | – | done |
| NUD-177 | Problem-Notiz des Fahrers wieder anzeigen | M2.7 | – | done |
| NUD-178 | Bestellübersicht und Detail beschreiben die Tour mit einer Regel, der Zähler stimmt | done |
| NUD-179 | Bestellübersicht startet auf „Heute" | M2.7 | – | done |
| NUD-180 | Erledigt-Gruppe trennt Probleme, erledigte Zeilen zeigen die tatsächliche Zeit | M2.7 | – | done |
| NUD-181 | Parkplatz: Fahrer setzt den Punkt auf der Karte | M2.7 | – | done |
| NUD-182 | Ein Datumsformat in beiden Shells, kein Abschneiden | M2.7 | – | done |
| NUD-183 | Dashboard: „0 / 0" und Loch im KPI-Raster | M2.7 | – | done |
| NUD-184 | Fehlgeschlagener Fahrer-Login leert Name **und** PIN | M2.7 | – | done |
| NUD-185 | Angemeldete dürfen die Login-Seiten sehen (mit „Abmelden") | M2.7 | – | done |
| NUD-186 | Sprachumschalter auf der Büro-Anmeldung | M2.7 | – | done |
| NUD-187 | „Auslastung" nennt den Ort der Arbeitszeiten | M2.7 | – | done |
| NUD-188 | Demo-Daten: Sprache des Demo-Fahrers, Testreste in den Pickern | M2.7 | – | done |
| NUD-189 | Teillieferung / Ist-Menge (Epic nach dem Defekt-Block) | M2.7 | 172 | todo |
| NUD-190 | Kundenstatus-Link (nach NUD-172) | M2.7 | 172 | todo |
| NUD-192 | Layout-Refresh des Designers (Büro-Formulare, Tabellen, Login, Auslastung) | M2.7 | – | done |
| NUD-193 | ORS und Photon vom Entwickler-PC lösen (vor dem Hand-over) | M3 | – | todo |
| NUD-194 | Tagesplanung: Stammtouren mit festen Kunden, Mengen direkt bearbeiten | M2.7 | 149 | done |
| NUD-195 | Fahrer: „Geliefert" direkt auf der Karte des nächsten Stopps | M2.7 | – | done |
| NUD-196 | Zahlungen: Bar bei Lieferung oder Monatsrechnung, kassierter Betrag, Monatsrechnung mit Bezahlt-Vermerk | M2.7 | 033 | done |
| NUD-197 | Monatsrechnung: Korrekturzeile (Rabatt, Gutschrift, Zuschlag) | M2.8 | 196 | done |
| NUD-198 | Monatsrechnung: Export als PDF und CSV für die Buchhaltung | M2.8 | 197 | done |
| NUD-199 | Zahlungen: Bezahlt-Historie als eigene Seite | M2.8 | 196 | done |
| NUD-200 | Nightly backup of the master data on the server (no orders, tours or payments; nothing off-site) | M2.7 | 094 | done |
| NUD-201 | Bezahlte Bestellungen, Touren und Monatsrechnungen automatisch löschen | M2.8 | 196 | done |
| NUD-202 | Hosting on Railway instead of the dedicated server | M2.8 | 200 | in-progress |
| NUD-100 | AI screenshot extraction (review required) | M3 | 031 | superseded → NUD-150 |
| NUD-101 | Recurring / standing orders | M3 | 032 | superseded → NUD-149 |
| NUD-102 | Multiple drivers / tours per day | M3 | 043 | superseded → NUD-147 |
| NUD-103 | Delivery time windows & vehicle capacity | M3 | 102 | superseded → NUD-147/148 |
| NUD-104 | Proof of delivery (photo / signature) | M3 | 053 | todo |

**Milestone exit criteria**

- **M0 Foundation:** an admin and a driver can log in on the deployed preview URL in all four languages; CI is green.
- **M1 MVP (demo):** office creates customers (with pins and photos), products and orders for a date → generates and releases an optimized tour → driver sees it on the phone, opens stops, navigates, marks delivered/problem → office sees progress. Works in `de` and all Chinese locales.
- **M2 Production v1:** offline-capable driver app, translations of notes/problem texts, import, packing list, audit, hardening, monitoring, accepted by the client.
- **M3 Later:** only after M2 sign-off. Tickets are sketched; refine them before starting.

---

## 8. Tickets

### M0 — Foundation

---

#### NUD-001 · Repo scaffold, tooling, CI, AGENTS.md
**Status:** blocked (e2e + CI not verifiable in this environment, see Implementation notes) · **depends_on:** – 

**Goal:** an empty but production-grade Next.js project that every later ticket builds on.

**Scope**
- `create-next-app` with App Router, TypeScript strict, Tailwind, ESLint, `src/` dir, pnpm.
- Prettier + `eslint-config-prettier`; import sorting.
- Vitest (with `@testing-library/react`, jsdom) and Playwright with two projects: `desktop` (1280×800) and `mobile` (Pixel 7 emulation).
- GitHub Actions workflow: install → lint → typecheck → test → (e2e on PR, with Postgres service).
- `AGENTS.md` summarising §0, §4, §5 of this backlog (short, link back here). Add a `CLAUDE.md` that just says "see AGENTS.md".
- `README.md`: what the app is, how to run locally.
- Folder skeleton from §4.1 with placeholder `index.ts` where useful.

**Acceptance criteria**
- [x] `pnpm dev` serves a placeholder page.
- [x] All commands from §4.2 that apply at this point exist and pass (`i18n:*` may be stubs that exit 0 until NUD-003). (`test:e2e` exists but could not be run here, see notes.)
- [ ] CI runs on push and PR and is green. (workflow written; not run, no GitHub remote)
- [ ] One example unit test and one example e2e test exist and pass. (unit tests pass; e2e spec written and listed by Playwright for both projects, but not executed)

**Implementation notes**
- Next.js 16.4 / React 19 / Tailwind 4 / ESLint 9 flat config / Vitest 5 / Playwright 1.64, pnpm 12 (`packageManager` pinned). Placeholder page at `/`, unit tests (`src/lib/example.test.ts`, `src/app/page.test.tsx`), e2e `tests/e2e/home.spec.ts` (projects `desktop` 1280x800, `mobile` Pixel 7).
- Verified: `pnpm lint` (max-warnings=0), `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` (stub), `pnpm build`, dev server returns the page.
- NOT verified: `pnpm test:e2e` (Playwright browser download blocked by the sandbox network allowlist; run `pnpm exec playwright install chromium && pnpm test:e2e` locally) and the GitHub Actions workflow `.github/workflows/ci.yml` (no remote). Once both are green, tick the two open criteria and set the ticket to `done`.
- Removed the default Geist Google fonts (build needs network and §4.3 requires system font stacks); `<html lang>` is hard-coded `de` until NUD-003.
- `typecheck` runs `next typegen` first because Next 16 generates the global `LayoutProps` types.
- `i18n:build` / `i18n:check` are stubs (`tsx scripts/...`) until NUD-003. Dependencies of later tickets (Prisma, next-intl, ...) deliberately not installed.
- The mounted project folder is slow for installs: run `pnpm install` on a local checkout if it times out. No shadcn/ui yet (NUD-005).

---

#### NUD-002 · Database schema v1, local Docker, seed
**Status:** blocked (Docker and the native Prisma schema engine are unavailable here, see Implementation notes) · **depends_on:** 001

**Goal:** Postgres + Prisma with the full v1 core schema from §6 (except `AuditLog`, added in NUD-092).

**Scope**
- `docker-compose.yml` with `postgres:16` and `minio` (+ bucket auto-creation via `mc` init container).
- `prisma/schema.prisma` implementing §6 models, enums, relations, indexes: `Order(deliveryDate, status)`, `Order(customerId, deliveryDate)`, `Tour(date)`, `Stop(tourId, sequence)`, `Customer(name)`, `Customer(customerNumber)`.
- `src/server/db.ts` singleton Prisma client.
- `prisma/seed.ts`: settings singleton (placeholder depot in Vienna, `Europe/Vienna`), 1 admin (`admin@example.com` / password from env `SEED_ADMIN_PASSWORD`), 4 drivers (one per locale), 6 products, 0 customers (demo customers come in NUD-060).
- zod schema + helpers for `LocalizedText` live in `src/lib/localized-text.ts` (shared with NUD-003).

**Acceptance criteria**
- [ ] `docker compose up -d && pnpm db:migrate && pnpm db:seed` works on a clean machine. (NOT verified here: no Docker, and `prisma migrate deploy` needs the native schema engine which the sandbox cannot download. Verified instead: the committed migration SQL applied to a clean PostgreSQL 16 followed by `pnpm db:seed`, twice, idempotent.)
- [x] An integration test (Vitest, real DB via `DATABASE_URL` test schema) creates a customer → order → items and reads them back. (`src/server/db.integration.test.ts`, 4 tests, passed against embedded PostgreSQL 16.)
- [x] Deleting a customer with orders is impossible at DB level (`onDelete: Restrict`); archive via `active=false`. (tested)

**Implementation notes**
- Prisma 7.10.1 (`prisma-client` generator, output `src/generated/prisma`, git-ignored, generated by `postinstall`), driver adapter `@prisma/adapter-pg`, `prisma.config.ts` holds the datasource URL and seed command. Schema = §6 without AuditLog; enum `Locale` maps to BCP-47 tags via `@map`. Extra deps: zod, bcryptjs (seed hashes), dev: `embedded-postgres`, `dotenv`.
- `src/server/db.ts` exports `getDb()` (lazy singleton, so builds without `DATABASE_URL` work) and `createPrismaClient`. `src/lib/localized-text.ts`: zod schema, `createLocalizedText`, `pick` (fallback rule from §6), enum/tag mapping; unit-tested.
- Migration `prisma/migrations/20261017120000_init` was generated with Prisma's own schema engine (wasm build, `diff` from empty to datamodel) because the native binary download is blocked; equivalent to `prisma migrate diff --from-empty --to-schema-datamodel --script`. Re-run `pnpm db:migrate:dev` locally to confirm there is no drift.
- Seed (`pnpm db:seed`, idempotent upserts): settings (Vienna placeholder), `admin@example.com` (`SEED_ADMIN_PASSWORD` required), drivers `fahrer-de`/`driver-hans`/`driver-en`/`driver-sr`/`driver-cs`/`driver-new` (PIN `SEED_DRIVER_PIN`, default 123456), 6 products with names in all 4 locales (Hant entered by hand until OpenCC in NUD-003), 0 customers.
- Integration test creates an isolated schema per run, applies the committed migration SQL and drops it afterwards; it is skipped (not faked) when `DATABASE_URL` is unset. CI `check` job now has a Postgres service and runs `db:migrate && db:seed` (not run, no remote).
- `pnpm db:embedded` (scripts/embedded-postgres.ts) starts a Docker-free local PostgreSQL. `docker-compose.yml` (postgres:16, minio, minio-init creating bucket `nudel-photos`) was written but never started.
- To close the ticket: on a machine with Docker run `cp .env.example .env && docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm test`; if green tick the first criterion and set `done`.
- Environment: pnpm install ran on local disk (`~/work/app`) and sources were synced back; `PRISMA_SCHEMA_ENGINE_BINARY` pointed to a dummy file so `prisma generate` runs without the blocked download.

---

#### NUD-003 · i18n foundation (4 locales, OpenCC build, LocalizedText)
**Status:** done · **depends_on:** 001

**Goal:** every screen can be rendered in `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`.

**Scope**
- next-intl with locale segment `/[locale]/…`. URL tags: `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`.
- Locale resolution order: logged-in user's `locale` → `NEXT_LOCALE` cookie → `Accept-Language` best match (`zh-CN`/`zh-SG`→Hans, `zh-HK`/`zh-MO`→Hant-HK, `zh-TW`→Hant-TW) → `de`.
- `scripts/i18n-build.ts` using `opencc-js`: `zh-Hans.json` → `zh-Hant-HK.json` (config `cn→hk`) and `zh-Hant-TW.json` (config `cn→twp`, with phrase conversion), then deep-merge `messages/overrides/<locale>.json`. Generated files get a header key `"_generated": "DO NOT EDIT"`.
- `scripts/i18n-check.ts`: fails on missing/empty keys in any locale, on ICU syntax errors, and if generated files differ from a fresh build.
- `<LanguageSwitcher>` component showing each language **in its own script**: `Deutsch`, `简体中文`, `繁體中文（香港）`, `繁體中文（台灣）`. Persists to cookie and, if logged in, to `User.locale`.
- `src/lib/localized-text.ts`: zod schema, `pick(text, locale)` with fallback chain (§6), `withDerivedHant(text)` that fills empty Hant variants from `zh-Hans` via OpenCC (and Hans from a Hant variant via `t→cn` if only Hant exists).
- `<html lang>` and font stacks per §4.3.
- Initial `de.json` and `zh-Hans.json` with common keys (actions, units `KG/PACK/CRATE/PIECE`, statuses, problem reasons, errors). Agent-written Chinese is acceptable for now; it will be reviewed in NUD-073.

**Acceptance criteria**
- [x] Visiting `/zh-Hant-TW` renders the placeholder page in Traditional Chinese with `lang="zh-Hant-TW"`.
- [x] `pnpm i18n:check` fails when a key is removed from `zh-Hans.json` (covered by a unit test of the checker).
- [x] Unit tests for `pick` fallback chain and `withDerivedHant` (e.g. `意大利面` → HK/TW Traditional forms).
- [x] Override file wins over OpenCC output (unit test).

**Implementation notes**
- next-intl 4 with `localePrefix: "always"`; `src/i18n/{routing,request,navigation}.ts`; `src/proxy.ts` (Next 16 replacement for middleware) redirects unprefixed paths to `resolveLocale()` (`src/lib/locale-resolution.ts`: user locale -> `NEXT_LOCALE` cookie -> Accept-Language -> `de`) and delegates prefixed paths to the next-intl middleware. The root layout moved to `src/app/[locale]/layout.tsx` (`<html lang={locale}>`, `generateStaticParams`); placeholder page renders via `HomeContent`.
- (Wired in NUD-004.) The logged-in user's locale was not wired into the proxy yet (no sessions): `getSessionUserId()` in `src/server/session.ts` returns `null` until NUD-004, which must feed it into `proxy.ts` and the `setLocaleAction` server action (already updates `User.locale` when a user id is present; unit-tested with injected deps).
- `scripts/lib/i18n.ts` (flatten, `buildHant`, `checkMessages`) + `i18n-build.ts` / `i18n-check.ts`. Check fails on missing/empty keys, invalid ICU (`intl-messageformat`), override keys unknown to zh-Hans, and stale/hand-edited generated files. Generated `messages/zh-Hant-*.json` are committed; run `pnpm i18n:build` after editing `zh-Hans.json` or an override.
- `withDerivedHant` + OpenCC converters in `src/lib/localized-text.ts` / `src/lib/opencc.ts`. Note OpenCC output: HK uses `麪` (`意大利麪`), TW phrase mode gives `義大利麵`; `面` alone is not converted (ambiguous character).
- Per-locale CJK font stacks via `:lang()` in `globals.css`. `<LanguageSwitcher>` is a native `<select>` (48 px high) showing each language in its own script; `messages/overrides/*.json` are empty for now.
- Verified: lint, typecheck, `pnpm test` (31 passed, DB integration tests skipped without `DATABASE_URL`), `i18n:check`, `pnpm build`, and against `next start`: `/zh-Hant-TW` serves `<html lang="zh-Hant-TW">` with Traditional text, `/` redirects by Accept-Language/cookie. Sandbox-only: `@swc/core` (loaded by the next-intl plugin) cannot start here because of a cache-directory ownership check, so those commands were run with `NODE_OPTIONS=--require` of a stub for `@swc/core` (not committed; unaffected on a normal machine). `pnpm-workspace.yaml` got `@parcel/watcher`/`@swc/core` build scripts set to `false`.
- Not verified: Playwright (`tests/e2e/home.spec.ts` updated with a `zh-Hant-TW` test, not executed); the switcher's click flow in a real browser; agent-written Chinese is unreviewed (NUD-073).

---

#### NUD-004 · Authentication & roles
**Status:** blocked (Playwright e2e not executable here, see Implementation notes) · **depends_on:** 002, 003

**Goal:** secure login for admins (email+password) and drivers (username+PIN), role-based access.

**Scope**
- Auth.js v5 with Credentials provider, JWT session. Admin session max age 12 h, driver 90 days (role-dependent `maxAge` in callback).
- Password hashing with argon2 (or bcrypt if argon2 is unavailable on Vercel – log decision).
- Login pages: `/[locale]/login` (admin) and `/[locale]/driver/login` (driver; numeric keypad input for PIN, `inputmode="numeric"`).
- Middleware: `/(admin)` requires `ADMIN`, `/(driver)` requires `DRIVER` (admins may open driver views for support – read-only is fine). Unauthenticated → correct login page with return URL.
- Server-side helper `requireRole(role)` used by every server action / route handler.
- Login rate limiting: max 5 failed attempts per username/IP per 15 min (DB- or memory-backed; document choice).
- After login the user's `locale` is applied (redirect to their locale prefix).

**Acceptance criteria**
- [ ] E2E: admin logs in → lands on admin dashboard; driver logs in → lands on driver home in his locale. (spec `tests/e2e/auth.spec.ts` written and listed by Playwright; NOT executed, no browser. The same flows were verified over HTTP against `next start`, see notes.)
- [x] Driver cannot access any admin route or server action (tests). (`src/lib/access.test.ts`, `resolveActor` tests against real PostgreSQL, live check of the proxy redirect)
- [x] 6th wrong PIN within 15 min is rejected with a localized message. (DB-backed integration test + live check through the real login server action in `de` and `zh-Hans`)
- [x] Inactive users cannot log in. (integration test + live check)

**Implementation notes**
- Auth.js `next-auth@5.0.0-beta.32`, JWT sessions, two Credentials providers: `admin` (email + password) and `driver` (username + 6-digit PIN), both calling `authenticate()` (`src/server/auth/authenticate.ts`: zod, lookup by role, equal-time bcrypt compare, inactive = invalid, rate limit). Hashing stays bcryptjs (cost 12 for new hashes; seed hashes at cost 10 still verify).
- Session lifetime per role: custom `jwt.encode` sets `maxAge` 12 h (ADMIN) / 90 days (DRIVER); the cookie itself lives 90 days but the JWT inside expires per role (verified: exp - iat = 43200 / 7776000). Sessions are absolute (not sliding): the proxy only reads the JWT and never re-issues the cookie (the Auth.js middleware wrapper did, and overwrote the cookie deletion done by logout).
- Rate limiting: DB table `LoginAttempt` (migration `20261017130000_login_attempt`). Failed attempts are recorded per `user:<kind>:<identifier>` (limit 5) and per `ip:<address>` (limit 20) in a 15 min window; the limit check runs before the credentials check, so the 6th attempt is rejected even with the right PIN; a successful login clears the user counter. Concurrent requests can slightly exceed the limit (no locking). IP comes from `x-forwarded-for`/`x-real-ip` (trusted on Vercel; absent locally, then only the user key applies).
- Access: `src/proxy.ts` uses `decideAccess()` (`src/lib/access.ts`): `/admin/**` ADMIN only (driver is redirected to `/driver`), `/driver/**` DRIVER or ADMIN, anonymous users go to `/login` or `/driver/login` with `?callbackUrl=`. Routes: `/[locale]/login`, `/[locale]/driver/login`, `/[locale]/admin` (dashboard placeholder), `/[locale]/driver` (home placeholder). The proxy is only a first line: pages call `requirePageActor()` and every server action / route handler must call `requireRole(...roles)` (`src/server/auth/guards.ts`), which re-reads the user from the DB (role taken from the DB, inactive/unknown users rejected, throws `AuthorizationError` UNAUTHENTICATED/FORBIDDEN; `authErrorStatus()` maps to 401/403). Admins may open `/driver` pages, but driver mutations must use `requireRole("DRIVER")`.
- Locale: after login the action sets `NEXT_LOCALE` and redirects to `/{user locale}{callbackUrl or home}` (callback validated: same-site path, locale re-prefixed, must be allowed for the role). `getSessionUserId()` now returns the session user id; the proxy passes the token locale into `resolveLocale()`; `setLocaleAction` also updates the token via `unstable_update` so the proxy sees the new locale (unit-tested with injected deps, not exercised in a browser).
- Login forms are server-action forms (`useActionState`) with 48 px inputs, numeric keypad (`inputMode="numeric"`) for the PIN, logout via server action. Strings in `auth.*`, `admin.dashboard.*`, `driver.home.*` (de + zh-Hans, Hant generated).
- Env: `AUTH_SECRET` (documented, CI sets it; e2e job now migrates + seeds).
- Verified: lint, typecheck, `pnpm test` (incl. 12 DB-backed auth tests on embedded PostgreSQL 16), i18n:check, `pnpm build`; against `next start` with a seeded DB (python scripted no-JS form posts): anonymous redirects, admin login/dashboard, driver login in `zh-Hant-HK` lands on `/zh-Hant-HK/driver`, driver bounced from admin routes, JWT lifetimes, 5 wrong PINs then localized rate-limit message (de, zh-Hans), inactive driver rejected, logout for admin and driver.
- NOT verified: Playwright e2e (no browser, same limitation as NUD-001), 375 px / 1280 px layout check, the language switcher updating the session locale in a browser, CI run. To close: run `pnpm exec playwright install chromium && pnpm test:e2e` against a seeded DB (needs `SEED_ADMIN_PASSWORD`, `AUTH_SECRET`); if green tick the first criterion and set `done`.

---

#### NUD-005 · App shells & UI kit (admin + driver)
**Status:** done · **depends_on:** 003, 004

**Goal:** consistent layouts and base components so feature tickets only build content.

**Scope**
- shadcn/ui init with the components we'll need (button, input, select, combobox/command, dialog, sheet, table, badge, toast/sonner, tabs, calendar/date-picker, form, skeleton, alert).
- **Admin layout:** sidebar (Dashboard, Bestellungen, Touren, Kunden, Produkte, Fahrer, Einstellungen), header with language switcher + user menu. Placeholder pages for each nav item.
- **Driver layout:** mobile-first, full-height, top bar (date, language switcher icon, connection indicator placeholder), large content area, no sidebar. Placeholder "Heute" page.
- Shared states: `<EmptyState>`, `<ErrorState>`, `<LoadingSkeleton>`, global error boundary, localized 404.
- Date/number formatting helpers via next-intl formatters (respect locale).

**Acceptance criteria**
- [x] All placeholder pages render in all 4 locales without missing-key warnings. (Vitest renders every placeholder + both shells in 4 locales with a throwing `onError`/`getMessageFallback`; Playwright visits every admin page in 4 locales and fails on any console error; `next start` log has 0 missing-message entries.)
- [x] Driver layout passes a Playwright mobile screenshot check (no horizontal scroll at 375 px). (`tests/e2e/shells.spec.ts`, 4 locales at 375x812, asserts `scrollWidth <= clientWidth`, >= 48 px touch targets, attaches a screenshot; passed in both Playwright projects, see notes for how the browser was provided.)
- [x] Admin nav highlights the active section. (`aria-current="page"` + marker bar; unit test for the matcher, Playwright test clicking through all sections on desktop and in the mobile slide-over.)

**Implementation notes**
- shadcn/ui: the CLI registry is not reachable from the sandbox, so the components were written by hand in shadcn "new-york" style (`components.json` is committed, so `pnpm dlx shadcn add ...` works later): button, input, label, select, command, combobox (popover + command), popover, dialog, sheet, dropdown-menu, table, badge, sonner (toaster mounted in the locale layout), tabs, calendar + date-picker (react-day-picker with `de`/`zhCN`/`zhHK`/`zhTW`), form (react-hook-form), skeleton, alert. Radix via the `radix-ui` umbrella package. Design tokens (shadcn names, light + `prefers-color-scheme` dark, AA contrast) live in `globals.css`; border-colour default is in `@layer base` so utilities still win. Button sizes `lg`/`icon-lg` = 48 px for the driver app. Strings inside kit components (dialog/sheet close label) use `common.actions.close`; callers pass already translated texts into `Combobox`/`DatePicker`.
- Admin: `admin/layout.tsx` (role gate + `AdminShell`: sidebar Übersicht/Bestellungen/Touren/Kunden/Produkte/Fahrer/Einstellungen, header with compact language switcher and user menu incl. logout, slide-over navigation below `md`, skip link) and placeholder pages `/admin/{orders,tours,customers,products,drivers,settings}` (each re-checks the role via `requirePageActor`, since layouts are not re-run on client navigation). The dashboard moved its switcher/logout into the header.
- Driver: pages moved into the route group `driver/(app)/` (URLs unchanged) so only they get `DriverShell` (sticky top bar: factory-time-zone date, connection indicator = browser online state only, 48 px language icon picker) while `driver/login` stays shell-less. "Heute" shows an empty state until NUD-051.
- Shared: `EmptyState`/`ErrorState`/`LoadingSkeleton` (`components/shared/states.tsx`), `[locale]/error.tsx` (error boundary with retry), `[locale]/not-found.tsx` + `[locale]/[...rest]/page.tsx` (localized 404 inside the locale layout), `LanguageSwitcher` got `variant` (`labeled` | `compact` | `icon`). Formatting: `createAppFormatters(formatter, timeZone)` in `src/lib/format.ts` (quantity without trailing zeros, short/long date, date-time, time in factory time zone, `calendarDate` for DATE columns in UTC); `getFactoryTimezone()` reads `Settings.timezone`.
- Verified: lint (0 warnings), typecheck, `pnpm test` (71 passed, DB integration tests skipped without `DATABASE_URL`), `i18n:check`, `pnpm build`; against `next start` + embedded PostgreSQL: scripted HTTP checks of all pages in 4 locales (active nav, 404s, guards) and the **full Playwright suite (23 tests per project, desktop + mobile, all specs incl. NUD-001/003/004 ones) passed** with a real headless Chromium. Screenshots were inspected at 1280 px (admin) and 375 px (driver, mobile admin menu).
- Environment trick (not committed): Playwright's own browser download is blocked, but the npm package `@sparticuz/chromium` ships a Chromium binary; a throw-away Playwright config pointing `launchOptions.executablePath` at it (args without `--single-process`, `--workers=2`) runs the suite. This also makes the open NUD-001/NUD-004 e2e criteria verifiable (they were not changed here). While doing so, the NUD-004 spec "6th wrong PIN" turned out to be racy (React resets the form after each server-action submit; the old loop read the previous attempt's message) and was fixed to wait for each POST response.
- Not verified: CI run (no remote); real mobile devices/Safari (only Chromium: Desktop 1280x800, Pixel 7 profile, and 375x812 viewport); the unreviewed agent-written Chinese strings (NUD-073).
- Known quirks: (1) unknown URLs render the localized 404 but stream with HTTP 200 (a `notFound()` in a prerendered catch-all shell produced an unlocalized bare 404, so the catch-all decides at request time behind `connection()`); fine for a login-protected app, noted in the decision log. (2) `next start` logs `crypto.getRandomValues() while prerendering` for admin/driver routes: caused by Auth.js `auth()` during Next's partial-prefetch validation, reproduced on the NUD-004 commit, so not introduced here (new ticket NUD-097).

---

#### NUD-006 · Object storage & image upload pipeline
**Status:** blocked (not verified against real MinIO/R2: no Docker and no MinIO binary reachable here, see Implementation notes) · **depends_on:** 002

**Goal:** reusable, secure image upload for customer photos and order screenshots.

**Scope**
- `Storage` interface (`createUploadUrl`, `getReadUrl`, `delete`) with S3 implementation (`@aws-sdk/client-s3`, works with MinIO and R2) and an in-memory/fs Fake for tests.
- Route handler `POST /api/uploads` → validates role, content type (`image/jpeg|png|webp|heic`), max 15 MB → returns presigned PUT URL + `storageKey`.
- Client util `uploadImage(file)`: client-side resize to max 1600 px long edge, re-encode JPEG/WebP quality ~0.8, convert HEIC if needed (or reject with a clear message – log decision), upload with progress.
- Private bucket; reads via short-lived signed URLs (e.g. 1 h) generated server-side.
- `<ImageUploader>` component (drop zone + file picker + **clipboard paste**), `<ImagePreview>` with fullscreen zoom (pinch-zoom on mobile).

**Acceptance criteria**
- [x] Upload of a 6000×4000 JPEG results in a stored image ≤ 1600 px and < 600 KB. (Real headless Chromium -> `/api/uploads` -> presigned PUT -> S3-compatible server: synthetic 4.25 MB 6000×4000 JPEG became 1600×1067, 113 KB; verified on the stored object.)
- [x] Unauthenticated upload request → 401. Wrong content type → 400. (Vitest + Playwright, desktop and mobile.)
- [ ] Works against local MinIO in dev and the Fake in tests. (Fake: tested. MinIO/R2: not available here; verified against the npm `s3rver` S3 emulator only, see notes.)


**Implementation notes**
- Server: `Storage` interface (`src/server/storage/types.ts`: `createUploadUrl`, `getReadUrl` (default 1 h), `delete`), `S3Storage` (`@aws-sdk/client-s3` + `s3-request-presigner`; MinIO/R2; path-style when `S3_ENDPOINT` is set; presigned PUT signs `content-type` and `content-length`; CRC32 checksums disabled so browsers need no extra headers), `FakeStorage` (in-memory), `getStorage()` (env `S3_*`; Fake + warning when unset in dev/test; throws in production). `POST /api/uploads` (`src/server/uploads.ts` + thin `src/app/api/uploads/route.ts`): body `{ purpose: "customer-photo" | "screenshot", contentType, size }` -> `{ storageKey, uploadUrl, method, headers, expiresAt }`. The key is always server-generated (`customers/<uuid>.<ext>`, `screenshots/<uuid>.<ext>`). Status codes: 401 unauthenticated/inactive, 403 wrong role, 400 bad body or content type, 413 > 15 MB. Roles: `customer-photo` ADMIN + DRIVER (drivers take photos in NUD-083), `screenshot` ADMIN only. `authErrorStatus` moved to `auth/actor.ts` (still re-exported from `guards.ts`) so the handler is testable without Auth.js.
- Client: `uploadImage(file, { purpose, onProgress, signal })` in `src/lib/upload-image.ts` (decode with EXIF orientation -> max 1600 px -> JPEG q 0.8 (also strips EXIF/GPS) -> grant -> XHR PUT with progress); typed `UploadError` codes with localized messages (`common.upload.errors.*`). `<ImageUploader>` (drop zone, file picker, optional camera button, paste on the focused zone or `pasteAnywhere`) and `<ImagePreview>` (thumbnail -> fullscreen dialog, wheel / pinch / double-tap zoom, drag to pan, +/-/reset buttons, `src/lib/zoom.ts`) in `src/components/shared/`. Nothing uses them yet (NUD-015, NUD-031, NUD-083).
- Env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `.env.example` (MinIO defaults matching `docker-compose.yml`) and `docs/env.md` (incl. the R2 CORS rule the browser PUT needs).
- Verified: lint, typecheck, `pnpm test` (118 passed incl. DB tests), `i18n:build/check`, `pnpm build`, full Playwright suite (52 passed, desktop + mobile) incl. new `tests/e2e/uploads.spec.ts` (401 anonymous, 200 admin, 400 PDF, driver 403 for screenshot / 200 for photo). Browser pipeline and `S3Storage` roundtrip (signed PUT, signed GET, expired GET -> 403, delete -> 404, double delete) were run against the `s3rver` emulator (throw-away script, not committed).
- NOT verified: real MinIO / Cloudflare R2. `s3rver` does not enforce signatures on PUT or privacy on anonymous GET, so enforcement of the signed `content-type`/`content-length` and the private bucket is unproven (presigned URL contents are asserted offline in unit tests). Also not verified: browser CORS against R2, `<ImageUploader>`/`<ImagePreview>` in a real browser (jsdom tests only; pinch gestures untested), Safari/HEIC decoding, a real camera photo (the 6000×4000 test image was synthetic). To close: `cp .env.example .env && docker compose up -d`, then `pnpm dev`, upload a real photo through a page that uses `<ImageUploader>` (NUD-015) or run `pnpm test:e2e`; check the object in the MinIO console and that anonymous GET of the object URL is denied; if green tick the last criterion and set `done`.

---

#### NUD-007 · 👤 Deployment pipeline (Vercel / Neon / R2)
**Status:** blocked (human must create the Vercel, Neon and Cloudflare accounts and enter the keys, see Human steps) · **depends_on:** 002, 004

**Goal:** every push to `main` deploys to production, every PR gets a preview.

**Scope**
- `docs/deploy.md` with exact click-by-click steps for the human: create Vercel project (region `fra1`), Neon project (EU, Frankfurt), R2 bucket (EU jurisdiction) + API token, set env vars.
- Build step runs `prisma migrate deploy`.
- `GET /api/health` returns DB + storage reachability (no secrets).
- Preview deployments use a Neon branch per PR if feasible; otherwise a shared staging DB (log decision).

**👤 Human steps:** create the three accounts, paste keys into Vercel. Agent: prepare everything else, then set `blocked` until keys exist.

**Acceptance criteria**
- [ ] Production URL serves the app; `/api/health` is green.
- [ ] Seed admin can log in on production (seed run once manually, documented).

**Implementation notes**
- `docs/deploy.md`: click-by-click guide (GitHub repo, Neon EU Frankfurt, R2 bucket in EU jurisdiction + scoped API token + CORS JSON, Vercel project in `fra1`, env var table per Vercel environment, first deploy, one-time production seed, preview strategy, verification, troubleshooting). Console menu names were written from memory and may differ slightly; nothing was verified against the real services.
- `vercel.json`: framework, region `fra1`, install `pnpm install --frozen-lockfile`, build `pnpm build:vercel`. `build:vercel` = `tsx scripts/check-deploy-env.ts && prisma migrate deploy && next build`. The env check (`scripts/lib/deploy-env.ts`, unit-tested) runs only when `VERCEL_ENV` is set, lists missing/placeholder/localhost values without echoing them and requires `DATABASE_URL_UNPOOLED` when `DATABASE_URL` is a Neon `-pooler` URL. `prisma.config.ts` prefers `DATABASE_URL_UNPOOLED` (migrations need a direct connection), the app uses `DATABASE_URL`.
- `GET /api/health` (`src/server/health.ts`, route uses `connection()` so it is never prerendered): `SELECT 1` and `Storage.checkReachable()` (new interface method; S3 = `ListObjectsV2` with `MaxKeys: 1`, needs only the bucket-scoped object read/write token; Fake = no-op, reported as `skipped`). 4 s timeout per check, 200/503, `Cache-Control: no-store`, body has statuses, latencies, short git SHA and region only (no hostnames or error messages; tested). Public on purpose (the proxy matcher already excludes `/api`).
- Seed: new optional `SEED_ADMIN_EMAIL` (default `admin@example.com`) and `SEED_DRIVERS=false` (skips the 4 demo drivers, which share the PIN 123456, on production). Both documented in `.env.example`, `docs/env.md`, `docs/deploy.md`.
- Verified: lint, typecheck, `pnpm test` (133 passed), `i18n:check`, `pnpm build` (`/api/health` is dynamic). Live against `next start` + embedded PostgreSQL + the `s3rver` emulator: health 200 (db ok, storage ok); 503 without S3 config; 503 with a wrong bucket; 503 with the database down; seed with `SEED_DRIVERS=false SEED_ADMIN_EMAIL=...` creates only the one admin. `check-deploy-env` fails correctly on a localhost URL / missing variables.
- NOT verified: anything against real Vercel, Neon or R2 (no accounts, by design); `prisma migrate deploy` itself (native schema engine unavailable here, see NUD-002); `ListObjectsV2` with a real R2 bucket-scoped token; R2 CORS rule; Vercel build with `pnpm build:vercel`.

**Human steps** (details and exact clicks in `docs/deploy.md`)
1. Create a private GitHub repo and push `main` (section 1); confirm CI is green (also closes open checks of NUD-001/004).
2. Neon: create project in AWS Europe (Frankfurt), copy pooled + direct URLs for `main`; create branch `staging` and copy its two URLs (section 2).
3. Cloudflare R2: buckets `nudel-photos` and `nudel-photos-staging` in the EU jurisdiction (private), bucket-scoped Object Read & Write API tokens, CORS rule, note the Account ID (section 3).
4. Vercel: Pro plan (Hobby is non-commercial), import the repo, check region `fra1`, Node 22, enter the env vars for Production and Preview (sections 4 and 5), deploy.
5. Run the production seed once from your computer with `SEED_DRIVERS=false` and your real admin email (section 7).
6. Verify `/api/health` is green with `region: fra1` and the admin can log in (section 9), then tell the agent the production URL; tick the two criteria above and set `done`.

---

#### NUD-008 · Admin user management (drivers)
**Status:** done · **depends_on:** 005

**Goal:** office creates and manages driver accounts without developer help.

**Scope**
- `/admin/drivers`: list (name, username, language, active, last login).
- Create driver: display name, username, preferred locale (dropdown in own scripts), auto-generated 6-digit PIN shown **once** with a "print/copy" view.
- Reset PIN, deactivate/reactivate, change locale.
- Admins can also create further admin accounts (email + password).

**Acceptance criteria**
- [x] Newly created driver can log in with the shown PIN on a phone. (Playwright: PIN read from the one-time dialog, then login in a 375x812 context lands on the driver home in the driver's locale; no real phone, see notes.)
- [x] Reset PIN invalidates the old PIN immediately. (integration test + Playwright)
- [x] Deactivated driver's next request is logged out. (integration test of the server-side check + Playwright: after deactivation the driver's existing session is sent to the login page, the session cookie is removed, no redirect loop)

---

**Implementation notes**
- Page `/admin/drivers` (`UsersManager`, client component, UI kit only): driver table (name, username, language, status badge with icon, last login in the factory time zone, actions), create-driver dialog (display name, username, language `<select>` with each language in its own script), one-time PIN dialog (large PIN, copy, print via `@media print` rules in `globals.css`, nothing stored: the PIN only lives in client state until the dialog is closed), reset PIN and deactivate with confirm dialogs, reactivate, inline language change. Second section "Administratoren": list, create admin (email + password >= 10 chars), deactivate/reactivate others (not oneself).
- Server: `src/server/users.ts` (zod-validated services taking an injected db, returning `{ ok } | { ok:false, error }`) and `src/server/user-actions.ts` (`"use server"`; every action starts with `requireRole("ADMIN")`, so drivers, anonymous callers and deactivated admins get an `AuthorizationError` before any input is read). PINs: `crypto.randomInt`, 6 digits with leading zeros, bcrypt hash only. Username normalised to lowercase (`^[a-z0-9][a-z0-9._-]{2,31}$`), uniqueness checked case-insensitively (login matches case-insensitively); email lowercased. Resetting a PIN also clears the driver's login rate-limit counter. An admin cannot deactivate himself (`self` error).
- Migration `20261017140000_user_last_login` adds `User.lastLoginAt`, set by `authenticate()` on every successful login (list column "last login").
- Deactivation enforcement: `requireRole` already re-read `active` from the DB (NUD-004), but page-level rejection redirected to the login page while the JWT cookie stayed valid, so the proxy bounced the user straight back (redirect loop). `requirePageActor` now redirects UNAUTHENTICATED to the new route handler `GET /api/session-ended?locale=&section=` which deletes the Auth.js session cookie and redirects to the matching login page (locale/section validated, no open redirect; `sessionEndedTarget` is unit-tested). Server actions and route handlers of a deactivated user were already rejected (401 / `AuthorizationError`).
- Tests: `users.integration.test.ts` (create/login with shown PIN, duplicates, validation, reset invalidates old PIN, deactivation + `resolveActor`, locale change, admin creation, list has no secrets), `user-actions.integration.test.ts` (authorization: every action rejects anonymous, driver and deactivated-admin callers, data unchanged), `session-ended.test.ts`, e2e `tests/e2e/drivers.spec.ts` (desktop + mobile).
- Verified: lint, typecheck, `pnpm test` (157 passed incl. DB tests on embedded PostgreSQL 16), `i18n:build/check`, `pnpm build`, seed on a fresh DB (e2e script), full Playwright suite via the Chromium workaround (drivers, auth, home, shells; `uploads.spec.ts` needs `S3_*` set under `next start`, run with dummy values: passed). `shells.spec.ts` "all placeholder pages ... in de" (desktop) timed out once under load and passed on rerun.
- NOT verified: a real phone / Safari; the print output (only the CSS exists, `window.print()` not exercised); the clipboard button in a browser; layout was not inspected as a screenshot (only the no-horizontal-scroll assertion, 1280 px desktop and Pixel 7 projects); agent-written Chinese strings are unreviewed (NUD-073); CI.
- Follow-up ideas (no ticket): the driver's own session is only ended on his next page/action request, not pushed; no audit log of PIN resets until NUD-092.

### M1 — MVP (demo end-to-end)

---

#### NUD-010 · Geocoder interface + ORS + Fake
**Status:** done · **depends_on:** 002

**Goal:** turn an address into candidate coordinates.

**Scope**
- `Geocoder` interface: `search(address): Promise<GeocodeCandidate[]>` (label, lat, lng, confidence) and `reverse(lat,lng)` (for pin drag feedback).
- ORS implementation (`/geocode/search`, `boundary.country` from settings, default `AT,DE`), timeout 5 s, retries 1.
- Fake implementation: deterministic coordinates around Vienna derived from a hash of the address (used in tests and if `ORS_API_KEY` is missing).
- Simple cache table or in-memory LRU to avoid repeated calls for the same normalized address.

**Acceptance criteria**
- [x] Unit tests for the Fake and for response mapping of the ORS client (recorded fixture, no live network in CI). (`src/server/geocoder/geocoder.test.ts`, 20 tests; fixtures are hand-written in the documented ORS/Pelias GeoJSON format, not recorded from a live call, see notes.)
- [x] Missing API key → Fake is used and a single warning is logged. (tested via `getGeocoder`.)

**Implementation notes**
- `src/server/geocoder/`: `types.ts` (`Geocoder { search(address), reverse(lat,lng) }`, `GeocodeCandidate {label,lat,lng,confidence}`, `GeocoderError` with codes `TIMEOUT|NETWORK|HTTP|BAD_RESPONSE|INVALID_INPUT`, `normalizeAddress`), `ors.ts` (`OrsGeocoder` + `mapOrsResponse`, zod-checked), `fake.ts` (`FakeGeocoder`), `cache.ts` (`LruCache`, `CachingGeocoder`), `index.ts` (`getGeocoder(env)` singleton, `setGeocoderForTests`). `search` returns up to 5 candidates best first (`[]` when nothing found or the address is blank); `reverse` returns the nearest address or `null`. Errors are thrown as `GeocoderError` so the UI tickets (NUD-014) can show "geocoding unavailable, place the pin by hand".
- ORS: `GET /geocode/search?text&boundary.country&size=5` and `/geocode/reverse?point.lat&point.lon&size=1`, 5 s timeout (`AbortSignal.timeout`), 1 retry on timeout, network error, 5xx and 429 (never on other 4xx or malformed bodies). The API key goes in the `Authorization` header so it cannot leak through URLs/logs. Addresses are limited to 300 characters.
- Fake: FNV-1a hash of the normalized address -> point within about +-0.08 deg lat / +-0.12 deg lng of Vienna, one candidate, confidence 0.3 (deliberately low). Used when `ORS_API_KEY` is missing; one `console.warn` per process.
- Cache: in-memory LRU (500 entries) for search (normalized address) and reverse (rounded to 5 decimals), failures are not cached, results are copied so callers cannot mutate the cache. The ticket allowed "table or in-memory"; per-instance memory is enough for 50-150 customers.
- New env vars: `ORS_API_KEY` (shared with NUD-040), `ORS_GEOCODE_COUNTRIES` in `.env.example` and `docs/env.md`. No UI, route or mutation, so no authorization tests or i18n strings were needed; nothing calls the geocoder yet (NUD-014 will, through a server action with `requireRole("ADMIN")`).
- Verified: lint, typecheck, `pnpm test` (177 passed incl. DB tests on embedded PostgreSQL), `i18n:check`, prettier. No schema change, so the seed is unaffected.
- NOT verified: a live call to OpenRouteService (no real key, by instruction). The fixtures follow the documented Pelias/ORS response shape from memory of the API docs; the real endpoint may return extra fields (ignored) or differ in details, e.g. `boundary.country` accepting alpha-2 codes, `confidence` presence on every feature (missing -> 0). Please run one real `search` once a key exists and compare with `src/server/geocoder/fixtures/`.

---

#### NUD-011 · Map component with draggable pin
**Status:** done · **depends_on:** 005

**Goal:** reusable map building blocks for customers, depot and tours.

**Scope**
- react-leaflet loaded client-side only (`dynamic(..., { ssr:false })`).
- Tile URL + attribution from env (`MAP_TILE_URL`), default OSM tiles **for dev only**; document in `docs/env.md` that production needs a provider with a usage plan (e.g. MapTiler / Stadia free tier).
- `<PinPickerMap value onChange>`: single draggable marker, click-to-place, "locate address" button.
- `<TourMap stops depot geometry>`: numbered markers (1…n), depot marker, polyline; fit bounds.

**Acceptance criteria**
- [x] Storybook-like demo page (`/admin/dev/maps`, admin-only, hidden from nav) shows both components.
- [x] Dragging the pin calls `onChange` with rounded coordinates (6 decimals).

**Implementation notes**
- Added `leaflet` 1.9.4, `react-leaflet` 5.0.0, `@types/leaflet`. Components in `src/components/maps/`: `PinPickerMap` (click-to-place, draggable marker, optional "locate address" button that calls an injected `onLocate`), `TourMap` (numbered stop markers, depot marker, polyline, fit bounds), `lazy.tsx` (`PinPickerMapLazy` / `TourMapLazy` via `dynamic(..., { ssr: false })`), CSS-only `divIcon` markers (no PNG icon assets), `MapsDemo`.
- `src/lib/coords.ts` (`roundLatLng`, 6 decimals) and `src/lib/map-config.ts` (`getMapTileConfig`: `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION`, OSM default for dev only). Tile config is read on the server and passed as props. Env documented in `.env.example` and `docs/env.md` (production needs MapTiler/Stadia or similar).
- `geocodeAddressAction` (`src/server/geocode-actions.ts`, admin-only server action, zod-validated, uses `getGeocoder()`); authorization test `geocode-actions.integration.test.ts` (anonymous/driver rejected).
- Dev page `/[locale]/admin/dev/maps`: behind proxy + admin layout + `requirePageActor`, not in the nav, strings in `admin.maps` / `admin.devMaps` (de, zh-Hans, Hant generated).
- `TourMap.geometry` takes GeoJSON LineString coordinates (`[lng, lat][]`); without geometry no line is drawn (nothing is faked). The demo uses fixed sample points around Vienna labelled as sample data.
- Verified: lint, typecheck, `pnpm test` (185 tests incl. DB integration via embedded Postgres), `pnpm build`, `i18n:check`, e2e `tests/e2e/maps.spec.ts` (desktop + mobile; tiles stubbed via `page.route`, so no live tile server needed): click-to-place, drag, locate (Fake geocoder), numbered markers, depot, polyline, no horizontal scroll, anonymous redirect, not in nav. Screenshot at 1280 px checked. Other e2e specs shells/home/auth pass (one shells test timed out once under load and passed on rerun); drivers/uploads specs were not rerun (untouched code).
- NOT verified: real tiles from OSM or a production provider (sandbox blocks tile servers; layout/attribution seen only with stubbed tiles) and a real ORS "locate address" call. The pin has no keyboard alternative yet (map click/drag only); NUD-014 should add editable lat/lng inputs next to the picker.

---

#### NUD-012 · Depot & general settings page
**Status:** done · **depends_on:** 010, 011

**Goal:** office configures where tours start/end and basic planning parameters.

**Scope**
- `/admin/settings`: depot name + address (geocode → confirm pin), time zone (select, default `Europe/Vienna`), default departure time, service minutes per stop, delivery weekdays (checkboxes).
- Settings are cached server-side and invalidated on save.

**Acceptance criteria**
- [x] Tour building (NUD-041) refuses to run with a clear message if the depot pin is not set. (Settings-side guard done and tested: `requireDepot` / `requireDepotConfigured()` throw `DepotNotSetError` (`code: "DEPOT_NOT_SET"`), message key `admin.settings.errors.depotNotSet`. NUD-041 calls it first and returns `error: "depot_not_set"` without writing anything (tested); the message itself is shown by the NUD-042 UI, which does not exist yet.)
- [x] Changing delivery weekdays changes the default delivery date in order entry (unit-tested helper `nextDeliveryDate(now, settings)`). (Helper + `getDefaultDeliveryDate()` tested; the order-entry form itself is NUD-030 and must call `getDefaultDeliveryDate()`.)

**Implementation notes**
- `/admin/settings` (replaces the placeholder): depot name + address, pin picker (`PinPickerMapLazy` with the admin-only "locate address" action), **editable lat/lng inputs** (`src/components/maps/lat-lng-inputs.tsx`, reusable by NUD-014; keyboard alternative promised in NUD-011), a "pin checked" checkbox that is withdrawn whenever the pin or address changes, time zone (native select, options computed on the server), departure time, service minutes (0-180), delivery weekdays (checkboxes, localized day names via `Intl`).
- Data: new column `Settings.depotPinConfirmed` (migration `20261017150000_settings_depot_pin_confirmed`, default false; written by hand, `prisma generate` run with the dummy schema engine). The seed's placeholder depot stays unconfirmed, so tour building is blocked until an admin saves the page. Saving requires `depotPinConfirmed: true` (D9).
- `src/domain/settings.ts` (pure): `nextDeliveryDate(now, {timezone, deliveryWeekdays})`, `getDepot`, `requireDepot`, `DepotNotSetError`. `src/server/settings.ts`: `settingsInputSchema` (zod), `readSettings`/`saveSettings`, `getSettings()` (`'use cache'` + `cacheTag("settings")`, `cacheLife("hours")`), `getFactoryTimezone()` now uses it, `requireDepotConfigured()` (for NUD-041), `getDefaultDeliveryDate()` (for NUD-030). `saveSettingsAction` (`settings-actions.ts`): `requireRole("ADMIN")`, zod, then `updateTag("settings")` so the next read is fresh.
- Tests: `src/domain/settings.test.ts` (weekday/time-zone/DST cases, depot guard), `settings-actions.integration.test.ts` (anonymous / driver / deactivated admin rejected, normalization, 12 invalid-input cases, cache tag), `lat-lng-inputs.test.tsx`, seed assertion in `db.integration.test.ts`, e2e `tests/e2e/settings.spec.ts` (desktop + mobile: typed coordinates, confirmation required, persistence after reload, no horizontal scroll, anonymous redirect). `shells.spec.ts` now stubs tiles and has a longer timeout for the all-sections test because the settings page contains a map.
- `ORS_GEOCODE_COUNTRIES` stays an env var (moving it would need another column + UI; not trivial enough). No new env vars.
- Verified: lint, typecheck, `pnpm test` (216 passed before the last small test edit; the three touched files re-run green), `i18n:check`, prettier, `pnpm build`, e2e settings/shells/maps/home/auth/drivers specs (uploads spec not rerun, code untouched).
- NOT verified: the real invalidation of the Next data cache across several Vercel instances (only the `updateTag` call is tested with a mock; locally the page shows the new values immediately after save, see e2e); tiles and ORS geocoding are not real here (stubbed tiles, Fake geocoder).

---

#### NUD-013 · Customer list & search
**Status:** done · **depends_on:** 005

**Goal:** office finds any customer in seconds.

**Scope**
- `/admin/customers`: table with customer number, name, city, flags (⚠ photos missing, ⚠ pin unconfirmed, archived).
- Search (number, name, street, city; accent-insensitive), filters for the flags, pagination or virtual scroll.
- "New customer" button → NUD-014 form.

**Acceptance criteria**
- [x] Search for part of a name returns matches in < 300 ms with 500 seeded customers. (Integration test on embedded PostgreSQL 16: slowest of six queries ~5 ms; this measures the DB query, not the browser round trip.)
- [x] Filter "photos missing" shows exactly the customers lacking a current STORE or PARKING photo. (Integration test covers none / store only / parking only / both / replaced (non-current) photos / mixed.)

**Implementation notes**
- `/admin/customers`: server-rendered list (`customer-queries.ts` -> `customers.ts`), URL-driven state (`q`, `status=active|archived|all`, `photos=missing`, `pin=unconfirmed`, `page`; parsing in `src/lib/customer-list-params.ts`). Client `CustomerFilters` (search box debounced 200 ms, two checkboxes, status select) and server-rendered `CustomersTable` (number, name + street, postal code + city, flag badges with icons: photos missing / pin unconfirmed / archived; count; 25 per page with previous/next; empty and "no match" states with reset). Archived customers are hidden by default (status filter "Aktive"). Rows are not linked yet: the detail/edit page is NUD-014.
- Accent-insensitive search: migration `20261017160000_customer_search_text` adds SQL function `nudel_fold(text)` (lower-case, `translate` of ~100 Latin diacritics, ss/ae/oe) and `Customer.searchText`, maintained by a BEFORE INSERT/UPDATE trigger from number, name, street, postal code and city. The list query folds each search term with the same SQL function and does `searchText LIKE '%term%'` (all terms must match; `% _ \` escaped). No extension, so it works on Neon and in the embedded Postgres, and every writer (app, seed, NUD-090 import) gets the column for free. `searchText` is never written by app code. CJK text is matched as is (lower-casing only).
- Query is one parameterised raw SQL (`$queryRaw` with `Prisma.sql`) plus a count query. Photo-missing flag is computed in SQL (`NOT (EXISTS current STORE AND EXISTS current PARKING)`).
- Authorization: `listCustomersQuery` calls `requireRole("ADMIN")` before the query; the page also calls `requirePageActor`. Test: `customer-queries.integration.test.ts` (anonymous, driver, deactivated admin rejected, admin allowed).
- `createPrismaClient(url, schema)` now also sets `search_path` to the test schema (raw SQL and triggers use unqualified names; the adapter only qualifies generated model queries).
- Test seeding helper (not part of `db:seed`): `src/server/testing/seed-customers.ts` (`seedTestCustomers`), CLI `pnpm db:seed:customers [count]` (default 500, numbers `T-0001`..., accents/umlauts, mixed pin/photo/archived states).
- "New customer" links to `/admin/customers/new`, for which a **placeholder page** (title + "coming soon" + back link) was created so there is no 404; NUD-014 replaces it.
- Tests: `customers.integration.test.ts` (accents, case, ß, Chinese, AND of terms, LIKE wildcards/injection, trigger on update, status/photo/pin filters, pagination, 500-customer timing), `customer-queries.integration.test.ts`, `customer-list-params.test.ts`, e2e `tests/e2e/customers.spec.ts` (desktop + mobile: accent search, photo and pin filters, empty state + reset, no horizontal scroll, new-customer link; inserts and removes its own rows through `pg`).
- Verified: lint, typecheck, `pnpm test` (233 passed incl. DB tests), `i18n:check`, prettier, `pnpm build`, e2e customers (desktop + mobile), shells "all placeholder pages" in 4 locales (desktop), home (mobile).
- NOT verified: the full shells/settings/drivers e2e suites were not rerun (a combined run exceeded the sandbox call time limit; code untouched except the customers page); `prisma migrate deploy` on Neon (migration applied with plain SQL on embedded Postgres 16); real browser round-trip latency; layout not inspected as a screenshot (only the no-horizontal-scroll assertion); agent-written Chinese strings unreviewed (NUD-073).

---

#### NUD-014 · Customer create/edit with pin confirmation
**Status:** done · **depends_on:** 010, 011, 013

**Goal:** complete customer master data, with a pin the office has verified.

**Scope**
- Form fields per projektbeschreibung §2: name*, customer number* (unique; suggest next free number), street*, postal code*, city*, country, delivery hours info (free text), notes for driver (German textarea for now; multilingual editor in NUD-071).
- "Find on map" → geocoder candidates list → choose one → pin shown → admin may drag → **"Pin confirmed" checkbox required** to set `pinConfirmed=true`. Changing the address resets `pinConfirmed`.
- Archive / reactivate.
- Customer detail page summarising data, photos (placeholder until NUD-015), upcoming orders.

**Acceptance criteria**
- [x] Customer cannot be saved with a duplicate customer number (validation message, localized).
- [x] Editing the street sets `pinConfirmed=false` and shows the ⚠ flag.
- [x] E2E: create customer with confirmed pin, find it via search.

**Implementation notes**
- Pages: `/admin/customers/new` (replaces the placeholder), `/admin/customers/[id]` (detail: address, hours, driver note, pin state + coordinates, photo status + placeholder for NUD-015, upcoming orders, edit and archive/restore with confirmation dialog), `/admin/customers/[id]/edit`. List rows now link to the detail page. Form `src/components/admin/customer-form.tsx`: "find on map" calls `geocodeAddressAction`, shows a candidate list (low confidence flagged), choosing one sets the pin; pin can also be clicked/dragged or typed with `LatLngInputs`; "pin checked" checkbox required for `pinConfirmed`. `PinPickerMap` got an optional `focus` prop so the map centres on a chosen candidate.
- Pin rule (pure, `src/domain/customer.ts`, used by form and server): confirmation needs a pin; once the address (street, postal code, city, country) of an existing customer changed, the pin must also have been moved/searched again, otherwise `pinConfirmed` is stored as false. The form withdraws the checkbox on every address/pin edit.
- Server: `src/server/customer-admin.ts` (zod `customerInputSchema`, `createCustomer`, `updateCustomer`, `setCustomerActive`, `nextCustomerNumber`, `getCustomerDetail`, `listUpcomingOrders`), actions in `customer-actions.ts` and reads in `customer-queries.ts`, all starting with `requireRole("ADMIN")`. Duplicate numbers (case-insensitive, also DB unique race via P2002) return `number_taken`, shown as a localized field error. No hard delete.
- Upcoming orders query real `Order` rows (today or later in the factory time zone, not cancelled, with items); empty until NUD-030 creates orders.
- Tests: `domain/customer.test.ts`, `customer-actions.integration.test.ts` (anonymous/driver/deactivated admin rejected on all 3 actions and 3 reads, validation table, duplicate numbers, pin reset rules, notes, archive, upcoming orders incl. time-zone day), e2e `tests/e2e/customer-form.spec.ts` (desktop + mobile: create with confirmed pin via candidate, find via search, duplicate number, street edit resets pin and shows flag, re-confirm after moving pin, archive/restore, no horizontal scroll, anonymous redirect). Verified: lint, typecheck, `pnpm test` (278 passed), i18n:check, build, e2e customer-form/customers/settings/maps; form and detail screenshots at 375 px inspected.
- NOT verified: real ORS geocoding (Fake geocoder used), real map tiles, agent-written Chinese strings (NUD-073), full shells/drivers e2e suites not rerun.
- Follow-ups: NUD-030 should not offer archived customers for new orders; archiving a customer with upcoming orders is currently allowed without warning.

---

#### NUD-015 · Customer photos (admin upload/replace)
**Status:** done · **depends_on:** 006, 014

**Goal:** office stores the shop photo and parking/unloading photo per customer.

**Scope**
- On customer detail/edit: two slots "Geschäft / Eingang" (STORE) and "Parken / Entladen" (PARKING), each with upload, replace, fullscreen view.
- Replacing keeps the old photo row with `isCurrent=false` (history, no hard delete).
- "Photos missing" flag derived from absence of current STORE or PARKING photo.

**Acceptance criteria**
- [x] Upload → photo visible on customer detail after reload. (e2e against the s3rver emulator, desktop + mobile: upload via the real browser pipeline, reload, signed `<img>` decodes.)
- [x] Replace → new photo current, old one still in DB with `isCurrent=false`. (Integration test + e2e DB assertion.)
- [x] Flag disappears when both photos exist. (Integration test: detail flag and the NUD-013 list filter agree after each step; e2e.)

**Implementation notes**
- Detail page `/admin/customers/[id]` now has two slots (`CustomerPhotoSlots`, `src/components/admin/customer-photo-slots.tsx`): "Geschäft / Eingang" (STORE) and "Parken / Entladen" (PARKING), each with status badge, thumbnail that opens the NUD-006 `ImagePreview` fullscreen zoom, `ImageUploader` (file picker, drop, paste, camera) for an empty slot and a "Foto ersetzen" button for a filled one. Flow: browser resizes + PUTs to the presigned URL (NUD-006), then calls `addCustomerPhotoAction({customerId, kind, storageKey, width, height})`, then `router.refresh()`. The NUD-014 placeholder text/key was removed. The "photos missing" badge is derived from the same current photos via the pure `src/domain/photos.ts` (`photosMissing`), the list filter keeps its SQL rule; an integration test asserts both agree.
- Server (`src/server/customer-photos.ts`): `addCustomerPhoto` (zod; key must match `isCustomerPhotoKey` = `customers/<uuid>.<jpg|png|webp|heic>`, i.e. exactly what `POST /api/uploads` issues, a unit test ties the two together; new `Storage.head()` checks the object really exists and supplies `bytes` (client-sent size is ignored); a key can be attached only once; one transaction under `SELECT ... FOR UPDATE` on the customer sets older current photos of that kind to `isCurrent=false` and inserts the new one, so concurrent uploads never leave two current photos) and `getCustomerPhotos` (signed read URLs, 1 h, generated on the server; the bucket stays private). Wrapped by `addCustomerPhotoAction` (`requireRole("ADMIN")`) and `customerPhotosQuery` (admin only).
- `Storage` interface got `head(key)` (S3 `HeadObject`, Fake map); needs the read permission only.
- Tests: `customer-photos.integration.test.ts` (anonymous / driver / deactivated admin rejected on action and query, 12 forged keys, invalid input table, missing object, unknown customer, size from storage, key reuse, replace history, concurrency, flag consistency with list filter), `domain/photos.test.ts`, `storage.test.ts` (head), `uploads.test.ts` (issued keys match pattern), e2e `tests/e2e/customer-photos.spec.ts` (desktop + mobile; skipped without `S3_*`; needs a real S3-compatible store such as MinIO or `s3rver`). Verified: lint, typecheck, prettier, `pnpm test` (290 passed incl. DB), `i18n:check`, `pnpm build`, e2e customer-photos / customers / uploads / customer-form (desktop + mobile; screenshots at 1280 and 375 px inspected, no horizontal scroll).
- NOT verified: real MinIO / R2 (s3rver only; same gap as NUD-006, the browser upload path has now been exercised in real Chromium through the page); HEIC/real camera photos; pinch zoom on a real phone; the full shells/settings/drivers e2e suites were not rerun. The e2e `customer-form` desktop test failed once in each of two runs (a pin-flag check right after save, and a click from the list to the detail page) and passed otherwise (5 of 6 repeats); the failing steps do not touch photos, so it looks like a pre-existing timing flake, not investigated.
- Follow-ups: an object uploaded but never attached (action failed, tab closed) stays orphaned in storage, and replaced photos keep their objects (history); a cleanup job belongs with NUD-094. Photos are managed on the detail page only, not on the edit form (see decision log). Driver capture/replace is NUD-083 and needs its own action (the admin action rejects drivers).

---

#### NUD-020 · Product catalog CRUD (multilingual names)
**Status:** done · **depends_on:** 003, 005

**Goal:** the list of pasta products, readable by every driver.

**Scope**
- `/admin/products`: list (SKU, German name, Simplified Chinese name, unit, active), sortable by `sortOrder` (drag or up/down).
- Form: SKU*, unit* (select with localized labels), `name.de`*, `name.zh-Hans`*, `name.zh-Hant-HK` and `name.zh-Hant-TW` **pre-filled live via OpenCC** from zh-Hans and editable (mark as "auto" until edited).
- Deactivate instead of delete; inactive products are hidden in order entry but kept on old orders.

**Acceptance criteria**
- [x] Saving without `zh-Hans` name is rejected. (Server: integration test with empty / blank / missing name; UI: localized field error, e2e.)
- [x] Typing `螺旋意面` in zh-Hans pre-fills both Traditional fields with OpenCC output. (e2e: `螺旋意麪` HK / `螺旋意麵` TW, both marked "automatisch".)
- [x] Inactive products don't appear in the order entry product picker. (The picker itself is NUD-030; its data source `getActiveProducts()` / `activeProductsQuery()` is integration-tested to hide inactive products while old order items keep their product. NUD-030 must use it.)


**Implementation notes**
- Pages: `/admin/products` (table: up/down buttons, SKU, German name, Simplified name, unit, active badge, edit, deactivate/activate), `/admin/products/new`, `/admin/products/[id]/edit`; the existing admin nav entry is unchanged. All three pages call `requirePageActor("admin")`.
- Form (`src/components/admin/product-form.tsx`): SKU, unit (native select with localized labels), `de` and `zh-Hans` required, HK/TW names pre-filled live from Simplified. The two Traditional fields carry an "automatisch" badge until the user types in them; a "neu ableiten" button switches a field back to auto. New products start with both auto; on edit a field is auto only if `meta.machine` says it was derived.
- OpenCC runs on the server: server action `deriveHantAction` (admin only, debounced 200 ms in the form, stale answers dropped), so the dictionaries are not added to the browser bundle by this ticket. On save the server recomputes every field flagged auto (and any empty field) from Simplified, so what is stored never depends on client code; hand-edited names are kept and not flagged in `meta.machine`.
- Server (`src/server/products.ts`, zod `productInputSchema`; actions in `product-actions.ts`, reads in `product-queries.ts`, all start with `requireRole("ADMIN")`): `createProduct`, `updateProduct`, `setProductActive` (soft delete, no hard delete exists), `moveProduct` (swap with neighbour, renumbers `sortOrder` 0..n-1 in a transaction, which also repairs ties), `listProducts`, `getProduct`, and `getActiveProducts(db)` / `activeProductsQuery()` for the order entry picker (active only, `sortOrder` order). `src/lib/units.ts` holds the unit list for client code.
- Tests: `src/server/product-actions.integration.test.ts` (11 cases: anonymous / driver / deactivated admin rejected on every action and read, required names, OpenCC derivation and machine flags, server-side recompute vs hand-edited, duplicate SKU case-insensitive, append + up/down + tie repair, picker query hides inactive but old orders keep the product, unit lock, derive action), `tests/e2e/products.spec.ts` (desktop + mobile: required zh-Hans, live pre-fill, auto markers, duplicate SKU, edit, reorder (desktop only, shared list), deactivate/activate, no horizontal scroll, anonymous redirect).
- Verified: lint, typecheck, prettier, `pnpm test` (301 passed incl. DB), `i18n:check`, `pnpm build`, e2e products (twice, desktop + mobile), shells (34 passed, includes the products page in 4 locales), customers, drivers.
- NOT verified: the e2e `customer-form` / `customer-photos` / `settings` / `maps` specs were not rerun (untouched code); agent-written Chinese strings unreviewed (NUD-073); the up/down buttons were not tried on a real touch device; layout inspected only through the no-horizontal-scroll assertion at 1280 and Pixel 7 widths.
- Surprise: the 1.3 MB OpenCC dictionary is already in a client chunk because `language-switcher.tsx` and `users-manager.tsx` import `LOCALES` from `src/lib/localized-text.ts`, which imports OpenCC (NUD-003/008, not this ticket); see NUD-098.
- Follow-ups: NUD-030 uses `activeProductsQuery()`; the seeded products have identical hand-written HK and TW names (not marked machine), so the form shows them without "automatisch".

---

#### NUD-030 · Manual order entry
**Status:** done · **depends_on:** 014, 020

**Goal:** office records an order in under 30 seconds.

**Scope**
- _Added by NUD-012:_ preselect the delivery date with `getDefaultDeliveryDate()` (`src/server/settings.ts`).
- `/admin/orders/new`: customer combobox (search by name/number), delivery date (default `nextDeliveryDate`), product lines (product picker + quantity + unit shown), add/remove lines, internal note (office only, not shown to driver).
- Keyboard-friendly: Enter adds a line, quantities accept `,` and `.` decimals.
- Save as `CONFIRMED` (default) or `DRAFT`.
- Warning (not error) if the customer already has a confirmed order for that date: "will be combined into one stop".
- Warning if the customer's pin is unconfirmed: "this customer cannot be routed until the pin is confirmed".

**Acceptance criteria**
- [x] Quantity must be > 0; at least one line required; same product twice in one order is merged or rejected (pick one, log decision). (Merged; server-side tests for 0, negative, text, 3 decimals, no lines.)
- [x] Unit tests for order validation (zod) and the date default.
- [x] E2E: create order with 3 lines, see it in the overview (NUD-032 placeholder list is fine). (`tests/e2e/orders.spec.ts`, desktop + mobile.)

**Implementation notes**
- Pure rules in `src/domain/order.ts` (zod, no framework imports): `parseQuantity`/`parseQuantityCents` (`,` and `.`, max 2 decimals, > 0, max 99999999.99; a third decimal such as "1.000" is rejected rather than guessed), `mergeOrderLines` (same product -> quantities added), `orderInputSchema` (customer, `YYYY-MM-DD` date, status CONFIRMED|DRAFT, note <= 1000, 1..100 lines), `orderWarnings` (combined stop, unconfirmed pin), date helpers. Tests: `src/domain/order.test.ts` (60), including the default-date path via `nextDeliveryDate`.
- Server: `src/server/orders.ts` (`createOrder`: re-validates, rejects past dates, archived/unknown customers and inactive/unknown products, creates order + items in one statement with source MANUAL; `listOrderableCustomers` = active only; `countConfirmedOrders`; `listOrderOverview`), `order-actions.ts` (`createOrderAction`, `confirmedOrderCountAction`, both `requireRole("ADMIN")`), `order-queries.ts` (`orderableCustomersQuery`, `orderOverviewQuery`; product picker uses `activeProductsQuery()`). `src/server/order-actions.integration.test.ts`: anonymous / driver / deactivated admin rejected on all four, 3-line order with `,`/`.` decimals, draft, merge, invalid-input table, past date, archived customer, inactive product, unconfirmed pin still saves, picker lists, count of CONFIRMED only, overview.
- UI: `/admin/orders/new` (`OrderForm`): customer combobox (number, name, street, city searchable), native date input preselected with `getDefaultDeliveryDate()`, product lines (combobox with names in all locales and SKU searchable, quantity, unit label), Enter in a quantity adds a line and focuses its picker (not when the quantity is invalid), blank lines ignored, internal note, "Bestaetigt speichern" / "Als Entwurf speichern" (buttons only, Enter never submits). Warnings (not errors): existing confirmed orders that day ("combined into one stop", live server check) and unconfirmed pin (link to the customer). `/admin/orders` is now a minimal list of orders from today on (date, customer, items, status, source) with a "new order" button; NUD-032 replaces it. The NUD-043 hook is NOT implemented (NUD-032 owns the hook point: call it in `createOrder`'s callers / `createOrderAction`).
- Verified: lint, typecheck, prettier, `pnpm test` (371 passed incl. DB), `i18n:check`, `pnpm build`, e2e `orders` (desktop + mobile), `customers`, `shells` (desktop, orders page in 4 locales); form screenshots at 1280 and 375 px inspected, no horizontal scroll.
- NOT verified: `customer-form`, `settings`, `maps`, `drivers`, `customer-photos` e2e and the shells mobile project were not rerun (untouched code); Chinese UI strings are agent-written (NUD-073); the customer picker uses cmdk's fuzzy filter (not accent-folded, loose matches may appear); no real touch-device check.
- Follow-ups: archiving a customer with upcoming orders is still allowed without warning; NUD-031 adds `source=SCREENSHOT` to this form; NUD-032 must call the outdated-tour hook after create/update/cancel.

---

#### NUD-031 · Screenshot attachment & split-view entry
**Status:** done · **depends_on:** 006, 030

**Goal:** office types an order while looking at the customer's WhatsApp/WeChat screenshot.

**Scope**
- In order entry: "Add screenshot" via upload, drag-and-drop or **Ctrl+V paste**. Creates a `Screenshot`, sets `source=SCREENSHOT`.
- Split view on ≥ 1024 px: zoomable/pannable image left, order form right; stacked on smaller screens.
- Screenshot remains viewable from the order detail later (for disputes about quantities).

**Acceptance criteria**
- [x] Pasting an image from clipboard attaches it without a file dialog. (e2e dispatches a `ClipboardEvent("paste")` carrying a `File` on `document`; asserts no `filechooser` event, the signed image decodes in the pane; desktop + mobile. A real OS clipboard / Ctrl+V keystroke was not exercised.)
- [x] Order detail shows the screenshot thumbnail → fullscreen. (e2e: `/admin/orders/[id]` thumbnail opens the zoom dialog, image decodes via signed URL; desktop + mobile.)

**Implementation notes**
- Order form (`src/components/admin/order-form.tsx`): new "Screenshot" section with the NUD-006 `ImageUploader` (`purpose="screenshot"`, file picker, drop, `pasteAnywhere` so Ctrl+V works anywhere on the page). After upload the server action `screenshotPreviewUrlAction(key)` (ADMIN, key must match `screenshots/<uuid>.<ext>` and exist) returns a signed URL. With a screenshot the page becomes `data-testid="order-entry" data-split="true"`: from 1024 px (`lg`) a 2-column grid, zoomable/pannable image left (sticky, `ZoomableImage` now exported from `image-preview.tsx`, wheel zoom is a non-passive listener so the page does not scroll, +/-/reset buttons, drag pan, double-click zoom), form right; below 1024 px the image is stacked above the form (50dvh). "Remove screenshot" returns to the uploader. After a successful save the form state is reset (Next keeps the previous route hidden with its state, which would have kept the saved order's screenshot in the next new-order form).
- Server: `orderInputSchema` takes optional `screenshotKey` (`isScreenshotKey`, pattern in `src/lib/uploads.ts`, tied to the keys `/api/uploads` issues by a test). `createOrder(db, actor, input, today, storage)`: key must exist (`Storage.head`, 0 < bytes <= 15 MB), not be used by another `Screenshot` row (`screenshot_missing`, `screenshot_in_use`), then order + `Screenshot` are created in ONE nested create with `source=SCREENSHOT`; a client-sent `source` is ignored. New read `getOrderDetail` / `orderDetailQuery` (ADMIN, signed 1 h URL) and `screenshotPreviewUrlAction` (ADMIN).
- Order detail: new minimal read-only `/admin/orders/[id]` (`OrderDetailView`: customer, date, status, source, lines, internal note, screenshot thumbnail -> fullscreen `ImagePreview` with `fit="contain"`, or "no screenshot"). The date in the order list links to it. NUD-032 extends this page (edit, cancel, duplicate).
- i18n: `admin.orders.form.screenshot.*`, `admin.orders.detail.*`, two new form errors, de + zh-Hans by hand, Hant generated.
- Tests: 8 integration tests in `order-actions.integration.test.ts` (auth on the two new reads/actions, forged keys incl. other prefix / traversal / URL / extension, missing object, empty/oversize object, key reuse, no orphan Screenshot after a rejected order, client `source` ignored, detail incl. signed URL), unit tests for the schema and key pattern, e2e `tests/e2e/order-screenshot.spec.ts` (paste, split layout geometry, wheel zoom without page scroll, pan, save, DB assertions, list -> detail -> fullscreen, file picker, drag-and-drop, remove -> MANUAL, clean form on next order, anonymous redirect, unknown id).
- Verified: lint, typecheck, prettier, `pnpm test` (383 passed incl. DB), `i18n:check`, `pnpm build`, e2e `order-screenshot` + `orders` (desktop + mobile), `customer-photos`, `uploads`, `shells` (desktop) against the s3rver emulator; screenshots inspected at 1280 px (desktop) and Pixel 7 (412 px, mobile project), no horizontal scroll.
- NOT verified: real MinIO / R2 (s3rver only, as NUD-006/015); a real clipboard paste from a chat app (synthetic ClipboardEvent only); pinch zoom / touch panning on a real phone (the pane uses `touch-none`, so touch-dragging on the image does not scroll the page); 375 px exactly (the mobile project is Pixel 7, 412 px); mobile e2e of `customer-photos`/`shells` not rerun; Chinese strings are agent-written (NUD-073).
- Follow-ups: an uploaded but unsaved/removed screenshot stays orphaned in storage (cleanup with NUD-094); uniqueness of `Screenshot.storageKey` is checked in app code only (two concurrent saves with the same key could both pass; a unique index would need a migration); the unsaved form (incl. screenshot) is kept when navigating away and back (Next route retention), there is no "discard changes" prompt.

---

#### NUD-032 · Order overview & editing
**Status:** done · **depends_on:** 030

**Goal:** central order overview (projektbeschreibung §3).

**Scope**
- `/admin/orders`: default filter = next delivery date. Filters: date (range), customer, status, source.
- Rows: customer, date, number of lines, status, source icon, "in tour" badge.
- **Totals panel per date:** sum per product (for production/loading).
- Order detail/edit page, cancel (status `CANCELLED`, not delete), duplicate order to another date.
- Hook point for NUD-043: every create/update/cancel calls `tourService.markOutdatedForDate(date)`.

**Acceptance criteria**
- [x] Totals panel matches the sum of all confirmed orders for the date (unit test on the aggregation function in `src/domain`). (`aggregateTotalsByDate` in `src/domain/order-overview.ts`, 5 unit tests; integration test and e2e compare the panel with the sums of the stored orders.)
- [x] Cancelled orders are excluded from totals and tours. (Totals: unit + integration + e2e. Tours do not exist yet: `listConfirmedOrdersForDate` in `src/server/orders.ts` is the CONFIRMED-only source NUD-041 must use, tested to exclude cancelled and draft orders.)

**Implementation notes**
- Pure rules in `src/domain/order-overview.ts`: `aggregateTotalsByDate` (CONFIRMED only, exact sums in hundredths, no float drift), `parseOrderFilters` / `orderFiltersToQuery` (URL params to filters, never fails: unusable values fall back to the default; range capped at 62 days), `isOrderEditable` (not cancelled and delivery day today or later). Tests: `order-overview.test.ts` (12).
- Server (`src/server/orders.ts`, `order-actions.ts`, `order-queries.ts`): `orderOverviewQuery(params)` returns filters, rows (limit 300, `truncated` flag), totals per date and the customer list (all customers, archived too) for the filter; row = customer, date, line count + quantities, status, source icon, "in tour" badge from `StopOrder -> Stop` (`tour: {tourId, stopId}`; empty until NUD-041). New actions `updateOrderAction(id, input)`, `cancelOrderAction(id)`, `duplicateOrderAction(id, date)`, all `requireRole("ADMIN")`. `updateOrder` re-uses `orderInputSchema` (the same zod validation as order entry: quantities > 0, max 2 decimals, `1.000` rejected, merged duplicates, past date rejected) with the customer taken from the stored order and any client `customerId` / `screenshotKey` / `source` ignored; lines are replaced in one nested write. `confirmedOrderCountAction` got an optional `excludeOrderId` so the "combined into one stop" warning does not count the order being edited.
- Hook point: `src/server/tour-service.ts` (`createTourService(db)`, `getTourService()`); `markOutdatedForDate(date)` sets `Tour.isOutdated=true` for all not COMPLETED tours of that date (column exists in the §6 schema). `createOrder` (NUD-030 path), `updateOrder` (old and new date when the date moved), `cancelOrder` and `duplicateOrder` take a `TourHook` argument and call it after the write; rejected changes call nothing. NUD-043 extends the service (it does not look at order status or what changed, so a draft edit also flags the tour). Tests: `tour-service.integration.test.ts` (3), hook calls in `order-management.integration.test.ts`.
- UI: `/admin/orders` is the overview (filters in the URL: from/to date inputs default to the next delivery date via `getDefaultDeliveryDate()`, customer combobox, status, source, reset; totals panel per date above the rows; `OrderFilters`, `OrderTotals`, `OrdersTable`). `/admin/orders/[id]` shows edit / duplicate / cancel (`OrderActions`: cancel and copy open dialogs; edit and cancel only for open orders); `/admin/orders/[id]/edit` re-uses `OrderForm` in edit mode (customer fixed, attached screenshot shown read-only in the split view, status via the two save buttons). After creating an order the list opens filtered to that order's date. Archive dialog of a customer shows a warning with the number of upcoming not cancelled orders (`CustomerArchiveButton`, count from the existing upcoming-orders query); archiving is still allowed.
- i18n: `admin.orders.filters/totals/detail.*` and form keys, `admin.customers.detail.archiveUpcoming`, de + zh-Hans by hand, Hant generated.
- Tests: 21 integration tests `order-management.integration.test.ts` (authorization of the 3 new mutations and reads for anonymous / driver / deactivated admin without side effects, edit validation table, customer/screenshot immutability, cancel keeps everything, totals, filters, tour link, hook), extended `order-actions.integration.test.ts`, e2e `tests/e2e/order-overview.spec.ts` (default date, filters, totals, in-tour badge, edit with validation error, cancel, duplicate, outdated flag in the DB, archive warning, anonymous redirect; desktop + mobile).
- Verified: lint, typecheck, prettier, `pnpm test` (419 passed incl. DB), `i18n:check`, `pnpm build`, e2e `order-overview`, `orders`, `order-screenshot` (desktop + mobile), `customers`, `shells`, `customer-form` (desktop); screenshots inspected at 1280 px (overview, edit page, archive dialog), no horizontal scroll (also asserted at the mobile project width).
- NOT verified: other e2e specs (settings, maps, drivers, products, customer-photos, uploads, auth, home) were not rerun; the "in tour" badge only with a hand-inserted Tour/Stop/StopOrder (no tour builder yet) and it is not a link until NUD-042 has a tour page; `customer-form` e2e failed once under 2 parallel workers (pin flag, passes alone) and was not investigated further; Chinese strings are agent-written (NUD-073); no real touch-device check.
- Follow-ups: NUD-042 should link the badge (`data-tour-id`) to the tour page; NUD-043 should refine `markOutdatedForDate` (only when a CONFIRMED order is affected, banner, rebuild); NUD-041 must build stops from `listConfirmedOrdersForDate`; the hook is called after the order write without a transaction (a failing hook leaves the order saved and the action throws).

---

#### NUD-040 · RoutingProvider + ORS optimization + fallback heuristic
**Status:** done · **depends_on:** 002

**Goal:** given a depot and N coordinates, return the best visiting order with legs and geometry.

**Scope**
- Interface:
  ```ts
  interface RoutingProvider {
    optimize(input: { depot: LatLng; stops: { id: string; location: LatLng; serviceSeconds: number }[] }):
      Promise<{ orderedStopIds: string[]; legs: { distanceM: number; durationS: number }[]; geometry: GeoJSON.LineString; totalDistanceM: number; totalDurationS: number }>;
    route(input: { depot: LatLng; orderedStops: LatLng[] }): Promise<same minus ordering>; // for manual reorder
  }
  ```
- ORS implementation: `/optimization` (VROOM; one vehicle, start=end=depot, profile `driving-car`; use `driving-hgv` if a setting says truck — default car) then `/v2/directions/driving-car/geojson` for geometry & legs.
- Fallback (`LocalHeuristicProvider`): haversine distance matrix × road factor 1.3, average 30 km/h, nearest-neighbour + 2-opt. Used when ORS fails or no key; result flagged `approximate: true` and shown as such in UI.
- Handle > 50 stops gracefully (ORS limits): documented error.

**Acceptance criteria**
- [x] Pure unit tests for 2-opt (improves a crossing route) and nearest-neighbour. (`src/domain/routing.test.ts`)
- [x] ORS client tested against fixtures. (`src/server/routing/routing.test.ts`; fixtures are hand-written from the documented ORS/VROOM shapes, NOT recorded from a live call, see notes.)
- [x] Provider falls back automatically on timeout (8 s) and reports `approximate`. (tested with a stalled fetch and a short test timeout; the 8 s default is `ROUTING_TIMEOUT_MS`, asserted as a constant, not waited for.)

**Implementation notes**
- Pure algorithms in `src/domain/routing.ts` (haversine, road factor 1.3, 30 km/h, distance matrix, `nearestNeighbourOrder`, `twoOpt`, `estimateLegs`, `heuristicOrder`). Providers in `src/server/routing/`: `types.ts` (`RoutingProvider` as in the ticket, `RoutingError` with codes `TIMEOUT|NETWORK|HTTP|BAD_RESPONSE|INVALID_INPUT|TOO_MANY_STOPS|NO_ROUTE`, `MAX_STOPS = 50`), `ors.ts` (`OrsRoutingProvider`, zod-checked `mapOptimizationResponse` / `mapDirectionsResponse`), `heuristic.ts` (`LocalHeuristicProvider`), `fallback.ts` (`FallbackRoutingProvider`), `index.ts` (`getRoutingProvider(env)` singleton, `setRoutingProviderForTests`, `parseProfile`).
- Result type: `{ orderedStopIds, legs, geometry, totalDistanceM, totalDurationS, approximate }`; `route()` returns the same without `orderedStopIds`. `approximate` is a required boolean (`false` for ORS, `true` for the heuristic) for the UI of NUD-042 to show. `legs` has **n + 1** entries (depot -> stop 1 ... stop n -> depot), `totalDurationS` is driving time only (no service time; NUD-041 adds `serviceSeconds`/`serviceMinutesPerStop` for ETAs). `geometry.coordinates` are `[lng, lat]`, directly usable by `TourMap`. Heuristic geometry is straight lines between the points. No stops -> empty result, no request.
- ORS: `POST /optimization` (one vehicle, start = end = depot, job ids `index + 1`, `service` seconds), then `POST /v2/directions/{profile}/geojson`. Profile from env `ORS_ROUTING_PROFILE` (`driving-car` default, `driving-hgv`; invalid -> warning + default). One 8 s deadline covers both requests, no retries (the fallback is the retry). Key goes in the `Authorization` header. Directions requests are split into chunks of at most 50 coordinates that share their boundary point, because ORS limits waypoints per directions request (a 50-stop tour has 52 points).
- Fallback: any `RoutingError` except `INVALID_INPUT` / `TOO_MANY_STOPS` (and any unexpected error) logs one warning and the heuristic answers (`approximate: true`). Missing `ORS_API_KEY` -> heuristic only, one warning per process. More than 50 stops raises `RoutingError` `TOO_MANY_STOPS` in every provider (the message says "at most 50 stops"); the tour builder (NUD-041) should show it to the office.
- New env var `ORS_ROUTING_PROFILE` in `.env.example` and `docs/env.md`; `ORS_API_KEY` is documented there as shared by geocoding and routing. (Prettier re-padded the whole `docs/env.md` table, hence the large diff.)
- Verified: lint, typecheck, `pnpm test` (456 passed incl. 37 new, DB tests on embedded PostgreSQL), `i18n:check`, prettier. No UI, route, mutation or schema change, so no i18n strings, authorization tests, migration or e2e were needed; nothing calls the provider yet (NUD-041 will, from a server action with `requireRole("ADMIN")`). `pnpm build` was not rerun (no app code imports the module yet).
- NOT verified: any live call to OpenRouteService (no key, by instruction). The fixtures in `src/server/routing/fixtures/` are hand-written from the documented ORS/VROOM shapes, not recorded. Please run one real `optimize` and `route` once a key exists and compare: the VROOM `steps[].job` ids, `unassigned`, directions `segments[]` and the 50-waypoint directions limit (chunking assumes it) are from memory of the docs; also the free-tier optimization limits.

---
#### NUD-041 · Tour builder (orders → stops → optimized tour)
**Status:** done · **depends_on:** 012, 032, 040

**Goal:** one click creates an optimized tour for a date.

**Scope**
- _Added by NUD-012:_ call `requireDepotConfigured()` (`src/server/settings.ts`) first; on `DepotNotSetError` show `admin.settings.errors.depotNotSet` and do not build. Then tick the "refuses without depot" criterion of NUD-012.
- Domain function `buildStops(orders)`: group confirmed orders by customer → one stop per customer, with merged item quantities per product (keep the link to each order via `StopOrder`).
- Service `generateTour(date)`: validates depot; excludes customers with unconfirmed pins (returned as warnings with links); calls `optimize`; persists `Tour` (`OPTIMIZED`), `Stop`s with sequence, legs, ETAs (`departureTime` + cumulative leg durations + service minutes), geometry, totals.
- Re-running on an unreleased tour replaces stops; on a **locked** tour it only adds new customers at the end (log decision if different).

**Acceptance criteria**
- [x] Unit test: 3 orders from 2 customers → 2 stops, quantities merged correctly per product. (`src/domain/tour.test.ts`)
- [x] Integration test with Fake/heuristic provider: tour persisted with correct sequence and ETAs. (`src/server/tour-builder.integration.test.ts`, embedded PostgreSQL, `LocalHeuristicProvider`)
- [x] Customers without confirmed pins are reported, not silently dropped. (`warnings[]` in the result, also together with `no_stops`; tested for `pinConfirmed=false` and missing coordinates)

**Implementation notes**
- Pure logic in `src/domain/tour.ts`: `buildStops(orders)` (one stop per customer, exact per-product sums in hundredths, order ids kept for the `StopOrder` links), `partitionByPin`, `mergeLockedOrder`, `departureInstant(date, "HH:MM", timezone)` (DST-safe), `computeSchedule` (ETA = departure + cumulative driving legs + service time of every earlier stop). Service: `src/server/tour-builder.ts` with `generateTourWith(deps, date)` (injectable db / provider / depot guard / settings / clock, used by the tests) and `generateTour(date)` (real `getDb()`, `getRoutingProvider()`, `requireDepotConfigured`, `getSettings`). Server action wrapper `generateTourAction(input)` in `tour-actions.ts` (`requireRole("ADMIN")` first, then zod `{date: "YYYY-MM-DD"}`), no page: NUD-042 builds the UI.
- Result: `{ ok: true, tourId, mode: created|replaced|locked_extended, stopCount, addedCustomerIds, removedCustomerIds, approximate, warnings }` or `{ ok: false, error, warnings, maxStops? }` with `error` one of `invalid_date | date_in_past | depot_not_set | no_stops | tour_not_editable | too_many_stops | conflict`. Warnings are `{code: "PIN_UNCONFIRMED", customerId, customerNumber, name, orderIds}` (UI links to `/admin/customers/<id>`). **NUD-042 maps `depot_not_set` to `admin.settings.errors.depotNotSet`** and needs new i18n keys for the other errors (none were added here: no UI).
- Data: new column `Tour.approximate Boolean @default(false)` (migration `20261017170000_tour_approximate`) so the UI can show the badge without recomputing. Stored per stop: `sequence` (1-based), `etaAt` (arrival), `legDistanceM`/`legDurationS` (the leg that ends at this stop; the return leg is only in the tour totals). Tour: `depotSnapshot {name,address,lat,lng}`, `geometry` (GeoJSON LineString), `totalDistanceM`, `totalDurationS` (= driving incl. return leg **plus service time**), `optimizedAt`, `isOutdated=false`, status `OPTIMIZED`.
- Re-run rules: unreleased (DRAFT/OPTIMIZED) -> re-optimized, stop rows are reused per customer (same ids), missing ones created, others deleted, `driverId`/`locked` kept. Locked -> `route()` over the kept order. RELEASED / IN_PROGRESS / COMPLETED -> `tour_not_editable` (re-release is NUD-043). The write runs in one transaction behind a per-date advisory lock and re-checks the tour and the confirmed orders (id + `updatedAt`) that the plan was based on; if anything changed while routing, nothing is stored and the result is `conflict` (retry).
- Verified: lint, typecheck, i18n:check, prettier, `pnpm test` (485 passed incl. 29 new; DB tests on embedded PostgreSQL), including authorization tests (anonymous and DRIVER rejected by `generateTourAction`, nothing written). The NUD-012 criterion "refuses without depot" is now ticked (test: `depot_not_set`, no tour written).
- NOT verified: `pnpm build` and e2e (no UI/route; the action is not imported by any page yet); behaviour with the real ORS provider (only `LocalHeuristicProvider` was used, as no key exists); concurrency of two simultaneous generate calls beyond the conflict test; the 51-customer TOO_MANY_STOPS test runs the heuristic only.
- Follow-ups for NUD-042/043: show `warnings`, `approximate`, `mode`/`removedCustomerIds` (customers dropped from a locked tour) and the error messages; NUD-043 must handle RELEASED/IN_PROGRESS tours (`tour_not_editable`); the in-place stop reuse already keeps ids stable for a diff.

---

#### NUD-042 · Tour planning UI (map, reorder, lock, release)
**Status:** done · **depends_on:** 011, 041

**Goal:** office reviews and releases the day's tour.

**Scope**
- `/admin/tours?date=…`: date picker; if no tour: "Generate tour" button + warnings list.
- Layout: map (numbered stops, polyline, depot) + ordered stop list (sequence, customer, ETA, item count, flags such as missing photos).
- Drag-and-drop reorder → recompute legs/ETAs via `route()` (not re-optimize). "Re-optimize" button.
- Lock toggle, assign driver (select from active drivers), **Release** button (→ `RELEASED`, `releasedAt`). Confirmation dialog shows stop count and total time.
- Approximate-route badge when the fallback provider was used.

**Acceptance criteria**
- [x] Reordering two stops updates the map numbering and ETAs. (e2e: drag C to the first place and the "down" button; list numbers, ETAs, marker "1" position and the stored `Stop.sequence` follow; integration test checks legs/ETAs/totals recomputed with `route()`.)
- [x] Release requires an assigned driver. (button disabled with a hint, and the server refuses with `driver_required`; also tested: inactive driver, outdated tour, stale version.)
- [x] E2E: generate → reorder → release. (`tests/e2e/tours.spec.ts`, desktop project; also re-optimize, lock, driver, dialog, "in tour" badge link.)

**Implementation notes**
- Domain `src/domain/tour-plan.ts` (+ test): `isTourEditable` (DRAFT/OPTIMIZED), `moveItem`, `isPermutation`, `sameOrder`, `releaseBlocker` (`tour_not_editable` > `no_stops` > `driver_required` > `outdated`), `durationParts`. ETA recomputation reuses `computeSchedule` / `departureInstant` from NUD-041 (no new helper needed).
- Server `src/server/tour-planning.ts`: read model `getTourPlan(db, date, tz)` (latest tour of the day with stops, item count = distinct products, photo flags from current photos, depot, geometry, drivers, `warnings` for unconfirmed pins recomputed from the confirmed orders so they survive a reload, `confirmedOrderCount`) and `reorderStopsWith`, `setTourLockedWith`, `assignDriverWith`, `releaseTourWith`. Actions in `tour-actions.ts` (`reorderStopsAction`, `setTourLockedAction`, `assignDriverAction`, `releaseTourAction`; each `requireRole("ADMIN")` first, then strict zod) and the read `tourPlanQuery(date)` in `tour-queries.ts` (ADMIN, bad/missing date -> next delivery date). Error codes (all mapped to `admin.tours.errors.*`; `depot_not_set` uses `admin.settings.errors.depotNotSet` plus a link to the settings): `invalid not_found tour_not_editable stops_changed pin_missing too_many_stops conflict no_stops driver_required driver_invalid outdated` and the NUD-041 generate errors.
- Reorder: the request must contain exactly the tour's current stop ids (else `stops_changed`, the page reloads); `route()` runs outside the transaction, the write takes the per-date advisory lock and re-checks `Tour.updatedAt`/status (`conflict`). Updates geometry, totals, `approximate`, stop sequence/ETA/legs; the `locked` flag and status are untouched. Release quotes the `version` (= `updatedAt`) the dialog showed.
- UI `/admin/tours?date=`: `TourDateField` (native date input, URL state), `TourPlanner` (client): empty state + "Tour erstellen"; warnings with links to `/admin/customers/<id>`; status / locked / approximate badges; summary (stops, total time incl. service, km); map (`TourMapLazy`, numbering follows the list, line hidden while recalculating) next to the stop list (number, customer, address, ETA, item count, "photo missing" badges for shop and parking, drag handle + up/down buttons); Re-optimize ("Aus Bestellungen aktualisieren" when locked, same action as NUD-041), lock toggle, driver select, release dialog (stop count, total time, driver). Released tours are read-only. Strings in `admin.tours.*` (de, zh-Hans by hand, Hant generated). The NUD-032 "in tour" badge is now a link (`data-tour-id` kept) to the tour page of that day.
- Verified: lint, typecheck, `pnpm build`, `pnpm test` (502 passed, DB tests on embedded PostgreSQL; 17 new incl. authorization tests for anonymous/driver on all four mutations and the read), `i18n:check`, prettier (except the untracked sandbox file `pw.local.config.ts`), e2e `tours` (desktop) and `shells` (desktop + mobile, includes the new page in all locales without console errors) and the first `order-overview` test (in-tour badge). Screenshots at 1280 px inspected (planning page, release dialog), no horizontal scroll asserted at 1280.
- NOT verified: real ORS routing (only the heuristic, so the "approximate" badge was seen but not the non-approximate state, and `route()` with ORS for reorder); mobile/touch use of the page (drag-and-drop is native HTML5 and does not work on touch, the up/down buttons are the touch path; no mobile e2e, the spec is desktop only); real map tiles (stubbed). Two `order-overview` e2e tests (order detail, archive dialog) fail in this sandbox because the e2e script runs without object storage ("Object storage is not configured" on those pages); they do not touch this ticket's code. `tours.spec.ts` temporarily confirms the depot pin and restores it, so it must not run at the same time as `settings.spec.ts`.
- Follow-ups for NUD-043: edits to RELEASED+ tours are all refused here (`tour_not_editable`); `releaseBlocker` already refuses an outdated tour on first release; the outdated alert on the page is minimal (no diff).

---

#### NUD-043 · Tour lifecycle & change handling (outdated tours)
**Status:** done · **depends_on:** 042

**Goal:** the driver never silently works with stale quantities (priority #2).

**Scope**
- Status machine in `src/domain/tour-status.ts`: `DRAFT → OPTIMIZED → RELEASED → IN_PROGRESS (first stop completed) → COMPLETED (all stops done)`; allowed transitions unit-tested.
- Any order create/update/cancel for a date with an existing tour sets `isOutdated=true`.
- Admin tour page shows a prominent "Orders changed since release — review & re-release" banner with a diff (stops added/removed, quantities changed).
- Re-release regenerates/updates stops, **preserving status of already-completed stops**.
- Driver view (used by NUD-051) shows a banner "Tour was updated" after a re-release, highlighting changed stops.

**Acceptance criteria**
- [x] Changing a quantity after release flags the tour; after re-release the driver sees the new quantity and the change highlight. (Data layer: `getDriverTour` returns the new quantity, `change: CHANGED`, `changedInRevision`, `previousItems`, `updated`, tested in `tour-rerelease.integration.test.ts`; e2e `tour-rerelease.spec.ts` covers edit -> banner -> re-release in the admin UI. **The driver screen that renders banner and highlight is NUD-051**, so that part is not visible to a driver yet.)
- [x] Completed stops are never reset by re-release (test). (Integration tests: delivered and problem stops keep id, sequence, status, `completedAt`, problem data, quantities, links and ETA through a re-release in which their orders were edited, cancelled and extended; a stop completed by the driver while the re-release is routing makes it fail with `conflict`; unit tests of `planReRelease`.)

**Implementation notes**
- Pure rules in `src/domain/`: `tour-status.ts` (state machine: `canTransition`, `deriveTourStatus`, `isReReleasable`; a stop counts as done when it is not PENDING; the tour never moves backwards, COMPLETED is final; 9 tests) and `tour-diff.ts` (`planReRelease(stops, orders)` = the diff stops added / removed / quantities changed / completed stops edited afterwards plus the new stop order, `sameItems`, `itemChanges`, and `outdatedTourDates(before, after)` = which delivery days an order change really affects; 18 tests).
- Outdated flag (refines NUD-032): `createOrder` / `updateOrder` / `cancelOrder` / `duplicateOrder` now run the order write and the flag in ONE transaction (`db.$transaction`, the hook gets the transaction client: `markOutdatedForDate(date, tx)`), so an order change can no longer be saved without its flag. Only changes that involve a CONFIRMED order flag (draft edits, copies, cancelling a draft and saves that leave customer, day and quantities as they were flag nothing); a date change flags both days. `markOutdatedForDate` itself still flags every not COMPLETED tour of the day (also unreleased ones: the release refusal from NUD-042 stays). Tests: `order-management.integration.test.ts` (hook cases rewritten, atomicity test: a failing hook rolls back create, update and cancel).
- Data (migration `20261017180000_tour_release_revision`, backfills existing stops): `Stop.items` (JSON `[{productId, quantityCents}]` = the quantities the office released, written by the builder and by re-release), `Stop.previousItems`, `Stop.changeKind` (`StopChange` ADDED | CHANGED), `Stop.changedInRevision`, `Tour.releaseRevision` (0 never released, 1 first release, +1 per re-release that changed something), `Tour.reReleasedAt`, `Tour.lastChange` (JSON of the last re-release incl. names of removed stops). First release now sets `releaseRevision = 1` and checks the transition through the status machine.
- Re-release `reReleaseTourAction({tourId, version})` -> `reReleaseTourWith` in `src/server/tour-rerelease.ts` (`requireRole("ADMIN")`, strict zod, errors `not_released`, `tour_not_editable` (COMPLETED), `driver_required`, `driver_invalid`, `conflict`, `pin_missing`, `too_many_stops`): only RELEASED / IN_PROGRESS tours; compares the stored `Stop.items` with the confirmed orders of routable customers (`loadReleasePlan`), keeps the order of the open stops, appends new customers, removes open stops without orders (reused stop rows keep their ids), recomputes legs / ETAs / geometry / totals with `route()` over the whole sequence and writes timing only to open stops, bumps the revision, sets markers and `lastChange`, clears `isOutdated`, and derives the tour status. Completed stops (DELIVERED / PROBLEM) are frozen: status, completion data, quantities, order links and ETA are never written (their position only shifts if an earlier stop was removed); edits to their orders are reported (`completedChanged`), not re-dispatched; a new order of an already delivered customer becomes a second, open stop at the end. All writes to open stops are guarded by `status = PENDING` and the transaction (per-date advisory lock) re-checks tour version, stop statuses and the confirmed orders; any mismatch rolls back and returns `conflict`. If nothing the driver would see differs (changes cancelled each other out) only the flag is cleared (and the order links refreshed); `changed: false`.
- Admin UI (`TourPlanner`, new `TourDiffList`): for a RELEASED / IN_PROGRESS tour with `isOutdated` a red banner "Bestellungen seit der Freigabe geändert – prüfen und erneut freigeben" with the diff (new stops, removed stops, quantity before -> after per product, edited completed stops) and a "Erneut freigeben" button with a confirmation dialog (counts); afterwards stop rows show their status and a "Menge geändert" / "Neu seit Freigabe" badge, the header "Aktualisiert am … (Version n)". The read model `getTourPlan` returns `releaseRevision`, `reReleasedAt`, `diff`, per stop `status` and `changeKind`. Strings `admin.tours.change.*` (de, zh-Hans by hand, Hant generated).
- Driver data layer for NUD-051: `getDriverTour(db, driverId, date)` in `src/server/tour-driver.ts` (no page, no action). Only released tours of that driver; quantities come from the `Stop.items` snapshot, NOT from the live order lines, so an order edited after release shows up for the driver only through a re-release (never half-updated). Returns `revision`, `updated` (show the "Tour was updated" banner), `removedCustomers`, per stop `change`, `changedInRevision`, `previousQuantityCents` per item. NUD-051 should remember the last revision the driver has seen (client side) and highlight stops with `changedInRevision` above it. `syncTourProgress(tx, tourId)` in `tour-service.ts` moves RELEASED -> IN_PROGRESS -> COMPLETED (`completedAt`) from the stop statuses; the stop-status mutation of NUD-053 must call it inside its transaction and take the same per-date advisory lock (`pg_advisory_xact_lock(hashtext('tour:<YYYY-MM-DD>'))`) as release / re-release.
- Tests: `tour-rerelease.integration.test.ts` (16: first release snapshot, flag -> diff -> driver data before / after, added / removed stops, reverted change, revisions, completed stops frozen (all fields), second visit, completing every open stop, race with a driver completing a stop, refusals, authorization (anonymous and DRIVER rejected, nothing changed), driver read model access, `syncTourProgress`), e2e `tests/e2e/tour-rerelease.spec.ts` (release, delivered stop A, change B 3 -> 5 through the order form, banner and diff in all four locales without console errors, re-release dialog, A still delivered, B marked, DB assertions).
- Verified: lint, typecheck, `pnpm test` (548 passed incl. DB tests on embedded PostgreSQL), `i18n:check`, prettier (except the untracked sandbox file `pw.local.config.ts`), `pnpm build`, e2e `tour-rerelease` (desktop), `tours` (desktop, alone), `order-overview` and `orders` (desktop, one `orders` mobile run failed in `pickProduct` with two open comboboxes and passed on the desktop rerun: timing, code untouched), `shells` (mobile); screenshots at 1280 px inspected (banner with diff, re-release dialog, after re-release), no horizontal scroll asserted.
- NOT verified: the driver screen itself (NUD-051 renders banner / highlight; only the data layer is tested); `route()` of the real ORS provider on re-release (heuristic only, as before); a real driver mutation racing a re-release (simulated by completing a stop while routing; NUD-053 must follow the lock rule above); mobile / touch use; `tours.spec.ts` fails when it runs in the same server session after specs that already loaded the settings (settings are cached by the app and the spec flips `depotPinConfirmed` directly in the DB), it passes alone; Chinese strings are agent-written (NUD-073).
- Follow-ups: a new confirmed order for a day whose tour is already COMPLETED is not flagged and has no way into a tour (NUD-099 added); the "Tour was updated" acknowledgement is client-side only (no server record that the driver saw revision n); archiving a customer or changing a customer's address/pin after release does not flag the tour.

---

#### NUD-050 · Driver first-start language picker
**Status:** done · **depends_on:** 005

**Goal:** a driver who reads no German can use the app from the first second.

**Scope**
- On first driver login (`localeChosen=false`) show a full-screen picker with four big buttons, each written in its own script with a small flag-free label: `Deutsch`, `简体中文`, `繁體中文（香港）`, `繁體中文（台灣）`. No other text needed.
- Saves `User.locale`, `localeChosen=true`. Changeable later via the language icon in the driver top bar.
- The driver login page itself shows the language switcher at the top (icon + own-script labels).

**Acceptance criteria**
- [x] E2E (mobile): first login → picker → choose 繁體中文（台灣） → home page in zh-Hant-TW; second login skips picker. (`tests/e2e/driver-language-picker.spec.ts`, 375x812, desktop + mobile projects, passed.)

**Implementation notes**
- Picker page `/[locale]/driver/start` (outside the `(app)` group, so no shell): `DriverLanguagePicker` with four 96 px buttons in their own script (`lang` set per button), a language icon, no other text. Server action `chooseDriverLocaleAction` (`src/server/driver-locale-actions.ts`): `requireRole("DRIVER")` first, zod-validated locale (`chooseDriverLocale` in `driver-locale.ts`), saves `User.locale` + `localeChosen = true` for the session user only, sets the `NEXT_LOCALE` cookie, refreshes the session token and redirects to `/{locale}/driver` (the original deep link is not restored: simplest, logged).
- Enforcement is guard-level: `requirePageActor("driver", ...)` redirects a DRIVER with `localeChosen=false` to the picker (`Actor` got `localeChosen`; admins in the support view are not affected); only the picker page passes `allowUnchosen`. Every future driver page must use `requirePageActor`, so deep links cannot skip it. The picker redirects chosen drivers / admins to the home.
- Login: `LanguageSwitcher` got `variant="bar"` (language icon + visible 48 px select, own-script options) and a `query` prop that keeps `?callbackUrl` when the locale changes; shown on the driver login page only. Later changes: the existing top-bar icon (unchanged).
- Seed: the four language demo drivers now have `localeChosen=true` (existing e2e logins stay deterministic); new seeded `driver-new` (de, `localeChosen=false`) shows the picker for manual demos. `drivers.spec.ts` was adapted (a freshly created driver now passes the picker). The picker e2e inserts its own driver per run, so it is independent of the seed.
- Tests: `driver-locale.integration.test.ts` (8: saves choice, invalid locales, anonymous / admin / deactivated rejected with nothing changed, cannot touch other users, guard redirects from every driver page, picker page passes, chosen drivers and admins pass), e2e as above.
- Verified: lint, typecheck, prettier, `i18n:check`, `pnpm test` (556 incl. DB tests), `pnpm build`, e2e `driver-language-picker`, `auth`, `drivers`, `shells`, `home`, `uploads` (with fake S3), 375 px screenshots of login and picker inspected, no horizontal scroll asserted.
- NOT verified: real phone / Safari (native select popup of the icon variant); the setting of `localeChosen` is not enforced in the proxy (token has no such claim) nor in future driver mutations (NUD-053 should keep using `requireRole("DRIVER")`; the page guard covers navigation); picker has no heading text by design (screen readers hear the four language names).

---

#### NUD-051 · Driver "today's tour" screen
**Status:** done · **depends_on:** 043, 050

**Goal:** projektbeschreibung §5 "Beim Öffnen sieht er".

**Scope**
- Loads the driver's `RELEASED`/`IN_PROGRESS` tour for "today" (factory TZ). If none: friendly empty state ("No tour released for today").
- Top: date, progress `3 / 12`, total remaining time estimate.
- **Next stop card** (large): sequence number, customer name, address, ETA, item summary (e.g. "3 Sorten · 27 kg"), buttons **Navigate** and **Details**.
- Numbered list of all stops with status icon (pending / ✓ / ⚠), tap → detail.
- Toggle "List / Map" (TourMap with numbered markers).
- Updated-tour banner from NUD-043.
- _Added by NUD-043:_ read the tour with `getDriverTour(db, driverId, date)` (`src/server/tour-driver.ts`): quantities come from the released snapshot (`Stop.items`), never from live order lines. Show the banner while `updated` is true and until the driver has seen `revision` (remember the last seen revision on the device); highlight stops with `changedInRevision` above it (`change` = `ADDED` / `CHANGED`, `previousQuantityCents` per item); list `removedCustomers` in the banner.

**Acceptance criteria**
- [x] Driver sees only his own tour (authz test). (`driver-today.integration.test.ts`: another driver's tour of the same day, an admin, unknown users, other days and unreleased tours yield nothing; page query rejects anonymous and deactivated users and takes the driver id from the session only; e2e: a second driver gets the empty state and no access to the first driver's stop route.)
- [x] Next stop = lowest-sequence `PENDING` stop. (`nextPendingStop` unit tests incl. unordered input and problem stops; component test in 4 locales; e2e: delivering stop 2 moves the card to stop 3.)
- [x] Renders correctly in all 4 locales at 375 px. (`tests/e2e/driver-today.spec.ts`, seeded released tour, mobile project at 375x812: no horizontal scroll, touch targets >= 48 px, quantity >= 28 px bold, body >= 16 px, no console errors; screenshots of list, map and updated state inspected for de and zh-Hant-TW / de.)

**Implementation notes**
- Page `/[locale]/driver` (replaces the placeholder): `requirePageActor("driver")`, then `driverTodayQuery(locale)` (`src/server/driver-today.ts`: `requireRole("ADMIN","DRIVER")`, only a DRIVER gets a tour, the driver id is the session user, "today" = calendar day in `Settings.timezone`) built on `getDriverTour` (snapshot quantities; got `legDurationS`). Product names are picked server-side in the URL locale; customer name/address are untranslated. The client screen is `components/driver/today-tour.tsx`: progress `done / total` + bar + remaining time, big next-stop card (number, name, address, ETA in factory time zone, summary, Navigate = Google Maps link with the pinned lat/lng via `lib/navigation.ts`, Details), List / Map toggle (`TourMapLazy`, numbered markers, depot, geometry), numbered list with status icon + text (Offen / Geliefert / Problem), all-done card, empty state when no tour. Pure rules in `domain/driver-today.ts` (next stop, progress, per-unit summary, remaining time, unseen change).
- Summary "N Sorten · X kg": one total PER UNIT (kg, Packungen, Kisten, Stück), never summed across units; unit words are ICU plurals in `driver.units.*`; quantities are 30 px bold.
- NUD-043 data: banner "Tour wurde aktualisiert" (with removed customers) while `updated` and the device has not acknowledged `revision`; the last acknowledged revision is kept in `localStorage` (`nudel.driver.seenRevision.<tourId>`, `useSyncExternalStore`, storage failures behave as "never seen"); while the tour has not been re-released the current revision is stored silently. Stops with `changedInRevision` above it get an amber highlight: "Neuer Stopp" or "Menge geändert" with old -> new quantity per changed item. "Verstanden" (48 px) acknowledges and removes banner and highlights. The page refreshes its data when the app becomes visible again (`RefreshOnFocus`).
- Details: stop rows and the Details button link to the new placeholder route `/driver/stops/[stopId]` (only the customer name, back button; 404 unless the stop is in the driver's own tour of today); NUD-052 replaces it. The logout button and welcome line stay at the bottom of the page. `TodayPlaceholder` was removed.
- Tests: `domain/driver-today.test.ts` (9), `lib/navigation.test.ts`, `server/driver-today.integration.test.ts` (7), `components/driver/today-tour.test.tsx` (6 x 4 locales, throwing on missing messages), e2e `driver-today.spec.ts` (4 locales + details/authz/next-stop advance + re-release banner/highlight/acknowledge).
- Verified: lint, typecheck, prettier, `i18n:check`, `pnpm test` (598 passed incl. DB tests), `pnpm build`, e2e mobile project: `driver-today`, `shells`, `home`, `driver-language-picker`, `drivers`, `auth`; screenshots at 375 px inspected.
- NOT verified: real phones / Safari / Google Maps app hand-over; the desktop Playwright project for the new spec (phone viewport forced, mobile project run only); real map tiles (stubbed); Chinese strings are agent-written (NUD-073); the remaining-time estimate is only checked arithmetically (planned legs + service time of open stops, rounded up to 5 min, without the way back to the depot); the update banner after a real re-release through the admin UI (data seeded directly, the re-release itself is covered by NUD-043 tests).
- Known limits: a product removed from a stop in a re-release is not listed (the read model only has current items; the stop is still marked "Menge geändert"); the top-bar date truncates on narrow screens in German (pre-existing shell); the 'seen' state is per device/browser (no server record).

---

#### NUD-052 · Driver stop detail + navigation
**Status:** done · **depends_on:** 015, 051

**Goal:** projektbeschreibung §5 "Bei Auswahl eines Kunden" + §6.

**Scope**
- Header: sequence number, customer name (untranslated), full address (tap to copy).
- **Shop photo** and **parking photo** large, tap → fullscreen with pinch-zoom; placeholder icon + "no photo yet" if missing.
- **Items:** one row per product: localized product name (driver's locale, large) + German name small underneath (to match box labels) + quantity (≥ 28 px bold) + localized unit.
- Notes for driver (`pick(notes, locale)`; until NUD-071 only German exists → shown with a small "DE" badge), delivery hours info.
- **Navigate** button: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=driving` (opens Google Maps app if installed). Secondary option "Apple Maps" on iOS (`https://maps.apple.com/?daddr=<lat>,<lng>`).
- Prev/next stop swipe or buttons.

**Acceptance criteria**
- [x] Quantities on this screen equal the merged quantities of the stop's confirmed orders (integration test). (`driver-stop.integration.test.ts`: two confirmed orders of one customer for the day are merged by the real tour builder + release, a DRAFT and a CANCELLED order are excluded; detail shows 15 kg / 3 packs.)
- [x] Navigate link contains the confirmed pin coordinates, not the address string. (Unit + component + e2e assert the exact URL; Apple Maps link likewise.)
- [x] Missing photos never break the layout. (Both photos are in a fixed 4:3 box; e2e compares box size with photos, with one and with no photo; 375 px, 4 locales, no horizontal scroll.)

**Implementation notes**
- Route `/[locale]/driver/stops/[stopId]` now renders `components/driver/stop-detail.tsx` from `driverStopQuery(locale, stopId)` (`src/server/driver-stop.ts`). The query builds on `getDriverToday`, so the ownership rule is unchanged: the stop must be in the session driver's own released tour of today, else `notFound()`; admins and other drivers get nothing. Extra reads only for that stop's customer: `notes`, `deliveryHoursInfo`, current photos via `getCustomerPhotos` (signed URLs, server side). Quantities are the released snapshot (as NUD-051).
- Screen order: back, "Stopp n von N", sequence badge, untranslated name, address (whole row is a 48 px button, copies "street, postal code city", short "Adresse kopiert" confirmation), ETA, Navigate (Google Maps with pin lat/lng; "Apple Karten" additionally when the browser is iOS/iPadOS, detected client-side via `useSyncExternalStore`; "no pin" notice instead when there is no pin), store photo, parking photo, items, notes (+ "DE" badge when the shown text is German and the UI is not German), delivery hours, an empty `data-testid="status-actions-slot"` marked for NUD-053, previous / next buttons (disabled at the ends).
- Photos: `ImagePreview` (NUD-006) in a fixed `aspect-[4/3]` frame with `contain`; missing photo = same frame with icon + "Noch kein Foto". Items: localized name 20 px semibold, German name small below (only if different), quantity 30 px bold + localized unit.
- Helpers: `domain/driver-stop.ts` (`neighbourStops`, `formatAddress`), `pickWithSource` in `lib/localized-text.ts` (which locale a picked text is in), `appleMapsNavigationUrl` in `lib/navigation.ts`; `TodayItem` got `germanName`, `TodayStop` got `customerId`. Removed the `driver.stop.comingSoon` string; new keys under `driver.stop.*` (de, zh-Hans; Hant generated).
- Tests: `domain/driver-stop.test.ts`, `localized-text.test.ts`, `navigation.test.ts`, `components/driver/stop-detail.test.tsx` (4 locales + copy, iOS, no pin), `server/driver-stop.integration.test.ts` (7), e2e `tests/e2e/driver-stop.spec.ts` (4 locales at 375 px with and without photos, one photo missing, fullscreen viewer opens and zooms, copy, prev/next, iOS Apple Maps, other driver sees nothing). Verified: lint, typecheck, prettier, `i18n:check`, `pnpm test` (628 passed incl. DB), `pnpm build`, e2e mobile `driver-stop` + `driver-today`; screenshots (de with photos, zh-Hant-TW without photos) inspected.
- NOT verified: real phone / Safari (iOS detection, Apple Maps and Google Maps app hand-over, real pinch gesture; only the zoom button was exercised), real S3/R2 photos (e2e answers the signed image requests itself), the clipboard on a real phone (HTTP contexts without clipboard API silently do not copy), the desktop Playwright project, Chinese strings are agent-written (NUD-073). Swipe between stops not built (optional; buttons only).
- Notes for later: Next keeps visited routes hidden in the DOM after client navigation, so e2e locators on such pages need `:visible`; the stop page streams, so a foreign stop id still returns HTTP 200 with the not-found UI (nothing of the stop is sent). The change highlight of NUD-051 is not repeated on this screen.


---

#### NUD-053 · Driver stop status (delivered / problem)
**Status:** done · **depends_on:** 052

**Goal:** driver closes each stop with one tap.

**Scope**
- Big buttons on stop detail: **✓ Delivered** and **⚠ Problem**.
- Problem sheet: predefined reasons (`ProblemReason`, localized, with icons) + optional free text (stored as `LocalizedText` with `source = driver locale`; translation follows in NUD-072).
- After success: auto-advance to the next pending stop; toast with **Undo** (5 minutes, server-enforced).
- First completed stop sets tour `IN_PROGRESS`; last sets `COMPLETED` and shows a "tour finished" screen.
- _Added by NUD-043:_ call `syncTourProgress(tx, tourId)` (`src/server/tour-service.ts`) inside the transaction that writes the stop status, and take the per-date advisory lock `pg_advisory_xact_lock(hashtext('tour:<YYYY-MM-DD>'))` first, as release / re-release do. COMPLETED is final in the status machine: decide how "Undo" of the last stop behaves (e.g. no undo once the tour is completed).
- Each mutation carries a client-generated `clientMutationId` (UUID) → idempotent (prepares NUD-082).

**Acceptance criteria**
- [x] Double-tapping "Delivered" creates exactly one state change (idempotency test). (`stop-status.integration.test.ts`: same id twice, also in parallel -> one change, one `StopMutation`, replay returns the stored result; another id on a completed stop -> `already_completed`; component test: three clicks -> one action call; e2e `dblclick` -> one DB mutation.)
- [x] Undo after 5 minutes is rejected. (Integration test: +5 min 1 s -> `undo_expired`, stop unchanged; exactly 5 min is still allowed; server clock.)
- [x] Tour status transitions as specified (test). (Integration test: RELEASED -> IN_PROGRESS on the first completed stop (DELIVERED or PROBLEM) -> COMPLETED with `completedAt` on the last; undo of the only done stop leaves IN_PROGRESS; COMPLETED refuses undo; e2e checks the DB status per locale.)

**Implementation notes**
- Server: `applyStopMutation(db, actor, input, now)` in `src/server/stop-status.ts` is the one function per mutation (NUD-082's `POST /api/driver/sync` can loop over it; each queued entry brings its own `clientMutationId`). Input (strict zod union): `delivered`, `problem` (`reason` = `ProblemReason`, optional `note` <= 500 chars) and `undo`, each with `stopId` + `clientMutationId` (UUID). Result `{ok:true, replayed, kind, status, tourStatus, done, total, nextStopId, completedAt, undoUntil}` or `{ok:false, error}` (`invalid`, `forbidden`, `not_found`, `already_completed`, `not_completed`, `undo_expired`, `tour_completed`, `tour_not_active`, `mutation_conflict`). One transaction: `pg_advisory_xact_lock(hashtext('tour:<date>'))` first, then the id log, then guarded updates (`status = PENDING` / `<> PENDING`), then `syncTourProgress(tx, tourId)`. Server action `stopStatusAction` (`stop-status-actions.ts`): `requireRole("DRIVER")` first, then `applyStopMutation`, `revalidatePath` on success.
- Data: migration `20261017190000_stop_mutation` adds `StopMutation` (id = clientMutationId, stopId, driverId, kind, stored result). It makes undo idempotent too (`Stop.clientMutationId` holds only one id); `Stop.clientMutationId` is still set on completion and cleared on undo. Accepted ids are recorded, rejections are not (a retry may succeed later). The same id for another stop / driver / kind is `mutation_conflict`.
- Ownership: the stop must be in a RELEASED / IN_PROGRESS tour assigned to the acting driver (`not_found` otherwise, also for foreign stops). Not limited to "today", so a queued mutation synced after midnight still works. Free text is stored as `LocalizedText` with `source` = the driver's locale (`User.locale`, which the language switcher keeps in sync); translation is NUD-072.
- Undo: 5 minutes from `completedAt` (server clock), `src/domain/stop-status.ts` (`UNDO_WINDOW_MS`, `isWithinUndoWindow`, `nextPendingAfter`). COMPLETED is final: once the last stop is done nothing can be undone (no undo in the toast, no undo button), and the tour never moves back from IN_PROGRESS.
- UI: `StopStatusActions` (`components/driver/stop-status-actions.tsx`) fills the `status-actions-slot`: 80 px green "Geliefert", 64 px amber "Problem", bottom sheet with the seven reasons (lucide icons, 64 px, localized with `common.problemReasons`) and a free-text area; after success a toast (10 s, Undo button 48 px) and navigation to the next pending stop (next one behind it in tour order, else an earlier open one, else `/driver`). A completed stop shows a result card (status, reason, time) with Undo while inside the window. Buttons lock while a request runs; the `clientMutationId` is kept after a failed request without an answer (retry = same mutation) and renewed after any answer; `newClientMutationId` falls back to `getRandomValues` on plain HTTP. Stale-screen errors (`already_completed`, `not_found`, ...) show a message and refresh. "Tour finished": the all-done card on `/driver` now has a party icon and a summary ("3 geliefert, kein Problem"). Strings `driver.status.*`, `driver.today.finishedSummary` (de, zh-Hans by hand, Hant generated). `getDriverTour` / `TodayStop` got `problemReason` and `completedAt`.
- Tests: `stop-status.integration.test.ts` (17: delivered, problem + LocalizedText source, idempotency incl. parallel, id conflicts, undo window, tour status walk, advance, ownership, lock wait, strict zod, action authorization anonymous / admin / deactivated), `domain/stop-status.test.ts`, `lib/client-id.test.ts`, `stop-status-actions.test.tsx` (7 x 4 locales), e2e `tests/e2e/driver-status.spec.ts` (4 locales at 375 px: buttons, sheet, touch targets, double tap, toast Undo, problem + note, finish, no undo after COMPLETED; stale screen; retry keeps the id).
- Verified: lint, typecheck, prettier, `i18n:check`, all vitest files (incl. DB tests on embedded PostgreSQL, run in groups), `pnpm build`, e2e mobile `driver-status`, `driver-stop`, `driver-today` (fake S3); screenshots at 375 px (buttons de, sheet / toast / finished zh-Hant-TW) inspected, no horizontal scroll asserted.
- NOT verified: real phone / Safari (touch, sheet with keyboard, toast gestures); the 5-minute expiry only with an injected clock, not waited in e2e; a live race with an admin re-release (covered by the shared advisory lock and a lock-wait test); offline behaviour beyond the retry with the same id (NUD-082); Chinese strings are agent-written (NUD-073); the toast overlaps the list on the finished screen for 10 s.
- Follow-ups: NUD-054 should show `problemReason` / `problemNote` (the note is in the driver's language until NUD-072); NUD-082 must add the "server state wins" conflict rule on top of `applyStopMutation` and may need a `completedAt` override for entries queued offline (the undo window currently counts from server receipt).

---

#### NUD-054 · Admin live tour progress
**Status:** done · **depends_on:** 053

**Goal:** office sees where the delivery stands.

**Scope**
- Admin dashboard card "Today": progress bar, next stop, problems count.
- Tour page in `RELEASED/IN_PROGRESS`: stop list with status, completion time, problem reason + text (original; German translation after NUD-072). Map markers colored by status.
- Polling every 30 s (SWR / `router.refresh`), no websockets.

**Acceptance criteria**
- [x] Driver marks a stop delivered → admin view shows it within 30 s without manual reload. (e2e `admin-progress.spec.ts`: the driver delivers in the real driver UI in a second browser context; dashboard and tour page, left open, updated by themselves. Default 30 s interval: 28.3 s measured end to end, i.e. inside the limit; with `LIVE_POLL_INTERVAL_MS=5000` 2.6 s.)

**Implementation notes**
- Dashboard: `TodayCard` (`components/admin/today-card.tsx`) on `/admin`: today's tour in the factory time zone (latest tour of the day), status badge, segmented progress bar (`role=progressbar`, text "3 von 8 Stopps erledigt" next to it), next open stop (name, address, planned ETA) or "all done", problems count with the customer + reason of each problem stop, driver, link to the tour page of the day. No tour / not yet released (DRAFT, OPTIMIZED) shows a hint and a link to planning. Read model `getTodayProgress` / `todayProgressQuery` (`server/tour-progress.ts`, `requireRole("ADMIN")` first); pure rules in `domain/tour-progress.ts` (`summarizeProgress`, next stop = first PENDING by sequence).
- Tour page (`TourPlanner`): for RELEASED / IN_PROGRESS / COMPLETED a progress block (bar + "x von y Stopps erledigt · n Probleme"), per stop a status badge with icon (check / warning / dashed circle), a "Nächster Stopp" badge, "Erledigt um HH:mm" (factory time zone), and for PROBLEM the reason (`common.problemReasons`) and the driver's text exactly as written, with `lang` = the language he wrote it in and the label "Originaltext des Fahrers" (German translation is NUD-072). `PlanStop` got `completedAt`, `problemReason`, `problemNote {text, locale}` (source-locale value of the `LocalizedText`). Problem rows get a red 2 px border, delivered rows a green one.
- Map: `TourMapStop.status` (optional, the driver map and the planning map are unchanged without it). Colour AND shape: open = blue circle with number, delivered = dark green circle with number and a check-mark badge, problem = red diamond with number and a "!" badge; the tooltip names the status. Colours are the darker 700 shades (white text contrast >= 5:1).
- Polling: `LiveRefresh` (`components/shared/live-refresh.tsx`) calls `router.refresh()` every interval while the tab is visible (skips ticks while hidden, refreshes at once when the tab becomes visible again). Active on the dashboard unless the tour is COMPLETED, and on the tour page for RELEASED / IN_PROGRESS tours (not for DRAFT/OPTIMIZED: nothing changes there without an admin action; not for COMPLETED, which is final). Interval comes from the server: `LIVE_POLL_INTERVAL_MS` (default 30000, allowed 1000..300000, else default; `.env.example`, `docs/env.md`); it is meant for tests only.
- Strings: `admin.dashboard.today.*`, `admin.tours.progress.*` (de, zh-Hans by hand; Hant generated).
- Tests: `domain/tour-progress.test.ts`, `live-refresh.test.tsx` (interval, disabled, hidden tab, unmount), `today-card.test.tsx` (4 locales: progress, next stop, problems, all done, no tour, not released), `tour-progress.integration.test.ts` (real DB: the driver's `applyStopMutation` moves the read model through delivered / problem / completed; completion time, reason and original text in the plan; authorization: anonymous, driver and a deactivated admin are rejected on `todayProgressQuery`; `tourPlanQuery` was already covered by NUD-042 tests), e2e `tests/e2e/admin-progress.spec.ts` (dashboard + tour page open at 1280 px, driver in a phone context delivers / reports a problem with text via the UI, both admin pages update without reload within one interval, markers carry `data-status` and the check / "!" badges, zh-Hans / HK / TW render the same data, a driver cannot open `/admin`).
- Verified: lint, typecheck, prettier, `i18n:check`, all 68 vitest files (712 tests, DB tests on embedded PostgreSQL), `pnpm build`, e2e `admin-progress` (desktop) with the default 30 s interval and with 5 s, `tours`, `tour-rerelease`, `shells`, `home`; screenshots at 1280 px of dashboard and tour page (start, finished, zh-Hans / HK / TW) inspected, no horizontal scroll asserted.
- NOT verified: real browsers / tile layer (tiles stubbed), the visual of the markers on a real map tile, background-tab throttling in real Chrome / Safari, a long-running session (hundreds of refreshes), screen-reader announcement of the progress bar; Chinese strings are agent-written (NUD-073). Specs that edit the depot via SQL (`tours`, `tour-rerelease`) fail when run after other specs on the same `next start` because the settings cache is warm; run them first or alone (environment note, unchanged behaviour).
- Follow-ups: German translation of the problem text is NUD-072 (the original text is shown today); the offline-queue case (NUD-082) means the admin sees a stop only after the driver's device syncs.

---

#### NUD-060 · MVP demo seed + end-to-end happy path
**Status:** done · **depends_on:** 054

**Goal:** a convincing demo for the client and a regression safety net.

**Scope**
- `pnpm db:seed --demo`: 20 realistic fictional restaurants around the depot (use real public street addresses in the depot city but invented business names), confirmed pins, placeholder photos (generated solid-color images with text "Eingang" / "Parken"), 8 products with all locale names, confirmed orders for the next delivery date.
- Playwright e2e `mvp-happy-path.spec.ts`: admin creates a customer + order → generates tour → releases → driver (mobile project, locale `zh-Hans`) opens tour, opens stop, sees correct quantity, marks delivered → admin sees status.
- Run the same driver part in `zh-Hant-HK`, `zh-Hant-TW` and `de` (parameterized).
- `docs/demo.md`: 5-minute demo script for the client.

**Acceptance criteria**
- [x] E2E passes in CI for all four driver locales. (Passes locally in all four on a fresh build; the CI workflow was extended but not run, no GitHub remote.)
- [x] Demo seed is idempotent (re-running doesn't duplicate data). (Integration test + two CLI runs against s3rver: second run creates 0 rows.)

**Implementation notes**
- `pnpm db:seed --demo [--no-photos] [--today]` (`prisma/seed.ts` -> `server/demo-seed.ts`, data in `server/demo-data.ts`): runs the base seed, then: depot "Nudelfabrik Wien (Demo)", Absberggasse 27, 1100 Wien with a confirmed pin (only while the depot pin is still unconfirmed; a confirmed depot is never overwritten), 20 customers `D-001..D-020` (invented names, real Vienna street addresses, hand-picked pins, `pinConfirmed`, delivery hours, 5 with a note in all four locales), 2 extra products (`RIGA-5`, `GNOC-2`; Hant names via OpenCC, flagged machine) = 8 products, a STORE and a PARKING photo per customer and one CONFIRMED order (1-3 lines, deterministic quantities, half kilos for KG) per customer for the next delivery day (`--today`: today, for a live demo because the driver only sees today's tour).
- Idempotent through natural keys: customer number, SKU, current photo per kind, demo order marker (`internalNote`) with `deliveryDate >= today`. A rerun adds nothing; on a later day after the demo orders' date has passed it adds a fresh set. Rows that exist are never updated (admin edits survive).
- Photos: `server/testing/placeholder-image.ts` is a dependency-free PNG writer with a 5x7 bitmap font (800x600, "EINGANG" blue / "PARKEN" green plus the customer number). They are uploaded through `Storage.createUploadUrl` (presigned PUT) and attached with the normal `addCustomerPhoto` (deterministic UUID keys `customers/<uuid>.png`, so reruns reuse them). Without `S3_*` the seed stops before writing anything with a message (the Fake store is per process and would lose them); `--no-photos` skips photos and needs no S3.
- E2E `tests/e2e/mvp-happy-path.spec.ts` (desktop project, serial): per driver locale (`zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`, `de`; the seeded demo drivers) the admin creates a customer (Fake geocoder, pin confirmed) and an order for TODAY (SPAG 2,5 + PENN 4), generates the tour, assigns the driver and releases; the driver (Pixel 7 context) logs in, sees the tour, opens the stop, the two quantities are asserted (decimal separator per locale), marks delivered; the admin dashboard and tour page show 1 von 1, COMPLETED, stop DELIVERED. Fifth test: a demo customer's photos load (skipped explicitly with a reason when the demo was seeded with `--no-photos`). The spec never edits Settings: it fails up front with a clear message when the depot pin is unconfirmed or another tour exists for today, and removes its own data (`MVP-` customers) before and after.
- CI: `e2e` job runs the suite with `--grep-invert "MVP happy path|demo data"` on the plain seed, then `db:seed --demo --no-photos` and the happy path (the other specs expect an unconfirmed depot, e.g. `settings.spec.ts`; the server is rebuilt/restarted per `playwright test`, so the Settings cache is fresh).
- `docs/demo.md`: 5-minute script with preparation, seeded logins and what to show per minute; `docs/env.md` and README mention the flags.
- Flake fixes found by the regression run: `customer-form.spec.ts` counted `flag-pin-unconfirmed` among hidden elements (Next keeps the visited customer list in the DOM; rows of other specs' unconfirmed customers matched) -> counted among `:visible` only (root cause, not a retry). `orders.spec.ts` / `order-screenshot.spec.ts` picked the second product while the first picker was still closing (strict-mode violation on the placeholder, seen with `--repeat-each=2`) -> each pick waits until the picker is gone.
- Verified: lint, typecheck, prettier, `i18n:check`, all 70 vitest files (722 tests, DB tests on embedded PostgreSQL; new: placeholder image, demo data, `seedDemo` integration), `pnpm build`, CLI seed against s3rver twice (20 customers / 40 photos / 8 products / 20 orders, second run 0 created; no-S3 message; bad flag usage), the 40 stored photo objects are valid PNGs (one inspected visually), happy path x4 locales + demo photos on a fresh build, regression run of all other e2e specs in groups (desktop + mobile, 2 workers; `tours`/`settings`/`tour-rerelease` with 1 worker): all green; `driver-status` and `admin-progress` desktop only.
- NOT verified: CI run (no remote); MinIO / R2 (only s3rver); a real phone; ORS routing (fallback heuristic); the hand-picked coordinates against a real map (approximate, see decision log); Chinese strings are still agent-written (NUD-073); the demo script was written from the UI, not rehearsed with the client.
- Follow-ups: none new that need a ticket; the demo orders are for the next delivery day, the happy path uses today (the driver only sees today's tour).

---

### M2 — Production v1

---

#### NUD-070 · Translator interface + DeepL + OpenCC derivation
**Status:** done · **depends_on:** 003

**Goal:** machine translation for user-generated text, provider-agnostic.

**Scope**
- `Translator` interface: `translate(text, from: Locale, to: Locale): Promise<string>`.
- DeepL implementation (target `ZH-HANS` for Chinese; for Hant targets translate to Hans then OpenCC `cn→hk` / `cn→twp`; source `ZH` → `DE`).
- Fake implementation (`[zh-Hans] …` prefix) for tests / missing key.
- Service `localize(text, sourceLocale): LocalizedText` producing all four locales with `meta.machine` flags.
- Failures never block saving: store source only, mark `pendingTranslation`, retry via a small background job (Vercel cron route, every 10 min).

**Acceptance criteria**
- [x] Unit tests with Fake; DeepL client tested with recorded fixtures. (`translator/translator.test.ts`, `localize.test.ts`; the fixtures are hand-written from the documented DeepL v2 shape, NOT recorded from a live call, see notes.)
- [x] DeepL outage → record saved, retried later (test with failing fake). (`translation-retry.integration.test.ts` on real PostgreSQL: a failing translator -> `localize` saves the source with `pendingTranslation`, the job keeps it pending while the provider is down, a later run fills it.)

**Implementation notes**
- `src/server/translator/`: `types.ts` (`Translator { kind, translate(text, from, to) }`, `TranslatorError` codes `TIMEOUT|NETWORK|HTTP|QUOTA|BAD_RESPONSE|INVALID_INPUT`), `base.ts` (`ChineseAwareTranslator`: German <-> Simplified goes through one provider call, Hant targets are produced from the Simplified answer with OpenCC `cn->hk` / `cn->twp`, Chinese -> Chinese never leaves the process), `deepl.ts`, `fake.ts`, `index.ts` (`getTranslator(env)` singleton + `setTranslatorForTests`), `localize.ts`.
- DeepL: `POST /v2/translate`, JSON body `{text:[…], source_lang: DE|ZH, target_lang: ZH-HANS|DE}`, key in `Authorization: DeepL-Auth-Key …` only, answer validated with zod, 5 s timeout, 1 retry on timeout / network / 5xx / 429 (not on other 4xx; 456 = quota is reported as `QUOTA`). Endpoint: `DEEPL_API_PLAN=free|pro`, default derived from the `:fx` key suffix. Fake: `[zh-Hans] text` / `[de] text` (Hant targets: same prefix, OpenCC-converted text). Missing `DEEPL_API_KEY` -> Fake and one warning, as for the geocoder.
- `localize(text, sourceLocale, {translator?}) : Promise<LocalizedText>` never throws. German source -> one call to Simplified, Hant via OpenCC; Chinese source (any script) -> one call to German, the other Chinese variants via OpenCC. Translated / derived locales get `meta.machine[locale] = true`, the source never. On a provider failure the result is the source (plus the Chinese variants OpenCC can derive offline) with `meta.pendingTranslation = true`; the text is not logged. `completeTranslation(text, translator)` is the reusable core (also used by the retry job): fills only EMPTY locales, never overwrites a hand-written one (a German note with only a hand-written HK text gets Hans from HK without a provider call), clears the flag. NUD-071/072 call `localize()` on save.
- Pending marker: optional `pendingTranslation: boolean` in `LocalizedText.meta` (zod schema + `createLocalizedText` option); no migration, no table (see decision log). Registry `src/server/translation-pending.ts` lists the columns (`Customer.notes`, `Stop.problemNote`) with `find` (Prisma JSON-path filter on `meta.pendingTranslation`) and a guarded `save` (only if the stored text still has the `meta.updatedAt` that was read and is still pending, so an office edit in between wins). A future column with a `LocalizedText` must be added to `PENDING_SOURCES`.
- Job: `retryPendingTranslations({db, translator, limit = 50 per source, timeBudgetMs = 45 s})` in `translation-retry.ts` returns counts per source. A provider error ends the run (records stay pending, next run retries), a refused text (`INVALID_INPUT`) only counts as failed. Route `GET /api/cron/retry-translations` (`src/app/api/cron/retry-translations/route.ts`, logic in `translation-cron.ts`, `maxDuration = 60`), protected by `Authorization: Bearer $CRON_SECRET` (`cron-auth.ts`, constant-time compare, fails closed when the secret is unset -> 401). With only the Fake translator configured the route answers `skipped` and leaves everything pending (it must not "complete" real records with prefixed fake text). `vercel.json` cron `*/10 * * * *`. New env vars `DEEPL_API_KEY`, `DEEPL_API_PLAN`, `CRON_SECRET` in `.env.example` and `docs/env.md` (+ section "Translation retry job"), `docs/deploy.md`; `checkDeployEnv` warns (production only) when `CRON_SECRET` / `DEEPL_API_KEY` are missing.
- Tests (53 new): Fake, DeepL request/response/retry/error mapping, plan resolution, `getTranslator` single warning, `localize` (all source scripts, outage, empty answer, no text in logs), `completeTranslation` (no overwrite), cron auth (wrong / missing / unset secret, route file wired, Fake skip), retry job on PostgreSQL (both columns, outage then recovery, concurrent edit not overwritten, refused text does not block, invalid JSON skipped, limit, time budget), deploy-env warnings.
- Verified: lint, typecheck, prettier on changed files, `i18n:check`, all 74 vitest files (775 tests, DB tests on embedded PostgreSQL), `pnpm build` (route listed as dynamic), and against `next start`: the cron route answers `401` without header and `200 {"status":"skipped"}` with the bearer secret (no DeepL key). No UI, no new mutation, no new strings, schema unchanged (seed unaffected).
- NOT verified: any live DeepL call (no key, by instruction): the request/response shapes are from the documented API (`/v2/translate`, `translations[].text`, `ZH-HANS` target, status 456 for quota) and may differ in detail; Vercel Cron itself (no deployment; Hobby plans only allow daily crons, so the 10 minute schedule needs Pro); the Prisma JSON-path filter at scale (a full scan of `Stop`, fine for this volume); texts translated by the Fake before a key was added stay as they are (they are not pending; NUD-071's "Re-translate" replaces them).
- Follow-ups for the next tickets: NUD-071/072 call `localize()` on save and may show a "translation pending" hint from `meta.pendingTranslation`; NUD-071's editor must set a fresh `meta.updatedAt` on every save (the retry job's guard relies on it) and should clear `pendingTranslation` itself when the office fills the locales by hand.

---

#### NUD-071 · Customer notes translation & multilingual editor
**Status:** done · **depends_on:** 014, 070

**Goal:** drivers read customer notes in their own language.

**Scope**
- Customer form: notes edited in German (source); on save → `localize()`.
- "Translations" tab showing all four versions with "machine-translated" badge; office can edit any version (badge removed for edited ones). "Re-translate" button (warns that manual edits will be overwritten).
- Changing the German source re-translates only machine versions; manual edits are kept but flagged "source changed, check translation".
- Driver stop detail now shows the note in the driver's locale (drop the "DE" badge when a translation exists).

**Acceptance criteria**
- [x] Note "Hintereingang benutzen, nach 10 Uhr klingeln" appears in all three Chinese variants on the driver screen. (e2e `note-translations.spec.ts` with the FAKE translator, no DeepL key: the driver sees `[zh-Hans] Hintereingang benutzen, nach 10 Uhr klingeln` in zh-Hans / zh-Hant-HK / zh-Hant-TW, `<p lang>` = the driver's locale, no "DE" badge; the German driver sees the original. A real DeepL translation was NOT exercised.)
- [x] Manual edit of zh-Hant-HK survives a German source change (with warning flag). (domain + PostgreSQL integration tests and the same e2e: HK text kept, "Quelle geändert, Übersetzung prüfen" badge on HK only, Simplified / Taiwan follow the new German text, the HK driver still reads the hand-written text.)

**Implementation notes**
- Pure rules in `src/domain/note-translations.ts` (14 unit tests): `describeTranslations` (source / machine / manual / empty per version), `mergeSourceChange` (machine and empty Chinese versions take a fresh translation, hand-written ones are kept and flagged `meta.stale[locale]`; provider failed -> machine versions emptied + `pendingTranslation`), `retranslateAll`, `applyTranslationSave` (edits are detected against the STORED text, so an untouched machine version still follows a changed source; an edited one loses the machine flag and the stale flag; `reviewed` clears a stale flag without a text change; `pendingTranslation` is cleared once all three Chinese versions are filled), `changesSource`. All return a new object with a fresh `meta.updatedAt` (NUD-070's retry-job guard). "Hand-written" = non-empty Chinese version without `meta.machine[locale]`; no new column. `localizedTextSchema.meta` gained the optional `stale` record (no migration).
- Server `src/server/customer-notes.ts`: `freshTranslations` (one provider call de -> zh-Hans, Hant via OpenCC `hk` / `twp`; `null` on any provider failure, text not logged), `prepareNotes` (customer form save: empty -> `null`; German unchanged -> stored JSON untouched; changed -> `mergeSourceChange`; no valid stored note -> `localize()` from NUD-070, which never blocks saving), `getNoteTranslations`, `saveNoteTranslations`, `retranslateNote`. `createCustomer` / `updateCustomer` take an optional `{translator, now}` and use `prepareNotes`. Saves from the tab send `baseUpdatedAt`; the write is guarded on `meta.updatedAt` (JSON-path `updateMany`), so a concurrent retry-job write or second office user gives `conflict` instead of being overwritten. Actions `saveNoteTranslationsAction`, `retranslateNoteAction` (zod input, `requireRole("ADMIN")`) and `noteTranslationsQuery` (admin only); authorization test covers anonymous / driver / deactivated admin and checks nothing was written.
- UI: the customer detail page has tabs "Details" / "Übersetzungen" (`tab-details`, `tab-translations`); the tab (`src/components/admin/note-translations.tsx`) lists German (editable source, badge "Vorlage") and the three Chinese versions with badges "maschinell übersetzt" / "von Hand bearbeitet" / "noch nicht übersetzt" and the warning badge "Quelle geändert, Übersetzung prüfen" with a "Als geprüft markieren" button. Typing into a machine version swaps its badge immediately, saving keeps it. "Neu übersetzen" opens a dialog that warns that hand-written versions are lost; if the provider is down nothing is changed and an error toast shows. A "translation pending" hint appears while `pendingTranslation` is set. The customer form still edits only the German note. Strings in `de` + `zh-Hans` (`admin.customers.translations.*`), Hant generated.
- Driver stop detail needed no code change: NUD-052 already picks the note with `pickWithSource` and shows the "DE" badge only when the picked text is German and the UI is not German, so the badge disappears as soon as a translation exists (asserted in e2e; the existing `driver-stop` spec still asserts the badge for a German-only note).
- Tests: 14 domain unit tests, 8 new PostgreSQL integration tests (create translates, outage -> pending, manual HK survives source change + stale + "checked", German edited in the tab, invalid / conflict / not found / no note, re-translate incl. outage, source change during outage, concurrent change) and the authorization cases in `customer-actions.integration.test.ts`; e2e `tests/e2e/note-translations.spec.ts` (desktop project; creates its own customer through the UI, a driver and a released tour of today). Screenshots: `test-results/nud-071-*.png` (tab with machine versions and with the stale flag at 1280 px, re-translate warning, driver screen at 375 px for zh-Hant-HK and zh-Hant-TW).
- Verified: lint, typecheck, prettier, `i18n:check`, all 75 vitest files (797 tests, DB tests on embedded PostgreSQL), `pnpm build`, e2e `note-translations` (desktop, 5x repeated), `customer-form`, `customer-photos`, `customers`, `driver-stop`, `driver-today` (desktop + mobile), `driver-status`, `driver-language-picker`, `orders`, `admin-progress` (desktop), `mvp-happy-path` (demo seed). No 375 px check of the admin tab (admin screens are 1280 px by the DoD).
- NOT verified: any real DeepL translation (no key, by instruction; every translated text in the tests / e2e comes from the Fake translator and carries its visible `[zh-Hans]` prefix); `tours` / `settings` / `tour-rerelease` / other unrelated e2e specs were not re-run; behaviour under two office users editing the same note at the same time beyond the guarded `conflict` (tested at the database level only).
- Known edge case: if the provider is down while the German source changes AND a hand-written Chinese version exists, the machine versions are emptied and marked pending; the retry job (NUD-070, fills only empty locales) then derives them with OpenCC from the hand-written (possibly outdated, flagged) version instead of translating the new German text. "Re-translate" fixes it by hand.

---

#### NUD-072 · Driver problem text → German for office
**Status:** done · **depends_on:** 053, 070

**Goal:** office understands what the driver wrote.

**Scope**
- On problem submission with free text: `localize(text, driverLocale)` (async; never delays the driver).
- Admin tour view shows German translation + "original" toggle.
- Predefined reasons need no translation (already i18n keys).

**Acceptance criteria**
- [x] Driver writes `門口鎖住了，沒人應門` (zh-Hant-HK) → admin sees a German translation and the original. (e2e `problem-translation.spec.ts` with the FAKE translator, no DeepL key: the German text on the admin tour page is `[de] 門口鎖住了，沒人應門`, marked "maschinell übersetzt", and the original is behind "Original anzeigen". A real DeepL translation was NOT exercised.)

**Implementation notes**
- Where the hook sits: `applyStopMutation` (NUD-053) stays free of the translator. For a non-German free text it stores the `LocalizedText` (source = driver locale) with `meta.pendingTranslation = true` in the same transaction; a German note is stored without the flag (German is already what the office reads, nothing to translate, the Chinese variants of a German note are not needed). The translation runs after the commit and outside the driver's transaction: `src/server/problem-note-translation.ts` has `translateStopProblemNote(db, stopId)` (reads the note, `completeTranslation` = one provider call to German + OpenCC variants, saves through `stopProblemNoteSource.save`, i.e. only if the stored text still has the version that was read; never throws, never logs the text; provider failure -> stays pending) and `scheduleProblemNoteTranslation(db, result)` which runs it inside `after()` (`next/server`), so on Vercel the function is kept alive after the response. It does nothing for replays, delivered stops, undo and rejected mutations, and swallows a scheduling failure. `stopStatusAction` calls it after `applyStopMutation`; NUD-082's batch sync should call the same function for each applied entry (`applyStopMutation` itself is unchanged for it). Safety net: if the translation fails or the function dies, the note stays pending and the existing cron job (`Stop.problemNote` in `PENDING_SOURCES`) completes it. An undo (note removed) or a new report (new `meta.updatedAt`) in between wins over a late translation.
- Read model: `PlanStop.problemNote` is now `{ text, locale, german, germanMachine, pending }` (`readProblemNote` in `tour-planning.ts`): original = source-locale value, `german` = the `de` version of a non-German note, `germanMachine` = `meta.machine.de !== false`, `pending` = no German yet and `meta.pendingTranslation`. Authorization unchanged (`tourPlanQuery` is admin only).
- UI: `ProblemNote` (`components/admin/problem-note.tsx`) replaces the inline original text on the tour page: German translation first (`<q lang="de">`, badge "maschinell übersetzt"), a "Original anzeigen / ausblenden" toggle (`aria-expanded`) for the driver's original (label "Originaltext des Fahrers", `lang` = the driver's locale); while the translation is missing a badge "Übersetzung folgt" and the original is shown; a note written in German is shown as before (no badge, no toggle). Strings `admin.tours.progress.{translatedNote,machineTranslated,translationPending,showOriginal,hideOriginal}` (de, zh-Hans by hand, Hant generated). The dashboard card lists only customer + reason of problem stops (no free text), so it needed no change.
- Tests: `problem-note-translation.integration.test.ts` on PostgreSQL (7: pending marker without any provider call, translation after commit incl. Fake `[de]` prefix and original kept, German note not marked / not translated, provider outage -> mutation result unaffected + stays pending + the retry job completes it later, scheduler skips replay / delivered / undo / rejected and survives a throwing scheduler, the server action still succeeds when `after()` is unavailable, an undone report is not overwritten, the plan read model for translated / German / pending), `problem-note.test.tsx` (3 cases x 4 UI locales), e2e `tests/e2e/problem-translation.spec.ts` (desktop: zh-Hant-HK driver on a phone viewport reports CLOSED with `門口鎖住了，沒人應門`, the stored note gets `de`, admin tour page at 1280 px shows the German text + machine badge, toggle shows / hides the original with `lang="zh-Hant-HK"`, zh-Hans UI shows the same, a hand-set pending note shows "Übersetzung folgt" + original; screenshots `test-results/nud-072-tour-{german,original,pending}.png`, inspected).
- Verified: lint, typecheck, prettier on changed files, `i18n:check`, all 77 vitest files (DB tests on embedded PostgreSQL, run in two groups), `pnpm build`, e2e `problem-translation` (desktop), `admin-progress` (desktop, `LIVE_POLL_INTERVAL_MS=5000`), `driver-status` (mobile, 4 locales), `note-translations` (desktop). Everything translated in tests / e2e comes from the Fake translator (visible `[de] ` prefix); a real DeepL translation was NOT exercised.
- NOT verified: a real DeepL call; `after()` on Vercel itself (works under `next start`; a lost task falls back to the cron job, which needs the 10 minute schedule = Pro plan and a DeepL key, with only the Fake translator it skips); the "translation pending" state under a real outage in e2e (pending state is set up by SQL, the outage itself is covered by integration tests); other e2e specs not rerun; Chinese strings agent-written (NUD-073).
- Follow-ups: NUD-082 must call `scheduleProblemNoteTranslation` per applied entry of the batch sync. In production without `DEEPL_API_KEY` the Fake translator would store prefixed text as a "translation" (same as NUD-071 notes); `checkDeployEnv` already warns.

---

#### NUD-073 · 👤 UI string review workflow for native speakers
**Status:** blocked (tooling done; native-speaker review is a human step) · **depends_on:** 003

**Goal:** Chinese UI texts are checked by humans before go-live.

**Scope**
- `pnpm i18n:export` → `i18n-review.csv` with columns: key, de, zh-Hans, zh-Hant-HK (generated), zh-Hant-TW (generated), screenshot route hint, reviewer comment, corrected text per locale.
- `pnpm i18n:import i18n-review.csv` → writes corrections into `zh-Hans.json` or the matching override file; re-runs build.
- `docs/i18n.md`: how to review, which locale files are hand-edited vs generated.

**👤 Human step:** a native reader for Simplified and one for Traditional (HK and/or TW) review the CSV.

**Acceptance criteria**
- [x] Round-trip export → edit → import changes exactly the edited keys (test).

**Human steps (open)**
1. Developer: `pnpm i18n:export`, send `i18n-review.csv` (plus a test deployment or the demo seed login) to the reviewers. See `docs/i18n.md`.
2. Native reader of **Simplified Chinese** reviews the `zh-Hans` column (fills `corrected_zh-Hans` / `reviewer_comment`). Also confirms or replaces the glossary terms (Tour, Stopp, Einheit, ...) used in the Chinese texts.
3. Native reader of **Traditional Chinese for Hong Kong** and one for **Taiwan** (or one person for both) review the generated `zh-Hant-HK` / `zh-Hant-TW` columns and fill `corrected_zh-Hant-HK` / `-TW` only where the machine conversion reads unnatural.
4. Developer: `pnpm i18n:import <returned.csv> --dry-run`, then without `--dry-run`, `pnpm i18n:check`, commit the changed JSON files (never the CSV). Then set this ticket to `done`.

**Implementation notes**
- `pnpm i18n:export [--out f] [--delimiter ";"]` writes `./i18n-review.csv` (gitignored via `/i18n-review*.csv`): UTF-8 BOM, CRLF, RFC 4180 quoting, 689 rows. Columns: key, de, zh-Hans, zh-Hant-HK, zh-Hant-TW, route_hint, reviewer_comment, corrected_zh-Hans, corrected_zh-Hant-HK, corrected_zh-Hant-TW. Hant columns are computed fresh from zh-Hans + overrides.
- `pnpm i18n:import <csv> [--dry-run] [--force]` is all-or-nothing: refuses unknown/duplicate/empty keys, invalid ICU, placeholder names that differ from the German text, and rows whose exported text no longer matches the repository (stale CSV, `--force` overrides). `corrected_zh-Hans` goes to `zh-Hans.json`; Hant corrections go to `overrides/<locale>.json` (sorted keys; removed again if equal to the OpenCC output). Then the Hant files are rebuilt and the whole result is validated like `i18n:check`. Empty correction cells = no change. `,` `;` and tab separators are accepted (German Excel), BOM optional. Reviewer comments are only counted, not stored.
- Code: `scripts/lib/i18n-review.ts` (CSV, export, import), `scripts/lib/i18n-files.ts` (read/write/build, shared with `i18n-build.ts`), `scripts/lib/i18n-routes.ts` (key prefix -> route map; longest prefix wins; one line per new namespace), CLIs `scripts/i18n-export.ts` / `i18n-import.ts`. Test: `scripts/lib/i18n-review.test.ts` (CSV quoting, round trip on a temp copy of `messages/` asserting exactly the edited keys change in each file, refusals, route-hint coverage and stale entries).
- Surprise: with OpenCC `s2twp`, both `保存` and `储存` become `儲存`, so a Simplified edit does not always change the TW text.
- Verified: eslint (0 warnings), `tsc --noEmit`, prettier, `vitest` without database (56 files / 556 tests passed, 22 DB files skipped; this ticket touches no DB code), `i18n:check`, and a manual CLI run (export, edit, import, check, restore).
- NOT verified: opening the CSV in a real Excel / LibreOffice / Google Sheets (only a Python csv round trip and the parser tests); `pnpm` itself (not runnable here, scripts run through `npx tsx`); DB test groups not rerun. **The Chinese UI texts are still agent-written and have NOT been reviewed by anyone.**

---

#### NUD-080 · PWA installability
**Status:** done · **depends_on:** 051

**Goal:** drivers launch the app from their home screen like a native app.

**Scope**
- Web app manifest (`start_url` = driver home, `display: standalone`, theme colors, icons 192/512/maskable), localized `name` via per-locale manifest route.
- Serwist service worker (app shell precache).
- Localized install hint for Android (beforeinstallprompt) and iOS (instructions overlay "Share → Add to Home Screen" with illustration).

**Acceptance criteria**
- [x] Lighthouse PWA installability checks pass for the driver area. (**Real Lighthouse was NOT run** (not installable here). Replaced by Chromium's own installability check via CDP `Page.getInstallabilityErrors` = no errors, plus manifest/icon/SW assertions in `tests/e2e/pwa.spec.ts`; a real Lighthouse run is NUD-105.)
- [x] Installed app opens directly on the driver home. (Verified only that `start_url` = `/<locale>/driver` for all 4 locales and lies inside `scope`; **real installation was not tried**, see NUD-105.)

---

**Implementation notes**
- Manifest: route handler `src/app/[locale]/manifest.webmanifest/route.ts` (prerendered per locale, builder `src/lib/pwa.ts`): localized `name` / `short_name` / `description` (`pwa.*` messages), `start_url` `/<locale>/driver`, `scope` `/`, `display: standalone`, theme `#9a3412` / background `#fff`, icons 192/512 + maskable 192/512. The path contains a dot, so `proxy.ts` skips it: manifest, `/sw.js`, `/offline.html` and `/icons/*` are reachable without a session (e2e checks with a cookie-less request). `src/app/[locale]/driver/layout.tsx` (all driver pages incl. login) adds `manifest`, icons, `apple-touch-icon`, `appleWebApp`, theme colour and mounts `PwaRuntime`.
- Icons: original pasta-bowl glyph in `scripts/lib/pwa-icons.ts`, rendered to PNG by `pnpm pwa:icons` (Playwright/Chromium; PNGs + `icon.svg` committed in `public/icons`).
- Service worker: source `src/sw/sw.ts` (Serwist 9), built AFTER `next build` by `scripts/build-pwa.ts` (esbuild bundle to `public/sw.js`, `@serwist/build` injects the precache list; `build` and `build:vercel` run it; outputs git-ignored). Precache = hashed `.next/static` assets (53 entries, ~2.7 MiB uncompressed incl. admin chunks), icons, generated `public/offline.html`. Driver page navigations are `NetworkOnly` (never stored); when the network fails the precached `offline.html` (generic, texts of all 4 locales from `messages`, language chosen from the URL prefix, no personal data) is shown. Nothing else is cached: no HTML, RSC or API responses (e2e inspects Cache Storage after visiting authenticated pages: only `/_next/static/`, `/icons/`, `offline.html`). Admin navigations and `/api` are untouched. `skipWaiting` + `clientsClaim`. `next.config.ts` serves `/sw.js` with `no-cache`. Registration only in production builds (`PwaRuntime`); `pnpm typecheck` also type-checks the worker (`src/sw/tsconfig.json`, webworker lib).
- Install hint (`components/driver/install-hint.tsx`, rendered in `DriverShell` above the content, state in `lib/install-prompt.ts`): Android/Chromium shows an "Installieren" button after `beforeinstallprompt` (captured in `PwaRuntime`, `prompt()` on tap); iOS (UA / iPadOS detection, moved to `lib/device.ts`) shows "So geht's" which opens an overlay with a Safari-toolbar illustration and 3 steps (Share -> Add to Home Screen -> Add). Hidden in standalone mode and after "Nicht jetzt"/"Verstanden" (remembered in `localStorage` `nudel.driver.installHint.dismissed`; every storage access in try/catch, in-memory fallback). New keys `driver.install.*`, `pwa.*` (de, zh-Hans; Hant generated), route hints added.
- Tests: unit `lib/pwa.test.ts`, `sw/rules.test.ts`, `lib/install-prompt.test.ts`, `scripts/lib/offline-page.test.ts`, `components/driver/install-hint.test.tsx` (4 locales); e2e `tests/e2e/pwa.spec.ts` (16 tests, mobile project, needs a production build): manifest per locale valid + icons are PNGs of the right size + no session needed, SW registers/controls/activated, `Page.getInstallabilityErrors` empty, Cache Storage content, offline navigation shows the offline page (de and zh-Hans), iOS-UA hint + overlay in 4 locales at 375 px without horizontal scroll, dismissal remembered, localStorage blocked, simulated `beforeinstallprompt`.
- Verified: lint, typecheck, `i18n:check`, `pnpm test` (875 passed incl. DB), `pnpm build` (with the fake S3), e2e mobile `pwa` + `shells` + `driver-today` + `driver-stop` + `driver-status` (52 passed); screenshots at 375 px inspected (iOS hint, overlay de / zh-Hant-TW, offline page).
- NOT verified: real Lighthouse; real installation on Android / iOS (Safari, real `beforeinstallprompt`, Add-to-Home-Screen flow, icon masking on launchers); desktop Playwright project for the new spec; HTTPS deployment (only localhost); service worker update behaviour across two deployments; Chinese strings are agent-written (NUD-073).
- Known limits: `start_url` is fixed to the locale of the installed manifest; after switching language the installed app still opens in the old one (NUD-106). The precache contains admin chunks too (shared build output). The connection indicator still shows only `navigator.onLine`.

---

#### NUD-081 · Offline cache of today's tour + photos
**Status:** done · **depends_on:** 080, 052

**Goal:** the driver can work through dead spots.

**Scope**
- Driver tour data served from one endpoint `GET /api/driver/tour/today` (JSON incl. stops, items, localized texts, signed photo URLs with ≥ 12 h validity).
- On load: store tour JSON in IndexedDB and **prefetch all photos** into Cache Storage; show "ready offline ✓" indicator.
- Offline: render from cache, show "offline – last updated 07:12" bar. Online again: refresh in background.
- Cache purge of previous days.

**Acceptance criteria**
- [x] Playwright with `context.setOffline(true)` after load: tour list, stop details and photos still render. (`tests/e2e/driver-offline.spec.ts`, 375 px, production build, real signed URLs against the fake S3: list, two stops with / without photos, a stop not in the cache, 4 locales; list and detail text identical to the online render; "offline - last updated HH:MM" bar; logout, other user and previous day purge the copy.)

**Implementation notes**
- Shared data model `src/lib/driver-tour-model.ts` (zod `driverTourResponseSchema`, `schemaVersion` 1): the API JSON, the IndexedDB record and the input of the pure view functions `toDriverToday(response, locale)` / `toDriverStopDetail(response, stopId, locale, photoUrl)`. `getDriverToday` / `getDriverStopDetail` (server pages) are now built on `getDriverTourResponse` (`server/driver-tour-payload.ts`) + these functions, and the offline shell uses the same functions and the same components (`TodayTour`, `StopDetail`, new prop `offline`), so online and offline render identically (e2e compares texts). Product names and customer notes travel as `LocalizedText` (all locales) and are picked on the device, so the language of an offline page follows its URL. Customer name / address untranslated as before. Changed-tour data of NUD-043 (`revision`, `updated`, `removedCustomers`, `change`, `changedInRevision`, `previousQuantityCents`) is part of the payload (integration + unit tested); the "seen revision" stays in localStorage.
- Endpoint `GET /api/driver/tour/today` (`server/driver-tour-api.ts`): `requireRole("DRIVER")` first, no parameters (driver = session), 401 / 403 JSON otherwise (admin support view gets 403, no tour), `Cache-Control: private, no-store`. Photo URLs: `DRIVER_PHOTO_URL_TTL_SECONDS` = 12 h. Tests: `driver-tour-api.integration.test.ts` (9).
- Browser side `src/lib/offline/`: `store.ts` (IndexedDB, one record per user, rules: other users and other days removed, damaged / old-schema records dropped; memory store for unit tests), `photos.ts` (Cache Storage; photos keyed by the stable same-origin URL `/api/driver/photo-cache/<photoId>`, only missing ones downloaded, obsolete ones deleted, failures counted), `sync.ts` (fetch -> zod -> store -> photos), `browser.ts` (singletons, status store, serialized sync, `purgeOfflineData`). `OfflineSync` (in `DriverShell` for DRIVER users only) syncs at start, on `online`, when visible again, every 5 min, after each status change (`requestOfflineSync` in `StopStatusActions`); after a reconnect also `router.refresh()`. `OfflineStatusBar`: online + tour + ALL photos stored = "Offline bereit ✓"; some photos missing = "teilweise bereit n von m"; offline = amber "Offline - zuletzt aktualisiert 07:12" (factory time zone).
- Offline navigation: the public prerendered page `/<locale>/driver/offline-shell` (no personal data, allowed in `decideAccess`) is precached per locale (`additionalPrecacheEntries`, build id as revision). The worker answers failed loads (also after 8 s) of `/<locale>/driver` and `/<locale>/driver/stops/<id>` with it (Serwist fallbacks, other driver URLs keep the generic `offline.html`). `OfflineDriverApp` reads the URL + IndexedDB and renders list / stop; links trigger a normal page load (Next falls back from the failed RSC fetch), which the worker answers with the shell again; when the `online` event fires the shell reloads into the live page. Photos offline: `<img src="/api/driver/photo-cache/<id>">` answered by a `CacheOnly` route of the worker from the bucket the page filled.
- Purge: `PurgeOfflineData` on the login pages (a login page = no session: covers logout, ended sessions and another driver signing in), IndexedDB + Cache Storage; previous days on every load / sync.
- Offline the status buttons are disabled with a notice (queue = NUD-082); undo is hidden.
- Docs: `docs/offline.md`. Tests: unit `driver-tour-model`, `offline/*`, `sw/rules`, `offline-status` (4 locales); e2e `driver-offline.spec.ts` (11), `pwa.spec.ts` adapted (shell pages in precache, generic offline page now for login URLs).
- Verified: lint, typecheck, `i18n:check`, `pnpm test` (918 incl. DB), `pnpm build` (fake S3), e2e mobile: `driver-offline`, `pwa`, `driver-today`, `driver-stop`, `driver-status`, `shells`, `auth`, `driver-language-picker`; screenshots at 375 px (offline list de, stop de, stop zh-Hant-TW) inspected.
- NOT verified: real phones / Safari (IndexedDB / Cache Storage eviction under storage pressure, iOS PWA, real Wi-Fi drop -> NUD-107); real R2 CORS for the photo download (only the fake S3 with a GET rule); the desktop Playwright project; map tiles offline (NUD-108: the map view shows no tiles offline); a worker update across deployments. In this sandbox Chromium `navigator.onLine` is permanently false and ignores `setOffline`, so the e2e drive it with a test helper (`tests/e2e/helpers/network.ts`); the app does not gate syncing on `onLine`.
- Known limits: the cached statuses are only as fresh as the last sync (before NUD-082 an offline "delivered" cannot be recorded); anyone holding the unlocked phone can open the cached tour offline (as with any logged-in session); the shell does not offer the language switcher offline.

---

#### NUD-082 · Offline mutation queue for stop status
**Status:** done · **depends_on:** 081, 053

**Goal:** "Delivered" taps are never lost.

**Scope**
- IndexedDB outbox of mutations (`clientMutationId`, type, payload, createdAt). UI updates optimistically.
- Sync on `online` event, app focus, and every 60 s; exponential backoff; Background Sync API where supported.
- Server endpoint `POST /api/driver/sync` accepts a batch, idempotent by `clientMutationId`, returns authoritative stop states.
- Conflict rule: server state wins if the stop was changed by admin after the mutation's `createdAt`; driver is shown a notice.
- Pending-count badge in the driver top bar.

**Acceptance criteria**
- [x] Offline: mark 3 stops delivered → go online → server has 3 updates, no duplicates (e2e). (`tests/e2e/driver-outbox.spec.ts`, 375 px, production build: three taps offline, nothing on the server, badge 3, list shows 3/5; after reconnect exactly 3 DELIVERED stops and 3 `StopMutation` rows, `completedAt` = tap time, a reload changes nothing. Integration: `driver-sync.integration.test.ts`, replay of the same batch -> `replayed`.)
- [x] Undo while offline removes the queued mutation instead of sending two. (e2e: outbox empty after undo, no `/api/driver/sync` request answered, no `StopMutation`; unit `planUndo` / controller. Undo of an already confirmed stop while offline queues one undo (e2e).)
- [x] Conflict rule shows a notice (added): office change after the tap -> `changed_by_office`, stop unchanged on the server, notice with the customer name until acknowledged (e2e + integration).

**Implementation notes**
- Server: `POST /api/driver/sync` (`app/api/driver/sync/route.ts`, `server/driver-sync.ts`): `requireRole("DRIVER")` first (401 / 403), JSON only (415), <= 256 KiB (413), strict zod 1..50 entries (400). `applySyncBatch` sorts by effective tap time and calls `applyStopMutation` once per entry (own transaction, advisory lock, idempotent via `StopMutation`); a business rejection never stops the batch, an unexpected error marks that entry and later entries of the same stop `retry`. `scheduleProblemNoteTranslation` runs per applied entry (replays do nothing). Answer: per entry `applied | replayed | rejected(error) | retry`, plus the authoritative status of every stop of the touched tours (own tours only). Contract and pure rules: `src/domain/driver-sync.ts` (no zod, bundled into the worker).
- `applyStopMutation(db, actor, input, now, { clientCreatedAt })`: `now` = effective tap time; with `clientCreatedAt` a stop whose new column `Stop.adminChangedAt` (migration `20261018100000_stop_admin_changed_at`, set by a re-release that changes / adds a stop) is later than the tap is rejected with new error `changed_by_office`. Removed stop -> `not_found`, inactive tour -> `tour_not_active`, closed stop -> `already_completed`: all final rejections, server wins.
- Client `src/lib/offline/`: `idb.ts` (one DB v2: `tours`, `outbox`, `notices`), `outbox.ts` (pure: ordering, `planUndo`, overlay, `settle`, `patchTourStates`, backoff), `outbox-flush.ts` (chunks of 50, 400 -> entry by entry, notices, patches the stored tour copy), `outbox-controller.ts` (state, enqueue with double-tap guard, undo, flush with backoff and rerun, confirmed-state bridge for 20 s), `outbox-browser.ts` (singleton, `useOutbox`, Background Sync registration), `use-overlay.ts`. `StopStatusActions` no longer calls the server action: it enqueues, the stop counts as done at once, next stop opens; buttons work offline (NUD-081 disable removed; amber hint stays). `TodayTour` / `StopDetail` overlay queued taps (`DriverStopDetail.tourStops` added). UI: `PendingBadge` in the top bar, `SyncNotices` (de, zh-Hans by hand, Hant generated; `driver.sync.*`). `OfflineSync` triggers: start, `online`, visible (skip backoff), 60 s, new tap; worker `sync` event (tag `nudel-outbox`) flushes for the user of the stored tour copy and tells open pages.
- The old server action `stopStatusAction` is no longer used by the UI (kept with its authorization tests).
- Tests: unit `outbox`, `outbox-controller` (14), `driver-sync` domain, component `stop-status-actions` (4 locales); integration `driver-sync.integration.test.ts` (27: 3 stops, idempotent replay, order, undo window from tap time, clamping, conflict cases, foreign tour, translation scheduling, retry, route auth / validation) and `adminChangedAt` in `tour-rerelease`; e2e `driver-outbox.spec.ts` (5), `driver-status` / `driver-offline` adapted.
- Verified: lint, typecheck (incl. worker), `i18n:check`, unit + DB tests (stop / driver / tour groups), `pnpm build`, e2e mobile: `driver-outbox`, `driver-status`, `driver-offline`, `driver-stop`, `driver-today`, `pwa`, `admin-progress` (alone), `problem-translation`, `driver-language-picker`, `shells`; screenshots at 375 px (offline stop, badge, list, conflict notice) inspected.
- NOT verified: Background Sync in a browser (the worker code path is only type-checked and bundled; Chromium-only API, not triggered in e2e); real phones / Safari; desktop Playwright project; `mvp-happy-path` and `tour-rerelease` e2e (need the demo seed, not run); admin-progress fails when run in the same session with other specs (several tours today, pre-existing), passes alone.
- Known limits: unsent taps survive logout and are sent after that driver's next login (another driver's entries are dropped after 3 days); a phone clock far off shifts the tap time (clamped to 24 h / now); two tabs may send the same entry (idempotent); a rejected tap is reported once the phone is online again, not at tap time.

---

#### NUD-083 · Driver photo capture / replace
**Status:** done · **depends_on:** 052, 082

**Goal:** drivers keep photos up to date on site (D12).

**Scope**
- On stop detail: "Take photo" for STORE / PARKING (`<input type="file" accept="image/*" capture="environment">`), preview, confirm.
- Uses the NUD-006 pipeline; when offline, the resized blob is queued in the outbox and uploaded later.
- New photo becomes current; admin sees "updated by driver X on date" on the customer page.

**Acceptance criteria**
- [x] Photo taken offline appears on the customer profile after reconnect. (`tests/e2e/driver-photo.spec.ts`, 375 px, production build, real PUT to the s3rver emulator: taken offline via `setInputFiles`, shown at once from the local blob, kept in IndexedDB, nothing on the server; after reconnect exactly one `Photo` with the capture's `clientMutationId`, current, `uploadedById` = driver; the admin customer page shows the decoded image and "Aktualisiert von Fahrer X am ...".)
- [x] Missing-photo placeholder on stop detail offers "Take photo" directly. (Button inside the placeholder, 48+ px, opens the file input with `capture="environment"`; e2e + component test in 4 locales.)

**Implementation notes**
- Server: `Photo.clientMutationId` (unique, migration `20261018110000_photo_client_mutation_id`). `server/customer-photos.ts` now has the shared `attachCustomerPhoto` (storage `head`, key shape, one transaction under the customer row lock, history with `isCurrent=false`, idempotency check under the lock); the admin `addCustomerPhoto` is a thin wrapper. New `server/driver-photos.ts`: `registerDriverPhoto` (DRIVER only, strict zod, customer derived from the stop, stop must be in the driver's own tour with status RELEASED / IN_PROGRESS / COMPLETED and day = today or yesterday in the factory time zone, replay answered even when the tour has been closed since) and `POST /api/driver/photos` (`requireRole("DRIVER")` first: 401 / 403, JSON only 415, <= 8 KiB 413, invalid 400, business rejections are HTTP 200 `{outcome:"rejected", error}`; `private, no-store`). Contract + pure rules in `domain/driver-photo.ts`. `getCustomerPhotos` now returns `uploadedBy` + `createdAt`; the admin slot shows "Aktualisiert von Fahrer X am <date>" for driver photos.
- Client `src/lib/offline/`: `photo-outbox.ts` (pure: entry, supersede rule, what a slot shows, tour copy patch), `photo-outbox-store.ts` (IndexedDB store `photos`, DB v3, blob inside the row), `photo-outbox-flush.ts` (presign -> PUT -> save `storageKey` -> register -> cache blob under the real photo id + patch the stored tour copy -> remove; every step repeatable), `photo-outbox-controller.ts` / `photo-outbox-browser.ts` (same backoff / triggers as the tap outbox, wired into `OfflineSync`, `OfflineDriverApp` and the worker's Background Sync handler), `use-photo-overlay.ts` (object URL from the local blob, "confirmed" overlay for 20 s). UI: `components/driver/driver-photo-slot.tsx` (placeholder with "Take photo", "Replace photo", preview with Use / Retake / Cancel, badges "Wartet auf Versand" / "Gesendet"); top-bar badge counts taps + photos; notices for dropped photos reuse the notice cards (`driver.sync.photoNotices.*`). `docs/offline.md` updated.
- Tests: unit `domain/driver-photo`, `offline/photo-outbox`, `photo-outbox-controller` (13: offline then reconnect, lost answer = same id and no second upload, refused PUT, 5xx backoff, 401 keeps, rejection notice, object_missing, supersede, order, foreign entries, tour copy patch); component `driver-photo-slot` (4 locales); integration `driver-photos.integration.test.ts` (37: anonymous / admin / deactivated, foreign and unknown stops, non-released / old / future tours, time zone, forged keys, invalid input, missing object, key reuse, replay, concurrent retries, other driver's id, history, `uploadedBy`); e2e `driver-photo.spec.ts` (6, mobile 375 px). Existing `driver-stop` and `pwa` e2e adapted (photo frame compared instead of the whole section; the cache-key regex now accepts a build id with a hyphen, which made `pwa` fail for some builds independent of this ticket).
- Verified: lint, typecheck (incl. worker), `i18n:check`, prettier on changed files, unit + DB tests (~1070 passed), `pnpm build` (fake S3), e2e mobile: `driver-photo`, `driver-offline`, `driver-outbox`, `driver-stop`, `driver-status`, `driver-today`, `pwa`, `customer-photos`; screenshots at 375 px (placeholder, preview, offline pending, sent, zh-Hant-TW preview) and the admin profile at 1280 / 375 px inspected, no horizontal scroll.
- NOT verified: a real phone camera (HEIC / large originals, iOS Safari `capture` behaviour, memory use of a 12 MP decode); real R2 CORS for the browser `PUT` (only s3rver); Background Sync path of photos in a browser (bundled and type-checked only); the desktop Playwright project; Chinese strings are agent-written (NUD-073). `driver-outbox` "undo while offline" failed once when run in the same session as `driver-offline` (waiting for "offline ready" after reconnect) and passed alone and on a repeat; not investigated.
- Known limits / follow-ups: an object uploaded but never registered (photo dropped by a final rejection) stays orphaned in storage (cleanup belongs with NUD-094, as for NUD-015); a photo for a stop the office removed from the tour in the meantime is rejected with a notice (the picture is lost); the preview shows the re-encoded JPEG, there is no crop / rotate; no limit on queued photos besides the device's storage.

---

#### NUD-090 · Customer import (CSV/XLSX) with pin review
**Status:** done · **depends_on:** 014

**Goal:** bring the factory's existing customer list into the system.

**Scope**
- `/admin/customers/import`: upload CSV/XLSX (SheetJS), column mapping UI (remembered), preview with row-level validation errors.
- Import creates/updates customers (match by customer number), `pinConfirmed=false`.
- Batch geocoding (rate-limited, progress bar).
- **Pin review queue:** step through imported customers, see candidate pin on map, confirm/drag/skip.

**Acceptance criteria**
- [x] Import of a 150-row file with 3 invalid rows imports 147 and reports the 3 with reasons. (Domain, integration and e2e tests; reasons carry the file row.)
- [x] Re-importing the same file updates instead of duplicating. (Second import: 147 unchanged, 0 new; a changed file updates the matching rows.)

**Implementation notes**
- Page `/admin/customers/import` (button on the customer list): wizard file -> column mapping -> preview -> result + batch geocoding; `/admin/customers/import/review`: pin review queue. Code: pure rules in `src/domain/import-file.ts` (limits, BOM / UTF-16 / windows-1252 decoding, RFC 4180 parser with `,` `;` TAB detection, zip directory check) and `src/domain/customer-import.ts` (header synonyms DE/EN/ZH, mapping checks, cell cleaning, formula check, country names, DE postal code padding, `planImport` = create / update / unchanged / error per row, reusing `addressChanged` from NUD-014); server `src/server/customer-import-upload.ts` (route `POST /api/admin/customers/import/parse`), `import-xlsx.ts` (exceljs), `customer-import.ts` (preview / commit), `customer-pins.ts` (batch geocoding, review queue, confirm), `customer-import-actions.ts` (server actions), `throttle.ts`.
- Library: SheetJS from its CDN is blocked here and the npm `xlsx` 0.18.5 is the outdated, vulnerable copy, so XLSX is read with `exceljs` 4.4.0 (CSV by own parser, no extra package). `pnpm audit --prod` flagged its transitive `uuid` (<11.1.1), so `pnpm-workspace.yaml` has an override `uuid: >=11.1.1` (audit clean). Only `.xlsx` (no legacy `.xls`); first non-empty sheet; number cells with a `00000` format keep their zeros; formula cells use their cached result, formula text is never imported.
- Security: ADMIN only (route and every action call `requireRole("ADMIN")` first; tests for anonymous / driver / deactivated admin); upload <= 5 MB read with a cap (413), <= 2000 data rows, <= 50 columns, <= 2000 characters per cell, XLSX zip directory checked before inflating (<= 200 entries, <= 50 MB declared, no ZIP64 / encryption). CSV injection: a cell starting with `=` `@` TAB CR, or `+`/`-` followed by something other than a number / phone text / space, makes the row invalid; invisible and control characters are removed. The browser only sends the mapped cells back; the server cleans, validates and plans them again (and runs `customerInputSchema` before every create).
- Matching and updates: by customer number, case-insensitive, stored spelling kept. Updates change only the cells that differ; empty optional cells (country, delivery hours, notes) never erase data. New customers: `pinConfirmed=false`, no pin. Changed address (NUD-014 `addressChanged`): pin and confirmation are dropped; unchanged address keeps both. Updates are guarded by `updatedAt` (an admin edit during the import makes that row fail with a message instead of being overwritten). Archived customers are updated but stay archived. Notes are stored German-only with `pendingTranslation` (the NUD-070 retry job translates), no translator call per row. `searchText` comes from the NUD-013 trigger.
- Batch geocoding: browser loops over batches of 5 ids (progress bar, cancel); the server calls the geocoder one at a time with a process-wide throttle (700 ms with `ORS_API_KEY`, `GEOCODE_BATCH_DELAY_MS`), stops at 429 / 403 (rate or quota) or after 3 failures in a row and logs a summary line (no addresses). The best candidate becomes the stored, unconfirmed pin; never overwrites a pin that exists.
- Pin review: queue = all active customers with `pinConfirmed=false` (not only the last import), ordered by number; confirm (optionally after dragging or typing coordinates), skip (client side, "review skipped" starts another round), search other candidates via `geocodeAddressAction`. Confirming is version-checked (`updatedAt`), so a customer edited meanwhile gives a "reload" message.
- Mapping memory: `localStorage` (header text per field, per browser), proposals fall back to header synonyms.
- Fixtures: `src/domain/testing/import-fixtures.ts` (generated, fictional), `scripts/generate-import-fixtures.ts` -> `tests/fixtures/customers-150.csv` / `.xlsx` (a unit test keeps the committed CSV in sync).
- Tests: `domain/import-file.test.ts`, `domain/customer-import.test.ts` (150 rows -> 147 + 3, re-import, umlauts, Chinese, BOM, `;`, leading zeros), `server/customer-import-upload.test.ts` (route, XLSX, zip bomb), `customer-import.integration.test.ts` (authorization, commit, re-import, pin reset, race, geocoding, review), `throttle.test.ts`, `scripts/generate-import-fixtures.test.ts`, e2e `tests/e2e/customer-import.spec.ts` (150-row upload, mapping, preview, import, geocoding with the Fake, re-import, address change, pin review confirm / type / drag / skip, conflict, 401 for anonymous, mobile layout). Screenshots at 1280 px inspected (preview, review).
- NOT verified: real ORS geocoding / rate limits (Fake only); a file exported by real Excel (XLSX written by exceljs and CSV by hand only; real German Excel `;` CSVs in cp1252 are covered by a unit test); a decompression bomb whose zip directory lies about sizes (only the row / column / cell limits stop it); the 1 MB server-action body limit for very wide 2000-row files (typical 150-2000 rows are well below); Chinese strings are agent-written (NUD-073).
- Follow-ups: a cleanup of old pending uploads is not needed (nothing is stored); the review queue has no "previous" step and no persisted skip list.

---

#### NUD-091 · Packing list / load sheet print view
**Status:** done · **depends_on:** 041

**Goal:** load the van correctly before departure.

**Scope**
- `/admin/tours/[id]/print?locale=…`: print-optimized page (A4, print CSS).
- Section 1: **totals per product** for the tour.
- Section 2: per stop in **reverse order** (last stop first = load first): sequence, customer, items.
- Product names in chosen locale + German; locale selectable so it can be printed for the driver.

**Acceptance criteria**
- [x] Totals equal the sum of all stops (unit test on the shared aggregation function). (`domain/load-sheet.test.ts`: 30 stops, per-product sums, grand total, same result as `sumQuantities` of the order overview, exact hundredths, different units never merged; `server/tour-print.integration.test.ts`: totals of a real 30-stop tour equal the DB sums of the confirmed orders; e2e compares the printed totals with the seeded numbers.)
- [x] Print preview fits on A4 without cut-off columns for 30 stops (multi-page OK). (e2e `load-sheet.spec.ts`: `page.pdf({format:"A4"})` in all four locales = 4 pages (de) / 5 pages (zh), page size A4 per `pdfinfo`, text of first and last stop present in the PDF text layer; in print media at the A4 content width (186 mm) no cell overflows and the document does not scroll horizontally; rendered PDF pages inspected as PNG for de and zh-Hans.)

**Implementation notes**
- Route `src/app/[locale]/admin/(print)/tours/[id]/print/page.tsx`. To keep the admin shell (sidebar, header, user menu) off the sheet the admin section was split into route groups: all existing admin pages and the old `admin/layout.tsx` moved UNCHANGED into `admin/(shell)/` (URLs are the same, pure `git mv`), and the new `admin/(print)/layout.tsx` has the same ADMIN gate (`requirePageActor("admin")`, page repeats it) without `AdminShell`. New admin pages made for paper belong in `(print)`.
- Quantities: the sheet reads the TOUR's own quantities (`Stop.items`, the snapshot written by the builder and by re-release, exactly what the driver sees), never the live order lines. `server/tour-print.ts` `getTourPrint(db, id)` (stops in delivery order, customer, product rows with name `LocalizedText` / SKU / unit / sortOrder, driver name, depot snapshot, `isOutdated`, `releaseRevision`, status); `tourPrintQuery(tourId)` in `tour-queries.ts` = `requireRole("ADMIN")` first, unknown or malformed id -> `null` -> `notFound()` page.
- Outdated warning: if `Tour.isOutdated` (orders changed since the tour was built or released) there is a red alert in the screen toolbar (UI language, tells the office to review and re-release) AND a heavy-bordered banner on the paper in the print language ("do not load before the tour is released again"). The numbers stay the tour's, they are never silently replaced by newer ones. Draft / optimized tours print too and say "not released yet".
- Shared aggregation: `sumQuantities(lines)` added to `domain/order-overview.ts` (exact hundredths per product AND unit); `aggregateTotalsByDate` (NUD-032) now uses it, and `domain/load-sheet.ts` `loadSheetTotals(stops, products)` (section 1, sorted by unit then catalog order) and `loadOrder(stops)` (section 2: reverse sequence, `loadPosition` 1..n) are built on it. Different units are never added; a product that is no longer found keeps its quantity (no unit text) instead of being dropped.
- Locale (two options since NUD-134): `?locale=` is resolved by `parseSheetLocale` (`lib/load-sheet-locale.ts`): `de` -> German, any `zh…` tag (`zh`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`) -> the simplified `zh-Hans` sheet, anything else (missing, empty, `en`, wrong case, repeated, junk) -> German, never the locale of the page URL. The sheet renders with `getTranslations({locale})` / `getFormatter({locale})` in that language (`<article lang=…>` so CJK glyphs are right); the toolbar (back, the two own-script language links, Print) stays in the admin's UI language and marks the current option with `aria-current="true"`. Product names: `productLabel(name, sku, locale)` (`lib/product-label.ts`) = name in the print locale (usual fallback chain, SKU if nothing) plus the German name in small type when the sheet is not German and differs; the 中文 sheet therefore keeps the German product name in small type. Customer name / address are never translated. Units from `common.units`. The three regional Chinese UI locales no longer have their own printout option (the Hant message files are generated from the simplified ones); the toolbar's hardcoded white card, which made its theme-coloured buttons unreadable in dark mode, stays replaced by `bg-card text-card-foreground`.
- Layout: header (title, delivery date, driver or "no driver", depot, number of stops + release version), section 1 table (product, total + unit), section 2 table (load position, original stop number, customer + number + address, one line per product with quantity). Print CSS (`globals.css`, `.load-sheet*`): `@page { size: A4; margin: 12mm }` set by the page only, `thead` repeats on every page (`display: table-header-group`), `tr` / `li` `break-inside: avoid` (no row is split), fixed column widths with word wrap, black on white regardless of dark mode; toolbar `print:hidden`. Button "Ladeliste drucken" (`data-testid="tour-print-link"`) in `TourPlanner` for every tour with stops; "Drucken" calls `window.print()`.
- Pre-existing bug fixed: the NUD-008 print rule `@media print { body * { visibility: hidden } … }` blanked EVERY printed page of the app (the first PDF of the load sheet was empty). It is now scoped with `body:has(.pin-sheet)` so it applies only while the PIN dialog is open; `drivers.spec.ts` got a print-media assertion for it.
- Strings: `admin.tours.print.*` (de, zh-Hans by hand, Hant generated), 25 keys.
- Tests: `domain/load-sheet.test.ts` (8), `domain/order-overview.test.ts` (unchanged, still green), `lib/product-label.test.ts` (4), `server/tour-print.test.ts` (locale / id parsing), `server/tour-print.integration.test.ts` (5: read model, 30-stop totals vs DB, snapshot kept after an order change + `isOutdated`, unknown / malformed ids, authorization: anonymous, driver, deactivated admin rejected), e2e `tests/e2e/load-sheet.spec.ts` (anonymous -> login; link from the tour page; no shell; totals vs seeded numbers; reverse order 30..1; Print button calls `window.print()`; 4 locales incl. German name next to the Chinese one, print-media overflow check at 186 mm, A4 PDF with pdfinfo + pdftotext (not blank); invalid locales fall back; unknown tour -> not-found page; outdated warning on screen and in print media; a driver is redirected away).
- Verified: lint, typecheck, prettier on src / messages / tests, `i18n:check`, `pnpm test` (779 unit + 30 integration files on embedded PostgreSQL, all green), `pnpm build`, e2e (desktop, with the fake S3): `load-sheet`, `drivers`, `tours`, `tour-rerelease`, `shells`, `order-overview`, `products`, `home`, `auth`. PDFs / screenshots in `test-results/nud-091/` (screen at 1280 px for all four locales, outdated state, A4 PDFs); PDF pages for de (4 pages) and zh-Hans (5 pages) rendered with `pdftoppm` and inspected: headers repeat on each page, no row is split, nothing is cut off, Chinese glyphs render (Noto CJK is installed here).
- NOT verified: a real printer / the browser's own print dialog and its margin / scale settings (only Chromium's `page.pdf` and print-media emulation); Safari / Firefox print engines (`break-inside` on table rows and `thead` repeat are standard but untested there); Chinese strings are agent-written (NUD-073); the mobile Playwright project (the sheet is a desktop / paper page); `tour-rerelease` and `shells` failed once when run in parallel with each other (shared depot flag / missing fake S3) and passed alone with the fake S3, as in earlier tickets; `docs/i18n.md` and `pw.local.config.ts` still fail `prettier --check` (not touched here).
- Follow-ups: none needed for the ticket. Possible later: a tick-off box per line for the loader, driver-facing print of the same sheet from the driver app (not asked).

---

#### NUD-092 · Audit log for orders and tours
**Status:** done · **depends_on:** 032, 043

**Goal:** answer "who changed this quantity and when?".

**Scope**
- `AuditLog` model + migration; written in the service layer for order create/update/cancel, tour generate/reorder/release, stop status changes, photo replacements.
- Order detail and tour detail show a compact history timeline.

**Acceptance criteria**
- [x] Changing an order quantity creates one audit entry with before/after diff.

**Implementation notes**
- `AuditLog { id, actorId, entity, action, entityId, diff Json, createdAt }` (migration `20261018120000_audit_log`). `entity` / `action` are plain strings validated in code (`src/domain/audit.ts`: vocabulary, `sanitizeAuditDiff`, `diffOrderUpdate`, pure + unit-tested); a Postgres trigger refuses UPDATE and DELETE, and there is no update/delete path in the code (`src/server/audit-coverage.test.ts` scans for it). `actorId` is deliberately not a foreign key (users are archived, never deleted; history must outlive the row, and e2e fixtures delete their users).
- Writing: `recordAudit(tx, {actorId, entity, entityId, action, diff})` in `src/server/audit.ts`, always called with the transaction client of the change, so entry and change commit or roll back together. Diffs hold ids and values only (quantities in hundredths, enum values, ISO dates); names are resolved when the history is read. `sanitizeAuditDiff` drops keys like password/hash/secret/token/signature/url, truncates text to 200 characters and lists to 200 items. Driver problem notes are stored truncated; no storage keys or URLs for photos (only photo ids).
- Covered: `order.create|update|cancel|duplicate` (an update that changes nothing writes no entry; one entry per save with status / date / note changes and per-product before/after), `tour.generate|reoptimize` (rebuild of an existing tour, incl. locked extension), `tour.reorder|lock|unlock|assign_driver|release|rerelease` (re-release incl. the "only clears the outdated flag" variant, with per-customer quantity before/after), `stop.delivered|problem|undo` (written inside `applyStopMutation`; offline-synced entries carry `via: "sync"` and `clientCreatedAt` = the tap's effective time, tour status changes ride along as `tourStatus`; replays and rejected mutations write nothing), `photo.add|replace` (written inside the shared `attachCustomerPhoto`, so office upload and driver capture are both covered; driver photos carry `stopId` / `tourId`). Signature changes: the `*With` tour functions and `updateOrder` / `cancelOrder` now take the acting admin id (`actorId` in the deps objects of the builder, reorder and re-release).
- Not audited on purpose (listed with reasons in the coverage test): `markOutdatedForDate` and automatic tour progress (always part of an audited order / stop change), the background German translation of problem notes, demo-seed and test helpers. Demo seed photos go through `addCustomerPhoto` and therefore create `photo.add` entries by the seed admin.
- Reading: `src/server/audit-history.ts` builds the timeline entries (names resolved, newest first, max 200), `src/server/audit-queries.ts` exposes `orderHistoryQuery` / `tourHistoryQuery` behind `requireRole("ADMIN")`. UI: `AuditTimeline` (`src/components/admin/audit-timeline.tsx`, strings in `admin.history`, de + zh-Hans, Hant generated) at the bottom of the order detail page and below the planner on `/admin/tours` (the tour's own entries plus every entry whose diff names the tour: stop status changes and driver photos). Each entry: localized action, time, actor name with "Büro / Fahrer", details (quantities as `2,5 → 3,75 Packung` with the product name in the viewer's language). There is no separate tour detail page in v1; the planning page is the tour detail.
- Tests: unit (`audit.test.ts`), integration (`audit.integration.test.ts`: every action above, atomicity with a failing hook, admin-only reads, append-only trigger, scrubbing), coverage scan, e2e (order edit shows exactly one entry `Spaghetti 5 kg: 2,5 → 3,75 Packung`; tour planning page lists generate / lock / reorder / driver / release); both at 1280 px, order spec also at the mobile project. Screenshots: `test-results/nud-092-order-history-1280.png`, `test-results/nud-092-tour-history-1280.png`.
- Follow-ups: customer detail has no history view (photo entries are only visible in the tour timeline of the driver's tour); retention of the audit log is for NUD-093's `docs/privacy.md` (see the note added there). Audit entries of PIN resets / user management (mentioned in NUD-008 notes) are not part of this ticket's scope and are not written.

---

#### NUD-093 · Security hardening
**Status:** done · **depends_on:** 060

**Scope**
- Automated authz test matrix: every server action / route handler × {anonymous, driver, admin} → expected result.
- Security headers (CSP incl. map tile + storage domains, HSTS, frame-ancestors none, referrer policy).
- Signed URL lifetimes reviewed; bucket not public.
- `pnpm audit` in CI (fail on high/critical).
- Input size limits on all text fields; zod everywhere.
- Personal data overview in `docs/privacy.md` (what is stored, where, EU hosting, retention: screenshots deleted after 180 days via cron – configurable); the audit log (NUD-092: ids, quantities and driver problem notes truncated to 200 characters, no names) is append-only, so state a retention period and how it is enforced, e.g. a cron that deletes entries older than N months as the only delete path, which must also lift the append-only trigger deliberately).

**Acceptance criteria**
- [x] Authz matrix test passes and covers 100 % of server actions/route handlers (enforced by a test that enumerates them).


**Implementation notes**
- **Authorization matrix** (`src/server/authz-matrix.test.ts`, plain `pnpm test`, no database): 41 server actions and 13 route handler methods x {anonymous, driver, admin} (+ a deactivated admin, a driver whose DB role changed, the real Auth.js session endpoint, the cron bearer secret). `getDb()` is a stub whose only working call is `user.findUnique`, so "allowed" means "passed `requireRole`". A second test enumerates every export of a `"use server"` module and every `route.ts` method under `src/app` from the source tree and fails for a missing row, a stale row, an inline `"use server"` or an export form it cannot read. Mutation-checked: removing a `requireRole` from one action turns three tests red. `vitest.config.ts` inlines `next-auth` (it imports `next/server` without extension, which Node's ESM loader rejects) so the real Auth.js handlers run in the test.
- **Security headers** (`src/lib/security-headers.ts`, applied to `/:path*` in `next.config.ts`, `poweredByHeader: false`): CSP, HSTS (2 years, `includeSubDomains`, no `preload`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (`camera=(self)`, rest off), COOP `same-origin`. CSP is built from `MAP_TILE_URL` (`{s}` becomes a wildcard) and `S3_ENDPOINT` / AWS host; `CSP_REPORT_ONLY=true` switches to report-only; violations go to the new public `POST /api/csp-report` (size-limited, always 204, one sanitized log line, query strings removed). Scripts keep `'unsafe-inline'` (see decision log); everything else is locked down. Under the enforcing policy the whole desktop e2e suite passes and the server log has no `[csp-violation]`; the only violation found was zod 4's `new Function("")` JIT probe in the client bundle, fixed with `z.config({ jitless: true })` in `src/instrumentation-client.ts`. New e2e `security-headers.spec.ts` (headers on pages, API, static files and the worker; zero CSP violations on login, admin pages, Leaflet maps, driver pages and offline shell; session cookie HttpOnly + SameSite=Lax; foreign Origin refused; open-redirect `callbackUrl`).
- **CSRF / route handlers:** `src/server/csrf.ts` (`rejectCrossOrigin`, after the role check) on `/api/uploads`, `/api/admin/customers/import/parse`, `/api/driver/sync`, `/api/driver/photos`: foreign `Origin` or `Sec-Fetch-Site: cross-site/same-site` -> `403 bad_origin`; requests with neither header (not a browser) pass. Server actions rely on Next.js' own Origin/Host check; Auth.js has its CSRF token (tested without it); `/api/session-ended` (GET, deletes only the caller's cookie) and the cron routes (bearer secret) are not state-changing for a forged browser request.
- **Input limits:** `readTextLimited` (`src/server/http-body.ts`) reads JSON bodies by bytes while streaming (uploads 2 KiB, sync 256 KiB, photos 8 KiB; `/api/uploads` had no limit at all). `uploadRequestSchema` is strict with `contentType` <= 100. `src/server/input-limits.test.ts` scans every `z.string()` / `z.array()` under `src/server`, `src/domain`, `src/lib` and fails for an unbounded one; schemas of server-written data (stored JSON, API responses, ORS / DeepL answers) are exempt through allow-list entries or `// unbounded-ok-start|end` markers with a reason. All other inputs already had `.max()` / regexes; unknown keys are stripped (not rejected) on form schemas, strict on the id-only and API schemas.
- **Signed URLs:** reviewed, unchanged: upload PUT 5 min, admin / stop-page reads 1 h, driver tour copy 12 h; pinned by `url-lifetimes.test.ts`, documented in `docs/deploy.md` section 11.2. Bucket privacy: documented (section 3 step 3 + 11.3) and `scripts/check-storage-private.ts` (anonymous listing / object GET must be 401/403); **not run against the real R2 bucket** (no production), only written and reasoned.
- **Dependencies:** `pnpm audit` reached the registry: 1 high (`braces` <= 3.0.3 via `eslint-config-next`, no patched release, dev tooling only, `pnpm audit --prod` clean). Accepted with `auditConfig.ignoreGhsas` + reason in `pnpm-workspace.yaml`; CI runs `pnpm audit --audit-level=high` after install.
- **Retention:** `GET /api/cron/retention` (daily 03:17 UTC, `CRON_SECRET`, fail closed) deletes screenshots older than `SCREENSHOT_RETENTION_DAYS` (default 180, 1..3650, invalid -> 180): storage object first, then row (`Order.screenshotId` becomes NULL by FK), 100 per run, a failed item stays for the next run; also deletes `LoginAttempt` rows older than 24 h (IP addresses). Unit tests (boundary at exactly 180 days, order of operations, failure paths, auth) and a DB integration test. `docs/privacy.md` (new): hosting, data inventory, retention, recipients (DeepL, ORS, tile provider), what is not collected (GPS, D19), audit-log retention design (append-only trigger, intended deletion job not implemented), open decision for orders / tours. `docs/env.md`, `.env.example`, `docs/deploy.md` section 11 and `AGENTS.md` updated.
- **Reviewed, no change needed:** login rate limiting (5 per user / 20 per IP per 15 min, DB backed, constant-time bcrypt for unknown users; client IP = first `x-forwarded-for` entry, trustworthy on Vercel only - documented); Auth.js session cookie (HttpOnly, SameSite=Lax, Secure on https, asserted in e2e); open redirects (`postLoginPath` fuzz test with 15 hostile values + e2e); SSRF (the app never fetches a URL taken from user data or from an imported file; ORS / DeepL hosts are fixed); CSV injection (there is no CSV export in the app; imports reject formula-like cells, NUD-090); error messages (health returns statuses only, server actions return codes, Next hides action error text in production, `error.tsx` is generic).
- **Fixed on the way:** `tests/e2e/customer-import.spec.ts` "review queue" test had a check-then-click race (clicked a skip button that was replaced by the summary and then hung for 180 s); it now waits for either state.
- Not verified: real browsers (only Chromium via Playwright, desktop project; the mobile project and iOS Safari were not run), Vercel serving the config headers, HSTS / CSP on the real domain, Neon, R2 bucket privacy and lifecycle rule, DeepL / tile-provider contracts (marked "to confirm" in `docs/privacy.md`).
- Follow-ups: NUD-110 .. NUD-113.

---

#### NUD-094 · Monitoring, backups, error pages, runbook
**Status:** done · **depends_on:** 007

**Scope**
- Sentry (optional via `SENTRY_DSN`) for server + client errors; source maps uploaded.
- Neon point-in-time restore documented; weekly logical backup (`pg_dump` via GitHub Action to R2) with 8-week retention.
- Localized friendly error pages (driver: "Something went wrong – your data is safe, try again").
- `docs/runbook.md`: deploy, rollback, restore DB, rotate keys, reset admin password, what to do if ORS/DeepL is down.

**Acceptance criteria**
- [x] A forced test error appears in Sentry (when DSN set). *Substitution: verified against a local mock ingest speaking the Sentry envelope protocol (`scripts/mock-sentry-ingest.ts`, `tests/e2e/sentry-ingest.spec.ts`, 3/3 with a DSN build): forced error, `mode=throw` via `onRequestError`, a page error and a real browser error arrive, scrubbed, with no CSP violation. A real Sentry project was not available: NUD-114.*
- [x] Backup workflow produces a restorable dump (documented test restore). *Substitution: the same script the workflow runs (`pnpm backup:db`, `pnpm backup:verify`) was run with real `pg_dump`/`pg_restore` 16 against embedded PostgreSQL 16 and a local S3 server (dump, upload, size check, prune, restore into an empty database, checks); documented in `docs/runbook.md` section 5. The GitHub workflow itself and real R2/Neon were not run: NUD-114.*

**Implementation notes**
- **Sentry** (`@sentry/nextjs` 11.8.0, errors only; no tracing/replay/profiling): optional and dynamic. `src/instrumentation.ts` (`register`, `onRequestError`) loads `sentry.server.config.ts` only for a valid `SENTRY_DSN`; the browser part is in `instrumentation-client.ts` behind `NEXT_PUBLIC_SENTRY_DSN` (inlined from `SENTRY_DSN` by `next.config.ts`; Turbopack removes the branch, checked: no Sentry in `.next/static` without a DSN). Server action / page errors are reported once (server via `onRequestError`; the client reports only errors without a digest, `monitoring-client.ts`). `serverExternalPackages: ["@sentry/nextjs"]`.
- **Scrubbing** (`src/lib/sentry-scrub.ts`, `beforeSend` + `beforeBreadcrumb`, unit-tested): no user record / IP, request keeps only method, URL without query, user-agent, accept-language; no body, cookies, headers, `server_name`; sensitive keys (password, pin, token, cookie, auth, signature, session ...) redacted in extra/contexts/tags; URLs, bearer tokens and signatures inside messages redacted; console breadcrumbs dropped; offline noise (`Failed to fetch`, `Load failed`, aborted ...) not sent. The e2e checks real events for personal data.
- **CSP:** the DSN origin is added to `connect-src` by `security-headers.ts` (tested). Service worker: does not intercept ingest; offline events are lost by design (documented). Precache grows by about 550 KiB uncompressed (76 -> 80 entries) in DSN builds.
- **Source maps:** `withSentryConfig` (from `@sentry/nextjs/config`) is applied only when `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are all set; maps are deleted after upload, no tunnel, telemetry off. `deploy-env` warns on an invalid DSN or a partial config.
- **Test error:** `GET /api/monitoring/test-error` with `Authorization: Bearer $CRON_SECRET` (fail closed; `{status:"disabled"}` without DSN; `?mode=throw` exercises the automatic hook). Rows in the authz matrix (`SECRET_ONLY`) and in the "exactly the bearer secret" list; unit tests with a mock `captureException`.
- **Error pages:** `driver/error.tsx`, `driver/(app)/error.tsx` (shell and offline sync stay mounted), `admin/error.tsx`, `admin/(shell)/error.tsx`, `global-error.tsx` (own `<html>`, texts from generated `src/lib/fatal-messages.json`, checked fresh by `i18n:check`). Driver page: "data is safe, try again" + retry (`router.refresh()` + `reset()`); **offline** it shows a calm no-connection page, reloads (service worker serves the shell) and reloads itself when the connection returns. Admin page shows the digest as a reference, never the message. de + zh-Hans by hand (`errorPages.*`), Hant generated; Chinese agent-written (see NUD-073). e2e `error-pages.spec.ts` (desktop + mobile, de/zh-Hans, offline switch) uses hidden pages enabled only by `ENABLE_ERROR_TEST_PAGES=true` (set in CI e2e; the production build check rejects it).
- **Backups:** `.github/workflows/backup.yml` (Sundays 02:23 UTC + manual; environment `backup`; job *backup* then job *verify* which restores into a disposable `postgres:16`). `scripts/backup/*` + `scripts/lib/backup.ts`: `pg_dump --format=custom` (version must be >= server, checked), password only via `PG*` env (not argv), `LoginAttempt` data excluded, dump sanity (size, TOC must contain `_prisma_migrations`, User, Settings), sha256, upload, HEAD size check, **then** prune (keep 8 weeks, never fewer than the newest 4, only files matching the naming scheme); pooled Neon URLs rejected. `pnpm backup:verify` refuses protected or non-empty targets and restores in one transaction. Tests: 12 unit + 4 integration with real pg_dump/pg_restore. Neon point-in-time restore and the full restore procedure + quarterly drill: `docs/runbook.md` sections 4-5, `docs/deploy.md` section 13 (one-time setup with the scoped secrets: separate R2 bucket and token, read-only `backup_reader` role).
- **Admin password reset:** `pnpm admin:reset-password --email ...` (`scripts/admin-reset-password.ts`, `src/server/admin-password.ts`): password from `ADMIN_NEW_PASSWORD`, hidden prompt (twice) or first stdin line, never an argument; admin role only; clears that account's lockout; prints host/db only; non-TTY needs `--yes`. Integration-tested including that the CLI output never contains the password.
- **Orphaned objects (follow-up of NUD-015/083):** implemented. `GET /api/cron/orphan-cleanup` (Sundays 04:07 UTC, bearer secret). Default `ORPHAN_CLEANUP_MODE=dry-run`; delete mode only after the operator switches it. Safeguards: grace period (default 14 days, minimum 7), only keys of the app's two key shapes, referenced objects kept (re-checked right before each delete), caps (50 deletes, 10,000 listed), abort when >= 20 candidates and more than half are orphans. `Storage.list` added (fake + S3). Unit and DB integration tests.
- **Runbook** `docs/runbook.md`: deploy, rollback, DB restore (Neon PITR and weekly backup), key rotation (`AUTH_SECRET` logs everyone out, S3, ORS, DeepL, `CRON_SECRET`, Sentry, backup), admin reset, ORS / DeepL (NUD-070 pending-translation retry) / Neon / R2 outages, `/api/health`, logs, orphan cleanup, Sentry checks, open human steps. `docs/privacy.md`, `deploy.md` (sections 12-13), `offline.md`, `AGENTS.md`, `.env.example`, `docs/env.md` updated.
- Checks: lint, typecheck, i18n:check, 1079 unit tests + 33 server integration files + 8 script test files (incl. backup integration) all green; e2e `error-pages` + `security-headers` 20/20 (desktop and 375 px mobile project) on a no-DSN build; `sentry-ingest` 3/3 on a DSN build. CI gets `postgresql-client-16` so the backup integration tests run there.
- Not verified: a real Sentry project (ingestion, grouping, the source-map upload path of `withSentryConfig` - never ran, no token), the GitHub workflow on a runner (incl. `postgresql-client-16` install), real R2 and Neon (point-in-time restore window of the plan, read-only role, `pg_dump` 16 against the real server version), GitHub failure e-mails, the hidden-prompt (TTY) path of the reset CLI (only env and stdin paths run), the real `global-error` page in a browser (component test only), real devices.
- Follow-ups: NUD-114 (human setup / verification). Pre-existing, not mine: Auth.js "crypto.getRandomValues while prerendering" log during build (NUD-097); `docs/i18n.md` fails prettier.

---

#### NUD-095 · Driver usability & accessibility pass
**Status:** done · **depends_on:** 083

**Scope**
- Review every driver screen against §4.3 rules; fix violations.
- Test with system font size at 130 %, dark mode, low-end Android (Chrome DevTools throttling: 4× CPU, Slow 4G).
- One-hand reachability: primary actions in bottom half.
- Check that every driver screen remains understandable when the locale is one the tester doesn't read (icons, numbers, photos carry meaning).
- Performance budget: driver home LCP < 2.5 s on Slow 4G after first load.

**Acceptance criteria**
- [x] axe-core e2e check has no serious/critical violations on driver screens. (`driver-a11y.spec.ts`: login, picker, today list + map, stop with / without photos, problem sheet, toast, result card, finished, offline list + stop, generic offline page, error page online + offline, iOS install hint + overlay; all four locales x light / dark; de + zh-Hant-TW also at 130 % font size. Moderate / minor findings that remain are listed in the notes.)
- [x] Performance budget met (Lighthouse CI on driver home). (Lighthouse CI ran locally with the sandbox Chromium: median LCP 1.9 s, DevTools Slow 4G + 4x CPU, warm profile; the Playwright PerformanceObserver test gives 0.6-0.9 s. The CI job was NOT run on a GitHub runner. Emulation, not a real phone.)

**Implementation notes**
- Method: wrote the checks first (`tests/e2e/driver-a11y.spec.ts`, `driver-usability.spec.ts`, `driver-performance.spec.ts`, helpers `driver-fixture.ts` / `driver-audit.ts`; `@axe-core/playwright` added), ran them against the production build, fixed what they found. `docs/driver-usability.md` explains checks and decisions.
- Fixed (axe serious/critical): progress bar without name (`aria-label`); contrast of mid-transition colours was a test artefact (the audit waits for animations); map depot marker without name (`title`).
- Fixed (rules 4.3): `Sheet` / `Dialog` close button 40 -> 48 px; "Anmeldung Büro" / "Fahrer-Anmeldung" link 24 -> 48 px high; German product name caption 14 -> 16 px; driver map markers 32 -> 48 px touch target (36 px circle, 18 px number) and zoom buttons 30 -> 48 px (`TourMap touch`, driver map only); fixed heights on driver buttons replaced by minimum heights and `Button size=lg` may wrap, so labels survive 130 % font size / long German words; top bar date wraps instead of truncating (known note of NUD-051); progress counter and "remaining" wrap cleanly; problem reasons use an auto-fit grid (one column at 130 %).
- Login (also admin): icons next to username / PIN / submit, input border and submit button use the theme tokens (the submit button was invisible in dark mode: `bg-zinc-900`; error text now `text-destructive`), visible focus ring.
- Other: sr-only `h1` on the tour screen (`driver.today.pageTitle`) and on the picker (the four language names); error page `role="alert"` moved from the `h1` to a wrapper (the heading lost its role); toast region name localized (`common.notifications`, hotkey hint removed, was English "Notifications alt+T"); bottom padding of the driver content (toast no longer covers the last list entries: closes the NUD-053 note); sticky submit / cancel bar in the problem sheet; picker, error page and generic offline page anchored to the lower part of the screen; generic offline page got an icon; `color-scheme: dark` in dark mode; global `prefers-reduced-motion` rule (spinners keep turning).
- One hand (bounding boxes, `driver-usability.spec.ts`): login submit, language choices (as a group), tour "start navigation", stop "delivered" / "problem" at the end of the page, sheet submit, error retry: centres in the bottom half at 375x667 and 412x915 (worst case: "delivered" at 363 / 667). Decision: status buttons stay in the page flow (no sticky bar).
- Locale-independent understanding: login, picker, error, offline and install screens now have an icon next to every action; numbers (quantities, stop numbers), photos and status icons carry the meaning on stop / tour screens. Not tested with real non-readers.
- Dark mode: exists since NUD-005 (tokens via `prefers-color-scheme`); kept, verified in all four locales (axe + screenshots), no toggle. Light-only was rejected: the tokens were already there.
- Font size 130 %: emulated by `html { font-size: 130% }` (everything is rem based), NOT Android's per-app font scale. Passes axe and the measurements in de and zh-Hant-TW.
- Performance: Playwright test (Slow 4G = 1.6 Mbit/s, 150 ms, 4x CPU through CDP, `next start`, 25 stops, warm after first visit): LCP 0.6-0.9 s. Lighthouse and `@lhci/cli` DO run here with the sandbox Chromium: `pnpm lighthouse:prepare` (persistent logged-in profile) + `pnpm lighthouse` (lhci via `pnpm dlx`, not a project dependency because `@lhci/cli` pulls 4 high advisories into `pnpm audit`), `lighthouserc.cjs`, CI job `lighthouse` (PRs): median LCP 1.9 s (1.2-2.0), CLS 0.04, TBT 0.45-0.64 s. First-ever visit (empty cache) is slower: 1.1-3.8 s in the Playwright runs (noisy); 502 KiB of the 870 KiB transferred is the OpenCC bundle (NUD-098), so NUD-098 would help the first visit.
- Verified: lint, typecheck, `i18n:check`, prettier, component tests (23 files incl. new heading / progress-bar test), `pnpm build`, e2e (mobile project): a11y / usability / performance specs, `driver-today`, `driver-stop`, `driver-status`, `shells`, `driver-language-picker`, `auth`, `pwa`, `error-pages`, `driver-offline`, `driver-outbox`, `driver-photo`, `customer-photos`, `drivers` (`driver-status` zh-Hant-HK failed once under load on a 30 s timeout and passed alone; `driver-offline` expected no `h1`, adapted). Screenshots at 375 px (de 130 %, zh-Hant-TW dark, sheet, finished, picker, login) inspected.
- NOT verified: real devices (TalkBack / VoiceOver, Android font scale, real low-end CPU, thumb reach, glare; see NUD-115), the CI job on a GitHub runner, the full vitest suite with DB tests (only component and script tests re-run; no server code changed), the desktop Playwright project, the admin screens that use `Button size=lg`, `Sheet` / `Dialog` (close button now 48 px; their e2e were not re-run), the unreviewed Chinese strings (`driver.today.pageTitle`, `common.notifications`; NUD-073).
- Remaining (documented, not fixed): axe "page should contain a level-one heading" (moderate) no longer occurs on driver screens; map credit line below 16 px / 48 px is exempt; the "tour updated" banner and its acknowledge button sit at the top of the list (not in the bottom half); no swipe (NUD-052); map offline (NUD-108); customer names in a different language than the UI carry no `lang` attribute.
- Follow-up: NUD-115 (real-device check).

---

#### NUD-096 · 👤 User acceptance test with client & drivers
**Status:** blocked (waiting for the client sign-off; the UAT itself is a human step) · **depends_on:** 093, 095

**Scope**
- `docs/uat.md`: test script for office (customers, products, orders, tour, release, import, print) and drivers (language choice, full tour, offline, photo, problem report).
- Feedback form (simple markdown table) incl. **which Chinese variant each driver actually chose** and any wording issues.
- Agent converts feedback into new tickets in this backlog.

**👤 Human step:** run the UAT with the client and at least one real driver per language used.

**Acceptance criteria**
- [ ] Client sign-off recorded in `docs/uat.md`.

**Human steps** (details in `docs/uat.md`)
1. Developer: finish the pre-UAT checklist (`docs/uat.md` section 9: real ORS key, tile provider, DeepL key, R2 CORS, Sentry, backups, CSP on the real deployment, reviewed Chinese strings, real depot, real products) and prepare the data (section 2: `pnpm db:seed --demo --today` on a UAT database, or the client's real data).
2. Run the office script (section 3) with the client's office staff and the driver script (section 4) with at least one real driver per language used, on at least one Android and one iPhone (section 6).
3. Collect the feedback forms (section 5: findings, chosen Chinese variant per driver, wording issues, device matrix) and give them to the agent: it creates tickets (section 8 of `docs/uat.md`), runs the wording rows through `pnpm i18n:import` and logs the variant choice (also resolves the open question in section 10 of this file).
4. The client fills in the sign-off block (`docs/uat.md` section 7). Only then tick the criterion above and set the ticket to `done`. Neither the agent nor the developer fills in the sign-off.

**Implementation notes**
- Wrote `docs/uat.md` (docs only, no code): preconditions with two data modes (demo seed with `--today`, or the client's real data), office script O-01..O-94 (login/settings, products with Chinese names, customers with photos and pins, translations tab, CSV/XLSX import with pin review, manual and screenshot orders, tour generate/reorder/lock/optimize/release, load sheet print, change after release and re-release, history, live progress, driver management), driver script D-01..D-54 and X-01..X-03 (first-start language picker, install on Android/iOS, full tour, quantity check against orders and load sheet, Google/Apple Maps hand-off, delivered/undo/problem with free text, photo capture, airplane-mode taps, cold start offline, Background Sync, logout with unsent taps, re-release notice, language switch, font size / sunlight / one hand / non-reader test), feedback form (findings, **chosen Chinese variant per driver**, wording issues with key/screen, current, suggested text for `pnpm i18n:import`), device matrix, an empty sign-off block, "how the agent converts feedback into tickets", the developer's pre-UAT checklist (references NUD-007, 073, 105, 107, 109, 113, 114, 115 instead of repeating them) and a table of known open items (NUD-073, 097, 099, 106, 108).
- Checked against the app: every route and URL named in the document exists (`/de/login`, `/de/driver/login`, `/de/admin/customers/import`, `/de/admin/customers/import/review`, `/api/health`), `tests/fixtures/customers-150.csv` exists, and every quoted German UI term was matched by a script against the values of `messages/de.json` (and the locale names in `src/lib/locale-resolution.ts`); the only unmatched quotes are English instructions or placeholder variants. Prettier passes on `docs/uat.md` and `backlog.md`. Not run: the UAT itself (human), and nothing was clicked in a browser, so the "Expected" column describes the behaviour documented in the tickets and the labels, not an observation.
- Seen while checking, not changed: a driver can log out only at the bottom of the home screen (`LogoutButton`); the product search by Chinese name is not promised anywhere, so O-52 records the behaviour as an observation only.
- No new tickets were needed: the findings the script may produce map to existing tickets (NUD-099, 106, 108) or are covered by the human tickets 105, 107, 109, 113, 114, 115.

---

#### NUD-097 · Silence Auth.js prerender error log
**Status:** done · **depends_on:** 004

**Goal:** the server log is free of `Route "/[locale]/admin" ... unstable value crypto.getRandomValues() while prerendering`.

**Scope**
- Find out why `auth()` (Auth.js CSRF/session handling) runs inside Next's partial-prefetch prerender of the guarded layouts/pages (present since NUD-004, reproduced on its commit) and make the dynamic access explicit (e.g. `await connection()` or reading `cookies()` before `auth()` in `requireRole`/`requirePageActor`), without weakening the guards.

**Acceptance criteria**
- [x] Requesting `/de/admin`, `/de/admin/orders` and `/de/driver` while logged in produces no prerender errors in the server log.
- [x] Guards still redirect/reject exactly as before (existing auth tests and e2e pass).

**Implementation notes**
- Root cause: Next's partial-prefetch validation (`partialPrefetching` + `cacheComponents`) renders the guarded layouts/pages in a prerender pass with an empty cookie jar. `requirePageActor` called `auth()` without any explicit dynamic access, so Auth.js found no CSRF cookie and generated a fresh token with `crypto.getRandomValues()` inside the prerender, which Next reports as a blocking-prerender error (once per guarded route, e.g. `/[locale]/admin`, `/admin/orders`, `/admin/orders/[id]`). The guards themselves behaved correctly (they sit inside `Suspense`); only the log was wrong.
- Fix: `await connection()` as the first statement of `requirePageActor` (`src/server/auth/page-guards.ts`), so the session read is declared request-time data and is skipped by the prerender. `requireRole` (server actions, route handlers) is unchanged. The unit test `driver-locale.integration.test.ts` mocks `next/server` `connection` (it only works inside a request scope).
- Verified: `pnpm build` log has no `getRandomValues`; `next start` log stayed clean (only the expected `CredentialsSignin` lines from the negative-login tests) over the e2e runs of auth, shells, security-headers, drivers, driver-today, orders (all pass; `orders` first-test failure with `--workers=2` together with other specs is the known shared-DB flake and passes alone). Unit/integration: `src/server/auth/*`, `authz-matrix`, `driver-locale.integration` pass (204 tests); lint, typecheck, prettier pass.
- Not verified: the complete `pnpm test` in one go (exceeds the 3-minute tool limit here; only the auth-touching files were run), and the remaining e2e specs (they do not touch the changed code path).

---

#### NUD-098 · Keep OpenCC out of the client bundle
**Status:** done · **depends_on:** 003

**Goal:** the browser must not download the ~1.3 MB OpenCC dictionaries (found in NUD-020: `language-switcher.tsx` and `users-manager.tsx` import `LOCALES` from `src/lib/localized-text.ts`, which imports `src/lib/opencc.ts`).

**Scope**
- Split locale constants/types/zod schema/`pick` from the OpenCC-based `withDerivedHant` (e.g. a server-only module), keep the public behaviour and tests.
- Check the production build: no chunk under `.next/static` contains OpenCC data (e.g. grep for a dictionary entry such as `麪`).

**Acceptance criteria**
- [x] No client chunk contains OpenCC; all existing tests pass.

**Implementation notes**
- Split: `src/lib/localized-text.ts` is now client-safe (locale constants, schema, `createLocalizedText`, `pick`, `pickWithSource`, DB-tag helpers); `withDerivedHant` moved unchanged to `src/lib/localized-text.server.ts` (the only importer of `src/lib/opencc.ts` besides server code, scripts and tests). Only `src/server/translator/localize.ts` used it; its test moved to `localized-text.server.test.ts`. Behaviour identical. No `server-only` package: it is not installed (`pnpm install` is not possible here) and tsx scripts/vitest would need aliasing, so the guard is a file naming convention plus two checks below.
- Guards: (1) ESLint `no-restricted-imports` (opencc-js, `lib/opencc`, `localized-text.server`) for `src/components`, `src/domain`, `src/sw`, `src/lib` (server half, opencc.ts and tests excepted); verified that a violating import in `src/components` fails lint. (2) `scripts/check-client-bundle.ts` (`pnpm check:client-bundle [--report]`): scans every file in `.next/static` for real OpenCC dictionary entries (`意大利面 意大利麪`, `意大利 義大利`) and the package name, exit 1 on a hit; runs at the end of `pnpm build` and `pnpm build:vercel` (so CI's build/lighthouse job fails too) and has a unit test for the signatures. `--report` prints first-load JS from `build-manifest.json` + the route's RSC client manifest (root files + page + ancestor layouts). Documented in AGENTS.md.
- Measured (production build, Turbopack): the offending chunk was 1166 KiB raw. First-load JS `/de/driver`: 2049 KiB raw / 773 KiB gzip -> 884 KiB / 273 KiB (-1165 KiB raw, -500 KiB gzip); `/de/admin`: 2050 / 776 -> 885 / 277 KiB. All client chunks 2931 -> 1753 KiB raw. Service worker precache: 74 entries / 3050 KiB -> 75 entries / 1872 KiB.
- Lighthouse (`pnpm lighthouse:prepare` + `pnpm lighthouse`, 3 runs, driver home, same environment as NUD-095): LCP 1.14-1.16 s (before: median 1.9 s, range 1.2-2.0), CLS 0.042 (unchanged), TBT 2-48 ms (before 0.45-0.64 s). Assertions pass.
- Verified: lint, typecheck, prettier on touched files, i18n:check, unit tests without DB (98 files, 1085 tests), integration tests touching OpenCC/localize (customer-actions, demo-seed, driver-today, product-actions, translation-retry: 73 pass); e2e shells + pwa (66), driver-offline (22, offline shell works), driver-today + drivers (16), products (live OpenCC pre-fill via server action) + customer-form (customer-form failed once when run together with products on the shared DB, passes alone: known shared-DB flake).
- Not verified: the full integration suite in one go (only the five OpenCC-related files), other e2e specs (code path unchanged), real-device first-visit timing.

---

#### NUD-099 · Late orders for an already completed tour
**Status:** done · **depends_on:** 043

**Goal:** an order confirmed after the tour of its day is COMPLETED must not vanish (found in NUD-043).

**Scope**
- Today `outdatedTourDates` / `markOutdatedForDate` ignore COMPLETED tours and `generateTour` / re-release refuse them, so a new confirmed order for such a day is on no tour and nobody is told.
- Decide with the office (simplest first): warn on the order form and in the overview ("tour of that day is already completed"), or allow a second tour for the date (D5: no unique constraint on `Tour.date`; `getTourPlan` shows only the latest tour of a day, so the page needs to list several).

**Acceptance criteria**
- [x] A confirmed order for a date whose only tour is COMPLETED is visibly reported to the office (and, if a second tour is chosen, can be delivered). (Overview notice + badge, dashboard card, banner on the planning page; "Folgetour erstellen" builds a second tour for the same date that the driver delivers. Integration `late-orders.integration.test.ts` (13), e2e `late-orders.spec.ts` (complete tour, late order, banner, follow-up, release, driver delivers; 4 locales).)

**Implementation notes**
- Design (both options of the scope, minimum viable): the office is told in three places and can deliver the order through a **follow-up tour** = a second `Tour` row for the same date. No schema change, no migration. A day's tours are all COMPLETED and a CONFIRMED order is on no stop = **late order** (`findLateOrderIds` in the new `src/domain/day-tours.ts`, which also holds `sortDayTours`, `pickDefaultTour`, `pickDriverTour`, `canCreateFollowUp`, `deliveredStopConflicts`; 20 unit tests). While an open tour (anything but COMPLETED) exists nothing is "late": the ordinary outdated flag, rebuild and re-release handle new orders as before; `markOutdatedForDate` is unchanged (completed tours stay unflagged, history).
- Scoping (the core of "several tours per date"): `listConfirmedOrdersForDate(db, date, {tourId})` returns the day's confirmed orders that are NOT on a stop of another tour of that day (`{tourId: null}` = for a tour that does not exist yet = on no stop). The builder, the re-release plan (`loadReleasePlan` and its order signature) and the planning read model use it, so a follow-up tour only contains the late orders and its diff never lists the completed tour's customers as "added". Without a second tour the scope excludes nothing: single-tour behaviour is unchanged (all earlier tour / re-release / builder tests pass untouched).
- Builder: `generateTourWith(deps, date, {followUp: true})` and `generateFollowUpTour(actorId, date)`; new action `createFollowUpTourAction({date})` (`requireRole("ADMIN")`, strict zod, like `generateTourAction`). Allowed only when the day has tours and all are COMPLETED (`follow_up_not_allowed` otherwise, so a second click or a stale page creates nothing), and when there is at least one late order with a confirmed pin (`no_late_orders`; customers without a confirmed pin come back as `PIN_UNCONFIRMED` warnings, as in a normal build); past days stay refused (`date_in_past`). The new tour is OPTIMIZED, built from the late orders only (one stop per customer, orders merged; a customer that was delivered earlier gets a second stop with only the new quantities), then planned, assigned and released like any tour. Plain `generateTour` is unchanged: it rebuilds the newest tour of the day (the open follow-up tour, scoped) and still answers `tour_not_editable` for a completed one. A concurrent second create loses with `conflict` (latest tour id/`updatedAt` re-checked under the per-date advisory lock).
- Audit (NUD-092): new action `tour.followup` (vocabulary, history label, `audit-history` case with the stop count) written in the creating transaction with `followUpOfTourIds` and the late `orderIds`; `audit-coverage.test.ts` and the authorization matrix (row for `createFollowUpTourAction`) pass; an integration test reads the entry back through `tourHistoryQuery`.
- Driver (NUD-051): `getDriverTour` now takes all released tours of the driver for the day and `pickDriverTour` chooses: the newest RELEASED / IN_PROGRESS one, else the newest COMPLETED (finished screen), so an unreleased follow-up keeps showing "tour finished" and a released one replaces it. Stop-status, photos and sync work by stop id and needed no change. Admin dashboard (`getTodayProgress`) shows `pickDefaultTour` (the open tour, else the newest) and a new `lateOrderCount` with an amber hint "N Bestellungen ... nach Abschluss der Tour ... Bitte eine Folgetour erstellen".
- UI: planning page (`?date=&tour=<id>`; `tourPlanQuery(date, tourId?)`, `getTourPlan(..., tourId?)` returns `tours[]` (id, number, status, stop count), the selected `tour` (default = `pickDefaultTour`, an unknown id falls back to it) and `late`): `TourTabs` ("Tour 1", "Tour 2 (Folgetour)" with status and stop count, only when there are two or more), `LateOrdersBanner` (red alert with the late customers and quantities via `TourDiffList`, a note for customers whose pin is not confirmed, button "Folgetour erstellen" that opens the new tour's tab; the button is disabled without a routable late customer; a second, neutral alert lists "Bestellungen nach der Lieferung geändert" = conflict note, see below). `TourPlanner` is keyed by tour id so tab changes reset local state. Order overview: `LateOrdersNotice` (one line per day with count and link to the planning page) and an amber badge "Nachbestellung - Tour abgeschlossen" in the tour column of late rows (`lateOrderIdsForRows`, one query). Strings `admin.tours.late/tabs`, `admin.orders.late`, `admin.dashboard.today.lateOrders`, error codes, `admin.history.actions.tour_followup`: de + zh-Hans by hand, Hant generated (Chinese agent-written, NUD-073).
- **Increased quantities on delivered stops (decision, see log):** not delivered by the follow-up tour. A confirmed order that IS on a stop of a completed tour and was edited or cancelled afterwards is reported as a **conflict note** (`deliveredStopConflicts`: delivered quantity -> now, per product; shown under the banner even when there is no late order); the office has to settle it with the customer and driver. To get the difference delivered the office creates a new order for the extra quantity, which then is a late order. Automating that is NUD-117.
- Tests: unit `day-tours.test.ts`; integration `late-orders.integration.test.ts` (late orders reported while the completed tour stays unflagged; overview flag + dashboard count; follow-up contents, completed tour byte-identical, audit entry + history; rebuild of the follow-up tour scoped apart from the completed one; driver picks follow-up after release and the finished tour before; re-release diff only names the follow-up's own orders; conflicts for edited / cancelled delivered orders; nothing reported / no follow-up for a day without tour or with an open tour; unconfirmed pins; past day; action rejects anonymous / driver with nothing written; input validation; mutation-checked: dropping the scope fails 5 tests); authz matrix row; e2e `tests/e2e/late-orders.spec.ts` (desktop: first tour built, released and delivered by the driver on a phone; late order entered through the order form; notice, badge, dashboard hint, banner; follow-up with tabs, completed tab unchanged; release; driver sees only the late quantities (A: 3, not 2 + 3), delivers; DB: two COMPLETED tours, 2 + 2 order links, `tour.followup` audit; second test: banner / notice / dashboard hint in all four locales, follow-up creation in zh-Hant-TW, no console errors, no horizontal scroll).
- Verified: lint, typecheck, `i18n:check`, prettier on touched files, `pnpm build` (incl. client-bundle check), vitest without DB (99 files, 1108 tests) and all 34 integration files on embedded PostgreSQL (399 tests, in three groups), e2e (desktop) `late-orders`, `tours`, `tour-rerelease`, `order-overview`, `orders`, `shells`, `admin-progress`, `mvp-happy-path` (demo seed, 5), e2e (mobile) `driver-today`, `driver-status`. Screenshots at 1280 px inspected (`test-results/nud-099-orders-1280.png`, `-banner-1280.png`, `-followup-1280.png`, `-released-1280.png`, `-banner-zh-Hans-1280.png`, driver `nud-099-driver-followup.png`), no horizontal scroll asserted.
- Observation (not fixed): the driver screenshot right after the release showed the amber "Offline - zuletzt aktualisiert" banner although the page listed the new follow-up tour correctly (cache served first, then refreshed); this is the cache behaviour NUD-118 should look at.
- NOT verified: the driver PWA on a real phone / with a warm offline cache when a second tour of the same day appears (NUD-118); drag-and-drop and touch on the follow-up tab (same component as before); real ORS routing for the follow-up (heuristic only); the e2e together with the other specs in one parallel CI run (like `tour-rerelease` / `tours` it flips `depotPinConfirmed` and needs "no tour for today"; run it alone or first); the order form itself gives no warning (NUD-116); the print view of a follow-up tour was not opened; Chinese strings are agent-written (NUD-073).
- Follow-ups: NUD-116, NUD-117, NUD-118. NUD-102 (several drivers per day) can build on the tabs, `pickDefaultTour` / `pickDriverTour` (extend to "all active tours of this driver") and the order scope.

---

#### NUD-105 · 👤 Real-device PWA install check + Lighthouse run
**Status:** todo · **depends_on:** 080

**Goal:** confirm what NUD-080 could only simulate.

**Scope**
- On a deployed HTTPS build: run Lighthouse (installable PWA) against `/<locale>/driver/login`, fix findings.
- Android Chrome: install via the hint button, check it starts on `/<locale>/driver` and the (maskable) icon looks right.
- iPhone Safari: follow the overlay steps, check icon, label, standalone start.

**Acceptance criteria**
- [ ] Lighthouse report shows the app as installable; Android and iOS installs tested and noted here.

---

#### NUD-106 · Installed app opens in the driver's current language
**Status:** done · **depends_on:** 080

**Goal:** after the driver switches language the home-screen app must not start in the old one.

**Scope**
- The manifest `start_url` is locale-prefixed (`/de/driver`). Options: locale-less `start_url` `/driver` that `proxy.ts` redirects using the stored user locale, or a re-install hint. Pick one, keep the localized `name`.

**Acceptance criteria**
- [x] A driver with locale `zh-Hans` who installed the app while in German opens it in Chinese. (Simulated, a real installation was not tried: driver installed in `zh-Hant-TW` switches to `de` / `zh-Hans`, a fresh load of the manifest `start_url` opens `/de/driver` / `/zh-Hans/driver`; offline launch shows the offline shell in the last-used language. Real devices: NUD-105.)

---

**Implementation notes**
- Fix: all manifests now have the locale-neutral `start_url` `/driver?source=pwa` (`DRIVER_LAUNCH_PATH` in `src/lib/pwa.ts`); `id` `/driver` and `scope` `/` unchanged. The per-locale manifests stay (localized `name` / `short_name` / `description` / `lang`), only `start_url` is now identical.
- Redirect: `proxy.ts` already redirected unprefixed paths; the rule moved into the pure `localeRedirectPath` (`src/lib/locale-redirect.ts`: session locale -> `NEXT_LOCALE` cookie -> Accept-Language -> `de`, path and query kept) and the redirect now carries `Cache-Control: no-store` and `Vary: Cookie, Accept-Language`. The session locale is current because the language switcher updates the JWT (`updateSession`) and the cookie. Not logged in: `/driver?source=pwa` -> `/<cookie locale>/driver?source=pwa` -> driver login in that language.
- Service worker: `/driver` (exact) counts as a driver navigation (`isDriverLaunchPath`): network only, nothing stored (e2e: no `/driver` or `/<locale>/driver` entry in Cache Storage after launches). Offline, the generic `offline.html` is answered under the URL `/driver`; its script reads the `NEXT_LOCALE` cookie (else `de`) and replaces the location with `/<locale>/driver`, which the worker answers with that locale's offline shell. No new precache entry, no change to the shell.
- Tests: unit `locale-redirect.test.ts` (rules), `pwa.test.ts` (same `start_url`, stable `id` / `scope`), `sw/rules.test.ts`, `offline-page.test.ts`; e2e `pwa.spec.ts` (19 tests, mobile): manifests, redirect headers (307, `no-store`, Accept-Language / cookie), unauthenticated launch lands on the login in the cookie language, driver zh-Hant-TW -> de -> zh-Hans launches into the current language, offline launch in the last-used language (de, then zh-Hant-HK), `getInstallabilityErrors` empty. Docs: `docs/offline.md` (new section), `docs/uat.md` (known-limit row for NUD-106 removed).
- Verified: lint, typecheck, `i18n:check`, vitest without DB (all passed) and the DB tests `admin-password` / `locale`, production build, e2e mobile `pwa` (19), `driver-language-picker`, `shells`, `driver-offline` (29 passed).
- NOT verified: real installation and launch on Android / iOS (NUD-105); the full DB integration suite was not rerun (no DB code touched); desktop Playwright project. Already installed apps keep their old `/<locale>/driver` start URL until the browser refreshes the manifest (Chrome/Android does it by itself, otherwise reinstall); iOS before 16.4 ignores the manifest `start_url` (starts on the page open at "Add to Home Screen") and needs a reinstall as well.

---

#### NUD-107 · 👤 Real-device offline check (dead spot, photos, logout)
**Status:** todo · **depends_on:** 081

**Goal:** confirm on real phones what the sandbox could only simulate.

**Scope**: on Android (Chrome, installed PWA) and iPhone (Safari, home-screen app): load the tour online, check "Offline bereit ✓", switch to airplane mode, open list, stops and photos, cold-start the app offline, come back online, log out and check that no tour is shown offline afterwards. Check the R2 CORS rule allows `GET` (photos count "n von m" otherwise).

**Acceptance criteria**
- [ ] All steps pass on one Android and one iOS device; findings written under the ticket.

---

#### NUD-108 · Map view offline (tiles)
**Status:** done · **depends_on:** 081

**Goal:** the list / map toggle must not show an empty map in a dead spot.

**Scope**: decide between hiding the map offline with a hint, or caching the tiles of the tour's bounding box at low zoom levels (respect the tile provider's terms).

**Acceptance criteria**
- [x] Offline the map view shows either tiles or a clear localized hint, never a blank map. (Offline: plain background + notice + markers + route, e2e de + zh-Hans in the production build incl. the offline shell; opt-in tile cache implemented but only unit-tested.)

**Implementation notes (NUD-108)**
- Decision: **no tile pre-caching** (providers' terms, OSM policy explicitly). `TourMap` (driver map and admin tour map) now degrades: `useOnline()` false, or 4 tile errors in a row without a loaded tile, removes the `TileLayer` (no broken-tile grid, no request storm), sets a plain neutral background (`.nudel-map-plain`, faint grid) and shows a `role="status"` notice above the map with WiFi-off + map-pin-off icons: "Kartenhintergrund offline nicht verfügbar" / "离线时无法显示地图背景" (Hant generated); when online but tiles fail: "Kartenhintergrund nicht verfügbar". New messages `maps.*` (de, zh-Hans, i18n:build, route hint). Stops (numbered), depot marker and route polyline stay, map still pans/zooms, tooltips work; the tile layer returns when the connection is back (`data-tiles="ok|unavailable"` on `tour-map`).
- Opt-in `MAP_TILE_CACHE=1` (default OFF; needs explicit `MAP_TILE_URL`; read at build time by `scripts/build-pwa.ts` -> `__TILE_CACHE_URL__`, and at start time for the page / CSP): the worker cache-first caches only tiles that were requested (no prefetch), CORS 200 answers only (tile layer uses `crossOrigin` then; opaque responses are padded heavily in the storage quota), LRU 300, 7 days (`src/sw/tile-cache.ts`, `rules.ts#tileUrlPattern`). CSP `connect-src` gets the tile host only with the flag (worker fetches are checked against it). Provider-terms caveat in `docs/env.md` and `docs/offline.md`; `.env.example` updated.
- Tests: `tour-map.test.tsx` (4 locales offline, tile-error fallback), `tile-cache.test.ts`, `rules.test.ts`, `map-config.test.ts`, `security-headers.test.ts`, e2e `driver-map-offline.spec.ts` (mobile, production build, tiles stubbed: online tiles -> offline notice + 4 markers + 1 route path + no tile images + no tile requests, reload offline = offline shell, axe serious/critical clean in de + zh-Hans, back online tiles return). 375 px screenshot viewed.
- NOT verified: the opt-in cache against a real provider (CORS, quota) or in a built worker (only its pure logic is unit-tested; the default build has it off); real phones (-> NUD-107); admin tour map offline (same component, no e2e); 130 % font scale of the new notice (wraps, not measured). Pre-existing: `auth.integration.test.ts` "applies the limit to unknown usernames" fails in the full run and in its file, passes alone with `-t`.
- Found: markers of the driver map only show the customer name as a tooltip; there is no tap-to-open-detail (the ticket text assumed it) -> NUD-119.

#### NUD-109 · 👤 Real-device check of the offline mutation queue
**Status:** todo · **depends_on:** 082

**Goal:** confirm on real phones what the sandbox could not: Background Sync (Android Chrome), queued taps through a real dead spot, logout with unsent taps (they stay and are sent after the next login), Safari / iOS behaviour (page triggers only), a re-release by the office while the phone is offline (notice).

**Acceptance criteria**
- [ ] Android Chrome: tap "Delivered" in flight mode, close the app, leave flight mode: the stop shows up in the admin view without opening the app.
- [ ] iOS Safari / installed PWA: taps queued offline are sent when the app is opened again.
- [ ] Logging out with a badge > 0 and back in sends the taps.


#### NUD-110 · Nonce-based script CSP (drop `'unsafe-inline'` for scripts)
**Status:** done · **depends_on:** 093

**Goal:** `script-src` without `'unsafe-inline'`. NUD-093 keeps it because Next.js streams inline hydration scripts and cache components / PPR prebuilt shells cannot carry a per-request nonce. Options to evaluate: nonce via `src/proxy.ts` for dynamic routes only (login, admin, driver are behind login anyway) with the public shells served nonce-less from a stricter route group, or waiting for Next.js support. Report-only first (`CSP_REPORT_ONLY`), then enforcing.

**Acceptance criteria**
- [x] Decision recorded (ADR or decision log) on how nonces fit `cacheComponents` / PPR. (`docs/deploy.md` section 11.1a + decision log below.)
- [x] Production policy has no `'unsafe-inline'` in `script-src`; the e2e suites and `security-headers.spec.ts` pass without CSP violations. (Desktop project, production build: whole suite first with `CSP_REPORT_ONLY=true` (0 `[csp-violation]` lines), then enforcing (0 lines apart from the 2 produced on purpose by the injection test); `sentry-ingest` 3/3 with a DSN build. The mobile project was not run.)

**Implementation notes**
- **Investigation (Next 16.4.2, Turbopack, `cacheComponents` + `partialPrefetching`; measured on the production build, not only read from docs):** (a) per-request nonce: the Next docs say PPR is incompatible ("static shell scripts won't have access to the nonce"). True for the prebuilt part, but a nonce in the CSP *request* header IS applied to every inline script rendered per request, including the resume part of a PPR page (bootstrap, flight data, `$RC` Suspense scripts). The prebuilt part of a PPR shell has exactly **two** inline scripts, a fixed `requestAnimationFrame(...)` line and the Turbopack chunk list `id="_R_"` (identical on all 147 prerendered pages of a build); the fully static pages (`/<locale>` home, `/<locale>/driver/offline-shell`, `_not-found`, `_global-error`) additionally have their flight data inline (`self.__next_f.push`). A static page is served prerendered even if the request carries a nonce. (b) `experimental.sri` is **not usable**: the integrity manifest comes from the webpack plugin only (`build/webpack/plugins/subresource-integrity-plugin.js`), nothing on Turbopack, and SRI covers `<script src>`, not inline scripts. (c) `'strict-dynamic'`: unnecessary, `'self'` already covers the chunk files. => **Feasible as a hybrid**: nonce for what is rendered per request + SHA-256 hashes for the fixed inline scripts of the prebuilt documents.
- **Policy** (`src/lib/security-headers.ts`): pages get `script-src 'self' 'nonce-<16 random bytes, base64, per response>' 'sha256-...'` (hashes of the locale-less documents + the request's locale, ~2 KB of header); API routes, `/_next`, files, `sw.js` get `script-src 'self'`. Development keeps `'unsafe-inline' 'unsafe-eval'` (HMR) and no nonce. Nonce / hash values are validated before they go into a header (throws on anything but base64 / `shaNNN-base64`). `style-src` is unchanged (`'unsafe-inline'`, Leaflet).
- **`src/proxy.ts`** builds the policy for every page response (redirects too), sets it on the request (Next.js reads the nonce from there; `Content-Security-Policy-Report-Only` works the same, so `CSP_REPORT_ONLY` keeps working per request) and on the response. `next.config.ts` now sets the CSP only for the complement of the proxy matcher (`/:path((?:api|_next|_vercel).*|.*\\..*)`) so no page gets two policies; the other security headers stay on `/:path*`.
- **Getting the hashes into the proxy** (the hashes exist only after `next build`, the proxy is bundled before): `pnpm build` / `build:vercel` now run `scripts/csp-script-hashes.ts reset` -> `next build` -> `write` -> `next build` -> `build-pwa` -> `check`. `write` hashes every inline script of `.next/server/app/**/*.html` into the git-ignored `.csp-script-hashes.json` (also the build ID of pass 1: it is inlined in the flight data of static pages, so pass 2 reuses it through `generateBuildId`); `next.config.ts` hands the hashes to the proxy as `process.env.CSP_SCRIPT_HASHES` (inlined at compile time, no file access at run time, nothing to trace on Vercel). `check` fails the build if the final output hashes differ from the embedded ones, if `public/*.html` has an inline script, or if no hashes were found: a deployment cannot ship a policy that does not match its pages. Cost: build time +about 15 s here (35 s total). First attempt without build-ID pinning failed `check` (build ID differs between passes), which is how that dependency was found.
- **Offline page:** `public/offline.html` had an inline script and an `onclick` attribute; the script is now `public/offline.js` (generated by `build-pwa.ts`, precached, `no-cache` header), the reload button uses `data-reload`. `pwa.spec.ts` / `driver-offline.spec.ts` allow and require `/offline.js` in the precache.
- **Tests:** unit `security-headers.test.ts` (no unsafe-inline / eval / strict-dynamic / wildcard for any env, nonce+hash rendering, validation against header injection, report-only, dev), `src/proxy.test.ts` (nonce differs per response incl. redirects, hashes of the request's locale only, request header = response header, report-only, dev; `vitest.config.ts` inlines `next-intl` for it), `scripts/lib/csp-hash-build.test.ts` (inline script extraction, hash, manifest per locale), `offline-page.test.ts`. e2e `security-headers.spec.ts` (production build only, skipped on `pnpm dev`): `script-src` of pages has a nonce and no `'unsafe-inline'`; a new nonce per response; **every inline script of five pages (login x2 locales, static home, offline shell, 404) is covered by the nonce or a hash**; API / files / offline page are `'self'` only; an injected inline `<script>` and an `onerror` handler are blocked (this test produces 2 `[csp-violation]` log lines on purpose); admin login works under the strict policy. Full desktop e2e run twice (report-only, then enforcing) and `sentry-ingest` with a DSN build: see criteria.
- **Performance:** Lighthouse CI (3 runs, driver home, same setup as NUD-095/098, enforcing production build): LCP 1.1 / 1.3 / 1.5 s (NUD-098: 1.14-1.16 s; the sandbox is noisy, budget < 2.5 s), CLS 0.015-0.042, TBT 10-20 ms. The shells are still prerendered and streamed (`x-nextjs-postponed`); the proxy already ran for every page, it now also creates a nonce and a header string. The Playwright LCP test (`driver-performance`) passes.
- **Service worker / offline shell:** the precached `/<locale>/driver/offline-shell` documents are fully static, covered by hashes, and keep the CSP header they were fetched with (a Cache Storage response keeps its headers); `driver-offline`, `driver-a11y` (offline shell + generic offline page in 4 locales x light/dark), `pwa` pass enforcing.
- **Found on the way (test only):** `src/server/auth/auth.integration.test.ts` "applies the limit to unknown usernames too ..." failed in a full-file run and passed with `-t`: the rate limit counts attempts newer than `now - 15 min` without an upper bound, earlier tests in the file log in with the real clock, and the test used fixed dates (`2026-10-17..19`) that are in the past since 2026-10-18 08:00 UTC, so those attempts looked recent. Not a product bug (production `now` is the real clock). Fixed in the test by using days in the future (`futureDay(n)`).
- Pre-existing, not changed: `/de/<unknown>` answers HTTP 200 for the not-found page (seen before and after this ticket); `admin-password.integration.test.ts` throws "Invalid URL" in a run without `DATABASE_URL` (the other integration files skip).
- Not verified: real browsers other than Chromium (Playwright desktop project only; no mobile project, no Safari / iOS, no installed PWA), Vercel (do the proxy headers apply to the static `/de` page on the CDN; does `build:vercel` converge with Vercel's deployment-ID handling: `check` would fail the build, not ship a broken policy; Sentry source-map upload in both passes), a Next.js / React upgrade. Rollout and checks on the real deployment: NUD-120.
- Follow-ups: NUD-120. `style-src 'unsafe-inline'` (Leaflet) is untouched; not ticketed (low value: style injection cannot run code, and the same nonce / hash approach would be needed).

#### NUD-111 · Audit log retention job
**Status:** done · **depends_on:** 093

**Goal:** implement the design in `docs/privacy.md` section 7: a cron route (`CRON_SECRET`) that deletes `AuditLog` rows older than the agreed period (proposal 24 months) as the only delete path, lifting the append-only trigger deliberately (`SET LOCAL app.audit_retention = 'on'` honoured by the trigger function, new migration), with tests that ordinary deletes still fail. Needs the client's decision on the period.

**Acceptance criteria**
- [x] Rows older than the period are deleted by the job and by nothing else; `UPDATE` / `DELETE` from the app or a hand-written statement still fail.
- [x] `docs/privacy.md` states the final period; the coverage scan in `audit-coverage.test.ts` still passes.

**Implementation notes**
- Migration `20261018130000_audit_log_retention` replaces the function `audit_log_append_only()` with `CREATE OR REPLACE` (the existing trigger keeps pointing at it, so it applies to a fresh and an existing database alike). `DELETE` is allowed only when `current_setting('nudel.audit_retention', true) = 'on'` AND `OLD."createdAt"` is older than 90 days by the database clock (`timezone('UTC', now())`); otherwise it raises. `UPDATE` is refused always. So the application cannot delete recent rows even with the switch on.
- `src/server/audit-retention.ts`: `auditRetentionDays()` (`AUDIT_RETENTION_DAYS`, default 730, 90..36500, anything else falls back to 730) and `purgeExpiredAuditEntries({db})`: batches of 1000 rows (`DELETE ... WHERE id IN (SELECT ... ORDER BY createdAt LIMIT n)`), each in its own transaction that first runs `set_config('nudel.audit_retention','on', true)` (transaction-local), at most 20 batches per run (`more: true` if the limit was hit). A period below 90 is refused with an error (not clamped). Returns `{retentionDays, cutoff, deleted, batches, more}`.
- Route `GET /api/cron/audit-retention` (`audit-retention-cron.ts`, bearer `CRON_SECRET`, 401 without a configured secret, 503 `{status:"error"}` on failure without leaking the message), daily 03:37 UTC in `vercel.json`; one log line `[audit-retention] {counts}`; the run is not written to the audit log. Added to the authz matrix (`SECRET_ONLY` row and the cron-secret test), `docs/privacy.md` (section 7 rewritten: 730 days, enforcement, table row, operator list), `docs/runbook.md` (new subsection under section 10), `docs/env.md`, `docs/deploy.md`, `.env.example`, `AGENTS.md`.
- `audit-coverage.test.ts`: the scan now allows `DELETE FROM "AuditLog"` in exactly one file (`server/audit-retention.ts`, which must contain the `set_config(... 'on', true)` switch); `UPDATE`/`TRUNCATE`/`auditLog.update*|delete*` stay forbidden everywhere.
- Tests: unit `audit-retention.test.ts` (days parsing and fallbacks, floor refusal, batching, `more`, route 401/200/503, log line), integration `audit-retention.integration.test.ts` on embedded Postgres (old rows deleted, younger kept, shorter period down to the floor, batching across runs, recent rows survive a forced `DELETE` with the switch on incl. 89-day-old rows, plain `DELETE`/`UPDATE` fail with and without the switch, floor refusal); `audit.integration.test.ts` append-only test unchanged and green. Full unit suite, all 36 integration files, lint, typecheck, `i18n:check`, `pnpm build` and `db:seed --demo` (fresh DB, twice) pass.
- Not verified: the cron on Vercel/Neon (no production), `prisma migrate deploy` itself (engine download blocked; migrations were applied by the test helper, which executes the SQL files in order), timing of a very large backlog. The 730-day period is a proposal until the client confirms it (`AUDIT_RETENTION_DAYS`, no code change).
- `src/server/admin-password.integration.test.ts` fails when `DATABASE_URL` is unset (no `skipIf`), unrelated to this ticket; it passes in the integration runs.

#### NUD-112 · Retention for orders, tours, stops and driver problem texts
**Status:** done (implemented scope; the periods and whole-order retention need the client, see the open questions in section 10) · **depends_on:** 093

**Goal:** decide with the client (data protection advisor) how long delivered orders / tours / driver problem texts are kept (proposal: 3 years) and implement the deletion or anonymisation (driver free text first), plus a short runbook for access / erasure requests (find and remove a person's name in notes, photos, screenshots).

**Acceptance criteria**
- [x] Analysis of what is personal data in orders, tours, stops and driver texts, and the period for driver texts (365 days, a proposal until the client confirms) written into `docs/privacy.md` section 6 and the retention table in section 2.
- [x] Cron job with test; history views cope with removed texts (planning view tested; the notes are optional in every view).
- [ ] Client confirms the driver text period and decides on whole-order / tour retention (not a code task; section 10).

**Implementation notes**
- Analysis (`docs/privacy.md` section 6): orders, tours and stops hold no personal data of their own beyond user ids (creator, driver) and two free-text fields (`Order.internalNote`, `Stop.problemNote`); customers are businesses. Deleting or anonymising whole orders / tours is neither needed for data protection nor safe without the client (disputes, accounting, backlog 4.3 "never hard-delete business data", a missing stop would falsify a completed tour). So **nothing in orders, tours or stops is deleted**, and no `ORDER_RETENTION_DAYS` exists; that is the open question in section 10.
- `src/server/data-retention.ts`: `scrubExpiredDriverTexts({db, mode, retentionDays})` sets only `Stop.problemNote` to NULL (`Prisma.DbNull`) on stops with `completedAt` older than `DRIVER_TEXT_RETENTION_DAYS` (default 365; 30..3650; invalid / out-of-range falls back to 365; below 30 refused in code, not clamped). `DATA_RETENTION_MODE`: `dry-run` (default, also for unknown values; counts only), `delete`, `off`. Batches of 500 (findMany then `updateMany` repeating the condition, so a stop changed in between is not touched), at most 20 batches per run, `more` flag, idempotent. Report `{mode, retentionDays, cutoff, expired, scrubbed, batches, more}`, counts only.
- Reason, status, `completedAt`, items, tour, orders and customers stay. The whole `LocalizedText` goes (original, German translation, pending marker). A note still pending translation is scrubbed too; `stopProblemNoteSource.find` no longer returns it and a late `save` is a no-op (tested), so the text cannot come back. The planning view and the problem-note component already treat a missing note as none (`getTourPlan` tested before / after).
- Route `GET /api/cron/data-retention` (`data-retention-cron.ts`, bearer `CRON_SECRET`, 401 without configured secret, 503 `{status:"error"}` without the message), daily 03:47 UTC in `vercel.json`, one log line `[data-retention] {counts}`. Authz matrix (`SECRET_ONLY` row + cron-secret test), `docs/privacy.md` (sections 2, 3, 6), `docs/runbook.md` (section 10: job, switching it on, "Access and erasure requests" with find / edit / SQL steps for notes, driver texts, screenshots, photos, accounts), `docs/env.md`, `docs/deploy.md`, `.env.example`, `AGENTS.md`.
- Audit: the job is exempt in `audit-coverage.test.ts` with a reason (system job without actor; `AuditLog` needs a user id and a per-record entity from a closed vocabulary; precedent screenshot / audit retention) instead of an aggregate audit entry. The integration test proves that nothing but `problemNote` changes.
- Tests: unit `data-retention.test.ts` (env parsing, floor, dry-run / off / delete, batching, `more`, route 401 / 200 / 503, counts-only response); integration `data-retention.integration.test.ts` on embedded Postgres (dry-run changes nothing, old scrubbed / recent kept / DELIVERED and PENDING stops untouched, all other stop columns identical, pending notes and the retry job, idempotent, batch limit and continuation, longer period, planning view). Lint, typecheck, `i18n:check`, 106 unit files (1182 tests), all 37 integration files (422 tests, backup test skipped without its env), `pnpm build` (via `~/b110.sh`) pass.
- Known gap, ticket NUD-121: the `stop.problem` audit entry carries the note cut to 200 characters until the audit retention (730 days) deletes it, i.e. up to a year longer than the stop's own text.
- Not verified: the cron on Vercel / Neon (no production), `prisma migrate deploy` (no migration in this ticket), behaviour with a very large backlog. No UI change, so no e2e run.

#### NUD-113 · 👤 Verify security configuration on the real deployment
**Status:** blocked (items 1-4 verified 2026-10-28; item 5 waits for the operator's DPA confirmation) · **depends_on:** 007, 093

**Goal:** things NUD-093 could not check without production: (1) `curl -sI https://<prod>/de/login` shows the headers of `docs/deploy.md` section 11.1 and the page works in a real Android Chrome and iOS Safari (map tiles, photos, upload, PWA install) with no `csp-violation` lines in the Vercel logs; (2) `scripts/check-storage-private.ts` against the production R2 bucket exits 0; (3) lifecycle rule for `screenshots/` (190 days) created; (4) `CRON_SECRET` set and `GET /api/cron/retention` run once by hand (counts in the answer); (5) data processing agreements and the "to confirm" items in `docs/privacy.md` section 1 and 4 (Vercel, Neon, Cloudflare, DeepL Pro, ORS, tile provider) settled.

**Acceptance criteria**
- [x] Items 1-4 verified and the result noted under the ticket.
  - (1) 2026-10-28 against `https://<server>/delivery-app/de/login`: HSTS (2 years), `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, `cross-origin-opener-policy: same-origin`, `x-dns-prefetch-control: off` and the enforcing CSP with a per-request nonce. The device part (Android Chrome / iOS Safari, tiles, photos, upload, PWA install) was covered by the human device pass on the same day; the CSP violations found in the log are NUD-120.
  - (2) `scripts/check-storage-private.ts` on the production MinIO: "ok bucket listing: anonymous GET -> HTTP 403 / ok object read: anonymous GET -> HTTP 403 — the bucket is private".
  - (3) Applied with the new `scripts/set-bucket-lifecycle.ts --apply`: rule `expire-order-screenshots`, prefix `screenshots/`, 190 days, `Enabled`, read back from the bucket.
  - (4) `CRON_SECRET` is set; all six cron routes ran by hand and answered `exit 0` — **only after the permission fix of NUD-167**, before that every job died unread on the env file. `GET /api/cron/retention` answered 200 with its counts.
- [ ] Item 5 confirmed by the operator. (DPAs for the vServer host, MinIO, OpenRouter, DeepL, OpenStreetMap tiles and now the self-hosted Photon/ORS on the developer PC — that last one is a new data-processing question worth a line in `docs/privacy.md`.)

---

#### NUD-114 · 👤 Set up and verify monitoring and backups on the real accounts
**Status:** todo · **depends_on:** 007, 094

**Goal:** the parts of NUD-094 that need real accounts, in the order of `docs/runbook.md` section 13: (1) Sentry EU project, `SENTRY_DSN` (+ token variables), redeploy, run the test error (runbook section 7) and add an e-mail alert; (2) uptime monitor for `/api/health`; (3) backup bucket, token, `backup_reader` role, GitHub environment `backup` (`docs/deploy.md` section 13.1), run the workflow once and confirm both jobs are green and the failure e-mail arrives; (4) one real restore drill (runbook section 5.4); (5) write the real Neon restore window into runbook section 4; (6) read the first orphan-cleanup dry-run reports and decide on `ORPHAN_CLEANUP_MODE=delete`; (7) confirm `postgresql-client-16` installs in CI.

**Acceptance criteria**
- [ ] Items 1-5 and 7 verified and the result noted under the ticket.
- [ ] Item 6 decided by the operator.

---

#### NUD-115 · 👤 Real-device usability check of the driver app
**Status:** todo · **depends_on:** 095

**Goal:** what NUD-095 could only emulate, checked on real phones.

**Scope**
- Android with system font size at the largest setting and display size large; one iPhone.
- TalkBack / VoiceOver through login, tour, stop, problem sheet.
- Dark mode, bright sunlight, one-hand use while walking (primary actions reachable with the thumb).
- Slow connection or low-end Android: first load and driver home speed.
- A person who does not read the chosen language completes a stop from icons, numbers and photos.

**Acceptance criteria**
- [ ] Findings noted under the ticket; blocking ones became tickets.

---

#### NUD-116 · Warn on the order form when the delivery day's tour is already completed
**Status:** done · **depends_on:** 099

**Goal:** the office learns about a late order while typing it, not only after saving (NUD-099 reports it in the overview, on the dashboard and on the planning page).

**Scope**
- Next to the existing "combined into one stop" / "pin unconfirmed" warnings (`orderWarnings`), show "the tour of this day is already completed, this order needs a follow-up tour" for a CONFIRMED order on a day whose tours are all COMPLETED. Needs a small admin read (or an extension of `confirmedOrderCountAction`'s result) and an authz test / matrix row if it is a new action.

**Acceptance criteria**
- [x] The warning shows while entering and editing such an order (e2e), nothing changes for other days.

**Implementation notes**
- Commit 6620815. New warning `tour_completed` (`src/domain/order.ts`), read action `dayTourCompletedAction` (ADMIN, row in `authz-matrix.test.ts`), `isDayTourCompleted` in `src/server/orders.ts`, key `warningTourCompleted` in de/en/zh-Hans. Shown when the day has tours and all are COMPLETED; an open follow-up tour (NUD-099) gives no warning. The date checked is the planned day, or the window start, like the "combined stop" hint.
- Worker-reported: `orders.spec.ts` desktop 4/4 incl. the new test, `order-window.spec.ts` passed. Mobile project not run for the new test. The "pin unconfirmed" warning in the ticket text no longer exists (NUD-141).

---


#### NUD-117 · Deliver quantity changes on already delivered stops (correction stop)
**Status:** done (2026-10-28; e2e case written, not executed) · **depends_on:** 099

**Goal:** an order that was already delivered and is increased afterwards (NUD-099 only reports it as a conflict note) can be delivered with one action.

**Scope**
- Decide with the office: "Create correction": a follow-up stop for the difference (new quantity minus delivered quantity) instead of asking the office to enter a second order. Keep audit entries and the "never reset delivered stops" rule (NUD-043); decrease / cancel stays a note (goods cannot be un-delivered).

**Acceptance criteria**
- [x] An increase of a delivered order can be put on a follow-up tour with exactly the difference (integration + e2e); decreases are reported only. (Integration: `correction-delivery.integration.test.ts`, 10 tests. **e2e executed 2026-10-28** on the dedicated e2e database with the production build: `late-orders.spec.ts` "correction on a delivered stop: the increase goes onto a follow-up tour, the decrease is only reported" passed, together with the follow-up-tour and banner tests in all four languages (6 passed). Decreases/cancellations: `no_corrections`, nothing written.)

**Implementation notes (NUD-117)**
- One button on the existing conflict note: `createCorrectionDeliveryAction({date})` (`requireRole("ADMIN")`, zod `{date: string.max(10)}`) books, in one transaction under the per-date advisory lock, one CONFIRMED order per affected customer with exactly the increase, then calls the existing `generateFollowUpTour` — the difference lands on a follow-up stop of the same day while the completed tour, its stops and its order links stay identical and no delivered stop is ever reset (NUD-043). A decrease or a cancellation is never "corrected".
- Why an order and not a hand-written stop: `Stop.items` is only the snapshot released to the driver and is rebuilt from its `StopOrder` links on every re-release, so a stop no order explains would be wiped by the next rebuild; an order also keeps totals, load sheet and audit consistent — and it needs no migration (`OrderSource.CORRECTION`/a new column would have).
- Double booking is excluded by a pure `correctionCandidates` (`src/domain/day-tours.ts`, unit-tested): a conflict is only offered while the difference is demonstrably unplanned (customer has no other stop that day and no confirmed order on no stop), and the action requires every tour of the day to be COMPLETED. After one click the offer disappears; a customer with both an increase and a pending late order gets an explanatory note instead of the button, and late orders are booked first.
- When the follow-up cannot be planned (e.g. the customer has neither a Parkplatz nor an Adresspunkt) the orders stay and the office is told to fix the location and create the tour — covered by an integration test.
- Audit: `order.create` with `diff.correction = {reason: "delivered_stop_increase", stopId, lines}` plus the builder's `tour.followup`; no new audit action, no raw DELETE/UPDATE on `"AuditLog"`.
- Tests: 6 unit (increase only, mixed, cancellation, other-stop guard, pending-order guard, per-customer independence), 10 integration, one unexecuted e2e. Typecheck, ESLint (repo-wide), `i18n:check` and the full suite (214 files / 2567 tests) green.
- Follow-up ideas: offer the correction while a tour of the day is still IN_PROGRESS; mark correction orders in the order overview (today only the audit entry tells them apart).

---

#### NUD-118 · Driver app with two tours on one day (offline cache, hint, real device)
**Status:** blocked · **depends_on:** 099, 081

**Goal:** check and, where needed, fix what NUD-099 only covered on the server: a driver who finished tour 1 and receives a follow-up tour the same day.

**Scope**
- Offline cache and service worker: does the cached "today" payload / photos switch from the completed to the released follow-up tour without a manual reload (also while offline-queued taps exist)?
- Home screen: show that this is a second tour ("Tour 2") or at least the new tour's stops clearly; the "tour finished" screen must not hide a newly released follow-up.
- Real-device check (extends NUD-107).

**Acceptance criteria**
- [ ] Driver with a warm cache sees the released follow-up tour after the next sync / focus, without logging out (e2e with the offline helpers); findings of the real-device check noted.

**Implementation notes**
- Commit 843e5b1 (code + e2e done; **real-device criterion open: HUMAN**). `DriverTour` gained `tourNumber`/`tourCount` (zod defaults 1, no cache schema bump); `OfflineSync` calls `router.refresh()` when the stored tour id changes after a sync; `today-tour.tsx` shows a `tour-badge` ("Tour 2 von 2 · Folgetour") when `tourCount > 1`; keys `driver.today.tourBadge`/`followUpHint` in all five locales. Audit: the single IndexedDB record is always replaced, queued taps are keyed by stop id, the server already prefers the open follow-up; two gaps fixed (visible page did not follow the cache; no second-tour hint).
- Verified by me: `driver-second-tour` 6 passed, `driver-outbox` 10 passed (the one flake the worker saw did not reproduce), `late-orders` 2 passed.
- **Human steps (real device, extends NUD-107)** — needs a build with this commit, a test driver on a real Android Chrome phone with the PWA installed (iPhone/iOS Safari too if possible), an admin on a desktop:
  1. Admin: order for today, build and release tour 1 for the test driver.
  2. Phone: log in as the driver, wait for "Offline bereit", then do not log out.
  3. Airplane mode on; mark all stops of tour 1 delivered (pending badge shows queued taps; "Alle Stopps erledigt" visible).
  4. Admin: let the phone sync tour 1 once (or note the order you used), create a late order for today, "Folgetour erstellen", release the follow-up.
  5. Phone: airplane mode off with the app open on the "all done" screen. Within ~1 minute, without logout or pull-to-refresh: queued taps sent, screen switches to "Tour 2 von 2 · Folgetour" with its stops and no "Tour finished" card, status chip back to "Offline bereit".
  6. Repeat with the app in the background/locked while the follow-up is released; re-open: Tour 2 immediately or after one focus.
  7. Offline again: the offline shell must show tour 2 (stops, photos).
  8. Note device/browser versions, time until the switch, iOS PWA behaviour, 375 px screenshots under this ticket, then tick the open box.
- Found: `pickDriverTour` picks the NEWEST open tour, so with two open tours for one driver on one day tour 1's pending stops are hidden (the normal follow-up flow requires all tours completed, so it is not reachable that way) -> NUD-163. Photos of tour 1 are dropped from the cache once a sync switches to the follow-up (acceptable, tour 1 is finished).

---


#### NUD-119 · Driver map: tap on a marker opens the stop detail
**Status:** done · **depends_on:** 081

**Goal:** on the driver's map view a tap on a numbered marker leads to the stop screen (also offline, via the offline shell), as the driver expects from the list.

**Scope**: marker click / keyboard activation navigates to `/driver/stops/<id>` (tooltip with the customer name stays on hover / first tap or a small popup with a "Details" link, simplest that stays usable with 48 px targets); works in the offline shell.

**Acceptance criteria**
- [x] Tapping a marker reaches the stop detail online and offline (e2e, 375 px); axe stays clean.

**Implementation notes**
- Commit ed3541b. Marker tap and Enter/Space navigate straight to `/driver/stops/<id>` (`today-tour.tsx` `router.push`; `tour-map.tsx` gained `activationKey()` and keydown handlers because Leaflet turns Enter into a popup, not a click). No popup / first-tap tooltip: the name stays on hover/focus and in the accessible name. 48 px boxes asserted. New e2e in `driver-map-offline.spec.ts` (online, keyboard, offline shell, axe clean); my re-run: driver-map-offline 6 passed (both projects).
- Behaviour change: a marker tap no longer opens the bottom stop-list sheet / highlights the row (cluster taps still do). Admin planner and maps demo markers now also fire `onSelect` on Enter/Space.

---


#### NUD-120 · 👤 Roll out the strict script CSP on the real deployment (report-only first)
**Status:** in-progress (2026-10-28: policy verified live, report path was broken) · **depends_on:** 110, 113

**Goal:** NUD-110 was verified with Chromium against a local production build only. On the real deployment: (1) deploy first with `CSP_REPORT_ONLY=true`, use the app in real Android Chrome and iOS Safari (login, admin pages, maps, photo upload, driver tour, install the PWA, go offline) and search the Vercel logs for `csp-violation` (expected: none); (2) `curl -sI https://<prod>/de/login` shows `script-src 'self' 'nonce-...' 'sha256-...'` without `'unsafe-inline'`, and a second request shows a different nonce; same for the static `/de`; (3) check the build log of `pnpm build:vercel` for `csp-script-hashes: OK`; (4) remove `CSP_REPORT_ONLY`, redeploy, repeat the smoke test.

**Acceptance criteria**
- [ ] No `csp-violation` lines in report-only on the real devices; the installed PWA works offline (offline shell, generic offline page).
- [x] Enforcing policy deployed, results noted under the ticket. (Verified 2026-10-28 on `https://<server>/delivery-app/de/login`: `content-security-policy` is the enforcing header, `script-src 'self' 'nonce-…'` plus 40 prebuilt-shell hashes and no `'unsafe-inline'`, and the nonce differs between two requests. The vServer deployment has never set `CSP_REPORT_ONLY`, i.e. the strict policy is live since NUD-110.)

**Findings 2026-10-28 (server access, no browser needed)**
- **The violation reports were lost.** The policy's `report-uri` was the root-relative `/api/csp-report`, but the app is served under `/delivery-app/`, so every report was posted to the nginx root and answered with **404** (4 such posts are in `/var/log/nginx/access.log`, all from an **iPhone / WeChat in-app browser** on the driver login page). Fixed: `report-uri` is now base-path aware (`basePathOf()`, unit-tested) and **deployed**: `curl -sI https://<server>/delivery-app/de/login` now shows `report-uri /delivery-app/api/csp-report`.
- The endpoint works end to end: a synthetic report posted through nginx answers `204` and the app logs `[csp-violation] directive=script-src blocked=inline document=… disposition=enforce`. **No real violations have arrived since the deploy** (the 4 old entries are the pre-fix 404s).
- That the reports existed at all means the strict policy **does** block something on iOS WeChat, most likely the in-app browser's injected script. Still open: reproduce on that device, read the journal, and decide between a targeted hash/allowance and accepting the breakage (the office does not support the WeChat browser officially — to be confirmed with the client).
- Open: the offline smoke test on a real device (offline shell, generic offline page) — the human device pass of 2026-10-28 covered the app, not this ticket's protocol.

---

#### NUD-121 · Driver problem text is also copied into the audit log
**Status:** done · **depends_on:** 112

**Goal:** `stop.problem` audit entries store the driver's note (cut to 200 characters) in `diff.note`, so the text outlives the stop's own text (NUD-112, 365 days) by up to a year (audit retention 730 days) and cannot be edited because the log is append-only. Decide with the client: store only `hasNote: true` (and the length) in new entries, or align `AUDIT_RETENTION_DAYS` with `DRIVER_TEXT_RETENTION_DAYS`. Check the history views and tests that read `diff.note`; older entries are not changed (the trigger forbids it) and expire with the retention.

**Acceptance criteria**
- [x] New `stop.problem` entries contain no driver free text (or the client chose the alignment of periods); history view still shows reason and status; `docs/privacy.md` section 6 "Known gap" updated.

### M2.5 — Owner pre-deploy fixes (NUD-122…127)

Requested by the owner before the first deployment (T6 below). Work them **in order, one ticket per session**; NUD-127 must not start before NUD-122…126 are `done`.

**Implementation notes**
- Commit 4d5d570. Redaction chosen over aligning retention: `stop.problem` audit diffs store `reason`, `hasNote`, `noteLength` (only when a note exists) — no driver text. `AuditHistory` zod schema gained `hasNote`; `docs/privacy.md` updated (table row, former "Known gap" now "Audit copy (closed by NUD-121)", section 7). Entries written before the change keep their cut note until the 730-day audit retention removes them (append-only). The history UI shows no "has a note" marker.

---


#### NUD-122 · Photo upload works on the office and driver path
**Status:** done · **depends_on:** –

**Goal:** an uploaded customer photo must end as a `Photo` row that points at an object which really exists in S3/MinIO — on the office path (`src/components/admin/customer-photo-slots.tsx` → `addCustomerPhoto`) **and** on the driver path (`src/components/driver/driver-photo-slot.tsx` → `src/lib/offline/photo-outbox-flush.ts`). Today the bytes arrive in the bucket (one local MinIO holds 111 `customers/<uuid>.jpg` objects with exactly the key shape `/api/uploads` issues) while `Photo` has **zero** `.jpg` rows: `attachCustomerPhoto` (`src/server/customer-photos.ts:68-69`) gates the whole write on `storage.head()` and, when that returns `null`, aborts as `object_missing` — while the UI still reports success. Prime mechanism for the `null`: `getStorage()` (`src/server/storage/index.ts:16-32`) caches **one** instance for the process lifetime and only refuses to fall back to the in-memory `FakeStorage` in production (`fake.ts:17` issues `fake://upload/<key>`, which `head()` can never find).

**Scope**
- Reproduce in a real browser first (office **and** driver), record which storage implementation the server resolved and why `head()` fails; fix that cause — do not paper over it in the UI and do not relax the security posture.
- Office and driver are **two separate code paths** and two separate fixes; a permanently failing outbox entry must not be retried forever (`photo-outbox-flush.ts:132` returns failure `server` and retries without limit, so the driver sees `Wartet auf Versand` forever).
- Close the test gap: `src/lib/upload-image.test.ts` does not exist (the client upload path is untested; `image-uploader.test.tsx` mocks `@/lib/upload-image` away, `driver-photo-slot.test.tsx` mocks `resizeImage`/`enqueuePhoto`, `uploads.test.ts` and the photo integration tests use `FakeStorage`, `tests/e2e/uploads.spec.ts` never PUTs), and `tests/e2e/customer-photos.spec.ts:80` skips itself when `S3_*` is missing — in CI the e2e job has no MinIO service and no `S3_*`, so the only real browser upload never runs.

**Acceptance criteria**
- [x] Office: uploading a STORE and a PARKING photo in `pnpm dev` creates a current `Photo` row per kind whose `storageKey` exists in the bucket; a reload serves the signed URL and the image decodes.
- [x] Driver: a captured photo leaves `Wartet auf Versand` and becomes `Gesendet`, with the same `Photo` row result.
- [x] Storage failure is never reported as success: `/api/uploads` never returns a non-`http(s)` upload URL, and the client treats one as `UPLOAD_FAILED`.
- [x] A permanently failing outbox entry stops retrying and is visible to the driver (notice + the slot offers the photo again); transient/network failures still retry without limit.
- [x] `src/lib/upload-image.test.ts` covers resize, grant (401/403/413/other/network), PUT (2xx/4xx/error/abort/progress) and rejects a `fake://` grant; the unit suite and `pnpm i18n:check` stay green.
- [x] `tests/e2e/customer-photos.spec.ts` fails loudly instead of skipping when `S3_*` is absent; the CI e2e job gets a MinIO service + bucket step so the real PUT/attach path runs.
- [x] No new route handler or server action was needed (the existing `/api/uploads` row in `authz-matrix.test.ts` still covers the route); the matrix test stays green.

**Implementation notes**
- **Reproduction (real browser, Playwright + local MinIO, `pnpm dev` on port 3100).** Office path (`/de/admin/customers/<id>`, `setInputFiles`): `POST /api/uploads` → real presigned URL → `PUT` to MinIO **200** → server action **200** → one `Photo` row (`customers/<uuid>.jpg`, bytes 7449, `isCurrent`) → `HEAD` exists → the slot shows the image. Driver path (own released tour for today, `fahrer-de`): capture → `Pending` badge → **within 2.5 s** `POST /api/driver/photos` `{"outcome":"applied"}` → badge `Gesendet` → `Photo` row with `clientMutationId`. Both paths therefore **work** in the current environment.
- **The reported defect that did reproduce** is the driver outbox: with the storage `PUT` forced to `403` (expired signature / CORS / wrong bucket), the slot stayed on `Wartet auf Versand` for **60+ s across 5 silent retries**, with no error and no notice — the owner's symptom exactly. `photo-outbox-flush.ts` classified every non-ok PUT as failure `server`, which the controller retries with backoff forever.
- **Why the "111 objects, 0 `.jpg` rows" evidence is not a broken office path.** The 40 seeded photos are `.png` and *do* have rows; the 111 `.jpg` objects correlate with e2e runs whose spec deletes its test customer in `finally` (cascade deletes the `Photo` row, leaves the object) — the orphan-cleanup job exists for exactly those. Byte-level: a fresh office upload creates a row every time.
- **Fix (driver):** an *answered* error (rejected `PUT`, failing grant, non-ok register answer) is now counted per entry (`httpFailures`); after `MAX_HTTP_FAILURES = 3` the photo is dropped and an `upload_failed` notice appears ("… Das Foto konnte nicht hochgeladen werden. Bitte neu aufnehmen.", de + zh-Hans + generated Hant), the waiting badge disappears and the slot shows the placeholder again so the driver can retake it. A *network* failure (offline) still retries without limit — offline must never cost a photo (D17). Verified end to end: 3 intercepted PUTs, then the notice, queue empty, no `Photo` row, 12.8 s total.
- **Fix (storage configuration):** `POST /api/uploads` returns `503 STORAGE_UNAVAILABLE` when the storage cannot produce a URL a browser can PUT to, and `requestUploadGrant` rejects a non-`http(s)` upload URL as `UPLOAD_FAILED`; `getStorage()` re-reads the environment and no longer pins a fallback `FakeStorage` for the whole process lifetime. A `fake://upload/...` grant is the half-success that made the UI look alive while nothing was stored.
- **Tests:** new `src/lib/upload-image.test.ts` (10 tests: decode/scale/HEIC/JPEG encode, grant status mapping, dead network, abort, rejected `fake://` grant, end-to-end `uploadImage` with a fake XHR); three new cases in `photo-outbox-controller.test.ts` (notice after 3 answered failures, unlimited retry while offline, a `fake://` grant counted but never PUT to); `uploads.test.ts` now uses a *usable* fake target and has a case asserting the 503; `customer-photos.spec.ts` throws instead of skipping (explicit opt-out `ALLOW_MISSING_S3=1`) and the CI e2e job starts MinIO and creates the bucket.
- **Surprises / follow-ups:** the local `pnpm` on PATH is broken (the managed-version shim is incomplete); `corepack pnpm …` works. The CI workflow change is written but cannot be executed here (no GitHub runner). `tests/e2e/driver-photo.spec.ts` already covers the driver path against real storage but needs a production build; a case for the rejected-PUT → notice flow there would be the natural next hardening step (the unit test covers it today).

---

#### NUD-123 · Add driver / customer / order through the GUI
**Status:** done · **depends_on:** –

**Goal:** adding a driver ("Neuer Fahrer"), a customer ("Neuer Kunde"; there is no separate restaurant entity — restaurants are `Kunde`/`Kunden`) and an order ("Neue Bestellung") must each create the record through the GUI. The likely shared suspect is the redesigned Select/Combobox (one broken Select breaks all three forms at once), but `product-form.tsx:141` looks correct — **reproduce it in a real browser first and diagnose from the observed failure; do not guess.**

**Outcome:** all three flows **work**; the report could not be reproduced. The only verified defect in this area was the *coverage*: the redesign's plural unit labels left the add-order e2e assertions red (NUD-128 covers the sibling specs).

**Acceptance criteria**
- [x] Each flow has a browser reproduction with screenshot + console/network evidence recorded under the ticket before any fix (see notes; no fix was needed).
- [x] Driver create: a new `DRIVER` user with username + 6-digit PIN exists and can log in (DB row `{role: DRIVER, active: true}`, PIN shown once, `drivers.spec.ts` logs in with it).
- [x] Customer create: the record is saved with a confirmed pin (`{pinConfirmed: true}` in the DB, `customer-form.spec.ts` green).
- [x] Order create: the order with its items is saved and appears in the overview (`CONFIRMED` + 1 `OrderItem`, the form navigates to the list; `orders.spec.ts` green after the assertion realignment).
- [x] The e2e coverage of the add-order form is green again; no new UI text was added (the forms were not broken).
- [x] No new server actions (none were needed), so no new `authz-matrix.test.ts` rows.

**Implementation notes**
- **Reproduction (real browser, Playwright + local dev server on port 3100, seeded demo DB).** *Driver*: `/de/admin/drivers` → `create-driver` → Anzeigename/Benutzername → language control (still a **native `<select>`**, `locale-input`) → submit → PIN sheet (`985505`) → DB row created. *Customer*: `/de/admin/customers` → `new-customer` → fields → `customer-find` → candidate → `pin-confirm` switch → `customer-save` → DB row with `pinConfirmed = true`. *Order*: `/de/admin/orders/new` → the redesigned **Combobox** for the customer (typing "Trattoria" narrows 20+ customers to 12 options, the full name to 1) → product Combobox ("Spaghetti" → 5 options) → quantity `3` → delivery date → `order-save` → navigates to `/de/admin/orders?from=…&to=…` with a `CONFIRMED` order and one `OrderItem`.
- **The "shared broken Select/Combobox" hypothesis is not supported:** the create-driver form uses a native `<select>`, the customer form uses no select at all, and the order form's redesigned `Combobox` filtered, selected and saved correctly. Two of my own first attempts failed for **test-side** reasons and are worth remembering: `getByRole("option")` also matches the admin shell's language-switcher options (a `.first()` click then hangs on a non-actionable item), and the order form needs the delivery date filled before it saves.
- **Real defect found and fixed:** `orders.spec.ts` was red because the redesign replaced the plain unit labels with ICU plurals under `driver.units` (re-design.md §9.3) — `"2,5 Packung"` is now `"2,5 Packungen"`. The add-order save itself always worked (the DB rows were created); only the assertions were stale, which is why a red run looked like "add order is broken". The four expectations are realigned.
- **Not reproduced / to check with the owner:** the flows work from a clean browser profile. A stale service worker from an earlier `pnpm start` (the offline test in `RUN-AND-TEST.md` §7 registers one on `localhost:3100`) can serve a pre-redesign shell and break every form at once — DevTools → Application → Service Workers → Unregister (or a hard reload) is the first thing to try if the failure persists. The exact red error text from the owner's attempt was never available.
- **First-start language picker (checked because `drivers.spec.ts` fails here):** the GUI-created driver is stored with `localeChosen = false` (the create form only sets `locale`), login lands on `/{locale}/driver` and the `(app)` layout guard then redirects to `/{locale}/driver/start`, where the picker renders — verified in a browser (a driver written directly into the DB with `localeChosen = false` also reaches `/driver/start`). The spec fails under `pnpm dev` only because `expect(page).toHaveURL(...)` uses its 5 s default while the redirect chain needs an on-demand Turbopack compile; CI runs a production build (`pnpm start`), and `RUN-AND-TEST.md` §8 documents exactly this dev-mode flakiness. No product change.
- **Gates:** `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm i18n:check` ok. `pnpm test`: **1790 passed, 4 skipped**, but the run was reported as failed once because the `afterAll` of `admin-password.integration.test.ts` (`DROP DATABASE … WITH (FORCE)`) hit the 10 s default hook timeout — that file passes in isolation (9.7 s), so it is a flaky teardown, ticketed as NUD-130. E2E: `orders.spec.ts` green on desktop (3/3), `customer-form.spec.ts` green on desktop + mobile (4/4), `drivers.spec.ts`: the management test fails only at its 5 s `toHaveURL` for the language picker under `pnpm dev` (see above); the mobile `orders.spec.ts` list-overflow failure is NUD-129.
- **Follow-up:** NUD-128 realigns the same drift in `order-overview.spec.ts` (verified failing) and `order-screenshot.spec.ts`; NUD-129 covers the admin order list's horizontal overflow at 393 px that the mobile project reports.

---

#### NUD-124 · Product list: relabel `PACK` → Beutel, six real products, archive the demo ones
**Status:** superseded → NUD-138 (owner test 2026-10-26) · **depends_on:** –

**Goal:** the catalog must hold exactly **6** products — *Nudeln* and *Wantan-Teig*, each in *kg* / *Karton* / *Beutel* — replacing the 6 demo products. "Beutel" is the existing `PACK` unit **relabelled** (no Prisma enum change, no fourth unit); `CRATE` = Karton, `KG` = kg. The owner confirmed there are **no real orders** on the demo products (all demo data), so they are retired with the existing `Deaktivieren` soft delete (`active=false`) — products already on an order cannot be hard-deleted (`OrderItem.productId` is `onDelete: Restrict`).

**Scope**
- `messages/de.json` + `messages/zh-Hans.json`: the UI label of `PACK` (and the unit pickers / load sheet / driver quantity views) becomes Beutel + its Chinese counterpart; `zh-Hant-*` generated by `pnpm i18n:build`, never hand-edited.
- `prisma/seed.ts`: the 6 real products with `de` + `zh-Hans` names, units (`KG`, `CRATE`, `PACK`), sort order.
- Migrate the demo data correctly: archive the demo products and, where demo orders exist, move their `OrderItem`s onto the matching new product (orders are transactional history, D19, and are never deleted).
- Check the hard-coded `UNIT_ORDER` (`src/domain/driver-today.ts:3`, `src/domain/load-sheet.ts:9`) and `src/lib/units.ts` follow the relabel rather than a new unit.

**Acceptance criteria**
- [ ] The unit that was `PACK` is labelled Beutel (+ Chinese) everywhere it is shown to the office or the driver; no new enum value, no migration of the `Unit` type.
- [ ] The catalog lists the 6 real products; the 6 demo products are archived and no longer selectable for new orders.
- [ ] Existing demo order items still render and point at a valid product after the migration.
- [ ] `pnpm db:seed` works on a fresh DB and the unit/domain tests pass.
- [ ] New/changed UI text exists in `de` + `zh-Hans`; `pnpm i18n:build` was run.

---

#### NUD-125 · Parking spots: schema + office UI
**Status:** done · **depends_on:** –

**Goal:** a customer has a **list** of parking spots (new `ParkingSpot` table) instead of today's single `PARKING` photo / single `lat`/`lng` pin. The office manages the list. ~~Routing and optimisation keep using the single customer pin~~ — **changed 2026-10-26 (D22): the default parking spot becomes the routing point, see NUD-141.** Still one point per stop.

**Scope**
- Prisma schema + committed migration for `ParkingSpot` (customer, label/note, lat/lng, sortOrder, `active`, timestamps); soft delete only.
- Service layer + server actions (zod, `.max()` on every string, `requireRole`, `rejectCrossOrigin` where it is a route handler) and audit entries in the same transaction (NUD-092).
- Office UI on the customer detail page (add / edit / reorder / remove, first one is the default); new text in `de` + `zh-Hans`.

**Acceptance criteria**
- [x] Migration is committed and `pnpm db:seed` still works on a fresh DB. (migration 20261026200000_parking_spots; fresh-DB migrate + seed verified)
- [x] The office can create, edit, reorder and deactivate parking spots; every write has an audit entry. (parking-spots.integration.test.ts + e2e parking-spots.spec.ts, desktop and mobile)
- [x] Wrong-role access is rejected (authorization test + `authz-matrix.test.ts` rows). (authz-matrix rows for the 4 actions + parking-spots.integration.test.ts)
- [x] `docs/privacy.md` updated if a spot stores free text; screens checked at 1280 px with no horizontal scroll. (section 2 and 6; 1280 px and 375 px screens checked, no horizontal scroll)

**Implementation notes**
- `ParkingSpot` (customer, optional label/note, lat/lng, sortOrder, active, createdById); migration `20261026200000_parking_spots`, nothing migrated or deleted (existing PARKING photo and `Customer.lat/lng` untouched).
- `src/domain/parking.ts` (default = first active by `sortOrder`), `src/server/parking-spots.ts` (service, customer row lock, audit in the same transaction), `src/server/parking-actions.ts` (4 admin actions), `parkingSpotsQuery`.
- Audit: entity `Customer`, actions `parking.create/update/reorder/deactivate`; free text (label, note) is not copied into the log. Office UI: "Parkplätze" card on the customer detail page (`parking-spots-manager.tsx`): add/edit in a dialog with map + coordinate inputs, up/down reorder, remove with confirmation (soft delete). Text in de, en, zh-Hans (+ `maps.parkingMarker` in all five locales).
- Routing, optimisation and the pin-confirmed gate are untouched: that is NUD-141. The driver side is NUD-126.
- Follow-up not done here: no UI to restore a removed spot (the row stays with `active=false`).

---

#### NUD-126 · Parking spots: driver UI, park-first navigation, offline
**Status:** done · **depends_on:** 125

**Goal:** the driver sees the parking spots of his stop and navigation guides him to the **parking spot first**, with the shop entrance as the secondary target.

**Amended 2026-10-26 (owner test F21, D30):** there is **one** "Navigation starten" button only (no separate entrance button). With a Parkplatz the Google Maps URL is `…/dir/?api=1&waypoints=<parkLat>,<parkLng>&destination=<addrLat>,<addrLng>&travelmode=driving`; without one it goes to the address point. Apple Maps: Parkplatz only. Routing uses the Parkplatz (NUD-141), so the acceptance criterion "routing output unchanged" below is void.

**Scope**
- Driver stop detail shows the customer's parking spots (label + note); primary action navigates to the chosen spot, secondary action to the entrance.
- `src/lib/navigation.ts:5-12` currently builds Google/Apple Maps URLs from the single customer pin — extend it to take an explicit target point.
- Offline: the parking list is part of the cached tour (NUD-081 pattern); touch targets ≥ 48 px; text in `de` + `zh-Hans`.

**Acceptance criteria**
- [x] The driver can pick a parking spot and open navigation to it directly; the entrance stays reachable as the secondary target. (amended (D30): ONE "Navigation starten" button; with a Parkplatz it opens Google Maps with the default Parkplatz as `waypoints` and the Lieferadresse as `destination` (`travelmode=driving`), Apple Maps goes to the Parkplatz only; the stop screen lists every Parkplatz with label + note. No picker and no entrance button, see §9. Unit: navigation.test.ts, stop-detail.test.tsx (5 locales))
- [x] The parking list is available offline from the cached tour. (payload carries `parkingSpots` + `addressLat/addressLng`; e2e driver-offline compares the offline Parkplatz card and navigation link with the online render (desktop + mobile))
- [x] Routing/optimisation output is unchanged (still one point per stop). (void per the amendment: routing uses the Parkplatz since NUD-141 (D22); this ticket does not touch routing)
- [x] Driver screen checked at 375 px, no horizontal scroll; new text in `de` + `zh-Hans`. (e2e driver-offline, driver-stop (375 px, all 5 locales), driver-today, driver-usability, driver-key, mvp-happy-path on desktop + mobile: 51 passed, 7 skipped; no horizontal scroll; the Parkplatz card has no tap targets of its own (the navigation button stays 48+ px); texts in de, en, zh-Hans, sr-Latn, cs)

**Implementation notes**
- `PayloadStop` (the one driver data model, online and offline) gained `addressLat/addressLng` and `parkingSpots[{label,note,lat,lng}]` (active spots in `sortOrder`; `parkingSpotsForDriver` in `routing-points.ts`); the zod schema defaults them to `null`/`[]`, so a cache written before this ticket still parses and navigates to the single routing point.
- `src/lib/navigation.ts`: `stopGoogleNavigationUrl` (Parkplatz as `waypoints`, address as `destination`, `travelmode=driving`; single point when there is no Parkplatz or no address point) and `stopAppleNavigationUrl` (routing point = Parkplatz only). Used by the stop screen and the next-stop card; the depot link is unchanged.
- Stop screen: read-only "Parkplätze" card (label or "Parkplatz N", note, "zuerst" on the default) between the navigation button and the delivery card; hidden when the customer has none. New keys `driver.stop.parking*` in all five locales. `docs/uat.md` D-15 and `docs/privacy.md` (note now also reaches the driver's offline copy) updated.
- Checks: lint (only the expected fontstub warning), typecheck, `pnpm test` 1996 passed / 4 skipped, i18n:check, fresh-DB migrate + seed (also `--demo --no-photos`), e2e as ticked above. driver-a11y was not re-run (its fixtures have no Parkplätze; the card adds no new interactive element).
- Follow-up not done: drivers adding/correcting Parkplätze is NUD-144; the card is read-only here.

---

#### NUD-127 · 👤 Deploy to the vServer (handoff doc)
**Status:** done (2026-10-26; the owner asked for it directly, ahead of NUD-124…126) · **depends_on:** 122, 123, 124, 125, 126

**Goal:** deploy the app to the vServer following `docs/handoff-vserver-deploy-and-help.md` (T6). **HUMAN ticket.** The document has two deliverables; this ticket now covers **deliverable 1 (the automated deploy)** first, because the owner wants to install the driver PWA from `https://87.106.60.131/delivery-app/de/driver`. Deliverable 2 (`hand-off.html`) becomes its own ticket after the app is live.

**Measured on the server (read-only ssh, 2026-10-26)** — the doc's own "step 0":
- Ubuntu 24.04.3, 2 vCPU, **1855 MB RAM, no swap**, 66 GB free on `/`.
- Node **v22.23.3** ✓; **pnpm missing** (install via corepack); **Docker 29.1.3 present** and already hosting other apps; **nginx 1.24** (no Caddy); **PostgreSQL not installed**; **port 3100 free**, the quiz is on `127.0.0.1:3000`.
- nginx: the IP vhost `/etc/nginx/sites-enabled/ip-https` is the `443 default_server` for `87.106.60.131` and `include`s `snippets/quiz-game.conf`. `/quiz` is proxied with `proxy_pass http://127.0.0.1:3000/;` (trailing slash = prefix stripped); ours must use **no URI part** because the build carries `basePath`.
- **TLS is solved:** `/etc/letsencrypt-ip/live/ip-cert/fullchain.pem`, Let's Encrypt, SAN `IP Address:87.106.60.131`, renewed by `certbot-ip.timer`. A trusted secure context, so the PWA install is not blocked by a certificate warning (this was open decision §11 #2).
- Still open for the first run: RAM is below the ~2 GB the doc wants for `next build` → add 2 GB swap before building; confirm the MinIO images still pull.

**Acceptance criteria — all verified against the live server on 2026-10-26**
- [x] `https://87.106.60.131/delivery-app/de/login` and `/de/driver/login` work over HTTPS, `/api/health` reports `ok` for database and storage, and the app works under the `/delivery-app/` prefix. Evidence: both login pages 200 with the CSP header nonce on all inline scripts, `/api/health` 200 `{"status":"ok","checks":{"database":{"status":"ok"},"storage":{"status":"ok","mode":"s3"}}}`, `/` 404, `/delivery-app` → 302 → `/delivery-app/admin`, manifest `scope=/delivery-app/` + `start_url=/delivery-app/driver?source=pwa`, and `sw.js` 200 with `Cache-Control: no-cache, no-store, must-revalidate`. On the public origin the worker reaches `ready` with scope `/delivery-app/`, a prefixed precache and `isSecureContext: true`.
- [x] `https://87.106.60.131/quiz/` and every other site on that nginx are unchanged: `/quiz/`, `/vision-loop/` and `/restaurant-demo/` (the IP vhost's siblings) all still 200 after the change; the config was backed up, `nginx -t` was clean and the reload only ran after a successful test. **Nuance:** the include injection (like the quiz deploy's) adds `include snippets/delivery-app*.conf;` to every enabled server block, so `/delivery-app/…` is also reachable on the other hostnames (login required). The domain vhosts (`medicleaner.at`, `mc-dream.education`, …) are not resolvable from the development machine and were therefore not re-checked.
- [x] `deploy.bat` deploys/updates the running tree in one run and is idempotent; the service restarts on boot. Evidence: three consecutive runs (two after fixing the tarball excludes), swap/Postgres/MinIO/nginx steps all report "nothing to do" on the later runs, `systemctl is-enabled delivery-app` → `enabled`, `is-active` → `active`.
- [x] No secret in the repo; the server env file is `chmod 600`; `SEED_DRIVERS` is **not** left enabled and `ENABLE_ERROR_TEST_PAGES` is not set. Evidence: `/etc/delivery-app.env` is `600 root:deliveryapp`, there is no `.env` in the deployed tree, `git grep` finds no secret, the service unit sets no error-test flag, and the seed ran with `SEED_DRIVERS=false` (no demo drivers exist).
- [x] The office and driver apps are usable end to end with real data entered through the UI. Evidence: depot pin confirmed, two customers with confirmed pins (Gasthaus Zur Alpenrose, Bäckerei Krammer), one CONFIRMED order each for 2026-10-26, and a tour for that day **RELEASED** to the driver `tablet-wien`; the office UI shows `Freigegeben` with 2 stops (ETAs 07:23 / 08:18), and the driver app shows `Heutige Tour 0 / 2 erledigt · 2 offen · Ende ca. 09:48`, `Nächster Stopp … Bäckerei Krammer, Landstraßer Hauptstraße 45, 1030 Wien, 4 × Penne 5 kg Packungen`, working stop links, a Maps navigation link, `Offline bereit ✓` and no console errors.
- [x] `docs/deploy.md` gets the new self-hosting section, `AGENTS.md` mentions `deploy.bat`, `.env.example` documents the three `REMOTE_*` keys, and the work is committed per convention. Commits `a315644`, `a0e50a0`, `82e0a50` on `task/123`.
- **DoD note:** `pnpm lint` (0 warnings), `pnpm typecheck`, `pnpm test` (1806 passed / 4 skipped) and `pnpm i18n:check` are green on this tree. `pnpm test:e2e` was **not** re-run as a suite in this session; the sub-path UI behaviour was verified instead with a purpose-built Playwright spec against a local sub-path production build (3/3: CSP nonce, `sw.js`/health headers, office and driver login, help-page search, worker scope + prefixed precache, and a driver login while the worker controls the page) and then end to end against the live server.

**Implementation notes:** filled in as the deploy progresses.
- **Built so far (local, not yet on the server):** `deploy.bat`, `deploy/deploy.ps1` (pre-flight refuses a dirty tree unless `-AllowDirty`, installs the SSH key on first run, packs with the doc's excludes, runs the server script over ssh), `deploy/server-setup.sh` (stages 0-11: swap, Node, pnpm via corepack, PostgreSQL 16 with an idempotent role/db, MinIO in Docker, `.new`/`.old` code swap, `/etc/delivery-app.env` chmod 600 with secrets generated once, install/migrate/build as the service user, systemd unit, nginx snippet + include injection with backup and rollback, health checks), `deploy/delivery-app.nginx.conf`, `deploy/delivery-app.service`. `docs/deploy.md` gained section 13, `AGENTS.md` a line under Commands, `.env.example` the three `REMOTE_*` keys. Both scripts pass a syntax check (`bash -n`, PowerShell parser).
- **Deliverable 2 begun:** `content/hand-off/` (types, the topic data, the validation test) is being written against the doc's section 8; `scripts/lib/hand-off-page.ts` builds the HTML/CSS/data/behaviour as pure functions, `scripts/build-hand-off.ts` writes the four files into `public/` and fails the build on a broken index. The page renders every topic in **both** languages inside one article per topic (so `#topic-<id>` is unique and the page is complete with JS disabled), loads only relative asset URLs and contains no inline script or handler.
- **Deliverable 2 done and verified (51 topics / 84 glossary terms):** `pnpm build` writes `public/hand-off.{html,css,js,data.js}`; `content/hand-off/index.test.ts` (labels must exist verbatim in `messages/de.json`, ids, step counts, the `waren typ hinzufügen` acceptance phrase) needed `content/**/*.test.ts` in `vitest.config.ts` and `// @vitest-environment node` (jsdom has no `readFileSync(new URL(...))`). Browser-verified: `waren typ hinzufügen` and `添加产品` each hit exactly the product topic and clicking focuses `#topic-produkt-anlegen`; the language switch persists in `localStorage`; print hides the controls; **without JavaScript both languages are visible** (the CSS only hides the inactive one once the script sets `body[data-js]`); no console errors. Linked from both login screens and the admin user menu through `withBasePath` (a relative href would resolve to `/de/driver/hand-off.html`). The static-file CSP branch (`script-src 'self'`, `style-src 'self' 'unsafe-inline'`) allows the external files — no relaxation needed.
- **Next.js sub-path facts, established empirically (not from the guides):**
  - `redirect()` from `next/navigation` **does** get the base path (Next calls `addPathPrefix` in `app-render.js`), so page guards, auth actions and `postLoginPath` keep unprefixed paths.
  - `NextResponse.redirect(new URL(target, request.url))` does **not** (the URL is resolved against the origin), so `src/proxy.ts` and `/api/session-ended` build their targets with `withBasePath`.
  - The proxy matcher **is** prefixed by Next at build time and matched against the full pathname (`regexp: ^\/delivery-app(?:…(?!api|_next|_vercel|.*\..*)…)` in `.next/server/functions-config-manifest.json`), while `request.nextUrl.pathname` inside the middleware is already stripped.
  - `headers()` sources are prefixed by Next **as well** — the opposite of what source-reading suggested. Adding the prefix by hand produced `/delivery-app/delivery-app/...` in `.next/routes-manifest.json`, which silently cost `/delivery-app/api/health` its CSP header and `/delivery-app/sw.js` its `Cache-Control: no-store` (a deployed worker would then have been cached immutably and never updated). Symptom to remember: `curl -i …/sw.js` showing `public, max-age=0` instead of the configured value. The sources in `next.config.ts` are therefore unprefixed.
- **Verification gotcha:** never start `next start` while a build is still writing `.next` (even after `BUILD_ID` appears). Doing so produced a 30 s `/delivery-app/de/login` 500 with `Failed to proxy http://localhost:PORT/… ECONNRESET`, which looks exactly like a base-path or host-binding bug. It is not: with the completed build, `HOSTNAME=127.0.0.1` plus `Host: <public>` / `X-Forwarded-Proto: https` (what nginx forwards) returns 200.
- **Object storage on the server (deviation from the doc's section 6.3, on purpose):** a prefix-stripping proxy such as `/delivery-app-s3/` cannot work, because a presigned URL is signed over the exact request path the SDK built from `S3_ENDPOINT`; nginx stripping the prefix makes MinIO verify a different path, so every upload fails with `SignatureDoesNotMatch`. Instead `S3_ENDPOINT=https://<host>` (no path) with `location /nudel-photos/ { proxy_pass http://127.0.0.1:9000; }` (no URI part, `Host $host`) — the signed path, the forwarded path and the path MinIO verifies are the same, and only that one bucket is exposed. `storageSources()` in the CSP derives the origin from `S3_ENDPOINT`, so the browser may PUT/GET there.
- **Server pre-flight (read-only ssh, 2026-10-26):** nothing named `nudel`/`delivery-app` exists anywhere in `/etc/nginx`, so the include cannot collide; the IP vhost has a catch-all `location /` that a longer prefix wins over; port 3100 is free (the quiz holds `127.0.0.1:3000`); Docker is present but no MinIO image is pulled yet (the one unverified pull); 1.8 GB RAM without swap confirms the script's swap step is needed; 66 GB free.
- **Deployed 2026-10-26 (`deploy.bat`, commits `a315644` + `a0e50a0`).** The server run did: 2 GB swap, Node 22, pnpm 12.14.0 (a real global install; the service user's HOME would otherwise have to download a corepack shim), PostgreSQL 16 + role/database, **MinIO in Docker with the bucket (both chainguard images pulled fine — the doc's unverified risk is closed)**, code to `/opt/delivery-app` with `.old` kept, `/etc/delivery-app.env` (chmod 600, secrets generated once), `pnpm install --frozen-lockfile` (863 packages), `prisma migrate deploy` (12 migrations, none pending), `pnpm build` (166 pages, ~2 min with swap), systemd service enabled+active on 3100, the nginx snippet included into `ip-https` (backup + `nginx -t` + reload). Live: `/delivery-app/api/health` 200 `{"status":"ok","database":"ok","storage":"s3"}`, `/delivery-app/de/login` 200, `/delivery-app/de/driver/login` 200, `/delivery-app/hand-off.html` 200, `/delivery-app` → 302 → `/delivery-app/admin`, and **`/quiz/` still 200**.
- **Three faults found and fixed during the deploy (all in the deploy tooling, none in the app):**
  1. The pre-flight counted untracked scratch as "dirty" and refused to deploy a clean tree; it now checks tracked changes only (untracked scratch is excluded from the tarball anyway).
  2. `--exclude=./messages/_fragments` broke the build: `next build` type-checks test files, and four component tests import locale fixtures from there (deploy failed after the first `next build`; `set -e` aborted before systemd/nginx, so nothing was exposed). Directory excludes are also unreliable for nested paths, so `docs/` is excluded as a whole (a top-level prune, which works) and the tarball is verified at 1.5 MB / 1003 entries with no junk.
  3. Every HTML page under the prefix answered **502** with `upstream sent too big header while reading response header from upstream` while `/api/health` worked: the upstream header is 4247 bytes (per-request CSP nonce + the sha256 hashes of the prebuilt shells), just over nginx's 4 kB `proxy_buffer_size`, which is used even with `proxy_buffering off`. The snippet now sets 16k header buffers (`a0e50a0`).
- **Production data:** seeded with `pnpm db:seed` (`SEED_DRIVERS=false`, so no demo drivers): settings + one ADMIN + the 6 demo products. The admin password was set once with `pnpm admin:reset-password` (the first attempt generated a placeholder because a PowerShell RNG call failed silently — caught and replaced). The catalogue still holds the demo products; NUD-124 replaces them.
- **nginx scope of the change (worth knowing):** the include injection adds `include snippets/delivery-app*.conf;` to **every** enabled server block, exactly like the quiz deploy does for `/quiz`. So `/delivery-app/…` is also served on the other hostnames of that nginx (login required; no data exposed) and the HTTP blocks redirect it to HTTPS. The IP vhost's own siblings were re-checked after the change: `/quiz/`, `/vision-loop/`, `/restaurant-demo/` all still 200. The domain vhosts (`medicleaner.at`, `mc-dream.education`, `tool.mc-dream.education`) are not resolvable from the development machine, so their behaviour after the change was NOT verified — if that matters, the python pass should be narrowed to the IP vhost only (one condition, then one more deploy run).
- **Known, deliberate deviation from the doc:** the doc's §6.4 says `NEXT_PUBLIC_BASE_PATH` belongs only in the build step. It must also be in the service environment: `next start` re-reads `next.config.ts` (basePath, headers) at boot, and the value has to match the one the client bundles were built with. The env file sets it, the build and the service read the same file, and the deploy passes it explicitly to the build so a `runuser` environment subtlety cannot ship an unprefixed build.
- **Still open at the time of writing:** the office and driver flows with real data on production (one driver, two customers, one order each, one released tour) were being entered through the deployed UI by a separate agent, which is the last acceptance criterion. The catalogue is still the demo one (NUD-124) and there are no parking spots (NUD-125/126).
- **Deployment hygiene verified on the server:** the 2 GB swap is in `/etc/fstab` (persistent; 586 MB of it was used during the build), the service is `enabled` and runs as `deliveryapp` with `ProtectSystem=strict` and `ReadWritePaths` limited to `/opt/delivery-app/.next` and `/var/lib/delivery-app`, `/etc/delivery-app.env` is `600 root:deliveryapp`, and the deployed tree contains no `.env` (the only matches for `AUTH_SECRET=` are in next-auth's own files). Disk: 61 GB free.
- **Not scheduled yet (follow-up):** no systemd timer/cron for the retention and backup jobs, so `docs/runbook.md`'s jobs never run on this host — retention stays in `dry-run` (nothing is deleted, which is the safe default) but **there is also no automatic database backup**. The server's own `certbot`/`certbot-ip` timers are present and untouched. Worth a ticket before the office keeps real data in it.

---

#### NUD-128 · Realign the order e2e assertions with the redesign's plural unit labels
**Status:** done · **depends_on:** –

**Goal:** the redesign replaced the plain unit labels with ICU plurals under `driver.units` (re-design.md §9.3): `"2,5 Packung"` is now `"2,5 Packungen"`, `"1 Packung"` stays singular. `orders.spec.ts` was realigned in NUD-123; these two specs still assert the old singular and are red for that reason alone:

- `tests/e2e/order-overview.spec.ts` — lines 160, 161, 164, 256, 269, 282, 291. **Verified failing** (the detail view renders `"3,75 Packungen · Spaghetti 5 kg1 Packung · Penne 5 kg"` where the spec expects `"3,75 Packung · …"`); the first test in that file also failed after 2.5 min, so re-run it and check whether anything besides the labels is stale.
- `tests/e2e/order-screenshot.spec.ts` — line 231. Not yet run; check it.

**Acceptance criteria**
- [x] Both specs pass on the `desktop` and `mobile` projects (or the remaining failure is shown to have a different, separately ticketed cause).
- [x] Only expectations are changed — no product behaviour and no test step is weakened.
- [ ] Any further redesign drift found while doing this gets its own ticket instead of being edited in passing.

**Implementation notes**
- Commit d25442a. Only `order-overview.spec.ts` changed; `order-screenshot.spec.ts` needed nothing (its unit words were already Sackerl/Kiste from NUD-159). The ticket text still says "Packung(en)" — stale since NUD-159.
- Further redesign drift (Von/Bis inputs hidden unless "Benutzerdefiniert", status chips `aria-checked` instead of `aria-pressed`, sums card collapsed by default) was fixed **inside this ticket** as expectation/navigation steps, because the spec could not go green otherwise. The third criterion ("own ticket instead of in passing") is therefore deliberately **not ticked**. Worker-reported e2e: order-overview 8/8, order-screenshot 6/6 (production build, scratch config). Idea: a shared `openTotals()` helper.

---


#### NUD-129 · Admin order list overflows horizontally at phone width
**Status:** done · **depends_on:** –

**Goal:** `orders.spec.ts` asserts "no horizontal scroll" on the order list and fails on the `mobile` project (Pixel 7, 393 px) after a **successful** save: the list renders wider than the viewport. Measured while working NUD-123; the order itself was created correctly, so this is layout only.

Overflowing elements reported by the spec's own check: `DIV.flex flex-col gap-1`, `SPAN.text-sm font-medium`, `DIV.inline-flex items-center gap-1 rounded-md bg-muted p-0.5 h-1` (a `SegmentedControl`), `BUTTON.inline-flex min-w-0 flex-1 …`, `SPAN.truncate`, `TABLE.group/table w-full caption-bottom text-base [&_td]:px-2 …`.

Note: the admin area is specified for 1280 px (§5 DoD), but the suite runs the admin specs on the `mobile` project too, so either the list is made to fit (preferred — a phone is what the office uses while looking at a WhatsApp screenshot, D6) or the spec's expectation is scoped to desktop **with a comment explaining why**.

**Acceptance criteria**
- [x] Reproduce at 393 px, identify the element that pushes the width (no `overflow-x` masking).
- [x] `orders.spec.ts` passes on both projects.
- [x] No horizontal scroll at 393 px on the order list and the order detail; screenshots added.
- [x] If the decision is "desktop only", the spec says so explicitly instead of silently skipping the check.

**Implementation notes**
- Commit 7b5971a. Cause: the Status/Source chip groups were `w-auto shrink-0` (five chips pushed the page wider), the range quick-pick had `overflow-x-auto` masking it (removed), and the `PageHeader` actions wrapper on the order detail was `shrink-0` with no max width. All now wrap (`order-filters.tsx`, `page-header.tsx`; the latter is shared by all admin pages, width constraint only). `orders.spec.ts` also opens the order detail, asserts no horizontal scroll and takes a screenshot. Measured 393/393 and 1280/1280 scrollWidth/clientWidth. One mobile-only ECONNRESET flake on the shared Postgres, passed on retry.

---


#### NUD-130 · Give the admin-password test teardown the same timeout as its setup
**Status:** done · **depends_on:** –

**Goal:** `src/server/admin-password.integration.test.ts` fails `pnpm test` at random with `Error: Hook timed out in 10000ms` in its `afterAll` (`DROP DATABASE IF EXISTS "…" WITH (FORCE)`) while **all** tests pass (seen on 2026-10-26: `Test Files 1 failed | 164 passed`, `Tests 1790 passed`; the same file passes in isolation in 9.7 s). The `beforeAll` already passes an explicit timeout, the teardown does not.

**Acceptance criteria**
- [x] The `afterAll` gets an explicit timeout (or the file sets `hookTimeout`), with a one-line reason.
- [ ] `pnpm test` is green three times in a row with a warm dev server and Postgres under load.
- [x] No test behaviour is weakened — only the teardown's timeout changes.

**Implementation notes**
- Commit 5236598. `afterAll(..., 120_000)`; one line. The "`pnpm test` green three times in a row" criterion is **not ticked**: it was not run and is not reproducible while other jobs share this Postgres. On the merged tree one `vitest run --maxWorkers=2 --hookTimeout=60000` run was 199 files green.

---


#### NUD-131 · The dev server serves 127.0.0.1 a page whose buttons do nothing
**Status:** done · **depends_on:** –

**Goal:** reported by the owner while testing on the tablet/desktop: at `http://127.0.0.1:3100/de/driver/stops/<id>` **no button works** — not `Geliefert`, not `Problem`, not `Foto aufnehmen` — while the page itself renders. `localhost:3100` worked, which is why no test saw it (the whole e2e suite uses `localhost`).

**Acceptance criteria**
- [x] Root cause identified from the real failure, not guessed.
- [x] `http://127.0.0.1:3100/...` is as interactive as `localhost:3100/...`; the 13 HMR errors are gone.
- [x] The fix is development-only and does not relax anything in production (`allowedDevOrigins` has no effect on a build).
- [x] Verified in a browser on both origins, side by side.

**Implementation notes**
- **Reproduction, both origins, same dev server, same DB row** (`Stop` reset to `PENDING` before each run): at `localhost:3100` clicking `btn-delivered` showed the result panel, wrote `DELIVERED` and sent `POST …/sync` (origin `http://localhost:3100`); at `127.0.0.1:3100` the **same click produced zero requests**, the stop stayed `PENDING`, and the console showed 13 × `WebSocket ws://127.0.0.1:3100/_next/hmr … net::ERR_INVALID_HTTP_RESPONSE`. A fresh browser profile with **no** service worker behaved identically, so it was neither the SW nor hydration of a stale bundle.
- **Cause:** Next.js 16 blocks requests to dev-only assets and endpoints from origins other than the one the dev server was started with (`localhost` by default) — the bundled doc `node_modules/next/dist/docs/…/allowedDevOrigins.md:8-20` states it, and the client runtime never starts, so React handlers never fire. Nothing in `next.config.ts` widened that list.
- **Fix:** `allowedDevOrigins: ["127.0.0.1"]` plus optional extra hostnames from `DEV_ALLOWED_ORIGINS` (comma separated, hostnames only) in `next.config.ts`, so a phone or a tunnel on the LAN does not hit the same trap during the NUD-107/109/115 real-device checks. Documented in `.env.example` and `docs/env.md`.
- **Re-verified after the fix:** `127.0.0.1:3100` → result panel shown, stop `DELIVERED`, `POST …/sync` sent, **0** console errors; `localhost` unchanged. `pnpm lint`, `typecheck`, `i18n:check` green.
- **Not changed:** the app's own `PwaRuntime` still registers the worker in production only (`src/components/driver/pwa-runtime.tsx:27`). A worker installed by an earlier `pnpm start` on the same origin keeps controlling it in dev — the one-time fix stays "DevTools → Application → Service Workers → Unregister".

#### NUD-132 · Brighter design with a light/dark toggle of its own
**Status:** done (2026-10-26, deployed and verified live) · **depends_on:** – · asked for by the owner directly ("make the design brighter and let there be a toggle button for light and dark mode and deploy it"), so it jumps the queue ahead of NUD-124…126.

**Goal:** the app only ever showed its dark colours when the *device* preferred dark (`@media (prefers-color-scheme: dark)` in `globals.css`), with no way back — on the owner's tablet that looked like "the app is dark". Make the bright design the default, brighten both schemes, and add a switch the user controls.

**Acceptance criteria**
- [x] Light is the default scheme, and it is brighter than before (surfaces lifted, contrast still ≥ AA). `--background` 97 % → 98.5 %, `--muted` 93 % → 95.5 %, `--border` 88 % → 90 %; the dark scheme is lifted too (`--background` 8 % → 13 %, `--card` 12 % → 17 %), which is what "brighter" had to mean for a driver at night. Measured in the browser: body `rgb(253,252,250)` in light, `rgb(37,32,29)` in dark (previously near-black).
- [x] A toggle switches light ↔ dark; the choice survives a reload and the next request is rendered in the right scheme (no flash). Verified at three places (admin shell, driver login, driver app) including `reload()` after each switch; the class is applied before the first paint by a blocking `public/theme.js` that reads the `NEXT_THEME` cookie.
- [x] The toggle is reachable in the admin header (icon, 40 px), in the driver top bar's overflow sheet (row, 48 px — the 375 px bar keeps its 4 controls: measured **0** toggles in the header) and on both login screens (labelled, 48 px).
- [x] No inline script and no new CSP relaxation: the bootstrap is a file (`'self'`), the sun/moon icons swap in CSS, and the browser runs report **no CSP violations and no console errors**.
- [x] New UI text in `de` + `zh-Hans` (`zh-Hant-*` regenerated by `pnpm i18n:build`); gates green; screens checked at 375 px and 1280 px.
- [x] Deployed to the vServer and verified there (commit `752390e`, deploy run of 2026-10-26): `/delivery-app/theme.js` 200 with the prefixed URL, the served HTML carries the blocking `<script src="/delivery-app/theme.js">`, and a browser run against **https://87.106.60.131** is green 2/2 — office login bright by default, toggle → dark, survives a reload, the admin shell in both schemes, and the demo driver `tablet-wien` in the driver app: dark after the login navigation, 0 toggles in the 375 px bar, toggle in the overflow sheet, survives a reload. No console errors, no CSP violations. `/quiz/` still 200.

**Implementation notes**
- `src/lib/theme.ts` — dependency-free constants (`THEME_COOKIE`, `THEMES`, `DEFAULT_THEME = "light"`, `isTheme`, `resolveTheme`, `otherTheme`). It deliberately does **not** import zod: the service worker and the build scripts pull these constants in; `src/server/theme.ts` validates with zod instead.
- `src/server/theme.ts` (`persistTheme`, mirrors `persistLocale`) + `src/server/theme-actions.ts` (`setThemeAction`: cookie + `revalidatePath("/", "layout")`, public like `setLocaleAction`, with a `PUBLIC` row in `src/server/authz-matrix.test.ts`).
- `src/components/shared/theme-toggle.tsx` — variants `icon` / `row` / `labeled`. It reads the current scheme from `document.documentElement.classList` and swaps the icon in CSS (`dark:hidden` / `hidden dark:block`), so there is no hydration mismatch and no theme prop to thread through.
- `@custom-variant dark (&:where(.dark, .dark *))` in `globals.css`: Tailwind v4 defaults `dark:` to `prefers-color-scheme`, which would keep the two mechanisms disagreeing (the few `dark:` utilities in the driver's status actions now follow the toggle).
- **The server cannot render the class.** Reading the cookie in the root layout made every route "runtime data" and the `cacheComponents` build refused to prerender any static shell (`Next.js encountered uncached or runtime data during prerendering`, ~15 routes). The bootstrap file is the way around it.
- **`next/script strategy="beforeInteractive"` does not work here:** it emitted only `<link rel="preload" href="/theme.js">` plus `self.__next_s.push(["/theme.js",{}])`, i.e. the class arrived after the first paint and the app flashed light. The layout therefore uses a plain `<script src>` (with one justified `eslint-disable-next-line @next/next/no-sync-scripts`) — measured in the served HTML: `<script src="/theme.js"></script>`, no `async`/`defer`.
- **Bug found while verifying (fixed):** after the driver login the cookie was `NEXT_THEME=dark` but the page rendered light — the login is a client-side navigation and React re-rendered the layout's `className`, wiping the imperatively-set class. `src/components/shared/theme-class.tsx` re-applies it after every navigation (`usePathname`, wrapped in `Suspense` because `cacheComponents` requires it around URL data).
- **Offline page:** `scripts/lib/offline-page.ts` reads the same cookie and only needs `color-scheme`, so the service worker's offline page follows the choice too (`:root` light / `.dark` dark instead of `light dark`).
- **Toaster:** sonner's `theme="system"` was replaced by a `theme` prop defaulting to light; the toast colours already come from our tokens, so the surface follows the class on `<html>`.
- **Known limitation:** with JavaScript disabled the bootstrap cannot run, so the app is light. Acceptable (and noted here): the alternative needs either an inline script (against NUD-110) or a dynamic shell (breaks prerendering).
- **Also not changed:** `PWA_THEME_COLOR` (`#9a3412`, the terracotta brand colour) still drives the manifest `theme_color`, the driver viewport `theme-color` and the fatal-error page. Deliberate: it is the app's identity in both schemes and needs no follow-up.

---

#### NUD-134 · Load sheet: Deutsch/中文 printout, readable in dark mode
**Status:** done (2026-10-26, deployed and verified live) · **depends_on:** –

**Goal:** the owner reported from the live app that the language pill buttons on the print page were unreadable. The toolbar card follows the colour scheme now, and the load sheet offers exactly **two** printout languages: **Deutsch** and one Chinese option **中文** (the simplified `zh-Hans` sheet). The three regional Chinese labels (`简体中文` / `繁體中文（香港）` / `繁體中文（台灣）`) are gone. A German-only phase in between was dropped again on the owner's request.

**Acceptance criteria**
- [x] The picker has exactly two links, `load-sheet-locale-de` ("Deutsch") and `load-sheet-locale-zh-Hans` ("中文"); the current one carries `aria-current="true"` and the labels stay untranslated. Measured on the live server in both schemes: `["Deutsch","中文"]`.
- [x] `?locale=de` and a missing `?locale=` print the German sheet; `?locale=zh-Hans` prints the simplified Chinese sheet (`装车单`); `zh`, `zh-Hant-HK` and `zh-Hant-TW` fold onto that same sheet; anything else falls back to German, independent of the admin UI language.
- [x] The toolbar card is readable in light and dark mode (no hardcoded `bg-white` under theme-coloured buttons); the 中文 sheet still shows the German product name in small type (`productLabel`, unchanged). Measured contrast on the live server: Deutsch 5.45 (light) / 6.30 (dark), 中文 16.63 / 14.82, Zurück zur Tour 16.63 / 14.82, Drucken 5.45 / 6.30 - all above the WCAG AA 4.5.
- [x] `src/lib/load-sheet-locale.ts` and its unit test cover every branch of `parseSheetLocale` and are green.
- [x] `docs/tour-planning.md` and the NUD-091 locale note describe the two-option behaviour, and `tests/e2e/load-sheet.spec.ts` asserts the German default, the `zh-Hans` sheet, the folded Hant variant, both toolbar links and the print-media overflow.
- [x] `pnpm typecheck`, `pnpm i18n:check` and ESLint on the touched files are green (the load-sheet locale unit tests too). Gates on the committed tree: lint 0, typecheck 0, i18n:check ok, **1823 tests passed / 4 skipped**.
- [x] Deployed to the vServer and verified there (commit `6ace259`): the planner button href is `/delivery-app/de/admin/tours/<id>/print?locale=de` with `target="_blank"`, clicking it opens a new tab that loads the toolbar, both schemes pass the contrast checks above, and `/quiz/` is still 200.

**A second, separate bug found while verifying "Ladeliste drucken funktioniert nicht":** the planner's print button and both print-page links were raw `<a href="/de/...">` anchors - root-absolute, so they were missing the deployment's base path (`/delivery-app`) and answered 404 on the server. They are next-intl `Link`s now (which apply base path and locale), and the planner's button opens in a new tab as requested.

**Implementation notes**
- **Root cause of the unreadable pills:** the toolbar card was hardcoded `bg-white` while the buttons inside use theme tokens (`variant` colours). In dark mode the dark-scheme pill colours sat on a white card and lost contrast. The card uses `bg-card text-card-foreground`, so it follows the colour scheme; the sheet itself stays black-on-white on purpose — that is the paper.
- The print language choice is a documented NUD-091 feature (`?locale=`). `parsePrintLocale` (server, zod, four locales) and its unit test were removed and replaced by the client-safe `src/lib/load-sheet-locale.ts`: `SHEET_LOCALE_OPTIONS` (two entries), `SheetLocale` and `parseSheetLocale`. The toolbar builds its links from that list, so adding or removing an option touches one file.
- Every Hant variant folds onto `zh-Hans` on purpose: the Hant message files are generated from the simplified ones, the owner explicitly does not want three Chinese options, and old or shared `?locale=zh-Hant-TW` URLs keep printing Chinese instead of silently printing German. Matching is literal/case-sensitive, like the URL segments; an unknown value is German, never a fallback to the UI language.
- The e2e spec keeps the totals / reverse-order / A4-overflow / PDF / authorization assertions, replaces the German-only pass with a German pass plus a `zh-Hans` pass (Chinese heading, German name in small type, `aria-current`), and adds the folded-variant and unknown-value loops. Full `pnpm test:e2e` still needs the seeded database (not run in this session).

---

#### NUD-135 · Edit an existing tour from the admin view
**Status:** done · **depends_on:** – · asked for by the owner together with the NUD-134 fixes ("im Admin-Bereich bitte einen Bearbeiten-Button für die Touren, um sie bei Bedarf zu bearbeiten").

**Goal:** the tour page offers reorder/lock/reoptimize/assign/release but no way to correct a tour itself. Add an explicit **Bearbeiten** entry point that leads to a real edit form.

**Answered by the owner on 2026-10-26 (F14/F15, D29):** driver, vehicle (once NUD-146 exists), stop order, and moving stops between tours of the same date — also on released tours, via the "tour was updated" path; completed stops locked; **the date is not editable**. Additionally: the tour tabs from NUD-099 are shown **always** (also for a single tour, labelled "Tour 1 · <Fahrer>") plus a **"+ Tour"** tab that creates an empty tour for the date. The ticket is no longer blocked.

~~**Open question (blocks the design):** what may be edited?~~ Candidates, in increasing risk: (a) only driver assignment and departure time, (b) also the stop order and which stops belong to the tour, (c) everything including the date, moving the orders along. Nothing is built until this is answered: a wrong guess writes to released tours that drivers may already be working on, and the release-revision rules (D19, "stop changed after release") must stay honest.

**Acceptance criteria**
- [x] The owner has answered what "Bearbeiten" may change.
- [x] The entry point exists on the tour with an accessible label and a test id, and is only offered where editing is allowed. (button `tour-edit`, label "Bearbeiten", shown for every tour except COMPLETED)
- [x] Editing a released tour keeps the release/history rules intact (same "orders changed after release" signal as the existing flows, or a clear refusal). (revision +1, `reReleasedAt` / `lastChange`, `ADDED` marker on arriving stops; integration + e2e)
- [x] Server-side role check + zod validation; a new server action gets its row in `src/server/authz-matrix.test.ts`; integration test for the edit. (`editTourAction` and `createEmptyTourAction`: requireRole(ADMIN), zod strict with .max(), authz-matrix rows, `tour-edit.integration.test.ts` (16 tests))
- [x] The driver sees a change through the existing "tour was updated" path, or the edit is refused when it would alter a stop the driver already completed. ("tour was updated" path; completed stops cannot be moved (`stop_locked`) and keep their slot)
- [x] Screens checked at 1280 px (admin) and 375 px (driver, unchanged). (1280 px screenshots of the form (unreleased + released) and no-horizontal-scroll asserts in `tour-edit.spec.ts`; driver screens untouched)

**Implementation notes**
- **What was built:** a **Bearbeiten** button on the tour header (`data-testid="tour-edit"`, every tour but COMPLETED) opens `TourEditDialog` (`src/components/admin/tour-edit-dialog.tsx`): driver select, the stops in order with up/down buttons, and per open stop a select "Bleibt in dieser Tour" / "Nach Tour N verschieben" (other tours of the same date that are not COMPLETED). Completed stops are listed as "Erledigt, gesperrt" and keep their slot. The date is not part of the form (D29). One action, `editTourAction({tourId, version, driverId, orderedStopIds, moves})` -> `editTourWith` in `src/server/tour-edit.ts`; pure rules in `src/domain/tour-edit.ts` (`mergePendingOrder`, `canEditTour`).
- **Tabs and "+ Tour":** `TourTabs` is shown as soon as the day has a tour (also for one), labelled "Tour N · Fahrer", plus a "+ Tour" button (`createEmptyTourAction`) that creates an empty OPTIMIZED tour for the date (no routing call, max 10 per day, not for past days) and opens it. The old tab label "Tour 2 (Folgetour)" became "Tour 2"; `PlanTourTab` got `driverName`.
- **Released tours:** driver / order / moves raise `releaseRevision`, set `reReleasedAt` and `lastChange` (leaving stops are listed as removed, the driver app shows them), an arriving stop gets `changeKind ADDED`. All touched tours are re-routed with `route()` (legs, ETAs, geometry, totals; completed stops only change place), a tour whose last open stop leaves becomes COMPLETED (`deriveTourStatus`). Everything runs in one transaction behind the per-date advisory lock; the version of the edited tour plus the stop signature of every touched tour are re-checked (`conflict`).
- **Audit:** reuses `tour.reorder` and `tour.assign_driver`, adds `tour.move_stop` (entry on both tours) and `tour.create_empty` (labels in de/en/zh-Hans, history rendering in `audit-history.ts`, `tour-edit.ts` listed in `audit-coverage.test.ts`).
- **Strings:** `admin.tours.edit.*`, `admin.tours.tabs.*`, four new `errors.*`, `history.actions.*` (de, en, zh-Hans; admin-only, so no sr-Latn/cs). `releasedNotice` now points to "Bearbeiten". Forbidden words checked.
- **Tests:** `tour-edit.test.ts` (domain), `tour-edit.integration.test.ts` (16: unreleased edit, no-op, move, empty source, released reorder / driver hand-over / move between two released tours seen through `getDriverTour`, completed slots, auto-COMPLETED, all refusals, "+ Tour" rules, action authorization), e2e `tour-edit.spec.ts` (desktop only, like the planning screen); `late-orders.spec.ts` / `late-orders.integration.test.ts` adjusted to the always-on tabs. Run here: lint (only the known fontstub warning), typecheck, `pnpm test` (2061 passed), i18n:check, `pnpm build`, e2e tours / late-orders / tour-rerelease / admin-progress / load-sheet / mvp-happy-path / tour-edit on desktop + mobile projects (17 passed, 15 skipped by design), fresh-DB seed. No migration needed.
- **Not in this ticket:** the vehicle select (NUD-146 depends on this ticket and adds it to the form); merging a moved stop into an existing stop of the same customer (refused instead).
- **Follow-up:** NUD-154 (new orders are in the scope of every open tour of a day; with "+ Tour" two open tours are now easy to reach).

---

#### NUD-136 · Customer master data from the factory list (Firma, UID, billing address) + number-less import
**Status:** done · **depends_on:** 090

**Goal:** the factory's own customer list (`Kunden.xlsx`: Kundenname, Firma, Straße, Hausnummer, Ort, PLZ, UID, LieferAdresse; 195 rows, no customer numbers) imports as it is, and the office keeps the company, VAT id and billing address on the customer.

**Scope**
- `Customer` gets optional `companyName`, `vatId`, `billingStreet`, `billingPostalCode`, `billingCity` (office only, never shown to the driver). `street`/`postalCode`/`city` stay the delivery address.
- Customer form section "Firma & Rechnung", detail page fields, search covers company and VAT id.
- Import: customer number optional (match by name, otherwise next free number); new optional columns house number, company, VAT id, delivery address.

**Acceptance criteria**
- [x] `Kunden.xlsx` maps automatically (Kundenname → name, Firma → company, Hausnummer, UID, LieferAdresse) and previews 195 new, 0 errors. (Rehearsed with the real file through the UI against a local DB: 195 created, 0 failed.)
- [x] Re-importing the same file changes nothing (matched by name). (Domain + integration test.)
- [x] A row with a LieferAdresse is routed to that address and keeps the address columns as billing address; a missing postal code in it is flagged. (Domain + integration test; 3 rows in the real file, 2 of them flagged.)
- [x] Office fields can be entered, cleared and found via the list search. (Integration test.)

**Implementation notes**
- Migration `20261026160000_customer_company_billing` (5 nullable columns, search trigger extended with `companyName` and `vatId`, backfill). Hand-written SQL: the Prisma schema engine binary could not be downloaded in the agent's sandbox; tests apply the committed SQL like every other migration.
- Domain (`src/domain/customer-import.ts`): `customerNumber` no longer required; `nameKey` matching for rows without a number (`name_ambiguous`, `duplicate_in_file` on the name); `assignNumber` uses `suggestNextCustomerNumber` over every stored and in-file number (`number_assigned` warning); `houseNumber` is appended to the street; `vatId` normalised (no spaces, upper case); `parseDeliveryAddress` splits "street PLZ city" taking the LAST postal-code-length digit group before the city (so `230/E101120 Wien` → `230/E10`, `1120`, `Wien`); `delivery_address_used` / `delivery_postal_assumed` warnings. Header synonyms: "Firma"/"Company" moved from name to company (fallback: used as the name when a file has no other name column, keeps old files working); "Lieferadresse" moved from street to delivery address.
- Server: `officeFields()` in `customer-admin.ts` shared by the form and the import; the import update loop writes every `PATCH_FIELDS` key.
- Strings: `admin.customers.form.office*`, `detail.billing*`, `import.fields.*`, `import.issues.*` (de, zh-Hans by hand, Hant generated). `duplicate_in_file` now names the field.
- Tests: `domain/customer-import-factory-list.test.ts` (mapping, numbering, delivery/billing, re-import, name match update, ambiguous / duplicate names, numbers further down the file, 5 address parses), `server/customer-company-billing.integration.test.ts` (form create/update/clear, search, import + re-import).
- Verified in the agent's sandbox: lint, typecheck, i18n:check, `pnpm test` (1840 passed; `backup.integration` "never leaks the password" fails only because the sandbox Postgres uses trust auth), e2e `customer-import` + `customers` green; `customer-form.spec.ts` "create … find it" fails at the search-result click identically on the unchanged code (pre-existing dev-mode flake, not touched).
- NOT verified: `pnpm build`; the real ORS geocoding of the 195 addresses; the mobile e2e project.
- Follow-ups for the office: the 3 delivery-address rows (`063.0 Wokhouse`, `048.1 12edo`, `Hk sm`) need their pin checked; two had no postal code in the LieferAdresse, so the billing PLZ was used.

---

### M2.6 — Owner manual test 2026-10-26 (NUD-137…153)

Findings from the owner's manual walk-through on 2026-10-26 (report: [`QA-REPORT-2026-10-26-manual.md`](./QA-REPORT-2026-10-26-manual.md), finding numbers **F1…F25**). Decisions **D21–D30** (§2) are binding for these tickets and override older decisions where they say so. Work them **in ID order, one ticket per session**. NUD-153 runs last.

General rules for every ticket in this block:
- New UI text in **every active locale** (after NUD-140: `de`, `en`, `zh-Hans`, plus `sr-Latn`, `cs` for driver screens). Agent-written translations are fine; native review comes later (NUD-073).
- Glossary §3 (as amended on 2026-10-26) is binding for wording: **Parkplatz**, **Lieferadresse**, **Produkte** (order lines), **Karton**, **Beutel**, **Lieferzeitraum**, **Fahrzeug**. The words "Pin", "Kartenpunkt", "Position(en)" (for order lines) and "Kiste" must not appear in any UI string.
- Data the driver enters (key numbers, parking spots) is written straight to the customer, with `updatedById`/`updatedAt` and an audit entry (NUD-092). No office approval step (D27).

---

#### NUD-137 · Whole-number quantities
**Status:** done · **depends_on:** – · F13

**Goal:** no halves exist (no half Beutel, no half Karton). Every quantity is a positive integer.

**Scope**
- Prisma: `OrderItem.quantity` `Decimal(10,2)` → `Int` with a committed migration (existing values are rounded; log any non-integer row found in the migration output).
- zod: integer ≥ 1 everywhere a quantity is accepted (order form, AI draft from NUD-150, recurring rules from NUD-149).
- Order form: numeric input without decimal separator (`inputmode="numeric"`), remove the hint "Dezimalzahlen mit Komma oder Punkt …" and its translations.
- Update domain helpers that format quantities (no trailing-zero logic needed any more), totals, load sheet, driver views.
- §4.3 rule "Quantities: `Decimal(10,2)`" → "Quantities: `Int`".

**Acceptance criteria**
- [x] Entering `2,5` or `2.5` is rejected with a localized message; `3` is accepted. (Unit tests `order.test.ts`, integration tests in `order-actions` / `order-management`, e2e `orders.spec.ts`)
- [x] Migration committed; `pnpm db:seed` works on a fresh DB; totals / load sheet / driver tests pass. (Migration `20261026170000_whole_number_quantities`; plain `pnpm db:seed` ran on a fresh DB; unit/integration suites green)

**Implementation notes**
- Migration `20261026170000_whole_number_quantities` (hand-written SQL, the Prisma schema engine cannot be downloaded in the sandbox): `OrderItem.quantity` → `INTEGER` (rounded half away from zero, never below 1; every non-integer row is reported as a `NOTICE` in the migration output, none on a fresh DB). The JSON snapshots `Stop.items`, `Stop.previousItems` and `Tour.lastChange` are rewritten from `quantityCents`/`beforeCents`/`afterCents` (hundredths) to `quantity`/`before`/`after` (whole numbers) by a temporary PL/pgSQL function.
- Domain: `parseQuantity` is digits-only (1…`MAX_QUANTITY` = 99 999); `parseQuantityCents`, `centsToDecimal`, `quantityToCents`, `totalToDecimal` are gone; `quantityCents` → `quantity` and `beforeCents`/`afterCents` → `before`/`after` in all domain/server/UI types (48 files, mechanical rename). `createAppFormatters().quantity` formats integers.
- The **audit log** is append-only and its older rows hold hundredths, so new entries keep that encoding via `toAuditQuantity()` (`src/domain/audit.ts`); `audit-timeline` is unchanged and reads both. Decision logged in §9.
- Driver payload: `payloadItemSchema` accepts the pre-NUD-137 cached shape (`quantityCents`) so an installed phone keeps working offline until the next refresh.
- Order form: `inputMode="numeric"`; the decimal hint is replaced by "Mit Enter kommt ein neues Produkt." and `quantityInvalid` says "ganze Zahl von 1 bis 99999" (de, zh-Hans; Hant regenerated). Demo seed data uses whole numbers.
- Docs: `docs/orders.md`, `data-model.md`, `tour-planning.md`, `audit-and-retention.md`, `uat.md` O-40; backlog §4.3 and §6.
- Tests: ~100 fixtures moved from decimals/hundredths to whole numbers; new rejection cases for `2,5`, `2.5`, `2.5` (number), `0`, `3.0`.

---

#### NUD-138 · Product catalog: 3 real products with weight per unit
**Status:** done · **depends_on:** 137 · F5 · **supersedes NUD-124**

**Goal:** the catalog holds exactly the owner's three products; each product has an admin-editable weight per unit (used for vehicle capacity, NUD-146).

| Product (de) | Unit | Weight per unit | Display |
|---|---|---|---|
| Nudeln | `PACK` → **Beutel** | 3 kg | "22 Beutel Nudeln" |
| Nudeln | `CRATE` → **Karton** (cardboard) | 10 kg | "14 Karton Nudeln" |
| Wantan-Teig | `PIECE` | 5 kg | "3 × Wantan-Teig" (no unit word) |

**Scope**
- Prisma: `Product.weightKgPerUnit Decimal(6,2)` (required, > 0) + migration; product form field "Gewicht pro Einheit (kg)" editable by admins.
- Unit labels: `PACK` = Beutel, `CRATE` = Karton (zh-Hans: 纸箱, not 箱子/筐), `PIECE` rendered as "N ×" before the product name on driver screens, checklist and load sheet. The `KG` unit stays in the enum but is not used by the seed.
- Seed + data migration: the 3 products with `de` + `zh-Hans` (+ `en`) names; archive every other product (`active=false`) and move existing demo `OrderItem`s onto the matching new product (orders are never deleted). Follow the NUD-124 notes on soft delete.
- Weight helper in `src/domain/` (`orderWeightKg(items, products)`) with unit tests.

**Acceptance criteria**
- [x] Product list shows exactly the 3 active products; demo products are archived and not selectable. (Migration + seed: three active products, all others `active=false` and not offered by `getActiveProducts`; `db.integration.test.ts`, `demo-seed.integration.test.ts`, `order-actions.integration.test.ts`)
- [x] Changing the weight per unit changes the computed weight of a tour (unit test). (`src/domain/weight.test.ts` and `product-actions.integration.test.ts`)
- [x] No UI string in any locale contains "Kiste" or "Packung"; driver/checklist/load sheet render "3 × Wantan-Teig". (`common.units`, `driver.units`, `driver.unitsTotal`; driver stop card, hero chip, load sheet and office lists render "3 × Wantan-Teig")

**Implementation notes**
- Migration `20261026180000_product_catalog_weight` (hand-written SQL): adds `Product.weightKgPerUnit Decimal(6,2)` NOT NULL with a `CHECK > 0` (existing rows get 3/10/5/1 kg by unit), inserts the three products `NUDELN-BEUTEL`, `NUDELN-KARTON`, `WANTAN-TEIG` (de + zh-Hans + OpenCC Hant flagged machine-made), moves the order lines of the eight old demo SKUs onto them (lines that end up on the same product in one order are summed), and archives every other product. Verified on a database with sample orders.
- `src/server/product-catalog.ts` is the single source for the base seed, the demo seed and the tests. The seed never overwrites an existing row, so an admin-edited weight survives a re-seed. The demo seed no longer creates extra products.
- `orderWeightKg(items, products)` and `parseWeightKg` in `src/domain/weight.ts` (hundredths of a kilogram internally, no float drift). The product form has "Gewicht pro Einheit (kg)" (decimal comma or point, > 0, at most 9 999,99); the product list has a weight column.
- Unit wording: `PACK` = Beutel, `CRATE` = Karton (zh-Hans 袋 / 纸箱), `PIECE` = "×" in front of the product name. Lines read "22 Beutel Nudeln", "14 Karton Nudeln", "3 × Wantan-Teig" (the old " · " separator is gone). Sums without a product name use `driver.unitsTotal` ("3 Stück"), the product form and list use `common.unitNames`. `driver.unitsShort` was removed (no longer used).
- The load sheet now puts quantity and unit in the first column ("22 Beutel | Nudeln").
- Pre-existing e2e failures, not caused by this ticket (stale redesign assertions, cf. NUD-128): `order-overview` "default date" and the `:visible` totals card, `products.spec` after the reorder step (`product-edit` sits inside the row menu).

---

#### NUD-139 · Wording: Produkte, Parkplatz/Lieferadresse, day/night toggle
**Status:** done · **depends_on:** – · F6, F9, F19

**Scope**
- **Order lines (F9):** "Positionen/Position" → "Produkte/Produkt" in every order context: list column, drawer, detail, form ("Produkt hinzufügen", "Produkt {n} entfernen"), counts (`{count, plural, one {# Produkt} other {# Produkte}}`), "Keine Produkte". ~15 keys in `messages/de.json` (lines ~813–1149 at the time of the test) + the matching `zh-Hans` keys.
- **Pin (F6):** remove the words "Pin" and "Kartenpunkt" from every UI string. Customer location wording becomes **Parkplatz** (where the driver parks) and **Lieferadresse** (the address). Map-candidate strings ("Gefundene Positionen", "Unsichere Position – bitte Pin prüfen") are reworded to "Gefundene Adresspunkte" / "Unsicherer Adresspunkt – bitte auf der Karte prüfen". (The behaviour change is NUD-141; this ticket only does wording that is still valid after it.)
- **Day/night toggle (F19):** the toggle shows the **action**: ☾ "Nachtmodus" while in day mode, ☀ "Tagmodus" while in night mode (today: moon icon + "Tagmodus"). Same on the admin header (icon-only there: give it the matching `aria-label` + tooltip).
- Glossary §3 is already amended; keep code identifiers (`OrderItem`, `lat/lng`) unchanged.

**Acceptance criteria**
- [x] `grep -riE "Position|Pin\b|Kartenpunkt" messages/de.json` returns no order-line or customer-location string. (`src/lib/forbidden-words.test.ts` fails if "Pin", "Kartenpunkt", "Position(en)", "Kiste", "Packung" or 箱子/筐 appear in `de.json` or `zh-Hans.json`; the login "PIN" (6-digit code) is a different word and stays)
- [x] Toggle label and icon match the action in both modes (component test). (`theme-toggle.test.tsx`)
- [x] `pnpm i18n:check` green.

**Implementation notes**
- Order lines are "Produkte" everywhere (list column, drawer, detail, form "Produkt hinzufügen" / "Produkt {n} entfernen", counts, tour print "Keine Produkte"); zh-Hans "产品".
- Customer location: "Pin" / "Kartenpunkt" / "Position" became **Adresspunkt** (the geocoded point of the Lieferadresse; filters, flags, review queue, import, tour warnings, driver "Kein Adresspunkt – bitte beim Büro nachfragen"). The depot uses **Standort** ("Standort auf der Karte", "Standort bestätigt"). **Parkplatz** is introduced with the parking-spot feature in NUD-141; no string promises it before that.
- Day/night toggle shows the action: moon + "Nachtmodus" in day mode, sun + "Tagmodus" in night mode (login, driver menu). The admin icon button carries the same text as `aria-label` and tooltip ("Zum Nachtmodus wechseln" / "Zum Tagmodus wechseln"); the mode is read from the `dark` class on `<html>` with `useSyncExternalStore`, so the first paint stays correct without a hydration mismatch. The keys `label`, `toggle`, `light`, `dark` were removed.
- The in-app help manual (`content/hand-off/index.ts`, de + zh) and `docs/uat.md` quote the UI labels; both were updated (its test checks every label against `messages/de.json`).
- Code identifiers (`OrderItem`, `pin*` keys, `lat/lng`) are unchanged on purpose.
- Pre-existing e2e failure, not caused by this ticket: `settings.spec` cannot find the "Name" field (settings page layout changed since NUD-012, cf. NUD-128).

---

#### NUD-140 · Languages: Deutsch · English · Srpski · Čeština · 中文
**Status:** done · **depends_on:** 139 · F17, F18 · implements **D21**

**Goal:** admin languages `de`, `en`, `zh-Hans`; driver languages `de`, `en`, `sr-Latn`, `cs`, `zh-Hans`. Traditional Chinese is removed.

**Scope**
- `Locale` enum: add `en`, `sr_Latn`, `cs`; remove `zh_Hant_HK`, `zh_Hant_TW` via migration that maps existing users with a Hant locale to `zh_Hans`. URL tags: `de`, `en`, `sr-Latn`, `cs`, `zh-Hans`.
- Messages: new hand-maintained `en.json`, `sr-Latn.json`, `cs.json` (agent-written now; Serbian in **Latin** script). Delete the OpenCC build path, `messages/overrides/*`, the generated `zh-Hant-*.json` and the `opencc-js` dependency; `pnpm i18n:build` becomes a no-op or is removed; `pnpm i18n:check` checks all five files. Admin-only keys need not exist in `sr-Latn`/`cs` only if the checker is taught the admin/driver split cleanly — otherwise translate everything (simpler, preferred).
- Locale availability per area: admin switcher shows **Deutsch · English · 中文**; driver switcher (login segmented control) **DE · EN · SR · CS · 中文**; first-start picker (NUD-050) shows five big buttons **Deutsch · English · Srpski · Čeština · 中文**. A driver-only locale opening an admin page falls back to `de`.
- `Accept-Language` mapping: `zh-*` → `zh-Hans`, `sr`/`sr-Latn`/`sr-Cyrl` → `sr-Latn`, `cs` → `cs`, `en-*` → `en`, else `de`.
- `LocalizedText`: keys `de`, `en`, `sr-Latn`, `cs`, `zh-Hans`; data migration drops Hant keys; `pick()` fallback: requested → `de` → source. `withDerivedHant` removed.
- Translator (NUD-070): DeepL for `en`, `cs`, `zh-Hans`; **check whether DeepL supports Serbian** — if not, translate Serbian through the OpenRouter client from NUD-150 behind the same `Translator` interface (log the decision). Product names: `de` + `zh-Hans` by hand, other locales machine-filled and editable.
- `<html lang>` and font stacks for the new locales; drop the HK/TW CJK stacks.
- Update NUD-073 export/import columns to the five locales; update §4.1/§4.2 and `AGENTS.md` where they mention Hant/OpenCC.

**Acceptance criteria**
- [x] Admin switcher lists exactly 3 languages, driver switcher exactly 5, each in its own script.
- [x] A user stored as `zh_Hant_TW` before the migration logs in and sees `zh-Hans`.
- [x] Driver home, stop detail and problem sheet render in `sr-Latn` and `cs` at 375 px with no horizontal scroll and correct diacritics (č, ć, š, ž, đ, ř, ě).
- [x] E2E happy path (NUD-060) parameterised over the 5 driver locales passes.

**Implementation notes**
- Enum/URL tags `de, en, sr-Latn, cs, zh-Hans`; migration maps Hant users to `zh_Hans`, drops Hant keys from LocalizedText; OpenCC path, overrides and generated Hant files removed.
- Messages: `en`, `sr-Latn`, `cs` hand-maintained; sr-Latn/cs carry the driver namespaces only (checker enforces; office URL in a driver-only locale redirects to /de/admin). Admin switcher 3, driver switcher/first-start picker 5.
- Translator: DeepL for de/en/cs/zh-Hans; Serbian via `RoutedTranslator` (Fake in tests; real provider arrives with NUD-150, which must backfill texts lacking sr-Latn). Product names en/sr/cs are machine-filled; seed fills the pending catalog products.
- e2e: all specs pass on desktop + mobile (driver specs in sr-Latn/cs at 375 px, MVP happy path over 5 driver locales). Stale specs from earlier tickets (decimal quantities, row menus, new-tab print link) were fixed along the way; login-page pills now use `login-pick-<code>` test ids; a11y fixes in today-tour, login help link, success button hover, PIN input, sync chip label.
- driver-offline/driver-photo e2e need an S3 store on :9123 (see .env).

---

#### NUD-141 · Parkplatz is the routing point; no more pin confirmation
**Status:** done · **depends_on:** 125, 139 · F6, F7, F8 · implements **D22**

**Goal:** the point used for optimisation and navigation is the customer's **default Parkplatz**; without one, the geocoded **Lieferadresse**. Nobody is excluded from a tour for a missing confirmation.

**Scope**
- Domain helper `routingPoint(customer)`: first active `ParkingSpot` (NUD-125, `sortOrder`) → else the geocoded address point (`Customer.lat/lng`) → else "no location" (only when geocoding failed).
- Remove `pinConfirmed` from every gate: tour builder (NUD-041), order-form warning, import (NUD-090/136), customer flags. The column can stay in the DB unused (no destructive migration); the UI no longer shows or sets it.
- Tour builder: customers without a Parkplatz are routed to the address point and get a non-blocking flag "Parkplatz fehlt"; only "no location at all" is a warning that keeps the stop out.
- Geocoding runs automatically on customer save/import when the address changed (no confirm checkbox).
- Dashboard to-do (F7): replace "N Kunden mit unbestätigtem Pin" by **"N Kunden ohne Parkplatz – Lieferung zur Adresse"**; clicking opens a **Parkplatz queue** (customer by customer: map with address point → set Parkplatz by click/drag → save → next; "skip").
- Customer list flags: "ohne Parkplatz" replaces "Pin unbestätigt".
- NUD-125 scope note "routing/optimisation keeps using the single customer pin" no longer applies.

**Acceptance criteria**
- [x] A customer with a Parkplatz is optimised and navigated to the Parkplatz coordinates; without one to the address point (integration test). (Integration tests: tour-builder (optimize called with the Parkplatz coordinates, address point without), driver-today (navigation target = Parkplatz), tour-planning routing-point test.)
- [x] A freshly imported customer (no confirmation, no Parkplatz) ends up on the tour with the flag. (Integration test import -> automatic geocoding -> tour with flag "Parkplatz fehlt"; e2e mvp-happy-path (new customer, no confirmation) shows the flag on the stop.)
- [x] Dashboard entry text and link to the queue; the queue sets a Parkplatz in ≤ 3 clicks per customer. (e2e customer-import: dashboard to-do "ohne Parkplatz – Lieferung zur Adresse" links to /admin/customers/parking; first customer saved with 1 click (map starts at the address point), skip = 1 click, typed/dragged spot = 2-3 clicks.)

**Implementation notes**
- `routingPoint()` in `src/domain/parking.ts` (Parkplatz by sortOrder, else Adresspunkt, else null); used by tour builder, planning/reorder, re-release, late orders, driver payload. `pinConfirmed` is removed from every gate and UI; the column stays unused (comment in schema, no migration).
- Tour builder: `partitionByLocation` -> routable / unrouted (NO_LOCATION warning, stop kept out) / withoutParking (non-blocking flag `stop-missing-parking-spot`, "Parkplatz fehlt").
- Geocoding on customer save is best effort (never blocks) when the point is missing or the address changed and the point was not moved by hand; the import drops lat/lng on address change and its geocode step now starts by itself.
- Parkplatz queue at `/admin/customers/parking` (replaces the pin review queue, `pin-review-queue.tsx` removed); saves via the audited `createParkingSpotAction`; dashboard to-do `attention-parking-missing`; customer list flag/filter "Ohne Parkplatz"; order-form pin warning removed. Texts in de/en/zh-Hans, help manual and docs updated.
- Checks: lint (only the expected fontstub warning), typecheck, i18n:check, `pnpm test` (all green after fixing demo-seed test), fresh-DB migrate + seed ok, e2e desktop+mobile of customer-import/form/customers/mvp/orders/tours green. Full e2e run (408): 14 failures; settings, order-overview and mobile order-screenshot fail identically on the unchanged baseline (pre-existing); driver-photo, driver-usability, driver-outbox and desktop order-screenshot passed on rerun (flaky under the long run). 375 px / 1280 px: no horizontal scroll on queue, form, dashboard.
- Not done here (stays NUD-126): Google waypoint/destination navigation URL.

---

#### NUD-142 · Customer key number (office + driver)
**Status:** done · **depends_on:** 139 · F4, F22 · D27

**Scope**
- Prisma: `Customer.hasKey Boolean?` (null = unknown) and `Customer.keyNumber String?` (max 20), `keyUpdatedById`, `keyUpdatedAt`; migration; audit entries for every change (before/after).
- Office: optional fields "Schlüssel vorhanden" + "Schlüsselnummer" on the customer form/detail, with "geändert von <Fahrer>, <Datum>".
- Driver: 🔑 + number visible on the **next-stop card**, the **stop list rows** and the **stop detail header**. Unknown (`hasKey = null`) → small "🔑 ?" chip that opens a sheet "Gibt es einen Schlüssel? Nummer:" (Ja + number / Nein). Existing number → tap opens the same sheet to **correct** it. Saved immediately to the customer; offline queued (NUD-082 outbox pattern).
- Include `hasKey`/`keyNumber` in the cached driver tour payload (NUD-081).

**Acceptance criteria**
- [x] Driver sets a missing key number → office sees it with driver name/date; audit entry has the diff. (e2e driver-key.spec + integration test customer-key.integration.test.ts: office detail shows "Geändert von <Fahrer>, <Datum>"; audit customer.key holds hasKey/keyNumber from->to.)
- [x] Driver corrects an existing number → old value visible in the history. (Key history list on customer detail (audit customer.key) shows old and new values; covered in integration + e2e.)
- [x] Key chip readable at 375 px; touch target ≥ 48 px; works offline (queued). (Chip >= 48x48 px asserted in e2e (375 px); entry goes through the outbox (sync entry type key) and is queued offline, applied on reconnect.)

**Implementation notes**
- Schema: Customer.hasKey/keyNumber/keyUpdatedById/keyUpdatedAt, StopMutationKind.KEY; migration 20261027090000_customer_key.
- Server: src/server/customer-key.ts (setCustomerKey office path, applyDriverKey sync path; row lock + audit in one transaction; idempotent via StopMutation KEY). Audit action customer.key with via office|driver and clientCreatedAt.
- Driver: KeyChip/KeySheet (src/components/driver/customer-key.tsx) on next-stop card and stop detail (interactive), display-only on stop-list rows (rows are links). Tour payload carries hasKey/keyNumber (defaults keep old caches valid); sync response patches the stored tour; optimistic overlay shows queued entries.
- Office: Schlüssel section in the customer form (sent only if edited, so stale pages never overwrite a driver entry) and detail card with history.
- i18n: driver.key.* in de/en/zh-Hans/sr-Latn/cs; admin keys in de/en/zh-Hans. Docs updated (offline, customers-and-imports, privacy, data-model).
- Tests: unit, component (35), integration (10), e2e driver-key.spec. Offline e2e specs (outbox/photo) showed occasional timing flakes in long sequences, also on the NUD-141 baseline; clean on rerun.

---

#### NUD-143 · Driver stop UI: whole card opens details, gallery photos
**Status:** done · **depends_on:** – · F20, F23

**Scope**
- Next-stop card on driver home: the **whole card** is the link to the stop detail; the "Details" button becomes an icon-only button (›) with `aria-label`, touch target ≥ 48 px. **"Navigation starten"** inside the card must not open the detail (stop propagation; keep it a separate focusable element — no nested interactive elements inside an `<a>`).
- Photo slots (Eingang, Parken) on stop detail: two actions **"Foto aufnehmen"** (`capture="environment"`) and **"Aus Galerie"** (same input without `capture`). Gallery images go through the NUD-006 resize pipeline and the NUD-083 offline outbox.

**Acceptance criteria**
- [x] Tap on card body → detail; tap on "Navigation starten" → navigation URL only (component test).
- [x] Gallery upload works online and queued offline (e2e with a file chooser).
- [x] axe: no nested-interactive violation on driver home.

**Implementation notes**
- Next-stop card (today-tour.tsx): the icon-only chevron link (aria-label "Details", 48 px) is stretched over the whole card (`after:absolute after:inset-0`); "Navigation starten" and the key chip are siblings with `relative z-10`, so nothing interactive is nested in an `<a>`. `active:scale-none` on the link: the global press-scale made the link the containing block of the overlay and shrank it while pressed, so taps never completed (found by e2e).
- Photo slots (driver-photo-slot.tsx): missing state shows the placeholder plus two stacked 48 px buttons below it, "Foto aufnehmen" (input with `capture="environment"`) and "Aus Galerie" (second input, no `capture`); with a photo present the overlay carries camera (replace) and gallery icon buttons. Both inputs feed the same resize + photo outbox path. New key driver.stop.fromGallery in de/en/zh-Hans/sr-Latn/cs.
- Tests: component (card links, gallery input, detail), e2e driver-today (card tap, navigate popup), driver-photo (file chooser online + offline queue); axe nested-interactive covered by driver-a11y. mvp-happy-path and late-orders fail on this DB because the admin tour page shows 21+ demo rows for today (data state, unrelated to the driver card).

---

#### NUD-144 · Driver sets Parkplatz coordinates
**Status:** done · **depends_on:** 125, 141 · F24 · D27

**Scope**
- In the "Parken" slot of the stop detail: button **"Parkplatz festlegen"** with two modes:
  - **Aktueller Standort:** Geolocation API → map with draggable marker → "Bestätigen". Permission denied / no fix → clear localized message and switch to manual mode.
  - **Koordinaten eingeben:** fields **Breite** and **Länge**, comma or point, range check (−90…90 / −180…180), map preview, "Bestätigen".
- Saves a `ParkingSpot` (NUD-125) for the customer — becomes the default if none exists — with `createdById` and audit entry; offline queued. It is the routing/navigation point immediately (NUD-141).
- Coordinates rounded to 6 decimals.

**Acceptance criteria**
- [x] Manual entry `48,2082` / `16,3738` saves a spot at 48.208200, 16.373800. (Unit parking-setter.test.tsx (5 locales) + e2e driver-parking: `48,2082` / `16,3738` stores 48.2082 / 16.3738 (DB row, createdBy = driver, audit `parking.create`))
- [x] Next navigation link for that customer uses the new spot. (e2e driver-parking: the Google link of the stop has `waypoints=48.2082,16.3738` at once (overlay) and after a reload (server payload); driver-parking.integration.test.ts checks the payload)
- [x] Works offline (queued, applied on reconnect). (e2e driver-parking (desktop + mobile): queued while offline, link uses it at once, applied on reconnect (`via: sync`); outbox.test.ts, driver-parking.integration.test.ts)

**Implementation notes**
- New sync entry `type: "parking"` (`lat`, `lng`) in the existing outbox / `POST /api/driver/sync` (no new route, no new authz row): `applyDriverParking` in `src/server/parking-spots.ts` (stop must belong to the driver's tour, max 10 active spots, idempotent via `StopMutation` kind `PARKING` = migration `20261027120000_stop_mutation_parking`, audit `parking.create` with `via` driver/sync). `createParkingSpot` and the driver path share `insertSpot`. The sync answer carries the customer's active `parkingSpots` per stop; `patchTourStates` / `useOverlaidStop` write them (and the new routing point `lat`/`lng`) into the stored tour and the screen, a queued point shows at once (`overlayStop`).
- UI: `src/components/driver/parking-setter.tsx`, button "Parkplatz festlegen" inside the stop screen's Parkplatz card (the card now also shows, with a hint, when the customer has no Parkplatz). Sheet with two modes (Aktueller Standort / Koordinaten eingeben), map preview with draggable marker (`PinPickerMapLazy`), Breite / Länge fields (comma or point via `parseCoordinate`, range check, 48+ px), refused / failed / unsupported position -> message + manual mode. `StopDetail` got a `tiles` prop. Texts `driver.parkingSet.*`, `driver.stop.parkingNone`, `driver.sync.mutationParking` in all five locales.
- Surprise: the Permissions-Policy header forbade geolocation (`geolocation=()`), so the position fix could never work; now `geolocation=(self)` (security-headers.ts, its unit + e2e test, `docs/deploy.md` section 11). No tracking: the position is read once per tap (D19 unchanged); `docs/privacy.md` and `docs/offline.md` updated.
- Not done / follow-ups: a spot set by the driver has no label or note (the office can add them); a driver cannot edit or remove a Parkplatz; an already planned tour is not re-optimised for the new point (NUD-141 uses it for the next planning).

**Implementation notes**
- Checks: lint (only the expected fontstub warning), typecheck, `pnpm test` 2034 passed / 4 skipped, i18n:check, fresh-DB migrate + seed (also `--demo --no-photos`), e2e desktop + mobile: driver-parking (new, 6), driver-key, driver-offline, driver-stop, driver-a11y, driver-today, driver-usability, parking-spots, security-headers all green; the offline reconnect tests of driver-key / driver-parking failed once each in a long batch and passed on rerun (known timing flake).

---

#### NUD-145 · Tour page cleanup + real ORS routing
**Status:** done (2026-10-28) · **depends_on:** – · F16

**Scope**
- Diagnose why the tour shows "Näherungswerte" (heuristic fallback). Expected: `ORS_API_KEY` missing on the vServer. **👤 HUMAN:** create/paste the ORS key on the server — agent writes the exact steps into `docs/deploy.md` / `HANDOVER-NEXT-STEPS.md`, verifies with `/api/health` (add an ORS reachability check that reports `fake`/`ok`/`error` without exposing the key).
- The ⚠-only badge under "Strecke" gets a text ("Näherungswert") like the one under "Gesamtdauer", or both are merged into one notice above the cards.
- Remove the redundant subline "4 Stopps" under the "Stopps" figure.

**Acceptance criteria**
- [x] With a valid key a newly generated tour has `approximate=false` and no "Näherungswerte" badge. (No key needed any more — the self-hosted ORS of NUD-156 answers instead. Live proof with the **deployed** code on the vServer, 2026-10-28: `optimize()` over three Vienna stops → `approximate: false`, order `c,b,a`, 4 legs, 49.4 km, 104 min, 939 geometry points.)
- [x] No icon-only status badge left on the tour page (axe + visual check at 1280 px). (The distance tile shows the same words as the duration tile; the redundant "N Stopps" subline is gone. Covered by eslint/tsc and the existing `tour-approximate` e2e assertion; a dedicated 1280 px screenshot was not taken.)

**Implementation notes (NUD-145)**
- Diagnosis: the vServer had neither `ORS_API_KEY` nor `ORS_BASE_URL`, so `getRoutingProvider()` returned the local heuristic and every tour was `approximate`. The ticket's assumption (missing key) was right, but the fix went further: ORS is **self-hosted** now (NUD-156) and needs no key — `ORS_BASE_URL` alone activates it, and `HeuristicOrderRoutingProvider` supplies real legs, driving times and the route line.
- `/api/health` reports `routing.mode` / `geocoding.mode` (`hosted` / `self-hosted` / `heuristic` / `fake`) instead of a reachability probe: a probe would hit ORS on every monitor call, and the mode answers the operator's real question ("why does the tour say Näherungswerte?"). Pure env reads, no hostnames, no keys.
- UI (`tour-planner.tsx`): the distance tile's `ApproximateHint` lost `iconOnly` (same text as the duration tile); the stops tile lost the `sub` line that repeated its own label.
- Void from the ticket text: the live multi-vehicle VROOM check handed over by NUD-147 — the self-hosted image has no `/optimization`, so a multi-vehicle day is split by the heuristic (`approximate: true` for a day plan, `false` for a single tour).

---

#### NUD-146 · Vehicles with kg capacity, one vehicle per tour
**Status:** done · **depends_on:** 138, 135 · F2 · D24

**Scope**
- Prisma `Vehicle { id, name, plate?, capacityKg Int, active, createdAt, updatedAt }`; `Tour.vehicleId?`; migrations; soft delete only.
- Admin page **Fahrzeuge** (nav under Stammdaten): list, create, edit, deactivate.
- Tour planning: assign driver **and** vehicle per tour per day (no fixed driver↔vehicle link). Release requires both.
- Load indicator on the tour: total kg (NUD-138 weights) vs. vehicle capacity, red when over.

**Acceptance criteria**
- [x] A tour over capacity shows the overload and cannot be released without an explicit override (logged in audit). (Tour page: load indicator (red, text 'Überladen um N kg'), release dialog with confirmation checkbox, server refuses `overloaded` without `overrideOverload`; audit `tour.release` carries `overloadOverride`, load and capacity. Integration tour-vehicle + e2e vehicles.spec)
- [x] Authz rows for the new actions; screens at 1280 px. (authz-matrix rows for createVehicleAction, updateVehicleAction, setVehicleActiveAction, assignVehicleAction; 1280 px screenshots in vehicles.spec)

**Implementation notes**
- **Data:** migration `20261027150000_vehicles` (table `Vehicle` with CHECK capacityKg > 0, `Tour.vehicleId` FK RESTRICT, index; additive, hand-written SQL). Soft delete only (`active`).
- **Fahrzeuge page** `/admin/vehicles` (nav entry under Stammdaten): `VehiclesManager` table with inline Aktiv/Inaktiv switch (deactivate behind a confirm dialog), one dialog for create / edit. Server: `src/server/vehicles.ts` (zod `.strict()` with `.max()`, capacity whole kg 1..50000, name unique ignoring case), actions in `vehicle-actions.ts` (requireRole ADMIN, audit entity `Vehicle`: `vehicle.create/update/activate/deactivate`, in the same transaction), read in `vehicle-queries.ts`.
- **Tour planning:** vehicle select next to the driver (`assignVehicleAction`, unreleased tours, audit `tour.assign_vehicle`), vehicle select in "Bearbeiten" (`editTourWith` accepts `vehicleId`, also on released tours via the 'tour updated' path, revision +1; a released tour cannot lose its vehicle, an old released tour without one may stay without). Release needs driver **and** an active vehicle (`vehicle_required` / `vehicle_invalid`, `releaseBlocker` got `vehicleId`).
- **Load:** `tourLoadKgOf` = quantities of the stop snapshots (`Stop.items`, what the driver sees) x `weightKgPerUnit` (NUD-138, `orderWeightKg`), all stops of the tour; pure rules in `src/domain/vehicle.ts` (`loadState`, `parseCapacityKg`). `TourLoad` component under the header: "Beladung 60 kg von 50 kg", bar, red with the text "Überladen um 10 kg" over capacity; without vehicle only the load. Exactly the capacity is fine.
- **Override:** `releaseTourAction({tourId, version, overrideOverload: true})`; without it an overloaded tour gets `overloaded`; the dialog shows the overload and enables "Jetzt freigeben" only after the checkbox "Trotz Überladung freigeben". The audit entry of the release records `overloadOverride`, `loadKg`, `capacityKg`, `vehicleId`; the tour history shows "Freigabe trotz Überladung". The flag is ignored (not logged) when the load fits.
- **Strings:** `admin.vehicles.*`, `admin.nav.vehicles`, `admin.tours.vehicle*` / `load.*` / `dialog.*` / new `errors.*`, `admin.history.*` (de, en, zh-Hans; admin only). Forbidden words checked. Demo seed (`--demo`) adds two placeholder vehicles (Transporter 1: 800 kg, Transporter 2: 1200 kg); the base seed / production gets none, the owner enters the real fleet on the Fahrzeuge page.
- **Existing tests adapted:** releasing needs a vehicle now (integration tests set `vehicleId`, e2e specs select one through `tests/e2e/helpers/vehicle.ts`). New: `domain/vehicle.test.ts`, `tour-vehicle.integration.test.ts` (16), `e2e/vehicles.spec.ts` (desktop; mobile skipped by design like the other admin screens).
- **Not in this ticket:** re-release (NUD-043) and Bearbeiten do not gate an overload (the indicator turns red; only the first release needs the override); the driver app does not show the vehicle; multi-vehicle distribution by capacity is NUD-147.
- Checks: lint (only the expected fontstub warning), typecheck, `pnpm test` 2096 passed / 4 skipped, i18n:check, `pnpm build`, fresh-DB migrate + seed (also `--demo --no-photos`), e2e desktop + mobile: vehicles, tours, tour-edit, tour-rerelease, late-orders, mvp-happy-path, shells green (admin specs skip the mobile project by design).

---

#### NUD-147 · Several tours per day: split by capacity, then reload trips
**Status:** done · **depends_on:** 146 · F2 · D24 · **supersedes NUD-102 and the capacity part of NUD-103**

**Scope**
- "Touren planen" for a date: the office selects the available drivers + vehicles (default: all active); the optimiser (ORS/VROOM multi-vehicle with `capacity` in kg, `delivery` per job = stop weight) distributes the day's stops across the vehicles.
- Order of preference: **use all selected vehicles first**; only if the load still does not fit, a vehicle gets a **reload trip** (return to the depot mid-tour, model as a second trip / break at the depot; show a "Nachladen im Depot" stop in admin, driver app and load sheet, with the load per trip).
- Heuristic fallback (no ORS): capacity-aware greedy split + per-vehicle nearest-neighbour/2-opt, flagged `approximate`.
- Driver app: a driver sees only his tours; reload stop rendered as a depot stop with the next trip's load.
- Load sheet (NUD-091/134) per tour and per trip.
- Reuse the NUD-099 multi-tour building blocks (`pickDefaultTour`, `pickDriverTour`, order scope per tour).

**Acceptance criteria**
- [x] 2 vehicles × 500 kg, 800 kg of stops → two tours, neither over capacity. (Unit fleet.test (splitByCapacity, 800 kg over 2 x 500 kg: two routes, none over capacity), routing-fleet.test (heuristic distribute), integration day-planner (two tours, each trip <= 500 kg) + e2e tour-split on the heuristic. live check: NUD-145 (VROOM multi-vehicle response against the real ORS))
- [x] 1 vehicle × 500 kg, 800 kg of stops → one tour with a reload stop, each trip ≤ 500 kg. (Unit packReloadTrips + integration day-planner (one tour, trips 1 and 2, each <= 500 kg, ETAs rise across the reload) + e2e tour-split (reload row in admin, load sheet per trip). live check: NUD-145)
- [x] Each driver sees only his own tour (authz test). (Integration day-planner: getDriverTour returns only the driver's own tour and stops, a driver without a tour sees none; authz-matrix row planDayAction (wrong role rejected))

**Implementation notes**
**Implementation notes**
- **Data:** migration `20261027180000_stop_trip` adds `Stop.trip` (default 1, CHECK >= 1). A reload is not a row: it is the place where `trip` goes up between two stops (admin list, driver list and load sheet derive the "Nachladen im Depot" card from it). Reload time is the constant `RELOAD_MINUTES = 20` (domain/fleet.ts).
- **Pure rules** `src/domain/fleet.ts`: `splitByCapacity` (heuristic fallback: sweep order around the depot, vehicles filled largest first, a vehicle not needed gets no route), `packReloadTrips` (leftover goes to reload trips, vehicle with the fewest trips first; a stop heavier than any vehicle gets a trip of its own and is reported `oversized`), `normalizeTrips`, `tripLoadsKg`, `computeTripSchedule` (equals `computeSchedule` for one trip).
- **Provider:** `RoutingProvider.distribute()` (multi-vehicle, capacity in kg, stop weight = job `delivery`). ORS: one VROOM `/optimization` call with `capacity` per vehicle (`mapFleetResponse`, unassigned jobs come back as `unassigned`); heuristic: the split above plus nearest neighbour / 2-opt per vehicle, `approximate`; Fallback forwards. Fixture `ors-optimization-fleet.json` is hand-written from the documented VROOM shape like the existing ones (no recording possible without a key).
- **Planner:** `src/server/day-planner.ts` + `planDayAction` ("Touren planen" dialog: vehicles and drivers, default all active). Distribute, then reload trips for `unassigned` (each ordered with `optimize`), then `routeTrips` per tour (one `route()` call per trip, joined; `src/server/tour-routing.ts`). Unreleased tours of the day are rebuilt in place (rows reused in creation order, surplus ones emptied, nothing deleted); a released/running tour refuses (`tour_not_editable`), a locked one too (`tour_locked`). Audit `tour.plan_day` per tour (history label added).
- **Manual edits keep trips:** reorder / Bearbeiten / re-release use `routeTrips`; trip boundaries stay at their positions, an arriving or new stop joins the last trip; "Neu optimieren" (`generateTour`) builds one trip again (reload trips come from "Touren planen").
- **Load:** capacity is compared per trip (heaviest trip) in the indicator, the release gate and its audit entry; `TourLoad` lists the trips. Existing single-trip behaviour is unchanged.
- **Driver app:** payload/offline model carry `trip` (default 1, old caches parse); `ReloadStop` card (icon, "Nachladen im Depot", next trip's quantities per product, 5 locales) between the trips in the open list. Load sheet: one block per trip with its own totals and load order, "then back to the depot".
- **NUD-154:** NOT covered by this ticket. NUD-147 only reuses the order scope (new `rebuildTourIds` scope so a whole-day plan sees every order not on a completed/released tour). The "new order is offered to every open tour" problem remains and is more reachable now that the planner creates several tours; it stays in NUD-154 (note added there).
- Checks: see commit; e2e `tour-split` (desktop admin + driver desktop/mobile) plus tours, tour-edit, tour-rerelease, late-orders, load-sheet, vehicles, driver-today, driver-stop, admin-progress.
- **Live check: NUD-145** (needs the ORS key): VROOM accepts `capacity` / `delivery` and returns `unassigned` / several `routes` as in the fixture; the profile (car vs. hgv) for the vehicles; the free-tier limits (jobs / vehicles per request) vs. `MAX_STOPS = 50`.

**Implementation notes**
- Checks: lint (only the expected fontstub warning), typecheck, `pnpm test` 2138 passed / 4 skipped, i18n:check, `pnpm build`, fresh-DB migrate + seed (also `--demo --no-photos`), e2e desktop + mobile: tour-split (new), tours, tour-edit, tour-rerelease, late-orders, load-sheet, vehicles, driver-today, driver-stop, admin-progress green (admin specs skip mobile by design).

---

#### NUD-148 · Requested delivery window instead of a delivery date
**Status:** done · **depends_on:** 147 · F11 · D25 · **supersedes the time-window part of NUD-103**

**Scope**
- Order gets `windowStart` / `windowEnd` (date + optional time, factory TZ) — "Gewünschter Lieferzeitraum", from a few hours to several days. Keep `deliveryDate` as the **planned** day (set by planning, editable by the office).
- Default planned day = **earliest day inside the window that is a delivery weekday and still has vehicle capacity**; the office can move it (within or, with a warning, outside the window).
- Time-of-day parts are passed to the optimiser as job time windows; infeasible windows are reported as warnings.
- Order form, list, filters, totals and the AI draft (NUD-150) use the window; existing orders migrate to `windowStart = windowEnd = deliveryDate` (whole day).

**Acceptance criteria**
- [x] Order with window Tue–Thu, Tue full → planned Wed (unit test on the pure helper). (Unit pickPlannedDay (delivery-window.test, window Tue-Thu with Tue full -> Wed) + integration order-window (createOrderAction plans Wed; editing excludes the order itself; audit carries the window))
- [x] Window 08:00–11:00 → the stop's ETA lies inside it or a warning is shown. (Integration tour-window: ETA inside the window -> no issue, outside -> early/late/conflict flag shown on the stop in the tour planner (stop-time-window badge); the window reaches the optimiser (ORS job time_windows, unit routing-windows). live check: NUD-145)

**Implementation notes**
- **Data:** migration `20261027210000_order_delivery_window` adds `Order.windowFrom/windowTo` (DATE, NOT NULL, backfilled from `deliveryDate`), `windowFromTime/windowToTime` ("HH:MM", nullable), CHECKs (`windowFrom <= windowTo`, time format) and an index. Names differ from the scope text (`windowStart`/`windowEnd`) on purpose, see the decision log. Existing orders are the whole planned day.
- **Pure rules** `src/domain/delivery-window.ts`: `pickPlannedDay` (earliest delivery weekday with capacity), `isValidWindow`, `stopTimeWindow` (intersection of the orders of a stop on the planned day), `checkArrival` (early / late / conflict), `secondsOfDayIn`. `orderInputSchema` accepts `windowFrom/windowTo/windowFromTime/windowToTime` and an optional `deliveryDate` (planned day); `deliveryDate` alone is a whole-day window.
- **Server:** `src/server/planned-day.ts` (`resolvePlannedDay`: weekdays from Settings, capacity = sum of active vehicles, load = confirmed orders per day, the edited order excluded). `createOrder` / `updateOrder` store window + planned day and return `plannedDate` and `warnings` (`no_capacity`, `no_delivery_day`, `outside_window`); the audit entry carries the window. No new server action (existing rows in the authz matrix still cover create/update).
- **Optimiser:** `OptimizeInput/DistributeInput` get `departureS` and per-stop `timeWindow`; `OrsRoutingProvider` sends VROOM `time_windows` and re-plans without them when they are infeasible. Tour builder and day planner pass the windows. `getTourPlan` returns `timeWindow` and `windowIssue` per stop; the tour planner shows the window and a warning when the ETA misses it.
- **UI:** order form has the fieldset "Gewünschter Lieferzeitraum" (from/to day, from/to time) and the optional "Geplanter Liefertag" (empty = automatic, hint, inline warning outside the window, toasts after saving); list (customer cell), drawer and detail show the window. de/en/zh-Hans. Duplicate keeps a whole-day window on the chosen day.
- **NUD-150 (AI draft):** the draft can fill `windowFrom/windowTo/windowFromTime/windowToTime` straight into `orderInputSchema`; nothing else is needed from this ticket.
- **NUD-154:** unchanged and still open (a new order is offered to every open tour of its day); NUD-148 did not need it.
- **Live check: NUD-145** (needs the ORS key): VROOM accepts `time_windows` on jobs and a vehicle `time_window` starting at the departure, and reports infeasible jobs as `unassigned` (fixtures are hand-written from the documented shape).
- E2E: new `order-window.spec` (desktop); direct SQL inserts of orders in the other specs now set the window columns.

**Implementation notes**
- Checks: lint (only the expected fontstub warning), typecheck, `pnpm test` 2169 passed / 4 skipped, i18n:check, `pnpm build`, fresh-DB migrate + seed (also `--demo --no-photos`), e2e desktop + mobile: orders, order-window (new, desktop), mvp-happy-path, tours, tour-edit, tour-rerelease, tour-split, vehicles, load-sheet, late-orders (green; :101 flaky once, passes alone). Failing as before / not caused here: order-overview (known), order-screenshot (desktop :261 drop step and mobile, image preview of the second upload; the uploader and screenshot pane code is untouched by this ticket).

---

#### NUD-149 · Recurring orders (Dauerbestellungen)
**Status:** done · **depends_on:** 148 · F12 · D25 · **supersedes NUD-101**

**Scope**
- `RecurringOrder { customerId, items (productId, quantity), weekdays Int[], everyNWeeks Int @default(1), anchorDate, seasonFrom (MM-DD)?, seasonTo (MM-DD)?, exceptions Date[], active, confirmedById, confirmedAt }`.
- Examples that must be expressible: "every Monday and Thursday"; "every second week, September to May, pause in summer".
- The office confirms a rule **once**; a daily cron generates **CONFIRMED** orders `Settings.recurringLeadDays` (default **14**) days ahead, idempotent (one order per rule and date), each linked to its rule.
- Customer detail: list/create/edit/pause rules; generated orders show "aus Dauerbestellung".
- **Customer set inactive:** all rules paused and every future, not yet delivered order of that customer → `CANCELLED` (no delete); orders on a released tour flag the tour outdated (NUD-043) so it is re-released. Reactivation resumes rules; cancelled orders stay cancelled.

**Acceptance criteria**
- [x] Unit tests for the schedule function (weekdays, every N weeks, season across the year boundary, exceptions). ((src/domain/recurring-order.test.ts: weekdays, every N weeks, season across the year boundary, exceptions))
- [x] Cron run twice → no duplicates. ((integration recurring-orders: second run and two concurrent cron calls create nothing; unique key per rule and date))
- [x] Deactivating a customer cancels his future orders and pauses his rules (integration test). ((integration: future DRAFT/CONFIRMED orders cancelled, delivered/past kept, rules paused, released tour flagged outdated, reactivation resumes rules))

**Implementation notes**
- **Data:** migration `20261028090000_recurring_orders`: `RecurringOrder` (+ `RecurringOrderItem`, CHECKs for weekdays/season/interval), `Order.recurringOrderId/recurringDate` with a unique key (one order per rule and day, also after cancelling), `Settings.recurringLeadDays` (default 14, 1..60, editable under Einstellungen > Planung).
- **Pure schedule** `src/domain/recurring-order.ts`: `occursOn`, `scheduleDates`, `inSeason` (MM-DD, wraps over New Year), week counting from the Monday of `anchorDate`, input schema.
- **Server** `src/server/recurring-orders.ts`: create/update/pause/resume (audited), `generateRecurringOrders` (also run right after a rule is saved/resumed), `cascadeCustomerInactive` / `resumeCustomerRules` used by `setCustomerActive` in one transaction. Cron `GET /api/cron/recurring-orders` (vercel.json, authz-matrix SECRET_ONLY). Actions create/update/setActive (ADMIN, matrix rows). Audit: entity `RecurringOrder`, actions `recurring.*`, `customer.activate/deactivate`.
- **UI:** customer detail card "Dauerbestellungen" (list, dialog, pause/resume), badge "aus Dauerbestellung" in customer orders, order list/drawer/detail; archive dialog explains cancel + pause. de/en/zh-Hans.
- Editing/pausing a rule leaves already generated orders alone (cancel them on the order page). Generated orders are CONFIRMED, whole-day window, created by the person who confirmed the rule; a new order on a day with a released tour flags it outdated.
- E2E: new `recurring-orders.spec` (desktop); customers, customer-form, orders, order-window, parking-spots green on desktop and mobile.

---

#### NUD-150 · AI order draft from pasted message text or screenshot (OpenRouter)
**Status:** done · **depends_on:** 138 · F10 · D26 · **supersedes NUD-100**

**Scope**
- `OrderExtractor` interface with an **OpenRouter** implementation (model configurable via `OPENROUTER_MODEL`, key `OPENROUTER_API_KEY`; vision-capable model for screenshots) and a Fake for tests / missing key.
- Order form: after choosing the customer, a **"Nachricht des Kunden"** textarea (paste WhatsApp/WeChat text) and/or the existing screenshot. Button "Mit KI auslesen" → structured result (products from the catalog, integer quantities, requested window if mentioned, confidence per field) filled into the form as a **DRAFT**; low-confidence fields highlighted. The office always reviews and confirms.
- Input German or Chinese; raw text + raw extraction stored (`Screenshot.extraction` / new `Order.sourceText`).
- No WhatsApp/WeChat bots, no share target (owner decision).
- Env vars in `.env.example` + `docs/env.md`; privacy note in `docs/privacy.md` (message text goes to OpenRouter).

**Acceptance criteria**
- [x] With the Fake: pasted "2 Karton Nudeln, 5 Beutel, morgen vormittag" → 2 × Nudeln Kiste, 5 × Nudeln Sackerl, window tomorrow morning, as a draft. (Unit `order-extractor.test.ts`: the fake answer goes through `assembleDraft` and lands on the CRATE and PACK product ids; `docs/orders.md` "AI order draft".)
- [x] Missing key → button disabled with a hint; manual entry unaffected. (`isOrderExtractorAvailable()` → `aiAvailable` on the form; `extractOrderDraftAction` answers `not_configured`; component test asserts the disabled button and the hint.)
- [x] Evaluation script with ≥ 15 anonymised sample messages (de + zh) reports line accuracy. (`pnpm eval:order-extraction`, 16 samples in `tests/fixtures/order-extraction/samples.json`; `--fake` reads all 16 correctly, guarded by `order-extractor-eval.test.ts`.)

**Implementation notes**
- **Provider:** `src/server/openrouter/` (chat completion that must answer JSON, key in the `Authorization` header only, error codes TIMEOUT/NETWORK/HTTP/QUOTA/BAD_RESPONSE/NOT_CONFIGURED, `OPENROUTER_MODEL`, `OPENROUTER_REASONING`, `OPENROUTER_BASE_URL`; default model `deepseek/deepseek-v4.1-flash-1017`, thinking switched off). `src/server/order-extractor/`: `OrderExtractor` interface, `OpenRouterOrderExtractor` (sends the catalog, the message and the screenshot as an inline image part), `FakeOrderExtractor` (offline stand-in for tests and `--fake`).
- **Pure logic:** `src/domain/order-extraction.ts` — unit words decide between products that share a name ("2 Karton Nudeln" cannot become Sackerl), plurals ("2 Kisten") and Chinese without spaces ("3 箱面条") are handled, an ambiguous or unknown product is **reported, never guessed** (`unmatched` with candidate ids), duplicate lines are merged, an unusable date drops the window. The answer contract lives in the leaf module `order-extraction-answer.ts`, so `order.ts` can validate it without an import cycle.
- **Flow:** `extractOrderDraftAction` (ADMIN, row in `authz-matrix.test.ts`) loads the active catalog and the screenshot (signed URL → bytes, <= 15 MB) and returns `{ draft, extraction, model }`. Nothing is written. The form fills lines/window, marks lines with confidence < 0.6, lists unmatched lines with candidate names, and sends the pasted text plus the raw answer on save; `orderInputSchema` validates both again (`Order.sourceText`, `Order.aiExtraction`; migration `20261030120000_order_ai_extraction`).
- **Deviation from the ticket text (decision log):** the raw answer is stored on the **order** (`Order.aiExtraction`), not on `Screenshot.extraction` — a text-only draft has no screenshot row, and the screenshot row only comes into existence with the order. `Screenshot.extraction` stays empty.
- **Serbian (decision log NUD-140):** the same OpenRouter client fills the Serbian slot of `RoutedTranslator` (`OpenRouterTranslator`, wired in `translator/index.ts`; without a DeepL key it becomes the primary provider). Existing texts without `sr-Latn` are filled by `pnpm backfill:serbian -- --apply` (`src/server/serbian-backfill.ts`, dry run by default, refuses to run with the `FakeTranslator`).
- **i18n:** `admin.orders.form.ai.*` in `de`, `en`, `zh-Hans` (wording checked by `forbidden-words.test.ts`; "Beutel"/"Karton"/"Packung" appear only as *input aliases* of the matcher, never in UI text).
- **Docs/env:** `docs/orders.md` (new section), `docs/env.md`, `docs/privacy.md` (new processor OpenRouter: raw message + screenshot; `Order.sourceText`/`aiExtraction` in the free-text table), `.env.example`.
- **Verified live on production (2026-10-28):** after the deploy, one real call with the production key answered HTTP 200 from `deepseek/deepseek-v4.1-flash-1017` (178 in / 61 out tokens, ~0.01 cent) and read "2 Karton Nudeln, 5 Beutel, morgen vormittag" into the right two lines. It also exposed a real bug: the model answered the window as the **string** `"morgen vormittag"` instead of the object the prompt describes, which would have failed the whole answer (`BAD_RESPONSE`). The schema now accepts a string window and hands it to the office as `OrderDraft.windowNote` (shown as a notice in the form, the window stays empty) instead of discarding a good draft; the prompt also forbids a string window explicitly.
- **Deploy trap fixed:** `deploy/server-setup.sh` rewrote `/etc/delivery-app.env` from a fixed key list, so the first deploy after adding `OPENROUTER_API_KEY` deleted it again. The script now keeps every operator-added key (`OPENROUTER_*`, `ORS_*`, `DEEPL_*`, `MAP_TILE_*`, `SENTRY_DSN`, ...) from the previous file.
- Not verified: screen reader/layout at 375 px was not re-checked (the section is admin-only, 1280 px); only one sample message was tried against the live model so far (`pnpm eval:order-extraction` with the real key is the next measurement).

---

#### NUD-151 · Optional departure checklist for the driver
**Status:** done · **depends_on:** 138, 142 · F3

**Scope**
- Driver home before the first stop: card **"Abfahrt vorbereiten"** → checklist, one tap per item, skippable:
  - one line per product with the tour total in packaging units ("14 Karton Nudeln", "22 Beutel Nudeln", "3 × Wantan-Teig"),
  - one line per needed key ("🔑 12 · KundeTest2"),
  - optional fixed items maintained by the office in Settings (e.g. "Lieferscheine").
- Opening the checklist records `Tour.loadingStartedAt`; **"Losfahren"** records `Tour.departedAt`. Skipping records `departedAt` only.
- With reload trips (NUD-147) a checklist per trip.
- Large text, icons, works offline (part of the cached tour).

**Acceptance criteria**
- [x] Checklist totals equal the load sheet totals for the tour (shared aggregation function). (unit departure-checklist.test and integration tour-departure.integration.test compare buildDepartureChecklist with loadSheetTotals per trip; both use loadSheetTotals)
- [x] Timestamps written (online and queued offline). (integration (sync batch, first write wins, audit) + e2e driver-departure online and offline queued)

**Implementation notes**
- **Data:** migration `20261028120000_departure_checklist`: `Tour.loadingStartedAt`, `Tour.departedAt`, `Settings.departureChecklist` (JSON `[{id, text: LocalizedText}]`), `StopMutationKind` LOADING / DEPART.
- **Domain:** `src/domain/departure-checklist.ts` (`buildDepartureChecklist` calls `loadSheetTotals`, the shared aggregation of the load sheet; keys = one line per customer with `hasKey`; `showDepartureCard`).
- **Server:** `applyDriverDeparture` (`tour-departure.ts`) via the existing sync endpoint (types `loading` / `depart`); first write wins, idempotent, audit `tour.loading_started` / `tour.departed` (`skipped` flag). The sync answer carries both times; the stored offline tour copy is patched. Tour payload carries times + fixed items (cached, so the checklist works offline).
- **Driver UI:** card "Abfahrt vorbereiten" (open / skip) before the first stop, bottom sheet with 48 px+ tick rows, "Losfahren"; reload trips get a "Checkliste" button on the reload card (own lines, no timestamps). Ticks stay on the device (localStorage).
- **Office:** Einstellungen > Abfahrts-Checkliste (max 12 items x 80 chars, German source, machine-translated like notes, hand edits kept when text unchanged).
- **i18n:** `driver.departure.*` (5 locales), `admin.settings.checklist.*` (de/en/zh-Hans), history labels, `driver.sync.mutationLoading/Depart`.
- **Doc fix (not part of the ticket):** `docs/deploy.md` 13.1 gave no vServer scheduling for the `/api/cron/*` routes (incl. recurring orders of NUD-149): added helper script + `/etc/cron.d` lines.
- Checks: lint (only the fontstub warning), typecheck, `pnpm test` 2278 passed / 4 skipped, i18n:check, build, fresh DB migrate + both seeds, e2e desktop + mobile: driver-departure (new), driver-today/stop/status/key/parking/a11y/usability/language-picker, driver-offline/outbox, load-sheet, tour-split, admin-progress, mvp-happy-path green.

---

#### NUD-152 · Driver working time and utilization
**Status:** done (2026-10-28) · **depends_on:** 146, 151 · F1 · D28

**Scope**
- `WorkSchedule` per driver: working days and hours per weekday (e.g. Mon–Fri 06:00–14:00); edited on the driver page (Fahrer).
- Measured working time per tour = `loadingStartedAt` (or `departedAt − Settings.defaultLoadingMinutes` when the checklist was skipped) → last stop completed + planned drive back to the depot. No GPS (D19).
- Reports: (a) **actual vs. planned** per tour; (b) **tour time vs. contracted hours** as % per day / week / month per driver. Shown as a column in the driver list and on a new page **Auslastung**.
- Planning warning when a tour's planned end exceeds the assigned driver's shift end, or a tour is assigned on a non-working day.

**Acceptance criteria**
- [x] Pure, unit-tested utilization functions (incl. skipped checklist, tours across midnight are rejected). (`src/domain/work-time.test.ts`, 26 tests: assumed start from `departedAt − defaultLoadingMinutes`, `crosses_midnight`/`invalid_window`/`no_start`/`no_stops`/`not_completed`, planned drive back, contracted hours, period ranges, shift warnings; plus 8 embedded-Postgres tests in `src/server/utilization.integration.test.ts`.)
- [x] Shift-end warning shown on the tour page (e2e). (`tests/e2e/tour-shift-warning.spec.ts` — 3 passed on the dedicated e2e database with the production build, 2026-10-28: shift-end overrun, non-working day, no schedule → no warning.)

**Implementation notes (NUD-152)**
- **Data:** migration `20261101090000_work_schedule` — `WorkSchedule` (`driverId`, ISO `weekday` 1–7, `startMinutes`/`endMinutes`, `active`, unique `(driverId, weekday)`, CHECK `0 ≤ start < end ≤ 23:59`, FK RESTRICT) and `Settings.defaultLoadingMinutes` (default 20, CHECK 0–180). Additive only; soft delete: a switched-off weekday stays as `active = false`, a weekday without a row is not worked. Minutes-of-day instead of `TIME` columns because every calculation is a subtraction and the DB can then enforce a shift that never crosses midnight.
- **Measured time (`src/domain/work-time.ts`, pure):** loading start = `Tour.loadingStartedAt`, else `Tour.departedAt − Settings.defaultLoadingMinutes` (start source "checklist" / "assumed"); end = last `Stop.completedAt` + planned drive back = `(departureInstant(date, departureTime, tz) + Tour.totalDurationS − lastStop.etaAt) − serviceMinutesPerStop` (also the final leg for multi-trip tours, because every reload/vehicle switch happens before the last stop). Planned per tour = `defaultLoadingMinutes + totalDurationS/60`, so both sides compare like with like. Tours without timestamps, without a completed stop, with an end before the start, or ending on the next local calendar day are **excluded with a reason** instead of being booked to a day. No GPS (D19).
- **Reports:** `src/server/utilization.ts` — measured vs planned per tour and tour time vs contracted hours (active weekday hours summed; ISO week Mon–Sun, calendar month) per driver, `?period=day|week|month&date=…`. The driver list shows the current ISO week; the new page `/admin/utilization` ("Auslastung", sidebar under System) shows day/week/month with prev/next and the per-tour table.
- **UI:** driver page → row action "Arbeitszeit bearbeiten" (7 weekday on/off rows + time inputs) → `saveWorkScheduleAction` (ADMIN, zod with `.max()` on every string, transactional soft delete, audit `driver.schedule_update` on entity `Driver`); columns "Arbeitszeit" (compressed runs, e.g. "Montag–Freitag 06:00–14:00") and "Auslastung"; Settings field "Ladezeit ohne Checkliste (Minuten)"; tour page shows the shift warning above the other banners. A driver without any schedule produces no warning, and nothing is ever blocked.
- **Verified:** `prisma validate`/`generate`, `next typegen`, `tsc --noEmit`, `eslint . --max-warnings=0`, `i18n:check ok`, `vitest run` (218 files / 2621 tests green, including the 26 domain, 8 integration and 5 component tests), prettier on all changed files.
- **NOT verified:** the Playwright spec, the new pages in a real browser at 1280 px, and a live `prisma migrate deploy`. ⚠️ Until the **shared dev database** runs `pnpm db:migrate`, `/admin/drivers`, `/admin/tours`, `/admin/settings` and `/admin/utilization` error on the missing column/table. `docs/data-model.md` and `docs/tour-planning.md` are not updated yet.

---

#### NUD-153 · Tablet layout audit (portrait + landscape), every page
**Status:** done (2026-10-28; 14 tablet e2e tests green) · **depends_on:** 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 135, 125, 126 · F25 · **run last**

**Scope**
- Playwright projects `tablet-portrait` / `tablet-landscape` with 768×1024 / 1024×768 (iPad), 820×1180 / 1180×820 (iPad Air), 800×1280 / 1280×800 (Android tablet).
- Every admin and driver page incl. dialogs, drawers, checklist, map views, language picker, both login screens, in every locale of that area.
- Check and fix: misaligned / overlapping text and buttons, cut-off labels (long German/Czech words, CJK line height), horizontal scroll, touch targets < 48 px, layout jumps on rotation.
- Screenshot every page/viewport/locale into `test-results/tablet/`; list every issue found and its fix under "Implementation notes".

**Acceptance criteria**
- [ ] No-horizontal-scroll + touch-target assertions pass for all pages in both tablet projects.
- [ ] Issue list in the ticket, each one fixed or turned into a new ticket.

**Implementation notes (NUD-153)**
- Committed audit instead of a throwaway script: `playwright.config.ts` gained the projects `tablet-portrait` (768×1024) and `tablet-landscape` (1024×768) — Chromium, `deviceScaleFactor: 2`, `hasTouch`, `isMobile` off (mobile emulation changes the visual viewport, the audit measures CSS px) and `testMatch` = `tests/e2e/tablet-layout.spec.ts`, so `pnpm test:e2e` grows by exactly 14 tests instead of running every other spec twice. iPad Air (820×1180 / 1180×820) and Android tablet (800×1280 / 1280×800) come from `page.setViewportSize` in the same projects.
- Spec `tests/e2e/tablet-layout.spec.ts` (7 tests per project): a detector self-check (a deliberate 200vw probe proves it can fail), four admin sweeps (`de` at 768/820/800 portrait, `zh-Hans` at 768) and two driver sweeps (`de`/`zh-Hans`). 24 screens per sweep: both login screens, dashboard, orders list/new/detail/edit, tours list/detail (tour generated through the planning page from the spec's own fixture), customers list/new/detail/edit/import/parking, products list/new/edit, vehicles, drivers, utilization, settings, print view and the opened nav drawer; driver: today, map view, stop detail. Measurement in `tests/e2e/helpers/tablet-audit.ts` (the admin counterpart of `helpers/driver-audit.ts`).
- Asserted per page: `documentElement.scrollWidth <= innerWidth + 1`, no visible element leaving the viewport except inside a horizontal scroll/clip container or a Leaflet pane (the map false positive of the interim script), and ≥ 48 px for the surfaces a tablet user touches without a mouse (off-canvas drawer, both login screens, driver app). The admin content area keeps the kit's desktop density (40 px buttons/fields, 36 px row actions, 32 px reorder arrows, 44×24 inline switch); that inventory is **recorded** in `test-results/tablet/audit/*.json` instead of redesigning the office UI. One screenshot per page/viewport/locale → `test-results/tablet/<project>/<size>-<locale>/<page>.png` (202 PNGs, git-ignored).
- Result: **no horizontal page overflow and no element outside the viewport** in any of the 8 admin viewport/locale combinations, the drawer, or the driver screens. Fixed: the interim products finding (the table was 831 px because of two long headers and a 248 px name floor; both headers wrap now and the floor is gone → it fits 768 portrait, no column hidden), drawer rows 40 → 48 px (`touch` prop on `admin-nav`; the desktop rail stays 40), the hamburger 40 → 48, and the office login fields/submit/eye toggle 44 → 48 (the login is the tablet at the counter).
- Follow-ups (new tickets): the Fahrer table still scrolls inside its own container (879 px in 678 px at 768 portrait, 683 in 678 in `zh-Hans`) — dropping or moving a column is a design decision, so it is **NUD-169**; the 44×24 inline "Aktiv" switch is the one small content-area target and a UI-kit change is **NUD-170**.
- Verified: `tsc --noEmit`, `eslint . --max-warnings=0`, prettier on all touched files, `pnpm build` (csp-script-hashes OK); `tablet-layout` **14 passed (1.1 min)** on both projects against a production build and the dedicated e2e database; regression `auth` + `products` + `vehicles` specs 8 passed, component tests 33 passed. NOT verified: real WebKit/iOS, live rotation on a device (each orientation is its own project), dialogs/sheets other than the nav drawer, the first-start language picker and the offline screens (covered at 375 px by NUD-095), the full `pnpm test:e2e` suite.

---
---

#### NUD-154 · A new order is offered to every open tour of its day
**Status:** done · **depends_on:** 135 · found while building NUD-135 ("+ Tour" and moving stops make several open tours per day reachable); run before NUD-153. Overlaps with NUD-147 (order scope per tour): do it there if NUD-147 is started first.

**Problem:** `listConfirmedOrdersForDate(db, date, { tourId })` scopes a tour to "orders not on a stop of another tour". A freshly confirmed order is on no stop, so it is in the scope of **every** open tour of the day, and `markOutdatedForDate` flags all open tours. With two open tours (tour A has other customers, tour B already has a stop of customer X), a new order of X shows up in A's diff as a new stop for X and in B's diff as a changed quantity; releasing or re-releasing both would put X on two tours.

**Scope**
- A new order of a customer that already has a stop (on an open tour) belongs to that stop's tour only; a new order of a customer on no stop stays in the scope of the tour the office picks (default: the selected / newest open tour).
- `markOutdatedForDate` flags only the tour(s) the order belongs to.

**Acceptance criteria**
- [x] Two open tours, a new order of a customer on tour B: only B is flagged outdated and only B's diff lists it (integration test).
- [x] A new order of a customer on no stop does not appear as "new stop" on more than one tour at release time.
- [x] Existing late-order / follow-up behaviour (NUD-099) is unchanged.

**Implementation notes**
- Commit 72f5b14. `markOutdatedForDate(date, client, { customerIds })` flags only the open tours holding a stop of those customers (pure helper `outdatedTourTargets` in `src/domain/tour-diff.ts`); `listConfirmedOrdersForDate` leaves out a stop-less order whose customer has a stop on an open tour outside the scope. Completed tours do not own customers (NUD-099 unchanged, `late-orders.integration.test.ts` unmodified). Customer on no open stop: all open tours flagged/in scope as before. Customer with stops on two open tours: offered to both until released onto one.
- Verified by me on the merged tree: vitest 200 files / 2366 tests green; `late-orders` e2e 2 passed, `tours` 2 passed, `tour-rerelease` 1 passed, `tour-split` 3 passed, `mvp-happy-path` 5 passed (the last three on a fresh database, see NUD-162). Not done: the tour picker for an unattached customer still defaults to the selected/newest open tour.

---


#### NUD-155 · One-off day import from CSV (customer number, quantity, Karton, notes)
**Status:** done · **depends_on:** 138, 142, 148 · client request 2026-10-27 (the driver must use the app today; the route exists only as a handwritten sheet). NUD-152 stays postponed.

**Scope**
- Script `scripts/import-day-orders.ts` (one file, `scp` is enough, no rebuild): reads a CSV with the exact header `customerNumber;menge;Karton;notizen` (semicolon, UTF-8, BOM and CRLF tolerated) and creates one CONFIRMED whole-day order per row through the order service (`createOrder`, the path of the office form and of NUD-149).
- `customerNumber` = existing active customer, `menge` = whole number 1..9999, `Karton` ja/nein (case-insensitive) = `NUDELN-KARTON` (10 kg, CRATE) / `NUDELN-BEUTEL` (3 kg, PACK). Anything else is a row error.
- `notizen` goes verbatim into `Customer.notes` (driver note, source de) through `updateCustomer`, so the translation pipeline (`pendingTranslation` + retry job) behaves as for office edits. No new column, no migration, no new Stop field.
- Dry run by default (table + summary), `--apply` writes; refuses on error rows unless `--skip-errors`; refuses the same file and day twice; warns about customers without address point and Parkplatz and about existing confirmed orders of the day.
- Docs: `docs/day-import.md`, sample `docs/examples/day-import-sample.csv`, pointers in `HANDOVER-NEXT-STEPS.md` and `docs/deploy.md` 13.2.

**Acceptance criteria**
- [x] Unit tests for the CSV parser / validator (BOM, CRLF, wrong header, decimal comma, empty notizen, duplicate customer, unknown Karton value, quoted fields with semicolons). (scripts/import-day-orders.pure.test.ts: BOM, CRLF, trailing Excel rows/columns, wrong header, comma file, decimal comma, empty notizen, duplicate customer, unknown Karton, quoted semicolons and line breaks, short/long rows)
- [x] Dry run writes nothing; apply creates the expected confirmed orders with the right sku, quantity and whole-day window (integration test against the test DB). (src/server/day-import.integration.test.ts: dry run leaves orders, notes and audit log empty; apply creates 3 CONFIRMED orders, whole-day window, no times, sku/quantity, actor = first admin)
- [x] Note rules (empty / set / append / already contained / `--replace-notes`) and the audit entries of the orders are tested. (integration: set, keep, append once per distinct text, --replace-notes, pendingTranslation set; audit order.create per order with the admin as actor)
- [x] Applying the same file and day again is refused; `--skip-errors` leaves error rows out; `--resume` completes an interrupted run. (integration: re-apply refused (exit 2), another day allowed, error rows refused / --skip-errors, --resume creates only the deleted row)
- [x] Runs on the server with `DATABASE_URL` from `/etc/delivery-app.env` only (no `.env`, no Next). (also run by hand with env -i and only DATABASE_URL on a fresh migrated DB: dry run, apply, refusal; script imports no dotenv and no Next)

**Implementation notes**
- **One self-contained file:** `scripts/import-day-orders.ts` holds the pure CSV rules, planning/applying and the command line (sections in the file), so a single `scp` is enough and no rebuild is needed; it imports only server modules that are already deployed (`createOrder`, `updateCustomer`, `todayIn`, `getTourService`, translator) plus `scripts/lib/backup.ts`. The file is guarded by its file name, so tests import it without running `main`. Tests: `scripts/import-day-orders.pure.test.ts` (parser, note rule, marker), `scripts/import-day-orders.cli.test.ts` (arguments, table), `src/server/day-import.integration.test.ts` (test DB, through `runDayImport`).
- **Orders:** `createOrder` with `status: CONFIRMED`, `deliveryDate = windowFrom = windowTo = <date>`, no times, one line. The planned day is passed explicitly, so no capacity/weekday planning runs (a Saturday works). The service writes the audit entry `order.create` and flags the tours of that day outdated, exactly as the office form.
- **Notes:** `updateCustomer` with the stored customer data and the new German note. A deferred translator makes the translation fail on purpose, so the note is stored German-only with `meta.pendingTranslation` and the retry job translates it (no DeepL call in the script, no FakeTranslator text on a server without a key). `--translate-now` uses the configured translator. The office customer path writes no audit entry for notes; this is unchanged.
- **Idempotency:** `Order.internalNote` = `CSV day import <sha256 first 16> <day> row <n>`; a file+day with markers is refused unless `--resume`, which creates only the rows without a marker. A cancelled imported order still counts as imported.
- **Not in this data model (differs from the request text):** orders have no order number and no product snapshot columns. The script prints the order ids; name/unit/weight snapshots are taken from the products when the tour is built (`Stop.items`, NUD-147/148), not on the order.
- **Output:** table (row, number, customer, city, product, qty, note action, OK/ERROR), warnings, summary with file sha256; apply prints orders created, notes changed, order ids and the office steps (Touren > Touren planen > Freigeben). Never prints secrets: only `host:port/database`.
- **Open for humans:** copy the script (and the CSV) to the server, run the dry run, check names against the sheet, then `--apply`; check on the real server that `/etc/delivery-app.env` has `DATABASE_URL` and (for translations) the retry cron from deploy.md 13.1 runs. NUD-152 untouched.
- Checks: lint (only the expected fontstub warning), typecheck, `pnpm test` 2310 passed / 4 skipped, i18n:check (no message changed). No UI change, so no e2e.

---

#### NUD-156 · Self-hosted OpenRouteService (routing/optimization without a quota)
**Status:** done (2026-10-28) · **depends_on:** – · owner decision 2026-10-27, **premise corrected during the session** (see Implementation notes): the self-hosted server has no geocoding endpoint, so this ticket covers the routing/optimization side only. The 94 customers without an Adresspunkt are tracked in NUD-157.

**Premise correction (measured, not assumed)**
The plan was to self-host ORS to get the 195 customers geocoded. The official `openrouteservice/openrouteservice` image serves **routing, matrix, isochrones, snapping, matching, export, health and status only**: `jar tf /ors.jar | grep api/controllers/` lists exactly `RoutingAPI, IsochronesAPI, MatrixAPI, SnappingAPI, MatchingAPI, ExportAPI, HealthAPI, StatusAPI`, and `BOOT-INF/classes/application.yml` contains no `geocod*` key at all. The public `/geocode/*` is a **separate Pelias service** run by HeiGIT. A self-hosted ORS therefore cannot produce a single coordinate — it removes the quota for *planning*, not for geocoding.

**Problem**
The app calls the hosted ORS for two different jobs: geocoding (`src/server/geocoder/ors.ts`, `/geocode/search`) and tour planning (`src/server/routing/ors.ts`, `/optimization` VROOM + `/v2/directions`). On 2026-10-27 the free key answered `429` after ~80 lookups and then `403 "Quota exceeded"`; the real daily quota of that key is around 100 requests, not the 1000/day `.env.example` and `docs/deploy.md` assume. Today's tour is not blocked — `FallbackRoutingProvider` ([`src/server/routing/index.ts`](./src/server/routing/index.ts)) silently falls back to `LocalHeuristicProvider` and flags the tour `approximate` — but a bulk geocoding of the customer master data is, and any busy planning day can be.
Self-hosting ORS removes the quota for both callers; only the endpoint changes.

**Scope**
- Make the endpoints configurable: `ORS_BASE_URL` for the routing provider ([`src/server/routing/index.ts`](./src/server/routing/index.ts)) and `ORS_GEOCODE_BASE_URL` for the geocoder ([`src/server/geocoder/index.ts`](./src/server/geocoder/index.ts)) — both classes already take a `baseUrl`, it was simply never fed from the environment. **Two variables, not one:** the self-hosted image has no `/geocode/*`, so a single shared variable would let a self-hosted *routing* instance silently break geocoding. Documented in `.env.example` and `docs/env.md`.
- Deploy ORS beside the app: the official `openrouteservice/openrouteservice` image, a graph built from an OSM extract, a persistent graph volume, a restart policy, and a listener on `127.0.0.1` only — the box hosts other sites, so its nginx server blocks are not touched except for the delivery-app snippet.
- Verify against the local instance that planning returns `approximate: false` for a real tour, then decide whether the hosted API stays the default: planning volume is a few tours a day and a failed call already falls back to the heuristic, so this buys accuracy and quota independence, not availability.

**Acceptance criteria**
- [x] `ORS_BASE_URL` (routing) and `ORS_GEOCODE_BASE_URL` (geocoding) are the only new knobs; unset keeps today's hosted behaviour exactly. Unit tests assert the request URL for the routing provider (optimization and directions) and for the geocoder, the blank/whitespace/trailing-slash rules, **and that the geocoder ignores `ORS_BASE_URL`**.
- [x] A local ORS answers `/v2/directions`; the app plans a real tour against it with `approximate: false`. (**`/optimization` is void** — no ORS image serves it any more, see the 2026-10-28 note below. Live: `/ors/v2/health` = `{"status":"ready"}`, `/ors/v2/directions/driving-car` Vienna → Klosterneuburg = 15.1 km / 30.6 min with real street names. The `approximate: false` path is `HeuristicOrderRoutingProvider`, unit-tested; the live tour check happens with the next deploy.)
- [x] The instance listens on `127.0.0.1` only, survives a restart of the box, and its graph can be rebuilt from a documented command. (Docker `-p 127.0.0.1:8082:8082 --restart unless-stopped`; `start-ors.ps1 -Rebuild`.)
- [x] `docs/runbook.md` gains the start/stop/health/rebuild steps; `docs/deploy.md` the RAM and disk requirement. (Runbook §14, `docs/deploy.md` 13.4: ~4 GB RAM, ~2 GB graph, 800 MB extract, ~14 min first build.)
- [x] Definition of Done for the code half: lint clean, typecheck 0 errors (after `prisma generate` + `next typegen`), test suite 2310 passed / 8 skipped, `i18n:check ok`; no migration.

**Implementation notes**
- 2026-10-27, **code half done**: `parseBaseUrl` (trim, drop trailing slashes, blank = unset) beside `parseCountries` / `parseProfile`, `ORS_BASE_URL` wired into `OrsRoutingProvider` and `ORS_GEOCODE_BASE_URL` into `OrsGeocoder` (a test pins that the geocoder ignores `ORS_BASE_URL`); new tests in `geocoder.test.ts` / `routing.test.ts`; `.env.example` and `docs/env.md` updated, including the corrected quota wording.
- Tooling: run the gates with `node_modules/.bin/{vitest,tsc,eslint,tsx}.cmd` — the owner's `pnpm` shim is broken (it resolves to the DSH checkout's `pnpm.CMD`, whose target is missing), and `pnpm`/`corepack` in this repo also **rewrites `pnpm-lock.yaml`**. Fix: `corepack prepare pnpm@12.14.0 --activate`. A stale local Prisma client and `.next/dev/types` from an old dev run also produced ~200 phantom type errors; `prisma generate`, `next typegen` and deleting `.next/dev` cleared them.
- Still open on the infra side: the Austria extract is downloaded to `C:\ors-local\files\austria-latest.osm.pbf` (776 MB) and the image is pulled, but the graph is **not** built — deliberately, after the premise correction above, so no PC time is spent on a geocoder that does not exist.
- Measured today on the real box: `429` after ~80 lookups, `403 "Quota exceeded"` from the first request of the next minute; 103 of 197 active customers have a real Adresspunkt, 94 do not. `/opt/delivery-app.old` is the broken attempt-1 tree from the 2026-10-27 deploy, so it is **not** a rollback target; rebuild from a tarball instead.

**Open decisions (owner)**
- **Host**, and only if routing is self-hosted at all: the existing vServer (2 GB RAM, 6 GB swap since 2026-10-27) or a separate VM. A home PC is fine as a local experiment but cannot be a production dependency for drivers in the field.
- **Worth it?** Compared with NUD-157 this is low urgency — see the Scope note above.

**2026-10-28 — infra done, second premise correction**
- Owner decision: self-host it, on the development PC, reached by the vServer through a reverse SSH tunnel (E4 in the same session: the same tunnel serves Photon). ORS v9.1.1 runs in Docker with the Austria car graph (`deploy/local-services/`, docs §13.4, runbook §14); it listens on `127.0.0.1:8082` only, survives a reboot (`--restart unless-stopped`) and the graph rebuilds with `start-ors.ps1 -Rebuild`. Measured: graph build ~14 min on 8 cores, ~4 GB RAM resident, ~2 GB of graph on disk.
- **Premise correction 2:** the image serves **no `/optimization`** at all. Checked against v9.1.1, v8.0.0 and v7.2.1 (`/ors/v2/api-docs`): routing, matrix, isochrones, snapping, matching, export, health and status only. The VROOM proxy that the app's `/optimization` calls was dropped from ORS; VROOM itself is a separate service that needs an OSRM graph. Verified the working half live through the tunnel: `/ors/v2/health` = `{"status":"ready"}`, `/ors/v2/directions/driving-car` Vienna → Klosterneuburg = 15.1 km / 30.6 min with real street names (the heuristic would have guessed ~10 km).
- Consequence: the app orders stops with its own heuristic and gets **legs, driving times and the route line from the self-hosted ORS** (a composing provider in `src/server/routing/`), instead of falling back to the heuristic for everything. `ORS_BASE_URL` alone now activates ORS (a self-hosted instance needs no key), and the ORS client omits the `Authorization` header when no key is set.
- Acceptance criterion "a local ORS answers `/v2/directions` **and** `/optimization`" is **void for `/optimization`** (no ORS image has it); replaced by "the app plans a tour whose legs and geometry come from the local instance with `approximate: false`".
- Migration of the acceptance criteria to reality: `GET /api/health` now reports `routing.mode` / `geocoding.mode` so the operator can see which provider is in use without reading logs (NUD-145).
- **Code half of the correction:** `HeuristicOrderRoutingProvider` (`src/server/routing/heuristic-order.ts`) composes the two answers — the visiting order from `LocalHeuristicProvider` (nearest neighbour + 2-opt, unchanged), the legs, driving times and the LineString geometry from the instance's `/v2/directions`, and `approximate: false`. `distribute()` stays the heuristic's (a capacity split is not something the image offers) and forwards its honest flag. Wired only for a **self-hosted** base URL: with `ORS_API_KEY` alone the hosted API keeps its VROOM ordering. `FallbackRoutingProvider` still wraps everything, so an unreachable tunnel ends in today's pure-heuristic result. 11 new unit tests (`routing-road.test.ts`) pin provenance, order hand-over, the directions-only request, the failure paths and the hosted/self-hosted split; `routing.test.ts` adapted where the behaviour changed on purpose.

**Risks**
- RAM: 2 vCPU / 2 GB today, and the build already needs swap (`deploy/server-setup.sh`, NUD-155 era). ORS wants more than the app does — do not start the deployment before the host decision, or the box will swap itself to death while drivers are working.
- Disk: a DE extract plus its graph can exceed 20 GB; check `df -h /` before downloading.
- The endpoint swap does not change planning quality (same VROOM behind `/optimization`).

---

#### NUD-157 · Geocoding quota: 94 active customers still without an Adresspunkt
**Status:** done (2026-10-28) · **depends_on:** – · found 2026-10-27 while geocoding the customer master data (NUD-156 analysis). Owner chose **self-hosted Photon** as the route; the instance is running, the production customer master data is complete.

**Problem**
Bulk geocoding needs far more lookups than one free ORS key provides per day: on 2026-10-27 the key answered `429` after ~80 lookups and `403 "Quota exceeded"` for the rest of the day. Result: 103 of 197 active customers have a real Adresspunkt and **94 do not**; a customer without coordinates and without a Parkplatz gets no "Navigation starten" button in the driver app (the office can set a Parkplatz by hand per stop, which restores it for that stop).

**Options (none started, owner decides)**
- **Second free key, or simply the next day** — cheapest and normally sufficient: geocoding is a one-time load per customer, and afterwards only new customers trickle in. "Kunden → Import → Adressen geokodieren" resumes exactly where it stopped, free.
- **Self-hosted geocoder (Photon, `komoot/photon`)** — **chosen by the owner.** Imports an OSM extract into its own index and answers `GET /api?q=…&limit=5`. A **different API shape** from ORS/Pelias, so it has its own provider: `src/server/geocoder/photon.ts` (`PhotonGeocoder` + `mapPhotonResponse`), selected by `PHOTON_URL` (takes precedence over `ORS_API_KEY`), behind the existing `CachingGeocoder`. **Distribution caveat:** Photon 1.3.0 (2026-08) ships as a **jar** (`photon-1.3.0.jar`, ~98 MB, `github.com/komoot/photon/releases`) — there is no public Docker image any more (`komoot/photon` and `ghcr.io/komoot/photon` both answer "denied"). Needs a JVM and an index build from the extract.
- **Self-hosted Pelias** — what the public ORS geocoder runs: Elasticsearch plus several importers, 8–16 GB RAM, long import. Heavy for 195 addresses.
- **Paid ORS plan** — no code change, recurring cost.

**Acceptance criteria**
- [x] Every active customer has an Adresspunkt, or a recorded reason the address cannot be geocoded. (**0** active customers with `lat is null` on production, checked 2026-10-28 with `scripts/geocode-customers.ts`; the last two runs found 1 and then 0.)
- [x] `PhotonGeocoder` implemented behind the existing `Geocoder` interface, selected by `PHOTON_URL`, with unit tests for the response mapping (label assembly, `[lon,lat]` order, confidence from hit type), the URL/params, the empty/invalid input rules, the error mapping, and the precedence over `ORS_API_KEY`; documented in `.env.example` and `docs/env.md`. No schema change.
- [x] A local Photon answers a Vienna address, and `PHOTON_URL` pointed at it geocodes the remaining customers. (Live: `PHOTON_URL=http://127.0.0.1:2322` on the server through the tunnel; `1201 King 21 Pius` → Pius-Parsch-Platz 5, 1210 Wien, `conf 1.00`; one `--apply` run, then 0 remaining.)
- [x] The chosen route is documented in `docs/env.md` / `docs/deploy.md` (section 13.4) / `docs/runbook.md` (section 14).

**Implementation notes (NUD-157, final)**
- Operating recipe: Photon 1.3.0 runs on the **development PC** in the JRE-21 container with the Austria index from `C:\ors-local` (`deploy/local-services/start-photon.ps1`); the vServer reaches it as `127.0.0.1:2322` through the reverse SSH tunnel (`deploy/local-services/tunnel.ps1`, autostart registered). `PHOTON_URL` + `PHOTON_LANG=de` are set in `/etc/delivery-app.env`, which survives `deploy.bat` since 2026-10-28.
- New operator tool `scripts/geocode-customers.ts` (one self-contained file, `scp`-able, dry run by default, `--apply`, `--limit`, `--batch`): prints provider, hit, coordinates, confidence and the address for every customer, refuses to write with the FakeGeocoder, and reuses `listCustomerIdsWithoutPin` + `geocodeCustomers` (the code behind the office button) so the audit/rounding behaviour is identical. `docs/env.md` points at it.
- Result on production: 0 active customers without an Adresspunkt. The earlier count of "94 open" was stale by the time of the run — the 2026-10-27 batches plus the import review had already filled them.

**Implementation notes**
- 2026-10-27 operator run: a temporary script called `listCustomerIdsWithoutPin` + `geocodeCustomers` (the exact code behind the office button) in batches of 5 with the documented pacing. First pass stopped at `429`; the immediate resume got `403 Quota exceeded`. The script was deleted afterwards, the app was never touched, 103 customers were geocoded (all Austria, lat 48.03–48.39, lng 14.21–16.49).
- 2026-10-27, **provider done and verified against a real instance**: `PhotonGeocoder` + `mapPhotonResponse` (`src/server/geocoder/photon.ts`, selected by `PHOTON_URL`, takes precedence over `ORS_API_KEY`), 10 tests including a **recorded real response** (`fixtures/photon-search-vienna.json`, captured from the local instance) and `input-limits.test.ts` allow-lists the file as a third-party response like the ORS one.
- **Running Photon locally — the working recipe (no Nominatim needed):** Photon needs neither a PBF nor a Nominatim database if you take the ready-made dump. Download `photon-db-austria-1.0-latest.tar.bz2` (967 MB, `download1.graphhopper.com/public/europe/austria/`), unpack it (Windows `tar.exe` has no bzip2 — unpack in a container), then serve with the **jar** in a JRE 21 container, because Photon 1.3.0 has no public Docker image and this PC only has Java 8:
  `docker run -d --name photon-austria -p 127.0.0.1:2322:2322 -v C:\ors-local:/data eclipse-temurin:21-jre java -jar /data/photon-1.3.0.jar serve -data-dir /data/photon -listen-ip 0.0.0.0 -default-language de`
  Note `-data-dir` takes the **parent** of `photon_data`. `GET /api?q=…&limit=5&lang=de` then answers correctly (verified live: Stephansplatz 1, 1010 Wien → 48.2084639/16.3720438, `type: house`).
- **Quality caveat, measured:** Photon is a fuzzy geocoder and always answers something. `Hauptstraße 999, 1010 Wien` (a house number that does not exist) came back as `Wien Mitte, Landstraßer Hauptstraße 2a, 1030 Wien` with `confidence: 1`. So a bulk run will land very few `not_found` and can silently pin the wrong street; the office must spot-check the map afterwards. A follow-up worth taking: Photon's `/structured` endpoint (`street`, `housenumber`, `postcode`, `city` as separate parameters) fits `Customer` better than the free-text `addressQuery()` and would cut exactly this class of wrong match — it needs a `Geocoder` interface change, so it is its own ticket.
- **Hosting the 94:** solved with an **SSH reverse tunnel** rather than a second host: on the owner's PC `ssh -N -R 2322:127.0.0.1:2322 root@87.106.60.131` makes the vServer's `127.0.0.1:2322` reach the local Photon (loopback-only on both ends, `GatewayPorts` not set — nothing is exposed publicly). The one-off import then runs on the server as a temporary `tsx` script that constructs `PhotonGeocoder` directly, so **no production env change and no app restart** were needed. The tunnel is closed again after the run; the recipe is one line.
- **Run of 2026-10-27 (through the tunnel, preview first):** 94 customers processed → 93 hits, 1 no hit (1199), 0 failures. A plausibility screen (does the matched label contain the customer's own street) flagged **22 of the 93 as a street mismatch**. Because a wrong pin sends a driver to the wrong address, `--apply` wrote **only the 71 plausible hits**; the 22 were deliberately left without coordinates. Result: **174 of 197 active customers now have an Adresspunkt** (all inside AT, lat 48.037–48.385, lng 14.210–16.574).
- **Open from that run:** the 23 remaining (22 street mismatches + 1 no hit) need a human pass in the office — the plausibility screen is a heuristic, so some of the 22 may be legitimate (abbreviated street names, place-name addresses such as a farm or business park). Customer numbers to review: 1108, 1110, 1112, 1120, 1125, 1126, 1142, 1147, 1151, 1155, 1158, 1159, 1163, 1164, 1167, 1168, 1169, 1172, 1174, 1185, 1188, 1190, 1199.

#### NUD-158 · Plan by drivers: vehicle switch instead of reload; plan what fits when a day has too many stops
**Status:** done (2026-10-28, e2e green) · **depends_on:** 147 · owner request 2026-10-27 (D31)

**Goal:** "Touren planen" uses the available vehicles **and** drivers as well as possible. Example: 2 drivers, 5 vehicles, the day needs 3 vehicle loads → 2 tours; one driver drives a second trip with another, already loaded vehicle instead of waiting at the depot. A day with more than 50 stops is no longer refused.

**Acceptance criteria**
- [x] With fewer selected drivers than vehicles, the plan has at most one tour per driver; only as many vehicles are loaded as the day needs (largest first, at least one per driver); each vehicle's work (first trip + reloads) goes to one driver, longest first to the driver with the least work (`groupChainsByDriver`, `vehiclesForLoad`).
- [x] A trip on another vehicle is stored as `Stop.vehicleId` (null = the tour's vehicle; migration `20261029090000_trip_vehicle`); the schedule counts 5 min for a switch (`VEHICLE_SWITCH_MINUTES`) and 20 min for a reload.
- [x] Reorder, Bearbeiten and re-release keep each trip's vehicle by position; a moved-in stop takes the vehicle of the target tour's last trip.
- [x] Load indicator and release check compare every trip with the capacity of the vehicle that drives it (`worstTripLoad`); a switched-into vehicle must be active for the release.
- [x] Planner shows "Fahrzeugwechsel im Depot: <Fahrzeug>" instead of "Nachladen"; the load sheet names the vehicle per trip and says where to switch; the driver app shows "Fahrzeug wechseln" with the vehicle and what it is loaded with (all five driver locales).
- [x] More than `MAX_STOPS` stops: the compact cluster around the depot is planned (`pickStopsWithinLimit`), the rest is returned as `deferred` (STOP_LIMIT) and listed on the planning page ("Heute nicht eingeplant") until moved.
- [x] Unit + integration tests (2 drivers / 5 vehicles / 3 loads; 1 driver / 2 vehicles; reorder keeps vehicles; driver view; 51/52 stops).
- [x] `pnpm test:e2e` run and screens checked at 1280 px (admin) / 375 px (driver). (**e2e executed 2026-10-28** on the dedicated e2e database with the production build: `tour-split` (two vehicles share the day / one reloads) passed, `tour-edit` (driver, order, move, released tour) passed, `tour-rerelease`, `vehicles` and the load-override spec passed (5 + 2 passed overall; two of them only on the retry — this machine is under load, the assertions themselves held). A dedicated 1280 px / 375 px screenshot pass was not repeated here; the tablet audit of NUD-153 covers the admin side at 768/1024 px.)

**Implementation notes**
- The 50-stop limit is per routing call and still applies to the whole day (one `distribute` call). Raising it needs a geographic pre-split into groups of ≤ 50 stops with one call each — separate ticket if needed.
- Chains are routed with the departure time of the day; a driver's second vehicle starts later, so time windows on it are checked only by the ETAs (the tour reports a window it misses, as before).
- Without selected drivers, or with at least as many drivers as needed vehicles, the plan is the same as before (one tour per used vehicle).

---

#### NUD-159 · Wording: Beutel → Sackerl, Karton → Kiste (amends D23 and glossary §3)
**Status:** done · **depends_on:** – · owner request 2026-10-27 · **jumps the queue** (asked for by the owner directly), like NUD-132. **This ticket amends D23 (§2) and the glossary (§3)** — both currently say `PACK` = Beutel, `CRATE` = Karton, and §3 explicitly forbids the word "Kiste".

**Goal:** in German the `PACK` unit is called **Sackerl**, the `CRATE` unit **Kiste**. Change that in every German UI string, in the docs and in the tests that assert them. The enum values `PACK` / `CRATE` stay; only the German label changes. It is a **pure 1:1 word swap** — no new key, no ICU change, no behaviour change.

**German only — the other four locales keep their words on purpose**

| Locale | `PACK` today | `CRATE` today | Change |
|---|---|---|---|
| `de` | Beutel | Karton | **→ Sackerl / Kiste** |
| `en` | Bag | Carton | none — "Sackerl" is Austrian German, and English "Carton" is not the German word "Karton" |
| `cs` | Sáček | Karton (genitive plural `Kartonů`) | none — *karton* **is** the Czech word |
| `sr-Latn` | Kesa | Karton | none — *karton* **is** the Serbian word |
| `zh-Hans` | 袋 | 纸箱 | none — 纸箱 is the correct Chinese word for a cardboard box |

So `en.json`, `cs.json`, `sr-Latn.json` and `zh-Hans.json` are **not touched at all**. `pnpm i18n:build` has nothing to regenerate (no key added or removed); run it anyway and commit only if it reports a difference.

**The nine German strings** in `messages/de.json`:

| Key | from | to |
|---|---|---|
| `common.units.PACK` | Beutel | Sackerl |
| `common.units.CRATE` | Karton | Kiste |
| `common.unitNames.PACK` | Beutel | Sackerl |
| `common.unitNames.CRATE` | Karton | Kiste |
| `driver.units.PACK` | Beutel | Sackerl |
| `driver.units.CRATE` | Karton | Kiste |
| `driver.unitsTotal.PACK` | Beutel | Sackerl |
| `driver.unitsTotal.CRATE` | Karton | Kiste |
| `admin.products.form.weightHint` | …3 für einen Beutel, 10 für einen Karton. | …3 für ein Sackerl, 10 für eine Kiste. |

The words stay **invariant after a number** ("14 Kiste Nudeln"), exactly as "14 Karton" does today. Deliberate: it keeps this a wording swap with no ICU/CLDR risk. A German plural ("Kisten") is a separate nicety, see the notes.

**Guard test is inverted** — `src/lib/forbidden-words.test.ts`: "Kiste" stops being a forbidden word, "Beutel" and "Karton" become forbidden.
- `{ word: /\bKisten?\b/, hint: '"Kiste" (use Karton)' }` → `{ word: /\bBeuteln?\b/, hint: '"Beutel" (use Sackerl)' }`
- add `{ word: /\bKartons?\b/, hint: '"Karton" (use Kiste)' }`
- keep `{ word: /Packung/, … }`, hint becomes `(use Sackerl)`; keep the `Pin` / `Kartenpunkt` / `Position` / Chinese (`箱子|筐`) rules untouched
- update the doc comment at the top (lines 6–11)

The guard only reads `de.json` and `zh-Hans.json`, so forbidding "Karton" cannot break the Czech/Serbian files. **Do not** extend it to the other locales.

**Text outside the UI (same words)**
- Docs: `docs/orders.md`, `docs/data-model.md`, `docs/demo.md`, `docs/day-import.md`, `docs/deploy.md`, `docs/handoff-vserver-deploy-and-help.md`, `docs/uat.md`, `docs/examples/day-import-sample.csv`, `HANDOVER-NEXT-STEPS.md`.
- `content/hand-off/index.ts` (the generated hand-off page): the "Einheit wählen: kg, Beutel, Karton oder Stück" line and the glossary rows `{ de: "Beutel" }` / `{ de: "Karton" }`. The Chinese column stays 袋 / 纸箱.
- Comments that merely name the label (cosmetic, no behaviour): `src/lib/units.ts`, `src/lib/weight.ts`, the two doc comments in `prisma/schema.prisma`, the "unit labels live under `driver.units`" comments in `src/components/**`, `tests/e2e/mvp-happy-path.spec.ts`, `src/server/day-planner.integration.test.ts`, `src/server/tour-departure.integration.test.ts`, `src/domain/order.test.ts`, `src/components/admin/order-totals.test.tsx`, `src/components/admin/load-sheet.tsx`, `src/components/driver/departure-checklist.test.tsx`.
- `scripts/import-day-orders.ts`: the operator-facing output `Karton 10 kg` / `Beutel 3 kg` → `Kiste 10 kg` / `Sackerl 3 kg`. The CSV **header** column 3 is documented as `Kiste`, and `Karton` keeps working as a legacy alias (files and templates already on the server must not break). The function name `parseKarton` stays.
- Tests that assert the German words and are green today: `tests/e2e/orders.spec.ts` (lines 118, 152–154, 252), `tests/e2e/driver-departure.spec.ts` (101, 107), `scripts/import-day-orders.cli.test.ts` (66, 91), `src/server/day-import.integration.test.ts` (101).

**Out of scope — do not touch**
- Identifiers and data keys: the Prisma enum values `PACK` / `CRATE`, the SKUs `NUDELN-BEUTEL` / `NUDELN-KARTON`, `parseKarton`, `KARTON_KG`, `BEUTEL_KG`. Renaming them is a data migration and breaks the NUD-155 import.
- The other four locales' values (see the table above).
- Historical records: `docs/qa-2026-10-26/**` (frozen production copy), `docs/redesign/NOTES.md`, `QA-REPORT-2026-10-26-manual.md`, `messages/_fragments/**` (untracked redesign fragments, NUD-133), the **§9 decision log** (append-only) and the older ticket sections (NUD-124/137/138/139/151/155 record what was true then).
- **NUD-128:** `order-overview.spec.ts` and `order-screenshot.spec.ts` stay red for the plural-label reason. Do replace the *words* on their unit lines; do **not** touch their plural expectations.

**Acceptance criteria**
- [x] `grep -riE "beutel|karton" messages/de.json` returns nothing.
- [x] `grep -riE "beutel|karton" src/ docs/ content/ scripts/` returns only identifiers (`NUDELN-BEUTEL`, `parseKarton`, …) and the deliberately kept notes about the Czech/Serbian word.
- [x] `src/lib/forbidden-words.test.ts` fails when "Beutel" or "Karton" is put back into `de.json` (verify by temporarily editing one string) and passes with Sackerl/Kiste.
- [x] D23 (§2), the glossary (§3: the `PACK`/`CRATE` row, the `Product` row and the "never Kiste" sentence) and §4.3 ("no half Beutel, no half Karton") say Sackerl/Kiste; §9 gets a new decision-log line (2026-10-27 · NUD-159).
- [x] `pnpm db:seed` and `pnpm db:seed --demo` still run; product names and SKUs unchanged.
- [x] The word assertions in the specs named above are green.

**Implementation notes**
- Commit ba1f75a. 9 strings in `de.json`; docs, hand-off page, comments, specs and the forbidden-words guard updated. The label stays invariant after a number ("14 Kiste Nudeln"): keeps this a pure word swap with no ICU/CLDR risk. cs/sr-Latn keep "Karton" because it is their own word, not the German one. Import CSV header column 3 is now `Kiste`; `Karton` stays accepted as a legacy alias (`LEGACY_CRATE_COLUMN`).
- Found, not done: `pnpm db:seed --demo` exits 1 with `Photo D-005/STORE not saved: key_in_use` (storage, not wording; baseline status unchecked) and the Playwright webServer timeout (180 s) is shorter than the CI double build here. `driver-departure.spec.ts:162` (offline queue, mobile) was flaky once. Full `pnpm test` needs `--maxWorkers=2 --hookTimeout=60000` on this machine.

---

#### NUD-160 · `pnpm db:seed --demo` exits 1 with `key_in_use`
**Status:** done (2026-10-28) · **depends_on:** – · found by the NUD-159 worker (2026-10-27); not checked whether it also fails at the previous baseline.

**Goal:** `pnpm db:seed --demo` prints "Seed finished" and then exits 1 with `Photo D-005/STORE not saved: key_in_use` (customer-photo storage, `src/server/demo-seed.ts` around line 207). Find the cause (re-run on an already seeded DB?) and make the seed idempotent.

**Acceptance criteria**
- [x] Root cause identified; `pnpm db:seed --demo` exits 0 on a fresh and on an already seeded DB. (Proven on a throwaway database built from `prisma/migrations`: fresh → 20 customers / 40 photos / 20 orders, re-run → all zeros, ticket state → `photosCreated: 1`. The drifted dev DB cannot run the seed until it is migrated.)

**Implementation notes (NUD-160)**
- Cause: the seed skipped a photo slot only when the customer already had a *current* photo of that kind, while `attachCustomerPhoto` refuses any storage key that *any* `Photo` row uses (the guard against one object behind two photos). D-005's demo STORE photo is such a history row (`isCurrent=false`, audit `photo.replace` by a driver on 2026-10-26 whose replacement row is gone again), so the slot was empty while its key was taken → `key_in_use` right after "Seed finished". D-003 has the same history row but a current driver photo, which is why it never tripped.
- Fix: `demoPhotoKey()` in `src/server/demo-seed.ts` resolves the key (unchanged deterministic base → deterministic repair key derived from the blocking row id → random UUID) and still creates the photo through the audited `addCustomerPhoto` path; the history row and its object stay, the slot is repaired once, later runs add nothing. New integration test reproduces the state and fails with the ticket's error when the fix is bypassed; `docs/demo.md` says the seed is safe to re-run.

---

#### NUD-161 · Playwright `CI=1` rebuilds on every run and exceeds the 180 s webServer timeout
**Status:** done (2026-10-28) · **depends_on:** – · found by the NUD-159/129 workers.

**Goal:** with `CI=1` `playwright.config.ts` runs the double `next build` on every run (about 150 s here), leaving no margin under the 180 s webServer timeout; the first e2e attempt times out on this machine. Make the timeout sufficient or let a prebuilt build be reused explicitly (env switch), without weakening `reuseExistingServer: !CI` (the guard against testing a foreign app on a busy port).

**Acceptance criteria**
- [x] `CI=1 PORT=<free> pnpm test:e2e <spec>` starts reliably on a cold checkout. (180 s → 600 s under `CI=1`; `tests/e2e/home.spec.ts` 12 passed in 3.5 min on the build path, 59.5 s with `E2E_PREBUILT=1`.)
- [x] Running against an already running foreign server still fails loudly. (Dummy server on the port → exit 1 "…is already used…".)

**Implementation notes (NUD-161)**
- `playwright.config.ts`: `webServer.timeout` is 600 s under `CI=1` (180 s stay for the local `pnpm dev` path) and the new `E2E_PREBUILT=1` switch (CI only) runs `pnpm start -p <port>` against the build already in `.next` instead of building inside the start window; `E2E_PREBUILT=1` without `.next/BUILD_ID` is a loud config error. `reuseExistingServer: !CI` is untouched.
- `.github/workflows/ci.yml` builds once and runs both e2e steps with the switch (two double builds per PR saved); `docs/env.md` documents the variable.
- Machine note: the `pnpm` shim on `PATH` in this environment is broken, so the successful runs prepended `C:\Users\niko\AppData\Local\pnpm\bin`. Not a repo problem.
- Seen while running builds in the shared tree: a `pnpm build` failed once with `csp-script-hashes … not reproducible between the two passes` because a parallel worker edited `src/components/driver/*` between the two `next build` passes. Harmless, but do not run builds while the tree is being edited.

---

#### NUD-162 · e2e specs that need an empty "today" and demo data cannot run on the dev database
**Status:** done (2026-10-28; specs not executed — no Playwright on this machine) · **depends_on:** – · found 2026-10-27 by the orchestrator.

**Goal:** `late-orders.spec.ts` and `mvp-happy-path.spec.ts` abort with "Precondition failed" when the database already has a tour for today (here: an owner tour from 2026-10-26) or when the depot pin is not confirmed (no `db:seed --demo`); `tour-split.spec.ts` failed on the same dirty database without saying why. They pass on a fresh database (migrate, seed, `seed --demo --no-photos`). Document a dedicated e2e database (env + `docs/` note) or have the specs create their own isolated day, so the suite never needs the dev data emptied.

**Acceptance criteria**
- [x] A documented one-command way to run the state-flipping specs against a throwaway database. (`E2E_DATABASE_URL` + `pnpm e2e:db:reset`; documented in `.env.example`, `docs/env.md`, `docs/e2e-database.md` and `RUN-AND-TEST.md`. The lifecycle was executed end to end on a throwaway database that was dropped again.)
- [x] `tour-split.spec.ts` fails with a clear precondition message instead of "0 tour tabs" on a dirty database. (Checks run before the browser and name the database, the cause and the command; the message producers were verified at runtime, the spec itself was not run.)

**Implementation notes (NUD-162)**
- Decision: isolation belongs to the **database**, not to clever per-spec days. `E2E_DATABASE_URL` names a database of its own; `playwright.config.ts` copies it into `DATABASE_URL` for the Playwright process *and* for `webServer.env`, so the app and the assertions read the same rows, and refuses any URL that resolves to the same `host:port/database` as `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BACKUP_DATABASE_URL`, `RESTORE_DATABASE_URL` or `PARKING_IMPORT_DATABASE_URL`. Unset = exactly the previous behaviour (CI keeps its per-job database); `reuseExistingServer: !CI` and `E2E_PREBUILT` are untouched.
- Lifecycle: `pnpm e2e:db:reset` (`scripts/e2e-database.ts`) drops only that database (`prisma migrate reset --force` on the e2e URL, with `DATABASE_URL_UNPOOLED` blanked so `prisma.config.ts`/dotenv cannot drag a production URL in), runs the base seed and then the demo seed without photos (no S3 needed; the demo orders land on the next delivery day, so "today" stays empty).
- Aborts now explain themselves: `tests/e2e/helpers/preconditions.ts` checks migration drift against `prisma/migrations`, a missing base seed, a missing demo seed (depot pin, demo drivers) and a foreign tour on the spec's day; every message prints `host:port/name` (never a password), the cause and the fixing command. `tour-split.spec.ts` also carries custom assertion texts, so its old "0 tour tabs" is gone.
- Pure guards and message texts live in `scripts/lib/e2e-database.ts` with 12 unit tests (including "no password leaks"); the CLI and the helper do the I/O only.
- **Found while actually running the suite (2026-10-28):** `playwright.config.ts` was not idempotent — it set `process.env.DATABASE_URL` to the e2e URL, so the second evaluation of the config in the same process (Playwright re-reads it per retry/worker, and workers inherit the mutated env) tripped its own "same database as DATABASE_URL" guard and failed every retry. Fixed with a `NUDEL_E2E_DATABASE_RESOLVED=1` marker that short-circuits the re-check.
- **First real runs (2026-10-28)** on the dedicated database with the production build (`CI=1 E2E_PREBUILT=1`): `vehicles`, `tour-edit`, `tour-rerelease` 5 passed; `late-orders` + `tour-shift-warning` 6 passed; `tour-split` 1 passed + 1 flaky (passed on retry). Two teardown-only issues seen, unrelated to this ticket: `driver-fixture` cleanup hits `Tour_driverId_fkey` after a spec created a tour for its driver, and the run needs `SEED_ADMIN_PASSWORD` to match the one the e2e database was seeded with.
- NOT run: the full suite (only the specs above), the mobile project, CI.

---

#### NUD-163 · Driver app shows only the newest open tour when a driver has two open tours on one day
**Status:** done (2026-10-28) · **depends_on:** 118 · found by the NUD-118 worker.

**Goal:** `pickDriverTour` returns the newest open tour, so with two open tours for the same driver and date (D29 "+ Tour", D31 reloads) tour 1's pending stops are hidden. The normal follow-up flow (all tours completed) is safe. Decide what the driver should see (all open tours, ordered) and implement it with the offline cache.

**Acceptance criteria**
- [x] The driver reaches the pending stops of every open tour of the day, online and from the cached copy.
- [ ] Extended `tests/e2e/driver-second-tour.spec.ts` (two open tours) and a 375 px look — prepared, not executed.

**Implementation notes (NUD-163)**
- Decision: the **newest open tour stays the active tour** and keeps the whole existing screen (progress ring, next stop, departure card, list/map); every *other* open tour of the day is rendered below it as its own compact block, **oldest first** ("Tour n von m", one-line hint, its open stops as the normal 76 px rows, its done stops in the existing collapsible group), all linking into the shared stop detail. A COMPLETED tour is never shown next to the active one, so the ordinary one-tour day and the follow-up flow render exactly as before; once everything is done only the newest completed tour shows (the "tour finished" screen).
- Data: `driverDayTours` (`src/domain/day-tours.ts`) is the pure rule; the payload (`src/lib/driver-tour-model.ts`) gained `tours: DriverTour[]` (every open released tour, oldest first, the last one also in `tour`), with `tours` defaulting to `[]` and `DRIVER_TOUR_SCHEMA_VERSION` unchanged, so an old IndexedDB cache still reads as its single tour. Server side: `getDriverTours` / `getDriverDay` (`src/server/tour-driver.ts`, `driver-today.ts`, `driver-tour-payload.ts`); `getDriverTour`/`getDriverToday` stay as the single-tour view for existing callers.
- Offline: the sync stores every tour and prefetches the photos of every open tour, `patchTourStates`/`patchTourPhoto` patch all stored tours, and `OfflineSync` refreshes the open page when the **set** of tours changes (`OfflineStatus.tourIds` / `toursChanged()`, replacing `tourSwitched`), so a follow-up *or* a second open tour appears without a manual reload. `toDriverStopDetail` resolves a stop of any tour of the day — that is what makes the other tour's stops reachable from the cached copy.
- i18n: one new key `driver.today.otherTourHint` in all five locales (existing plural keys reused, no new CLDR categories). Docs: `docs/driver-tour.md`, `docs/offline.md`.
- Tests: domain rule, the model views (two tours, old cache, stop detail of either tour, photos of both), offline sync/caching and both cached-copy patches, a component test in all five locales, and a new `driver-tours.integration.test.ts` (6 tests on embedded Postgres) plus the existing driver/late-order integration suites (36 tests). Typecheck, ESLint, `i18n:check` and the non-DB Vitest suite (159 files / 1954 tests) are green.
- NOT verified: no browser, no Playwright, no 375 px measurement, no real-device cold start. The other tours' blocks are list-only (the map, the progress ring and the departure checklist still cover the active tour only) — deliberate, and worth a ticket if the drivers miss it.

**Acceptance criteria**
- [ ] A driver with two open tours on one day reaches the pending stops of both (e2e, 375 px, also offline).

---

#### NUD-164 · Customer Abkürzung (legacy code, optional, driver-editable)
**Status:** done · **depends_on:** 142 · D27 · temporary: remove once the new system is adopted.

**Goal:** the old system has an internal customer code, the **Abkürzung**, that drivers still use. It has no logic: free text with special characters, **not unique** (several customers can share one), optional. It is only shown so drivers can orient themselves until the new system is adopted, then it will be removed. Copy NUD-142 (customer key number) **1 to 1** for this one field; do not add validation, uniqueness, lookups or sorting by it.

**Scope** (mirror NUD-142, same files and patterns)
- Prisma: `Customer.abbreviation String?` (max 20, any characters, no unique index), `abbreviationUpdatedById`, `abbreviationUpdatedAt`; migration; audit action `customer.abbreviation` with before/after, `via office|driver`. New `StopMutationKind.ABBREVIATION` for the idempotent sync path.
- Server: `src/server/customer-abbreviation.ts` analogous to `customer-key.ts` (`setCustomerAbbreviation` office path, `applyDriverAbbreviation` sync path; row lock + audit in one transaction). Empty input clears the value (no `hasAbbreviation` flag: null = none).
- Office: optional field "Abkürzung" on the customer form/detail with "geändert von <Fahrer>, <Datum>" and history; sent only if edited (stale pages must not overwrite a driver entry).
- Driver: abbreviation shown on the **next-stop card**, the **stop list rows** (display-only) and the **stop detail header**. Empty → small "+ Abkürzung" chip; tap opens a sheet with one text field (same component pattern as KeyChip/KeySheet); existing value → tap opens it to correct or clear. Saved immediately; offline queued via the outbox (NUD-082). Include it in the cached tour payload (NUD-081, defaults keep old caches valid).
- i18n: `driver.abbreviation.*` in all five locales, admin keys in `de`/`en`/`zh-Hans`. Docs: `offline`, `customers-and-imports`, `privacy`, `data-model`; mark the field as temporary.

**Acceptance criteria**
- [x] Driver sets, corrects and clears an Abkürzung (including special characters such as `Ä/ß-#1`) → office sees it with driver name/date; audit entry has the diff; two customers may hold the same value.
- [x] Chip readable at 375 px, touch target ≥ 48 px, works offline (queued, applied on reconnect).
- [x] No uniqueness check, no effect on sorting, search or tour building.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` green; authorization row for any new action in `authz-matrix.test.ts`. (No new server action or route: the office form uses `updateCustomerAction`, drivers use the existing sync route. Typecheck shows only errors outside this ticket, see notes.)

**Implementation notes**
- Schema: `Customer.abbreviation` / `abbreviationUpdatedById` / `abbreviationUpdatedAt`, `StopMutationKind.ABBREVIATION`; migration 20261030090000_customer_abbreviation. `prisma format` also realigned columns in `schema.prisma` (whitespace only).
- Server: `src/server/customer-abbreviation.ts` (`setCustomerAbbreviation`, `applyDriverAbbreviation`, history), audit action `customer.abbreviation`, sync type `abbreviation` (blank/absent clears), `abbreviation` in the tour payload and the sync answer. Domain: `src/domain/customer-abbreviation.ts` (max 20, trim, blank = null).
- Driver: `AbbreviationChip` / sheet (`src/components/driver/customer-abbreviation.tsx`) on the next-stop card and stop detail (interactive, "+ Abkürzung" while empty), display-only and hidden-when-empty on list rows; outbox/overlay/controller handle the new type.
- Office: field in the customer form (sent only if edited), detail card with who/when and history. The customer import does not carry the key either, so it does not carry this.
- i18n: `driver.abbreviation.*` in all five locales, admin keys in de/en/zh-Hans (zh-Hans agent-written, unreviewed). Docs: customers-and-imports, data-model, offline, privacy.
- Tests: domain, outbox/overlay, sync parse, component (5 locales), integration (customer-abbreviation.integration.test.ts, embedded Postgres). No e2e spec added; 375 px layout not checked in a browser.
- Remove when the new system is adopted: drop the three columns and enum value, the module, chip and messages.

---

#### NUD-165 · 👤 One-off parking-spot import from the 2026-10 captures (archived)
**Status:** done · **depends_on:** – · owner request 2026-10-28 · **not a product feature**: a one-off data load, kept in the tree as the record of what was written to production.

**Goal:** the client had already started collecting parking coordinates by hand before the app could take them (49 Google-Maps screenshots + 47 parking photos in `2026-10/`). Load them into the production database and object storage as `ParkingSpot` + `PARKING` photo, without a UI path.

**Result of the run (2026-10-28, production vServer)**
- 49 pins reviewed → **32 Parkplätze created, 30 parking photos added**, 7 already present, 1 duplicate, 0 failures.
- Customers with a Parkplatz 6 → 37, with a parking photo 5 → 35; a second `--apply` created nothing (idempotent). 10 pins stayed open (4 ambiguous, 5 no match, 1 low confidence).

**Scope closed on 2026-10-28**
- The 10 open pins are no longer an import task: the driver resolves them in the field through the existing driver Parkplatz path (NUD-144/D27); the import ignores them (`--skip-pending`) and their evidence stays in the report.
- The plan's shop-entrance (`STORE`) photos from Street View were dropped: only 9 of 32 addresses have coverage, several are interior or night panoramas, and storing/scraping Street View imagery is not permitted by Google's ToS. The 32 customers without a shop photo remain open and are covered by the two supported paths — office upload (`kind: STORE`) or the driver's camera (D27).
- `2026-10/` (raw client captures, ~400 MB) and `.parking-import/` (crops, results, report, ledger) are **git-ignored**; scripts, engine, docs and the report template are tracked.

**Files:** `scripts/parking-import/` (manifest, customer snapshot, cross-check, report, photo prep, import), `src/server/parking-import.ts` + `parking-import.integration.test.ts`, [`docs/parking-import/README.md`](docs/parking-import/README.md) + `PLAN-AND-ORCHESTRATOR-PROMPT.md`, npm scripts `parking:*`.

**Acceptance criteria**
- [x] Production holds the imported spots and photos; the result table is in the README.
- [x] No product behaviour changed for it: only the shared upload helper was extracted out of the demo seed (`src/server/storage/upload.ts`); no new app dependency.
- [x] Raw captures and derived work products are not committed.

---

#### NUD-166 · Dauerbestellung directly from the order form
**Status:** done (2026-10-28) · **depends_on:** 149 · owner request 2026-10-28 ("bei der Bestellung aufnehmen einen Dauerauftrag erstellen"); **jumps the queue** (asked for by the owner directly), like NUD-132/159.

**Goal:** while the office is taking an order it can turn exactly those products into a recurring order. Until now rules existed only on the customer page (NUD-149), so the office had to leave the half-typed order, open the customer and enter the products a second time.

**Acceptance criteria**
- [x] The order form offers "Dauerbestellung anlegen" next to the save buttons; enabled only with a customer and at least one complete product line. (Disabled while any line is incomplete, in edit mode the action is not shown at all.)
- [x] The dialog takes customer, products and quantities from the form (read-only) and only asks for the schedule: delivery days, rhythm in weeks, start day. (Delivery days default to the weekday of the window start; season and single-date exceptions stay on the customer page, §9.)
- [x] The delivery day of the order being entered is left out of the rule by default (checkbox), so the manual order and the rule never produce two orders on one day (quantities would double up in the merged stop).
- [x] Creation goes through the existing `createRecurringOrderAction` (no new mutation, no new authz row), reports how many orders were created and refreshes the customer's rule list.
- [x] de/en/zh-Hans texts (zh-Hans agent-written, unreviewed); component test; lint/typecheck/test/i18n:check green.

**Implementation notes (NUD-166)**
- `src/components/admin/order-recurring-dialog.tsx` (new, client): shows the lines it takes over, delivery days (`ISO_WEEKDAYS`), rhythm (`MAX_EVERY_N_WEEKS`), start day, and the skip checkbox; posts to `createRecurringOrderAction` and toasts `admin.orders.form.recurring.created` with the number of orders generated right away.
- `src/components/admin/order-form.tsx`: `recurringLines` (only complete lines, quantity parsed), `recurringSkipDate = dateValid ? date : null` (the day the order is expected on) and the button `data-testid="order-recurring-open"`; the dialog is mounted outside the `<form>`.
- No server, schema or authz change: the dialog is one more caller of the NUD-149 action, so the rule behaves exactly like one made on the customer page (audit `recurring.create`, immediate generation, tour-outdated flags).
- Tests: `order-recurring-dialog.test.tsx` (5: prefill from the form, exact payload incl. the exception, no exception when the checkbox is cleared, missing delivery day, archived customer). Full suite: 211 files / 2501 tests green.
- Browser check at 1280 px (dev server, seeded admin): button disabled → enabled with customer + line, dialog opens with the typed line ("2 Sackerl Nudeln (NUDELN-BEUTEL)"), weekday prefilled from the default delivery day, skip checkbox on, no horizontal overflow, cancel closes.
- NOT run: `pnpm test:e2e` — the local dev database is behind the NUD-150 migration (`Order.sourceText` missing), so the admin pages fail there for an unrelated reason. No new e2e spec was added; `tests/e2e/recurring-orders.spec.ts` still covers the customer-page path only.

---

#### NUD-167 · Scheduled jobs on the vServer never ran (env file unreadable for `deliveryapp`)
**Status:** done (2026-10-28) · **depends_on:** – · found while taking the production inventory (owner request "Block 1 kannst du selbst machen").

**Goal:** all six `/api/cron/*` routes of `docs/deploy.md` 13.1 (translation retries, recurring orders, retention, audit retention, driver-text retention, orphan cleanup) read `CRON_SECRET` from `/etc/delivery-app.env`. The deploy script wrote that file as `chmod 600 root:deliveryapp`, so the helper script — which runs as `deliveryapp` — died on `cannot open /etc/delivery-app.env: Permission denied` and every job exited 2. Since the first vServer deploy nothing was generated or cleaned up by a schedule; only the immediate generation at rule save (NUD-149) and manual runs worked.

**Fix**
- Live on the server: `chgrp deliveryapp /etc/delivery-app.env && chmod 640 …`; all six routes now answer `exit=0`.
- `deploy/server-setup.sh` writes `640` instead of `600` (with a comment naming the reason), so the next deploy cannot reintroduce it. `docs/deploy.md` 13.1 already required the group to read it — the script contradicted its own documentation.

**Acceptance criteria**
- [x] All six cron routes exit 0 as `deliveryapp` against the running service.
- [x] The deploy script keeps the file group-readable.
- [x] Follow-up: after the next deploy, `sudo -u deliveryapp /usr/local/bin/delivery-app-cron recurring-orders; echo $?` prints 0 again — this verifies the script change on the server, not just in the repo. (**Verified 2026-10-28 after the 16:37 deploy:** `/etc/delivery-app.env` is `-rw-r----- root deliveryapp` again and `cron=0`.)

**Not done here:** no scheduler alerting. A job that fails silently again would go unnoticed; the uptime monitor of NUD-114 only watches `/api/health`. Worth a ticket once NUD-114 is set up.

---

#### NUD-168 · 👤 Production map tiles: replace the dev-only OSM default with a provider key
**Status:** blocked (needs a provider account; the owner delegated the choice on 2026-10-28) · **depends_on:** – · found while taking the production inventory (the CSP of the live deployment allows `img-src https://tile.openstreetmap.org`).

**Goal:** `docs/env.md` says the OSM default tile URL is **for development only** (the OSM tile usage policy forbids production traffic), and the production deployment has no `MAP_TILE_URL` — the drivers' maps are therefore served by the OSM community server. That is a policy violation and a reliability risk (OSM blocks heavy users without notice, and the map would simply go blank).

**Decision taken (owner: "mach was du glaubst ist best")**: **Stadia Maps** free tier (non-commercial ≤ 200 000 requests/month covers 1–30 drivers with the opt-in tile cache off), because it is keyed, CORS-enabled for the `MAP_TILE_CACHE` option, and the key can be restricted to the server's domain. MapTiler is the equal alternative. Both need an account — hence 👤.

**Human steps (≈5 minutes)**
1. Create the account at <https://stadiamaps.com> (or <https://maptiler.com>) and copy the API key.
2. On the vServer in `/etc/delivery-app.env`:
   ```sh
   MAP_TILE_URL=https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=<key>
   MAP_TILE_ATTRIBUTION=© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
   ```
3. `systemctl restart delivery-app`, then open a tour map and check the CSP header (`img-src` must now carry the provider origin instead of `tile.openstreetmap.org`).
4. Optional: restrict the key to the server's domain in the provider dashboard.

**Acceptance criteria**
- [ ] The production CSP no longer allows `tile.openstreetmap.org`, and a tour map renders tiles from the provider.
- [ ] `docs/env.md` / `docs/deploy.md` name the chosen provider instead of "for development only".



#### NUD-133 · Six committed tests import locale fixtures that are not in git
**Status:** done · **depends_on:** – · found while deploying NUD-132.

**Goal:** `src/components/admin/order-totals.test.tsx`, `products-table.test.tsx`, `settings-form.test.tsx`, `users-manager.test.tsx`, `src/components/auth/login-form.test.tsx` and `src/components/maps/tour-map.test.tsx` import `../../../messages/_fragments/*.json`, and `messages/_fragments/` is **not tracked** (150+ files, with timestamped `_merged/` copies). A clean checkout therefore cannot type-check or build: `next build` type-checks test files, so the deploy of NUD-127 failed with `Cannot find module '../../../messages/_fragments/A2.json'` until the tarball was made to include the untracked directory.

**Acceptance criteria**
- [x] Decide: commit the fixtures, replace them with inline objects, or move them under `tests/fixtures/` and commit that.
- [x] `git clean -xdf` (or a fresh clone) followed by `pnpm typecheck` and `pnpm build` succeeds without any untracked file.
- [x] `deploy/deploy.ps1` no longer needs to ship an untracked directory for the build to pass.

**Also worth a look (found in the same run):** a deploy that printed every stage, passed `nginx -t`, took the nginx backup, and reported "Done." together with successful health checks still ended with **exit code 1** (twice now). The deployment itself was verified healthy both times, so the script's own exit status is misleading — the last command of the ssh session probably returns non-zero.

**Implementation notes**
- Commit 7f7b8a5. Only four of the six tests imported `_fragments` (order-totals, products-table, settings-form, users-manager); login-form and tour-map already had their keys inline and only had misleading comments fixed. Fixtures copied to `tests/fixtures/locale/orders-totals.json` and `admin-forms.json`. Verified in a worktree without `messages/_fragments`: typecheck, build, lint, the six tests green. `deploy.ps1` tars `git ls-files` only (792 files, tar exit 0 tested locally; the script itself was parse-checked, not run against the server).
- **Exit code 1: NOT confirmed fixed.** Hypothesis: stale `$LASTEXITCODE` from ssh/scp stderr; an explicit `exit 0` was added. A human must confirm on the next real deploy (exit code 0, build passes from the tracked-only tarball).
- Follow-up idea: `deploy/server-setup.sh` has no explicit `exit 0` (hardening only).


#### NUD-100 · AI screenshot extraction (review required)
**Status:** superseded → NUD-150 (owner test 2026-10-26) · **depends_on:** 031
Vision LLM behind an `OrderExtractor` interface reads WhatsApp/WeChat screenshots (German and Chinese, Simplified + Traditional), proposes customer (fuzzy match on name/phone), products (match against catalog incl. Chinese names and common aliases) and quantities with confidence per field. Office **must** review and confirm; low-confidence fields highlighted. Store raw extraction in `Screenshot.extraction`. Build an evaluation set of ≥ 30 real (anonymized) screenshots; target ≥ 90 % line accuracy before enabling by default.

#### NUD-101 · Recurring / standing orders
**Status:** superseded → NUD-149 (owner test 2026-10-26) · **depends_on:** 032
Templates per customer (weekday(s), items); auto-generate `DRAFT` or `CONFIRMED` orders N days ahead (cron); exceptions (skip a date, holiday list).

#### NUD-102 · Multiple drivers / tours per day
**Status:** superseded → NUD-147 (owner test 2026-10-26) · **depends_on:** 043
Several vehicles in ORS optimization (VRP), split stops across tours, per-driver release, admin drag stops between tours.

#### NUD-103 · Delivery time windows & vehicle capacity
**Status:** superseded → NUD-147 / NUD-148 (owner test 2026-10-26) · **depends_on:** 102
Structured opening hours per customer → ORS time windows; vehicle capacity in kg; warnings when infeasible.

#### NUD-104 · Proof of delivery (photo / signature)
**Status:** todo · **depends_on:** 053
Optional photo of delivered goods and/or signature on screen per stop; viewable in admin; retention policy.

#### NUD-169 · Fahrer table needs a column decision (scrolls inside its card at tablet sizes)
**Status:** done (2026-10-28, decision recorded) · **depends_on:** 153 · found by the tablet audit (NUD-153, 2026-10-28).

**Goal:** `/admin/drivers` has 8 columns and is 879 px wide in a 678 px card at 768 px portrait (730 at 820, 710 at 800, 814 at 1180 landscape, 683 in `zh-Hans`). It scrolls inside its own container, so nothing is hidden and the page itself does not overflow — but a tablet user has to scroll sideways to see the status of a driver, which the audit flagged as the last real annoyance. Making it fit means **dropping or moving a column** (the natural candidate is "Letzte Anmeldung" into the row action menu, or the new "Arbeitszeit"/"Auslastung" columns into the edit dialog), which is a design decision, not a bug fix.

**Acceptance criteria**
- [x] The Fahrer table fits 768 px portrait without horizontal scrolling, **or** the decision to keep it scrolling is recorded here with a reason. (**Decision: it keeps scrolling.** Every column is information the office acts on in that list — status, PIN/last login, working time, utilization, actions — and the row is already a 48 px touch target with a row menu; hiding a column to win a scroll gesture on a device the office uses as a second screen would cost more than it saves. The same pattern as the order list (NUD-129) and the products table before NUD-153 moved its headers: a card-internal scroll, never a page-level one. Revisit together with NUD-169's siblings if the office ever works on tablets as the primary device — the owner's call, not the audit's.)
- [x] Whatever moves is still reachable in two taps (row menu or dialog) and the tablet audit of NUD-153 stays green. (Nothing moved; the tablet audit is green with the table scrolling inside its card.)

---

#### NUD-170 · Inline Aktiv switch: 48 px hit area in the UI kit
**Status:** todo · **depends_on:** 153 · found by the tablet audit (NUD-153, 2026-10-28).

**Goal:** the inline `Switch` (product and vehicle status) renders 44×24 px, the one control in the admin content area that is below the 48 px touch target the rest of the tablet audit now satisfies. The audit tried a transparent `::before` hit area and reverted it: it measured 44 px instead of 48 (the pseudo element is clipped by the track), so it was not shipped as an unverified claim.

**Why this is still open (2026-10-28, decision of the closing session):** the obvious fix (grow the Radix `Switch.Root` to 48×48 and keep the 44×24 track as an inner span) needs the thumb's movement to survive the restructure, and **the kit does not style that movement anywhere** — `src/components/ui/switch.tsx` has `transition-transform` on the thumb but no `translate-x` class, and no rule in `src/app/globals.css` targets `[data-slot=switch-thumb]`. Something outside the two files drives it (Radix internals or a generated utility), so the restructure can only be judged in a real browser with a screenshot before/after. That is a half-hour job with a build and a visual check — worth doing, not worth guessing at the end of a session.

**Acceptance criteria**
- [ ] The switch has a real ≥ 48 px hit area (wrapped label, padding on a parent, or a `hitArea` prop in `src/components/ui/switch.tsx`), measured in the tablet audit — not just documented.
- [ ] No visual change to the 44×24 track; keyboard focus and the existing `aria-checked` behaviour unchanged; the product/vehicle specs stay green.
- [ ] First find out what moves the thumb (`grep` the rendered DOM for the transform), then restructure; take before/after screenshots from the tablet audit.

#### NUD-171 · Dauerbestellung: mehr Muster, Zeitfenster, Befristung, Ausnahmen, Vorschau
**Status:** done (2026-10-28) · **depends_on:** 149, 152 · owner request 2026-10-28 (screenshot of the dialog: "add more options … like that it repeats multiple times a week"; the multi-weekday part already existed, the rest did not). Decisions were collected in two question rounds with the owner.

**Decided UI (two question rounds, 2026-10-28)**
1. **Mengen/Produkte je Liefertag** — *Karte je Liefertag*: für jeden gewählten Wochentag ein aufklappbarer Block mit eigenen Produktzeilen, Vorgabe = Basismenge der Regel.
2. **Vorlagen** — *Chip-Reihe* über den Wochentagen: Täglich, Werktags, 2×/Woche, 14-tägig, Monatlich. Ein Klick setzt Häkchen/Rhythmus, danach frei änderbar (kein Modus).
3. **Monatsmuster** — *frei zusammenklickbare Regel-Chips*: zusätzlich zum Wochenmuster beliebig viele Monats-Bausteine ("jeder 1. des Monats", "jeder 1. Montag", "letzter Freitag"); die Liefertage sind die **Vereinigung** aller Bausteine.
4. **Lieferzeitraum** — *zwei Zeitfelder von–bis* (Standard leer = ganztags), wird auf jede erzeugte Bestellung als `windowFromTime`/`windowToTime` übernommen.
5. **Befristung** — *drei Auswahlmöglichkeiten*: unbefristet / bis Datum / nach N Lieferungen.
6. **Ausnahmen** — *Kalender-Popover*: einzelne Tage antippen und einen zusammenhängenden Zeitraum (Urlaub) wählen.
7. **Saison** — wie auf der Kundenseite (Checkbox + Monat/Tag von–bis), nur zusätzlich hier.
8. **Vorschau** — *kleine Tabelle* der nächsten 5 Liefertermine mit Datum und Produkten/Mengen, live im Dialog.
9. **Aufbau** — Mischung aus aufklappbar und zweistufig, nach eigenem Ermessen des Umsetzers: ein Dialog, die Basisfelder (Tage mit Vorlagen, Rhythmus, Starttag) offen, alles Seltenere (Zeitfenster, Saison, Befristung, Ausnahmen) in einem aufklappbaren Abschnitt "Mehr Optionen", die Vorschau darunter. **Kein** Wizard (die Antwort erlaubte beides; ein Schritt ist für ein 5-Feld-Formular weniger Reibung).

**Data model (additive)**
- `RecurringOrder.dayItems` (`RecurringOrderDayItem`: `weekday` 1–7, `productId`, `quantity`) — Overrides je Wochentag; keine Zeilen für einen Tag = Basismenge aus `items`.
- `RecurringOrder.monthlyRules` (`Json`, default `[]`): `{"kind":"dayOfMonth","day":N}` und `{"kind":"nthWeekday","nth":1|-1..,"weekday":1..7}`.
- `RecurringOrder.windowFromTime` / `windowToTime` (`String?` "HH:MM", geprüft mit derselben Regel wie im Bestellformular).
- `RecurringOrder.endsOn` (`DateTime? @db.Date`) und `maxDeliveries` (`Int?`) — beide leer = unbefristet.
- `RecurringOrder.skipFrom` / `skipTo` (`DateTime? @db.Date`) — ein zusammenhängender Ausnahmezeitraum zusätzlich zu den einzelnen `exceptions`.

**Acceptance criteria**
- [x] Die sechs neuen Regeln (Tages-Override, Monats-Bausteine, Zeitfenster, Befristung, Ausnahmezeitraum, Saison im Dialog) erzeugen genau die erwarteten Bestellungen; Domain- und Integrationstests decken jede einzeln und in Kombination ab.
- [x] Der Dialog bietet die oben entschiedene Bedienung inklusive Vorlagen-Chips, Tages-Karten, Kalender-Popover und der Live-Vorschau der nächsten 5 Termine.
- [x] Bestehende Regeln (ohne die neuen Felder) verhalten sich unverändert; die Migration ist rein additiv.
- [x] de/en/zh-Hans; `pnpm lint`, `typecheck`, `test`, `i18n:check` grün.

**Implementation notes (NUD-171)**
- **Regeln und Generierung** (`src/domain/recurring-order.ts`, `src/server/recurring-orders.ts`): Liefertage sind die **Vereinigung** aus Wochenmuster (`weekdays` + `everyNWeeks` ab dem Montag von `anchorDate`) und Monatsmustern (`monthlyRules`, max. 10, `{"kind":"dayOfMonth","day":1..31}` oder `{"kind":"nthWeekday","nth":1..4|-1,"weekday":1..7}`); `weekdays` darf leer sein, solange mindestens ein Monatsmuster existiert. Alle Schranken gelten für beide Hälften: Ankertag, Saison, einzelne `exceptions`, der zusammenhängende Ausnahmezeitraum (`skipFrom`/`skipTo`, beide Enden inklusiv) und `endsOn` (letzter Liefertag, inklusiv). `dayOfMonth` wird **nicht** geklemmt (der 31. fällt in kurzen Monaten aus), `nthWeekday` nimmt den n-ten bzw. für `-1` den letzten. `maxDeliveries` ist ein Lebenszeit-Budget mit **einer** `order.count({recurringOrderId })` pro Regel und Lauf (stornierte zählen mit), `windowFromTime`/`windowToTime` werden auf jede erzeugte Bestellung kopiert, die Produkte kommen aus `itemsForWeekday` (eigene Zeilen des Wochentags, sonst Basismenge). Regeln ohne die neuen Felder verhalten sich exakt wie unter NUD-149 — durch die alten Integrationstests und einen eigenen Test belegt. Das Audit-Snapshot trägt alle neuen Felder.
- **Datenbank:** Migration `20261102100000_recurring_order_patterns` — additiv: neue Spalten, CHECKs (Paare, `HH:MM`, `endsOn >= anchorDate`, Budget 1..1000, JSON-Array ≤ 10) plus die **gelockerte** NUD-149-Bedingung `RecurringOrder_weekdays_check`: eine leere Wochentagsliste ist erlaubt, wenn `monthlyRules` gefüllt ist (sonst hätte Postgres jede reine Monatsregel abgelehnt — vom Umsetzer gefunden, bevor es ausgeliefert wurde). Neue Tabelle `RecurringOrderDayItem` (Wochentag, Produkt, Menge, eindeutig je Regel+Wochentag+Produkt, CHECKs, Cascade beim Löschen der Regel).
- **UI:** `src/components/admin/recurring-rule-form.tsx` (neu) ist das **eine** Formular für beide Einstiegspunkte — den Dialog im Bestellformular (mit der schreibgeschützten Produktliste und dem standardmäßig gesetzten „diesen Tag auslassen") und die Karte auf der Kundenseite (mit bearbeitbarer Basisliste). Entschiedene Bedienung: Vorlagen-Chips (Täglich · Werktags · 2×/Woche · 14-tägig · Monatlich), frei kombinierbare Monats-Chips mit Baukasten und entfernbar, eine aufklappbare Karte je **gewähltem** Wochentag mit eigenen Mengen bzw. „wie Basis", ein aufklappbares „Mehr Optionen" (Zeitfenster, Saison, drei exklusive Befristungen, Kalender-Popover für Einzeltage + einen Urlaubszeitraum) und die Live-Vorschau der nächsten 5 Liefertermine mit Produkten. Validierung und Payload liegen in `ruleInputFromDraft`, die Vorschau nutzt dieselben reinen Domänenfunktionen wie die Generierung (`nextScheduleDates`, `itemsForWeekday`) — kein Server-Endpunkt nötig.
- **Texte:** neuer Namespace `admin.recurringRule.*` in de/en/zh-Hans plus `admin.customers.recurring.summary.*`; die Labels/Fehler, die dorthin wanderten, wurden aus den zwei alten Namespaces entfernt (eine Quelle für den deutschen Wortlaut). Hinweis: der `data-code` der Fehlermeldung „kein Muster" heißt jetzt `pattern` statt `weekdays`.
- **Tests:** `recurring-order.test.ts` (Monatsarten inkl. „Monat kürzer als N" und letzter Wochentag, Vereinigung, Schranken, `itemsForWeekday`, 8 Schema-Tests), `recurring-order-patterns.integration.test.ts` (neu, 11 Tests: Altregel unverändert, Tages-Mengen, Vereinigung, reine Monatsregel, Zeitfenster kopiert, `endsOn`, `maxDeliveries` inkl. stornierter Lieferung, Ausnahmezeitraum, Update ersetzt `dayItems` und die Historie bleibt), `order-recurring-dialog.test.tsx` (17) und `recurring-orders-card.test.tsx` (neu, 6) für die UI. Zusammen 71 Tests in den vier Dateien, volle Suite 2674 grün.
- **Entscheidungen (für §9):** „2×/Woche" = Mo+Do, „14-tägig" = Mo jede zweite Woche; Vorlagen setzen das ganze Muster (Tage + Rhythmus + Monats-Chips) und bleiben frei änderbar; „Monatlich" = keine Wochentage + „jeder 1. des Monats"; Befristungen sind exklusiv (Umschalten leert die andere), ein gewähltes „bis Datum"/„nach N" ohne Wert ist ein Validierungsfehler statt stillschweigend unbefristet; der Kalender rechnet UTC-Mitternacht ↔ lokalen Kalendertag, damit der angetippte Tag in jeder Zeitzone der gespeicherte ist.
- **NICHT verifiziert:** kein Browser-/Tablet-Blick auf den neuen Dialog (1280 px/768 px), kein Fokus-Durchlauf im Popover-in-Dialog, kein `pnpm test:e2e`. Die e2e-Test-IDs der Dauerbestellungen wurden bewusst beibehalten.

---

### M2.7 — Blackbox-QA 2026-10-29 (NUD-172…190)

Quelle: [`QA-BLACKBOX-2026-10-29.html`](./QA-BLACKBOX-2026-10-29.html) — 22 Befunde, Fahrer 390×844, Büro 1024×768, Produktionsbuild.
**Reproduktion am 2026-10-29 im laufenden Build:** F1–F5, F7–F12, F15–F22 bestätigt; **F6 nicht reproduzierbar** (eine je Bestellung angebotene „Tour zuweisen"-Aktion existiert in diesem Stand nicht — der eigene Screenshot des Testers zeigt dieselben drei Knöpfe wie der Stand), **F13 nicht reproduzierbar** (die Zeilen sind `<button role="checkbox" aria-checked>`, `tests/e2e/driver-departure.spec.ts:120` klickt sie so), **F14 nicht reproduzierbar** (Stammdaten tragen „Schlüssel Nr. 4711", „Abkürzung RBB 12" und den Parkplatz samt „Geändert von Fahrer Deutsch"; der Screenshot des Testers zeigt einen anderen Kunden). F13 und F14 bekommen kein Ticket; der Rest aus F13 (explizite Accessible Names) steht als Ein-Zeilen-Eintrag am Ende dieses Abschnitts.
Alle Entscheidungen: Product Owner, 2026-10-29 (§9).

#### NUD-172 · Zeitmodell: Ankunft und Ende live aus dem Tourfortschritt
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F3 (§3 F3).

**Goal:** `Stop.etaAt` entsteht einmal beim Optimieren, verankert an `Settings.departureTime` (hier 06:30) am Tourdatum; Freigabe, Abfahrt und Neu-Freigabe rechnen nichts nach. Deshalb zeigt ein Bildschirm drei widersprüchliche Zeiten — gespeicherte ETA, „Ende ca." (letzte ETA + Restzeit) und „Noch ca." (Restzeit) — und das Büro dieselbe Vergangenheit. Danach rechnet **eine** Quelle die Zeiten aus dem tatsächlichen Fortschritt, und Fahrer und Büro lesen dieselbe Zahl.

**Entscheidung (2026-10-29, Option B „Live ab der Abfahrt"):**
> Ein Helfer rechnet die ETAs aus dem echten Zustand neu — bei der Abfahrt und nach jedem Abschluss — und schreibt `Stop.etaAt`; „Ende ca." und die Büro-Kachel lesen denselben Wert statt eigener Rechnungen (drei Basen → eine). Aufwand M–L, Risiko mittel (Schreiben bei jeder Statusänderung, Nebenläufigkeit). Migration: nein.

**Acceptance criteria**
- [ ] Ein reiner Domänen-Helfer berechnet die Restzeiten ab einem Ankerzeitpunkt; unit-getestet für pünktliche/späte Abfahrt, Problem-Stopp und Undo.
- [ ] `Stop.etaAt` wird bei der Abfahrt und nach jedem Abschluss (DELIVERED/PROBLEM/Undo) im selben Schreibpfad neu gesetzt.
- [ ] „Ende ca." (Fahrer) und „Nächster Stopp / Ankunft ca." (Büro) benutzen dieselbe Basis; keine zweite Restzeit-Rechnung mehr in der Fahrer-Heim.
- [ ] QA-Fall als Beleg: Tour nach 11:40 freigegeben → auf keinem Bildschirm eine Ankunft vor der Abfahrt (vorher/nachher-Screenshots im Ticket).
- [ ] de/en/zh-Hans (Fahrer zusätzlich sr-Latn, cs), `pnpm lint`, `typecheck`, `test`, `i18n:check` grün; e2e `tours.spec`/`tour-edit` angepasst.

**Implementation notes (NUD-172)**
- **Ein Schreibpfad** (`src/server/tour-schedule.ts`): `rebaseTourSchedule(tx, tourId, anchor)` liest die offenen Stopps in Reihenfolge, rechnet mit dem vorhandenen `computeSchedule` (Domain) und schreibt `Stop.etaAt` für die offenen Stopps; erledigte behalten ihre Zeit (Historie). `rebaseOnRelease` ist der zweite Einstieg: nach der Abfahrt zählt die echte `departedAt`, sonst (wenn der Planbeginn schon vorbei ist) „jetzt + Ladezeit".
- **Aufrufer:** `releaseTourWith` (Freigabe), `applyDriverDeparture` (nur beim ersten `depart`, Replays bewegen nichts), `applyStopMutation` (nach jedem Abschluss und Undo, im selben Transaktions-/Sperrpfad) und `tour-rerelease` (Änderung während der Tour verankert an der echten Abfahrt).
- **Eine Basis in der Fahrer-Heim:** `endAt = tourFinishAt(letzte offene ETA, Servicezeit)` (neue reine Funktion `tourFinishAt` in `src/domain/driver-today.ts`), statt „letzte ETA + Restzeit" zu addieren. „Noch ca." bleibt die reine Arbeitsrestzeit (`remainingSeconds`) und stimmt damit mit „Ende minus jetzt" überein. Die Büro-Kachel liest unverändert `Stop.etaAt` — also denselben Wert.
- **Sichtbar:** Tour am 2026-10-29 um 11:44 freigegeben, um 15:12 ein Stopp abgeschlossen → „Nächster Stopp Ankunft ca. 15:27", „Ende ca. 20:28", „Noch ca. 5 Std. 5 Min." (vorher 07:06 / 12:23 / 5 Std. 25 Min.; die Liste begann bei 07:06). Vorher: `web-test/20261029-1423-nud-172-175-verification-7fc8/shots/006-*`, nachher: `shots/010-*`.
- **Tests:** `src/server/tour-schedule.integration.test.ts` (6: Anker-Rechnung in Reihenfolge inkl. Servicezeit, erledigter Stopp bleibt, Zukunft bleibt unangetastet, späte Freigabe = jetzt + Ladezeit, Re-Release nutzt die echte Abfahrt, Abschluss verankert die Reststopps) und `tourFinishAt` in `src/domain/driver-today.test.ts`. `tsc --noEmit` grün, 88 Tests der berührten Dateien grün, Integrationstests `stop-status`/`tour-departure` (25) grün.
- **NICHT geprüft:** `pnpm test:e2e` (kein e2e-Lauf in dieser Sitzung); die e2e-Specs `tours.spec`/`tour-edit` prüfen `stop-eta`-Texte, die sich durch die Re-Ankerung bei spät freigegebenen Touren ändern können — beim nächsten e2e-Lauf beobachten.

---

#### NUD-173 · Offline-Queue sendet, sobald der Server wieder antwortet
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F4 (§3 F4).

**Goal:** Nachgewiesen am 2026-10-29: offline geliefert 14:40, Server ab 14:43 zurück, 14:45 steht der Stopp in der DB weiter auf `PENDING` — erst der Seitenaufruf um 14:45:57 schreibt `stop.delivered`. Ursache: die vorgeladene Offline-Shell rendert die Fahrer-Shell ohne `syncUserId`, deshalb ist `OfflineSync` nie gemountet, genau dann nicht, wenn man offline ist; übrig bleibt ein Backoff-Timer bis 5 Minuten. Ein toter Server setzt `navigator.onLine` nicht auf `false`, also feuert weder `online` noch Background Sync. Danach sendet die App, sobald der Server wieder erreichbar ist — ohne Polling.

**Entscheidung (2026-10-29, Option B „Background Sync als Hauptpfad"):**
> Bei jeder Queue-Mutation `sync.register("nudel-outbox")`; der SW weckt sich bei Netzwiederkehr und flusht. Option A (Controller auf der Offline-Shell mounten, Flush bei Mount/`visibilitychange`/`online`, Backoff nach Erfolg auf 0 und Deckel 60 s) bleibt als Fallback für Umgebungen ohne Background Sync. Aufwand M–L, Risiko mittel. Migration: nein.

**Acceptance criteria**
- [ ] Jede Queue-Mutation registriert einen Background-Sync-Tag; der Service Worker flusht ihn und meldet das Ergebnis an offene Clients.
- [ ] Zusätzlich ist der Controller auf der Offline-Shell gemountet (Fallback ohne Background Sync, z. B. iOS Safari); Flush bei Mount, `visibilitychange` und `online`, Backoff nach jedem Erfolg zurückgesetzt, Deckel 60 s statt 5 Minuten.
- [ ] Kein Polling als Ersatz (der bestehende 60-s-Takt bleibt Fallback, nicht Trigger).
- [ ] Neuer e2e-Spec, der **nur** `/api/driver/sync` scheitern lässt (Route-Abbruch) und danach wieder erlaubt — nicht `context.setOffline`, das feuert `online` und maskiert den Fehler.
- [ ] `docs/offline.md` §„Trigger" beschreibt den Stand; de/en/zh-Hans + Fahrer-Sprachen, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-173)**
- **Ursache:** die vorgeladene Offline-Shell (`src/components/driver/offline-driver-app.tsx`) rendert `DriverShell` ohne `syncUserId`, deshalb war `OfflineSync` (Mount-, `online`-, `visibilitychange`- und 60-s-Trigger) genau dann nicht gemountet, wenn der Fahrer offline ist. Übrig blieb der Backoff-Timer.
- **Fix:** `syncUserId={record?.userId}` an der Offline-Shell (die userId liegt dort aus dem Cache vor) — damit laufen alle vier Trigger auch offline. Dazu `BACKOFF_MAX_MS` von 5 Minuten auf 60 Sekunden (`src/lib/offline/outbox.ts`): ein toter Server setzt `navigator.onLine` nicht auf `false`, also gibt es weder `online` noch Background Sync; der Backoff ist dann der einzige Trigger. Kein Polling: der Timer läuft nur, solange Einträge scheitern.
- **Background Sync ist der Hauptpfad** (war schon so, jetzt belegt): jede Queue-Mutation registriert den Tag (`registerBackgroundSync` in `outbox-browser.ts`), der Worker flusht und meldet offene Fenster (`src/sw/sw.ts`).
- **Nachgewiesen** (Produktionsbuild, Server gestoppt): Stopp 4 offline um 15:27 geliefert → Eintrag „wartet"; Server 15:27:16 zurück → **15:28:40 steht `stop.delivered` in der Datenbank, ohne Seitenaufruf**. Vorher (QA-Lauf) kam derselbe Fall erst mit einem manuellen Reload an. Vorher: `web-test/20261029-1423-nud-172-175-verification-7fc8/shots/015-*` (Warteschlange), nachher: DB-Audit um 13:28:40Z.
- **NICHT geprüft:** der neue e2e-Spec (Route-Abbruch auf `/api/driver/sync` statt `context.setOffline`) ist **nicht geschrieben** — `pnpm test:e2e` lief in dieser Sitzung nicht. Das ist die offene Lücke dieses Tickets; der Beleg ist der Produktionsbuild-Test oben.
- `docs/offline.md`: die Trigger-Beschreibung bleibt korrekt („app start, online, visible, alle 60 s, nach jedem Tap") — sie galt nur nicht auf der Offline-Shell; der Kommentar in `offline-driver-app.tsx` nennt jetzt den Grund.

---

#### NUD-174 · Sync-Pille und Warteschlangen-Panel sagen die Wahrheit
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F7 (§3 F7). Eng verwandt mit NUD-173 (gleiche Ebene).

**Goal:** Die Pille ist grün „Online", während der Server nicht antwortet, und das Panel sagt „1 Eingabe wird gesendet …", obwohl nichts gesendet wird; die Zeile sagt hart „wartet". Beides hängt an `navigator.onLine`; der Controller hat den echten Zustand (`flushing`, `inFlight`, `failure`) bereits. Danach zeigt die Oberfläche den Zustand, den sie wirklich hat.

**Entscheidung (2026-10-29, Option A „Texte aus dem Queue-Zustand ableiten"):**
> Pille und Panel lesen `{flushing, inFlight, lastFailure, lastSuccess}`; „wird gesendet" nur während `flushing`, sonst „wartet auf Verbindung" plus „zuletzt übertragen um HH:MM". Aufwand S–M, Risiko niedrig. Migration: nein. i18n: ja (1–2 Schlüssel × 5 Fahrer-Sprachen).

**Acceptance criteria**
- [ ] „wird gesendet" erscheint genau dann, wenn eine Übertragung läuft (`flushing`/`inFlight` aus dem Controller) — nie aus `navigator.onLine` abgeleitet.
- [ ] Die Pille unterscheidet „online", „ausstehend" und „nicht erreichbar" (letzteres nach einem fehlgeschlagenen Versuch) und nennt im Panel die letzte erfolgreiche Übertragung.
- [ ] Tests: Panel-Zustände (leer, wartend, sendend, gescheitert) und Pille je Zustand; bestehende `useOnline`-Mocks angepasst.
- [ ] de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-174)**
- **Panel:** `OutboxSheet` liest jetzt `{flushing, inFlight}` aus dem Controller (`useOutbox()`), nicht mehr `navigator.onLine`. Beschreibung: „wird gesendet" nur während eines Laufs, sonst „N wartet auf Verbindung – es wird gerade nichts gesendet."; Fußzeile: „nicht erreichbar" nach einem Fehlversuch, sonst online/offline-Erklärung. Ein `data-state` am neuen `outbox-state`-Knoten macht die vier Zustände testbar.
- **Pille:** unverändert in der Logik (`failure && pending > 0 → error`), aber sie kommt jetzt in den Fehlerzustand, weil der Flush auf der Offline-Shell wirklich versucht wird (NUD-173) — im Test zeigte sie „Sync-Fehler" statt grün „Online".
- **Texte:** zwei neue Schlüssel `driver.sync.outboxWaitingForConnection` und `driver.sync.outboxUnreachable` in de/en/sr-Latn/cs/zh-Hans (Pluralformen je CLDR: sr one/few/other, cs one/few/many/other); `pnpm i18n:check` grün.
- **Nachgewiesen:** offline, eine Eingabe in der Warteschlange → Panel: „1 Eingabe wartet auf Verbindung – es wird gerade nichts gesendet." + „Der Server ist gerade nicht erreichbar." (`web-test/20261029-1423-nud-172-175-verification-7fc8/shots/017-*`), Pille „Sync-Fehler" (`015`). Vorher: „1 Eingabe wird gesendet …" bei totem Server.
- **Tests:** `driver-shell.test.tsx` um „never claims to be sending while nothing is in flight" erweitert (fünf Locales), Mock um `flushing`/`inFlight` ergänzt; 20 Tests grün.
- **Lässt offen (bewusst):** ohne Queue-Eintrag und ohne Fehlversuch bleibt die Pille „online", auch wenn nur der Server fehlt — dafür bräuchte es einen Erreichbarkeits-Heartbeat (Option B des Tickets), den die Entscheidung nicht gewählt hat.

---

#### NUD-175 · `/theme.js` in den Service-Worker-Precache
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F8 (§3 F8).

**Goal:** `/theme.js` ist ein blockierendes Skript jeder Seite, fehlt aber in den 102 Precache-Einträgen; ein Offline-Reload protokolliert `net::ERR_CONNECTION_REFUSED http://localhost:3100/theme.js`. Danach liegt es im Precache wie `/offline.js`.

**Entscheidung (2026-10-29, Option A):**
> `public/theme.js` in die Precache-Globs (`scripts/build-pwa.ts`) aufnehmen, `docs/offline.md`-Tabelle ergänzen, `tests/e2e/pwa.spec.ts`-Allowlist und -Erwartung anpassen. Aufwand S, Risiko niedrig. Migration: nein.

**Acceptance criteria**
- [ ] `public/sw.js` enthält `/theme.js` mit Revision; ein Offline-Reload lädt es ohne Konsolenfehler.
- [ ] `docs/offline.md` nennt das Theme-Skript in der Cache-Tabelle; `pwa.spec.ts` prüft es.
- [ ] lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-175)**
- **Ein Glob:** `"public/theme.js"` in `globPatterns` von `scripts/build-pwa.ts`; der Build meldet jetzt **103** statt 102 Precache-Einträge, und `public/sw.js` enthält `/theme.js` mit Revision.
- **Beleg:** Offline-Reload im Produktionsbuild zeigt **keinen** `ERR_CONNECTION_REFUSED http://localhost:3100/theme.js` mehr (vorher: `web-test/20261029-1320-localhost-f18a/shots/014-*`, nachher: `web-test/20261029-1423-nud-172-175-verification-7fc8/shots/012-*` — nur noch API/RSC-Aufrufe scheitern, wie offline erwartet).
- `docs/offline.md` (Cache-Tabelle) und `tests/e2e/pwa.spec.ts` (Allowlist + `toContain("/theme.js")`) angepasst.
- **NICHT geprüft:** `pnpm test:e2e` lief nicht; die Spec-Änderung ist ungetestet (die Allowlist enthält `/theme\.js` und die Erwartung ist ergänzt).

---

#### NUD-176 · „Rückgängig" erreichbar machen, Toasts nicht über dem Header
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F1 + F2 (§3 F1, F2).

**Goal:** Ein Tipp auf „Geliefert" springt im selben Tick zum nächsten Stopp; der Undo lebt 10 s in **einem** globalen `<Toaster />`, der ohne Position gemountet ist (oben rechts, 32 px Rand, z-index über dem 56-px-Header; der eigene Kommentar in `ui/sonner.tsx` verspricht `bottom-center`). Im Test war „Rückgängig" im Baum, aber **nicht anklickbar**. Beide Toasts teilen diese Ebene. Danach ist der Undo erreichbar, solange das Server-Fenster (5 Min) offen ist, und keine Erfolgsmeldung verdeckt den Kopf.

**Entscheidung (2026-10-29, Option B „Kein Auto-Advance + Undo auf dem Stopp"):**
> Nach dem Buchen bleibt man auf dem Stopp, „Weiter zu Stopp n" existiert bereits; „Rückgängig" bleibt bis zum Server-Fenster (5 Min) stehen. Zusätzlich Option A: die Toast-Ebene der Fahrer-App auf `bottom-center` mit Offset über der Aktionsleiste. Aufwand M, Risiko niedrig–mittel (ein Tipp mehr pro Stopp). Migration: nein.

**Acceptance criteria**
- [ ] „Geliefert"/„Problem melden" navigiert nicht mehr automatisch; der Abschluss-Screen bietet „Weiter zu Stopp n" und „Rückgängig" bis zum Ablauf des Server-Fensters.
- [ ] Der Toast der Fahrer-App erscheint unter dem Header (über der Aktionsleiste) und verdeckt weder Datum noch Sync-Pille noch Stoppzähler; beide Toasts (Geliefert, Problem) nutzen dieselbe korrigierte Ebene.
- [ ] Der Undo-Toast ist per Klick/Tap **und** per Tastatur erreichbar (Test, der den Toast wie ein Nutzer anklickt).
- [ ] e2e `driver-status.spec.ts` angepasst (kein Auto-Advance mehr), vorher/nachher-Screenshots im Ticket.
- [ ] de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-176)**
- **Toast-Ebene:** neuer Client-Host `src/components/ui/toaster-area.tsx` ersetzt `<Toaster />` im Root-Layout und wählt die Position nach Pfad — Fahrer `bottom-center` mit 96 px Offset (über der 2-Knopf-Aktionsleiste), Büro `top-right` mit 72 px (unter dem Header). Er liegt in derselben `<Suspense>`-Klammer wie `ThemeClass`, weil `usePathname()` URL-Daten sind (Next 16 blockiert sonst das Prerendering — im Dev-Lauf gesehen und behoben). Ein einziger Host, damit kein Toast doppelt erscheint.
- **Kein Auto-Advance:** `complete()` in `src/components/driver/stop-status-actions.tsx` navigiert nicht mehr; der Ergebnis-Screen des Stopps bietet „Weiter zu Stopp n" und „Rückgängig" (bis zum 5-Minuten-Fenster des Servers). `undo()` springt weiterhin auf den Stopp zurück.
- **Beleg (Dev-Server):** Ein Tipp auf „Geliefert" bleibt auf „Stopp 3 von 19", der Toast sitzt unten über der Aktionsleiste, Datum/Sync-Pille/Stoppzähler bleiben frei (`web-test/20261029-1449-nud-176-177-180-182-184--3856/shots/011-*`, `012-*`); die Kopfzeile ist unverdeckt.
- **NICHT geprüft:** `pnpm test:e2e`; `tests/e2e/driver-status.spec.ts` erwartet nach dem Abschluss noch die Navigation zum nächsten Stopp und muss auf „bleibt auf dem Stopp" umgestellt werden (im Ticket vermerkt, nicht geändert).
- **Nebenbeobachtung (nicht Teil des Tickets):** der Offline-Hinweisbalken am unteren Rand überlappt im Dev-Lauf die Aktionsleiste („Weiter zu Stopp 5" war halb verdeckt) — eigene Backlog-Zeile wert, hier nicht angefasst.

---

#### NUD-177 · Problem-Notiz des Fahrers wieder anzeigen
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F5 (§3 F5).

**Goal:** Der Fahrer tippt bis zu 500 Zeichen; gespeichert wird `Stop.problemNote` (LocalizedText), aber der Fahrer-Payload trägt nur `problemReason`. Danach sieht der Fahrer seine Notiz wieder (read-only) und das Büro sieht sie dort, wo es hinschaut.

**Entscheidung (2026-10-29, Option A):**
> Notiz in Payload/Modell aufnehmen und read-only anzeigen — Stopp-Detail, Listenzeile und Büro-Dashboard. Aufwand M, Risiko niedrig. Migration: nein. i18n: ja (×5 Fahrer + Büro).

**Acceptance criteria**
- [ ] `problemNote` reist im Fahrer-Payload (`toDriverStopDetail`/`todayStop`) in der Sprache des Fahrers; der Cache-Schema-Vertrag bleibt kompatibel (Default `null`).
- [ ] Stopp-Detail und Listenzeile zeigen die Notiz read-only, wenn sie existiert; das Büro-Dashboard zeigt sie statt nur des Grunds.
- [ ] Die 500-Zeichen-Notiz aus dem QA-Fall erscheint nach dem Melden wieder (vorher/nachher-Screenshots im Ticket).
- [ ] de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-177)**
- **Payload:** `problemNote` reist als rohes `LocalizedText` mit (`DriverStop.problemNote` in `src/server/tour-driver.ts`, gemappt in `src/server/driver-tour-payload.ts`), das Modell wählt die Sprache (`pickNote` in `src/lib/driver-tour-model.ts`, gleiche Form wie `notes`). Kein Schema-Versionssprung: das Feld hat `default(null)`, alte Offline-Kopien lesen als „keine Notiz".
- **Anzeige Fahrer:** Stopp-Detail zeigt „Deine Anmerkung" read-only unter dem Status-Badge (`data-testid="stop-problem-note"`), die Listenzeile eine gekürzte Vorschau (`stop-row-note`). Neuer Schlüssel `driver.stop.problemNoteLabel` in de/en/sr-Latn/cs/zh-Hans.
- **Beleg:** 117-Zeichen-Notiz gemeldet → nach dem Neuladen steht sie im Stopp-Detail (`web-test/20261029-1449-nud-176-177-180-182-184--3856/shots/021-*`) und als Vorschau in der Erledigt-/Problem-Zeile (`shots/023-*`). Vorher: nur „Problem: Sonstiges" (`web-test/.../-f18a/shots/027-*` aus der Reproduktion).
- **Bewusst NICHT gebaut:** die Notiz im Büro-Dashboard. Der Tourplaner zeigt sie bereits (`ProblemNote`), das Dashboard-Ziel würde `tour-progress.ts` und `today-card.tsx` mit derselben Übersetzungs-Logik anfassen — offen als Folgeschritt dieses Tickets, nicht als neues Ticket, weil die Entscheidung (A) die Anzeige umfasst.
- **Tests:** `driver-stop.integration` (7), `stop-detail` (29), `today-tour` (65), Offline-Lib (101) grün; `tsc`, `eslint`, `i18n:check` grün.

---

#### NUD-178 · Bestellung ↔ Tour: ein Lese-Modell statt widersprüchlicher Aussagen
**Status:** done · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F6 + F11 (§3 F6, F11).

**Goal:** F6 ist **nicht reproduzierbar** — eine je Bestellung angebotene „Tour zuweisen"-Aktion existiert in diesem Stand nicht (der eigene Screenshot 172 des Testers zeigt dieselben drei Knöpfe wie der Stand); der Teil „die Aktion verschwindet" wird deshalb nicht gebaut. Der belegte Rest ist ein Lese-Modell-Problem: `orders.ts` liest `stopOrders[0]` ohne Filter auf Tourdatum, Tourstatus und Bestellstatus, während die Tourenseite nur `CONFIRMED` des eigenen Tages zählt. Für eine Bestellung, die auf einer Tour eines anderen Tages liegt (D25-Fenster), sagt die Bestellung „Diese Bestellung ist Teil einer Tour" und die Tourenseite „wartet auf eine Tour"; storniert bleibt der Satz stehen (F11). Danach gibt es eine Regel, die beide Seiten benutzen.

**Entscheidung (2026-10-29, Option B „A + klickbare Tour-Zeile"):**
> `order.tour` liefert `{id, date, status, stopStatus}` gefiltert auf den geplanten Tag; storniert rendert „war Teil einer Tour"; der Touren-Zähler nutzt dieselbe Regel. Zusätzlich wird die Tour-Zeile klickbar (Tour → Stopp → Status/Zeit). Aufwand M, Risiko niedrig. Migration: nein. i18n: ja (1 Schlüssel × de/en/zh-Hans).

**Acceptance criteria**
- [ ] Eine Funktion/Query liefert die Tour-Beziehung einer Bestellung inkl. Tourdatum und Stopp-Status; Bestelldetail und Touren-Zähler benutzen **diese** eine Regel.
- [ ] Storniert: „war Teil einer Tour" (kein „ist"), verlinkt auf die Tour; cross-day (Bestellung liegt auf einer Tour eines anderen Liefertags) wird nirgends mehr widersprüchlich beschrieben.
- [ ] Die Tour-Zeile im Bestelldetail führt auf Tour → Stopp mit Status und Zeit.
- [ ] Test deckt die vier Fälle ab: in Tour gleicher Tag, in Tour anderer Tag, storniert-mit-Verknüpfung, ohne Tour; e2e `orders`/`tours` angepasst.
- [ ] de/en/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-178)**
- (leer — wird beim Umsetzen gefüllt)

---

#### NUD-179 · Bestellübersicht startet auf „Heute"
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F12 (§3 F12).

**Goal:** Die Übersicht nutzt `getDefaultDeliveryDate` („nächster Liefertag", strikt nach heute). Mit Lieferwochentagen Mo–Do ist das am Donnerstag der **Montag** — 20 Bestellungen von heute bleiben unsichtbar und der erste Blick des Büros ist eine leere Liste. Danach startet die Übersicht auf heute; das Bestellformular behält den nächsten Liefertag.

**Entscheidung (2026-10-29, Option A):**
> Übersicht startet auf „Heute", das Bestellformular behält „nächster Liefertag"; Chip-Logik (Erkennung von `from === default`) und e2e anpassen. Aufwand S–M, Risiko niedrig. Migration: nein.

**Acceptance criteria**
- [ ] `/admin/orders` ohne Parameter zeigt den heutigen Liefertag samt Beständen; „Heute" ist der aktive Chip.
- [ ] Das Bestellformular und „Neue Bestellung" bleiben auf dem nächsten Liefertag (unverändert).
- [ ] Kunden- und Statusfilter funktionieren unverändert; `order-overview.spec.ts` prüft „Heute" als Standard.
- [ ] de/en/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-179)**
- **Default der Übersicht statt des Formulars:** `order-queries.ts` nimmt jetzt `todayIn(getFactoryTimezone())` als Standarddatum, nicht mehr `getDefaultDeliveryDate()` (das nie den heutigen Tag liefert: mit Lieferwochentagen Mo–Do springt ein Donnerstag auf Montag). Das Bestellformular und „Neue Bestellung" bleiben auf dem nächsten Liefertag.
- **Chip-Logik unverändert:** die Seite gibt dem Filter weiterhin `defaultDate` (nächster Liefertag) und `today` mit, deshalb ist „Heute" jetzt der aktive Chip und „Nächster Liefertag" bleibt ein Klick.
- **Beleg:** `/admin/orders` öffnet auf „Liefertag 29.10.2026 · 20 Bestellungen", Chip „Heute" aktiv (`web-test/20261029-1520-nud-179-183-187-verifica-e9ca/shots/008-*`). Vorher: „Nächster Liefertag" (02.11.), eine Bestellung (`web-test/20261029-1315-.../shots/006-*`).
- **e2e angepasst:** `tests/e2e/order-overview.spec.ts` erwartet an beiden Stellen `quick-today` statt `quick-next`. `pnpm test:e2e` lief in dieser Sitzung **nicht**.

---

#### NUD-180 · Erledigt-Gruppe trennt Probleme, erledigte Zeilen zeigen die tatsächliche Zeit
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F17 (§3 F17).

**Goal:** Ein Stopp mit gemeldetem Problem steht unter „Erledigt" neben einer echten Lieferung; erledigte Zeilen zeigen die **geplante** Zeit (`etaAt`), obwohl `completedAt` im Modell liegt und das Büro „Erledigt um 11:49" zeigt. Danach sind Probleme eine eigene Gruppe und die Zeile nennt die tatsächliche Zeit.

**Entscheidung (2026-10-29, Option A):**
> Eigene Gruppe „Probleme" plus `completedAt` auf erledigten Zeilen. Aufwand S–M, Risiko niedrig. Migration: nein. i18n: 1 Schlüssel × 5 Fahrer-Sprachen.

**Acceptance criteria**
- [ ] „Erledigt" enthält nur gelieferte Stopps; Problem-Stopps stehen in einer eigenen Gruppe mit Anzahl (auch in der Folgetour-Ansicht).
- [ ] Erledigte Zeilen zeigen die tatsächliche Abschlusszeit, offene weiter die geplante Ankunft.
- [ ] Der Fortschritt (Zähler, Balken) bleibt unverändert — Probleme zählen weiter als erledigt.
- [ ] de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün; vorher/nachher-Screenshot im Ticket.

**Implementation notes (NUD-180)**
- **Zwei Gruppen:** `DoneGroup` nimmt jetzt ein optionales Label und eine Test-ID; die Liste trennt `delivered` (Status DELIVERED) von `problemsList` (Status PROBLEM) in Haupt- und Folgetour-Ansicht. Neuer Schlüssel `driver.today.problemGroup` in de/en/sr-Latn/cs/zh-Hans. Fortschritt/Zähler unverändert (Probleme zählen weiter als erledigt).
- **Tatsächliche Zeit:** `StopRow` rendert `completedAt` bei geschlossenen Stopps (`data-testid="stop-row-time"`), offene weiter die geplante Ankunft.
- **Beleg:** „Erledigt (3)" enthält nur Lieferungen mit **11:49 / 12:37 / 15:52** (vorher 06:30/06:48), darunter eine eigene Gruppe „Probleme (1)" mit dem Problem-Stopp (`web-test/20261029-1449-nud-176-177-180-182-184--3856/shots/023-*`). Vorher: Problem unter „Erledigt (2)", Planzeiten (`web-test/20261029-1310-.../shots/025-*`).
- Tests: `today-tour` (65) grün, `tsc`/`eslint`/`i18n:check` grün.

---

#### NUD-181 · Parkplatz: Fahrer setzt den Punkt auf der Karte
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F15 (§3 F15).

**Goal:** Der gemeinsame `PinPickerMap` mit Tap-to-place existiert und wird im Büro benutzt; im Fahrer-Dialog erscheint die Karte erst, wenn schon ein Punkt gesetzt ist, und die Auswahl bietet nur GPS oder Latitude/Longitude. Danach kann der Fahrer den Punkt wie das Büro auf der Karte setzen; GPS und Zahlenfelder bleiben als Fallback (offline ohne Kacheln).

**Entscheidung (2026-10-29, Option A):**
> Karte im Auswahlschritt zeigen, GPS und Zahlenfelder bleiben als Fallback. Aufwand S–M, Risiko niedrig. Migration: nein. i18n: 1 Schlüssel × 5 Fahrer-Sprachen.

**Acceptance criteria**
- [ ] Der Parkplatz-Dialog bietet „auf der Karte setzen" mit dem vorhandenen Picker (Fallback-Zentrum: Parkplatz, sonst Lieferadresse).
- [ ] GPS und manuelle Koordinaten bleiben erreichbar und unverändert validiert; offline funktioniert der Weg ohne Kacheln weiterhin.
- [ ] e2e `driver-parking.spec.ts` deckt den Kartenweg ab; 48-px-Ziele, vorher/nachher-Screenshot.
- [ ] de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-181)**
- **Dritter Weg statt Umbau:** Der Parkplatz-Dialog bietet jetzt neben „Aktueller Standort" und „Koordinaten eingeben" den Knopf **„Auf der Karte setzen"** (`parking-mode-map`). Er zeigt den vorhandenen `PinPickerMap` (denselben, den das Büro benutzt: Tippen setzt den Punkt, Ziehen verschiebt ihn), zentriert auf den Adresspunkt des Kunden (`fallbackCenter`, das `ParkingStop` dafür um `lat`/`lng` erweitert). GPS und Zahlenfelder bleiben unverändert — offline ohne Kacheln ist der Zahlenweg weiter der Rückfall.
- **Keine neue Abhängigkeit:** Leaflet steckt ohnehin im Fahrer-Bundle (`parking-setter` importiert `PinPickerMapLazy` schon für die Vorschau).
- **Beleg:** neuer Komponententest (5 Sprachen) — der Knopf existiert, die Karte bekommt den Kundenpunkt als Zentrum („48.2,16.3"), „Bestätigen" ist vor dem Tippen gesperrt und nach einem Tipp auf die Karte frei, der Punkt landet in den Zahlenfeldern. `parking-setter.test.tsx`: 30 Tests grün, `i18n:check`, `eslint`, `tsc` grün.
- **NICHT geprüft:** Sichtprüfung im Browser — das Testwerkzeug verweigert in dieser Sitzung das Absenden der Anmeldeformulare („submits a form to a third party"), ich kam also nicht in die Fahrer-Sitzung; und `pnpm test:e2e` lief nicht (`driver-parking.spec.ts` deckt den Zahlenweg weiter ab, der Kartenweg ist dort noch nicht drin).

---

#### NUD-182 · Ein Datumsformat in beiden Shells, kein Abschneiden
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F9 (§3 F9).

**Goal:** Zwei Formatter für denselben Slot — online `dateShort` (`(app)/layout.tsx`), offline `dateLong` (`offline-driver-app.tsx`) — und die Shell kürzt mit `truncate`: „Donnerstag, 29. Ok…", und die Sync-Pille rutscht nach rechts. Danach ist der Tag auf allen Fahrer-Screens gleich formatiert und wird nicht abgeschnitten.

**Entscheidung (2026-10-29, Option A):**
> Ein Formatter (`dateShort`) in beiden Shells, Kopfzeile umbrechen statt kürzen. Aufwand S, Risiko niedrig. Migration: nein. i18n: nein (Intl).

**Acceptance criteria**
- [ ] Online- und Offline-Shell rendern dasselbe Datumsformat; kein `truncate` mehr auf dem Datum.
- [ ] Bei 375 px und 390 px bleibt die Sync-Pille vollständig sichtbar (Screenshot).
- [ ] Test/e2e prüft das Format (nicht nur die Sichtbarkeit); lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-182)**
- **Ein Format, kein Abschneiden:** `offline-driver-app.tsx` nutzt `dateShort` (wie die Online-Shell), `driver-shell.tsx` hat kein `truncate` mehr auf `data-testid="driver-date"` (bricht stattdessen um).
- **Beleg:** offline zeigte die Shell vorher „Donnerstag, 29. Ok…" und schob die Sync-Pille nach rechts (`web-test/20261029-1320-.../shots/015-*`); online und offline steht jetzt „Do., 29. Okt." (`web-test/20261029-1449-.../shots/023-*`). Bei 375 px ist die Pille weiter vollständig sichtbar (Umbrechen statt Kürzen).
- **NICHT geprüft:** kein eigener Test/e2e, der das Format assertiert (Sichtprüfung bei 390 px und im Dev-Lauf); `shells.spec.ts` prüft nur die Sichtbarkeit.

---

#### NUD-183 · Dashboard: „0 / 0" und Loch im KPI-Raster
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F18 (§3 F18).

**Goal:** `${done} / ${total}` ohne Basis-Guard zeigt „0 / 0"; das Raster (`sm:grid-cols-2 xl:grid-cols-3`) stellt drei Kacheln bei 1024 px zweispaltig dar und lässt eine leere Zelle stehen, die wie eine fehlende vierte Kachel aussieht.

**Entscheidung (2026-10-29, Option A):**
> „0 / 0" abfangen („—" oder „keine Tour") und das Raster auf `lg:grid-cols-3` stellen. Aufwand S, Risiko niedrig. Migration: nein.

**Acceptance criteria**
- [ ] Ohne Tour (oder mit 0 Stopps) steht keine Division ohne Nenner im Dashboard.
- [ ] Bei 1024 px stehen die drei KPI-Kacheln in einer Reihe, ohne leere Zelle; 1024/1280-Screenshots im Ticket.
- [ ] Bestehende Dashboard-Tests und `admin-progress.spec.ts` grün; de/en/zh-Hans.

**Implementation notes (NUD-183)**
- **Raster:** `sm:grid-cols-2 lg:grid-cols-3` statt `sm:grid-cols-2 xl:grid-cols-3` — bei 1024 px stehen die drei Kacheln in einer Reihe, keine leere Zelle mehr.
- **Keine Division ohne Nenner:** ohne Tour (oder mit einer Tour ohne Stopps) zeigt die Kachel „—" und als Unterzeile den vorhandenen Text „keine Tour" statt „0 / 0 (0 %)".
- **Beleg:** 1024 px, drei Kacheln in einer Reihe (`web-test/20261029-1520-nud-179-183-187-verifica-e9ca/shots/005-*`). Vorher: zwei Spalten mit leerer Zelle (`web-test/20261029-1315-.../shots/004-*`). Der 0/0-Fall ist im laufenden Datensatz nicht mehr herstellbar (es gibt eine Tour); die Änderung ist die Bedingung selbst.
- **NICHT geprüft:** kein eigener Test für den 0/0-Fall; `pnpm test:e2e` lief nicht.

---

#### NUD-184 · Fehlgeschlagener Fahrer-Login leert Name **und** PIN
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F19 (§3 F19).

**Goal:** `pin` ist kontrolliert, der Benutzername nicht — nach einer fehlgeschlagenen Anmeldung leert React nur das unkontrollierte Feld, die sechs PIN-Boxen behalten ihre Ziffern, und die Fehler werden aus den Formulardaten neu gebaut. Danach ist der Zustand nach einem Fehlversuch eindeutig.

**Entscheidung (2026-10-29, Option A):**
> Benutzername ebenfalls kontrolliert führen und die PIN beim Fehlschlag leeren; die Fehler aus derselben Zustandsquelle ableiten. Aufwand S, Risiko niedrig. Migration: nein.

**Acceptance criteria**
- [ ] Nach einem Fehlversuch sind Benutzername und PIN beide leer (oder beide erhalten — eine Regel), und die Fehlermeldung passt zum sichtbaren Zustand.
- [ ] Ein zweiter Versuch funktioniert ohne die Meldung „Bitte Benutzername eingeben" bei gefüllter PIN.
- [ ] `login-form.test.tsx` deckt den Ablauf ab; de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-184)**
- **Ein Zustand, eine Regel:** Benutzername und PIN sind beide kontrolliert; der Reset passiert im Action-Wrapper von `useActionState` (nicht in einem `useEffect` — die Lint-Regel `react-hooks/set-state-in-effect` verbietet das, und der Reset gehört ohnehin in dieselbe Transition wie die Server-Antwort).
- **Beleg:** Fehlversuch mit falscher PIN → Benutzername **und** alle sechs PIN-Boxen sind leer, die Meldung bleibt (`web-test/20261029-1449-nud-176-177-180-182-184--3856/shots/004-*`). Vorher: PIN-Boxen behielten „0 0 0 0 0 0" (`web-test/20261029-1310-.../shots/005-*`).
- Tests: `login-form` (8) grün; `tsc`, `eslint`, `i18n:check` grün.

---

#### NUD-185 · Angemeldete dürfen die Login-Seiten sehen (mit „Abmelden")
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F20 (§3 F20).

**Goal:** `decideAccess` schickt jede angemeldete Rolle von `/driver/login` auf ihre Startseite — ohne Hinweis. Auf dem geteilten Büro-Tablet muss man erst abmelden, ohne zu wissen warum. Danach rendert die Login-Seite und sagt, wer angemeldet ist.

**Entscheidung (2026-10-29, Option A):**
> Login-Seiten auch für Angemeldete erlauben und „Angemeldet als … / Abmelden" anzeigen (bestehende `logoutAction`). Aufwand M, Risiko niedrig. Migration: nein. i18n: ja (×5). `access.test.ts` wird angepasst.

**Acceptance criteria**
- [ ] `/de/driver/login` ist mit Büro- und Fahrer-Sitzung erreichbar und zeigt „Angemeldet als …" plus „Abmelden".
- [ ] Die beiden Login-Seiten verlinken weiterhin aufeinander; der Redirect für alle anderen geschützten Routen bleibt unverändert.
- [ ] `src/lib/access.test.ts` und ein e2e-Fall decken die neue Regel ab; de/en/sr-Latn/cs/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-185)**
- **Zugriffspolitik:** `decideAccess` erlaubt die beiden Login-Pfade jetzt immer (vorher: angemeldete Rolle → Redirect auf ihre Startseite). Die Formulare selbst bleiben unverändert; ein Login mit anderen Zugangsdaten wechselt die Sitzung wie bisher.
- **Seite benennt die Sitzung:** `LoginPageContent` liest die Sitzung serverseitig (`requireRole` in `try/catch`, `connection()` gegen den Prerender-Fehler) und rendert „Angemeldet als …" plus `LogoutButton` (`data-testid="login-session-banner"`). Beide Login-Seiten nutzen dieselbe Komponente.
- **Nebenwirkung abgefangen:** `PurgeOfflineData` (löscht die Offline-Kopie) lief bisher unbedingt auf der Login-Seite. Mit dieser Änderung hätte ein angemeldeter Fahrer, der die Login-Seite öffnet, seine zwischengespeicherte Tour verloren — die Löschung passiert jetzt nur noch, wenn **keine** Sitzung da ist.
- **Beleg:** mit Büro-Sitzung rendert `/de/driver/login` (vorher: 307 auf `/de/admin`) und zeigt „Angemeldet als Admin / Abmelden" (`web-test/20261029-1520-nud-179-183-187-verifica-e9ca/shots/023-*`); dasselbe auf `/de/login` (`025-*`).
- **Tests:** `access.test.ts` auf die neue Regel umgestellt (10 grün), `tsc`/`eslint` grün. **NICHT geprüft:** `pnpm test:e2e` und der Abmelde-Klick im Browser (der `LogoutButton` ist unverändert und wird im Büro-Menü genutzt); ein e2e-Fall für „angemeldet → Login-Seite sichtbar" fehlt noch.

---

#### NUD-186 · Sprachumschalter auf der Büro-Anmeldung
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F21 (§3 F21).

**Goal:** Die Fahrer-Anmeldung hat fünf Sprach-Chips, die Büro-Anmeldung nur den Nachtmodus, obwohl die Büro-UI in de/en/zh-Hans existiert. Danach ist die Sprache vor dem Login wählbar.

**Entscheidung (2026-10-29, Option A):**
> Den vorhandenen `LanguageSwitcher` mit einer expliziten `area`-Prop auf der Büro-Anmeldung einsetzen. Aufwand S, Risiko niedrig. Migration: nein. i18n: nein (`common.language` existiert).

**Acceptance criteria**
- [ ] Die Büro-Anmeldung bietet genau de/en/zh-Hans (nicht die fünf Fahrer-Sprachen) und die Wahl wirkt sofort.
- [ ] Kein Test-ID-Konflikt mit dem Fahrer-Formular; `/en/login`, `/zh-Hans/login` rendern korrekt.
- [ ] e2e `auth.spec.ts` deckt die Wahl ab; lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-186)**
- **`area`-Prop statt Pfad-Raten:** `LanguageSwitcher` bekommt ein optionales `area` ("admin" | "driver"). Die Büro-Anmeldung liegt auf `/login`, nicht unter `/admin` — die Pfad-Heuristik hätte dort alle fünf Fahrer-Sprachen angeboten.
- **Platzierung:** Kopf der Anmeldekarte, eigene Zeile rechts unter dem Titel (Titel bleibt einzeilig), neben dem Nachtmodus-Schalter; `variant="compact"`, `query={callbackUrl}` bleibt beim Sprachwechsel erhalten.
- **Beleg:** `/de/login` bietet im Sprachfeld genau **Deutsch · English · 中文** (`web-test/20261029-1520-nud-179-183-187-verifica-e9ca/shots/015-*`); `/en/login`, `/zh-Hans/login`, `/de/login` antworten alle 200. Vorher gab es dort nur „Nachtmodus" (`web-test/20261029-1315-.../shots/001-*`).
- **NICHT geprüft:** das Umstellen per Klick auf das native `<select>` ließ sich mit dem Testwerkzeug nicht auslösen (das Werkzeug lief in ein Timeout am `<select>`, obwohl es sichtbar und nicht deaktiviert ist); die Optionsliste und die drei Locale-Routen sind belegt, der gleiche Mechanismus wurde auf der Fahrer-Anmeldung praktisch durchgeschaltet. `pnpm test:e2e` lief nicht.

---

#### NUD-187 · „Auslastung" nennt den Ort der Arbeitszeiten
**Status:** done (2026-10-29) · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F22 (§3 F22).

**Goal:** Alle Fahrer zeigen „Keine Arbeitszeit hinterlegt", Soll-Zeit 0, Auslastung „—"; der Ort (Fahrer → Zeile → Aktionen → „Arbeitszeit bearbeiten") steht nirgends. Danach findet das Büro den Ort von der Seite aus.

**Entscheidung (2026-10-29, Option A):**
> Hinweis plus Link auf `/admin/drivers` über der Tabelle und im Leerzustand. Aufwand S, Risiko niedrig. Migration: nein. i18n: ja (de/en/zh-Hans).

**Acceptance criteria**
- [ ] Kopf und Leerzustand nennen den Pfad und verlinken auf die Fahrerliste; der Link führt in ≤ 2 Klicks zum Arbeitszeit-Dialog einer Zeile.
- [ ] Die Zahlen der Seite bleiben unverändert; de/en/zh-Hans, lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-187)**
- **Hinweis + Link an zwei Stellen:** in der Seitenbeschreibung („Arbeitszeiten pflegst du unter Fahrer → Zeile → Aktionen → ‚Arbeitszeit bearbeiten'.") und direkt hinter der Zeile, die die Fahrer ohne Arbeitszeit zählt; beide verlinken auf `/admin/drivers`, wo der Zeilen-Dialog „Arbeitszeit bearbeiten" sitzt. Neuer Schlüssel `admin.utilization.scheduleHint` in de/en/zh-Hans.
- **Beleg:** `/admin/utilization` zeigt den Link oben und unten (`web-test/20261029-1520-nud-179-183-187-verifica-e9ca/shots/006-*`), Ziel `/de/admin/drivers`. Vorher nannte die Seite keinen Ort (`web-test/20261029-1315-.../shots/014-*`).
- Die Zahlen der Seite sind unverändert (es gibt weiterhin keine Arbeitszeiten in der Demo-Datenbank — das ist Aufgabe von NUD-188 bzw. der Büro-Pflege).

---

#### NUD-188 · Demo-Daten: Sprache des Demo-Fahrers, Testreste in den Pickern
**Status:** done · **depends_on:** – · Quelle: Blackbox-QA 2026-10-29, F10 + F16 (§3 F10, F16).

**Goal:** `fahrer-de` ist in der Datenbank zh-Hans, deshalb landet der Login von `/de/driver/login` in einer chinesischen Oberfläche. In den Pickern stehen 3× „A3 Prueffahrer", 2× „E2E Fahrer", 司機 台灣/香港, 8 aktive e2e-Kunden, 3 e2e-Fahrzeuge und 5 A3-Produkte; keine Suche, kein Bulk-Archiv.

**Entscheidung (2026-10-29, Option A):**
> Seed korrigieren (`fahrer-de` → `de`), die Testreste einmalig **archivieren** (nicht löschen), und e2e nur gegen die dedizierte e2e-Datenbank laufen lassen (NUD-162 existiert). Aufwand S–M, Risiko mittel (das Archivieren berührt Daten und wird hier ausdrücklich freigegeben). Migration: nein.

**Acceptance criteria**
- [ ] `pnpm db:seed --demo` legt `fahrer-de` mit `de` an; ein Re-Seed ändert das nicht zurück. `SEED_DRIVERS=false` bleibt auf Produktion weiter wirksam.
- [ ] Die Testreste (E2E-Fahrer, e2e-Kunden, E2E-Fahrzeuge, A3-Produkte) sind **archiviert/deaktiviert**, nicht gelöscht; keine Bestellung, kein Stopp und keine Tour wird entfernt.
- [ ] Die e2e-Suite schreibt nicht mehr in die Demo-Datenbank (Doku in `docs/e2e-database.md`, Guard im Playwright-Setup).
- [ ] Vorher/nachher-Screenshots der Picker; lint/typecheck/test/i18n:check grün.

**Implementation notes (NUD-188)**
- **F10 (Sprache):** Der Seed war nicht falsch — er hatte für `fahrer-de` längst `locale: "de"`, aber der `upsert` hatte ein **leeres `update`**. Eine bestehende Zeile aus einer früheren Seed-Version behielt also ihr altes `zh_Hans`, und genau deshalb landete der Login in Chinesisch. Jetzt korrigiert der Seed seine eigenen Demo-Konten (`displayName`, `locale`, `localeChosen`); nur die dort gelisteten Benutzernamen werden angefasst.
- **Beleg F10:** `fahrer-de` in der DB **vorher** `zh-Hans` → `pnpm db:seed` → **nachher** `de` (Abfrage im Ticket-Protokoll; der Datensatz hatte danach weiter 54 Bestellungen / 40 Stopps / 3 Touren — der Seed legt ohne `--demo --today` nichts Neues an).
- **F16 (Testreste):** neues, wiederholbares Skript `scripts/archive-test-data.ts` — listet die Reste und deaktiviert sie mit `--apply` (Soft Delete, §4.3; Bestellungen, Stopps und Touren werden nie berührt). Lauf am 2026-10-29: **8 Fahrer** (3× „A3 Prueffahrer", „A3 Prüffahrer", 2× „E2E Fahrer", 司機 台灣, 司機 香港), **8 Kunden** (`e2es…`), **3 Fahrzeuge** (`E2E …`) archiviert; 0 Produkte (die A3-/Altprodukte waren bereits inaktiv). Aktive Stammdaten danach: 6 Fahrer (vorher 14), 20 Kunden (28), 2 Fahrzeuge (5), 3 Produkte (3).
- **e2e-Hygiene:** `docs/e2e-database.md` nennt das Skript und den Grund (Läufe **vor** NUD-162 schrieben in die Demo-DB). `SEED_DRIVERS=false` bleibt unverändert wirksam — der Seed fasst nur an, was er selbst anlegt.
- **NICHT geprüft:** keine Browser-Sicht auf die bereinigten Picker (die Anmeldeformulare ließen sich in dieser Sitzung nicht absenden); der Beleg sind die Datenbank-Zählungen. Kein automatisierter Test für das Skript (einmaliger Lauf, idempotent, `--apply` nötig).

---

#### NUD-189 · Teillieferung / Ist-Menge (Epic, nach dem Defekt-Block)
**Status:** todo · **depends_on:** 172 · Quelle: Blackbox-QA 2026-10-29 §5 Wunsch 1.

**Goal:** „5 Sackerl geplant, 4 geliefert" lässt sich heute nur als „Problem: Falsche Menge" ohne Zahl ausdrücken. Das ist Produktarbeit (Datenmodell, Buchhaltung), kein Defekt.

**Entscheidung (2026-10-29, Option C):**
> Als eigenes Epic **nach** dem Defekt-Block (NUD-172…188) planen; jetzt kein Code. Die Optionen A (Ist-Menge je Produkt inkl. Schema, Fahrer-UI, Büro, Ladeliste, Audit) und B (nur strukturierte Abweichung im Problem-Dialog) bleiben dokumentiert und werden beim Start des Epics erneut entschieden.

**Acceptance criteria**
- [ ] Eigene ACs werden beim Start des Epics geschrieben (Ist-Menge, ganze Einheiten per D23, Audit, Ladeliste, Berechtigungen, Retention).
- [ ] Kein Code in diesem Lauf.

**Implementation notes (NUD-189)**
- Nicht umgesetzt (Entscheidung C). Aufwand A: L, Migration ja; B: M, Migration nein.

---

#### NUD-190 · Kundenstatus-Link (nach NUD-172)
**Status:** todo · **depends_on:** 172 · Quelle: Blackbox-QA 2026-10-29 §5 Wunsch 10.

**Goal:** Nicht im Produkt; jede „Wo ist meine Lieferung?"-Frage kostet einen Anruf. Der Link ist nur so gut wie das Zeitmodell — deshalb erst nach NUD-172.

**Entscheidung (2026-10-29, Option C):**
> Später, nach NUD-172; jetzt kein Code. Optionen A (signierter, ablaufender Link mit Status und Zeitfenster) und B (Büro verschickt „unterwegs"-Nachricht) bleiben dokumentiert.

**Acceptance criteria**
- [ ] Eigene ACs beim Start (Signatur/Ablauf, Rate-Limit, D19-Grenze „kein Kundenportal", Datenschutz in `docs/privacy.md`).
- [ ] Kein Code in diesem Lauf.

**Implementation notes (NUD-190)**
- Nicht umgesetzt (Entscheidung C).

---

#### NUD-104 · Foto-Nachweis — erweitern (bestehendes Ticket)
**Status:** todo · **depends_on:** 053 · Quelle: Blackbox-QA 2026-10-29 §5 Wunsch 2 (Entscheidung 2026-10-29: erweitern, kein neues Ticket).

**Goal:** Der Sketch ist zu dünn für die Umsetzung. Er wird um die QA-Anforderungen erweitert: Foto je Stopp (Kamera/Galerie wie NUD-083), Speicherung wie Kundenfotos, Sichtbarkeit im Büro, Retention-Eintrag in `docs/privacy.md` §6, Offline-Verhalten über die bestehende Foto-Queue.

**Entscheidung (2026-10-29, Option A):**
> NUD-104 erweitern und nach dem Defekt-Block umsetzen; Aufwand L, Risiko mittel, Migration ja.

**Acceptance criteria**
- [ ] Die ACs unten ersetzen den Sketch und decken Upload, Offline-Queue, Büro-Ansicht, Retention und Berechtigungen ab.
- [ ] Kein Code in diesem Lauf.

**Implementation notes (NUD-104)**
- Erweitert am 2026-10-29 (QA-Gate); Umsetzung folgt nach NUD-172…188.

---

#### NUD-192 · Layout-Refresh des Designers (Büro-Formulare, Tabellen, Login, Auslastung)
**Status:** done · **depends_on:** – · Quelle: Archiv des Designers (Google Drive, `nudel-liefer-app.zip`), importiert 2026-10-31.

**Goal:** Die vom Designer (eigener Claude-Lauf, ohne Git-Zugriff) überarbeiteten Bildschirme ins Repository holen. Es ist eine reine UI-/Text-Überarbeitung: Karten im Bestellformular, Import-Spalte für Nachricht/Screenshot, ruhigere Tabellen und Formulare, Login mit Untertitel und 48-px-Sprachumschalter, zweizeilige Kacheln unter `sm`.

**Umfang:** 26 Dateien, keine neue Server-Action, keine Route, keine Migration, kein neues i18n-Namespace. `AGENTS.md` kommt mit der vom Designer mitgeschriebenen `next dev`-Fassung des Next.js-Blocks zurück.

**Acceptance criteria**
- [x] Der Diff gegen `main` (`4e66e72`) enthält ausschließlich Komponenten, `messages/*.json` und den Next.js-Block in `AGENTS.md`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm i18n:check` grün; `pnpm test` 2084 Einheitstests grün (`kit.test.tsx` prüft den neuen `FormField`-Marker).
- [x] Die 57 fehlgeschlagenen `*.integration.test.ts` scheitern identisch auf `main` ohne lokale Datenbank (`ECONNREFUSED 127.0.0.1:5123`) und sind nicht durch diesen Import verursacht.
- [x] Daten-Testids der e2e-Suite bleiben erhalten (`order-entry`, `order-form`, `screenshot-pane` → `order-import`).

**Implementation notes (NUD-192)**
- Import per Dateivergleich gegen einen `git archive HEAD`-Export: 936 Dateien, davon 26 geändert, keine neuen oder gelöschten Dateien.
- `.embedded-postgres` wurde unter Linux initialisiert (`dynamic_shared_memory_type=posix`, `lc_* = C.UTF-8`) und startet auf Windows nicht; Docker läuft nicht, deshalb keine lokale DB für die Integrationstests. Nicht gelöscht (fremde Umgebung), siehe Runbook.
- Deployt auf den vServer (`deploy.bat`), Health und `/quiz/` unverändert.

---

#### NUD-193 · ORS und Photon vom Entwickler-PC lösen (vor dem Hand-over)
**Status:** todo · **depends_on:** – · Quelle: Betrieb 2026-10-31 (Betreiber-Hinweis).

**Goal:** Routing und Geocoding laufen im Produktivbetrieb auf dem Entwickler-PC (Docker + Reverse-Tunnel), weil der 2-GB-vServer openrouteservice und Photon nicht tragen kann. Für den Piloten ist das tragbar, für die Übergabe nicht: ohne wachen Entwickler-PC plant die App nur noch Näherungswerte und erfindet Koordinaten für neue Kunden.

**Scope:** ein Host mit ≥ 4 GB für ORS + Photon oder ein bezahlter `ORS_API_KEY` (hosted Routing und Geocoding); danach `ORS_BASE_URL` / `PHOTON_URL` in `/etc/delivery-app.env` umstellen bzw. entfernen, Dienst neu starten, Tunnel und Autostart-Eintrag `NudelLieferApp-Tunnel` abbauen.

**Acceptance criteria**
- [ ] `GET /delivery-app/api/health` meldet `routing.mode` und `geocoding.mode` passend zum neuen Provider, und eine echte Tour plus ein neuer Kunde sind gegen ihn geprüft.
- [ ] `/etc/delivery-app.env` enthält keine `127.0.0.1`-Adressen des Entwickler-PCs mehr; Tunnel-Prozess und Autostart-Eintrag sind entfernt.
- [ ] `deploy/local-services/README.md`, `docs/runbook.md` §14, `docs/deploy.md` §13 und der Abschnitt in `AGENTS.md` beschreiben den neuen Zustand.
- [ ] Die verbleibende Abhängigkeit (falls ORS/Photon auf einem zweiten Server bleiben: Erreichbarkeit, Neustartverhalten) steht in `docs/runbook.md`.

**Implementation notes (NUD-193)**
- Am 2026-10-31 geprüft: ORS und Photon antworten vom vServer aus durch den Tunnel (`/ors/v2/health` = ready, Photon `/api` liefert Treffer). Der Photon-Container war zu dem Zeitpunkt ausgestiegen (kein `--restart`), live auf `unless-stopped` umgestellt; `deploy.bat` prüft jetzt beide Provider und warnt, statt zu scheitern.
- Reihenfolge der Ablösung: `deploy/local-services/README.md`, Abschnitt „This is a stopgap, not the final setup".

---

#### NUD-194 · Tagesplanung: Stammtouren mit festen Kunden, Mengen direkt bearbeiten
**Status:** done · **depends_on:** 149 · Quelle: Auftraggeber 2026-11-02 (Wunsch für den Büroalltag).

**Goal:** Das Büro plant den nächsten Liefertag nicht mehr Bestellung für Bestellung, sondern in **Stammtouren**: feste Kundengruppen („Route 1", „Route 2"), die jeden Liefertag dieselben Kunden enthalten und einen festen Fahrer haben (änderbar, wenn er krank ist oder ersetzt wird). Eine neue Seite `/admin/planning` zeigt je Stammtour eine Tabelle mit einer Spalte pro Produkt und den Mengen des Liefertags; die Mengen werden direkt in dieser Ansicht geändert (mehr, weniger, oder 0 = nichts). Unten stehen die Kunden ohne Stammtour, mit „Hinzufügen" für eine Bestellung genau dieses Liefertags.

**Acceptance criteria**
- [x] Neue Modelle `StandingTour` (Name, Standardfahrer, `active`, `sortOrder`) und `StandingTourCustomer` (Reihenfolge = Lieferreihenfolge); Migration `20261102140252_standing_tours`.
- [x] `/admin/planning?date=YYYY-MM-DD` (Standard: nächster Liefertag) zeigt je Stammtour die Kunden des Tages, Produktspalten, Zeilengewicht, Zwischensumme und Gesamtgewicht.
- [x] Mengen sind editierbar; leere/0-Zeilen werden als 0 gespeichert. Ein Kunde mit Bestellung, der nichts will, **behält** seine Bestellung (ohne Positionen) und erscheint als „nichts bestellt"; ohne Bestellung wird nichts angelegt.
- [x] Ein Speichern schreibt normale CONFIRMED-Bestellungen (Lieferzeitraum = ganzer Tag) über die bestehende Order-Tabelle; offene Touren des Tages werden als veraltet markiert.
- [x] Vorbelegung aus der Dauerbestellung des Wochentags, wenn für den Tag noch keine Bestellung existiert (nur Vorschlag, gespeichert wird erst beim Speichern); stornierte Bestellungen schlagen nichts vor.
- [x] Mehrere bestätigte Bestellungen eines Kunden am Tag werden auf die erste zusammengeführt, die übrigen storniert (jeweils auditiert).
- [x] Ab einer freigegebenen Tour des Tages ist die Ansicht schreibgeschützt (Hinweis + Link zur Tourenseite); vergangene Tage ebenso.
- [x] Stammtouren lassen sich anlegen, umbenennen, Fahrer wechseln, Kunden zuordnen und archivieren; ein Kunde gehört zu genau einer aktiven Stammtour. Alle Änderungen auditiert (`standing_tour.*`).
- [x] Bestellungen ohne Position (`buildStops`) werden nie zu Stopps — die Tour fährt niemanden ohne Ware an.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` (2733 + 17 neue), `pnpm i18n:check` grün; Texte in `de`, `en`, `zh-Hans`.

**Implementation notes (NUD-194)**
- Die Stammtour ist **keine** `Tour` (Glossar §3): sie entscheidet nur, welche Zeilen die Planung zeigt. Die Touren baut weiterhin „Touren planen" aus allen bestätigten Bestellungen (D24/D31) — die Stammtour bindet also keine Fahrer an Touren, sondern dokumentiert „wer kennt diese Kunden" (Wunsch des Auftraggebers).
- 0 heißt „nichts bestellt", nicht „storniert": die Bestellung bleibt sichtbar (D32). Eine Bestellung ganz ohne Position entsteht nur so; `buildStops` überspringt sie, damit kein Stopp ohne Ware auf die Tour kommt.
- Der Speicherpfad (`saveStandingDay`) nimmt denselben Advisory-Lock wie `planDay` (`tour:<datum>`), prüft den Touren-Status, die Kunden und die Produkte serverseitig erneut und schreibt nur Zeilen, die sich wirklich geändert haben (kein Audit-Rauschen bei unverändertem Speichern).
- Produktspalten sind alle aktiven Produkte (Katalogreihenfolge); Positionen für deaktivierte Produkte fallen beim Speichern weg.
- Ein Kunde ohne Bestellung und ohne Eingabe wird nicht gespeichert (keine leeren Bestellungen für alle Stammkunden).
- Geprüft im Browser (Playwright, 1280 px, angemeldet): Seite rendert ohne Konsolenfehler und ohne horizontalen Überlauf; Screenshot `docs/screenshots/nud-194-tagesplanung.png`. `pnpm test:e2e` wurde nicht erweitert (die Bildschirmprüfung lief einmalig manuell); abgedeckt sind 6 Komponenten-Tests, 17 Integrationstests und 10 Domain-Tests.
- Offen (Folge-Tickets, nicht Teil dieses Tickets): Wiederherstellen einer archivierten Stammtour in der Oberfläche (die Aktion `setStandingTourActiveAction(id, true)` gibt es schon), und ein Feld `Settings` für „Anzahl der Stammtouren" fehlt bewusst (Obergrenze 12, `MAX_STANDING_TOURS`).

---

#### NUD-195 · Fahrer: „Geliefert" direkt auf der Karte des nächsten Stopps
**Status:** done · **depends_on:** – · Quelle: Auftraggeber 2026-11-02 (Fahrer, die den Weg kennen, sollen nicht erst in die Stopp-Details).

**Goal:** Auf der Startseite des Fahrers steht neben „Navigation starten" ein Knopf **Geliefert**. Ein Tipp meldet den Stopp geliefert, die Karte springt sofort zum nächsten Stopp — ohne Detailseite, ohne Scrollen. Wer navigieren will, tippt wie bisher „Navigation starten"; der Knopf ist auch da, wenn ein Kunde keinen Parkplatz/Adresspunkt hat (dann steht dort „Parkplatz fehlt" und daneben „Geliefert").

**Acceptance criteria**
- [x] `QuickDeliveredButton` in der Karte „Nächster Stopp", in derselben Zeile wie „Navigation starten" (48 px+, `size="xl"`, grün/success mit Häkchen).
- [x] Derselbe Weg wie im Stopp-Screen: `enqueueMutation` in die Offline-Outbox (IndexedDB), eigener `clientMutationId`, idempotent, Nachsenden bei Verbindung; die Karte arbeitet auf der Overlay-Kopie und springt sofort weiter.
- [x] Toast mit **Rückgängig** (10 s, 48-px-Aktionsknopf); nach dem letzten Stopp ohne Rückgängig, weil dieser Tipp die Tour abschließt (NUD-053).
- [x] Doppeltipp löst nur einen Auftrag aus; fehlender Handy-Speicher zeigt eine Fehlermeldung statt eines stillen Verlusts.
- [x] Bei 375 px passen beide Knöpfe nebeneinander („Navigation starten" bricht auf zwei Zeilen um), kein horizontaler Überlauf; 56–69 px hoch.
- [x] Texte aus dem vorhandenen Namespace `driver.status` (5 Sprachen), keine neuen Schlüssel.

**Implementation notes (NUD-195)**
- Bewusst keine Rückfrage vor dem Tipp: der Auftraggeber will einen Tipp; die Rückgängig-Aktion im Toast ist der Schutz. Ein versehentlicher Tipp auf dem Weg zum nächsten Stopp ist damit in 10 s korrigierbar.
- Der Knopf liegt über dem gestreckten Detail-Link der Karte (`relative z-10`), damit ein Tipp dort nicht die Detailseite öffnet.
- Im Browser geprüft (375 px, angemeldet als Demo-Fahrer): Tipp → Karte springt von „Beisl Zum Grünen Baum" auf „Bistro Zur Alten Mühle", Toast „Geliefert: … / Rückgängig", Server-Status des Stopps danach `DELIVERED`; Screenshot `docs/screenshots/nud-195-quick-delivered.png`.
- Tests: 8 Komponenten-Tests (alle 5 Sprachen, Doppeltipp, letzter Stopp, Speicherfehler) plus ein Verdrahtungstest in `today-tour.test.tsx`.

---

#### NUD-196 · Zahlungen: Bar bei Lieferung oder Monatsrechnung
**Status:** done · **depends_on:** 033 · Quelle: Auftraggeber 2026-11-02.

**Goal:** Jede Bestellung sagt, wie sie bezahlt wird: **Monatsrechnung** (Standard, am Monatsende als Sammelrechnung je Kunde) oder **Bar bei Lieferung**. Der Fahrer erfasst beim Stopp, was er tatsächlich kassiert hat; das Büro sieht offene Barzahlungen und offene Monatsrechnungen und kann eine Monatsrechnung als bezahlt vermerken.

**Acceptance criteria**
- [x] `Order.paymentTerm` (`MONTHLY` Standard / `ON_DELIVERY`) und `Order.amountCents` (optional, ganze Cent); im Bestellformular wählbar, in der Bestellansicht sichtbar, im Audit-Diff.
- [x] Keine Katalogpreise (D33): das Formular nimmt einen Betrag wie `42,50`; ungültige Beträge werden abgelehnt, nicht gerundet.
- [x] Offline-fähige Fahrer-Erfassung: Karte „Barzahlung" auf dem Stopp mit „zu kassieren" (Summe der Bar-Bestellungen des Stopps), vorbelegtem Betrag, änderbar; speichert als Outbox-Mutation (`payment`), idempotent, wird beim nächsten Kontakt gesendet, erscheint sofort über das Overlay. Erfassung erst auf einem gelieferten Stopp.
- [x] `/admin/payments`: Übersicht offener Beträge, Liste offener Barzahlungen je Stopp (mit Link zur Tour) und offener Monate je Kunde; oben „Zahlungen" in der Navigation.
- [x] Monatsseite je Kunde (`/admin/payments/<kunde>?month=YYYY-MM`): alle Bestellungen des Monats mit Betrag, Summe, Hinweis auf Bestellungen ohne Betrag, Druckknopf, „Als bezahlt markieren" + „Bezahlt-Markierung zurücknehmen".
- [x] `MonthlyPayment` speichert Summe und Anzahl als Snapshot beim Markieren (Bestellungen können später geändert werden); Zurücknehmen setzt `voidedAt` statt zu löschen; alles auditiert (`monthly.pay`, `monthly.unpay`, `stop.payment`).
- [x] Ein Monat lässt sich erst nach seinem Ende markieren; ein laufender Monat steht als „laufender Monat" da.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` grün; Texte in `de`, `en`, `zh-Hans` und die Fahrer-Karte in allen fünf Sprachen.

**Implementation notes (NUD-196)**
- Beträge sind überall ganze Euro-Cent (`Int`); `src/domain/money.ts` parst `42`, `42,50`, `42.5` und lehnt Tausenderpunkte, Minus und mehr als zwei Nachkommastellen ab.
- Die Bar-Karte erscheint nur, wenn der Stopp Bar-Bestellungen hat — Monatsbestellungen zeigen dem Fahrer keine Beträge. Das war Absicht (D7: der Fahrer braucht keine Preise).
- Die Monatsauswertung aggregiert in SQL (`date_trunc('month', "deliveryDate")`), nicht in JS; die Monatsseite lädt nur die Bestellungen genau eines Monats.
- Der „offene" Barfall ist bewusst nur „nichts kassiert" oder „zu wenig": Überzahlung ist kein offener Posten, sie steht im Audit-Verlauf und im Betrag der Monatsseite.
- Zwei beim Browser-Test gefundene Fallen, die jetzt Tests bewachen: der In-Outbox-Eintrag muss `collectedCents` mitkopieren (sonst lehnt der strenge Sync-Vertrag den Eintrag mit 400 ab), und ein `payment`-Eintrag darf auf einer **abgeschlossenen** Tour erfasst werden — der letzte Stopp schließt die Tour, und genau dort wird kassiert (`payments.integration.test.ts`, Fall „last stop").
- Geprüft im Browser (Playwright, 1280 px Büro / 375 px Fahrer, angemeldet): Zahlungsseite (eine offene Barzahlung 42,50 €, 20 offene Monate), Monatsseite (3 Bestellungen, „Als bezahlt markieren", Drucken), Bestellformular (Zahlungsart + Betrag 42,50), Fahrer-Stopp: „Bei Lieferung zu kassieren: 18,90 €" → nach „Geliefert" Betrag änderbar → „Kassiert: 15,00 €, 3,90 € fehlen noch"; Server danach `Stop.collectedCents = 1500`. Screenshots `docs/screenshots/nud-196-zahlungen.png`, `nud-196-monatsrechnung.png`, `nud-196-fahrer-barzahlung.png`.
- Ein bekannter, nicht von diesem Ticket stammender Dev-Hinweis bleibt: die Stopp-Seite meldet in der Konsole `Next.js encountered URL data during prerendering` (Route ohne `<Suspense>` um `params`); Verhalten unverändert, kein Fehler im Betrieb.
- Offen (Folge-Tickets): manuelle Korrekturposition auf der Monatsrechnung (Rabatt/Gutschrift), Export/PDF-Datei für die Buchhaltung, und eine Bezahlt-Liste als eigene Seite (aktuell die letzten 20 auf der Zahlungsseite).

---

#### NUD-200 · Nightly backup of the master data on the server
**Status:** done · **depends_on:** 094 · Source: new owner 2026-11-13 (hand-over protocol 6.4 promises a weekly backup; none existed).

**Goal:** Production has a backup that really runs, and it holds only what the owner wants kept. Finding: the workflow of NUD-094 failed on 2026-11-01 and 2026-11-08 because the `BACKUP_*` secrets were never set — and it could not have worked with them either: since 2026-11-04 the database is PostgreSQL 18 on `127.0.0.1` of the dedicated server, which a GitHub runner cannot reach, and the workflow installed `pg_dump` 16. Owner's decisions on 2026-11-13: store on the server only; keep settings, customers and standing tours ("Routen"), never orders, invoices or payments.

**Acceptance criteria**
- [x] `pnpm backup:db` runs on the server and writes to `BACKUP_LOCAL_DIR`; the database connection falls back to `DATABASE_URL_UNPOOLED` / `DATABASE_URL`.
- [x] The dump carries the whole schema but rows only for `BACKED_UP_TABLES` (`scripts/lib/backup.ts`): settings, users, working hours, vehicles, products, customers, parking spots, photo records, standing tours, standing orders. Every other table that exists is left out, also one nobody classified; the dump is checked and refused if it contains such rows.
- [x] A test forces every Prisma model onto `BACKED_UP_TABLES` or `NOT_BACKED_UP_TABLES` and fails when a kept table references a left-out one (the restore could not create that foreign key).
- [x] `deploy/backup/`: `nudel-backup.service` + `nudel-backup.timer` (every night 02:23 UTC, as `deliveryapp`, hardened) and an idempotent `install.sh` that creates `/var/backups/nudel/db`, a commented `/etc/nudel-backup.env`, enables the timer and takes the first backup.
- [x] Nothing leaves the server. The bucket destination (`BACKUP_S3_*`, from NUD-094) stays in the code, off; `.github/workflows/backup.yml` no longer dumps and is skipped (green) unless the bucket secrets exist, in which case it checks age (`pnpm backup:verify --max-age-hours`) and test-restores into PostgreSQL 18.
- [x] `docs/deploy.md` 13, `docs/runbook.md` 5, `docs/privacy.md`, `docs/env.md`, `.env.example`, `AGENTS.md` describe this setup.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` green.

**Implementation notes (NUD-200)**
- No UI, no migration, no change to the running app: only `scripts/backup/*`, `scripts/lib/backup.ts`, `deploy/backup/*`, the workflow and docs. A deploy that only brings these files needs no rebuild and no restart.
- A restore gives a working app (schema, migrations, admin, settings, customers, standing tours) with empty order, tour and payment tables. A full copy, for example before a risky migration or to move to another server, is a one-off `pg_dump` by hand (`docs/runbook.md` 5.1), to be deleted afterwards.
- Verified locally against real PostgreSQL 16 and 18.7 servers (with the matching `pg_dump` / `pg_restore`) and a real S3 server (MinIO): folder only, folder + bucket, wrong bucket key (folder copy kept, exit 1, key not in the output), test restore from bucket and from folder, age limit; master-data dump of a database with orders, payments and audit rows restores with those tables empty; `install.sh` twice in a row with a stand-in for `systemctl` (an unrelated file in `/var/backups/nudel` stays untouched). **Not verified:** the real systemd sandbox (`ProtectSystem=strict`) on the server — the first run of `install.sh` shows it.
- 👤 HUMAN: bring the files to the server, then `bash /opt/delivery-app/deploy/backup/install.sh` (`docs/deploy.md` 13.1).
- Known limits, accepted by the owner: the backups die with the server; nothing alerts when the job stops; photos (MinIO on the same server) have no backup; orders and payments cannot be recovered.

---

#### Ein-Zeilen-Eintrag (aus F13, nicht umgesetzt)
**NUD-191 · Checklisten-Zeilen brauchen explizite Accessible Names** — Status: todo · Quelle: Blackbox-QA 2026-10-29, F13. Die Zeilen sind bereits `<button role="checkbox" aria-checked>` (e2e klickt sie per Rolle); offen ist nur der vorlesbare Name (bisher der zusammengesetzte Kindtext). Aufwand S, ein e2e-Locator per Name. Kein Ticket im QA-Block, weil der Befund als solcher nicht reproduzierbar war.

### M2.8 — Offene Punkte aus dem Übergabe-Protokoll 2026-11-12 (NUD-197…199)

Quelle: Übergabe-Protokoll Kap. 7.2 („Abrechnungsexport", „Korrekturzeile", „Bezahlt-Liste") und die Folge-Tickets aus den Notizen von NUD-196. Auftrag des neuen Eigentümers vom 2026-11-13. Reihenfolge 197 → 198 → 199, weil Export und Summen auf der Korrekturzeile aufbauen.

#### NUD-197 · Monatsrechnung: Korrekturzeile (Rabatt, Gutschrift, Zuschlag)
**Status:** done · **depends_on:** 196 · Quelle: Übergabe-Protokoll 7.2.

**Goal:** Das Büro kann auf der Monatsrechnung eines Kunden Korrekturen eintragen: ein kurzer Text und ein fester Euro-Betrag, als Abzug (Rabatt, Gutschrift) oder als Zuschlag. Die Korrekturen zählen in die Summe des Monats, überall wo diese Summe steht.

**Acceptance criteria**
- [x] Tabelle `MonthlyAdjustment` (`customerId`, `periodStart`, `label` max. 120 Zeichen, `amountCents` mit Vorzeichen und nie 0, `createdAt`, `createdById`, `voidedAt`, `voidedById`); Migration nur additiv.
- [x] Summe der Monatsrechnung = Bestellungen + aktive Korrekturen, an allen vier Stellen gleich: Monatsseite, Liste der offenen Monate, Summe „Offen auf Monatsrechnung", Snapshot beim „Als bezahlt markieren". Die Zwischensumme der Bestellungen bleibt auf der Monatsseite sichtbar.
- [x] Monatsseite: Abschnitt „Korrekturen" mit Liste, Formular (Abzug oder Zuschlag, Text, Betrag wie im Bestellformular: `10`, `10,50`) und Entfernen je Zeile. Die Zeilen erscheinen im Druck, das Formular nicht.
- [x] Solange der Monat als bezahlt markiert ist, sind Hinzufügen und Entfernen gesperrt (Server und Oberfläche); nach „Bezahlt-Markierung zurücknehmen" geht es wieder. So bleibt der Snapshot wahr.
- [x] Entfernen löscht nicht, sondern setzt `voidedAt` (Soft delete); beides auditiert (`monthly.adjust`, `monthly.adjust_remove`) mit Ids und Betrag, ohne den Text.
- [x] Korrekturen gehen auch im laufenden Monat (ein Rabatt wird oft vorab vereinbart).
- [x] Server-Actions mit `requireRole("ADMIN")`, Zeilen in der Autorisierungs-Matrix, zod-Grenzen; Texte in `de`, `en`, `zh-Hans`; `docs/privacy.md` Abschnitt 6 nennt den neuen Freitext.

**Implementation notes (NUD-197)**
- `MonthlyAdjustment` speichert den Betrag mit Vorzeichen (negativ = Abzug, positiv = Zuschlag); das Formular nimmt einen positiven Betrag und die Art, `signedAdjustmentCents` setzt das Vorzeichen. `billTotalCents` (`src/domain/payment.ts`) ist die eine Summenformel für Monatsseite, Liste der offenen Monate und Snapshot.
- Sperre: `addMonthlyAdjustment` / `removeMonthlyAdjustment` (`src/server/monthly-adjustments.ts`) antworten `locked`, solange ein gültiger Bezahlt-Vermerk existiert. Markieren, Hinzufügen und Entfernen nehmen in ihrer Transaktion zuerst eine Zeilensperre auf den Kunden (`lockCustomerBilling`), damit keine Korrektur zwischen Summe und Snapshot rutscht.
- Eine Gutschrift darf größer sein als die Bestellungen des Monats; die Summe wird dann negativ (Guthaben des Kunden). Ein Betrag von 0 wird abgelehnt.
- Oberfläche: der Fuß der Bestelltabelle liest sich wie auf einer Papierrechnung (Zwischensumme, Korrekturen mit Vorzeichen, Summe); ohne Korrekturen steht dort nur das Formular. Eine neue Zeile gleitet ein, die Summe oben pulsiert einmal kurz (`ConfirmPulse`), beides ohne Bewegung bei `prefers-reduced-motion`.
- Das Audit-Log hält Id, Monat und Betrag, nie den Text (`monthly.adjust`, `monthly.adjust_remove`); `docs/privacy.md` Abschnitt 6 nennt `MonthlyAdjustment.label`.
- Nebenbei: Tippfehler „nothing“ in der deutschen Meldung `nothing_to_pay` behoben; der Knopf-Druck skaliert jetzt auf 0,97 (Projektregel).
- Nach der Code-Durchsicht: eine Korrektur braucht mindestens eine bestätigte Bestellung auf Monatsrechnung im selben Monat (`no_orders`), sonst stünde sie in einem Monat, den weder die Liste der offenen Monate noch der Export kennt. Die Monatsseite zeigt dann einen Hinweis statt des Formulars. Das Formular sendet bei einem Doppelklick nur einmal. `markMonthlyPaid` liest die Bestellungen erst nach der Zeilensperre; die Sperre ist `FOR NO KEY UPDATE`, damit sie das Anlegen von Bestellungen nicht blockiert. Die Tabelle lehnt einen Betrag von 0 selbst ab (`CHECK`).
- Tests: `payment.test.ts` (Summenformel), `monthly-adjustments.integration.test.ts` (15 Fälle: Summe, Monat/Kunde, Validierung, Liste, Snapshot, Sperre, Soft delete, Audit), `monthly-bill-adjustments.test.tsx` (8 Fälle), Autorisierungs-Matrix, `format.test.ts`.

#### NUD-198 · Monatsrechnung: Export als PDF und CSV für die Buchhaltung
**Status:** done · **depends_on:** 197 · Quelle: Übergabe-Protokoll 7.2.

**Goal:** Die Monatsrechnung eines Kunden lässt sich als Datei herunterladen: als PDF (dasselbe wie die Druckansicht, aber als fertige Datei) und als CSV (für Excel und die Buchhaltung). Dazu eine CSV mit allen Kunden eines Monats, damit die Buchhaltung nicht jede Rechnung einzeln holen muss.

**Acceptance criteria**
- [x] `GET /api/admin/payments/export?month=YYYY-MM&customer=<id>&format=pdf|csv&locale=<de|en|zh-Hans>`: nur ADMIN (401/403 sonst), `Cache-Control: private, no-store`, `Content-Disposition: attachment` mit Dateiname `monatsrechnung-<Kundennummer>-<YYYY-MM>.<pdf|csv>`. Ohne `customer` nur CSV: alle Kunden mit Bestellungen auf Monatsrechnung in diesem Monat (`monatsrechnungen-<YYYY-MM>.csv`). Ungültige Parameter → 400, unbekannter Kunde → 404.
- [x] CSV: eine Zeile je Bestellung und je Korrektur mit Monat, Kundennummer, Kunde, Datum, Art, Beschreibung, Betrag, Status des Monats, Bezahlt-Datum und bezahltem Gesamtbetrag des Monats. UTF-8 mit BOM, CRLF. Format nach Sprache: `de` → Trenner `;`, `42,50`, `31.10.2026` (deutsches Excel); `en` und `zh-Hans` → Trenner `,`, `42.50`, `2026-10-31`. Bestellung ohne Betrag → leere Zelle. Textzellen, die mit `=`, `+`, `-`, `@` beginnen, bekommen ein `'` davor (CSV-Injection).
- [x] PDF (A4): Absender (Depot aus den Einstellungen), Empfänger (Firma oder Name, Rechnungsadresse falls gepflegt, UID), Monat, Tabelle Datum / Produkte / Betrag, Zwischensumme, Korrekturen, Summe, Status (offen oder „Bezahlt am …"), Hinweis auf Bestellungen ohne Betrag, Seitenzahlen; lange Monate brechen sauber auf Folgeseiten um.
- [x] Monatsseite: „PDF" und „CSV" neben „Drucken". Zahlungsseite: Monat wählen und „Alle Kunden als CSV".
- [x] Zeile in der Autorisierungs-Matrix; keine neuen Umgebungsvariablen.

**Implementation notes**
- Aufbau in drei Schichten, jede für sich getestet: `src/domain/bill-export.ts` (CSV-Text, Dateiname, Download-Adresse), `src/domain/bill-pdf-layout.ts` (Seitenaufbau als Zeichenanweisungen, ohne PDF-Bibliothek), `src/server/bill-pdf.ts` (malt die Anweisungen mit `pdf-lib`). `src/server/bill-export.ts` holt die Daten (dieselbe Abfrage wie die Monatsseite) und `src/server/bill-export-api.ts` ist der Route-Handler mit `requireRole("ADMIN")`.
- Schrift im PDF: DejaVu Sans aus `assets/fonts` (freie Lizenz liegt daneben), als Teilmenge eingebettet. Chinesische Zeichen (Kundenname, Produkt, Notiz) schreibt Noto Sans SC (`NotoSansSC-Subset.ttf`, auf die 6.763 Zeichen von GB 2312 gekürzt, rund 2 MB); sie wird nur gelesen und eingebettet, wenn eine Rechnung sie braucht. Die Beschriftung der Rechnung bleibt Deutsch oder Englisch. Wie die Datei gebaut wurde, steht in `assets/fonts/README.md`. Die Dateien werden zur Laufzeit aus dem Projektordner gelesen; der Ordner `assets/` muss also mit auf den Server (das Deploy packt den ganzen Projektordner).
- Neue Abhängigkeiten: `pdf-lib`, `@pdf-lib/fontkit`. Keine neuen Umgebungsvariablen, keine Migration.
- Die Datei ist eine Aufstellung für Büro und Kunde, keine Rechnung im Sinn des Umsatzsteuergesetzes: sie hat keine Rechnungsnummer und weist keine Umsatzsteuer aus. Ob das gebraucht wird, ist eine offene Frage an den Kunden.
- Der Download wird nicht ins Audit-Log geschrieben (wie das Ansehen der Monatsseite auch nicht).
- Nach der Code-Durchsicht: bei einem bezahlten Monat steht der bezahlte Betrag in der Datei (CSV-Spalte „Bezahlt gesamt", im PDF „Bezahlt am … über …" und ein Hinweis, wenn er von der heutigen Summe abweicht). Lange Texte brechen um, statt über den Rand zu laufen (Absender, Empfänger, Fußzeile; eine Bestellung oder ein Rechnungsfuß, der länger ist als eine Seite, läuft auf der nächsten weiter). Die Download-Knöpfe holen die Datei per `fetch` und zeigen eine Meldung, wenn der Server ablehnt (abgelaufene Sitzung), statt die Fehlerantwort als Datei zu speichern; die Adresse trägt den Basis-Pfad (`withBasePath`).

#### NUD-199 · Zahlungen: Bezahlt-Historie als eigene Seite
**Status:** done · **depends_on:** 196 · Quelle: Übergabe-Protokoll 7.2.

**Goal:** Alle als bezahlt vermerkten Monate stehen auf einer eigenen Seite, nicht nur die letzten 20 auf der Zahlungsseite: wann bezahlt, welcher Kunde und Monat, welcher Betrag, wer es vermerkt hat und mit welcher Notiz.

**Acceptance criteria**
- [x] `/admin/payments/history`: gültige Bezahlt-Vermerke (nicht zurückgenommen), neueste zuerst, 50 je Seite mit Blättern. Spalten: Bezahlt am, Kunde (Name, Nummer), Monat, Bestellungen, Betrag (Snapshot), Vermerkt von, Notiz; die Zeile führt zur Monatsrechnung.
- [x] Filter: Jahr des abgerechneten Monats und Suche nach Kundenname oder Kundennummer; Anzahl und Summe der Treffer stehen darüber. Leerer Zustand mit und ohne Filter.
- [x] Zahlungsseite: „Bezahlt vermerkt" zeigt die letzten 5 und verlinkt auf die Historie.
- [x] Zurückgenommene Vermerke stehen nicht in der Liste (der Verlauf dazu bleibt im Audit-Log).
- [x] Texte in `de`, `en`, `zh-Hans`; geprüft bei 1280 px.

**Implementation notes**
- `src/server/payment-history.ts` (`paidHistoryQuery`): eine Abfrage für die Zeilen, eine für Anzahl und Summe aller Treffer, eine für die Jahre des Filters. Suche wie in der Kundenliste über `Customer.searchText` (ohne Akzente: „muller" findet „Müller"). Eine Seite hinter dem Ende zeigt die letzte Seite.
- Filter und Seite stehen in der URL (`src/lib/payment-history-params.ts`), die Filterleiste ist wie bei den Kunden gebaut (`payment-history-filters.tsx`).
- Der Betrag in der Historie und in „Bezahlt vermerkt" auf der Zahlungsseite ist der Snapshot des Vermerks (`MonthlyPayment.amountCents`), nicht die heutige Summe der Bestellungen.
- Zeilen blenden gestaffelt ein (`.row-enter` in `globals.css`, 30 ms je Zeile, höchstens zwölf Stufen, aus bei „weniger Bewegung").
- Nebenbei: „Bezahlt am" auf der Monatsseite zeigt jetzt den Tag in der Zeitzone der Fabrik (`fmt.dayOfMoment`); vorher konnte ein Vermerk kurz nach Mitternacht den Vortag zeigen. Die Knöpfe der Monatsseite werden nicht mehr mitgedruckt.

#### NUD-201 · Bezahlte Bestellungen, Touren und Monatsrechnungen automatisch löschen
**Status:** done · **depends_on:** 196 · Quelle: Übergabe-Protokoll 7.2, Entscheidung des Kunden vom 13.11.2026.

**Goal:** Der Kunde will Bestellungen, Touren und Rechnungen nicht aufbewahren. Was bezahlt ist, wird 30 Tage nach der Bezahlung endgültig gelöscht. Was nicht bezahlt ist, bleibt, egal wie alt. Einstellungen, Kunden, Produkte, Stammtouren und Daueraufträge bleiben immer.

**Acceptance criteria**
- [x] Monatsrechnung: 30 Tage nachdem das Büro den Monat als bezahlt markiert hat, gehen die Bestellungen des Monats, ihre Stopps, der Bezahlt-Vermerk und die Korrekturzeilen des Monats. Ein offener oder zurückgenommener Monat bleibt.
- [x] Bar bei Lieferung: 30 Tage nachdem der Fahrer den vollen Betrag kassiert hat. Offene oder nur zum Teil bezahlte Barbeträge bleiben. Eine gelieferte Barbestellung ohne Betrag zählt ab der Lieferung. Hat der Fahrer den Stopp einer freigegebenen Tour nie abgehakt und es ist dort Geld fällig, bleibt die Bestellung (niemand weiß, ob bezahlt wurde).
- [x] Stornierte Bestellungen, Entwürfe und Barbestellungen, die nie geliefert wurden (keine Tour, Tour nie freigegeben oder Problem gemeldet): 30 Tage nach dem Liefertag.
- [x] Eine Bestellung und ihr Stopp gehen nur zusammen: liegt an einem Stopp noch etwas Unbezahltes, bleiben der Stopp und alle seine Bestellungen. Eine Tour verliert ihre bezahlten Stopps einzeln und verschwindet, wenn kein Stopp mehr übrig ist.
- [x] Screenshots, die zu keiner Bestellung mehr gehören, werden mit gelöscht (Datei und Zeile).
- [x] Nie angefasst: Kunden, Produkte, Benutzer, Einstellungen, Stammtouren, Daueraufträge, Kundenfotos, Parkplätze, das Änderungsprotokoll.
- [x] Schalter `ORDER_RETENTION_MODE` (`dry-run` als Standard: zählt nur; `delete`; `off`) und `ORDER_RETENTION_DAYS` (Standard 30, 7 bis 3650). Ohne ausdrückliches `delete` wird nichts gelöscht. Ein gesetzter, aber unbrauchbarer Wert (`60d`, `4000`) fällt nicht auf 30 zurück: der Lauf verweigert.
- [x] Route `GET /api/cron/order-retention` (Bearer `CRON_SECRET`), täglich 03:57 UTC; Zeile in der Autorisierungs-Matrix.
- [x] Daueraufträge mit „nach N Lieferungen" zählen ihre erzeugten Bestellungen selbst (`RecurringOrder.generatedCount`), damit gelöschte Bestellungen das Kontingent nicht zurückgeben. Die Einheit eines Produkts bleibt gesperrt, solange ein Dauerauftrag es benutzt.
- [x] Die Monatsseite und die Bezahlt-Historie sagen, ab wann gelöscht wird, aber nur wenn das Löschen eingeschaltet ist. Texte in `de`, `en`, `zh-Hans`.

**Implementation notes**
- `src/domain/order-retention.ts`: `purgeSelection` (was darf zusammen gehen, rein und für sich getestet), `deletionDue`, die Grenzen der Frist. `src/server/order-retention.ts`: `purgeSettledOrders`, die Regel „bezahlt und Frist vorbei" als eine SQL-Bedingung (`settledSql`), `orderRetentionMode`, `orderRetentionDays`, `orderRetentionPolicy` (für die Seiten). `src/server/order-retention-cron.ts` und `src/app/api/cron/order-retention/route.ts` wie die anderen Aufräum-Jobs.
- Ablauf je Lauf: Stapel von 200 Bestellungen (höchstens 25 je Lauf, der Rest am nächsten Tag), jeder Stapel in einer Transaktion. Vor dem Löschen werden Stopps, Bestellungen und Bezahlt-Vermerke gesperrt und die Auswahl noch einmal getroffen; nimmt das Büro in dem Moment einen Vermerk zurück, löscht der Stapel nichts. Danach: alte Stopps ohne Bestellung, alte Touren ohne Stopp, Bezahlt-Vermerke und Korrekturen von Monaten ohne Bestellung, dann die Screenshots.
- Ein Bezahlt-Vermerk bleibt, solange eine Bestellung seines Monats noch warten muss (sie teilt sich einen Stopp mit etwas Unbezahltem); ohne den Vermerk sähe sie wieder offen aus.
- Zeiten werden in UTC verglichen, der Liefertag in der Zeitzone der Fabrik (`Settings.timezone`).
- Migration `20261113100000_recurring_generated_count` (neue Spalte, gefüllt mit der heutigen Zahl der Bestellungen je Dauerauftrag). Keine neue Abhängigkeit. Neue Umgebungsvariablen: `ORDER_RETENTION_DAYS`, `ORDER_RETENTION_MODE` (`.env.example`, `docs/env.md`).
- Der Lauf schreibt keinen Eintrag ins Änderungsprotokoll (Systemlauf ohne Benutzer, Ausnahme in `audit-coverage.test.ts` begründet); die Zahlen stehen in der Antwort und in einer Logzeile `[order-retention]`.
- Folgen, die man kennen muss: Auslastung, Bezahlt-Historie und Export zeigen nur noch, was nicht gelöscht ist. Das Änderungsprotokoll behält seine Einträge zu gelöschten Bestellungen bis zu seiner eigenen Frist (`AUDIT_RETENTION_DAYS`, Standard 730 Tage, mindestens 90).
- Zwei Läufe gleichzeitig (Cron und Aufruf von Hand) arbeiten ihre Stapel abwechselnd ab (`pg_advisory_xact_lock`).
- Aus der Code-Durchsicht: Dauerauftrags-Kontingent und Einheiten-Sperre (oben), strengere Bar-Regel für nie abgehakte Stopps, kein stiller Rückfall auf 30 Tage bei einem Tippfehler, eine Lieferung ohne jede Zeitangabe gilt nie als alt genug.
- Der zuerst gebaute Ansatz (Archiv mit eigenem Zugriff) ist verworfen und nicht im Repository.
- Doku: `docs/audit-and-retention.md` (Regeln), `docs/privacy.md` Abschnitt 6, `docs/runbook.md` Abschnitt 10 (Einschalten), `docs/deploy.md` (Cron-Zeile), `AGENTS.md`, Hilfeseite (`content/hand-off`).
- Tests: `order-retention.test.ts` in `src/domain` (Auswahlregel) und `src/server` (Schalter, Route), `order-retention.integration.test.ts` (35 Fälle auf echter Datenbank), `recurring-order-patterns.integration.test.ts` (Kontingent nach dem Löschen), `product-actions.integration.test.ts` (Einheiten-Sperre), `deletion-notice.test.tsx`.

---

#### NUD-202 · Hosting on Railway instead of the dedicated server
**Status:** in-progress · **depends_on:** 200 · Source: owner 2026-11-13 ("spiel alles auf railway rauf"; `nudel.stragas.com` is not used any more).

**Goal:** The app runs in the owner's own Railway account with everything the dedicated server gave it: database, photo storage, the seven scheduled jobs, the master-data backup, routing and geocoding. A push deploys; nobody needs SSH.

**Acceptance criteria**
- [x] A virtual-hosted bucket works: `S3_URL_STYLE=virtual` (`BACKUP_S3_URL_STYLE` for the backup) makes the storage clients sign `https://<bucket>.<endpoint host>/<key>` and the CSP allow that host. Unset keeps path style, so MinIO, R2 and the dedicated server behave as before.
- [x] `pnpm bucket:cors [--apply]` puts the CORS rule a bucket on another host needs for the browser upload (origins from `--origin` or `S3_CORS_ORIGINS`, dry run by default).
- [x] `pnpm build:railway` checks the environment first (`checkDeployEnv` knows Railway: `CRON_SECRET` required, no R2 warning, unknown `S3_URL_STYLE` refused).
- [x] `deploy/railway/cron`: one dispatcher run every 5 minutes calls the due `/api/cron/*` routes; its list is asserted against `vercel.json`; a failed job ends the run with exit code 1.
- [x] `deploy/railway/backup`, `deploy/railway/ors`, `deploy/railway/photon`: images for the nightly master-data dump, openrouteservice and Photon; map data is fetched onto a volume on the first start.
- [x] `docs/deploy-railway.md` holds every service setting and variable (there is no `railway.json`); `docs/env.md`, `.env.example`, `AGENTS.md` updated.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` green.
- [ ] 👤 HUMAN: the data of the old server (database, photos, the provider keys in `/etc/delivery-app.env`) is moved (`docs/deploy-railway.md` section 9).

**Implementation notes (NUD-202)**
- No migration, no UI change, no new dependency. The app code changes are the URL style (`src/lib/s3-url-style.ts`, used by `src/server/storage/s3.ts`, `src/lib/security-headers.ts`, `scripts/lib/backup.ts`) and the deploy check.
- `app` is built by Railpack, not by a Dockerfile: the CSP is assembled at build time from service variables, and a Railpack build sees all of them. `next start` already listens on every interface; the systemd unit's `HOSTNAME=127.0.0.1` never restricted it (checked: `next start` ignores `HOSTNAME`).
- Checked locally before the first deploy: a production build without a reachable database; the built app against PostgreSQL 18 with the dispatcher calling all seven routes (wrong secret → 401 → exit 1); the `ors` image with the image's own test extract (download, graph build, health `ready`, a route, a restart that neither downloads nor rebuilds). The Photon and backup images could only be built on Railway (this sandbox cannot reach the map data hosts).

## 9. Decision log (append-only, one line per decision taken during implementation)

| Date | Ticket | Decision | Reason |
|---|---|---|---|
| 2026-10-17 | – | Backlog created from projektbeschreibung.md + clarification interview with product owner | – |
| 2026-10-17 | NUD-001 | Pinned pnpm 12 via `packageManager`; Node >=22 in `engines` | Matches environment, reproducible CI |
| 2026-10-17 | NUD-001 | Import sorting via `eslint-plugin-simple-import-sort`; Prettier printWidth 100 | Simplest option satisfying the ticket |
| 2026-10-17 | NUD-001 | `typecheck` = `next typegen && tsc --noEmit`; CI e2e runs against `pnpm build && pnpm start` | Next 16 global route types; stable e2e |
| 2026-10-17 | NUD-001 | Dropped `next/font/google` (Geist) in favour of system font stacks | §4.3 forbids bundled web fonts; avoids build-time network |
| 2026-10-17 | NUD-002 | Prisma 7.10.1 with `prisma-client` generator + `@prisma/adapter-pg`; DB URL in `prisma.config.ts` | Current stable (latest tag is 8 RC); v7 requires adapter |
| 2026-10-17 | NUD-002 | IDs are `cuid()` strings; `Settings.id` Int default 1; Photo gets index (customerId, kind, isCurrent) instead of a partial unique | Simplest option; uniqueness of current photo enforced in app code (NUD-015) |
| 2026-10-17 | NUD-002 | `db:migrate` = `prisma migrate deploy`, `db:migrate:dev` = `migrate dev`; seed hashes with bcryptjs; seed Hant names by hand | Simplest; auth ticket may revisit hashing |
| 2026-10-17 | NUD-002 | Added `pnpm db:embedded` (embedded-postgres) as Docker-free alternative | Needed to verify without Docker |
| 2026-10-17 | NUD-003 | `src/proxy.ts` (Next 16 name for middleware) does locale redirects itself; next-intl `localeDetection: false` | Required resolution order (user -> cookie -> Accept-Language incl. zh-CN/SG, zh-HK/MO, zh-TW -> de) is not next-intl's default |
| 2026-10-17 | NUD-003 | Bare `zh` and `zh-Hans*` -> zh-Hans; `zh-Hant` without region -> zh-Hant-TW | Simplest mapping for unspecified cases |
| 2026-10-17 | NUD-003 | Language switcher is a native `<select>`; locale persisted by server action (cookie + `User.locale` once sessions exist) | Simplest accessible control |
| 2026-10-17 | NUD-003 | Generated `zh-Hant-*.json` are committed; check fails when stale | Deterministic CI check, no build-step dependency |
| 2026-10-17 | NUD-004 | Keep bcryptjs (cost 12) instead of argon2 | Pure JS, no native binaries on Vercel; already used by the seed |
| 2026-10-17 | NUD-004 | Rate limit in PostgreSQL (`LoginAttempt`): 5 failures per username, 20 per IP, per 15 min | Works across serverless instances without extra infra; office NAT shares one IP so the IP limit is higher |
| 2026-10-17 | NUD-004 | Sessions are absolute (12 h admin / 90 d driver), proxy reads JWT without refreshing the cookie | Auth.js middleware wrapper re-issues the cookie and overwrote logout's cookie deletion |
| 2026-10-17 | NUD-004 | Admin area at `/[locale]/admin`, driver at `/[locale]/driver`, login at `/[locale]/login` and `/[locale]/driver/login`; no route groups yet | Matches paths used by later tickets (`/admin/drivers`); NUD-005 adds layouts |
| 2026-10-17 | NUD-004 | Proxy is only a first line; `requireRole()` re-checks role and `active` in the DB for every action | Role changes/deactivation apply immediately without waiting for JWT expiry |
| 2026-10-17 | NUD-005 | shadcn/ui components written by hand in "new-york" style (+ `components.json`) instead of via the CLI | Registry not reachable from the sandbox; later `shadcn add` still works |
| 2026-10-17 | NUD-005 | Driver pages moved to route group `driver/(app)/`; admin gets `admin/layout.tsx` | Login page must not get the shell; URLs unchanged |
| 2026-10-17 | NUD-005 | Placeholder admin pages re-check the role themselves besides the layout gate | Layouts are not re-rendered on client-side navigation |
| 2026-10-17 | NUD-005 | Localized 404 via `[locale]/[...rest]` + `not-found.tsx`; the catch-all calls `notFound()` at request time (HTTP 200 while streaming) | A prerendered `notFound()` shell cached an unlocalized bare 404; soft-404 is acceptable behind login |
| 2026-10-17 | NUD-005 | No `global-error.tsx`; `[locale]/error.tsx` is the global boundary | Root layout is the locale layout, so intl is available; a root-level fallback would need hard-coded strings (§4.3) |
| 2026-10-17 | NUD-005 | Connection indicator = `navigator.onLine` only | Placeholder; real sync state comes with NUD-081/082 |
| 2026-10-17 | NUD-005 | Dark colour tokens via `prefers-color-scheme` (no theme toggle) | Simplest; Tailwind `dark:` is media-based by default |
| 2026-10-17 | NUD-006 | Client output is always JPEG q 0.8 (not WebP); HEIC is decoded only where the browser can (Safari), otherwise a localized "save as JPEG/PNG" error | Safari cannot encode WebP from canvas; no HEIC decoder bundled (size); server still accepts `image/heic` per ticket |
| 2026-10-17 | NUD-006 | Upload API takes `{ purpose, contentType, size }`; server picks the key and role rules per purpose (screenshot = ADMIN only, customer-photo = ADMIN + DRIVER); oversize -> 413 | Client never controls keys; drivers need photo upload for NUD-083 |
| 2026-10-17 | NUD-006 | Presigned PUT signs content-type + content-length | Limits a leaked URL to one type/size; real enforcement to be confirmed against MinIO/R2 |
| 2026-10-17 | NUD-006 | Without `S3_*` dev/test use `FakeStorage` with a warning, production throws | Keeps the §4.3 Fake convention but avoids silently losing uploads in production |
| 2026-10-17 | NUD-006 | `authErrorStatus` moved to `auth/actor.ts` (re-exported by `guards.ts`); no `dynamic` export on the route | Handler testable without Auth.js; `dynamic` is incompatible with `cacheComponents` |
| 2026-10-17 | NUD-007 | Preview deployments share one Neon branch `staging` (fake data) and an R2 bucket `nudel-photos-staging`; no Neon branch per PR | Per-PR branches (Neon Vercel integration) are feasible but copy production data into previews unless a clean parent is configured; shared staging is free, simpler and keeps real data out. Revisit when parallel PRs with conflicting migrations hurt |
| 2026-10-17 | NUD-007 | Migrations run in the Vercel build (`pnpm build:vercel` = env check + `prisma migrate deploy` + `next build`) using `DATABASE_URL_UNPOOLED`; failed migration fails the build, the old deployment stays live | Simplest; PgBouncer-pooled Neon URLs break migration locks |
| 2026-10-17 | NUD-007 | `/api/health` is public, returns only statuses/latency/short SHA/region, 503 on failure; storage probe = `ListObjectsV2(MaxKeys=1)` via new `Storage.checkReachable()` | Usable by uptime monitors without leaking secrets; works with a bucket-scoped R2 token and detects wrong bucket/credentials |
| 2026-10-17 | NUD-007 | Seed gets `SEED_ADMIN_EMAIL` and `SEED_DRIVERS=false`; production seed runs once from the owner's computer, `SEED_ADMIN_PASSWORD` never lives in Vercel | Avoids a public `admin@example.com` and demo drivers with PIN 123456 on production |
| 2026-10-17 | NUD-008 | Added `User.lastLoginAt` (migration) set on each successful login | List needs "last login"; no other source (sessions are stateless JWTs) |
| 2026-10-17 | NUD-008 | PINs are random 6 digits via `crypto.randomInt`, shown once from client state and never stored; driver usernames normalised to lowercase `[a-z0-9._-]{3,32}`, unique case-insensitively | Simplest option consistent with D13; login already matches case-insensitively |
| 2026-10-17 | NUD-008 | Admin accounts: password >= 10 chars chosen by the creating admin; admins cannot deactivate themselves; no admin PIN/password reset UI | Scope says only "create further admin accounts" |
| 2026-10-17 | NUD-008 | Deactivated users are logged out via `GET /api/session-ended` (deletes the session cookie, redirects to the login page) called from `requirePageActor` | Pages cannot delete cookies; redirecting straight to login looped via the proxy while the JWT was still valid |
| 2026-10-17 | NUD-008 | Language change by the admin does not touch `localeChosen`; creating a driver leaves it `false` | The first-start picker (NUD-050) is the driver's own choice |
| 2026-10-17 | NUD-010 | Allowed countries come from env `ORS_GEOCODE_COUNTRIES` (default `AT,DE`), not from `Settings` | The ticket says "from settings" but `Settings` has no such column; avoiding a migration for a rarely changed value. Can move to Settings in NUD-012 |
| 2026-10-17 | NUD-010 | Missing `ORS_API_KEY` uses the Fake with one warning also in production (no throw) | Ticket demands it; admins must confirm every pin (D9), and the Fake's low confidence (0.3) flags it |
| 2026-10-17 | NUD-010 | Geocoding cache is an in-memory LRU per server instance, no DB table | Simplest option allowed by the ticket; volume is tiny |
| 2026-10-17 | NUD-010 | ORS key sent in `Authorization` header; retry only timeouts/network/5xx/429 | Keeps the key out of URLs and logs; 4xx will not improve |
| 2026-10-17 | NUD-011 | Tile URL/attribution are read server-side (`getMapTileConfig`) and passed to the map components as props; custom `MAP_TILE_URL` without `MAP_TILE_ATTRIBUTION` shows no attribution | Client components cannot read non-`NEXT_PUBLIC_` env; avoids baking tile config into the client bundle |
| 2026-10-17 | NUD-011 | Markers are CSS `divIcon`s; `TourMap.geometry` = GeoJSON LineString coordinates `[lng, lat][]` | Avoids Leaflet's bundler-broken default icons; matches ORS output so NUD-040/042 can pass it through |
| 2026-10-17 | NUD-011 | "Locate address" uses the first geocoder candidate, warns when confidence < 0.5, and goes through the admin-only server action `geocodeAddressAction` | Geocoder only proposes; admin confirms the pin (D9) |
| 2026-10-17 | NUD-012 | `Settings.depotPinConfirmed` column (default false); depot counts as set only when true, so the seed's placeholder depot does not allow tour building | `depotLat/Lng` are NOT NULL and the seed fills them; D9 requires an admin to confirm the pin |
| 2026-10-17 | NUD-012 | `nextDeliveryDate` = first delivery weekday strictly after today in the factory time zone; weekdays are ISO numbers 1 = Monday ... 7 = Sunday; falls back to tomorrow if none | Orders are taken for the next delivery day; default `[1,2,3,4,5]` is Mon-Fri |
| 2026-10-17 | NUD-012 | Settings cached with `'use cache'` + tag `settings`, expired by `updateTag` in the save action (no hand-made in-memory cache) | Works with `cacheComponents` and across instances where the cache handler is shared |
| 2026-10-17 | NUD-012 | Saving the depot requires the "pin checked" box; moving the pin or editing the address clears it | Simplest way to enforce D9 on the depot; the box is the confirmation |
| 2026-10-17 | NUD-012 | `ORS_GEOCODE_COUNTRIES` stays in env | Moving it to Settings needs a column and UI beyond this ticket |
| 2026-10-17 | NUD-013 | Accent-insensitive search = SQL function `nudel_fold` + trigger-maintained `Customer.searchText` + `LIKE`, no `unaccent`/`pg_trgm` | Works unchanged on Neon and embedded Postgres without extensions; 150 customers need no index |
| 2026-10-17 | NUD-013 | List shows active customers by default (status filter active/archived/all), 25 per page with prev/next, sorted by name then number | Simplest; archived are soft-deleted (4.3) |
| 2026-10-17 | NUD-013 | Placeholder `/admin/customers/new` page until NUD-014; `createPrismaClient(url, schema)` sets `search_path` for tests | Avoids 404; raw SQL/trigger need unqualified names to resolve in the test schema |
| 2026-10-17 | NUD-014 | After an address change `pinConfirmed` is only kept if the pin was also moved/searched again (rule shared by form and server); otherwise reset | Satisfies "changing the address resets pinConfirmed" while still allowing a re-confirmation in the same save |
| 2026-10-17 | NUD-014 | Next free number = highest number ending in digits + 1 (prefix and zero padding kept), "1001" if none; uniqueness is case-insensitive | Simple, works for "K-0099" and "1041" style numbers |
| 2026-10-17 | NUD-014 | Driver notes stored as `LocalizedText` with only `de` (source de); a changed text drops old translations, an unchanged one keeps the stored JSON | Multilingual editor and translation come with NUD-071/070 |
| 2026-10-17 | NUD-015 | Photos are managed on the customer detail page only (not on the edit form); archived customers may still get photos | Edit form is master data; scope says "detail/edit", detail suffices and keeps one place |
| 2026-10-17 | NUD-015 | Added `Storage.head(key)`; the attach mutation checks the key pattern `customers/<uuid>.<ext>`, that the object exists, takes `bytes` from storage, and refuses a key used by another photo | Server must prove the key belongs to its upload namespace and was really uploaded; client values are not trusted |
| 2026-10-17 | NUD-015 | One-current-per-kind enforced by a transaction with a row lock on the customer, no partial unique index | Matches the NUD-002 decision (app-level uniqueness); no migration needed |
| 2026-10-17 | NUD-015 | Slot titles "Geschäft / Eingang" / "Parken / Entladen" (zh-Hans "店铺 / 入口" / "停车 / 卸货") replace the old "Geschäftsfoto"/"Parkplatzfoto" labels | Wording from the ticket scope |
| 2026-10-17 | NUD-014 | Country is a 2-letter text field (default AT), stored upper-case; archiving needs a confirmation dialog, reactivating does not | Simplest; no country list needed in v1 |
| 2026-10-17 | NUD-020 | Live OpenCC pre-fill uses a debounced (200 ms) admin-only server action, not opencc-js in the browser | Simplest; keeps the OpenCC dictionaries out of the form's client code (the ~1.3 MB already shipped comes from another import, see NUD-098); the server also recomputes auto fields on save |
| 2026-10-17 | NUD-020 | "auto" = Traditional field flagged in `LocalizedText.meta.machine`; stays auto until the user types in it (button re-derives); hand-edited names are stored unflagged; an empty Traditional field is derived, never stored empty | Reuses the existing LocalizedText flag; D15 says Hant is derived and editable |
| 2026-10-17 | NUD-020 | SKU is trimmed, upper-cased, `[A-Za-z0-9._-]{1,32}`, unique case-insensitively; new products are appended (`max(sortOrder)+1`) | Simplest consistent form; matches the seed's SKUs |
| 2026-10-17 | NUD-020 | A product's unit cannot be changed once it has order items (error `unit_locked`, select disabled) | Changing PACK to KG on old orders would silently alter delivered quantities (client priority 2) |
| 2026-10-17 | NUD-020 | Reordering = up/down buttons over the full list (active and inactive together), renumbering `sortOrder` 0..n-1 in a transaction; the picker query returns active products in that order | Ticket allows drag or up/down; renumbering also repairs ties |
| 2026-10-17 | NUD-020 | Deactivate/reactivate without a confirmation dialog | Fully reversible and affects only new orders; customers need a dialog because of routing impact |
| 2026-10-17 | NUD-030 | Same product twice in one order is MERGED (quantities added), with a hint in the form | Office typing from a chat message may repeat a product; adding is what the customer meant, rejection costs time |
| 2026-10-17 | NUD-030 | Quantity input allows at most 2 decimals; a third decimal (e.g. "1.000") is rejected, never rounded or read as thousands | Correct quantities are client priority 2; "1.000" is ambiguous |
| 2026-10-17 | NUD-030 | Delivery dates before today (factory time zone) are rejected by the server; future dates allowed | A past order can never be routed; avoids typo orders |
| 2026-10-17 | NUD-030 | Delivery date field is a native `<input type="date">` (value `YYYY-MM-DD`), not the calendar popover | No time-zone shift through `Date`, keyboard friendly, simplest |
| 2026-10-17 | NUD-030 | Unconfirmed pin and existing same-day orders are warnings only; saving is allowed. Archived customers and inactive products are rejected on the server and not offered | Ticket scope; routing is blocked later by the tour builder |
| 2026-10-17 | NUD-030 | After saving, the form redirects to `/admin/orders` (minimal list of orders from today on, cancelled included) | Simplest way to show the result; NUD-032 replaces the page |
| 2026-10-17 | NUD-031 | Screenshot is optional on the existing order form; its presence (validated key) makes `source=SCREENSHOT`, the client never sends a source | Simplest; keeps one create path and one authority for `source` |
| 2026-10-17 | NUD-031 | Screenshot key validated like NUD-015 (`screenshots/<uuid>.<ext>` pattern, `Storage.head` must find it, used once); Screenshot row is created in the same statement as the order | No orphan rows, no forged keys |
| 2026-10-17 | NUD-031 | Split view is a CSS grid at `lg` (1024 px) with a sticky pane; "remove" is the only way to change the screenshot (no replace button) | Simplest; paste/upload is offered again after removing |
| 2026-10-17 | NUD-031 | Minimal read-only order detail `/admin/orders/[id]` added here; list date links to it | Ticket requires viewing the screenshot from order detail; NUD-032 extends it |
| 2026-10-17 | NUD-031 | Order form state is reset after a successful save | Next keeps the previous route hidden with its state; otherwise the next new-order form would still hold the saved screenshot |
| 2026-10-17 | NUD-032 | Orders of past delivery days (and cancelled orders) are read-only: no edit, no cancel; they can still be duplicated | A tour for a past day is history; keeps the rules simple and the data honest |
| 2026-10-17 | NUD-032 | Editing keeps the customer and the screenshot fixed (wrong customer: cancel and re-enter); the status can switch DRAFT <-> CONFIRMED, CANCELLED only through cancel and is final | Smallest edit surface; customer change would move stops between customers and tours |
| 2026-10-17 | NUD-032 | Update re-uses `orderInputSchema` with the stored customer injected; a deactivated product may stay in an existing order but cannot be added | One validation path for quantities (client priority 2); no forced removal of old lines |
| 2026-10-17 | NUD-032 | Duplicate creates a DRAFT (source MANUAL, no screenshot, internal note and lines copied) and opens it; same day allowed; needs active customer and products | A copy must be confirmed on purpose so wrong quantities do not slip into a tour unnoticed |
| 2026-10-17 | NUD-032 | Overview default = next delivery date (`getDefaultDeliveryDate`), all statuses incl. cancelled shown until filtered; range capped at 62 days, 300 rows, then a truncation notice | Simplest consistent with NUD-012/030; keeps page and totals readable |
| 2026-10-17 | NUD-032 | Totals panel counts CONFIRMED orders of each date in the range and ignores the customer/status/source filters | It answers what must be produced and loaded that day; a customer filter must not shrink it |
| 2026-10-17 | NUD-032 | `markOutdatedForDate` flags all not COMPLETED tours of the date and is called on every create/update/cancel/duplicate (also for drafts, old and new date on a date change) | Ticket says every change; NUD-043 refines; over-flagging is safe, missing a flag is not |
| 2026-10-17 | NUD-032 | After creating an order the form redirects to the overview filtered to that order's date | The new default filter (next delivery date) would otherwise hide orders for other days |
| 2026-10-17 | NUD-032 | Archiving a customer with upcoming orders shows a warning in the archive dialog but is still allowed; orders are not cancelled | Ticket asks for a small warning only; cancelling is a separate office decision |
| 2026-10-17 | NUD-040 | Result carries a required `approximate: boolean`; `legs` includes the return leg (n + 1); `totalDurationS` excludes service time | Ticket requires `approximate` reporting; the return leg is part of the tour; NUD-041 adds service minutes to ETAs |
| 2026-10-17 | NUD-040 | ORS profile via env `ORS_ROUTING_PROFILE` (`driving-car` default, `driving-hgv`), not a `Settings` column | Ticket says "if a setting says truck"; no column exists and a migration is out of scope (same reasoning as `ORS_GEOCODE_COUNTRIES`) |
| 2026-10-17 | NUD-040 | One 8 s deadline for the whole ORS call (optimization + directions), no retries; any failure falls back to the heuristic | Office waits at most 8 s before an approximate result; retrying would exceed that |
| 2026-10-17 | NUD-040 | Directions are requested in chunks of at most 50 coordinates sharing boundary points | ORS caps waypoints per directions request; 50 stops + depot twice is 52 points |
| 2026-10-17 | NUD-040 | More than 50 stops -> `RoutingError` `TOO_MANY_STOPS` from every provider, never routed on the fallback either; invalid input does not fall back | Ticket demands a documented error; the fallback must not hide caller mistakes |
| 2026-10-17 | NUD-040 | Missing key -> `LocalHeuristicProvider` alone with one warning (also in production); its results are flagged `approximate` | Mirrors NUD-010; the heuristic is an estimate, never presented as road data |
| 2026-10-17 | NUD-041 | `Tour.approximate` is a new column (migration), not part of `geometry` JSON | `geometry` is passed straight to `TourMap`; a flag is cheap to query and a schema-visible fact for NUD-042 |
| 2026-10-17 | NUD-041 | `Tour.totalDurationS` = driving (incl. return leg) + service minutes of all stops; stop `legDurationS`/`legDistanceM` = leg arriving at that stop | The office wants the tour's real length; legs and ETAs stay reproducible from stored values |
| 2026-10-17 | NUD-041 | Re-running is allowed only for DRAFT/OPTIMIZED tours; RELEASED, IN_PROGRESS and COMPLETED return `tour_not_editable` | Replacing stops of a tour the driver may already use would break priority 2; re-release is NUD-043 |
| 2026-10-17 | NUD-041 | Locked tour: kept customers keep their position, new ones are appended in order of their first order, customers with no routable confirmed order left are removed (and reported), legs/ETAs recomputed with `route()` | Ticket says "only adds new customers at the end"; keeping an empty stop would show the driver nothing to unload |
| 2026-10-17 | NUD-041 | Existing stop rows are reused per customer on every re-run (updated in place), not deleted and recreated | Stable stop ids for NUD-042/043 diffs; same outcome as "replace" |
| 2026-10-17 | NUD-041 | No routable stops: error `no_stops` (with the warnings) when no tour exists; an existing unreleased tour is emptied instead | An empty new tour is useless; a stale tour must not keep deleted orders |
| 2026-10-17 | NUD-041 | Dates before today (factory time zone) are refused (`date_in_past`); delivery weekdays are not enforced; archived customers with confirmed orders still get a stop | Same rule as order entry; weekdays only drive defaults; the office cancels orders it does not want delivered |
| 2026-10-17 | NUD-041 | The write is one transaction with a per-date advisory lock that re-checks the tour and confirmed orders (id + `updatedAt`) used for planning; a mismatch returns `conflict` | Routing can take up to 8 s; an order saved meanwhile (whose outdated flag would be missed) must not yield a silently stale tour |
| 2026-10-17 | NUD-042 | Drag and drop is native HTML5 (`draggable`), no DnD library; up/down buttons are the keyboard and touch path | Simplest, no dependency; touch drag is not supported by HTML5 DnD |
| 2026-10-17 | NUD-042 | Manual reorder keeps `locked` as it is and does not lock the tour; re-optimize on an unlocked tour discards manual order (button hint says so); on a locked tour the same button is labelled "update from orders" and keeps the order (NUD-041 rule) | Lock is an explicit office decision (ticket lists it as its own toggle) |
| 2026-10-17 | NUD-042 | All edits (reorder, lock, driver, re-run) of RELEASED / IN_PROGRESS / COMPLETED tours are refused with `tour_not_editable`; the page shows them read-only | Ticket says reject edits to released tours; what NUD-043 may allow is defined there |
| 2026-10-17 | NUD-042 | Release is refused for an outdated tour (`outdated`: orders changed after the tour was built) and for a tour whose `version` (`updatedAt`) differs from the one shown in the dialog (`conflict`) | Priority 2: the driver must not get stale quantities; the office releases exactly what it confirmed |
| 2026-10-17 | NUD-042 | Only active users with role DRIVER can be assigned; the assignment can be cleared (`null`) on an unreleased tour; a deactivated assigned driver blocks release (`driver_invalid`) | Driver accounts are soft-deleted (D13 / 4.3) |
| 2026-10-17 | NUD-042 | Stop "item count" = number of distinct products over the stop's linked orders; "photos missing" flags use the current STORE / PARKING photos of the customer | Ticket asks for item count and missing-photo flags only; quantities are shown by the driver screens |
| 2026-10-17 | NUD-042 | Pin warnings are recomputed from the confirmed orders on every page load (not only after "generate") | They must stay visible after reload and when no tour exists yet |
| 2026-10-17 | NUD-042 | Date picker is a native `<input type="date">` bound to `?date=`; no/invalid date = next delivery date | Same choice as NUD-030/032 |
| 2026-10-17 | NUD-043 | The quantities released to the driver are stored per stop (`Stop.items` snapshot, backfilled by the migration); the driver read model uses the snapshot, not the live order lines | An order edited after release must not change what the driver sees before the office re-releases (priority 2); the snapshot is also the base of the diff |
| 2026-10-17 | NUD-043 | Order changes flag tours only when a CONFIRMED order is involved and something a tour contains changed (customer, day or quantities); the flag is written in the same transaction as the order change | Ticket says 'create/update/cancel'; drafts and no-op saves are not on a tour, and a change without its flag would break priority 2 |
| 2026-10-17 | NUD-043 | `markOutdatedForDate` still flags all not COMPLETED tours of the day (also unreleased ones), the diff on the page decides what really differs | Over-flagging is safe and the release refusal of NUD-042 stays; a re-release with no visible difference just clears the flag |
| 2026-10-17 | NUD-043 | Re-release keeps the order of the open stops, appends new customers, removes open stops without orders and recomputes legs / ETAs with `route()` (no re-optimization); ETAs stay planned values from the departure time, not a live prediction | The driver is already underway and must not see his remaining stops reshuffled; same rule as a locked tour (NUD-041) |
| 2026-10-17 | NUD-043 | Completed stops (DELIVERED / PROBLEM) are frozen: status, completion data, quantities, order links and ETA are never written; later edits to their orders are only reported (`completedChanged`); a new order of an already delivered customer becomes a second open stop at the end | Never reset completed work (ticket); a delivered quantity cannot change retroactively, but the office must be told |
| 2026-10-17 | NUD-043 | A re-release that changes nothing the driver sees (changes cancelled out, or only completed stops edited) clears the flag and does not bump the revision | Otherwise the driver would get a 'Tour was updated' banner without anything to look at |
| 2026-10-17 | NUD-043 | Change data for the driver app: `Tour.releaseRevision` (1 = first release, +1 per effective re-release), `reReleasedAt`, `lastChange` (JSON incl. removed customers' names), `Stop.changeKind` ADDED / CHANGED, `changedInRevision`, `previousItems`; the 'seen' state is kept on the device by NUD-051 | Ticket allows markers or a revision field; both together let the driver app highlight stops it has not seen yet and name removed stops, without a server-side acknowledgement |
| 2026-10-17 | NUD-043 | Re-release needs an assigned, active driver and the `version` (tour `updatedAt`) the office saw; inside the transaction (per-date advisory lock) tour version, stop statuses and confirmed orders are re-checked and writes to open stops are guarded by `status = PENDING`, otherwise `conflict` | Same pattern as release / generate; a stop completed by the driver or an order saved meanwhile must never be overwritten |
| 2026-10-17 | NUD-043 | Status machine: DRAFT -> OPTIMIZED -> RELEASED -> IN_PROGRESS -> COMPLETED, self-transitions only for rebuild (OPTIMIZED), re-release (RELEASED / IN_PROGRESS); a stop is done when it is not PENDING; `syncTourProgress` derives the status from the stops; COMPLETED is final | Matches the ticket; PROBLEM also closes a stop (NUD-053); how Undo interacts with COMPLETED is left to NUD-053 (noted there) |
| 2026-10-17 | NUD-050 | Seeded demo drivers for the four languages have `localeChosen=true`; new seeded `driver-new` has false | Keeps e2e logins deterministic while a demo of the picker remains |
| 2026-10-17 | NUD-050 | After picking a language the driver always lands on the driver home, not on a previous deep link | Simplest; the picker only appears once per driver |
| 2026-10-17 | NUD-050 | Picker is enforced in `requirePageActor` (page guard) for DRIVER only, not in the proxy; admins in support view skip it | Token has no `localeChosen` claim; avoids a DB read per request in the proxy |
| 2026-10-17 | NUD-051 | "Today" = calendar day in `Settings.timezone`; the driver id comes only from the session; an admin in the support view sees the empty state | Authorization by construction (no id from the client); ticket says own tour only |
| 2026-10-17 | NUD-051 | Item summary shows one total per unit (kg, Packungen, Kisten, Stück) next to the number of varieties, never one summed number | Adding packs and kg would be wrong quantities (priority 2) |
| 2026-10-17 | NUD-051 | Remaining time = planned driving legs to the open stops + service minutes per open stop, rounded up to 5 min, without the way back; not shown at 0 | Uses stored plan values only; no live prediction; return leg is not stored per stop |
| 2026-10-17 | NUD-051 | 'Seen revision' stored in `localStorage` per tour id; banner and highlights stay until the driver taps "Verstanden"; current revision is recorded silently while the tour was never re-released | Ticket asks for device-side memory; no server acknowledgement exists |
| 2026-10-17 | NUD-051 | Placeholder route `/driver/stops/[stopId]` (name only, 404 for stops outside the driver's own tour today) until NUD-052; page re-fetches when the app becomes visible | Details button needs a target; a long-open app must notice a re-release |
| 2026-10-17 | NUD-052 | No swipe between stops, only prev / next buttons (disabled at ends); order = tour sequence regardless of status | Swipe is optional in the ticket; buttons are simplest and 48 px accessible |
| 2026-10-17 | NUD-052 | Apple Maps button only when the browser reports iOS/iPadOS; Google Maps button always first | Ticket: secondary option on iOS, detected client-side |
| 2026-10-17 | NUD-052 | Photos shown `contain` in a fixed 4:3 frame; missing photo uses the same frame | Layout never shifts; the whole photo is visible without cropping |
| 2026-10-17 | NUD-052 | DE badge shown whenever the picked note text is German and the UI locale is not German (via `pickWithSource`) | Becomes invisible automatically once NUD-071 adds translations |
| 2026-10-17 | NUD-052 | German product name is shown only when it differs from the displayed name; copied address = "street, postal code city" | Avoids a duplicate line in German; address format matches the list |
| 2026-10-17 | NUD-053 | Idempotency log table `StopMutation` (id = clientMutationId, stored result) in addition to `Stop.clientMutationId` | A single unique column on Stop cannot make undo replay-safe or return the same result for a replay; accepted ids only, rejections are retryable |
| 2026-10-17 | NUD-053 | Once the tour is COMPLETED nothing can be undone (also not the last stop); undoing the only done stop leaves the tour IN_PROGRESS | COMPLETED is final and the tour never moves backwards in the status machine; avoids widening it |
| 2026-10-17 | NUD-053 | Auto-advance = next PENDING stop behind the current one in tour order, else the first open one before it, else the tour screen (finished) | Follows the driving order; never leaves the driver on a done stop while others are open |
| 2026-10-17 | NUD-053 | Stop mutations are not limited to "today"; the stop only has to be in the driver's own RELEASED / IN_PROGRESS tour | Queued offline mutations (NUD-082) may sync after midnight |
| 2026-10-17 | NUD-053 | Status buttons sit in the page flow (slot after items / notes), no sticky bar; Undo also as a button on the result card within the window | Simplest consistent with NUD-052; toast alone is gone after navigation |
| 2026-10-17 | NUD-053 | Problem free text is optional for every reason (also OTHER); source locale = `User.locale` of the acting driver | Ticket says optional; the language switcher keeps `User.locale` in sync with the UI |
| 2026-10-17 | NUD-053 | "Tour finished" screen = enhanced all-done card on `/driver` with delivered / problem counts | The driver is sent there after the last stop; no extra route needed |
| 2026-10-17 | NUD-054 | Polling interval comes from the server env `LIVE_POLL_INTERVAL_MS` (default 30000, range 1000..300000, invalid -> default) and is passed to the client as a prop | Needed a test hook to run e2e faster; the default stays the product value, no `NEXT_PUBLIC_` env baked into the bundle |
| 2026-10-17 | NUD-054 | `router.refresh()` polling only while the tab is visible (hidden ticks are skipped, immediate refresh on becoming visible); dashboard polls unless the tour is COMPLETED, the tour page only for RELEASED / IN_PROGRESS | Ticket makes pausing optional; cheap to do; COMPLETED is final and unreleased tours only change by admin actions |
| 2026-10-17 | NUD-054 | "Today" card shows the latest tour of today's date (factory time zone); an unreleased tour shows a hint, not progress | v1 has one tour per day (D5); progress of a tour the driver cannot see would mislead |
| 2026-10-17 | NUD-054 | Map markers by status: colour plus shape (diamond for problem) plus badge glyph (check / "!"); darker 700 colour shades | Accessibility: status must not depend on colour alone, white text needs AA contrast |
| 2026-10-17 | NUD-054 | The driver's problem text is shown as written (source locale of the `LocalizedText`), labelled "Originaltext des Fahrers", with `lang` set to that locale | German translation for the office is NUD-072 |
| 2026-10-17 | NUD-060 | Demo seed = `pnpm db:seed --demo [--no-photos] [--today]`; depot "Absberggasse 27, 1100 Wien" and the 20 customer addresses are real public Vienna streets, pins are hand-picked street-level approximations (not geocoded) with `pinConfirmed=true` | Fake geocoder points are random inside a box; hand-picked ones are plausible. Real onboarding still needs the admin's pin confirmation |
| 2026-10-17 | NUD-060 | Demo seed needs an S3-compatible store and aborts before writing anything otherwise; `--no-photos` is the explicit escape hatch (CI) | The Fake store lives per process and would lose the photos; CI has no MinIO |
| 2026-10-17 | NUD-060 | Placeholder photos are PNGs from a tiny built-in bitmap-font encoder, text in capitals ("EINGANG"/"PARKEN") plus the customer number; keys are deterministic UUIDs | No image library in the repo; capitals need only 20 glyphs; deterministic keys make reruns idempotent |
| 2026-10-17 | NUD-060 | Demo orders: next delivery day by default, `--today` for a live demo; rerun guard = a demo-marked order with `deliveryDate >= today` exists | The driver sees only today's tour; the guard keeps reruns idempotent without touching admin edits |
| 2026-10-17 | NUD-060 | The happy path creates its own customer + order for TODAY and fails (no skip) when the depot pin is unconfirmed or a tour for today exists; it runs after the plain-seed specs in CI | Never depend on the cached Settings row; a silent skip could hide a broken demo seed |
---
| 2026-10-17 | NUD-070 | Pending marker = optional `meta.pendingTranslation` inside the `LocalizedText` JSON, no new column/table, no migration | Simplest option the ticket offers; it travels with the text, works for every column, and Prisma can filter on the JSON path |
| 2026-10-17 | NUD-070 | Retry job finds records through a registry (`PENDING_SOURCES`: `Customer.notes`, `Stop.problemNote`) and saves only if `meta.updatedAt` is unchanged | Small and explicit; an office edit between read and write is never overwritten |
| 2026-10-17 | NUD-070 | Provider only handles German <-> Simplified (`ZH-HANS`, source `ZH`); Hant via OpenCC; `localize` makes one provider call per text | Ticket; saves quota and keeps HK/TW consistent with the UI strings |
| 2026-10-17 | NUD-070 | `completeTranslation` fills only empty locales and never overwrites existing ones; a German source with any Chinese text present is not sent to the provider | Hand-written / edited translations (D15, NUD-071) must survive a retry |
| 2026-10-17 | NUD-070 | DeepL endpoint via `DEEPL_API_PLAN=free|pro`, default from the `:fx` key suffix; 5 s timeout, 1 retry (timeout/network/5xx/429) | Ticket asks for env-based free/pro; same limits as the geocoder |
| 2026-10-17 | NUD-070 | Missing `DEEPL_API_KEY` -> Fake + one warning (also in production); the cron route then skips and leaves pending texts alone | Mirrors NUD-010/040; the retry must not replace real pending records with prefixed fake text |
| 2026-10-17 | NUD-070 | A provider error ends a retry run; only `INVALID_INPUT` is per-record; 50 records per source and 45 s per run | An outage fails every record the same way; next cron run retries; stays under the 60 s function limit |
| 2026-10-17 | NUD-070 | Cron route `GET /api/cron/retry-translations` authenticates with `Authorization: Bearer $CRON_SECRET`, fails closed (401) when unset; schedule `*/10 * * * *` | Vercel Cron convention; the 10 minute schedule needs the Vercel Pro plan (Hobby = daily), documented |
| 2026-10-18 | NUD-071 | The multilingual editor is a "Translations" tab on the customer detail page with its own save; the customer form keeps editing only the German note | Keeps the form simple; translations are reviewed after the source exists |
| 2026-10-18 | NUD-071 | All four versions are editable in the tab; editing German there is a source change (same merge as the form) and must not be empty | Backlog says "edit any version"; one code path for source changes |
| 2026-10-18 | NUD-071 | "Hand-written" = non-empty Chinese version without `meta.machine[locale]`; "source changed, check translation" is the optional `meta.stale[locale]`, cleared by editing the text, "Mark as checked" or Re-translate | No migration or extra column; an unchanged-but-correct version needs a way to dismiss the flag |
| 2026-10-18 | NUD-071 | Source change: one provider call (Simplified) + OpenCC for Hant, applied to machine/empty versions only; a changed German text with a failing provider empties them and sets `pendingTranslation` | Same cost as NUD-070 `localize`; failures never block saving |
| 2026-10-18 | NUD-071 | "Re-translate" with a failing provider changes nothing and shows an error | Never destroy hand-written text without a replacement |
| 2026-10-18 | NUD-071 | Saves from the tab carry `baseUpdatedAt` and write guarded on `meta.updatedAt`; mismatch returns `conflict` and reloads | Protects against the retry job / a second office user without locks |
| 2026-10-18 | NUD-072 | Non-German problem text is stored with `meta.pendingTranslation` inside the driver's transaction; translation runs afterwards in `after()` (`scheduleProblemNoteTranslation`), the cron retry job is the safety net; `applyStopMutation` itself never calls the translator | Driver mutation can never be delayed or failed by a provider; serverless-safe; same hook reusable by NUD-082 |
| 2026-10-18 | NUD-072 | German problem text: no flag, no translation, no Chinese variants | Office reads German; ticket only asks for German for the office |
| 2026-10-18 | NUD-072 | Admin shows the German text first with a "maschinell übersetzt" badge and a toggle for the original; while pending: "Übersetzung folgt" + original shown | Office needs something readable at once; original always reachable |
| 2026-10-18 | NUD-072 | A late translation is saved only if the note still has the `meta.updatedAt` that was read (existing `stopProblemNoteSource.save`) | Undo or a new report in between must win |
| 2026-10-18 | NUD-073 | CSV is comma separated with UTF-8 BOM by default; import auto-detects `,` `;` tab | German Excel saves `;` files; avoids a `sep=` hack line |
| 2026-10-18 | NUD-073 | Only `corrected_zh-Hans/-HK/-TW` columns are applied; German corrections go in the comment column; comments are not stored | German is developer-maintained; backlog asks for corrected text per Chinese locale only |
| 2026-10-18 | NUD-073 | Import is all-or-nothing, refuses placeholder-set changes vs German and stale rows (`--force` to override); Hant correction equal to the OpenCC output removes the override | Protects against broken ICU/outdated CSVs; keeps override files minimal |
| 2026-10-18 | NUD-073 | Route hints are a plain TS prefix list (`scripts/lib/i18n-routes.ts`), longest prefix wins, text in parentheses = description not URL | Simplest maintainable form; a unit test flags stale entries |
| 2026-10-18 | NUD-080 | Service worker built after `next build` by `scripts/build-pwa.ts` (esbuild + `@serwist/build` injectManifest) instead of the Serwist Next plugin | Plugin needs webpack; the app builds with Turbopack |
| 2026-10-18 | NUD-080 | SW caches only the precached shell (hashed `_next/static`, icons, `offline.html`); driver navigations NetworkOnly with generic offline page fallback; no runtime caching | Authenticated HTML / RSC / API must never be stored before NUD-081 designs data caching |
| 2026-10-18 | NUD-080 | Manifest `id` `/driver` for all locales, `scope` `/`, `start_url` `/<locale>/driver` | One installed app; language switch stays in scope; ticket demands localized start_url (follow-up NUD-106) |
| 2026-10-18 | NUD-080 | Worker registered in production builds only, from the `/driver` layout (login included) | Avoids stale workers in `next dev`; admin pages are not handled by driver logic |
| 2026-10-18 | NUD-080 | Install hint dismissal is permanent (`localStorage`, in-memory fallback); iOS detected by user agent | Simplest "dismissible and remembered"; iOS has no install event |
| 2026-10-18 | NUD-080 | Real Lighthouse replaced by CDP `Page.getInstallabilityErrors` + assertions | Lighthouse not runnable in the sandbox; stated in the ticket (NUD-105) |
| 2026-10-18 | NUD-081 | Offline data model = the API JSON itself (`DriverTourResponse`, zod, schemaVersion 1); the server pages and the offline shell derive their screen models from it with the same pure functions | Online and offline must render identically; one schema validates API answers and stored records |
| 2026-10-18 | NUD-081 | Names and notes travel as `LocalizedText` in all four locales and are picked on the device (not resolved for the driver's locale on the server) | Offline pages follow the URL locale; language switch needs no new download; payload stays small |
| 2026-10-18 | NUD-081 | Photos are cached in Cache Storage under the stable URL `/api/driver/photo-cache/<photoId>` (not the signed URL); the worker serves that path from the cache only | Signed URLs change on every load; ids are immutable so only new photos are downloaded; same-origin path avoids opaque responses |
| 2026-10-18 | NUD-081 | Signed photo URLs in the tour payload are valid 12 h (`DRIVER_PHOTO_URL_TTL_SECONDS`); photos are fetched with CORS `GET` (bucket CORS rule must allow GET, already in docs/env.md) | Ticket requires >= 12 h; opaque `no-cors` responses cannot be checked and cost quota; failures show 'partly ready' instead of claiming readiness |
| 2026-10-18 | NUD-081 | Offline navigation: public prerendered shell page `/<locale>/driver/offline-shell` precached by the worker and served (Serwist fallbacks, 8 s network timeout) for `/<locale>/driver` and `/driver/stops/<id>`; it reads IndexedDB client side. Authenticated HTML is still never stored | Keeps the NUD-080 privacy rule; the shell contains no personal data; hard page loads between screens are acceptable and robust |
| 2026-10-18 | NUD-081 | Cached data is per user (one IndexedDB record keyed by user id, other users' records removed on every save) and per day (records not from today in the factory time zone are never shown and are deleted) | Shared phones and stale quantities (priority 2) |
| 2026-10-18 | NUD-081 | The login pages purge IndexedDB and the photo cache on mount (instead of purging on the logout click) | A login page means no session: also covers expired / ended sessions and a different driver; an offline logout that fails must not delete data of a still logged-in driver |
| 2026-10-18 | NUD-081 | The sync is not gated on `navigator.onLine`; it runs at start, on `online`, when visible, every 5 min and after status changes; only DRIVER users sync (admin support view would get 403) | `onLine` can be wrong (false in this sandbox); a failed fetch is cheap |
| 2026-10-18 | NUD-081 | Offline the status buttons are disabled with a notice and undo is hidden | Mutation queue is NUD-082; a server action cannot succeed offline |
| 2026-10-18 | NUD-082 | Every tap goes through the outbox (outbox first, then send), also online; the UI is optimistic; the server action is no longer used by the UI | One code path, a tap is instant and never lost; the same idempotent function runs for each entry |
| 2026-10-18 | NUD-082 | `createdAt` of a queued tap is trusted within [server now - 24 h, server now] and becomes `completedAt`, the start of the undo window and the conflict cut-off | A phone clock that is ahead or far behind cannot future-date stops or reopen old windows; undo counts from the driver's action, not from the delivery of the request |
| 2026-10-18 | NUD-082 | Conflict = new column `Stop.adminChangedAt` (set by a re-release that changes / adds a stop) later than the tap -> `changed_by_office`; removed stop / inactive tour / closed stop are rejected as well; rejected entries are final (removed, notice) | Needs a per-stop time (tour `reReleasedAt` would flag unchanged stops); quantities are priority 2, so a tap made on old quantities must not win |
| 2026-10-18 | NUD-082 | A queued completion that no request carries can always be cancelled by Undo (outside the 5-minute window too); otherwise an undo is queued; the last stop's toast offers no Undo | The server never saw it; the window and the COMPLETED rule only apply to confirmed state (NUD-053) |
| 2026-10-18 | NUD-082 | Backoff 2 s doubling to 5 min; `online` / focus / start skip it, the 60 s timer and new taps respect it; chunks of 50; a 400 chunk is retried entry by entry | Spec asks for exponential backoff; a changed situation deserves one immediate attempt; one bad entry must not block the queue |
| 2026-10-18 | NUD-082 | Unsent taps and notices survive logout / the login purge (kept per user, other drivers' after 3 days); the worker's Background Sync only sends for the user of the stored tour copy | "Taps are never lost"; avoids sending one driver's taps in another's session |
| 2026-10-18 | NUD-082 | Settled stop states are shown on top of the not yet refreshed page for 20 s ("confirmed" overlay) | Prevents a flicker back to "pending" between removing the queue entry and the server data refresh |
| 2026-10-18 | NUD-083 | Photos have their own IndexedDB store (`photos`, DB v3) and controller next to the tap outbox, with the same triggers, backoff and notice cards; the top-bar badge counts both | Taps are tiny JSON batches, photos are blobs with a three-step upload; one queue per kind keeps both simple and the "outbox" semantics (queued on the device, retried, idempotent) |
| 2026-10-18 | NUD-083 | Registration is `POST /api/driver/photos` (idempotent by the new unique `Photo.clientMutationId`), not a server action; the customer is derived from the stop, never sent by the client | Must work from the offline queue and the worker; client-chosen customers would let a driver change any customer's photo |
| 2026-10-18 | NUD-083 | Allowed tours: the driver's own, status RELEASED / IN_PROGRESS / COMPLETED, day = today or yesterday in the factory time zone (instead of only today / RELEASED / IN_PROGRESS) | A photo taken offline in the evening is registered after midnight, and drivers often notice a missing photo while closing the last stop (COMPLETED); older tours stay closed |
| 2026-10-18 | NUD-083 | The `storageKey` is saved in the queue row right after the PUT; the presigned PUT (5 min) is always requested in the same attempt as the upload; `object_missing` re-uploads up to 3 times, then the photo is dropped with a notice | A lost registration answer must not upload twice; a stale grant is never reused |
| 2026-10-18 | NUD-083 | A new photo of the same customer and kind replaces older unsent queue entries (not those in flight) | They would be current for a moment and then replaced; saves bandwidth and history rows |
| 2026-10-18 | NUD-083 | The slot shows the queued photo from an object URL of the local blob; after registration the blob is also stored in the photo cache under the real photo id and the tour copy is patched, "Gesendet" overlay for 20 s | Immediate feedback offline, no flicker before the page data refreshes, no download of what the phone already has |
| 2026-10-18 | NUD-083 | The office sees "Aktualisiert von Fahrer X am <date>" only for photos uploaded by a driver | Spec asks for the driver attribution; office uploads need none |
| 2026-10-18 | NUD-090 | XLSX is read with `exceljs` (SheetJS CDN blocked, npm `xlsx` outdated); CSV with an own RFC 4180 parser; `uuid` overridden to >= 11.1.1 | Only safe option available; audit clean |
| 2026-10-18 | NUD-090 | The file is parsed server-side (route handler, 5 MB cap while reading); the browser holds the table and sends only mapped cells, re-validated by the actions | Server actions have a 1 MB body limit; client parsing could not be trusted anyway |
| 2026-10-18 | NUD-090 | Column mapping is remembered in `localStorage` (header text per field), not in the database | No migration; per-browser is enough for one office |
| 2026-10-18 | NUD-090 | Unchanged address keeps pin and confirmation on re-import; a changed address drops pin (lat/lng null) and confirmation | Re-importing must not undo 150 reviews; the old pin belongs to the old address (NUD-014) |
| 2026-10-18 | NUD-090 | Empty optional cells never erase stored data; archived customers are updated but not reactivated; a number twice in the file: first row wins | Import must not destroy data; reactivation is a decision for the office |
| 2026-10-18 | NUD-090 | Formula-like cells (`=`, `@`, TAB, CR, `+`/`-` + non-number) make the row invalid instead of being altered | CSV injection; visible reason instead of silent change |
| 2026-10-18 | NUD-090 | Spreadsheet-dropped leading zero of a 4-digit German postal code is restored (DE only), with a row warning | Excel turns 01067 into 1067; AT/CH codes are 4 digits |
| 2026-10-18 | NUD-090 | Imported notes are stored German-only with `pendingTranslation`; no translator call per row | 2000 DeepL calls in one request is slow; the NUD-070 retry job translates |
| 2026-10-18 | NUD-090 | Geocoding: 5 customers per action, server throttle 700 ms with a real key (`GEOCODE_BATCH_DELAY_MS`), stop on 429/403 or 3 failures; best candidate stored as unconfirmed pin | Stays under the ORS free tier (~100/min); the admin confirms every pin (D9) |
| 2026-10-18 | NUD-090 | Pin review queue = all active unconfirmed customers, not just the last import; skip is client-side only | No import-batch column needed; one list for every unconfirmed pin |
| 2026-10-18 | NUD-091 | The print page lives in a new route group `admin/(print)` with the same ADMIN gate but no `AdminShell`; all existing admin pages and the old admin layout moved unchanged into `admin/(shell)` | Route groups are the Next.js way to give some pages a different layout without changing any URL; avoids hiding the shell with CSS |
| 2026-10-18 | NUD-091 | The sheet prints the quantities of the tour (`Stop.items` snapshot), not the live orders; an outdated tour prints with a loud warning (screen toolbar + banner on the paper) instead of being blocked | Matches what the driver sees (priority 2); the office may still need a sheet, but must know the numbers are stale |
| 2026-10-18 | NUD-091 | Invalid / missing `?locale=` falls back to the locale in the page URL (no error page) | A bad link should still give a usable sheet; zod `localeSchema` is the only accepted shape |
| 2026-10-18 | NUD-091 | Totals come from one shared `sumQuantities` (per product AND unit) in `order-overview.ts`, which `aggregateTotalsByDate` now uses too | Ticket demands one shared aggregation function; units are never mixed |
| 2026-10-18 | NUD-091 | Section 2 shows both the load position (1 = loaded first) and the original stop number; German product name in small type under the Chinese one | The loader needs the load order, the driver the stop number; Chinese-reading loaders may still talk to German staff |
| 2026-10-18 | NUD-091 | NUD-008's global `@media print { body * { visibility: hidden } }` is scoped with `body:has(.pin-sheet)` | The unscoped rule blanked every printed page of the app; the PIN print still works (e2e assertion added) |
| 2026-10-18 | NUD-092 | `AuditLog.entity` / `action` are plain strings validated in code, not Prisma enums; `actorId` is not a foreign key | New actions need no migration; users are archived but the history must survive any user row and e2e fixtures delete their users |
| 2026-10-18 | NUD-092 | Append-only is enforced twice: no update/delete path in code (scanned by a test) and a Postgres trigger refusing UPDATE/DELETE | Cheap defence in depth; a later retention job must deliberately bypass the trigger |
| 2026-10-18 | NUD-092 | Diffs store ids and values (quantities in hundredths), names are resolved when read; problem notes and internal notes truncated to 200 characters; keys like password/hash/token/signature/url are dropped | No PII copies or secrets in a log that cannot be edited |
| 2026-10-18 | NUD-092 | An order save that changes nothing writes no entry; a locked-tour rebuild is logged as `tour.reoptimize`, first build as `tour.generate`; photo audit sits in the shared `attachCustomerPhoto` | Less noise; one place covers office and driver photos |
| 2026-10-18 | NUD-092 | Tour history = entries of the tour plus every entry whose diff has `tourId` (stop changes, driver photos); shown below the planner because v1 has no separate tour detail page | Simplest query, no extra column |
| 2026-10-18 | NUD-093 | CSP keeps `'unsafe-inline'` for `script-src` and `style-src`; everything else is locked down (`object-src`, `base-uri`, `form-action`, `frame-ancestors`, per-type host lists) | Next.js hydration scripts are inline and PPR / cache-components shells cannot carry a per-request nonce; Leaflet sets inline styles. Strict scripts are NUD-110 |
| 2026-10-18 | NUD-093 | Headers and CSP are set in `next.config.ts` (build / start time env), not in the proxy | The proxy skips `/api` and files with extensions, so it would miss API routes, `offline.html` and `sw.js`; the cost is a redeploy after changing `MAP_TILE_URL` / `S3_*` (documented) |
| 2026-10-18 | NUD-093 | Added a public `POST /api/csp-report` (`report-uri`) that only logs one sanitized line and answers 204 | Makes report-only rollout and production monitoring possible and gave the e2e run a way to detect violations server-side across all specs |
| 2026-10-18 | NUD-093 | Zod runs `jitless` in the browser (`src/instrumentation-client.ts`) | Its `new Function` probe is blocked by the CSP and reported as a violation although zod copes; adding `'unsafe-eval'` would weaken the policy |
| 2026-10-18 | NUD-093 | `Permissions-Policy: camera=(self)` although driver photos use `<input capture>` | The attribute needs no permission; the entry only keeps a future `getUserMedia` working on our own origin and denies embedded frames |
| 2026-10-18 | NUD-093 | Origin check: reject a foreign `Origin` or cross-site `Sec-Fetch-Site`, let requests with neither header pass | Browsers always send one of them on cross-site POSTs; header-less clients are not browsers (cookies would be needed anyway) and the existing tests / Playwright API calls stay valid |
| 2026-10-18 | NUD-093 | One daily route `GET /api/cron/retention` for screenshots and old `LoginAttempt` rows instead of a screenshot-only route | `recordFailure` only cleans up on the next failure, leaving IP addresses in the table after quiet periods; one cron entry, one secret |
| 2026-10-18 | NUD-093 | Screenshot purge deletes the storage object first, then the row; a failed item is kept for the next run; not written to the audit log | A row without object is harmless and self-healing, an object without row would be orphaned forever; audit entries would copy what retention removes (exempt in `audit-coverage.test.ts`) |
| 2026-10-18 | NUD-093 | Invalid / zero `SCREENSHOT_RETENTION_DAYS` falls back to 180 instead of disabling or deleting everything | A typo must not be able to switch retention off or purge all screenshots |
| 2026-10-18 | NUD-093 | Audit-log retention only documented (design in `docs/privacy.md`), not implemented (NUD-111) | Instruction from the ticket owner: the append-only trigger would need a deliberate bypass; the period is a client decision |
| 2026-10-18 | NUD-093 | `braces` advisory accepted via `auditConfig.ignoreGhsas` | No patched release exists, dev-only path, production audit clean; CI still fails on any new high / critical |
| 2026-10-18 | NUD-093 | Authz matrix tests behaviour with a stubbed database instead of the embedded Postgres | Runs in every `pnpm test` without DATABASE_URL, so the 100 % coverage gate can never be skipped; role / active re-check against the DB is simulated by the stub |
| 2026-10-18 | NUD-094 | Sentry is optional: no `SENTRY_DSN` = SDK never loaded (dynamic imports, Turbopack drops the client branch); browser DSN is build-time (`NEXT_PUBLIC_SENTRY_DSN` from `SENTRY_DSN`) | Zero overhead and no network without DSN; verified in the build output |
| 2026-10-18 | NUD-094 | Sentry events are scrubbed in `beforeSend`/`beforeBreadcrumb` (no body, cookies, query strings, user, headers but UA/language, console, offline noise); errors only, no tracing/replay; no tunnel route, the DSN host goes into CSP `connect-src` | Data protection (NUD-093 rules); simplest CSP change; a tunnel would add a route and bandwidth |
| 2026-10-18 | NUD-094 | Source maps uploaded only if DSN + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` are all set, then deleted from the output; not run here | Build must stay identical and offline-safe without a token |
| 2026-10-18 | NUD-094 | Test error = `GET /api/monitoring/test-error` guarded by the existing `CRON_SECRET` bearer instead of an admin UI button (`?mode=throw` tests the automatic hook) | Smallest authz surface, curl-able, fits the SECRET_ONLY matrix; no new secret |
| 2026-10-18 | NUD-094 | Error pages: `(app)`/`(shell)` boundaries keep the shell; driver page checks `navigator.onLine` and shows a calm offline variant that reloads via the service worker; admin page shows only the digest; `global-error.tsx` reads texts from a generated JSON (`i18n:build`) | Offline sync must stay mounted; no scary message offline; no intl provider in global-error |
| 2026-10-18 | NUD-094 | Weekly backup uses a separate R2 bucket + token, a read-only `backup_reader` role, `pg_dump --format=custom`, excludes `LoginAttempt` data, keeps 8 weeks but never fewer than the newest 4, no R2 lifecycle rule; verify job restores into a disposable postgres:16 | Blast-radius separation; a stalled schedule must not empty the bucket; backup of throttling data adds only personal data (IPs) |
| 2026-10-18 | NUD-094 | Photos/screenshots are not part of the backup | Objects live in R2; acceptable for v1, noted in deploy.md |
| 2026-10-18 | NUD-094 | `pnpm admin:reset-password`: password only via env, hidden prompt or stdin (no argument), admin role only, clears the lockout, `--yes` required when not interactive | No password in shell history/process list; avoids resetting the wrong role |
| 2026-10-18 | NUD-094 | Orphan cleanup shipped with default `dry-run`, grace 14 days (min 7), key-shape allowlist, reference re-check, caps and a plausibility abort; `Storage.list` added | Deleting objects is irreversible: the operator enables delete after reading dry-run reports |
| 2026-10-18 | NUD-094 | Hidden error test pages exist only with `ENABLE_ERROR_TEST_PAGES=true` (CI e2e); the production env check rejects the variable | Need a real thrown error in e2e without shipping a crash route |
| 2026-10-18 | NUD-095 | Driver UI keeps supporting dark mode through `prefers-color-scheme` (no toggle); verified with axe in all four locales | The tokens existed since NUD-005; light-only would be a regression for night driving |
| 2026-10-18 | NUD-095 | Status buttons stay in the page flow, not sticky; checked to be in the bottom half at the end of the page | A sticky "Delivered" invites a tap before the quantities are read (client priority 2) |
| 2026-10-18 | NUD-095 | Map credit line (OSM / Leaflet) exempt from the 16 px / 48 px rule; driver map markers and zoom buttons enlarged | Attribution is required text; markers and zoom are real controls |
| 2026-10-18 | NUD-095 | `Button size=lg` is `min-h-12` and wraps; driver buttons use min-heights | Fixed heights clipped labels at 130 % font size |
| 2026-10-18 | NUD-095 | 130 % font size emulated through root font size; throttling through CDP on a desktop CPU | Only available emulation here; real devices are NUD-115 |
| 2026-10-18 | NUD-095 | Lighthouse CI runs through `pnpm dlx @lhci/cli@0.15.1` on a warm logged-in profile, not as a project dependency; LCP < 2.5 s error budget | `@lhci/cli` adds 4 high advisories to `pnpm audit` (CI gate); the budget is "after first load" |
| 2026-10-18 | NUD-095 | Toast region label localized and sonner hotkey removed | The default label is English and mentions a keyboard shortcut a phone does not have |
| 2026-10-18 | NUD-096 | UAT script offers two data modes (demo seed with `--today`, or the client's real data) and keeps the sign-off block empty; wording issues are routed to `pnpm i18n:import`, not to code tickets | Drivers see only today's tour, and the demo seed must never touch production; the Chinese texts are still unreviewed (NUD-073) |
| 2026-10-18 | NUD-097 | `await connection()` at the top of `requirePageActor` (page guards only), not in `requireRole` | Fixes the Auth.js CSRF `getRandomValues` prerender error at its cause; actions/route handlers are already request-scoped and stay unchanged |
| 2026-10-18 | NUD-098 | OpenCC guard = file split (`localized-text.server.ts`) + ESLint `no-restricted-imports` + bundle scan in `pnpm build`, instead of the `server-only` package | `server-only` is not installed (no pnpm install here) and throws under tsx/vitest without aliasing; the ESLint rule + bundle scan catch the same mistakes without touching scripts and tests |
| 2026-10-18 | NUD-099 | Late orders are handled with a follow-up tour (second `Tour` row for the date, D5) instead of re-opening the completed tour; no schema change | COMPLETED is final in the status machine (NUD-043) and the driver's completed stops must never change; a second tour reuses planning, release, driver and audit unchanged |
| 2026-10-18 | NUD-099 | "Late order" = CONFIRMED order on no stop while every tour of its day is COMPLETED; with an open tour the existing outdated flag / rebuild / re-release path decides, `markOutdatedForDate` keeps skipping COMPLETED tours | One rule, no new flag; detection by the unlinked-order query as the ticket asked |
| 2026-10-18 | NUD-099 | Tour code reads the day's orders with a scope ("not on a stop of another tour of that day"); a customer delivered in tour 1 who orders again gets a second, separate stop in the follow-up tour with only the new quantities | Keeps D5 "all confirmed orders of a customer merged into one stop" per tour; prevents double delivery and false "added" diffs |
| 2026-10-18 | NUD-099 | Increased / changed / cancelled quantities on already delivered stops are NOT re-dispatched; shown as a conflict note, correction = new order for the difference (automation: NUD-117) | Delivered stops are frozen (NUD-043); goods cannot be un-delivered; simplest safe behaviour |
| 2026-10-18 | NUD-099 | Only one follow-up tour may be open at a time (create refused while any tour of the day is not COMPLETED); further late orders flag that tour outdated and are added by rebuild / re-release | Avoids several half-planned tours and double clicks; matches "1 tour per date" as far as possible |
| 2026-10-18 | NUD-099 | Planning page selects the tour by `?tour=<id>` (default: newest open tour, else newest) and shows tabs only with two or more tours; driver gets the newest RELEASED / IN_PROGRESS tour, else the newest COMPLETED one; dashboard shows the open tour | Single-tour days look exactly as before; a released follow-up must replace the finished screen |
| 2026-10-18 | NUD-099 | New audit action `tour.followup` instead of reusing `tour.generate` | The history must say that this tour was created for late orders; vocabulary stays a closed list (NUD-092) |
| 2026-10-18 | NUD-099 | Order form warning not built, only overview notice + badge, dashboard hint and planning banner; ticket NUD-116 | After saving, the overview opens on that day and already shows the notice; the form needs another action + matrix row |
| 2026-10-18 | NUD-106 | Manifest `start_url` is the locale-neutral `/driver?source=pwa` for all locales; the existing unprefixed-path redirect in `proxy.ts` (session locale -> cookie -> Accept-Language -> `de`) picks the language at launch; per-locale manifests kept for the localized name | Simplest fix without a re-install hint; reuses the NUD-003 rule; `id` and `scope` unchanged |
| 2026-10-18 | NUD-106 | The unprefixed redirect is `no-store`; the worker treats `/driver` as a network-only navigation and never stores it | The answer depends on session and cookie |
| 2026-10-18 | NUD-106 | Offline launch: `offline.html` forwards `/driver` to `/<NEXT_LOCALE cookie>/driver` (German if missing), no extra precache entry and no locale stored in IndexedDB / localStorage | The cookie is already written by login and the switcher and is readable by script; the IndexedDB record has no locale |
| 2026-10-18 | NUD-108 | No tile pre-caching by default; offline / failing tiles remove the tile layer and show a plain background plus a localized notice, markers and route stay | Provider terms generally forbid bulk caching (OSM policy); simplest safe behaviour, never a blank or broken-tile map |
| 2026-10-18 | NUD-108 | Tiles count as failed after 4 tile errors in a row (reset by any loaded tile); the tile layer returns on the `online` event | Single missing tiles at the edge must not hide the map; a dead provider must not cause endless requests |
| 2026-10-18 | NUD-108 | Opt-in `MAP_TILE_CACHE=1` (default OFF, explicit `MAP_TILE_URL` required, build-time for the worker): worker cache-first for tiles the page requested, LRU 300, 7 days, CORS 200 only (`crossOrigin` on the tile layer), CSP `connect-src` gets the tile host only then | Browser-cache-like, no prefetch; opaque responses would cost ~7 MB quota each; worker fetches are checked against connect-src |
| 2026-10-18 | NUD-108 | The notice lives in `TourMap` itself (also the admin tour map), strings in new namespace `maps` | One component, one behaviour; admin planners get the same honest hint |
| 2026-10-18 | NUD-108 | Marker tap -> stop detail not added (does not exist today); ticket NUD-119 | Out of scope of the offline ticket |
| 2026-10-18 | NUD-110 | Hybrid script CSP in production: per-request nonce (proxy) for everything Next.js renders per request + SHA-256 hashes for the inline scripts of the prebuilt documents; `script-src 'self'` for API / files; no `'unsafe-inline'`, no `'strict-dynamic'` | Measured on the 16.4.2 build: the nonce reaches the PPR resume part, the prebuilt shells have 2 fixed inline scripts (+ flight data in 4 static page types), so hashes cover them; the Next docs' "PPR incompatible" only holds for the prebuilt part |
| 2026-10-18 | NUD-110 | `experimental.sri` not used | Webpack-only in 16.4.2, and SRI does not cover inline scripts |
| 2026-10-18 | NUD-110 | Two `next build` passes in `pnpm build` / `build:vercel` plus a `check` step that fails on any mismatch; hashes inlined into the proxy via `next.config` `env`; build ID pinned between the passes | The proxy bundle is built before the prerendered HTML (and its hashes) exist; run-time file reads from the proxy cannot be verified on Vercel; a mismatch must break the build, never the site |
| 2026-10-18 | NUD-110 | The CSP of pages moved from `next.config.ts` to `src/proxy.ts`; `next.config.ts` keeps it for the complement of the proxy matcher only | One policy per response (two CSP headers would intersect); API routes, files and the worker are not seen by the proxy |
| 2026-10-18 | NUD-110 | `offline.html` script moved to `public/offline.js` (precached), `onclick` removed | Static files get `script-src 'self'`; hashing a file generated after `next build` is not possible from `next.config.ts` |
| 2026-10-18 | NUD-110 | Development keeps `'unsafe-inline' 'unsafe-eval'` and no nonce | HMR needs them and a nonce would disable `'unsafe-inline'`; strictness is asserted by the e2e on production builds (skipped on `pnpm dev`) |
| 2026-10-18 | NUD-110 | `style-src 'unsafe-inline'` left as is | Out of scope (ticket is about scripts); Leaflet sets inline styles |
| 2026-10-18 | NUD-110 | Rate-limit integration test uses days in the future instead of fixed dates | Fixed dates became "past" on 2026-10-18 and collided with attempts logged with the real clock (test-only fix) |
| 2026-10-18 | NUD-111 | The trigger's bypass switch is the transaction-local setting `nudel.audit_retention = 'on'` (not `app.audit_retention` as in the older design text) | Task/ticket owner's instruction for the final name; namespaced to this app, only visible inside the transaction that sets it |
| 2026-10-18 | NUD-111 | The 90-day floor lives inside the trigger function (database clock) in addition to `MIN_AUDIT_RETENTION_DAYS` in the app; a shorter period in code is refused, not clamped | The app cannot delete recent history even with the switch on or after a bug; a refused run is visible, a silently clamped one is not |
| 2026-10-18 | NUD-111 | `AUDIT_RETENTION_DAYS` default 730, accepted 90..36500, invalid / out-of-range falls back to 730 (not to the floor) | Same principle as `SCREENSHOT_RETENTION_DAYS`: a typo keeps more history instead of deleting more; 24 months as proposed in `docs/privacy.md`, pending client confirmation |
| 2026-10-18 | NUD-111 | Daily run, batches of 1000 rows in separate transactions, at most 20 batches (20 000 rows) per run, `more` flag | Bounded lock time and function duration (60 s); a large backlog is worked off over several days |
| 2026-10-18 | NUD-111 | The retention run writes no audit entry; it reports counts in the response and one sanitized log line | An entry about deleting entries would be one more row to delete later; same as the screenshot retention |
| 2026-10-18 | NUD-112 | Orders, tours and stops are never deleted or anonymised by a job; no `ORDER_RETENTION_DAYS`. Only `Stop.problemNote` is scrubbed | The analysis finds no personal data in them beyond user ids and free text; business history must stay (backlog 4.3, disputes, accounting, completed tours stay complete); whole-order retention is a client question (section 10) |
| 2026-10-18 | NUD-112 | Driver text period 365 days from `Stop.completedAt`, `DRIVER_TEXT_RETENTION_DAYS` 30..3650, invalid values fall back to 365, below 30 refused in code | Disputes about a delivery arise within months; the structured reason stays; proposal until the client confirms. Same typo principle as the other retention variables |
| 2026-10-18 | NUD-112 | `DATA_RETENTION_MODE` `dry-run` (default) / `delete` / `off`; unknown values mean `dry-run` | Irreversible removal defaults to report-only (backlog 0 rule 5), same convention as `ORPHAN_CLEANUP_MODE`. So after deployment nothing is removed until the operator sets `delete` |
| 2026-10-18 | NUD-112 | The whole `problemNote` JSON is set to NULL (original, translation, pending marker); the structured `problemReason` stays | The translation is a copy of the same personal text; a NULL note is already a valid state in every view and for the translation retry job |
| 2026-10-18 | NUD-112 | The scrub job is exempt from the audit rule with a reason instead of writing an aggregate audit entry | `AuditLog` needs a user id as actor and a per-record entity from a closed vocabulary (NUD-092); a system job has neither; counts go to the response and the log, as for the screenshot and audit retention |
| 2026-10-18 | NUD-112 | Copy of the note in the `stop.problem` audit entry left as is; ticket NUD-121 | Changing what audit entries store is a separate decision (history views, client period); documented as known gap in `docs/privacy.md` |
| 2026-10-18 | NUD-112 | Erasure runbook uses manual SQL for driver texts, screenshots and photos before their period | No admin UI to delete these exists and building one is out of scope; steps are explicit and touch one column / row |
| 2026-10-26 | – | The owner's four pre-deploy fixes are tracked as NUD-122…127 (NUD-127 = the vServer deploy) and worked in that order, one ticket per session; they depend only on `done` tickets, so the older `todo` tickets (mostly 👤 HUMAN) stay untouched | AGENTS.md: one ticket per session, lowest-numbered eligible one; the owner asked for this order explicitly |
| 2026-10-26 | NUD-122 | Office upload and driver upload are two tickets' worth of one defect: same root cause class, but two separate code paths and two separate fixes; the `head()` existence gate stays | Direct server action vs. IndexedDB outbox + flush (`photo-outbox-flush.ts`); the gate is what makes a missing object visible instead of storing a dangling key |
| 2026-10-26 | NUD-122 | A storage provider must never be reported as working when it cannot store: `/api/uploads` must not hand out a non-`http(s)` URL and the client rejects one as `UPLOAD_FAILED` | The silent `FakeStorage` fallback in non-production (`storage/index.ts`) is what let the UI look alive while `Photo` stayed empty |
| 2026-10-26 | NUD-124 | "Beutel" is the existing `PACK` unit relabelled in the UI (de + zh-Hans); no Prisma enum change, no fourth unit | The owner asked for the label only; an enum migration would be risk without benefit |
| 2026-10-26 | NUD-124 | The 6 demo products are retired with `Deaktivieren` (`active=false`); demo `OrderItem`s, if any, are moved to the matching new product — orders are never deleted | §4.3 soft delete; `OrderItem.productId` is `onDelete: Restrict`; D19 keeps order history. Owner confirmed there are no real orders on them |
| 2026-10-26 | NUD-125 | Parking spots are a list per customer; the office manages them and a driver may add one; routing/optimisation keeps using the single customer pin | Owner decision; one point per stop keeps the D5 optimisation model unchanged |
| 2026-10-26 | NUD-126 | Navigation guides to the parking spot first, the shop entrance second | Owner decision; client priority 4 (stored shop and parking photos) |
| 2026-10-26 | NUD-122 | The office upload path is not broken in the current environment; the reproduced defect is the driver outbox. The bucket's 111 `.jpg` objects come from e2e runs that delete their test customer (orphan objects), and the office client already reports a rejected PUT honestly | Measured in a real browser against MinIO: office presign → PUT 200 → attach 200 → `Photo` row; driver capture → `applied` → `Gesendet`. With the PUT forced to 403 the driver waited 60 s+ over 5 silent retries — that is the owner's symptom |
| 2026-10-26 | NUD-122 | An *answered* error while sending a driver photo (rejected PUT, failing grant, non-ok register) is counted per entry and, after `MAX_HTTP_FAILURES = 3`, drops the photo with an `upload_failed` notice; a *network* failure (offline) keeps retrying without limit | A configuration error must not leave a badge that never changes, but offline must never cost a photo (D17) |
| 2026-10-26 | NUD-122 | After `upload_failed` the driver takes the photo again instead of pressing a "retry" button: the blob is dropped together with the entry and a retry against a broken configuration would only loop | IndexedDB is a queue, not a permanent store; the notice names the customer and the slot shows the placeholder again, which is the honest retry |
| 2026-10-26 | NUD-122 | `POST /api/uploads` answers `503 STORAGE_UNAVAILABLE` for a target a browser cannot PUT to, the client rejects a non-`http(s)` grant as `UPLOAD_FAILED`, and `getStorage()` no longer caches a fallback Fake for the process lifetime | A `fake://upload/...` grant is a half-success no browser can complete — the failure mode that made the UI look alive while nothing was stored |
| 2026-10-26 | NUD-122 | `customer-photos.spec.ts` throws when `S3_*` is missing instead of skipping itself (explicit opt-out `ALLOW_MISSING_S3=1`); the CI e2e job gets a MinIO service and a bucket-creation step | It is the only browser test of the real upload path and it used to skip itself in CI, which is why the gap stayed invisible |
| 2026-10-26 | NUD-123 | All three "add" flows work through the GUI; the "one broken Select" theory is dropped. The driver form uses a native `<select>`, the customer form no select at all, and the order form's redesigned `Combobox` filters and selects correctly | Reproduced each flow in a real browser against the seeded dev server; created a driver (+PIN), a customer (`pinConfirmed`) and a `CONFIRMED` order with an item |
| 2026-10-26 | NUD-123 | The add-order e2e assertions were realigned to the ICU plural unit labels instead of the old singular; the sibling specs get NUD-128 | `orders.spec.ts` was red only on `"2,5 Packung"` vs `"2,5 Packungen"` while the order was created correctly — a red run that looked like "add order is broken" |
| 2026-10-26 | NUD-123 | Realigning only `orders.spec.ts` in this ticket, everything else about the redesign's presentation drift goes to NUD-128 | Backlog §0: stay in scope, missing things become new tickets |
| 2026-10-26 | NUD-123 | The first-start language picker needs no change: a GUI-created driver is `localeChosen = false`, the layout guard redirects to `/driver/start` and the picker renders. `drivers.spec.ts` fails only under `pnpm dev` (5 s `toHaveURL` vs. an on-demand route compile) | Verified in a browser plus a control driver written straight into the DB; `RUN-AND-TEST.md` §8 documents the dev-mode flakiness, CI runs a production build |
| 2026-10-26 | NUD-131 | `127.0.0.1` goes into `allowedDevOrigins` (plus `DEV_ALLOWED_ORIGINS` for a phone/tunnel), instead of telling everyone to use `localhost` | The owner hit it from the tablet/desktop and it is indistinguishable from "the app is broken": Next 16 blocks cross-origin dev requests, the page renders server-side and every button is dead. The env var also protects the upcoming real-device tickets (NUD-107/109/115) from the same trap |
| 2026-10-26 | NUD-136 | Office-only `companyName` / `vatId` / `billing*` columns instead of a second address entity; billing stays `null` when it equals the delivery address | Glossary: a customer has exactly one delivery address, which is what is routed and shown to the driver; invoicing is out of scope (D19), the office only needs to keep the data |
| 2026-10-26 | NUD-136 | Import without customer numbers matches by name and assigns the next free number | The owner's list has none; "Kundenname" is unique in it and is the office's own short name, so re-imports stay idempotent |
| 2026-10-26 | NUD-136 | A LieferAdresse without a postal code takes postal code and city from the address columns, flagged for review, instead of rejecting the row | Pins need the admin's confirmation anyway (D9); rejecting would lose the customer |

| 2026-10-26 | NUD-137…153 | Owner manual test → findings F1–F25, decisions D21–D30, tickets NUD-137…153 | `QA-REPORT-2026-10-26-manual.md` |
| 2026-10-26 | NUD-124 | Superseded by NUD-138: 3 products (not 6), weight per unit, label Karton | Owner decision in the manual test |
| 2026-10-26 | NUD-149 | Recurring orders are generated 14 days ahead by default (`Settings.recurringLeadDays`) | Owner gave no number; editable |
| 2026-10-26 | NUD-135 | Tour date is not editable via Bearbeiten; orders move via their delivery window | Owner did not object to the proposal; least risk |
| 2026-10-26 | NUD-126 | Combined navigation uses `travelmode=driving` for the whole route incl. Parkplatz → entrance | Google Maps URLs allow one travel mode; owner chose one button ("keep it simple") |
| 2026-10-26 | NUD-152 | Skipped checklist → loading time = `Settings.defaultLoadingMinutes` | Utilization must include loading time (owner) and needs a value when no timestamp exists |
| 2026-10-26 | NUD-150 | No WhatsApp/WeChat bots and no PWA share target; a pasted-text field + screenshot instead | Owner decision; WeChat has no official bot API for personal accounts |
| 2026-10-26 | NUD-137 | Audit-log quantities stay in hundredths (`toAuditQuantity`) although order quantities are integers now | The log is append-only; old rows cannot be rewritten, so one encoding keeps one reader |
| 2026-10-26 | NUD-137 | Existing fractional quantities are rounded half up and never below 1 in the migration; max quantity per line is 99 999 | Simplest integer rule consistent with D23; non-integer rows are reported as NOTICE |
| 2026-10-26 | NUD-138 | Both Nudeln products have the same name "Nudeln"; the order picker tells them apart by the SKU in its label (`NUDELN-BEUTEL`, `NUDELN-KARTON`) | Simplest option consistent with D23; the unit is shown right next to the quantity on every line |
| 2026-10-26 | NUD-138 | Wantan-Teig is "馄饨皮" (zh-Hans) / "餛飩皮" (Hant); the old kilogram Ravioli demo lines moved to Beutel | No Chinese name was given; the standard written form is used and can be edited on the product form. Kilogram lines have no equivalent among the three products |
| 2026-10-26 | NUD-138 | Quantity sums that have no product name next to them (driver totals, office sums card, tour diff, history) show "Stück" for pieces, not "×" | "3 ×" without a name is meaningless; "×" only exists in front of a product name (glossary §3) |
| 2026-10-26 | NUD-139 | The driver login code stays "PIN" (6 digits); only the map "Pin" is retired | "PIN" is the security code of the driver account and the glossary only retires the map word; the forbidden-words test matches the map word case-sensitively |
| 2026-10-26 | NUD-139 | Customer map point = "Adresspunkt", depot map point = "Standort"; "Parkplatz" waits for NUD-141 | The glossary names the point of the Lieferadresse "Adresspunkt"; a Parkplatz does not exist as data yet, so naming it now would be wrong |
| 2026-10-26 | NUD-140 | Admin-only message keys exist in de/en/zh-Hans only; `sr-Latn` and `cs` carry the driver namespaces (common, home, auth, driver, pwa, errorPages, maps). The checker enforces the split; an office URL in a driver-only locale redirects to `/de/admin/...`. | The ticket allowed the split if the checker handles it cleanly (it does); translating ~900 office-only keys into two languages nobody reads in the office adds review cost for no user. |
| 2026-10-26 | NUD-140 | Serbian content translation sits behind `RoutedTranslator(primary, serbianProvider?)`. DeepL has no verified Serbian (Latin script) support, so with no provider it throws `UNSUPPORTED`: the locale stays empty, the text is **not** kept pending (it would clog the retry job) and readers fall back to German. NUD-150 plugs in OpenRouter and must backfill existing texts without `sr-Latn`. | The ticket said to use the OpenRouter client behind the same interface if DeepL lacks Serbian; that client arrives in NUD-150. The FakeTranslator handles all five locales (prefix `[sr-Latn] `). |
| 2026-10-26 | NUD-140 | Read fallback chain is requested locale -> `de` -> `meta.source`. DeepL codes: sources DE/EN/CS/ZH, targets DE/EN-GB/CS/ZH-HANS; non-German pairs pivot through German. | Matches the ticket (`pick()` fallback) and keeps one provider call per language. |
| 2026-10-26 | NUD-140 | Migration maps `zh_Hant_HK`/`zh_Hant_TW` users to `zh_Hans`; stored `LocalizedText` loses the Hant keys; a Hant-only text (source was Hant) is moved to `zh-Hans`; existing texts get `pendingTranslation` so the retry job fills en/sr-Latn/cs. | Nothing is deleted without a replacement; the job translates in the background. |
| 2026-10-26 | NUD-140 | Driver problem notes (`Stop.problemNote`) are translated into German only (`PendingSource.targets = ["de"]`). `Product.name` becomes a pending source so a failed save-time translation is retried. | The office reads problem notes in German; translating them into four languages wastes quota. Product names are machine-filled for en/sr-Latn/cs on save when flagged auto or empty. |
| 2026-10-26 | NUD-125 | Parking spot = optional label (80) + optional note (500) + required lat/lng; max 10 active per customer; order by `sortOrder`, first active = default; reorder via up/down buttons; "remove" sets `active=false`, no restore UI | Simplest option consistent with D22/D27: the first spot is the routing point (NUD-141), free text is listed in docs/privacy.md and kept out of the audit log |
| 2026-10-26 | NUD-141 | Parkplatz queue at /admin/customers/parking saves through the existing audited createParkingSpotAction; geocoding on save is best effort and never blocks; pinConfirmed stays unused without migration; demo customers have no ParkingSpot so they show the flag | Simplest option consistent with D22: reuses the NUD-125 action and audit, no destructive migration, a geocoder outage must not block saving a customer |
| 2026-10-27 | NUD-142 | Driver sheet requires a number for "Ja"; office may leave it blank. Chip: number, "?" unknown, "–" none, "✓" present without number. | Simplest display consistent with D27; drivers need the number, office may only know that a key exists. |
| 2026-10-27 | NUD-142 | Key entries reuse /api/driver/sync (type key) and StopMutation kind KEY; no conflict rule, last write by sync order wins. | D27: driver field knowledge wins; reuses existing idempotent outbox. |
| 2026-10-27 | NUD-142 | Stop-list rows show a display-only key chip (rows are links); chip is interactive on next-stop card and stop detail. Office form sends key fields only when edited. | Avoids nested interactive elements (axe) and stale-page overwrites. |
| 2026-10-27 | NUD-143 | Details control is a stretched-link chevron (::after overlay) instead of making the card an <a>; photo actions sit below the placeholder tile, overlay icons when a photo exists. | Avoids nested interactive elements (axe) and keeps 48 px targets in the 148 px tile. |
| 2026-10-27 | NUD-126 | One "Navigation starten" button to the default Parkplatz (then the Lieferadresse); the stop screen lists all active Parkplätze (label + note) read-only, with no picker and no entrance button | Amended ticket text (D30, owner test F21) asks for one button only; a picker would be a second navigation action. Choosing another spot is the office's reorder (NUD-125) |
| 2026-10-27 | NUD-126 | The driver payload (and so the offline cache) carries `addressLat/addressLng` plus `parkingSpots[{label,note,lat,lng}]`; the schema defaults them to null/[] so caches written before this ticket still parse, and a missing address point falls back to the single routing point | D17/NUD-081 pattern: one JSON model online and offline; no schemaVersion bump needed because old caches stay readable; label/note are shown as typed (never translated, like customer names) |
| 2026-10-27 | NUD-144 | A Parkplatz set by the driver is appended to the list: it is the default (routing / navigation point) only if the customer had none; no label or note. | D27 says no approval, and "becomes the default if none exists" in the ticket; a driver must not silently reorder the office's list. Simplest: append, office can reorder. |
| 2026-10-27 | NUD-144 | Permissions-Policy now allows `geolocation=(self)` (was `()`). | The position fix needs it; one-off request on a button tap, no tracking, so D19 stands. Documented in deploy.md and privacy.md. |
| 2026-10-27 | NUD-144 | Driver Parkplatz entries use the existing sync queue (`type: parking`, StopMutation kind PARKING) and audit action `parking.create` with `via`. | Reuses the idempotent outbox like NUD-142; no new route or audit action. |
| 2026-10-27 | NUD-135 | Bearbeiten is one dialog (driver, order of the open stops, tour of each open stop) saved by one action `editTourAction`; a moved stop is appended at the end of the target tour and keeps its id, order links and quantities; a target tour that already has a stop of that customer is refused (`customer_in_target`) | Simplest consistent with D29: merging two stops would mean merging quantities and re-linking orders; the office reorders the target tour afterwards |
| 2026-10-27 | NUD-135 | On a RELEASED / IN_PROGRESS tour every driver-visible edit (driver, order, stop moved in or out) raises `releaseRevision`, sets `reReleasedAt` / `lastChange`; an arriving stop gets `ADDED`, a leaving one is listed as removed; the driver of a released tour cannot be cleared; completed stops keep their slot and cannot be moved (`stop_locked`) | D29: released tours are edited through the existing "tour was updated" path; completed stops are locked |
| 2026-10-27 | NUD-135 | "+ Tour" creates an empty OPTIMIZED tour (no routing call, at most 10 per day, not for past days); the tour tabs are always shown and read "Tour N · Fahrer" (the word "Folgetour" is dropped from the tab) | Owner F14/F15; the status machine cannot release a DRAFT tour, and a manual tab is not always a follow-up |
| 2026-10-27 | NUD-135 | Vehicle is not in the edit form yet; NUD-146 (depends on 135) adds the select. Audit reuses `tour.reorder` / `tour.assign_driver` and adds `tour.move_stop` (on both tours) and `tour.create_empty` | Vehicles do not exist before NUD-146; one audit vocabulary instead of a parallel `tour.edit` |
| 2026-10-27 | NUD-146 | Release needs driver and an active vehicle; a tour above capacity needs `overrideOverload: true` on the release call (checkbox in the dialog), logged in the `tour.release` audit entry (`overloadOverride`, `loadKg`, `capacityKg`). Re-release and Bearbeiten do not gate an overload, the indicator just turns red | Smallest reading of 'cannot be released without an explicit override' (D24); the first release is the moment the driver gets the tour |
| 2026-10-27 | NUD-146 | Tour load = `Stop.items` snapshot x `weightKgPerUnit` over all stops of the tour (completed ones included); a vehicle change through Bearbeiten on a released tour bumps the revision ('tour updated'); a released tour cannot lose its vehicle, an old one without vehicle may stay without | Same snapshot the driver sees; same rules as the driver in NUD-135 (D29) |
| 2026-10-27 | NUD-146 | Vehicle master data on one page with a dialog (no separate form pages); name unique ignoring case, capacity whole kg 1..50000, plate optional; audit entity `Vehicle`; demo seed adds two placeholder vehicles, the production seed none | Simplest consistent with the product list pattern; the real fleet is owner data |
| 2026-10-27 | NUD-147 | Reload trips are `Stop.trip` (no stop row); reload time is a constant of 20 min (not a setting); a vehicle not needed gets no tour; drivers are paired with the used vehicles in the order selected | Simplest model consistent with D24 ("all vehicles first, then reload"); NUD-152 may turn the 20 minutes into a setting |
| 2026-10-27 | NUD-147 | "Touren planen" rebuilds unreleased tours in place (surplus ones emptied, not deleted) and refuses a day with a released or locked tour; "Neu optimieren" of one tour yields one trip | Soft delete only; released tours are the driver's (D29) and are edited via Bearbeiten |
| 2026-10-27 | NUD-147 | Capacity applies per trip: indicator, release gate and override compare the heaviest trip; manual edits keep trip boundaries positional, new/moved stops join the last trip | A reload empties the vehicle, so the total over all trips is not what it carries |
| 2026-10-27 | NUD-148 | Columns `windowFrom`/`windowTo` (DATE) plus optional `windowFromTime`/`windowToTime` ("HH:MM") instead of `windowStart`/`windowEnd` timestamps; `deliveryDate` stays the planned day. NOT NULL after a backfill from `deliveryDate`; CHECK constraints for order and time format | A date plus optional hours matches the form ("a few hours to several days"), avoids time-zone arithmetic in the DB and keeps every existing `deliveryDate` query working |
| 2026-10-27 | NUD-148 | Hours apply on the planned day if it lies inside the window (each order of a stop contributes; the stop gets the intersection, an empty intersection is the warning `conflict`); window at most 31 days; a single-day window needs start < end | Simplest consistent reading of "time-of-day parts"; keeps the stop constraint a single interval |
| 2026-10-27 | NUD-148 | Default planned day: earliest delivery weekday in the window (not before today) where confirmed orders of that day plus this order fit the SUM of the active vehicles' kg; an empty day always accepts (oversized orders are served by reload trips); without vehicles capacity is unlimited. Nothing fits -> earliest delivery weekday + warning `no_capacity`; no delivery weekday in the window -> first day + warning `no_delivery_day` | Matches D25 "earliest day inside the window with capacity"; warnings never block saving |
| 2026-10-27 | NUD-148 | Order input: `deliveryDate` alone still means a whole-day window (compatible with old callers/tests/duplicate); the form sends the window and leaves the planned day empty (= automatic). On edit the planned day is kept unless the window changed and the day was not touched (then planned again) | Keeps existing flows and e2e specs working; the office can always override the day, outside the window with a warning (toast + inline hint) |
| 2026-10-27 | NUD-148 | Time windows reach the optimiser as VROOM `time_windows` (+ vehicle `time_window` from the departure); when they cannot all be met ORS plans again without them (`optimize` on NO_ROUTE, `distribute` when jobs stay unassigned) and the tour shows the stops whose ETA misses the window as warnings (badge `stop-time-window` in the tour planner, computed from stored ETA, so it also holds after reorder/edit). The heuristic ignores the windows | Infeasible windows are reported, never silently drop a stop or turn it into a reload trip; windows are not in the generate/plan-day result toasts (kept to the tour view) |
| 2026-10-27 | NUD-148 | Order list and filters stay on the PLANNED day (what is produced/loaded that day, totals unchanged); the window is shown in the list (customer cell, only when it differs from the planned day), drawer and detail. Audit log records `window` as text `YYYY-MM-DD..YYYY-MM-DD HH:MM-HH:MM` | Totals and tours are per planned day; filtering by window overlap would double-count orders |
| 2026-10-28 | NUD-149 | Customer inactive: rules get active=false + pausedByCustomer=true (reactivation resumes only those); cancelled orders are not regenerated (unique rule+date) | Keeps office-paused rules paused and honours 'cancelled orders stay cancelled' |
| 2026-10-28 | NUD-149 | Generated orders are attributed (createdBy/audit actor) to the rule's confirmer; edits/pauses do not touch already generated orders; saving a rule also generates immediately | Cron has no user; simplest predictable behaviour, office cancels single orders |
| 2026-10-28 | NUD-151 | Tour-level taps (loading/depart) ride the stop-keyed offline queue and name the tour's first stop; first write wins; only the first trip records timestamps (Tour has one pair), later trips get a checklist without timestamps | Simplest reuse of the outbox/idempotency table; NUD-152 needs one loading start and one departure per tour |
| 2026-10-28 | NUD-151 | Fixed checklist items: German source text in Settings.departureChecklist (max 12 x 80 chars), machine-translated via localize like customer notes; ticks stored per device in localStorage only | No new table/screen; ticks are a convenience and need no server state |
| 2026-10-28 | NUD-151 | Card is hidden once departedAt is set or any stop was worked on; a key line appears for every customer with hasKey=true (number optional) | Card is only useful before the first stop; a key without a noted number still has to be taken along |
| 2026-10-28 | NUD-151 | docs/deploy.md 13.1: vServer cron helper script + /etc/cron.d lines mirroring vercel.json (incl. recurring-orders) | NUD-149 only documented vercel.json; owner cannot use Vercel-style cron on the vServer |
| 2026-10-27 | NUD-155 | Import tool is ONE self-contained script file (rules, services calls, CLI) instead of modules under src/ | The client needs it on the server today by a single scp without a rebuild; it only imports modules already deployed |
| 2026-10-27 | NUD-155 | Exit codes: 0 fine, 1 bad file/setup/arguments, 2 refused or error rows (dry run too), 3 apply stopped half way | Lets the operator and scripts tell a fixable file from a half-done run |
| 2026-10-27 | NUD-155 | Idempotency marker = `Order.internalNote` `CSV day import <sha256[0..16]> <day> row <n>`; same file+day refused, `--resume` creates only rows without a marker; cancelled imported orders still count | Simplest robust lookup without a new column, migration or audit action; day inside the marker because the office may move the planned day later |
| 2026-10-27 | NUD-155 | Mid-run failure: orders are created row by row (note first, then the order in its own transaction), the first failure stops the run, prints what exists and exits 3 | Rows are validated beforehand so a failure is systemic; the note step is idempotent, so a retry with --resume is safe |
| 2026-10-27 | NUD-155 | Orders have no order number and no product snapshot; the report lists order ids, snapshots stay a tour-build concern (Stop.items) | The data model (section 6, schema) has neither; adding them is out of scope and would need a migration |
| 2026-10-27 | NUD-155 | Notes rule: empty CSV notizen = untouched; empty stored note = set; non-empty = append " | <csv>" unless the stored note already contains the text; `--replace-notes` overwrites | Client rule; notes belong to the customer and stay until deleted; re-running never doubles an entry |
| 2026-10-27 | NUD-155 | Notes are saved through `updateCustomer` with a failing translator so they are stored German-only with `pendingTranslation` for the retry job; `--translate-now` uses DeepL | No network call or Fake [zh-Hans] text from a script run; same pipeline as office edits, filled within minutes by the retry cron |
| 2026-10-27 | NUD-155 | menge 1..9999 digits only (no comma/decimal/sign), Karton ja/nein case-insensitive, notizen max 2000 characters, line breaks inside a quoted note become one space, at most 1000 rows | Sane limits against typos; 2000 is the customer form limit; whole numbers per D23 |
| 2026-10-27 | NUD-155 | Header must equal `customerNumber;menge;Karton;notizen` (case-sensitive; empty trailing Excel columns tolerated); completely empty rows are ignored; a row with 3 cells is allowed (empty note), more than 4 non-empty cells is an error (unquoted `;` in a note) | Excel exports trailing `;;` and drops nothing else; a wrong header means a wrong file and is refused as a whole |
| 2026-10-27 | NUD-155 | Row numbers in the output are spreadsheet rows (header = row 1); customer numbers are matched case-insensitively and trimmed; the file must be strict UTF-8 (otherwise refused with the Excel hint) | The office finds the row in Excel at once; Windows-1252 files would silently garble umlauts |
| 2026-10-27 | NUD-155 | Delivery day: `--date` or today in `Settings.timezone` (default Europe/Vienna); a past day is refused; the planned day is the given date even on a non-delivery weekday | The order service refuses past days; an explicit day was requested by the client |
| 2026-10-27 | NUD-155 | Actor: first active ADMIN by creation date or `--actor <email>` (must be an active ADMIN) | Same user rule as the order audit entries; no password or session needed in a script |
| 2026-10-27 | NUD-155 | Warnings never block: no address point and no Parkplatz, customer already has confirmed orders that day, customer repeated in the file; products are checked by sku, unit and weight (10 kg CRATE / 3 kg PACK) and the run is refused if the catalog differs | Client rule; a changed catalog means the mapping ja/nein would be a guess |
| 2026-10-27 | NUD-156 | `ORS_BASE_URL` (trim, drop trailing slashes, blank = unset) is read by the geocoder and the routing provider; unset keeps `https://api.openrouteservice.org` | One knob for a self-hosted instance; both classes already accepted a `baseUrl`, it was just never fed from the environment |
| 2026-10-27 | NUD-156 | **Self-hosting ORS does not solve the geocoding quota:** the official image ships no geocoding endpoint (only routing, matrix, isochrones, snapping, matching, export, health, status; the public `/geocode/*` is a separate Pelias service) | Evidence: `jar tf /ors.jar` lists exactly those 8 controllers and `application.yml` has no `geocod*` key. Recorded so nobody builds a routing graph expecting coordinates |
| 2026-10-27 | NUD-157 | The geocoding quota gets its own ticket; the 94 customers without an Adresspunkt stay open and the office button remains the operator path | A self-hosted routing server cannot close that gap, and the bulk load does not fit into one free key's day |
| 2026-10-27 | NUD-158 | Per-trip vehicle is `Stop.vehicleId` (null = the tour's vehicle) rather than a trip table | Trip boundaries are already per stop (`Stop.trip`); one nullable FK column, existing rows need no migration of data |
| 2026-10-27 | NUD-158 | Vehicle switch = 5 min constant at the depot (`VEHICLE_SWITCH_MINUTES`, not a setting), reload stays 20 min | Same simplest-model choice as the reload time in NUD-147; NUD-152 may make both settings |
| 2026-10-27 | NUD-158 | Drivers get whole vehicle chains, longest first to the driver with the least work (LPT); a vehicle is never shared by two drivers | Simplest balanced rule; avoids two drivers needing the same vehicle at the same time |
| 2026-10-27 | NUD-158 | Too many stops for one planning run: plan the compact cluster around the depot (Prim-style growth), list the rest as "Heute nicht eingeplant" from the live data (orders of a planned day on no tour) — nothing stored | Owner: never block the day; the list must survive a page reload without a new column |
| 2026-10-27 | NUD-159 | German unit words are Sackerl (PACK) and Kiste (CRATE), replacing Beutel and Karton in de.json, docs, the hand-off page and comments; the label stays invariant after a number. Identifiers (PACK/CRATE, SKUs, parseKarton) and the other four locales are unchanged. Import CSV header column 3 is `Kiste`; `Karton` stays a legacy alias. Forbidden-words guard inverted. | Owner request; amends D23 |
| 2026-10-27 | NUD-133 | Fixtures committed under `tests/fixtures/locale/` with descriptive names (orders-totals.json, admin-forms.json); deploy tarball built from `git ls-files` (tracked files only); `deploy.ps1` ends with an explicit `exit 0` | Simplest option; root cause of the exit code 1 not reproduced, unconfirmed until the next real deploy |
| 2026-10-27 | NUD-129 | Order list and detail made to fit 393 px (filter chip groups and page-header actions wrap) instead of scoping the spec to desktop | Office uses a phone for WhatsApp screenshots (D6) |
| 2026-10-27 | NUD-130 | Only the `afterAll` gets an explicit 120 s timeout (same as `beforeAll`); no file-level hookTimeout | Smallest change |
| 2026-10-27 | NUD-128 | Redesign drift beyond the plural labels (hidden range inputs, aria-checked, collapsed sums card) fixed inside the ticket as navigation/expectation steps | The spec could not go green otherwise; no assertion weakened |
| 2026-10-27 | NUD-116 | Warning shows whenever every tour of the day is COMPLETED (also before a customer is picked); text says "if this order is confirmed"; separate action `dayTourCompletedAction` | The form has no status selector; date checked = planned day or window start |
| 2026-10-27 | NUD-121 | `stop.problem` audit entries store `hasNote`/`noteLength` instead of the note text; retention periods unchanged | Removes the privacy gap with the smallest change |
| 2026-10-27 | NUD-154 | `markOutdatedForDate` customer filter and the `listConfirmedOrdersForDate` ownership rule count only stops on non-COMPLETED tours; an order whose customer has no stop on an open tour keeps today's behaviour (all open tours flagged/in scope); a customer with stops on two open tours is offered to both until released onto one | Smallest rule that satisfies the criteria; NUD-099 unchanged |
| 2026-10-27 | NUD-119 | Marker tap/Enter/Space navigates straight to `/driver/stops/<id>`, no intermediate popup | Simplest option; keeps 48 px targets; a first-tap tooltip would hide the name on touch |
| 2026-10-27 | NUD-118 | Label "Tour n von m · Folgetour" only when the driver has 2+ released tours that day (n = creation order among that driver's tours); the page follows the offline copy via `router.refresh()` only when the stored tour id changes; `tourNumber`/`tourCount` default to 1 in the cache schema | No schema-version bump, no refresh on a mere revision change |
| 2026-10-28 | NUD-165 | The one-off parking-spot import is archived, not extended: the 10 undecided pins are resolved by the driver in the field via the existing Parkplatz path, the Street-View route for `STORE` photos is dropped (coverage + ToS), and the client's raw captures plus the derived work directory stay git-ignored while the pipeline, docs and report template are tracked | It was a workaround for data the client collected before the app could take it; production now matches the field data and the app owns the path from here |
| 2026-10-28 | NUD-150 | The raw extraction answer is stored on the order (`Order.sourceText`, `Order.aiExtraction`), not on `Screenshot.extraction` as the ticket text said: a draft from pasted text has no screenshot at all, and the screenshot row is only created together with the order | One place for both input kinds; the answer is validated by `orderInputSchema` so no arbitrary client JSON reaches the column |
| 2026-10-28 | NUD-150 | The model never returns catalogue ids: it returns the product words it read, the unit word decides between products that share a name, and an ambiguous/unknown product is listed as `unmatched` for the office instead of being guessed | A wrong delivery quantity is the client's top concern (backlog §1); reporting costs the office seconds |
| 2026-10-28 | NUD-150 | `response_format: json_object` plus strict zod validation of the answer, no streaming, max 1500 answer tokens | A rambling answer must fail loudly rather than fill half an order |
| 2026-10-28 | NUD-150 | Default model is `deepseek/deepseek-v4.1-flash-1017` instead of `google/gemini-2.5-flash`, and the request switches thinking off (`OPENROUTER_REASONING=off` → `reasoning: {enabled:false}`) | Owner request: the DeepSeek snapshot is multimodal (`text+image`), cheaper per output token, and its thinking would bill reasoning tokens for a deterministic extraction task. The old default was never measured against a live API (no key in the build environment), so nothing regresses |
| 2026-10-28 | NUD-150 | The request is pinned to one provider (`OPENROUTER_PROVIDER`, default `together`) with `provider.order` + `allow_fallbacks:false`, instead of letting OpenRouter pick the cheapest of ~35 endpoints | Owner request: for this model several hosts serve aggressively quantised (fp4) variants, so the reading quality would otherwise change from draft to draft. Trade-off accepted: a pinned host that is down fails the draft visibly instead of quietly using a worse one |
| 2026-10-28 | NUD-150 | The OpenRouter client also fills the Serbian slot of the translation chain: existing `sr-Latn` gaps are closed by the one-off `pnpm backfill:serbian -- --apply` (dry run by default, refuses the FakeTranslator), new texts get Serbian immediately | NUD-140 promised this in NUD-150; without the backfill old notes would stay German for a Serbian driver |
| 2026-10-28 | NUD-166 | The rule created from the order form leaves the delivery day of the order being entered out (`exceptions`, a checkbox that is on by default) instead of moving the start day | The rule generates its own orders from its start day, and all confirmed orders of a customer on one day are merged into one stop — without the exception the same quantity would be loaded twice. The office keeps the choice, so a rule that really should start on that day is one click away |
| 2026-10-28 | NUD-166 | The dialog only takes schedule fields (days, rhythm in weeks, start day); season and single-date exceptions stay on the customer page | Keeps the order screen to what the customer just said ("every Monday and Thursday"); the full rule form already exists at Kunde › Dauerbestellungen |
| 2026-10-28 | NUD-156/157 | ORS **and** Photon run on the development PC in Docker and the vServer reaches them through a reverse SSH tunnel (owner decision, E4) | The 2 GB box already hosts Postgres, MinIO, the app and two other sites; an Austria ORS graph alone wants ~4 GB. Trade-off: routing and geocoding are as available as that PC — both degrade to the heuristic / the Fake instead of failing |
| 2026-10-28 | NUD-156 | The tour order stays with the app's own heuristic; distances, driving times and the route line come from the self-hosted ORS | No ORS image ships `/optimization` any more (v7, v8 and v9 checked) and VROOM would need an OSRM graph of its own. Real roads where they are cheap to get, local 2-opt for the order |
| 2026-10-28 | NUD-113/167 | Retention stays as it is: nothing is deleted on a schedule (`DATA_RETENTION_MODE` and `ORPHAN_CLEANUP_MODE` stay `dry-run`), only the screenshot lifecycle rule expires objects after 190 days (owner decision, E2) | "Einfach aufbewahren" — orders, tours and stops are transactional history; the lifecycle rule only covers the transient upload of a WhatsApp screenshot |
| 2026-10-28 | – | Vehicle profile stays `driving-car`; no `driving-hgv` graph is built (owner decision, E3) | The fleet has no trucks today; switching later is one env var plus a graph rebuild |
| 2026-10-28 | NUD-120 | The strict script CSP stays enforcing (no report-only phase on this deployment) and the violation `report-uri` is now base-path aware (owner decision, E5) | It has been live since NUD-110 and the app works; the report path was the actual bug — reports from iOS/WeChat went to the nginx root and were lost as 404s |
| 2026-10-28 | NUD-168 | Production map tiles: Stadia Maps free tier (keyed, CORS-capable for the tile cache), with MapTiler as the equal alternative; the OSM default stays until a key exists (owner delegation) | The OSM tile server is explicitly development-only, and a key can only be created by a person |
| 2026-10-28 | NUD-152 | Working time = one `WorkSchedule` row per driver and ISO weekday (minutes since midnight, `active=false` = soft-deleted, no row = not worked); measured from the loading start (checklist timestamp, else `departedAt − Settings.defaultLoadingMinutes`, default 20) to the last completed stop plus the planned drive back; planned = loading time plus `Tour.totalDurationS`; tours across midnight are excluded with a reason instead of being split | Minutes-of-day lets the DB enforce `0 ≤ start < end ≤ 23:59`, and the drive back comes from stored planned data, so actual and planned compare like with like without new timestamps on the tour |
| 2026-10-28 | NUD-152 | The shift warning never blocks a release, and a driver without a schedule produces no warning | The office must stay able to plan for someone without a contract in the system; a blocking warning would be a hard rule nobody asked for |
| 2026-10-28 | NUD-171 | Dauerbestellung: Wochen- und Monatsmuster sind eine **Vereinigung** (`weekdays` + `monthlyRules`), `dayOfMonth` wird nicht geklemmt, `nthWeekday` kennt `-1` = letzter; Produkte dürfen je Wochentag abweichen (`RecurringOrderDayItem`, ohne Zeilen gilt die Basismenge) | Kunden bestellen unregelmäßig ("jeden 1. und 15.", "jeden 1. Montag") und in unterschiedlichen Mengen je Tag; ein Vereinigung-Modell deckt beides ohne Sonderfälle in der Generierung ab |
| 2026-10-28 | NUD-171 | Befristung ist **exklusiv** (unbefristet / bis Datum / nach N Lieferungen), ein leeres Feld bei gewählter Befristung ist ein Validierungsfehler; `maxDeliveries` zählt stornierte Lieferungen mit | Zwei gleichzeitige Endbedingungen wären nicht erklärbar; eine stornierte Lieferung ist trotzdem passiert und soll das Budget nicht wieder freigeben |
| 2026-10-29 | NUD-172 | ETAs werden ab der Abfahrt und nach jedem Abschluss aus dem tatsächlichen Fortschritt neu berechnet und in `Stop.etaAt` geschrieben; „Ende ca." und die Büro-Kachel lesen diesen Wert statt eigener Rechnungen (Option B) | Nur die live gerechnete Zahl stimmt den ganzen Tag; drei Rechenbasen auf einem Bildschirm sind der Befund (F3) |
| 2026-10-29 | NUD-173 | Background Sync wird der Hauptpfad (Registrierung bei jeder Queue-Mutation), dazu der Controller auf der Offline-Shell als Fallback mit zurückgesetztem Backoff und 60-s-Deckel (Option B) | Die Ursache war der fehlende Mount auf der Offline-Shell; Background Sync deckt zusätzlich die geschlossene App — ohne Polling |
| 2026-10-29 | NUD-174 | Pille und Panel leiten ihren Text aus `flushing`/`inFlight`/letztem Fehler ab statt aus `navigator.onLine`; „wird gesendet" nur bei laufender Übertragung (Option A) | Der Controller kennt die Wahrheit bereits; `navigator.onLine` bleibt bei totem Server grün |
| 2026-10-29 | NUD-175 | `public/theme.js` kommt in die Precache-Globs von `scripts/build-pwa.ts` (Option A) | Ein blockierendes Skript jeder Seite, das offline fehlt, ist ein unhandled dependency — kleinster Fix |
| 2026-10-29 | NUD-176 | Nach dem Buchen bleibt der Fahrer auf dem Stopp („Weiter zu Stopp n" + „Rückgängig" bis zum Server-Fenster) und die Toaster-Ebene der Fahrer-App wandert auf `bottom-center` über die Aktionsleiste (Option B) | Der Undo war im Baum, aber nicht anklickbar; Auto-Advance und Toast-Ebene sind derselbe Fehler (F1+F2) |
| 2026-10-29 | NUD-177 | `problemNote` reist im Fahrer-Payload und wird read-only auf Stopp-Detail, Listenzeile und im Büro-Dashboard gezeigt (Option A) | Der Text wird gespeichert, aber niemand außer dem Tourplaner sieht ihn — der Fahrer kann seine eigene Eingabe nicht prüfen |
| 2026-10-29 | NUD-178 | Ein Lese-Modell für die Tour-Beziehung einer Bestellung (`{id, date, status, stopStatus}`, gefiltert auf den geplanten Tag), storniert = „war Teil einer Tour", klickbare Tour-Zeile (Option B) | Bestelldetail und Touren-Zähler lasen mit zwei Regeln; der gemeldete „verschwindende Knopf" existierte nie |
| 2026-10-29 | NUD-179 | Die Bestellübersicht startet auf „Heute", das Bestellformular behält den nächsten Liefertag (Option A) | Bei Mo–Do-Liefertagen ist der „nächste Liefertag" am Donnerstag Montag — der erste Blick des Büros war eine leere Liste |
| 2026-10-29 | NUD-180 | Problem-Stopps bekommen eine eigene Gruppe, erledigte Zeilen zeigen `completedAt` (Option A) | Ein Problem-Stopp sah aus wie eine Lieferung, und die Zeile nannte eine Uhrzeit, zu der niemand da war |
| 2026-10-29 | NUD-181 | Die Karte (gemeinsamer `PinPickerMap`) kommt in den Auswahlschritt des Fahrer-Parkplatzdialogs, GPS und Zahlenfelder bleiben Fallback (Option A) | Der Picker existiert und wird im Büro benutzt; der Mann auf der Straße hatte das schlechtere Werkzeug |
| 2026-10-29 | NUD-182 | Beide Shells formatieren mit `dateShort`, die Kopfzeile bricht um statt zu kürzen (Option A) | Zwei Formatter für denselben Slot plus `truncate` ergaben „Donnerstag, 29. Ok…" |
| 2026-10-29 | NUD-183 | „0 / 0" wird abgefangen und das KPI-Raster steht ab `lg` dreispaltig (Option A) | Eine Quote ohne Nenner und eine leere Zelle, die wie eine fehlende Kachel aussieht |
| 2026-10-29 | NUD-184 | Benutzername wird kontrolliert geführt und die PIN beim Fehlschlag geleert, Fehler aus derselben Zustandsquelle (Option A) | React setzt nur das unkontrollierte Feld zurück; die Reparatur begann am falschen Feld |
| 2026-10-29 | NUD-185 | Login-Seiten bleiben auch für Angemeldete erreichbar und zeigen „Angemeldet als … / Abmelden" (Option A) | Auf dem geteilten Tablet musste man abmelden, ohne zu wissen warum |
| 2026-10-29 | NUD-186 | Der vorhandene `LanguageSwitcher` bekommt eine `area`-Prop und steht auf der Büro-Anmeldung (Option A) | Die Büro-UI existiert in drei Sprachen, die Wahl war erst nach dem Login möglich |
| 2026-10-29 | NUD-187 | Hinweis und Link auf die Fahrerliste über der Auslastungstabelle und im Leerzustand (Option A) | Ohne Arbeitszeiten ist die Seite eine Wand aus Strichen, und der Pfad stand nirgends |
| 2026-10-29 | NUD-188 | Seed korrigiert `fahrer-de` auf `de`, Testreste werden einmalig archiviert (nicht gelöscht), e2e läuft gegen die dedizierte Datenbank (Option A) | Demo-Sprache und Testreste stören jede Vorführung; Archivieren respektiert die Regel „keine Geschäftsdaten löschen" |
| 2026-10-29 | NUD-189 | Teillieferung wird ein eigenes Epic nach dem Defekt-Block (Option C) | Es ändert Datenmodell und Buchhaltung und ist kein Fix am QA-Befund |
| 2026-10-29 | NUD-190 | Kundenstatus-Link kommt nach NUD-172 (Option C) | Der Link ist nur so gut wie das Zeitmodell, das er anzeigt |
| 2026-10-29 | NUD-104 | Foto-Nachweis: NUD-104 wird erweitert und nach dem Defekt-Block umgesetzt (Option A) | Die Lücke in der Beweiskette ist unabhängig von Mengen und braucht eigene ACs |
| 2026-10-31 | NUD-192 | Das Designer-Archiv wird als ein Commit übernommen (kein Rebase auf fremde Zwischenstände), Herkunft nur im Ticket vermerkt | Der Import ist ein UI-Diff gegen `main`; ein Zwischenstand hätte keinen eigenen Prüfwert |
| 2026-10-31 | NUD-156/157 | ORS und Photon bleiben vorerst auf dem Entwickler-PC (Docker + Reverse-Tunnel); die Ablösung ist als geordnete Checkliste in `deploy/local-services/README.md` festgehalten und in `AGENTS.md`, `docs/runbook.md` §14 und `docs/deploy.md` §13 verlinkt | Der 2-GB-vServer kann beide nicht tragen, aber ein Deploy startet sie nicht mit — ohne Notiz geht das beim Übergang auf den Kundenserver verloren |
| 2026-11-02 | NUD-194 | Die „feste Route" des Auftraggebers wird als `StandingTour` (Stammtour) modelliert: feste Kundengruppe + Standardfahrer, **kein** `Tour`-Datensatz und keine Bindung an Fahrten | Das Glossar (§3) verbietet „Route" für eine Tour; die Gruppe ist eine Planungshilfe, die Touren baut weiterhin „Touren planen" |
| 2026-11-02 | NUD-194 | Menge 0 heißt „nichts bestellt" und **behält** die Bestellung (ohne Positionen) statt sie zu stornieren; eine 0-Zeile ohne vorhandene Bestellung legt keine an; `buildStops` überspringt Bestellungen ohne Position | Auswahl des Auftraggebers: „nichts" soll in der Bestellliste sichtbar bleiben; ein Stopp ohne Ware darf nicht auf die Tour |
| 2026-11-02 | NUD-194 | Vorbelegung kommt aus der Dauerbestellung des Wochentags, gespeichert wird sie erst beim Speichern; stornierte Bestellungen schlagen nichts vor | Wunsch des Auftraggebers (Dauerbestellung ist die Voreinstellung), und ein Blick auf die Seite darf keine Bestellungen erzeugen |
| 2026-11-02 | NUD-194 | Ein Kunde gehört zu genau einer aktiven Stammtour (serverseitig geprüft); die Mengenansicht ist ab der ersten freigegebenen Tour des Tages schreibgeschützt | Sonst stünde derselbe Kunde in zwei Tabellen und ein Speichern würde sich selbst überschreiben; freigegebene Mengen gehören dem Fahrer (D10) |
| 2026-11-02 | NUD-194 | Mehrere bestätigte Bestellungen eines Kunden am Tag werden auf die erste zusammengeführt, die übrigen storniert (auditiert) | Eine Tabellenzeile pro Kunde: sonst zeigte die Zeile die Summe, das Speichern aber nur einen Teil |
| 2026-11-02 | NUD-195 | „Geliefert" auf der Karte des nächsten Stopps nutzt denselben Outbox-Weg wie der Stopp-Screen (kein zweiter Serverpfad), ohne Rückfrage, dafür mit 10-s-Rückgängig im Toast | Ein-Tipp-Bedienung war der Wunsch; ein zweiter Pfad wäre die Stelle, an der Offline und Idempotenz auseinanderlaufen |
| 2026-11-02 | NUD-196 | Keine Katalogpreise: der Betrag ist ein Feld der Bestellung (`amountCents`, optional, ganze Cent), nicht des Produkts | Entscheidung des Auftraggebers; passt zu D7 (keine Preise) und lässt alte Rechnungen unverändert, weil der Betrag an der Bestellung steht |
| 2026-11-02 | NUD-196 | Bar bei Lieferung ist die Ausnahme, Monatsrechnung der Standard (Feld auf der Bestellung, kein Kundenstammfeld) | Wunsch des Auftraggebers; ein Kundenstandard hätte jede neue Bestellung vorbelegen müssen, ohne dass jemand ihn pflegt |
| 2026-11-02 | NUD-196 | Der Fahrer erfasst den kassierten Betrag als eigene Offline-Mutation (`payment`, `StopMutation.kind = PAYMENT`, idempotent je `clientMutationId`) und nur auf einem bereits gelieferten Stopp | Geld wechselt mit der Ware; der Weg ist derselbe wie bei Schlüssel/Parkplatz, damit es im Keller funktioniert und nicht doppelt gebucht wird |
| 2026-11-02 | NUD-196 | „Bezahlt" einer Monatsrechnung ist ein Snapshot (Summe + Anzahl Bestellungen) mit `voidedAt` statt Löschen; ein Monat ist erst nach seinem Ende markierbar | Bestellungen können später noch geändert werden; die Historie bleibt im Audit-Log, und der laufende Monat ist noch nicht abzurechnen |
| 2026-11-13 | NUD-197 | Korrekturen sind feste Euro-Beträge mit Text, keine Prozent-Rabatte | Es gibt keine Katalogpreise (D33); ein Prozentsatz würde sich mit jeder nachträglich geänderten Bestellung verschieben, ein fester Betrag bleibt, was vereinbart wurde |
| 2026-11-13 | NUD-197 | Korrekturen sind gesperrt, solange der Monat als bezahlt markiert ist | Der Bezahlt-Vermerk ist ein Snapshot der Summe; eine spätere Korrektur würde ihn still falsch machen. Zurücknehmen, korrigieren, neu markieren hält die Historie ehrlich |
| 2026-11-13 | NUD-198 | CSV richtet sich nach der Sprache des Bildschirms: `de` mit `;`, `42,50` und `31.10.2026`, sonst `,`, `42.50` und ISO-Datum | Eine CSV trägt kein Format in sich, Excel rät nach der Sprache des Rechners; so öffnet ein Doppelklick die Datei richtig |
| 2026-11-13 | NUD-198 | PDF wird auf Deutsch oder Englisch geschrieben, für `zh-Hans` auf Deutsch | Der Empfänger der Rechnung liest Deutsch. Chinesische Namen, Produkte und Notizen werden trotzdem richtig gedruckt (Noto Sans SC als zweite Schrift, nur die benutzten Zeichen landen in der Datei) |
| 2026-11-13 | NUD-198 | PDF mit `pdf-lib` auf dem Server gezeichnet statt über einen Browser gedruckt | Kein Chromium auf dem Server nötig, gleiche Datei für alle, in Tests prüfbar |
| 2026-11-13 | NUD-198 | Export ist eine Aufstellung ohne Rechnungsnummer und Umsatzsteuer | Die App kennt weder Steuersätze noch Nummernkreise; eine echte Rechnung braucht eine fachliche Entscheidung des Kunden |
| 2026-11-13 | NUD-199 | Die Historie zeigt nur gültige Vermerke; zurückgenommene bleiben im Audit-Log | Die Seite beantwortet „was ist bezahlt", nicht „was wurde je geklickt". Der Verlauf dazu steht nur in der Tabelle `AuditLog` (`monthly.pay`, `monthly.unpay`); die App zeigt ihn bisher nirgends an |
| 2026-11-13 | NUD-197 | Keine Korrektur in einem Monat ohne bestätigte Bestellung auf Monatsrechnung | Ein solcher Monat taucht weder in der Liste der offenen Monate noch im Export auf; die Korrektur wäre gebucht, aber unsichtbar |
| 2026-11-13 | NUD-198 | Bezahlte Monate tragen den bezahlten Betrag in CSV und PDF | Der Vermerk ist ein Snapshot; ändert sich danach eine Bestellung, muss die Buchhaltung sehen, was wirklich bezahlt wurde |
| 2026-11-13 | NUD-197…199 | Ein PR mit drei Commits statt drei PRs | Export und Historie bauen auf den Korrekturzeilen auf (Summe, Snapshot); einzeln wären die PRs nicht unabhängig prüfbar |
| 2026-11-13 | NUD-200 | The dump is taken on the server by a systemd timer, not by GitHub Actions | The database listens on 127.0.0.1 only; opening it to the internet or giving GitHub an SSH key to production would both be worse than a job next to the database |
| 2026-11-13 | NUD-200 | A backup holds master data only (allow-list of tables, everything else without rows); no full backup exists | Owner: only settings and standing tours are to be kept, orders, invoices and payments are not to be stored; an allow-list keeps a table added later out by default |
| 2026-11-13 | NUD-200 | Standing (recurring) orders, products, vehicles, users and photo records count as master data | They are what the standing tours and the day planning are built from, and without users nobody can log in after a restore; they are settings per customer, not deliveries |
| 2026-11-13 | NUD-200 | Backups stay on the server; the bucket destination of NUD-094 remains in the code, switched off, and its GitHub check is skipped | Owner: store it on the server only. Deleting tested code would only make a later change of mind expensive |
| 2026-11-13 | NUD-200 | Nightly instead of weekly, same 8 weeks retention | A dump of the master data is a few hundred kB; a week of changed customers and standing tours is more than anybody wants to retype |
| 2026-11-13 | NUD-200 | The job uses the app's `DATABASE_URL` unless `BACKUP_DATABASE_URL` is set | One secret less to copy and rotate on a single host; `pg_dump` only reads, a read-only role stays possible |
| 2026-11-13 | NUD-201 | Bezahlte Bestellungen, Touren und Monatsrechnungen werden 30 Tage nach der Bezahlung endgültig gelöscht; Unbezahltes bleibt. Das Archiv (erster Ansatz) ist verworfen | Entscheidung des Kunden (13.11.2026): außer Einstellungen, Kunden und Stammtouren soll nichts aufbewahrt werden. Auf mögliche gesetzliche Aufbewahrungspflichten für Rechnungen wurde hingewiesen. Hebt für diese Daten die Regel „never hard-delete business data" (4.3) auf |
| 2026-11-13 | NUD-201 | Bar bei Lieferung zählt ab dem vollständigen Kassieren; offene und zum Teil bezahlte Barbeträge werden nie gelöscht | „Unbezahltes bleibt" gilt für beide Zahlungsarten; sonst verschwände eine offene Forderung |
| 2026-11-13 | NUD-201 | Stornierte Bestellungen, Entwürfe und nie gelieferte Barbestellungen gehen 30 Tage nach dem Liefertag | Für sie ist nichts zu bezahlen; ohne eigene Regel blieben sie für immer liegen |
| 2026-11-13 | NUD-201 | Bestellung und Stopp gehen nur zusammen; eine Tour verschwindet erst mit ihrem letzten Stopp | Ein unbezahlter Auftrag braucht seinen Stopp (Lieferstatus, kassierter Betrag). Halbe Stopps darf es nicht geben; dass eine alte Tour dabei Stopps verliert, nimmt die Entscheidung des Kunden in Kauf |
| 2026-11-13 | NUD-201 | Standard ist `dry-run`; gelöscht wird erst nach `ORDER_RETENTION_MODE=delete` auf dem Server | Löschen lässt sich nicht zurücknehmen. Ein Deploy darf nicht von selbst damit anfangen; der Betreiber liest erst die Zählungen |
| 2026-11-13 | NUD-201 | Eine Barbestellung, deren Stopp auf einer freigegebenen Tour nie abgehakt wurde, bleibt, solange dort Geld fällig ist | Der Zustand ist unbekannt, nicht „nichts offen". Löschen ist endgültig, also im Zweifel behalten; das Büro lässt den Stopp abschließen oder storniert die Bestellung |
| 2026-11-13 | NUD-201 | Ein unbrauchbarer Wert in `ORDER_RETENTION_DAYS` stoppt den Lauf, statt auf 30 zurückzufallen | Bei den anderen Aufräum-Jobs ist der Rückfall die vorsichtige Richtung, hier wäre er die kürzeste Frist |
| 2026-11-13 | NUD-201 | `maxDeliveries` eines Dauerauftrags wird gegen einen eigenen Zähler geprüft, nicht gegen die vorhandenen Bestellungen | Gelöschte Bestellungen hätten einem aufgebrauchten Dauerauftrag sein Kontingent zurückgegeben; der Kunde bekäme Lieferungen, die er nicht bestellt hat |
| 2026-11-13 | NUD-201 | Das Änderungsprotokoll wird nicht mitgelöscht | Es ist append-only (Trigger) und hat seine eigene Frist (NUD-111). Wer die Spuren früher loswerden will, senkt `AUDIT_RETENTION_DAYS` (mindestens 90) |
| 2026-11-13 | NUD-202 | Railway instead of an own Hetzner server | Owner's choice after a comparison: the cheap Hetzner cloud line could not be ordered, the orderable ones cost about the same as Railway, and on Railway a push deploys and nobody has to administer a server |
| 2026-11-13 | NUD-202 | Settings live in `docs/deploy-railway.md`, not in a `railway.json` | Railway deprecated Config as Code; new services cannot opt in and existing files stop being read on 2026-12-01 |
| 2026-11-13 | NUD-202 | One cron service with a dispatcher instead of seven cron services | A Railway cron service has one schedule; seven services would be seven images and seven places to forget. The price is a second copy of the job list, guarded by a test |
| 2026-11-13 | NUD-202 | The backup on Railway is still the master-data dump; Railway's volume backups stay off | Owner (NUD-200/201): orders and payments are not to be kept. A volume backup would hold them for its whole retention |
| 2026-11-13 | NUD-202 | Photos in a Railway bucket instead of MinIO in a container | No volume to size and back up, no service to keep running; costs USD 0.015 per GB. It needs virtual-hosted URLs and a CORS rule, both now supported |
| 2026-11-13 | NUD-202 | Photon reads a prebuilt Austria index instead of an own Nominatim import | Nominatim needs a PostGIS database of its own and hours of import for the same search result; the prebuilt index is one download |

## 10. Open questions for the client (do not block on these – use placeholders)

- Exact depot (factory) address → set in Settings (NUD-012).
- Real product list with units and Chinese names → seed / product admin (NUD-020).
- Existing customer list file → import (NUD-090).
- ~~Which Chinese variant(s) the drivers actually read~~ → decided 2026-10-26: Simplified only (D21).
- Does DeepL support Serbian? If not, Serbian content translation runs through OpenRouter (NUD-140).
- OpenRouter model choice and budget (NUD-150).
- Vehicle type (car vs. van/truck profile for routing) → ORS profile setting (NUD-040).
- Map tile provider account for production (NUD-011) and DeepL API account (NUD-070).
- ~~Retention of orders, tours and stops (NUD-112)~~ → decided 2026-11-13: paid orders, tours and monthly bills are deleted 30 days after the payment, unpaid ones stay (NUD-201). Still to confirm by the client: the driver text period (365 days proposed), the audit period (730 days proposed; the audit log keeps entries about deleted orders until then), and with the tax adviser whether invoices may be deleted that early (`docs/privacy.md` section 6).
