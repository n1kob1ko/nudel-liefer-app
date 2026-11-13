import { z } from "zod";

import { formatCalendarDate } from "@/domain/order";
import { monthKey } from "@/domain/payment";
import { Prisma } from "@/generated/prisma/client";

import { escapeLike, searchTerms } from "./customers";
import type { PaymentsDb } from "./payments";

/**
 * The history of "paid" notes (NUD-199): every month the office marked as paid and did not take
 * back, newest note first. The amount and the number of orders are the snapshot taken when the
 * month was marked (D33), not today's sum of the orders.
 *
 * Not authorized by itself: the page checks the role before it asks.
 */

export const PAID_HISTORY_PAGE_SIZE = 50;

export type PaidHistoryRow = {
  id: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  /** `YYYY-MM-DD` of the first day of the billed month. */
  periodStart: string;
  monthKey: string;
  orderCount: number;
  amountCents: number;
  /** ISO moment the office marked the month. */
  paidAt: string;
  paidByName: string | null;
  note: string | null;
};

export type PaidHistoryResult = {
  rows: PaidHistoryRow[];
  /** Number and sum of all hits of the filter, not only of this page. */
  total: number;
  sumCents: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Years (of the billed month) that have paid notes at all, newest first: the filter's choices. */
  years: number[];
};

/** Unreadable input falls back to "no filter, first page": a list never fails over its URL. */
const inputSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2999).optional().catch(undefined),
  q: z.string().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce.number().int().min(1).max(200).catch(PAID_HISTORY_PAGE_SIZE),
});

export type PaidHistoryInput = { year?: number; q?: string; page?: number; pageSize?: number };

type RawRow = {
  id: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  periodStart: Date;
  orderCount: number;
  amountCents: number;
  paidAt: Date;
  paidByName: string | null;
  note: string | null;
};

export async function paidHistoryQuery(
  db: Pick<PaymentsDb, "$queryRaw">,
  rawInput: unknown,
): Promise<PaidHistoryResult> {
  const raw = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const input = inputSchema.parse({
    year: raw.year,
    q: raw.q ?? "",
    page: raw.page ?? 1,
    pageSize: raw.pageSize ?? PAID_HISTORY_PAGE_SIZE,
  });

  const conditions: Prisma.Sql[] = [Prisma.sql`p."voidedAt" IS NULL`];
  if (input.year !== undefined) {
    conditions.push(
      Prisma.sql`p."periodStart" >= ${new Date(Date.UTC(input.year, 0, 1))}::date`,
      Prisma.sql`p."periodStart" < ${new Date(Date.UTC(input.year + 1, 0, 1))}::date`,
    );
  }
  // Same accent-insensitive search as the customer list: "muller" finds "Müller".
  for (const term of searchTerms(input.q)) {
    conditions.push(
      Prisma.sql`c."searchText" LIKE '%' || "nudel_fold"(${escapeLike(term)}) || '%'`,
    );
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

  const [counted, years] = await Promise.all([
    db.$queryRaw<{ n: bigint; sum: bigint | null }[]>`
      SELECT count(*) AS n, sum(p."amountCents") AS sum
      FROM "MonthlyPayment" p JOIN "Customer" c ON c."id" = p."customerId"
      ${where}`,
    db.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT extract(year FROM p."periodStart")::int AS year
      FROM "MonthlyPayment" p
      WHERE p."voidedAt" IS NULL
      ORDER BY year DESC`,
  ]);
  const total = Number(counted[0]?.n ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / input.pageSize));
  // A page behind the end (a bookmark, a filter that got narrower) shows the last page.
  const page = Math.min(input.page, pageCount);

  const rows = await db.$queryRaw<RawRow[]>`
    SELECT p."id", p."customerId", c."customerNumber", c."name" AS "customerName",
           p."periodStart", p."orderCount", p."amountCents", p."paidAt", p."note",
           u."displayName" AS "paidByName"
    FROM "MonthlyPayment" p
    JOIN "Customer" c ON c."id" = p."customerId"
    LEFT JOIN "User" u ON u."id" = p."paidById"
    ${where}
    ORDER BY p."paidAt" DESC, p."id" DESC
    LIMIT ${input.pageSize} OFFSET ${(page - 1) * input.pageSize}`;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      customerNumber: row.customerNumber,
      customerName: row.customerName,
      periodStart: formatCalendarDate(row.periodStart),
      monthKey: monthKey(row.periodStart),
      orderCount: row.orderCount,
      amountCents: row.amountCents,
      paidAt: row.paidAt.toISOString(),
      paidByName: row.paidByName,
      note: row.note,
    })),
    total,
    sumCents: Number(counted[0]?.sum ?? 0),
    page,
    pageSize: input.pageSize,
    pageCount,
    years: years.map((entry) => entry.year),
  };
}
