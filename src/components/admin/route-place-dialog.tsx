"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DayPlanRoute, DayPlanRow } from "@/domain/standing-day";
import { cn } from "@/lib/utils";
import { assignStandingAction, moveExtraAction } from "@/server/standing-actions";

/**
 * "Route ändern" of a delivery (NUD-212; owner 2026-11-16 for standing customers too). The office
 * picks the route and after which standing customer it is delivered. Two ways:
 * - for this delivery day only (default): the standing tours stay as they are; a standing customer
 *   rides on the other route for the day, "Zurück auf …" puts him back;
 * - "Immer auf dieser Route": the customer joins that standing tour for good at that position (and
 *   leaves any other one).
 */
export function RoutePlaceDialog({
  date,
  row,
  routeId,
  routes,
  open,
  onOpenChange,
  onMoved,
}: {
  date: string;
  row: DayPlanRow;
  /** The route the customer rides on today. */
  routeId: string;
  routes: ReadonlyArray<DayPlanRoute>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}) {
  const t = useTranslations("admin.planning.move");
  const te = useTranslations("admin.planning.errors");
  const switchId = useId();
  // The standing customers of a route today, without the one being moved.
  const membersOf = (id: string) =>
    (routes.find((r) => r.id === id)?.rows ?? []).filter(
      (r) => r.extra === null && r.customerId !== row.customerId,
    );
  // His own standing tour: the route he is on (no `extra`), or where he came from today.
  const home = row.extra ? row.extra.home : routeId;
  const homeName = routes.find((r) => r.id === home)?.name ?? null;
  const slotOnRoute = () => {
    if (row.extra) return row.extra.slot;
    const index = (routes.find((r) => r.id === routeId)?.rows ?? [])
      .filter((r) => r.extra === null)
      .findIndex((r) => r.customerId === row.customerId);
    return Math.max(0, index);
  };
  const [target, setTarget] = useState(routeId);
  const [slot, setSlot] = useState(slotOnRoute);
  const [always, setAlways] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const members = membersOf(target);
  // For the day, his own route is "at home": nothing to store, so only "for good" can reorder it.
  const nothingToDo = !always && target === home && row.extra === null;

  function pick(id: string) {
    setTarget(id);
    // Another route: the end of it, the office moves it up from there.
    setSlot(id === routeId ? slotOnRoute() : membersOf(id).length);
    setError(null);
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch {
        return setError(te("generic"));
      }
      if (!result.ok) return setError(t(`errors.${result.error}` as "errors.invalid"));
      toast.success(done);
      onOpenChange(false);
      onMoved();
    });
  }

  function save() {
    const at = Math.min(slot, members.length);
    const route = routes.find((r) => r.id === target)?.name ?? "";
    if (always) {
      run(
        () =>
          assignStandingAction({
            date,
            customerId: row.customerId,
            standingTourId: target,
            afterCustomerId: at === 0 ? null : (members[at - 1]?.customerId ?? null),
          }),
        t("savedAlways", { route }),
      );
      return;
    }
    run(
      () => moveExtraAction({ date, customerId: row.customerId, standingTourId: target, slot: at }),
      t("saved"),
    );
  }

  function reset() {
    run(
      () => moveExtraAction({ date, customerId: row.customerId, standingTourId: null, slot: null }),
      t("saved"),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { name: row.name })}</DialogTitle>
          <DialogDescription>{always ? t("bodyAlways") : t("body")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-muted-foreground">{t("route")}</legend>
            <div className="flex flex-wrap gap-2">
              {routes.map((route) => (
                <Button
                  key={route.id}
                  type="button"
                  variant="outline"
                  aria-pressed={target === route.id}
                  className={cn(target === route.id && "border-foreground bg-muted")}
                  onClick={() => pick(route.id)}
                  data-testid={`move-route-${route.id}`}
                >
                  {route.name}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor="move-slot" className="text-sm font-medium text-muted-foreground">
              {t("position")}
            </label>
            <Select value={String(slot)} onValueChange={(value) => setSlot(Number(value))}>
              <SelectTrigger id="move-slot" className="w-full" data-testid="move-slot">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("first")}</SelectItem>
                {members.map((member, index) => (
                  <SelectItem key={member.customerId} value={String(index + 1)}>
                    {t("after", { name: member.name })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* A 48 px row: the whole line toggles, not only the small switch. */}
          <label
            htmlFor={switchId}
            className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block text-base font-medium">{t("always")}</span>
              <span className="block text-sm text-muted-foreground">{t("alwaysHint")}</span>
            </span>
            <Switch
              id={switchId}
              checked={always}
              onCheckedChange={(checked) => {
                setAlways(checked);
                setError(null);
              }}
              data-testid="move-always"
            />
          </label>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {row.extra && !always ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={reset}
              data-testid="move-auto"
            >
              {row.extra.home && homeName ? t("home", { route: homeName }) : t("auto")}
            </Button>
          ) : (
            <span aria-hidden />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={pending || nothingToDo}
            onClick={save}
            data-testid="move-save"
          >
            {pending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
