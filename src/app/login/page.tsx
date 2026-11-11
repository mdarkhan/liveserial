import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field, PasswordField, SubmitButton } from "@/components/form";
import { getSessionUser, homeFor } from "@/lib/access";
import { t } from "@/lib/i18n/bn";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: t.auth.loginTitle };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10 outline-none">
      <div className="mb-8 text-center">
        <p className="text-3xl font-bold text-primary">{t.appName}</p>
        <p className="mt-1 text-ink-muted">{t.tagline}</p>
      </div>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h1 className="mb-4 text-xl font-semibold">{t.auth.loginTitle}</h1>
        <ActionForm action={loginAction} resetOnSuccess={false}>
          <Field
            name="phone"
            label={t.auth.phone}
            hint={t.auth.phoneHint}
            type="tel"
            inputMode="tel"
            autoComplete="username"
            required
          />
          <PasswordField
            name="password"
            label={t.auth.password}
            showLabel={t.auth.showPassword}
            autoComplete="current-password"
            required
          />
          <SubmitButton pendingLabel={t.auth.submitting} size="lg" className="w-full">
            {t.auth.submit}
          </SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
