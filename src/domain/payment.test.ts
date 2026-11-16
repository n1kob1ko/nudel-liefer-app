import { describe, expect, it } from "vitest";

import {
  addMonths,
  applyCashCredit,
  billTotalCents,
  cashDueCents,
  cashOrders,
  cashState,
  isClosedMonth,
  monthKey,
  monthlyState,
  monthStart,
  nextMonthStart,
  openCashByCustomer,
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

describe("openCashByCustomer", () => {
  const row = (
    customerId: string,
    date: string,
    dueCents: number,
    collectedCents: number | null,
  ) => ({
    customerId,
    customerNumber: `K-${customerId}`,
    customerName: `Kunde ${customerId}`,
    date,
    dueCents,
    collectedCents,
  });

  it("sums the open money per customer, the biggest debt first", () => {
    const result = openCashByCustomer([
      row("a", "2026-11-10", 5000, 3000),
      row("b", "2026-11-11", 9000, null),
      row("a", "2026-11-09", 4000, 1000),
      row("c", "2026-11-12", 2000, 2000),
    ]);
    expect(result.map((r) => [r.customerId, r.openCents, r.stopCount, r.oldestDate])).toEqual([
      ["b", 9000, 1, "2026-11-11"],
      ["a", 5000, 2, "2026-11-09"],
    ]);
  });

  it("puts the older debt first when the sums are equal", () => {
    const result = openCashByCustomer([
      row("x", "2026-11-12", 1000, null),
      row("y", "2026-11-02", 1000, null),
    ]);
    expect(result.map((r) => r.customerId)).toEqual(["y", "x"]);
  });
});

describe("applyCashCredit (owner 2026-11-16)", () => {
  const stop = (
    stopId: string,
    customerId: string,
    date: string,
    dueCents: number,
    collectedCents: number | null,
  ) => ({ stopId, customerId, date, dueCents, collectedCents });

  it("lets an overpayment pay the customer's oldest open deliveries first", () => {
    const { owed, leftCents } = applyCashCredit([
      stop("s3", "a", "2026-11-16", 5000, 8000), // 30 EUR too much today
      stop("s2", "a", "2026-11-12", 4000, null), // open 40 EUR
      stop("s1", "a", "2026-11-10", 2000, 500), // short 15 EUR
    ]);
    expect(owed.map((r) => [r.stopId, r.creditedCents, r.openCents])).toEqual([
      ["s2", 1500, 2500],
      ["s1", 1500, 0],
    ]);
    expect(leftCents.size).toBe(0);
  });

  it("never moves money between customers and keeps a credit that is left over", () => {
    const { owed, leftCents } = applyCashCredit([
      stop("a1", "a", "2026-11-10", 1000, null),
      stop("b1", "b", "2026-11-11", 1000, 4000),
      stop("b2", "b", "2026-11-09", 1000, 0),
    ]);
    expect(owed.map((r) => [r.stopId, r.creditedCents, r.openCents])).toEqual([
      ["a1", 0, 1000],
      ["b2", 1000, 0],
    ]);
    expect(leftCents.get("b")).toBe(2000);
    expect(leftCents.has("a")).toBe(false);
  });

  it("ignores stops without cash and exact payments", () => {
    const { owed, leftCents } = applyCashCredit([
      stop("x", "a", "2026-11-10", 0, 500),
      stop("y", "a", "2026-11-11", 1000, 1000),
    ]);
    expect(owed).toEqual([]);
    expect(leftCents.size).toBe(0);
  });

  it("feeds openCashByCustomer: a fully credited delivery is no debt any more", () => {
    const { owed } = applyCashCredit([
      stop("s1", "a", "2026-11-10", 2000, null),
      stop("s2", "a", "2026-11-11", 1000, 3000),
    ]);
    const debtors = openCashByCustomer(
      owed.map((r) => ({ ...r, customerNumber: "K-a", customerName: "Kunde a" })),
    );
    expect(debtors).toEqual([]);
  });
});
