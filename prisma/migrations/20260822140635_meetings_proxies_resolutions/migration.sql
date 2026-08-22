-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "ResolutionBasis" AS ENUM ('VOTED', 'PRESENT', 'OUTSTANDING');

-- DropIndex
DROP INDEX "Proxy_meetingId_unitId_key";

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "agenda" TEXT,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "minutes" TEXT,
ADD COLUMN     "minutesAdoptedAt" TIMESTAMP(3),
ADD COLUMN     "minutesAdoptedById" UUID;

-- AlterTable
ALTER TABLE "MeetingAttendance" ADD COLUMN     "recordedById" UUID,
ADD COLUMN     "representedBy" TEXT;

-- AlterTable
ALTER TABLE "Proxy" ADD COLUMN     "grantedById" UUID,
ADD COLUMN     "revokedById" UUID;

-- AlterTable
ALTER TABLE "Resolution" ADD COLUMN     "basis" "ResolutionBasis" NOT NULL DEFAULT 'VOTED',
ADD COLUMN     "recordedAt" TIMESTAMP(3),
ADD COLUMN     "recordedById" UUID,
ADD COLUMN     "thresholdDenominator" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "thresholdNumerator" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "thresholdStrict" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ResolutionVote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "resolutionId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "shares" INTEGER NOT NULL,
    "byProxy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolutionVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResolutionVote_buildingId_idx" ON "ResolutionVote"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionVote_resolutionId_unitId_key" ON "ResolutionVote"("resolutionId", "unitId");

-- CreateIndex
CREATE INDEX "Proxy_meetingId_unitId_idx" ON "Proxy"("meetingId", "unitId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_minutesAdoptedById_fkey" FOREIGN KEY ("minutesAdoptedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionVote" ADD CONSTRAINT "ResolutionVote_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionVote" ADD CONSTRAINT "ResolutionVote_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "Resolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionVote" ADD CONSTRAINT "ResolutionVote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
