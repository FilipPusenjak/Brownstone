
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" UUID,
ADD COLUMN     "depositCents" INTEGER,
ADD COLUMN     "depositNote" TEXT,
ADD COLUMN     "depositReceivedOn" DATE,
ADD COLUMN     "depositReference" TEXT,
ADD COLUMN     "depositReturnedOn" DATE,
ADD COLUMN     "depositWithheldCents" INTEGER;

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "closesMinute" INTEGER NOT NULL DEFAULT 1200,
ADD COLUMN     "opensMinute" INTEGER NOT NULL DEFAULT 480;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Nothing can be booked twice.
--
-- The application checks for a clash before it inserts, which produces a
-- readable refusal. It cannot be the only check: two people pressing the same
-- slot at the same moment both read an empty calendar and both insert, and the
-- freight elevator is double-booked by a race nobody can reproduce.
--
-- So the rule lives in the database, as an exclusion constraint over the time
-- range, scoped to one resource, and only among bookings that still hold the
-- slot — a cancelled booking must not block the slot it gave up. `btree_gist`
-- is what lets a uuid equality sit in the same index as a range overlap.
--
-- The range is half-open: a booking ending at noon and one starting at noon do
-- not collide, which is the normal case for a long move split across slots.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status IN ('HELD', 'CONFIRMED'));
