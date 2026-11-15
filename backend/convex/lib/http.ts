import { ConvexError } from "convex/values";
import { fail } from "./errors";
import type { Failure } from "./errors";

export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function httpError(error: unknown) {
  const failure = error instanceof ConvexError ? error.data as Failure : { code: "PROCESSING_UNAVAILABLE", message: "Temporarily unavailable", retryable: true };
  const status = failure.code === "NOT_FOUND" ? 404 : failure.code === "UNAUTHENTICATED" || failure.code === "PROFILE_REQUIRED" ? 401 : failure.code === "PROCESSING_UNAVAILABLE" ? 503 : failure.code === "TOO_LARGE" ? 413 : failure.code === "CONFLICT" ? 409 : 422;
  return Response.json({ failure }, { status, headers: privateHeaders });
}
export async function readBody(request: Request, maxBytes: number) {
  const claimed = request.headers.get("Content-Length");
  if (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > maxBytes)) fail("TOO_LARGE", "Upload exceeds the byte limit");
  if (!request.body) fail("INVALID_MEDIA", "Upload body is empty");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maxBytes) fail("TOO_LARGE", "Upload exceeds the byte limit");
      chunks.push(item.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (length === 0 || (claimed !== null && Number(claimed) !== length)) fail("INVALID_MEDIA", "Upload body is empty or truncated");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
export function byteRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return "invalid";
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end };
}
