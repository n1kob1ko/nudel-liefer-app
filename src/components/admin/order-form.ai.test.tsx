import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtractionAnswer, OrderDraft } from "@/domain/order-extraction";
import { extractOrderDraftAction } from "@/server/order-actions";

import de from "../../../messages/de.json";
import { type CustomerOption, OrderForm, type ProductOption } from "./order-form";

// jsdom has no ResizeObserver; the combobox's Radix popover measures its trigger with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@/server/order-actions", () => ({
  confirmedOrderCountAction: vi.fn(async () => 0),
  createOrderAction: vi.fn(),
  dayTourCompletedAction: vi.fn(async () => false),
  extractOrderDraftAction: vi.fn(),
  screenshotPreviewUrlAction: vi.fn(async () => null),
  updateOrderAction: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const CUSTOMERS: CustomerOption[] = [{ value: "c-1", label: "K-1 Gasthaus" }];
const PRODUCTS: ProductOption[] = [
  { value: "p-crate", label: "Nudeln (Kiste)", unit: "CRATE" },
  { value: "p-pack", label: "Nudeln (Sackerl)", unit: "PACK" },
];

const DRAFT: OrderDraft = {
  lines: [
    { productId: "p-crate", quantity: "2", confidence: 0.9, label: "Nudeln Kiste" },
    { productId: "p-pack", quantity: "1", confidence: 0.4, label: "Nudeln Sackerl" },
  ],
  unmatched: [
    {
      label: "Wantan-Teig",
      quantity: 3,
      reason: "ambiguous_product",
      candidates: ["p-pack"],
    },
  ],
  window: { from: "2099-05-05", to: "2099-05-06", fromTime: "08:00", toTime: "12:00" },
  windowConfidence: 0.8,
  windowNote: null,
  note: "Bitte am Morgen",
  confidence: 0.4,
};

const EXTRACTION: ExtractionAnswer = {
  lines: [
    { label: "Nudeln Kiste", quantity: 2, confidence: 0.9 },
    { label: "Nudeln Sackerl", quantity: 1, confidence: 0.4 },
  ],
  window: {
    from: "2099-05-05",
    to: "2099-05-06",
    fromTime: "08:00",
    toTime: "12:00",
    confidence: 0.8,
  },
  note: "Bitte am Morgen",
  confidence: 0.4,
};

function renderForm(aiAvailable: boolean) {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={de as unknown as AbstractIntlMessages}
      onError={(error) => {
        throw error;
      }}
    >
      <OrderForm
        customers={CUSTOMERS}
        products={PRODUCTS}
        defaultDate="2099-05-04"
        aiAvailable={aiAvailable}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderForm AI draft (NUD-150)", () => {
  it("disables the button and explains why when the AI is not configured", () => {
    renderForm(false);
    expect(screen.getByTestId("ai-extract")).toBeDisabled();
    expect(screen.getByTestId("ai-disabled-hint")).toHaveTextContent(
      "KI-Auslesen ist nicht konfiguriert",
    );
  });

  it("keeps the button disabled until a message or screenshot is there", () => {
    renderForm(true);
    const button = screen.getByTestId("ai-extract");
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId("ai-source-text"), { target: { value: "2 Kiste Nudeln" } });
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByTestId("ai-source-text"), { target: { value: "   " } });
    expect(button).toBeDisabled();
  });

  it("fills the lines and the window from a successful draft and marks uncertain lines", async () => {
    vi.mocked(extractOrderDraftAction).mockResolvedValue({
      ok: true,
      draft: DRAFT,
      extraction: EXTRACTION,
      model: "test/model",
    });
    renderForm(true);
    fireEvent.change(screen.getByTestId("ai-source-text"), { target: { value: "2 Kiste" } });
    fireEvent.click(screen.getByTestId("ai-extract"));

    await waitFor(() => {
      const quantities = screen
        .getAllByTestId("line-quantity")
        .map((input) => (input as HTMLInputElement).value);
      expect(quantities).toEqual(["2", "1"]);
    });
    // The window is filled, the planned day stays empty (= automatic).
    expect(screen.getByTestId("order-window-from")).toHaveValue("2099-05-05");
    expect(screen.getByTestId("order-window-to")).toHaveValue("2099-05-06");
    expect(screen.getByTestId("order-window-from-time")).toHaveValue("08:00");
    expect(screen.getByTestId("order-window-to-time")).toHaveValue("12:00");
    expect(screen.getByTestId("order-date")).toHaveValue("");

    // Only the uncertain line is marked; both lines show what the model read.
    const markers = screen.getAllByTestId("line-low-confidence");
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveTextContent("Unsicher erkannt");
    expect(screen.getAllByTestId("line-ai-label")).toHaveLength(2);
    expect(screen.getByTestId("ai-low-confidence")).toBeInTheDocument();

    // The unmatched line is listed with its quantity and the candidate's catalogue name.
    const notice = screen.getByTestId("ai-notice");
    expect(notice).toHaveTextContent("Wantan-Teig");
    expect(notice).toHaveTextContent("Nudeln (Sackerl)");
    expect(notice).toHaveTextContent("Bitte am Morgen");
    // The notice is never written into the internal note by itself.
    expect(screen.getByTestId("order-note")).toHaveValue("");
  });

  it("shows window words the model could not turn into a date instead of failing", async () => {
    vi.mocked(extractOrderDraftAction).mockResolvedValue({
      ok: true,
      draft: { ...DRAFT, window: null, windowConfidence: 0, windowNote: "morgen vormittag" },
      extraction: { ...EXTRACTION, window: "morgen vormittag" },
      model: "test/model",
    });
    renderForm(true);
    fireEvent.change(screen.getByTestId("ai-source-text"), {
      target: { value: "2 Kiste, morgen vormittag" },
    });
    fireEvent.click(screen.getByTestId("ai-extract"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-window-note")).toHaveTextContent("morgen vormittag");
    });
    // The window fields stay untouched, the office sets them by hand.
    expect(screen.getByTestId("order-window-from")).toHaveValue("2099-05-04");
    expect(screen.getByTestId("ai-notice")).toHaveTextContent("Zeitangabe aus der Nachricht");
  });

  it("shows the mapped error and keeps everything the office typed", async () => {
    vi.mocked(extractOrderDraftAction).mockResolvedValue({ ok: false, error: "not_configured" });
    renderForm(true);
    fireEvent.change(screen.getByTestId("ai-source-text"), { target: { value: "Hallo" } });
    fireEvent.change(screen.getByTestId("order-note"), { target: { value: "Kunde anrufen" } });
    fireEvent.click(screen.getByTestId("ai-extract"));

    expect(await screen.findByTestId("ai-error")).toHaveTextContent(
      "KI-Auslesen ist nicht konfiguriert",
    );
    expect(screen.getByTestId("ai-source-text")).toHaveValue("Hallo");
    expect(screen.getByTestId("order-note")).toHaveValue("Kunde anrufen");
  });
});
