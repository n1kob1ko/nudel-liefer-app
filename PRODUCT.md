# Routenplanner: product context

Durable context for anyone designing or building screens. The visual system lives in
[DESIGN.md](./DESIGN.md).

## What it is

A delivery planner for a small food producer in Vienna: the office takes orders from restaurants,
plans the day's tours and hands them to the drivers; the drivers deliver and report back.

## Who uses it, and where

**The office** (one or two people, desktop from 1280 px, German, English or Chinese). In the
morning, under time pressure: confirm orders, build the tour, assign driver and vehicle, release
it. During the day: see how far each driver is and where something went wrong. Two or three drivers
can be out at the same time.

**The drivers** (phone, one hand, in a van, a stairwell or a cold store; German, English, Serbian,
Czech or Chinese; often without a connection). They want to know the next stop, what to unload
there, and to tick it off. They do not read.

## What success looks like on a screen

- The next thing to do is obvious within a second, without reading.
- A status is recognised by colour and shape before the word is read, and it means the same thing
  everywhere.
- A tap is answered at once, even offline. Nothing a driver does can be lost or sent twice.
- A mistake can be taken back (undo), so nothing needs a "are you sure" for everyday actions.
- The office sees problems first, then progress, then everything else.

## Tone

Plain, short, concrete. A button names its action ("Tour freigeben", "Geliefert"). An error says
what happened and what to do next. No jokes, no exclamation marks, no technical words for the
drivers.

## Constraints that shape the design

- Driver app: touch targets at least 48 px, text at least 16 px, quantities at least 28 px and
  bold, usable in sunlight and in the dark, safe-area aware, works offline.
- Five locales for drivers, three for the office. Chinese and long German words must fit.
- WCAG AA: text 4.5:1, control boundaries and focus rings 3:1, status never by colour alone.
- No function may get lost in a redesign. Browser tests depend on `data-testid`s.
