import {
  BanknoteIcon,
  CalendarDaysIcon,
  CarFrontIcon,
  ClipboardListIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PackageIcon,
  SettingsIcon,
  StoreIcon,
  TruckIcon,
} from "lucide-react";

/** NUD-212: no "tours" section; the routes of a day are sent from the day plan ("planning"). */
export const ADMIN_SECTIONS = [
  "dashboard",
  "planning",
  "orders",
  "payments",
  "customers",
  "products",
  "vehicles",
  "drivers",
  "utilization",
  "settings",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Sidebar groups (re-design.md §8.1): Betrieb / Stammdaten / System. */
export const ADMIN_NAV_GROUPS = [
  { id: "operations", sections: ["dashboard", "planning", "orders", "payments"] },
  { id: "masterData", sections: ["customers", "products", "vehicles", "drivers"] },
  { id: "system", sections: ["utilization", "settings"] },
] as const satisfies ReadonlyArray<{
  id: "operations" | "masterData" | "system";
  sections: ReadonlyArray<AdminSection>;
}>;

export type AdminNavGroupId = (typeof ADMIN_NAV_GROUPS)[number]["id"];

/** Locale-less paths (the i18n navigation helpers add the locale prefix). */
export const ADMIN_NAV: ReadonlyArray<{ section: AdminSection; href: string; icon: LucideIcon }> = [
  { section: "dashboard", href: "/admin", icon: LayoutDashboardIcon },
  { section: "planning", href: "/admin/planning", icon: CalendarDaysIcon },
  { section: "orders", href: "/admin/orders", icon: ClipboardListIcon },
  { section: "payments", href: "/admin/payments", icon: BanknoteIcon },
  { section: "customers", href: "/admin/customers", icon: StoreIcon },
  { section: "products", href: "/admin/products", icon: PackageIcon },
  { section: "vehicles", href: "/admin/vehicles", icon: CarFrontIcon },
  { section: "drivers", href: "/admin/drivers", icon: TruckIcon },
  { section: "utilization", href: "/admin/utilization", icon: GaugeIcon },
  { section: "settings", href: "/admin/settings", icon: SettingsIcon },
];

/** The dashboard only matches exactly; other sections also match their sub-pages. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nav entry (href + icon) of one section, in membership order. */
export function navItem(section: AdminSection) {
  const item = ADMIN_NAV.find((entry) => entry.section === section);
  if (!item) throw new Error(`Unreachable: no nav item for section ${section}`);
  return item;
}

/**
 * Section the current path belongs to; the dashboard is the fallback so the shell always has a
 * breadcrumb without reading any data (re-design.md §8.1/§14.3).
 */
export function activeNavItem(pathname: string) {
  // NUD-212: the old tour page and the load sheet have no menu entry; they belong to the day plan.
  if (isNavActive("/admin/tours", pathname)) return navItem("planning");
  return ADMIN_NAV.find((entry) => isNavActive(entry.href, pathname)) ?? navItem("dashboard");
}
