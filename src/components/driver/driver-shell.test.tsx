import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { DriverShell } from "./driver-shell";

/**
 * The driver top bar (re-design.md §7.1/§7.6): date, sync chip, language select and overflow, plus
 * the accessible markers the e2e specs query (`connection-indicator`, `pending-badge`,
 * `offline-ready`). The offline store is mocked; the marker state is what is under test.
 */
const state = vi.hoisted(() => ({
  online: true,
  offline: {
    phase: "ready",
    syncing: false,
    savedAt: "2099-07-02T05:12:00.000Z",
    timezone: "Europe/Vienna",
    photos: { total: 3, cached: 3 },
  } as Record<string, unknown>,
  entries: [] as unknown[],
  failure: null as string | null,
  notices: [] as unknown[],
  flushing: false,
  inFlight: new Set<string>(),
}));

vi.mock("@/lib/offline/use-online", () => ({ useOnline: () => state.online }));
vi.mock("@/lib/offline/browser", () => ({ useOfflineStatus: () => state.offline }));
vi.mock("@/lib/offline/outbox-browser", () => ({
  useOutbox: () => ({
    entries: state.entries,
    notices: state.notices,
    failure: state.failure,
    // NUD-174: the panel reads the real flush state, not `navigator.onLine`.
    flushing: state.flushing,
    inFlight: state.inFlight,
  }),
  getOutbox: () => ({ flush: vi.fn(), dismissNotice: vi.fn() }),
}));
vi.mock("@/lib/offline/photo-outbox-browser", () => ({
  usePhotoOutbox: () => ({ entries: [] }),
}));
vi.mock("@/lib/offline/outbox-controller", () => ({}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/driver",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));

const MESSAGES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};

function show(locale: keyof typeof MESSAGES) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      <DriverShell dateLabel="17. Okt.">content</DriverShell>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.online = true;
  state.offline = { ...state.offline, phase: "ready", savedAt: "2099-07-02T05:12:00.000Z" };
  state.entries = [];
  state.failure = null;
  state.flushing = false;
  state.inFlight = new Set<string>();
});

describe.each(Object.keys(MESSAGES))("DriverShell in %s", (locale) => {
  it("renders the date, the sync chip, the language select and the overflow", () => {
    show(locale);
    expect(screen.getByTestId("driver-date")).toHaveTextContent("17. Okt.");
    expect(screen.getByTestId("sync-chip")).toBeInTheDocument();
    expect(screen.getByTestId("language-switcher")).toBeInTheDocument();
    expect(screen.getByTestId("driver-menu")).toBeInTheDocument();
    expect(screen.getByTestId("connection-indicator")).toHaveAttribute("data-online", "true");
  });

  it("keeps the 'offline ready' text in the chip's marker instead of its own line", () => {
    show(locale);
    const ready = screen.getByTestId("offline-ready");
    expect(ready).toBeInTheDocument();
    expect(ready).toHaveTextContent(/\S/);
    cleanup();
    state.offline = { ...state.offline, phase: "partial", photos: { total: 3, cached: 1 } };
    show(locale);
    expect(screen.queryByTestId("offline-ready")).toBeNull();
  });

  it("reports the offline state through the chip and the count through the badge", () => {
    state.online = false;
    state.entries = [
      {
        clientMutationId: "a",
        userId: "u",
        type: "delivered",
        stopId: "s1",
        createdAt: "2099-07-02T06:12:00.000Z",
        seq: 1,
        customerName: "Trattoria 1",
      },
    ];
    show(locale);
    expect(screen.getByTestId("connection-indicator")).toHaveAttribute("data-online", "false");
    expect(screen.getByTestId("sync-chip")).toHaveAttribute("data-state", "pending");
    expect(screen.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  });

  it("shows queued taps without a connection as waiting, not as an error", () => {
    // Multi-day run 2026-11-16: three "Geliefert" taps in a dead spot turned the chip red ("Fehler")
    // because the flush had failed with "network" — which is the normal offline case.
    state.online = false;
    state.failure = "network";
    state.entries = [
      {
        clientMutationId: "a",
        userId: "u",
        type: "delivered",
        stopId: "s1",
        createdAt: "2099-07-02T06:12:00.000Z",
        seq: 1,
        customerName: "Trattoria 1",
      },
    ];
    show(locale);
    expect(screen.getByTestId("sync-chip")).toHaveAttribute("data-state", "pending");
    cleanup();
    state.online = true;
    state.failure = "server";
    show(locale);
    expect(screen.getByTestId("sync-chip")).toHaveAttribute("data-state", "error");
  });

  it("never claims to be sending while nothing is in flight (NUD-174)", async () => {
    state.entries = [
      {
        clientMutationId: "a",
        userId: "u",
        type: "delivered",
        stopId: "s1",
        createdAt: "2099-07-02T06:12:00.000Z",
        seq: 1,
        customerName: "Trattoria 1",
      },
    ];
    show(locale);
    fireEvent.click(screen.getByTestId("sync-chip"));
    const panel = await screen.findByTestId("outbox-state");
    // no flush running: the panel says "waiting", whatever `navigator.onLine` says
    expect(panel).toHaveAttribute("data-state", "online");
    cleanup();
    state.flushing = true;
    show(locale);
    fireEvent.click(screen.getByTestId("sync-chip"));
    expect(await screen.findByTestId("outbox-state")).toHaveAttribute("data-state", "sending");
  });
});
