"use client";

import * as m from "motion/react-m";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { LayoutThumb } from "@/components/motion/layout-thumb";
import { MotionProvider } from "@/components/motion/motion-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import { ADMIN_NAV_GROUPS, isNavActive, navItem } from "./nav-items";

/**
 * Sidebar navigation (re-design.md §8.1): grouped by Betrieb / Stammdaten / System, the current
 * section as a `primary-soft` pill. In the collapsed 72 px rail the group labels disappear and the
 * label moves into a tooltip; every row is a real link with `aria-current="page"` when active.
 *
 * Redesign RD2: the pill is one element that travels from the old section to the new one (motion
 * rule 20, `LayoutThumb`) instead of vanishing here and appearing there, and an entry gives way a
 * little while it is pressed (rule 4).
 */
export function AdminNav({
  onNavigate,
  collapsed = false,
  touch = false,
}: {
  onNavigate?: () => void;
  /** Icon rail mode (desktop sidebar collapsed); labels are shown in tooltips instead. */
  collapsed?: boolean;
  /**
   * NUD-153: the off-canvas drawer is the *only* navigation below 1025 px and is used with a
   * finger, so its rows are 48 px touch targets (backlog 4.3). The desktop rail keeps the 40 px
   * density the redesign specified.
   */
  touch?: boolean;
}) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const thumbId = useId();

  return (
    <MotionProvider>
      {/* `layoutRoot`: the pill travels relative to the list, not to the page (the sidebar is
          sticky, a scrolled page must not send it flying). */}
      <m.div
        layout
        layoutRoot
        transition={{ layout: { duration: 0 } }}
        className="flex min-h-0 flex-col"
      >
        <NavList
          t={t}
          pathname={pathname}
          thumbId={thumbId}
          onNavigate={onNavigate}
          collapsed={collapsed}
          touch={touch}
        />
      </m.div>
    </MotionProvider>
  );
}

function NavList({
  t,
  pathname,
  thumbId,
  onNavigate,
  collapsed,
  touch,
}: {
  t: ReturnType<typeof useTranslations<"admin">>;
  pathname: string;
  thumbId: string;
  onNavigate?: () => void;
  collapsed: boolean;
  touch: boolean;
}) {
  return (
    <nav
      aria-label={t("shell.mainNavigation")}
      data-testid="admin-nav"
      data-collapsed={collapsed ? "" : undefined}
      className="flex min-h-0 flex-col gap-4 overflow-y-auto"
    >
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          {collapsed ? (
            <span aria-hidden className="mx-3 border-t border-border" />
          ) : (
            <p className="px-3 text-xs font-medium text-muted-foreground">
              {t(`nav.groups.${group.id}`)}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.sections.map((section) => {
              const { href, icon: Icon } = navItem(section);
              const active = isNavActive(href, pathname);
              const label = t(`nav.${section}`);
              const link = (
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  data-testid={`nav-${section}`}
                  className={cn(
                    // 48 px in the drawer (`touch`), the redesign's 40 px density in the desktop rail.
                    "relative flex items-center gap-3 rounded-lg px-3 text-base outline-none transition-[background-color,color,transform] duration-[140ms] ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[.98]",
                    touch ? "min-h-12" : "h-10",
                    collapsed && "justify-center px-0",
                    active
                      ? "font-semibold text-primary-soft-foreground"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {active ? (
                    <LayoutThumb layoutId={thumbId} className="rounded-lg bg-primary-soft" />
                  ) : null}
                  <Icon className="relative size-5 shrink-0" aria-hidden />
                  {collapsed ? null : <span className="relative truncate">{label}</span>}
                </Link>
              );
              return (
                <li key={section}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
