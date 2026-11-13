"use client";

import * as m from "motion/react-m";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

import { LayoutThumb } from "@/components/motion/layout-thumb";
import { MotionProvider } from "@/components/motion/motion-provider";
import { cn } from "@/lib/utils";

/** The active tab and an id for the travelling highlight, shared between `Tabs` and its triggers. */
const TabsContext = React.createContext<{ value: string | undefined; thumbId: string } | null>(
  null,
);

/**
 * Tabs (redesign RD2, DESIGN.md). Radix `Tabs` keeps the roving focus and the `tab`/`tabpanel`
 * wiring; the active tab is marked by the surface *and* the text weight, not by colour alone. Driver
 * screens use `SegmentedControl` instead (48 px targets): tabs stay the admin pattern.
 *
 * The white highlight behind the active tab is one element that travels from the old tab to the new
 * one (motion rules 9 and 20), and the new panel fades in over the old one (rule 16).
 */
function Tabs({
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const thumbId = React.useId();
  const [inner, setInner] = React.useState(defaultValue);
  const context = React.useMemo(
    () => ({ value: value ?? inner, thumbId }),
    [value, inner, thumbId],
  );
  return (
    <MotionProvider>
      <TabsContext.Provider value={context}>
        <TabsPrimitive.Root
          data-slot="tabs"
          value={value}
          defaultValue={defaultValue}
          onValueChange={(next) => {
            setInner(next);
            onValueChange?.(next);
          }}
          className={cn("flex flex-col gap-3", className)}
          {...props}
        />
      </TabsContext.Provider>
    </MotionProvider>
  );
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      asChild
      data-slot="tabs-list"
      className={cn(
        "isolate inline-flex h-10 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {/*
       * `layoutRoot`: the highlight travels relative to the list, wherever the list itself is. The
       * list is a layout node that snaps (duration 0), so only the highlight is animated.
       */}
      <m.div layout layoutRoot transition={{ layout: { duration: 0 } }}>
        {children}
      </m.div>
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const context = React.useContext(TabsContext);
  const active = context !== null && context.value === value;
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-base font-medium whitespace-nowrap outline-none transition-colors duration-200 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none data-[state=active]:font-semibold data-[state=active]:text-foreground",
        // Without a surrounding `Tabs` there is no travelling highlight: fall back to a plain fill.
        context === null && "data-[state=active]:bg-card data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    >
      {active ? (
        <LayoutThumb
          layoutId={context.thumbId}
          data-slot="tabs-thumb"
          className="rounded-md bg-card shadow-sm"
        />
      ) : null}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 outline-none data-[state=active]:animate-in data-[state=active]:duration-200 data-[state=active]:ease-out data-[state=active]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
