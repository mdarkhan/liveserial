import { prisma } from "./db";
import { normalizeBdPhone } from "./format";
import { ensureSweeper } from "./sms";
import { createUserWithPassword } from "./users";

/**
 * Runs once when the server starts (src/instrumentation.ts):
 *  1. On a fresh production database, creates the first super admin from
 *     SEED_SUPERADMIN_PHONE / SEED_SUPERADMIN_PASSWORD — only if no super
 *     admin exists yet, so changing or removing the variables later is harmless.
 *  2. Starts the SMS sweeper, so messages queued before a restart are sent
 *     without waiting for the next queue action.
 */
export async function bootstrap() {
  try {
    const phone = normalizeBdPhone(process.env.SEED_SUPERADMIN_PHONE ?? "");
    const password = process.env.SEED_SUPERADMIN_PASSWORD ?? "";
    if (phone && password.length >= 8 && !(await prisma.user.count({ where: { role: "SUPER_ADMIN" } }))) {
      await createUserWithPassword({
        name: "সুপার অ্যাডমিন",
        phone,
        role: "SUPER_ADMIN",
        organizationId: null,
        password,
      });
      console.log(`[bootstrap] Created super admin ${phone}`);
    }
  } catch (e) {
    // Don't stop the server (e.g. the database is still starting); the next start tries again.
    console.error("[bootstrap] Super admin check failed:", e);
  }
  ensureSweeper();
}
