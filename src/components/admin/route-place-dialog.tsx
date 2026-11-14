"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
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
import type { DayPlanRoute, DayPlanRow } from "@/domain/standing-day";
import { cn } from "@/lib/utils";
import { moveExtraAction } from "@/server/standing-actions";

/**
 * "Verschieben" of an extra customer (NUD-212): the office picks the route and after which standing
 * customer it is delivered, or lets the app put it back where the detour is smallest. Only this
 * delivery day changes; the standing tours stay as they are.
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
  /** The route the extra rides on now. */
  routeId: string;
  routes: ReadonlyArray<DayPlanRoute>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}) {
  const t = useTranslations("admin.planning.move");
  const te = useTranslations("admin.planning.errors");
  const membersOf = (id: string) =>
    (routes.find((r) => r.id === id)?.rows ?? []).filter((r) => r.extra === null);
  const [target, setTarget] = useState(routeId);
  const [slot, setSlot] = useState(row.extra?.slot ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const members = membersOf(target);

  function pick(id: string) {
    setTarget(id);
    // Another route: the end of it, the office moves it up from there.
    setSlot(id === routeId ? (row.extra?.slot ?? 0) : membersOf(id).length);
    setError(null);
  }

  function save(standingTourId: string | null, value: number | null) {
    startTransition(async () => {
      let result;
      try {
        result = await moveExtraAction({
          date,
          customerId: row.customerId,
          standingTourId,
          slot: value,
        });
      } catch {
        return setError(te("generic"));
      }
      if (!result.ok) return setError(t(`errors.${result.error}`));
      toast.success(t("saved"));
      onOpenChange(false);
      onMoved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { name: row.name })}</DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
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
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => save(null, null)}
            data-testid="move-auto"
          >
            {t("auto")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => save(target, Math.min(slot, members.length))}
            data-testid="move-save"
          >
            {pending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
