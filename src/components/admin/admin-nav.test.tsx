import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import de from "../../../messages/de.json";
import { AdminBottomNav } from "./admin-bottom-nav";
import { AdminNav } from "./admin-nav";

let pathname = "/admin/orders";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function show(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <TooltipProvider>{ui}</TooltipProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  pathname = "/admin/orders";
});

describe("AdminNav", () => {
  it("marks the current section and carries one travelling highlight (motion rule 20)", () => {
    show(<AdminNav />);
    const current = screen.getByTestId("nav-orders");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.querySelector('[data-slot="layout-thumb"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-slot="layout-thumb"]')).toHaveLength(1);
    expect(screen.getByTestId("nav-tours")).not.toHaveAttribute("aria-current");
  });

  it("gives way under the finger: entries scale a little while pressed (rule 4)", () => {
    show(<AdminNav />);
    expect(screen.getByTestId("nav-tours")).toHaveClass("active:scale-[.98]");
  });

  it("keeps the label readable above the highlight", () => {
    show(<AdminNav />);
    const label = screen.getByTestId("nav-orders").querySelector("span.truncate");
    expect(label).toHaveClass("relative");
    expect(screen.getByTestId("nav-orders")).toHaveClass("text-primary-soft-foreground");
  });

  it("keeps the highlight in the collapsed rail, where labels are tooltips", () => {
    show(<AdminNav collapsed />);
    const current = screen.getByTestId("nav-orders");
    expect(current).toHaveAccessibleName("Bestellungen");
    expect(current.querySelector('[data-slot="layout-thumb"]')).not.toBeNull();
  });
});

describe("AdminBottomNav", () => {
  it("moves one highlight between the tabs as well", () => {
    pathname = "/admin/tours";
    show(<AdminBottomNav />);
    const nav = screen.getByTestId("admin-bottom-nav");
    const current = nav.querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent("Touren");
    expect(current?.querySelector('[data-slot="layout-thumb"]')).not.toBeNull();
    expect(nav.querySelectorAll('[data-slot="layout-thumb"]')).toHaveLength(1);
  });
});
