import { tmpdir } from 'node:os';

export const HARD_LIMITS = Object.freeze({
  videoBytes: 20 * 1024 * 1024,
  avatarBytes: 2 * 1024 * 1024,
  durationMs: 15_000,
  dimension: 4096,
  avatarDimension: 2048,
  videoPixels: 2160 * 3840,
  avatarPixels: 2048 * 2048,
  fps: 60,
  processOutputBytes: 2 * 1024 * 1024,
  imageOutputBytes: 512 * 1024,
});

export class VerificationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function invalidMedia() {
  return new VerificationError(422, 'INVALID_MEDIA', 'The uploaded media is not supported or could not be fully verified.');
}

export function loadConfig(env = process.env) {
  const secret = env.VERIFY_SHARED_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || !/^[\x21-\x7e]+$/.test(secret)) {
    throw new Error('VERIFY_SHARED_SECRET must contain 32–512 printable, non-space ASCII characters.');
  }

  const integer = (name, fallback, maximum) => {
    if (env[name] === undefined) return fallback;
    if (!/^[0-9]+$/.test(env[name])) throw new Error(`${name} must be a bounded positive integer.`);
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be between 1 and ${maximum}.`);
    }
    return value;
  };

  const requestTimeoutMs = integer('VERIFY_REQUEST_TIMEOUT_MS', 25_000, 30_000);
  return Object.freeze({
    secret,
    port: integer('PORT', 8080, 65535),
    maxBytes: integer('VERIFY_MAX_BYTES', HARD_LIMITS.videoBytes, HARD_LIMITS.videoBytes),
    maxAvatarBytes: integer('VERIFY_MAX_AVATAR_BYTES', HARD_LIMITS.avatarBytes, HARD_LIMITS.avatarBytes),
    maxDurationMs: integer('VERIFY_MAX_DURATION_MS', HARD_LIMITS.durationMs, HARD_LIMITS.durationMs),
    concurrency: integer('VERIFY_MAX_CONCURRENCY', 2, 4),
    maxConnections: integer('VERIFY_MAX_CONNECTIONS', 32, 64),
    requestTimeoutMs,
    bodyTimeoutMs: Math.min(integer('VERIFY_BODY_TIMEOUT_MS', 5000, 10_000), requestTimeoutMs),
    processTimeoutMs: Math.min(integer('VERIFY_PROCESS_TIMEOUT_MS', 8000, 10_000), requestTimeoutMs),
    tempRoot: tmpdir(),
  });
}
