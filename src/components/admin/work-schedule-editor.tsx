"use client";

import { ClockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatScheduleRuns,
  ISO_WEEKDAYS,
  minutesToTime,
  type ScheduleDay,
  summariseSchedule,
} from "@/domain/work-time";
import { cn } from "@/lib/utils";
import { saveWorkScheduleAction } from "@/server/work-schedule-actions";

/** One weekday row of the editor; `active = false` = the driver does not work that day. */
export type WorkScheduleRow = { weekday: number; active: boolean; start: string; end: string };

const DEFAULT_START = "06:00";
const DEFAULT_END = "14:00";

const WEEKDAY_REFERENCE = (weekday: number) => new Date(Date.UTC(2026, 0, 4 + weekday));

/** Monday first weekday names in the current language (CLDR, not a message file). */
function weekdayNames(locale: string): Record<number, string> {
  const names: Record<number, string> = {};
  for (const weekday of ISO_WEEKDAYS) {
    names[weekday] = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      timeZone: "UTC",
    }).format(WEEKDAY_REFERENCE(weekday));
  }
  return names;
}

/** The seven editor rows of a stored schedule; a weekday without a row starts inactive. */
export function toScheduleRows(days: readonly ScheduleDay[]): WorkScheduleRow[] {
  return ISO_WEEKDAYS.map((weekday) => {
    const day = days.find((entry) => entry.weekday === weekday);
    const active = day?.active === true;
    return {
      weekday,
      active,
      start: active ? minutesToTime(day!.startMinutes) : DEFAULT_START,
      end: active ? minutesToTime(day!.endMinutes) : DEFAULT_END,
    };
  });
}

/**
 * The "working time" cell of the driver list (NUD-152): the schedule as compact text, e.g.
 * "Mo–Fr 06:00–14:00" — consecutive weekdays with the same hours are one run.
 */
export function ScheduleSummary({ schedule }: { schedule: readonly ScheduleDay[] }) {
  const t = useTranslations("admin.drivers.schedule");
  const locale = useLocale();
  const names = weekdayNames(locale);
  const runs = summariseSchedule(schedule);
  if (runs.length === 0) return <span className="text-muted-foreground">{t("none")}</span>;
  return (
    <span className="text-sm" data-testid="driver-schedule">
      {formatScheduleRuns(runs, (weekday) => names[weekday] ?? String(weekday))}
    </span>
  );
}

/**
 * Working days and hours of one driver (NUD-152, D28): seven weekday rows with an on/off switch and
 * the shift hours. Saved through the admin-only server action; weekdays switched off stay stored as
 * `active = false` (soft delete), so the hours are not lost when the office turns the day back on.
 */
export function WorkScheduleDialog({
  driverId,
  driverName,
  days,
  open,
  onOpenChange,
}: {
  driverId: string;
  driverName: string;
  days: readonly ScheduleDay[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.drivers.schedule");
  const tc = useTranslations("common");
  const locale = useLocale();
  const names = weekdayNames(locale);
  const [rows, setRows] = useState<WorkScheduleRow[]>(() => toScheduleRows(days));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Closed: render nothing at all, so reopening the dialog starts from the stored schedule again
  // (the parent remounts this component per driver with a `key`).
  if (!open) return null;

  function update(weekday: number, patch: Partial<WorkScheduleRow>) {
    setRows((current) =>
      current.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)),
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const invalid = rows.some(
      (row) => row.active && !(row.start < row.end && row.start !== "" && row.end !== ""),
    );
    if (invalid) return setError(t("errors.hours"));
    startTransition(async () => {
      let result;
      try {
        result = await saveWorkScheduleAction({
          driverId,
          days: rows.map((row) => ({
            weekday: row.weekday,
            active: row.active,
            start: row.start,
            end: row.end,
          })),
        });
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) {
        return setError(
          result.error === "not_found" || result.error === "not_a_driver"
            ? t("errors.notFound")
            : t("errors.hours"),
        );
      }
      toast.success(t("saved", { name: driverName }));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="work-schedule-dialog">
        <DialogHeader>
          <DialogTitle>{t("title", { name: driverName })}</DialogTitle>
          <DialogDescription>{t("description", { name: driverName })}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.weekday}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <label className="flex min-w-28 items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    checked={row.active}
                    onChange={(event) => update(row.weekday, { active: event.target.checked })}
                    data-testid={`schedule-day-${row.weekday}`}
                    className="size-5 accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                  />
                  <span className={cn(row.active ? "font-medium" : "text-muted-foreground")}>
                    {names[row.weekday]}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label={t("startLabel", { weekday: names[row.weekday]! })}
                    value={row.start}
                    disabled={!row.active}
                    onChange={(event) => update(row.weekday, { start: event.target.value })}
                    className="w-32"
                    data-testid={`schedule-start-${row.weekday}`}
                  />
                  <span aria-hidden className="text-muted-foreground">
                    –
                  </span>
                  <Input
                    type="time"
                    aria-label={t("endLabel", { weekday: names[row.weekday]! })}
                    value={row.end}
                    disabled={!row.active}
                    onChange={(event) => update(row.weekday, { end: event.target.value })}
                    className="w-32"
                    data-testid={`schedule-end-${row.weekday}`}
                  />
                </div>
              </li>
            ))}
          </ul>
          {error ? (
            <p
              role="alert"
              className="text-base font-medium text-destructive"
              data-testid="schedule-error"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="schedule-save">
              <ClockIcon aria-hidden />
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
