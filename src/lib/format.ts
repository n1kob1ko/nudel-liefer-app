import type { createFormatter } from "next-intl";

type Formatter = ReturnType<typeof createFormatter>;

/** Fallback when `Settings.timezone` cannot be read; the real value is stored in Settings (backlog 4.3). */
export const DEFAULT_TIMEZONE = "Europe/Vienna";

/**
 * Locale-aware formatting helpers on top of a next-intl formatter
 * (`useFormatter()` in components, `await getFormatter()` in async server code).
 */
export function createAppFormatters(format: Formatter, timeZone: string = DEFAULT_TIMEZONE) {
  return {
    /** Quantities are whole numbers (D23, NUD-137): `5`, `1,200` in en. */
    quantity: (value: number | string) =>
      format.number(Number(value), { maximumFractionDigits: 0 }),
    /** A moment in time, shown in the factory time zone, e.g. "Mo., 17. Okt.". */
    dateShort: (value: Date) =>
      format.dateTime(value, { weekday: "short", day: "numeric", month: "short", timeZone }),
    dateLong: (value: Date) =>
      format.dateTime(value, { weekday: "long", day: "numeric", month: "long", timeZone }),
    dateTime: (value: Date) =>
      format.dateTime(value, { dateStyle: "medium", timeStyle: "short", timeZone }),
    time: (value: Date) => format.dateTime(value, { hour: "2-digit", minute: "2-digit", timeZone }),
    /**
     * A `DATE` column value such as `deliveryDate` (a calendar day without time zone).
     * Always formatted in UTC so the day never shifts.
     */
    calendarDate: (value: Date) => format.dateTime(value, { dateStyle: "medium", timeZone: "UTC" }),
    /**
     * Money of an order or a bill (D33, NUD-196): euro cents in, local currency text out
     * ("42,50 €"). Always EUR — the factory bills in euro.
     */
    amount: (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" }),
    /**
     * A correction on a monthly bill (NUD-197): always with its sign ("-10,00 €", "+2,50 €"), so a
     * deduction and a surcharge read differently without relying on colour.
     */
    signedAmount: (cents: number) =>
      format.number(cents / 100, { style: "currency", currency: "EUR", signDisplay: "exceptZero" }),
  };
}

export type AppFormatters = ReturnType<typeof createAppFormatters>;

/**
 * Requested delivery window as one line (NUD-148): `03.11.2026`, `03.11.2026 – 05.11.2026` and an
 * optional `08:00–11:00` (24 h, factory time; the same in every locale).
 */
export function formatOrderWindow(
  fmt: Pick<AppFormatters, "calendarDate">,
  window: { from: Date; to: Date; fromTime: string | null; toTime: string | null },
): string {
  const days =
    window.from.getTime() === window.to.getTime()
      ? fmt.calendarDate(window.from)
      : `${fmt.calendarDate(window.from)} – ${fmt.calendarDate(window.to)}`;
  if (!window.fromTime && !window.toTime) return days;
  return `${days}, ${window.fromTime ?? ""}–${window.toTime ?? ""}`;
}

/** True when the window is just the planned day (whole day): nothing worth showing in a list. */
export function isPlainWindow(
  window: { from: Date; to: Date; fromTime: string | null; toTime: string | null },
  plannedDay: Date,
): boolean {
  return (
    !window.fromTime &&
    !window.toTime &&
    window.from.getTime() === plannedDay.getTime() &&
    window.to.getTime() === plannedDay.getTime()
  );
}
