import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerImport } from "@/components/admin/customer-import";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { parkingQueueCountQuery } from "@/server/customer-queries";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const queueCount = await parkingQueueCountQuery();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/customers", label: t("backToList") }}
        title={t("import.title")}
        info={t("import.description")}
      />
      <CustomerImport initialQueueCount={queueCount} />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/import">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
