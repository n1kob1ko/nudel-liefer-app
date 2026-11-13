"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  MapPinCheckIcon,
  PlusCircleIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { CustomerImportGeocode } from "@/components/admin/customer-import-geocode";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildRecords,
  checkMapping,
  type ColumnMapping,
  IMPORT_FIELDS,
  type ImportField,
  type RememberedMapping,
  rememberMapping,
  REQUIRED_IMPORT_FIELDS,
  type RowIssue,
  suggestMapping,
} from "@/domain/customer-import";
import { IMPORT_LIMITS, type ParsedTable } from "@/domain/import-file";
import { Link } from "@/i18n/navigation";
import { withBasePath } from "@/lib/base-path";
import type { CommitResult, PreviewResult, PreviewRow } from "@/server/customer-import";
import {
  commitCustomerImportAction,
  previewCustomerImportAction,
} from "@/server/customer-import-actions";

const STORAGE_KEY = "nudel.customerImport.mapping.v1";
const PREVIEW_LIMIT = 300;
const selectClass =
  "h-10 w-full max-w-xs field rounded-md border border-input bg-card px-3 text-base";

type Upload = {
  filename: string;
  table: ParsedTable;
  sheetName: string | null;
  sheetCount: number;
};
type Preview = Extract<PreviewResult, { ok: true }>;
type Result = Extract<CommitResult, { ok: true }>;
type Stage = { name: "upload" } | { name: "mapping" } | { name: "preview" } | { name: "result" };
type Filter = "all" | "errors" | "changes";

function loadRemembered(): RememberedMapping {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: RememberedMapping = {};
    for (const field of IMPORT_FIELDS) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === "string") out[field] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveRemembered(value: RememberedMapping) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the mapping is simply not remembered.
  }
}

const STAGES = ["upload", "mapping", "preview", "result"] as const;

/**
 * Customer import wizard (NUD-090): file -> column mapping -> preview with row errors -> import ->
 * batch geocoding. The file is parsed on the server; the browser keeps the table and sends only the
 * mapped cells back, which the server validates again.
 */
export function CustomerImport({ initialQueueCount }: { initialQueueCount: number }) {
  const t = useTranslations("admin.customers.import");
  const [stage, setStage] = useState<Stage>({ name: "upload" });
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [fileKey, setFileKey] = useState(0);

  const errorText = (code: string) =>
    t(`errors.${code}`, {
      size: IMPORT_LIMITS.maxBytes / (1024 * 1024),
      rows: IMPORT_LIMITS.maxRows,
      columns: IMPORT_LIMITS.maxColumns,
      length: IMPORT_LIMITS.maxCellLength,
    });

  const issueText = (issue: RowIssue) =>
    t(`issues.${issue.code}`, {
      field: issue.field ? t(`fields.${issue.field}`) : "",
      max: issue.max ?? 0,
      line: issue.line ?? 0,
    });

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > IMPORT_LIMITS.maxBytes) return setError(errorText("too_large"));
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch(withBasePath("/api/admin/customers/import/parse"), {
          method: "POST",
          body: form,
        });
        const body = (await response.json()) as {
          upload?: Upload;
          error?: string;
        };
        if (!response.ok || !body.upload) {
          const code = body.error ?? "generic";
          return setError(errorText(code in ERROR_CODES ? code : "generic"));
        }
        setUpload(body.upload);
        setMapping(suggestMapping(body.upload.table.rows[0] ?? [], loadRemembered()));
        setStage({ name: "mapping" });
      } catch {
        setError(errorText("generic"));
      }
    });
  }

  const problems = checkMapping(mapping);

  function toPreview() {
    if (!upload) return;
    setError(null);
    startTransition(async () => {
      saveRemembered(rememberMapping(upload.table.rows[0] ?? [], mapping));
      try {
        const records = buildRecords(upload.table, mapping).map((r) => ({
          line: r.line,
          values: r.record,
        }));
        const answer = await previewCustomerImportAction({ records });
        if (!answer.ok) return setError(errorText("invalid"));
        setPreview(answer);
        setFilter(answer.summary.error > 0 ? "errors" : "changes");
        setStage({ name: "preview" });
      } catch {
        setError(errorText("generic"));
      }
    });
  }

  function commit() {
    if (!upload) return;
    setError(null);
    startTransition(async () => {
      try {
        const records = buildRecords(upload.table, mapping).map((r) => ({
          line: r.line,
          values: r.record,
        }));
        const answer = await commitCustomerImportAction({ records });
        if (!answer.ok) return setError(errorText("invalid"));
        setResult(answer);
        setStage({ name: "result" });
      } catch {
        setError(errorText("generic"));
      }
    });
  }

  function restart() {
    setUpload(null);
    setPreview(null);
    setResult(null);
    setMapping({});
    setError(null);
    setFileKey((k) => k + 1);
    setStage({ name: "upload" });
  }

  const current = STAGES.indexOf(stage.name);

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2" aria-label={t("title")} data-testid="import-steps">
        {STAGES.map((name, index) => (
          <li
            key={name}
            aria-current={index === current ? "step" : undefined}
            className={`flex items-center gap-2 rounded-md border px-3 py-1 text-sm ${index === current ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <span aria-hidden>{index + 1}</span>
            {t(`steps.${name}`)}
          </li>
        ))}
      </ol>

      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 text-destructive"
          data-testid="import-error"
        >
          <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {stage.name === "upload" ? (
        <section className="flex flex-col gap-4" aria-labelledby="imp-upload">
          <h2 id="imp-upload" className="text-xl font-semibold">
            {t("upload.heading")}
          </h2>
          <p className="max-w-prose text-muted-foreground">
            {t("upload.hint", {
              size: IMPORT_LIMITS.maxBytes / (1024 * 1024),
              rows: IMPORT_LIMITS.maxRows,
            })}
          </p>
          <div className="flex max-w-xl flex-col gap-2">
            <Label htmlFor="imp-file">{t("upload.label")}</Label>
            <input
              key={fileKey}
              id="imp-file"
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,text/csv"
              className="field rounded-md border border-input bg-card p-2 text-base file:mr-3 file:rounded-md file:border-0 file:bg-muted file:font-medium file:px-3 file:py-1.5 file:text-base"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
              data-testid="import-file"
            />
            {busy ? (
              <p role="status" className="flex items-center gap-2 text-muted-foreground">
                <UploadIcon className="size-5" aria-hidden />
                {t("upload.reading")}
              </p>
            ) : null}
          </div>
          {initialQueueCount > 0 ? (
            <Link
              href="/admin/customers/parking"
              className={buttonVariants({ variant: "outline", className: "w-fit" })}
              data-testid="queue-link-upload"
            >
              <MapPinCheckIcon aria-hidden />
              {t("queueLink", { count: initialQueueCount })}
            </Link>
          ) : null}
        </section>
      ) : null}

      {stage.name === "mapping" && upload ? (
        <section className="flex flex-col gap-4" aria-labelledby="imp-map">
          <h2 id="imp-map" className="text-xl font-semibold">
            {t("mapping.heading")}
          </h2>
          <p className="flex max-w-prose items-start gap-2 text-muted-foreground">
            <FileSpreadsheetIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span data-testid="mapping-intro">
              {t("mapping.intro", { file: upload.filename, rows: upload.table.rows.length - 1 })}
            </span>
          </p>
          {upload.sheetCount > 1 ? (
            <p className="text-sm text-muted-foreground">
              {t("mapping.sheetNote", { count: upload.sheetCount, name: upload.sheetName ?? "" })}
            </p>
          ) : null}
          <Table data-testid="mapping-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("mapping.field")}</TableHead>
                <TableHead>{t("mapping.column")}</TableHead>
                <TableHead>{t("mapping.sample")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {IMPORT_FIELDS.map((field) => (
                <MappingRow
                  key={field}
                  field={field}
                  upload={upload}
                  value={mapping[field]}
                  onChange={(column) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (column === undefined) delete next[field];
                      else next[field] = column;
                      return next;
                    })
                  }
                />
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">{t("mapping.optionalHint")}</p>
          {problems.length > 0 ? (
            <ul className="flex flex-col gap-1 text-destructive" data-testid="mapping-problems">
              {problems.map((p) => (
                <li key={p.code === "missing" ? p.field : `c${p.column}`} className="flex gap-2">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
                  {p.code === "missing"
                    ? t("mapping.problemMissing", { field: t(`fields.${p.field}`) })
                    : t("mapping.problemDuplicate", { column: p.column + 1 })}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={restart}>
              {t("mapping.otherFile")}
            </Button>
            <Button
              type="button"
              onClick={toPreview}
              disabled={problems.length > 0 || busy}
              data-testid="mapping-next"
            >
              {busy ? t("preview.checking") : t("mapping.next")}
            </Button>
          </div>
        </section>
      ) : null}

      {stage.name === "preview" && preview ? (
        <PreviewStep
          preview={preview}
          filter={filter}
          onFilter={setFilter}
          issueText={issueText}
          busy={busy}
          onBack={() => setStage({ name: "mapping" })}
          onCommit={commit}
        />
      ) : null}

      {stage.name === "result" && result ? (
        <section className="flex flex-col gap-5" aria-labelledby="imp-result">
          <h2 id="imp-result" className="text-xl font-semibold">
            {t("result.heading")}
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="result-summary">
            <Stat label={t("result.created")} value={result.created} testId="result-created" />
            <Stat label={t("result.updated")} value={result.updated} testId="result-updated" />
            <Stat
              label={t("result.unchanged")}
              value={result.unchanged}
              testId="result-unchanged"
            />
            <Stat
              label={t("result.failed")}
              value={result.failed.length}
              testId="result-failed"
              warn={result.failed.length > 0}
            />
          </dl>
          {result.failed.length === 0 ? (
            <p className="flex items-center gap-2" role="status">
              <CheckCircle2Icon className="size-5 text-success" aria-hidden />
              {t("result.allOk")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold">{t("result.failedHeading")}</h3>
              <Table data-testid="failed-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("preview.columns.line")}</TableHead>
                    <TableHead>{t("preview.columns.number")}</TableHead>
                    <TableHead>{t("preview.columns.name")}</TableHead>
                    <TableHead>{t("preview.columns.details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.failed.map((f) => (
                    <TableRow key={f.line} data-testid="failed-row">
                      <TableCell>{f.line}</TableCell>
                      <TableCell>{f.customerNumber}</TableCell>
                      <TableCell>{f.name}</TableCell>
                      <TableCell>
                        <ul className="flex flex-col gap-1">
                          {f.issues.map((i, n) => (
                            <li key={n}>{issueText(i)}</li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {result.pinsReset > 0 ? (
            <p className="text-muted-foreground">
              {t("result.pinsReset", { count: result.pinsReset })}
            </p>
          ) : null}

          <CustomerImportGeocode withoutPin={result.withoutPin} />

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/customers/parking"
              className={buttonVariants()}
              data-testid="queue-link"
            >
              <MapPinCheckIcon aria-hidden />
              {t("queueLink", { count: result.withoutParking })}
            </Link>
            <Link href="/admin/customers" className={buttonVariants({ variant: "outline" })}>
              {t("result.toList")}
            </Link>
            <Button type="button" variant="outline" onClick={restart} data-testid="import-again">
              <RefreshCwIcon aria-hidden />
              {t("result.again")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const ERROR_CODES: Record<string, true> = {
  too_large: true,
  empty: true,
  unsupported_type: true,
  too_many_rows: true,
  too_many_columns: true,
  cell_too_long: true,
  bad_csv: true,
  bad_xlsx: true,
  zip_bomb: true,
  invalid: true,
};

function Stat({
  label,
  value,
  testId,
  warn = false,
}: {
  label: string;
  value: number;
  testId: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <dt className="flex items-center gap-1 text-sm text-muted-foreground">
        {warn ? <AlertTriangleIcon className="size-4" aria-hidden /> : null}
        {label}
      </dt>
      <dd className="text-3xl font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function MappingRow({
  field,
  upload,
  value,
  onChange,
}: {
  field: ImportField;
  upload: Upload;
  value: number | undefined;
  onChange: (column: number | undefined) => void;
}) {
  const t = useTranslations("admin.customers.import");
  const header = upload.table.rows[0] ?? [];
  const samples =
    value === undefined
      ? []
      : upload.table.rows
          .slice(1)
          .map((row) => row[value] ?? "")
          .filter((cell) => cell.trim() !== "")
          .slice(0, 3);
  const required = REQUIRED_IMPORT_FIELDS.includes(field);
  const id = `map-${field}`;
  return (
    <TableRow>
      <TableCell className="align-top">
        <Label htmlFor={id}>
          {t(`fields.${field}`)}
          {required ? (
            <Badge variant="outline" className="ml-2">
              {t("mapping.required")}
            </Badge>
          ) : null}
        </Label>
      </TableCell>
      <TableCell className="align-top">
        <select
          id={id}
          className={selectClass}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          data-testid={id}
        >
          <option value="">{t("mapping.notUsed")}</option>
          {header.map((h, index) => (
            <option key={index} value={index}>
              {index + 1}: {h.trim() === "" ? t("mapping.emptyHeader") : h}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="align-top text-muted-foreground">
        {samples.map((s, i) => (
          <span key={i} className="block max-w-64 truncate">
            {s}
          </span>
        ))}
      </TableCell>
    </TableRow>
  );
}

function PreviewStep({
  preview,
  filter,
  onFilter,
  issueText,
  busy,
  onBack,
  onCommit,
}: {
  preview: Preview;
  filter: Filter;
  onFilter: (f: Filter) => void;
  issueText: (issue: RowIssue) => string;
  busy: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const t = useTranslations("admin.customers.import");
  const { summary } = preview;
  const rows = preview.rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "errors"
        ? r.status === "error"
        : r.status === "create" || r.status === "update",
  );
  const shown = rows.slice(0, PREVIEW_LIMIT);
  const work = summary.create + summary.update;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="imp-prev">
      <h2 id="imp-prev" className="text-xl font-semibold">
        {t("preview.heading")}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="preview-summary">
        <Stat label={t("preview.summary.create")} value={summary.create} testId="preview-create" />
        <Stat label={t("preview.summary.update")} value={summary.update} testId="preview-update" />
        <Stat
          label={t("preview.summary.unchanged")}
          value={summary.unchanged}
          testId="preview-unchanged"
        />
        <Stat
          label={t("preview.summary.error")}
          value={summary.error}
          testId="preview-error"
          warn={summary.error > 0}
        />
      </dl>
      {summary.error > 0 ? (
        <p className="text-muted-foreground">{t("preview.errorsHint")}</p>
      ) : null}
      {preview.pinsReset > 0 ? (
        <p className="flex gap-2" data-testid="preview-pins-reset">
          <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t("preview.pinsReset", { count: preview.pinsReset })}
        </p>
      ) : null}
      {preview.archived > 0 ? (
        <p className="text-muted-foreground">
          {t("preview.archived", { count: preview.archived })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="prev-filter">{t("preview.filter")}</Label>
        <select
          id="prev-filter"
          className="h-10 field rounded-md border border-input bg-card px-3 text-base"
          value={filter}
          onChange={(e) => onFilter(e.target.value as Filter)}
          data-testid="preview-filter"
        >
          <option value="all">{t("preview.filterAll")}</option>
          <option value="errors">{t("preview.filterErrors")}</option>
          <option value="changes">{t("preview.filterChanges")}</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t("preview.none")}</p>
      ) : (
        <>
          <Table data-testid="preview-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("preview.columns.line")}</TableHead>
                <TableHead>{t("preview.columns.number")}</TableHead>
                <TableHead>{t("preview.columns.name")}</TableHead>
                <TableHead>{t("preview.columns.status")}</TableHead>
                <TableHead>{t("preview.columns.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <PreviewRowView key={row.line} row={row} issueText={issueText} />
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("preview.shown", { shown: shown.length, total: rows.length })}
          </p>
        </>
      )}

      {work === 0 ? <p className="text-muted-foreground">{t("preview.nothingToDo")}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          {t("preview.back")}
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={busy || work === 0}
          data-testid="import-commit"
        >
          <PlusCircleIcon aria-hidden />
          {busy ? t("preview.importing") : t("preview.commit", { count: work })}
        </Button>
      </div>
    </section>
  );
}

const STATUS_VARIANT = {
  create: "success",
  update: "secondary",
  unchanged: "outline",
  error: "destructive",
} as const;

function PreviewRowView({
  row,
  issueText,
}: {
  row: PreviewRow;
  issueText: (issue: RowIssue) => string;
}) {
  const t = useTranslations("admin.customers.import");
  return (
    <TableRow data-testid="preview-row" data-status={row.status}>
      <TableCell>{row.line}</TableCell>
      <TableCell>{row.customerNumber}</TableCell>
      <TableCell>{row.name}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status]}>{t(`preview.status.${row.status}`)}</Badge>
      </TableCell>
      <TableCell>
        <ul className="flex flex-col gap-1 text-sm">
          {row.issues.map((i, n) => (
            <li key={`i${n}`} className="text-destructive">
              {issueText(i)}
            </li>
          ))}
          {row.warnings.map((w, n) => (
            <li key={`w${n}`}>{issueText(w)}</li>
          ))}
          {row.status === "update" ? (
            <li>
              {t("preview.changed", {
                fields: row.changedFields.map((f) => t(`fields.${f}`)).join(", "),
              })}
            </li>
          ) : null}
          {row.pinReset ? <li>{t("preview.pinReset")}</li> : null}
          {row.status === "update" && row.archived ? <li>{t("preview.stayArchived")}</li> : null}
        </ul>
      </TableCell>
    </TableRow>
  );
}
