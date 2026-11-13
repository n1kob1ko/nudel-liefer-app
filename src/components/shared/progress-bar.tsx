import { cn } from "@/lib/utils";

import type { Tone } from "./status";

/** One slice of a segmented bar: how many stops it covers and which status colour it carries. */
export type ProgressSegment = { value: number; tone: Tone };

type ProgressBarBaseProps = {
  total: number;
  label: string;
  /** Screen-reader text with the numbers, so the colour is never the only carrier of meaning. */
  valueText?: string;
  className?: string;
};

/**
 * Either the segmented API (`segments`) or the simple delivered/problems pair of the original
 * component. Both stay supported so existing callers compile unchanged.
 */
type ProgressBarProps = ProgressBarBaseProps &
  (
    | {
        /** Shows delivered (success) + problems (destructive) + open (muted/primary) in one bar. */
        segments: ProgressSegment[];
        delivered?: never;
        problems?: never;
      }
    | {
        segments?: never;
        delivered: number;
        problems: number;
      }
  );

const segmentTone: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

/**
 * Segmented progress bar for a tour. The colours are redundant on purpose: the caller always prints
 * the numbers next to the bar and `aria-valuetext` carries them for screen readers.
 */
export function ProgressBar(props: ProgressBarProps) {
  const { total, label, valueText, className } = props;
  const { segments } = props;
  const resolved: ProgressSegment[] = segments ?? [
    { value: props.delivered, tone: "success" },
    { value: props.problems, tone: "destructive" },
  ];
  const done = resolved.reduce((sum, segment) => sum + segment.value, 0);
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={valueText}
      className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}
      data-testid="progress-bar"
    >
      {resolved.map((segment, index) =>
        segment.value > 0 ? (
          <div
            key={index}
            data-tone={segment.tone}
            className={cn("h-full", segmentTone[segment.tone])}
            style={{ width: `${pct(segment.value)}%` }}
          />
        ) : null,
      )}
    </div>
  );
}
