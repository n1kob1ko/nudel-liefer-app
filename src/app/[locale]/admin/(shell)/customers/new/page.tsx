import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import {
  CustomerForm,
  EMPTY_KEY_VALUES,
  EMPTY_OFFICE_VALUES,
} from "@/components/admin/customer-form";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { nextCustomerNumberQuery } from "@/server/customer-queries";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const suggestion = await nextCustomerNumberQuery();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/admin/customers", label: t("backToList") }} title={t("new")} />
      <CustomerForm
        customerId={null}
        tiles={getMapTileConfig()}
        initial={{
          customerNumber: suggestion,
          name: "",
          street: "",
          postalCode: "",
          city: "",
          country: "AT",
          pin: null,
          deliveryHoursInfo: "",
          notes: "",
          office: EMPTY_OFFICE_VALUES,
          key: EMPTY_KEY_VALUES,
          abbreviation: "",
        }}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
