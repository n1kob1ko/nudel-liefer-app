type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Filter and page of `/admin/payments/history` as they stand in the URL (NUD-199). */
export type PaidHistoryParams = { q: string; year: number | null; page: number };

/** URL search params -> filter (anything unreadable falls back to "no filter, first page"). */
export function parsePaidHistoryParams(raw: Raw): PaidHistoryParams {
  const year = first(raw.year) ?? "";
  const page = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    q: (first(raw.q) ?? "").slice(0, 100),
    year: /^2\d{3}$/.test(year) ? Number(year) : null,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
  };
}

/** Filter -> URL query (defaults omitted). */
export function paidHistoryQueryString(params: PaidHistoryParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.q.trim()) query.q = params.q;
  if (params.year !== null) query.year = String(params.year);
  if (params.page > 1) query.page = String(params.page);
  return query;
}
