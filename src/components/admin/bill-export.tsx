"use client";

import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { billExportHref } from "@/domain/bill-export";

/**
 * Downloads of a monthly bill (NUD-198). Plain links to `GET /api/admin/payments/export`: the
 * server answers with an attachment, so the browser saves the file and the page stays where it is.
 * The file is written in the language of the screen (`locale`), which also decides how a CSV
 * writes numbers and dates.
 */
export function BillDownloadButtons({
  customerId,
  month,
}: {
  customerId: string;
  /** `YYYY-MM` */
  month: string;
}) {
  const t = useTranslations("admin.payments.export");
  const locale = useLocale();
  const files = [
    { format: "pdf", icon: FileTextIcon, text: t("pdf"), label: t("pdfLabel") },
    { format: "csv", icon: FileSpreadsheetIcon, text: t("csv"), label: t("csvLabel") },
  ] as const;

  return (
    <TooltipProvider>
      {files.map(({ format, icon: Icon, text, label }) => (
        <Tooltip key={format}>
          <TooltipTrigger asChild>
            <Button asChild variant="outline">
              <a
                href={billExportHref({ month, customerId, format, locale })}
                download
                aria-label={label}
                data-testid={`bill-export-${format}`}
              >
                <Icon aria-hidden />
                {text}
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </TooltipProvider>
  );
}

/**
 * "All monthly bills of a month as one CSV" for the accounting: pick the month, download. Opens on
 * `defaultMonth` (the page passes the last finished month), else on the first month of the list.
 */
export function MonthExportForm({
  months,
  defaultMonth,
}: {
  months: Array<{ value: string; label: string }>;
  defaultMonth?: string;
}) {
  const t = useTranslations("admin.payments.export");
  const locale = useLocale();
  const monthId = useId();
  const [month, setMonth] = useState(
    months.find((entry) => entry.value === defaultMonth)?.value ?? months[0]?.value ?? "",
  );
  if (!month) return null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex w-56 flex-col gap-1.5">
        <Label htmlFor={monthId}>{t("month")}</Label>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger id={monthId} data-testid="month-export-month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button asChild variant="outline">
        <a
          href={billExportHref({ month, format: "csv", locale })}
          download
          data-testid="month-export-download"
        >
          <DownloadIcon aria-hidden />
          {t("allCsv")}
        </a>
      </Button>
    </div>
  );
}
