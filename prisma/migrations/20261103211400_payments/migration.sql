-- CreateEnum
CREATE TYPE "PaymentTerm" AS ENUM ('MONTHLY', 'ON_DELIVERY');

-- AlterEnum
ALTER TYPE "StopMutationKind" ADD VALUE 'PAYMENT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "amountCents" INTEGER,
ADD COLUMN     "paymentTerm" "PaymentTerm" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "Stop" ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "collectedById" TEXT,
ADD COLUMN     "collectedCents" INTEGER;

-- CreateTable
CREATE TABLE "MonthlyPayment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "MonthlyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyPayment_periodStart_idx" ON "MonthlyPayment"("periodStart");

-- CreateIndex
CREATE INDEX "MonthlyPayment_customerId_periodStart_idx" ON "MonthlyPayment"("customerId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPayment_customerId_periodStart_key" ON "MonthlyPayment"("customerId", "periodStart");

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
