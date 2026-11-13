import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import { AdminCommandMenu } from "./admin-command-menu";

const push = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

// cmdk measures its list and scrolls the selected row into view; jsdom has neither.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();

function show() {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <AdminCommandMenu />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("AdminCommandMenu", () => {
  it("stays closed until it is asked for", () => {
    show();
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("command-open")).toHaveAccessibleName(/Suchen und springen/);
  });

  it("opens with Ctrl+K and with ⌘K, and closes with the same keys", () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("command-menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("leaves a plain k and Ctrl+Shift+K alone", () => {
    show();
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("lists every section of the office and the two things that get created most", () => {
    show();
    fireEvent.click(screen.getByTestId("command-open"));
    for (const label of [
      "Übersicht",
      "Tagesplanung",
      "Bestellungen",
      "Touren",
      "Zahlungen",
      "Kunden",
      "Produkte",
      "Fahrzeuge",
      "Fahrer",
      "Auslastung",
      "Einstellungen",
      "Neue Bestellung",
      "Neuer Kunde",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("narrows the list while typing and goes to the chosen page", () => {
    show();
    fireEvent.click(screen.getByTestId("command-open"));
    fireEvent.change(screen.getByPlaceholderText("Seite oder Aktion suchen …"), {
      target: { value: "Zahl" },
    });
    expect(screen.queryByRole("option", { name: "Touren" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Zahlungen" }));
    expect(push).toHaveBeenCalledWith("/admin/payments");
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("starts a new order from anywhere", () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByRole("option", { name: "Neue Bestellung" }));
    expect(push).toHaveBeenCalledWith("/admin/orders/new");
  });

  it("says so when nothing matches", () => {
    show();
    fireEvent.click(screen.getByTestId("command-open"));
    fireEvent.change(screen.getByPlaceholderText("Seite oder Aktion suchen …"), {
      target: { value: "xyzxyz" },
    });
    expect(screen.getByText("Nichts gefunden.")).toBeInTheDocument();
  });
});
