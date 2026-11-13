import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Table (redesign RD-2, re-design.md §5/§8.10).
 *
 * A real `<table>` for accessibility. Row height is 48 px by default and `density="compact"` (40 px)
 * is available for dense admin tables. Zebra striping is off; rows are separated by hairlines and
 * highlighted on hover. Numeric cells get `tabular-nums` through the exported `numericCell` helper.
 * `TableHeader` accepts `sticky` so a long table keeps its header while the page scrolls.
 */
function Table({
  className,
  density = "default",
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  density?: "default" | "compact";
  /** Class name for the scroll container, e.g. to cap the height of a sticky-header table. */
  containerClassName?: string;
}) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        data-density={density}
        className={cn("group/table w-full caption-bottom text-base", className)}
        {...props}
      />
    </div>
  );
}

/**
 * Sticky header: pass `data-sticky` (a React boolean prop, so no unknown-attribute warning) or add
 * `sticky top-0 z-10` yourself. `data-sticky` is the shorthand.
 */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b",
        "data-[sticky]:sticky data-[sticky]:top-0 data-[sticky]:z-10 data-[sticky]:bg-muted data-[sticky]:[&_th]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // 48 px rows; `density="compact"` on Table takes them to 40 px (re-design.md §8.10).
        "h-12 border-b transition-colors duration-150 ease-out hover:bg-muted/60 motion-reduce:transition-none data-[state=selected]:bg-muted group-data-[density=compact]/table:h-10",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-11 px-3 text-start align-middle text-sm font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("p-3 align-middle", className)} {...props} />;
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Cell helper: right-aligns and tabularizes a numeric column (re-design.md §8.10). */
const numericCell = "text-end tabular-nums";

export {
  numericCell,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
