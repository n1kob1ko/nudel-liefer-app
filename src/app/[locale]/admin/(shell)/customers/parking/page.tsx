import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { ParkingQueue } from "@/components/admin/parking-queue";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { parkingQueueQuery } from "@/server/customer-queries";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers.parkingQueue" });
  const items = await parkingQueueQuery();
  // A new key restarts the queue after "reload" (router.refresh keeps client state otherwise).
  const version = `${items.length}:${items.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), "")}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/customers", label: t("toList") }}
        title={t("title")}
        info={t("description")}
      />
      {items.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("empty")}>
          <Link href="/admin/customers" className={buttonVariants({ variant: "outline" })}>
            {t("toList")}
          </Link>
        </EmptyState>
      ) : (
        <ParkingQueue key={version} items={items} tiles={getMapTileConfig()} />
      )}
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/parking">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
