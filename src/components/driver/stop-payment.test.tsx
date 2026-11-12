import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { StopPayment } from "./stop-payment";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/offline/outbox-browser", () => ({ enqueueMutation: mocks.enqueue }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};

type StopProps = Parameters<typeof StopPayment>[0]["stop"];
const deliveredStop: StopProps = {
  id: "s1",
  customerName: "Trattoria Roma",
  status: "DELIVERED",
  cashDueCents: 4250,
  collectedCents: null,
};

function renderIn(locale: string, stop: StopProps = deliveredStop) {
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
      <StopPayment stop={stop} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockImplementation(async (mutation: unknown) => ({
    clientMutationId: "m1",
    ...(mutation as object),
  }));
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("StopPayment in %s", (locale) => {
  it("prefills what is due and queues the collected amount", async () => {
    renderIn(locale);

    expect(screen.getByTestId("stop-payment")).toBeInTheDocument();
    expect(screen.getByTestId("payment-amount")).toHaveValue("42.50");

    fireEvent.change(screen.getByTestId("payment-amount"), { target: { value: "40,00" } });
    fireEvent.click(screen.getByTestId("payment-save"));

    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith({
        type: "payment",
        stopId: "s1",
        collectedCents: 4000,
        customerName: "Trattoria Roma",
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalled();
  });
});

describe("StopPayment behaviour", () => {
  it("renders nothing when the stop has no cash order", () => {
    renderIn("de", { ...deliveredStop, cashDueCents: 0, collectedCents: null });
    expect(screen.queryByTestId("stop-payment")).toBeNull();
  });

  it("shows the collected amount with the shortfall and lets the office driver change it", () => {
    renderIn("de", { ...deliveredStop, collectedCents: 4000 });
    expect(screen.getByTestId("payment-collected")).toHaveTextContent("40,00");
    expect(screen.getByTestId("payment-edit")).toBeInTheDocument();
    expect(screen.getByTestId("stop-payment").dataset.state).toBe("short");
  });

  it("cannot save before the stop is delivered", () => {
    renderIn("de", { ...deliveredStop, status: "PENDING" });
    expect(screen.getByTestId("payment-need-delivery")).toBeInTheDocument();
    expect(screen.getByTestId("payment-save")).toBeDisabled();
  });

  it("refuses an amount that is not a plain euro value", () => {
    renderIn("de");
    fireEvent.change(screen.getByTestId("payment-amount"), { target: { value: "1.234,56" } });
    expect(screen.getByTestId("payment-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("payment-save"));
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("tells the driver when the phone cannot store the tap", async () => {
    mocks.enqueue.mockRejectedValue(new Error("no storage"));
    renderIn("de");
    fireEvent.click(screen.getByTestId("payment-save"));
    await waitFor(() => expect(screen.getByTestId("payment-error")).toBeInTheDocument());
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
