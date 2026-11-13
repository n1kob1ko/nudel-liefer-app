"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A hint behind a small "i": the explanation is one tap away instead of standing on the page.
 *
 * The rule for the office (DESIGN.md, "Words"): a screen shows what to do, not how the app works.
 * Whatever is worth knowing once goes here. It is a popover and not a hover tooltip, so it opens by
 * tap on a tablet and by Enter or Space from the keyboard, and stays open until dismissed.
 *
 * The button is 24 px to the eye and 40 px to the finger (the invisible ring around it).
 */
export function InfoTip({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("common");
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={t("info")}
        data-testid={testId}
        className={cn(
          "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none transition-colors duration-150 ease-out before:absolute before:-inset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground motion-reduce:transition-none",
          className,
        )}
      >
        <InfoIcon className="size-4.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-sm leading-relaxed text-pretty">
        {children}
      </PopoverContent>
    </Popover>
  );
}
