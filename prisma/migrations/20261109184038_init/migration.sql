-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'DOCTOR', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('NOT_STARTED', 'DOCTOR_ARRIVED', 'RUNNING', 'ON_BREAK', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CALLED', 'IN_CONSULT', 'DONE', 'SKIPPED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueAction" AS ENUM ('TOKEN_ADDED', 'TOKEN_EDITED', 'TOKEN_CANCELLED', 'CALL_NEXT', 'CALL_OUT_OF_ORDER', 'MARK_IN_CONSULT', 'MARK_DONE', 'SKIP', 'NO_SHOW', 'REQUEUE_AFTER_CURRENT', 'REQUEUE_AT_END', 'SESSION_STATUS_CHANGED', 'DELAY_SET', 'DELAY_BROADCAST');

-- CreateEnum
CREATE TYPE "OutOfOrderReason" AS ENUM ('EMERGENCY', 'LATE_ARRIVAL', 'REPORT_CHECK', 'ELDERLY_OR_DISABLED', 'OTHER');

-- CreateEnum
CREATE TYPE "SmsTemplate" AS ENUM ('TOKEN_CREATED', 'LEAVE_NOW', 'NEXT_UP', 'DELAY_BROADCAST');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberVerified" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role" NOT NULL,
    "organizationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chamber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "leaveNowThreshold" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Chamber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "chamberId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "chamberId" TEXT NOT NULL,
    "scheduleTemplateId" TEXT,
    "date" DATE NOT NULL,
    "scheduledStartAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "announcedDelayMinutes" INTEGER,
    "doctorArrivedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "nextSerial" INTEGER NOT NULL DEFAULT 1,
    "queueVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "queueOrder" INTEGER NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientPhone" TEXT,
    "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "publicCode" TEXT NOT NULL,
    "calledAt" TIMESTAMPTZ(3),
    "consultStartedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEvent" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenId" TEXT,
    "actorId" TEXT,
    "action" "QueueAction" NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "isOutOfOrder" BOOLEAN NOT NULL DEFAULT false,
    "reason" "OutOfOrderReason",
    "note" TEXT,
    "meta" JSONB,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "tokenId" TEXT,
    "toPhone" TEXT NOT NULL,
    "template" "SmsTemplate" NOT NULL,
    "body" TEXT NOT NULL,
    "segments" INTEGER NOT NULL,
    "isUnicode" BOOLEAN NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE INDEX "Doctor_organizationId_idx" ON "Doctor"("organizationId");

-- CreateIndex
CREATE INDEX "Chamber_organizationId_idx" ON "Chamber"("organizationId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_organizationId_idx" ON "ScheduleTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTemplate_doctorId_weekday_startTime_key" ON "ScheduleTemplate"("doctorId", "weekday", "startTime");

-- CreateIndex
CREATE INDEX "Session_organizationId_date_idx" ON "Session"("organizationId", "date");

-- CreateIndex
CREATE INDEX "Session_chamberId_date_idx" ON "Session"("chamberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Session_doctorId_scheduledStartAt_key" ON "Session"("doctorId", "scheduledStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "Token_publicCode_key" ON "Token"("publicCode");

-- CreateIndex
CREATE INDEX "Token_sessionId_status_queueOrder_idx" ON "Token"("sessionId", "status", "queueOrder");

-- CreateIndex
CREATE INDEX "Token_organizationId_idx" ON "Token"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_sessionId_serial_key" ON "Token"("sessionId", "serial");

-- CreateIndex
CREATE INDEX "QueueEvent_sessionId_id_idx" ON "QueueEvent"("sessionId", "id");

-- CreateIndex
CREATE INDEX "QueueEvent_organizationId_createdAt_idx" ON "QueueEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_organizationId_isOutOfOrder_createdAt_idx" ON "QueueEvent"("organizationId", "isOutOfOrder", "createdAt");

-- CreateIndex
CREATE INDEX "ClientRequest_createdAt_idx" ON "ClientRequest"("createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_organizationId_createdAt_idx" ON "SmsMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_status_createdAt_idx" ON "SmsMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_tokenId_idx" ON "SmsMessage"("tokenId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chamber" ADD CONSTRAINT "Chamber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_chamberId_fkey" FOREIGN KEY ("chamberId") REFERENCES "Chamber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_chamberId_fkey" FOREIGN KEY ("chamberId") REFERENCES "Chamber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_scheduleTemplateId_fkey" FOREIGN KEY ("scheduleTemplateId") REFERENCES "ScheduleTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Hand-written guards (not expressible in Prisma schema) ─────────────

-- 1. QueueEvent is an append-only audit log.
CREATE FUNCTION queue_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'QueueEvent is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QueueEvent_append_only"
  BEFORE UPDATE OR DELETE ON "QueueEvent"
  FOR EACH ROW EXECUTE FUNCTION queue_event_append_only();

CREATE TRIGGER "QueueEvent_no_truncate"
  BEFORE TRUNCATE ON "QueueEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION queue_event_append_only();

-- 2. At most one "now serving" token per session.
CREATE UNIQUE INDEX "Token_one_active_per_session"
  ON "Token" ("sessionId")
  WHERE status IN ('CALLED', 'IN_CONSULT');

-- 3. Each automatic SMS trigger at most once per token.
CREATE UNIQUE INDEX "SmsMessage_one_auto_trigger_per_token"
  ON "SmsMessage" ("tokenId", "template")
  WHERE template <> 'DELAY_BROADCAST' AND "tokenId" IS NOT NULL;

-- 4. Sanity checks.
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_weekday_check" CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_startTime_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "Chamber" ADD CONSTRAINT "Chamber_leaveNowThreshold_check" CHECK ("leaveNowThreshold" BETWEEN 1 AND 50);
ALTER TABLE "Token" ADD CONSTRAINT "Token_serial_check" CHECK (serial > 0);
