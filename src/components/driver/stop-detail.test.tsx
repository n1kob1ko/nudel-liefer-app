import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DriverStopDetail } from "@/server/driver-stop";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { StopDetail } from "./stop-detail";

vi.mock("@/server/stop-status-actions", () => ({ stopStatusAction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};

function renderIn(locale: string, detail: DriverStopDetail) {
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
      <StopDetail
        detail={{ ...detail, locale: locale as DriverStopDetail["locale"] }}
        tiles={{ url: "x", attribution: "" }}
      />
    </NextIntlClientProvider>,
  );
}

const photo = { id: "p1", url: "https://s3.test/a.jpg?sig=1", width: 800, height: 600 };
const detail = (extra: Partial<DriverStopDetail> = {}): DriverStopDetail => ({
  tourId: "t1",
  tourStatus: "RELEASED",
  locale: "de",
  timezone: "Europe/Vienna",
  problemPhone: "+43 1 000 00 00",
  position: 2,
  total: 3,
  prevStopId: "s1",
  nextStopId: "s3",
  notes: { text: "Hintereingang", lang: "de" },
  deliveryHoursInfo: "Mo-Fr 8-11",
  photos: { STORE: photo, PARKING: null },
  tourStops: ["s1", "s2", "s3"].map((id, i) => ({
    id,
    sequence: i + 1,
    status: "PENDING" as const,
    problemReason: null,
    completedAt: null,
  })),
  stop: {
    id: "s2",
    sequence: 2,
    status: "PENDING",
    problemReason: null,
    completedAt: null,
    noteText: null,
    etaAt: "2099-07-02T08:15:00Z",
    legDurationS: 600,
    change: null,
    changedInRevision: null,
    customerId: "c2",
    customerNumber: "K2",
    customerName: "Trattoria Roma",
    street: "Hauptstraße 1",
    postalCode: "1010",
    city: "Wien",
    lat: 48.21,
    lng: 16.38,
    items: [
      {
        productId: "p1",
        name: "Spaghetti",
        germanName: "Spaghetti lose",
        unit: "KG",
        quantity: 13,
        previousQuantity: null,
      },
      {
        productId: "p2",
        name: "Penne",
        germanName: "Penne",
        unit: "PACK",
        quantity: 3,
        previousQuantity: null,
      },
    ],
  },
  ...extra,
});

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(Object.keys(LOCALES))("StopDetail in %s", (locale) => {
  it("renders header, photos, items, notes, navigation and stop buttons", () => {
    renderIn(locale, detail());
    expect(screen.getByTestId("stop-name")).toHaveTextContent("Trattoria Roma");
    expect(screen.getByTestId("stop-number")).toHaveTextContent("2");
    expect(screen.getByTestId("stop-address")).toHaveTextContent("Hauptstraße 1, 1010 Wien");
    expect(screen.getByTestId("navigate")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=48.21,16.38&travelmode=driving",
    );
    expect(screen.queryByTestId("navigate-apple")).toBeNull();
    // A present photo: the frame holds exactly one button (the viewer), the Replace overlay sits
    // next to the frame so both stay separate 48 px targets.
    expect(
      within(within(screen.getByTestId("photo-store")).getByTestId("photo-frame")).getAllByRole(
        "button",
      ),
    ).toHaveLength(1);
    expect(within(screen.getByTestId("photo-store")).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByTestId("photo-open-store")).toBeVisible();
    expect(screen.getByTestId("photo-replace-store")).toBeVisible();
    expect(screen.getByTestId("photo-gallery-store")).toBeVisible();
    // A missing photo: the placeholder offers "Take photo" right there (NUD-083)
    expect(within(screen.getByTestId("photo-parking")).getByTestId("photo-missing")).toBeVisible();
    expect(screen.getByTestId("photo-take-parking")).toBeVisible();
    expect(screen.getByTestId("photo-gallery-parking")).toBeVisible();
    const rows = screen.getAllByTestId("stop-item");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("item-name")).toHaveTextContent("Spaghetti");
    expect(within(rows[0]).getByTestId("item-name-de")).toHaveTextContent("Spaghetti lose");
    expect(within(rows[0]).getByTestId("item-quantity")).toHaveTextContent("13");
    expect(within(rows[1]).queryByTestId("item-name-de")).toBeNull(); // same as the shown name
    // The delivery hours live on the merged ETA line in the header. Weekdays and the "Uhr" suffix
    // follow the locale (run 3 review point 3), the rest of the free text stays as stored.
    const hours = {
      de: "Mo-Fr 8-11",
      en: "Mon-Fri 8-11",
      "sr-Latn": "pon-pet 8-11",
      cs: "Po-Pá 8-11",
      "zh-Hans": "周一-周五 8-11",
    }[locale as "de" | "en" | "sr-Latn" | "cs" | "zh-Hans"];
    expect(screen.getByTestId("stop-hours")).toHaveTextContent(hours);
    expect(screen.getByTestId("stop-eta")).toHaveTextContent(/\d{1,2}[:.]\d{2}/);
    expect(screen.getByTestId("stop-status")).toHaveAttribute("data-status", "PENDING");
    expect(screen.getByTestId("prev-stop")).toHaveAttribute("href", "/driver/stops/s1");
    expect(screen.getByTestId("next-stop")).toHaveAttribute("href", "/driver/stops/s3");
    expect(screen.getByTestId("status-actions-slot")).toBeInTheDocument();
    // The delivery card stays above the photos card, the top bar carries the position.
    expect(screen.getAllByTestId("stop-item").length).toBeGreaterThan(1);
    // No total row (owner 2026-11-16): only what this customer gets, product by product.
    expect(screen.queryByTestId("summary-total")).not.toBeInTheDocument();
    expect(screen.getByTestId("stop-position")).toHaveTextContent("2");
  });

  it("marks German-only notes with a DE badge outside German", () => {
    renderIn(locale, detail());
    expect(screen.getByTestId("stop-notes")).toHaveTextContent("Hintereingang");
    if (locale === "de") expect(screen.queryByTestId("notes-lang")).toBeNull();
    else expect(screen.getByTestId("notes-lang")).toHaveTextContent("DE");
  });

  it("shows both placeholders and disables missing neighbours without breaking", () => {
    renderIn(
      locale,
      detail({
        photos: { STORE: null, PARKING: null },
        notes: null,
        deliveryHoursInfo: null,
        prevStopId: null,
        nextStopId: null,
      }),
    );
    expect(screen.getAllByTestId("photo-missing")).toHaveLength(2);
    // The container stays in the DOM for the offline render comparison, but is not exposed.
    expect(screen.getByTestId("stop-info")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("prev-stop")).toBeDisabled();
    expect(screen.getByTestId("next-stop")).toBeDisabled();
  });
});

describe("StopDetail details", () => {
  it("has no DE badge for a translated note", () => {
    renderIn("zh-Hans", detail({ notes: { text: "按门铃", lang: "zh-Hans" } }));
    expect(screen.queryByTestId("notes-lang")).toBeNull();
  });

  it("copies the full address on tap and confirms it", async () => {
    renderIn("de", detail());
    fireEvent.click(screen.getByRole("button", { name: /Adresse kopieren/ }));
    await waitFor(() => expect(screen.getByTestId("address-copied")).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hauptstraße 1, 1010 Wien");
  });

  it("shows no Navigate button without a confirmed pin", () => {
    const d = detail();
    renderIn("de", { ...d, stop: { ...d.stop, lat: null, lng: null } });
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.getByTestId("no-pin")).toBeInTheDocument();
  });

  it("offers Apple Maps on iOS with the pin coordinates", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    renderIn("de", detail());
    expect(screen.getByTestId("navigate-apple")).toHaveAttribute(
      "href",
      "https://maps.apple.com/?daddr=48.21,16.38",
    );
    expect(screen.getByTestId("navigate")).toBeInTheDocument();
  });

  it.each(Object.keys(LOCALES))(
    "lists the Parkplätze and navigates Parkplatz first, address second in %s (NUD-126, D30)",
    (locale) => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      );
      const d = detail();
      renderIn(locale, {
        ...d,
        stop: {
          ...d.stop,
          lat: 48.5,
          lng: 16.9,
          addressLat: 48.21,
          addressLng: 16.38,
          parkingSpots: [
            { label: "Hof", note: "Tor links", lat: 48.5, lng: 16.9 },
            { label: null, note: null, lat: 48.6, lng: 17 },
          ],
        },
      });
      expect(screen.getAllByTestId("navigate")).toHaveLength(1);
      expect(screen.getByTestId("navigate")).toHaveAttribute(
        "href",
        "https://www.google.com/maps/dir/?api=1&waypoints=48.5,16.9&destination=48.21,16.38&travelmode=driving",
      );
      expect(screen.getByTestId("navigate-apple")).toHaveAttribute(
        "href",
        "https://maps.apple.com/?daddr=48.5,16.9",
      );
      const spots = screen.getAllByTestId("parking-spot");
      expect(spots).toHaveLength(2);
      expect(spots[0]).toHaveTextContent("Hof");
      expect(spots[0]).toHaveTextContent("Tor links");
      expect(spots[0]).toHaveAttribute("data-default", "true");
      expect(spots[1]).toHaveAttribute("data-default", "false");
    },
  );

  it.each(Object.keys(LOCALES))(
    "shows no Parkplatz list but the button to set one for a customer without one in %s",
    (locale) => {
      renderIn(locale, detail());
      expect(screen.queryByTestId("parking-spots")).toBeNull();
      expect(screen.getByTestId("parking-empty")).toBeInTheDocument();
      expect(screen.getByTestId("parking-set")).toBeInTheDocument();
    },
  );
});
