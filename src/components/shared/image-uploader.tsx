"use client";

import { CameraIcon, ImagePlusIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { type UploadedImage, UploadError, uploadImage } from "@/lib/upload-image";
import type { UploadPurpose } from "@/lib/uploads";
import { cn } from "@/lib/utils";

type Props = {
  purpose: UploadPurpose;
  onUploaded: (image: UploadedImage) => void;
  disabled?: boolean;
  /** Also accept `paste` anywhere on the page (use only when there is a single uploader). */
  pasteAnywhere?: boolean;
  /** Show a second button that opens the phone camera directly. */
  camera?: boolean;
  /** One-row variant for forms where the image is optional (order import column). */
  compact?: boolean;
  className?: string;
};

/** Drop zone + file picker + clipboard paste. Resizes in the browser, then uploads. */
export function ImageUploader({
  purpose,
  onUploaded,
  disabled,
  pasteAnywhere,
  camera,
  compact = false,
  className,
}: Props) {
  const t = useTranslations("common.upload");
  const [progress, setProgress] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const busy = progress !== null;

  const start = useCallback(
    async (file: File | Blob | undefined) => {
      if (!file || disabled || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setErrorCode(null);
      setProgress(0);
      try {
        const image = await uploadImage(file, {
          purpose,
          signal: controller.signal,
          onProgress: setProgress,
        });
        onUploaded(image);
      } catch (error) {
        const code = error instanceof UploadError ? error.code : "REQUEST_FAILED";
        if (code !== "ABORTED") setErrorCode(code);
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
    },
    [disabled, onUploaded, purpose],
  );

  useEffect(() => {
    if (!pasteAnywhere) return;
    const handler = (event: globalThis.ClipboardEvent) => {
      const file = firstImage(event.clipboardData);
      if (file) void start(file);
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [pasteAnywhere, start]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function onPaste(event: ClipboardEvent) {
    const file = firstImage(event.clipboardData);
    if (file) {
      event.preventDefault();
      void start(file);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void start(event.dataTransfer.files[0]);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        data-testid="image-uploader"
        tabIndex={disabled ? -1 : 0}
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-lg border-2 border-dashed border-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          compact
            ? "flex flex-wrap items-center gap-3 p-3 text-start"
            : "flex flex-col items-center gap-3 p-6 text-center",
          dragging && "border-foreground bg-primary-soft",
          disabled && "opacity-50",
        )}
      >
        {compact && !busy ? (
          <>
            <ImagePlusIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("dropHere")}</p>
              <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              {t("choose")}
            </Button>
          </>
        ) : busy ? (
          <>
            <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden />
            <p role="status">{t("uploading", { percent: Math.round((progress ?? 0) * 100) })}</p>
            <progress
              className="h-2 w-full max-w-xs"
              value={progress ?? 0}
              max={1}
              aria-label={t("uploading", { percent: Math.round((progress ?? 0) * 100) })}
            />
            <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
              {t("cancel")}
            </Button>
          </>
        ) : (
          <>
            <ImagePlusIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">{t("dropHere")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" disabled={disabled} onClick={() => fileInput.current?.click()}>
                <ImagePlusIcon aria-hidden />
                {t("choose")}
              </Button>
              {camera ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => cameraInput.current?.click()}
                >
                  <CameraIcon aria-hidden />
                  {t("camera")}
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{t("pasteHint")}</p>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.heic,.heif"
          className="sr-only"
          tabIndex={-1}
          data-testid="image-uploader-input"
          aria-label={t("choose")}
          disabled={disabled}
          onChange={(e) => {
            void start(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {camera ? (
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("camera")}
            disabled={disabled}
            onChange={(e) => {
              void start(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        ) : null}
      </div>
      {errorCode ? (
        <p role="alert" className="text-base font-medium text-destructive">
          {t(`errors.${errorCode}` as "errors.UPLOAD_FAILED")}
        </p>
      ) : null}
    </div>
  );
}

function firstImage(data: DataTransfer | null): File | undefined {
  return Array.from(data?.files ?? []).find((f) => f.type.startsWith("image/"));
}
