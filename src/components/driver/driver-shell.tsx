"use client";

import {
  ClockIcon,
  CloudOffIcon,
  CloudUploadIcon,
  LanguagesIcon,
  Loader2Icon,
  MoreVerticalIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { ConnectionIndicator } from "@/components/driver/connection-indicator";
import { InstallHint } from "@/components/driver/install-hint";
import { OfflineStatusBar } from "@/components/driver/offline-status";
import { OfflineSync } from "@/components/driver/offline-sync";
import { PendingBadge } from "@/components/driver/pending-badge";
import { SyncNotices } from "@/components/driver/sync-notices";
import type { SyncState } from "@/components/shared/sync-status-chip";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePathname, useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { isAppLocale, LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { useOfflineStatus } from "@/lib/offline/browser";
import { getOutbox, useOutbox } from "@/lib/offline/outbox-browser";
import { usePhotoOutbox } from "@/lib/offline/photo-outbox-browser";
import { useOnline } from "@/lib/offline/use-online";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/server/locale-actions";

/**
 * Language picker of the driver top bar (re-design.md §7.1). The redesign draws a bottom sheet; the
 * native `<select>` stays as the visible 48 px control because four driver e2e specs drive the
 * locale change through `selectOption("de" | "en" | "sr-Latn" | "cs" | "zh-Hans")` and read
 * `option` texts (`driver-language-picker`, `driver-usability`, `shells`, `pwa`). Its test ids and
 * behaviour are unchanged from `LanguageSwitcher variant="icon"`.
 */
function LocaleSelect() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <label
      className="relative flex size-12 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
      title={t("language")}
    >
      <LanguagesIcon className="size-6" aria-hidden />
      <select
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
        value={locale}
        disabled={pending}
        data-testid="language-switcher"
        aria-label={t("language")}
        onChange={(event) => {
          const next = event.target.value;
          if (!isAppLocale(next)) return;
          startTransition(async () => {
            await setLocaleAction(next);
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Token colours of the five sync states (the same vocabulary as the shared `SyncStatusChip`). */
const SYNC_TONE: Record<SyncState, string> = {
  online: "bg-info-soft text-info-soft-foreground",
  preparing: "bg-muted text-muted-foreground",
  offline: "bg-warning-soft text-warning-soft-foreground",
  pending: "bg-warning-soft text-warning-soft-foreground",
  error: "bg-destructive-soft text-destructive-soft-foreground",
};

/**
 * Compact driver sync chip (re-design.md §7.1/§7.6).
 *
 * The shared `SyncStatusChip` carries the whole sentence ("Wird vorbereitet …", ~160 px wide). In the
 * 375 px top bar the 144 px date needs the rest of the room, so the full sentence pushed the date
 * into "Mo., 26…" (design review, point 4). The driver bar therefore renders the same five states
 * with a short visible word — and the pending state with its count, exactly as §7.6 asks — while the
 * full sentence stays the accessible name and the tooltip, so nothing is hidden from screen readers.
 * The shared component remains the vocabulary of the admin bar; the test ids (`sync-chip`,
 * `data-state`) and the `offline-ready` marker are unchanged.
 */
function SyncChip({ onClick, className }: { onClick: () => void; className?: string }) {
  const online = useOnline();
  const status = useOfflineStatus();
  const t = useTranslations("driver.sync");
  const tOffline = useTranslations("driver.offline");
  const { entries: taps, failure: tapFailure } = useOutbox();
  const { entries: photos, failure: photoFailure } = usePhotoOutbox();
  const pending = taps.length + photos.length;
  const failure = tapFailure ?? photoFailure;

  let state: SyncState;
  if (failure && pending > 0) state = "error";
  else if (pending > 0) state = "pending";
  else if (!online) state = "offline";
  else if (status.syncing || (status.savedAt === null && status.phase === "idle"))
    state = "preparing";
  else state = "online";

  // Full sentence = accessible name; `short` is what fits next to the date.
  const label =
    state === "online"
      ? t("online")
      : state === "offline"
        ? t("offline")
        : state === "preparing"
          ? t("preparing")
          : state === "error"
            ? t("error")
            : t("pendingChip", { count: pending });
  const short =
    state === "preparing"
      ? t("preparingShort")
      : state === "error"
        ? t("errorShort")
        : state === "pending"
          ? t("pendingShort", { count: pending })
          : label;
  // WCAG 2.5.3: the visible text must be part of the accessible name (the short wording of the
  // "preparing" / "error" chip is not part of the full sentence).
  const accessibleName = label.includes(short) ? label : `${short}: ${label}`;
  const icon =
    state === "preparing" ? (
      <Loader2Icon className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
    ) : state === "offline" ? (
      <WifiOffIcon className="size-4 shrink-0" aria-hidden />
    ) : state === "pending" ? (
      <CloudUploadIcon className="size-4 shrink-0" aria-hidden />
    ) : state === "error" ? (
      <CloudOffIcon className="size-4 shrink-0" aria-hidden />
    ) : (
      <WifiIcon className="size-4 shrink-0" aria-hidden />
    );
  // "Offline bereit ✓" is no longer a line of its own (re-design.md §7.6): the same text sits in the
  // chip's accessible marker, which the offline/outbox specs assert (`offline-ready`, visible).
  const ready = online && status.savedAt !== null && status.phase === "ready";

  return (
    <span
      className={cn("flex min-h-12 shrink-0 items-center", className)}
      title={label}
      aria-label={label}
      data-testid="sync-state"
      data-state={state}
    >
      <button
        type="button"
        onClick={onClick}
        data-testid="sync-chip"
        data-state={state}
        aria-label={accessibleName}
        className={cn(
          // Driver rules: >= 48 px touch target and >= 16 px text. `max-w` keeps the chip from
          // eating the date; the pending count alone can be narrow, hence the `min-w`.
          "inline-flex min-h-12 min-w-12 max-w-[7rem] items-center gap-1.5 rounded-full px-2 text-base font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          SYNC_TONE[state],
        )}
      >
        {state === "online" ? (
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
        ) : null}
        {icon}
        <span className="truncate">{short}</span>
      </button>
      {ready ? (
        <span className="sr-only" role="status" data-testid="offline-ready">
          {tOffline("ready")}
        </span>
      ) : null}
    </span>
  );
}

/** The Outbox sheet: a pure view over the existing store, no retry logic is invented here. */
function OutboxSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("driver.sync");
  const online = useOnline();
  const formatter = useFormatter();
  const fmt = createAppFormatters(formatter);
  const { entries, failure, flushing, inFlight } = useOutbox();
  const { entries: photos } = usePhotoOutbox();
  // NUD-174 (QA 2026-10-29 F7): the panel says what the queue is doing, not what the browser thinks
  // the connection is. `navigator.onLine` stays green when only the server is gone.
  const sending = flushing || inFlight.size > 0;
  const rows: Array<{ id: string; text: string }> = [
    ...entries.map((entry) => ({
      id: entry.clientMutationId,
      text: `${entry.customerName} · ${t(`mutation${entry.type[0]!.toUpperCase()}${entry.type.slice(1)}`)} · ${fmt.time(new Date(entry.createdAt))} · ${t("outboxWaiting")}`,
    })),
    ...photos.map((photo) => ({
      id: `${photo.clientMutationId}-photo`,
      text: `${photo.customerName} · ${t("mutationPhoto")} · ${fmt.time(new Date(photo.createdAt))} · ${t("outboxWaiting")}`,
    })),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" data-testid="outbox-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CloudUploadIcon className="size-5 shrink-0" aria-hidden />
            {t("outboxTitle")}
          </SheetTitle>
          {rows.length === 0 ? null : (
            <SheetDescription>
              {sending
                ? t("outboxSending", { count: rows.length })
                : t("outboxWaitingForConnection", { count: rows.length })}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {rows.length === 0 ? (
            <p className="text-base text-muted-foreground">{t("outboxNothingPending")}</p>
          ) : (
            <ul className="flex flex-col" data-testid="outbox-list">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 border-b border-border py-3 text-base last:border-b-0"
                  data-testid="outbox-entry"
                >
                  <ClockIcon className="size-5 shrink-0 text-warning-soft-foreground" aria-hidden />
                  <span className="min-w-0">{row.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2 p-4">
          {rows.length > 0 && failure ? (
            <Button
              type="button"
              size="xl"
              variant="primary"
              onClick={() => void getOutbox().flush({ force: true })}
              data-testid="outbox-retry"
            >
              {t("outboxRetry")}
            </Button>
          ) : null}
          {rows.length > 0 ? (
            <p
              className="flex items-center gap-2 text-base text-muted-foreground"
              data-testid="outbox-state"
              data-state={
                sending ? "sending" : failure ? "unreachable" : online ? "online" : "offline"
              }
            >
              {sending || online ? (
                <WifiIcon className="size-5 shrink-0" aria-hidden />
              ) : (
                <WifiOffIcon className="size-5 shrink-0" aria-hidden />
              )}
              {sending
                ? t("outboxOnlineExplanation")
                : failure
                  ? t("outboxUnreachable")
                  : online
                    ? t("outboxWaitingForConnection", { count: rows.length })
                    : t("outboxExplanation")}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Overflow menu of the driver top bar: logout and the colour scheme (NUD-132). The theme switch lives
 * here rather than in the bar itself: at 375 px the bar is already at its limit (date + sync chip +
 * language + menu), and a fifth control pushed the date into "Mo., 26…" during the design review.
 */
function OverflowSheet({
  open,
  onOpenChange,
  logout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logout?: ReactNode;
}) {
  const t = useTranslations("driver.shell");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" data-testid="driver-menu-sheet">
        <SheetHeader>
          <SheetTitle>{t("menu")}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4">
          <ThemeToggle variant="row" />
          {logout}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Mobile-first driver layout: sticky 56 px top bar (date, sync chip, language, overflow) and a large
 * content area with room for a sticky action bar. `syncUserId` (DRIVER users) keeps the offline copy
 * of the tour current (NUD-081); `offline` is the service-worker shell: no install hint and no
 * server-backed logout. The locale `<select>` is kept in both variants because the specs need it.
 */
export function DriverShell({
  dateLabel,
  syncUserId,
  offline = false,
  logout,
  children,
}: {
  dateLabel: string;
  syncUserId?: string;
  offline?: boolean;
  /** Server-rendered logout control (a form action); omitted in the offline shell. */
  logout?: ReactNode;
  children: ReactNode;
}) {
  const [outboxOpen, setOutboxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useTranslations("driver.shell");

  return (
    <div className="driver-app flex min-h-dvh flex-col bg-background" data-testid="driver-shell">
      <header className="sticky top-0 z-30 flex min-h-14 items-center gap-0.5 border-b border-border bg-card py-1 ps-4 pe-1">
        <p
          // 16 px (the driver floor, §4.2 body) leaves the date ~122 px of the bar; at 18 px the
          // "Wird vorbereitet …" chip left only 99 px and the date read "Mo., 26…" (point 4).
          // NUD-182 (QA 2026-10-29 F9): no `truncate` — a date that does not fit wraps instead of
          // ending in "Ok…", and both shells render the same short format (see offline-driver-app).
          className="min-w-0 flex-1 text-base leading-tight font-semibold break-words hyphens-none"
          data-testid="driver-date"
        >
          {dateLabel}
        </p>
        {/* Presence markers the driver specs query; the chip carries the visible state. */}
        <span className="sr-only">
          <ConnectionIndicator />
        </span>
        <span className="sr-only">
          <PendingBadge />
        </span>
        <SyncChip onClick={() => setOutboxOpen(true)} />
        <LocaleSelect />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={t("menu")}
          onClick={() => setMenuOpen(true)}
          data-testid="driver-menu"
        >
          <MoreVerticalIcon className="size-6" aria-hidden />
        </Button>
      </header>
      <OutboxSheet open={outboxOpen} onOpenChange={setOutboxOpen} />
      <OverflowSheet open={menuOpen} onOpenChange={setMenuOpen} logout={logout} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-3 pb-32">
        {syncUserId ? <OfflineSync userId={syncUserId} /> : null}
        {offline ? null : <InstallHint />}
        <OfflineStatusBar />
        <SyncNotices />
        {children}
      </main>
    </div>
  );
}
