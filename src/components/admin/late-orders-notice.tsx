import { TriangleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { OrderOverviewRow } from "@/server/orders";

/**
 * Order overview (NUD-099): confirmed orders whose delivery day already has a COMPLETED tour are
 * on no tour. One notice per day with a link to the planning page, where the follow-up tour is
 * created.
 */
export function LateOrdersNotice({ orders }: { orders: OrderOverviewRow[] }) {
  const t = useTranslations("admin.orders.late");
  const fmt = createAppFormatters(useFormatter());
  const days = new Map<string, { date: Date; count: number }>();
  for (const order of orders) {
    if (!order.late) continue;
    const key = formatCalendarDate(order.deliveryDate);
    const entry = days.get(key) ?? { date: order.deliveryDate, count: 0 };
    entry.count += 1;
    days.set(key, entry);
  }
  if (days.size === 0) return null;
  return (
    <Alert variant="destructive" data-testid="late-orders-notice">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        <p>{t("body")}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {[...days.entries()].map(([key, day]) => (
            <li key={key} data-testid="late-orders-day" data-date={key}>
              <Link
                href={`/admin/planning?date=${key}`}
                className="font-medium underline"
                data-testid="late-orders-link"
              >
                {fmt.calendarDate(day.date)}
              </Link>{" "}
              – {t("count", { count: day.count })}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
