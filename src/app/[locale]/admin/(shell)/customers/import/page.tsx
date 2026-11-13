import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerImport } from "@/components/admin/customer-import";
import { LoadingSkeleton } from "@/components/shared/states";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";
import { parkingQueueCountQuery } from "@/server/customer-queries";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const queueCount = await parkingQueueCountQuery();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/customers" className="link text-sm">
          {t("backToList")}
        </Link>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("import.title")}
        </h1>
        <p className="max-w-prose text-muted-foreground">{t("import.description")}</p>
      </div>
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
