import { ConvexError } from "convex/values";

export type Failure = { code: string; message: string; retryable: boolean };
export function fail(code: string, message: string, retryable = false): never {
  throw new ConvexError({ code, message, retryable });
}
export function notFound(): never { return fail("NOT_FOUND", "Not found"); }
export function bounded(value: string, min: number, max: number, field: string) {
  const text = value.trim();
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    fail("INVALID_ARGUMENT", `Invalid ${field}`);
  }
  return text;
}
export function httpOrigin() {
  const value = process.env.TAKE_HTTP_ORIGIN;
  if (!value || !/^https:\/\/[^/]+$/.test(value)) fail("PROCESSING_UNAVAILABLE", "HTTP origin is not configured", true);
  return value;
}
