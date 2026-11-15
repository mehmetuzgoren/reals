import { fail } from "./errors";
import { inspectVideo } from "./isoBmff";
import { inspectAvatar } from "./images";

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function bindHash(bytes: ArrayBuffer, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash) || await sha256(bytes) !== hash) fail("INVALID_MEDIA", "Verified bytes do not match this upload");
}
export async function verifyVideo(bytes: ArrayBuffer, hash: string) {
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) fail("INVALID_MEDIA", "Video exceeds its byte limit");
  await bindHash(bytes, hash);
  return { ...inspectVideo(bytes), thumbnail: null as ArrayBuffer | null };
}
export async function verifyAvatar(bytes: ArrayBuffer, hash: string) {
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) fail("INVALID_MEDIA", "Avatar exceeds its byte limit");
  await bindHash(bytes, hash);
  return { ...inspectAvatar(bytes), image: bytes };
}
