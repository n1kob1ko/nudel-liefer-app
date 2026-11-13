import { PlusIcon, UploadIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerFilters } from "@/components/admin/customer-filters";
import { CustomersTable } from "@/components/admin/customers-table";
import { PageHeader } from "@/components/admin/page-header";
import { LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { parseCustomerListParams } from "@/lib/customer-list-params";
import { requirePageActor } from "@/server/auth/page-guards";
import { listCustomersQuery } from "@/server/customer-queries";

async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Defence in depth behind the proxy and the admin layout; the query re-checks the role too.
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const input = parseCustomerListParams(await searchParams);
  const result = await listCustomersQuery(input);
  const filters = {
    q: input.q,
    status: input.status,
    photosMissing: input.photosMissing,
    parkingMissing: input.parkingMissing,
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={
          <span className="tabular-nums" data-testid="customer-count" aria-live="polite">
            {tc("itemsCount", { count: result.total })}
          </span>
        }
        actions={
          <>
            <Link
              href="/admin/customers/import"
              className={buttonVariants({ variant: "outline" })}
              data-testid="import-customers"
            >
              <UploadIcon aria-hidden />
              {t("import.link")}
            </Link>
            <Link
              href="/admin/customers/new"
              className={buttonVariants()}
              data-testid="new-customer"
            >
              <PlusIcon aria-hidden />
              {t("new")}
            </Link>
          </>
        }
      >
        <CustomerFilters values={filters} />
      </PageHeader>
      <CustomersTable result={result} filters={filters} />
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/customers">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" rows={8} />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
