/**
 * Cron dispatcher for Railway (NUD-202, docs/deploy-railway.md).
 *
 * Vercel called the `/api/cron/*` routes by itself and the dedicated server had seven lines in
 * /etc/cron.d. A Railway cron service has exactly one schedule, so this one small service runs
 * every 5 minutes (`*\/5 * * * *`), works out which jobs fell due in the slot that just ended and
 * calls them over the private network with `Authorization: Bearer $CRON_SECRET`.
 *
 * One file without dependencies on purpose: the image is `node:22-alpine` plus this file, and
 * Node 22 runs it directly (type stripping), so only erasable TypeScript may be used here - no
 * enums, no parameter properties, no imports from the repository.
 *
 * Variables: APP_URL (e.g. http://app.railway.internal:3000), CRON_SECRET (the app's own value).
 * Exit code 1 when a variable is missing or a job failed, so Railway shows the run as failed.
 */
import { pathToFileURL } from "node:url";

/**
 * The same seven entries as `vercel.json` (times in UTC); scripts/railway/cron-dispatch.test.ts
 * fails when the two lists differ.
 */
export const CRON_JOBS: readonly { path: string; schedule: string }[] = [
  { path: "/api/cron/retry-translations", schedule: "*/10 * * * *" },
  { path: "/api/cron/recurring-orders", schedule: "27 2 * * *" },
  { path: "/api/cron/retention", schedule: "17 3 * * *" },
  { path: "/api/cron/audit-retention", schedule: "37 3 * * *" },
  { path: "/api/cron/data-retention", schedule: "47 3 * * *" },
  { path: "/api/cron/order-retention", schedule: "57 3 * * *" },
  { path: "/api/cron/orphan-cleanup", schedule: "7 4 * * 0" },
];

const SLOT_MINUTES = 5;
/** Railway may start a run a moment before the full minute; that still belongs to the new slot. */
const EARLY_START_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;
/** Statuses of a proxy or a container that is being swapped, not an answer of the job itself. */
const RETRY_STATUSES = new Set([502, 503, 504]);

/** One cron field: `*`, `*\/n`, a number, a range `a-b`, or a comma list of those. */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  const fail = (): never => {
    throw new Error(`cannot read the cron field "${field}"`);
  };
  let matched = false;
  for (const part of field.split(",")) {
    const step = /^\*\/(\d+)$/.exec(part);
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (part === "*") {
      matched = true;
    } else if (step) {
      const every = Number(step[1]);
      if (every < 1) fail();
      if ((value - min) % every === 0) matched = true;
    } else if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < min || to > max || from > to) fail();
      if (value >= from && value <= to) matched = true;
    } else if (/^\d+$/.test(part)) {
      const exact = Number(part);
      if (exact < min || exact > max) fail();
      if (exact === value) matched = true;
    } else {
      fail();
    }
  }
  return matched;
}

/**
 * True when the 5-field cron expression (minute hour day-of-month month day-of-week, UTC) matches
 * the minute of `at`. Weekday 0 and 7 are both Sunday. As in cron, a restricted day-of-month and a
 * restricted weekday match when either does.
 */
export function matchesCron(expression: string, at: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cannot read the cron expression "${expression}"`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const weekday = at.getUTCDay();
  const dom = fieldMatches(dayOfMonth, at.getUTCDate(), 1, 31);
  const dow =
    fieldMatches(dayOfWeek, weekday, 0, 7) || (weekday === 0 && fieldMatches(dayOfWeek, 7, 0, 7));
  const day = dayOfMonth !== "*" && dayOfWeek !== "*" ? dom || dow : dom && dow;
  return (
    fieldMatches(minute, at.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour, at.getUTCHours(), 0, 23) &&
    fieldMatches(month, at.getUTCMonth() + 1, 1, 12) &&
    day
  );
}

/**
 * The paths that fell due in the slot that ended at the last multiple of `slotMinutes` (counted
 * from the full hour). The slot, not the wall clock of the start, decides: a run that starts at
 * 03:20:00, 03:21:10 or 03:24:50 handles the minutes 03:16..03:20, the next one 03:21..03:25. So a
 * late start skips nothing and a second start within the slot would call the same (idempotent) jobs.
 */
export function dueJobs(now: Date, slotMinutes: number = SLOT_MINUTES): string[] {
  const slotMs = slotMinutes * 60_000;
  const slotEnd = Math.floor((now.getTime() + EARLY_START_MS) / slotMs) * slotMs;
  const due: string[] = [];
  for (const job of CRON_JOBS) {
    for (let minute = slotMinutes - 1; minute >= 0; minute -= 1) {
      if (matchesCron(job.schedule, new Date(slotEnd - minute * 60_000))) {
        due.push(job.path);
        break;
      }
    }
  }
  return due;
}

export type RunOptions = {
  now: Date;
  /** Address of the app inside the project, with or without a trailing slash. */
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  /** Pause before the one retry of an unreachable app. */
  retryDelayMs?: number;
};

/**
 * Calls every due job, one after the other. A job that fails does not stop the others. An app that
 * cannot be reached (network error, 502/503/504 while a deploy swaps the container) is asked once
 * more; any other answer is the job's own and is not repeated.
 */
export async function runDue(options: RunOptions): Promise<{ ok: string[]; failed: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((line: string) => console.log(line));
  const base = options.baseUrl.replace(/\/+$/, "");
  const ok: string[] = [];
  const failed: string[] = [];

  for (const path of dueJobs(options.now)) {
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt += 1) {
      const started = Date.now();
      let outcome: string;
      let retry = false;
      try {
        const response = await fetchImpl(`${base}${path}`, {
          headers: { Authorization: `Bearer ${options.secret}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) {
          done = true;
          outcome = `HTTP ${response.status}`;
        } else {
          retry = RETRY_STATUSES.has(response.status);
          const body = (await response.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
          outcome = `HTTP ${response.status}${body ? ` ${body}` : ""}`;
        }
      } catch (error) {
        retry = true;
        outcome = `no answer (${error instanceof Error ? error.message : String(error)})`;
      }
      log(`[cron] ${path} -> ${outcome} (${Date.now() - started} ms, attempt ${attempt})`);
      if (done || !retry) break;
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 20_000));
      }
    }
    (done ? ok : failed).push(path);
  }
  return { ok, failed };
}

async function main(): Promise<number> {
  const baseUrl = process.env.APP_URL?.trim();
  const secret = process.env.CRON_SECRET?.trim();
  if (!baseUrl || !secret) {
    console.error("[cron] APP_URL and CRON_SECRET must be set");
    return 1;
  }
  const now = new Date();
  const result = await runDue({ now, baseUrl, secret });
  if (result.ok.length + result.failed.length === 0) {
    console.log(`[cron] ${now.toISOString()}: nothing due in this slot`);
  }
  if (result.failed.length > 0) {
    console.error(`[cron] FAILED: ${result.failed.join(", ")}`);
    return 1;
  }
  return 0;
}

// Only when started as a program (`node dispatch.mts`), not when a test imports the functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`[cron] failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
