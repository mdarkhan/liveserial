import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { prisma } from "@/lib/db";

/**
 * Better Auth: phone number + password, database sessions.
 * Users are created by admins (see lib/users.ts); public sign-up is off.
 */
export const auth = betterAuth({
  baseURL: process.env.APP_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  telemetry: { enabled: false },
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  session: {
    modelName: "authSession",
    expiresIn: 60 * 60 * 24 * 30, // 30 days: assistants shouldn't re-login every shift
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: true, input: false },
      organizationId: { type: "string", required: false, input: false },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: { "/sign-in/phone-number": { window: 60, max: 5 } },
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated users (or users of a deactivated organization) can't sign in.
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { isActive: true, organization: { select: { isActive: true } } },
          });
          if (!user?.isActive || (user.organization && !user.organization.isActive)) return false;
        },
      },
    },
  },
  plugins: [
    phoneNumber({
      // OTP flows aren't used in the MVP; the plugin requires a sender.
      sendOTP: async () => {},
      phoneNumberValidator: (p) => /^8801[3-9]\d{8}$/.test(p),
    }),
    nextCookies(), // must stay last
  ],
});
