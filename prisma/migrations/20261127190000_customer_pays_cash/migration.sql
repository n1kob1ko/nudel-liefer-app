-- Owner 2026-11-27: a customer who always pays cash at the stop. The day plan then creates his
-- orders as "Bar bei Lieferung" and asks for the amount of the day.
ALTER TABLE "Customer" ADD COLUMN "paysCash" BOOLEAN NOT NULL DEFAULT false;
