import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderForm } from "@/components/admin/order-form";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { formatCalendarDate } from "@/domain/order";
import { redirect } from "@/i18n/navigation";
import { type AppLocale, LOCALES, pick } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { isOrderExtractorAvailable } from "@/server/order-extractor";
import { inboxPrefillQuery, orderableCustomersQuery } from "@/server/order-queries";
import { activeProductsQuery } from "@/server/product-queries";
import { getDefaultDeliveryDate } from "@/server/settings";

async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  // `?inbox=<id>`: one photo of the order inbox is checked (NUD-210).
  const inboxId = (await searchParams).inbox;
  const [customers, products, defaultDate, inbox] = await Promise.all([
    orderableCustomersQuery(),
    activeProductsQuery(),
    getDefaultDeliveryDate(),
    typeof inboxId === "string" ? inboxPrefillQuery(inboxId) : null,
  ]);
  // The photo is gone (saved by somebody else, discarded): back to what is still waiting.
  if (inboxId !== undefined && !inbox) return redirect({ href: "/admin/orders/inbox", locale });
  return (
    <div className="flex flex-col gap-6">
      {inbox ? (
        <PageHeader
          title={t("form.inbox.title")}
          description={t("form.inbox.remaining", { count: inbox.remaining })}
          back={{ href: "/admin/orders/inbox", label: t("form.inbox.back") }}
        />
      ) : (
        <PageHeader title={t("newTitle")} back={{ href: "/admin/orders", label: t("backToList") }} />
      )}
      <OrderForm
        // A new photo is a new form: nothing of the previous photo may stay in the fields.
        key={inbox?.id ?? "new"}
        inbox={inbox ?? undefined}
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

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/orders/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
