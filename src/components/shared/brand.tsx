import { RouteIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The app mark: a route in ink on a yolk tile, plus the wordmark. One component, so the start page,
 * both logins and the office menu show the same thing. Pure CSS and an icon, no image file.
 *
 * `as="h1"` is for the start page, where the name is the page title.
 */
export function Brand({
  as: Tag = "p",
  size = "md",
  className,
  ...props
}: {
  as?: "p" | "h1" | "span";
  size?: "sm" | "md";
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <Tag
      className={cn(
        "flex items-center gap-2.5 font-semibold tracking-tight text-foreground",
        size === "sm" ? "text-lg" : "text-xl",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        data-testid="brand-mark"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
          size === "sm" ? "size-7" : "size-9",
        )}
      >
        <RouteIcon className={size === "sm" ? "size-4" : "size-5"} />
      </span>
      <span className="truncate">Routenplanner</span>
    </Tag>
  );
}
