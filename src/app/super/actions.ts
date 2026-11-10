"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { normalizeBdPhone, toAsciiDigits } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { fail, isUniqueViolation, parseForm, type ActionResult } from "@/lib/action-result";
import { createUserWithPassword } from "@/lib/users";
import { doctorOverridesFromForm, FEATURES, orgFeaturesFromForm } from "@/lib/features";

const v = t.validation;

const orgSchema = z.object({
  orgName: z.string().trim().min(1, v.required).max(120, v.tooLong),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, t.org.slugHint)
    .max(40, v.tooLong),
  phone: z
    .string()
    .transform((s) => normalizeBdPhone(s))
    .refine((p): p is string => p !== null, v.phone),
  adminName: z.string().trim().min(1, v.required).max(120, v.tooLong),
  password: z.string().min(8, v.password).max(128, v.tooLong),
});

/** Creates an organization together with its first ORG_ADMIN. */
export async function createOrganization(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireUser(["SUPER_ADMIN"]);
  const { data, error } = parseForm(orgSchema, fd);
  if (error) return error;

  const [slugTaken, phoneTaken] = await Promise.all([
    prisma.organization.findUnique({ where: { slug: data.slug } }),
    prisma.user.findUnique({ where: { phoneNumber: data.phone } }),
  ]);
  if (slugTaken || phoneTaken) {
    return fail("", fd, {
      ...(slugTaken ? { slug: t.org.slugTaken } : {}),
      ...(phoneTaken ? { phone: t.user.phoneTaken } : {}),
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: data.orgName, slug: data.slug } });
      await createUserWithPassword(
        { name: data.adminName, phone: data.phone, role: "ORG_ADMIN", organizationId: org.id, password: data.password },
        tx,
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(t.org.slugTaken, fd);
    throw e;
  }
  revalidatePath("/super");
  return { ok: true, message: t.org.created };
}

export async function toggleOrganization(fd: FormData) {
  await requireUser(["SUPER_ADMIN"]);
  const org = await prisma.organization.findUnique({ where: { id: String(fd.get("id")) } });
  if (!org) return;
  await prisma.$transaction([
    prisma.organization.update({ where: { id: org.id }, data: { isActive: !org.isActive } }),
    // Deactivating an organization signs all its users out.
    ...(org.isActive ? [prisma.authSession.deleteMany({ where: { user: { organizationId: org.id } } })] : []),
  ]);
  revalidatePath("/super");
}

// ───────────── Optional features ─────────────

/** Organization-wide feature switches (checkbox per feature, or the "all on/off" buttons). */
export async function saveOrgFeatures(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireUser(["SUPER_ADMIN"]);
  const orgId = String(fd.get("orgId") ?? "");
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return fail(t.common.notFound);
  const preset = fd.get("preset");
  const flags =
    preset === "all-on" || preset === "all-off"
      ? Object.fromEntries(FEATURES.map((f) => [f, preset === "all-on"]))
      : orgFeaturesFromForm(fd);
  await prisma.organization.update({ where: { id: org.id }, data: { features: flags } });
  revalidatePath(`/super/orgs/${org.id}`);
  revalidatePath("/super");
  return { ok: true, message: t.features.saved };
}

/** One doctor's overrides ("same as organization" / on / off per feature). */
export async function saveDoctorFeatures(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireUser(["SUPER_ADMIN"]);
  const orgId = String(fd.get("orgId") ?? "");
  const doctorId = String(fd.get("doctorId") ?? "");
  // Scoped by organization: a doctor id from another organization is "not found".
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, organizationId: orgId }, select: { id: true } });
  if (!doctor) return fail(t.common.notFound);
  await prisma.doctor.update({ where: { id: doctor.id }, data: { features: doctorOverridesFromForm(fd) } });
  revalidatePath(`/super/orgs/${orgId}`);
  return { ok: true, message: t.features.saved };
}

/** Monthly SMS allowance in billable segments (empty = no limit). Warning only; sending is never blocked. */
export async function saveSmsLimit(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireUser(["SUPER_ADMIN"]);
  const orgId = String(fd.get("orgId") ?? "");
  const raw = String(fd.get("smsMonthlyLimit") ?? "").trim();
  const value = raw === "" ? null : Number(toAsciiDigits(raw));
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 10_000_000)) {
    return fail("", fd, { smsMonthlyLimit: t.validation.number });
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return fail(t.common.notFound);
  await prisma.organization.update({ where: { id: org.id }, data: { smsMonthlyLimit: value } });
  revalidatePath(`/super/orgs/${org.id}`);
  revalidatePath("/super");
  revalidatePath("/super/sms");
  return { ok: true, message: t.features.smsLimitSaved };
}
