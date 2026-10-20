// Calendar link tokens (timetable.md "Calendar link panel"). Server-only: uses node:crypto.
import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export function newCalendarToken(): string {
  return randomBytes(32).toString("base64url");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 of the token, hex: what the feed route looks a link up by (same as the database check). */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
