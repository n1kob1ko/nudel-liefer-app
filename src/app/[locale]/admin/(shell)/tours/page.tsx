import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { AuditTimeline } from "@/components/admin/audit-timeline";
import { PageHeader } from "@/components/admin/page-header";
import { TourDateField } from "@/components/admin/tour-date-field";
import { TourPlanner } from "@/components/admin/tour-planner";
import { LoadingSkeleton } from "@/components/shared/states";
import { getMapTileConfig } from "@/lib/map-config";
import { tourHistoryQuery } from "@/server/audit-queries";
import { requirePageActor } from "@/server/auth/page-guards";
import { getLivePollIntervalMs } from "@/server/tour-progress";
import { tourPlanQuery } from "@/server/tour-queries";

/** Tour planning (NUD-042): `/admin/tours?date=YYYY-MM-DD` (default = next delivery date). */
async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.tours" });
  const { date, tour } = await searchParams;
  const plan = await tourPlanQuery(
    Array.isArray(date) ? date[0] : date,
    Array.isArray(tour) ? tour[0] : tour,
  );
  const history = plan.tour ? await tourHistoryQuery(plan.tour.id) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} actions={<TourDateField value={plan.date} />} />
      <TourPlanner
        key={plan.tour?.id ?? "none"}
        plan={plan}
        tiles={getMapTileConfig()}
        pollIntervalMs={getLivePollIntervalMs()}
      />
      {history ? <AuditTimeline entries={history} /> : null}
    </div>
  );
}

export default async function Page({ searchParams, params }: PageProps<"/[locale]/admin/tours">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
