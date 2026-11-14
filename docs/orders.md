---
covers:
  - src/server/orders.ts
  - src/server/order-*.ts
  - src/server/late-orders.ts
  - src/server/product-*.ts
  - src/server/products.ts
  - src/domain/order*.ts
stamp: 03567253045f80f8a80d9b4d7ba496fceacd7ff821fd55212d7018f6f0221ebf
status: fresh
stale_since: null
---

# Orders (and products)

## Purpose

Office order entry and the product catalog. An order belongs to one customer, targets one
delivery day and carries one or more product lines. Nobody deletes an order by hand: they are `DRAFT`,
`CONFIRMED` or `CANCELLED`. Only the order retention job removes them, 30 days after they
were paid (NUD-201, `docs/audit-and-retention.md`). Products are the catalog those lines reference
and can only ever be soft-deleted (`active = false`), because old orders keep pointing at
them. Everything here is admin-only and every server action re-checks the role against the
database before reading the input.

## Files

| File                            | Role                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/order.ts`           | Pure order-entry rules and the input schema (no DB imports)                                                                                                                |
| `src/domain/order-overview.ts`  | Pure overview rules: per-date totals, URL filters, editability (no DB imports)                                                                                             |
| `src/server/orders.ts`          | DB-facing order functions (`create/update/cancel/duplicate`, overview, detail, screenshots)                                                                                |
| `src/server/order-actions.ts`   | `"use server"` mutations: `createOrderAction`, `updateOrderAction`, `cancelOrderAction`, `duplicateOrderAction`, `confirmedOrderCountAction`, `screenshotPreviewUrlAction` |
| `src/server/order-queries.ts`   | `"use server"` reads: `orderableCustomersQuery`, `orderOverviewQuery`, `orderDetailQuery`                                                                                  |
| `src/server/late-orders.ts`     | Read model for orders stranded after their tours completed                                                                                                                 |
| `src/server/products.ts`        | DB-facing product functions (`create/update/setActive/move/list/get`)                                                                                                      |
| `src/server/product-actions.ts` | `"use server"` product mutations plus the automatic name translation                                                                                                       |
| `src/server/product-queries.ts` | `"use server"` product reads                                                                                                                                               |

## Entry and overview rules (domain)

`src/domain/order.ts`:

- **Quantities are whole numbers (D23, NUD-137).** `parseQuantity` accepts only digits
  (`"3"`, `3`) and returns an integer `1..MAX_QUANTITY` or `null`; `2,5`, `2.5`, `0`, negative
  numbers and thousands separators are rejected, not rounded or guessed (a wrong delivery
  quantity is worse than a rejected input). The column is `OrderItem.quantity Int`. Limits:
  `MAX_QUANTITY = 99_999`, `MAX_ORDER_LINES = 100`, `MAX_NOTE_LENGTH = 1000`.
- **One product per order line is merged, not rejected**: `mergeOrderLines` adds duplicate
  quantities, keeps order of first appearance, and returns `null` if the sum overflows.
  `hasDuplicateProducts` is the non-blocking hint the form uses.
- `parseCalendarDate` / `formatCalendarDate` convert between `YYYY-MM-DD` and a `DATE`
  value (UTC midnight); only real calendar days parse. `isPastDeliveryDate` rejects days
  before the factory's "today" (`todayIn` in `orders.ts`).
- `orderInputSchema` validates the create/edit payload: customerId, a real deliveryDate,
  status `CONFIRMED` (default) or `DRAFT`, `internalNote` (max 1000, trimmed, null when
  empty), an optional `screenshotKey` (max 200, must match the upload endpoint's shape via
  `isScreenshotKey`), and 1..100 lines each with quantity `> 0`. Lines are merged on the
  server; the client's merged state is never trusted.
- `orderWarnings` emits non-blocking warnings: `combined_stop` (the customer already has
  confirmed orders that day, so they merge into one stop) and `tour_completed` (NUD-116: every tour of the delivery day is COMPLETED, so a confirmed order needs a follow-up tour; read through `dayTourCompletedAction`). A missing Parkplatz or address point is no order warning (NUD-141, D22).

`src/domain/order-overview.ts`:

- `sumQuantities` is the shared aggregation: a sum of whole numbers **per product AND
  unit** — 5 packs + 2 kg is not 7 of anything — sorted by productId then unit.
- `aggregateTotalsByDate` sums per delivery date **from CONFIRMED orders only**; drafts and
  cancelled orders are neither produced nor delivered, so they never count.
- `parseOrderFilters` turns URL search params into `OrderFilters` (`from`, `to`,
  `customerId`, `status`, `source`). It can never fail: unusable values fall back to the
  default (next delivery date). A range with `to` before `from` collapses to `from`; a range
  longer than `MAX_RANGE_DAYS` (62) is cut. `orderFiltersToQuery` is the reverse.
- `isOrderEditable` — an order may be edited or cancelled only while its delivery day is
  today or later and it is not already `CANCELLED`.

## Server: orders

`src/server/orders.ts` reads `order`, `orderItem`, `customer`, `product`, `screenshot` and
`auditLog`, writes in one `$transaction`, and coordinates with the tour side through the
`TourHook` (`markOutdatedForDate` from `tour-service.ts`).

- `todayIn(timezone)` — the factory-time-zone calendar day of now as a `DATE` value; passed
  as "today" into every write and the detail read.
- `createOrder` creates the order, its items and (optionally) a `Screenshot` row in one
  transaction. Source is `MANUAL`, or `SCREENSHOT` when a `screenshotKey` is attached: the
  key must be one the upload endpoint issues (`screenshots/<uuid>.<ext>`), the object must
  really exist in storage (`storage.head`), its size must be in `(0, MAX_UPLOAD_BYTES]`, and
  the key may be used only once. Validation is repeated here because the client is never
  trusted: customer and every product must exist and be active (archived customers and
  inactive products are rejected), and the delivery day must not be in the past. Audit
  `order.create` and the affected tours' outdated flags are recorded in the same transaction.
- `updateOrder` edits an editable order (date, status, note, lines) with the same
  validation; `cancelOrder` sets status `CANCELLED` (never deletes); `duplicateOrder` copies
  an existing order to another delivery day as a new `DRAFT` with source `MANUAL` (copying
  note and items), likewise refusing past dates, inactive customers and inactive products.
- `listOrderableCustomers` returns only active customers for the entry picker (archived
  customers are never offered), sorted by name then customer number.
- `countConfirmedOrders` counts the customer's `CONFIRMED` orders for a day (they become one
  stop), optionally excluding one order id.
- `listOrderOverview` returns overview rows under `OrderFilters` with a `truncated` flag;
  `getDateTotals` returns the per-date `CONFIRMED` totals in the same range;
  `listCustomersForFilter` feeds the filter dropdown; `getOrderDetail` returns detail
  including a signed screenshot preview URL and whether the order is still editable;
  `getScreenshotPreviewUrl` signs a freshly uploaded screenshot's key (`null` if it is not
  one).

The mutations are wrapped by `order-actions.ts` and the reads by `order-queries.ts`, each of
which calls `requireRole("ADMIN")` first and passes the live DB, factory timezone and tour
service. `orderOverviewQuery` additionally parses filters (default = next delivery date) and
marks each returned row `late: true` using `lateOrderIdsForRows`.

## AI order draft (NUD-150, D26)

The office may paste the customer's WhatsApp/WeChat message into the order form and/or attach a
screenshot; "Automatisch auslesen" turns it into a **draft** that the office reviews and confirms -
nothing is saved by the extraction itself.

- `src/domain/order-extraction.ts` (pure): the answer contract
  (`extractionAnswerSchema`, leaf module `order-extraction-answer.ts` so `order.ts` can store it),
  the label → catalog matcher (`matchProduct`, unit words decide between the two "Nudeln" products),
  `assembleDraft` (catalog ids only, ambiguous/unknown products are reported in `unmatched`, never
  guessed) and the prompt (`buildExtractionPrompt`).
- `src/server/order-extractor/`: the `OrderExtractor` interface, `ClaudeOrderExtractor` (the Claude
  API through Anthropic's SDK, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, NUD-207; the photo goes along
  as a base64 image block, the answer comes back as structured output in the contract's JSON schema)
  and `FakeOrderExtractor` (offline stand-in used by the tests and the evaluation script). A missing
  key disables the button; the fake never reaches an office user. Claude reads JPEG, PNG, WebP and
  GIF; the browser already turns every upload into a JPEG of at most 1600 px.
- `src/server/order-extraction.ts`: loads the active catalog and the screenshot (signed URL → bytes),
  calls the extractor and returns `{ draft, extraction, model }`. Read-only.
- `extractOrderDraftAction` (ADMIN) is the only entry point; a draft's raw answer travels back with
  the saved order and is validated again by `orderInputSchema` (`Order.sourceText`,
  `Order.aiExtraction`; migration `20261030120000_order_ai_extraction`).
- Evaluation: `pnpm eval:order-extraction` (`--fake`, `--min 0.8`, `--today YYYY-MM-DD`) runs the 16
  anonymised messages in `tests/fixtures/order-extraction/samples.json` and reports the line accuracy;
  `src/server/order-extractor-eval.test.ts` keeps fixture and matcher in sync.
- The same Claude client (`src/server/claude/`) is the Serbian slot of the translation chain (DeepL
  has no Serbian).

## Order inbox (NUD-210)

About 100 orders a day arrive as photos. `/admin/orders/inbox` ("Foto-Eingang") takes many photos at
once; the app reads each one and proposes the customer; the office checks every photo in the order
form and confirms. **Nothing is an order before the form is saved.**

- **A photo in the inbox is a `Screenshot` row** with `inboxStatus`: `NEW` (uploaded), `READING`
  (claimed by a reader, `readStartedAt`), `READY` (`extraction` holds the model's answer,
  `customerHint` the name on the photo, `suggestedCustomerId` the proposal), `FAILED` (`readError`),
  `DONE` (an order was saved from it), `DISCARDED` (`discardedAt`). `null` is a screenshot attached
  in the order form as before.
- **Reading** (`src/server/order-inbox.ts`): `addInboxPhotos` stores the rows, the action schedules
  `readInbox` with `after()`. `createInboxReader` allows one run per process; `drainInbox` claims
  photos with a guarded `updateMany` (status and `readStartedAt`), four at a time, and takes over a
  claim older than three minutes. `readInboxPhoto` writes its result only while the row is still
  `READING`, so a photo that was saved or discarded meanwhile is left alone. Without
  `ANTHROPIC_API_KEY` nothing is read: the photos wait and are typed by hand.
- **Customer proposal** (`suggestCustomer`): the model returns `customer`, the sender's name exactly
  as written on the picture (never an id; the customer list is not sent). First the customer of an
  earlier saved order whose photo carried the same name (so a chat name is learned after one pick),
  then `matchCustomer` over the active customers (exact name, company or abbreviation; otherwise the
  name as whole words). A tie proposes nobody.
- **Checking** (`/admin/orders/new?inbox=<id>`, `OrderForm` prop `inbox`): photo left, form right,
  customer and lines filled in. `createOrder` connects the existing row and marks it `DONE` in the
  transaction of the order; a second save of the same photo fails with `screenshot_in_use`. After a
  save the form goes to `nextInboxPhoto` (read ones first, then failed ones, oldest first).
- **Discard**: soft (`DISCARDED`), `restoreInboxPhoto` brings it back; `purgeDiscardedInboxPhotos`
  deletes object and row ten minutes later (run with `after()` on the next inbox action).
- Actions in `order-inbox-actions.ts` (all `requireRole("ADMIN")`): `addInboxPhotosAction`,
  `inboxAction` (the list; the page polls it while something is uploaded or read),
  `discardInboxPhotoAction`, `restoreInboxPhotoAction`, `retryInboxPhotoAction`.
- Limits: 20 keys per add call (the page sends one per photo), 300 rows in the list.

## Late orders

`src/server/late-orders.ts` (NUD-099) implements a read model: a `CONFIRMED` order for a day
whose tours are all `COMPLETED` sits on no stop, a completed tour is never re-released, and
tour generation refuses it — nothing would otherwise tell the office. It is admin-only; the
role is checked by its callers (`tourPlanQuery`, `orderOverviewQuery`, `todayProgressQuery`).

- `getLateOrdersView(db, date)` returns `LateOrdersView`: the count and per-customer merged
  entries for those orders (`orderIds`, and `routable` = false while the customer has no
  location at all (no Parkplatz, no address point), in which case a follow-up tour cannot include the stop), the `conflicts`
  (stops of completed tours whose linked orders were edited or cancelled after the tour ran;
  the follow-up tour does not deliver the difference), and `canCreateFollowUp` (all tours of
  the day completed and at least one late order routable). Returns the `NO_LATE_ORDERS`
  constant when there are no tours that day or nothing is late. Quantities are merged
  per customer.
- `lateOrderIdsForRows(db, rows)` reports which overview rows are late (`CONFIRMED`, on no
  stop, all tours of their day `COMPLETED`) with one query across all involved dates.

## Server: products

Every product has a **weight per unit** in kilograms (`weightKgPerUnit`, required, > 0, two decimals,
editable on the product form by admins). `orderWeightKg(items, products)` in `src/domain/weight.ts`
multiplies it with the quantities; the vehicle capacity check (NUD-146) builds on it. Unit words:
`PACK` = Sackerl, `CRATE` = Kiste, `PIECE` has no word and reads "3 × Wantan-Teig" (glossary §3);
sums without a product name next to them use `driver.unitsTotal` ("3 Stück").

`src/server/products.ts` reads/writes `product` and `orderItem` in
`$transaction` where needed.

- `productInputSchema`: `sku` (must match `[A-Za-z0-9][A-Za-z0-9._-]{0,31}`, uppercased),
  `unit` from `UNITS`, and a name with required `de` and `zh-Hans` (max 160 each) plus
  optional `en`/`sr`/`cs` with `enAuto`/`srAuto`/`csAuto` flags. `buildProductName` translates
  `en`/`sr-Latn`/`cs` from German on the server when flagged auto (or empty), marking the stored
  value `machine`; a non-auto, non-empty value is a hand-edited name. A failed translation saves
  the product anyway and flags the name `pendingTranslation` (retry job, `Product.name` source).
- `createProduct` appends at the end (`sortOrder = max + 1`); `updateProduct` refuses a
  `sku` already taken (case-insensitive) and **locks the unit once the product is on any
  order** — changing it would silently change the meaning of old quantities. Errors:
  `invalid`, `sku_taken`, `not_found`, `unit_locked`.
- `setProductActive` is the soft delete: `active = false` keeps old orders readable; such
  products are never offered in the order-entry picker. `moveProduct` moves one place up or
  down across the **full** list (active and inactive together) and renumbers `sortOrder` to
  `0..n-1`, which also repairs ties; no-op at the ends.
- Reads: `listProducts` (all, in `sortOrder`), `getActiveProducts` (active only, the picker
  of NUD-030), `getProduct` (detail for the form plus `unitLocked` from the order-items
  and standing-order-items counts). Corrupt name JSON falls back to the `sku` so the list never crashes.

`product-actions.ts` wraps the writes, `product-queries.ts` the reads. Both check
`requireRole("ADMIN")` first.

## Invariants a caller must respect

- Every server action is admin-only; nothing trusts the client — inputs are re-validated
  against the schema in the DB-facing function.
- Order writes happen in one transaction together with the audit log entry and the tour
  outdated-flagging: either all succeed or none does. No order, product or item is ever
  physically deleted.
- Only active customers and active products may appear on new or edited orders; archived
  customers and inactive products remain visible on existing records.
- Delivery dates must be today or later; overview totals and late-order maths count
  `CONFIRMED` orders only.
- Quantities are aggregated as whole numbers and never summed across units; a product's
  unit is locked once the product appears on an order or a standing order (orders are
  deleted after they were paid, NUD-201; the standing order keeps the lock).
