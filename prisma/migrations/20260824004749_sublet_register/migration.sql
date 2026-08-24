-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "subletId" UUID;

-- AlterTable
ALTER TABLE "SubletRegistration" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "endedById" UUID,
ADD COLUMN     "endedOn" DATE,
ADD COLUMN     "endedReason" TEXT,
ADD COLUMN     "renewedFromId" UUID,
ADD COLUMN     "subtenantContact" TEXT;

-- CreateIndex
CREATE INDEX "SubletRegistration_buildingId_unitId_idx" ON "SubletRegistration"("buildingId", "unitId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_subletId_fkey" FOREIGN KEY ("subletId") REFERENCES "SubletRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubletRegistration" ADD CONSTRAINT "SubletRegistration_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubletRegistration" ADD CONSTRAINT "SubletRegistration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubletRegistration" ADD CONSTRAINT "SubletRegistration_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "SubletRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
