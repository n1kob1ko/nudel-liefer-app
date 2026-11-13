"use client";

import { DownloadIcon, PlusSquareIcon, ShareIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isIosDevice, isStandaloneDisplay } from "@/lib/device";
import {
  getDeferredPrompt,
  isMarkedInstalled,
  readDismissed,
  setDeferredPrompt,
  subscribeInstallState,
  writeDismissed,
} from "@/lib/install-prompt";

type HintKind = "none" | "android" | "ios";

function currentKind(): HintKind {
  if (isMarkedInstalled() || isStandaloneDisplay() || readDismissed()) return "none";
  if (getDeferredPrompt()) return "android";
  if (isIosDevice()) return "ios";
  return "none";
}

/** Safari's bottom toolbar with the Share button highlighted (decorative, the steps carry the text). */
function ShareIllustration({ label }: { label: string }) {
  return (
    <svg
      viewBox="0 0 320 150"
      role="img"
      aria-label={label}
      className="mx-auto w-full max-w-xs"
      data-testid="install-illustration"
    >
      <rect
        x="1"
        y="1"
        width="318"
        height="148"
        rx="16"
        fill="hsl(var(--muted))"
        stroke="hsl(var(--border))"
      />
      <rect
        x="16"
        y="14"
        width="288"
        height="34"
        rx="10"
        fill="hsl(var(--background))"
        stroke="hsl(var(--border))"
      />
      <g
        fill="none"
        stroke="hsl(var(--muted-foreground))"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M52 104 38 116l14 12" />
        <path d="M84 104l14 12-14 12" opacity="0.45" />
        <rect x="222" y="104" width="26" height="24" rx="5" />
        <rect x="270" y="104" width="22" height="24" rx="5" opacity="0.45" />
      </g>
      <circle
        cx="160"
        cy="116"
        r="28"
        fill="hsl(var(--primary))"
        stroke="hsl(var(--foreground))"
        strokeWidth="3"
      />
      <g
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M160 120V101M153 108l7-7 7 7" />
        <path d="M152 112h-3a3 3 0 0 0-3 3v13a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3v-13a3 3 0 0 0-3-3h-3" />
      </g>
    </svg>
  );
}

function IosInstructions({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("driver.install");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="install-overlay">
        <DialogHeader>
          <DialogTitle>{t("overlayTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("iosText")}</DialogDescription>
        </DialogHeader>
        <ShareIllustration label={t("illustrationLabel")} />
        <ol className="flex flex-col gap-3 text-base">
          <li className="flex items-center gap-3">
            <ShareIcon className="size-7 shrink-0 text-foreground" aria-hidden />
            <span>
              <b className="me-1">1.</b>
              {t("step1")}
            </span>
          </li>
          <li className="flex items-center gap-3">
            <PlusSquareIcon className="size-7 shrink-0 text-foreground" aria-hidden />
            <span>
              <b className="me-1">2.</b>
              {t("step2")}
            </span>
          </li>
          <li className="flex items-center gap-3">
            <DownloadIcon className="size-7 shrink-0 text-foreground" aria-hidden />
            <span>
              <b className="me-1">3.</b>
              {t("step3")}
            </span>
          </li>
        </ol>
        <DialogFooter>
          <Button
            size="lg"
            onClick={() => {
              writeDismissed();
              onOpenChange(false);
            }}
            data-testid="install-overlay-done"
          >
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Localized install hint above the driver content. Android / Chromium: shows an Install button as
 * soon as the browser offers `beforeinstallprompt`. iOS (no such event): explains
 * "Share -> Add to Home Screen" in an overlay. Hidden when already installed (standalone) or after
 * the driver dismissed it (remembered in localStorage, failures tolerated).
 */
export function InstallHint() {
  const t = useTranslations("driver.install");
  const kind = useSyncExternalStore(subscribeInstallState, currentKind, (): HintKind => "none");
  const [overlayOpen, setOverlayOpen] = useState(false);

  if (kind === "none" && !overlayOpen) return null;

  const install = async () => {
    const event = getDeferredPrompt();
    if (!event) return;
    setDeferredPrompt(null); // the event can only be used once
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "dismissed") writeDismissed();
    } catch {
      // prompt() can reject when called twice or without a user gesture; nothing to do
    }
  };

  return (
    <>
      {kind !== "none" ? (
        <section
          aria-label={t("title")}
          data-testid="install-hint"
          data-kind={kind}
          className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground"
        >
          <div className="flex items-start gap-3">
            <DownloadIcon className="mt-0.5 size-7 shrink-0 text-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{t("title")}</p>
              <p className="text-base text-muted-foreground">
                {kind === "android" ? t("androidText") : t("iosText")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {kind === "android" ? (
              <Button size="lg" onClick={install} data-testid="install-button">
                <DownloadIcon aria-hidden />
                {t("installButton")}
              </Button>
            ) : (
              <Button size="lg" onClick={() => setOverlayOpen(true)} data-testid="install-how">
                <ShareIcon aria-hidden />
                {t("howButton")}
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              onClick={writeDismissed}
              data-testid="install-dismiss"
            >
              <XIcon aria-hidden />
              {t("notNow")}
            </Button>
          </div>
        </section>
      ) : null}
      {kind === "ios" || overlayOpen ? (
        <IosInstructions open={overlayOpen} onOpenChange={setOverlayOpen} />
      ) : null}
    </>
  );
}
