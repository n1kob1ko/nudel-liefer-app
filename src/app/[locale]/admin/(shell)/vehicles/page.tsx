import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { VehiclesManager } from "@/components/admin/vehicles-manager";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { listVehiclesQuery } from "@/server/vehicle-queries";

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout; the query re-checks the role too.
  await requirePageActor("admin", locale);
  const rows = await listVehiclesQuery();
  return (
    <div className="flex flex-col gap-5">
      <VehiclesManager rows={rows} />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/vehicles">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
