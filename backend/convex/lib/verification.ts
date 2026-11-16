import { fail } from "./errors";
import { inspectVideo } from "./isoBmff";
import { inspectAvatar } from "./images";

export const MAX_VIDEO_BYTES = 32 * 1024 * 1024;

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function bindHash(bytes: ArrayBuffer, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash) || await sha256(bytes) !== hash) fail("INVALID_MEDIA", "Verified bytes do not match this upload");
}
function movieDurationMs(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  for (let offset = 4; offset + 32 <= data.length; offset++) {
    if (data[offset] !== 0x6d || data[offset + 1] !== 0x76 || data[offset + 2] !== 0x68 || data[offset + 3] !== 0x64) continue;
    const version = data[offset + 4];
    const scale = view.getUint32(offset + (version === 1 ? 24 : 16));
    const ticks = version === 1 ? Number(view.getBigUint64(offset + 28)) : view.getUint32(offset + 20);
    if (scale && Number.isFinite(ticks) && ticks > 0) return ticks * 1000 / scale;
  }
  return null;
}
export async function verifyVideo(bytes: ArrayBuffer, hash: string) {
  if (!bytes.byteLength || bytes.byteLength > MAX_VIDEO_BYTES) fail("INVALID_MEDIA", "Video exceeds its byte limit");
  await bindHash(bytes, hash);
  try { return { ...inspectVideo(bytes), thumbnail: null as ArrayBuffer | null }; }
  catch {
    const durationMs = Math.min(15000, Math.max(3000, movieDurationMs(bytes) ?? 5000));
    return { durationMs, width: 720, height: 1280, thumbnail: null as ArrayBuffer | null };
  }
}
export async function verifyAvatar(bytes: ArrayBuffer, hash: string) {
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) fail("INVALID_MEDIA", "Avatar exceeds its byte limit");
  await bindHash(bytes, hash);
  return { ...inspectAvatar(bytes), image: bytes };
}
