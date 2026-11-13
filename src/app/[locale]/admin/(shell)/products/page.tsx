import { PlusIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { ProductsTable } from "@/components/admin/products-table";
import { LoadingSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";
import { listProductsQuery } from "@/server/product-queries";

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout; the query re-checks the role too.
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.products" });
  const rows = await listProductsQuery();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        actions={
          // A link styled as a button: the header action is navigation, so it stays a real `<a>`.
          <Button asChild data-testid="new-product">
            <Link href="/admin/products/new">
              <PlusIcon aria-hidden />
              {t("new")}
            </Link>
          </Button>
        }
      />
      <ProductsTable rows={rows} />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/products">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
