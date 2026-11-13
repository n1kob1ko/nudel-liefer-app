import {
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  ClockIcon,
  FileTextIcon,
  ImageIcon,
  type LucideIcon,
  PencilLineIcon,
  RouteIcon,
  SendIcon,
  TriangleAlertIcon,
  TruckIcon,
} from "lucide-react";

/**
 * Status colour + icon vocabulary (redesign RD-2, re-design.md §3 principle 2, §14.1).
 *
 * **Single source of truth.** Badges (`StatusBadge`), list rows, map markers, progress segments and
 * tables all read the tone from here, so one stop looks identical everywhere. Never colour alone:
 * a badge always carries text (and optionally an icon/dot) next to the colour.
 *
 * The values come from the real enums:
 *  - `StopStatus` (prisma): `PENDING | DELIVERED | PROBLEM`
 *  - `TourStatus` (prisma): `DRAFT | OPTIMIZED | RELEASED | IN_PROGRESS | COMPLETED`
 *  - `OrderStatus` (prisma): `DRAFT | CONFIRMED | CANCELLED`
 *  - `OrderSource` (prisma): `MANUAL | SCREENSHOT`
 *  - `ProblemReason` (prisma): `CLOSED | NOBODY_THERE | NO_PARKING | WRONG_QUANTITY | REFUSED |
 *    ADDRESS_NOT_FOUND | OTHER`
 *
 * `CANCELLED` / `FAILED` / `QUEUED` are accepted as string inputs where the UI derives them (an
 * aborted stop, an action waiting in the outbox) even though they are not stored stop statuses.
 */

/** The six tones of the design system (re-design.md §4.1). */
export type Tone = "neutral" | "primary" | "success" | "warning" | "destructive" | "info";

/** Soft background + matching dark text, contrast >= 4.5:1 (globals.css documents the ratios). */
export const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  primary: "bg-primary-soft text-primary-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
};

/** Fill for a small status dot / map marker (never the only carrier of meaning). */
export const toneDot: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

/**
 * Stop: open = neutral, delivered = green, problem = red (redesign RD2: red means "problem" and
 * nothing else), waiting in the outbox / cancelled = orange.
 */
const STOP_TONES: Record<string, Tone> = {
  PENDING: "neutral",
  DELIVERED: "success",
  PROBLEM: "destructive",
  QUEUED: "warning", // UI overlay: the action is waiting in the outbox, not stored on the stop
  FAILED: "destructive",
  CANCELLED: "warning", // a cancelled stop is reported, not an error the driver caused
};

/** Tour: draft = neutral, planned/optimized = info, released = brand, completed = green. */
const TOUR_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  OPTIMIZED: "info",
  PLANNED: "info", // alias used by older screens; not a stored value
  RELEASED: "primary",
  IN_PROGRESS: "primary",
  COMPLETED: "success",
  DONE: "success", // alias used by §14.1 of the redesign document
};

/** Order: draft = neutral, confirmed = green, cancelled = red. */
const ORDER_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  CONFIRMED: "success",
  CANCELLED: "destructive",
};

const STOP_ICONS: Record<string, LucideIcon> = {
  PENDING: CircleIcon,
  DELIVERED: CircleCheckIcon,
  PROBLEM: TriangleAlertIcon,
  QUEUED: ClockIcon,
  FAILED: CircleXIcon,
  CANCELLED: CircleXIcon,
};

const TOUR_ICONS: Record<string, LucideIcon> = {
  DRAFT: FileTextIcon,
  OPTIMIZED: RouteIcon,
  PLANNED: RouteIcon,
  RELEASED: SendIcon,
  IN_PROGRESS: TruckIcon,
  COMPLETED: CircleCheckIcon,
  DONE: CircleCheckIcon,
};

const ORDER_ICONS: Record<string, LucideIcon> = {
  DRAFT: PencilLineIcon,
  CONFIRMED: CircleCheckIcon,
  CANCELLED: CircleXIcon,
};

function toneOf(map: Record<string, Tone>, status: string, fallback: Tone): Tone {
  return map[status.toUpperCase()] ?? fallback;
}

/** Tone of a stop status. Unknown values fall back to neutral (never throw in the UI). */
export function stopTone(status: string): Tone {
  return toneOf(STOP_TONES, status, "neutral");
}

/**
 * Tone of a stop row/list entry where the tour may mark exactly one stop as the next one.
 * The "next" stop wins over the stored status (it is brand-coloured everywhere: list, map, badge).
 */
export function stopToneWithNext(status: string, isNext: boolean): Tone {
  return isNext ? "primary" : stopTone(status);
}

/** Tone of a tour status. */
export function tourTone(status: string): Tone {
  return toneOf(TOUR_TONES, status, "neutral");
}

/** Tone of an order status. */
export function orderTone(status: string): Tone {
  return toneOf(ORDER_TONES, status, "neutral");
}

/** Leading icon of a stop status (optional for callers — the badge text always carries the meaning). */
export function stopIcon(status: string): LucideIcon {
  return STOP_ICONS[status.toUpperCase()] ?? CircleIcon;
}

/** Leading icon of a tour status. */
export function tourIcon(status: string): LucideIcon {
  return TOUR_ICONS[status.toUpperCase()] ?? FileTextIcon;
}

/** Leading icon of an order status. */
export function orderIcon(status: string): LucideIcon {
  return ORDER_ICONS[status.toUpperCase()] ?? PencilLineIcon;
}

/**
 * Icon for the source an order came in through (`OrderSource`): typed in by the office or imported
 * from a screenshot. Text always accompanies the icon (re-design.md §9.2).
 */
export function orderSourceIcon(source: string): LucideIcon {
  return source.toUpperCase() === "SCREENSHOT" ? ImageIcon : PencilLineIcon;
}

/** Message key of a stop status label (`common.statuses.stop.*`, present in every locale). */
export function stopStatusLabelKey(status: string): string {
  return `statuses.stop.${status.toUpperCase()}`;
}

/** Message key of a tour status label (`common.statuses.tour.*`). */
export function tourStatusLabelKey(status: string): string {
  return `statuses.tour.${status.toUpperCase()}`;
}

/** Message key of an order status label (`common.statuses.order.*`). */
export function orderStatusLabelKey(status: string): string {
  return `statuses.order.${status.toUpperCase()}`;
}

/** Message key of an order source label (`admin.orders.source.*`). */
export function orderSourceLabelKey(source: string): string {
  return `source.${source.toUpperCase()}`;
}

/**
 * Message key of a unit label (`common.units.*`, e.g. "Sackerl"). The driver screens use the ICU
 * plural keys under `driver.units.*` instead — they need a count, these do not.
 */
export function unitLabelKey(unit: string): string {
  return `units.${unit.toUpperCase()}`;
}
