export type ProcessingRecipe = { recipe: "mp3-320k-44100-v1"; outputBudget: number };
export type UploadClaim = { version: number; owner: string; uploadId: string; recordUri: string; sizeBytes: number; contentType: string; fileType: string; visibility: string; downloadPolicy: string; expiresAt: number; processing?: ProcessingRecipe | null };
const encoder = new TextEncoder();
export const MAX_UPLOAD_BYTES = 1610612736;
export const PART_BYTES = 10485760;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const formats = new Map([
  ["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["flac", "audio/flac"],
  ["ogg", "audio/ogg"], ["m4a", "audio/mp4"], ["aac", "audio/aac"],
]);
const processingFormats = new Map([...formats, ["aif", "audio/aiff"], ["aiff", "audio/aiff"], ["webm", "audio/webm"], ["opus", "audio/opus"]]);

export function validProcessing(value: unknown, sourceBytes: number): value is ProcessingRecipe {
  return value !== null && typeof value === "object" && "recipe" in value && value.recipe === "mp3-320k-44100-v1"
    && "outputBudget" in value && typeof value.outputBudget === "number" && Number.isSafeInteger(value.outputBudget)
    && value.outputBudget > 0 && value.outputBudget <= 2 * MAX_UPLOAD_BYTES - sourceBytes;
}

export function reservedBytes(value: Pick<UploadClaim, "sizeBytes" | "processing">) {
  return value.sizeBytes + (value.processing?.outputBudget ?? 0);
}

export function validClaim(value: unknown, now = Date.now()): value is UploadClaim {
  if (value === null || typeof value !== "object") return false;
  if (!("version" in value) || !("owner" in value) || !("uploadId" in value) || !("recordUri" in value) || !("sizeBytes" in value) || !("fileType" in value) || !("contentType" in value) || !("visibility" in value) || !("downloadPolicy" in value) || !("expiresAt" in value)) return false;
  const claim = value;
  const processing = "processing" in claim ? claim.processing : null;
  return claim.version === 1 &&
    typeof claim.owner === "string" && /^did:(plc|web):[A-Za-z0-9._:%-]+$/.test(claim.owner) &&
    typeof claim.uploadId === "string" && UUID.test(claim.uploadId) &&
    typeof claim.recordUri === "string" && claim.recordUri.startsWith(`at://${claim.owner}/`) &&
    claim.recordUri.split("/").length === 5 &&
    typeof claim.sizeBytes === "number" && Number.isSafeInteger(claim.sizeBytes) && claim.sizeBytes > 0 && claim.sizeBytes <= MAX_UPLOAD_BYTES &&
    (processing == null || validProcessing(processing, claim.sizeBytes)) &&
    typeof claim.fileType === "string" && typeof claim.contentType === "string" && (processing ? processingFormats : formats).get(claim.fileType) === claim.contentType &&
    claim.visibility === "public" && claim.downloadPolicy === "open" &&
    typeof claim.expiresAt === "number" && Number.isSafeInteger(claim.expiresAt) && claim.expiresAt > now && claim.expiresAt <= now + 600000;
}

export async function ownerHash(owner: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(owner));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
}

export async function verifyCapability(token: string | null, secret: string | undefined, now = Date.now()) {
  if (typeof token !== "string" || token.length > 4096 || typeof secret !== "string" || secret.length < 32) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decode(signature), encoder.encode(payload))) return null;
    const claim = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(payload)));
    return validClaim(claim, now) ? claim : null;
  } catch {
    return null;
  }
}

export function sameUpload(left: Omit<UploadClaim, "expiresAt">, right: Omit<UploadClaim, "expiresAt">) {
  return (["owner", "uploadId", "recordUri", "sizeBytes", "contentType", "fileType", "visibility", "downloadPolicy"] as const)
    .every(field => left[field] === right[field]) && left.processing?.recipe === right.processing?.recipe && left.processing?.outputBudget === right.processing?.outputBudget;
}
