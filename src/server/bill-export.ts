import { z } from "zod";

import {
  type BillExportRow,
  buildBillCsv,
  csvStyleFor,
  exportFileName,
  type ExportLabels,
} from "@/domain/bill-export";
import type { BillPdfModel } from "@/domain/bill-pdf-layout";
import { formatCalendarDate } from "@/domain/order";
import {
  monthKey,
  type MonthlyState,
  monthlyState,
  nextMonthStart,
  parseMonthKey,
} from "@/domain/payment";
import { ADMIN_LOCALES, type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";

import { renderBillPdf } from "./bill-pdf";
import { idSchema, type MonthlyBill, monthlyBillQuery, type PaymentsDb } from "./payments";

/**
 * The monthly bill as a file (NUD-198): one customer's month as PDF or CSV, or every customer of a
 * month in one CSV for the accounting. It writes down what the month page shows, it does not
 * calculate anything new; the numbers come from `monthlyBillQuery` and the same order filter.
 *
 * The file is a statement for the office and the customer, not a tax invoice: it carries no
 * invoice number and no VAT (see the decision log, NUD-198).
 */

type ExportLocale = (typeof ADMIN_LOCALES)[number];

/**
 * A translator of one namespace. `getTranslations` and `createTranslator` both fit; the keys used
 * here are checked by the tests against the real message files.
 */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Every text an export needs, already in the language of the file. */
export type ExportTexts = {
  csv: ExportLabels;
  unit: (unit: string) => string;
  document: {
    title: string;
    columns: { date: string; items: string; amount: string };
    customerNumber: (number: string) => string;
    vatId: (vatId: string) => string;
    open: string;
    current: string;
    paidOn: (date: string, amount: string) => string;
    paidDiffers: string;
    note: (note: string) => string;
    noAmount: string;
    noAmountNotice: (count: number) => string;
    empty: string;
    subtotal: string;
    total: string;
    page: (page: number, pages: number) => string;
  };
};

const UNITS = ["KG", "PACK", "CRATE", "PIECE"] as const;

/**
 * Reads the export texts from the message files. `t` is the translator of `admin.payments`, `tc`
 * the one of `common`.
 */
export function exportTextsFrom(t: unknown, tc: unknown): ExportTexts {
  const payments = t as Translate;
  const common = tc as Translate;
  const column = (key: keyof ExportLabels["columns"]) => payments(`export.columns.${key}`);
  return {
    csv: {
      columns: {
        month: column("month"),
        customerNumber: column("customerNumber"),
        customer: column("customer"),
        date: column("date"),
        kind: column("kind"),
        description: column("description"),
        amount: column("amount"),
        status: column("status"),
        paidOn: column("paidOn"),
        paidAmount: column("paidAmount"),
      },
      order: payments("export.kindOrder"),
      adjustment: payments("export.kindAdjustment"),
      open: payments("state.open"),
      paid: payments("state.paid"),
      current: payments("state.current"),
    },
    unit: (unit) => ((UNITS as readonly string[]).includes(unit) ? common(`units.${unit}`) : unit),
    document: {
      title: payments("export.document.title"),
      columns: {
        date: payments("columns.date"),
        items: payments("columns.items"),
        amount: payments("columns.amount"),
      },
      customerNumber: (number) => payments("export.document.customerNumber", { number }),
      vatId: (vatId) => payments("export.document.vatId", { vatId }),
      open: payments("export.document.open"),
      current: payments("export.document.current"),
      paidOn: (date, amount) => payments("export.document.paidOn", { date, amount }),
      paidDiffers: payments("export.document.paidDiffers"),
      note: (note) => payments("export.document.note", { note }),
      noAmount: payments("bill.noAmount"),
      noAmountNotice: (count) => payments("export.document.noAmountNotice", { count }),
      empty: payments("export.document.empty"),
      subtotal: payments("adjust.subtotal"),
      total: payments("adjust.total"),
      page: (page, pages) => payments("export.document.page", { page, pages }),
    },
  };
}

/**
 * Language of a PDF. The embedded font has no Chinese letters, so a Chinese-speaking user gets the
 * German document (the customer reads German anyway); the CSV stays in the user's language.
 */
export function pdfLocaleFor(locale: ExportLocale): "de" | "en" {
  return locale === "en" ? "en" : "de";
}

type OrderItem = { productName: unknown; unit: string; quantity: number };

/** "3 Kiste Nudeln, 2 kg Teigblätter": the products of one order in one line. */
function describeItems(items: readonly OrderItem[], locale: AppLocale, texts: ExportTexts): string {
  const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return items
    .map((item) => {
      const parsed = localizedTextSchema.safeParse(item.productName);
      const name = parsed.success ? pick(parsed.data, locale) : "";
      return `${quantity.format(item.quantity)} ${texts.unit(item.unit)} ${name}`.trim();
    })
    .join(", ");
}

/** The calendar day of a moment in the factory time zone, `YYYY-MM-DD`. */
function dayIn(moment: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

/** A `YYYY-MM-DD` day as people write it: `04.05.2099` in German, the ISO day otherwise. */
function writtenDay(iso: string, locale: "de" | "en"): string {
  const [year, month, dayOfMonth] = iso.split("-");
  return locale === "de" ? `${dayOfMonth}.${month}.${year}` : iso;
}

export function billPdfModel(
  bill: MonthlyBill,
  options: {
    locale: "de" | "en";
    timezone: string;
    depot: { name: string; address: string } | null;
    texts: ExportTexts;
  },
): BillPdfModel {
  const { locale, texts } = options;
  const doc = texts.document;
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const signed = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    signDisplay: "exceptZero",
  });
  const money = (cents: number) => amount.format(cents / 100);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${bill.periodStart}T00:00:00Z`));

  const customer = bill.customer;
  // The billing address replaces the delivery address as a whole, never line by line.
  const address = customer.billingStreet
    ? {
        street: customer.billingStreet,
        postalCode: customer.billingPostalCode ?? customer.postalCode,
        city: customer.billingCity ?? customer.city,
      }
    : { street: customer.street, postalCode: customer.postalCode, city: customer.city };
  const recipient = [
    customer.companyName,
    customer.name,
    address.street,
    `${address.postalCode} ${address.city}`.trim(),
  ].filter((line): line is string => Boolean(line && line.trim()));

  const notes: string[] = [];
  if (bill.payment) {
    notes.push(
      doc.paidOn(
        writtenDay(dayIn(new Date(bill.payment.paidAt), options.timezone), locale),
        money(bill.payment.amountCents),
      ),
    );
    // The paid note is a snapshot; orders of a paid month can still be edited (D33).
    if (bill.payment.amountCents !== bill.totalCents) notes.push(doc.paidDiffers);
    if (bill.payment.note) notes.push(doc.note(bill.payment.note));
  } else {
    notes.push(bill.state === "current" ? doc.current : doc.open);
  }
  if (bill.noAmountCount > 0) notes.push(doc.noAmountNotice(bill.noAmountCount));

  const senderName = options.depot?.name ?? "";
  return {
    sender: { name: senderName, addressLines: options.depot ? [options.depot.address] : [] },
    recipient,
    meta: [
      doc.customerNumber(customer.customerNumber),
      ...(customer.vatId ? [doc.vatId(customer.vatId)] : []),
    ],
    title: doc.title,
    monthLabel,
    columns: doc.columns,
    orders: bill.orders.map((order) => ({
      date: writtenDay(order.date, locale),
      items: describeItems(order.items, locale, texts),
      amount: order.amountCents === null ? doc.noAmount : money(order.amountCents),
    })),
    emptyText: doc.empty,
    foot: [
      // Without corrections the subtotal would only repeat the total.
      ...(bill.adjustments.length > 0
        ? [{ label: doc.subtotal, amount: money(bill.ordersTotalCents), style: "muted" as const }]
        : []),
      ...bill.adjustments.map((adjustment) => ({
        label: adjustment.label,
        amount: signed.format(adjustment.amountCents / 100),
        style: "plain" as const,
      })),
      { label: doc.total, amount: money(bill.totalCents), style: "total" as const },
    ],
    notes,
    footerLeft: [senderName, `${doc.title} ${monthLabel}`, customer.customerNumber]
      .filter(Boolean)
      .join(" · "),
    pageLabel: doc.page,
  };
}

type RowSource = {
  monthKey: string;
  customerNumber: string;
  customerName: string;
  orders: ReadonlyArray<{ date: string; amountCents: number | null; items: readonly OrderItem[] }>;
  adjustments: ReadonlyArray<{ label: string; amountCents: number }>;
  state: MonthlyState;
  paidOn: string | null;
  paidCents: number | null;
};

/** The lines of one customer's month: the orders by day, then the corrections. */
function exportRows(source: RowSource, locale: AppLocale, texts: ExportTexts): BillExportRow[] {
  const base = {
    monthKey: source.monthKey,
    customerNumber: source.customerNumber,
    customerName: source.customerName,
    state: source.state,
    paidOn: source.paidOn,
    paidCents: source.paidCents,
  };
  return [
    ...source.orders.map((order) => ({
      ...base,
      date: order.date,
      kind: "order" as const,
      description: describeItems(order.items, locale, texts),
      amountCents: order.amountCents,
    })),
    ...source.adjustments.map((adjustment) => ({
      ...base,
      date: null,
      kind: "adjustment" as const,
      description: adjustment.label,
      amountCents: adjustment.amountCents,
    })),
  ];
}

/**
 * Every customer's lines of one month, by customer number: the CONFIRMED orders on monthly bill
 * (the same filter as the month page) and the corrections of the month.
 */
async function allCustomersRows(
  db: PaymentsDb,
  period: Date,
  options: { today: Date; timezone: string; locale: AppLocale; texts: ExportTexts },
): Promise<BillExportRow[]> {
  const [orders, adjustments, payments] = await Promise.all([
    db.order.findMany({
      where: {
        status: "CONFIRMED",
        paymentTerm: "MONTHLY",
        deliveryDate: { gte: period, lt: nextMonthStart(period) },
      },
      orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        customerId: true,
        deliveryDate: true,
        amountCents: true,
        items: {
          select: { quantity: true, product: { select: { name: true, unit: true } } },
          orderBy: { id: "asc" },
        },
      },
    }),
    db.monthlyAdjustment.findMany({
      where: { periodStart: period, voidedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { customerId: true, label: true, amountCents: true },
    }),
    db.monthlyPayment.findMany({
      where: { periodStart: period, voidedAt: null },
      select: { customerId: true, paidAt: true, amountCents: true },
    }),
  ]);

  const customerIds = [...new Set([...orders, ...adjustments].map((entry) => entry.customerId))];
  if (customerIds.length === 0) return [];
  const customers = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, customerNumber: true, name: true },
  });
  const payment = new Map(payments.map((entry) => [entry.customerId, entry]));
  const ordersOf = Map.groupBy(orders, (order) => order.customerId);
  const adjustmentsOf = Map.groupBy(adjustments, (entry) => entry.customerId);
  const byNumber = new Intl.Collator("de", { numeric: true });

  return customers
    .sort((a, b) => byNumber.compare(a.customerNumber, b.customerNumber))
    .flatMap((customer) => {
      const own = ordersOf.get(customer.id) ?? [];
      const paid = payment.get(customer.id);
      return exportRows(
        {
          monthKey: monthKey(period),
          customerNumber: customer.customerNumber,
          customerName: customer.name,
          orders: own.map((order) => ({
            date: formatCalendarDate(order.deliveryDate),
            amountCents: order.amountCents,
            items: order.items.map((item) => ({
              productName: item.product.name,
              unit: item.product.unit,
              quantity: item.quantity,
            })),
          })),
          adjustments: adjustmentsOf.get(customer.id) ?? [],
          state: monthlyState({
            periodStart: period,
            today: options.today,
            paid: paid !== undefined,
            orderCount: own.length,
          }),
          paidOn: paid ? dayIn(paid.paidAt, options.timezone) : null,
          paidCents: paid ? paid.amountCents : null,
        },
        options.locale,
        options.texts,
      );
    });
}

const querySchema = z.object({
  month: z.string().max(7),
  customer: idSchema.optional(),
  format: z.enum(["csv", "pdf"]).default("csv"),
  locale: z.enum(ADMIN_LOCALES).default("de"),
});

export type BillExportContext = {
  today: Date;
  timezone: string;
  depot: { name: string; address: string } | null;
  texts: (locale: ExportLocale) => Promise<ExportTexts>;
};

export type BillExportResult =
  | {
      ok: true;
      fileName: string;
      contentType: "text/csv; charset=utf-8" | "application/pdf";
      body: string | Uint8Array;
    }
  | { ok: false; status: 400 | 404 };

export async function createBillExport(
  db: PaymentsDb,
  query: URLSearchParams,
  ctx: BillExportContext,
): Promise<BillExportResult> {
  const parsed = querySchema.safeParse({
    month: query.get("month") ?? undefined,
    customer: query.get("customer") ?? undefined,
    format: query.get("format") ?? undefined,
    locale: query.get("locale") ?? undefined,
  });
  const period = parsed.success ? parseMonthKey(parsed.data.month) : null;
  if (!parsed.success || !period) return { ok: false, status: 400 };
  const { customer: customerId, format, locale } = parsed.data;
  // A PDF is one customer's document; there is no PDF of "everybody".
  if (format === "pdf" && !customerId) return { ok: false, status: 400 };

  if (!customerId) {
    const texts = await ctx.texts(locale);
    const rows = await allCustomersRows(db, period, { ...ctx, locale, texts });
    return {
      ok: true,
      fileName: exportFileName({ monthKey: monthKey(period), extension: "csv" }),
      contentType: "text/csv; charset=utf-8",
      body: buildBillCsv(rows, texts.csv, csvStyleFor(locale)),
    };
  }

  const bill = await monthlyBillQuery(db, customerId, parsed.data.month, ctx.today);
  if (!bill) return { ok: false, status: 404 };
  const fileName = exportFileName({
    customerNumber: bill.customer.customerNumber,
    monthKey: bill.monthKey,
    extension: format,
  });

  if (format === "pdf") {
    const pdfLocale = pdfLocaleFor(locale);
    const texts = await ctx.texts(pdfLocale);
    const model = billPdfModel(bill, {
      locale: pdfLocale,
      timezone: ctx.timezone,
      depot: ctx.depot,
      texts,
    });
    return {
      ok: true,
      fileName,
      contentType: "application/pdf",
      body: await renderBillPdf(model, {
        title: `${texts.document.title} ${bill.customer.customerNumber} ${bill.monthKey}`,
        author: ctx.depot?.name,
      }),
    };
  }

  const texts = await ctx.texts(locale);
  const rows = exportRows(
    {
      monthKey: bill.monthKey,
      customerNumber: bill.customer.customerNumber,
      customerName: bill.customer.name,
      orders: bill.orders,
      adjustments: bill.adjustments,
      state: bill.state,
      paidOn: bill.payment ? dayIn(new Date(bill.payment.paidAt), ctx.timezone) : null,
      paidCents: bill.payment ? bill.payment.amountCents : null,
    },
    locale,
    texts,
  );
  return {
    ok: true,
    fileName,
    contentType: "text/csv; charset=utf-8",
    body: buildBillCsv(rows, texts.csv, csvStyleFor(locale)),
  };
}
