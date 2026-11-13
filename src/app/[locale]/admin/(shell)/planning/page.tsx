import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { StandingPlan } from "@/components/admin/standing-plan";
import { StandingToursDialog } from "@/components/admin/standing-tours-dialog";
import { TourDateField } from "@/components/admin/tour-date-field";
import { LoadingSkeleton } from "@/components/shared/states";
import { formatCalendarDate } from "@/domain/order";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { todayIn } from "@/server/orders";
import { getDefaultDeliveryDate, getFactoryTimezone } from "@/server/settings";
import { listActiveDrivers, standingDayQuery } from "@/server/standing-tours";

/**
 * Day plan ("Tagesplanung", NUD-186): `/admin/planning?date=YYYY-MM-DD` (default = next delivery
 * day). One table per standing tour ("Stammtour") with the same customers every delivery day, the
 * quantities of that day editable in place, and the active customers of no standing tour at the
 * bottom with "add for this delivery day".
 */
async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.planning" });
  const { date } = await searchParams;
  const requested = Array.isArray(date) ? date[0] : date;
  const today = todayIn(await getFactoryTimezone());
  // Without a valid `?date=` the page opens on the next delivery day (like order entry).
  const fallback = formatCalendarDate(await getDefaultDeliveryDate());
  const plan = await standingDayQuery(getDb(), requested ?? fallback, today);
  const drivers = await listActiveDrivers(getDb());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        titleTestId="planning-title"
        actions={
          <>
            <StandingToursDialog plan={plan} drivers={drivers} />
            <TourDateField value={plan.date} />
          </>
        }
      />
      <StandingPlan plan={plan} drivers={drivers} />
    </div>
  );
}

export default async function Page({
  searchParams,
  params,
}: PageProps<"/[locale]/admin/planning">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
