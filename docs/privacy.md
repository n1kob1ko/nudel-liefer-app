# Privacy and personal data (NUD-093)

Working document for the operator (the pasta factory) and its data protection advisor. It lists what
the app stores, where it lives, who else receives data, and how long it is kept. It is **not legal
advice**; points marked "to confirm" need a decision or a contract check by the operator.

The app is an internal tool: users are the office staff (admins) and the drivers. Customers are
**businesses** (mostly restaurants); they have no login and no self-service. Personal data therefore
concerns (a) the staff and drivers, and (b) people who appear in business data (contact names in
notes, people in a photo or chat screenshot).

## 1. Where data lives (hosting)

| Component                            | Provider and region                                                         | What it holds                                                            |
| ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Application (server functions, cron) | Vercel, region `fra1` (Frankfurt), see `vercel.json`                        | Processes requests; logs (see section 5); no data store of its own       |
| Database (PostgreSQL)                | Neon, EU (Frankfurt) project, see `docs/deploy.md` section 2                | All tables of section 2                                                  |
| Object storage (photos, screenshots) | Cloudflare R2, **EU jurisdiction**, private bucket, `docs/deploy.md` sec. 3 | Customer photos and order screenshots                                    |
| Routing and geocoding                | OpenRouteService (HeiGIT, Germany), only when `ORS_API_KEY` is set          | Addresses of customers and the depot, stop coordinates (section 4)       |
| Machine translation                  | DeepL API, only when `DEEPL_API_KEY` is set                                 | Texts of notes and driver problem reports (section 4)                    |
| Map tiles                            | Provider chosen with `MAP_TILE_URL` (production: MapTiler or Stadia Maps)   | The browser requests tiles directly: IP address and map area (section 4) |
| Error reports (optional)             | Sentry, EU data region (project setting), only when `SENTRY_DSN` is set     | Scrubbed error events: no personal data by design (section 4)            |
| Database backups                     | The production server itself (`/var/backups/nudel/db`), nothing external    | Master data only, nightly, 8 weeks (section 3, "Backups")                |

To confirm: Vercel and Cloudflare are US companies. Data stays in the EU regions above, but a
data processing agreement with the standard contractual clauses (or the EU-US Data Privacy Framework
certification) is needed with each provider. Neon, Vercel, Cloudflare, OpenRouteService, DeepL and
the tile provider are processors of the operator.

## 2. What is stored

| Data                                  | Where (table / bucket)                              | Personal data in it                                                                                                                                                                                                                                                                                                                       | Retention                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff and driver accounts             | `User`                                              | Display name, e-mail (admins) or user name (drivers), language, last login time, **bcrypt hash** of password / PIN (never the PIN itself)                                                                                                                                                                                                 | Until the operator removes the account; accounts are deactivated (soft delete), not erased                                                       |
| Customers (businesses)                | `Customer`                                          | Business name, delivery address and address point, delivery hours, a driver note that may name a contact person; office only (NUD-136): company (may be a sole trader's own name), VAT id, billing address                                                                                                                                | Until archived; archived customers are kept (soft delete)                                                                                        |
| Photos of shop entrance and parking   | `Photo` + bucket `customers/<uuid>.jpg`             | Images taken on the street; may show passers-by, vehicle registration plates or staff. Uploader (user id)                                                                                                                                                                                                                                 | Kept while the customer is served; replaced photos stay as history                                                                               |
| Parking spots of a customer           | `ParkingSpot` (NUD-125)                             | Map position of a parking place, a short name and a **free-text note** typed by the office (drivers add a Parkplatz with coordinates only, no text, NUD-144); shown to the driver on the stop screen and kept in the driver's offline copy of today's tour (NUD-126); the note may name a contact person or a gate code. Author (user id) | Kept while the customer exists; "removed" spots stay with `active=false` (soft delete). Not copied into the audit log (only ids and coordinates) |
| Order screenshots (WhatsApp / WeChat) | `Screenshot` + bucket `screenshots/<uuid>.jpg`      | Chat content: names, phone numbers, messages. Uploader (user id). `extraction` stays empty: the AI answer is stored with the order (`Order.aiExtraction`, NUD-150)                                                                                                                                                                        | **180 days** (configurable), then deleted automatically (section 3)                                                                              |
| Orders and order lines                | `Order`, `OrderItem`                                | Customer reference (a business), quantities, delivery date, creator (user id), internal note (free text, may name a contact person), and - when the AI draft was used - the pasted customer message plus the model's answer (NUD-150)                                                                                                     | Kept (transactional history, section 6); the internal note is editable in the admin area; the AI fields go with the order. Deleted 30 days after payment once the job is on (section 6) |
| Tours, stops, delivery status         | `Tour`, `Stop`, `StopOrder`, `StopMutation`         | Assigned driver (user id), completion times, problem reason (enum). Not personal data on their own: quantities, statuses, ids                                                                                                                                                                                                             | Deleted with their orders 30 days after payment once the job is on (section 6) |
| Driver problem text                   | `Stop.problemNote` (JSON, driver language + German) | **Free text typed by the driver**, plus its machine translation; may contain names or phone numbers                                                                                                                                                                                                                                       | **365 days** after the stop was completed (configurable), then removed by the daily job (section 6)                                              |
| Audit log                             | `AuditLog`                                          | Actor id, entity ids, quantities, dates, order / problem notes **cut to 200 characters** (this includes a copy of the driver's problem text, see section 6); no names                                                                                                                                                                     | **730 days** (configurable), then deleted by the daily job (section 7)                                                                           |
| Failed-login counters                 | `LoginAttempt`                                      | User name or e-mail that was typed and the **IP address** of the failed attempt                                                                                                                                                                                                                                                           | 15 minute rolling window; rows older than 24 h are deleted daily (section 3)                                                                     |
| Offline copy on the driver's phone    | Browser IndexedDB and Cache Storage                 | Today's tour: customer names, addresses, notes, photos, queued status taps and photos                                                                                                                                                                                                                                                     | Replaced on every sync; removed at the login page; other days are never shown                                                                    |
| Cookies                               | Browser                                             | `authjs.session-token` (signed session, HttpOnly, SameSite=Lax, Secure on https; 12 h admin, 90 days driver), `NEXT_LOCALE` (language, 1 year)                                                                                                                                                                                            | Strictly necessary; no analytics, advertising or tracking cookies                                                                                |

**Not collected:** continuous driver GPS positions or tracking (decision D19), prices, payment data, delivery
signatures or proof photos (D11), analytics or advertising identifiers.

The address point and the Parkplätze on the map are coordinates of a customer's business, not the
position of a person.
The only use of the device position is the one-off fix behind "Parkplatz festlegen" (NUD-144): the
driver taps the button, the browser asks for permission once, and the resulting point is stored as a
Parkplatz of the customer (author = user id, audit entry). The position is not kept otherwise; the
Permissions-Policy allows `geolocation` for our own origin only.

## 3. Retention implemented in the app

### Order screenshots: 180 days

`GET /api/cron/retention` runs daily at 03:17 UTC (`vercel.json`). It is protected by
`Authorization: Bearer $CRON_SECRET` like the translation job (without a configured secret every
call is answered with 401).

- Every `Screenshot` older than `SCREENSHOT_RETENTION_DAYS` (default **180**, allowed 1 to 3650;
  invalid or empty values fall back to 180 so that a typo can never switch the job off or delete
  everything) is deleted: first the **storage object**, then the **database row**. If the process
  dies in between, the row points to a missing object (harmless: the next run removes the row; a
  missing object is not an error). The reverse order could leave an orphaned file that no row refers
  to any more. If the storage delete fails, the row is kept and tried again the next day.
- The order itself stays; `Order.screenshotId` becomes empty (foreign key `ON DELETE SET NULL`) and
  the order detail simply shows no screenshot.
- At most 100 screenshots per run; the response reports `examined`, `deleted`, `failed`, `more`.
  After a long outage the backlog is worked off over several days.
- Objects that were uploaded but never attached to an order (the office abandoned the form) have no
  row and are not found by this job. Add a **lifecycle rule** on the bucket as the backstop:
  delete objects under the prefix `screenshots/` after 190 days (R2 dashboard > bucket > Settings >
  Object lifecycle rules). Customer photos (`customers/`) must not get such a rule.
- The same run deletes `LoginAttempt` rows older than 24 hours.
- The run is not written to the audit log (no user action); the counts are in the cron response and
  the Vercel function log.

### Backups (NUD-094, NUD-200)

A job on the production server (`nudel-backup.timer`, `deploy/backup/`) writes a backup every night
into the folder `/var/backups/nudel/db/` on that server (readable by the app user and root only)
and deletes backups older than 8 weeks. Nothing is copied off the server.

A backup holds **master data only**: settings, users (with their **password hashes**) and working
hours, vehicles, products, customers with their address data, parking spots and photo records,
standing tours and standing orders. It never holds orders, tours, stops, payments, monthly
invoices, order screenshots, the change history or `LoginAttempt` rows (decision of the owner,
2026-11-13; the script checks every dump and refuses to store one that contains such rows).
Consequences to know:

- A customer or user deleted or changed in the app can still exist in a backup for up to 8 weeks
  plus the time to the next run. A request to erase personal data is answered in the app at once
  and in the backups by the 8-week expiry.
- Orders and payments cannot be recovered from a backup. Whatever the app deletes of them is gone.
- Access is limited to the people with root access to the server. Photos and screenshots are
  **not** in the backups (objects stay in the photo bucket).
- The backup only reads the database (`pg_dump`). It uses the app's connection unless the operator
  gives it a read-only role (`BACKUP_DATABASE_URL`).
- An optional second copy in an external bucket exists in the code and is **not** configured
  (`docs/deploy.md` section 13.2); switching it on would add that storage provider to section 1.

### Orphaned storage objects (NUD-094)

Uploads that never became a photo or screenshot (action failed, tab closed) stay in the bucket. A
weekly job lists the objects, and removes those older than `ORPHAN_CLEANUP_GRACE_DAYS` (default 14)
that no database row refers to, once `ORPHAN_CLEANUP_MODE=delete` is set; by default it only logs
what it would delete. Details and safeguards: `docs/runbook.md`, "Orphaned storage objects".

### What the operator must configure

`CRON_SECRET` (required, otherwise the retention jobs, the orphan job and the translation job never
run), optionally `SCREENSHOT_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`, `DRIVER_TEXT_RETENTION_DAYS`,
`DATA_RETENTION_MODE` (**set to `delete` to activate the driver text job**), `ORDER_RETENTION_DAYS`,
`ORDER_RETENTION_MODE` (**set to `delete` to activate deleting settled orders**), `ORPHAN_CLEANUP_MODE`. See `docs/env.md`.

## 4. Who else receives data

- **DeepL** receives the text of customer notes (German) and of driver problem reports whenever a
  translation is needed (NUD-070 to NUD-072). The text contains no customer number, but it may
  contain names or phone numbers if someone typed them. Use a **DeepL API Pro** key in production:
  according to DeepL's terms Pro does not store or train on submitted text, whereas the free API may
  (to confirm against the current terms and conclude DeepL's data processing agreement). Without
  `DEEPL_API_KEY` nothing is sent.
- **OpenRouter** (NUD-150, optional, `OPENROUTER_API_KEY`): receives the **pasted customer message**
  and, when one is attached, the **order screenshot** (as an inline image) whenever the office presses
  "Mit KI auslesen", plus the customer note / driver text when a Serbian translation is needed. This
  is raw message content: names, phone numbers, addresses and whatever else the customer wrote. A
  model provider processes it; OpenRouter routes the request and, depending on the chosen model and
  its settings, the provider may log or train on it - choose a model with a no-training policy,
  conclude the data processing agreement, and cap the spend. The request is pinned to one provider
  (`OPENROUTER_PROVIDER`, default Together), so the receiving processor does not change per call.
  Without the key no request is made and the button stays disabled. Log lines never contain the
  message (`[order-extraction] extraction failed (<code>)`).
- **OpenRouteService** receives customer and depot addresses (geocoding) and stop coordinates
  (routing) with the API key in a header. Business addresses, no driver positions.
- **Map tile provider**: the browser of every user who opens a map requests tiles from it and
  thereby reveals the IP address and the viewed area. The `Referer` header is limited to the origin
  (`Referrer-Policy: strict-origin-when-cross-origin`). Use a provider with a data processing
  agreement; the default OpenStreetMap server is for development only.
- **Google Maps / Apple Maps**: the "navigate" button opens the other app with the stop's
  coordinates on the driver's own phone. The app itself sends nothing to Google.
- **Sentry** (NUD-094, optional, `SENTRY_DSN`): receives error events from the server and from the
  browsers (error type, message, stack trace, page path, release, browser / OS name). Before an
  event leaves the app `src/lib/sentry-scrub.ts` removes: request bodies, cookies, all headers but
  the user agent and language, query strings (signed storage URLs, tokens), user records and IP
  addresses (`sendDefaultPii` off), console output, anything stored under keys like password / pin /
  token / cookie / signature, and offline / aborted-request noise. No session replay, tracing or
  profiling. Create the Sentry project with the **EU data region** (`de.sentry.io`), conclude a
  data processing agreement, and keep the retention of events short (30 days is enough). Error
  messages written by the app's own code contain ids, not names; an unexpected library message could
  still contain a fragment of text, which is why the scrubber also redacts URLs and secrets inside
  messages. Without a DSN nothing is sent.

The browser never loads scripts, fonts or images from third-party sites other than the configured
tile server and the storage host (enforced by the Content-Security-Policy, `docs/deploy.md` section
11).

## 5. Logs

Vercel keeps request and function logs (retention depends on the plan). The application writes
operational messages only (no passwords or PINs; no signed URLs; CSP reports keep origin and path
without query strings; the orphan cleanup logs random object keys and counts). IP addresses appear in
Vercel's request logs and in `LoginAttempt` (above). Where to read them: `docs/runbook.md`.

## 6. Orders, tours, stops and driver texts (NUD-112)

### What is personal data here

| Field                                                                                 | Personal data?                                                                                                                                                                                                                                                | Decision                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Order` (customer, date, status, source), `OrderItem`                                 | No. Customers are businesses; quantities and dates describe goods. (A sole trader's business name can identify a person, but that is master data of the `Customer`, which is kept while the customer is served, not part of the order history.)               | Keep                                                                                                                                       |
| `Order.createdById`, `Tour.driverId`, `StopMutation.driverId`                         | Indirectly: a user id that points to a staff or driver account. The name sits in `User`. An account is deactivated or, since NUD-206, deleted by an admin; then the id on a tour is cleared and other records point to the deleting admin.                                                                                                                      | Keep (accountability for quantities); erasing needs the account decision                                                                   |
| `Order.internalNote`                                                                  | **Possibly**: free text written by the office; may name a contact person.                                                                                                                                                                                     | Keep; editable in the order form. Open question for the client below                                                                       |
| `Order.sourceText`, `Order.aiExtraction` (NUD-150)                                    | **Yes, possibly**: the pasted customer message (WhatsApp/WeChat text, may contain a name, a phone number or an address) and the raw JSON the model read from it. Stored only when the office uses the AI draft.                                               | Keep with the order like `internalNote`; not in the retention jobs (open question below). The screenshot itself keeps its own 180-day rule |
| `ParkingSpot.label`, `ParkingSpot.note`                                               | **Possibly**: free text written by the office (later by drivers); may name a contact person.                                                                                                                                                                  | Keep with the customer; editable in the customer detail. Not copied into the audit log                                                     |
| `Order.amountCents`, `Order.paymentTerm`, `Stop.collectedCents`, `Stop.collectedAt`, `Stop.collectedById`, `MonthlyPayment` (NUD-196) | No personal data beyond user ids (the driver who collected, the office user who marked a month paid). Amounts, terms, timestamps and the snapshot of a monthly bill (total, order count). `MonthlyPayment.note` is **possibly** free text typed by the office (max 200 characters, e.g. "bar beglichen") and can name a person. | Keep with the order / stop / customer; the note is not copied into the audit log (the entry holds ids, amount and order count). Deleted with the month 30 days after it was paid (NUD-201) |
| `MonthlyAdjustment` (NUD-197)                                                          | **Possibly**: `label` is free text typed by the office (max 120 characters, e.g. "Rabatt Stammkunde", "Gutschrift Bruchware") and can name a person. The rest is an amount, a month and user ids (who added it, who removed it).                                  | Keep with the customer like `MonthlyPayment` (a removed line stays with `voidedAt`); the label is not copied into the audit log (the entry holds the id and the amount). Deleted with the month 30 days after it was paid (NUD-201) |
| `Tour.loadingStartedAt`, `Tour.departedAt`                                            | Indirectly: moments at which the assigned driver opened the departure checklist and left the depot (NUD-151); app events only, no location. Used for the working-time evaluation (NUD-152).                                                                   | Kept with the tour; deleted with it (NUD-201) |
| `Customer.keyNumber`, `Customer.hasKey`                                               | No. A number on a key tag (max 20 characters) typed by the office or a driver; master data of the customer, kept with it (NUD-142). The audit entry `customer.key` holds the old and the new number.                                                          | Keep; not in the retention jobs                                                                                                            |
| `Customer.abbreviation`                                                               | No. Legacy internal code (max 20 characters, free text) typed by the office or a driver (NUD-164); master data of the customer, temporary and removed once the old system is retired. The audit entry `customer.abbreviation` holds the old and the new text. | Keep until removal; not in the retention jobs                                                                                              |
| `StandingTour.name`, `StandingTourCustomer` (NUD-194)                                 | **Possibly**: a group name typed by the office ("Route 1", "Stammtour Nord") and the link to its customers; the name can be a place or a neighbourhood, never a person. The membership is a plain id link.                                                    | Keep with the group (soft delete, `active=false`); memberships are replaced on edit and the changes are audited by ids only                |
| `Tour`, `Stop` (sequence, times, quantities, `problemReason`, status, route geometry) | No. Enum values, ids, times, distances. No driver positions are stored (D19); the route is the planned road path.                                                                                                                                             | Keep                                                                                                                                       |
| `Stop.problemNote`                                                                    | **Yes, possibly**: free text typed by the driver, in his language and as German machine translation (DeepL); can contain a person's name or phone number.                                                                                                     | **Scrub after 365 days** (implemented)                                                                                                     |
| `AuditLog.diff` of `stop.problem` / order entries                                     | **Possibly**: order notes cut to 200 characters. `stop.problem` entries hold no driver text (only `hasNote` and `noteLength`, NUD-121); entries written before that change may still hold the cut text.                                                       | Deleted with the entry after 730 days (section 7); see the note below                                                                      |

**Conclusion.** Orders, tours and stops carry no personal data of their own beyond user ids and
the two free-text fields, so data protection does not require deleting them. The **client decided
on 2026-11-13 that they are not kept anyway**: everything that is paid is deleted 30 days after the
payment (next subsection). Until that job is switched on, nothing is deleted.

### Orders, tours, stops and monthly bills: deleted 30 days after payment (NUD-201)

`GET /api/cron/order-retention` runs daily at 03:57 UTC (`vercel.json`), bearer `CRON_SECRET`.

- **What goes:** orders with their lines (including `internalNote`, `sourceText`, `aiExtraction`),
  the stops they were delivered with (including cash amounts and a remaining `problemNote`), tours
  without a stop left, the monthly "paid" notes (`MonthlyPayment`, including its note) and the
  correction lines of those months (`MonthlyAdjustment`, including the label), and screenshots no
  order uses any more.
- **When:** `ORDER_RETENTION_DAYS` days (default **30**, 7 to 3650) after the payment. Monthly bill:
  after the office marked the month paid. Cash: after the driver collected the full amount.
  Cancelled orders, drafts and cash orders that were never delivered: after their delivery day.
- **What stays:** everything that is not paid (an open month, a month whose paid note was taken
  back, open or partly paid cash, a cash order whose stop was never ticked off on a released
  tour), whatever its age, and an order that shares a stop with something unpaid. Paid notes that
  were taken back and the correction lines of unpaid months stay with them. Customers, products, users,
  settings, standing tours, standing orders, customer photos and parking spots are never touched.
- **Default is `ORDER_RETENTION_MODE=dry-run`**: the job only counts and logs
  `[order-retention] {...}`. Set `ORDER_RETENTION_MODE=delete` to delete (`off` does nothing).
  Deleted data cannot be recovered except from a backup that contains it.
- **The audit log is not part of it.** Entries about deleted orders (ids, changed quantities,
  amounts, notes cut to 200 characters) stay until the audit retention deletes them (section 7,
  730 days by default, at least 90).
- **Retention duties are the client's call.** Tax and commercial law can require keeping invoices
  and their records for years. The client was told and decided to delete; whoever operates the app
  should have this confirmed by the client's tax adviser before switching the job on. The monthly
  bill can be downloaded as PDF or CSV before it goes.

Details of the rule and its safeguards: `docs/audit-and-retention.md`; switching it on:
`docs/runbook.md` section 10.

### Driver problem texts: 365 days (implemented)

`GET /api/cron/data-retention` runs daily at 03:47 UTC (`vercel.json`), bearer `CRON_SECRET`
(without a configured secret every call is answered with 401).

- It sets `Stop.problemNote` to empty for every stop **completed more than
  `DRIVER_TEXT_RETENTION_DAYS` days ago** (default **365**, whole days 30 to 3650; empty, invalid
  or out-of-range values fall back to 365, a value below 30 is refused by the code). Nothing else
  on the stop changes: `problemReason`, `status`, `completedAt`, quantities, the tour and the
  orders stay (until the stop itself is deleted with its paid orders, see above). The office sees such a stop with its reason and without a note, exactly like a
  stop where the driver wrote none.
- The whole text is removed at once: the driver's original, the German translation and the marker
  "translation pending". A text whose translation is still pending is removed too; the translation
  retry job then finds nothing to do, and a late save of a translation does not bring the text back
  (it only writes to a note that is still pending).
- **Default is `DATA_RETENTION_MODE=dry-run`**: the job only counts what it would remove and logs
  `[data-retention] {...}`. Set `DATA_RETENTION_MODE=delete` to remove (`off` does nothing at all).
  Anything else counts as `dry-run`. Removed texts cannot be recovered except from a database backup.
- At most 20 batches of 500 per run (10 000 texts); `more: true` in the answer means the backlog
  continues the next day. The job is idempotent.
- The response and the log line carry counts only (`expired`, `scrubbed`, `batches`, `more`), never
  a text. The run is not written to the audit log (it is a system job without a user, like the
  screenshot job; the exemption is explained in `src/server/audit-coverage.test.ts`).
- **The period is a proposal until the client confirms it**: 365 days because disputes about a
  delivery are raised within months, the structured reason remains afterwards, and a free text
  has no further use for the office. A different value is only the variable.

**Audit copy (closed by NUD-121).** The audit entry of a problem report (`stop.problem`) no longer
contains the driver text: it stores the reason, `hasNote` (true/false) and `noteLength` only, so the
text lives only in `Stop.problemNote` and is scrubbed after 365 days (the history view still shows
reason and status). Entries written **before** this change may still hold the note cut to 200
characters; the log is append-only (trigger), they cannot be edited and disappear with the audit
retention (730 days, section 7).

### Requests of people (access, rectification, erasure)

Handled by the operator by hand; steps in `docs/runbook.md` ("Access and erasure requests"):
customer and order notes are edited in the admin area, driver texts are scrubbed by the job or
earlier by hand, a user account is deactivated or deleted, photos and screenshots are removed in the bucket
and the database. Data in backups expires with the backups (section 3).

## 7. Audit log retention (NUD-092, NUD-111)

The audit log is **append-only**: the application has no update path and exactly one delete path
(a test scans the code), and a PostgreSQL trigger (`AuditLog_append_only`, function
`audit_log_append_only`) rejects `UPDATE` and `DELETE`. Entries contain ids, enum values, dates and
quantities; the only free text is order notes cut to 200 characters (driver problem texts are not copied
here since NUD-121; older entries may hold one), so a note can still contain a name someone
typed.

**Retention: 730 days (24 months)**, configurable with `AUDIT_RETENTION_DAYS` (whole days, 90 to
36500; empty, invalid or below the floor falls back to 730 so a typo can never delete history). The
period is a proposal until the client confirms it; change the variable, no code change needed.

How it is enforced (implemented in NUD-111, migration `20261018130000_audit_log_retention`):

- `GET /api/cron/audit-retention` runs daily at 03:37 UTC (`vercel.json`), bearer `CRON_SECRET`
  (without a configured secret every call is answered with 401).
- The job is the **only delete path**. It deletes in batches of 1000 rows (at most 20 batches =
  20 000 rows per run; a larger backlog is worked off over the following days), each batch in its
  own transaction that first sets the transaction-local switch `nudel.audit_retention = 'on'`.
- The trigger function honours the switch for `DELETE` only, and only for rows **older than 90
  days by the database clock**. Even code that lifts the switch cannot delete recent entries; the
  floor of 90 days is part of the function, not of the application. `UPDATE` is refused always.
  A plain `DELETE` without the switch fails as before.
- The response carries `retentionDays`, `cutoff`, `deleted`, `batches`, `more`, and one sanitized
  line `[audit-retention] {...}` goes to the function log (no entry content). The run is not written
  to the audit log: that entry would be one more row to delete later.
- Deleted entries cannot be recovered except from a database backup (`docs/runbook.md` sections 4
  and 5).

## 8. Technical protection (summary)

TLS only (HSTS), private storage bucket and short-lived signed URLs (`docs/deploy.md` section 11),
role checks on every server action and route handler (test matrix, `src/server/authz-matrix.test.ts`),
rate-limited login, hashed secrets, Content-Security-Policy and further security headers, origin
check on state-changing API routes, input size limits.
