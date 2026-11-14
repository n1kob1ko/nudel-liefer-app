import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadImage } from "@/lib/upload-image";
import type { InboxItemView, InboxView } from "@/server/order-inbox";
import {
  addInboxPhotosAction,
  discardInboxPhotoAction,
  inboxAction,
  restoreInboxPhotoAction,
  retryInboxPhotoAction,
} from "@/server/order-inbox-actions";

import de from "../../../messages/de.json";
import { type InboxProduct, OrderInbox } from "./order-inbox";

vi.mock("@/server/order-inbox-actions", () => ({
  addInboxPhotosAction: vi.fn(),
  discardInboxPhotoAction: vi.fn(),
  inboxAction: vi.fn(),
  restoreInboxPhotoAction: vi.fn(),
  retryInboxPhotoAction: vi.fn(),
}));
vi.mock("@/lib/upload-image", () => ({
  isHeic: () => false,
  uploadImage: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
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

const PRODUCTS: InboxProduct[] = [
  { id: "p-crate", name: "Nudeln", unit: "CRATE" },
  { id: "p-pack", name: "Nudeln", unit: "PACK" },
];

function item(over: Partial<InboxItemView> & { id: string }): InboxItemView {
  return {
    status: "READY",
    url: `https://photos.test/${over.id}`,
    customer: null,
    customerHint: null,
    lines: [],
    unmatched: 0,
    error: null,
    ...over,
  };
}

const READY = item({
  id: "s-ready",
  customer: { id: "c-1", name: "Pasta e Basta", city: "Wien" },
  customerHint: "Pasta e Basta",
  lines: [
    { productId: "p-crate", quantity: "3" },
    { productId: "p-pack", quantity: "10" },
  ],
  unmatched: 1,
});
const NO_CUSTOMER = item({
  id: "s-hint",
  customerHint: "+43 660 5550123",
  lines: [{ productId: "p-crate", quantity: "1" }],
});
const READING = item({ id: "s-reading", status: "READING" });
const FAILED = item({ id: "s-failed", status: "FAILED", error: "extraction_failed" });

const view = (items: InboxItemView[]): InboxView => ({
  items,
  waiting: items.filter((entry) => entry.status === "NEW" || entry.status === "READING").length,
  ready: items.filter((entry) => entry.status === "READY").length,
});

function renderInbox(items: InboxItemView[], options: { aiAvailable?: boolean } = {}) {
  const initial = view(items);
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={de as unknown as AbstractIntlMessages}
      onError={(error) => {
        throw error;
      }}
    >
      <OrderInbox
        initial={initial}
        firstId={items.find((entry) => entry.status === "READY")?.id ?? null}
        aiAvailable={options.aiAvailable ?? true}
        products={PRODUCTS}
      />
    </NextIntlClientProvider>,
  );
}

const row = (index: number) => screen.getAllByTestId("inbox-row")[index];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderInbox (NUD-210)", () => {
  it("invites to upload when the inbox is empty: one primary action, nothing to check", () => {
    renderInbox([]);
    expect(screen.getByTestId("inbox-empty")).toHaveTextContent("Noch keine Fotos");
    expect(screen.getByTestId("inbox-count")).toHaveTextContent("Keine Fotos offen");
    expect(screen.queryByTestId("inbox-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-list")).not.toBeInTheDocument();
    // The hint about the missing model is noise on an empty page.
    cleanup();
    renderInbox([], { aiAvailable: false });
    expect(screen.queryByTestId("inbox-no-ai")).not.toBeInTheDocument();
  });

  it("shows what was read on each photo: customer, lines in the catalog's words, unclear lines", () => {
    renderInbox([READY, NO_CUSTOMER, item({ id: "s-empty" })]);
    expect(screen.getByTestId("inbox-count")).toHaveTextContent("3 Fotos offen");
    expect(within(row(0)).getByTestId("inbox-row-customer")).toHaveTextContent(
      "Pasta e Basta, Wien",
    );
    expect(row(0)).toHaveTextContent("3 Kiste Nudeln · 10 Sackerl Nudeln · 1 unklar");
    // No customer found: the row shows what stands on the photo, or says that the customer is missing.
    expect(within(row(1)).getByTestId("inbox-row-customer")).toHaveTextContent(
      "Auf dem Foto: +43 660 5550123",
    );
    expect(within(row(2)).getByTestId("inbox-row-customer")).toHaveTextContent("Kunde fehlt");
    expect(row(2)).toHaveTextContent("Keine Produkte erkannt");
    // "Prüfen starten" opens the oldest ready photo, each row its own.
    expect(screen.getByTestId("inbox-start")).toHaveAttribute(
      "href",
      "/admin/orders/new?inbox=s-ready",
    );
    expect(within(row(1)).getByTestId("inbox-row-review")).toHaveAttribute(
      "href",
      "/admin/orders/new?inbox=s-hint",
    );
  });

  it("a photo that is still being read has a skeleton and cannot be checked yet", () => {
    renderInbox([READY, READING]);
    expect(screen.getByTestId("inbox-reading")).toHaveTextContent("1 wird gelesen");
    expect(within(row(1)).getByTestId("inbox-row-state")).toHaveTextContent("Wird gelesen");
    expect(within(row(1)).queryByTestId("inbox-row-review")).not.toBeInTheDocument();
    expect(within(row(1)).queryByRole("link")).not.toBeInTheDocument();
    // It can still be thrown away.
    expect(within(row(1)).getByTestId("inbox-row-discard")).toBeInTheDocument();
  });

  it("without a model the photos wait unread and are checked by hand", () => {
    renderInbox([item({ id: "s-new", status: "NEW" })], { aiAvailable: false });
    expect(screen.getByTestId("inbox-no-ai")).toHaveTextContent("noch nicht eingerichtet");
    expect(screen.queryByTestId("inbox-reading")).not.toBeInTheDocument();
    expect(row(0)).toHaveTextContent("Nicht gelesen");
    expect(within(row(0)).getByTestId("inbox-row-review")).toHaveAttribute(
      "href",
      "/admin/orders/new?inbox=s-new",
    );
  });

  it("an unreadable photo can be read again or typed by hand", async () => {
    vi.mocked(retryInboxPhotoAction).mockResolvedValue({ ok: true });
    vi.mocked(inboxAction).mockResolvedValue({
      view: view([{ ...FAILED, status: "NEW", error: null }]),
      firstId: null,
    });
    renderInbox([FAILED]);
    expect(row(0)).toHaveTextContent("Nicht lesbar");
    expect(within(row(0)).getByTestId("inbox-row-review")).toBeInTheDocument();

    fireEvent.click(within(row(0)).getByTestId("inbox-row-retry"));
    await waitFor(() => expect(retryInboxPhotoAction).toHaveBeenCalledWith("s-failed"));
    await waitFor(() =>
      expect(within(row(0)).getByTestId("inbox-row-state")).toHaveTextContent("Wird gelesen"),
    );
    // The photo on screen keeps the URL it was loaded with.
    expect(row(0).querySelector("img")).toHaveAttribute("src", FAILED.url);
  });

  it("discarding removes the row at once and can be taken back from the toast", async () => {
    vi.mocked(discardInboxPhotoAction).mockResolvedValue({ ok: true });
    vi.mocked(restoreInboxPhotoAction).mockResolvedValue({ ok: true });
    vi.mocked(inboxAction).mockResolvedValue({ view: view([NO_CUSTOMER]), firstId: "s-hint" });
    renderInbox([READY, NO_CUSTOMER]);

    fireEvent.click(within(row(0)).getByTestId("inbox-row-discard"));
    // Optimistic: gone before the server answered.
    expect(screen.getAllByTestId("inbox-row")).toHaveLength(1);
    expect(screen.getByTestId("inbox-count")).toHaveTextContent("1 Foto offen");
    await waitFor(() => expect(discardInboxPhotoAction).toHaveBeenCalledWith("s-ready"));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const [message, options] = vi.mocked(toast).mock.calls[0] as unknown as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Foto verworfen");
    expect(options.action.label).toBe("Rückgängig");

    vi.mocked(inboxAction).mockResolvedValue({
      view: view([READY, NO_CUSTOMER]),
      firstId: "s-ready",
    });
    options.action.onClick();
    await waitFor(() => expect(restoreInboxPhotoAction).toHaveBeenCalledWith("s-ready"));
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(2));
  });

  it("puts a row back and says so when the discard fails", async () => {
    vi.mocked(discardInboxPhotoAction).mockResolvedValue({ ok: false, error: "not_found" });
    renderInbox([READY]);
    fireEvent.click(within(row(0)).getByTestId("inbox-row-discard"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("nicht")));
    expect(screen.getAllByTestId("inbox-row")).toHaveLength(1);
  });

  it("uploads every chosen photo, counts them and reports the ones that failed", async () => {
    vi.mocked(uploadImage).mockImplementation(async (file) => {
      if ((file as File).name === "kaputt.png") throw new Error("too large");
      return { storageKey: `screenshots/${(file as File).name}` } as Awaited<
        ReturnType<typeof uploadImage>
      >;
    });
    vi.mocked(addInboxPhotosAction).mockResolvedValue({ ok: true, added: 1, skipped: 0 });
    vi.mocked(inboxAction).mockResolvedValue({
      view: view([item({ id: "s-a", status: "NEW" }), item({ id: "s-b", status: "NEW" })]),
      firstId: null,
    });
    renderInbox([]);

    const files = ["a.png", "b.png", "kaputt.png"].map(
      (name) => new File(["x"], name, { type: "image/png" }),
    );
    // A text file among them is ignored instead of failing the batch.
    files.push(new File(["x"], "notiz.txt", { type: "text/plain" }));
    fireEvent.change(screen.getByTestId("inbox-file-input"), { target: { files } });

    await waitFor(() => expect(addInboxPhotosAction).toHaveBeenCalledTimes(2));
    expect(uploadImage).toHaveBeenCalledTimes(3);
    expect(addInboxPhotosAction).toHaveBeenCalledWith(["screenshots/a.png"]);
    expect(addInboxPhotosAction).toHaveBeenCalledWith(["screenshots/b.png"]);
    expect(await screen.findByTestId("inbox-upload-failed")).toHaveTextContent(
      "1 Foto konnte nicht hochgeladen werden.",
    );
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(2));
    expect(screen.queryByTestId("inbox-uploading")).not.toBeInTheDocument();
  });
});
