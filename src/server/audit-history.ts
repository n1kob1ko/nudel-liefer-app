import { z } from "zod";

import { type AuditAction, isAuditAction } from "@/domain/audit";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Read side of the audit log (NUD-092): turns stored entries (ids and values) into the compact
 * history timeline of the order and tour pages. Names are resolved here, at read time, so the log
 * itself never holds a copy of a customer / product / driver name. Callers are the admin-only
 * queries in `audit-queries.ts`; nothing here writes.
 */

export type AuditProductLine = {
  kind: "line";
  productId: string;
  sku: string;
  /** `LocalizedText` JSON; the component picks the locale. */
  productName: unknown;
  unit: string;
  /** Hundredths; `null` = not on the order / stop (added or removed line). */
  before: number | null;
  after: number | null;
};

export type AuditFieldType =
  "orderStatus" | "date" | "text" | "bool" | "person" | "stopStatus" | "tourStatus";

export type AuditDetail =
  | AuditProductLine
  | {
      kind: "field";
      field:
        | "status"
        | "deliveryDate"
        | "window"
        | "internalNote"
        | "locked"
        | "driver"
        | "vehicle"
        | "tourStatus";
      type: AuditFieldType;
      before: string | null;
      after: string | null;
    }
  | { kind: "customer"; name: string; number: string }
  | { kind: "fact"; key: string; value: string | number }
  | { kind: "sequence"; names: string[] }
  | {
      kind: "stopGroup";
      change: "added" | "removed" | "changed" | "completed_changed";
      name: string;
      number: string;
      lines: AuditProductLine[];
    }
  | { kind: "reason"; reason: string }
  | { kind: "note"; text: string }
  | { kind: "photo"; photoKind: string; via: "admin" | "driver" }
  | { kind: "tapped"; at: string }
  /** Money in euro cents (D33): the cash collected at a stop, with what was due. */
  | {
      kind: "money";
      field: "collectedCents";
      before: number | null;
      after: number | null;
      dueCents: number | null;
    };

export type AuditEntryView = {
  id: string;
  /** ISO instant the entry was written (server clock). */
  at: string;
  action: AuditAction;
  /** Who did it; `via` tells whether a driver or the office acted. */
  actor: { name: string; role: "ADMIN" | "DRIVER" } | null;
  details: AuditDetail[];
};

export const HISTORY_LIMIT = 200;

type Row = {
  id: string;
  action: string;
  diff: unknown;
  createdAt: Date;
  actorId: string;
};

const lineSchema = z.object({
  productId: z.string(),
  before: z.number().nullable(),
  after: z.number().nullable(),
});
const changeSchema = z.object({ from: z.string().nullable(), to: z.string().nullable() });
const str = z.string().nullable().optional();

const orderCreate = z.object({
  customerId: z.string(),
  status: z.string(),
  deliveryDate: z.string(),
  window: z.string().optional(),
  source: z.string().optional(),
  internalNote: str,
  lines: z.array(lineSchema).default([]),
});
const orderUpdate = z.object({
  status: changeSchema.optional(),
  deliveryDate: changeSchema.optional(),
  window: changeSchema.optional(),
  internalNote: changeSchema.optional(),
  lines: z.array(lineSchema).optional(),
});
const orderDuplicate = orderCreate.extend({ sourceOrderId: z.string().optional() });
const tourBuild = z.object({
  mode: z.string().optional(),
  stopCountBefore: z.number().nullable().optional(),
  stopCount: z.number(),
  addedCustomerIds: z.array(z.string()).default([]),
  removedCustomerIds: z.array(z.string()).default([]),
});
const tourReorder = z.object({ customerIdsAfter: z.array(z.string()) });
const tourLock = z.object({ locked: z.object({ from: z.boolean(), to: z.boolean() }) });
const tourMove = z.object({ customerId: z.string() });
const tourAssign = z.object({ driverId: changeSchema });
const tourAssignVehicle = z.object({ vehicleId: changeSchema });
const tourRelease = z.object({
  stopCount: z.number(),
  driverId: z.string().nullable(),
  vehicleId: z.string().nullable().optional(),
  overloadOverride: z.boolean().optional(),
  loadKg: z.number().optional(),
  capacityKg: z.number().optional(),
});
const tourRerelease = z.object({
  changed: z.boolean(),
  revision: z.number(),
  stops: z
    .array(
      z.object({
        kind: z.enum(["added", "removed", "changed", "completed_changed"]),
        customerId: z.string(),
        items: z.array(lineSchema),
      }),
    )
    .default([]),
});
const stopEntry = z.object({
  customerId: z.string(),
  status: changeSchema.optional(),
  reason: str,
  // Entries before NUD-121 hold the (cut) driver text here; newer ones only `hasNote`.
  note: str,
  hasNote: z.boolean().optional(),
  previousReason: str,
  tourStatus: changeSchema.optional(),
  clientCreatedAt: z.string().optional(),
});
const photoEntry = z.object({
  kind: z.string(),
  via: z.enum(["admin", "driver"]),
  tourId: z.string().optional(),
});

/** Cash collected at a stop (D33): the amount before and after, and what was due. */
const paymentEntry = z.object({
  customerId: z.string(),
  from: z.number().nullable(),
  to: z.number().nullable(),
  dueCents: z.number().nullable().optional(),
  clientCreatedAt: z.string().optional(),
});

/** Ids an entry refers to, so names can be loaded with a handful of queries. */
function collectIds(rows: Row[]) {
  const products = new Set<string>();
  const customers = new Set<string>();
  const users = new Set<string>(rows.map((r) => r.actorId));
  const vehicles = new Set<string>();
  const walk = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, key));
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
      return;
    }
    if (typeof value !== "string") return;
    if (key === "productId") products.add(value);
    else if (key === "customerId" || key === "customerIdsAfter") customers.add(value);
    else if (key === "driverId") users.add(value);
    else if (key === "vehicleId") vehicles.add(value);
  };
  for (const row of rows) {
    walk(row.diff);
    if (row.action === "tour.assign_driver") {
      const d = tourAssign.safeParse(row.diff);
      if (d.success) {
        for (const id of [d.data.driverId.from, d.data.driverId.to]) if (id) users.add(id);
      }
    }
    if (row.action === "tour.assign_vehicle") {
      const d = tourAssignVehicle.safeParse(row.diff);
      if (d.success) {
        for (const id of [d.data.vehicleId.from, d.data.vehicleId.to]) if (id) vehicles.add(id);
      }
    }
  }
  return { products, customers, users, vehicles };
}

type DbForHistory = Pick<PrismaClient, "auditLog" | "product" | "customer" | "user" | "vehicle">;

async function toViews(db: DbForHistory, rows: Row[]): Promise<AuditEntryView[]> {
  const ids = collectIds(rows);
  const [products, customers, users, vehicleRows] = await Promise.all([
    db.product.findMany({
      where: { id: { in: [...ids.products] } },
      select: { id: true, sku: true, name: true, unit: true },
    }),
    db.customer.findMany({
      where: { id: { in: [...ids.customers] } },
      select: { id: true, name: true, customerNumber: true },
    }),
    db.user.findMany({
      where: { id: { in: [...ids.users] } },
      select: { id: true, displayName: true, role: true },
    }),
    db.vehicle.findMany({
      where: { id: { in: [...ids.vehicles] } },
      select: { id: true, name: true },
    }),
  ]);
  const vehicleById = new Map(vehicleRows.map((v) => [v.id, v.name]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const userById = new Map(users.map((u) => [u.id, u.displayName]));
  const actorById = new Map(users.map((u) => [u.id, { name: u.displayName, role: u.role }]));

  const line = (l: z.infer<typeof lineSchema>): AuditProductLine => {
    const p = productById.get(l.productId);
    return {
      kind: "line",
      productId: l.productId,
      sku: p?.sku ?? "",
      productName: p?.name ?? null,
      unit: p?.unit ?? "PACK",
      before: l.before,
      after: l.after,
    };
  };
  const customerDetail = (id: string): AuditDetail => {
    const c = customerById.get(id);
    return { kind: "customer", name: c?.name ?? "", number: c?.customerNumber ?? "" };
  };
  const person = (id: string | null): string | null => (id ? (userById.get(id) ?? "") : null);
  const vehicleName = (id: string | null): string | null =>
    id ? (vehicleById.get(id) ?? "") : null;

  const details = (row: Row, action: AuditAction): AuditDetail[] => {
    switch (action) {
      case "order.create":
      case "order.duplicate": {
        const d = (action === "order.create" ? orderCreate : orderDuplicate).safeParse(row.diff);
        if (!d.success) return [];
        const out: AuditDetail[] = [
          customerDetail(d.data.customerId),
          {
            kind: "field",
            field: "status",
            type: "orderStatus",
            before: null,
            after: d.data.status,
          },
          {
            kind: "field",
            field: "deliveryDate",
            type: "date",
            before: null,
            after: d.data.deliveryDate,
          },
        ];
        if (d.data.window) {
          out.push({
            kind: "field",
            field: "window",
            type: "text",
            before: null,
            after: d.data.window,
          });
        }
        if (d.data.internalNote) {
          out.push({
            kind: "field",
            field: "internalNote",
            type: "text",
            before: null,
            after: d.data.internalNote,
          });
        }
        return [...out, ...d.data.lines.map(line)];
      }
      case "order.update": {
        const d = orderUpdate.safeParse(row.diff);
        if (!d.success) return [];
        const out: AuditDetail[] = [];
        if (d.data.status)
          out.push({
            kind: "field",
            field: "status",
            type: "orderStatus",
            before: d.data.status.from,
            after: d.data.status.to,
          });
        if (d.data.deliveryDate)
          out.push({
            kind: "field",
            field: "deliveryDate",
            type: "date",
            before: d.data.deliveryDate.from,
            after: d.data.deliveryDate.to,
          });
        if (d.data.window)
          out.push({
            kind: "field",
            field: "window",
            type: "text",
            before: d.data.window.from,
            after: d.data.window.to,
          });
        if (d.data.internalNote)
          out.push({
            kind: "field",
            field: "internalNote",
            type: "text",
            before: d.data.internalNote.from,
            after: d.data.internalNote.to,
          });
        return [...out, ...(d.data.lines ?? []).map(line)];
      }
      case "order.cancel": {
        const d = z.object({ status: changeSchema }).safeParse(row.diff);
        return d.success
          ? [
              {
                kind: "field",
                field: "status",
                type: "orderStatus",
                before: d.data.status.from,
                after: d.data.status.to,
              },
            ]
          : [];
      }
      case "tour.generate":
      case "tour.plan_day":
      case "tour.followup":
      case "tour.reoptimize": {
        const d = tourBuild.safeParse(row.diff);
        if (!d.success) return [];
        const out: AuditDetail[] = [{ kind: "fact", key: "stopCount", value: d.data.stopCount }];
        if (d.data.stopCountBefore != null) {
          out.push({ kind: "fact", key: "stopCountBefore", value: d.data.stopCountBefore });
        }
        if (d.data.addedCustomerIds.length > 0) {
          out.push({ kind: "fact", key: "addedCount", value: d.data.addedCustomerIds.length });
        }
        if (d.data.removedCustomerIds.length > 0) {
          out.push({ kind: "fact", key: "removedCount", value: d.data.removedCustomerIds.length });
        }
        return out;
      }
      case "tour.reorder": {
        const d = tourReorder.safeParse(row.diff);
        return d.success
          ? [
              {
                kind: "sequence",
                names: d.data.customerIdsAfter.map((id) => customerById.get(id)?.name ?? ""),
              },
            ]
          : [];
      }
      case "tour.lock":
      case "tour.unlock": {
        const d = tourLock.safeParse(row.diff);
        return d.success
          ? [
              {
                kind: "field",
                field: "locked",
                type: "bool",
                before: String(d.data.locked.from),
                after: String(d.data.locked.to),
              },
            ]
          : [];
      }
      case "tour.assign_driver": {
        const d = tourAssign.safeParse(row.diff);
        return d.success
          ? [
              {
                kind: "field",
                field: "driver",
                type: "person",
                before: person(d.data.driverId.from),
                after: person(d.data.driverId.to),
              },
            ]
          : [];
      }
      case "tour.assign_vehicle": {
        const d = tourAssignVehicle.safeParse(row.diff);
        return d.success
          ? [
              {
                kind: "field",
                field: "vehicle",
                type: "text",
                before: vehicleName(d.data.vehicleId.from),
                after: vehicleName(d.data.vehicleId.to),
              },
            ]
          : [];
      }
      case "tour.move_stop": {
        const d = tourMove.safeParse(row.diff);
        return d.success ? [customerDetail(d.data.customerId)] : [];
      }
      case "tour.create_empty":
      // Departure checklist (NUD-151): the entry itself (who, when) is the information.
      case "tour.loading_started":
      case "tour.departed":
        return [];
      case "tour.release": {
        const d = tourRelease.safeParse(row.diff);
        if (!d.success) return [];
        const out: AuditDetail[] = [
          { kind: "fact", key: "stopCount", value: d.data.stopCount },
          {
            kind: "field",
            field: "driver",
            type: "person",
            before: null,
            after: person(d.data.driverId),
          },
        ];
        if (d.data.vehicleId) {
          out.push({
            kind: "field",
            field: "vehicle",
            type: "text",
            before: null,
            after: vehicleName(d.data.vehicleId),
          });
        }
        if (d.data.overloadOverride) {
          out.push({
            kind: "fact",
            key: "overloadOverride",
            value: `${d.data.loadKg ?? 0} / ${d.data.capacityKg ?? 0}`,
          });
        }
        return out;
      }
      case "tour.rerelease": {
        const d = tourRerelease.safeParse(row.diff);
        if (!d.success) return [];
        return [
          { kind: "fact", key: "revision", value: d.data.revision },
          ...d.data.stops.map((s): AuditDetail => {
            const c = customerById.get(s.customerId);
            return {
              kind: "stopGroup",
              change: s.kind,
              name: c?.name ?? "",
              number: c?.customerNumber ?? "",
              lines: s.items.map(line),
            };
          }),
        ];
      }
      case "stop.delivered":
      case "stop.problem":
      case "stop.undo": {
        const d = stopEntry.safeParse(row.diff);
        if (!d.success) return [];
        const out: AuditDetail[] = [customerDetail(d.data.customerId)];
        const reason = d.data.reason ?? d.data.previousReason;
        if (reason) out.push({ kind: "reason", reason });
        if (d.data.note) out.push({ kind: "note", text: d.data.note });
        if (d.data.tourStatus)
          out.push({
            kind: "field",
            field: "tourStatus",
            type: "tourStatus",
            before: d.data.tourStatus.from,
            after: d.data.tourStatus.to,
          });
        if (d.data.clientCreatedAt) out.push({ kind: "tapped", at: d.data.clientCreatedAt });
        return out;
      }
      case "stop.payment": {
        const d = paymentEntry.safeParse(row.diff);
        if (!d.success) return [];
        return [
          customerDetail(d.data.customerId),
          {
            kind: "money",
            field: "collectedCents",
            before: d.data.from,
            after: d.data.to,
            dueCents: d.data.dueCents ?? null,
          },
        ];
      }
      case "photo.add":
      case "photo.replace": {        const d = photoEntry.safeParse(row.diff);
        return d.success ? [{ kind: "photo", photoKind: d.data.kind, via: d.data.via }] : [];
      }
      // Parking spot entries belong to the customer; no order or tour history shows them.
      case "parking.create":
      case "parking.update":
      case "parking.reorder":
      case "parking.deactivate":
      // Key entries (NUD-142) are shown in the customer's own key history, not here.
      case "customer.key":
      case "customer.abbreviation":
      case "customer.deactivate":
      case "customer.activate":
      // Recurring rules (NUD-149) are listed on the customer page, not in an order or tour timeline.
      case "recurring.create":
      case "recurring.update":
      case "recurring.pause":
      case "recurring.resume":
      // Vehicle master data has no order / tour page; its entries are not shown in a timeline.
      case "vehicle.create":
      case "vehicle.update":
      case "vehicle.activate":
      case "vehicle.deactivate":
      // Driver working time (NUD-152) is edited on the driver page, not in an order / tour timeline.
      case "driver.schedule_update":
      // Standing tours (NUD-186) are edited on the day plan; their entries belong to no order or tour.
      case "standing_tour.create":
      case "standing_tour.update":
      case "standing_tour.driver":
      case "standing_tour.activate":
      case "standing_tour.deactivate":
      // Monthly bills (NUD-196) have their own page; no order or tour timeline shows them.
      case "monthly.pay":
      case "monthly.unpay":
        return [];
    }
  };

  return rows.flatMap((row) =>
    isAuditAction(row.action)
      ? [
          {
            id: row.id,
            at: row.createdAt.toISOString(),
            action: row.action,
            actor: actorById.get(row.actorId) ?? null,
            details: details(row, row.action),
          } satisfies AuditEntryView,
        ]
      : [],
  );
}

/** History of one order, newest first. */
export async function getOrderHistory(
  db: DbForHistory,
  orderId: string,
): Promise<AuditEntryView[]> {
  const rows = await db.auditLog.findMany({
    where: { entity: "Order", entityId: orderId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
  });
  return toViews(db, rows);
}

/**
 * History of one tour, newest first: the tour's own entries plus everything that names the tour
 * in its diff (stop status changes of its stops and photos a driver took at them).
 */
export async function getTourHistory(db: DbForHistory, tourId: string): Promise<AuditEntryView[]> {
  const rows = await db.auditLog.findMany({
    where: {
      OR: [{ entity: "Tour", entityId: tourId }, { diff: { path: ["tourId"], equals: tourId } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
  });
  return toViews(db, rows);
}
