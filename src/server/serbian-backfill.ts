import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { type AppLocale, type LocalizedText, localizedTextSchema } from "@/lib/localized-text";

import { completeTranslation } from "./translator/localize";
import type { Translator } from "./translator/types";

/**
 * One-off backfill of the Serbian (Latin) texts (NUD-150, decision log NUD-140): before the
 * language-model translator existed, `completeTranslation` left `sr-Latn` empty **and not pending** -
 * deliberately, because a retry job that can never succeed would fill itself. Existing rows are
 * therefore invisible to the retry job and need one pass; everything saved from now on gets its
 * Serbian text immediately (or is queued when the provider is briefly down).
 */

export type BackfillColumn = "notes" | "problemNote" | "name";

export type SerbianBackfillSource = {
  name: string;
  column: BackfillColumn;
  /** Rows in pages of `limit`, ordered by id; the caller filters out the complete ones. */
  find(
    db: BackfillDb,
    limit: number,
    cursor: string | undefined,
  ): Promise<{ id: string; value: unknown }[]>;
  /** Writes only when the stored text is still the version that was read. */
  save(db: BackfillDb, id: string, previous: LocalizedText, next: LocalizedText): Promise<boolean>;
};

export type BackfillDb = Pick<PrismaClient, "customer" | "stop" | "product">;

const json = (text: LocalizedText) => text as unknown as Prisma.InputJsonValue;

/** Guard against overwriting a text an office user edited between read and write. */
const unchanged = (column: BackfillColumn, previous: LocalizedText) =>
  [{ [column]: { path: ["meta", "updatedAt"], equals: previous.meta.updatedAt } }] as const;

function paginate(
  model: "customer" | "stop" | "product",
  column: BackfillColumn,
): SerbianBackfillSource {
  return {
    name: `${model}.${column}`,
    column,
    async find(db, limit, cursor) {
      const rows = await (
        db[model] as unknown as {
          findMany: (args: unknown) => Promise<{ id: string; [key: string]: unknown }[]>;
        }
      ).findMany({
        select: { id: true, [column]: true },
        orderBy: { id: "asc" },
        take: limit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return rows.map((row) => ({ id: row.id, value: row[column] }));
    },
    async save(db, id, previous, next) {
      const result = await (
        db[model] as unknown as {
          updateMany: (args: unknown) => Promise<{ count: number }>;
        }
      ).updateMany({
        where: { id, AND: [...unchanged(column, previous)] },
        data: { [column]: json(next) },
      });
      return result.count === 1;
    },
  };
}

export const SERBIAN_SOURCES: readonly SerbianBackfillSource[] = [
  paginate("customer", "notes"),
  paginate("stop", "problemNote"),
  paginate("product", "name"),
];

/** True when the text carries a source text but no Serbian one. */
export function needsSerbian(value: unknown): value is LocalizedText {
  const parsed = localizedTextSchema.safeParse(value);
  if (!parsed.success) return false;
  const current = parsed.data["sr-Latn"];
  if (current !== undefined && current.trim() !== "") return false;
  const source = parsed.data[parsed.data.meta.source];
  return source !== undefined && source.trim() !== "";
}

export type SerbianBackfillReport = {
  examined: number;
  filled: number;
  skipped: number;
  failed: number;
  apply: boolean;
  bySource: Record<string, { examined: number; filled: number; failed: number }>;
};

/** Fills `sr-Latn` on every row that lacks it. `apply: false` only counts (the default). */
export async function backfillSerbian(
  deps: { db: BackfillDb; translator: Translator; now?: Date; pageSize?: number },
  options: { apply: boolean; targets?: readonly AppLocale[] },
): Promise<SerbianBackfillReport> {
  const pageSize = deps.pageSize ?? 200;
  const now = deps.now ?? new Date();
  const report: SerbianBackfillReport = {
    examined: 0,
    filled: 0,
    skipped: 0,
    failed: 0,
    apply: options.apply,
    bySource: {},
  };
  for (const source of SERBIAN_SOURCES) {
    const counts = (report.bySource[source.name] ??= { examined: 0, filled: 0, failed: 0 });
    let cursor: string | undefined;
    for (;;) {
      const rows = await source.find(deps.db, pageSize, cursor);
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      for (const row of rows) {
        report.examined++;
        counts.examined++;
        if (!needsSerbian(row.value)) {
          report.skipped++;
          continue;
        }
        const next = await completeTranslation(row.value, deps.translator, now, ["sr-Latn"]).catch(
          () => null,
        );
        const filled = next?.["sr-Latn"];
        if (!next || filled === undefined || filled.trim() === "") {
          report.failed++;
          counts.failed++;
          continue;
        }
        if (!options.apply) {
          report.filled++;
          counts.filled++;
          continue;
        }
        const written = await source.save(deps.db, row.id, row.value, next);
        if (written) {
          report.filled++;
          counts.filled++;
        } else {
          report.skipped++;
        }
      }
      if (rows.length < pageSize) break;
    }
  }
  return report;
}
