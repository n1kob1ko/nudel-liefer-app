"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";

import messages from "@/lib/fatal-messages.json";
import { reportClientError } from "@/lib/monitoring-client";
import { PWA_THEME_COLOR, PWA_THEME_FOREGROUND } from "@/lib/pwa";

type Locale = keyof typeof messages;

/** The locale is the first URL segment; anything unknown falls back to German. */
export function fatalLocale(pathname: string): Locale {
  const first = pathname.split("/")[1] ?? "";
  return Object.hasOwn(messages, first) ? (first as Locale) : "de";
}

/**
 * Last-resort error page (`app/global-error.tsx`, NUD-094). It replaces the whole document, so it
 * has no providers, no layout and no message loader: the four texts come from the small generated
 * `fatal-messages.json` and the styles are inline. "Reload" is a full page load on purpose.
 */
export function FatalError({ error }: { error: Error & { digest?: string } }) {
  const locale: Locale =
    typeof window === "undefined" ? "de" : fatalLocale(window.location.pathname);
  const t = messages[locale];
  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);
  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 16,
          boxSizing: "border-box",
          fontFamily:
            'system-ui, "PingFang SC", "PingFang HK", "PingFang TC", "Noto Sans SC", "Noto Sans HK", "Noto Sans TC", "Microsoft YaHei", "Microsoft JhengHei", sans-serif',
          fontSize: 18,
          lineHeight: 1.5,
        }}
      >
        <main role="alert" data-testid="fatal-error" style={{ maxWidth: 384, textAlign: "center" }}>
          <AlertTriangleIcon aria-hidden width={40} height={40} />
          <h1 style={{ fontSize: 24, margin: "8px 0" }}>{t.title}</h1>
          <p style={{ margin: "0 0 24px" }}>{t.description}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 48,
              minWidth: 48,
              padding: "0 24px",
              font: "inherit",
              fontWeight: 600,
              border: 0,
              borderRadius: 8,
              color: PWA_THEME_FOREGROUND,
              background: PWA_THEME_COLOR,
            }}
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
