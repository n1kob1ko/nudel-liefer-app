import "../globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { ThemeClass } from "@/components/shared/theme-class";
import { ToasterArea } from "@/components/ui/toaster-area";
import { routing } from "@/i18n/routing";
import { withBasePath } from "@/lib/base-path";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Self-hosted variable font (re-design.md §4.2). Latin only: Chinese text falls through to the
 * per-locale CJK stack in globals.css, which is why `variable` is used instead of a fixed stack.
 */
const geist = Geist({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-geist",
});

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return { title: t("appName") };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    // `suppressHydrationWarning`: `theme.js` below puts `dark` on <html> before React hydrates, so
    // the class of a dark-mode user never matches the server HTML. That is intended; the flag
    // covers this one element only, not its children.
    <html lang={locale} className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/*
         * Colour scheme (NUD-132) is applied before the first paint by this static bootstrap, which
         * reads the NEXT_THEME cookie and puts `dark` on <html>.
         *
         * It must be a *blocking* script: `next/script strategy="beforeInteractive"` was measured to
         * only preload it and queue it in the framework runtime (`self.__next_s.push(["/theme.js"])`),
         * so the class arrived after the first paint and the app flashed the light theme. A plain
         * `<script src>` without async/defer runs while the parser is still blocked here.
         *
         * It is a file and not an inline snippet because production `script-src` has no
         * 'unsafe-inline'; `'self'` covers it (served from our origin under the base path).
         * Rendering the class in the server layout instead is not possible: reading the cookie there
         * makes every route runtime data and `cacheComponents` refuses to prerender any static shell
         * (measured: the build failed with "encountered uncached or runtime data").
         */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- intentional: the theme must be set before the first paint */}
        <script src={withBasePath("/theme.js")} />
        {/* Re-applies the class after client-side navigations (see the component). Suspense is what
            `cacheComponents` requires around the URL data it reads; the fallback is nothing. */}
        <Suspense fallback={null}>
          <ThemeClass />
        </Suspense>
        <NextIntlClientProvider>
          {children}
          {/* Toast colours come from our own tokens (--popover/--border), so the surface follows the
              class on <html> without sonner needing to be told the theme. NUD-176: the host picks its
              position from the path (driver = bottom, office = top), which is URL data — hence the
              same Suspense wrapper as `ThemeClass` above. */}
          <Suspense fallback={null}>
            <ToasterArea />
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
