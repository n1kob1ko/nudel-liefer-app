"use client";

import {
  AlertTriangleIcon,
  ImagePlusIcon,
  ListChecksIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { RowButton, RowButtons } from "@/components/ui/row-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { isHeic, uploadImage } from "@/lib/upload-image";
import { cn } from "@/lib/utils";
import type { InboxItemView, InboxView } from "@/server/order-inbox";
import {
  addInboxPhotosAction,
  discardInboxPhotoAction,
  inboxAction,
  restoreInboxPhotoAction,
  retryInboxPhotoAction,
} from "@/server/order-inbox-actions";

export type InboxProduct = { id: string; name: string; unit: "KG" | "PACK" | "CRATE" | "PIECE" };

type Props = {
  initial: InboxView;
  /** The photo "Prüfen starten" opens (the oldest one that is ready). */
  firstId: string | null;
  /** A model reads the photos; without one they wait unread and are typed by hand. */
  aiAvailable: boolean;
  products: InboxProduct[];
};

/** Photos resized and sent at the same time; the browser stays responsive on a phone. */
const UPLOADS_AT_ONCE = 3;
/** How often the list is read again while photos are being uploaded or read. */
const REFRESH_MS = 2500;

type UploadState = { total: number; done: number; failed: number };

/**
 * A signed URL is new on every answer of the server; a photo that is already on screen keeps the
 * URL it was loaded with, so the list does not fetch a hundred photos again every few seconds.
 */
function keepUrls(current: InboxView, next: InboxView): InboxView {
  const known = new Map(current.items.map((item) => [item.id, item.url]));
  return {
    ...next,
    items: next.items.map((item) => ({ ...item, url: known.get(item.id) ?? item.url })),
  };
}

/** A signed URL of the private bucket: next/image cannot fetch it. */
function thumbnail(url: string) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className="size-full object-cover object-top"
    />
  );
}

/**
 * The order inbox (NUD-210): many photos of orders are uploaded at once (picked, dropped or
 * pasted), the server reads them in the background and this list shows what it found. Each row
 * leads to the order form with the photo next to it; nothing is an order before the office saves
 * it there.
 *
 * The list reads itself again every few seconds while something is still being uploaded or read,
 * and stops when everything is settled. Discarding is immediate and can be taken back from the
 * toast.
 */
export function OrderInbox({ initial, firstId: initialFirstId, aiAvailable, products }: Props) {
  const t = useTranslations("admin.orders.inbox");
  const tc = useTranslations("common");
  const [view, setView] = useState(initial);
  const [firstId, setFirstId] = useState(initialFirstId);
  const [upload, setUpload] = useState<UploadState>({ total: 0, done: 0, failed: 0 });
  // Rows the office discarded: gone at once, whatever the next answer of the server still says.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const queue = useRef<File[]>([]);
  const running = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const productById = new Map(products.map((product) => [product.id, product]));
  const uploading = upload.done + upload.failed < upload.total;
  const items = view.items.filter((item) => !hidden.has(item.id));
  const reading = aiAvailable
    ? items.filter((item) => item.status === "NEW" || item.status === "READING").length
    : 0;
  const startId =
    firstId && !hidden.has(firstId)
      ? firstId
      : (items.find((item) => item.status === "READY")?.id ?? null);

  const refresh = useCallback(async () => {
    try {
      const next = await inboxAction();
      setView((current) => keepUrls(current, next.view));
      setFirstId(next.firstId);
    } catch {
      // The next tick tries again; a failed refresh must not empty the list.
    }
  }, []);

  const active = uploading || reading > 0;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await refresh();
      if (!cancelled) timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    timer = setTimeout(() => void tick(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, refresh]);

  /** Takes photos off the queue until it is empty: resize, upload, put into the inbox. */
  const work = useCallback(async () => {
    running.current += 1;
    try {
      for (let file = queue.current.shift(); file; file = queue.current.shift()) {
        try {
          const image = await uploadImage(file, { purpose: "screenshot" });
          const result = await addInboxPhotosAction([image.storageKey]);
          if (!result.ok || result.added === 0) throw new Error("not added");
          setUpload((state) => ({ ...state, done: state.done + 1 }));
        } catch {
          setUpload((state) => ({ ...state, failed: state.failed + 1 }));
        }
      }
    } finally {
      running.current -= 1;
      if (running.current === 0) void refresh();
    }
  }, [refresh]);

  const addFiles = useCallback(
    (list: Iterable<File>) => {
      const files = [...list].filter((file) => file.type.startsWith("image/") || isHeic(file));
      if (files.length === 0) return;
      queue.current.push(...files);
      setUpload((state) =>
        state.done + state.failed < state.total
          ? { ...state, total: state.total + files.length }
          : { total: files.length, done: 0, failed: 0 },
      );
      while (running.current < Math.min(UPLOADS_AT_ONCE, queue.current.length)) void work();
    },
    [work],
  );

  // Ctrl+V anywhere on the page: screenshots come straight from the clipboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.some((file) => file.type.startsWith("image/"))) addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  async function discard(item: InboxItemView) {
    setHidden((current) => new Set(current).add(item.id));
    const show = () =>
      setHidden((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    try {
      const result = await discardInboxPhotoAction(item.id);
      if (!result.ok) throw new Error(result.error);
    } catch {
      show();
      toast.error(t("actionFailed"));
      return;
    }
    toast(t("discarded"), {
      action: {
        label: t("undo"),
        onClick: () => {
          void restoreInboxPhotoAction(item.id)
            .then(async (restored) => {
              if (!restored.ok) throw new Error(restored.error);
              await refresh();
              show();
            })
            .catch(() => toast.error(t("actionFailed")));
        },
      },
    });
    void refresh();
  }

  async function retry(item: InboxItemView) {
    try {
      const result = await retryInboxPhotoAction(item.id);
      if (!result.ok) throw new Error(result.error);
    } catch {
      toast.error(t("actionFailed"));
    }
    await refresh();
  }

  function lineText(item: InboxItemView): string {
    const parts = item.lines.flatMap((line) => {
      const product = productById.get(line.productId);
      return product ? [`${line.quantity} ${tc(`units.${product.unit}`)} ${product.name}`] : [];
    });
    if (item.unmatched > 0) parts.push(t("row.unmatched", { count: item.unmatched }));
    return parts.length > 0 ? parts.join(" · ") : t("row.noLines");
  }

  const reviewHref = (id: string) => ({
    pathname: "/admin/orders/new" as const,
    query: { inbox: id },
  });
  const percent = upload.total > 0 ? (upload.done + upload.failed) / upload.total : 0;

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="order-inbox"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground tabular-nums" role="status">
          <span data-testid="inbox-count">{t("summary", { count: items.length })}</span>
          {reading > 0 ? (
            <span data-testid="inbox-reading"> · {t("reading", { count: reading })}</span>
          ) : null}
        </p>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            variant={startId ? "outline" : "default"}
            className="max-sm:flex-1"
            onClick={() => fileInput.current?.click()}
            data-testid="inbox-upload"
          >
            <ImagePlusIcon aria-hidden />
            {t("upload")}
          </Button>
          {startId ? (
            <Link
              href={reviewHref(startId)}
              className={cn(buttonVariants(), "max-sm:flex-1")}
              data-testid="inbox-start"
            >
              <ListChecksIcon aria-hidden />
              {t("start")}
            </Link>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          className="sr-only"
          tabIndex={-1}
          aria-label={t("upload")}
          data-testid="inbox-file-input"
          onChange={(event) => {
            addFiles(event.target.files ?? []);
            event.target.value = "";
          }}
        />
      </div>

      {uploading ? (
        <div className="flex flex-col gap-2" data-testid="inbox-uploading">
          <p className="text-sm font-medium tabular-nums" role="status">
            {t("uploading", { done: upload.done + upload.failed, total: upload.total })}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full origin-left rounded-full bg-foreground transition-transform duration-200 ease-out motion-reduce:transition-none rtl:origin-right"
              style={{ transform: `scaleX(${percent})` }}
            />
          </div>
        </div>
      ) : null}
      {upload.failed > 0 ? (
        <Alert variant="warning" role="alert" data-testid="inbox-upload-failed">
          <AlertTriangleIcon aria-hidden />
          <div>{t("uploadFailed", { count: upload.failed })}</div>
        </Alert>
      ) : null}
      {aiAvailable || items.length === 0 ? null : (
        <Alert variant="info" role="status" data-testid="inbox-no-ai">
          <div>{t("noAi")}</div>
        </Alert>
      )}

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          data-testid="inbox-empty"
          className={cn(
            "flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-input p-8 text-center outline-none transition-colors duration-150 ease-out hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            dragging && "border-foreground bg-primary-soft",
          )}
        >
          <ImagePlusIcon className="size-8 text-muted-foreground" aria-hidden />
          <span className="text-xl font-semibold text-balance">
            {dragging ? t("drop") : t("empty.title")}
          </span>
          <span className="max-w-prose text-base text-muted-foreground">
            {t("empty.description")}
          </span>
        </button>
      ) : (
        <ul
          className={cn(
            "divide-y divide-border rounded-2xl border bg-card shadow-xs transition-colors duration-150 ease-out motion-reduce:transition-none",
            dragging && "border-foreground bg-primary-soft",
          )}
          data-testid="inbox-list"
        >
          {items.map((item) => {
            const waiting = item.status === "NEW" || item.status === "READING";
            const pendingRead = waiting && aiAvailable;
            const subject = item.customer?.name ?? item.customerHint ?? t("row.photoAlt");
            return (
              <li
                key={item.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 p-3 sm:p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-4"
                data-testid="inbox-row"
                data-status={item.status}
              >
                {pendingRead ? (
                  <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted md:size-16">
                    {thumbnail(item.url)}
                  </div>
                ) : (
                  <Link
                    href={reviewHref(item.id)}
                    aria-label={`${t("row.review")}: ${subject}`}
                    className="block size-14 shrink-0 overflow-hidden rounded-lg bg-muted outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] motion-reduce:transition-none md:size-16"
                  >
                    {thumbnail(item.url)}
                  </Link>
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  {pendingRead ? (
                    <>
                      <p className="text-base font-medium" data-testid="inbox-row-state">
                        {t("row.reading")}
                      </p>
                      <Skeleton className="h-4 w-40 max-w-full" />
                    </>
                  ) : (
                    <>
                      <p
                        className="truncate text-base font-medium"
                        data-testid="inbox-row-customer"
                      >
                        {item.customer ? (
                          <>
                            {item.customer.name}
                            <span className="font-normal text-muted-foreground">
                              , {item.customer.city}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {item.customerHint
                              ? t("row.hint", { name: item.customerHint })
                              : t("row.noCustomer")}
                          </span>
                        )}
                      </p>
                      {item.status === "FAILED" ? (
                        <p
                          className="flex items-center gap-1.5 text-sm font-medium text-destructive"
                          data-testid="inbox-row-state"
                        >
                          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
                          {t("row.failed")}
                        </p>
                      ) : item.status === "READY" ? (
                        <p
                          className="text-sm text-muted-foreground tabular-nums md:truncate"
                          data-testid="inbox-row-lines"
                        >
                          {lineText(item)}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground" data-testid="inbox-row-state">
                          {t("row.unread")}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:flex-nowrap md:justify-end">
                  {pendingRead ? null : (
                    <Link
                      href={reviewHref(item.id)}
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "h-11 px-4 text-sm max-md:flex-1 md:h-9",
                      )}
                      aria-label={`${t("row.review")}: ${subject}`}
                      data-testid="inbox-row-review"
                    >
                      {t("row.review")}
                    </Link>
                  )}
                  <RowButtons className="max-md:contents">
                    {item.status === "FAILED" && aiAvailable ? (
                      <RowButton
                        icon={RotateCwIcon}
                        label={t("row.retry")}
                        hint={t("row.retryHint")}
                        subject={subject}
                        onClick={() => void retry(item)}
                        data-testid="inbox-row-retry"
                      />
                    ) : null}
                    <RowButton
                      icon={Trash2Icon}
                      label={t("row.discard")}
                      subject={subject}
                      destructive
                      onClick={() => void discard(item)}
                      data-testid="inbox-row-discard"
                    />
                  </RowButtons>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
