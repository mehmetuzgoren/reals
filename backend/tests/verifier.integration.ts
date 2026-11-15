import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { verifyVideo, verifyAvatar } from "../convex/lib/verification";
import { fixtures } from "../verifier/test/fixtures.mjs";
import { setup, user, round, begin, befriend, playback, path, type Actor } from "./helpers";
import { fixtureBytes } from "./media-fixtures";

const execute = promisify(execFile);
let media: Record<string, Buffer>;
let directory: string;
const bytes = (value: Buffer) => new Uint8Array(value).buffer;
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");

beforeAll(async () => {
  media = await fixtures() as unknown as Record<string, Buffer>;
  directory = await mkdtemp(join(tmpdir(), "reals-simple-media-"));
  const native = join(directory, "native-export.mp4");
  await execute("/usr/bin/ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "3", "-c:v", "libx264",
    "-preset", "ultrafast", "-crf", "28", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2",
    "-video_track_timescale", "600", "-movflags", "+faststart", "-y", native,
  ], { timeout: 20000, maxBuffer: 128 * 1024 });
  media["native-stereo.mp4"] = await readFile(native);
  const probe = await execute("/usr/bin/ffprobe", ["-v", "error", "-show_streams", "-of", "json", native]);
  const streams = JSON.parse(probe.stdout).streams;
  expect(streams.find((stream: { codec_type: string }) => stream.codec_type === "video")).toMatchObject({ codec_name: "h264", width: 720, height: 1280, time_base: "1/600", duration: "3.000000" });
  expect(streams.find((stream: { codec_type: string }) => stream.codec_type === "audio")).toMatchObject({ codec_name: "aac", channels: 2 });
  expect(media["native-stereo.mp4"].length).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(media["native-stereo.mp4"].indexOf("moov")).toBeLessThan(media["native-stereo.mp4"].indexOf("mdat"));
  const file = join(directory, "iphone-compatible-hevc.mov");
  await execute("/usr/bin/ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=96x160:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "3", "-c:v", "libx265",
    "-threads", "1", "-x265-params", "pools=none:frame-threads=1:log-level=error", "-tag:v", "hvc1",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-video_track_timescale", "600", "-movflags", "+faststart", "-y", file,
  ], { timeout: 20000, maxBuffer: 128 * 1024 });
  media["hevc.mov"] = await readFile(file);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function liveBackend() {
  const t = setup();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
  vi.stubEnv("MEDIA_VERIFIER_ORIGIN", "");
  vi.stubEnv("MEDIA_VERIFIER_SECRET", "");
  return t;
}

async function upload(client: Actor, url: string, value: Buffer, mime = "video/mp4") {
  return client.fetch(path(url), { method: "POST", headers: { "Content-Type": mime }, body: new Uint8Array(value) });
}

describe("in-Convex actual-byte structural verification", () => {
  it.each(["native-stereo.mp4", "hevc.mov"])("publishes real %s without a host and returns no thumbnail", async name => {
    const t = liveBackend();
    const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await befriend(alex.client, alex.profile.id, blair.client, blair.profile.id);
    const roundId = await round(t);
    const a = await begin(alex.client, roundId);
    expect((await upload(alex.client, a.uploadUrl, media[name])).status).toBe(200);
    expect((await alex.client.query(api.rounds.today, {})).viewerReceipt).toBeNull();
    const published = await alex.client.action(api.uploads.finalize, { uploadId: a.uploadId });
    expect(published).toMatchObject({ state: "published", failure: null, receipt: { roundId } });
    expect((await alex.client.query(api.rounds.today, {})).ownOriginal).toMatchObject({ durationMs: 3000, thumbnailAssetId: null });
    await expect(playback(blair.client, published.originalId!, "original")).rejects.toThrow("NOT_FOUND");
    const b = await begin(blair.client, roundId);
    expect((await upload(blair.client, b.uploadUrl, media["native-stereo.mp4"])).status).toBe(200);
    expect(await blair.client.action(api.uploads.finalize, { uploadId: b.uploadId })).toMatchObject({ state: "published" });
    const grant = await playback(blair.client, published.originalId!, "original");
    const full = await t.fetch(path(grant.url));
    expect(full.status).toBe(200);
    expect(full.headers.get("Location")).toBeNull();
    expect(full.headers.get("Cache-Control")).toContain("no-store");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(media[name]);
    const partial = await t.fetch(path(grant.url), { headers: { Range: "bytes=4-20" } });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(media[name].subarray(4, 21));
    await expect(playback(blair.client, published.originalId!, "original", "thumbnail")).rejects.toThrow("NOT_FOUND");
    await alex.client.mutation(api.friends.remove, { userId: blair.profile.id });
    expect((await t.fetch(path(grant.url))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects short, overlong, malformed, unsupported-codec and truncated stored clips without a receipt", async () => {
    const t = liveBackend(); const roundId = await round(t);
    const invalid = ["one-second.mp4", "below-minimum.mp4", "below-minimum-submillisecond.mp4", "below-minimum-offset.mp4", "over-limit.mp4", "truncated.mp4", "fake-duration.mp4", "wrong-video.mp4", "wrong-audio.mp4"];
    for (const [index, name] of invalid.entries()) {
      const owner = await user(t, `invalid_${index}`); const intent = await begin(owner.client, roundId);
      expect((await upload(owner.client, intent.uploadUrl, media[name])).status).toBe(200);
      expect(await owner.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", receipt: null, failure: { code: "INVALID_MEDIA", retryable: false } });
      expect(await owner.client.query(api.rounds.today, {})).toMatchObject({ canViewFriends: false, viewerReceipt: null, ownOriginal: null });
    }
    expect(await t.run(async ctx => ({ receipts: await ctx.db.query("submissionReceipts").collect(), originals: await ctx.db.query("originalTakes").collect() }))).toEqual({ receipts: [], originals: [] });
  });

  it.each(["valid.mp4", "at-minimum-600.mp4", "at-minimum-offset.mp4", "at-limit.mp4", "at-limit-600.mp4", "rotated.mp4", "no-audio.mp4", "silent.mp4"])("checks real sample tables and supported format without a decoder: %s", async name => {
    const result = await verifyVideo(bytes(media[name]), hash(media[name]));
    expect(result.durationMs).toBeGreaterThanOrEqual(3000);
    expect(result.durationMs).toBeLessThanOrEqual(15000);
    expect(result.width).toBeLessThan(result.height);
    expect(result.thumbnail).toBeNull();
  });

  it("binds actual parsed bytes to the object's hash", async () => {
    await expect(verifyVideo(bytes(media["native-stereo.mp4"]), "0".repeat(64))).rejects.toThrow("INVALID_MEDIA");
    await expect(verifyAvatar(bytes(media["avatar.jpg"]), "0".repeat(64))).rejects.toThrow("INVALID_MEDIA");
  });

  it("rejects a video edit pointing beyond the actual sample presentation extent", async () => {
    const invalid = Buffer.from(fixtureBytes);
    invalid.writeInt32BE(2147483647, invalid.indexOf("elst") + 16);
    expect(hash(invalid)).toBe("74709e83c4c1394cb84b5d21e404529a7a8bf8e1f69bd5bdbae6aded91f5803b");
    await expect(verifyVideo(bytes(invalid), hash(invalid))).rejects.toThrow("INVALID_MEDIA");
  });

  it.each([["moov", -4], ["stco", 12], ["stsc", 8], ["stsz", 12], ["stts", 12]])("rejects out-of-bounds %s sizes, counts or offsets", async (box, offset) => {
    const malformed = Buffer.from(media["valid.mp4"]);
    const start = malformed.indexOf(box);
    expect(start).toBeGreaterThan(0);
    malformed.writeUInt32BE(0xffffffff, start + offset);
    await expect(verifyVideo(bytes(malformed), hash(malformed))).rejects.toThrow("INVALID_MEDIA");
  });

  it.each(["corrupt.png", "corrupt.jpg", "concatenated.jpg", "unknown-critical.png", "separated-idat.png", "avatar.gif", "animated.png", "large.png", "large.jpg"])("rejects structurally invalid avatar %s", async name => {
    await expect(verifyAvatar(bytes(media[name]), hash(media[name]))).rejects.toThrow("INVALID_MEDIA");
  });

  it("accepts the 2048px avatar dimension boundary without changing image bytes", async () => {
    const value = media["at-dimension-limit.png"];
    const result = await verifyAvatar(bytes(value), hash(value));
    expect(result).toMatchObject({ width: 2048, height: 2048, mimeType: "image/png" });
    expect(Buffer.from(result.image)).toEqual(value);
  });

  it("rejects oversized uploads and avatar dimensions before publication", async () => {
    const video = Buffer.alloc(8 * 1024 * 1024 + 1);
    const avatar = Buffer.alloc(2 * 1024 * 1024 + 1);
    await expect(verifyVideo(bytes(video), hash(video))).rejects.toThrow("INVALID_MEDIA");
    await expect(verifyAvatar(bytes(avatar), hash(avatar))).rejects.toThrow("INVALID_MEDIA");
    const jpeg = Buffer.from(media["avatar.jpg"]);
    const frame = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
    expect(frame).toBeGreaterThan(0);
    jpeg.writeUInt16BE(2049, frame + 7);
    await expect(verifyAvatar(bytes(jpeg), hash(jpeg))).rejects.toThrow("INVALID_MEDIA");
  });

  it.each([["avatar.jpg", "image/jpeg"], ["avatar.png", "image/png"]])("validates real %s avatars and preserves ownership, exact bytes and MIME", async (name, mime) => {
    const t = liveBackend(); const alex = await user(t, "alex"); const blair = await user(t, "blair");
    const intent = await alex.client.mutation(api.profiles.beginAvatarUpload, { requestId: "actual-avatar-integration" });
    expect((await upload(blair.client, intent.uploadUrl, media[name], mime)).status).toBe(404);
    expect((await upload(alex.client, intent.uploadUrl, media[name], mime)).status).toBe(200);
    await expect(blair.client.mutation(api.profiles.update, { displayName: "Blair", avatarUploadId: intent.uploadId })).rejects.toThrow("NOT_FOUND");
    const profile = await alex.client.mutation(api.profiles.update, { displayName: "Alex", avatarUploadId: intent.uploadId });
    const response = await t.fetch(path(profile.avatar!.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(mime);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(media[name]);
    const stored = await t.run(async ctx => ({ profile: await ctx.db.get(alex.profile.id), assets: await ctx.db.system.query("_storage").collect() }));
    expect(stored.profile!.avatarWidth).toBeGreaterThan(0);
    expect(stored.profile!.avatarWidth).toBeLessThanOrEqual(2048);
    expect(stored.assets).toHaveLength(1);
    expect(stored.assets[0].size).toBe(media[name].length);
    expect(fetch).not.toHaveBeenCalled();
  });
});
