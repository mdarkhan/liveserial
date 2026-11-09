/**
 * Pure queue rules (no DB access) — unit-testable. Phase 2 adds next-token
 * selection, people-ahead and transition rules here.
 */
import { randomInt } from "node:crypto";

/** No look-alikes (0/O, 1/l/I). 55 symbols × 10 chars ≈ 57.8 bits. */
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function generatePublicCode(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}
