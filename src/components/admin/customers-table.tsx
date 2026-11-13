"use client";

import {
  ArchiveIcon,
  ImageOffIcon,
  type LucideIcon,
  MapPinOffIcon,
  PencilIcon,
  StickyNoteIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActions } from "@/components/ui/row-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { customerListQuery } from "@/lib/customer-list-params";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import { setCustomerActiveAction } from "@/server/customer-actions";
import type { CustomerListResult, CustomerListRow } from "@/server/customers";

type Filters = {
  q: string;
  status: "active" | "archived" | "all";
  photosMissing: boolean;
  parkingMissing: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts
    .map((part) => [...part][0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

/**
 * Does the customer have a delivery note? `notes` is a `LocalizedText` (or `null`); the icon shows
 * when the locale's fallback chain yields any non-empty text — the same rule `pick` uses to render
 * the note on the customer detail page.
 */
function hasNote(notes: unknown, locale: AppLocale): boolean {
  const parsed = localizedTextSchema.safeParse(notes);
  return parsed.success && pick(parsed.data, locale).trim() !== "";
}

/**
 * Customers list (re-design.md §8.5/§8.10): a real `<table>` with 48 px rows and a sticky header,
 * initials avatars, the number in mono, and the "Hinweise" flags as named icons with tooltips (an
 * accessible name in the tooltip alone is not enough — each flag carries `sr-only` text too). Every
 * row has exactly one visible control: the `RowActions` overflow menu (edit, deactivate/reactivate).
 * All `data-testid`s of `tests/e2e/customers.spec.ts` and `customer-form.spec.ts` are unchanged.
 */
export function CustomersTable({
  result,
  filters,
}: {
  result: CustomerListResult;
  filters: Filters;
}) {
  const t = useTranslations("admin.customers");
  const tc = useTranslations("common");
  const filtered =
    filters.q.trim() !== "" ||
    filters.status !== "active" ||
    filters.photosMissing ||
    filters.parkingMissing;
  const pageHref = (page: number) => ({
    pathname: "/admin/customers" as const,
    query: customerListQuery({ ...filters, page }),
  });

  if (result.total === 0) {
    return (
      <EmptyState
        title={filtered ? t("emptyFilteredTitle") : t("emptyTitle")}
        description={filtered ? t("emptyFiltered") : t("empty")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Table surface data-testid="customers-table" aria-label={t("title")}>
        <TableHeader data-sticky>
          <TableRow>
            <TableHead className="max-md:w-full">{t("columns.customer")}</TableHead>
            <TableHead className="max-md:hidden">{t("columns.number")}</TableHead>
            <TableHead className="max-md:hidden">{t("columns.city")}</TableHead>
            {/* A phone has no width for two more column titles: there the icons and the menu
                speak for themselves, and the titles stay for screen readers. */}
            <TableHead>
              <span className="max-sm:sr-only">{t("columns.flags")}</span>
            </TableHead>
            <TableHead className="w-12 text-end">
              <span className="max-sm:sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((c) => (
            <CustomerRow key={c.id} customer={c} />
          ))}
        </TableBody>
      </Table>
      {result.pageCount > 1 ? (
        <nav
          aria-label={t("pagination.label")}
          className="flex items-center justify-between gap-3"
          data-testid="pagination"
        >
          <PageLink disabled={result.page <= 1} href={pageHref(result.page - 1)} testId="page-prev">
            {tc("actions.back")}
          </PageLink>
          <span className="text-base">
            {t("pagination.status", { page: result.page, pageCount: result.pageCount })}
          </span>
          <PageLink
            disabled={result.page >= result.pageCount}
            href={pageHref(result.page + 1)}
            testId="page-next"
          >
            {tc("actions.next")}
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function CustomerRow({ customer }: { customer: CustomerListRow }) {
  const t = useTranslations("admin.customers");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const active = customer.active;

  function apply(next: boolean) {
    startTransition(async () => {
      let result;
      try {
        result = await setCustomerActiveAction(customer.id, next);
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return void toast.error(tc("errors.generic"));
      setOpen(false);
      toast.success(t(next ? "detail.restored" : "detail.archived"));
      router.refresh();
    });
  }

  return (
    <TableRow data-testid="customer-row" data-number={customer.customerNumber}>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            // Neutral on purpose: a colour per customer would read as a status (DESIGN.md, rule 3).
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground max-sm:hidden"
          >
            {initials(customer.name)}
          </span>
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/admin/customers/${customer.id}`}
              className="link break-words"
              data-testid="customer-link"
            >
              {customer.name}
            </Link>
            <span className="text-sm text-muted-foreground">{customer.street}</span>
            <span className="text-sm text-muted-foreground md:hidden">
              <span className="font-mono tabular-nums">{customer.customerNumber}</span> ·{" "}
              {customer.postalCode} {customer.city}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm text-muted-foreground tabular-nums max-md:hidden">
        {customer.customerNumber}
      </TableCell>
      <TableCell className="max-md:hidden">
        {customer.postalCode} {customer.city}
      </TableCell>
      <TableCell>
        <FlagList customer={customer} />
      </TableCell>
      <TableCell className="text-end">
        <RowActions label={t("rowMenu.label", { name: customer.name })}>
          <DropdownMenuItem asChild>
            <Link href={`/admin/customers/${customer.id}/edit`} data-testid="customer-row-edit">
              <PencilIcon aria-hidden />
              {tc("actions.edit")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen(true)} data-testid="customer-row-deactivate">
            {active ? <ArchiveIcon aria-hidden /> : null}
            {t(active ? "actions.deactivate" : "actions.reactivate")}
          </DropdownMenuItem>
        </RowActions>
      </TableCell>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("detail.archiveTitle")}</DialogTitle>
            <DialogDescription>{t("detail.archiveDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              variant={active ? "destructive" : "default"}
              disabled={pending}
              onClick={() => apply(!active)}
              data-testid="customer-row-deactivate-confirm"
            >
              {active ? t("actions.deactivate") : t("actions.reactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableRow>
  );
}

/**
 * "Hinweise" column (re-design.md §8.5): the icon flags the toolbar filters by, for **every** row
 * whose data matches — `photosMissing` and `parkingMissing` are exactly the predicates of the two
 * filter chips, `!active` marks an archived customer, and `StickyNote` marks a customer whose
 * `notes` (LocalizedText) carries text in the locale's fallback chain. A row without a single match
 * shows a muted dash, so an empty cell never reads as a rendering bug.
 */
function FlagList({ customer }: { customer: CustomerListRow }) {
  const t = useTranslations("admin.customers");
  const locale = useLocale() as AppLocale;
  const flags: { testId: string; icon: LucideIcon; title: string }[] = [];
  if (customer.photosMissing) {
    flags.push({
      testId: "flag-photos-missing",
      icon: ImageOffIcon,
      title: t("flags.photosMissing"),
    });
  }
  if (customer.parkingMissing) {
    flags.push({
      testId: "flag-parking-missing",
      icon: MapPinOffIcon,
      title: t("flags.parkingMissing"),
    });
  }
  if (hasNote(customer.notes, locale)) {
    flags.push({
      testId: "flag-notes",
      icon: StickyNoteIcon,
      title: t("flags.notes"),
    });
  }
  if (!customer.active) {
    flags.push({ testId: "flag-archived", icon: ArchiveIcon, title: t("flags.archived") });
  }

  if (flags.length === 0) {
    return (
      <span className="text-muted-foreground" aria-hidden>
        —
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1 sm:flex-wrap">
      {flags.map((flag) => (
        <Flag key={flag.testId} testId={flag.testId} icon={flag.icon} title={flag.title} />
      ))}
    </div>
  );
}

/** One "Hinweis" flag: an icon with sr-only text, a tooltip and a keyboard focus stop. */
function Flag({ testId, icon: Icon, title }: { testId: string; icon: LucideIcon; title: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid={testId}
            tabIndex={0}
            className="inline-flex size-6 items-center justify-center rounded-md text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <Icon className="size-4" aria-hidden />
            <span className="sr-only">{title}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PageLink({
  disabled,
  href,
  testId,
  children,
}: {
  disabled: boolean;
  href: React.ComponentProps<typeof Link>["href"];
  testId: string;
  children: React.ReactNode;
}) {
  const className = buttonVariants({ variant: "outline" });
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} data-testid={testId}>
      {children}
    </Link>
  );
}
