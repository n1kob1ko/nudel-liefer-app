import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import { HomeContent } from "./home-content";

vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
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
    expect(screen.getByText("Platzhalter")).toBeInTheDocument();
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
