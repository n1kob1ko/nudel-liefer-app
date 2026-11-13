---
covers:
  - src/server/audit*.ts
  - src/server/data-retention*.ts
  - src/server/order-retention*.ts
  - src/domain/order-retention.ts
  - src/server/retention-cron.ts
  - src/server/orphan-cleanup*.ts
  - src/domain/audit.ts
stamp: a1ab25f494ba40358e45fd286c03e2be2979c4ac35064a4dc2b9c0a5a044ae4b
status: fresh
stale_since: null
---

# Audit and retention

This module covers the append-only audit log (NUD-092) and the background jobs
that delete or scrub old data: audit-log retention (NUD-111), driver-text
retention (NUD-112), deleting settled orders (NUD-201), the screenshot/failed-login
retention cron (NUD-093) and orphaned storage-object cleanup (NUD-094).

## Files

| File                                 | What it is                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/domain/audit.ts`                | Audit vocabulary, diff sanitizer and pure diff builders. No framework or database imports. |
| `src/server/audit.ts`                | `recordAudit`: the only code that creates `AuditLog` rows.                                 |
| `src/server/audit-history.ts`        | Read side: turns stored entries into history timelines for the order and tour pages.       |
| `src/server/audit-queries.ts`        | Admin-only read endpoints (`orderHistoryQuery`, `tourHistoryQuery`).                       |
| `src/server/audit-retention.ts`      | `purgeExpiredAuditEntries`: the only delete path of `AuditLog`.                            |
| `src/server/audit-retention-cron.ts` | Cron handler `GET /api/cron/audit-retention`.                                              |
| `src/server/data-retention.ts`       | `scrubExpiredDriverTexts`: scrubs `Stop.problemNote`.                                      |
| `src/server/data-retention-cron.ts`  | Cron handler `GET /api/cron/data-retention`.                                               |
| `src/domain/order-retention.ts`      | `purgeSelection`: which orders and stops may go together; period constants.                |
| `src/server/order-retention.ts`      | `purgeSettledOrders`: deletes orders, stops, tours and paid notes 30 days after payment.   |
| `src/server/order-retention-cron.ts` | Cron handler `GET /api/cron/order-retention`.                                              |
| `src/server/retention-cron.ts`       | Cron handler `GET /api/cron/retention`: screenshots and failed-login rows.                 |
| `src/server/orphan-cleanup.ts`       | `cleanupOrphanedObjects`: deletes uploaded-but-unattached storage objects.                 |
| `src/server/orphan-cleanup-cron.ts`  | Cron handler `GET /api/cron/orphan-cleanup`.                                               |
| `*.test.ts` next to these            | Unit and integration tests (see "Tests").                                                  |

## Audit log

### Vocabulary (`src/domain/audit.ts`)

- `AUDIT_ENTITIES`: `Order`, `Tour`, `Stop`, `Customer`.
- `AUDIT_ACTIONS`: 18 actions (`order.create`, `order.update`, `order.cancel`,
  `order.duplicate`, `tour.generate`, `tour.followup`, `tour.reoptimize`,
  `tour.reorder`, `tour.lock`, `tour.unlock`, `tour.assign_driver`,
  `tour.release`, `tour.rerelease`, `stop.delivered`, `stop.problem`,
  `stop.undo`, `photo.add`, `photo.replace`); `isAuditAction` validates.
- Entries store ids, enum values, dates and quantities only (quantities stay in hundredths, `toAuditQuantity`, because the log is append-only and older rows hold hundredths; NUD-137) —
  never names (they are resolved at read time, so renamed products show their
  current name and the log holds no copy of personal data) and never secrets.
- `sanitizeAuditDiff` is the second line of defence applied to every diff: it
  drops keys matching `pass|hash|secret|token|signature|signedurl|credential|
cookie|^url$|Url$`, drops `undefined` and non-finite numbers, converts dates
  to ISO strings, truncates strings to `AUDIT_TEXT_MAX` (200 chars, ellipsis
  appended) and lists to `AUDIT_LIST_MAX` (200 entries), and caps nesting at
  depth 6.
- `diffOrderLines` and `diffOrderUpdate` build the diffs the order service
  stores; `diffOrderUpdate` returns `null` when nothing a person can see
  changed (no entry is written then).

### Writing (`src/server/audit.ts`)

`recordAudit(tx, entry)` is the only way the application writes to
`AuditLog`, and it only ever inserts. Call it with the **transaction client of
the change itself, as the last step of that transaction** — the entry exists
if and only if the change committed. `entry` is `{ actorId, entity, entityId,
action, diff }`; an action outside `AUDIT_ACTIONS` throws.

The database itself enforces append-only: `UPDATE`, `TRUNCATE` and plain
`DELETE` on `AuditLog` fail with a trigger (see `audit-coverage.test.ts` and
the integration test). There is exactly one delete path, the retention job
below, and it is only permitted through a transaction-local switch.

### Reading (`src/server/audit-history.ts`, `audit-queries.ts`)

- `getOrderHistory(db, orderId)` and `getTourHistory(db, tourId)` return
  `AuditEntryView` rows, newest first, capped at `HISTORY_LIMIT` (200). Tour
  history includes the tour's own entries plus every entry whose diff names
  the tour (`tourId` path): stop-status changes of its stops and driver
  photos.
- Names are resolved here, at read time, with a handful of queries against
  `product`, `customer` and `user`; the actor is exposed as
  `{ name, role: "ADMIN" | "DRIVER" }`.
- `orderHistoryQuery` / `tourHistoryQuery` call `requireRole("ADMIN")` (checked
  against the database) before touching the log; drivers and anonymous callers
  never reach it. Nothing here writes.

## Retention jobs

All cron handlers live at `GET /api/cron/...`, require
`Authorization: Bearer $CRON_SECRET` (shared `isCronAuthorized`; they fail
closed with 401 when the secret is unset, empty or wrong), answer with
`Cache-Control: no-store`, log one line with the counts and are never
themselves written to the audit log (no user action, no actor).

### Audit log retention (`audit-retention.ts`, `audit-retention-cron.ts`)

`purgeExpiredAuditEntries` deletes `AuditLog` rows older than the retention
period, in batches of `AUDIT_PURGE_BATCH_SIZE` (1000) rows, at most
`AUDIT_PURGE_MAX_BATCHES` (20) batches per run; leftover rows are reported as
`more` and follow on the next run. Each batch runs in its own transaction that
sets the transaction-local `nudel.audit_retention = 'on'`, which the
append-only trigger honours only for rows older than 90 days — a forced delete
of recent rows is refused by the trigger. A requested period below
`MIN_AUDIT_RETENTION_DAYS` (90) is **refused with an error, not clamped**.
`auditRetentionDays` parses `AUDIT_RETENTION_DAYS` (default 730, floor 90,
max 36500); unset, non-numeric or out-of-range values fall back to 730 so a
typo never wipes history.

### Driver text retention (`data-retention.ts`, `data-retention-cron.ts`)

`scrubExpiredDriverTexts` only sets `Stop.problemNote` to `NULL`, and only on
stops with `completedAt` before the cutoff that still have a note. The whole
`LocalizedText` goes at once — the driver's original, the German translation
and the `pendingTranslation` marker — so a note still waiting for translation
is scrubbed too and the translation retry job finds nothing to do (its guarded
save is a no-op). `problemReason`, status, times, quantities, the stop, its
tour and the order are untouched: history views keep working. The job is
idempotent (a scrubbed stop no longer matches) and repeats the expiry condition
in the `updateMany` so a stop changed since the read is never touched.
`DATA_RETENTION_MODE` is `off` | `dry-run` | `delete`; unset or anything else
is `dry-run`, which only counts. Batches of 500, max 20 per run; a period below
`MIN_DRIVER_TEXT_RETENTION_DAYS` (30) is refused. `driverTextRetentionDays`
parses `DRIVER_TEXT_RETENTION_DAYS` (default 365, range 30..3650, fallback 365).

### Deleting settled orders (`order-retention.ts`, `order-retention-cron.ts`)

The client does not want orders, tours and bills kept (decision of 2026-11-13,
NUD-201). `purgeSettledOrders` deletes them for good once they are paid and the
period after the payment is over (`ORDER_RETENTION_DAYS`, default 30, range
7..3650). A value that is set but unusable gives `null` from `orderRetentionDays`
and the run throws instead of falling back to 30: the default is the shortest
sensible period, so a typo must not select it. **What is not paid is never
deleted.** `ORDER_RETENTION_MODE` is `off` | `dry-run` | `delete`; unset or
anything else is `dry-run`, which only counts orders and stops. A deployment
therefore never starts deleting by itself.

An order is _settled_ (`settledSql`) when its delivery day is older than the
period and

- it is a `DRAFT` or `CANCELLED` order (nothing was ever to be paid), or
- it is `CONFIRMED` on the monthly bill and its customer-month has a paid note
  (`MonthlyPayment`, not voided) with `paidAt` older than the period, or
- it is a `CONFIRMED` cash order and none of its `DELIVERED` stops has cash open
  or paid in part, and the collection (`collectedAt`, else `completedAt`) is
  older than the period (a delivery without any recorded time never counts as
  old enough). A `PENDING` stop on a released, running or completed tour with
  cash due keeps the order as well: nobody knows whether it was delivered and
  paid. Only a cash order on no such stop (no tour, a tour that was never
  released, a reported problem) counts from its delivery day.

What goes together (`purgeSelection`, pure): a stop goes only when its tour is
older than the period and every one of its orders goes; an order goes only when
every stop it is on goes. So one unpaid order keeps its stop, and with it the
other orders of that stop. A batch also follows these links to orders outside
itself, so two settled orders on one stop never wait for each other.

Two runs at once take their batches in turn (`pg_advisory_xact_lock`).
Per batch (200 orders, at most 25 batches per run, keyset cursor over
`deliveryDate, id` so waiting orders do not hold up later ones) one transaction
selects, locks the stops, the orders and their paid notes, selects again and
deletes only when both selections agree (a month marked unpaid in between makes
the batch step back). Stops go first (`StopOrder` restricts deleting an order),
order lines and stop mutations cascade. After the batches the run deletes old
stops without an order, old tours without a stop, and the paid notes whose
month is over and has no `CONFIRMED` monthly order left, together with the
correction lines (`MonthlyAdjustment`) of those months. A paid note stays while
an order of its month has to wait. Screenshots that no order uses any more are
removed like in the screenshot job (file first, then row); a storage failure is
counted (`screenshotsFailed`, response status `partial`) and left to that job.

Never touched: customers, products, users, settings, standing tours, standing
orders, customer photos, parking spots, and `AuditLog` (its entries about
deleted orders expire with the audit retention). The run writes no audit entry.
The bill page and the paid history show when a paid month will be deleted, only
while the mode is `delete` (`orderRetentionPolicy`).

Consequences to know: the utilization statistics, the paid history and the
exports only cover what is not deleted yet, and a tour loses its paid stops one
by one before it disappears (its counts shrink with them). While one order of
a paid month has to wait, the bill page shows the month with the orders that
are left next to the amount that was paid. Paid notes that were taken back and
correction lines of unpaid months are never deleted.

Nothing may conclude a lasting fact from "an order row exists". Two places did
and were changed with this job: the delivery limit of a standing order counts
`RecurringOrder.generatedCount` (incremented when an order is generated,
backfilled by the migration `20261113100000_recurring_generated_count`) instead
of the orders that exist, and the unit of a product stays locked while a
standing order uses it (`products.ts`).

### Screenshots and failed-login rows (`retention-cron.ts`)

`handleRetentionCron` (`GET /api/cron/retention`, daily) deletes order
screenshots older than `SCREENSHOT_RETENTION_DAYS` (default 180 — storage
object and row) via `purgeExpiredScreenshots`, and then failed-login rows older
than 24 h via `purgeLoginAttempts`. The login purge runs independently of the
screenshot purge: a storage outage must not keep IP addresses in the table.
The response status is `ok`, or `partial` when some screenshot deletions
failed. Dependencies (`db`, `storage`, `run`, `purgeLogins`) are injectable
for tests.

## Orphan cleanup (`orphan-cleanup.ts`, `orphan-cleanup-cron.ts`)

`cleanupOrphanedObjects` finds storage objects that were uploaded (the browser
PUT to a presigned URL) but never attached to a record — a failed action, a
closed tab, a rejected queued driver photo — and deletes them. Deleting is
irreversible, so the job is deliberately cautious:

- Mode is `ORPHAN_CLEANUP_MODE`: `off` | `dry-run` | `delete`; unset or
  anything else is `dry-run` (reports only).
- Grace period `ORPHAN_CLEANUP_GRACE_DAYS`, clamped to `MIN_ORPHAN_GRACE_DAYS`
  (7) .. `MAX_ORPHAN_GRACE_DAYS` (365), default 14; a younger object is never
  touched (a driver's queued photo is re-uploaded if its object is gone).
- Only keys of exactly the shapes the server issues are considered
  (`customers/<uuid>.<ext>` per `CUSTOMER_PHOTO_KEY_PATTERN`,
  `screenshots/<uuid>.<ext>` per `SCREENSHOT_KEY_PATTERN`); anything else in
  the bucket is counted as `unexpected` and left alone.
- An object is an orphan only if **no** `Photo` and **no** `Screenshot` row
  names its key — replaced photos (history) stay referenced and are kept.
- The reference is checked again immediately before each delete (a row may
  have appeared since the first check).
- Plausibility valve: when at least `SUSPICIOUS_MIN_CANDIDATES` (20) candidates
  exist and more than half look orphaned, the run aborts with
  `aborted: "suspicious_ratio"` and deletes nothing (wrong database, empty
  tables).
- At most `MAX_DELETES_PER_RUN` (50) deletions and `MAX_LISTED_PER_RUN`
  (10 000) listed objects per run; listings are paged in pages of 1000.
- `handleOrphanCleanupCron` (`GET /api/cron/orphan-cleanup`, weekly) answers
  with the report; `status` is `ok`, `partial` when some deletes failed, or
  `error` (503) when the storage listing itself failed — nothing was deleted
  in that case.

## Environment variables

| Variable                     | Meaning                                    | Default / fallback                  |
| ---------------------------- | ------------------------------------------ | ----------------------------------- |
| `CRON_SECRET`                | Bearer secret for all `/api/cron/*` routes | none; routes fail closed without it |
| `AUDIT_RETENTION_DAYS`       | Audit entry retention, 90..36500           | 730 on unset/invalid                |
| `DATA_RETENTION_MODE`        | `off` \| `dry-run` \| `delete`             | `dry-run`                           |
| `DRIVER_TEXT_RETENTION_DAYS` | Driver text retention, 30..3650            | 365 on unset/invalid                |
| `ORPHAN_CLEANUP_MODE`        | `off` \| `dry-run` \| `delete`             | `dry-run`                           |
| `ORPHAN_CLEANUP_GRACE_DAYS`  | Orphan grace period, 7..365                | 14 on unset/invalid                 |

## Tests

- `audit-coverage.test.ts` scans the sources: every module that writes orders,
  tours, stops or photos either calls `recordAudit` or is listed as exempt;
  every vocabulary action is written somewhere; no module other than
  `audit-retention.ts` deletes `AuditLog` rows and no module updates them;
  only `audit.ts` creates rows.
- `audit.integration.test.ts` covers end-to-end entries for order, tour,
  stop and photo flows, actor resolution, the append-only trigger and secret /
  long-text scrubbing.
- `audit-retention.test.ts` / `.integration.test.ts` cover env parsing,
  batching and the trigger: plain `DELETE`/`UPDATE` fail, and rows younger than
  90 days survive even when the retention switch is lifted.
- `data-retention.test.ts` / `.integration.test.ts` cover the modes, batching,
  idempotence, that only `problemNote` is scrubbed, and that the tour plan view
  still shows the stop with its reason.
- `order-retention.test.ts` (domain and server) / `.integration.test.ts` cover
  the selection rule, env parsing, the cron handler and, on a real database:
  paid / unpaid / voided months, cash collected / open / short, cancelled and
  draft orders, shared tours and stops, paid notes and corrections, screenshots,
  the modes, batching, the step back when a month is marked unpaid during a
  run, and that customers, products, users and the audit log stay.
- `orphan-cleanup.test.ts` / `.integration.test.ts` cover the modes, grace
  period, key shapes, the plausibility valve, the re-check before delete, the
  per-run caps and that replaced photos stay referenced.

## Invariants a caller must respect

- `AuditLog` is append-only; the only legal delete goes through
  `purgeExpiredAuditEntries`, which needs the transaction-local SQL switch and
  an age above 90 days.
- Call `recordAudit` with the transaction client of the change, inside that
  transaction; pass ids and values only, never names, secrets or signed URLs.
- Never write an audit entry from a cron/retention run (no actor exists).
- Retention periods below the floors (90 audit, 30 driver text) are errors,
  not clamped; the env parsers already fall back to the safe default.
- Dry-run is the default for every destructive cleanup; deletion must be
  switched on explicitly.
