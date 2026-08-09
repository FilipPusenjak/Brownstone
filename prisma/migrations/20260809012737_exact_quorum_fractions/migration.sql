/*
  Warnings:

  - You are about to drop the column `quorumBasisPoints` on the `Meeting` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Meeting" DROP COLUMN "quorumBasisPoints",
ADD COLUMN     "quorumDenominator" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "quorumNumerator" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "quorumStrict" BOOLEAN NOT NULL DEFAULT true;
