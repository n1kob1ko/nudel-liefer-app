import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  hasDuplicateProducts,
  isPastDeliveryDate,
  MAX_QUANTITY,
  mergeOrderLines,
  orderInputSchema,
  orderWarnings,
  parseCalendarDate,
  parseQuantity,
} from "./order";
import { nextDeliveryDate } from "./settings";

describe("parseQuantity (whole numbers only, NUD-137)", () => {
  it.each([
    ["5", 5],
    ["  12 ", 12],
    ["99999", 99_999],
    [3, 3],
  ])("accepts %j as %d", (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "0",
    "00",
    "-1",
    "2,5", // no halves of a Sackerl or Kiste
    "2.5",
    "3.0",
    "3,00",
    "abc",
    "1,2,3",
    "1.000", // ambiguous thousands separator: rejected, not guessed
    "1e3",
    "1 000",
    "100000",
    NaN,
    Infinity,
    -3,
    0,
    2.5,
  ])("rejects %j", (input) => {
    expect(parseQuantity(input as string | number)).toBeNull();
  });
});

describe("mergeOrderLines (decision: same product twice is merged)", () => {
  it("adds quantities and keeps first-appearance order", () => {
    expect(
      mergeOrderLines([
        { productId: "a", quantity: 1 },
        { productId: "b", quantity: 25 },
        { productId: "a", quantity: 5 },
      ]),
    ).toEqual([
      { productId: "a", quantity: 6 },
      { productId: "b", quantity: 25 },
    ]);
  });

  it("returns null when the sum exceeds the maximum quantity", () => {
    expect(
      mergeOrderLines([
        { productId: "a", quantity: MAX_QUANTITY },
        { productId: "a", quantity: 1 },
      ]),
    ).toBeNull();
  });

  it("detects duplicates for the form hint", () => {
    expect(hasDuplicateProducts(["a", "b"])).toBe(false);
    expect(hasDuplicateProducts(["a", "b", "a"])).toBe(true);
  });
});

describe("calendar dates", () => {
  it("parses real days only", () => {
    expect(parseCalendarDate("2026-10-19")?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(parseCalendarDate("2028-02-29")).not.toBeNull();
    expect(parseCalendarDate("2026-02-29")).toBeNull();
    expect(parseCalendarDate("2026-13-01")).toBeNull();
    expect(parseCalendarDate("19.10.2026")).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
  });

  it("round-trips and compares days", () => {
    const d = parseCalendarDate("2026-10-19")!;
    expect(formatCalendarDate(d)).toBe("2026-10-19");
    const today = parseCalendarDate("2026-10-19")!;
    expect(isPastDeliveryDate(d, today)).toBe(false);
    expect(isPastDeliveryDate(parseCalendarDate("2026-10-18")!, today)).toBe(true);
    expect(isPastDeliveryDate(parseCalendarDate("2026-12-24")!, today)).toBe(false);
  });
});

describe("orderInputSchema", () => {
  const base = {
    customerId: "c1",
    deliveryDate: "2026-10-19",
    lines: [{ productId: "p1", quantity: "3" }],
  };

  it("accepts a valid order, defaults to CONFIRMED and reads quantities as integers", () => {
    const parsed = orderInputSchema.parse(base);
    expect(parsed.status).toBe("CONFIRMED");
    expect(parsed.internalNote).toBeNull();
    expect(parsed.deliveryDate!.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(parsed.lines).toEqual([{ productId: "p1", quantity: 3 }]);
  });

  it("accepts digit strings and numbers in the same order and merges the same product", () => {
    const parsed = orderInputSchema.parse({
      ...base,
      status: "DRAFT",
      internalNote: "  Anruf 14 Uhr  ",
      lines: [
        { productId: "p1", quantity: "2" },
        { productId: "p2", quantity: 3 },
        { productId: "p1", quantity: "4" },
      ],
    });
    expect(parsed.status).toBe("DRAFT");
    expect(parsed.internalNote).toBe("Anruf 14 Uhr");
    expect(parsed.lines).toEqual([
      { productId: "p1", quantity: 6 },
      { productId: "p2", quantity: 3 },
    ]);
  });

  it("turns an empty note into null", () => {
    expect(orderInputSchema.parse({ ...base, internalNote: "   " }).internalNote).toBeNull();
    expect(orderInputSchema.parse({ ...base, internalNote: null }).internalNote).toBeNull();
  });

  it.each([
    ["no lines", { lines: [] }],
    ["missing lines", { lines: undefined }],
    ["zero quantity", { lines: [{ productId: "p1", quantity: 0 }] }],
    ["negative quantity", { lines: [{ productId: "p1", quantity: "-1" }] }],
    ["text quantity", { lines: [{ productId: "p1", quantity: "viel" }] }],
    ["decimal with comma", { lines: [{ productId: "p1", quantity: "2,5" }] }],
    ["decimal with point", { lines: [{ productId: "p1", quantity: "2.5" }] }],
    ["fractional number", { lines: [{ productId: "p1", quantity: 2.5 }] }],
    ["empty product", { lines: [{ productId: " ", quantity: 1 }] }],
    [
      "one bad line among good ones",
      {
        lines: [
          { productId: "p1", quantity: 1 },
          { productId: "p2", quantity: 0 },
        ],
      },
    ],
    [
      "merged sum too large",
      {
        lines: [
          { productId: "p1", quantity: 99_999 },
          { productId: "p1", quantity: 1 },
        ],
      },
    ],
    [
      "too many lines",
      { lines: Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, quantity: 1 })) },
    ],
    ["no customer", { customerId: "" }],
    ["bad date", { deliveryDate: "2026-02-30" }],
    ["date in other format", { deliveryDate: "19.10.2026" }],
    ["unknown status", { status: "CANCELLED" }],
    ["long note", { internalNote: "x".repeat(1001) }],
    ["cash without amount", { paymentTerm: "ON_DELIVERY" }],
    ["cash with an empty amount", { paymentTerm: "ON_DELIVERY", amount: "  " }],
    ["cash with 0 EUR", { paymentTerm: "ON_DELIVERY", amount: "0" }],
  ])("rejects: %s", (_name, override) => {
    expect(orderInputSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });

  it("takes cash with an amount, and a monthly order without one (owner 2026-11-27)", () => {
    expect(
      orderInputSchema.parse({ ...base, paymentTerm: "ON_DELIVERY", amount: "42,50" }).amountCents,
    ).toBe(4250);
    expect(orderInputSchema.parse({ ...base, paymentTerm: "MONTHLY" }).amountCents).toBeNull();
  });
});

describe("orderWarnings", () => {
  it("warns when the day's tours are all completed (NUD-116)", () => {
    expect(orderWarnings({ confirmedOrdersOnDate: 0, tourCompletedOnDate: true })).toEqual([
      "tour_completed",
    ]);
    expect(orderWarnings({ confirmedOrdersOnDate: 2, tourCompletedOnDate: true })).toEqual([
      "combined_stop",
      "tour_completed",
    ]);
    expect(orderWarnings({ confirmedOrdersOnDate: 0, tourCompletedOnDate: false })).toEqual([]);
  });

  it("is empty for a customer without other orders", () => {
    expect(orderWarnings({ confirmedOrdersOnDate: 0 })).toEqual([]);
  });

  it("warns about combining into one stop", () => {
    expect(orderWarnings({ confirmedOrdersOnDate: 1 })).toEqual(["combined_stop"]);
  });
});

describe("default delivery date of the order form", () => {
  it("is the next delivery weekday, formatted for the date field, and always accepted", () => {
    const now = new Date("2026-10-16T08:00:00Z"); // Friday in Vienna
    const settings = { timezone: "Europe/Vienna", deliveryWeekdays: [1, 2, 3, 4, 5] };
    const formatted = formatCalendarDate(nextDeliveryDate(now, settings));
    expect(formatted).toBe("2026-10-19"); // Monday
    const parsed = parseCalendarDate(formatted)!;
    expect(isPastDeliveryDate(parsed, parseCalendarDate("2026-10-16")!)).toBe(false);
    expect(formatCalendarDate(nextDeliveryDate(now, { ...settings, deliveryWeekdays: [3] }))).toBe(
      "2026-10-21",
    ); // changed weekdays change the default
    expect(
      orderInputSchema.safeParse({
        customerId: "c",
        deliveryDate: formatted,
        lines: [{ productId: "p", quantity: 1 }],
      }).success,
    ).toBe(true);
  });
});

describe("orderInputSchema screenshotKey (NUD-031)", () => {
  const base = {
    customerId: "c1",
    deliveryDate: "2026-10-19",
    lines: [{ productId: "p1", quantity: 1 }],
  };
  const key = "screenshots/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg";

  it("accepts an upload-endpoint screenshot key and defaults to null", () => {
    expect(orderInputSchema.parse(base).screenshotKey).toBeNull();
    expect(orderInputSchema.parse({ ...base, screenshotKey: null }).screenshotKey).toBeNull();
    expect(orderInputSchema.parse({ ...base, screenshotKey: key }).screenshotKey).toBe(key);
  });

  it("rejects keys the upload endpoint would not issue", () => {
    for (const bad of [
      "customers/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg",
      "screenshots/x.jpg",
      "screenshots/3f2504e0-4f89-41d3-9a0c-0305e82c3301.svg",
      `${key}/..`,
      `x/${key}`,
      "",
      5,
    ]) {
      expect(orderInputSchema.safeParse({ ...base, screenshotKey: bad }).success, String(bad)).toBe(
        false,
      );
    }
  });
});
