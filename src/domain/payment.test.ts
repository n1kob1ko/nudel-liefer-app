import { describe, expect, it } from "vitest";

import {
  addMonths,
  billTotalCents,
  cashDueCents,
  cashOrders,
  cashState,
  isClosedMonth,
  monthKey,
  monthlyState,
  monthStart,
  nextMonthStart,
  parseMonthKey,
  signedAdjustmentCents,
} from "./payment";

const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

const order = (paymentTerm: string, amountCents: number | null) => ({ paymentTerm, amountCents });

describe("cash due at a stop", () => {
  it("sums only the ON_DELIVERY amounts", () => {
    expect(
      cashDueCents([order("MONTHLY", 5000), order("ON_DELIVERY", 1200), order("ON_DELIVERY", 300)]),
    ).toBe(1500);
    expect(cashOrders([order("MONTHLY", 5000), order("ON_DELIVERY", 1200)])).toHaveLength(1);
  });

  it("counts an order without an amount as 0 and a stop without cash orders as nothing", () => {
    expect(cashDueCents([order("ON_DELIVERY", null)])).toBe(0);
    expect(cashDueCents([order("MONTHLY", 5000)])).toBe(0);
    expect(cashDueCents([])).toBe(0);
  });
});

describe("cashState", () => {
  it("distinguishes nothing to collect, open, exact, short and over", () => {
    expect(cashState(0, null)).toBe("none");
    expect(cashState(1500, null)).toBe("open");
    expect(cashState(1500, undefined)).toBe("open");
    expect(cashState(1500, 1500)).toBe("exact");
    expect(cashState(1500, 1000)).toBe("short");
    expect(cashState(1500, 2000)).toBe("over");
  });
});

describe("month helpers", () => {
  it("finds the month start and the next month", () => {
    expect(monthKey(monthStart(date("2026-11-17")))).toBe("2026-11");
    expect(monthKey(monthStart(date("2026-12-01")))).toBe("2026-12");
    expect(monthKey(nextMonthStart(monthStart(date("2026-12-01"))))).toBe("2027-01");
    expect(monthKey(addMonths(monthStart(date("2026-01-31")), -1))).toBe("2025-12");
  });

  it("parses YYYY-MM and refuses anything else", () => {
    expect(monthKey(parseMonthKey("2026-03")!)).toBe("2026-03");
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-3")).toBeNull();
    expect(parseMonthKey(" März")).toBeNull();
    expect(parseMonthKey("1999-12")).toBeNull();
  });

  it("knows when a month is over", () => {
    const november = monthStart(date("2026-11-01"));
    expect(isClosedMonth(november, date("2026-11-30"))).toBe(false);
    expect(isClosedMonth(november, date("2026-12-01"))).toBe(true);
    expect(isClosedMonth(november, date("2027-01-15"))).toBe(true);
  });

  it("gives a customer-month its office state", () => {
    const today = date("2026-12-03");
    const november = monthStart(date("2026-11-01"));
    const december = monthStart(date("2026-12-01"));
    expect(monthlyState({ periodStart: november, today, paid: true, orderCount: 4 })).toBe("paid");
    expect(monthlyState({ periodStart: november, today, paid: false, orderCount: 4 })).toBe("open");
    expect(monthlyState({ periodStart: december, today, paid: false, orderCount: 4 })).toBe(
      "current",
    );
    expect(monthlyState({ periodStart: november, today, paid: false, orderCount: 0 })).toBe(
      "current",
    );
  });
});

describe("corrections on a monthly bill (NUD-197)", () => {
  it("a deduction lowers the bill, a surcharge raises it", () => {
    expect(signedAdjustmentCents("deduction", 1000)).toBe(-1000);
    expect(signedAdjustmentCents("surcharge", 1000)).toBe(1000);
  });

  it("the total is the orders plus the signed corrections", () => {
    expect(billTotalCents([5000, 2500], [-1000, 250])).toBe(6750);
    expect(billTotalCents([5000], [])).toBe(5000);
  });

  it("an order without an amount counts as 0, and a credit larger than the orders goes below 0", () => {
    expect(billTotalCents([null, 3000], [-500])).toBe(2500);
    expect(billTotalCents([1000], [-2500])).toBe(-1500);
  });
});
