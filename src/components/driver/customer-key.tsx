"use client";

import { KeyRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { KEY_NUMBER_MAX, keyDisplay } from "@/domain/customer-key";
import { enqueueMutation } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

export type KeyStop = {
  id: string;
  customerName: string;
  hasKey?: boolean | null;
  keyNumber?: string | null;
};

/**
 * The customer's key on the driver screens (NUD-142, D27): a key icon with the number, or "?" when
 * nobody knows yet. `interactive` chips (next-stop card, stop detail) are buttons that open the
 * sheet "Is there a key? Number:" to set or correct it; in stop-list rows, which are links as a
 * whole, the chip is display only (no interactive element inside a link). The change is written to
 * the offline outbox like a delivery tap and sent as soon as there is a connection; the screen
 * shows the new value at once. Stops without key information (`hasKey` undefined) show nothing.
 */
export function KeyChip({
  stop,
  interactive = false,
  className,
}: {
  stop: KeyStop;
  interactive?: boolean;
  className?: string;
}) {
  const t = useTranslations("driver.key");
  const [open, setOpen] = useState(false);
  if (stop.hasKey === undefined) return null;
  const display = keyDisplay(stop);

  const short =
    display.kind === "number"
      ? display.number
      : display.kind === "unknown"
        ? "?"
        : display.kind === "none"
          ? "–"
          : "✓";
  const spoken =
    display.kind === "number"
      ? t("chip.number", { number: display.number })
      : t(`chip.${display.kind}`);

  const body = (
    <>
      <KeyRoundIcon className="size-5 shrink-0" aria-hidden />
      <span aria-hidden className="font-sans font-bold tabular-nums">
        {short}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
  const tone =
    display.kind === "unknown"
      ? // Not known yet: a quiet chip, so the eye stays on the customer and the quantities.
        "border-input/50 bg-transparent text-muted-foreground"
      : "border-input/50 bg-card text-foreground";

  if (!interactive) {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-base leading-tight",
          tone,
          className,
        )}
        data-testid="key-chip"
        data-key={display.kind}
      >
        {body}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          // 48 px touch target; the visible chip is as small as the display-only one.
          "inline-flex min-h-12 min-w-12 max-w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-base leading-tight outline-none transition-[background-color,border-color,transform] duration-[140ms] ease-out hover:border-input focus-visible:ring-2 focus-visible:ring-ring active:scale-[.97]",
          tone,
          className,
        )}
        data-testid="key-chip"
        data-key={display.kind}
      >
        {body}
      </button>
      {open ? <KeySheet stop={stop} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** "Is there a key? Yes + number / No" for one customer. Mounted only while open (fresh state). */
function KeySheet({ stop, onClose }: { stop: KeyStop; onClose: () => void }) {
  const t = useTranslations("driver.key");
  const numberId = useId();
  const [hasKey, setHasKey] = useState<boolean | null>(stop.hasKey ?? null);
  const [keyNumber, setKeyNumber] = useState(stop.keyNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = keyNumber.trim();
  const canSave = hasKey === false || (hasKey === true && number.length > 0);

  async function save() {
    if (!canSave || hasKey === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueMutation({
        type: "key",
        stopId: stop.id,
        hasKey,
        ...(hasKey && number ? { keyNumber: number } : {}),
        customerName: stop.customerName,
      });
      toast.success(t("saved", { name: stop.customerName }));
      onClose();
    } catch {
      // IndexedDB unavailable (private mode): nothing was queued, say so instead of pretending.
      setError(t("errors.storage"));
      setBusy(false);
    }
  }

  const choice = (value: boolean, label: string, testId: string) => (
    <button
      type="button"
      aria-pressed={hasKey === value}
      onClick={() => setHasKey(value)}
      className={cn(
        "min-h-14 rounded-lg border px-4 text-lg font-semibold outline-none transition-[background-color,border-color,transform] duration-[140ms] ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[.97]",
        hasKey === value
          ? "border-foreground bg-primary text-primary-foreground"
          : "border-input/60 bg-card hover:border-input hover:bg-muted/60",
      )}
      data-testid={testId}
    >
      {label}
    </button>
  );

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
        data-testid="key-sheet"
      >
        <SheetHeader className="shrink-0 pe-14">
          <SheetTitle className="text-2xl">{t("title")}</SheetTitle>
          <SheetDescription>{t("description", { name: stop.customerName })}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-1 pb-4">
          <div role="group" aria-label={t("title")} className="grid grid-cols-2 gap-2">
            {choice(true, t("yes"), "key-yes")}
            {choice(false, t("no"), "key-no")}
          </div>
          {hasKey === true ? (
            <div className="space-y-1.5">
              <label htmlFor={numberId} className="block text-base font-semibold">
                {t("numberLabel")}
              </label>
              <input
                id={numberId}
                value={keyNumber}
                onChange={(event) => setKeyNumber(event.target.value)}
                maxLength={KEY_NUMBER_MAX}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                className="block min-h-14 w-full field rounded-lg border border-input bg-card px-3 text-xl font-semibold outline-none"
                data-testid="key-number"
              />
            </div>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="text-base font-medium text-destructive"
              data-testid="key-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            size="xl"
            disabled={!canSave || busy}
            onClick={() => void save()}
            data-testid="key-save"
          >
            {t("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 text-lg"
            disabled={busy}
            onClick={onClose}
            data-testid="key-cancel"
          >
            {t("cancel")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
