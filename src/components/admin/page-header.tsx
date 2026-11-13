import type { ReactNode } from "react";

/**
 * Admin page header (re-design.md §8.1 + §14.3) — **the shared pattern every admin page uses**:
 * `h1` + one muted sentence on the left, primary action (at most one secondary) on the right, then
 * an optional toolbar row that sticks right below the 56 px top bar.
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
  actions,
  breadcrumb,
  children,
  titleTestId = "section-title",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  /** Toolbar row (filters/search) — sticks to the top when the page scrolls. */
  children?: ReactNode;
  /** Defaults to `section-title`; the dashboard passes `admin-title`. */
  titleTestId?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {breadcrumb ? (
        <nav aria-label="breadcrumb" className="text-sm text-muted-foreground">
          {breadcrumb}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            data-testid={titleTestId}
            className="text-2xl font-semibold text-balance wrap-anywhere hyphens-auto"
          >
            {title}
          </h1>
          {description ? (
            <p className="max-w-prose text-base text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? (
        <div className="sticky top-14 z-20 -mx-6 flex flex-wrap items-center gap-2 border-b bg-card px-6 py-3 lg:-mx-8 lg:px-8">
          {children}
        </div>
      ) : null}
    </div>
  );
}
