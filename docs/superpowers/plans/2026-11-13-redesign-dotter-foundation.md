# Redesign "Dotter", Step 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Dotter colours, the new buttons and fields, and the motion building blocks for the 20 rules into the shared kit, so every page picks them up and steps 2 to 6 only rearrange screens.

**Architecture:** Tokens stay HSL channel triples in `src/app/globals.css`, consumed through `@theme inline`. The kit in `src/components/ui` keeps its exports and props, only classes change. Predetermined motion is CSS (keyframes and utilities in `globals.css`); only shared-layout animation uses `motion`, loaded lazily inside client leaves under `src/components/motion`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, `tw-animate-css`, Radix (`radix-ui`), `motion` (new), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-redesign-dotter-design.md`

## Global Constraints

- No function, test id, prop or export is removed. e2e specs depend on `data-testid`s and native `<select>`s.
- Yolk `#FFC72C` is a fill, never a text colour on a light surface. Ink is `#15171A`.
- Text pairs at least 4.5:1, UI boundaries and focus rings at least 3:1, in light and dark.
- Driver app: touch targets at least 48 px, text at least 16 px, quantities at least 28 px bold.
- Motion: entrances `--ease-out`, movement `--ease-in-out`, exits 0.8 of the entrance, press scale 0.97, no bounce, nothing tweens while a pointer is held, `prefers-reduced-motion` collapses movement.
- CSP: no `unsafe-inline` or `unsafe-eval` for scripts. Inline styles are allowed.
- New UI text in de and zh-Hans (all five locales where the driver sees it). This step adds no visible text.
- Commit prefix `RD2-1`. Never deploy.
- Definition of done: `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check`.

## Review Focus

1. A caller passes its own `className` colours to `Button` (for example `bg-success`): the tactile edge and press state must still look right and the caller's colour must win.
2. Dark mode: yolk fills next to yolk focus rings. A focused primary button must still show a visible ring (ring offset in the page colour).
3. Reduced motion: overlays must still open and close (state change is not tied to `animationend` of a suppressed animation).
4. A segmented control or tab list whose options change while mounted, or two controls on one page: the shared-layout thumb must not jump between controls (unique `layoutId` per instance).
5. Server rendering: nothing in `src/components/motion` may run `motion` code or touch `window` during render; kit components that were server components stay server components.

---

### Task 1: Tokens and the contrast test

**Files:**

- Modify: `src/app/globals.css` (token blocks, `@theme inline`, `.bg-hero`, base rules)
- Create: `src/lib/design-tokens.ts`, `src/lib/design-tokens.test.ts`

**Interfaces:**

- Produces: `readTokens(css: string): { light: Record<string, string>; dark: Record<string, string> }` (dark falls back to light for missing keys), `contrast(a: string, b: string): number` (both HSL channel strings), new tokens `--primary` (yolk), `--warning` (orange), `--link-underline`, motion tokens `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--dur-press`, `--dur-pop`, `--dur-sheet`, `--dur-move`, the `link` utility.

- [ ] **Step 1: Write the failing test** `src/lib/design-tokens.test.ts`: reads `src/app/globals.css`, and for both schemes asserts `contrast >= 4.5` for foreground/background, foreground/card, muted-foreground/background, muted-foreground/card, primary-foreground/primary, primary-soft-foreground/primary-soft, and each `x-foreground/x` and `x-soft-foreground/x-soft` for success, warning, destructive, info; `>= 3` for input/card, ring/background, ring/card, ring/primary; and that `--primary` is `44 100% 58.6%` in both schemes.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/design-tokens.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `design-tokens.ts` and replace the token values with the Dotter values from the spec; add `--brand`-free aliases, motion tokens, neutral shadows, `--radius-md: 0.75rem`, `.bg-hero` without the black mix, themed `::selection`, `caret-color`, scrollbars and `tabular-nums` for tables.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `RD2-1: Dotter colour tokens for light and dark, with a contrast test`.

### Task 2: Brand colour is never text

**Files:** every hit of `text-primary`, `border-primary` (unfilled), `accent-primary`, `stroke-primary`, `bg-primary/NN`, `var(--primary)` outside the kit (list from `grep`), plus `src/components/maps/map.css`.

- [ ] **Step 1:** Links use the `link` utility (ink text, yolk underline). Icons use `text-foreground`. Native checkboxes use `accent-foreground`. Unfilled yolk borders become `border-foreground`. Chart and ring fills are checked against their track for 3:1 and moved to `foreground` or `success` where yolk fails.
- [ ] **Step 2: Run** `pnpm test`. Fix class-name assertions that pinned the old classes.
- [ ] **Step 3: Commit** `RD2-1: the brand colour is a fill, links and icons use ink`.

### Task 3: Buttons

**Files:** `src/components/ui/button.tsx`, `src/components/ui/kit.test.tsx`, `src/app/globals.css` (`btn-edge` utility)

**Interfaces:**

- Produces: `Button` variant `warning` (new); all existing variants and sizes unchanged in name.

- [ ] **Step 1: Failing tests** in `kit.test.tsx`: default variant has `bg-primary` and `text-primary-foreground` and `btn-edge`; every variant has `active:scale-[.97]`; `variant="warning"` has `bg-destructive-soft`; `outline` and `ghost` do not have `btn-edge`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** `btn-edge`: `box-shadow: inset 0 1px 0 rgb(255 255 255 / .38), inset 0 -2px 0 rgb(0 0 0 / .13), 0 1px 2px rgb(0 0 0 / .12)`, flattened on `:active`. Transition 140 ms `--ease-out` on transform, box-shadow, background-color.
- [ ] **Step 4: Run**, expect PASS. **Step 5: Commit** `RD2-1: buttons with colour, a tactile edge and a 0.97 press`.

### Task 4: Fields and surfaces

**Files:** `input.tsx`, `textarea.tsx`, `select.tsx` (trigger), `combobox.tsx`, `pin-input.tsx`, `card.tsx`, `badge.tsx`, `alert.tsx`, `table.tsx`, `skeleton.tsx`, `stat-tile.tsx`, `tabs.tsx`, `switch.tsx`, `calendar.tsx` in `src/components/ui`.

- [ ] **Step 1:** Fields: `bg-card`, `border-input`, hover `border-foreground/40`, focus ring `ring-ring`. Cards: `border-border`, `shadow-xs`; interactive cards lift to `shadow-md` and press to 0.99. Skeleton: shimmer instead of pulse. Switch: thumb stretches 12 % while it travels (rule 5). Update existing kit tests that pin old classes.
- [ ] **Step 2: Run** `pnpm test`. **Step 3: Commit** `RD2-1: fields, cards and status surfaces in the new look`.

### Task 5: Overlay motion in CSS

**Files:** `src/app/globals.css` (`pop-in`/`pop-out`, `sheet-*`, `overlay-*`, `content-settle` keyframes and utilities), `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `tooltip.tsx`, `dialog.tsx`, `sheet.tsx`, `sonner.tsx`, `combobox.tsx`.

- [ ] **Step 1:** Popover, menu, select: start at scale 0.95 and opacity 0, `transform-origin` from the Radix origin variable, 200 ms in, 160 ms out. Tooltip: 0.97, 150/120 ms. Dialog: centre origin, 0.96, 240/190 ms, content settles 40 ms later. Sheet: `--ease-drawer`, 300/240 ms. Reduced motion: opacity only.
- [ ] **Step 2: Test** `src/components/ui/overlay-motion.test.tsx`: an open `Popover`, `DropdownMenu` and `Dialog` each render content carrying its motion utility class (`pop`, `pop`, `dialog-pop`) and still unmount on close with animations disabled.
- [ ] **Step 3: Run**, **Step 4: Commit** `RD2-1: overlays enter from their trigger and leave 20 % faster`.

### Task 6: Motion building blocks

**Files:**

- Create: `src/components/motion/motion-provider.tsx`, `stagger.tsx`, `success-pulse.tsx`, `icon-swap.tsx`, `fly-to.ts`, `rubber-band.ts`, `index.ts`, tests next to each
- Modify: `segmented-control.tsx`, `tabs.tsx`, `package.json` (`motion`)

**Interfaces:**

- Produces: `MotionProvider({ children })` (LazyMotion, features loaded with `import()`), `Stagger({ as?, step = 30, max = 12, children, className })` (sets `--i` on children), `SuccessPulse({ active, children, className })`, `IconSwap({ icon: ReactNode, iconKey: string, className })`, `flyTo(el: HTMLElement, from: DOMRect, opts?: { duration?: number }): Animation | null`, `rubberBand(distance: number, dimension: number, constant = 0.55): number`, `clampWithRubberBand(value: number, min: number, max: number, dimension: number): number`.

- [ ] **Step 1: Failing tests:** `rubberBand(0, 300) === 0`; `rubberBand(100, 300)` is between 0 and 100; monotonic; never exceeds `dimension`; `clampWithRubberBand(50, 0, 100, 300) === 50`; `Stagger` gives the 3rd child `--i: 2` and the 20th `--i: 11` (cap); `IconSwap` keeps the previous icon mounted with `data-state="exit"` right after a key change; `flyTo` returns `null` when `prefers-reduced-motion` matches; `SegmentedControl` renders exactly one `[data-slot="segmented-thumb"]` inside the selected item.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `RD2-1: motion building blocks for the 20 rules`.

### Task 7: PWA colours and icons

**Files:** `src/lib/pwa.ts`, `scripts/lib/pwa-icons.ts`, `public/icons/*`, `scripts/lib/offline-page.ts`, `scripts/lib/hand-off-page.ts`, `src/app/[locale]/driver/layout.tsx`, their tests.

- [ ] **Step 1:** `PWA_THEME_COLOR = "#FFC72C"`, `PWA_BACKGROUND_COLOR = "#F1F2F4"`; icon: ink route mark on yolk; regenerate with `pnpm pwa:icons`; static pages use the same two colours. Update tests that pin `#2f6b4f`.
- [ ] **Step 2: Run** `pnpm test`. **Step 3: Commit** `RD2-1: app icon and browser colours in yolk and ink`.

### Task 8: Record, verify, open the PR

**Files:** `DESIGN.md`, `PRODUCT.md` (new, repo root), `docs/redesign/NOTES.md` (pointer to DESIGN.md), `AGENTS.md` (one line naming DESIGN.md as the design source).

- [ ] **Step 1:** Write `PRODUCT.md` (users, scenes, tone) and `DESIGN.md` (tokens, button table, motion table, do and don't).
- [ ] **Step 2: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check`, then the e2e specs that touch the kit (`pnpm test:e2e`), and fix what the new classes break without skipping any test.
- [ ] **Step 3:** One batched inspection round: driver home and stop at 375 px, office overview, tours and a form at 1280 px, each in light and dark; fix everything in one batch; run the impeccable detector once on the changed files.
- [ ] **Step 4: Commit**, push `claude/project-thread-hz1an2`, open the PR.
