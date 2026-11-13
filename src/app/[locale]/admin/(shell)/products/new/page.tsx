import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { ProductForm } from "@/components/admin/product-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.products" });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/products" className="link text-sm">
          {t("backToList")}
        </Link>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("new")}
        </h1>
      </div>
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
