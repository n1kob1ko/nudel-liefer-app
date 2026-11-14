"use client";

import { ArrowLeftIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { SHEET_LOCALE_OPTIONS, type SheetLocale } from "@/lib/load-sheet-locale";

/**
 * Screen-only controls of the load sheet (hidden when printing): back to the tour, the printout
 * language (two options, own-script labels, shareable links) and Print.
 *
 * The card follows the colour scheme (`bg-card`), not a hardcoded white: the buttons inside use theme
 * tokens, so a white card made them unreadable in dark mode (reported from the live app). The sheet
 * itself stays black-on-white on purpose - that is the paper.
 *
 * The links are next-intl `Link`s, not raw anchors: a root-absolute `<a href="/de/...">` misses the
 * deployment's base path (/delivery-app) and 404s on the server (NUD-134).
 */
export function LoadSheetToolbar({
  tourId,
  date,
  printLocale,
  isOutdated,
  outdatedText,
  backLabel,
  printLabel,
  languageLabel,
}: {
  tourId: string;
  date: string;
  printLocale: SheetLocale;
  isOutdated: boolean;
  outdatedText: string;
  backLabel: string;
  printLabel: string;
  languageLabel: string;
}) {
  return (
    <div
      className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-col gap-3 px-4 print:hidden"
      data-testid="load-sheet-toolbar"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-3 text-card-foreground shadow">
        <Button asChild variant="outline">
          <Link
            href={{ pathname: "/admin/planning", query: { date } }}
            data-testid="load-sheet-back"
          >
            <ArrowLeftIcon aria-hidden />
            {backLabel}
          </Link>
        </Button>
        <nav aria-label={languageLabel} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{languageLabel}</span>
          {SHEET_LOCALE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              asChild
              size="sm"
              variant={option.value === printLocale ? "primary" : "outline"}
              aria-current={option.value === printLocale ? "true" : undefined}
            >
              <Link
                href={{
                  pathname: `/admin/tours/${tourId}/print`,
                  query: { locale: option.value },
                }}
                lang={option.value}
                data-testid={`load-sheet-locale-${option.value}`}
              >
                {option.label}
              </Link>
            </Button>
          ))}
        </nav>
        <Button
          type="button"
          className="ms-auto"
          onClick={() => window.print()}
          data-testid="load-sheet-print"
        >
          <PrinterIcon aria-hidden />
          {printLabel}
        </Button>
      </div>
      {isOutdated ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border-2 border-red-700 bg-red-50 p-3 text-base font-medium text-red-900"
          data-testid="load-sheet-outdated-screen"
        >
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {outdatedText}
        </p>
      ) : null}
    </div>
  );
}
