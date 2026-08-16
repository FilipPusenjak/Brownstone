-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('PROPOSED', 'APPROVED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "buildingWorkId" UUID;

-- CreateTable
CREATE TABLE "BuildingWork" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buildingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" "WorkStatus" NOT NULL DEFAULT 'PROPOSED',
    "estimateCents" INTEGER,
    "obligationId" UUID,
    "assessmentRaisedAt" TIMESTAMP(3),
    "assessmentRaisedById" UUID,
    "assessmentTotalCents" INTEGER,
    "assessmentDueOn" DATE,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildingWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildingWork_buildingId_idx" ON "BuildingWork"("buildingId");

-- CreateIndex
CREATE INDEX "BuildingWork_buildingId_status_idx" ON "BuildingWork"("buildingId", "status");

-- CreateIndex
CREATE INDEX "BuildingWork_buildingId_obligationId_idx" ON "BuildingWork"("buildingId", "obligationId");

-- AddForeignKey
ALTER TABLE "BuildingWork" ADD CONSTRAINT "BuildingWork_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingWork" ADD CONSTRAINT "BuildingWork_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingWork" ADD CONSTRAINT "BuildingWork_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingWork" ADD CONSTRAINT "BuildingWork_assessmentRaisedById_fkey" FOREIGN KEY ("assessmentRaisedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_buildingWorkId_fkey" FOREIGN KEY ("buildingWorkId") REFERENCES "BuildingWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
