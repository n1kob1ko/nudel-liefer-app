"use client";

import { ImageOffIcon, MapPinOffIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
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
import { customerListQuery } from "@/lib/customer-list-params";
import { cn } from "@/lib/utils";

export type CustomerFilterValues = {
  q: string;
  status: "active" | "archived" | "all";
  photosMissing: boolean;
  parkingMissing: boolean;
};

const DEBOUNCE_MS = 200;

/**
 * Kunden toolbar (re-design.md §8.5): search with the `/` shortcut (the admin shell focuses the
 * first `input[type=search]` in `main`, which is this one), the two filter chips as real checkboxes
 * styled as chips (the e2e specs toggle them with `.check()`), the active/archived view as a
 * `Select` instead of a native `<select>`, and a reset action that appears only while a filter is
 * set. The state lives in the URL; typing updates it after a short pause.
 */
export function CustomerFilters({ values }: { values: CustomerFilterValues }) {
  const t = useTranslations("admin.customers");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  // The URL (props) is the source of truth, but the controls follow the user at once instead of
  // waiting for the server round trip: local copy, re-synced when the URL changes by itself
  // (e.g. "reset filters"). While typing, `q` is only taken from the URL when it was cleared.
  const [local, setLocal] = useState(values);
  const [seen, setSeen] = useState(values);
  if (
    seen.status !== values.status ||
    seen.photosMissing !== values.photosMissing ||
    seen.parkingMissing !== values.parkingMissing ||
    seen.q !== values.q
  ) {
    setSeen(values);
    setLocal({ ...values, q: values.q === "" ? "" : local.q });
  }
  const q = local.q;
  const setQ = (next: string) => setLocal((l) => ({ ...l, q: next }));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const push = (next: CustomerFilterValues) => {
    clearTimeout(timer.current);
    setLocal(next);
    startTransition(() => {
      router.replace({ pathname, query: customerListQuery({ ...next, page: 1 }) });
    });
  };

  const filtered =
    values.q.trim() !== "" ||
    values.status !== "active" ||
    values.photosMissing ||
    values.parkingMissing;

  return (
    <form
      role="search"
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        push({ ...local, q });
      }}
    >
      <div className="relative min-w-56 flex-1">
        <label htmlFor={searchId} className="sr-only">
          {t("search.label")}
        </label>
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          id={searchId}
          type="search"
          className="pl-9"
          value={q}
          placeholder={t("search.placeholder")}
          autoComplete="off"
          aria-keyshortcuts="/"
          data-testid="customer-search"
          onChange={(e) => {
            const next = e.target.value;
            setQ(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => push({ ...local, q: next }), DEBOUNCE_MS);
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground sm:block"
        >
          /
        </span>
      </div>

      <FilterChip
        testId="filter-photos-missing"
        icon={<ImageOffIcon className="size-4" aria-hidden />}
        label={t("filters.photosMissing")}
        checked={local.photosMissing}
        onCheckedChange={(checked) => push({ ...local, photosMissing: checked })}
      />
      <FilterChip
        testId="filter-parking-missing"
        icon={<MapPinOffIcon className="size-4" aria-hidden />}
        label={t("filters.parkingMissing")}
        checked={local.parkingMissing}
        onCheckedChange={(checked) => push({ ...local, parkingMissing: checked })}
      />

      <div className="flex items-center gap-2">
        <Select
          value={local.status}
          onValueChange={(next) =>
            push({ ...local, status: next as CustomerFilterValues["status"] })
          }
        >
          <SelectTrigger
            aria-label={t("filters.status")}
            className="h-10 w-40"
            data-testid="filter-status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t("filters.statusActive")}</SelectItem>
            <SelectItem value="archived">{t("filters.statusArchived")}</SelectItem>
            <SelectItem value="all">{t("filters.statusAll")}</SelectItem>
          </SelectContent>
        </Select>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              push({ q: "", status: "active", photosMissing: false, parkingMissing: false })
            }
            data-testid="reset-filters"
          >
            <RotateCcwIcon aria-hidden />
            {t("resetFilters")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Filter chip: a real checkbox (keyboard, `.check()` in the specs, `aria-checked` semantics come
 * from the native control) styled as a toggle pill. The label wraps the input, so the whole chip is
 * the target — no JavaScript toggle needed.
 */
function FilterChip({
  testId,
  icon,
  label,
  checked,
  onCheckedChange,
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-base transition-colors duration-150 ease-out select-none motion-reduce:transition-none",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
        checked
          ? "border-transparent bg-primary-soft text-primary-soft-foreground"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-foreground"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        data-testid={testId}
      />
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </label>
  );
}
