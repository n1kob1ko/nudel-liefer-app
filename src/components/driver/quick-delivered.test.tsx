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
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/offline/outbox-browser", () => ({
  enqueueMutation: mocks.enqueue,
  undoStopStatus: mocks.undo,
}));
vi.mock("@/lib/offline/browser", () => ({ requestOfflineSync: mocks.requestOfflineSync }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

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

function renderIn(locale: string, tourStops = stops("PENDING", "PENDING")) {
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
      <QuickDeliveredButton stop={STOP} stops={tourStops} />
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
