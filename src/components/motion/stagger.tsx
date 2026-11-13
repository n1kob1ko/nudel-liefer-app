import { Children, cloneElement, type CSSProperties, isValidElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Rows beyond this index arrive together with it: a long list must not keep the reader waiting. */
export const STAGGER_MAX = 12;

/**
 * Lets the rows of a list arrive 30 ms apart (motion rule 3). It is plain CSS: every direct child
 * gets its index as `--i` and the `stagger-item` utility, which delays one shared entrance by
 * `--i * 30ms`. Works in server components. Reduced motion collapses it (globals.css).
 *
 * Use it for a list that appears as a whole (a page, a tab panel, a sheet). Do not use it for rows
 * that are added one by one later, and not for lists the user sees dozens of times a minute.
 */
export function Stagger({
  as: Tag = "div",
  children,
  className,
  max = STAGGER_MAX,
  ...props
}: {
  as?: "div" | "ul" | "ol" | "section" | "tbody";
  children: ReactNode;
  className?: string;
  max?: number;
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  let index = 0;
  return (
    <Tag className={className} {...props}>
      {Children.map(children, (child) => {
        if (!isValidElement<{ className?: string; style?: CSSProperties }>(child)) return child;
        const i = Math.min(index++, max - 1);
        return cloneElement(child, {
          className: cn("stagger-item", child.props.className),
          style: { ...child.props.style, "--i": i } as CSSProperties,
        });
      })}
    </Tag>
  );
}
