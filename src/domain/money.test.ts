import { describe, expect, it } from "vitest";

import {
  amountInputValue,
  isValidCents,
  MAX_AMOUNT_CENTS,
  parseAmountToCents,
  sumCents,
} from "./money";

describe("parseAmountToCents", () => {
  it("reads whole euros and both decimal separators", () => {
    expect(parseAmountToCents("42")).toBe(4200);
    expect(parseAmountToCents("42,50")).toBe(4250);
    expect(parseAmountToCents("42.5")).toBe(4250);
    expect(parseAmountToCents("0,05")).toBe(5);
    expect(parseAmountToCents(12.34)).toBe(1234);
    expect(parseAmountToCents(" 7 ")).toBe(700);
  });

  it("reads an empty field as no amount", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("   ")).toBeNull();
  });

  it("refuses what is not a plain euro amount", () => {
    for (const bad of [
      "-1",
      "1.234,56",
      "1.234",
      "1,234",
      "12,345",
      "12.3.4",
      "abc",
      "12 €",
      "1e3",
    ]) {
      expect(parseAmountToCents(bad), bad).toBeNull();
    }
    expect(parseAmountToCents(Number.NaN)).toBeNull();
    expect(parseAmountToCents(-3)).toBeNull();
    expect(parseAmountToCents(12.345)).toBeNull();
  });

  it("stays inside the allowed range", () => {
    expect(parseAmountToCents(MAX_AMOUNT_CENTS / 100)).toBe(MAX_AMOUNT_CENTS);
    expect(parseAmountToCents("9999999")).toBeNull();
  });
});

describe("isValidCents", () => {
  it("accepts whole cents only", () => {
    expect(isValidCents(0)).toBe(true);
    expect(isValidCents(1234)).toBe(true);
    expect(isValidCents(12.5)).toBe(false);
    expect(isValidCents(-1)).toBe(false);
    expect(isValidCents(MAX_AMOUNT_CENTS + 1)).toBe(false);
    expect(isValidCents("12")).toBe(false);
  });
});

describe("amountInputValue", () => {
  it("shows a plain value for the field and nothing for 'no amount'", () => {
    expect(amountInputValue(4250)).toBe("42.50");
    expect(amountInputValue(0)).toBe("0.00");
    expect(amountInputValue(null)).toBe("");
    expect(amountInputValue(undefined)).toBe("");
  });
});

describe("sumCents", () => {
  it("adds amounts and ignores missing ones", () => {
    expect(sumCents([100, null, 250, undefined])).toBe(350);
    expect(sumCents([])).toBe(0);
  });
});
