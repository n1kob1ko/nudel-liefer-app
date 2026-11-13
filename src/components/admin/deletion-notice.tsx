import { CalendarClockIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * "This is deleted by itself on that day" (NUD-201). The pages show it only while deleting is
 * switched on (`orderRetentionPolicy`). Quiet on purpose: it is a fact to know, not an alarm, and
 * it never goes on paper.
 */
export function DeletionNotice({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      role="note"
      data-testid={testId}
      className={cn(
        "flex max-w-prose items-start gap-2 text-sm text-muted-foreground print:hidden",
        className,
      )}
    >
      <CalendarClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
