"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { homeFor } from "@/lib/access";
import { normalizeBdPhone } from "@/lib/format";
import { verifyPassword } from "@/lib/users";
import { t } from "@/lib/i18n/bn";
import { fail, type ActionResult } from "@/lib/action-result";

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const phone = normalizeBdPhone(String(fd.get("phone") ?? ""));
  const password = String(fd.get("password") ?? "");
  if (!phone) return fail("", fd, { phone: t.validation.phone });
  if (!password) return fail("", fd, { password: t.validation.required });

  let role: Parameters<typeof homeFor>[0] | null = null;
  try {
    const res = await auth.api.signInPhoneNumber({
      body: { phoneNumber: phone, password, rememberMe: true },
      headers: await headers(),
    });
    role = (res.user as unknown as { role: Parameters<typeof homeFor>[0] }).role;
  } catch {
    // Tell a deactivated user why — but only if they proved the password.
    const user = await prisma.user.findUnique({
      where: { phoneNumber: phone },
      include: { accounts: { where: { providerId: "credential" } }, organization: true },
    });
    const hash = user?.accounts[0]?.password;
    const inactive = user && (!user.isActive || (user.organization && !user.organization.isActive));
    if (inactive && hash && (await verifyPassword(hash, password))) return fail(t.auth.inactive, fd);
    return fail(t.auth.invalid, fd);
  }
  redirect(homeFor(role));
}

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
