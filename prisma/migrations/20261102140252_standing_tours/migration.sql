-- CreateTable
CREATE TABLE "StandingTour" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driverId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandingTour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandingTourCustomer" (
    "standingTourId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StandingTourCustomer_pkey" PRIMARY KEY ("standingTourId","customerId")
);

-- CreateIndex
CREATE INDEX "StandingTour_driverId_idx" ON "StandingTour"("driverId");

-- CreateIndex
CREATE INDEX "StandingTourCustomer_customerId_idx" ON "StandingTourCustomer"("customerId");

-- AddForeignKey
ALTER TABLE "StandingTour" ADD CONSTRAINT "StandingTour_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingTourCustomer" ADD CONSTRAINT "StandingTourCustomer_standingTourId_fkey" FOREIGN KEY ("standingTourId") REFERENCES "StandingTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingTourCustomer" ADD CONSTRAINT "StandingTourCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
