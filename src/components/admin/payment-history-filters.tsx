"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";
import { paidHistoryQueryString } from "@/lib/payment-history-params";

export type PaymentHistoryFilterValues = { q: string; year: number | null };

const DEBOUNCE_MS = 200;
const ALL_YEARS = "all";

/**
 * Filter row of the paid history (NUD-199): search by customer and the year of the billed month.
 * Built like the customer list's filters: the state lives in the URL, typing updates it after a
 * short pause, every change goes back to the first page.
 */
export function PaymentHistoryFilters({
  values,
  years,
}: {
  values: PaymentHistoryFilterValues;
  /** Years that have paid notes, newest first. */
  years: number[];
}) {
  const t = useTranslations("admin.payments.history");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const searchId = useId();
  // The URL (props) is the source of truth, but the controls follow the user at once; the local
  // copy is re-synced when the URL changes by itself (reset, back button).
  const [local, setLocal] = useState(values);
  const [seen, setSeen] = useState(values);
  if (seen.q !== values.q || seen.year !== values.year) {
    setSeen(values);
    setLocal({ year: values.year, q: values.q === "" ? "" : local.q });
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const push = (next: PaymentHistoryFilterValues) => {
    clearTimeout(timer.current);
    setLocal(next);
    startTransition(() => {
      router.replace({ pathname, query: paidHistoryQueryString({ ...next, page: 1 }) });
    });
  };

  const filtered = values.q.trim() !== "" || values.year !== null;
  // A year from an old link that has no notes any more still shows as the selected value.
  const yearOptions =
    local.year !== null && !years.includes(local.year) ? [local.year, ...years] : years;

  return (
    <form
      role="search"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        push(local);
      }}
    >
      <div className="relative min-w-56 flex-1 sm:max-w-md">
        <label htmlFor={searchId} className="sr-only">
          {t("searchLabel")}
        </label>
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={searchId}
          type="search"
          className="pl-9"
          value={local.q}
          maxLength={100}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          data-testid="history-search"
          onChange={(event) => {
            const next = { ...local, q: event.target.value };
            setLocal(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => push(next), DEBOUNCE_MS);
          }}
        />
      </div>

      <Select
        value={local.year === null ? ALL_YEARS : String(local.year)}
        onValueChange={(next) => push({ ...local, year: next === ALL_YEARS ? null : Number(next) })}
      >
        <SelectTrigger aria-label={t("year")} className="h-10 w-36" data-testid="history-year">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_YEARS}>{t("allYears")}</SelectItem>
          {yearOptions.map((year) => (
            <SelectItem key={year} value={String(year)}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => push({ q: "", year: null })}
          data-testid="history-reset"
        >
          <XIcon aria-hidden />
          {t("reset")}
        </Button>
      ) : null}
    </form>
  );
}
