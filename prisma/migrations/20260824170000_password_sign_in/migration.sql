-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordSetAt" TIMESTAMP(3),
ADD COLUMN     "signInBlockedTill" TIMESTAMP(3),
ADD COLUMN     "signInFailures" INTEGER NOT NULL DEFAULT 0;

