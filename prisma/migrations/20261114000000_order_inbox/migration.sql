-- NUD-210: the order inbox. Many photos are uploaded at once; each one is a `Screenshot` row that is
-- read in the background and waits for the office. A row without `inboxStatus` is a photo that was
-- attached in the order form, as before.
CREATE TYPE "ScreenshotInboxStatus" AS ENUM ('NEW', 'READING', 'READY', 'FAILED', 'DONE', 'DISCARDED');

ALTER TABLE "Screenshot"
  ADD COLUMN "inboxStatus" "ScreenshotInboxStatus",
  ADD COLUMN "readStartedAt" TIMESTAMP(3),
  ADD COLUMN "readError" TEXT,
  ADD COLUMN "customerHint" TEXT,
  ADD COLUMN "suggestedCustomerId" TEXT,
  ADD COLUMN "discardedAt" TIMESTAMP(3);

ALTER TABLE "Screenshot"
  ADD CONSTRAINT "Screenshot_suggestedCustomerId_fkey"
  FOREIGN KEY ("suggestedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Screenshot_inboxStatus_createdAt_idx" ON "Screenshot"("inboxStatus", "createdAt");
