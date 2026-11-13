import { describe, expect, it } from "vitest";

import { paidHistoryQueryString, parsePaidHistoryParams } from "./payment-history-params";

describe("parsePaidHistoryParams", () => {
  it("reads search, year and page from the URL", () => {
    expect(parsePaidHistoryParams({ q: "müller", year: "2026", page: "3" })).toEqual({
      q: "müller",
      year: 2026,
      page: 3,
    });
  });

  it("falls back to no filter and the first page for anything it cannot read", () => {
    expect(parsePaidHistoryParams({})).toEqual({ q: "", year: null, page: 1 });
    expect(parsePaidHistoryParams({ year: "abc", page: "0" })).toEqual({
      q: "",
      year: null,
      page: 1,
    });
    expect(parsePaidHistoryParams({ year: "20260", page: "-2" }).year).toBeNull();
    expect(parsePaidHistoryParams({ q: ["a", "b"], year: ["2025", "2026"] })).toEqual({
      q: "a",
      year: 2025,
      page: 1,
    });
    expect(parsePaidHistoryParams({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("paidHistoryQueryString", () => {
  it("leaves the defaults out of the URL", () => {
    expect(paidHistoryQueryString({ q: "", year: null, page: 1 })).toEqual({});
    expect(paidHistoryQueryString({ q: " gelso ", year: 2026, page: 2 })).toEqual({
      q: " gelso ",
      year: "2026",
      page: "2",
    });
  });
});
