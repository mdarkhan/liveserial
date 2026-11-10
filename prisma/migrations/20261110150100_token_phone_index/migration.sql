-- Returning-patient lookup (console): latest serial for a phone within an organization
CREATE INDEX "Token_organizationId_patientPhone_createdAt_idx" ON "Token"("organizationId", "patientPhone", "createdAt");
