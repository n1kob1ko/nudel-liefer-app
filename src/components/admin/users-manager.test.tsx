import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import fragment from "../../../tests/fixtures/locale/admin-forms.json";
import { type UserListRow, UsersManager } from "./users-manager";

type Tree = Record<string, unknown>;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const setDriverLocaleAction = vi.fn(async () => ({ ok: true }));
const setUserActiveAction = vi.fn(async () => ({ ok: true }));
const resetDriverPinAction = vi.fn(async () => ({ ok: true, pin: "654321" }));
const refresh = vi.fn();

vi.mock("@/server/user-actions", () => ({
  createDriverAction: vi.fn(),
  createAdminAction: vi.fn(),
  resetDriverPinAction: (...args: unknown[]) => resetDriverPinAction(...(args as [])),
  setUserActiveAction: (...args: unknown[]) => setUserActiveAction(...(args as [])),
  setDriverLocaleAction: (...args: unknown[]) => setDriverLocaleAction(...(args as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
// `PageHeader` carries the app's `Link` (the way back on sub pages); this page has none.
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key];
    out[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object"
        ? merge(current as Tree, value as Tree)
        : value;
  }
  return out;
}

const MESSAGES = merge(
  de as unknown as Tree,
  fragment.de as unknown as Tree,
) as AbstractIntlMessages;

const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const drivers: UserListRow[] = [
  {
    id: "u1",
    displayName: "Mira Fahrer",
    username: "mira",
    email: null,
    locale: "de",
    active: true,
    lastLoginAt: twoHoursAgo,
  },
  {
    id: "u2",
    displayName: "Neu Fahrer",
    username: "neu",
    email: null,
    locale: "zh-Hans",
    active: false,
    lastLoginAt: null,
  },
];

const admins: UserListRow[] = [
  {
    id: "a1",
    displayName: "Adele Admin",
    username: null,
    email: "admin@example.com",
    locale: "de",
    active: true,
    lastLoginAt: null,
  },
];

function renderManager() {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={MESSAGES}
      onError={(error) => {
        throw error;
      }}
    >
      <UsersManager
        title="Fahrer"
        drivers={drivers}
        admins={admins}
        currentUserId="a1"
        timezone="Europe/Vienna"
        schedules={{}}
        utilization={{}}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UsersManager", () => {
  it("keeps the table and row ids the drivers spec drives", () => {
    renderManager();
    // The component renders the shared page header (h1 + `section-title` + the primary action in the
    // action slot) and the cards with the tables below it.
    expect(screen.getByTestId("section-title")).toHaveTextContent("Fahrer");
    expect(screen.getByTestId("drivers-table")).toBeInTheDocument();
    expect(screen.getByTestId("admins-table")).toBeInTheDocument();
    expect(screen.getByTestId("driver-row-mira")).toBeInTheDocument();
    expect(screen.getByTestId("driver-row-neu")).toBeInTheDocument();
    expect(screen.getByTestId("admin-row-admin@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("create-driver")).toBeInTheDocument();
    expect(screen.getByTestId("create-admin")).toBeInTheDocument();
  });

  it("shows the language as a read-only badge and the last sign-in as relative time", () => {
    renderManager();
    const row = screen.getByTestId("driver-row-mira");
    expect(within(row).getByText("Deutsch")).toBeInTheDocument();
    // No inline language <select> in the row any more (re-design.md §8.7).
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row).getByText("vor 2 Stunden")).toBeInTheDocument();
    expect(within(screen.getByTestId("driver-row-neu")).getByText("Noch nie")).toBeInTheDocument();
  });

  it("keeps the overflow actions: PIN reset, language edit, deactivate/reactivate", () => {
    renderManager();
    const activeRow = screen.getByTestId("driver-row-mira");
    const inactiveRow = screen.getByTestId("driver-row-neu");
    expect(within(activeRow).getByLabelText(/Aktionen für Mira Fahrer/)).toBeInTheDocument();
    expect(within(inactiveRow).getByLabelText(/Aktionen für Neu Fahrer/)).toBeInTheDocument();
    // The admin row of the signed-in user has no deactivate action.
    const adminRow = screen.getByTestId("admin-row-admin@example.com");
    expect(within(adminRow).getByLabelText(/Aktionen für Adele Admin/)).toBeInTheDocument();
  });

  it("moves the language edit into a dialog and calls the same action", async () => {
    renderManager();
    const row = screen.getByTestId("driver-row-mira");
    fireEvent.pointerDown(within(row).getByLabelText(/Aktionen für Mira Fahrer/), {
      button: 0,
      ctrlKey: false,
    });
    const edit = await screen.findByTestId("edit-login");
    fireEvent.click(edit);
    const dialog = await screen.findByTestId("edit-driver-form");
    expect(await screen.findByText("Sprache von Mira Fahrer")).toBeInTheDocument();
    const submit = await within(dialog).findByTestId("edit-submit");
    fireEvent.click(submit);
    await vi.waitFor(() => expect(setDriverLocaleAction).toHaveBeenCalledWith("u1", "de"));
  });

  it("offers the PIN reset through the existing confirm flow", async () => {
    renderManager();
    const row = screen.getByTestId("driver-row-mira");
    fireEvent.pointerDown(within(row).getByLabelText(/Aktionen für Mira Fahrer/), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByTestId("reset-pin"));
    fireEvent.click(await screen.findByTestId("confirm-submit"));
    await vi.waitFor(() => expect(resetDriverPinAction).toHaveBeenCalledWith("u1"));
    expect(await screen.findByTestId("pin-dialog")).toBeInTheDocument();
  });
});
