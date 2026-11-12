"use client";

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  MessageSquareTextIcon,
  PlusIcon,
  RepeatIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  OrderRecurringDialog,
  type RecurringDialogLine,
} from "@/components/admin/order-recurring-dialog";
import { ZoomableImage } from "@/components/shared/image-preview";
import { ImageUploader } from "@/components/shared/image-uploader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isInsideWindow, isValidWindow } from "@/domain/delivery-window";
import { amountInputValue, parseAmountToCents } from "@/domain/money";
import {
  hasDuplicateProducts,
  orderWarnings,
  parseCalendarDate,
  parseQuantity,
} from "@/domain/order";
import type { ExtractionAnswer, OrderDraft, UnmatchedLine } from "@/domain/order-extraction";
import { DEFAULT_PAYMENT_TERM, type PaymentTerm } from "@/domain/payment";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  confirmedOrderCountAction,
  createOrderAction,
  dayTourCompletedAction,
  extractOrderDraftAction,
  screenshotPreviewUrlAction,
  updateOrderAction,
} from "@/server/order-actions";
import type { OrderDraftFailure } from "@/server/order-extraction";

export type CustomerOption = ComboboxOption;
export type ProductOption = ComboboxOption & { unit: "KG" | "PACK" | "CRATE" | "PIECE" };

/** An existing order that is being edited (NUD-032). */
export type EditableOrder = {
  id: string;
  customerId: string;
  /** Planned day. */
  date: string;
  /** Requested delivery window (NUD-148). */
  windowFrom: string;
  windowTo: string;
  windowFromTime: string;
  windowToTime: string;
  status: "CONFIRMED" | "DRAFT";
  note: string;
  /** Monthly bill (default) or cash at the stop (D33, NUD-196). */
  paymentTerm?: PaymentTerm;
  /** Euro cents typed by the office; `null` = no amount set. */
  amountCents?: number | null;
  lines: Array<{ productId: string; quantity: string }>;
  /** Signed URL of the attached screenshot, shown read-only next to the form. */
  screenshotUrl: string | null;
};

type Props = {
  customers: CustomerOption[];
  products: ProductOption[];
  /** `YYYY-MM-DD`, from `getDefaultDeliveryDate()` (next delivery weekday). */
  defaultDate: string;
  /** Edit mode: the form is filled from this order; customer and screenshot cannot be changed. */
  order?: EditableOrder;
  /** The AI order draft (NUD-150) is configured: an `OrderExtractor` API key is present. */
  aiAvailable?: boolean;
};

type Line = { key: number; productId: string | undefined; quantity: string };
type SaveStatus = "CONFIRMED" | "DRAFT";

const isBlank = (line: Line) => !line.productId && line.quantity.trim() === "";
const isComplete = (line: Line) => Boolean(line.productId) && parseQuantity(line.quantity) !== null;

const SERVER_ERRORS: Record<string, string> = {
  invalid: "invalid",
  not_found: "notFound",
  not_editable: "notEditable",
  date_in_past: "datePast",
  customer_not_found: "customerNotFound",
  customer_inactive: "customerInactive",
  product_not_found: "productNotFound",
  product_inactive: "productInactive",
  screenshot_missing: "screenshotMissing",
  screenshot_in_use: "screenshotInUse",
};

/** Message keys of the AI draft failures (NUD-150), mapped from the server's snake_case codes. */
const AI_ERRORS: Record<OrderDraftFailure, string> = {
  invalid: "invalid",
  not_configured: "notConfigured",
  screenshot_unavailable: "screenshotUnavailable",
  extraction_failed: "extractionFailed",
};

/** An uploaded screenshot: its storage key (sent on save) and a signed URL for the viewer. */
type Screenshot = { storageKey: string; url: string };

/**
 * Manual order entry (layout refresh 2026-10): cards in the order the office works — customer,
 * product lines (picker + quantity + unit), delivery (requested window, optional fixed day), internal
 * note — closed by a sticky save bar. Keyboard flow: Enter in a quantity adds the next line and
 * focuses its product picker; quantities accept `,` and `.`. Blank lines are ignored on save. The
 * server validates everything again.
 *
 * Import column (NUD-031/NUD-150): the customer's message and/or a screenshot (uploaded, dropped or
 * pasted with Ctrl+V anywhere on the page) live in a column left of the form from 1024 px; below
 * that they fold behind one row at the top, which a screenshot opens. With a screenshot the zoomable
 * image sits at the top of that column and the order is saved with `source=SCREENSHOT`.
 *
 * Edit mode (NUD-032, `order` given): same fields and the same server validation; the customer is
 * fixed, the attached screenshot (if any) is shown read-only, the import tools are hidden.
 */
export function OrderForm({ customers, products, defaultDate, order, aiAvailable = false }: Props) {
  const t = useTranslations("admin.orders.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(order);
  const nextKey = useRef(order ? order.lines.length + 1 : 2);
  const focusKey = useRef<number | null>(null);
  const [customerId, setCustomerId] = useState<string | undefined>(order?.customerId);
  // Requested window (NUD-148). The planned day below stays empty = automatic unless the office sets it.
  const [windowFrom, setWindowFrom] = useState(order?.windowFrom ?? defaultDate);
  const [windowTo, setWindowTo] = useState(order?.windowTo ?? defaultDate);
  const [windowFromTime, setWindowFromTime] = useState(order?.windowFromTime ?? "");
  const [windowToTime, setWindowToTime] = useState(order?.windowToTime ?? "");
  const [plannedDay, setPlannedDay] = useState(order?.date ?? "");
  const windowTouched = useRef(Boolean(order));
  const plannedTouched = useRef(false);
  const [lines, setLines] = useState<Line[]>(
    order && order.lines.length > 0
      ? order.lines.map((l, i) => ({ key: i + 1, productId: l.productId, quantity: l.quantity }))
      : [{ key: 1, productId: undefined, quantity: "" }],
  );
  const [note, setNote] = useState(order?.note ?? "");
  // Payment (D33, NUD-196): monthly bill is the default, cash at the stop the exception; the amount
  // is typed by the office (the catalog has no prices).
  const [paymentTerm, setPaymentTerm] = useState<PaymentTerm>(
    order?.paymentTerm ?? DEFAULT_PAYMENT_TERM,
  );
  const [amount, setAmount] = useState(amountInputValue(order?.amountCents ?? null));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(
    order?.screenshotUrl ? { storageKey: "", url: order.screenshotUrl } : null,
  );
  const [screenshotError, setScreenshotError] = useState(false);
  const [counted, setCounted] = useState<{ key: string; count: number } | null>(null);
  const [dayDone, setDayDone] = useState<{ key: string; done: boolean } | null>(null);
  // AI order draft (NUD-150): the pasted customer message, the last outcome and what the office
  // should check. The raw answer is kept so a save can send it back; nothing here is written to the
  // order by itself - the office confirms every line.
  const [sourceText, setSourceText] = useState("");
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<OrderDraftFailure | null>(null);
  const [aiExtraction, setAiExtraction] = useState<ExtractionAnswer | null>(null);
  const [aiConfidences, setAiConfidences] = useState<Record<number, number>>({});
  const [aiLabels, setAiLabels] = useState<Record<number, string>>({});
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [aiNotice, setAiNotice] = useState<{
    unmatched: UnmatchedLine[];
    note: string | null;
    /** Window words the model read but did not turn into dates ("morgen vormittag"). */
    windowNote: string | null;
  } | null>(null);
  // Recurring order (NUD-166): the rule is created from the lines typed above, not from a copy.
  const [recurringOpen, setRecurringOpen] = useState(false);
  // Below 1024 px the message/screenshot import is folded behind one row; a screenshot opens it.
  const [importOpen, setImportOpen] = useState(false);

  const customer = customers.find((c) => c.value === customerId);
  const productById = new Map(products.map((p) => [p.value, p]));
  const fromDate = parseCalendarDate(windowFrom);
  const toDate = parseCalendarDate(windowTo);
  const plannedDate = plannedDay ? parseCalendarDate(plannedDay) : null;
  const windowValid =
    fromDate !== null &&
    toDate !== null &&
    isValidWindow({
      from: fromDate,
      to: toDate,
      fromTime: windowFromTime || null,
      toTime: windowToTime || null,
    });
  const plannedValid = plannedDay === "" || plannedDate !== null;
  const dateValid = windowValid && plannedValid;
  // The day the order is expected on, for the "combined stop" hint and the list after saving.
  const date = plannedDay || windowFrom;
  const outsideWindow =
    plannedDate !== null && fromDate !== null && toDate !== null
      ? !isInsideWindow(plannedDate, { from: fromDate, to: toDate })
      : false;

  // Focus the product picker of a freshly added line.
  useEffect(() => {
    if (focusKey.current === null) return;
    document.getElementById(`order-line-product-${focusKey.current}`)?.focus();
    focusKey.current = null;
  }, [lines.length]);

  // Warning: confirmed orders of this customer on that day will be combined into one stop.
  // The answer is stored with the customer/day it belongs to, so a stale answer is never shown.
  const countKey = customerId && dateValid ? `${customerId}|${date}` : null;
  useEffect(() => {
    if (countKey === null || !customerId) return;
    let current = true;
    confirmedOrderCountAction(customerId, date, order?.id)
      .then((count) => {
        if (current) setCounted({ key: countKey, count });
      })
      .catch(() => {
        if (current) setCounted({ key: countKey, count: 0 });
      });
    return () => {
      current = false;
    };
  }, [countKey, customerId, date, order?.id]);
  const confirmedCount = counted && counted.key === countKey ? counted.count : 0;

  // Warning (NUD-116): every tour of that day is completed, so a confirmed order is late.
  const dayKey = dateValid ? date : null;
  useEffect(() => {
    if (dayKey === null) return;
    let current = true;
    dayTourCompletedAction(dayKey)
      .then((done) => {
        if (current) setDayDone({ key: dayKey, done });
      })
      .catch(() => {
        if (current) setDayDone({ key: dayKey, done: false });
      });
    return () => {
      current = false;
    };
  }, [dayKey]);
  const tourCompleted = dayDone !== null && dayDone.key === dayKey && dayDone.done;

  const warnings = orderWarnings({
    confirmedOrdersOnDate: customer ? confirmedCount : 0,
    tourCompletedOnDate: tourCompleted,
  });
  const usedProducts = lines.map((l) => l.productId).filter((p): p is string => Boolean(p));

  /**
   * Next keeps the previous route (hidden) with its state, so the saved order's values, and above
   * all its screenshot, would still be there the next time "new order" is opened.
   */
  function resetForm() {
    setCustomerId(undefined);
    setWindowFrom(defaultDate);
    setWindowTo(defaultDate);
    setWindowFromTime("");
    setWindowToTime("");
    setPlannedDay("");
    windowTouched.current = false;
    plannedTouched.current = false;
    setLines([{ key: nextKey.current++, productId: undefined, quantity: "" }]);
    setNote("");
    setSubmitted(false);
    setServerError(null);
    setScreenshot(null);
    setScreenshotError(false);
    setCounted(null);
    setDayDone(null);
    setSourceText("");
    setAiPending(false);
    setAiError(null);
    setAiExtraction(null);
    setAiConfidences({});
    setAiLabels({});
    setAiConfidence(null);
    setAiNotice(null);
    setRecurringOpen(false);
    setImportOpen(false);
  }

  /**
   * Fills the draft the model read into the form (NUD-150). The product lines are the model's
   * mapping, but every line keeps a low-confidence marker so the office checks the quantity; the
   * planned day stays empty (= automatic). The notice is only shown, never written into the note.
   */
  function applyDraft(draft: OrderDraft, extraction: ExtractionAnswer) {
    const imported: Line[] = draft.lines.map((line, index) => ({
      // Reuse the keys already on screen so React does not remount the pickers.
      key: lines[index]?.key ?? nextKey.current++,
      productId: line.productId,
      quantity: line.quantity,
    }));
    const confidences: Record<number, number> = {};
    const labels: Record<number, string> = {};
    imported.forEach((line, index) => {
      confidences[line.key] = draft.lines[index]!.confidence;
      labels[line.key] = draft.lines[index]!.label;
    });
    setLines(
      imported.length > 0
        ? imported
        : [{ key: nextKey.current++, productId: undefined, quantity: "" }],
    );
    setAiConfidences(confidences);
    setAiLabels(labels);
    if (draft.window) {
      setWindowFrom(draft.window.from);
      setWindowTo(draft.window.to);
      setWindowFromTime(draft.window.fromTime);
      setWindowToTime(draft.window.toTime);
      windowTouched.current = true;
    }
    setPlannedDay("");
    plannedTouched.current = false;
    setAiConfidence(draft.confidence);
    setAiNotice({
      unmatched: draft.unmatched,
      note: draft.note,
      windowNote: draft.windowNote,
    });
    setAiExtraction(extraction);
    setServerError(null);
  }

  /** Read the pasted message and/or the screenshot into a draft; on failure keep every typed value. */
  async function runExtraction() {
    setAiPending(true);
    setAiError(null);
    try {
      const outcome = await extractOrderDraftAction({
        text: sourceText,
        screenshotKey: screenshot?.storageKey || null,
      });
      if (outcome.ok) applyDraft(outcome.draft, outcome.extraction);
      else setAiError(outcome.error);
    } catch {
      setAiError("extraction_failed");
    } finally {
      setAiPending(false);
    }
  }

  /** Catalogue names of the products the model found plausible for an unmatched line. */
  function candidateNames(candidates: string[]): string[] {
    return candidates
      .map((id) => productById.get(id)?.label)
      .filter((name): name is string => Boolean(name));
  }

  const aiHasInput = sourceText.trim() !== "" || Boolean(screenshot?.storageKey);
  const aiDisabled = !aiAvailable || aiPending || !aiHasInput;

  async function onScreenshotUploaded(image: { storageKey: string }) {
    setScreenshotError(false);
    setImportOpen(true);
    try {
      const url = await screenshotPreviewUrlAction(image.storageKey);
      if (!url) throw new Error("no preview");
      setScreenshot({ storageKey: image.storageKey, url });
    } catch {
      setScreenshotError(true);
    }
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setServerError(null);
  }

  function addLine() {
    const key = nextKey.current++;
    focusKey.current = key;
    setLines((current) => [...current, { key, productId: undefined, quantity: "" }]);
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length === 1
        ? [{ key: nextKey.current++, productId: undefined, quantity: "" }]
        : current.filter((l) => l.key !== key),
    );
  }

  function onQuantityKeyDown(event: KeyboardEvent<HTMLInputElement>, line: Line) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!isComplete(line)) {
      setSubmitted(true);
      return;
    }
    addLine();
  }

  const filled = lines.filter((l) => !isBlank(l));
  // What a recurring order created from this form takes over (NUD-166): only complete lines.
  const recurringLines: RecurringDialogLine[] = filled.flatMap((line) => {
    const product = line.productId ? productById.get(line.productId) : undefined;
    const quantity = parseQuantity(line.quantity);
    return product && quantity !== null
      ? [{ productId: product.value, quantity, label: product.label, unit: product.unit }]
      : [];
  });
  // The day this order is expected on; the rule leaves it out so the quantities cannot double up.
  const recurringSkipDate = dateValid ? date : null;
  const lineErrors = (line: Line): "productRequired" | "quantityInvalid" | null => {
    if (isBlank(line)) return null;
    if (!line.productId) return "productRequired";
    return parseQuantity(line.quantity) === null ? "quantityInvalid" : null;
  };
  const formError = !customerId
    ? "customerRequired"
    : !dateValid
      ? windowValid
        ? "dateInvalid"
        : "windowInvalid"
      : filled.length === 0
        ? "linesRequired"
        : filled.some((l) => lineErrors(l) !== null)
          ? "invalid"
          : amount.trim() !== "" && parseAmountToCents(amount) === null
            ? "amountInvalid"
            : null;

  function save(status: SaveStatus) {
    setSubmitted(true);
    setServerError(null);
    if (formError !== null || !customerId) return;
    // Editing: a changed window without a touched planned day is planned again by the server.
    const windowChanged =
      order !== undefined &&
      (windowFrom !== order.windowFrom ||
        windowTo !== order.windowTo ||
        windowFromTime !== order.windowFromTime ||
        windowToTime !== order.windowToTime);
    const input = {
      customerId,
      deliveryDate: order && windowChanged && !plannedTouched.current ? "" : plannedDay,
      windowFrom,
      windowTo,
      windowFromTime,
      windowToTime,
      status,
      internalNote: note,
      paymentTerm,
      amount,
      screenshotKey: editing ? null : (screenshot?.storageKey ?? null),
      // The AI draft is only a proposal: the message and the raw answer ride along with the saved
      // order so the office can see what the model read (NUD-150). Never sent when editing.
      ...(editing ? {} : { sourceText: sourceText || null, aiExtraction }),
      lines: filled.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    };
    startTransition(async () => {
      let result;
      try {
        result = order ? await updateOrderAction(order.id, input) : await createOrderAction(input);
      } catch {
        return setServerError("generic");
      }
      if (!result.ok) return setServerError(SERVER_ERRORS[result.error] ?? "generic");
      for (const warning of result.warnings) {
        toast.warning(t(`planWarnings.${warning}`, { date: result.plannedDate }));
      }
      if (order) {
        toast.success(t("savedChanges"));
        router.push(`/admin/orders/${order.id}`);
      } else {
        toast.success(t(result.status === "DRAFT" ? "savedDraft" : "savedConfirmed"));
        resetForm();
        router.push({
          pathname: "/admin/orders",
          query: { from: result.plannedDate, to: result.plannedDate },
        });
      }
      router.refresh();
    });
  }

  const hasSide = !editing || screenshot !== null;
  const showImportPanel = importOpen || screenshot !== null;

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="order-entry"
      data-split={screenshot ? "true" : "false"}
    >
      <div
        className={cn(
          "flex flex-col gap-6",
          hasSide && "lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-8",
        )}
      >
        {hasSide ? (
          <div className="flex flex-col gap-3 lg:sticky lg:top-20" data-testid="order-import">
            {editing ? null : (
              <button
                type="button"
                aria-expanded={showImportPanel}
                aria-controls="order-import-panel"
                onClick={() => setImportOpen((open) => !open)}
                data-testid="order-import-toggle"
                className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-start shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                  <MessageSquareTextIcon className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium">{t("import.toggle")}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t("import.optional")}
                  </span>
                </span>
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "size-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                    showImportPanel && "rotate-180",
                  )}
                />
              </button>
            )}
            <div
              id="order-import-panel"
              className={cn("flex-col gap-3", showImportPanel ? "flex" : "hidden lg:flex")}
            >
              {screenshot ? (
                <aside
                  aria-label={t("screenshot.heading")}
                  className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-3 shadow-sm"
                  data-testid="screenshot-pane"
                >
                  <div className="flex items-center justify-between gap-2 px-1">
                    <h2 className="text-base font-semibold">{t("screenshot.heading")}</h2>
                    {editing ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setScreenshot(null)}
                        data-testid="screenshot-remove"
                      >
                        <XIcon aria-hidden />
                        {t("screenshot.remove")}
                      </Button>
                    )}
                  </div>
                  <div className="relative h-[45dvh] min-h-64 overflow-hidden rounded-lg bg-black lg:h-[calc(100dvh-26rem)]">
                    <ZoomableImage src={screenshot.url} alt={t("screenshot.alt")} />
                  </div>
                  <p className="px-1 text-xs text-muted-foreground">{t("screenshot.zoomHint")}</p>
                </aside>
              ) : null}
              {editing ? null : (
                <Card data-testid="order-ai" aria-labelledby="order-ai-heading">
                  <CardHeader>
                    <CardTitle id="order-ai-heading">{t("ai.heading")}</CardTitle>
                    <CardDescription>{t("ai.hint")}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {screenshot ? null : (
                      <div className="flex flex-col gap-2">
                        <ImageUploader
                          purpose="screenshot"
                          pasteAnywhere
                          compact
                          onUploaded={(image) => void onScreenshotUploaded(image)}
                        />
                        {screenshotError ? (
                          <p
                            className="text-sm text-destructive"
                            role="alert"
                            data-testid="screenshot-error"
                          >
                            {t("screenshot.previewFailed")}
                          </p>
                        ) : null}
                      </div>
                    )}
                    <FormField label={t("ai.label")}>
                      <Textarea
                        id="order-ai-source"
                        value={sourceText}
                        maxLength={4000}
                        rows={4}
                        onChange={(e) => {
                          setSourceText(e.target.value);
                          setAiError(null);
                        }}
                        placeholder={t("ai.placeholder")}
                        className="min-h-20"
                        data-testid="ai-source-text"
                      />
                    </FormField>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant={aiAvailable ? "default" : "outline"}
                        disabled={aiDisabled}
                        onClick={() => void runExtraction()}
                        data-testid="ai-extract"
                      >
                        <SparklesIcon aria-hidden />
                        {aiPending ? t("ai.buttonBusy") : t("ai.button")}
                      </Button>
                      {aiAvailable ? null : (
                        <p className="text-sm text-muted-foreground" data-testid="ai-disabled-hint">
                          {t("ai.disabledHint")}
                        </p>
                      )}
                    </div>
                    {aiError ? (
                      <p className="text-sm text-destructive" role="alert" data-testid="ai-error">
                        {t(`ai.errors.${AI_ERRORS[aiError]}`)}
                      </p>
                    ) : null}
                    {aiConfidence !== null && aiConfidence < 0.6 ? (
                      <Alert variant="warning" role="status" data-testid="ai-low-confidence">
                        <AlertTriangleIcon aria-hidden />
                        <div>
                          {t("ai.lowConfidence", { percent: Math.round(aiConfidence * 100) })}
                        </div>
                      </Alert>
                    ) : null}
                    {aiNotice &&
                    (aiNotice.unmatched.length > 0 || aiNotice.note || aiNotice.windowNote) ? (
                      <Alert variant="info" role="status" data-testid="ai-notice">
                        <div className="flex flex-col gap-1">
                          {aiNotice.unmatched.length > 0 ? (
                            <>
                              <p className="font-medium">{t("ai.unmatchedHeading")}</p>
                              <ul className="list-disc pl-5">
                                {aiNotice.unmatched.map((line, index) => (
                                  <li
                                    key={`${line.label}-${index}`}
                                    data-testid="ai-unmatched-line"
                                  >
                                    {t("ai.unmatchedLine", {
                                      label: line.label,
                                      quantity: line.quantity ?? t("ai.quantityUnknown"),
                                    })}
                                    {candidateNames(line.candidates).length > 0
                                      ? ` ${t("ai.candidates", {
                                          names: candidateNames(line.candidates).join(", "),
                                        })}`
                                      : ""}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                          {aiNotice.note ? <p>{t("ai.note", { note: aiNotice.note })}</p> : null}
                          {aiNotice.windowNote ? (
                            <p data-testid="ai-window-note">
                              {t("ai.windowUnclear", { text: aiNotice.windowNote })}
                            </p>
                          ) : null}
                        </div>
                      </Alert>
                    ) : null}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        ) : null}

        <form
          onSubmit={(event) => event.preventDefault()}
          className="flex min-w-0 flex-col gap-4"
          noValidate
          data-testid="order-form"
        >
          <Card>
            <CardContent>
              <FormField
                label={t("customer")}
                required={!editing}
                description={editing ? t("customerFixed") : undefined}
                error={submitted && !customerId ? t("errors.customerRequired") : undefined}
              >
                <Combobox
                  id="order-customer"
                  disabled={editing}
                  options={customers}
                  value={customerId}
                  onChange={(value) => {
                    setCustomerId(value);
                    setServerError(null);
                  }}
                  placeholder={t("customerPlaceholder")}
                  searchPlaceholder={t("customerSearch")}
                  emptyText={t("customerEmpty")}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card aria-labelledby="order-lines">
            <CardHeader>
              <CardTitle id="order-lines">{t("linesHeading")}</CardTitle>
              <CardDescription className="hidden sm:block">{t("quantityHint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-3">
                {lines.map((line, index) => {
                  const product = line.productId ? productById.get(line.productId) : undefined;
                  const error = submitted ? lineErrors(line) : null;
                  const aiLabel = aiLabels[line.key];
                  const aiLineConfidence = aiConfidences[line.key];
                  return (
                    <li key={line.key} className="flex flex-col gap-1" data-testid="order-line">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
                        <Label htmlFor={`order-line-product-${line.key}`} className="sr-only">
                          {t("product")} · {t("lineLabel", { n: index + 1 })}
                        </Label>
                        <Combobox
                          id={`order-line-product-${line.key}`}
                          options={products}
                          value={line.productId}
                          onChange={(value) => updateLine(line.key, { productId: value })}
                          placeholder={t("productPlaceholder")}
                          searchPlaceholder={t("productSearch")}
                          emptyText={t("productEmpty")}
                          className="col-span-2 sm:col-span-1"
                        />
                        <div className="relative">
                          <Label htmlFor={`order-line-quantity-${line.key}`} className="sr-only">
                            {t("quantity")} · {t("lineLabel", { n: index + 1 })}
                          </Label>
                          <Input
                            id={`order-line-quantity-${line.key}`}
                            inputMode="numeric"
                            autoComplete="off"
                            value={line.quantity}
                            placeholder={t("quantity")}
                            onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                            onKeyDown={(e) => onQuantityKeyDown(e, line)}
                            aria-invalid={error === "quantityInvalid" || undefined}
                            className={cn("min-w-0 tabular-nums", product && "pe-16")}
                            data-testid="line-quantity"
                          />
                          <span
                            className={cn(
                              "pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground",
                              !product && "sr-only",
                            )}
                            data-testid="line-unit"
                          >
                            {product ? tc(`units.${product.unit}`) : ""}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeLine(line.key)}
                          aria-label={t("removeLine", { n: index + 1 })}
                          data-testid="line-remove"
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </div>
                      {aiLabel !== undefined ? (
                        <p className="text-sm text-muted-foreground" data-testid="line-ai-label">
                          {t("ai.lineLabelHint", { label: aiLabel })}
                        </p>
                      ) : null}
                      {aiLineConfidence !== undefined && aiLineConfidence < 0.6 ? (
                        <p
                          className="text-sm text-warning"
                          role="status"
                          data-testid="line-low-confidence"
                        >
                          {t("ai.lineLowConfidence")}
                        </p>
                      ) : null}
                      {error ? (
                        <p
                          className="text-sm text-destructive"
                          role="alert"
                          data-testid="error-line"
                        >
                          {t(`errors.${error}`)}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={addLine} data-testid="add-line">
                  <PlusIcon aria-hidden />
                  {t("addLine")}
                </Button>
                {editing ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending || !customerId || recurringLines.length === 0}
                    onClick={() => setRecurringOpen(true)}
                    data-testid="order-recurring-open"
                    className="sm:ms-auto"
                  >
                    <RepeatIcon aria-hidden />
                    {t("recurring.open")}
                  </Button>
                )}
              </div>
              {hasDuplicateProducts(usedProducts) ? (
                <p className="text-sm text-muted-foreground" data-testid="duplicate-notice">
                  {t("duplicateNotice")}
                </p>
              ) : null}
              {submitted && customerId && dateValid && filled.length === 0 ? (
                <p className="text-sm text-destructive" role="alert" data-testid="error-lines">
                  {t("errors.linesRequired")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card aria-labelledby="order-window-heading" data-testid="order-window">
            <CardHeader>
              <CardTitle id="order-window-heading">{t("window.heading")}</CardTitle>
              <CardDescription>{t("window.hint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <FormField label={t("window.from")}>
                  <Input
                    id="order-window-from"
                    type="date"
                    value={windowFrom}
                    onChange={(e) => {
                      const value = e.target.value;
                      windowTouched.current = true;
                      setWindowFrom(value);
                      if (windowTo < value || windowTo === windowFrom) setWindowTo(value);
                      setServerError(null);
                    }}
                    aria-invalid={(submitted && !windowValid) || undefined}
                    required
                    data-testid="order-window-from"
                  />
                </FormField>
                <FormField label={t("window.to")}>
                  <Input
                    id="order-window-to"
                    type="date"
                    value={windowTo}
                    min={windowFrom || undefined}
                    onChange={(e) => {
                      windowTouched.current = true;
                      setWindowTo(e.target.value);
                      setServerError(null);
                    }}
                    aria-invalid={(submitted && !windowValid) || undefined}
                    required
                    data-testid="order-window-to"
                  />
                </FormField>
                <FormField label={t("window.fromTime")} hint={t("optional")}>
                  <Input
                    id="order-window-from-time"
                    type="time"
                    value={windowFromTime}
                    onChange={(e) => {
                      windowTouched.current = true;
                      setWindowFromTime(e.target.value);
                      setServerError(null);
                    }}
                    data-testid="order-window-from-time"
                  />
                </FormField>
                <FormField label={t("window.toTime")} hint={t("optional")}>
                  <Input
                    id="order-window-to-time"
                    type="time"
                    value={windowToTime}
                    onChange={(e) => {
                      windowTouched.current = true;
                      setWindowToTime(e.target.value);
                      setServerError(null);
                    }}
                    data-testid="order-window-to-time"
                  />
                </FormField>
              </div>
              {submitted && !windowValid ? (
                <p className="text-sm text-destructive" role="alert" data-testid="error-window">
                  {t("errors.windowInvalid")}
                </p>
              ) : null}
              <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-end sm:gap-4">
                <FormField
                  label={t("date")}
                  hint={t("optional")}
                  error={submitted && !plannedValid ? t("errors.dateInvalid") : undefined}
                >
                  <Input
                    id="order-date"
                    type="date"
                    value={plannedDay}
                    onChange={(e) => {
                      const value = e.target.value;
                      plannedTouched.current = true;
                      setPlannedDay(value);
                      // Without a window of its own the chosen day is the window: the whole day.
                      if (!windowTouched.current && value) {
                        setWindowFrom(value);
                        setWindowTo(value);
                      }
                      setServerError(null);
                    }}
                    data-testid="order-date"
                  />
                </FormField>
                <p className="text-sm text-muted-foreground sm:pb-2.5">{t("dateHint")}</p>
              </div>
              {outsideWindow ? (
                <Alert variant="warning" role="status" data-testid="warning-outside-window">
                  <AlertTriangleIcon aria-hidden />
                  <div>{t("planWarnings.outside_window", { date: plannedDay })}</div>
                </Alert>
              ) : null}
              {warnings.length > 0 ? (
                <div className="flex flex-col gap-3" data-testid="order-warnings">
                  {warnings.includes("combined_stop") ? (
                    <Alert variant="warning" role="status" data-testid="warning-combined">
                      <AlertTriangleIcon aria-hidden />
                      <div>{t("warningCombined", { count: confirmedCount })}</div>
                    </Alert>
                  ) : null}
                  {warnings.includes("tour_completed") ? (
                    <Alert variant="warning" role="status" data-testid="warning-tour-completed">
                      <AlertTriangleIcon aria-hidden />
                      <div>{t("warningTourCompleted", { date })}</div>
                    </Alert>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("paymentTerm")} description={t("paymentTermHint")}>
                  <Select
                    value={paymentTerm}
                    onValueChange={(next) => setPaymentTerm(next as PaymentTerm)}
                  >
                    <SelectTrigger
                      id="order-payment-term"
                      data-testid="order-payment-term"
                      aria-label={t("paymentTerm")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">{t("paymentMonthly")}</SelectItem>
                      <SelectItem value="ON_DELIVERY">{t("paymentCash")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("amount")} description={t("amountHint")}>
                  <div className="flex items-center gap-2">
                    <Input
                      id="order-amount"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0,00"
                      className="w-40 text-right tabular-nums"
                      aria-invalid={amount.trim() !== "" && parseAmountToCents(amount) === null}
                      data-testid="order-amount"
                    />
                    <span className="text-base font-semibold" aria-hidden>
                      €
                    </span>
                  </div>
                </FormField>
              </div>
              {amount.trim() !== "" && parseAmountToCents(amount) === null ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {t("amountInvalid")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <FormField label={t("internalNote")} description={t("internalNoteHint")}>
                <Textarea
                  id="order-note"
                  value={note}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-20"
                  data-testid="order-note"
                />
              </FormField>
            </CardContent>
          </Card>

          {serverError ? (
            <Alert variant="destructive" role="alert" data-testid="order-error">
              <AlertTriangleIcon aria-hidden />
              <div>{t(`errors.${serverError as "generic"}`)}</div>
            </Alert>
          ) : null}

          <div
            className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center"
            data-testid="order-save-bar"
          >
            <Button
              type="button"
              disabled={pending}
              onClick={() => save("CONFIRMED")}
              data-testid="order-save"
              className="w-full sm:w-auto"
            >
              {t("saveConfirmed")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => save("DRAFT")}
              data-testid="order-save-draft"
              className="w-full sm:w-auto"
            >
              {t("saveDraft")}
            </Button>
          </div>
        </form>
      </div>

      {!editing && recurringOpen && customerId && recurringLines.length > 0 ? (
        <OrderRecurringDialog
          customerId={customerId}
          customerLabel={customer?.label ?? ""}
          lines={recurringLines}
          startDate={windowFrom}
          skipDate={recurringSkipDate}
          onClose={() => setRecurringOpen(false)}
        />
      ) : null}
    </div>
  );
}
