import { fail } from "./errors";

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function fromBase64(value: string, limit: number) {
  if (value.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail("INVALID_MEDIA", "Invalid verifier output");
  const text = atob(value);
  if (text.length > limit) fail("INVALID_MEDIA", "Invalid verifier output");
  return Uint8Array.from(text, char => char.charCodeAt(0)).buffer;
}
async function verify(path: string, bytes: ArrayBuffer, hash: string): Promise<Record<string, unknown>> {
  const origin = process.env.MEDIA_VERIFIER_ORIGIN;
  const secret = process.env.MEDIA_VERIFIER_SECRET;
  if (!origin || !/^https:\/\/[^/]+$/.test(origin) || !secret || secret.length < 32) fail("PROCESSING_UNAVAILABLE", "Trusted media verification is not configured", true);
  let response;
  try {
    response = await fetch(`${origin}${path}`, { method: "POST", headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/octet-stream", "X-Content-SHA256": hash }, body: bytes, signal: AbortSignal.timeout(45000), redirect: "error" });
  } catch { fail("PROCESSING_UNAVAILABLE", "Trusted media verification is unavailable", true); }
  if (response.status === 422 || response.status === 413 || response.status === 415) fail("INVALID_MEDIA", "Upload a usable portrait MP4 with audio, between 3 and 15 seconds");
  if (!response.ok) fail("PROCESSING_UNAVAILABLE", "Trusted media verification is unavailable", true);
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) fail("INVALID_MEDIA", "Invalid verifier output");
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); }
  catch { return fail("INVALID_MEDIA", "Invalid verifier output"); }
  if (data.sha256 !== hash) fail("INVALID_MEDIA", "Verified bytes do not match this upload");
  return data;
}
export async function verifyVideo(bytes: ArrayBuffer, hash: string) {
  const data = await verify("/verify", bytes, hash);
  const { durationMs, width, height } = data;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 3000 || durationMs > 15000 ||
    typeof width !== "number" || !Number.isInteger(width) || width <= 0 || width > 2160 ||
    typeof height !== "number" || !Number.isInteger(height) || height <= width || height > 4096 || data.videoCodec !== "h264" || data.audioCodec !== "aac") {
    fail("INVALID_MEDIA", "Trusted verification rejected this video");
  }
  const thumbnail = typeof data.thumbnailBase64 === "string" ? fromBase64(data.thumbnailBase64, 512 * 1024) : null;
  return { durationMs, width, height, thumbnail };
}
export async function verifyAvatar(bytes: ArrayBuffer, hash: string) {
  const data = await verify("/verify-avatar", bytes, hash);
  if (typeof data.width !== "number" || typeof data.height !== "number" || !Number.isInteger(data.width) || !Number.isInteger(data.height) ||
    data.width < 1 || data.height < 1 || data.width > 512 || data.height > 512 || data.mimeType !== "image/jpeg" || typeof data.imageBase64 !== "string") fail("INVALID_MEDIA", "Invalid avatar image");
  const image = fromBase64(data.imageBase64, 512 * 1024);
  const signature = new Uint8Array(image);
  if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) fail("INVALID_MEDIA", "Invalid avatar image");
  return { width: data.width, height: data.height, image };
}
