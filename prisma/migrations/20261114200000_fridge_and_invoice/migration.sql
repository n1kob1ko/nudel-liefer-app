-- Owner 2026-11-14: the driver sees a fridge symbol (customer setting) and an invoice symbol
-- (set per delivery day in the day plan).
ALTER TABLE "Customer" ADD COLUMN "intoFridge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "handInvoice" BOOLEAN NOT NULL DEFAULT false;
