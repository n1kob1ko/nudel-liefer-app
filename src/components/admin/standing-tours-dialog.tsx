"use client";

import { PlusIcon, SearchIcon, SlidersHorizontalIcon, UserPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DayPlan } from "@/domain/standing-day";
import { useRouter } from "@/i18n/navigation";
import { saveStandingTourAction, setStandingTourActiveAction } from "@/server/standing-actions";

/**
 * Managing the standing tours ("Stammtouren", NUD-186): name, default driver and the customers that
 * belong to the group. A customer belongs to exactly one active group; the day plan lists the
 * customers of its groups every delivery day.
 *
 * Only the groups themselves are edited here — the quantities of a day are the day plan's business.
 */

type Draft = {
  id: string | null;
  name: string;
  driverId: string | null;
  customerIds: string[];
};

const NONE = "__none__";

export function StandingToursDialog({
  plan,
  drivers,
}: {
  plan: DayPlan;
  drivers: ReadonlyArray<{ id: string; displayName: string }>;
}) {
  const t = useTranslations("admin.planning");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | "new">(plan.routes[0]?.id ?? "new");
  const [draft, setDraft] = useState<Draft>(() => draftOf(plan, plan.routes[0]?.id ?? "new"));
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Every active customer: the customers of the groups plus the off-route ones.
  const customers = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; customerNumber: string; name: string; city: string }> = [];
    for (const row of [...plan.routes.flatMap((route) => route.rows), ...plan.offRoute]) {
      if (seen.has(row.customerId)) continue;
      seen.add(row.customerId);
      out.push({
        id: row.customerId,
        customerNumber: row.customerNumber,
        name: row.name,
        city: row.city,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [plan]);

  // Which group each customer belongs to (for the "already in another group" hint).
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const route of plan.routes) {
      for (const row of route.rows) map.set(row.customerId, route.id);
    }
    return map;
  }, [plan]);

  function openFor(target: string | "new") {
    setSelected(target);
    setDraft(draftOf(plan, target));
    setError(null);
    setSearch("");
  }

  function toggleCustomer(customerId: string) {
    setDraft((current) => ({
      ...current,
      customerIds: current.customerIds.includes(customerId)
        ? current.customerIds.filter((id) => id !== customerId)
        : [...current.customerIds, customerId],
    }));
    setError(null);
  }

  function save() {
    if (draft.name.trim() === "") return setError(t("manage.errors.invalid"));
    startTransition(async () => {
      let result;
      try {
        result = await saveStandingTourAction({
          id: draft.id,
          name: draft.name.trim(),
          driverId: draft.driverId,
          customerIds: draft.customerIds,
        });
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t(`manage.errors.${result.error}`));
      toast.success(result.created ? t("manage.created") : t("manage.saved"));
      setOpen(false);
      router.refresh();
    });
  }

  function archive() {
    if (!draft.id) return;
    startTransition(async () => {
      let result;
      try {
        result = await setStandingTourActiveAction(draft.id, false);
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t("errors.generic"));
      toast.success(t("manage.archived"));
      setOpen(false);
      router.refresh();
    });
  }

  const filtered = customers.filter((customer) => {
    const term = search.trim().toLowerCase();
    return (
      term === "" ||
      customer.name.toLowerCase().includes(term) ||
      customer.customerNumber.toLowerCase().includes(term) ||
      customer.city.toLowerCase().includes(term)
    );
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          openFor(plan.routes[0]?.id ?? "new");
          setOpen(true);
        }}
        data-testid="standing-tours-open"
      >
        <SlidersHorizontalIcon aria-hidden />
        {t("manage.open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("manage.title")}</DialogTitle>
            <DialogDescription>{t("manage.description")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={selected === "new" ? "secondary" : "outline"}
              size="sm"
              onClick={() => openFor("new")}
              data-testid="standing-tour-new"
            >
              <PlusIcon aria-hidden />
              {t("manage.new")}
            </Button>
            {plan.routes.map((route) => (
              <Button
                key={route.id}
                type="button"
                variant={selected === route.id ? "secondary" : "outline"}
                size="sm"
                onClick={() => openFor(route.id)}
                data-testid={`standing-tour-pick-${route.id}`}
              >
                {route.name}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="standing-tour-name">{t("manage.name")}</Label>
              <Input
                id="standing-tour-name"
                value={draft.name}
                maxLength={80}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, name: event.target.value }));
                  setError(null);
                }}
                placeholder={t("manage.namePlaceholder")}
                data-testid="standing-tour-name"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="standing-tour-driver">{t("manage.driver")}</Label>
              <Select
                value={draft.driverId ?? NONE}
                onValueChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    driverId: next === NONE ? null : next,
                  }))
                }
              >
                <SelectTrigger id="standing-tour-driver" data-testid="standing-tour-driver">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("route.noDriver")}</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t("manage.customers")}</Label>
              <span className="text-sm text-muted-foreground">
                {t("manage.selected", { count: draft.customerIds.length })}
              </span>
            </div>
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("manage.search")}
                aria-label={t("manage.search")}
                className="pl-9"
                data-testid="standing-tour-search"
              />
            </div>
            <ul
              className="max-h-64 overflow-y-auto rounded-md border border-border"
              data-testid="standing-tour-customers"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">{t("manage.noMatch")}</li>
              ) : (
                filtered.map((customer) => {
                  const otherGroup = groupOf.get(customer.id);
                  const inOther = otherGroup !== undefined && otherGroup !== draft.id;
                  const checked = draft.customerIds.includes(customer.id);
                  return (
                    <li
                      key={customer.id}
                      className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <input
                        id={`pick-${customer.id}`}
                        type="checkbox"
                        className="mt-1 size-4 accent-foreground"
                        checked={checked}
                        disabled={inOther}
                        onChange={() => toggleCustomer(customer.id)}
                        data-testid={`pick-${customer.id}`}
                      />
                      <label htmlFor={`pick-${customer.id}`} className="min-w-0 flex-1">
                        <span className="block text-base">{customer.name}</span>
                        <span className="block text-sm text-muted-foreground">
                          {customer.customerNumber} · {customer.city}
                          {inOther ? ` · ${t("manage.inOther")}` : ""}
                        </span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="manage-error">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-wrap gap-2">
            {draft.id ? (
              <Button
                type="button"
                variant="outline"
                onClick={archive}
                disabled={pending}
                data-testid="standing-tour-archive"
              >
                {t("manage.archive")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("manage.cancel")}
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={pending}
              data-testid="standing-tour-save"
            >
              <UserPlusIcon aria-hidden />
              {pending ? t("manage.saving") : t("manage.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function draftOf(plan: DayPlan, target: string | "new"): Draft {
  if (target === "new") return { id: null, name: "", driverId: null, customerIds: [] };
  const route = plan.routes.find((entry) => entry.id === target);
  if (!route) return { id: null, name: "", driverId: null, customerIds: [] };
  return {
    id: route.id,
    name: route.name,
    driverId: route.driverId,
    customerIds: route.rows.map((row) => row.customerId),
  };
}
