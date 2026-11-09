import { z } from "zod";
import { t } from "@/lib/i18n/bn";

/** What every form server action returns. */
export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted text values, so a failed form keeps what was typed. */
  values?: Record<string, string>;
};

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && k !== "password") out[k] = v;
  return out;
}

/** Parse FormData with a zod schema; on failure return a ready ActionResult. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  fd: FormData,
): { data: z.infer<S>; error?: undefined } | { data?: undefined; error: ActionResult } {
  const raw = Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$")));
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message || t.common.somethingWrong;
  }
  return { error: { ok: false, fieldErrors, values: formValues(fd) } };
}

export function fail(message: string, fd?: FormData, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, message: fieldErrors ? undefined : message, fieldErrors, values: fd ? formValues(fd) : undefined };
}

/** Postgres unique violation (Prisma error code P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}
