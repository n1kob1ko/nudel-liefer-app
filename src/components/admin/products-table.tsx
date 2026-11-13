"use client";

import { ArrowDownIcon, ArrowUpIcon, BanIcon, CheckCircle2Icon, PencilIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { RowActions } from "@/components/ui/row-actions";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { moveProductAction, setProductActiveAction } from "@/server/product-actions";
import type { ProductRow } from "@/server/products";

/**
 * Product catalog (re-design.md §8.6/§8.10): 48 px rows, the two name columns merged into one cell
 * (German bold, Simplified muted underneath), the unit as a badge and **Aktiv/Inaktiv as an inline
 * `Switch`**. Reordering keeps the existing up/down mechanism exactly, but the arrows move into the
 * row's hover actions as 32 px icon buttons. Deactivation is a soft delete behind a confirm dialog —
 * there is never a "delete" button.
 *
 * Test ids (`products-table`, `product-row`, `data-sku`, `move-up`, `move-down`, `product-edit`,
 * `product-deactivate`, `product-activate`, `status-active`, `status-inactive`) stay as the
 * Playwright spec uses them; the row actions are menu items now, so `getByTestId` still finds them.
 */
export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const t = useTranslations("admin.products");
  const tc = useTranslations("common");
  const fmt = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Deactivation is confirmed because it is a soft delete (the product stops being ordered). */
  const [confirming, setConfirming] = useState<ProductRow | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  function run(action: () => Promise<{ ok: boolean }>, successKey?: string) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return void toast.error(tc("errors.generic"));
      if (successKey) toast.success(t(successKey));
      router.refresh();
    });
  }

  /** `next = true` activates, `next = false` asks first (soft delete). */
  function setActive(product: ProductRow, next: boolean) {
    if (!next) return setConfirming(product);
    run(() => setProductActiveAction(product.id, true), "activated");
  }

  function confirmDeactivate() {
    if (!confirming) return;
    const product = confirming;
    setConfirmPending(true);
    startTransition(async () => {
      let result;
      try {
        result = await setProductActiveAction(product.id, false);
      } catch {
        setConfirmPending(false);
        return void toast.error(tc("errors.generic"));
      }
      setConfirmPending(false);
      if (!result.ok) return void toast.error(tc("errors.generic"));
      toast.success(t("deactivated"));
      setConfirming(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("empty")} />;
  }

  const busy = pending || confirmPending;

  return (
    <TooltipProvider>
      <Table surface data-testid="products-table">
        <TableHeader data-sticky>
          <TableRow>
            <TableHead>
              <span className="sr-only">{t("columns.order")}</span>
            </TableHead>
            <TableHead className="max-md:hidden">{t("columns.sku")}</TableHead>
            {/* Both names share one column (re-design.md §8.6): German bold, Simplified muted below.
                NUD-153: the two long headers wrap instead of forcing the table wider — the table
                then fits 768 px portrait instead of scrolling sideways for the status column. */}
            <TableHead className="whitespace-normal">{t("columns.name")}</TableHead>
            <TableHead className="max-md:hidden">{t("columns.unit")}</TableHead>
            <TableHead className="text-end whitespace-normal max-md:hidden">
              {t("columns.weight")}
            </TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead className="text-end">
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p, index) => {
            const name = p.name.de ?? p.sku;
            return (
              <TableRow
                key={p.id}
                data-testid="product-row"
                data-sku={p.sku}
                className={cn("group/row", !p.active && "text-muted-foreground")}
              >
                {/* ↑↓ reorder + (nothing else): the ordering controls live in the row's action slot. */}
                <TableCell className="w-0 py-1.5 max-md:px-1">
                  <TooltipProvider>
                    {/* Phones: the two arrows stack, so the column is one button wide. */}
                    <div className="flex items-center gap-0.5 opacity-60 max-md:flex-col max-md:gap-0 transition-opacity duration-150 ease-out group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={busy || index === 0}
                        aria-label={t("moveUp", { name })}
                        onClick={() => run(() => moveProductAction(p.id, "up"))}
                        data-testid="move-up"
                      >
                        <ArrowUpIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={busy || index === rows.length - 1}
                        aria-label={t("moveDown", { name })}
                        onClick={() => run(() => moveProductAction(p.id, "down"))}
                        data-testid="move-down"
                      >
                        <ArrowDownIcon aria-hidden />
                      </Button>
                    </div>
                  </TooltipProvider>
                </TableCell>

                <TableCell className="py-1.5 max-md:hidden">
                  {/* Artikelnr. */}
                  <span className="font-mono text-sm text-muted-foreground tabular-nums">
                    {p.sku}
                  </span>
                </TableCell>

                {/* NUD-153: no `min-w-48` — at 768 px portrait that floor pushed the status column
                    out of the visible area; the name column now takes what is left and wraps. */}
                <TableCell className="min-w-0 py-1.5">
                  <span
                    className="block text-sm leading-tight font-semibold text-foreground"
                    lang="de"
                  >
                    {p.name.de}
                  </span>
                  <span
                    className="block text-xs leading-tight text-muted-foreground"
                    lang="zh-Hans"
                  >
                    {p.name["zh-Hans"]}
                  </span>
                  <span className="block text-xs text-muted-foreground md:hidden">
                    <span className="font-mono tabular-nums">{p.sku}</span> ·{" "}
                    {tc(`unitNames.${p.unit}`)}
                  </span>
                </TableCell>

                <TableCell className="py-1.5 max-md:hidden">
                  <StatusBadge tone="neutral" size="sm">
                    {tc(`unitNames.${p.unit}`)}
                  </StatusBadge>
                </TableCell>

                <TableCell
                  className="py-1.5 text-end tabular-nums max-md:hidden"
                  data-testid="product-weight-cell"
                >
                  {fmt.number(p.weightKgPerUnit, { maximumFractionDigits: 2 })} kg
                </TableCell>

                <TableCell className="py-1.5">
                  {/* Status is a switch *and* a label, never colour alone. The state marker keeps the
                      `status-active`/`status-inactive` ids the products spec asserts (also after a
                      reload), independent of the switch's own accessible name. */}
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={p.active}
                      disabled={busy}
                      aria-label={t("toggleStatus", { name })}
                      data-testid="product-status"
                      onCheckedChange={(next) => setActive(p, next)}
                    />
                    <span
                      className="text-xs whitespace-nowrap"
                      data-testid={p.active ? "status-active" : "status-inactive"}
                    >
                      {p.active ? t("status.active") : t("status.inactive")}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="py-1.5 text-end">
                  {/* Exactly one visible control per row (re-design.md §8.10). The inline Switch above
                      performs activate/deactivate (with a confirm dialog on deactivate); the overflow
                      menu carries the same action as a labelled item plus Bearbeiten, so the row keeps
                      its `product-deactivate`/`product-activate` contract without a second button. */}
                  <RowActions label={t("rowMenu.label", { name })}>
                    <DropdownMenuItem asChild>
                      <Link href={`/admin/products/${p.id}/edit`} data-testid="product-edit">
                        <PencilIcon aria-hidden />
                        {tc("actions.edit")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant={p.active ? "destructive" : "default"}
                      disabled={busy}
                      data-testid={p.active ? "product-deactivate" : "product-activate"}
                      // Defer so the menu can close before a confirm dialog opens.
                      onSelect={() => setTimeout(() => setActive(p, !p.active), 0)}
                    >
                      {p.active ? <BanIcon aria-hidden /> : <CheckCircle2Icon aria-hidden />}
                      {p.active ? t("deactivate") : t("activate")}
                    </DropdownMenuItem>
                  </RowActions>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming
                ? t("confirm.deactivateTitle", { name: confirming.name.de ?? confirming.sku })
                : null}
            </DialogTitle>
            <DialogDescription>{t("confirm.deactivateBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={confirmPending}
              data-testid="confirm-submit"
              onClick={confirmDeactivate}
            >
              <BanIcon aria-hidden />
              {t("deactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
