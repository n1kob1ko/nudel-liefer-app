-- Invoice and fridge marks (owner 2026-11-14): the day plan sets them for one day (Order), the
-- customer form sets them for good (Customer).
ALTER TABLE "Customer" ADD COLUMN "alwaysInvoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "intoFridge" BOOLEAN NOT NULL DEFAULT false;
