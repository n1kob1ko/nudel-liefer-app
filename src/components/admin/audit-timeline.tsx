import { ChevronDownIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import type { AuditAction } from "@/domain/audit";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { AuditDetail, AuditEntryView, AuditProductLine } from "@/server/audit-history";

/** Message keys cannot contain dots: `order.update` is stored as `order_update`. */
type ActionKey = ReplaceDot<AuditAction>;
type ReplaceDot<S extends string> = S extends `${infer A}.${infer B}` ? `${A}_${B}` : S;
type Translate = ReturnType<typeof useTranslations<"admin.history">>;

/** Above this many entries the history starts collapsed (re-design.md §8.4). */
const COLLAPSE_THRESHOLD = 5;

function productName(line: AuditProductLine, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(line.productName);
  return (parsed.success ? pick(parsed.data, locale) : "") || line.sku;
}

/**
 * Compact history of an order or a tour (NUD-092): newest entry first, each with what happened,
 * who did it (office or driver), when, and the details that changed. Quantities show
 * before -> after with the product name in the viewer's language.
 *
 * Presentation follows re-design.md §8.4: a vertical timeline (dot + time + actor + text) in a
 * `Card`, collapsed by default once it grows past five entries. Append-only: nothing here edits.
 */
export function AuditTimeline({ entries }: { entries: AuditEntryView[] }) {
  const t = useTranslations("admin.history");
  const tc = useTranslations("common");
  // Quantities without a product name next to them ("22 Sackerl", "3 Stück") use the word forms
  // under `driver.unitsTotal` (§9.3); "×" only exists in front of a product name.
  const tu = useTranslations("driver.unitsTotal");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const money = useFormatter();

  const qty = (cents: number) => fmt.quantity(cents / 100);
  const euro = (cents: number | null) =>
    cents === null
      ? t("values.none")
      : money.number(cents / 100, { style: "currency", currency: "EUR" });

  const lineText = (line: AuditProductLine) => {
    // The unit always follows the quantity it belongs to, so the plural follows that one.
    const unitOf = () => tu(line.unit as "KG" | "PACK" | "CRATE" | "PIECE");
    const change =
      line.before === null && line.after !== null
        ? `${qty(line.after)} ${unitOf()} (${t("line.added")})`
        : line.after === null && line.before !== null
          ? `${qty(line.before)} ${unitOf()} → ${t("line.removed")}`
          : `${qty(line.before ?? 0)} → ${qty(line.after ?? 0)} ${unitOf()}`;
    return `${productName(line, locale)}: ${change}`;
  };

  const value = (detail: Extract<AuditDetail, { kind: "field" }>, v: string | null): string => {
    if (v === null || v === "") return t("values.none");
    switch (detail.type) {
      case "orderStatus":
        return tc(`statuses.order.${v as "DRAFT" | "CONFIRMED" | "CANCELLED"}`);
      case "tourStatus":
        return tc(
          `statuses.tour.${v as "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED"}`,
        );
      case "stopStatus":
        return tc(`statuses.stop.${v as "PENDING" | "DELIVERED" | "PROBLEM"}`);
      case "date":
        return fmt.calendarDate(new Date(`${v}T00:00:00Z`));
      case "bool":
        return t(`values.${v === "true" ? "true" : "false"}`);
      case "text":
        return `„${v}“`;
      case "person":
        return v;
    }
  };

  const detailText = (d: AuditDetail): string => {
    switch (d.kind) {
      case "line":
        return lineText(d);
      case "field":
        return `${t(`fields.${d.field}`)}: ${
          d.before === null && d.type !== "bool"
            ? value(d, d.after)
            : t("change", { before: value(d, d.before), after: value(d, d.after) })
        }`;
      case "customer":
        return t("customer", { name: d.name, number: d.number });
      case "fact":
        return t(`facts.${d.key as "stopCount"}`, { value: d.value });
      case "sequence":
        return t("sequence", { names: d.names.join(" → ") });
      case "reason":
        return t("reason", {
          reason: tc(
            `problemReasons.${d.reason as "CLOSED" | "NOBODY_THERE" | "NO_PARKING" | "WRONG_QUANTITY" | "REFUSED" | "ADDRESS_NOT_FOUND" | "OTHER"}`,
          ),
        });
      case "note":
        return t("note", { text: d.text });
      case "tapped":
        return t("tapped", { time: fmt.dateTime(new Date(d.at)) });
      case "photo":
        return `${t(`photo.${d.photoKind as "STORE" | "PARKING"}`)}, ${t(`photo.via.${d.via}`)}`;
      case "money":
        return `${t("money.collected")}: ${
          d.before === null
            ? euro(d.after)
            : t("change", { before: euro(d.before), after: euro(d.after) })
        }${d.dueCents !== null ? ` (${t("money.due", { amount: euro(d.dueCents) })})` : ""}`;
      case "stopGroup":
        return "";
    }
  };

  const heading = (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id="audit-history" className="text-xl font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
    </div>
  );

  if (entries.length === 0) {
    return (
      <Card className="gap-1 p-5" aria-labelledby="audit-history" data-testid="audit-timeline">
        {heading}
        <p className="text-base text-muted-foreground" data-testid="audit-empty">
          {t("empty")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="gap-0 p-0" aria-labelledby="audit-history" data-testid="audit-timeline">
      <details open={entries.length > COLLAPSE_THRESHOLD ? undefined : true} className="group">
        <summary
          data-testid="audit-toggle"
          className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        >
          {heading}
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            {t("entriesCount", { count: entries.length })}
            <ChevronDownIcon
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </span>
        </summary>
        <ol className="ms-6 flex flex-col gap-5 border-s-2 border-border pb-5 ps-5">
          {entries.map((entry) => (
            <Entry
              key={entry.id}
              entry={entry}
              t={t}
              dateTime={fmt.dateTime(new Date(entry.at))}
              detailText={detailText}
              lineText={lineText}
            />
          ))}
        </ol>
      </details>
    </Card>
  );
}

function Entry({
  entry,
  t,
  dateTime,
  detailText,
  lineText,
}: {
  entry: AuditEntryView;
  t: Translate;
  dateTime: string;
  detailText: (d: AuditDetail) => string;
  lineText: (l: AuditProductLine) => string;
}) {
  return (
    <li
      className="relative flex flex-col gap-1"
      data-testid="audit-entry"
      data-action={entry.action}
    >
      <span
        aria-hidden
        className="absolute -start-[1.625rem] top-1.5 size-2.5 rounded-full bg-muted-foreground ring-4 ring-card"
      />
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-base font-semibold" data-testid="audit-action">
          {t(`actions.${entry.action.replace(".", "_") as ActionKey}`)}
        </span>
        <span className="text-sm text-muted-foreground" data-testid="audit-meta">
          <time dateTime={entry.at}>{dateTime}</time> ·{" "}
          {entry.actor
            ? `${entry.actor.name} (${t(`roles.${entry.actor.role}`)})`
            : t("unknownActor")}
        </span>
      </div>
      {entry.details.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-base">
          {entry.details.map((d, index) =>
            d.kind === "stopGroup" ? (
              <li key={index} data-testid="audit-stop-group">
                <span className="font-medium">
                  {t(`stopGroup.${d.change}`)}: {d.name} ({d.number})
                </span>
                <ul className="ml-4 list-disc">
                  {d.lines.map((l) => (
                    <li key={l.productId} data-testid="audit-line" data-product-id={l.productId}>
                      {lineText(l)}
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li
                key={index}
                data-testid={d.kind === "line" ? "audit-line" : "audit-detail"}
                data-product-id={d.kind === "line" ? d.productId : undefined}
              >
                {detailText(d)}
              </li>
            ),
          )}
        </ul>
      ) : null}
    </li>
  );
}
