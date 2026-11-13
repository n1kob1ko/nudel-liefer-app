import { isCronAuthorized } from "./cron-auth";
import { getDb } from "./db";
import { type OrderRetentionReport, purgeSettledOrders } from "./order-retention";
import { getStorage } from "./storage";

export type OrderRetentionCronDeps = {
  secret: string | undefined;
  run: () => Promise<OrderRetentionReport>;
};

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET /api/cron/order-retention` (NUD-201), run daily: deletes orders, their stops and tours and
 * the monthly "paid" notes `ORDER_RETENTION_DAYS` (default 30) after they were paid. What is not
 * paid stays. `ORDER_RETENTION_MODE` defaults to `dry-run` (counts only). Bearer `CRON_SECRET`
 * like the other cron routes; fails closed without a configured secret. The response and one log
 * line carry the counts only; the run is not written to the audit log (no user action, no actor,
 * see `audit-coverage.test.ts`).
 */
export async function handleOrderRetentionCron(
  request: Request,
  deps: Partial<OrderRetentionCronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const report = await (
      deps.run ?? (() => purgeSettledOrders({ db: getDb(), storage: getStorage() }))
    )();
    console.info(`[order-retention] ${JSON.stringify(report)}`);
    return Response.json(
      { status: report.screenshotsFailed > 0 ? "partial" : "ok", ...report },
      { headers: noStore },
    );
  } catch (error) {
    console.error(
      "[order-retention] run failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ status: "error" }, { status: 503, headers: noStore });
  }
}
