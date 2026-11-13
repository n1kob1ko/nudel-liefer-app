import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import { HomeContent } from "./home-content";

vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("HomeContent", () => {
  afterEach(cleanup);

  it("renders German messages", () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <HomeContent />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Routenplanner");
    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
    // The two ways in: one whole row each, nothing else to read.
    expect(screen.getByTestId("home-office")).toHaveAttribute("href", "/admin");
    expect(screen.getByTestId("home-office")).toHaveTextContent("Büro");
    expect(screen.getByTestId("home-driver")).toHaveAttribute("href", "/driver");
    expect(screen.getByTestId("home-driver")).toHaveTextContent("Fahrer");
    expect(screen.queryByText("Platzhalter")).not.toBeInTheDocument();
  });

  it("renders Simplified Chinese messages and labels languages in their own script", () => {
    render(
      <NextIntlClientProvider locale="zh-Hans" messages={zhHans}>
        <HomeContent />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("option", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deutsch" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Srpski" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Čeština" })).toBeInTheDocument();
  });
});
