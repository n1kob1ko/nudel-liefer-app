// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  orderRetentionDays,
  orderRetentionMode,
  orderRetentionPolicy,
  type OrderRetentionReport,
} from "./order-retention";
import { handleOrderRetentionCron } from "./order-retention-cron";

describe("env parsing", () => {
  it("mode defaults to dry-run for unset and unknown values: nothing is deleted by accident", () => {
    expect(orderRetentionMode(undefined)).toBe("dry-run");
    expect(orderRetentionMode("")).toBe("dry-run");
    expect(orderRetentionMode("DELETE ")).toBe("delete");
    expect(orderRetentionMode("off")).toBe("off");
    expect(orderRetentionMode("yes")).toBe("dry-run");
    expect(orderRetentionMode("true")).toBe("dry-run");
  });

  it("period defaults to 30 days and falls back for typos and out-of-range values", () => {
    expect(orderRetentionDays(undefined)).toBe(30);
    expect(orderRetentionDays(" 60 ")).toBe(60);
    expect(orderRetentionDays("7")).toBe(7);
    for (const bad of ["0", "1", "6", "-1", "1.5", "abc", "1e3", "3651", ""]) {
      expect(orderRetentionDays(bad), bad).toBe(30);
    }
  });

  it("tells the pages that deleting is on only in delete mode", () => {
    expect(orderRetentionPolicy({ ORDER_RETENTION_MODE: "delete" })).toEqual({
      active: true,
      days: 30,
    });
    expect(
      orderRetentionPolicy({ ORDER_RETENTION_MODE: "delete", ORDER_RETENTION_DAYS: "45" }),
    ).toEqual({ active: true, days: 45 });
    expect(orderRetentionPolicy({ ORDER_RETENTION_MODE: "dry-run" }).active).toBe(false);
    expect(orderRetentionPolicy({ ORDER_RETENTION_MODE: "off" }).active).toBe(false);
    expect(orderRetentionPolicy({}).active).toBe(false);
  });
});

describe("GET /api/cron/order-retention", () => {
  const report: OrderRetentionReport = {
    mode: "delete",
    retentionDays: 30,
    cutoff: "2026-09-18T03:00:00.000Z",
    cutoffDay: "2026-09-18",
    orders: 3,
    stops: 2,
    tours: 1,
    payments: 1,
    adjustments: 0,
    screenshots: 1,
    screenshotsFailed: 0,
    batches: 1,
    more: false,
  };
  const request = (authorization?: string) =>
    new Request("http://localhost/api/cron/order-retention", {
      headers: authorization ? { authorization } : {},
    });

  it("rejects a call without the cron secret and does not run", async () => {
    const run = vi.fn(async () => report);
    for (const call of [request(), request("Bearer wrong")]) {
      const response = await handleOrderRetentionCron(call, { secret: "s3cret", run });
      expect(response.status).toBe(401);
    }
    const unset = await handleOrderRetentionCron(request("Bearer "), { secret: undefined, run });
    expect(unset.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs with the secret and answers with the counts, never cached", async () => {
    const run = vi.fn(async () => report);
    const response = await handleOrderRetentionCron(request("Bearer s3cret"), {
      secret: "s3cret",
      run,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", ...report });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("says partial when screenshot files could not be removed", async () => {
    const response = await handleOrderRetentionCron(request("Bearer s3cret"), {
      secret: "s3cret",
      run: async () => ({ ...report, screenshotsFailed: 2 }),
    });
    expect((await response.json()).status).toBe("partial");
  });

  it("answers 503 without details when the run fails", async () => {
    const response = await handleOrderRetentionCron(request("Bearer s3cret"), {
      secret: "s3cret",
      run: async () => {
        throw new Error("connection to 10.0.0.5 refused");
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error" });
  });
});
