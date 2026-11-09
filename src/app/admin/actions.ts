"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bn, dateOnly, dhakaWallTimeToUtc, normalizeBdPhone, toAsciiDigits } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { fail, isUniqueViolation, parseForm, type ActionResult } from "@/lib/action-result";
import { addTokens, cancelSession, cancelToken, editToken, QueueError } from "@/lib/queue-service";
import { createUserWithPassword, setPassword } from "@/lib/users";

type Prev = ActionResult | null;
const v = t.validation;

// ───────────── shared field schemas ─────────────

const name = z.string().trim().min(1, v.required).max(120, v.tooLong);
const optionalText = z
  .string()
  .trim()
  .max(200, v.tooLong)
  .optional()
  .transform((s) => (s ? s : null));
const phone = z
  .string()
  .transform((s) => normalizeBdPhone(s))
  .refine((p): p is string => p !== null, v.phone);
const password = z.string().min(8, v.password).max(128, v.tooLong);
const checkbox = z
  .string()
  .optional()
  .transform((s) => s === "on");
const id = z.string().min(1);
const rid = z.string().uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, v.time);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, v.date);

function ok(message?: string): ActionResult {
  return { ok: true, message };
}

/** Phone that may be blank, but if typed must be valid. */
function optionalPhoneField(fd: FormData): { value: string | null; error?: string } {
  const raw = String(fd.get("phone") ?? "").trim();
  if (!raw) return { value: null };
  const p = normalizeBdPhone(raw);
  return p ? { value: p } : { value: null, error: v.phone };
}

function queueErrorResult(e: unknown, fd: FormData): ActionResult {
  if (e instanceof QueueError) {
    if (e.code === "SESSION_CLOSED") return fail(t.token.sessionClosed, fd);
    if (e.code === "SERIAL_TAKEN") return fail(t.token.serialTaken(bn(e.message)), fd);
    if (e.code === "NOT_FOUND") return fail(t.common.notFound, fd);
  }
  console.error(e);
  return fail(t.common.somethingWrong, fd);
}

// ───────────── Doctors ─────────────

const doctorSchema = z.object({ name, specialty: optionalText });

export async function createDoctor(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(doctorSchema, fd);
  if (error) return error;
  await prisma.doctor.create({ data: { organizationId: orgId, name: data.name, specialty: data.specialty } });
  revalidatePath("/admin/doctors");
  return ok(t.common.saved);
}

export async function updateDoctor(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(doctorSchema.extend({ id }), fd);
  if (error) return error;
  await prisma.doctor.updateMany({
    where: { id: data.id, organizationId: orgId },
    data: { name: data.name, specialty: data.specialty },
  });
  revalidatePath("/admin/doctors");
  return ok(t.common.saved);
}

export async function toggleDoctor(fd: FormData) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const doctorId = String(fd.get("id"));
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, organizationId: orgId } });
  if (doctor) await prisma.doctor.update({ where: { id: doctor.id }, data: { isActive: !doctor.isActive } });
  revalidatePath("/admin/doctors");
}

// ───────────── Chambers ─────────────

const chamberSchema = z.object({
  name,
  address: optionalText,
  leaveNowThreshold: z
    .string()
    .transform((s) => Number(toAsciiDigits(s)))
    .pipe(z.number({ error: v.number }).int(v.number).min(1, v.number).max(50, v.number)),
});

export async function createChamber(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(chamberSchema, fd);
  if (error) return error;
  await prisma.chamber.create({ data: { organizationId: orgId, ...data } });
  revalidatePath("/admin/chambers");
  return ok(t.common.saved);
}

export async function updateChamber(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(chamberSchema.extend({ id }), fd);
  if (error) return error;
  const { id: chamberId, ...rest } = data;
  await prisma.chamber.updateMany({ where: { id: chamberId, organizationId: orgId }, data: rest });
  revalidatePath("/admin/chambers");
  return ok(t.common.saved);
}

export async function toggleChamber(fd: FormData) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const chamber = await prisma.chamber.findFirst({ where: { id: String(fd.get("id")), organizationId: orgId } });
  if (chamber) await prisma.chamber.update({ where: { id: chamber.id }, data: { isActive: !chamber.isActive } });
  revalidatePath("/admin/chambers");
}

// ───────────── Schedules ─────────────

const scheduleSchema = z.object({
  doctorId: id,
  chamberId: id,
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: time,
});

export async function createSchedule(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(scheduleSchema, fd);
  if (error) return error;
  const [doctor, chamber] = await Promise.all([
    prisma.doctor.findFirst({ where: { id: data.doctorId, organizationId: orgId } }),
    prisma.chamber.findFirst({ where: { id: data.chamberId, organizationId: orgId } }),
  ]);
  if (!doctor || !chamber) return fail(t.common.notFound, fd);
  try {
    await prisma.scheduleTemplate.create({ data: { organizationId: orgId, ...data } });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(t.schedule.duplicate, fd);
    throw e;
  }
  revalidatePath("/admin/schedules");
  return ok(t.common.saved);
}

export async function toggleSchedule(fd: FormData) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const s = await prisma.scheduleTemplate.findFirst({ where: { id: String(fd.get("id")), organizationId: orgId } });
  if (s) await prisma.scheduleTemplate.update({ where: { id: s.id }, data: { isActive: !s.isActive } });
  revalidatePath("/admin/schedules");
}

// ───────────── Users ─────────────

const userSchema = z.object({
  name,
  phone,
  role: z.enum(["ORG_ADMIN", "DOCTOR", "ASSISTANT"]),
  password,
  doctorId: z.string().optional(),
});

export async function createUser(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(userSchema, fd);
  if (error) return error;
  let doctorId: string | null = null;
  if (data.role === "DOCTOR" && data.doctorId) {
    const doctor = await prisma.doctor.findFirst({ where: { id: data.doctorId, organizationId: orgId, userId: null } });
    if (!doctor) return fail(t.common.notFound, fd);
    doctorId = doctor.id;
  }
  try {
    await prisma.$transaction(async (tx) => {
      const user = await createUserWithPassword(
        { name: data.name, phone: data.phone, role: data.role, organizationId: orgId, password: data.password },
        tx,
      );
      if (doctorId) await tx.doctor.update({ where: { id: doctorId }, data: { userId: user.id } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("", fd, { phone: t.user.phoneTaken });
    throw e;
  }
  revalidatePath("/admin/users");
  return ok(t.common.saved);
}

export async function toggleUser(fd: FormData) {
  const { orgId, user: me } = await requireOrgUser(["ORG_ADMIN"]);
  const target = await prisma.user.findFirst({ where: { id: String(fd.get("id")), organizationId: orgId } });
  if (!target || target.id === me.id) return;
  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { isActive: !target.isActive } }),
    // Deactivation signs the user out everywhere.
    ...(target.isActive ? [prisma.authSession.deleteMany({ where: { userId: target.id } })] : []),
  ]);
  revalidatePath("/admin/users");
}

export async function resetUserPassword(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(z.object({ id, password }), fd);
  if (error) return error;
  const target = await prisma.user.findFirst({ where: { id: data.id, organizationId: orgId } });
  if (!target) return fail(t.common.notFound, fd);
  await setPassword(target.id, data.password);
  return ok(t.user.passwordChanged);
}

// ───────────── Sessions ─────────────

const sessionSchema = z.object({ doctorId: id, chamberId: id, date: ymd, startTime: time });

export async function createSession(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { data, error } = parseForm(sessionSchema, fd);
  if (error) return error;
  const [doctor, chamber] = await Promise.all([
    prisma.doctor.findFirst({ where: { id: data.doctorId, organizationId: orgId, isActive: true } }),
    prisma.chamber.findFirst({ where: { id: data.chamberId, organizationId: orgId, isActive: true } }),
  ]);
  if (!doctor || !chamber) return fail(t.common.notFound, fd);
  let sessionId: string;
  try {
    const s = await prisma.session.create({
      data: {
        organizationId: orgId,
        doctorId: doctor.id,
        chamberId: chamber.id,
        date: dateOnly(data.date),
        scheduledStartAt: dhakaWallTimeToUtc(data.date, data.startTime),
      },
    });
    sessionId = s.id;
  } catch (e) {
    if (isUniqueViolation(e)) return fail(t.session.duplicate, fd);
    throw e;
  }
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSessionAction(fd: FormData) {
  const { orgId, user } = await requireOrgUser(["ORG_ADMIN"]);
  const parsed = z.object({ sessionId: id, rid }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return;
  try {
    await cancelSession({ orgId, userId: user.id, sessionId: parsed.data.sessionId, clientRequestId: parsed.data.rid });
  } catch (e) {
    if (!(e instanceof QueueError)) throw e;
  }
  revalidatePath(`/admin/sessions/${parsed.data.sessionId}`);
}

// ───────────── Tokens ─────────────

const tokenSchema = z.object({
  sessionId: id,
  rid,
  name,
  isEmergency: checkbox,
});

export async function addTokenAction(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId, user } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT"]);
  const { data, error } = parseForm(tokenSchema, fd);
  if (error) return error;
  const ph = optionalPhoneField(fd);
  if (ph.error) return fail("", fd, { phone: ph.error });
  try {
    const [added] = await addTokens(
      { orgId, userId: user.id, sessionId: data.sessionId, clientRequestId: data.rid },
      [{ name: data.name, phone: ph.value, isEmergency: data.isEmergency }],
    );
    revalidatePath(`/admin/sessions/${data.sessionId}`);
    return ok(t.token.added(bn(added.serial)));
  } catch (e) {
    return queueErrorResult(e, fd);
  }
}

export async function editTokenAction(_: Prev, fd: FormData): Promise<ActionResult> {
  const { orgId, user } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT"]);
  const { data, error } = parseForm(tokenSchema.extend({ tokenId: id }), fd);
  if (error) return error;
  const ph = optionalPhoneField(fd);
  if (ph.error) return fail("", fd, { phone: ph.error });
  try {
    await editToken(
      { orgId, userId: user.id, sessionId: data.sessionId, clientRequestId: data.rid },
      data.tokenId,
      { name: data.name, phone: ph.value, isEmergency: data.isEmergency },
    );
    revalidatePath(`/admin/sessions/${data.sessionId}`);
    return ok(t.common.saved);
  } catch (e) {
    return queueErrorResult(e, fd);
  }
}

export async function cancelTokenAction(fd: FormData) {
  const { orgId, user } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT"]);
  const parsed = z.object({ sessionId: id, tokenId: id, rid }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return;
  try {
    await cancelToken(
      { orgId, userId: user.id, sessionId: parsed.data.sessionId, clientRequestId: parsed.data.rid },
      parsed.data.tokenId,
    );
  } catch (e) {
    if (!(e instanceof QueueError)) throw e;
  }
  revalidatePath(`/admin/sessions/${parsed.data.sessionId}`);
}
