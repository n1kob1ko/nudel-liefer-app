"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { DayPicker } from "react-day-picker";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      className={cn("p-3", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex flex-col gap-4",
        month: "flex flex-col gap-3",
        month_caption: "flex h-10 items-center justify-center px-12",
        caption_label: "text-base font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(buttonVariants({ variant: "outline", size: "icon" }), "size-10"),
        button_next: cn(buttonVariants({ variant: "outline", size: "icon" }), "size-10"),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-10 text-center text-sm font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative size-10 p-0 text-center text-base",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-10 font-normal aria-selected:opacity-100",
        ),
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
        today: "[&>button]:border [&>button]:border-foreground [&>button]:font-semibold",
        outside: "text-muted-foreground opacity-70",
        disabled: "text-muted-foreground opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? (
            <ChevronLeftIcon className={cn("size-5 rtl:rotate-180", chevronClass)} aria-hidden />
          ) : (
            <ChevronRightIcon className={cn("size-5 rtl:rotate-180", chevronClass)} aria-hidden />
          ),
        // A caller may replace single parts (e.g. `DayButton` to add test ids); the chevron stays.
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
