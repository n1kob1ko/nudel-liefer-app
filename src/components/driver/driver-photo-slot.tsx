"use client";

import {
  CameraIcon,
  CheckIcon,
  ImageIcon,
  ImageOffIcon,
  Loader2Icon,
  RefreshCwIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DriverPhotoKind } from "@/domain/driver-photo";
import type { ShownPhoto } from "@/lib/offline/photo-outbox";
import { enqueuePhoto } from "@/lib/offline/photo-outbox-browser";
import { resizeImage, UploadError } from "@/lib/upload-image";

type Phase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "preview"; blob: Blob; width: number; height: number; url: string }
  | { name: "saving" };

type Props = {
  kind: DriverPhotoKind;
  label: string;
  alt: string;
  photo: ShownPhoto | null;
  stopId: string;
  customerId: string;
  customerName: string;
  /** Presentation only: the photos card opens the shared fullscreen viewer on tap (re-design.md §7.3). */
  onOpen?: () => void;
};

/**
 * One square photo thumbnail of the stop screen (STORE or PARKING) with the camera built in
 * (NUD-083, redesign RD-2 §7.3). The upload logic is unchanged: the file input is still the leaf,
 * the resized blob still goes into the on-device photo queue and the slot still shows the queued
 * photo at once ("waiting"/"sent").
 *
 * Presentation only since the redesign: the frame is a 1:1 thumbnail that the photos card puts next
 * to its sibling; tapping a present photo opens the shared fullscreen viewer (`onOpen`), the
 * "Replace photo" overlay button is a sibling of the frame (never nested inside it), and a missing
 * photo is a dashed placeholder whose own button opens the rear camera.
 */
export function DriverPhotoSlot({
  kind,
  label,
  alt,
  photo,
  stopId,
  customerId,
  customerName,
  onOpen,
}: Props) {
  const t = useTranslations("driver.stop");
  const tErrors = useTranslations("common.upload.errors");
  const id = kind.toLowerCase();
  const input = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const previewUrl = phase.name === "preview" ? phase.url : null;

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErrorCode(null);
    setPhase({ name: "preparing" });
    try {
      // Decode, scale to 1600 px, JPEG q 0.8, strip EXIF/GPS: same pipeline as the office upload.
      const { blob, width, height } = await resizeImage(file);
      setPhase({ name: "preview", blob, width, height, url: URL.createObjectURL(blob) });
    } catch (error) {
      setErrorCode(error instanceof UploadError ? error.code : "DECODE_FAILED");
      setPhase({ name: "idle" });
    }
  }

  async function confirm() {
    if (phase.name !== "preview") return;
    const { blob, width, height } = phase;
    setPhase({ name: "saving" });
    try {
      await enqueuePhoto({ stopId, customerId, customerName, kind, blob, width, height });
      setPhase({ name: "idle" });
    } catch {
      // No storage on the device (private mode, full): the photo could not be kept.
      setErrorCode("STORAGE_FAILED");
      setPhase({ name: "idle" });
    }
  }

  const take = () => input.current?.click();
  // Same pipeline, but the picker without `capture` offers the gallery (NUD-143).
  const pickFromGallery = () => galleryInput.current?.click();
  const busy = phase.name === "preparing" || phase.name === "saving";

  return (
    <section className="min-w-0 space-y-2" data-testid={`photo-${id}`}>
      <h3 className="truncate text-base font-semibold" data-testid={`photo-label-${id}`}>
        {label}
      </h3>
      <div className="relative">
        {/* 1:1 frame: a missing, slow or broken photo never changes the layout. */}
        <div
          className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted"
          data-testid="photo-frame"
        >
          {phase.name === "preview" ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob of the photo just taken
            <img
              src={phase.url}
              alt={alt}
              className="size-full object-contain"
              data-testid="photo-preview"
            />
          ) : busy ? (
            <div
              className="flex size-full flex-col items-center justify-center gap-2 p-2 text-center text-muted-foreground"
              role="status"
              data-testid="photo-busy"
            >
              <Loader2Icon className="size-10 animate-spin" aria-hidden />
              <span className="text-base font-medium">{t("photoPreparing")}</span>
            </div>
          ) : photo ? (
            <button
              type="button"
              onClick={onOpen}
              disabled={!onOpen}
              className="block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={t("viewerTitle")}
              data-testid={`photo-open-${id}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already resized */}
              <img src={photo.url} alt={alt} className="size-full object-cover" />
            </button>
          ) : (
            <div
              // Absolutely filled so a missing photo can never stretch the 1:1 frame: in German
              // "Foto aufnehmen" is the longest label and used to make this tile taller than the
              // tile beside it (design review point 9).
              className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border p-1.5 text-center text-muted-foreground"
              data-testid="photo-missing"
            >
              <ImageOffIcon className="size-9" aria-hidden />
              <span className="text-base font-medium">{t("noPhoto")}</span>
            </div>
          )}
        </div>

        {/* Overlay: 48 px targets, siblings of the frame so the frame holds exactly one button. */}
        {photo && !busy && phase.name !== "preview" ? (
          <div className="absolute end-2 bottom-2 flex gap-2">
            <Button
              type="button"
              size="icon-lg"
              variant="secondary"
              className="shadow-md"
              onClick={pickFromGallery}
              aria-label={t("fromGallery")}
              data-testid={`photo-gallery-${id}`}
            >
              <ImageIcon aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              variant="secondary"
              className="shadow-md"
              onClick={take}
              aria-label={t("replacePhoto")}
              data-testid={`photo-replace-${id}`}
            >
              <CameraIcon aria-hidden />
            </Button>
          </div>
        ) : null}

        {photo?.pending && phase.name === "idle" ? (
          <span
            role="status"
            data-testid="photo-pending"
            className="absolute start-2 top-2 flex items-center gap-1 rounded-full bg-warning-soft px-2 py-1 text-sm font-bold text-warning-soft-foreground"
          >
            <UploadCloudIcon className="size-4 shrink-0" aria-hidden />
            {t("photoPending")}
          </span>
        ) : photo?.sent && phase.name === "idle" ? (
          <span
            role="status"
            data-testid="photo-sent"
            className="absolute start-2 top-2 flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-sm font-bold text-success-soft-foreground"
          >
            <CheckIcon className="size-4 shrink-0" aria-hidden />
            {t("photoSent")}
          </span>
        ) : null}
      </div>

      {!photo && phase.name === "idle" ? (
        <div className="grid gap-2" data-testid="photo-actions">
          {/* One line each, 16 px: "Foto aufnehmen" is the longest label and must not wrap. Neither
              is yolk: a photo is optional, the yolk button of the stop is the navigation. */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 w-full px-1 text-base whitespace-nowrap"
            onClick={take}
            data-testid={`photo-take-${id}`}
          >
            {t("takePhoto")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 w-full px-1 text-base whitespace-nowrap"
            onClick={pickFromGallery}
            data-testid={`photo-gallery-${id}`}
          >
            {t("fromGallery")}
          </Button>
        </div>
      ) : null}

      {phase.name === "preview" ? (
        <div className="grid grid-cols-2 gap-2" data-testid="photo-confirm-bar">
          <Button
            type="button"
            size="lg"
            className="col-span-2 text-base"
            onClick={() => void confirm()}
            data-testid="photo-confirm"
          >
            <CheckIcon className="size-6" aria-hidden />
            {t("usePhoto")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="text-base"
            onClick={take}
            data-testid="photo-retake"
          >
            <RefreshCwIcon className="size-5" aria-hidden />
            {t("retakePhoto")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="text-base"
            onClick={() => setPhase({ name: "idle" })}
            data-testid="photo-cancel"
          >
            <XIcon className="size-5" aria-hidden />
            {t("cancelPhoto")}
          </Button>
        </div>
      ) : null}

      {errorCode ? (
        <p
          role="alert"
          className="text-base font-medium text-destructive"
          data-testid="photo-error"
        >
          {errorCode === "STORAGE_FAILED"
            ? t("photoNotSaved")
            : tErrors(errorCode as "DECODE_FAILED")}
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={t("takePhoto")}
        data-testid={`photo-input-${id}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onFile(file);
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t("fromGallery")}
        data-testid={`photo-gallery-input-${id}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onFile(file);
        }}
      />
    </section>
  );
}
