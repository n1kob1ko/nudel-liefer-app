-- NUD-212: day routes from standing tours. A tour remembers its standing tour, a standing tour its
-- vehicle, and an order of a customer outside the standing tours may carry the route and position
-- the office chose for it.
ALTER TABLE "Tour" ADD COLUMN "standingTourId" TEXT;
ALTER TABLE "StandingTour" ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "Order" ADD COLUMN "routeStandingTourId" TEXT;
ALTER TABLE "Order" ADD COLUMN "routeSlot" INTEGER;

ALTER TABLE "Order" ADD CONSTRAINT "Order_routeSlot_check" CHECK ("routeSlot" IS NULL OR "routeSlot" >= 0);

CREATE INDEX "Tour_date_standingTourId_idx" ON "Tour"("date", "standingTourId");

ALTER TABLE "Tour" ADD CONSTRAINT "Tour_standingTourId_fkey" FOREIGN KEY ("standingTourId") REFERENCES "StandingTour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StandingTour" ADD CONSTRAINT "StandingTour_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_routeStandingTourId_fkey" FOREIGN KEY ("routeStandingTourId") REFERENCES "StandingTour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
