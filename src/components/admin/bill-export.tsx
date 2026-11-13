"use client";

import {
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ComponentProps, type MouseEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";

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
import { withBasePath } from "@/lib/base-path";

/** The file name of `Content-Disposition: attachment; filename="..."`. */
function fileNameOf(response: Response): string {
  return /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "";
}

/** Hands a fetched file to the browser's "save" through a temporary link. */
function saveFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Not in the same tick: some browsers start reading the file only after the click returned.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * A link to a download that tells the office when the download fails. A plain `<a download>` would
 * save the server's error answer as a file (or do nothing at all) once the session has run out, so
 * a normal click fetches the file first and reports a failure as a toast. The `href` stays: a
 * click with a modifier key and "save link as" keep working.
 */
function DownloadAnchor({
  href,
  icon: Icon,
  children,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string; icon: LucideIcon }) {
  const t = useTranslations("admin.payments.export");
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  async function download(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const response = await fetch(href, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`download failed: ${response.status}`);
      saveFile(await response.blob(), fileNameOf(response));
    } catch {
      toast.error(t("failed"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <a {...props} href={href} download onClick={download} aria-busy={busy || undefined}>
      {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
      {children}
    </a>
  );
}

/**
 * Downloads of a monthly bill (NUD-198), from `GET /api/admin/payments/export`: the server answers
 * with an attachment, the browser saves the file and the page stays where it is. The file is
 * written in the language of the screen (`locale`), which also decides how a CSV writes numbers
 * and dates.
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
      {files.map(({ format, icon, text, label }) => (
        <Tooltip key={format}>
          <TooltipTrigger asChild>
            <Button asChild variant="outline">
              <DownloadAnchor
                href={withBasePath(billExportHref({ month, customerId, format, locale }))}
                icon={icon}
                aria-label={label}
                data-testid={`bill-export-${format}`}
              >
                {text}
              </DownloadAnchor>
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
        <DownloadAnchor
          href={withBasePath(billExportHref({ month, format: "csv", locale }))}
          icon={DownloadIcon}
          data-testid="month-export-download"
        >
          {t("allCsv")}
        </DownloadAnchor>
      </Button>
    </div>
  );
}
