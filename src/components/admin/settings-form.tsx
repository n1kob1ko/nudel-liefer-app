"use client";

import { CheckCircle2Icon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CHECKLIST_ITEM_MAX, CHECKLIST_ITEMS_MAX } from "@/domain/departure-checklist";
import { ISO_WEEKDAYS } from "@/domain/settings";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";
import { geocodeAddressAction } from "@/server/geocode-actions";
import { saveSettingsAction } from "@/server/settings-actions";

export type SettingsFormValues = {
  depotName: string;
  depotAddress: string;
  /** `null` while no depot exists yet. */
  depotPin: LatLng | null;
  depotPinConfirmed: boolean;
  timezone: string;
  departureTime: string;
  serviceMinutesPerStop: number;
  /** Loading time assumed when the driver skipped the departure checklist (NUD-152). */
  defaultLoadingMinutes: number;
  recurringLeadDays: number;
  deliveryWeekdays: number[];
  /** Fixed items of the driver's departure checklist (NUD-151), German source text. */
  departureChecklist: Array<{ id: string; text: string }>;
};

/** One row of the checklist editor; `id` is empty for a row that was just added. */
type ChecklistRow = { key: string; id: string; text: string };

/**
 * Settings (re-design.md §8.8/§8.5): left in-page anchor nav (sticky) + right form sections in
 * `Card`s (never nested), and a **sticky save bar** at the bottom with Speichern / Verwerfen and an
 * unsaved-changes indicator. The depot map keeps the §6 pin treatment through `PinPickerMapLazy`
 * (this component only passes props).
 *
 * The Playwright contract stays: `section-title`, `depot-status`, `depot-confirm` (now a `Switch`
 * with a hidden checkbox input), `settings-save`, `settings-error`, `weekday-<n>`, `pin-lat`,
 * `pin-lng`, and the labels "Name", "Adresse", "Standard-Abfahrtszeit", "Minuten pro Stopp".
 */
export function SettingsForm({
  initial,
  timezones,
  tiles,
}: {
  initial: SettingsFormValues;
  timezones: string[];
  tiles: MapTileConfig;
}) {
  const t = useTranslations("admin.settings");
  const tm = useTranslations("admin.maps");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.depotName);
  const [address, setAddress] = useState(initial.depotAddress);
  const [pin, setPin] = useState(initial.depotPin);
  const [confirmed, setConfirmed] = useState(initial.depotPinConfirmed);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [departure, setDeparture] = useState(initial.departureTime);
  const [minutes, setMinutes] = useState(String(initial.serviceMinutesPerStop));
  const [loadingMinutes, setLoadingMinutes] = useState(String(initial.defaultLoadingMinutes));
  const [leadDays, setLeadDays] = useState(String(initial.recurringLeadDays));
  const [weekdays, setWeekdays] = useState(initial.deliveryWeekdays);
  const toRows = (items: SettingsFormValues["departureChecklist"]): ChecklistRow[] =>
    items.map((item) => ({ key: item.id, id: item.id, text: item.text }));
  const [checklist, setChecklist] = useState<ChecklistRow[]>(() =>
    toRows(initial.departureChecklist),
  );
  const [nextKey, setNextKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + day)), // 2026-01-05 is a Monday
    );

  const dirty = useMemo(() => {
    const samePin = (a: LatLng | null, b: LatLng | null) =>
      a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);
    const sameDays =
      weekdays.length === initial.deliveryWeekdays.length &&
      [...weekdays].sort().every((d, i) => d === [...initial.deliveryWeekdays].sort()[i]);
    return (
      name !== initial.depotName ||
      address !== initial.depotAddress ||
      !samePin(pin, initial.depotPin) ||
      confirmed !== initial.depotPinConfirmed ||
      timezone !== initial.timezone ||
      departure !== initial.departureTime ||
      minutes !== String(initial.serviceMinutesPerStop) ||
      loadingMinutes !== String(initial.defaultLoadingMinutes) ||
      leadDays !== String(initial.recurringLeadDays) ||
      !sameDays ||
      JSON.stringify(checklist.map(({ id, text }) => [id, text])) !==
        JSON.stringify(initial.departureChecklist.map(({ id, text }) => [id, text]))
    );
  }, [
    name,
    address,
    pin,
    confirmed,
    timezone,
    departure,
    minutes,
    loadingMinutes,
    leadDays,
    weekdays,
    checklist,
    initial,
  ]);

  const sections = [
    { id: "settings-depot", label: t("depot.heading") },
    { id: "settings-planning", label: t("planning.heading") },
    { id: "settings-checklist", label: t("checklist.nav") },
  ];

  // Moving the pin or changing the address invalidates an earlier confirmation (D9).
  function changePin(next: LatLng) {
    setPin(next);
    setConfirmed(false);
  }

  function reset() {
    setName(initial.depotName);
    setAddress(initial.depotAddress);
    setPin(initial.depotPin);
    setConfirmed(initial.depotPinConfirmed);
    setTimezone(initial.timezone);
    setDeparture(initial.departureTime);
    setMinutes(String(initial.serviceMinutesPerStop));
    setLoadingMinutes(String(initial.defaultLoadingMinutes));
    setLeadDays(String(initial.recurringLeadDays));
    setWeekdays(initial.deliveryWeekdays);
    setChecklist(toRows(initial.departureChecklist));
    setError(null);
  }

  function addChecklistRow() {
    setChecklist((rows) => [...rows, { key: `new-${nextKey}`, id: "", text: "" }]);
    setNextKey((n) => n + 1);
  }

  function toggleDay(day: number, on: boolean) {
    setWeekdays((days) => (on ? [...days, day] : days.filter((d) => d !== day)));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!pin) return setError(t("errors.needPin"));
    if (!confirmed) return setError(t("errors.needConfirm"));
    if (weekdays.length === 0) return setError(t("errors.needWeekday"));
    const input = {
      depotName: name,
      depotAddress: address,
      depotLat: pin.lat,
      depotLng: pin.lng,
      depotPinConfirmed: confirmed,
      timezone,
      departureTime: departure,
      serviceMinutesPerStop: minutes.trim() === "" ? Number.NaN : Number(minutes),
      defaultLoadingMinutes: loadingMinutes.trim() === "" ? Number.NaN : Number(loadingMinutes),
      recurringLeadDays: leadDays.trim() === "" ? Number.NaN : Number(leadDays),
      deliveryWeekdays: weekdays,
      departureChecklist: checklist
        .filter((row) => row.text.trim() !== "")
        .map((row) => ({ ...(row.id ? { id: row.id } : {}), text: row.text.trim() })),
    };
    startTransition(async () => {
      let result;
      try {
        result = await saveSettingsAction(input);
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t("errors.invalid"));
      toast.success(t("saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 pb-24" noValidate>
      <div className="flex flex-col gap-1">
        <h1
          className="hyphens-auto text-2xl font-semibold text-balance"
          data-testid="section-title"
        >
          {t("title")}
        </h1>
        <p className="max-w-prose text-base text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* Left: in-page anchor nav, sticky under the 56 px top bar on wide screens. */}
        <nav aria-label={t("sectionsLabel")} className="lg:sticky lg:top-20 lg:w-56 lg:shrink-0">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="mx-2 block rounded-md px-3 py-2 text-base text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none lg:mx-0"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card id="settings-depot" className="scroll-mt-20">
            <CardHeader
              action={
                // The test id lives on a wrapper: `StatusBadge` does not forward extra attributes.
                <span data-testid="depot-status">
                  {initial.depotPinConfirmed ? (
                    <StatusBadge tone="success" icon={CheckCircle2Icon}>
                      {t("depot.status.confirmed")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="warning" icon={TriangleAlertIcon}>
                      {t("depot.status.unconfirmed")}
                    </StatusBadge>
                  )}
                </span>
              }
            >
              <CardTitle>{t("depot.heading")}</CardTitle>
              {initial.depotPinConfirmed ? null : (
                <p className="text-base" data-testid="depot-unconfirmed-notice">
                  {t("depot.unconfirmedNotice")}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <FormField label={t("depot.name")} htmlFor="depot-name" required className="max-w-xl">
                <Input
                  id="depot-name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormField>
              <FormField
                label={t("depot.address")}
                htmlFor="depot-address"
                required
                className="max-w-xl"
              >
                <Input
                  id="depot-address"
                  value={address}
                  maxLength={300}
                  placeholder={t("depot.addressPlaceholder")}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setConfirmed(false);
                  }}
                  required
                />
              </FormField>

              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-medium">{t("depot.pinHeading")}</h3>
                <p className="max-w-prose text-sm text-muted-foreground">{t("depot.pinHint")}</p>
              </div>
              <PinPickerMapLazy
                value={pin}
                onChange={changePin}
                tiles={tiles}
                address={address}
                onLocate={geocodeAddressAction}
                labels={{
                  locate: tm("locate"),
                  locating: tm("locating"),
                  noAddress: tm("noAddress"),
                  notFound: tm("notFound"),
                  failed: tm("failed"),
                  lowConfidence: tm("lowConfidence"),
                }}
              />
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

              {/* Pin confirmation: the explanation stays visible, the control is a Switch. A hidden
                  checkbox keeps the `depot-confirm` form contract the Playwright spec asserts. */}
              <div className="flex items-start gap-3">
                <Switch
                  checked={confirmed}
                  disabled={!pin}
                  aria-labelledby="depot-confirm-label"
                  onCheckedChange={setConfirmed}
                />
                <input
                  id="depot-confirm"
                  type="checkbox"
                  className="sr-only"
                  checked={confirmed}
                  disabled={!pin}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  data-testid="depot-confirm"
                  aria-hidden
                  tabIndex={-1}
                />
                <label id="depot-confirm-label" htmlFor="depot-confirm" className="text-base">
                  {t("depot.confirm")}
                </label>
              </div>
            </CardContent>
          </Card>

          <Card id="settings-planning" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>{t("planning.heading")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <FormField label={t("planning.timezone")} htmlFor="timezone" className="max-w-sm">
                {/* A native select on purpose: the IANA list has ~400 entries, which is unusable in a
                    popover listbox but fine for the browser's own type-ahead. Styled like the kit. */}
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  data-testid="timezone"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </FormField>

              <div className="flex flex-wrap gap-6">
                <FormField
                  label={t("planning.departureTime")}
                  htmlFor="departure"
                  required
                  className="w-44"
                >
                  <Input
                    id="departure"
                    type="time"
                    value={departure}
                    onChange={(e) => setDeparture(e.target.value)}
                    required
                  />
                </FormField>
                <FormField
                  label={t("planning.serviceMinutes")}
                  htmlFor="service-minutes"
                  required
                  className="w-44"
                  description={t("planning.serviceMinutesHint")}
                >
                  <Input
                    id="service-minutes"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={180}
                    step={1}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    required
                  />
                </FormField>
                <FormField
                  label={t("planning.recurringLeadDays")}
                  htmlFor="recurring-lead-days"
                  required
                  className="w-44"
                  description={t("planning.recurringLeadDaysHint")}
                >
                  <Input
                    id="recurring-lead-days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={60}
                    step={1}
                    value={leadDays}
                    onChange={(e) => setLeadDays(e.target.value)}
                    data-testid="recurring-lead-days"
                    required
                  />
                </FormField>
                <FormField
                  label={t("planning.defaultLoadingMinutes")}
                  htmlFor="default-loading-minutes"
                  required
                  className="w-44"
                  description={t("planning.defaultLoadingMinutesHint")}
                >
                  <Input
                    id="default-loading-minutes"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={180}
                    step={1}
                    value={loadingMinutes}
                    onChange={(e) => setLoadingMinutes(e.target.value)}
                    data-testid="default-loading-minutes"
                    required
                  />
                </FormField>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-base font-medium">{t("planning.weekdays")}</legend>
                <p className="text-sm text-muted-foreground">{t("planning.weekdaysHint")}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-3" data-testid="weekdays">
                  {ISO_WEEKDAYS.map((day) => (
                    <label key={day} className="flex items-center gap-2 text-base">
                      <input
                        type="checkbox"
                        className="size-5 accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                        checked={weekdays.includes(day)}
                        onChange={(e) => toggleDay(day, e.target.checked)}
                        data-testid={`weekday-${day}`}
                      />
                      {weekdayName(day)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </CardContent>
          </Card>

          <Card id="settings-checklist" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>{t("checklist.heading")}</CardTitle>
              <p className="max-w-prose text-sm text-muted-foreground">{t("checklist.hint")}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3" data-testid="checklist-editor">
              {checklist.length === 0 ? (
                <p className="text-base text-muted-foreground" data-testid="checklist-empty">
                  {t("checklist.empty")}
                </p>
              ) : null}
              {checklist.map((row, index) => (
                <div key={row.key} className="flex max-w-xl items-end gap-2">
                  <FormField
                    label={t("checklist.itemLabel", { n: index + 1 })}
                    htmlFor={`checklist-item-${row.key}`}
                    className="min-w-0 flex-1"
                  >
                    <Input
                      id={`checklist-item-${row.key}`}
                      value={row.text}
                      maxLength={CHECKLIST_ITEM_MAX}
                      placeholder={t("checklist.placeholder")}
                      onChange={(e) =>
                        setChecklist((rows) =>
                          rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)),
                        )
                      }
                      data-testid="checklist-item"
                    />
                  </FormField>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("checklist.remove", { n: index + 1 })}
                    onClick={() => setChecklist((rows) => rows.filter((r) => r.key !== row.key))}
                    data-testid="checklist-remove"
                  >
                    <XIcon className="size-5" aria-hidden />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={checklist.length >= CHECKLIST_ITEMS_MAX}
                  onClick={addChecklistRow}
                  data-testid="checklist-add"
                >
                  <PlusIcon className="size-5" aria-hidden />
                  {t("checklist.add")}
                </Button>
                {checklist.length >= CHECKLIST_ITEMS_MAX ? (
                  <span className="text-sm text-muted-foreground">
                    {t("checklist.limit", { max: CHECKLIST_ITEMS_MAX })}
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save row at the end of the form (review 2026-10-31: the sticky bar of re-design.md
          §8.5/§8.8 floated over the content and read as misplaced). */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3">
          {error ? (
            <p
              className="text-base font-medium text-destructive"
              role="alert"
              data-testid="settings-error"
            >
              {error}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                aria-hidden
                className={cn("size-2 rounded-full", dirty ? "bg-warning" : "bg-success")}
              />
              {dirty ? t("unsaved") : t("saved-state")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || pending}
            data-testid="settings-reset"
            onClick={reset}
          >
            {t("discard")}
          </Button>
          <Button type="submit" loading={pending} data-testid="settings-save">
            {t("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
