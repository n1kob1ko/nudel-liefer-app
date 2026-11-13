import { cn } from "@/lib/utils";

/** Half circle from the left to the right end; `pathLength` makes the dash maths percentages. */
const ARC = "M 20 100 A 80 80 0 0 1 180 100";
/** Surface gap between two segments, in `pathLength` units. */
const GAP = 1.2;

/**
 * Half-circle progress of today's tour (colour refresh 2026-10): delivered (success), problems
 * (destructive) and open (hatched track) in tour order. The numbers sit in the middle and in the legend,
 * so the colours are never the only carrier of meaning; the SVG itself is `role="img"` with the
 * same sentence as its name.
 */
export function TourGauge({
  delivered,
  problems,
  total,
  percent,
  labels,
}: {
  delivered: number;
  problems: number;
  total: number;
  percent: number;
  labels: { summary: string; center: string; delivered: string; problems: string; open: string };
}) {
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const deliveredLen = share(delivered);
  const problemLen = share(problems);
  const segments = [
    { key: "delivered", start: 0, length: deliveredLen, className: "stroke-success" },
    { key: "problems", start: deliveredLen, length: problemLen, className: "stroke-destructive" },
  ].filter((segment) => segment.length > 0);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-64">
        <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={labels.summary}>
          <defs>
            <pattern
              id="tour-gauge-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" className="fill-muted" />
              <rect width="2" height="6" className="fill-input" />
            </pattern>
          </defs>
          <path
            d={ARC}
            fill="none"
            stroke="url(#tour-gauge-hatch)"
            strokeWidth="24"
            pathLength={100}
          />
          {segments.map((segment, index) => {
            // Each segment after the first starts one gap later, so neighbours never touch.
            const start = segment.start + (index > 0 ? GAP / 2 : 0);
            const length = Math.max(0, segment.length - (index > 0 ? GAP / 2 : 0) - GAP / 2);
            return (
              <path
                key={segment.key}
                d={ARC}
                fill="none"
                strokeWidth="24"
                pathLength={100}
                strokeDasharray={`0 ${start} ${length} 200`}
                className={cn(segment.className, "transition-[stroke-dasharray] duration-500")}
              />
            );
          })}
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-4xl leading-none font-semibold tracking-tight tabular-nums">
            {percent} %
          </span>
          <span className="text-sm text-muted-foreground">{labels.center}</span>
        </div>
      </div>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-success" />
          {labels.delivered}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-destructive" />
          {labels.problems}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-hatch" />
          {labels.open}
        </li>
      </ul>
    </div>
  );
}
