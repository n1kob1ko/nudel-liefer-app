import { describe, expect, it } from "vitest";

import {
  activeNavItem,
  ADMIN_NAV,
  ADMIN_NAV_GROUPS,
  ADMIN_SECTIONS,
  isNavActive,
} from "./nav-items";

describe("isNavActive", () => {
  it("matches the dashboard only exactly", () => {
    expect(isNavActive("/admin", "/admin")).toBe(true);
    expect(isNavActive("/admin", "/admin/orders")).toBe(false);
  });

  it("matches a section and its sub-pages but not look-alikes", () => {
    expect(isNavActive("/admin/orders", "/admin/orders")).toBe(true);
    expect(isNavActive("/admin/orders", "/admin/orders/123")).toBe(true);
    expect(isNavActive("/admin/orders", "/admin/orders-archive")).toBe(false);
    expect(isNavActive("/admin/orders", "/admin/tours")).toBe(false);
  });
});

describe("admin nav groups", () => {
  it("lists every section exactly once, in membership order", () => {
    const grouped = ADMIN_NAV_GROUPS.flatMap((group) => [...group.sections]);
    expect(grouped).toEqual([...ADMIN_SECTIONS]);
    expect(new Set(grouped).size).toBe(ADMIN_SECTIONS.length);
  });

  it("puts the operations sections in the Betrieb group", () => {
    expect(ADMIN_NAV_GROUPS[0]).toEqual({
      id: "operations",
      sections: ["dashboard", "planning", "orders", "tours", "payments"],
    });
  });
});

describe("activeNavItem", () => {
  it("resolves a section and its sub-pages, and falls back to the dashboard", () => {
    expect(activeNavItem("/admin/customers/42").section).toBe("customers");
    expect(activeNavItem("/admin/tours").href).toBe("/admin/tours");
    expect(activeNavItem("/admin").section).toBe("dashboard");
    expect(activeNavItem("/admin/unknown").section).toBe("dashboard");
  });

  it("covers every section declared in the nav", () => {
    for (const item of ADMIN_NAV) {
      expect(activeNavItem(item.href).section).toBe(item.section);
    }
  });
});
