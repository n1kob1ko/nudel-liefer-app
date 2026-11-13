import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Circular progress for the driver home header ("3/20"). The filled part uses the brand colour and
 * the track the muted token, but the count is also written in the middle and exposed as the
 * accessible name, so the ring never carries the information through colour alone.
 */
export function ProgressRing({
  value,
  max,
  size = 56,
  label,
  className,
  "data-testid": testId,
}: {
  value: number;
  max: number;
  size?: number;
  label?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const ratio = clamped / safeMax;
  const stroke = Math.max(4, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const text = `${clamped}/${max}`;

  return (
    <div
      role="img"
      aria-label={typeof label === "string" ? label : text}
      data-testid={testId}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="stroke-success transition-[stroke-dashoffset] duration-500 ease-in-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-semibold tabular-nums">
        {label ?? text}
      </span>
    </div>
  );
}
