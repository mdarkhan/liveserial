-- Optional features (super admin switches them on per organization, with per-doctor overrides)
ALTER TABLE "Organization" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Doctor" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';

-- Console "undo" is logged as its own queue event
ALTER TYPE "QueueAction" ADD VALUE 'UNDO';
