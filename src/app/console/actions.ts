"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addDays, dateOnly, dhakaDateString, dhakaWallTimeToUtc, weekdayOf } from "@/lib/format";
import { isUniqueViolation } from "@/lib/action-result";

/**
 * Opens a scheduled sitting: creates its Session row the first time (lazily,
 * from the ScheduleTemplate) and goes to the console. Safe to tap twice —
 * the (doctorId, scheduledStartAt) unique key makes creation idempotent.
 */
export async function openSitting(fd: FormData) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT"]);
  const parsed = z
    .object({ templateId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirect("/console");
  const { templateId, date } = parsed.data;

  // Only today … 7 days ahead (phone bookings for the coming week).
  const today = dhakaDateString();
  if (date < today || date > addDays(today, 7)) redirect("/console");

  const template = await prisma.scheduleTemplate.findFirst({
    where: { id: templateId, organizationId: orgId, isActive: true, doctor: { isActive: true }, chamber: { isActive: true } },
  });
  if (!template || template.weekday !== weekdayOf(date)) redirect(`/console?date=${date}`);

  const scheduledStartAt = dhakaWallTimeToUtc(date, template.startTime);
  let session = await prisma.session.findUnique({
    where: { doctorId_scheduledStartAt: { doctorId: template.doctorId, scheduledStartAt } },
  });
  if (!session) {
    try {
      session = await prisma.session.create({
        data: {
          organizationId: orgId,
          doctorId: template.doctorId,
          chamberId: template.chamberId,
          scheduleTemplateId: template.id,
          date: dateOnly(date),
          scheduledStartAt,
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      session = await prisma.session.findUniqueOrThrow({
        where: { doctorId_scheduledStartAt: { doctorId: template.doctorId, scheduledStartAt } },
      });
    }
  }
  if (session.organizationId !== orgId) redirect("/console");
  redirect(`/console/${session.id}`);
}
