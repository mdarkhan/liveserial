import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { E2E_DATABASE_URL } from "../../playwright.config";

/**
 * Prepares the test DB (migrations, non-destructive) and creates a fresh clinic
 * for this run: an admin, an assistant, a doctor, a chamber and today's session
 * with 8 patients. Details are passed to the tests through process.env.
 */
export default async function globalSetup() {
  process.env.DATABASE_URL = E2E_DATABASE_URL;
  process.env.APP_BASE_URL ??= "http://localhost:3100";
  execSync("npx prisma migrate deploy", { env: { ...process.env }, stdio: "pipe" });

  // Imported after DATABASE_URL is set (db.ts reads it at import time).
  const { prisma } = await import("../../src/lib/db");
  const { createUserWithPassword } = await import("../../src/lib/users");
  const { addTokens } = await import("../../src/lib/queue-service");
  const { bn, dateOnly, dhakaDateString, dhakaWallTimeToUtc } = await import("../../src/lib/format");

  const tag = randomUUID().slice(0, 8);
  const phone = () => `88019${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const password = "e2e-pass-1234";

  const org = await prisma.organization.create({ data: { name: `E2E ক্লিনিক ${tag}`, slug: `e2e-${tag}` } });
  const adminPhone = phone();
  const assistantPhone = phone();
  await createUserWithPassword({ name: "E2E অ্যাডমিন", phone: adminPhone, role: "ORG_ADMIN", organizationId: org.id, password });
  const assistant = await createUserWithPassword({
    name: "E2E সহকারী",
    phone: assistantPhone,
    role: "ASSISTANT",
    organizationId: org.id,
    password,
  });
  const doctor = await prisma.doctor.create({ data: { organizationId: org.id, name: "ডা. ই২ই পরীক্ষক" } });
  const chamber = await prisma.chamber.create({ data: { organizationId: org.id, name: "পরীক্ষা চেম্বার", leaveNowThreshold: 2 } });
  const today = dhakaDateString();
  const session = await prisma.session.create({
    data: {
      organizationId: org.id,
      doctorId: doctor.id,
      chamberId: chamber.id,
      date: dateOnly(today),
      scheduledStartAt: dhakaWallTimeToUtc(today, "17:00"),
    },
  });
  const tokens = await addTokens(
    { orgId: org.id, userId: assistant.id, sessionId: session.id, clientRequestId: randomUUID() },
    Array.from({ length: 8 }, (_, i) => ({ name: `রোগী ${bn(i + 1)}`, phone: i >= 6 ? `8801755${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}` : null })),
  );
  await prisma.$disconnect();

  const local = (p: string) => p.slice(2); // 8801… → 01…
  process.env.E2E_PASSWORD = password;
  process.env.E2E_ADMIN_PHONE = local(adminPhone);
  process.env.E2E_ASSISTANT_PHONE = local(assistantPhone);
  process.env.E2E_SESSION_ID = session.id;
  process.env.E2E_CODES = JSON.stringify(Object.fromEntries(tokens.map((t) => [t.serial, t.publicCode])));
}
