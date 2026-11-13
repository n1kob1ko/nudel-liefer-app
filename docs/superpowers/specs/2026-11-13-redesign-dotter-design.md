# Redesign "Dotter" (RD2): design

Date: 2026-11-13. Requested by niko. Replaces the sage-green look from `docs/redesign/NOTES.md`.

## Intent

niko asked for the whole app to be redone: design, UX, colours, "easy to use", with the 20 motion
rules from the project instructions. He later added: rename the product to **Routenplanner**, make
all buttons nicer with the important ones in colour, and make the office overview work when two or
three drivers are out at once.

Who it is for: the office (desktop, 1280 px and up, de/en/zh-Hans) plans the day under time
pressure in the morning. Drivers (phone, five locales, often offline, one hand, in a van or a
stairwell) tick off stops. Both groups want to see what is next without reading.

## Goals

- One accent with one meaning. Yolk yellow marks "this is the next thing to do": the primary
  action, the next stop, the current step, the active selection.
- Status colours mean exactly one thing each: green is delivered or done, red is a problem or a
  destructive action, orange is a warning, blue is information.
- Important buttons are filled and coloured, so they are found at a glance. Secondary buttons are
  white with a border. Every button has a pressed state.
- Fewer things per screen: one coloured card per driver screen, one summary line instead of
  several header blocks in the office.
- Motion follows the 20 rules and is never decoration: it shows where something came from, what
  changed, and that a tap was registered.

## Non-goals

- No function is removed. All flows, test ids and translations stay.
- No live GPS tracking of drivers (the app has none; the overview uses the last ticked stop).
- No deploy. Merging does not deploy.

## Anti-goals

- A yellow app. Yolk is used sparingly; surfaces stay neutral.
- Yellow text on white (1.5:1). Yolk is a fill, never a text colour on light surfaces.
- Warnings that look like the brand colour. Warning moves to orange for that reason.
- Bounce, long animations, or anything that delays a driver's tap.

## Approaches considered

1. **Dotter (chosen by niko, decision card 2026-11-13):** neutral cool-grey surfaces, yolk
   `#FFC72C` plus ink `#15171A`. Highest signal for "next", works in sunlight on a phone, clearly
   different from the old look.
2. **Kobalt:** blue accent. Calm and familiar, but blue already means "information".
3. **Flaschengrün:** keep green. Least change, but green then means both "brand" and "delivered".

## Design decisions

### Colour tokens (HSL channels in `src/app/globals.css`)

- `--primary` is the yolk fill in both schemes, `--primary-foreground` is ink. `--primary-hover`
  is one step deeper.
- `--primary-soft` / `--primary-soft-foreground`: pale yolk with ink text (light), deep yolk-brown
  with pale yolk text (dark). Used for tinted buttons, selected rows, the active nav entry.
- `--ring` is ink in light mode and yolk in dark mode, so the focus ring always has at least 3:1
  against its surroundings.
- Links are ink (or near-white in dark) with a yolk underline: utility class `link`.
- `--warning` moves from amber to orange so it cannot be confused with yolk.
- `--hero` is yolk with ink text.
- Cards get a hairline border and almost no shadow; shadows are neutral, with offset and blur.
- Inputs are white with a visible border (3:1 against the card).

Contrast is enforced by a unit test over the token file (`src/lib/design-tokens.test.ts`): text
pairs at least 4.5:1, UI boundaries and focus rings at least 3:1, in both schemes.

### Buttons

| Variant               | Look                              | Use                                   |
| --------------------- | --------------------------------- | ------------------------------------- |
| `default` / `primary` | yolk fill, ink text, tactile edge | the one important action of a view    |
| `success`             | green fill, white text            | "Geliefert", confirm a completed step |
| `destructive`         | red fill, white text              | delete, irreversible actions          |
| `warning` (new)       | soft red-orange fill, dark text   | "Problem melden"                      |
| `secondary`           | pale yolk tint, ink text          | second-most important action          |
| `outline`             | white, border, ink text           | everything else                       |
| `ghost`, `link`       | no fill                           | toolbars, inline                      |

Filled buttons carry a tactile edge (inner top highlight, inner bottom shade, a small drop shadow)
that flattens while pressed. All buttons scale to 0.97 while pressed (rule 4).

### Motion (the 20 rules)

Tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`,
`--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`; press 140 ms; popover in 200 ms / out 160 ms;
sheet in 300 ms / out 240 ms; move 260 ms; stagger 30 ms.

| Rule                        | Where it lives                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ |
| 1 ease-out for entrances    | every overlay, list and toast entrance uses `--ease-out`                             |
| 2 dropdowns 150 to 250 ms   | select, dropdown menu, popover, combobox: 200 ms in                                  |
| 3 stagger rows by 30 ms     | `Stagger` component / `stagger` utility, capped at 12 rows                           |
| 4 scale 0.97 on press       | `Button`, pressable cards, segments, nav entries                                     |
| 5 stretch moving knobs 12 % | `Switch` thumb and the segmented-control thumb while they travel                     |
| 6 stagger details on snap   | sheet and dialog content fades in after the surface has landed                       |
| 7 arcs for object movement  | `flyTo` helper (WAAPI, x and y on different easings) for moved rows and markers      |
| 8 short pulse for success   | `SuccessPulse` and the `pulse-success` utility on "Geliefert", saved, released       |
| 9 ease-in-out for movement  | thumb, shared-layout indicator, reorder                                              |
| 10 popovers start at 0.95   | popover, menu, select, tooltip start at scale 0.95 (tooltip 0.97)                    |
| 11 enter from the trigger   | `transform-origin` from the Radix origin variables                                   |
| 12 exit to the trigger      | same origin on exit                                                                  |
| 13 no bounce                | no spring overshoot anywhere; `bounce: 0`                                            |
| 14 no tween while held      | drag handlers write transforms directly; transitions are off while a pointer is down |
| 15 exits 20 % shorter       | every exit duration is 0.8 of its entrance                                           |
| 16 overlap old and new      | tab panels, `IconSwap`, number changes crossfade instead of cutting                  |
| 17 masks for reveals        | `clip-path` for the segmented thumb colour change, before/after and reveal blocks    |
| 18 icons crossfade + blur   | `IconSwap` (opacity, scale, 2 px blur)                                               |
| 19 rubber band past limits  | bottom sheet drag, damped beyond its limits                                          |
| 20 reuse the same layoutId  | `motion` shared layout for the segmented thumb, the tab indicator, the nav indicator |

Reduced motion: every entrance collapses to a short fade; presses and colour changes stay.

`motion` is added as a dependency for rule 20 only, loaded with `LazyMotion` and `domMax` in client
leaves. Everything predetermined is CSS (off the main thread).

### Name

The product is called Routenplanner in every locale, the PWA manifest and the login. Repository
name and domain are unchanged.

## Delivery

Six pull requests, each mergeable on its own, none deploys:

1. Foundation: rename, tokens, kit components, motion building blocks, PWA colours.
2. Driver app.
3. Office shell and overview (multi-driver overview only after niko's OK on the proposal).
4. Office daily business: orders, day planning, tours, payments.
5. Office master data.
6. Polish: dark mode, all locales, contrast, keyboard, browser tests.

## Left to the builder

Exact class names, how each page adopts the kit, and the order of pages inside a step.
