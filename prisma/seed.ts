/**
 * Demo data: 1 organization, 2 doctors, 2 chambers, schedules, one user per
 * role, and today's session for Dr. Karim with 25 patients.
 *   npm run db:seed
 * Demo password for every seeded org user: demo1234 (development only).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc, normalizeBdPhone } from "../src/lib/format";
import { FEATURES } from "../src/lib/features";
import { addTokens } from "../src/lib/queue-service";
import { flushOutbox } from "../src/lib/sms";
import { createUserWithPassword } from "../src/lib/users";

const DEMO_PASSWORD = "demo1234";
const ORG_SLUG = "seba-clinic";

const PATIENTS = [
  "মোঃ রফিকুল ইসলাম", "আয়েশা বেগম", "আব্দুল হালিম", "শাহানা পারভীন", "মোঃ জসিম উদ্দিন",
  "রাশিদা খাতুন", "কামরুল হাসান", "নাজমা আক্তার", "মোঃ সেলিম রেজা", "ফাতেমা জোহরা",
  "আনোয়ার হোসেন", "মমতাজ বেগম", "মোঃ শফিকুল আলম", "রোকেয়া সুলতানা", "হাবিবুর রহমান",
  "সালমা খানম", "মোঃ নুরুল আমিন", "জাহানারা বেগম", "তানভীর আহমেদ", "শিরিন আক্তার",
  "মোঃ আলমগীর কবির", "পারভীন সুলতানা", "আবুল কালাম", "রুবিনা ইয়াসমিন", "মোঃ মিজানুর রহমান",
];

async function main() {
  // Super admin (from env).
  const superPhone = normalizeBdPhone(process.env.SEED_SUPERADMIN_PHONE ?? "");
  const superPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? "";
  if (superPhone && superPassword.length >= 8) {
    const exists = await prisma.user.findUnique({ where: { phoneNumber: superPhone } });
    if (!exists) {
      await createUserWithPassword({
        name: "সুপার অ্যাডমিন",
        phone: superPhone,
        role: "SUPER_ADMIN",
        organizationId: null,
        password: superPassword,
      });
      console.log(`Super admin: ${superPhone}`);
    }
  } else {
    console.warn("SEED_SUPERADMIN_PHONE / SEED_SUPERADMIN_PASSWORD (8+ chars) not set — skipping super admin.");
  }

  if (await prisma.organization.findUnique({ where: { slug: ORG_SLUG } })) {
    console.log(`Organization "${ORG_SLUG}" already exists — nothing else to seed. (npm run db:reset to start over)`);
    return;
  }

  const org = await prisma.organization.create({
    data: {
      name: "সেবা ক্লিনিক ও ডায়াগনস্টিক",
      slug: ORG_SLUG,
      address: "মিরপুর ১০, ঢাকা",
      // Demo: every optional feature on, so they can be tried locally.
      features: Object.fromEntries(FEATURES.map((f) => [f, true])),
    },
  });

  const [karim, nasrin] = await Promise.all([
    prisma.doctor.create({
      data: { organizationId: org.id, name: "ডা. আব্দুল করিম", specialty: "মেডিসিন বিশেষজ্ঞ" },
    }),
    prisma.doctor.create({
      data: { organizationId: org.id, name: "ডা. নাসরিন সুলতানা", specialty: "শিশু বিশেষজ্ঞ" },
    }),
  ]);
  const [room1, room2] = await Promise.all([
    prisma.chamber.create({ data: { organizationId: org.id, name: "চেম্বার ১ (নিচতলা)", leaveNowThreshold: 5 } }),
    prisma.chamber.create({ data: { organizationId: org.id, name: "চেম্বার ২ (দোতলা)", leaveNowThreshold: 4 } }),
  ]);

  // Karim: every day except Friday at 17:00 in room 1. Nasrin: Sun/Tue/Thu 10:00 in room 2.
  await prisma.scheduleTemplate.createMany({
    data: [
      ...[0, 1, 2, 3, 4, 6].map((weekday) => ({
        organizationId: org.id, doctorId: karim.id, chamberId: room1.id, weekday, startTime: "17:00",
      })),
      ...[0, 2, 4].map((weekday) => ({
        organizationId: org.id, doctorId: nasrin.id, chamberId: room2.id, weekday, startTime: "10:00",
      })),
    ],
  });

  const admin = await createUserWithPassword({
    name: "রাকিব হাসান", phone: "8801711000001", role: "ORG_ADMIN", organizationId: org.id, password: DEMO_PASSWORD,
  });
  const assistant = await createUserWithPassword({
    name: "সুমন মিয়া", phone: "8801711000002", role: "ASSISTANT", organizationId: org.id, password: DEMO_PASSWORD,
  });
  const doctorUser = await createUserWithPassword({
    name: "ডা. আব্দুল করিম", phone: "8801711000003", role: "DOCTOR", organizationId: org.id, password: DEMO_PASSWORD,
  });
  await prisma.doctor.update({ where: { id: karim.id }, data: { userId: doctorUser.id } });

  const today = dhakaDateString();
  const session = await prisma.session.create({
    data: {
      organizationId: org.id,
      doctorId: karim.id,
      chamberId: room1.id,
      date: dateOnly(today),
      scheduledStartAt: dhakaWallTimeToUtc(today, "17:00"),
    },
  });

  // Added through the queue service so every token gets its TOKEN_ADDED audit event.
  const added = await addTokens(
    { orgId: org.id, userId: assistant.id, sessionId: session.id, clientRequestId: randomUUID() },
    PATIENTS.map((name, i) => ({
      name,
      // A few walk-ins without a phone.
      phone: i % 9 === 8 ? null : `88017${String(20000000 + i * 137).padStart(8, "0")}`,
      isEmergency: i === 17,
    })),
  );

  // The creation SMS were queued with the tokens; send them (console provider prints them) before exiting.
  await flushOutbox();

  console.log(`Organization: ${org.name} (${org.slug})`);
  console.log(`  ORG_ADMIN  01711000001 / ${DEMO_PASSWORD}  (${admin.name})`);
  console.log(`  ASSISTANT  01711000002 / ${DEMO_PASSWORD}  (${assistant.name})`);
  console.log(`  DOCTOR     01711000003 / ${DEMO_PASSWORD}  (${doctorUser.name})`);
  console.log(`Session today ${today} 17:00 — ${added.length} tokens. First patient link: /t/${added[0].publicCode}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
