import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma, Role } from "@/generated/prisma/client";

export async function hashPassword(password: string): Promise<string> {
  const ctx = await auth.$context;
  return ctx.password.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const ctx = await auth.$context;
  return ctx.password.verify({ hash, password });
}

/**
 * Creates a login user the way Better Auth's credential sign-up would:
 * a User row + an Account row (providerId "credential") holding the hash.
 * `phone` must already be normalized (8801XXXXXXXXX).
 */
export async function createUserWithPassword(
  input: { name: string; phone: string; role: Role; organizationId: string | null; password: string },
  db: Prisma.TransactionClient = prisma,
) {
  const hash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      name: input.name,
      email: `${input.phone}@phone.invalid`,
      phoneNumber: input.phone,
      role: input.role,
      organizationId: input.organizationId,
    },
  });
  await db.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
  });
  return user;
}

/** Sets a new password and signs the user out everywhere. */
export async function setPassword(userId: string, password: string) {
  const hash = await hashPassword(password);
  await prisma.$transaction([
    prisma.account.updateMany({ where: { userId, providerId: "credential" }, data: { password: hash } }),
    prisma.authSession.deleteMany({ where: { userId } }),
  ]);
}
