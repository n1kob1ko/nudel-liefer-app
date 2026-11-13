import { type AbstractIntlMessages, createTranslator } from "next-intl";

import { authErrorStatus, requireRole } from "./auth/guards";
import { createBillExport, exportTextsFrom } from "./bill-export";
import { getDb } from "./db";
import { todayIn } from "./orders";
import { getSettings } from "./settings";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * The export texts in one language, read straight from the message file: the language of the file
 * is a parameter of the download (`locale=`), not the language of a page.
 */
async function textsFor(locale: "de" | "en" | "zh-Hans") {
  const messages = (await import(`../../messages/${locale}.json`)).default as AbstractIntlMessages;
  return exportTextsFrom(
    createTranslator({ locale, messages, namespace: "admin.payments" }),
    createTranslator({ locale, messages, namespace: "common" }),
  );
}

/**
 * `GET /api/admin/payments/export` (NUD-198): a monthly bill as a file.
 *
 * `month=YYYY-MM` (required), `customer=<id>` (one customer; without it every customer of the
 * month, CSV only), `format=csv|pdf` (default csv), `locale=de|en|zh-Hans` (default de).
 *
 * ADMIN only: `requireRole("ADMIN")` comes first, anonymous -> 401, other roles -> 403. The file
 * holds customer names and amounts: never cached, always sent as an attachment so the browser
 * saves it instead of showing it.
 */
export async function billExportResponse(
  request: Request,
  now: Date = new Date(),
): Promise<Response> {
  try {
    await requireRole("ADMIN");
  } catch (error) {
    const status = authErrorStatus(error);
    if (!status) throw error;
    return Response.json(
      { error: status === 401 ? "unauthenticated" : "forbidden" },
      { status, headers: NO_STORE },
    );
  }

  const settings = await getSettings();
  const timezone = settings?.timezone ?? "Europe/Vienna";
  const result = await createBillExport(getDb(), new URL(request.url).searchParams, {
    today: todayIn(timezone, now),
    timezone,
    depot: settings ? { name: settings.depotName, address: settings.depotAddress } : null,
    texts: textsFor,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.status === 400 ? "invalid" : "not_found" },
      { status: result.status, headers: NO_STORE },
    );
  }

  const body = typeof result.body === "string" ? result.body : Buffer.from(result.body);
  return new Response(body, {
    headers: {
      ...NO_STORE,
      "Content-Type": result.contentType,
      // The name is built from letters, digits, `-` and `_` only (`exportFileName`).
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
