import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setup, user, round, begin, send, publish, matrix } from "./helpers";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("trusted publication transactions", () => {
  it("does not unlock on selection, intent, bytes, validation outage, or invalid media; retries are real", async () => {
    const t = setup();
    const alex = await user(t, "alex");
    const id = await round(t);
    const intent = await begin(alex.client, id);
    expect((await alex.client.query(api.rounds.today, {})).canViewFriends).toBe(false);
    await expect(alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).rejects.toThrow("INVALID_MEDIA");
    expect((await send(alex.client, intent)).status).toBe(200);
    expect((await alex.client.query(api.rounds.today, {})).viewerReceipt).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const failed = await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId });
    expect(failed).toMatchObject({ state: "failed", failure: { code: "PROCESSING_UNAVAILABLE", retryable: true }, receipt: null });
    expect((await alex.client.query(api.rounds.today, {})).canViewFriends).toBe(false);
    const retry = await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId });
    expect(retry).toMatchObject({ state: "published", failure: null });
    expect((await alex.client.query(api.uploads.status, { uploadId: intent.uploadId })).progress).toBe(1);
    expect(await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toEqual(retry);
    const blair = await user(t, "blair");
    const invalid = await begin(blair.client, id);
    await send(blair.client, invalid);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("invalid", { status: 422 }));
    expect(await blair.client.action(api.uploads.finalize, { uploadId: invalid.uploadId })).toMatchObject({ state: "failed", failure: { code: "INVALID_MEDIA", retryable: false } });
    expect((await blair.client.query(api.rounds.today, {})).viewerReceipt).toBeNull();
  });

  it("fails closed without a verifier and rejects forged duration/hash metadata", async () => {
    const t = setup();
    const alex = await user(t, "alex");
    const id = await round(t);
    const intent = await begin(alex.client, id);
    await send(alex.client, intent);
    vi.stubEnv("MEDIA_VERIFIER_SECRET", "");
    expect(await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", failure: { code: "PROCESSING_UNAVAILABLE" } });
    vi.stubEnv("MEDIA_VERIFIER_SECRET", "test-only-verifier-secret-not-a-credential");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ sha256: "forged", durationMs: 1, width: 360, height: 640, videoCodec: "h264", audioCodec: "aac" }));
    expect(await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", failure: { code: "INVALID_MEDIA" } });
    expect((await alex.client.query(api.rounds.today, {})).canViewFriends).toBe(false);
    const second = await begin(alex.client, id);
    await send(alex.client, second);
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => Response.json({ sha256: new Headers(init?.headers).get("X-Content-SHA256"), durationMs: 15000.001, width: 360, height: 640, videoCodec: "h264", audioCodec: "aac" }));
    expect(await alex.client.action(api.uploads.finalize, { uploadId: second.uploadId })).toMatchObject({ state: "failed", failure: { code: "INVALID_MEDIA" } });
  });

  it("binds owner-authenticated bytes once, not a client-chosen storage ID; cancels and expires safely", async () => {
    const t = setup();
    const alex = await user(t, "alex");
    const blair = await user(t, "blair");
    const id = await round(t);
    const intent = await begin(alex.client, id, null, "dedupe-request-123");
    expect(await begin(alex.client, id, null, "dedupe-request-123")).toEqual(intent);
    await expect(blair.client.query(api.uploads.status, { uploadId: intent.uploadId })).rejects.toThrow("NOT_FOUND");
    expect((await send(blair.client, intent)).status).toBe(404);
    expect((await t.fetch(new URL(intent.uploadUrl).pathname, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: "bad" })).status).toBe(401);
    expect((await send(alex.client, intent)).status).toBe(200);
    expect((await send(alex.client, intent)).status).toBe(409);
    await expect(alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId, storageId: "forged" } as never)).rejects.toThrow();
    await alex.client.mutation(api.uploads.cancel, { uploadId: intent.uploadId });
    expect(await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", failure: { code: "CANCELLED" } });
    const expired = await begin(alex.client, id);
    vi.setSystemTime(Date.now() + 600001);
    expect((await send(alex.client, expired)).status).toBe(422);
    expect(await alex.client.action(api.uploads.finalize, { uploadId: expired.uploadId })).toMatchObject({ state: "failed", failure: { code: "UPLOAD_EXPIRED" } });
    expect((await alex.client.query(api.rounds.today, {})).viewerReceipt).toBeNull();
  });

  it("serializes duplicate and competing finalizations to one immutable original and one receipt", async () => {
    const t = setup();
    const alex = await user(t, "alex");
    const id = await round(t);
    const a = await begin(alex.client, id);
    const b = await begin(alex.client, id);
    await send(alex.client, a); await send(alex.client, b);
    const results = await Promise.all([a, a, b].map(intent => alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })));
    expect(results.some(result => result.state === "published")).toBe(true);
    const data = await t.run(async ctx => ({ originals: await ctx.db.query("originalTakes").collect(), receipts: await ctx.db.query("submissionReceipts").collect() }));
    expect(data.originals).toHaveLength(1); expect(data.receipts).toHaveLength(1);
    const winner = results.find(result => result.state === "published")!;
    const winningIntent = data.originals[0]._id === (await alex.client.action(api.uploads.finalize, { uploadId: a.uploadId })).originalId ? a : b;
    expect(await alex.client.action(api.uploads.finalize, { uploadId: winningIntent.uploadId })).toEqual(winner);
    await expect(begin(alex.client, id)).rejects.toThrow("ALREADY_PUBLISHED");
  });

  it("rechecks relationships and round in the final transaction after verifier work", async () => {
    const t = setup();
    const m = await matrix(t);
    const intent = await begin(m.blair.client, m.roundId, m.original.originalId);
    await send(m.blair.client, intent);
    const defaultVerifier = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
      await m.alex.client.mutation(api.friends.remove, { userId: m.blair.profile.id });
      return defaultVerifier(input, init);
    });
    expect(await m.blair.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", failure: { code: "NOT_FOUND" }, receipt: null });
    const locked = await begin(m.locked.client, m.roundId);
    await send(m.locked.client, locked);
    vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
      vi.setSystemTime(Date.now() + 1000); await round(t, "successor");
      return defaultVerifier(input, init);
    });
    expect(await m.locked.client.action(api.uploads.finalize, { uploadId: locked.uploadId })).toMatchObject({ state: "failed", failure: { code: "ROUND_CLOSED" } });
    expect((await m.locked.client.query(api.rounds.today, {})).canViewFriends).toBe(false);
  });

  it("deletes a conversation and media while retaining its unique successful receipt and unlock", async () => {
    const t = setup();
    const m = await matrix(t);
    await m.alex.client.mutation(api.takes.delete, { id: m.original.originalId });
    expect(await m.alex.client.query(api.rounds.today, {})).toMatchObject({ canViewFriends: true, ownOriginal: null, viewerReceipt: { originalId: null, roundId: m.roundId } });
    await expect(begin(m.alex.client, m.roundId)).rejects.toThrow("ALREADY_PUBLISHED");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const remaining = await t.run(async ctx => ({ original: await ctx.db.get(m.original.originalId), reply: await ctx.db.get(m.reply.replyId) }));
    expect(remaining).toEqual({ original: null, reply: null });
    const retried = await m.alex.client.action(api.uploads.finalize, { uploadId: m.original.intent.uploadId });
    expect(retried).toMatchObject({ state: "published", receipt: { originalId: null } });
  });

  it("retries a lost processing lease but never replaces already bound bytes", async () => {
    const t = setup();
    const alex = await user(t, "alex");
    const id = await round(t);
    const intent = await begin(alex.client, id); await send(alex.client, intent);
    const claim = await alex.client.mutation(internal.uploads.claimFinalization, { uploadId: intent.uploadId, lease: "lost-test-lease" });
    expect(claim.upload).not.toBeNull();
    expect(await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "processing", receipt: null });
    vi.setSystemTime(Date.now() + 120001);
    expect(await alex.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "published" });
    expect((await send(alex.client, intent)).status).not.toBe(200);
  });
});
