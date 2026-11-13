# Redesign — implementation notes, decisions and verification

> **History.** This describes the first redesign (sage green, 2026-10). The current look is the
> "Dotter" design system in [`DESIGN.md`](../../DESIGN.md) (redesign RD2, 2026-11). The decisions
> about test ids, map markers and driver sizes below still hold.

Scope: `re-design.md` (driver + office UI redesign) implemented without touching business logic,
data model, server actions, routing or offline behaviour. This file is the review artefact: what was
implemented, which trade-offs were taken, how each claim was verified, and what is knowingly open.

Ticket mapping (the plan in `re-design.md` §12, executed as parallel agents instead of 15 sessions):

| Ticket | Scope | Where |
|---|---|---|
| RD-1 | Design tokens & typography (§4) | `src/app/globals.css`, `src/app/[locale]/layout.tsx` |
| RD-2 | Shared components I (§5) | `src/components/ui/{button,card,badge,input,select,combobox,dialog,sheet,table,alert,tabs,tooltip,form-field,switch,textarea,pin-input,sonner,skeleton}.tsx`, `src/components/shared/{states,status,status-badge}.tsx` |
| RD-3 | Shared components II (§5) | `src/components/ui/{segmented-control,stat-tile,row-actions}.tsx`, `src/components/shared/{progress-ring,progress-bar,stop-number-badge,sync-status-chip}.tsx` |
| RD-4 | Map markers & accessibility (§6) | `src/components/maps/{tour-map,map-icons,map.css,pin-picker-map,maps-demo}.tsx` |
| RD-5 | Driver login (§7.5) | `src/components/auth/login-form.tsx` |
| RD-6 | Driver shell + home (§7.1, §7.2) | `src/components/driver/{driver-shell,today-tour,offline-status,sync-notices,pending-badge,connection-indicator}.tsx` |
| RD-7 | Driver stop detail (§7.3, §7.4) | `src/components/driver/{stop-detail,stop-status-actions,driver-photo-slot,stop-photos,stop-i18n-fallback}.tsx` |
| RD-8 | Driver sync/outbox UI (§7.6) | `src/components/driver/driver-shell.tsx` (chip + sheets), `src/components/shared/sync-status-chip.tsx` |
| RD-9 | Admin shell + login (§8.1, §8.9) | `src/components/admin/{admin-shell,admin-nav,nav-items,mobile-nav,user-menu,page-header}.tsx`, `src/app/[locale]/admin/(shell)/layout.tsx` |
| RD-10 | Admin dashboard (§8.2) | `src/app/[locale]/admin/(shell)/page.tsx`, `src/components/admin/today-card.tsx` |
| RD-11 | Admin orders (§8.3) | `src/components/admin/{orders-table,order-filters,order-totals,order-detail}.tsx` |
| RD-12 | Admin tours (§8.4) | `src/components/admin/{tour-planner,audit-timeline,tour-date-field}.tsx` |
| RD-13 | Admin customers (§8.5) | `src/components/admin/{customers-table,customer-filters,customer-detail,customer-form,customer-photo-slots}.tsx` |
| RD-14 | Products, drivers, settings (§8.6–8.8) | `src/components/admin/{products-table,product-form,users-manager,settings-form}.tsx` |
| RD-15 | Polish & audit (§13) | this document + the checks below |

## Decisions (backlog §9 material)

1. **Tokens in HSL channels, warm neutrals** (`globals.css`) rather than the previous hex palette, so
   a future `.dark` block needs no changes to components. Dark mode stays out of scope; the existing
   `prefers-color-scheme` block was kept and extended with the new tokens.
2. **Inter via `next/font` (self-hosted, Latin + Latin-ext)** with the per-locale CJK stacks behind it
   (`:lang(zh-*)`), because Inter has no CJK glyphs. No external font CDN (CSP).
3. **`--warning-foreground` is dark, not white.** Measured contrast: white on the amber was 3.22:1
   (fails AA); dark amber ink is 7.60:1. All 24 token pairs are measured by `.redesign/contrast.mjs`.
4. **Clustering in-house** (28 px pixel-distance pass on `zoomend`/`moveend`), no
   `leaflet.markercluster` dependency.
5. **Markers keep the number plus a ✓/! cue** instead of §6's "number replaced by check": replacing it
   would leave `.nudel-stop-badge` empty, which `admin-progress.spec.ts` pins.
6. **Zoom controls are 48 px, not 44 px**: backlog §4.3 and the existing `layoutAudit` require ≥47.5 px.
7. **Segment `lg` = 52 px track with 48 px items** (the *items* are the touch targets).
8. **The two language switchers stay native `<select>`** (`driver-shell`, `language-switcher`, and the
   office `shells.spec.ts` path): four e2e specs drive them with `selectOption(...)` and read the
   `option` texts. The visible treatment is the redesigned control; converting to a sheet/Radix Select
   would require changing those specs, which §1 only allows with an explanation — recorded here.
9. **`connection-indicator`, `pending-badge` and `offline-ready` remain in the DOM as sr-only markers**
   inside the sync chip: their specs assert presence, visibility and exact text, and §7.6 asks for the
   chip to be the visible vocabulary.
10. **Driver text never below 16 px:** shared components carry admin-sized `text-sm`; inside
    `.driver-app` it is bumped to 1rem via a scoped, unlayered rule.
11. **`loading` buttons keep their label next to the spinner** (no text swap) so width and accessible
    name stay stable.
12. **Problem reasons come from the existing `ProblemReason` enum** — no data-model change; no free-text
    quick-fill chips were needed.
13. **Verlauf is collapsed above 5 entries** (§8.4). `tests/e2e/tours.spec.ts` generated more entries
    and then asserted `audit-entry:visible`, so the spec now clicks the new `audit-toggle` first —
    the one spec change in this redesign, and the reason is recorded here (§1 requires exactly that).
14. **The tour driver picker stays a native `<select>`** and tour rows keep native drag-and-drop:
    the specs drive them with `selectOption()` and `dragTo("stop-handle")`.
15. **`order-overview.spec.ts` presses the Status/Quelle chips** instead of `selectOption(...)` on a
    native `<select>`: §8.3 asks for chip filters, so the spec follows the UI (six lines, same
    semantics — `filter-status-ALL` carries `aria-pressed="true"` and the chips keep their per-value
    test ids). Second and last spec change; the reason is recorded here per §1.
16. **The orders empty state names the nearest date only when that date is inside the selected range**
    (`getDateTotals` is range-scoped by design, and §8.3 forbids changing the fetching). For the QA
    default view it offers a one-click jump to the surrounding week instead — an honest, documented
    compromise rather than a new query.

## Verification (measured, not asserted)

- **Tokens:** `.redesign/contrast.mjs` — all 24 pairs pass (text ≥ 4.5:1, UI ≥ 3:1); ratios are quoted
  in the `globals.css` header comment.
- **Test-id contract (§1):** `.redesign/check-testids.mjs` extracts all 257 ids referenced by
  `tests/e2e/**` (comments stripped) and verifies each still exists in `src/`.
- **Structure (§3/§13):** `.redesign/check-nested-cards.mjs` — no `Card` inside a `Card` across the
  tree; no hard-coded hex in components; no `uppercase` on translated strings.
- **Syntax:** `.redesign/syntax-scan.mjs` — parse-only scan (617+ files) used as a cheap pre-flight.
- **i18n:** `pnpm i18n:check` green; `pnpm i18n:build` regenerates `zh-Hant-*` (never hand-edited).
- **Types:** `pnpm typecheck` exit 0 repo-wide.
- **Live browser checks** (dev server, `localhost` — `127.0.0.1` is blocked as cross-origin by Next 16):
  F1 (localized PIN error, no native bubble), driver home/stop/map, problem sheet, outbox sheet,
  admin dashboard, orders, login screens — with `web_inspect` reporting 0 console errors,
  0 unnamed controls, 0 low-contrast samples and correct heading order on each.
- **Driver rules:** the repo's own `layoutAudit` (≥48 px targets, ≥16 px text, ≥28 px bold quantities,
  no horizontal scroll) reports zero findings on the driver home at 375×667.
- Screenshots for every screen/width/locale pair live in `docs/redesign/final/` (copied from
  `.redesign/shots/`), including 375/430 px driver in `de` + `zh-Hant-TW` and 1024/1280/1536 px admin.

## Feedback loop (scored reviews)

The redesign was reviewed by **two independent scorers** on the same captured pass (`run1`,
28 screenshots, `.redesign/shots/run1/` → copied to `docs/redesign/final/`), using the fixed rubric in
`.redesign/RUBRIC.md`. They agreed on the overall verdict — **6.7/10** — and on most defects, which is
why the findings below are usable rather than anecdotal.

| Axis | Scorer 1 | Scorer 2 |
|---|---|---|
| A visual design & hierarchy | 7.5 | 7.0 |
| B driver usability | 6.5 | 7.0 |
| C office/admin usability | 6.5 | 6.5 |
| D compliance with `re-design.md` | 6.0 | 6.0 |
| E accessibility & i18n | 7.0 | 6.5 |
| **Overall (weighted)** | **6.7** | **6.7** |

### Defect → disposition

| Finding (both scorers unless noted) | Disposition |
|---|---|
| Driver stop-list rows: display-size quantity collides with the status badge; names truncate to ~11 chars | **Fixed** (D3: compact 15 px right-hand summary, name column min-width, rows ≥ 76 px) |
| Driver home prints "3 / 6" twice (ring + text) and pushes the CTA to the bottom edge | **Fixed** (D3: single count, cache strip folded into the sync chip, CTA re-measured at 375×667) |
| German top bar truncates "Mo., 26…" / "Wird vorbereit…" | **Fixed** (D3) |
| "Karte" is not a map view — map gets ~17 % of the 430 px viewport | **Fixed** (D3: map mode owns `100dvh − top bar − control`) |
| German problem sheet clips its 7th reason chip and the textarea | **Fixed** (D3: scrollable sheet body) |
| Stop-detail element order: nav CTA above the amber Hinweis | **Fixed** (D3: callout first, per §7.3) |
| "Gesamt 17,5 ✕ Kisten" — multiplication sign between value and unit | **Fixed** (D3: `createAppFormatters`) |
| Orders at 1280: expanded sums card hides the table | **Fixed** (A6: two-column at ≥ 1280, sums collapsed) |
| Order rows blow the density budget (3 stacked chips + floating count bubble) | **Fixed** (A6: > 2 positions collapse to "3 Positionen", inline count, capped row) |
| Kunden "Hinweise" flags render nothing | **Fixed** (A6: icon flags with tooltip + sr-only, same predicates as the filters) |
| Fahrer page repeats its own header | **Fixed** (A6) |
| Produkte: stray ⊘ row action; ~65 px rows; search inside the table-header band | **Fixed** (A3: action into the overflow menu, 48 px rows, own toolbar row) |
| Quantities not pluralised in the sums card ("15 Packung") | **Fixed** (A6: through `createAppFormatters`) |
| Weak contrast: reorder arrows, disabled "Problem melden" | **Fixed** (token-based colours) |
| CJK numerals lose semibold/tabular weight; time format differs per locale | **Fixed** (D3: Latin/tabular span for digits, per-locale time) |
| §8.2(1) fourth dashboard tile ("Bestellungen morgen …") | **Accepted gap** — the aggregate does not exist; RD-10 explicitly allows fewer tiles plus a follow-up ticket. Not invented at the end of the session. |
| §8.2(2) inline 200 px mini-map on the dashboard | **Accepted gap** (same reason: no such data on that card today) |
| "Simplified note in the Traditional UI" (scorer 1, E axis) | **Refuted** — an artefact of the screenshot harness, which wrote the Simplified string into all three Chinese variants. Fixed in the harness; the app's OpenCC path was never wrong. |

### What is measured and green

`pnpm typecheck` exit 0 · `pnpm lint` green · `pnpm test` 1772 passed / 4 skipped (the one failing file,
`stop-photos.test.tsx`, was fixed — a jsdom-only `setPointerCapture` call) · `pnpm i18n:check` ok ·
`.redesign/check-testids.mjs` 257/257 spec ids present · `check-nested-cards.mjs` clean ·
`contrast.mjs` all 24 token pairs pass · `syntax-scan.mjs` clean over 627 files ·
driver `layoutAudit` zero findings at 375×667.

### Honest limitation

The loop ran **one** fully captured, twice-scored pass. The fix wave for its findings was launched in
the same session and is verified by review of the changed code paths, measurements and the project's
own gates — but **not** by a second scored pass, because the session's round budget ended first. The
best *scored* result therefore stands at **6.7/10**, with the entire ranked defect list either fixed,
explicitly accepted, or refuted with evidence.

### Second scored pass (run2) and the stale-stylesheet caveat

A second pass was captured (10 screens, `REDESIGN_FAST=1`) and scored independently: **6.5 overall**,
within single-reviewer variance of run1. The reviewer additionally reported a byte-level check —
`1280-admin-orders.png`, `375-driver-stop-de.png` and `375-driver-problem-de.png` were **MD5-identical**
to their run1 counterparts.

**Why:** the long-running `next dev` (started 02:24) had been serving a **Tailwind CSS chunk frozen at
its startup**. Utilities added to the components afterwards — `min-w-12`, `w-27`, `min-h-[72px]`,
`max-h-[52dvh]`, `[&_.leaflet-container]:h-[calc(100dvh-153px)]` — were absent from the stylesheet the
browser received, while older classes were present. HMR, cache-busting and editing `globals.css` did not
reliably invalidate it. So both scored passes were judged on a **partly stale stylesheet**, which means
the ranked layout defects (sums card over the table, map height, hero/CTA fold, problem-sheet clipping)
may be understated — and, equally, the fix wave could not be shown to land.

After an approved restart the served chunk went from 86,440 to 114,697 bytes and contains the new
utilities. **Treat any layout observation from run1/run2 as provisional**, and re-capture before judging.

### Fixes verified after the restart

- Message fragments (D3/A3/A6) merged; `pnpm i18n:check` ok. This cleared **36 unit-test
  `MISSING_MESSAGE` failures** and a real 375 px **horizontal-overflow regression** caused by raw key
  literals: `vitest run src/components/driver src/components/shells.test.tsx` → **185/185 pass**.
- `pnpm typecheck` exit 0.
- Accessibility defects fixed by the verification agent (P1): an illegal `aria-pressed` on elements Radix
  rendered as `role="radio"` (axe `aria-allowed-attr`), and — importantly — `StopNumberBadge` carried its
  `aria-label` on a role-less `<span>` (`aria-prohibited-attr`), so the F4 marker name **was never
  announced**; it now has `role="img"` when a label exists. Also fixed: two elements sharing
  `data-testid="language-picker"`, which made the picker unreachable in Playwright strict mode.

### Dev-server limitation for the e2e gate

A **client-side navigation to `/de/driver` does not render** on the dev server (`RSC fetch ERR_ABORTED`,
"Could not validate `instant` because the target segment was prevented from rendering"). Root cause is the
QA-04 family — `await params` in `src/app/[locale]/layout.tsx` outside `<Suspense>` plus `connection()`
in `requirePageActor` — which §10 parks in its own ticket. Consequence: `driver-a11y`,
`driver-usability`, `driver-status`, `driver-stop` and parts of `driver-today` cannot complete here
(~34 of 56 mobile tests). The one-line dev-only opt-out `export const instant = false` was **deliberately
not applied**: it would make a blocked gate look green without changing the product. The QA-01 offline
specs (`driver-offline.spec.ts:317` and `:353`) additionally need a production build.

### Third pass, captured with a correctly served stylesheet (run3)

Both fix agents completed after the restart and verified with measurements (`run3` captures the same
screen set as `run1`, from `.redesign/shots/run3/`):

**Driver (D3)** — stop-list rows rebuilt (name 17 px semibold with 22–24 visible characters before the
ellipsis, a reserved 80 px right column carrying a stacked per-unit summary, **no intersection between
that summary and the status badge** on any row); a single progress count inside the 64 px ring with
`data-testid="progress-count"` moved onto it; the "Tour wird für offline gespeichert" strip folded into
the sync chip; the hero CTA measured fully inside 375×667 (**y 484 → 540**); the date never truncates
(chip "Speichert", full sentence as its accessible name; zh keeps "儲存中" + "10月26日週一"); the map at
430×932 now spans **779 px = 100dvh − top bar − control** (83.6 % of the viewport, was ~17 %) with the
stop list behind a 72 px peek sheet; the problem sheet body scrolls (de 329/512, zh-Hant-TW 329/426) so
all seven chips and the textarea are reachable with the actions pinned; "Gesamt je Einheit 12,5 kg ·
5 Kisten" (no multiplication sign, per-unit sums); disciplined contrast on the disabled submit
(~5:1 border, ~4.5:1 text); both photo frames 149×149; the amber Hinweis callout first under the header
with navigation below it; numerals forced to the Latin tabular face and **all driver times 24 h**.

**Office (A6)** — orders is two-column from ≥ 1280 with the sums card collapsed in a 224 px rail, giving
**6 order rows visible at 1280×800 (was 0)** and **8 at 1536 (was 5)**, rows at 49 px with position chips
capped at 2 and the count inline (no floating grey bubble); the Kunden "Hinweise" flags now render from
the same predicates as the filter chips (Tooltip + sr-only, muted "—" when a row has none; the
`StickyNote` flag would need `Customer.notes` in the list payload, which is a fetch change and therefore
out of scope); Von/Bis appear only in "Benutzerdefiniert"; quantities are pluralised through the existing
ICU forms ("15 Packungen", "12 Kisten").

Third spec adaptation, recorded per §1: `order-overview.spec.ts` now clicks the new `totals-toggle`
before reading `totals-day`, because the sums card is collapsed by default. `admin.orders.empty.hint` is
now an unused key (superseded by `empty.hintWeek`/`widen`) — left in place rather than deleted, so the
generated `zh-Hant-*` files stay consistent.

**Caveat on all three passes:** the first two were captured through a dev server serving a frozen
Tailwind chunk, so their layout findings are provisional; `run3` is the first capture that can be
trusted for layout.

### Third scored pass (run3) — the first trustworthy one

| Axis | run1 | run2 | **run3** |
|---|---|---|---|
| A visual design & hierarchy | 7.5 / 7.0 | 7.0 | **8.0** |
| B driver usability | 6.5 / 7.0 | 6.5 | **7.5** |
| C office/admin usability | 6.5 / 6.5 | 6.5 | **7.5** |
| D compliance with `re-design.md` | 6.0 / 6.0 | 6.0 | **7.0** |
| E accessibility & i18n | 7.0 / 6.5 | 6.5 | **7.5** |
| **Overall (weighted)** | **6.7** | **6.5** | **7.5** |

run3 was captured after the dev-server restart, so it is the first pass judged on a correctly served
stylesheet. The reviewer confirmed 9 of the 15 tracked items fixed, 3 partly fixed and 3 not verifiable
in the set, and raised a new list that the next wave addresses:

- **zh-Hant-TW ships untranslated German** in the delivery window ("Mo–Fr 8–11 Uhr") inside otherwise
  localized text — a real localization miss.
- **The map view lost its sticky top bar and has no peeking stop-list sheet**, which removes §7.2(5)'s
  list↔map entry point (the map itself now fills the viewport, which is fixed).
- **Order "Positionen" chips truncate to "2 Pa…" at the 1280 baseline** while reading fine at 1536.
- **The dashboard contradicts itself**: the tile says "2 / 6 (50 %)" while the card says "3 von 6 (50 %)".
- **Kunden "Hinweise" shows "—" on every row**, including a customer whose stop carries a Hinweis — the
  `StickyNote` flag needs `notes` in the list payload.
- **The hero still fills the first viewport** at 375×667, with "Details" cut by the fold and no stop row
  peeking.
- **Tours pushes its work surface below the fold** with two rows of oversized KPI tiles, and shows
  "Gesamtdauer 0 Min." as a fact.
- **Fahrer's primary action sits inside the table card** instead of the page header.
- **The problem sheet is absent from every capture** (the file is byte-identical to the stop capture), so
  §7.3's sheet could not be scored at all.

### Fourth scored pass (run4) — target reached

| Axis | run1 | run2 | run3 | **run4** |
|---|---|---|---|---|
| A visual design & hierarchy | 7.0 | 7.0 | 8.0 | **7.5** |
| B driver usability | 6.5 | 6.5 | 7.5 | **8.0** |
| C office/admin usability | 6.5 | 6.5 | 7.5 | **7.5** |
| D compliance with `re-design.md` | 6.0 | 6.0 | 7.0 | **7.5** |
| E accessibility & i18n | 7.0 | 6.5 | 7.5 | **8.0** |
| **Overall (weighted)** | **6.7** | **6.5** | **7.5** | **7.7** |

**7.7/10 — above the 7.5 target.** Ten of the thirteen run3 findings were confirmed closed on the
evidence, including the worst one (zh-Hant-TW no longer ships a German delivery window), the 430 px map
view (top bar, full-height map, peeking list sheet with drag handle), the orders "Positionen" truncation,
the dashboard's contradictory arithmetic, the Kunden `StickyNote` flags, the hero occupying the whole
first viewport, the 1024 row regression, Fahrer's misplaced primary action, the singular-unit summary,
and the problem sheet finally appearing in the captures.

### What the reviewer still flags (candidate work for a fifth pass)

Ranked by cost to the user:

1. **Every driver stop row repeats a status pill** under the name, inflating rows to ~110 px against the
   76 px §7.2 target — a 20-stop list becomes a long scroll. The badge colour plus a Check/dot and the
   problem reason in the address slot are meant to carry that information.
2. **Tours still hides its two-pane body**: at 1280 the map/stop list starts around y=715 of 800 because
   the header stacks two tour tabs, a status badge, a four-pill stepper, "Ladeliste drucken", the
   released alert and a ~150 px KPI row in which "Tobias Berger" wraps to three lines.
3. **Dashboard**: the §8.2.1 "Bestellungen morgen" tile is still absent, and "Letzte Aktivität" reads
   "Heute noch keine Einträge." although the tour was released the same day (the audit entry exists), so
   §8.2.4 is not demonstrably wired.
4. **Hero quantities are plain text rows, not the §7.2.2 chips** (soft pill surface, tabular number,
   product, unit), with an orphan separator and two different number treatments.
5. **Bestellungen row heights vary** (47–85 px, wrapping customer names), §8.3's empty view still does
   not name the nearest day with data, and no admin table shows a sort affordance (§5).

Not verifiable from the capture set (no shots): the other §7.6 sync states, the office login, the
customer-edit pin picker (QA-02), marker accessible names, the sidebar's 72 px rail, and admin in
`zh-Hant-TW`.

## Known open items

- **QA-01** (offline "next stop" navigation/outbox progress) is a logic defect and explicitly out of
  scope (§1). The redesign delivers the states it needs (§7.6).
- **QA-04** (`params`/`searchParams` outside `<Suspense>`) is a routing concern (§10). It remains as a
  Next dev-only warning on dynamic driver routes.
- Aggregates that do not exist yet (orders/tours for *tomorrow* on the dashboard, the pin-review queue
  in the needs-attention panel) were not invented: the dashboard shows fewer tiles and says so.
- The office dashboard's tiles and the needs-attention panel use existing queries only.
