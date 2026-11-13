import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderForm } from "@/components/admin/order-form";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { formatCalendarDate } from "@/domain/order";
import { type AppLocale, LOCALES, pick } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { isOrderExtractorAvailable } from "@/server/order-extractor";
import { orderableCustomersQuery } from "@/server/order-queries";
import { activeProductsQuery } from "@/server/product-queries";
import { getDefaultDeliveryDate } from "@/server/settings";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const [customers, products, defaultDate] = await Promise.all([
    orderableCustomersQuery(),
    activeProductsQuery(),
    getDefaultDeliveryDate(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("newTitle")} back={{ href: "/admin/orders", label: t("backToList") }} />
      <OrderForm
        aiAvailable={isOrderExtractorAvailable()}
        defaultDate={formatCalendarDate(defaultDate)}
        customers={customers.map((c) => ({
          value: c.id,
          label: `${c.customerNumber} · ${c.name}, ${c.city}`,
          keywords: [c.customerNumber, c.name, c.street, c.postalCode, c.city],
        }))}
        products={products.map((p) => ({
          value: p.id,
          label: `${pick(p.name, locale as AppLocale)} (${p.sku})`,
          keywords: [p.sku, ...LOCALES.flatMap((l) => (p.name[l] ? [p.name[l]] : []))],
          unit: p.unit,
        }))}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/orders/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
