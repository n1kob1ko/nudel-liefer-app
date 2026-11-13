// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/domain/audit";

/**
 * NUD-092 guard: every server module that writes orders, tours, stops or photos either calls
 * `recordAudit` or is listed here with the reason it does not. A new write path in a new file
 * fails this test until somebody decides which of the two it is.
 */

const ROOT = join(process.cwd(), "src");
const WRITE =
  /\b(?:order|orderItem|tour|stop|stopOrder|photo|parkingSpot|screenshot|vehicle)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(/;

/** Files that write these tables and are expected to record audit entries. */
const AUDITED = [
  "server/orders.ts",
  "server/correction-delivery.ts",
  "server/tour-builder.ts",
  "server/tour-planning.ts",
  "server/tour-edit.ts",
  "server/day-planner.ts",
  "server/tour-rerelease.ts",
  "server/stop-status.ts",
  "server/customer-photos.ts",
  "server/parking-spots.ts",
  "server/customer-key.ts",
  "server/customer-abbreviation.ts",
  "server/tour-departure.ts",
  "server/vehicles.ts",
  "server/recurring-orders.ts",
  "server/customer-admin.ts",
  "server/work-schedule.ts",
  "server/standing-tours.ts",
  "server/stop-payment.ts",
  "server/payments.ts",
];

/** Writes that are deliberately not audited, with the reason. */
const EXEMPT: Record<string, string> = {
  "server/tour-schedule.ts":
    "re-anchoring the arrival times (NUD-172): a derived recomputation that always runs inside the audited release / departure / stop-status transaction and writes only `Stop.etaAt` (no business state) — same reasoning as the tour progress below",
  "server/tour-service.ts":
    "outdated flag and automatic tour progress: always part of an audited order / stop change (stop entries carry the tourStatus change)",
  "server/translation-pending.ts":
    "background fill of the German problem-note translation, no user action",
  "server/screenshot-retention.ts":
    "retention job (NUD-093): deletes screenshots older than the retention period together with their files; no user action, the run reports its counts in the cron response and the log (docs/privacy.md)",
  "server/data-retention.ts":
    "retention job (NUD-112): sets only Stop.problemNote to NULL on stops completed more than DRIVER_TEXT_RETENTION_DAYS ago (default dry-run); no user action and no actor (an audit entry needs a user id and a per-record entity, neither exists for a system job; precedent: screenshot-retention). Counts only go to the cron response and the log; the test data-retention.integration.test.ts proves that nothing else on the stop changes",
  "server/demo-seed.ts": "demo data seeding script, not an application flow",
  "server/testing/seed-customers.ts": "test helper",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(ROOT).map((path) => ({
  name: relative(ROOT, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

describe("audit coverage", () => {
  it("every module that writes orders, tours, stops or photos is audited or explicitly exempt", () => {
    const writers = files.filter((f) => WRITE.test(f.text)).map((f) => f.name);
    const unknown = writers.filter((name) => !AUDITED.includes(name) && !(name in EXEMPT));
    expect(unknown).toEqual([]);
  });

  it("the audited modules really call recordAudit", () => {
    for (const name of AUDITED) {
      const file = files.find((f) => f.name === name);
      expect(file, name).toBeDefined();
      expect(file!.text, name).toMatch(/\brecordAudit\(/);
    }
  });

  it("the exemption list has no stale entries", () => {
    for (const name of Object.keys(EXEMPT)) {
      expect(
        files.some((f) => f.name === name && WRITE.test(f.text)),
        name,
      ).toBe(true);
    }
  });

  it("every action in the vocabulary is written somewhere", () => {
    const writerText = files
      .filter((f) => AUDITED.includes(f.name))
      .map((f) => f.text)
      .join("\n");
    for (const action of AUDIT_ACTIONS) {
      expect(writerText, action).toContain(`"${action}"`);
    }
  });

  it("the audit log has no update path and exactly one delete path (the retention job)", () => {
    const offenders = files
      .filter(
        (f) =>
          /\bauditLog\.(?:update|updateMany|delete|deleteMany|upsert)\(/.test(f.text) ||
          /(?:UPDATE|TRUNCATE)\s+"?AuditLog/i.test(f.text),
      )
      .map((f) => f.name);
    expect(offenders).toEqual([]);
    const deleters = files.filter((f) => /DELETE\s+FROM\s+"?AuditLog/i.test(f.text));
    expect(deleters.map((f) => f.name)).toEqual(["server/audit-retention.ts"]);
    // The statement runs only after the transaction-local switch that the trigger honours.
    expect(deleters[0]!.text).toMatch(/set_config\('nudel\.audit_retention', 'on', true\)/);
  });

  it("only audit.ts creates audit rows", () => {
    const creators = files.filter((f) => /\bauditLog\.create/.test(f.text)).map((f) => f.name);
    expect(creators).toEqual(["server/audit.ts"]);
  });
});
