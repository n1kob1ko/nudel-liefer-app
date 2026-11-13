import { describe, expect, it } from "vitest";

import { deletionDue, purgeSelection } from "./order-retention";

const stop = (id: string, orderIds: string[], expired = true) => ({ id, orderIds, expired });

describe("purgeSelection", () => {
  it("deletes a settled order together with its stop", () => {
    expect(purgeSelection(["o1"], [stop("s1", ["o1"])])).toEqual({
      orderIds: ["o1"],
      stopIds: ["s1"],
    });
  });

  it("deletes a settled order that was never on a tour", () => {
    expect(purgeSelection(["o1"], [])).toEqual({ orderIds: ["o1"], stopIds: [] });
  });

  it("keeps the whole stop while one of its orders is not settled", () => {
    // o2 is not settled (not in the list): the stop and with it o1 stay.
    expect(purgeSelection(["o1"], [stop("s1", ["o1", "o2"])])).toEqual({
      orderIds: [],
      stopIds: [],
    });
  });

  it("keeps an order while one of its stops is still too young", () => {
    expect(purgeSelection(["o1"], [stop("s1", ["o1"]), stop("s2", ["o1"], false)])).toEqual({
      orderIds: [],
      stopIds: [],
    });
  });

  it("follows the chain: an order kept by one stop keeps its other stops and their orders", () => {
    // o3 is not settled -> s2 stays -> o2 stays -> s1 stays -> o1 stays. o4 is free of all that.
    const selection = purgeSelection(
      ["o1", "o2", "o4"],
      [stop("s1", ["o1", "o2"]), stop("s2", ["o2", "o3"]), stop("s3", ["o4"])],
    );
    expect(selection).toEqual({ orderIds: ["o4"], stopIds: ["s3"] });
  });

  it("deletes an old stop that carries no order at all", () => {
    expect(purgeSelection([], [stop("s1", []), stop("s2", [], false)])).toEqual({
      orderIds: [],
      stopIds: ["s1"],
    });
  });
});

describe("deletionDue", () => {
  it("is the moment the period after the payment is over", () => {
    expect(deletionDue(new Date("2026-10-01T09:30:00Z"), 30)).toEqual(
      new Date("2026-10-31T09:30:00Z"),
    );
  });
});
