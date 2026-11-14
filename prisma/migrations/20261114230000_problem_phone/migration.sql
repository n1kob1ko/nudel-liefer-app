-- "Problem" in the driver app shows this number to call (owner 2026-11-14). Dummy until the office sets it.
ALTER TABLE "Settings" ADD COLUMN "problemPhone" TEXT NOT NULL DEFAULT '+43 1 000 00 00';
