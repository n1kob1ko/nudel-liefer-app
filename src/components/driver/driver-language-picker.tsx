"use client";

import { LanguagesIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { chooseDriverLocaleAction } from "@/server/driver-locale-actions";

/** Full-screen first-start picker: five big buttons, each in its own script, no other text. */
export function DriverLanguagePicker() {
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-end gap-4 p-4 pb-8"
      data-testid="language-picker"
    >
      <LanguagesIcon className="mx-auto mb-2 size-14" aria-hidden />
      {/* The page has no text of its own (no language is known yet): the heading lists the languages. */}
      <h1 className="sr-only">
        {LOCALES.map((code) => (
          <span key={code} lang={code}>
            {LOCALE_LABELS[code]}{" "}
          </span>
        ))}
      </h1>
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          disabled={pending}
          aria-busy={pending && chosen === code}
          data-testid={`pick-${code}`}
          className="min-h-20 rounded-xl border border-input/60 bg-card px-4 text-3xl font-semibold shadow-xs outline-none transition-[background-color,border-color,transform] duration-[140ms] ease-out hover:border-input hover:bg-muted/60 focus-visible:ring-4 focus-visible:ring-ring active:scale-[.97] disabled:opacity-60"
          onClick={() => {
            setChosen(code);
            startTransition(async () => {
              await chooseDriverLocaleAction(code);
            });
          }}
        >
          {LOCALE_LABELS[code]}
        </button>
      ))}
    </main>
  );
}
