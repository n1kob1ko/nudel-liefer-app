import { describe, expect, it, vi } from "vitest";

import { CRON_JOBS, dueJobs, matchesCron, runDue } from "../../deploy/railway/cron/dispatch.mjs";
import vercel from "../../vercel.json";

const utc = (text: string) => new Date(`${text}Z`);
const cron = (name: string) => `/api/cron/${name}`;

describe("CRON_JOBS", () => {
  it("is the list of vercel.json: one schedule, kept in two places on purpose", () => {
    // The dispatcher image holds a single file and cannot read vercel.json. A job added to one
    // list only would silently never run on Railway.
    expect([...CRON_JOBS].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [...vercel.crons].sort((a, b) => a.path.localeCompare(b.path)),
    );
  });
});

describe("matchesCron", () => {
  it("reads minute, hour, day, month and weekday in UTC", () => {
    expect(matchesCron("17 3 * * *", utc("2026-11-13T03:17:00"))).toBe(true);
    expect(matchesCron("17 3 * * *", utc("2026-11-13T03:18:00"))).toBe(false);
    expect(matchesCron("17 3 * * *", utc("2026-11-13T04:17:00"))).toBe(false);
    expect(matchesCron("*/10 * * * *", utc("2026-11-13T09:40:00"))).toBe(true);
    expect(matchesCron("*/10 * * * *", utc("2026-11-13T09:45:00"))).toBe(false);
    // 2026-11-15 is a Sunday.
    expect(matchesCron("7 4 * * 0", utc("2026-11-15T04:07:00"))).toBe(true);
    expect(matchesCron("7 4 * * 7", utc("2026-11-15T04:07:00"))).toBe(true);
    expect(matchesCron("7 4 * * 0", utc("2026-11-16T04:07:00"))).toBe(false);
    expect(matchesCron("0 6 1,15 * *", utc("2026-11-15T06:00:00"))).toBe(true);
    expect(matchesCron("0 6 1-5 12 *", utc("2026-11-03T06:00:00"))).toBe(false);
  });
  it("refuses an expression it cannot read instead of never running the job", () => {
    for (const bad of ["* * * *", "61 * * * *", "a * * * *", "*/0 * * * *", "5-1 * * * *"]) {
      expect(() => matchesCron(bad, utc("2026-11-13T00:00:00"))).toThrow(/cron/);
    }
  });
});

describe("dueJobs", () => {
  it("returns the jobs whose minute lies in the 5-minute slot that just ended", () => {
    expect(dueJobs(utc("2026-11-13T03:20:40"))).toEqual([
      cron("retry-translations"),
      cron("retention"),
    ]);
    expect(dueJobs(utc("2026-11-13T03:40:02"))).toEqual([
      cron("retry-translations"),
      cron("audit-retention"),
    ]);
    expect(dueJobs(utc("2026-11-13T03:50:02"))).toEqual([
      cron("retry-translations"),
      cron("data-retention"),
    ]);
    expect(dueJobs(utc("2026-11-13T04:00:02"))).toEqual([
      cron("retry-translations"),
      cron("order-retention"),
    ]);
    expect(dueJobs(utc("2026-11-13T02:30:02"))).toEqual([
      cron("retry-translations"),
      cron("recurring-orders"),
    ]);
  });
  it("gives a late or slightly early start the same slot, so nothing is skipped or doubled", () => {
    const onTime = dueJobs(utc("2026-11-13T03:20:00"));
    expect(dueJobs(utc("2026-11-13T03:21:00"))).toEqual(onTime);
    expect(dueJobs(utc("2026-11-13T03:24:20"))).toEqual(onTime);
    expect(dueJobs(utc("2026-11-13T03:19:45"))).toEqual(onTime);
    // The next slot no longer holds 03:17.
    expect(dueJobs(utc("2026-11-13T03:25:00"))).toEqual([]);
  });
  it("runs every job exactly once over a whole week of 5-minute slots", () => {
    const counts = new Map<string, number>();
    const start = utc("2026-11-09T00:00:00").getTime(); // a Monday
    for (let slot = 0; slot < 7 * 24 * 12; slot += 1) {
      for (const path of dueJobs(new Date(start + slot * 5 * 60_000 + 3_000))) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(counts)).toEqual({
      [cron("retry-translations")]: 7 * 24 * 6,
      [cron("recurring-orders")]: 7,
      [cron("retention")]: 7,
      [cron("audit-retention")]: 7,
      [cron("data-retention")]: 7,
      [cron("order-retention")]: 7,
      [cron("orphan-cleanup")]: 1,
    });
  });
  it("runs the weekly cleanup on Sunday only", () => {
    expect(dueJobs(utc("2026-11-15T04:10:00"))).toContain(cron("orphan-cleanup"));
    expect(dueJobs(utc("2026-11-16T04:10:00"))).not.toContain(cron("orphan-cleanup"));
  });
});

describe("runDue", () => {
  const base = {
    now: utc("2026-11-13T03:20:05"),
    baseUrl: "http://app.railway.internal:3000/",
    secret: "s3cret",
    retryDelayMs: 0,
  };

  it("calls each due route with the bearer secret", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const log = vi.fn();
    const result = await runDue({ ...base, fetchImpl, log });
    expect(result).toEqual({ ok: [cron("retry-translations"), cron("retention")], failed: [] });
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://app.railway.internal:3000/api/cron/retry-translations",
      "http://app.railway.internal:3000/api/cron/retention",
    ]);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cret");
    expect(log.mock.calls.flat().join("\n")).not.toContain("s3cret");
  });

  it("keeps going after a failing route and reports it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("retry-translations")
        ? new Response("boom", { status: 500 })
        : new Response("{}", { status: 200 }),
    );
    const result = await runDue({ ...base, fetchImpl, log: () => {} });
    expect(result).toEqual({ ok: [cron("retention")], failed: [cron("retry-translations")] });
    // A plain 500 is the job's own answer: asking again would only run it twice.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("asks once more when the app is not reachable (a deploy is swapping the container)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      if (calls === 2) return new Response("", { status: 503 });
      return new Response("{}", { status: 200 });
    });
    const result = await runDue({ ...base, fetchImpl, log: () => {} });
    // retry-translations: network error, then 503 -> failed. retention: 200.
    expect(result).toEqual({ ok: [cron("retention")], failed: [cron("retry-translations")] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does nothing in a slot without a job", async () => {
    const fetchImpl = vi.fn();
    const result = await runDue({
      ...base,
      now: utc("2026-11-13T03:25:05"),
      fetchImpl,
      log: () => {},
    });
    expect(result).toEqual({ ok: [], failed: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
