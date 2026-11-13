"use client";

import {
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  CopyIcon,
  KeyRoundIcon,
  LanguagesIcon,
  PlusIcon,
  PrinterIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { ScheduleSummary, WorkScheduleDialog } from "@/components/admin/work-schedule-editor";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RowButton, RowButtons } from "@/components/ui/row-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  stackedTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ScheduleDay } from "@/domain/work-time";
import { createAppFormatters } from "@/lib/format";
import { isAppLocale, LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import {
  createAdminAction,
  createDriverAction,
  deleteUserAction,
  resetDriverPinAction,
  setDriverLocaleAction,
  setUserActiveAction,
} from "@/server/user-actions";
import type { UserError } from "@/server/users";

export type UserListRow = {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  locale: string;
  active: boolean;
  /** ISO timestamp of the last successful sign-in; `null` when the person never signed in. */
  lastLoginAt: string | null;
};

/** Utilization of one driver in the current week (NUD-152): measured vs contracted minutes. */
export type UserUtilization = {
  percent: number | null;
  actualMinutes: number;
  contractMinutes: number;
};

const ERROR_KEYS: Record<UserError, string> = {
  invalid: "invalid",
  username_taken: "usernameTaken",
  email_taken: "emailTaken",
  not_found: "notFound",
  self: "self",
};

type PinSheet = { name: string; username: string; pin: string };
type Confirm = { kind: "reset" | "deactivate" | "delete"; user: UserListRow };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** "vor 2 Std." / "vor 3 Tagen", built from the locale's relative-time vocabulary. */
function relativeFrom(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(minutes / (60 * 24)), "day");
}

/** Relative time with the absolute timestamp in a tooltip (re-design.md §8.7). */
function LastLogin({ row, timezone }: { row: UserListRow; timezone: string }) {
  const t = useTranslations("admin.drivers");
  const locale = useLocale();
  const format = useFormatter();
  if (!row.lastLoginAt) return <span className="text-muted-foreground">{t("neverLoggedIn")}</span>;
  const absolute = createAppFormatters(format, timezone).dateTime(new Date(row.lastLoginAt));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">{relativeFrom(row.lastLoginAt, locale)}</span>
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Utilization of the current week as a column of the driver list (NUD-152): the measured tour time
 * as a percentage of the contracted hours. Without a schedule there is nothing to compare against.
 */
function UtilizationCell({ utilization }: { utilization?: UserUtilization }) {
  const t = useTranslations("admin.drivers");
  if (!utilization) return <span className="text-muted-foreground">—</span>;
  if (utilization.percent === null) {
    return (
      <span className="text-muted-foreground" title={t("utilization.noSchedule")}>
        —
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default" data-testid="driver-utilization">
          {t("utilization.percent", { percent: utilization.percent })}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t("utilization.hint", {
          actual: utilization.actualMinutes,
          contract: utilization.contractMinutes,
        })}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Drivers + admins management (re-design.md §8.7): 48 px rows, initials `Avatar` with a deterministic
 * colour, the language as a read-only badge (editing moved into the row's edit dialog — the inline
 * native `<select>` is gone), `StatusBadge`, relative "last sign-in" with the absolute time in a
 * tooltip, and one overflow menu per row (PIN reset, language, deactivate/reactivate).
 *
 * The component also renders the shared `PageHeader` (§8.1) because the primary "Fahrer anlegen"
 * action opens the create dialog this component owns: Bestellungen, Kunden, Produkte and Touren all
 * carry their primary action on the header row, and the round-3 review flagged Fahrer as the one page
 * where "Fahrer anlegen" sat inside the table card instead.
 *
 * The Playwright ids stay: `drivers-table`, `driver-row-<username>`, `admins-table`,
 * `admin-row-<email>`, `create-driver`, `create-admin`, `create-driver-form`, `create-submit`,
 * `reset-pin`, `deactivate`, `reactivate`, `delete-user`, `confirm-submit`, `pin-dialog`, `pin-username`,
 * `pin-value`, `pin-copy`, `pin-print`, `pin-done`.
 */
export function UsersManager({
  title,
  drivers,
  admins,
  currentUserId,
  timezone,
  schedules,
  utilization,
}: {
  /** `h1` of the page (it stays the page's only `title`, `data-testid="section-title"`). */
  title: string;
  drivers: UserListRow[];
  admins: UserListRow[];
  currentUserId: string;
  /** Factory time zone for the absolute "last sign-in" tooltip. */
  timezone: string;
  /** Working days and hours per driver id (NUD-152); a driver without rows has no schedule. */
  schedules: Record<string, ScheduleDay[]>;
  /** Utilization of the current week per driver id; a missing entry means "not computed". */
  utilization: Record<string, UserUtilization>;
}) {
  const t = useTranslations("admin.drivers");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState<"driver" | "admin" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [localeDraft, setLocaleDraft] = useState<string>("de");
  const [editLocale, setEditLocale] = useState<string>("de");
  const [pinSheet, setPinSheet] = useState<PinSheet | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editLogin, setEditLogin] = useState<UserListRow | null>(null);
  const [scheduleFor, setScheduleFor] = useState<UserListRow | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const format = useFormatter();

  const errorText = (error: UserError) => t(`errors.${ERROR_KEYS[error]}`);

  async function run<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  function onCreate(kind: "driver" | "admin", event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    startTransition(async () => {
      if (kind === "driver") {
        const input = {
          displayName: form.get("displayName"),
          username: form.get("username"),
          locale: form.get("locale") ?? localeDraft,
        };
        const result = await run(() => createDriverAction(input));
        if (!result) return setFormError(t("errors.generic"));
        if (!result.ok) return setFormError(errorText(result.error));
        setCreateOpen(null);
        setPinSheet({
          name: String(input.displayName).trim(),
          username: String(input.username).trim().toLowerCase(),
          pin: result.pin,
        });
      } else {
        const input = {
          displayName: form.get("displayName"),
          email: form.get("email"),
          password: form.get("password"),
        };
        const result = await run(() => createAdminAction(input));
        if (!result) return setFormError(t("errors.generic"));
        if (!result.ok) return setFormError(errorText(result.error));
        setCreateOpen(null);
      }
      router.refresh();
    });
  }

  function onConfirm() {
    if (!confirm) return;
    const { kind, user } = confirm;
    setConfirmError(null);
    startTransition(async () => {
      if (kind === "reset") {
        const result = await run(() => resetDriverPinAction(user.id));
        if (!result) return setConfirmError(t("errors.generic"));
        if (!result.ok) return setConfirmError(errorText(result.error));
        setConfirm(null);
        setPinSheet({ name: user.displayName, username: user.username ?? "", pin: result.pin });
      } else if (kind === "delete") {
        const result = await run(() => deleteUserAction(user.id));
        if (!result) return setConfirmError(t("errors.generic"));
        if (!result.ok) {
          if (result.error === "open_tours") {
            // The days of the tours that stop the delete: `Tour.date` is a calendar day (UTC).
            const dates = (result.dates ?? [])
              .map((day) =>
                format.dateTime(new Date(`${day}T00:00:00Z`), {
                  day: "2-digit",
                  month: "2-digit",
                  timeZone: "UTC",
                }),
              )
              .join(", ");
            return setConfirmError(t("errors.openTours", { name: user.displayName, dates }));
          }
          return setConfirmError(
            result.error === "self" ? t("errors.selfDelete") : errorText(result.error),
          );
        }
        setConfirm(null);
        toast.success(t("toast.deleted", { name: user.displayName }));
      } else {
        const result = await run(() => setUserActiveAction(user.id, false));
        if (!result) return setConfirmError(t("errors.generic"));
        if (!result.ok) return setConfirmError(errorText(result.error));
        setConfirm(null);
        toast.success(t("toast.deactivated", { name: user.displayName }));
      }
      router.refresh();
    });
  }

  function reactivate(user: UserListRow) {
    startTransition(async () => {
      const result = await run(() => setUserActiveAction(user.id, true));
      if (!result) {
        toast.error(t("errors.generic"));
        return;
      }
      if (!result.ok) {
        toast.error(errorText(result.error));
        return;
      }
      toast.success(t("toast.activated", { name: user.displayName }));
      router.refresh();
    });
  }

  function changeLocale(user: UserListRow, locale: string) {
    startTransition(async () => {
      const result = await run(() => setDriverLocaleAction(user.id, locale));
      if (!result) {
        toast.error(t("errors.generic"));
        return;
      }
      if (!result.ok) {
        toast.error(errorText(result.error));
        return;
      }
      toast.success(t("toast.localeChanged", { name: user.displayName }));
      setEditLogin(null);
      router.refresh();
    });
  }

  /** Shared row renderer: the driver and admin tables only differ in the middle columns. */
  function renderRows(rows: UserListRow[], kind: "driver" | "admin") {
    return rows.map((user) => (
      <TableRow
        key={user.id}
        data-testid={`${kind}-row-${user.username ?? user.email}`}
        // A phone shows each person as a block: who and whether active, then the actions as
        // buttons with words on them. From 768 px it is a table row again.
        className={stackedTable.row}
      >
        <TableCell className={cn("py-1.5", stackedTable.cell)}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              // Neutral on purpose: a colour per person would read as a status (DESIGN.md, rule 3).
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
            >
              {initials(user.displayName)}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium md:whitespace-nowrap">{user.displayName}</span>
                {kind === "admin" && user.id === currentUserId ? (
                  <span className="text-sm text-muted-foreground">({t("admins.you")})</span>
                ) : null}
              </span>
              {/* A driver's login name stays below the name at every width: one column less, so
                  the five buttons fit next to the rest. An e-mail has its own column from 768 px. */}
              <span
                className={cn(
                  "font-mono text-sm break-all text-muted-foreground",
                  kind === "admin" && "md:hidden",
                )}
              >
                {kind === "driver" ? user.username : user.email}
              </span>
            </div>
          </div>
        </TableCell>
        {kind === "admin" ? (
          <TableCell className="py-1.5 font-mono text-sm text-muted-foreground max-md:hidden">
            {user.email}
          </TableCell>
        ) : null}
        {kind === "driver" ? (
          <TableCell className="py-1.5 max-[1099px]:hidden">
            <Badge variant="secondary" size="sm">
              <LanguagesIcon aria-hidden />
              {LOCALE_LABELS[user.locale as keyof typeof LOCALE_LABELS] ?? user.locale}
            </Badge>
          </TableCell>
        ) : null}
        {kind === "driver" ? (
          <TableCell className="min-w-44 py-1.5 max-xl:hidden">
            <ScheduleSummary schedule={schedules[user.id] ?? []} />
          </TableCell>
        ) : null}
        {kind === "driver" ? (
          <TableCell className="py-1.5 tabular-nums max-[1399px]:hidden">
            <UtilizationCell utilization={utilization[user.id]} />
          </TableCell>
        ) : null}
        <TableCell className={cn("py-1.5", stackedTable.cell)}>
          <StatusBadge
            // "Aktiv" is the normal case and stays quiet: green means delivered, done or saved.
            tone="neutral"
            className={user.active ? undefined : "text-muted-foreground"}
            icon={user.active ? CheckCircle2Icon : BanIcon}
            size="sm"
          >
            {user.active ? t("status.active") : t("status.inactive")}
          </StatusBadge>
        </TableCell>
        <TableCell
          className={cn("py-1.5", kind === "driver" ? "max-[1399px]:hidden" : "max-md:hidden")}
        >
          <LastLogin row={user} timezone={timezone} />
        </TableCell>
        <TableCell className={cn("py-1.5 text-end", stackedTable.cell, "max-md:col-span-2")}>
          <RowButtons>
            {kind === "driver" && user.active ? (
              <>
                <RowButton
                  subject={user.displayName}
                  icon={KeyRoundIcon}
                  label={t("actions.short.resetPin")}
                  hint={t("actions.resetPin")}
                  data-testid="reset-pin"
                  onClick={() => {
                    setConfirmError(null);
                    setConfirm({ kind: "reset", user });
                  }}
                />
                <RowButton
                  subject={user.displayName}
                  icon={LanguagesIcon}
                  label={t("actions.short.editLogin")}
                  hint={t("actions.editLogin")}
                  data-testid="edit-login"
                  onClick={() => {
                    setEditLocale(user.locale);
                    setEditLogin(user);
                  }}
                />
                <RowButton
                  subject={user.displayName}
                  icon={ClockIcon}
                  label={t("actions.short.editSchedule")}
                  hint={t("actions.editSchedule")}
                  data-testid="edit-schedule"
                  onClick={() => setScheduleFor(user)}
                />
              </>
            ) : null}
            {user.id === currentUserId ? null : user.active ? (
              <RowButton
                subject={user.displayName}
                icon={BanIcon}
                label={t("actions.deactivate")}
                data-testid="deactivate"
                onClick={() => {
                  setConfirmError(null);
                  setConfirm({ kind: "deactivate", user });
                }}
              />
            ) : (
              <RowButton
                subject={user.displayName}
                icon={CheckCircle2Icon}
                label={t("actions.reactivate")}
                data-testid="reactivate"
                onClick={() => reactivate(user)}
              />
            )}
            {user.id === currentUserId ? null : (
              // NUD-206: for good, behind its own confirmation. Never offered for the own account.
              <RowButton
                subject={user.displayName}
                icon={Trash2Icon}
                label={t("actions.delete")}
                destructive
                data-testid="delete-user"
                onClick={() => {
                  setConfirmError(null);
                  setConfirm({ kind: "delete", user });
                }}
              />
            )}
          </RowButtons>
        </TableCell>
      </TableRow>
    ));
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-8">
        {/* §8.1 page-header pattern: `h1` + one sentence on the left, the page's primary action in
            the action slot (it used to sit in the table card's header — round-3 review). */}
        <PageHeader
          title={title}
          actions={
            <Button
              data-testid="create-driver"
              onClick={() => {
                setFormError(null);
                setCreateOpen("driver");
              }}
            >
              <PlusIcon aria-hidden />
              {t("create")}
            </Button>
          }
        />

        <Card>
          {/* No title on this card: the page header above already carries the `h1` and the sentence,
              so the card only holds the table — no duplicated title, no nested eyebrow. */}
          <CardContent>
            {drivers.length === 0 ? (
              <EmptyState title={t("emptyTitle")} description={t("empty")} />
            ) : (
              <Table
                data-testid="drivers-table"
                containerClassName="overscroll-x-contain"
                className={stackedTable.table}
              >
                <TableHeader data-sticky className={stackedTable.header}>
                  <TableRow>
                    <TableHead>{t("columns.name")}</TableHead>
                    {/* The narrower the screen, the fewer columns: language from 1024 px, working
                        time from 1280 px, utilization and last login from 1536 px. */}
                    <TableHead className="max-[1099px]:hidden">{t("columns.language")}</TableHead>
                    <TableHead className="max-xl:hidden">{t("columns.schedule")}</TableHead>
                    <TableHead className="max-[1399px]:hidden">
                      {t("columns.utilization")}
                    </TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead className="max-[1399px]:hidden">{t("columns.lastLogin")}</TableHead>
                    <TableHead className="text-end">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={stackedTable.body}>{renderRows(drivers, "driver")}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            action={
              <Button
                variant="outline"
                data-testid="create-admin"
                onClick={() => {
                  setFormError(null);
                  setCreateOpen("admin");
                }}
              >
                <PlusIcon aria-hidden />
                {t("admins.create")}
              </Button>
            }
          >
            <CardTitle>{t("admins.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {admins.length === 0 ? (
              <EmptyState title={t("admins.emptyTitle")} description={t("admins.empty")} />
            ) : (
              <Table
                data-testid="admins-table"
                containerClassName="overscroll-x-contain"
                className={stackedTable.table}
              >
                <TableHeader data-sticky className={stackedTable.header}>
                  <TableRow>
                    <TableHead>{t("columns.name")}</TableHead>
                    <TableHead className="max-md:hidden">{t("admins.email")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead className="max-md:hidden">{t("columns.lastLogin")}</TableHead>
                    <TableHead className="text-end">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={stackedTable.body}>{renderRows(admins, "admin")}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={createOpen !== null}
        onOpenChange={(open) => {
          if (open) return;
          setCreateOpen(null);
          setLocaleDraft("de");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createOpen === "admin" ? t("admins.formTitle") : t("form.title")}
            </DialogTitle>
            <DialogDescription>
              {createOpen === "admin" ? t("admins.passwordHint") : t("form.usernameHint")}
            </DialogDescription>
          </DialogHeader>
          {createOpen ? (
            <form
              className="flex flex-col gap-4"
              noValidate
              data-testid={createOpen === "driver" ? "create-driver-form" : "create-admin-form"}
              onSubmit={(event) => onCreate(createOpen, event)}
            >
              <FormField label={t("form.displayName")} htmlFor="displayName" required>
                <Input
                  id="displayName"
                  name="displayName"
                  required
                  maxLength={80}
                  autoComplete="off"
                />
              </FormField>
              {createOpen === "driver" ? (
                <>
                  <FormField label={t("form.username")} htmlFor="username" required>
                    <Input
                      id="username"
                      name="username"
                      required
                      minLength={3}
                      maxLength={32}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </FormField>
                  <FormField
                    label={t("form.locale")}
                    htmlFor="locale"
                    className="max-w-xs"
                    info={t("form.localeHint")}
                  >
                    {/* A real native control in the *create* form: the Playwright spec drives it with
                        `selectOption`, and the table's inline select is what re-design.md §8.7 removes.
                        It is styled like the Radix trigger so the dialog looks the same. */}
                    <select
                      id="locale"
                      name="locale"
                      defaultValue="de"
                      lang={localeDraft}
                      onChange={(event) => {
                        if (isAppLocale(event.target.value)) setLocaleDraft(event.target.value);
                      }}
                      data-testid="locale-input"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    >
                      {LOCALES.map((code) => (
                        <option key={code} value={code} lang={code}>
                          {LOCALE_LABELS[code]}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label={t("admins.email")} htmlFor="email" required>
                    <Input id="email" name="email" type="email" required autoComplete="off" />
                  </FormField>
                  <FormField label={t("admins.password")} htmlFor="password" required>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      required
                      minLength={10}
                      autoComplete="new-password"
                    />
                  </FormField>
                </>
              )}
              {formError ? (
                <p
                  role="alert"
                  className="text-base font-medium text-destructive"
                  data-testid="form-error"
                >
                  {formError}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={pending} data-testid="create-submit">
                  {t("form.submit")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editLogin !== null} onOpenChange={(open) => !open && setEditLogin(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editLogin ? t("login.title", { name: editLogin.displayName }) : null}
            </DialogTitle>
            <DialogDescription>{t("login.description")}</DialogDescription>
          </DialogHeader>
          {editLogin ? (
            <form
              className="flex flex-col gap-4"
              noValidate
              data-testid="edit-driver-form"
              onSubmit={(event) => {
                event.preventDefault();
                changeLocale(editLogin, editLocale);
              }}
            >
              <FormField label={t("form.locale")} htmlFor="edit-locale">
                <Select
                  value={editLocale}
                  onValueChange={(code) => {
                    if (isAppLocale(code)) setEditLocale(code);
                  }}
                >
                  <SelectTrigger
                    id="edit-locale"
                    aria-label={t("form.locale")}
                    className="mt-1 max-w-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((code) => (
                      <SelectItem key={code} value={code} lang={code}>
                        {LOCALE_LABELS[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setEditLogin(null)}>
                  {tc("actions.cancel")}
                </Button>
                <Button type="submit" disabled={pending} data-testid="edit-submit">
                  {tc("actions.save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm
                ? t(`confirm.${confirm.kind}Title`, { name: confirm.user.displayName })
                : null}
            </DialogTitle>
            <DialogDescription>
              {confirm ? t(`confirm.${confirm.kind}Body`) : null}
            </DialogDescription>
          </DialogHeader>
          {confirmError ? (
            <p
              role="alert"
              className="text-base font-medium text-destructive"
              data-testid="confirm-error"
            >
              {confirmError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              <CancelLabel />
            </Button>
            <Button
              variant={confirm?.kind === "reset" ? "default" : "destructive"}
              disabled={pending}
              data-testid="confirm-submit"
              onClick={onConfirm}
            >
              {confirm?.kind === "reset"
                ? t("actions.resetPin")
                : confirm?.kind === "delete"
                  ? t("actions.deleteConfirm")
                  : t("actions.deactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WorkScheduleDialog
        key={scheduleFor?.id ?? "none"}
        driverId={scheduleFor?.id ?? ""}
        driverName={scheduleFor?.displayName ?? ""}
        days={schedules[scheduleFor?.id ?? ""] ?? []}
        open={scheduleFor !== null}
        onOpenChange={(open) => {
          if (!open) setScheduleFor(null);
        }}
      />

      <Dialog open={pinSheet !== null} onOpenChange={(open) => !open && setPinSheet(null)}>
        <DialogContent className="pin-sheet" data-testid="pin-dialog">
          {pinSheet ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("pin.title", { name: pinSheet.name })}</DialogTitle>
                <DialogDescription>{t("pin.warning")}</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3">
                <div>
                  <dt className="text-sm text-muted-foreground">{t("pin.username")}</dt>
                  <dd className="text-xl font-semibold" data-testid="pin-username">
                    {pinSheet.username}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{t("pin.label")}</dt>
                  <dd
                    className="font-mono text-5xl font-bold tracking-[0.3em]"
                    data-testid="pin-value"
                  >
                    {pinSheet.pin}
                  </dd>
                </div>
              </dl>
              <DialogFooter className="print:hidden">
                <Button
                  variant="outline"
                  data-testid="pin-copy"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(pinSheet.pin)
                      .then(() => toast.success(t("pin.copied")))
                      .catch(() => toast.error(t("errors.generic")));
                  }}
                >
                  <CopyIcon aria-hidden />
                  {t("pin.copy")}
                </Button>
                <Button variant="outline" data-testid="pin-print" onClick={() => window.print()}>
                  <PrinterIcon aria-hidden />
                  {t("pin.print")}
                </Button>
                <Button data-testid="pin-done" onClick={() => setPinSheet(null)}>
                  {t("pin.done")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function CancelLabel() {
  const t = useTranslations("common.actions");
  return <>{t("cancel")}</>;
}
