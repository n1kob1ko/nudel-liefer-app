import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerForm } from "@/components/admin/customer-form";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { customerPhotosQuery, getCustomerQuery } from "@/server/customer-queries";

const toSlot = ({
  id,
  url,
  width,
  height,
  createdAt,
  uploadedBy,
}: {
  id: string;
  url: string;
  width: number;
  height: number;
  createdAt: Date;
  uploadedBy: { name: string; role: "ADMIN" | "DRIVER" };
}) => ({
  id,
  url,
  width,
  height,
  createdAt: createdAt.toISOString(),
  // Only drivers are named: the office knows its own uploads (NUD-083 "updated by driver X").
  driverName: uploadedBy.role === "DRIVER" ? uploadedBy.name : null,
});

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const customer = await getCustomerQuery(id);
  if (!customer) notFound();
  const photos = await customerPhotosQuery(id);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/customers/${customer.id}`, label: t("form.backToDetail") }}
        title={t("form.editTitle")}
        description={t("detail.number", { number: customer.customerNumber })}
      />
      <CustomerForm
        customerId={customer.id}
        tiles={getMapTileConfig()}
        customerName={customer.name}
        photos={{
          STORE: photos.STORE && toSlot(photos.STORE),
          PARKING: photos.PARKING && toSlot(photos.PARKING),
        }}
        initial={{
          customerNumber: customer.customerNumber,
          name: customer.name,
          street: customer.street,
          postalCode: customer.postalCode,
          city: customer.city,
          country: customer.country,
          pin:
            customer.lat !== null && customer.lng !== null
              ? { lat: customer.lat, lng: customer.lng }
              : null,
          deliveryHoursInfo: customer.deliveryHoursInfo ?? "",
          notes: customer.notes,
          office: {
            companyName: customer.companyName ?? "",
            vatId: customer.vatId ?? "",
            billingStreet: customer.billingStreet ?? "",
            billingPostalCode: customer.billingPostalCode ?? "",
            billingCity: customer.billingCity ?? "",
          },
          key: {
            hasKey: customer.hasKey === null ? "unknown" : customer.hasKey ? "yes" : "no",
            keyNumber: customer.keyNumber ?? "",
          },
          abbreviation: customer.abbreviation ?? "",
        }}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/[id]/edit">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} id={id} />
    </Suspense>
  );
}
