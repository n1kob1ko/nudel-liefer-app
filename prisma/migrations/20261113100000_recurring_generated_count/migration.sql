-- NUD-201: orders are deleted 30 days after they were paid. `RecurringOrder.maxDeliveries` was
-- checked against the number of orders that exist, so deleting orders would have given a used-up
-- standing order its budget back. The rule now counts what it created itself.
ALTER TABLE "RecurringOrder" ADD COLUMN "generatedCount" INTEGER NOT NULL DEFAULT 0;

-- Rules that already delivered start with the orders they have today (nothing was deleted yet).
UPDATE "RecurringOrder" r
SET "generatedCount" = (SELECT count(*) FROM "Order" o WHERE o."recurringOrderId" = r."id");

ALTER TABLE "RecurringOrder"
  ADD CONSTRAINT "RecurringOrder_generated_count_check" CHECK ("generatedCount" >= 0);
