import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.products" });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/admin/products", label: t("backToList") }} title={t("new")} />
      <ProductForm
        productId={null}
        unitLocked={false}
        initial={{
          sku: "",
          unit: "PACK",
          weightKgPerUnit: "",
          de: "",
          hans: "",
          en: "",
          sr: "",
          cs: "",
          enAuto: true,
          srAuto: true,
          csAuto: true,
        }}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/products/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
