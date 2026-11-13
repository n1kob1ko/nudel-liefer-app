import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { TodayTour } from "@/components/driver/today-tour";
import { UpcomingTours } from "@/components/driver/upcoming-tours";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import type { AppLocale } from "@/lib/localized-text";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { driverDayQuery } from "@/server/driver-today";
import { driverUpcomingQuery } from "@/server/driver-upcoming";

async function Today({ locale }: { locale: string }) {
  await requirePageActor("driver", locale);
  const t = await getTranslations({ locale, namespace: "driver" });
  // NUD-163: the active tour plus every other open tour of the day (usually none).
  // NUD-205: the tours of the coming days, as a preview below today's tour.
  const [{ primary: today, others }, upcoming] = await Promise.all([
    driverDayQuery(locale as AppLocale),
    driverUpcomingQuery(locale as AppLocale),
  ]);
  const stopCount =
    (today?.stops.length ?? 0) + others.reduce((sum, tour) => sum + tour.stops.length, 0);
  const hasTour = today !== null && stopCount > 0;
  return (
    <>
      {hasTour ? null : (
        // The tour screen brings its own (visually hidden) h1: exactly one h1 per page (QA-03).
        <h1 className="sr-only" data-testid="driver-title">
          {t("today.pageTitle")}
        </h1>
      )}
      {today && hasTour ? (
        <TodayTour today={today} others={others} tiles={getMapTileConfig()} />
      ) : (
        <EmptyState
          title={t("today.emptyTitle")}
          description={t("today.emptyDescription")}
          action={<LogoutButton locale={locale} />}
        />
      )}
      <UpcomingTours tours={upcoming.tours} timezone={upcoming.timezone} />
    </>
  );
}

export default async function DriverTodayPage({ params }: PageProps<"/[locale]/driver">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" rows={6} />}>
      <Today locale={locale} />
    </Suspense>
  );
}
