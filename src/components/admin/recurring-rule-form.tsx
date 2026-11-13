"use client";

import {
  CalendarDaysIcon,
  ChevronDownIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { useMemo, useState } from "react";
import { DayButton } from "react-day-picker";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DAY_PICKER_LOCALES } from "@/components/ui/date-picker";
import { FormField } from "@/components/ui/form-field";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { parseTimeOfDay } from "@/domain/delivery-window";
import { formatCalendarDate, parseCalendarDate, parseQuantity } from "@/domain/order";
import {
  itemsForWeekday,
  MAX_EVERY_N_WEEKS,
  MAX_MAX_DELIVERIES,
  MAX_MONTHLY_RULES,
  type MonthlyRule,
  nextScheduleDates,
  type RecurringSchedule,
} from "@/domain/recurring-order";
import { ISO_WEEKDAYS, isoWeekday } from "@/domain/settings";
import { createAppFormatters } from "@/lib/format";
import type { AppLocale } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import type { RecurringRuleView } from "@/server/recurring-orders";

/**
 * The rule form of a recurring order (`RecurringOrder`), shared by both office entry points:
 * the dialog in the order form (`order-recurring-dialog.tsx`, NUD-166) and the card on the customer
 * page (`recurring-orders-card.tsx`, NUD-149). One implementation, so the two cannot drift apart.
 *
 * NUD-171 adds the decided UI: preset chips above the weekdays, freely combinable monthly rule
 * chips (delivery days are the union of weekly and monthly patterns), one collapsible card per
 * selected weekday with its own product rows ("wie Basis" otherwise), a delivery window, three end
 * conditions, a calendar popover for single days plus one connected skipped range, the season, and
 * a live preview of the next five delivery dates.
 *
 * The component is controlled: the entry point owns the draft (so it can add its own fields, e.g.
 * the order dialog's "leave this day out") and submits `ruleInputFromDraft`. All schedule logic is
 * the pure domain module (`nextScheduleDates`, `itemsForWeekday`), so the preview is client-side.
 */

export type RuleProduct = {
  id: string;
  label: string;
  unit: "KG" | "PACK" | "CRATE" | "PIECE";
};

/** One editable product row of the form (quantity still as typed text). */
export type RuleLineDraft = { key: number; productId: string; quantity: string };

type MonthDayDraft = { month: string; day: string };

/** Which end condition the form shows; the payload keeps both stored values (see below). */
export type RuleEndMode = "open" | "date" | "count";

export type RecurringRuleDraft = {
  /** ISO weekdays 1..7; empty is allowed when `monthlyRules` has at least one pattern. */
  weekdays: number[];
  monthlyRules: MonthlyRule[];
  everyNWeeks: string;
  /** `YYYY-MM-DD`; also the week that starts the rhythm. */
  anchorDate: string;
  /** `HH:MM` or empty (= all day). */
  windowFrom: string;
  windowTo: string;
  season: boolean;
  seasonFrom: MonthDayDraft;
  seasonTo: MonthDayDraft;
  endMode: RuleEndMode;
  /** `YYYY-MM-DD` or empty. */
  endsOn: string;
  maxDeliveries: string;
  /** One connected skipped range (holiday); `YYYY-MM-DD` or empty. */
  skipFrom: string;
  skipTo: string;
  /** Single days that are left out, `YYYY-MM-DD`, ascending on save. */
  exceptions: string[];
  /** Base product list of the rule. */
  lines: RuleLineDraft[];
  /** Own product rows per ISO weekday; a weekday without rows uses `lines`. */
  dayItems: Partial<Record<number, RuleLineDraft[]>>;
};

/** Field-level problems the form can detect itself (the server validates again). */
export type RuleFormError =
  "pattern" | "every" | "anchor" | "lines" | "window" | "endsOn" | "maxDeliveries" | "skip";

/** The payload fields of `recurringOrderInputSchema` the form fills in. */
export type RuleInputFields = {
  weekdays: number[];
  monthlyRules: MonthlyRule[];
  everyNWeeks: number;
  anchorDate: string;
  seasonFrom: string | null;
  seasonTo: string | null;
  exceptions: string[];
  skipFrom: string | null;
  skipTo: string | null;
  windowFromTime: string | null;
  windowToTime: string | null;
  endsOn: string | null;
  maxDeliveries: number | null;
  lines: { productId: string; quantity: number }[];
  dayItems: { weekday: number; productId: string; quantity: number }[];
};

export type RuleInputResult =
  | { ok: true; input: RuleInputFields & { customerId: string } }
  | { ok: false; error: RuleFormError };

const pad2 = (value: number | string) => String(value).padStart(2, "0");

/**
 * A `DATE` value (UTC midnight) as a local calendar day for react-day-picker, and back. The
 * calendar works in the browser's time zone; converting through the calendar parts keeps the day
 * the office tapped, whatever the time zone (UTC midnight would show as the previous day west of
 * UTC).
 */
function toPickerDay(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function fromPickerDay(date: Date): string {
  return formatCalendarDate(
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())),
  );
}

const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Localized weekday name of an ISO weekday (1 = Monday); UTC so the day never shifts. */
export function formatWeekday(
  locale: AppLocale | string,
  day: number,
  style: "long" | "short" = "long",
): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 4 + day)), // 2026-01-05 is a Monday
  );
}

/** Localized month name, 1..12. */
export function formatMonth(locale: AppLocale | string, month: number): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2001, month - 1, 1)),
  );
}

function splitMonthDay(value: string | null, fallback: MonthDayDraft): MonthDayDraft {
  if (!value) return fallback;
  return { month: String(Number(value.slice(0, 2))), day: String(Number(value.slice(3, 5))) };
}

function monthDayValue(value: MonthDayDraft): string {
  return `${pad2(value.month)}-${pad2(value.day)}`;
}

function lineDraftsFrom(
  lines: readonly { productId: string; quantity: number | string }[],
): RuleLineDraft[] {
  return lines.map((line, index) => ({
    key: index + 1,
    productId: line.productId,
    quantity: String(line.quantity),
  }));
}

/** Parsed base lines of a draft (rows with a positive whole quantity only). */
function baseItemsOf(draft: RecurringRuleDraft): { productId: string; quantity: number }[] {
  const out: { productId: string; quantity: number }[] = [];
  for (const line of draft.lines) {
    const quantity = parseQuantity(line.quantity);
    if (line.productId && quantity !== null) out.push({ productId: line.productId, quantity });
  }
  return out;
}

function dayItemsOf(draft: RecurringRuleDraft): RuleInputFields["dayItems"] {
  const out: RuleInputFields["dayItems"] = [];
  for (const [weekday, rows] of Object.entries(draft.dayItems)) {
    for (const row of rows ?? []) {
      const quantity = parseQuantity(row.quantity);
      if (row.productId && quantity !== null) {
        out.push({ weekday: Number(weekday), productId: row.productId, quantity });
      }
    }
  }
  return out;
}

/** A fresh rule (create). `weekdays` defaults to none; the order dialog passes the start day. */
export function newRuleDraft(options: {
  startDate: string;
  weekdays?: readonly number[];
  lines: readonly { productId: string; quantity: number | string }[];
}): RecurringRuleDraft {
  return {
    weekdays: [...(options.weekdays ?? [])],
    monthlyRules: [],
    everyNWeeks: "1",
    anchorDate: options.startDate,
    windowFrom: "",
    windowTo: "",
    season: false,
    seasonFrom: { month: "9", day: "1" },
    seasonTo: { month: "5", day: "31" },
    endMode: "open",
    endsOn: "",
    maxDeliveries: "",
    skipFrom: "",
    skipTo: "",
    exceptions: [],
    lines: lineDraftsFrom(options.lines),
    dayItems: {},
  };
}

/** The stored rule as a form draft (edit). */
export function ruleDraftFromView(rule: RecurringRuleView): RecurringRuleDraft {
  const byWeekday = new Map<number, { productId: string; quantity: number }[]>();
  for (const item of rule.dayItems) {
    const rows = byWeekday.get(item.weekday) ?? [];
    rows.push({ productId: item.productId, quantity: item.quantity });
    byWeekday.set(item.weekday, rows);
  }
  const dayItems: Partial<Record<number, RuleLineDraft[]>> = {};
  for (const [weekday, rows] of byWeekday) dayItems[weekday] = lineDraftsFrom(rows);
  // Both end conditions may exist on a row the API wrote; the radio shows the date then.
  const endMode: RuleEndMode = rule.endsOn
    ? "date"
    : rule.maxDeliveries !== null
      ? "count"
      : "open";
  return {
    weekdays: [...rule.weekdays],
    monthlyRules: [...rule.monthlyRules],
    everyNWeeks: String(rule.everyNWeeks),
    anchorDate: rule.anchorDate,
    windowFrom: rule.windowFromTime ?? "",
    windowTo: rule.windowToTime ?? "",
    season: Boolean(rule.seasonFrom && rule.seasonTo),
    seasonFrom: splitMonthDay(rule.seasonFrom, { month: "9", day: "1" }),
    seasonTo: splitMonthDay(rule.seasonTo, { month: "5", day: "31" }),
    endMode,
    endsOn: rule.endsOn ?? "",
    maxDeliveries: rule.maxDeliveries === null ? "" : String(rule.maxDeliveries),
    skipFrom: rule.skipFrom ?? "",
    skipTo: rule.skipTo ?? "",
    exceptions: [...rule.exceptions],
    lines: lineDraftsFrom(
      rule.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    ),
    dayItems,
  };
}

/** Whether the draft uses any field of the "Mehr Optionen" section (opened by default then). */
export function hasAdvancedOptions(draft: RecurringRuleDraft): boolean {
  return (
    Boolean(draft.windowFrom || draft.windowTo) ||
    draft.season ||
    draft.endMode !== "open" ||
    Boolean(draft.skipFrom || draft.skipTo) ||
    draft.exceptions.length > 0
  );
}

/** The draft as the pure schedule logic sees it; `null` while the anchor or rhythm is unusable. */
export function draftSchedule(draft: RecurringRuleDraft): RecurringSchedule | null {
  const anchorDate = parseCalendarDate(draft.anchorDate);
  const everyNWeeks = Number(draft.everyNWeeks);
  if (!anchorDate) return null;
  if (!Number.isInteger(everyNWeeks) || everyNWeeks < 1 || everyNWeeks > MAX_EVERY_N_WEEKS) {
    return null;
  }
  const exceptions = draft.exceptions
    .map((day) => parseCalendarDate(day))
    .filter((day): day is Date => day !== null);
  return {
    weekdays: draft.weekdays,
    everyNWeeks,
    anchorDate,
    seasonFrom: draft.season ? monthDayValue(draft.seasonFrom) : null,
    seasonTo: draft.season ? monthDayValue(draft.seasonTo) : null,
    exceptions,
    monthlyRules: draft.monthlyRules,
    skipFrom: parseCalendarDate(draft.skipFrom),
    skipTo: parseCalendarDate(draft.skipTo),
    endsOn: parseCalendarDate(draft.endsOn),
  };
}

export type PreviewRow = {
  date: Date;
  items: { productId: string; quantity: number }[];
};

/**
 * The next `count` delivery dates of the draft from `from` (inclusive) with the products of each
 * day: pure client-side, using the same `nextScheduleDates` / `itemsForWeekday` as generation.
 */
export function previewRows(draft: RecurringRuleDraft, from: string, count = 5): PreviewRow[] {
  const schedule = draftSchedule(draft);
  const start = parseCalendarDate(from) ?? schedule?.anchorDate;
  if (!schedule || !start) return [];
  if (schedule.weekdays.length === 0 && (schedule.monthlyRules ?? []).length === 0) return [];
  const baseItems = baseItemsOf(draft);
  const dayItems = dayItemsOf(draft);
  return nextScheduleDates(schedule, start, count).map((date) => ({
    date,
    items: itemsForWeekday(schedule, isoWeekday(date), baseItems, dayItems),
  }));
}

/**
 * Validates the draft and builds the server action input. `extraExceptions` lets an entry point add
 * its own skipped day (the order dialog leaves out the order's delivery day by default).
 */
export function ruleInputFromDraft(
  draft: RecurringRuleDraft,
  options: { customerId: string; extraExceptions?: readonly string[] },
): RuleInputResult {
  if (draft.weekdays.length === 0 && draft.monthlyRules.length === 0) {
    return { ok: false, error: "pattern" };
  }
  const everyNWeeks = Number(draft.everyNWeeks);
  if (!Number.isInteger(everyNWeeks) || everyNWeeks < 1 || everyNWeeks > MAX_EVERY_N_WEEKS) {
    return { ok: false, error: "every" };
  }
  const anchorDate = parseCalendarDate(draft.anchorDate);
  if (!anchorDate) return { ok: false, error: "anchor" };

  const lines: RuleInputFields["lines"] = [];
  for (const line of draft.lines) {
    const quantity = parseQuantity(line.quantity);
    if (!line.productId || quantity === null) return { ok: false, error: "lines" };
    lines.push({ productId: line.productId, quantity });
  }
  if (lines.length === 0) return { ok: false, error: "lines" };

  const dayItems: RuleInputFields["dayItems"] = [];
  for (const [weekday, rows] of Object.entries(draft.dayItems)) {
    for (const row of rows ?? []) {
      const quantity = parseQuantity(row.quantity);
      if (!row.productId || quantity === null) return { ok: false, error: "lines" };
      dayItems.push({ weekday: Number(weekday), productId: row.productId, quantity });
    }
  }

  const windowFrom = draft.windowFrom.trim() || null;
  const windowTo = draft.windowTo.trim() || null;
  if ((windowFrom === null) !== (windowTo === null)) return { ok: false, error: "window" };
  if (windowFrom !== null && windowTo !== null) {
    const from = parseTimeOfDay(windowFrom);
    const to = parseTimeOfDay(windowTo);
    if (from === null || to === null || from >= to) return { ok: false, error: "window" };
  }

  // Both stored end conditions are kept when a row has both; the radio only decides what is shown.
  // A chosen condition needs its value: "bis Datum" without a date would silently be open-ended.
  const open = draft.endMode === "open";
  let endsOn: string | null = null;
  if (!open && draft.endsOn.trim()) {
    const date = parseCalendarDate(draft.endsOn);
    if (!date || date.getTime() < anchorDate.getTime()) return { ok: false, error: "endsOn" };
    endsOn = draft.endsOn.trim();
  }
  if (draft.endMode === "date" && endsOn === null) return { ok: false, error: "endsOn" };
  let maxDeliveries: number | null = null;
  if (!open && draft.maxDeliveries.trim()) {
    const value = Number(draft.maxDeliveries);
    if (!Number.isInteger(value) || value < 1 || value > MAX_MAX_DELIVERIES) {
      return { ok: false, error: "maxDeliveries" };
    }
    maxDeliveries = value;
  }
  if (draft.endMode === "count" && maxDeliveries === null) {
    return { ok: false, error: "maxDeliveries" };
  }

  const skipFrom = draft.skipFrom.trim();
  const skipTo = draft.skipTo.trim();
  if ((skipFrom === "") !== (skipTo === "")) return { ok: false, error: "skip" };
  if (skipFrom !== "" && skipTo !== "") {
    const from = parseCalendarDate(skipFrom);
    const to = parseCalendarDate(skipTo);
    if (!from || !to || from.getTime() > to.getTime()) return { ok: false, error: "skip" };
  }

  const exceptions = [...new Set([...draft.exceptions, ...(options.extraExceptions ?? [])])].sort();

  return {
    ok: true,
    input: {
      customerId: options.customerId,
      weekdays: [...draft.weekdays].sort((a, b) => a - b),
      monthlyRules: draft.monthlyRules,
      everyNWeeks,
      anchorDate: draft.anchorDate,
      seasonFrom: draft.season ? monthDayValue(draft.seasonFrom) : null,
      seasonTo: draft.season ? monthDayValue(draft.seasonTo) : null,
      exceptions,
      skipFrom: skipFrom || null,
      skipTo: skipTo || null,
      windowFromTime: windowFrom,
      windowToTime: windowTo,
      endsOn,
      maxDeliveries,
      lines,
      dayItems,
    },
  };
}

/** Translator of the three monthly-pattern messages (see `monthlyRuleText`). */
export type MonthlyRuleTranslate = (
  key: "dayOfMonth" | "nthWeekday" | "lastWeekday",
  values: Record<string, string | number | Date>,
) => string;

/** Localized text of one monthly pattern ("jeder 1. Montag", "letzter Freitag", …). */
export function monthlyRuleText(
  rule: MonthlyRule,
  translate: MonthlyRuleTranslate,
  weekday: (day: number) => string,
): string {
  if (rule.kind === "dayOfMonth") return translate("dayOfMonth", { day: rule.day });
  if (rule.nth === -1) return translate("lastWeekday", { weekday: weekday(rule.weekday) });
  return translate("nthWeekday", { n: rule.nth, weekday: weekday(rule.weekday) });
}

/** Error text lookup shared by both entry points (max values included). */
export function useRuleErrorText() {
  const t = useTranslations("admin.recurringRule.errors");
  return (error: RuleFormError | "customerInactive" | "generic"): string => {
    if (error === "every") return t("every", { max: MAX_EVERY_N_WEEKS });
    if (error === "maxDeliveries") return t("maxDeliveries", { max: MAX_MAX_DELIVERIES });
    if (error === "customerInactive") return t("customerInactive");
    if (error === "generic") return t("generic");
    return t(error);
  };
}

const monthDayOf = (month: string, day: string) => ({
  month: String(Number(month)),
  day: String(Number(day)),
});

/** Weekday sets of the preset chips (decision NUD-171: "2×/Woche" = Monday + Thursday). */
const PRESETS = {
  daily: { weekdays: [...ISO_WEEKDAYS], everyNWeeks: "1" },
  weekdays: { weekdays: [1, 2, 3, 4, 5], everyNWeeks: "1" },
  twice: { weekdays: [1, 4], everyNWeeks: "1" },
  biweekly: { weekdays: [1], everyNWeeks: "2" },
} as const;

type PresetKey = keyof typeof PRESETS;

const QUICK_MONTHLY: { key: string; rule: MonthlyRule }[] = [
  { key: "day-1", rule: { kind: "dayOfMonth", day: 1 } },
  { key: "day-15", rule: { kind: "dayOfMonth", day: 15 } },
  { key: "first-monday", rule: { kind: "nthWeekday", nth: 1, weekday: 1 } },
  { key: "last-friday", rule: { kind: "nthWeekday", nth: -1, weekday: 5 } },
];

const sameRule = (a: MonthlyRule, b: MonthlyRule) => JSON.stringify(a) === JSON.stringify(b);

function LineEditor({
  rows,
  products,
  testIdBase,
  onChange,
  translate,
}: {
  rows: RuleLineDraft[];
  products: readonly RuleProduct[];
  testIdBase: string;
  onChange: (rows: RuleLineDraft[]) => void;
  translate: ReturnType<typeof useTranslations>;
}) {
  const nextKey = Math.max(0, ...rows.map((row) => row.key)) + 1;
  const patch = (key: number, values: Partial<RuleLineDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...values } : row)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2"
          data-testid={testIdBase}
        >
          <select
            aria-label={`${translate("products.product")} · ${index + 1}`}
            value={row.productId}
            onChange={(event) => patch(row.key, { productId: event.target.value })}
            className={`${selectClass} min-w-0`}
            data-testid={`${testIdBase}-product`}
          >
            <option value="">{translate("products.productPlaceholder")}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.label}
              </option>
            ))}
          </select>
          <Input
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${translate("products.quantity")} · ${index + 1}`}
            placeholder={translate("products.quantity")}
            value={row.quantity}
            onChange={(event) => patch(row.key, { quantity: event.target.value })}
            data-testid={`${testIdBase}-quantity`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={rows.length === 1}
            aria-label={`${translate("products.remove")}: ${index + 1}`}
            onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
            data-testid={`${testIdBase}-remove`}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...rows, { key: nextKey, productId: "", quantity: "" }])}
          data-testid={`${testIdBase}-add`}
        >
          <PlusIcon aria-hidden />
          {translate("products.add")}
        </Button>
      </div>
    </div>
  );
}

/** Open/collapsed state of the per-weekday quantity blocks. */
type DayOpenState = Record<number, boolean>;

/**
 * The whole rule form. Controlled: read `draft`, call `onChange` with a patch. `prefix` prefixes
 * every id and `data-testid` so both entry points keep their existing test ids
 * (`order-recurring-*` in the order dialog, `recurring-*` on the customer card).
 */
export function RecurringRuleForm({
  draft,
  onChange,
  products,
  prefix,
  startOn,
  baseLines = "editable",
}: {
  draft: RecurringRuleDraft;
  onChange: (patch: Partial<RecurringRuleDraft>) => void;
  products: readonly RuleProduct[];
  prefix: string;
  /** `YYYY-MM-DD` the preview starts at (today on the card, the order's window start in the dialog). */
  startOn: string;
  /** `readonly` = the order dialog shows the order's products above the form instead. */
  baseLines?: "editable" | "readonly";
}) {
  const t = useTranslations("admin.recurringRule");
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  const [moreOpen, setMoreOpen] = useState(() => hasAdvancedOptions(draft));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [openDays, setOpenDays] = useState<DayOpenState>(() =>
    Object.fromEntries(Object.entries(draft.dayItems).map(([weekday]) => [Number(weekday), true])),
  );
  const [monthlyKind, setMonthlyKind] = useState<"dayOfMonth" | "nthWeekday">("dayOfMonth");
  const [monthlyDay, setMonthlyDay] = useState("1");
  const [monthlyNth, setMonthlyNth] = useState("1");
  const [monthlyWeekday, setMonthlyWeekday] = useState("1");

  const weekdayName = (day: number, style: "long" | "short" = "long") =>
    formatWeekday(locale, day, style);
  const monthName = (month: number) => formatMonth(locale, month);
  const dayText = (value: string) => fmt.calendarDate(parseCalendarDate(value) ?? new Date(0));

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const rows = useMemo(() => previewRows(draft, startOn), [draft, startOn]);

  const setDayRows = (weekday: number, dayRows: RuleLineDraft[]) =>
    onChange({ dayItems: { ...draft.dayItems, [weekday]: dayRows } });
  const resetDayItems = (weekday: number) => {
    const dayItems = { ...draft.dayItems };
    delete dayItems[weekday];
    onChange({ dayItems });
  };
  const ownRows = (weekday: number) => {
    const seeded = draft.lines.map((line) => ({ ...line }));
    onChange({ dayItems: { ...draft.dayItems, [weekday]: seeded } });
    setOpenDays((open) => ({ ...open, [weekday]: true }));
  };

  /** Presets replace the whole pattern (no mode): days, rhythm and monthly rules together. */
  function applyPreset(key: PresetKey | "monthly") {
    const weekdays = key === "monthly" ? [] : [...PRESETS[key].weekdays];
    const dayItems: Partial<Record<number, RuleLineDraft[]>> = {};
    for (const weekday of weekdays) {
      const rows = draft.dayItems[weekday];
      if (rows) dayItems[weekday] = rows;
    }
    onChange({
      weekdays,
      everyNWeeks: key === "monthly" ? "1" : PRESETS[key].everyNWeeks,
      monthlyRules: key === "monthly" ? [{ kind: "dayOfMonth", day: 1 }] : [],
      dayItems,
    });
    setOpenDays({});
  }

  function toggleWeekday(day: number, checked: boolean) {
    if (checked) {
      onChange({ weekdays: [...draft.weekdays, day].sort((a, b) => a - b) });
      return;
    }
    const dayItems = { ...draft.dayItems };
    delete dayItems[day];
    onChange({ weekdays: draft.weekdays.filter((value) => value !== day), dayItems });
  }

  function addMonthlyRule(rule: MonthlyRule) {
    if (draft.monthlyRules.length >= MAX_MONTHLY_RULES) return;
    if (draft.monthlyRules.some((existing) => sameRule(existing, rule))) return;
    onChange({ monthlyRules: [...draft.monthlyRules, rule] });
  }

  function removeMonthlyRule(index: number) {
    onChange({ monthlyRules: draft.monthlyRules.filter((_, i) => i !== index) });
  }

  const monthlyFromBuilder = (): MonthlyRule => {
    if (monthlyKind === "dayOfMonth") {
      const day = Math.min(31, Math.max(1, Number(monthlyDay) || 1));
      return { kind: "dayOfMonth", day };
    }
    const nth = Number(monthlyNth);
    return {
      kind: "nthWeekday",
      nth: nth === -1 ? -1 : (nth as 1 | 2 | 3 | 4),
      weekday: Math.min(7, Math.max(1, Number(monthlyWeekday) || 1)),
    };
  };

  const exceptionDates = draft.exceptions
    .map((day) => parseCalendarDate(day))
    .filter((day): day is Date => day !== null)
    .map(toPickerDay);
  const anchorDate = parseCalendarDate(draft.anchorDate);

  const components = useMemo(
    () => ({
      DayButton: ({ day, ...props }: React.ComponentProps<typeof DayButton>) => (
        <DayButton day={day} {...props} data-testid={`${prefix}-calendar-day-${day.isoDate}`} />
      ),
    }),
    [prefix],
  );

  const monthDayFields = (
    id: string,
    value: MonthDayDraft,
    onChangeValue: (value: MonthDayDraft) => void,
  ) => (
    <div className="flex gap-2">
      <select
        id={`${id}-month`}
        aria-label={`${t("season.month")} · ${t("season.label")}`}
        value={value.month}
        onChange={(event) => onChangeValue(monthDayOf(event.target.value, value.day))}
        className={selectClass}
        data-testid={`${id}-month`}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {monthName(i + 1)}
          </option>
        ))}
      </select>
      <select
        id={`${id}-day`}
        aria-label={`${t("season.day")} · ${t("season.label")}`}
        value={value.day}
        onChange={(event) => onChangeValue(monthDayOf(value.month, event.target.value))}
        className={selectClass}
        data-testid={`${id}-day`}
      >
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex flex-col gap-5" data-testid={`${prefix}-rule-form`}>
      {baseLines === "editable" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium">{t("products.label")}</legend>
          <LineEditor
            rows={draft.lines}
            products={products}
            testIdBase={`${prefix}-line`}
            onChange={(lines) => onChange({ lines })}
            translate={t}
          />
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-medium">{t("presets.label")}</legend>
        <div className="flex flex-wrap gap-2" data-testid={`${prefix}-presets`}>
          {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset(key)}
              data-testid={`${prefix}-preset-${key}`}
            >
              {t(`presets.${key}`)}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyPreset("monthly")}
            data-testid={`${prefix}-preset-monthly`}
          >
            {t("presets.monthly")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("presets.hint")}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-medium">{t("weekdays")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid={`${prefix}-weekdays`}>
          {ISO_WEEKDAYS.map((day) => (
            <label key={day} className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                className="size-5 accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                checked={draft.weekdays.includes(day)}
                onChange={(event) => toggleWeekday(day, event.target.checked)}
                data-testid={`${prefix}-weekday-${day}`}
              />
              {weekdayName(day)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("rhythm")} htmlFor={`${prefix}-every`} info={t("rhythmHint")}>
          <Input
            id={`${prefix}-every`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_EVERY_N_WEEKS}
            step={1}
            value={draft.everyNWeeks}
            onChange={(event) => onChange({ everyNWeeks: event.target.value })}
            data-testid={`${prefix}-every`}
          />
        </FormField>
        <FormField label={t("anchor")} htmlFor={`${prefix}-anchor`} info={t("anchorHint")}>
          <Input
            id={`${prefix}-anchor`}
            type="date"
            value={draft.anchorDate}
            onChange={(event) => onChange({ anchorDate: event.target.value })}
            data-testid={`${prefix}-anchor`}
          />
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-medium">{t("monthly.label")}</legend>
        <p className="text-sm text-muted-foreground">{t("monthly.hint")}</p>
        <div className="flex flex-wrap gap-2" data-testid={`${prefix}-monthly-chips`}>
          {QUICK_MONTHLY.map((quick) => (
            <Button
              key={quick.key}
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.monthlyRules.some((rule) => sameRule(rule, quick.rule))}
              onClick={() => addMonthlyRule(quick.rule)}
              data-testid={`${prefix}-monthly-chip-${quick.key}`}
            >
              <RepeatIcon aria-hidden />
              {monthlyRuleText(
                quick.rule,
                (key, values) => t(`monthly.${key}`, values),
                weekdayName,
              )}
            </Button>
          ))}
        </div>
        {draft.monthlyRules.length > 0 ? (
          <ul className="flex flex-wrap gap-2" data-testid={`${prefix}-monthly-applied`}>
            {draft.monthlyRules.map((rule, index) => {
              const label = monthlyRuleText(
                rule,
                (key, values) => t(`monthly.${key}`, values),
                weekdayName,
              );
              return (
                <li key={`${rule.kind}-${index}`}>
                  <Badge variant="secondary" className="gap-1">
                    {label}
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${t("monthly.remove")}: ${label}`}
                      onClick={() => removeMonthlyRule(index)}
                      data-testid={`${prefix}-monthly-remove-${index}`}
                    >
                      <XIcon className="size-3.5" aria-hidden />
                    </button>
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={t("monthly.kind")} htmlFor={`${prefix}-monthly-kind`} className="w-44">
            <select
              id={`${prefix}-monthly-kind`}
              value={monthlyKind}
              onChange={(event) =>
                setMonthlyKind(event.target.value as "dayOfMonth" | "nthWeekday")
              }
              className={selectClass}
              data-testid={`${prefix}-monthly-kind`}
            >
              <option value="dayOfMonth">{t("monthly.kindDayOfMonth")}</option>
              <option value="nthWeekday">{t("monthly.kindNthWeekday")}</option>
            </select>
          </FormField>
          {monthlyKind === "dayOfMonth" ? (
            <FormField label={t("monthly.day")} htmlFor={`${prefix}-monthly-day`} className="w-24">
              <Input
                id={`${prefix}-monthly-day`}
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={monthlyDay}
                onChange={(event) => setMonthlyDay(event.target.value)}
                data-testid={`${prefix}-monthly-day`}
              />
            </FormField>
          ) : (
            <>
              <FormField
                label={t("monthly.nth")}
                htmlFor={`${prefix}-monthly-nth`}
                className="w-32"
              >
                <select
                  id={`${prefix}-monthly-nth`}
                  value={monthlyNth}
                  onChange={(event) => setMonthlyNth(event.target.value)}
                  className={selectClass}
                  data-testid={`${prefix}-monthly-nth`}
                >
                  {["1", "2", "3", "4"].map((value) => (
                    <option key={value} value={value}>
                      {value}.
                    </option>
                  ))}
                  <option value="-1">{t("monthly.nthLast")}</option>
                </select>
              </FormField>
              <FormField
                label={t("monthly.weekday")}
                htmlFor={`${prefix}-monthly-weekday`}
                className="w-36"
              >
                <select
                  id={`${prefix}-monthly-weekday`}
                  value={monthlyWeekday}
                  onChange={(event) => setMonthlyWeekday(event.target.value)}
                  className={selectClass}
                  data-testid={`${prefix}-monthly-weekday`}
                >
                  {ISO_WEEKDAYS.map((day) => (
                    <option key={day} value={String(day)}>
                      {weekdayName(day)}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={draft.monthlyRules.length >= MAX_MONTHLY_RULES}
            onClick={() => addMonthlyRule(monthlyFromBuilder())}
            data-testid={`${prefix}-monthly-add`}
          >
            <PlusIcon aria-hidden />
            {t("monthly.add")}
          </Button>
        </div>
        {draft.monthlyRules.length >= MAX_MONTHLY_RULES ? (
          <p className="text-sm text-muted-foreground">
            {t("monthly.limit", { max: MAX_MONTHLY_RULES })}
          </p>
        ) : null}
      </fieldset>

      {draft.weekdays.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium">{t("dayItems.label")}</legend>
          <p className="text-sm text-muted-foreground">{t("dayItems.hint")}</p>
          <div className="flex flex-col gap-2">
            {draft.weekdays.map((day) => {
              const own = draft.dayItems[day];
              const expanded = openDays[day] ?? false;
              return (
                <div
                  key={day}
                  className="rounded-md border border-input"
                  data-testid={`${prefix}-day-card-${day}`}
                >
                  <div className="flex flex-wrap items-center gap-2 p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      aria-controls={expanded ? `${prefix}-day-panel-${day}` : undefined}
                      onClick={() =>
                        setOpenDays((open) => ({ ...open, [day]: !(open[day] ?? false) }))
                      }
                      data-testid={`${prefix}-day-toggle-${day}`}
                    >
                      <ChevronDownIcon
                        className={cn(
                          "size-4 transition-transform motion-reduce:transition-none",
                          expanded && "rotate-180",
                        )}
                        aria-hidden
                      />
                      {weekdayName(day)}
                    </Button>
                    <Badge
                      variant={own ? "info" : "secondary"}
                      data-testid={`${prefix}-day-state-${day}`}
                      data-state={own ? "own" : "base"}
                    >
                      {own ? t("dayItems.ownCount", { count: own.length }) : t("dayItems.likeBase")}
                    </Badge>
                    <span className="ms-auto">
                      {own ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => resetDayItems(day)}
                          data-testid={`${prefix}-day-reset-${day}`}
                        >
                          {t("dayItems.reset")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => ownRows(day)}
                          data-testid={`${prefix}-day-own-${day}`}
                        >
                          {t("dayItems.own")}
                        </Button>
                      )}
                    </span>
                  </div>
                  {expanded ? (
                    <div
                      id={`${prefix}-day-panel-${day}`}
                      className="flex flex-col gap-2 border-t border-input p-2"
                    >
                      <p className="text-sm text-muted-foreground">
                        {own
                          ? t("dayItems.forDay", { weekday: weekdayName(day) })
                          : t("dayItems.hint")}
                      </p>
                      {own ? (
                        <LineEditor
                          rows={own}
                          products={products}
                          testIdBase={`${prefix}-day-line-${day}`}
                          onChange={(rows) => setDayRows(day, rows)}
                          translate={t}
                        />
                      ) : (
                        <ul
                          className="flex flex-col gap-0.5 text-base"
                          data-testid={`${prefix}-day-base-${day}`}
                        >
                          {baseItemsOf(draft).map((item) => {
                            const product = productById.get(item.productId);
                            return (
                              <li key={item.productId} className="tabular-nums">
                                {fmt.quantity(item.quantity)}{" "}
                                {product ? tu(product.unit, { count: item.quantity }) : ""}{" "}
                                {product?.label ?? ""}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="rounded-md border border-input">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-between"
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? `${prefix}-more-options-panel` : undefined}
          onClick={() => setMoreOpen((open) => !open)}
          data-testid={`${prefix}-more-options`}
        >
          <span>{t("moreOptions")}</span>
          <ChevronDownIcon
            className={cn(
              "size-5 transition-transform motion-reduce:transition-none",
              moreOpen && "rotate-180",
            )}
            aria-hidden
          />
        </Button>
        {moreOpen ? (
          <div
            id={`${prefix}-more-options-panel`}
            className="flex flex-col gap-5 border-t border-input p-3"
            data-testid={`${prefix}-more-options-panel`}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="flex items-center gap-2 text-base font-medium">
                {t("window.label")}
                <InfoTip>{t("window.hint")}</InfoTip>
              </legend>
              <div className="flex flex-wrap items-end gap-2">
                <FormField label={t("window.from")} htmlFor={`${prefix}-window-from`}>
                  <Input
                    id={`${prefix}-window-from`}
                    type="time"
                    value={draft.windowFrom}
                    onChange={(event) => onChange({ windowFrom: event.target.value })}
                    className="w-36"
                    data-testid={`${prefix}-window-from`}
                  />
                </FormField>
                <FormField label={t("window.to")} htmlFor={`${prefix}-window-to`}>
                  <Input
                    id={`${prefix}-window-to`}
                    type="time"
                    value={draft.windowTo}
                    onChange={(event) => onChange({ windowTo: event.target.value })}
                    className="w-36"
                    data-testid={`${prefix}-window-to`}
                  />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-base font-medium">{t("season.label")}</legend>
              <label className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="size-5 accent-foreground"
                  checked={draft.season}
                  onChange={(event) => onChange({ season: event.target.checked })}
                  data-testid={`${prefix}-season`}
                />
                {t("season.only")}
              </label>
              {draft.season ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {monthDayFields(`${prefix}-season-from`, draft.seasonFrom, (seasonFrom) =>
                    onChange({ seasonFrom }),
                  )}
                  <span className="text-base">{t("season.to")}</span>
                  {monthDayFields(`${prefix}-season-to`, draft.seasonTo, (seasonTo) =>
                    onChange({ seasonTo }),
                  )}
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">{t("season.hint")}</p>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-base font-medium">{t("end.label")}</legend>
              <SegmentedControl
                value={draft.endMode}
                onValueChange={(value) => {
                  // The three choices are exclusive (decision NUD-171): switching clears the other.
                  const endMode = value as RuleEndMode;
                  onChange({
                    endMode,
                    endsOn: endMode === "date" ? draft.endsOn : "",
                    maxDeliveries: endMode === "count" ? draft.maxDeliveries : "",
                  });
                }}
                options={[
                  { value: "open", label: t("end.open"), testId: `${prefix}-end-open` },
                  { value: "date", label: t("end.date"), testId: `${prefix}-end-date` },
                  { value: "count", label: t("end.count"), testId: `${prefix}-end-count` },
                ]}
                ariaLabel={t("end.label")}
                size="md"
              />
              {draft.endMode === "date" ? (
                <FormField label={t("end.endsOn")} htmlFor={`${prefix}-ends-on`}>
                  <Input
                    id={`${prefix}-ends-on`}
                    type="date"
                    value={draft.endsOn}
                    onChange={(event) => onChange({ endsOn: event.target.value })}
                    data-testid={`${prefix}-ends-on`}
                  />
                </FormField>
              ) : null}
              {draft.endMode === "count" ? (
                <FormField
                  label={t("end.maxDeliveries")}
                  htmlFor={`${prefix}-max-deliveries`}
                  info={t("end.countHint")}
                >
                  <Input
                    id={`${prefix}-max-deliveries`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_MAX_DELIVERIES}
                    step={1}
                    value={draft.maxDeliveries}
                    onChange={(event) => onChange({ maxDeliveries: event.target.value })}
                    data-testid={`${prefix}-max-deliveries`}
                  />
                </FormField>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-base font-medium">{t("exceptions.label")}</legend>
              <p className="text-sm text-muted-foreground">{t("exceptions.hint")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid={`${prefix}-exceptions-open`}
                    >
                      <CalendarDaysIcon aria-hidden />
                      {t("exceptions.open")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div
                      className="flex flex-col gap-3 p-3"
                      data-testid={`${prefix}-exceptions-popover`}
                    >
                      <Calendar
                        mode="multiple"
                        selected={exceptionDates}
                        defaultMonth={anchorDate ? toPickerDay(anchorDate) : undefined}
                        locale={DAY_PICKER_LOCALES[locale] ?? DAY_PICKER_LOCALES.de}
                        onSelect={(dates) =>
                          onChange({
                            exceptions: (dates ?? []).map(fromPickerDay).sort(),
                          })
                        }
                        components={components}
                      />
                      <div className="flex flex-col gap-2 border-t border-input pt-3">
                        <p className="text-base font-medium">{t("exceptions.range")}</p>
                        <div className="flex flex-wrap items-end gap-2">
                          <FormField label={t("exceptions.from")} htmlFor={`${prefix}-skip-from`}>
                            <Input
                              id={`${prefix}-skip-from`}
                              type="date"
                              value={draft.skipFrom}
                              onChange={(event) => onChange({ skipFrom: event.target.value })}
                              className="w-auto"
                              data-testid={`${prefix}-skip-from`}
                            />
                          </FormField>
                          <FormField label={t("exceptions.to")} htmlFor={`${prefix}-skip-to`}>
                            <Input
                              id={`${prefix}-skip-to`}
                              type="date"
                              value={draft.skipTo}
                              onChange={(event) => onChange({ skipTo: event.target.value })}
                              className="w-auto"
                              data-testid={`${prefix}-skip-to`}
                            />
                          </FormField>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                {draft.skipFrom && draft.skipTo ? (
                  <Badge variant="secondary" className="gap-1" data-testid={`${prefix}-skip-range`}>
                    {t("exceptions.skip", {
                      from: dayText(draft.skipFrom),
                      to: dayText(draft.skipTo),
                    })}
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("exceptions.clearRange")}
                      onClick={() => onChange({ skipFrom: "", skipTo: "" })}
                      data-testid={`${prefix}-skip-clear`}
                    >
                      <XIcon className="size-3.5" aria-hidden />
                    </button>
                  </Badge>
                ) : null}
              </div>
              {draft.exceptions.length > 0 ? (
                <ul className="flex flex-wrap gap-2" data-testid={`${prefix}-exceptions`}>
                  {draft.exceptions.map((day) => (
                    <li key={day}>
                      <Badge variant="secondary" className="gap-1">
                        {dayText(day)}
                        <button
                          type="button"
                          className="inline-flex size-6 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${t("exceptions.remove")}: ${dayText(day)}`}
                          onClick={() =>
                            onChange({
                              exceptions: draft.exceptions.filter((value) => value !== day),
                            })
                          }
                          data-testid={`${prefix}-exception-remove-${day}`}
                        >
                          <XIcon className="size-3.5" aria-hidden />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid={`${prefix}-exceptions-none`}
                >
                  {t("exceptions.none")}
                </p>
              )}
            </fieldset>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2" data-testid={`${prefix}-preview`}>
        <p className="text-base font-medium">{t("preview.label")}</p>
        <p className="text-sm text-muted-foreground">{t("preview.hint")}</p>
        {rows.length === 0 ? (
          <p className="text-base text-muted-foreground" data-testid={`${prefix}-preview-empty`}>
            {t("preview.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-base">
              <thead>
                <tr className="text-start text-sm text-muted-foreground">
                  <th scope="col" className="py-1 pe-3 text-start font-medium">
                    {t("preview.date")}
                  </th>
                  <th scope="col" className="py-1 text-start font-medium">
                    {t("preview.products")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={formatCalendarDate(row.date)}
                    className="border-t"
                    data-testid={`${prefix}-preview-row`}
                    data-date={formatCalendarDate(row.date)}
                  >
                    <td className="py-1.5 pe-3 whitespace-nowrap tabular-nums">
                      {fmt.calendarDate(row.date)}
                    </td>
                    <td className="py-1.5">
                      {row.items.length === 0
                        ? "–"
                        : row.items
                            .map((item) => {
                              const product = productById.get(item.productId);
                              return `${fmt.quantity(item.quantity)} ${
                                product ? tu(product.unit, { count: item.quantity }) : ""
                              } ${product?.label ?? ""}`.trim();
                            })
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
