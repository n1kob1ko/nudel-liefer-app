"use client";

import { ClipboardPlusIcon, type LucideIcon, SearchIcon, UserPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";

import { ADMIN_NAV } from "./nav-items";

/** What gets created most often in the office: reachable from every page without the mouse. */
const CREATE: ReadonlyArray<{ id: "newOrder" | "newCustomer"; href: string; icon: LucideIcon }> = [
  { id: "newOrder", href: "/admin/orders/new", icon: ClipboardPlusIcon },
  { id: "newCustomer", href: "/admin/customers/new", icon: UserPlusIcon },
];

/**
 * Command menu of the office (redesign RD2, step 6): Ctrl+K or ⌘K opens a list of every section
 * and the two things that get created most; typing narrows it, Enter goes there.
 *
 * It is opened from the keyboard, many times a day, so it appears and disappears without motion
 * (DESIGN.md, "frequency decides"). The button in the top bar is the visible way in and shows the
 * shortcut; below `lg` (tablets and phones, no keyboard) the button is hidden, the shortcut still works.
 */
export function AdminCommandMenu() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 font-normal text-muted-foreground max-lg:hidden"
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="command-open"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden />
        {t("shell.command.open")}
        <kbd
          aria-hidden
          className="rounded border border-border bg-muted px-1.5 font-sans text-xs text-muted-foreground"
        >
          {t("shell.command.shortcut")}
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="command-menu"
          // No motion (see above), no close button (Esc and a click outside close it), and a place
          // in the upper third so the list grows downwards without moving the field.
          className="top-[16%] translate-y-0 gap-0 overflow-hidden p-0 data-[state=closed]:animate-none! data-[state=open]:animate-none! [&>*]:animate-none! [&>button]:hidden"
        >
          <DialogTitle className="sr-only">{t("shell.command.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("shell.command.description")}</DialogDescription>
          <Command className="rounded-xl bg-card">
            <CommandInput placeholder={t("shell.command.placeholder")} />
            <CommandList className="max-h-[min(24rem,60dvh)]">
              <CommandEmpty>{t("shell.command.empty")}</CommandEmpty>
              <CommandGroup heading={t("shell.command.create")}>
                {CREATE.map(({ id, href, icon: Icon }) => (
                  <CommandItem key={id} value={t(`shell.command.${id}`)} onSelect={() => go(href)}>
                    <Icon aria-hidden />
                    {t(`shell.command.${id}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={t("shell.command.pages")}>
                {ADMIN_NAV.map(({ section, href, icon: Icon }) => (
                  <CommandItem key={section} value={t(`nav.${section}`)} onSelect={() => go(href)}>
                    <Icon aria-hidden />
                    {t(`nav.${section}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
