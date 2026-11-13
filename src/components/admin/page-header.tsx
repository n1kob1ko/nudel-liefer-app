import { ArrowLeftIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { Link } from "@/i18n/navigation";

/**
 * Admin page header (re-design.md §8.1 + §14.3) — **the shared pattern every admin page uses**:
 * `h1` on the left (plus, at most, one short line of facts such as the day or a count; no
 * instructions), primary action (at most one secondary) on the right, then an optional toolbar row
 * in the same column. A page below a list (new, edit, detail) names the way back with `back`: one
 * arrow link above the title, the same on every such page.
 *
 * ```tsx
 * <PageHeader
 *   title={t("title")}
 *   description={t("description")}
 *   actions={<Button>{t("create")}</Button>}
 * >
 *   <SearchInput /> {/* toolbar row *\/}
 * </PageHeader>
 * ```
 *
 * The `h1` carries `data-testid="section-title"` by default because the Playwright specs assert the
 * page title through it; pages that need another id (the dashboard uses `admin-title`) pass
 * `titleTestId`.
 */
export function PageHeader({
  title,
  description,
  info,
  actions,
  back,
  children,
  titleTestId = "section-title",
}: {
  title: ReactNode;
  description?: ReactNode;
  /** What is worth knowing once about this page: behind a small "i" next to the title. */
  info?: ReactNode;
  actions?: ReactNode;
  /** The way back to the list this page belongs to. */
  back?: { href: ComponentProps<typeof Link>["href"]; label: ReactNode };
  /** Toolbar row (filters/search), in the page column. */
  children?: ReactNode;
  /** Defaults to `section-title`; the dashboard passes `admin-title`. */
  titleTestId?: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-slot="page-header">
      {back ? (
        <Link
          href={back.href}
          data-testid="page-back"
          className="-my-1 inline-flex min-h-8 w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1
              data-testid={titleTestId}
              className="text-2xl leading-tight font-semibold text-balance wrap-anywhere hyphens-auto"
            >
              {title}
            </h1>
            {info ? <InfoTip testId="page-info">{info}</InfoTip> : null}
          </div>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {/* The toolbar is part of the page column: same left and right edge as the title above and
          the list below. No band across the page, no surface of its own. */}
      {children ? (
        <div data-slot="page-toolbar" className="flex flex-wrap items-end gap-x-3 gap-y-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
