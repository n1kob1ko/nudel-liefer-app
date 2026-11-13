"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseWeightKg } from "@/domain/weight";
import { Link, useRouter } from "@/i18n/navigation";
import { UNITS } from "@/lib/units";
import { createProductAction, updateProductAction } from "@/server/product-actions";
import type { ProductFormValues } from "@/server/products";

type Props = {
  /** `null` creates a product; an id edits that product. */
  productId: string | null;
  initial: ProductFormValues;
  /** The unit cannot change once the product is on an order. */
  unitLocked: boolean;
};

type FormError = "invalid" | "generic" | "skuTaken" | "unitLocked" | "weightInvalid" | null;

export function ProductForm({ productId, initial, unitLocked }: Props) {
  const t = useTranslations("admin.products.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sku, setSku] = useState(initial.sku);
  const [unit, setUnit] = useState(initial.unit);
  const [weight, setWeight] = useState(initial.weightKgPerUnit);
  const [de, setDe] = useState(initial.de);
  const [hans, setHans] = useState(initial.hans);
  const [en, setEn] = useState(initial.en);
  const [sr, setSr] = useState(initial.sr);
  const [cs, setCs] = useState(initial.cs);
  // New products start "auto" (machine-translated on save); an existing name stays "auto" only if
  // it was machine-translated.
  const [enAuto, setEnAuto] = useState(productId === null ? true : initial.enAuto);
  const [srAuto, setSrAuto] = useState(productId === null ? true : initial.srAuto);
  const [csAuto, setCsAuto] = useState(productId === null ? true : initial.csAuto);
  const [error, setError] = useState<FormError>(null);
  const [hansMissing, setHansMissing] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setHansMissing(hans.trim() === "");
    if (hans.trim() === "" || de.trim() === "" || sku.trim() === "") return setError("invalid");
    if (parseWeightKg(weight) === null) return setError("weightInvalid");
    const input = {
      sku,
      unit,
      weightKgPerUnit: weight,
      name: { de, hans, en, sr, cs },
      enAuto,
      srAuto,
      csAuto,
    };
    startTransition(async () => {
      let result;
      try {
        result = productId
          ? await updateProductAction(productId, input)
          : await createProductAction(input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        if (result.error === "sku_taken") return setError("skuTaken");
        if (result.error === "unit_locked") return setError("unitLocked");
        return setError(result.error === "not_found" ? "generic" : "invalid");
      }
      toast.success(t(productId ? "savedEdit" : "savedNew"));
      router.push("/admin/products");
      router.refresh();
    });
  }

  const autoBadge = (
    <Badge variant="secondary" data-testid="auto-badge">
      {t("auto")}
    </Badge>
  );

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-8" noValidate>
      <section
        className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-sm"
        aria-labelledby="prod-data"
      >
        <h2 id="prod-data" className="text-lg font-semibold tracking-tight">
          {t("dataHeading")}
        </h2>
        <FormField label={t("sku")} htmlFor="prod-sku" required className="max-w-xs">
          <Input
            id="prod-sku"
            value={sku}
            maxLength={32}
            onChange={(e) => {
              setSku(e.target.value);
              if (error === "skuTaken") setError(null);
            }}
            aria-invalid={error === "skuTaken" || undefined}
            required
            data-testid="product-sku"
          />
        </FormField>
        {error === "skuTaken" ? (
          <p
            className="-mt-2 max-w-xs text-sm text-destructive"
            role="alert"
            data-testid="sku-taken"
          >
            {t("skuTaken")}
          </p>
        ) : null}
        <FormField
          label={t("unit")}
          htmlFor="prod-unit"
          className="max-w-xs"
          description={unitLocked ? t("unitLocked") : undefined}
        >
          <Select
            value={unit}
            disabled={unitLocked}
            onValueChange={(v) => setUnit(v as typeof unit)}
          >
            <SelectTrigger id="prod-unit" data-testid="product-unit" aria-label={t("unit")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {tc(`unitNames.${u}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          label={t("weight")}
          htmlFor="prod-weight"
          required
          className="max-w-xs"
          info={t("weightHint")}
        >
          <Input
            id="prod-weight"
            inputMode="decimal"
            value={weight}
            maxLength={8}
            onChange={(e) => {
              setWeight(e.target.value);
              if (error === "weightInvalid") setError(null);
            }}
            aria-invalid={error === "weightInvalid" || undefined}
            required
            data-testid="product-weight"
          />
        </FormField>
      </section>

      <section
        className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-sm"
        aria-labelledby="prod-names"
      >
        <h2 id="prod-names" className="text-lg font-semibold tracking-tight">
          {t("namesHeading")}
          <InfoTip className="ms-2">{t("namesHint")}</InfoTip>
        </h2>
        <FormField label={t("nameDe")} htmlFor="prod-de" required className="max-w-xl">
          <Input
            id="prod-de"
            lang="de"
            value={de}
            maxLength={160}
            onChange={(e) => setDe(e.target.value)}
            required
            data-testid="product-name-de"
          />
        </FormField>
        <FormField label={t("nameHans")} htmlFor="prod-hans" required className="max-w-xl">
          <Input
            id="prod-hans"
            lang="zh-Hans"
            value={hans}
            maxLength={160}
            onChange={(e) => {
              setHans(e.target.value);
              setHansMissing(false);
            }}
            data-testid="product-name-hans"
          />
        </FormField>
        {hansMissing ? (
          <p
            className="-mt-2 max-w-xl text-sm text-destructive"
            role="alert"
            data-testid="hans-required"
          >
            {t("hansRequired")}
          </p>
        ) : null}
        {(
          [
            ["en", "en", en, setEn, enAuto, setEnAuto, "nameEn"],
            ["sr", "sr-Latn", sr, setSr, srAuto, setSrAuto, "nameSr"],
            ["cs", "cs", cs, setCs, csAuto, setCsAuto, "nameCs"],
          ] as const
        ).map(([key, lang, value, setValue, auto, setAuto, label]) => (
          <FormField
            key={key}
            label={t(label)}
            htmlFor={`prod-${key}`}
            className="max-w-xl"
            hint={
              <span className="flex flex-wrap items-center gap-2">
                {auto ? autoBadge : null}
                {!auto ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-9 max-w-full shrink whitespace-normal text-start"
                    onClick={() => {
                      setAuto(true);
                      setValue("");
                    }}
                    data-testid={`rederive-${key}`}
                  >
                    <RefreshCwIcon aria-hidden />
                    {t("rederive")}
                  </Button>
                ) : null}
              </span>
            }
          >
            <Input
              id={`prod-${key}`}
              lang={lang}
              value={value}
              maxLength={160}
              placeholder={auto ? t("autoPlaceholder") : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setAuto(false);
              }}
              data-testid={`product-name-${key}`}
            />
          </FormField>
        ))}
      </section>

      {error === "invalid" ||
      error === "generic" ||
      error === "unitLocked" ||
      error === "weightInvalid" ? (
        <p className="text-sm text-destructive" role="alert" data-testid="form-error">
          {error === "unitLocked"
            ? t("unitLockedError")
            : error === "weightInvalid"
              ? t("weightInvalid")
              : t(error === "invalid" ? "invalid" : "generic")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} data-testid="product-save">
          {tc("actions.save")}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/products">{tc("actions.cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
