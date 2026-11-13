"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { isAppLocale, LOCALE_LABELS, localesFor } from "@/lib/locale-resolution";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/server/locale-actions";

type Variant = "labeled" | "compact" | "icon" | "bar";

/**
 * Native `<select>` (each language in its own script).
 * `labeled`: visible label (login/start pages). `compact`: label for screen readers only (admin header).
 * `icon`: 48 px icon button that opens the native picker (driver top bar).
 * `bar`: language icon plus the visible 48 px select (driver login page, nobody logged in yet).
 * The office screens offer Deutsch · English · 中文, everything else (driver area, start page) all five languages.
 * `query`: search params kept when the locale changes (e.g. the login `callbackUrl`).
 * `area`: which language set to offer. NUD-186 (QA 2026-10-29 F21) needs it on the office LOGIN page,
 * whose path is `/login` and therefore not under `/admin` — the pathname guess would offer all five.
 */
export function LanguageSwitcher({
  variant = "labeled",
  query,
  area,
  className,
}: {
  variant?: Variant;
  query?: Record<string, string>;
  area?: "admin" | "driver";
  /** Extra classes for the `select` (e.g. a 48 px touch height on the login screens). */
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const locales = localesFor(
    area ?? (pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : "driver"),
  );

  const select = (
    <select
      className={cn(
        variant === "icon"
          ? "absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
          : "min-h-12 field rounded-md border border-input bg-card px-3 text-base",
        variant === "bar" && "w-full",
        variant === "compact" && "min-h-10",
        className,
      )}
      value={locale}
      disabled={pending}
      data-testid="language-switcher"
      aria-label={variant === "labeled" ? undefined : t("language")}
      onChange={(event) => {
        const next = event.target.value;
        if (!isAppLocale(next)) return;
        startTransition(async () => {
          await setLocaleAction(next);
          router.replace(query ? { pathname, query } : pathname, { locale: next });
        });
      }}
    >
      {locales.map((code) => (
        <option key={code} value={code} lang={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );

  if (variant === "icon") {
    return (
      <span className="relative flex size-12 items-center justify-center rounded-md hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
        <LanguagesIcon className="size-6" aria-hidden />
        {select}
      </span>
    );
  }
  if (variant === "bar") {
    return (
      <div className="flex items-center gap-2">
        <LanguagesIcon className="size-6 shrink-0" aria-hidden />
        {select}
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-base">
      <span className={variant === "compact" ? "sr-only" : undefined}>{t("language")}</span>
      {select}
    </label>
  );
}
