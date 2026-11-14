import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderInbox } from "@/components/admin/order-inbox";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { type AppLocale, pick } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderInboxQuery } from "@/server/order-queries";
import { activeProductsQuery } from "@/server/product-queries";

/**
 * The order inbox (NUD-210): many photos of orders at once. The app reads them in the background
 * and proposes the customer; the office checks each one in the order form and confirms it.
 */
async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const [inbox, products] = await Promise.all([orderInboxQuery(), activeProductsQuery()]);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("inbox.title")}
        info={t("inbox.info")}
        back={{ href: "/admin/orders", label: t("backToList") }}
      />
      <OrderInbox
        initial={inbox.view}
        firstId={inbox.firstId}
        aiAvailable={inbox.aiAvailable}
        products={products.map((p) => ({
          id: p.id,
          name: pick(p.name, locale as AppLocale),
          unit: p.unit,
        }))}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/orders/inbox">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
