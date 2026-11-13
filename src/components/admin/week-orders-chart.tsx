import { cn } from "@/lib/utils";

export type WeekOrdersDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Short weekday shown under the bar ("Mo"). */
  label: string;
  /** Tooltip / table text for the day ("Mo, 26.10.: 18 Bestellungen"). */
  description: string;
  count: number;
  when: "past" | "today" | "upcoming";
};

/**
 * Dashboard "Bestellungen diese Woche" (colour refresh 2026-10): one bar per day of the current week,
 * the count of confirmed orders, today in the brand colour. One series, so no legend box for colour
 * identity — the legend only names the three day states, and every bar carries its number as a
 * tooltip (hover and keyboard focus) plus a visually hidden table for screen readers.
 *
 * Pure presentation; the page computes the days from the existing `getDateTotals` read model.
 */
export function WeekOrdersChart({
  days,
  labels,
}: {
  days: WeekOrdersDay[];
  labels: {
    today: string;
    past: string;
    upcoming: string;
    table: string;
    day: string;
    orders: string;
  };
}) {
  const max = Math.max(1, ...days.map((day) => day.count));

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-hidden
        className="grid h-56 items-end gap-2 pt-8 sm:gap-3"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((day) => {
          // A day without orders keeps a short stub, so the week still reads as seven slots.
          const height = day.count === 0 ? 6 : Math.max(12, Math.round((day.count / max) * 100));
          return (
            <div
              key={day.date}
              className="group relative flex h-full flex-col items-center justify-end"
            >
              <span
                className={cn(
                  "pointer-events-none absolute z-10 rounded-md bg-foreground px-2 py-1 text-xs font-semibold whitespace-nowrap text-background tabular-nums shadow-md transition-opacity",
                  day.when === "today" ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{ bottom: `calc(${height}% + 0.5rem)` }}
              >
                {day.count}
              </span>
              <div
                title={day.description}
                data-testid="week-bar"
                data-when={day.when}
                className={cn(
                  "w-full max-w-14 rounded-full transition-[filter] group-hover:brightness-95",
                  day.when === "today" && "bg-primary",
                  day.when === "past" && "bg-foreground/25 dark:bg-foreground/35",
                  day.when === "upcoming" && "bg-hatch",
                )}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div
        aria-hidden
        className="grid gap-2 text-center text-sm text-muted-foreground sm:gap-3"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((day) => (
          <span
            key={day.date}
            className={cn(day.when === "today" && "font-semibold text-foreground")}
          >
            {day.label}
          </span>
        ))}
      </div>
      <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <LegendSwatch className="bg-foreground/25 dark:bg-foreground/35" label={labels.past} />
        <LegendSwatch className="bg-primary" label={labels.today} />
        <LegendSwatch className="bg-hatch" label={labels.upcoming} />
      </div>
      <table className="sr-only">
        <caption>{labels.table}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.day}</th>
            <th scope="col">{labels.orders}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.description}</th>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[3px]", className)} />
      {label}
    </span>
  );
}
