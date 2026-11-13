"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon, RouteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useSyncExternalStore, ViewTransition } from "react";

import { AdminBottomNav } from "@/components/admin/admin-bottom-nav";
import { AdminCommandMenu } from "@/components/admin/admin-command-menu";
import { AdminNav } from "@/components/admin/admin-nav";
import { MobileNav } from "@/components/admin/mobile-nav";
import { activeNavItem } from "@/components/admin/nav-items";
import { UserMenu } from "@/components/admin/user-menu";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** `localStorage` key of the desktop sidebar state (re-design.md §8.1). */
const COLLAPSE_KEY = "nudel.admin.sidebar.collapsed";

/**
 * Sidebar rail state as an external store: `localStorage` is the source of truth, so the value
 * survives reloads and other tabs, and the first client render after hydration picks it up without
 * a state-syncing effect (which would cascade renders).
 */
const collapseListeners = new Set<() => void>();

function subscribeCollapse(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function collapsedSnapshot(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false; // Private mode / storage disabled: the sidebar stays expanded.
  }
}

function setCollapsedStored(next: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Storage unavailable: the rail still collapses for this page view.
  }
  for (const listener of collapseListeners) listener();
}

/**
 * Admin chrome (re-design.md §8.1): 260 px sidebar (collapsible to a 72 px icon rail, state in
 * `localStorage`, off-canvas drawer ≤ 1024 px), 56 px top bar with breadcrumb, language select and
 * user menu, and a 1440 px content column. Keyboard: `/` focuses the page search, Ctrl+K or ⌘K opens
 * the command menu (`AdminCommandMenu`), the drawer closes with `Esc` (Radix).
 */
export function AdminShell({
  name,
  locale,
  children,
}: {
  name: string;
  locale: string;
  children: ReactNode;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapse, collapsedSnapshot, () => false);

  // `/` focuses the page search where one exists. Typing `/` in a field is left alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      const search = document.querySelector<HTMLElement>(
        "main [data-page-search], main input[type='search']",
      );
      if (!search) return;
      event.preventDefault();
      search.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleSidebar = () => setCollapsedStored(!collapsed);

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh bg-background" data-testid="admin-shell">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:start-2 focus:top-2"
        >
          {t("admin.shell.skipToContent")}
        </a>

        <aside
          data-collapsed={collapsed ? "" : undefined}
          // §8.1: the 260 px rail needs the room, so **≤ 1024 px** the navigation is the off-canvas
          // drawer behind the hamburger (`MobileNav`) — `min-[1025px]`, not `lg` (which starts at
          // exactly 1024 px and left the rail expanded at the 1024 px review width).
          // The aside itself stretches to the full page height (its surface and border run to the
          // bottom of a long page); the inner column is sticky, so the navigation stays in view.
          className={cn(
            "hidden shrink-0 border-e border-border bg-card min-[1025px]:block",
            collapsed ? "w-[72px]" : "w-[260px]",
          )}
        >
          <div className="sticky top-0 flex h-dvh flex-col">
            <div
              className={cn(
                "flex h-14 shrink-0 items-center gap-2 px-3",
                collapsed && "justify-center px-0",
              )}
            >
              {/* The app symbol in small: a route in ink on yolk. */}
              <span
                aria-hidden
                data-testid="brand-mark"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              >
                <RouteIcon className="size-4" />
              </span>
              {collapsed ? null : (
                <span className="truncate text-lg font-semibold">{t("common.appName")}</span>
              )}
            </div>
            <div className="min-h-0 flex-1 px-2 py-2">
              <AdminNav collapsed={collapsed} />
            </div>
            <div
              className={cn(
                "shrink-0 border-t border-border p-2",
                collapsed && "flex justify-center",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid="toggle-sidebar"
                    aria-label={t(
                      collapsed ? "admin.shell.expandSidebar" : "admin.shell.collapseSidebar",
                    )}
                    aria-expanded={!collapsed}
                    onClick={toggleSidebar}
                  >
                    {collapsed ? (
                      <PanelLeftOpenIcon aria-hidden />
                    ) : (
                      <PanelLeftCloseIcon aria-hidden />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t(collapsed ? "admin.shell.expandSidebar" : "admin.shell.collapseSidebar")}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 lg:px-6">
            <MobileNav />
            <Breadcrumb pathname={pathname} />
            <div className="ms-auto flex items-center gap-2">
              <AdminCommandMenu />
              <ThemeToggle />
              <LanguageSwitcher variant="compact" />
              <UserMenu name={name} locale={locale} />
            </div>
          </header>
          <main id="main" className="min-w-0 flex-1">
            {/* Bottom padding below the rail breakpoint keeps the last row clear of the bottom bar. */}
            <div className="mx-auto w-full max-w-[1440px] px-6 pt-6 pb-28 lg:px-8 min-[1025px]:pb-6">
              {/* Page change (motion rule 16): the old page fades out while the new one fades in,
                  only the content, the menu and the top bar stay put. Keyed by the path, so a new
                  filter or date on the same page does not fade. `default="none"`: content that
                  loads or updates inside a page never triggers it. */}
              <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
                <div>{children}</div>
              </ViewTransition>
            </div>
          </main>
          <AdminBottomNav />
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Breadcrumb derived from the path only (re-design.md §8.1/§14.3) — no data fetching. */
function Breadcrumb({ pathname }: { pathname: string }) {
  const t = useTranslations("admin");
  const current = activeNavItem(pathname);
  const label = t(`nav.${current.section}`);
  return (
    <nav
      aria-label={t("shell.breadcrumb")}
      data-testid="admin-breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
    >
      {current.section === "dashboard" ? (
        <span className="truncate font-medium text-foreground">{label}</span>
      ) : (
        <>
          <Link
            href="/admin"
            className="truncate rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.dashboard")}
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate font-medium text-foreground">{label}</span>
        </>
      )}
    </nav>
  );
}
