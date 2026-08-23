-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "ticketId" UUID;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assigneeId" UUID,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedById" UUID,
ADD COLUMN     "triagedAt" TIMESTAMP(3),
ADD COLUMN     "triagedById" UUID,
ADD COLUMN     "vendorName" TEXT,
ADD COLUMN     "vendorPhone" TEXT;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
