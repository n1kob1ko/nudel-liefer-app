import { handleOrderRetentionCron } from "@/server/order-retention-cron";

// Vercel Cron (vercel.json) calls this once a day; a run deletes at most 5 000 settled orders.
export const maxDuration = 60;

/** Deleting settled orders (NUD-201). Dry-run unless ORDER_RETENTION_MODE=delete. */
export async function GET(request: Request) {
  return handleOrderRetentionCron(request);
}
