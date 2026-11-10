-- AlterEnum
ALTER TYPE "SmsStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "lastAttemptAt" TIMESTAMPTZ(3);
