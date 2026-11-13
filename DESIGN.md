# Routenplanner: design system "Dotter"

The source of truth for how the app looks and moves (redesign RD2, 2026-11). It replaces the
sage-green look described in `docs/redesign/NOTES.md`, which stays as history. Product context:
[PRODUCT.md](./PRODUCT.md). Why it looks like this: `docs/superpowers/specs/2026-11-13-redesign-dotter-design.md`.

Mode: **Operate**. People complete tasks here. Scanability and consistency outrank expression; the
brand lives in one colour and in precise details.

## Colour

Tokens are HSL channel triples in `src/app/globals.css`, used through Tailwind (`bg-primary`,
`text-muted-foreground`). `src/lib/design-tokens.test.ts` reads that file and fails when a pair
drops below WCAG AA, in light or dark.

| Role      | Token            | Light     | Dark            | Means                                                                                       |
| --------- | ---------------- | --------- | --------------- | ------------------------------------------------------------------------------------------- |
| Page      | `--background`   | `#F1F2F4` | near-black      | the neutral ground                                                                          |
| Surface   | `--card`         | white     | lifted grey     | cards, fields, sheets                                                                       |
| Ink       | `--foreground`   | `#15171A` | near-white      | text, icons, links                                                                          |
| Yolk      | `--primary`      | `#FFC72C` | `#FFC72C`       | **this is next**: the primary action, the next stop, the current step, the active selection |
| Pale yolk | `--primary-soft` | `#FFF3C4` | deep yolk-brown | selected row, active nav entry, tinted button                                               |
| Green     | `--success`      | `#137640` | lighter green   | delivered, done, saved                                                                      |
| Red       | `--destructive`  | `#C3281D` | lighter red     | a problem, a destructive action                                                             |
| Orange    | `--warning`      | `#A65107` | lighter orange  | a warning that is not yet a problem                                                         |
| Blue      | `--info`         | `#306088` | lighter blue    | neutral information                                                                         |

Rules:

1. **Yolk is a fill, never text on a light surface** (1.6:1). Text on yolk is ink
   (`text-primary-foreground`). Links use the `link` utility: ink with an underline that turns into
   a yolk marker stroke on hover.
2. **One yolk element per view where possible.** If everything is yellow, nothing is next.
3. **A status colour means one thing.** Green is never decoration; red is never "important".
   Status is always carried by a word or an icon as well.
4. **The focus ring** (`--ring`) is ink in light mode and yolk in dark mode. Fields show focus as an
   ink border plus a yolk halo (`field` utility).
5. Surfaces are neutral and cool. No second accent, no gradients except the hero tile's soft light.

## Buttons

`src/components/ui/button.tsx`. Colour carries importance.

| Variant               | Look                              | Use                                      |
| --------------------- | --------------------------------- | ---------------------------------------- |
| `default` / `primary` | yolk fill, ink text, tactile edge | the one important action of a view       |
| `success`             | green fill                        | "Geliefert", confirming a completed step |
| `destructive`         | red fill                          | delete, irreversible actions             |
| `warning`             | soft red fill                     | "Problem melden"                         |
| `secondary`           | pale yolk tint                    | the second-most important action         |
| `outline`             | white, border                     | everything else                          |
| `ghost`, `link`       | no fill                           | toolbars, inline                         |

Filled buttons carry the `btn-edge` (top highlight, bottom shade, small drop shadow) that flattens
while pressed. Every button scales to 0.97 while pressed. Driver screens use `size="lg"` (48 px)
or `xl` (56 px).

## Shape, depth, type

- Radius: fields and buttons 12 px, cards 16 px, sheets 20 px, pills full.
- Cards: white, hairline border, almost no shadow (`shadow-xs`). Shadows are neutral and always
  have an offset and a blur. Cards are never nested.
- Fields: white with a visible border (3:1), `field` utility for hover, focus and invalid.
- Type: Geist. Numbers in tables are tabular. Headlines are balanced, paragraphs avoid a lonely
  last word. Driver text is never below 16 px, quantities never below 28 px bold.

## Motion: the 20 rules

Tokens in `:root`: `--ease-out` (entrances), `--ease-in-out` (movement), `--ease-drawer` (sheets),
`--dur-*`. Tailwind's `ease-out` and `ease-in-out` utilities use the same strong curves.
Predetermined motion is CSS and runs off the main thread. Only shared-layout animation uses the
`motion` library, lazily loaded (`src/components/motion`).

| #   | Rule                                 | Where it lives                                                                    |
| --- | ------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Ease-out for entrances               | every overlay, list and toast entrance uses `--ease-out`                          |
| 2   | Dropdowns 150 to 250 ms              | `pop` utility: 200 ms in (`Select`, `DropdownMenu`, `Popover`, `Combobox`)        |
| 3   | Stagger list rows by 30 ms           | `<Stagger>` / `stagger-item`, capped at 12 rows                                   |
| 4   | Scale to 0.97 on press               | `Button`; pressable cards 0.99; close buttons 0.94                                |
| 5   | Stretch moving knobs by 12 %         | `knob-stretch`: `Switch` knob, `SegmentedControl` thumb                           |
| 6   | Stagger details on snap              | `settle` utility: dialog content arrives after the surface                        |
| 7   | Arcs for object movement             | `flyTo()` (x and y on different curves)                                           |
| 8   | Short pulse as success confirmation  | `<SuccessPulse>` / `pulse-ring`                                                   |
| 9   | Ease-in-out for movement             | thumb, knob, progress ring, shared-layout highlight                               |
| 10  | Popovers start at scale 0.95         | `pop` (tooltip 0.97, dialog 0.96)                                                 |
| 11  | Enter from the trigger               | `--pop-origin` is set from the Radix transform-origin variable                    |
| 12  | Exit to the trigger                  | same origin on exit                                                               |
| 13  | No bounce in everyday UI             | tweens only; no spring overshoot anywhere                                         |
| 14  | Do not tween while held              | `useSheetDrag` writes transforms directly, transition off while a pointer is down |
| 15  | Exits 20 % shorter than entrances    | 200/160, 240/190, 300/240 ms                                                      |
| 16  | Overlap old and new state            | `IconSwap`, tab panels fade in over the old panel                                 |
| 17  | Masks for reveals and colour changes | `clip-path` reveals; used by the page steps that compare or reveal content        |
| 18  | Icons change by crossfade and blur   | `<IconSwap>`                                                                      |
| 19  | Rubber band past limits              | `rubberBand()`, bottom sheet pulled up                                            |
| 20  | Reuse the same layoutId              | `<LayoutThumb>` in `SegmentedControl` and `Tabs`, inside a `layoutRoot`           |

More rules that apply everywhere:

- **Interruptible.** Hover, press and colour changes are CSS transitions, so they can be reversed
  mid-way. Keyframes are used only for one-shot entrances and exits.
- **Not on page load.** Knob stretch, success pulse and icon swap run only after the user did
  something.
- **Frequency decides.** Something seen dozens of times a day gets less motion, not more.
- **Reduced motion.** `prefers-reduced-motion` collapses movement to a near-instant change;
  spinners keep turning. `motion` follows the same setting.
- **Sheets can be swiped away** by their handle: far enough or a quick flick closes, anything else
  settles back. Esc and the close button always work.

## Driver app

- **One yolk button per screen:** "Navigation starten" while a stop is open, "Weiter zu Stopp n"
  once it is done. The departure checklist and the photo buttons are white.
- **One coloured card:** the next stop, pale yolk with a yolk edge all round. No side stripes.
- **Green is "Geliefert", red is "Problem"** in the badge, the list row, the ring, the bar and the
  result card. Orange is only for hints: the customer note, offline, "waiting to be sent".
- **The status buttons stay in the page flow,** after the quantities (`docs/driver-usability.md`):
  a sticky "Geliefert" invites a tap before the delivery was read.
- **Empty extras are quiet:** an unknown key or a missing Abkürzung is a thin grey chip.
- **Motion:** stop rows arrive 30 ms apart; the next-stop card rises in when it takes over after a
  delivery on the same screen; a delivery is confirmed by one ring around the count or the result
  card. Nothing animates when the screen is merely opened again.
- One 12 px gap between the blocks of a screen, one radius (`rounded-xl`) for its cards.

## Start page and logins

- **One narrow column in the middle** (`AuthFrame`, 24 rem): the app mark (`Brand`), one card, one
  quiet row below it. The same on a phone and on a wide screen; nothing sits at the screen edge.
- **The start page is two rows to tap:** "Büro" and "Fahrer", then the language. No other text.
- **A login is one card:** title, fields, the yolk button. The way to the other login, the language
  and the theme sit below the card. No brand panel, no slogan.
- Whoever is already signed in gets one card with "Weiter" (yolk) and "Abmelden", not a bar.

## Words

- **A screen says what to do, not how the app works.** A page title has no sentence under it; at
  most one short line of facts (the day, a count).
- **Whatever is worth knowing once sits behind a small "i"** (`InfoTip`; `FormField info=`,
  `PageHeader info=`): one tap away, read out to screen readers as the field's description.
- Text stays on the page only where the user must read it to get the field right, and for errors.
- Rarely used choices sit behind one button ("Filter" on the orders page) and show by themselves
  while one of them is set.

## Office

- **One column.** The top bar and the page share one column (1440 px at most, the same gutters),
  so the search field, the title, the filters and the list start on the same line. No breadcrumb:
  the menu shows where you are. Below 1025 px the bar shows the app mark.
- **Every page starts the same** (`PageHeader`): title left, at most one yolk action right, the
  filters in the row below, in the page column. A page below a list (new, edit, detail) has one
  arrow link back above the title (`back`).
- **A list is one white surface** (`<Table surface>`) with a plain header row. On a phone a table
  keeps the columns that matter (who, state, the actions) and drops the rest.
- **Few row actions are buttons, not a menu** (`RowButtons` / `RowButton`, owner feedback of
  2026-11-13: the three dots are one tap too many). On a phone each row is a block
  (`stackedTable`): who and state, then the actions as buttons with one word each ("Neue PIN",
  "Sprache", "Löschen"), 44 px high, wrapping so that no word is cut. From 768 px the same buttons
  are icons with a tooltip and the row's subject in their name. Drivers and vehicles work this
  way; a row with more than five actions keeps the "…" menu (`RowActions`). A switch that already
  turns something on and off needs no second action for it.
- **A form is one card with hairlines between its parts,** labels above the fields, the yolk button
  at the end. Fields are as wide as what goes into them.
- **The menu highlight travels.** The active entry of the sidebar and of the bottom bar is one pale
  yolk pill that moves to the new section (rule 20). Entries scale to 0.98 while pressed.
- **The overview is built for two or three drivers at once** (`DayBoard`):
  - one strip of figures for the day: stops done, drivers on the road, problems, when the last
    driver is back, the next delivery day. One card with hairlines, not five cards;
  - every reported problem is a red row above everything else, with customer, reason, driver, time
    and a way to the tour. No problem, no row;
  - one lane per driver: who, vehicle, state, "7 von 20", expected end, a bead per stop (green
    delivered, red square problem, yolk the next one), the next stop, "pünktlich" or "12 Min.
    später" (orange from five minutes), the last ticked stop. The whole lane opens the tour;
  - the map shows each driver at the stop he ticked off last. There is no live GPS and the card
    says so. The same is listed in words below the map.
- **One yolk button on the overview:** "Neue Bestellung".
- **Motion:** lanes arrive 30 ms apart; a delivery that comes in while the page is open is
  confirmed by one ring around that driver's count. The page re-reads itself every 30 s.
- A finished tour reads "Abgeschlossen" everywhere, the same word as on the tour page.
- **Figures are one strip,** not a row of cards: one bordered surface with hairlines between the
  cells (overview, tour, payments, utilization).
- **Lists are calm.** Initials are grey, "Aktiv" is grey: a colour in a list row is a status.
  A selection (period, tour tab) is pale yolk, never the yolk fill.
- **Day planning is a sheet.** A zero recedes, a quantity is bold, Enter and the arrow keys walk a
  column, and the bar at the bottom sums the day while typing.
- **Ctrl+K / ⌘K opens the command menu** from every office page: every section plus "Neue
  Bestellung" and "Neuer Kunde". It opens without motion because it is used all day.
- Sticky bars are solid surfaces. No blur.
- **A page change is a short cross-fade of the content** (120 ms out, 150 ms in, opacity only,
  `ViewTransition` in `AdminShell`). Menu and top bar do not take part; a new filter or date on
  the same page does not fade. The driver app has no page transition.

## Do and don't

- Do put the important action in yolk and leave the others white.
- Do show a `Skeleton` in the shape of what is loading; don't show a spinner for content.
- Do keep the test ids and native `<select>`s the browser tests rely on.
- Don't use `text-primary`, `border-primary` on an unfilled element, or yolk for charts on white.
- Don't add a second accent colour, gradient text, glass blur or nested cards.
- Don't animate from `scale(0)`, don't use `ease-in`, don't use `transition: all`.
