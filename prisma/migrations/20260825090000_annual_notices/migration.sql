-- CreateEnum
CREATE TYPE "NoticeDeliveryMethod" AS ENUM ('EMAIL', 'HAND', 'MAIL', 'POSTED');

-- AlterTable
ALTER TABLE "NoticeCampaign" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" UUID,
ADD COLUMN     "respondBy" DATE;

-- AlterTable
ALTER TABLE "NoticeDelivery" ADD COLUMN     "method" "NoticeDeliveryMethod",
ADD COLUMN     "obligationId" UUID,
ADD COLUMN     "recordedById" UUID,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "NoticeCampaign" ADD CONSTRAINT "NoticeCampaign_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDelivery" ADD CONSTRAINT "NoticeDelivery_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDelivery" ADD CONSTRAINT "NoticeDelivery_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

