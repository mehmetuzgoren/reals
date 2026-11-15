import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createVerifierServer } from "../verifier/src/server.mjs";
import { loadConfig } from "../verifier/src/config.mjs";
import { setup, user, round, begin, befriend, playback, path, type Actor } from "./helpers";

const execute = promisify(execFile);
const networkFetch = globalThis.fetch;
const secret = "test-only-verifier-secret-not-a-credential";
let server: Server;
let directory: string;
let origin: string;
let video: Buffer;
let short: Buffer;
let silent: Buffer;
let silentAtMinimum: Buffer;
let overlong: Buffer;
let avatar: Buffer;
const metadata = Buffer.from("private-avatar-integration-metadata");

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "take-backend-media-integration-"));
  const ffmpeg = async (name: string, args: string[]) => {
    const output = join(directory, name);
    await execute("/usr/bin/ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-filter_threads", "1", "-y", ...args, output], { timeout: 20000, maxBuffer: 1024 * 1024 });
    return readFile(output);
  };
  const clip = (name: string, duration: string, audio: string) => ffmpeg(name, [
    "-f", "lavfi", "-i", "testsrc2=size=96x160:rate=30", "-f", "lavfi", "-i", audio,
    "-t", duration, "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-video_track_timescale", "600", "-movflags", "+faststart",
  ]);
  video = await clip("valid.mp4", "3", "sine=frequency=440:sample_rate=48000");
  short = await clip("short.mp4", "1", "sine=frequency=440:sample_rate=48000");
  silent = await clip("silent.mp4", "1", "anullsrc=r=48000:cl=stereo");
  silentAtMinimum = await clip("silent-at-minimum.mp4", "3", "anullsrc=r=48000:cl=stereo");
  overlong = await clip("overlong.mp4", "15.1", "sine=frequency=440:sample_rate=48000");
  const jpeg = await ffmpeg("avatar.jpg", ["-f", "lavfi", "-i", "testsrc2=size=1200x800", "-frames:v", "1", "-c:v", "mjpeg", "-threads", "1", "-q:v", "4"]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffef);
  marker.writeUInt16BE(metadata.length + 2, 2);
  avatar = Buffer.concat([jpeg.subarray(0, 2), marker, metadata, jpeg.subarray(2)]);
  server = await createVerifierServer({ ...loadConfig({ VERIFY_SHARED_SECRET: secret }), tempRoot: directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Verifier did not open a TCP listener");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  if (server) {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function liveBackend() {
  const t = setup();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://verifier.test" || !["/verify", "/verify-avatar"].includes(url.pathname)) throw new Error("Unexpected integration-test request");
    return networkFetch(origin + url.pathname, init);
  });
  return t;
}

async function upload(client: Actor, url: string, bytes: Buffer, mime = "video/mp4") {
  return client.fetch(path(url), { method: "POST", headers: { "Content-Type": mime }, body: new Uint8Array(bytes) });
}

describe("actual verifier HTTP and decoder through Convex publication", () => {
  it("creates receipts only after actual decoding and serves exact private video/thumbnail bytes with live revocation", async () => {
    const t = liveBackend();
    const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await befriend(alex.client, alex.profile.id, blair.client, blair.profile.id);
    const roundId = await round(t);
    const a = await begin(alex.client, roundId);
    expect((await upload(alex.client, a.uploadUrl, video)).status).toBe(200);
    expect((await alex.client.query(api.rounds.today, {})).viewerReceipt).toBeNull();
    const published = await alex.client.action(api.uploads.finalize, { uploadId: a.uploadId });
    expect(published).toMatchObject({ state: "published", failure: null, receipt: { roundId } });
    expect((await alex.client.query(api.rounds.today, {})).ownOriginal).toMatchObject({ durationMs: 3000 });
    await expect(playback(blair.client, published.originalId!, "original")).rejects.toThrow("NOT_FOUND");
    const b = await begin(blair.client, roundId);
    expect((await upload(blair.client, b.uploadUrl, video)).status).toBe(200);
    expect(await blair.client.action(api.uploads.finalize, { uploadId: b.uploadId })).toMatchObject({ state: "published" });
    const grant = await playback(blair.client, published.originalId!, "original");
    const full = await t.fetch(path(grant.url));
    expect(full.status).toBe(200);
    expect(full.headers.get("Location")).toBeNull();
    expect(full.headers.get("Cache-Control")).toContain("no-store");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(video);
    const partial = await t.fetch(path(grant.url), { headers: { Range: "bytes=4-20" } });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(video.subarray(4, 21));
    const thumbnail = await playback(blair.client, published.originalId!, "original", "thumbnail");
    const image = Buffer.from(await (await t.fetch(path(thumbnail.url))).arrayBuffer());
    expect(image.readUInt16BE(0)).toBe(0xffd8);
    expect(image.length).toBeGreaterThan(4);
    expect(image.length).toBeLessThanOrEqual(512 * 1024);
    await alex.client.mutation(api.friends.remove, { userId: blair.profile.id });
    expect((await t.fetch(path(grant.url))).status).toBe(404);
    expect((await t.fetch(path(thumbnail.url))).status).toBe(404);
  });

  it("rejects real silent, overlong and truncated clips without any publication or unlock", async () => {
    const t = liveBackend();
    const roundId = await round(t);
    for (const [index, bytes] of [silent, overlong, video.subarray(0, 128), short, silentAtMinimum].entries()) {
      const owner = await user(t, `invalid_${index}`);
      const intent = await begin(owner.client, roundId);
      expect((await upload(owner.client, intent.uploadUrl, bytes)).status).toBe(200);
      expect(await owner.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", receipt: null, failure: { code: "INVALID_MEDIA", retryable: false } });
      expect(await owner.client.query(api.rounds.today, {})).toMatchObject({ canViewFriends: false, viewerReceipt: null, ownOriginal: null });
    }
    expect(await t.run(async ctx => ({ receipts: await ctx.db.query("submissionReceipts").collect(), originals: await ctx.db.query("originalTakes").collect() }))).toEqual({ receipts: [], originals: [] });
  });

  it("binds only actually normalized metadata-free avatars, not raw input or a foreign owner's intent", async () => {
    const t = liveBackend();
    const alex = await user(t, "alex"); const blair = await user(t, "blair");
    const intent = await alex.client.mutation(api.profiles.beginAvatarUpload, { requestId: "real-avatar-integration" });
    expect((await upload(blair.client, intent.uploadUrl, avatar, "image/jpeg")).status).toBe(404);
    expect((await upload(alex.client, intent.uploadUrl, avatar, "image/jpeg")).status).toBe(200);
    await expect(blair.client.mutation(api.profiles.update, { displayName: "Blair", avatarUploadId: intent.uploadId })).rejects.toThrow("NOT_FOUND");
    const profile = await alex.client.mutation(api.profiles.update, { displayName: "Alex", avatarUploadId: intent.uploadId });
    const response = await t.fetch(path(profile.avatar!.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    const normalized = Buffer.from(await response.arrayBuffer());
    expect(normalized.readUInt16BE(0)).toBe(0xffd8);
    expect(normalized.length).toBeLessThanOrEqual(512 * 1024);
    expect(normalized.includes(metadata)).toBe(false);
    expect(normalized).not.toEqual(avatar);
    const stored = await t.run(async ctx => ({ profile: await ctx.db.get(alex.profile.id), assets: await ctx.db.system.query("_storage").collect() }));
    expect(stored.profile!.avatarWidth).toBe(512);
    expect(stored.profile!.avatarHeight).toBeGreaterThanOrEqual(340);
    expect(stored.profile!.avatarHeight).toBeLessThanOrEqual(342);
    expect(stored.assets).toHaveLength(1);
    expect(stored.assets[0].size).toBe(normalized.length);
  });
});
