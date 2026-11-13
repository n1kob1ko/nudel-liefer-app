import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { getProductQuery } from "@/server/product-queries";

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const product = await getProductQuery(id);
  if (!product) notFound();
  const t = await getTranslations({ locale, namespace: "admin.products" });
  const { id: productId, unitLocked } = product;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/products", label: t("backToList") }}
        title={t("editTitle")}
      />
      <ProductForm productId={productId} unitLocked={unitLocked} initial={product} />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/products/[id]/edit">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} id={id} />
    </Suspense>
  );
}
