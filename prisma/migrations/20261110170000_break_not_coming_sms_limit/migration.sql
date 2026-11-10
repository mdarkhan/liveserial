-- Timed doctor break
CREATE TYPE "BreakKind" AS ENUM ('PRAYER', 'BREAK');
ALTER TABLE "Session" ADD COLUMN "breakKind" "BreakKind",
ADD COLUMN "breakEndsAt" TIMESTAMPTZ(3);

-- "I'm not coming" from the patient link
ALTER TABLE "Token" ADD COLUMN "cancelledByPatientAt" TIMESTAMPTZ(3);
ALTER TYPE "QueueAction" ADD VALUE 'PATIENT_NOT_COMING';

-- Monthly SMS allowance per organization (warning only)
ALTER TABLE "Organization" ADD COLUMN "smsMonthlyLimit" INTEGER;
