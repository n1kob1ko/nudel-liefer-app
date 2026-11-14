import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrderDraft } from "@/domain/order-extraction";
import { createOrderAction } from "@/server/order-actions";
import type { InboxPrefill } from "@/server/order-inbox";
import { discardInboxPhotoAction, restoreInboxPhotoAction } from "@/server/order-inbox-actions";

import de from "../../../messages/de.json";
import { type CustomerOption, OrderForm, type ProductOption } from "./order-form";

// jsdom has no ResizeObserver; the combobox's Radix popover and the zoom pane measure with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const push = vi.fn();
vi.mock("@/server/order-actions", () => ({
  confirmedOrderCountAction: vi.fn(async () => 0),
  createOrderAction: vi.fn(),
  dayTourCompletedAction: vi.fn(async () => false),
  extractOrderDraftAction: vi.fn(),
  screenshotPreviewUrlAction: vi.fn(async () => null),
  updateOrderAction: vi.fn(),
}));
vi.mock("@/server/order-inbox-actions", () => ({
  discardInboxPhotoAction: vi.fn(),
  restoreInboxPhotoAction: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: { pathname: string; query?: Record<string, string> } | string;
    children: ReactNode;
  }) => (
    <a
      href={
        typeof href === "string"
          ? href
          : `${href.pathname}?${new URLSearchParams(href.query).toString()}`
      }
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const CUSTOMERS: CustomerOption[] = [
  { value: "c-1", label: "K-1 Pasta e Basta, Wien" },
  { value: "c-2", label: "K-2 Gasthaus, Wien" },
];
const PRODUCTS: ProductOption[] = [
  { value: "p-crate", label: "Nudeln (Kiste)", unit: "CRATE" },
  { value: "p-pack", label: "Nudeln (Sackerl)", unit: "PACK" },
];

const DRAFT: OrderDraft = {
  lines: [
    { productId: "p-crate", quantity: "3", confidence: 0.95, label: "Nudeln Kiste" },
    { productId: "p-pack", quantity: "10", confidence: 0.4, label: "Nudeln Sackerl" },
  ],
  unmatched: [{ label: "Gnocchi", quantity: 2, reason: "unknown_product", candidates: [] }],
  window: null,
  windowConfidence: 0,
  windowNote: null,
  note: "Bitte vor 10 Uhr",
  confidence: 0.4,
};

function prefill(over: Partial<InboxPrefill> = {}): InboxPrefill {
  return {
    id: "s-1",
    screenshot: { storageKey: "screenshots/s-1.jpg", url: "https://photos.test/s-1" },
    draft: DRAFT,
    extraction: {
      customer: "Pasta e Basta",
      lines: [
        { label: "Nudeln Kiste", quantity: 3, confidence: 0.95 },
        { label: "Nudeln Sackerl", quantity: 10, confidence: 0.4 },
        { label: "Gnocchi", quantity: 2, confidence: 0.8 },
      ],
      window: null,
      note: "Bitte vor 10 Uhr",
      confidence: 0.4,
    },
    customerId: "c-1",
    customerHint: "Pasta e Basta",
    nextId: "s-2",
    remaining: 4,
    ...over,
  };
}

function renderForm(inbox: InboxPrefill) {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={de as unknown as AbstractIntlMessages}
      onError={(error) => {
        throw error;
      }}
    >
      <OrderForm
        key={inbox.id}
        customers={CUSTOMERS}
        products={PRODUCTS}
        defaultDate="2099-05-04"
        aiAvailable
        inbox={inbox}
      />
    </NextIntlClientProvider>,
  );
}

const quantities = () =>
  screen.getAllByTestId("line-quantity").map((input) => (input as HTMLInputElement).value);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderForm inbox mode (NUD-210)", () => {
  it("opens with the photo, the proposed customer and what was read; nothing is typed again", () => {
    renderForm(prefill());
    expect(screen.getByTestId("order-entry")).toHaveAttribute("data-split", "true");
    expect(screen.getByTestId("screenshot-pane")).toBeInTheDocument();
    expect(document.getElementById("order-customer")).toHaveTextContent("Pasta e Basta");
    expect(screen.getByText("Vorschlag. Auf dem Foto: Pasta e Basta")).toBeInTheDocument();
    expect(quantities()).toEqual(["3", "10"]);
    // Only the uncertain line is marked, both show what stood on the photo.
    expect(screen.getAllByTestId("line-low-confidence")).toHaveLength(1);
    expect(screen.getAllByTestId("line-ai-label")).toHaveLength(2);
    // What could not be matched and the customer's remark stay in view, not in the internal note.
    const notes = screen.getByTestId("inbox-notes");
    expect(notes).toHaveTextContent("Gnocchi");
    expect(notes).toHaveTextContent("Bitte vor 10 Uhr");
    expect(screen.getByTestId("order-note")).toHaveValue("");
    // One photo, one job: no second way to read a message, no "repeat weekly" here.
    expect(screen.queryByTestId("ai-extract")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-source-text")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-save")).toHaveTextContent("Bestätigen und weiter");
    expect(screen.getByTestId("inbox-skip")).toHaveAttribute("href", "/admin/orders/new?inbox=s-2");
  });

  it("saves with the inbox photo and goes on to the next one", async () => {
    vi.mocked(createOrderAction).mockResolvedValue({
      ok: true,
      id: "o-1",
      status: "CONFIRMED",
      plannedDate: "2099-05-04",
      warnings: [],
    } as Awaited<ReturnType<typeof createOrderAction>>);
    renderForm(prefill());
    fireEvent.click(screen.getByTestId("order-save"));

    await waitFor(() => expect(createOrderAction).toHaveBeenCalledTimes(1));
    const input = vi.mocked(createOrderAction).mock.calls[0][0] as {
      customerId: string;
      screenshotKey: string;
      status: string;
      lines: { productId: string; quantity: string }[];
      aiExtraction: unknown;
    };
    expect(input.customerId).toBe("c-1");
    expect(input.screenshotKey).toBe("screenshots/s-1.jpg");
    expect(input.status).toBe("CONFIRMED");
    expect(input.lines).toEqual([
      { productId: "p-crate", quantity: "3" },
      { productId: "p-pack", quantity: "10" },
    ]);
    expect(input.aiExtraction).toMatchObject({ customer: "Pasta e Basta" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ pathname: "/admin/orders/new", query: { inbox: "s-2" } }),
    );
  });

  it("the last photo goes back to the inbox and offers nothing to skip to", async () => {
    vi.mocked(createOrderAction).mockResolvedValue({
      ok: true,
      id: "o-1",
      status: "DRAFT",
      plannedDate: "2099-05-04",
      warnings: [],
    } as Awaited<ReturnType<typeof createOrderAction>>);
    renderForm(prefill({ nextId: null, remaining: 0 }));
    expect(screen.queryByTestId("inbox-skip")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-save")).toHaveTextContent("Bestätigt speichern");
    fireEvent.click(screen.getByTestId("order-save-draft"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/orders/inbox"));
  });

  it("a photo that was not read is typed by hand: no customer, one empty line, a plain notice", () => {
    renderForm(prefill({ draft: null, extraction: null, customerId: null, customerHint: null }));
    expect(screen.getByTestId("inbox-not-read")).toHaveTextContent("nicht gelesen");
    expect(quantities()).toEqual([""]);
    expect(screen.queryByTestId("line-ai-label")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("order-save"));
    // The customer is required like on any order; nothing is sent.
    expect(createOrderAction).not.toHaveBeenCalled();
  });

  it("a name on the photo without a known customer is shown as a hint, never picked", () => {
    renderForm(prefill({ customerId: null, customerHint: "+43 660 5550123" }));
    expect(screen.getByText("Auf dem Foto: +43 660 5550123")).toBeInTheDocument();
    expect(document.getElementById("order-customer")).not.toHaveTextContent("Pasta e Basta");
  });

  it("a proposal for a customer that is no longer selectable is dropped", () => {
    renderForm(prefill({ customerId: "c-gone" }));
    expect(screen.getByText("Auf dem Foto: Pasta e Basta")).toBeInTheDocument();
    expect(document.getElementById("order-customer")).not.toHaveTextContent("Pasta e Basta");
  });

  it("discards the photo, goes on, and brings it back from the toast", async () => {
    vi.mocked(discardInboxPhotoAction).mockResolvedValue({ ok: true });
    vi.mocked(restoreInboxPhotoAction).mockResolvedValue({ ok: true });
    renderForm(prefill());
    fireEvent.click(screen.getByTestId("inbox-discard"));

    await waitFor(() => expect(discardInboxPhotoAction).toHaveBeenCalledWith("s-1"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ pathname: "/admin/orders/new", query: { inbox: "s-2" } }),
    );
    expect(createOrderAction).not.toHaveBeenCalled();
    const [message, options] = vi.mocked(toast).mock.calls[0] as unknown as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Foto verworfen");
    options.action.onClick();
    await waitFor(() => expect(restoreInboxPhotoAction).toHaveBeenCalledWith("s-1"));
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith({
        pathname: "/admin/orders/new",
        query: { inbox: "s-1" },
      }),
    );
  });

  it("stays on the photo when the discard fails", async () => {
    vi.mocked(discardInboxPhotoAction).mockResolvedValue({ ok: false, error: "not_found" });
    renderForm(prefill());
    fireEvent.click(screen.getByTestId("inbox-discard"));
    expect(await screen.findByTestId("order-error")).toHaveTextContent("erneut versuchen");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("inbox-discard")).toBeEnabled();
  });
});
