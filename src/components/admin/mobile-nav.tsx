"use client";

import { EllipsisIcon, MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AdminNav } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Sidebar as an off-canvas drawer below the rail breakpoint (re-design.md §8.1: the 260 px sidebar
 * needs the room, so **≤ 1024 px** the navigation moves behind a hamburger). Radix `Dialog` provides
 * the focus trap and closes on `Esc`; the test ids stay as in the specs (`open-menu`, `admin-nav`).
 *
 * `min-[1025px]:hidden` pairs with the `min-[1025px]:flex` of the rail in `admin-shell.tsx` — `lg`
 * starts at exactly 1024 px and would hide the hamburger while the rail was still a drawer.
 *
 * NUD-153: the trigger and the drawer rows are 48 px touch targets — this is the whole navigation of
 * a tablet and a phone, and there is no mouse at hand.
 *
 * `variant="tab"`: the same drawer opened from the "Mehr" slot of the bottom navigation
 * (`AdminBottomNav`), for the sections that have no tab of their own.
 */
export function MobileNav({ variant = "header" }: { variant?: "header" | "tab" }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {variant === "tab" ? (
          <button
            type="button"
            data-testid="open-menu-tab"
            className="flex min-h-12 flex-auto flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <EllipsisIcon className="size-5" aria-hidden />
            {t("admin.shell.more")}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-12 min-[1025px]:hidden"
            data-testid="open-menu"
            aria-label={t("admin.shell.openMenu")}
          >
            <MenuIcon aria-hidden />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined} className="w-64 max-w-[80vw]">
        <SheetHeader>
          <SheetTitle>{t("common.appName")}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <AdminNav onNavigate={() => setOpen(false)} touch />
        </div>
      </SheetContent>
    </Sheet>
  );
}
