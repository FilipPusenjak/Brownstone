-- AlterTable
ALTER TABLE "BuildingWork" ADD COLUMN     "decisionAbstain" INTEGER,
ADD COLUMN     "decisionAgainst" INTEGER,
ADD COLUMN     "decisionAt" TIMESTAMP(3),
ADD COLUMN     "decisionFor" INTEGER,
ADD COLUMN     "decisionMeetingId" UUID,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "decisionRecordedById" UUID;

-- AddForeignKey
ALTER TABLE "BuildingWork" ADD CONSTRAINT "BuildingWork_decisionMeetingId_fkey" FOREIGN KEY ("decisionMeetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingWork" ADD CONSTRAINT "BuildingWork_decisionRecordedById_fkey" FOREIGN KEY ("decisionRecordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
