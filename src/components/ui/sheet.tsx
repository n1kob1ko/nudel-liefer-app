"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

import { useSheetDrag } from "@/components/motion/use-sheet-drag";
import { cn } from "@/lib/utils";

/**
 * Sheet / Drawer (redesign RD-2, re-design.md §5/§7.3).
 *
 * Radix `Dialog` under the hood, so the focus trap, `Esc` to close and returning focus to the
 * trigger are handled for us; a `SheetTitle` is still required for the accessible name. `side`
 * keeps the driver's bottom sheet (drag handle, 20 px top radius, safe-area padding) and the admin
 * right drawer apart.
 *
 * A bottom sheet can be swiped away by its handle (redesign RD2): it follows the finger, resists
 * being pulled up, and closes after a long drag or a quick flick. Esc and the close button stay.
 */
function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * How far the on-screen keyboard covers the bottom of the layout viewport. iOS Safari keeps fixed
 * elements where they were when the keyboard opens, so a bottom sheet with a text field would sit
 * behind it. `bottom` lifts the sheet above the keyboard, `height` is the room that is left.
 */
function useKeyboardInset(enabled: boolean): { bottom: number; height: number } | null {
  const [inset, setInset] = React.useState<{ bottom: number; height: number } | null>(null);
  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const update = () => {
      const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      // Browser toolbars change the visual viewport by a few dozen pixels: only a keyboard counts.
      setInset(bottom > 120 ? { bottom, height: viewport.height } : null);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return inset;
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
}) {
  const t = useTranslations("common.actions");
  const keyboard = useKeyboardInset(side === "bottom");
  const contentRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const dragHandlers = useSheetDrag(
    () => contentRef.current,
    () => closeRef.current?.click(),
  );
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="overlay-fade fixed inset-0 z-50 bg-black/55"
      />
      <SheetPrimitive.Content
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card text-card-foreground shadow-lg",
          side === "right" &&
            "sheet-x inset-y-0 end-0 h-full w-3/4 rounded-s-xl border-s sm:max-w-md",
          side === "left" &&
            "sheet-x inset-y-0 start-0 h-full w-3/4 rounded-e-xl border-e [--sheet-enter:-100%] sm:max-w-md",
          side === "top" &&
            "sheet-y inset-x-0 top-0 h-auto rounded-b-xl border-b [--sheet-enter:-100%]",
          side === "bottom" &&
            "sheet-y inset-x-0 bottom-0 h-auto max-h-[92dvh] rounded-t-xl border-t pb-[max(1rem,env(safe-area-inset-bottom))]",
          className,
        )}
        {...props}
        style={
          keyboard
            ? { ...props.style, bottom: keyboard.bottom, maxHeight: keyboard.height * 0.92 }
            : props.style
        }
      >
        {side === "bottom" ? (
          // Drag handle: swipe down to close. A pointer-only extra, so it is hidden from assistive
          // technology; Esc and the close button close the sheet for everyone. The grab area is the
          // full width and 28 px high, much bigger than the visible bar.
          <div
            data-slot="sheet-drag-area"
            aria-hidden
            className="-mb-3 flex shrink-0 cursor-grab touch-none justify-center pt-2 pb-3.5 active:cursor-grabbing"
            {...dragHandlers}
          >
            <div
              data-slot="sheet-drag-handle"
              className="h-1.5 w-12 rounded-full bg-muted-foreground/40"
            />
          </div>
        ) : null}
        {children}
        <SheetPrimitive.Close
          ref={closeRef}
          className="absolute end-2 top-2 flex size-12 items-center justify-center rounded-md outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[.94] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <XIcon className="size-5" aria-hidden />
          <span className="sr-only">{t("close")}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-base text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
