import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import fragment from "../../../tests/fixtures/locale/admin-forms.json";
import { SettingsForm, type SettingsFormValues } from "./settings-form";

type Tree = Record<string, unknown>;

// jsdom has no ResizeObserver; Radix' Switch/Popover measure their trigger with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const saveSettingsAction = vi.fn(async () => ({ ok: true }));
const refresh = vi.fn();

vi.mock("@/server/settings-actions", () => ({
  saveSettingsAction: (...args: unknown[]) => saveSettingsAction(...(args as [])),
}));
vi.mock("@/server/geocode-actions", () => ({ geocodeAddressAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
// Leaflet touches `window`; the map is irrelevant for the form contract under test.
vi.mock("@/components/maps/lazy", () => ({
  PinPickerMapLazy: () => <div data-testid="pin-picker" />,
}));
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
const MESSAGES_HANS = merge(
  zhHans as unknown as Tree,
  fragment["zh-Hans"] as unknown as Tree,
) as AbstractIntlMessages;

const INITIAL: SettingsFormValues = {
  depotName: "Nudelfabrik",
  depotAddress: "Graben 1, 1010 Wien",
  depotPin: { lat: 48.2102, lng: 16.3702 },
  depotPinConfirmed: false,
  timezone: "Europe/Vienna",
  departureTime: "07:00",
  serviceMinutesPerStop: 10,
  defaultLoadingMinutes: 20,
  recurringLeadDays: 14,
  deliveryWeekdays: [1, 2, 3, 4, 5],
  departureChecklist: [],
  problemPhone: "+43 1 000 00 00",
};

const TILES = { url: "https://tiles.test/{z}/{x}/{y}.png", attribution: "test" };

function renderForm(initial: SettingsFormValues = INITIAL) {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={MESSAGES}
      onError={(error) => {
        throw error;
      }}
    >
      <SettingsForm
        initial={initial}
        timezones={["Europe/Vienna", "Europe/Berlin"]}
        tiles={TILES}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsForm", () => {
  it("keeps the ids the settings spec drives and labels its fields", () => {
    renderForm();
    expect(screen.getByTestId("section-title")).toHaveTextContent("Einstellungen");
    expect(screen.getByTestId("depot-status")).toHaveTextContent("Standort nicht bestätigt");
    // `getByLabelText` folds the required `*` into the label text; the Playwright specs query by
    // accessible name (which excludes the aria-hidden marker), so match on the prefix here.
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Nudelfabrik");
    expect(screen.getByLabelText(/^Adresse/)).toHaveValue("Graben 1, 1010 Wien");
    expect(screen.getByLabelText(/^Standard-Abfahrtszeit/)).toHaveValue("07:00");
    expect(screen.getByLabelText(/^Minuten pro Stopp/)).toHaveValue(10);
    expect(screen.getByTestId("pin-lat")).toHaveValue("48.2102");
    expect(screen.getByTestId("pin-lng")).toHaveValue("16.3702");
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      expect(screen.getByTestId(`weekday-${day}`)).toBeInTheDocument();
    }
  });

  it("refuses to save until the pin is confirmed, with the localized message", async () => {
    renderForm();
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByTestId("settings-error")).toHaveTextContent(
      "Bitte bestätigen, dass der Standort am richtigen Ort liegt.",
    );
    expect(saveSettingsAction).not.toHaveBeenCalled();
  });

  it("tracks the pin confirmation through the depot-confirm control", () => {
    renderForm();
    const confirm = screen.getByTestId("depot-confirm");
    expect(confirm).not.toBeChecked();
    fireEvent.click(confirm);
    expect(confirm).toBeChecked();
  });

  it("saves the same input shape as before (server contract unchanged)", async () => {
    renderForm({ ...INITIAL, depotPinConfirmed: true });
    fireEvent.change(screen.getByLabelText(/^Minuten pro Stopp/), { target: { value: "15" } });
    fireEvent.click(screen.getByTestId("settings-save"));
    await vi.waitFor(() =>
      expect(saveSettingsAction).toHaveBeenCalledWith({
        depotName: "Nudelfabrik",
        depotAddress: "Graben 1, 1010 Wien",
        depotLat: 48.2102,
        depotLng: 16.3702,
        depotPinConfirmed: true,
        timezone: "Europe/Vienna",
        departureTime: "07:00",
        serviceMinutesPerStop: 15,
        defaultLoadingMinutes: 20,
        recurringLeadDays: 14,
        problemPhone: "+43 1 000 00 00",
        deliveryWeekdays: [1, 2, 3, 4, 5],
        departureChecklist: [],
      }),
    );
  });

  it("edits the fixed departure checklist items and saves them with their ids (NUD-151)", async () => {
    renderForm({
      ...INITIAL,
      depotPinConfirmed: true,
      departureChecklist: [{ id: "c1", text: "Lieferscheine" }],
    });
    expect(screen.getAllByTestId("checklist-item")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("checklist-add"));
    const inputs = screen.getAllByTestId("checklist-item");
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[1]!, { target: { value: "  Rechnungsblock " } });
    // An empty row is dropped on save instead of being refused.
    fireEvent.click(screen.getByTestId("checklist-add"));
    fireEvent.click(screen.getByTestId("settings-save"));
    await vi.waitFor(() =>
      expect(saveSettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({
          departureChecklist: [{ id: "c1", text: "Lieferscheine" }, { text: "Rechnungsblock" }],
        }),
      ),
    );
  });

  it("removes a fixed item and stops adding at the limit", () => {
    renderForm({
      ...INITIAL,
      departureChecklist: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, text: `P${i}` })),
    });
    expect(screen.getByTestId("checklist-add")).toBeDisabled();
    fireEvent.click(screen.getAllByTestId("checklist-remove")[0]!);
    expect(screen.getAllByTestId("checklist-item")).toHaveLength(11);
    expect(screen.getByTestId("checklist-add")).toBeEnabled();
  });

  it("marks unsaved changes and discards them again", () => {
    renderForm();
    expect(screen.queryByText("Ungespeicherte Änderungen")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Anderes Depot" } });
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-reset"));
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Nudelfabrik");
    expect(screen.queryByText("Ungespeicherte Änderungen")).not.toBeInTheDocument();
  });

  it("renders its texts in Simplified Chinese without missing keys", () => {
    render(
      <NextIntlClientProvider
        locale="zh-Hans"
        messages={MESSAGES_HANS}
        onError={(error) => {
          throw error;
        }}
      >
        <SettingsForm initial={INITIAL} timezones={["Europe/Vienna"]} tiles={TILES} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("section-title")).toHaveTextContent("设置");
    fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: "仓库" } });
    expect(screen.getByText("有未保存的更改")).toBeInTheDocument();
  });
});
