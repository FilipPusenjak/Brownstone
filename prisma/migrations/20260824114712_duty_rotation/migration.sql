
-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "dsnyFineId" UUID;

-- AlterTable
ALTER TABLE "DsnyFine" ADD COLUMN     "dutyAssignmentId" UUID,
ADD COLUMN     "hearingOn" DATE,
ADD COLUMN     "obligationId" UUID,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "recordedById" UUID;

-- AlterTable
ALTER TABLE "DutyAssignment" ADD COLUMN     "originalUnitId" UUID,
ADD COLUMN     "swappedAt" TIMESTAMP(3),
ADD COLUMN     "swappedById" UUID,
ADD COLUMN     "swappedWithId" UUID;

-- CreateIndex
CREATE INDEX "DsnyFine_buildingId_issuedOn_idx" ON "DsnyFine"("buildingId", "issuedOn");

-- CreateIndex
CREATE UNIQUE INDEX "DutyAssignment_swappedWithId_key" ON "DutyAssignment"("swappedWithId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_dsnyFineId_fkey" FOREIGN KEY ("dsnyFineId") REFERENCES "DsnyFine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_swappedById_fkey" FOREIGN KEY ("swappedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_swappedWithId_fkey" FOREIGN KEY ("swappedWithId") REFERENCES "DutyAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsnyFine" ADD CONSTRAINT "DsnyFine_dutyAssignmentId_fkey" FOREIGN KEY ("dutyAssignmentId") REFERENCES "DutyAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsnyFine" ADD CONSTRAINT "DsnyFine_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

