---
covers:
  - prisma/**
  - src/server/db.ts
stamp: 2e767538e56f55123ef88644411cd9133890e106643f72672603b78106039e8b
status: fresh
stale_since: null
---

# Data model, migrations and the database client

This module owns the persistence layer of the app: the Prisma schema that defines the PostgreSQL
schema, the migrations that bring a database up to date, the seed script that fills core data, and
the shared Prisma client factory used by every server module, test and script.

## The schema (`prisma/schema.prisma`)

The provider is `postgresql`; the generated client is emitted to
`src/generated/prisma` (output `../src/generated/prisma`). All models carry CUID
`id` primary keys and `createdAt`/`updatedAt` timestamps where recent rows are mutable.

### Enums

| Enum               | Values                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `Role`             | `ADMIN`, `DRIVER`                                                                                 |
| `Locale`           | `de`, `en`, `sr_Latn` (`@map("sr-Latn")`), `cs`, `zh_Hans` (`@map("zh-Hans")`) — BCP-47 tags      |
| `Unit`             | `KG`, `PACK`, `CRATE`, `PIECE`                                                                    |
| `PhotoKind`        | `STORE`, `PARKING`                                                                                |
| `OrderSource`      | `MANUAL`, `SCREENSHOT`                                                                            |
| `OrderStatus`      | `DRAFT`, `CONFIRMED`, `CANCELLED`                                                                 |
| `TourStatus`       | `DRAFT`, `OPTIMIZED`, `RELEASED`, `IN_PROGRESS`, `COMPLETED`                                      |
| `StopChange`       | `ADDED`, `CHANGED`                                                                                |
| `StopStatus`       | `PENDING`, `DELIVERED`, `PROBLEM`                                                                 |
| `ProblemReason`    | `CLOSED`, `NOBODY_THERE`, `NO_PARKING`, `WRONG_QUANTITY`, `REFUSED`, `ADDRESS_NOT_FOUND`, `OTHER` |
| `StopMutationKind` | `COMPLETE`, `UNDO`, `KEY`, `PARKING`, `LOADING`, `DEPART`                                         |

### Models

- **`User`** — an ADMIN or DRIVER account. Login is `email` (admin) or `username` (driver), both
  unique and nullable; `passwordHash` is the stored bcrypt hash, `locale`/`localeChosen` drive the
  first-start language picker, `active` disables the account, and `lastLoginAt` is set on every
  successful login. Users are normally deactivated; an admin can also delete one for good (NUD-206, `src/server/user-delete.ts`, which first moves or clears every referencing row because they use `onDelete: Restrict`).
- **`Settings`** — a singleton row (`id = 1`) holding depot name/address/coordinates,
  `depotPinConfirmed` (tour building requires it), `timezone`, `departureTime`,
  `serviceMinutesPerStop`, `deliveryWeekdays` and `departureChecklist` (JSON list of `{ id, text: LocalizedText }`:
  the fixed items of the driver's departure checklist, NUD-151; German is the source).
- **`Customer`** — addresses with `customerNumber` (unique), coordinates (the address point; `pinConfirmed` is unused since NUD-141), the optional key (`hasKey`, `keyNumber`, `keyUpdatedById`, `keyUpdatedAt`; NUD-142), and
  - Temporary (NUD-164): `abbreviation`, `abbreviationUpdatedById`, `abbreviationUpdatedAt` hold the legacy Abkürzung (free text, not unique); `StopMutationKind` also has `ABBREVIATION` for a driver's entry. Drop them when the old system is retired.
  `notes`/`deliveryHoursInfo`. Office-only master data (NUD-136): `companyName` ("Firma"), `vatId`
  ("UID") and `billingStreet`/`billingPostalCode`/`billingCity`, set only when the billing address
  differs; `street`/`postalCode`/`city` are always the **delivery** address (geocoded, routed, shown
  to the driver). `searchText` is accent-folded search material **maintained by a DB
  trigger — never write it** (see migrations, NUD-013). Referenced with `onDelete: Restrict`.
- **`Photo`** — a customer photo (`kind` STORE or PARKING) whose binary lives in object storage;
  the row holds `storageKey`, dimensions and `bytes`, the uploader, and `isCurrent`
  (only the current photo per customer/kind is shown). `clientMutationId` is the driver client's
  idempotency key (NUD-083): a retry of the same capture reuses the row; `null` for office uploads.
- **`Product`** — the catalog: `sku` (unique), `name` as LocalizedText JSON, `unit`, `weightKgPerUnit` (`Decimal(6,2)`, > 0, admin-editable;
  Sackerl 3 kg, Kiste 10 kg, Wantan-Teig 5 kg, NUD-138), `active`, `sortOrder`. Referenced with `onDelete: Restrict`.
- **`Screenshot`** — an uploaded order screenshot in object storage, with optional `extraction`
  JSON produced by AI extraction (M3). `onDelete: Restrict` on the uploader.
- **`Order`** — a delivery order for a customer on a `deliveryDate` (SQL `DATE`), with
  `status`, `source` (manual or from screenshot), optional `screenshotId` (`onDelete: SetNull`),
  `internalNote`, and the creating user (`Restrict`). Indexed on `(deliveryDate, status)` and
  `(customerId, deliveryDate)`.
- **`OrderItem`** — one order line: product, quantity (`Int`, whole numbers since NUD-137). Cascades with its order,
  restricts product deletion.
- **`Tour`** — a route for `date` (no unique constraint: several tours per date are allowed),
  optional `driverId` (`Restrict`), `status`, `isOutdated`, `locked`, `depotSnapshot` JSON,
  optional `geometry` JSON, `totalDistanceM`/`totalDurationS`, `approximate`
  (true when the route came from the local heuristic), and the release bookkeeping of NUD-043:
  `releaseRevision` (0 = never, 1 = first release, +1 per re-release), `reReleasedAt`
  (null until the first re-release), `lastChange` (TourDiff plus revision and removed-stop names), and the
  departure checklist times of NUD-151: `loadingStartedAt` (the driver opened the checklist) and
  `departedAt` ("Losfahren" or skipped), both written once by the driver app (first write wins).
  Stops cascade with their tour.
- **`Stop`** — one delivery stop in a tour: `sequence`, `status`, `etaAt`,
  `legDistanceM`/`legDurationS`, `problemReason`/`problemNote` (LocalizedText), `completedAt`,
  optional `clientMutationId` (unique, the driver's idempotency key), and the release snapshot
  `items` (`[{productId, quantity}]`) that the driver sees — never the live order lines.
  On a re-release that changes the stop, `previousItems`, `changeKind` (`StopChange`) and
  `changedInRevision` are set; `adminChangedAt` records when the office last changed the stop and
  wins over an older driver mutation in offline sync (NUD-082). Cascade-deletes with its tour;
  `customerId` is `Restrict`.
- **`StopMutation`** — one row per accepted driver stop-status mutation (NUD-053), keyed by the
  client-generated `id`: replaying the same id returns the stored `result` without a second state
  change. `kind` is `COMPLETE` or `UNDO` (`KEY` for a driver's customer-key entry, NUD-142; `LOADING` / `DEPART` for the departure checklist times of the stop's tour, NUD-151). Cascades with its stop.
- **`StopOrder`** — the many-to-many link between stops and orders (composite PK). Stops cascade;
  orders restrict.
- **`LoginAttempt`** — failed logins for rate limiting (NUD-004), keyed
  `"user:<admin|driver>:<identifier>"` or `"ip:<address>"`. Rows older than the window are pruned.
- **`AuditLog`** — append-only history (NUD-092) for orders, tours, stops and customer photos.
  `entity` is `"Order" | "Tour" | "Stop" | "Customer"` and `action` a dotted name such as
  `"order.update"` (plain strings, so new actions need no migration); `diff` holds ids and values
  only (no secrets); `actorId` is deliberately **not** a foreign key because users are archived,
  not deleted. Rows are written by the service layer (`recordAudit`) inside the transaction of the
  change itself and are never updated or deleted — PostgreSQL refuses both (see below).

### Invariants enforced by the database

- Updates/deletes on `AuditLog` raise an exception. The only allowed DELETE is inside a
  transaction that set the advisory setting `nudel.audit_retention = 'on'` (SET LOCAL /
  `set_config(..., is_local := true)`) and only for rows older than 90 days by the database clock —
  retention may never delete recent history. UPDATE is refused always.
- `Customer.searchText` is (re)computed by the `Customer_search_text` trigger on every
  INSERT/UPDATE of the row from `customerNumber`, `name`, `street`, `postalCode`, `city`, using the
  SQL function `nudel_fold` (lower-case + Latin diacritic folding + `ß`/`æ`/`œ` expansion), which
  queries must reuse to fold search terms. The trigger ran once against existing rows in the
  migration (NUD-013).
- Unique constraints: `User.email`, `User.username`, `Customer.customerNumber`, `Product.sku`,
  `Stop.clientMutationId`, `Photo.clientMutationId` (unique index, `null` allowed for office
  uploads). Foreign keys restrict deletes of users, customers, products and orders; `OrderItem`,
  `Stop`, `StopMutation`, `StopOrder` cascade with their parent (`Order`/`Tour`/`Stop`);
  `Order.screenshotId` sets null.

## The migrations (`prisma/migrations/**`)

SQL migrations are applied in timestamp order, ending with `migration_lock.toml` (provider
`postgresql`). They implement the schema above incrementally; the ones that add behavior on top of
plain DDL are:

- `20261017160000_customer_search_text` — creates `nudel_fold`, the `Customer.searchText` column
  and the `Customer_search_text` trigger, then backfills existing rows.
- `20261026160000_customer_company_billing` — adds the five office columns and extends the search
  trigger with `companyName` and `vatId` (NUD-136).
- `20261017180000_tour_release_revision` — adds the NUD-043 columns and backfills: existing stops
  get an `items` snapshot from their linked order lines (whole-number quantities; NUD-137 rewrote the old `quantityCents` JSON to `quantity`), and tours already
  `RELEASED`/`IN_PROGRESS`/`COMPLETED` get `releaseRevision = 1`.
- `20261018120000_audit_log` — creates `AuditLog` plus the `audit_log_append_only` trigger that
  rejects UPDATE/DELETE.
- `20261018130000_audit_log_retention` — `CREATE OR REPLACE`s that trigger to allow the narrow
  90-day retention delete described above (whether or not a delete is allowed is decided by the
  trigger **at execution time**, so this migration is safe on a fresh or existing database).

The remaining migrations are plain schema changes: `20261017120000_init` (baseline), plus
additive columns/tables for login attempts, `lastLoginAt`, `depotPinConfirmed`, `approximate`,
`StopMutation`, `adminChangedAt` and `photo clientMutationId`. Adding new schema fields here is
the normal workflow: change `schema.prisma` and generate a matching SQL migration.

## Seeding (`prisma/seed.ts`)

`seed(prisma)` is **idempotent** (upserts) and creates the singleton `Settings` row, one admin
user, and the demo drivers and products. Environment-driven:

- `SEED_ADMIN_PASSWORD` is required; `SEED_ADMIN_EMAIL` defaults to `admin@example.com`.
- `SEED_DRIVERS` (default on) creates five demo drivers sharing one bcrypt-hashed PIN from
  `SEED_DRIVER_PIN` (must be exactly 6 digits). Never create these well-known-PIN drivers on
  production — set `SEED_DRIVERS=false`.
- Products are the owner's three real products (`src/server/product-catalog.ts`): Nudeln in Sackerl
  (`NUDELN-BEUTEL`, 3 kg), Nudeln in Kiste (`NUDELN-KARTON`, 10 kg) and Wantan-Teig (`WANTAN-TEIG`,
  piece, 5 kg), with LocalizedText names. The seed never overwrites an existing row, so an edited
  weight survives. The migration `20261026180000_product_catalog_weight` creates the same rows,
  archives every other product and moves the old demo order lines onto the new ones.

Run directly (`pnpm db:seed`), the CLI accepts `--demo` (also seeds demo orders/customers/photos
via `seedDemo`, requiring object storage — configured first by `assertDemoStorageConfigured`, which
fails before anything is written if storage is missing), `--no-photos` and `--today`
(orders for today; only valid with `--demo`).

## The database client (`src/server/db.ts`)

- `createPrismaClient(connectionString = process.env.DATABASE_URL, schema?)` — throws if
  `DATABASE_URL` is missing; builds a `PrismaPg` adapter and a `PrismaClient`. When `schema` is
  given (tests), it also sets the connection's `search_path` to that schema, because raw SQL,
  triggers and SQL functions (e.g. `nudel_fold`, the audit trigger) use unqualified names while the
  adapter only qualifies tables in generated queries.
- `getDb()` — a lazily-created singleton Prisma client kept on `globalThis`, so hot reloads in
  dev reuse one client.
