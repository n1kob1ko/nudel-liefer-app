import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { SettingsForm, type SettingsFormValues } from "@/components/admin/settings-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { DEFAULT_PROBLEM_PHONE } from "@/domain/problem-phone";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { getSettings } from "@/server/settings";

const DEFAULTS: SettingsFormValues = {
  depotName: "",
  depotAddress: "",
  depotPin: null,
  depotPinConfirmed: false,
  timezone: DEFAULT_TIMEZONE,
  departureTime: "07:00",
  serviceMinutesPerStop: 10,
  defaultLoadingMinutes: 20,
  recurringLeadDays: 14,
  deliveryWeekdays: [1, 2, 3, 4, 5],
  departureChecklist: [],
  problemPhone: DEFAULT_PROBLEM_PHONE,
};

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout.
  await requirePageActor("admin", locale);
  const settings = await getSettings();
  const initial: SettingsFormValues = settings
    ? {
        depotName: settings.depotName,
        depotAddress: settings.depotAddress,
        depotPin: { lat: settings.depotLat, lng: settings.depotLng },
        depotPinConfirmed: settings.depotPinConfirmed,
        timezone: settings.timezone,
        departureTime: settings.departureTime,
        serviceMinutesPerStop: settings.serviceMinutesPerStop,
        defaultLoadingMinutes: settings.defaultLoadingMinutes,
        recurringLeadDays: settings.recurringLeadDays,
        deliveryWeekdays: [...settings.deliveryWeekdays],
        departureChecklist: settings.departureChecklist.map((item) => ({
          id: item.id,
          text: item.text.de ?? "",
        })),
        problemPhone: settings.problemPhone,
      }
    : DEFAULTS;
  // Computed on the server so server and client render the same option list.
  const timezones = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC", initial.timezone])];
  return <SettingsForm initial={initial} timezones={timezones} tiles={getMapTileConfig()} />;
}

export default async function Page({ params }: PageProps<"/[locale]/admin/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
