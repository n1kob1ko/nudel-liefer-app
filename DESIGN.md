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

## Do and don't

- Do put the important action in yolk and leave the others white.
- Do show a `Skeleton` in the shape of what is loading; don't show a spinner for content.
- Do keep the test ids and native `<select>`s the browser tests rely on.
- Don't use `text-primary`, `border-primary` on an unfilled element, or yolk for charts on white.
- Don't add a second accent colour, gradient text, glass blur or nested cards.
- Don't animate from `scale(0)`, don't use `ease-in`, don't use `transition: all`.
