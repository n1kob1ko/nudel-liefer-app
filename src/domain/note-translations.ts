/**
 * Pure merge rules of the multilingual note editor (NUD-071, backlog D15).
 *
 * A note is a `LocalizedText` whose source is German. The other four versions (en, sr-Latn, cs,
 * zh-Hans, D21) are either machine-made (`meta.machine[locale] = true`) or hand-written (non-empty,
 * not flagged). When the
 * German source changes, machine versions are replaced by fresh translations; hand-written ones
 * are kept but flagged in `meta.stale` ("source changed, check translation"). Every function
 * returns a new object with a fresh `meta.updatedAt` (the retry job's concurrency guard relies on
 * it) and never mutates its input. The translation itself is injected (`fresh`), not done here.
 */
import { type AppLocale, type LocalizedText } from "@/lib/localized-text";

/** Every language except the German source, in display order. */
export const TRANSLATED_LOCALES = ["en", "sr-Latn", "cs", "zh-Hans"] as const;
export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];
/**
 * Machine translation of the (new) German source per locale. A locale the provider could not
 * translate (for example Serbian while no Claude key is configured) is simply absent.
 */
export type FreshTranslations = Partial<Record<TranslatedLocale, string>>;

export type TranslationKind = "source" | "machine" | "manual" | "empty";
export type TranslationRow = {
  locale: AppLocale;
  value: string;
  kind: TranslationKind;
  /** Hand-written text that may no longer match the changed German source. */
  stale: boolean;
};

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

function clone(text: LocalizedText, now: Date): LocalizedText {
  const next: LocalizedText = {
    ...text,
    meta: {
      ...text.meta,
      machine: { ...text.meta.machine },
      ...(text.meta.stale ? { stale: { ...text.meta.stale } } : {}),
    },
  };
  next.meta.updatedAt = now.toISOString();
  return next;
}

function tidy(text: LocalizedText): LocalizedText {
  if (text.meta.stale && !Object.values(text.meta.stale).some(Boolean)) delete text.meta.stale;
  if (TRANSLATED_LOCALES.every((l) => !isBlank(text[l]))) delete text.meta.pendingTranslation;
  return text;
}

function setMachine(text: LocalizedText, locale: TranslatedLocale, value: string): void {
  text[locale] = value;
  text.meta.machine[locale] = true;
  if (text.meta.stale) delete text.meta.stale[locale];
}

function clearLocale(text: LocalizedText, locale: TranslatedLocale): void {
  delete text[locale];
  delete text.meta.machine[locale];
  if (text.meta.stale) delete text.meta.stale[locale];
}

/** The five versions in display order with their origin (source / machine / hand-written / empty). */
export function describeTranslations(text: LocalizedText): TranslationRow[] {
  return (["de", ...TRANSLATED_LOCALES] as const).map((locale) => {
    const value = text[locale] ?? "";
    const kind: TranslationKind = isBlank(value)
      ? "empty"
      : locale === text.meta.source
        ? "source"
        : text.meta.machine[locale] === true
          ? "machine"
          : "manual";
    return { locale, value, kind, stale: kind === "manual" && text.meta.stale?.[locale] === true };
  });
}

/**
 * The German source changed. Machine (and empty) Chinese versions take the fresh translation
 * (`fresh === null` = the provider failed: they are emptied and the text is marked pending for the
 * retry job); hand-written versions are kept and flagged stale.
 */
export function mergeSourceChange(
  stored: LocalizedText,
  newGerman: string,
  fresh: FreshTranslations | null,
  now: Date = new Date(),
): LocalizedText {
  const next = clone(stored, now);
  next.de = newGerman.trim();
  next.meta.source = "de";
  delete next.meta.machine.de;
  let missing = false;
  for (const locale of TRANSLATED_LOCALES) {
    const manual = !isBlank(next[locale]) && next.meta.machine[locale] !== true;
    const translated = fresh?.[locale];
    if (manual) {
      next.meta.stale = { ...next.meta.stale, [locale]: true };
    } else if (translated !== undefined && !isBlank(translated)) {
      setMachine(next, locale, translated);
    } else {
      clearLocale(next, locale);
      missing = true;
    }
  }
  if (missing) next.meta.pendingTranslation = true;
  return tidy(next);
}

/**
 * "Re-translate": every version the provider translated becomes a fresh machine translation
 * (manual edits lost). A locale the provider could not translate is cleared and the text is marked
 * pending, so the retry job fills it later.
 */
export function retranslateAll(
  stored: LocalizedText,
  fresh: FreshTranslations,
  now: Date = new Date(),
): LocalizedText {
  const next = clone(stored, now);
  delete next.meta.pendingTranslation;
  for (const locale of TRANSLATED_LOCALES) {
    const translated = fresh[locale];
    if (translated !== undefined && !isBlank(translated)) setMachine(next, locale, translated);
    else {
      clearLocale(next, locale);
      next.meta.pendingTranslation = true;
    }
  }
  return tidy(next);
}

export type TranslationSave = {
  /** Texts as shown in the editor; only versions that differ from the stored one count as edited. */
  values: Partial<Record<AppLocale, string>>;
  /** Stale hand-written versions the office checked and left unchanged. */
  reviewed?: readonly TranslatedLocale[];
};

/** True when saving `values` changes the German source (the caller then needs `fresh`). */
export function changesSource(stored: LocalizedText, values: TranslationSave["values"]): boolean {
  return values.de !== undefined && values.de.trim() !== (stored.de ?? "");
}

/**
 * Applies the editor's save: a changed German source first goes through `mergeSourceChange`; then
 * every edited translated version becomes hand-written (machine flag and stale flag removed), and
 * checked ones lose their stale flag. Edits are detected against the stored text, so an untouched
 * machine version is replaced by the fresh translation even though the form still held the old one.
 */
export function applyTranslationSave(
  stored: LocalizedText,
  save: TranslationSave,
  fresh: FreshTranslations | null,
  now: Date = new Date(),
): LocalizedText {
  let next = changesSource(stored, save.values)
    ? mergeSourceChange(stored, save.values.de ?? "", fresh, now)
    : clone(stored, now);
  next = clone(next, now);
  for (const locale of TRANSLATED_LOCALES) {
    const submitted = save.values[locale];
    if (submitted === undefined) continue;
    const value = submitted.trim();
    if (value === (stored[locale] ?? "")) continue;
    if (value === "") clearLocale(next, locale);
    else {
      next[locale] = value;
      delete next.meta.machine[locale];
      if (next.meta.stale) delete next.meta.stale[locale];
    }
  }
  for (const locale of save.reviewed ?? []) {
    if (next.meta.stale) delete next.meta.stale[locale];
  }
  return tidy(next);
}
