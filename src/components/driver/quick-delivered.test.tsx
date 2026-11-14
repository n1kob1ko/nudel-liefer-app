import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { QuickDeliveredButton } from "./quick-delivered";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  undo: vi.fn(),
  requestOfflineSync: vi.fn(),
  push: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/offline/outbox-browser", () => ({
  enqueueMutation: mocks.enqueue,
  undoStopStatus: mocks.undo,
}));
vi.mock("@/lib/offline/browser", () => ({ requestOfflineSync: mocks.requestOfflineSync }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};

const STOP = { id: "s1", customerName: "Trattoria Roma" };
const stops = (...statuses: string[]) =>
  statuses.map((status, i) => ({ id: `s${i + 1}`, sequence: i + 1, status }));

function renderIn(
  locale: string,
  tourStops = stops("PENDING", "PENDING"),
  stop: { id: string; customerName: string; cashDueCents?: number } = STOP,
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      <QuickDeliveredButton stop={stop} stops={tourStops} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockImplementation(async (mutation: unknown) => ({
    clientMutationId: "m1",
    ...(mutation as object),
  }));
  mocks.undo.mockResolvedValue("cancelled");
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("QuickDeliveredButton in %s", (locale) => {
  it("stays on the tour when nothing is to be collected", async () => {
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-quick-delivered"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("asks for the cash first and queues delivered with the amount (owner 2026-11-14)", async () => {
    renderIn(locale, stops("PENDING", "PENDING"), { ...STOP, cashDueCents: 15750 });
    fireEvent.click(screen.getByTestId("btn-quick-delivered"));
    // Nothing is delivered by the tap itself: the cash sheet opens with the due amount.
    const amount = await screen.findByTestId("cash-sheet-amount");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    // Nothing collected: refused with a message, still nothing queued.
    fireEvent.change(amount, { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("cash-sheet-confirm"));
    expect(await screen.findByTestId("cash-sheet-nothing")).toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    // Part of it: delivered, then the payment, both queued.
    fireEvent.change(amount, { target: { value: "100" } });
    expect(screen.getByTestId("cash-sheet-short")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cash-sheet-confirm"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(2));
    expect(mocks.enqueue.mock.calls[0]?.[0]).toEqual({
      type: "delivered",
      stopId: "s1",
      customerName: "Trattoria Roma",
    });
    expect(mocks.enqueue.mock.calls[1]?.[0]).toEqual({
      type: "payment",
      stopId: "s1",
      collectedCents: 10000,
      customerName: "Trattoria Roma",
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("marks the stop delivered with one tap and offers undo", async () => {
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-quick-delivered"));

    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith({
        type: "delivered",
        stopId: "s1",
        customerName: "Trattoria Roma",
      }),
    );
    expect(mocks.toast).toHaveBeenCalled();
    const options = mocks.toast.mock.calls.at(-1)?.[1] as {
      action?: { label: string; onClick: () => void };
    };
    expect(options.action).toBeDefined();

    options.action!.onClick();
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledWith("s1", "Trattoria Roma"));
    expect(mocks.requestOfflineSync).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalled();
  });
});

describe("QuickDeliveredButton behaviour", () => {
  it("queues one tap even when the driver taps twice quickly", async () => {
    let finish!: (value: unknown) => void;
    mocks.enqueue.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderIn("de");

    const button = screen.getByTestId("btn-quick-delivered");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    finish({ clientMutationId: "m1" });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  });

  it("offers no undo after the last stop: that tap closes the tour", async () => {
    renderIn("de", stops("PENDING", "DELIVERED"));
    fireEvent.click(screen.getByTestId("btn-quick-delivered"));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    const options = mocks.toast.mock.calls.at(-1)?.[1] as { action?: unknown };
    expect(options.action).toBeUndefined();
  });

  it("tells the driver when the phone cannot store the tap", async () => {
    mocks.enqueue.mockRejectedValue(new Error("no storage"));
    renderIn("de");
    fireEvent.click(screen.getByTestId("btn-quick-delivered"));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
