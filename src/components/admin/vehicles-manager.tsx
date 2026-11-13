"use client";

import { BanIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/shared/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RowButton, RowButtons } from "@/components/ui/row-actions";
import { Switch } from "@/components/ui/switch";
import {
  stackedTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseCapacityKg } from "@/domain/vehicle";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  createVehicleAction,
  setVehicleActiveAction,
  updateVehicleAction,
} from "@/server/vehicle-actions";
import type { VehicleRow } from "@/server/vehicles";

type FormState = { id: string | null; name: string; plate: string; capacity: string };
type FormError = "invalid" | "generic" | "nameTaken" | "nameRequired" | "capacityInvalid" | null;

const EMPTY: FormState = { id: null, name: "", plate: "", capacity: "" };

/**
 * Vehicle master data (NUD-146, D24): a table of the fleet with the capacity in kg, an inline
 * Aktiv/Inaktiv switch (soft delete behind a confirm dialog, never a delete button) and one dialog
 * for creating and editing. Same patterns as the product list.
 */
export function VehiclesManager({ rows }: { rows: VehicleRow[] }) {
  const t = useTranslations("admin.vehicles");
  const tc = useTranslations("common");
  const fmt = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<FormError>(null);
  const [confirming, setConfirming] = useState<VehicleRow | null>(null);

  function openForm(state: FormState) {
    setError(null);
    setForm(state);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    if (form.name.trim() === "") return setError("nameRequired");
    if (parseCapacityKg(form.capacity) === null) return setError("capacityInvalid");
    setError(null);
    const input = { name: form.name, plate: form.plate, capacityKg: form.capacity };
    startTransition(async () => {
      let result;
      try {
        result = form.id
          ? await updateVehicleAction(form.id, input)
          : await createVehicleAction(input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        return setError(
          result.error === "name_taken"
            ? "nameTaken"
            : result.error === "invalid"
              ? "invalid"
              : "generic",
        );
      }
      toast.success(form.id ? t("form.savedEdit") : t("form.savedNew"));
      setForm(null);
      router.refresh();
    });
  }

  function setActive(vehicle: VehicleRow, next: boolean) {
    if (!next) return setConfirming(vehicle);
    startTransition(async () => {
      try {
        const result = await setVehicleActiveAction(vehicle.id, true);
        if (!result.ok) return void toast.error(tc("errors.generic"));
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      toast.success(t("activated"));
      router.refresh();
    });
  }

  function confirmDeactivate() {
    if (!confirming) return;
    const vehicle = confirming;
    startTransition(async () => {
      try {
        const result = await setVehicleActiveAction(vehicle.id, false);
        if (!result.ok) return void toast.error(tc("errors.generic"));
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      toast.success(t("deactivated"));
      setConfirming(null);
      router.refresh();
    });
  }

  const errorText = error ? (error === "generic" ? t("form.generic") : t(`form.${error}`)) : null;

  return (
    <TooltipProvider>
      {/* The header lives here (like the drivers page): its button opens the form of this
          component, and it belongs next to the title, not on a row of its own. */}
      <PageHeader
        title={t("title")}
        actions={
          <Button type="button" onClick={() => openForm(EMPTY)} data-testid="new-vehicle">
            <PlusIcon aria-hidden />
            {t("new")}
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("empty")} />
      ) : (
        <Card>
          <CardContent>
            <Table data-testid="vehicles-table" className={stackedTable.table}>
              <TableHeader data-sticky className={stackedTable.header}>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead className="max-sm:hidden">{t("columns.plate")}</TableHead>
                  <TableHead className="text-end">{t("columns.capacity")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead className="text-end">
                    <span className="sr-only">{t("columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={stackedTable.body}>
                {rows.map((v) => (
                  <TableRow
                    key={v.id}
                    data-testid="vehicle-row"
                    data-vehicle-id={v.id}
                    className={cn(stackedTable.row, !v.active && "text-muted-foreground")}
                  >
                    <TableCell
                      className={cn("py-1.5 font-medium", stackedTable.cell)}
                      data-testid="vehicle-name"
                    >
                      {v.name}
                    </TableCell>
                    <TableCell className="py-1.5 tabular-nums max-sm:hidden">
                      {v.plate ?? "–"}
                    </TableCell>
                    <TableCell
                      className={cn("py-1.5 text-end tabular-nums", stackedTable.cell)}
                      data-testid="vehicle-capacity"
                    >
                      {t("capacityValue", { kg: fmt.number(v.capacityKg) })}
                    </TableCell>
                    <TableCell className={cn("py-1.5", stackedTable.cell)}>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={v.active}
                          disabled={pending}
                          aria-label={t("toggleStatus", { name: v.name })}
                          data-testid="vehicle-status"
                          onCheckedChange={(next) => setActive(v, next)}
                        />
                        <span
                          className="text-xs whitespace-nowrap"
                          data-testid={v.active ? "status-active" : "status-inactive"}
                        >
                          {v.active ? t("status.active") : t("status.inactive")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={cn("py-1.5 text-end", stackedTable.cell)}>
                      {/* One direct button: the switch next to it already turns a vehicle on
                          and off, so the row needs no menu. */}
                      <RowButtons className="max-md:flex max-md:justify-end">
                        <RowButton
                          icon={PencilIcon}
                          label={t("edit")}
                          subject={v.name}
                          className="max-md:px-4"
                          data-testid="vehicle-edit"
                          onClick={() =>
                            openForm({
                              id: v.id,
                              name: v.name,
                              plate: v.plate ?? "",
                              capacity: String(v.capacityKg),
                            })
                          }
                        />
                      </RowButtons>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent data-testid="vehicle-dialog">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
          </DialogHeader>
          {form ? (
            <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
              <FormField label={t("form.name")} htmlFor="vehicle-name-input" required>
                <Input
                  id="vehicle-name-input"
                  value={form.name}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="vehicle-name-input"
                />
              </FormField>
              <FormField label={t("form.plate")} htmlFor="vehicle-plate-input">
                <Input
                  id="vehicle-plate-input"
                  value={form.plate}
                  maxLength={20}
                  autoComplete="off"
                  onChange={(e) => setForm({ ...form, plate: e.target.value })}
                  data-testid="vehicle-plate-input"
                />
              </FormField>
              <FormField
                label={t("form.capacity")}
                htmlFor="vehicle-capacity-input"
                info={t("form.capacityHint")}
                required
              >
                <Input
                  id="vehicle-capacity-input"
                  value={form.capacity}
                  inputMode="numeric"
                  maxLength={5}
                  autoComplete="off"
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  data-testid="vehicle-capacity-input"
                />
              </FormField>
              {errorText ? (
                <Alert variant="destructive" data-testid="vehicle-form-error" data-code={error}>
                  <AlertDescription>{errorText}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  {tc("actions.cancel")}
                </Button>
                <Button type="submit" disabled={pending} data-testid="vehicle-save">
                  {pending ? t("form.saving") : t("form.save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming ? t("confirm.deactivateTitle", { name: confirming.name }) : null}
            </DialogTitle>
          </DialogHeader>
          <p className="text-base text-muted-foreground">{t("confirm.deactivateBody")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
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
