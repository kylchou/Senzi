import { createHash, randomInt } from "node:crypto";

// Plain helpers for product-user proof (access codes and screenshots), kept
// free of app imports so seed scripts and unit tests can use them. See
// lib/product-verification.ts.

// No 0/O or 1/I/L, so codes read cleanly off a screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Case, spaces, and dashes don't matter: "stripe demo" matches "STRIPE-DEMO". */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCode(raw: string): string {
  return createHash("sha256").update(normalizeCode(raw)).digest("hex");
}

/** e.g. STRIPE-7KQ2-X9WD. The prefix only helps people tell codes apart. */
export function generateCode(startupSlug: string): string {
  const prefix = startupSlug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "SENZI";
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${prefix}-${part()}-${part()}`;
}

/** Checks the file's first bytes rather than trusting its name or browser type. */
export function screenshotType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
