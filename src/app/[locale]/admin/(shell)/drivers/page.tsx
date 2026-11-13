import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import {
  type UserListRow,
  UsersManager,
  type UserUtilization,
} from "@/components/admin/users-manager";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { getFactoryTimezone } from "@/server/settings";
import { listUsers } from "@/server/users";
import { factoryToday, weekUtilization } from "@/server/utilization";
import { listWorkSchedules } from "@/server/work-schedule";

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout.
  const actor = await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.drivers" });
  const db = getDb();
  const [drivers, admins] = await Promise.all([listUsers(db, "DRIVER"), listUsers(db, "ADMIN")]);
  const timezone = await getFactoryTimezone();
  // NUD-152: working days/hours and the utilization of the current week per driver.
  const driverIds = drivers.map((driver) => driver.id);
  const [schedules, utilization] = await Promise.all([
    listWorkSchedules(db, driverIds),
    weekUtilization(db, factoryToday(new Date(), timezone), driverIds),
  ]);
  const toRow = (u: Awaited<ReturnType<typeof listUsers>>[number]): UserListRow => ({
    id: u.id,
    displayName: u.displayName,
    username: u.username,
    email: u.email,
    locale: u.locale,
    active: u.active,
    // The ISO value stays raw; the client renders relative time plus the absolute tooltip.
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
  });
  const utilizationById: Record<string, UserUtilization> = {};
  for (const [driverId, totals] of utilization) {
    utilizationById[driverId] = {
      percent: totals.percent,
      actualMinutes: totals.actualMinutes,
      contractMinutes: totals.contractMinutes,
    };
  }
  return (
    <UsersManager
      title={t("title")}
      drivers={drivers.map(toRow)}
      admins={admins.map(toRow)}
      currentUserId={actor.id}
      timezone={timezone}
      schedules={Object.fromEntries(schedules)}
      utilization={utilizationById}
    />
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/drivers">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
