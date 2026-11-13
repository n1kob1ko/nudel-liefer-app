"use client";

import { PackagePlusIcon, PlusIcon, RouteIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { createCorrectionDeliveryAction } from "@/server/order-actions";
import { createEmptyTourAction, createFollowUpTourAction } from "@/server/tour-actions";
import type { TourPlan } from "@/server/tour-planning";

import { TourDiffList } from "./tour-diff-list";

/**
 * Late orders on the planning page (NUD-099). Orders confirmed after every tour of the day was
 * COMPLETED are on no stop; the office sees them here and creates a follow-up tour (a second tour
 * for the same date) for them. Edits to orders of already delivered stops are listed as well: an
 * increase of such an order is offered as a "correction" (NUD-117), which books the difference as
 * a new order and puts it on a follow-up tour in one step; a decrease or a cancellation is only
 * reported (goods cannot be un-delivered).
 */
export function LateOrdersBanner({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours.late");
  const te = useTranslations("admin.tours.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [correctionPending, startCorrection] = useTransition();
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const { late } = plan;
  if (late.lateOrders.length === 0 && late.conflicts.length === 0) return null;
  const unroutable = late.lateOrders.filter((o) => !o.routable);
  const errorText = (code: string) => (te.has(code) ? te(code) : te("generic"));

  function create() {
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createFollowUpTourAction({ date: plan.date });
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        setError(result.error);
        if (["conflict", "follow_up_not_allowed", "no_late_orders"].includes(result.error)) {
          router.refresh();
        }
        return;
      }
      toast.success(t("created", { count: result.stopCount }));
      router.replace({ pathname: "/admin/tours", query: { date: plan.date, tour: result.tourId } });
    });
  }

  function correct() {
    setCorrectionError(null);
    startCorrection(async () => {
      let result;
      try {
        result = await createCorrectionDeliveryAction({ date: plan.date });
      } catch {
        return setCorrectionError("generic");
      }
      if (!result.ok) {
        setCorrectionError(result.error);
        if (["no_corrections", "follow_up_not_allowed"].includes(result.error)) router.refresh();
        return;
      }
      if (result.followUp.ok) {
        toast.success(t("correction.created", { count: result.followUp.stopCount }));
        router.replace({
          pathname: "/admin/tours",
          query: { date: plan.date, tour: result.followUp.tourId },
        });
        return;
      }
      // The difference is booked, the tour could not be planned (e.g. no Parkplatz): say both.
      setCorrectionError(result.followUp.error);
      toast.warning(t("correction.createdNoTour"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="late-orders">
      {late.lateOrders.length > 0 ? (
        <Alert variant="destructive" data-testid="late-orders-banner">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{t("body", { count: late.lateOrderCount })}</p>
            <TourDiffList
              diff={{ added: late.lateOrders, removed: [], changed: [], completedChanged: [] }}
              addedHeading={t("listHeading", { count: late.lateOrders.length })}
            />
            {unroutable.length > 0 ? (
              <div data-testid="late-orders-unrouted">
                <p>{t("unrouted")}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {unroutable.map((o) => (
                    <li key={o.customerId}>
                      <Link
                        href={`/admin/customers/${o.customerId}`}
                        className="font-medium underline"
                      >
                        {o.name} ({o.customerNumber})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error ? (
              <p className="font-medium" role="alert" data-testid="late-orders-error">
                {errorText(error)}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                onClick={create}
                disabled={pending || !late.canCreateFollowUp}
                data-testid="create-follow-up"
              >
                <RouteIcon aria-hidden />
                {pending ? t("creating") : t("create")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {late.conflicts.length > 0 ? (
        <Alert data-testid="delivered-conflicts">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{t("conflictTitle")}</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{t("conflictBody")}</p>
            <TourDiffList
              diff={{ added: [], removed: [], changed: [], completedChanged: late.conflicts }}
            />
            {late.corrections.length > 0 ? (
              <div className="flex flex-col gap-2" data-testid="correction-offer">
                <p>{t("correction.body")}</p>
                <TourDiffList
                  diff={{ added: late.corrections, removed: [], changed: [], completedChanged: [] }}
                  addedHeading={t("correction.heading", { count: late.corrections.length })}
                />
                {correctionError ? (
                  <p className="font-medium" role="alert" data-testid="correction-error">
                    {errorText(correctionError)}
                  </p>
                ) : null}
                <div>
                  <Button
                    type="button"
                    onClick={correct}
                    disabled={correctionPending || !late.canCreateCorrection}
                    data-testid="create-correction"
                  >
                    <PackagePlusIcon aria-hidden />
                    {correctionPending ? t("correction.creating") : t("correction.create")}
                  </Button>
                </div>
              </div>
            ) : late.correctionBlocked ? (
              <p data-testid="correction-blocked">{t("correction.blocked")}</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Tabs of the tours of one day (NUD-135): always shown once the day has a tour, also for a single
 * one ("Tour 1 · Anna"), plus a "+ Tour" tab that creates an empty tour for the date.
 */
export function TourTabs({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours.tabs");
  const te = useTranslations("admin.tours.errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (plan.tours.length === 0) return null;

  function addTour() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createEmptyTourAction({ date: plan.date });
        if (!result.ok) return setError(result.error);
        toast.success(t("added"));
        router.push({ pathname: "/admin/tours", query: { date: plan.date, tour: result.tourId } });
      } catch {
        setError("generic");
      }
    });
  }

  return (
    <nav aria-label={t("label")} data-testid="tour-tabs" className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {plan.tours.map((tab) => {
          const current = tab.id === plan.tour?.id;
          return (
            <li key={tab.id}>
              <Link
                href={{ pathname: "/admin/tours", query: { date: plan.date, tour: tab.id } }}
                aria-current={current ? "page" : undefined}
                data-testid="tour-tab"
                data-tour-id={tab.id}
                data-status={tab.status}
                className={
                  // The selected tour is pale yolk (a selection), not a filled yolk button: the one
                  // yolk button of the page is the tour's next step below (redesign RD2).
                  "inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-base outline-none transition-[background-color,border-color,transform] duration-[140ms] ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[.98] " +
                  (current
                    ? "border-foreground/25 bg-primary-soft font-semibold text-primary-soft-foreground"
                    : "border-border bg-card font-medium hover:bg-muted")
                }
              >
                {tab.driverName
                  ? t("withDriver", { number: tab.number, driver: tab.driverName })
                  : t("tour", { number: tab.number })}
                <span className="text-sm font-normal">
                  {tc(`statuses.tour.${tab.status}`)} · {t("stops", { count: tab.stopCount })}
                </span>
              </Link>
            </li>
          );
        })}
        <li>
          <Button
            type="button"
            variant="outline"
            onClick={addTour}
            disabled={pending}
            className="min-h-10"
            data-testid="tour-add"
          >
            <PlusIcon aria-hidden />
            {t("add")}
          </Button>
        </li>
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="tour-add-error">
          {te.has(error) ? te(error) : te("generic")}
        </p>
      ) : null}
    </nav>
  );
}
