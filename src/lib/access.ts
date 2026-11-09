import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

/**
 * The signed-in user, freshly read from the DB (role / org / active status are
 * never trusted from the cookie). Cached per request.
 */
export const getSessionUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true, doctor: true },
  });
  if (!user || !user.isActive) return null;
  if (user.organization && !user.organization.isActive) return null;
  return user;
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export function homeFor(role: Role): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/super";
    case "ORG_ADMIN":
      return "/admin";
    default:
      return "/console";
  }
}

/** Require a signed-in user, optionally with one of the given roles. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/**
 * Require a user that belongs to an organization. Every tenant query must use
 * the returned orgId in its `where`.
 */
export async function requireOrgUser(roles: Role[]): Promise<{ user: SessionUser; orgId: string }> {
  const user = await requireUser(roles);
  if (!user.organizationId) redirect(homeFor(user.role));
  return { user, orgId: user.organizationId };
}
