-- CreateTable
CREATE TABLE "MonthlyAdjustment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "MonthlyAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyAdjustment_customerId_periodStart_idx" ON "MonthlyAdjustment"("customerId", "periodStart");

-- CreateIndex
CREATE INDEX "MonthlyAdjustment_periodStart_idx" ON "MonthlyAdjustment"("periodStart");

-- AddForeignKey
ALTER TABLE "MonthlyAdjustment" ADD CONSTRAINT "MonthlyAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyAdjustment" ADD CONSTRAINT "MonthlyAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A correction of 0,00 says nothing and would only clutter the bill. The form refuses it; this
-- keeps it out of the table for every other way in.
ALTER TABLE "MonthlyAdjustment" ADD CONSTRAINT "MonthlyAdjustment_amountCents_nonzero" CHECK ("amountCents" <> 0);
