import type { SessionStatus, TokenStatus } from "@/generated/prisma/enums";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export function sessionTone(s: SessionStatus): Tone {
  switch (s) {
    case "RUNNING":
    case "DOCTOR_ARRIVED":
      return "success";
    case "ON_BREAK":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

export function tokenTone(s: TokenStatus): Tone {
  switch (s) {
    case "CALLED":
    case "IN_CONSULT":
      return "primary";
    case "DONE":
      return "success";
    case "SKIPPED":
    case "NO_SHOW":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}
