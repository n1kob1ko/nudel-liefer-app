"use client";

import { ExternalLinkIcon, type LucideIcon, PencilIcon, RepeatIcon, UserIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { orderIcon, orderSourceIcon, orderTone } from "@/components/shared/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActions } from "@/components/ui/row-actions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { isOrderEditable } from "@/domain/order-overview";
import { Link } from "@/i18n/navigation";
import { createAppFormatters, formatOrderWindow, isPlainWindow } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { OrderOverviewRow } from "@/server/orders";

/** Clicks on these keep working as before; only a click on the row itself opens the drawer. */
const INTERACTIVE = "a,button,input,select,textarea,[role='menuitem'],[role='option']";

/**
 * How many position chips stay inline before the cell collapses to "{n} Positionen" with a
 * tooltip (re-design.md §8.3: "collapsed to '3 Positionen' ... when > 2"). The full list stays in
 * the tooltip *and* as `sr-only` text, so nothing is lost for a screen reader.
 */
const CHIP_LIMIT = 2;

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

function clickedControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

/** Renders the icon `orderSourceIcon` returns (a lookup, handed in as a prop like `StatusBadge`). */
function SourceMark({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon className={className} aria-hidden />;
}

/**
 * Order overview rows (re-design.md §8.3/§8.10). Real `<table>`, 48 px rows, sticky header, one
 * visible control per row (`RowActions`, the rest in its menu). A click on the row opens the right
 * drawer with the order; the count chip links to the detail page and keeps `order-open`, every
 * `data-testid` of the specs is unchanged.
 */
export function OrdersTable({
  orders,
  multiDay,
  today,
}: {
  orders: OrderOverviewRow[];
  /** Range spans more than one day: the Liefertag column is shown instead of date group headers. */
  multiDay: boolean;
  /** Today in the factory time zone (`YYYY-MM-DD`) — decides whether an order can still be edited. */
  today: string;
}) {
  const t = useTranslations("admin.orders");
  const fmt = createAppFormatters(useFormatter());
  const [openId, setOpenId] = useState<string | null>(null);

  const groups = new Map<string, { date: Date; rows: OrderOverviewRow[] }>();
  for (const order of orders) {
    const key = formatCalendarDate(order.deliveryDate);
    const group = groups.get(key) ?? { date: order.deliveryDate, rows: [] };
    group.rows.push(order);
    groups.set(key, group);
  }
  const columns = (multiDay ? 6 : 5) + 1;
  const open = openId ? (orders.find((order) => order.id === openId) ?? null) : null;

  return (
    <>
      <Table
        data-testid="orders-table"
        // Tighter padding so all seven columns fit next to the totals rail (1280 px), and a row
        // with the two lines of the customer cell stays inside the 48–52 px density budget
        // (§8.10). Auto table layout on purpose: the customer cell is capped, so the leftover width
        // goes to the Produkte column instead of being shared out evenly.
        // Below `md` the rows become stacked blocks (review 2026-10-31: seven columns squeezed into
        // 390 px read as cramped): name and menu on the first line, the position chips on their
        // own line, status / source / tour as a row of badges — see `OrderRow`.
        className="md:[&_td]:px-2 md:[&_td]:py-0.5 md:[&_th]:px-2 max-md:[&_td]:p-0"
        containerClassName="md:max-h-[70dvh] md:overflow-auto"
        aria-label={t("title")}
      >
        {/* Sticky header: the utilities are set here so the table does not depend on an optional
            prop of the shared kit (`TableHeader` also supports `data-sticky`). */}
        <TableHeader className="sticky top-0 z-10 bg-muted max-md:hidden [&_th]:bg-muted">
          <TableRow>
            {multiDay ? <TableHead>{t("columns.date")}</TableHead> : null}
            <TableHead>{t("columns.customer")}</TableHead>
            <TableHead>{t("columns.items")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.source")}</TableHead>
            <TableHead>{t("columns.tour")}</TableHead>
            <TableHead className="w-12 text-end">
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...groups.entries()].map(([key, group]) => (
            <Fragment key={key}>
              {multiDay ? null : (
                <TableRow
                  data-testid="order-group"
                  data-date={key}
                  className="hover:bg-transparent"
                >
                  <TableHead
                    scope="colgroup"
                    colSpan={columns}
                    className="bg-muted/50 text-sm font-medium text-muted-foreground max-md:block max-md:px-2 max-md:py-1.5"
                  >
                    {t("group.label", { date: fmt.calendarDate(group.date) })}
                  </TableHead>
                </TableRow>
              )}
              {group.rows.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  multiDay={multiDay}
                  today={today}
                  onOpen={() => setOpenId(order.id)}
                />
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <OrderDrawer order={open} today={today} onClose={() => setOpenId(null)} />
    </>
  );
}

function OrderRow({
  order,
  multiDay,
  today,
  onOpen,
}: {
  order: OrderOverviewRow;
  multiDay: boolean;
  today: string;
  onOpen: () => void;
}) {
  const t = useTranslations("admin.orders");
  const tc = useTranslations("common");
  // Unit labels ("Sackerl", "Kiste", "×") live once, under `driver.units` — the office screens
  // reuse them instead of duplicating translations (§9.3).
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const cancelled = order.status === "CANCELLED";
  const editable = isOrderEditable(
    { status: order.status, deliveryDate: order.deliveryDate },
    parseCalendarDate(today) ?? new Date(),
  );
  /**
   * Full line ("22 Sackerl Nudeln", "3 × Wantan-Teig"): the tooltip, the collapsed list and the accessible
   * text of a chip. `orders.spec.ts` and `order-overview.spec.ts` read exactly this wording.
   */
  const itemLabel = (item: OrderOverviewRow["items"][number]) =>
    `${fmt.quantity(item.quantity)} ${tu(item.unit as "KG" | "PACK" | "CRATE" | "PIECE", { count: Number(item.quantity) })} ${productName(item.productName, locale)}`;
  /**
   * Compact chip (re-design.md §8.3: "4 × Penne 5 kg"). The unit and the product name both repeat
   * the pack size, so the short form leaves the one content-bearing column readable at 1280 px
   * instead of ellipsising mid-word. The full line stays in `title` and in the `sr-only` span, so
   * the visible abbreviation never costs information.
   */
  const itemChipLabel = (item: OrderOverviewRow["items"][number]) =>
    `${fmt.quantity(item.quantity)} × ${productName(item.productName, locale)}`;
  const collapsed = order.items.length > CHIP_LIMIT;

  return (
    <TableRow
      data-testid="order-row"
      data-order-id={order.id}
      className="cursor-pointer max-md:flex max-md:h-auto max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-2 max-md:px-2 max-md:py-3"
      onClick={(event) => {
        if (clickedControl(event.target)) return;
        onOpen();
      }}
    >
      {multiDay ? (
        <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums max-md:order-first max-md:basis-full max-md:text-sm">
          {fmt.calendarDate(order.deliveryDate)}
        </TableCell>
      ) : null}

      {/* A floor, not a cap: the customer name may wrap to two lines, and everything the fixed
          columns leave goes to the Produkte column (round-3 review: that column carries the order
          content). Without the floor the greedy chip column squeezed the name to three lines. */}
      <TableCell className="min-w-[12rem] max-md:order-1 max-md:min-w-0 max-md:flex-1">
        <Link
          href={`/admin/customers/${order.customer.id}`}
          className={
            "font-semibold underline-offset-4 hover:underline " +
            (cancelled ? "text-muted-foreground" : "")
          }
        >
          {order.customer.name}
        </Link>
        <div className="text-sm text-muted-foreground tabular-nums">
          {order.customer.customerNumber}
        </div>
        {isPlainWindow(order.window, order.deliveryDate) ? null : (
          <div className="text-sm text-muted-foreground" data-testid="order-window-text">
            {t("window.label")}: {formatOrderWindow(fmt, order.window)}
          </div>
        )}
      </TableCell>

      {/* The flexible column: it carries the only free content of the row, so it takes every pixel
          the fixed columns (Status / Quelle / Tour / actions) leave over. The chips wrap instead of
          being cut in the middle of a word (the round-3 review read "2 Pa…"), and the two-line cap
          keeps the row inside the 48–52 px density budget (§8.10) as long as the labels fit. */}
      <TableCell className="min-w-0 max-md:order-3 max-md:basis-full">
        {/* One line where it fits: the count sits inline with the chips (never a bubble of its own).
            The old `max-w-48`/`max-w-80` cap is gone — it squeezed the chips below their content
            width at 1280 px while the totals rail shared the row. */}
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
          <Link
            href={`/admin/orders/${order.id}`}
            data-testid="order-open"
            aria-label={t("openOrder")}
            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-border px-1.5 text-sm font-medium text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <span data-testid="order-line-count">{order.items.length}</span>
          </Link>
          {collapsed ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="inline-flex h-6 shrink-0 items-center rounded-md border border-border px-2 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    {t("positions.summary", { count: order.items.length })}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <ul className="flex flex-col gap-0.5">
                    {order.items.map((item) => (
                      <li key={item.id}>{itemLabel(item)}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <ul className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="order-items">
              {order.items.map((item) => (
                <li
                  key={item.id}
                  data-testid="order-item"
                  // Hover shows the full line (quantity + unit + product); the compact chip only
                  // carries "4 × Penne 5 kg" (§8.3).
                  title={itemLabel(item)}
                  className="inline-flex h-6 max-w-full min-w-0 items-center rounded-md border border-border px-2 text-sm"
                >
                  <span aria-hidden className="truncate">
                    {itemChipLabel(item)}
                  </span>
                  {/* The chip abbreviates visually only: AT (and the e2e specs) still read the full
                      "22 Sackerl Nudeln". */}
                  <span className="sr-only">{itemLabel(item)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* The collapsed row keeps the full list for assistive tech (the tooltip alone is
            hover-only); `orders.spec.ts` also reads the three lines of a three-line order here. */}
        {collapsed ? (
          <ul className="sr-only">
            {order.items.map((item) => (
              <li key={item.id} data-testid="order-item">
                {itemLabel(item)}
              </li>
            ))}
          </ul>
        ) : null}
      </TableCell>

      <TableCell className="max-md:order-4">
        <span data-testid="order-status" className="inline-flex">
          <StatusBadge tone={orderTone(order.status)} icon={orderIcon(order.status)} size="sm">
            {tc(`statuses.order.${order.status}`)}
          </StatusBadge>
        </span>
      </TableCell>

      <TableCell className="max-md:order-5">
        <span
          className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap"
          data-testid="order-source"
          data-source={order.source}
        >
          <SourceMark
            icon={order.fromRecurring ? RepeatIcon : orderSourceIcon(order.source)}
            className="size-4 text-muted-foreground"
          />
          {order.fromRecurring ? (
            <span data-testid="order-from-recurring">{t("fromRecurring")}</span>
          ) : (
            t(`source.${order.source}`)
          )}
        </span>
      </TableCell>

      <TableCell className="max-md:order-6">
        {order.tour ? (
          <Link
            href={{
              pathname: "/admin/tours",
              query: { date: formatCalendarDate(order.deliveryDate) },
            }}
            className="inline-flex"
            data-testid="order-in-tour-link"
          >
            <StatusBadge tone="info" size="sm">
              <span
                data-testid="order-in-tour"
                data-tour-id={order.tour.tourId}
                data-stop-id={order.tour.stopId}
              >
                {t("inTour")}
              </span>
            </StatusBadge>
          </Link>
        ) : order.late ? (
          <Link
            href={{
              pathname: "/admin/tours",
              query: { date: formatCalendarDate(order.deliveryDate) },
            }}
            className="inline-flex"
            data-testid="order-late-link"
          >
            <StatusBadge tone="warning" size="sm">
              <span data-testid="order-late">{t("late.badge")}</span>
            </StatusBadge>
          </Link>
        ) : (
          <span className="text-muted-foreground" aria-hidden>
            —
          </span>
        )}
      </TableCell>

      <TableCell className="text-end max-md:order-2">
        <RowActions label={t("rowMenu.label", { customer: order.customer.name })}>
          <DropdownMenuItem onSelect={onOpen} data-testid="order-row-details">
            <ExternalLinkIcon aria-hidden />
            {t("rowMenu.details")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/admin/orders/${order.id}`} data-testid="order-row-open">
              {t("rowMenu.open")}
            </Link>
          </DropdownMenuItem>
          {editable ? (
            <DropdownMenuItem asChild>
              <Link href={`/admin/orders/${order.id}/edit`} data-testid="order-row-edit">
                <PencilIcon aria-hidden />
                {t("rowMenu.edit")}
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={`/admin/customers/${order.customer.id}`} data-testid="order-row-customer">
              <UserIcon aria-hidden />
              {t("rowMenu.customer")}
            </Link>
          </DropdownMenuItem>
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

/** Right drawer with the order (re-design.md §8.3): a preview, the edit page stays a link. */
function OrderDrawer({
  order,
  today,
  onClose,
}: {
  order: OrderOverviewRow | null;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("admin.orders");
  const tc = useTranslations("common");
  // Same plural unit labels as the rows (`driver.units`, see `OrderRow`).
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  return (
    <Sheet
      open={order !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" data-testid="order-drawer">
        {order ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("drawer.title")}</SheetTitle>
              <SheetDescription>
                {t("drawer.description", {
                  customer: order.customer.name,
                  date: fmt.calendarDate(order.deliveryDate),
                })}
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("columns.customer")}</dt>
                <dd>
                  <Link
                    href={`/admin/customers/${order.customer.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {order.customer.name}
                  </Link>
                  <span className="block text-muted-foreground tabular-nums">
                    {order.customer.customerNumber}
                  </span>
                </dd>
                <dt className="text-muted-foreground">{t("window.label")}</dt>
                <dd data-testid="drawer-window">{formatOrderWindow(fmt, order.window)}</dd>
                <dt className="text-muted-foreground">{t("columns.status")}</dt>
                <dd>
                  <StatusBadge
                    tone={orderTone(order.status)}
                    icon={orderIcon(order.status)}
                    size="sm"
                  >
                    {tc(`statuses.order.${order.status}`)}
                  </StatusBadge>
                </dd>
                <dt className="text-muted-foreground">{t("columns.source")}</dt>
                <dd className="inline-flex items-center gap-1.5">
                  <SourceMark
                    icon={order.fromRecurring ? RepeatIcon : orderSourceIcon(order.source)}
                    className="size-4 text-muted-foreground"
                  />
                  {order.fromRecurring ? t("fromRecurring") : t(`source.${order.source}`)}
                </dd>
                <dt className="text-muted-foreground">{t("columns.tour")}</dt>
                <dd>
                  {order.tour ? (
                    <Link
                      href={{
                        pathname: "/admin/tours",
                        query: { date: formatCalendarDate(order.deliveryDate) },
                      }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t("inTour")}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("detail.notInTour")}</span>
                  )}
                </dd>
              </dl>

              <h3 className="mt-4 mb-1 text-sm font-medium text-muted-foreground">
                {t("drawer.positions")}
              </h3>
              <ul className="flex flex-col gap-1 text-base">
                {order.items.map((item) => (
                  <li key={item.id} className="tabular-nums">
                    <span className="font-semibold">
                      {fmt.quantity(item.quantity)}{" "}
                      {tu(item.unit as "KG" | "PACK" | "CRATE" | "PIECE", {
                        count: Number(item.quantity),
                      })}
                    </span>{" "}
                    {productName(item.productName, locale)}
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-sm text-muted-foreground">{t("drawer.hint")}</p>
            </div>

            <SheetFooter className="flex-row justify-end gap-2">
              <Link
                href={`/admin/orders/${order.id}`}
                className={buttonVariants({ variant: "outline" })}
                data-testid="drawer-open-order"
              >
                {t("drawer.open")}
              </Link>
              {isOrderEditable(
                { status: order.status, deliveryDate: order.deliveryDate },
                parseCalendarDate(today) ?? new Date(),
              ) ? (
                <Link
                  href={`/admin/orders/${order.id}/edit`}
                  className={buttonVariants()}
                  data-testid="drawer-edit-order"
                >
                  <PencilIcon aria-hidden />
                  {t("drawer.edit")}
                </Link>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
