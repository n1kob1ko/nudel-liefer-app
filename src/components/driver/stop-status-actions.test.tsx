import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { StopStatusActions } from "./stop-status-actions";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  undo: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  outbox: {
    userId: "u1",
    entries: [] as unknown[],
    inFlight: new Set<string>(),
    notices: [],
    flushing: false,
    failure: null,
    confirmed: {},
  },
}));
vi.mock("@/lib/offline/outbox-browser", () => ({
  enqueueMutation: mocks.enqueue,
  undoStopStatus: mocks.undo,
  useOutbox: () => mocks.outbox,
}));
vi.mock("@/lib/offline/browser", () => ({ requestOfflineSync: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};

type StopProps = Parameters<typeof StopStatusActions>[0]["stop"];
const pendingStop: StopProps = {
  id: "s1",
  customerName: "Trattoria Roma",
  status: "PENDING",
  problemReason: null,
  completedAt: null,
};
const tourOf = (...statuses: string[]) =>
  statuses.map((status, i) => ({ id: `s${i + 1}`, sequence: i + 1, status }));
const queued = (type: string, stopId = "s1", id = "m1") => ({
  clientMutationId: id,
  userId: "u1",
  type,
  stopId,
  createdAt: "2099-07-02T08:00:00.000Z",
  seq: 1,
  customerName: "Trattoria Roma",
});

function renderIn(
  locale: string,
  stop: StopProps = pendingStop,
  tourStatus = "RELEASED",
  props: { tourStops?: ReturnType<typeof tourOf>; offline?: boolean } = {},
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
      <StopStatusActions
        stop={stop}
        tourStops={props.tourStops ?? tourOf("PENDING", "PENDING", "PENDING")}
        tourStatus={tourStatus}
        timezone="Europe/Vienna"
        offline={props.offline}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.outbox.entries = [];
  mocks.outbox.inFlight = new Set();
  mocks.enqueue.mockImplementation(async (m) => ({ clientMutationId: "m1", ...m }));
  mocks.undo.mockResolvedValue("cancelled");
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("StopStatusActions in %s", (locale) => {
  it("queues one delivered tap per double tap, opens the next stop and offers Undo", async () => {
    let finish!: (value: unknown) => void;
    mocks.enqueue.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderIn(locale);
    const button = screen.getByTestId("btn-delivered");
    expect(screen.getByTestId("btn-problem")).toBeVisible();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "delivered",
      stopId: "s1",
      customerName: "Trattoria Roma",
    });
    await act(async () => finish({ clientMutationId: "m1" }));
    // NUD-176 (QA F1): no automatic jump to the next stop — the result card offers it, and the
    // undo therefore stays reachable.
    expect(mocks.push).not.toHaveBeenCalled();
    // Toast with an Undo action; pressing it undoes the stop and goes back to it.
    const [message, options] = mocks.toast.mock.calls[0];
    expect(message).toContain("Trattoria Roma");
    expect(options.action.label).toBeTruthy();
    await act(async () => options.action.onClick());
    expect(mocks.undo).toHaveBeenCalledWith("s1", "Trattoria Roma");
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith("/driver/stops/s1"));
  });

  it("reports a problem with a reason and a free text", async () => {
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-problem"));
    const submit = await screen.findByTestId("problem-submit");
    expect(submit).toBeDisabled(); // a reason is required
    const reasons = within(screen.getByTestId("problem-reasons")).getAllByRole("button");
    expect(reasons).toHaveLength(7);
    fireEvent.click(screen.getByTestId("reason-NO_PARKING"));
    expect(screen.getByTestId("reason-NO_PARKING")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByTestId("problem-note"), { target: { value: "  Baustelle  " } });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "problem",
      stopId: "s1",
      customerName: "Trattoria Roma",
      reason: "NO_PARKING",
      note: "Baustelle",
    });
    // NUD-176: reporting a problem stays on the stop as well.
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("stays on the last stop and offers no undo then", async () => {
    renderIn(locale, pendingStop, "RELEASED", { tourStops: tourOf("PENDING", "DELIVERED") });
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toast.mock.calls[0][1].action).toBeUndefined();
  });

  it("keeps the buttons usable offline and says the tap is kept on the phone", async () => {
    renderIn(locale, pendingStop, "RELEASED", { offline: true });
    expect(screen.getByTestId("status-offline-notice")).toBeVisible();
    expect(screen.getByTestId("btn-delivered")).toBeEnabled();
    expect(screen.getByTestId("btn-problem")).toBeEnabled();
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
  });

  it("does not navigate and says so when the phone cannot store the tap", async () => {
    mocks.enqueue.mockRejectedValue(new Error("no storage"));
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-delivered"));
    expect(await screen.findByTestId("status-error")).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("shows the result of a completed stop with Undo only inside the window", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T08:04:00Z"));
    const done: StopProps = {
      ...pendingStop,
      status: "PROBLEM",
      problemReason: "NOBODY_THERE",
      completedAt: "2099-07-02T08:00:00Z",
    };
    const view = renderIn(locale, done);
    expect(screen.getByTestId("stop-result")).toHaveAttribute("data-status", "PROBLEM");
    expect(screen.getByTestId("stop-result-text")).toBeVisible();
    expect(screen.getByTestId("undo")).toBeVisible();
    expect(screen.queryByTestId("btn-delivered")).toBeNull();
    view.unmount();
    vi.setSystemTime(new Date("2099-07-02T08:06:00Z"));
    renderIn(locale, done);
    expect(screen.queryByTestId("undo")).toBeNull();
    vi.useRealTimers();
  });

  it("shows the delivered strip and a Weiter action in the sticky bar after delivery", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T08:04:00Z"));
    renderIn(locale, {
      ...pendingStop,
      status: "DELIVERED",
      completedAt: "2099-07-02T08:00:00Z",
    });
    const bar = screen.getByTestId("stop-action-bar");
    expect(within(bar).getByTestId("stop-strip")).toHaveTextContent(/\d{2}[:.]\d{2}/);
    // The undo is offered twice on purpose: inside the result card and as the strip's inline link.
    expect(within(bar).getByTestId("strip-undo")).toBeVisible();
    expect(screen.getByTestId("next-stop-action")).toHaveAttribute("href", "/driver/stops/s2");
    vi.useRealTimers();
  });

  it("links back to the tour when nothing is pending any more", () => {
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00Z" },
      "RELEASED",
      {
        tourStops: tourOf("DELIVERED", "DELIVERED"),
      },
    );
    expect(screen.getByTestId("back-to-tour-action")).toHaveAttribute("href", "/driver");
    expect(screen.queryByTestId("next-stop-action")).toBeNull();
  });

  it("offers no undo once the tour is completed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T08:01:00Z"));
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00Z" },
      "COMPLETED",
    );
    expect(screen.getByTestId("stop-result")).toBeVisible();
    expect(screen.queryByTestId("undo")).toBeNull();
    vi.useRealTimers();
  });

  it("lets a queued completion be taken back at any time, even for the last stop", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T09:30:00Z")); // far outside the 5-minute window
    mocks.outbox.entries = [queued("delivered")];
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00.000Z" },
      "RELEASED",
      { tourStops: tourOf("DELIVERED", "DELIVERED") },
    );
    expect(screen.getByTestId("stop-pending-sync")).toBeVisible();
    expect(screen.getByTestId("undo")).toBeVisible();
    vi.useRealTimers();
  });

  it("does not offer to cancel a completion that a request carries right now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T09:30:00Z"));
    mocks.outbox.entries = [queued("delivered")];
    mocks.outbox.inFlight = new Set(["m1"]);
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00.000Z" },
      "RELEASED",
      { tourStops: tourOf("DELIVERED", "PENDING") },
    );
    // Outside the window, and the tap is on its way: nothing to cancel, no "waiting" hint either.
    expect(screen.queryByTestId("undo")).toBeNull();
    expect(screen.queryByTestId("stop-pending-sync")).toBeNull();
    vi.useRealTimers();
  });
});

describe("StopStatusActions, look (redesign RD2)", () => {
  const delivered: StopProps = {
    ...pendingStop,
    status: "DELIVERED",
    completedAt: "2099-07-02T08:00:00Z",
  };

  it("keeps Geliefert green and Problem soft red, so the two are never confused", () => {
    renderIn("de");
    expect(screen.getByTestId("btn-delivered")).toHaveClass("bg-success");
    expect(screen.getByTestId("btn-problem")).toHaveClass(
      "bg-destructive-soft",
      "text-destructive-soft-foreground",
    );
  });

  it("shows a reported problem in red and a delivery in green, from the design tokens", () => {
    const view = renderIn("de", { ...delivered, status: "PROBLEM", problemReason: "CLOSED" });
    expect(screen.getByTestId("stop-result")).toHaveClass("bg-destructive-soft");
    view.unmount();
    renderIn("de", delivered);
    expect(screen.getByTestId("stop-result")).toHaveClass("bg-success-soft");
  });

  it("confirms a delivery tapped here with one ring, and stays still on a later visit", async () => {
    const ring = () => screen.getByTestId("stop-result").querySelector('[data-slot="pulse-ring"]');
    // A stop that was already delivered when the screen opened: no ring.
    const before = renderIn("de", delivered);
    expect(ring()).toBeNull();
    before.unmount();

    // The driver taps "Geliefert"; the screen remounts the actions with the new status.
    const pending = renderIn("de");
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    pending.unmount();
    const after = renderIn("de", delivered);
    expect(ring()).not.toBeNull();
    after.unmount();

    renderIn("de", delivered);
    expect(ring()).toBeNull();
  });
});
