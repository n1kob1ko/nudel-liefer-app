"use client";

import { AlertTriangleIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Button, buttonVariants } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ABBREVIATION_MAX } from "@/domain/customer-abbreviation";
import { KEY_NUMBER_MAX } from "@/domain/customer-key";
import type { PhotoKind } from "@/domain/photos";
import { Link, useRouter } from "@/i18n/navigation";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";
import { createCustomerAction, updateCustomerAction } from "@/server/customer-actions";
import { geocodeAddressAction } from "@/server/geocode-actions";
import type { GeocodeCandidate } from "@/server/geocoder";

import { CustomerPhotoSlots, type PhotoSlotValue } from "./customer-photo-slots";

export type CustomerFormValues = {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  pin: LatLng | null;
  deliveryHoursInfo: string;
  notes: string;
  /** Office-only master data (NUD-136): legal entity, VAT id, billing address if different. */
  office: OfficeValues;
  /** Customer key (NUD-142). */
  key: KeyValues;
  /** Legacy Abkürzung (NUD-164). */
  abbreviation: string;
};

export type KeyValues = { hasKey: "unknown" | "yes" | "no"; keyNumber: string };

export const EMPTY_KEY_VALUES: KeyValues = { hasKey: "unknown", keyNumber: "" };

export type OfficeValues = {
  companyName: string;
  vatId: string;
  billingStreet: string;
  billingPostalCode: string;
  billingCity: string;
};

export const EMPTY_OFFICE_VALUES: OfficeValues = {
  companyName: "",
  vatId: "",
  billingStreet: "",
  billingPostalCode: "",
  billingCity: "",
};

/** Field -> input id, max length and test id for the "Firma & Rechnung" section. */
const OFFICE_FIELDS: ReadonlyArray<{ key: keyof OfficeValues; max: number; width: string }> = [
  { key: "companyName", max: 160, width: "max-w-xl" },
  { key: "vatId", max: 32, width: "max-w-xs" },
  { key: "billingStreet", max: 160, width: "max-w-xl" },
  { key: "billingPostalCode", max: 16, width: "max-w-32" },
  { key: "billingCity", max: 100, width: "max-w-sm" },
];

type Props = {
  /** `null` creates a customer; an id edits that customer. */
  customerId: string | null;
  initial: CustomerFormValues;
  tiles: MapTileConfig;
  /** Customer name for the photo tiles' alt text. */
  customerName?: string;
  /** Current photos; the "Fotos" section renders only when this is passed (edit page). */
  photos?: Record<PhotoKind, PhotoSlotValue | null>;
};

const LOW_CONFIDENCE = 0.5;
const selectClass =
  "h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
const textareaClass =
  "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:border-destructive";

type Search =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "message"; message: "noAddress" | "notFound" | "failed" }
  | { state: "results"; candidates: GeocodeCandidate[] };

/** "Teststraße 12, 1010 Wien, AT" — the address the geocoder is asked about. */
function addressQuery(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Customer form (re-design.md §8.5): a two-column layout — labels in a 240 px left column, controls
 * on the right, collapsing to one column below 768 px — in the sections "Stammdaten", "Lieferadresse
 * & Adresspunkt", "Lieferzeiten und Hinweise" and "Fotos", closed by a sticky save bar with an
 * unsaved-changes indicator.
 *
 * The pin picker is one 360 px map: the address search sits as an overlay in the map's top-left
 * (Leaflet's own zoom control moves to the bottom-left by descendant utilities, so the two never
 * overlap) and the coordinates stay below it as two small inputs — the keyboard alternative WCAG
 * asks for. There is no confirmation step (D22, NUD-141): the Adresspunkt is looked up on save; the pin marker carries an accessible name and M1's live
 * region announces the new coordinates after a drag (**QA-02**).
 *
 * The visible surface changed only: zod input, server action, field names, test ids and the
 * localized error rendering (`noValidate`, `aria-describedby`/`aria-invalid`) are unchanged.
 */
export function CustomerForm({ customerId, initial, tiles, customerName, photos }: Props) {
  const t = useTranslations("admin.customers.form");
  const tm = useTranslations("admin.maps");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState(initial.customerNumber);
  const [name, setName] = useState(initial.name);
  const [street, setStreet] = useState(initial.street);
  const [postalCode, setPostalCode] = useState(initial.postalCode);
  const [city, setCity] = useState(initial.city);
  const [country, setCountry] = useState(initial.country);
  const [hours, setHours] = useState(initial.deliveryHoursInfo);
  const [notes, setNotes] = useState(initial.notes);
  const [office, setOffice] = useState(initial.office);
  const [keyValues, setKeyValues] = useState(initial.key);
  const [abbreviation, setAbbreviation] = useState(initial.abbreviation);
  const [pin, setPin] = useState(initial.pin);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [focus, setFocus] = useState<{ point: LatLng; nonce: number } | null>(null);
  const [error, setError] = useState<"invalid" | "generic" | null>(null);
  const [numberTaken, setNumberTaken] = useState(false);

  // The map's search overlay follows the address fields until the user types something themselves
  // (`null` = untouched); no effect needed, the value is derived during render.
  const derivedQuery = addressQuery([
    street,
    [postalCode, city].filter(Boolean).join(" "),
    country,
  ]);
  const [queryEdit, setQueryEdit] = useState<string | null>(null);
  const query = queryEdit ?? derivedQuery;

  const initialValues = {
    customerNumber: initial.customerNumber,
    name: initial.name,
    street: initial.street,
    postalCode: initial.postalCode,
    city: initial.city,
    country: initial.country,
    hours: initial.deliveryHoursInfo,
    notes: initial.notes,
    office: initial.office,
    key: initial.key,
    abbreviation: initial.abbreviation,
    lat: initial.pin?.lat ?? null,
    lng: initial.pin?.lng ?? null,
  };
  const dirty =
    JSON.stringify({
      customerNumber: number,
      name,
      street,
      postalCode,
      city,
      country,
      hours,
      notes,
      office,
      key: keyValues,
      abbreviation,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
    }) !== JSON.stringify(initialValues);

  // Warn before leaving with unsaved edits; the save bar carries the visible indicator.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** "Verwerfen": every control returns to the value the page was rendered with. */
  function discard() {
    setNumber(initial.customerNumber);
    setName(initial.name);
    setStreet(initial.street);
    setPostalCode(initial.postalCode);
    setCity(initial.city);
    setCountry(initial.country);
    setHours(initial.deliveryHoursInfo);
    setNotes(initial.notes);
    setOffice(initial.office);
    setKeyValues(initial.key);
    setAbbreviation(initial.abbreviation);
    setPin(initial.pin);
    setSearch({ state: "idle" });
    setFocus(null);
    setError(null);
    setNumberTaken(false);
    setQueryEdit(null);
  }

  // A new address makes the earlier search results obsolete.
  function editAddress(set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setSearch({ state: "idle" });
    };
  }

  function changePin(next: LatLng) {
    setPin(next);
  }

  async function findOnMap() {
    if (!query.trim()) return setSearch({ state: "message", message: "noAddress" });
    setSearch({ state: "busy" });
    try {
      const result = await geocodeAddressAction(query);
      if (!result.ok) return setSearch({ state: "message", message: "failed" });
      if (result.candidates.length === 0) {
        return setSearch({ state: "message", message: "notFound" });
      }
      setSearch({ state: "results", candidates: result.candidates });
    } catch {
      setSearch({ state: "message", message: "failed" });
    }
  }

  function choose(candidate: GeocodeCandidate) {
    const point = { lat: candidate.lat, lng: candidate.lng };
    changePin(point);
    setFocus({ point, nonce: (focus?.nonce ?? 0) + 1 });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNumberTaken(false);
    const input = {
      customerNumber: number,
      name,
      street,
      postalCode,
      city,
      country,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      deliveryHoursInfo: hours,
      notes,
      ...office,
      // Only a key the office actually edited is sent: an older page must not overwrite a newer
      // entry of a driver (NUD-142).
      ...(JSON.stringify(keyValues) === JSON.stringify(initial.key)
        ? {}
        : {
            hasKey: keyValues.hasKey === "unknown" ? null : keyValues.hasKey === "yes",
            keyNumber: keyValues.hasKey === "yes" ? keyValues.keyNumber : "",
          }),
      // Same for the Abkürzung (NUD-164).
      ...(abbreviation === initial.abbreviation ? {} : { abbreviation }),
    };
    startTransition(async () => {
      let result;
      try {
        result = customerId
          ? await updateCustomerAction(customerId, input)
          : await createCustomerAction(input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        if (result.error === "number_taken") return setNumberTaken(true);
        return setError(result.error === "not_found" ? "generic" : "invalid");
      }
      toast.success(t(customerId ? "savedEdit" : "savedNew"));
      router.push(`/admin/customers/${result.id}`);
      router.refresh();
    });
  }

  const searchMessage =
    search.state === "message"
      ? search.message === "noAddress"
        ? t("needAddress")
        : tm(search.message)
      : null;

  /** Helper ids are `${id}-hint` / `${id}-error` (see `FieldRow`). */
  const describedBy = (id: string, options: { hint?: boolean; error?: boolean } = {}) =>
    [options.hint ? `${id}-hint` : null, options.error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <form onSubmit={onSubmit} className="flex max-w-4xl flex-col gap-4" noValidate>
      <section
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
        aria-labelledby="cust-data"
      >
        <h2 id="cust-data" className="text-lg font-semibold tracking-tight">
          {t("dataHeading")}
        </h2>
        <FieldRow
          id="cust-number"
          label={t("number")}
          hint={customerId ? t("numberHintEdit") : t("numberHintNew")}
          error={numberTaken ? t("numberTaken") : undefined}
          errorTestId="number-taken"
        >
          <Input
            id="cust-number"
            className="max-w-xs"
            value={number}
            maxLength={32}
            onChange={(e) => {
              setNumber(e.target.value);
              setNumberTaken(false);
            }}
            aria-invalid={numberTaken || undefined}
            aria-describedby={describedBy("cust-number", { hint: true, error: numberTaken })}
            required
            data-testid="customer-number"
          />
        </FieldRow>
        <FieldRow id="cust-name" label={t("name")} hint={t("nameHint")}>
          <Input
            id="cust-name"
            className="max-w-xl"
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={describedBy("cust-name", { hint: true })}
            required
            data-testid="customer-name"
          />
        </FieldRow>
      </section>

      <section
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
        aria-labelledby="cust-address"
      >
        <div className="flex flex-col gap-1">
          <h2 id="cust-address" className="text-lg font-semibold tracking-tight">
            {t("addressHeading")}
          </h2>
        </div>
        <FieldRow id="cust-street" label={t("street")}>
          <Input
            id="cust-street"
            className="max-w-xl"
            value={street}
            maxLength={160}
            onChange={(e) => editAddress(setStreet)(e.target.value)}
            required
            data-testid="customer-street"
          />
        </FieldRow>
        <FieldRow id="cust-zip" label={t("postalCode")}>
          <Input
            id="cust-zip"
            className="max-w-32"
            value={postalCode}
            maxLength={16}
            onChange={(e) => editAddress(setPostalCode)(e.target.value)}
            required
            data-testid="customer-postal"
          />
        </FieldRow>
        <FieldRow id="cust-city" label={t("city")}>
          <Input
            id="cust-city"
            className="max-w-sm"
            value={city}
            maxLength={100}
            onChange={(e) => editAddress(setCity)(e.target.value)}
            required
            data-testid="customer-city"
          />
        </FieldRow>
        <FieldRow id="cust-country" label={t("country")} hint={t("countryHint")}>
          <Input
            id="cust-country"
            className="max-w-24"
            value={country}
            maxLength={2}
            onChange={(e) => editAddress(setCountry)(e.target.value)}
            aria-describedby={describedBy("cust-country", { hint: true })}
            required
            data-testid="customer-country"
          />
        </FieldRow>

        <FieldRow id="cust-pin" label={t("pinHeading")} hint={t("pinHint")}>
          {/* Map with the address search as an overlay in its top-left. The overlay starts right of
              Leaflet's zoom control (`left-14`) instead of covering it — Leaflet's stylesheet is
              unlayered and would outrank Tailwind's layered utilities if we tried to move it. */}
          <div
            data-testid="pin-map"
            className={cn(
              // `isolate` keeps Leaflet's internal z-indexes (panes up to 1000 for the controls)
              // inside this box — without it the map paints over the sticky save bar and the header.
              "relative isolate w-full overflow-hidden rounded-lg border",
              "[&_.leaflet-container]:h-[360px]!",
            )}
          >
            <PinPickerMapLazy
              value={pin}
              onChange={changePin}
              tiles={tiles}
              focus={focus}
              address={addressQuery([
                street,
                [postalCode, city].filter(Boolean).join(" "),
                country,
              ])}
              labels={{
                locate: tm("locate"),
                locating: tm("locating"),
                noAddress: tm("noAddress"),
                notFound: tm("notFound"),
                failed: tm("failed"),
                lowConfidence: tm("lowConfidence"),
              }}
            />
            <div className="pointer-events-none absolute top-3 right-3 left-14 z-[800] flex flex-col gap-2">
              <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
                <div className="flex flex-col gap-2 rounded-lg border bg-card p-2 shadow-md sm:flex-row sm:items-end">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label htmlFor="cust-pin-search" className="sr-only">
                      {t("pinSearchLabel")}
                    </label>
                    <Input
                      id="cust-pin-search"
                      className="h-9"
                      value={query}
                      placeholder={t("pinSearchPlaceholder")}
                      autoComplete="off"
                      onChange={(e) => setQueryEdit(e.target.value)}
                      data-testid="pin-search"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={findOnMap}
                    disabled={search.state === "busy"}
                    data-testid="customer-find"
                  >
                    <SearchIcon aria-hidden="true" />
                    {search.state === "busy" ? tm("locating") : t("find")}
                  </Button>
                </div>
                <p
                  className="rounded-md bg-card px-2 py-1 text-sm text-muted-foreground empty:hidden"
                  role="status"
                  data-testid="find-message"
                >
                  {searchMessage}
                </p>
                {search.state === "results" ? (
                  <div
                    className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border bg-card p-2 shadow-md"
                    data-testid="candidates"
                  >
                    <h3 className="text-sm font-medium">{t("candidatesHeading")}</h3>
                    <ul className="flex flex-col gap-1">
                      {search.candidates.map((c, index) => {
                        const selected =
                          pin?.lat === Math.round(c.lat * 1e6) / 1e6 &&
                          pin?.lng === Math.round(c.lng * 1e6) / 1e6;
                        return (
                          <li key={`${c.lat},${c.lng},${index}`}>
                            <Button
                              type="button"
                              variant={selected ? "default" : "outline"}
                              size="sm"
                              className="h-auto w-full justify-start py-1.5 text-left whitespace-normal"
                              onClick={() => choose(c)}
                              aria-pressed={selected}
                              data-testid="candidate"
                            >
                              <span className="flex flex-col items-start">
                                <span>{c.label}</span>
                                {c.confidence < LOW_CONFIDENCE ? (
                                  <span className="flex items-center gap-1 text-sm">
                                    <AlertTriangleIcon className="size-4" aria-hidden="true" />
                                    {tm("lowConfidence")}
                                  </span>
                                ) : null}
                              </span>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </FieldRow>
        <FieldRow id="cust-coordinates" label={tm("coordinates")} labelAsText>
          <LatLngInputs
            value={pin}
            onChange={changePin}
            labels={{
              legend: tm("coordinates"),
              latitude: tm("latitude"),
              longitude: tm("longitude"),
              invalid: tm("coordinatesInvalid"),
            }}
          />
        </FieldRow>
      </section>

      <section
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
        aria-labelledby="cust-extra"
      >
        <h2 id="cust-extra" className="text-lg font-semibold tracking-tight">
          {t("extraHeading")}
        </h2>
        <FieldRow id="cust-hours" label={t("hours")} hint={t("hoursHint")}>
          <Input
            id="cust-hours"
            className="max-w-xl"
            value={hours}
            maxLength={300}
            onChange={(e) => setHours(e.target.value)}
            aria-describedby={describedBy("cust-hours", { hint: true })}
            data-testid="customer-hours"
          />
        </FieldRow>
        <FieldRow id="cust-notes" label={t("notes")} hint={t("notesHint")}>
          <textarea
            id="cust-notes"
            className={textareaClass}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby={describedBy("cust-notes", { hint: true })}
            data-testid="customer-notes"
          />
        </FieldRow>
      </section>

      <section
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
        aria-labelledby="cust-key"
      >
        <h2 id="cust-key" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {t("keyHeading")}
          <InfoTip>{t("keyHint")}</InfoTip>
        </h2>
        <FieldRow id="cust-has-key" label={t("hasKey")}>
          <select
            id="cust-has-key"
            className={selectClass}
            value={keyValues.hasKey}
            onChange={(e) =>
              setKeyValues({ ...keyValues, hasKey: e.target.value as KeyValues["hasKey"] })
            }
            data-testid="customer-has-key"
          >
            <option value="unknown">{t("hasKeyOptions.unknown")}</option>
            <option value="yes">{t("hasKeyOptions.yes")}</option>
            <option value="no">{t("hasKeyOptions.no")}</option>
          </select>
        </FieldRow>
        {keyValues.hasKey === "yes" ? (
          <FieldRow id="cust-key-number" label={t("keyNumber")}>
            <Input
              id="cust-key-number"
              className="max-w-xs"
              value={keyValues.keyNumber}
              maxLength={KEY_NUMBER_MAX}
              onChange={(e) => setKeyValues({ ...keyValues, keyNumber: e.target.value })}
              data-testid="customer-key-number"
            />
          </FieldRow>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
        aria-labelledby="cust-abbreviation"
      >
        <h2
          id="cust-abbreviation"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          {t("abbreviationHeading")}
          <InfoTip>{t("abbreviationHint")}</InfoTip>
        </h2>
        <FieldRow id="cust-abbreviation-input" label={t("abbreviation")}>
          <Input
            id="cust-abbreviation-input"
            className="max-w-xs"
            value={abbreviation}
            maxLength={ABBREVIATION_MAX}
            onChange={(e) => setAbbreviation(e.target.value)}
            data-testid="customer-abbreviation"
          />
        </FieldRow>
      </section>

      <section
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
        aria-labelledby="cust-office"
      >
        <h2
          id="cust-office"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          {t("officeHeading")}
          <InfoTip>{t("officeHint")}</InfoTip>
        </h2>
        {OFFICE_FIELDS.map(({ key, max, width }) => (
          <FieldRow key={key} id={`cust-${key}`} label={t(`office.${key}`)}>
            <Input
              id={`cust-${key}`}
              className={width}
              value={office[key]}
              maxLength={max}
              onChange={(e) => setOffice({ ...office, [key]: e.target.value })}
              data-testid={`customer-${key}`}
            />
          </FieldRow>
        ))}
      </section>

      {customerId && photos && customerName ? (
        <section
          className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
          aria-labelledby="cust-photos"
        >
          <h2
            id="cust-photos"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            {t("photosHeading")}
            <InfoTip>{t("photosHint")}</InfoTip>
          </h2>
          <CustomerPhotoSlots customerId={customerId} customerName={customerName} photos={photos} />
        </section>
      ) : null}

      {error ? (
        <p className="text-base text-destructive" role="alert" data-testid="customer-error">
          {error === "invalid" ? t("errors.invalid") : tc("errors.generic")}
        </p>
      ) : null}

      {/* Save row at the end of the form (review 2026-10-31: the sticky bar of re-design.md §8.5
          floated over the content and read as misplaced): primary save, ghost discard, unsaved
          indicator. */}
      <div
        role="group"
        aria-label={t("saveBarLabel")}
        className="flex flex-wrap items-center gap-3 pt-2"
      >
        <Button type="submit" loading={pending} data-testid="customer-save">
          {customerId ? tc("actions.save") : t("create")}
        </Button>
        {customerId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty}
            onClick={discard}
            data-testid="customer-discard"
          >
            {t("discard")}
          </Button>
        ) : (
          <Link
            href="/admin/customers"
            className={buttonVariants({ variant: "ghost" })}
            data-testid="customer-cancel"
          >
            {tc("actions.cancel")}
          </Link>
        )}
        {dirty ? (
          <p
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
            role="status"
            data-testid="unsaved-indicator"
          >
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            {t("unsaved")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * One field of the two-column form: the 200 px label column on the left (label, plus an "i" for
 * the explanation), the control on the right; below 768 px the grid stacks, which keeps the form usable at 375 px. The
 * helper text id is `${id}-hint`, the error id `${id}-error`; the caller wires both through
 * `aria-describedby`. `labelAsText` is for grouped controls (a fieldset with its own legend).
 */
function FieldRow({
  id,
  label,
  hint,
  error,
  errorTestId,
  labelAsText = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  errorTestId?: string;
  labelAsText?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 md:grid-cols-[200px_minmax(0,1fr)] md:items-start md:gap-x-6">
      <div className="md:pt-2">
        {labelAsText ? (
          <span className="hyphens-auto text-base font-medium text-pretty">{label}</span>
        ) : (
          <Label htmlFor={id} className="inline hyphens-auto text-base font-medium text-pretty">
            {label}
          </Label>
        )}
        {/* The explanation is one tap away (`InfoTip`); for screen readers it stays the field's
            description under the id the caller wires through `aria-describedby`. */}
        {hint ? (
          <>
            <InfoTip className="ms-1.5 -mt-0.5">{hint}</InfoTip>
            <span id={`${id}-hint`} className="sr-only">
              {hint}
            </span>
          </>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-1.5">
        {children}
        {error ? (
          <p
            id={`${id}-error`}
            role="alert"
            data-testid={errorTestId}
            className="text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
