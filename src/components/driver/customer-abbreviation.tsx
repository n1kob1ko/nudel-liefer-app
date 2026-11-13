"use client";

import { PlusIcon, TagIcon } from "lucide-react";
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
import { ABBREVIATION_MAX } from "@/domain/customer-abbreviation";
import { enqueueMutation } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

export type AbbreviationStop = {
  id: string;
  customerName: string;
  abbreviation?: string | null;
};

/**
 * The customer's legacy Abkürzung on the driver screens (NUD-164, D27): a tag icon with the text, or
 * a dashed "+ Abkürzung" chip when none is noted. Same pattern as the key chip (`customer-key.tsx`):
 * `interactive` chips (next-stop card, stop detail) open a sheet to set, correct or clear it; in
 * stop-list rows, which are links as a whole, the chip is display only and hidden while empty. The
 * change goes through the offline outbox like a delivery tap. The text is free, optional and not
 * unique. Stops without Abkürzung information (`abbreviation` undefined) show nothing. Temporary.
 */
export function AbbreviationChip({
  stop,
  interactive = false,
  className,
}: {
  stop: AbbreviationStop;
  interactive?: boolean;
  className?: string;
}) {
  const t = useTranslations("driver.abbreviation");
  const [open, setOpen] = useState(false);
  if (stop.abbreviation === undefined) return null;
  const value = stop.abbreviation?.trim() || null;
  if (!value && !interactive) return null;

  const body = value ? (
    <>
      <TagIcon className="size-5 shrink-0" aria-hidden />
      <span aria-hidden className="min-w-0 truncate font-sans font-bold">
        {value}
      </span>
      <span className="sr-only">{t("chip.value", { value })}</span>
    </>
  ) : (
    <>
      <PlusIcon className="size-5 shrink-0" aria-hidden />
      <span aria-hidden>{t("chip.add")}</span>
      <span className="sr-only">{t("chip.empty")}</span>
    </>
  );
  const tone = value
    ? "border-input/50 bg-card text-foreground"
    : "border-input/50 bg-transparent text-muted-foreground";

  if (!interactive) {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-base leading-tight",
          tone,
          className,
        )}
        data-testid="abbreviation-chip"
        data-abbreviation={value ? "set" : "empty"}
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
        data-testid="abbreviation-chip"
        data-abbreviation={value ? "set" : "empty"}
      >
        {body}
      </button>
      {open ? <AbbreviationSheet stop={stop} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** One text field for one customer; empty text clears it. Mounted only while open (fresh state). */
function AbbreviationSheet({ stop, onClose }: { stop: AbbreviationStop; onClose: () => void }) {
  const t = useTranslations("driver.abbreviation");
  const fieldId = useId();
  const [text, setText] = useState(stop.abbreviation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = text.trim();
  const unchanged = value === (stop.abbreviation?.trim() ?? "");

  async function save() {
    if (unchanged || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueMutation({
        type: "abbreviation",
        stopId: stop.id,
        ...(value ? { abbreviation: value } : {}),
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

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
        data-testid="abbreviation-sheet"
      >
        <SheetHeader className="shrink-0 pe-14">
          <SheetTitle className="text-2xl">{t("title")}</SheetTitle>
          <SheetDescription>{t("description", { name: stop.customerName })}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-1 pb-4">
          <div className="space-y-1.5">
            <label htmlFor={fieldId} className="block text-base font-semibold">
              {t("label")}
            </label>
            <input
              id={fieldId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={ABBREVIATION_MAX}
              autoComplete="off"
              enterKeyHint="done"
              className="block min-h-14 w-full field rounded-lg border border-input bg-card px-3 text-xl font-semibold outline-none"
              data-testid="abbreviation-input"
            />
            <p className="text-sm text-muted-foreground">{t("hint")}</p>
          </div>
          {error ? (
            <p
              role="alert"
              className="text-base font-medium text-destructive"
              data-testid="abbreviation-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            size="xl"
            disabled={unchanged || busy}
            onClick={() => void save()}
            data-testid="abbreviation-save"
          >
            {!value && !unchanged ? t("clear") : t("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 text-lg"
            disabled={busy}
            onClick={onClose}
            data-testid="abbreviation-cancel"
          >
            {t("cancel")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
