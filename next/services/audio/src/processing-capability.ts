import { UUID } from "./upload-capability.ts";

export type ProcessingClaim = { kind: "processing-v1"; ownerHash: string; uploadId: string; generation: number; expiresAt: number };
const encoder = new TextEncoder();
const lifetime = 2 * 60 * 60 * 1000;

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid capability encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
}
function valid(value: unknown, now: number): value is ProcessingClaim {
  return value !== null && typeof value === "object"
    && "kind" in value && value.kind === "processing-v1"
    && "ownerHash" in value && typeof value.ownerHash === "string" && /^[a-f0-9]{64}$/.test(value.ownerHash)
    && "uploadId" in value && typeof value.uploadId === "string" && UUID.test(value.uploadId)
    && "generation" in value && typeof value.generation === "number" && Number.isSafeInteger(value.generation) && value.generation > 0
    && "expiresAt" in value && typeof value.expiresAt === "number" && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + lifetime;
}
async function key(secret: string, usage: KeyUsage) {
  if (secret.length < 32) throw new Error("processing authority unavailable");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}
export async function signProcessing(claim: ProcessingClaim, secret: string) {
  const payload = encode(encoder.encode(JSON.stringify(claim)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret, "sign"), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyProcessing(token: string | null, secret: string, now = Date.now()) {
  if (!token || token.length > 4096) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined || !await crypto.subtle.verify("HMAC", await key(secret, "verify"), decode(signature), encoder.encode(payload))) return null;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(payload)));
    return valid(value, now) ? value : null;
  } catch { return null; }
}
