"use client";

import type { LucideIcon } from "lucide-react";
import { CameraIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { DriverPhotoSlot } from "@/components/driver/driver-photo-slot";
import { ZoomableImage } from "@/components/shared/image-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DriverPhotoKind } from "@/domain/driver-photo";
import type { ShownPhoto } from "@/lib/offline/photo-outbox";

import { stopText } from "./stop-i18n-fallback";

/** How far a finger must travel horizontally before it counts as a swipe (px). */
const SWIPE_THRESHOLD = 56;

type Slide = { kind: DriverPhotoKind; label: string; photo: ShownPhoto; alt: string };

/**
 * The "Fotos" card and its fullscreen viewer (re-design.md §7.3).
 *
 * Two 1:1 thumbnails side by side — "Eingang" (STORE) and "Parken" (PARKING) — each one a
 * `DriverPhotoSlot` (upload logic unchanged, presentation only). Tapping a present photo opens the
 * fullscreen viewer with zoom (reused from the shared `ImagePreview`), swipe/arrow navigation
 * between the two photos, a caption (label + customer) and a 48 px close button top-right.
 */
export function StopPhotos({
  photos,
  customerName,
  stopId,
  customerId,
}: {
  photos: Record<DriverPhotoKind, ShownPhoto | null>;
  customerName: string;
  stopId: string;
  customerId: string;
}) {
  const t = useTranslations("driver.stop");
  const locale = useLocale();
  const [viewerKind, setViewerKind] = useState<DriverPhotoKind | null>(null);

  const labels: Record<DriverPhotoKind, string> = {
    STORE: stopText(t, locale, "photoStore"),
    PARKING: stopText(t, locale, "photoParking"),
  };
  // Viewer order = card order: STORE first, PARKING second.
  const slides: Slide[] = (["STORE", "PARKING"] as const).flatMap((kind) => {
    const photo = photos[kind];
    if (!photo) return [];
    const label = labels[kind];
    return [{ kind, label, photo, alt: `${label}: ${customerName}` }];
  });
  const found = slides.findIndex((slide) => slide.kind === viewerKind);
  // Nothing chosen (or the chosen photo is gone): the viewer stays closed.
  const activeIndex = found === -1 ? 0 : found;
  const active = viewerKind === null ? null : (slides[activeIndex] ?? null);
  const show = (index: number) => {
    const slide = slides[(index + slides.length) % slides.length];
    if (slide) setViewerKind(slide.kind);
  };

  return (
    // Same inset and title size as the parking and delivery cards of the stop screen.
    <Card className="gap-3 py-4" data-testid="stop-photos">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <CameraIcon className="size-5 shrink-0" aria-hidden />
          {stopText(t, locale, "photos")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="grid grid-cols-2 gap-3">
          {(["STORE", "PARKING"] as const).map((kind) => (
            <DriverPhotoSlot
              key={kind}
              kind={kind}
              label={labels[kind]}
              alt={`${labels[kind]}: ${customerName}`}
              photo={photos[kind]}
              stopId={stopId}
              customerId={customerId}
              customerName={customerName}
              onOpen={photos[kind] ? () => setViewerKind(kind) : undefined}
            />
          ))}
        </div>
      </CardContent>

      <Dialog open={active !== null} onOpenChange={(open) => !open && setViewerKind(null)}>
        <DialogContent
          className="h-dvh max-h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black p-0 text-white"
          data-testid="photo-viewer"
        >
          <DialogTitle className="sr-only">{stopText(t, locale, "viewerTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{active?.label}</DialogDescription>
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className="relative min-h-0 flex-1 touch-none"
              onPointerDown={startSwipe(slides.length, activeIndex, show)}
            >
              {active ? (
                <ZoomableImage key={active.kind} src={active.photo.url} alt={active.alt} />
              ) : null}
            </div>

            <p
              className="px-4 py-2 text-center text-base font-medium"
              data-testid="photo-viewer-caption"
            >
              {active ? `${active.label} · ${customerName}` : null}
            </p>

            <div className="flex items-center justify-between gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex gap-2">
                <ViewerStep
                  icon={ChevronLeftIcon}
                  label={stopText(t, locale, "viewerPrev")}
                  disabled={slides.length < 2}
                  onClick={() => show(activeIndex - 1)}
                />
                <ViewerStep
                  icon={ChevronRightIcon}
                  label={stopText(t, locale, "viewerNext")}
                  disabled={slides.length < 2}
                  onClick={() => show(activeIndex + 1)}
                />
              </div>
              <Button asChild variant="secondary" size="icon-lg">
                <DialogClose
                  type="button"
                  aria-label={stopText(t, locale, "viewerClose")}
                  data-testid="photo-viewer-close"
                >
                  <XIcon aria-hidden />
                </DialogClose>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** A 48 px icon button of the viewer. */
function ViewerStep({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-lg"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >
      <Icon aria-hidden />
    </Button>
  );
}

/**
 * Horizontal swipe / flick: a pointer that moves more than `SWIPE_THRESHOLD` px sideways switches
 * to the neighbouring photo. Listening on the window keeps the zoom/pan pointer handling of
 * `ZoomableImage` (which captures the pointer on its own frame) untouched.
 */
function startSwipe(
  count: number,
  index: number,
  show: (index: number) => void,
): (event: React.PointerEvent<HTMLDivElement>) => void {
  return (event) => {
    if (count < 2) return;
    const origin = { x: event.clientX, y: event.clientY };
    const onUp = (up: globalThis.PointerEvent) => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const dx = up.clientX - origin.x;
      const dy = up.clientY - origin.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
      show(index + (dx < 0 ? 1 : -1));
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
}
