import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { setup, matrix, playback, path, round, begin, publish, user, befriend } from "./helpers";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("server content visibility", () => {
  it("paginates only approved content and reveals no strangers' publication activity through cursors", async () => {
    const t = setup(); const alex = await user(t, "alex"); const id = await round(t);
    await publish(alex.client, id);
    for (let i = 0; i < 9; i++) {
      const friend = await user(t, `friend${i}`);
      await befriend(alex.client, alex.profile.id, friend.client, friend.profile.id);
      await publish(friend.client, id);
    }
    const before = await alex.client.query(api.takes.feed, { roundId: id, cursor: null, limit: 20 });
    expect(before.items).toHaveLength(8); expect(before.nextCursor).not.toBeNull();
    for (let i = 0; i < 12; i++) { const stranger = await user(t, `stranger${i}`); await publish(stranger.client, id); }
    expect(await alex.client.query(api.takes.feed, { roundId: id, cursor: null, limit: 20 })).toEqual(before);
    expect((await alex.client.query(api.takes.feed, { roundId: id, cursor: before.nextCursor, limit: 20 })).items).toHaveLength(2);
  });
  it("does not return opinions, media, captions, or direct-ID content to locked or pending viewers", async () => {
    const t = setup();
    const m = await matrix(t);
    const today = await m.locked.client.query(api.rounds.today, {});
    expect(today).toMatchObject({ canViewFriends: false, viewerReceipt: null, ownOriginal: null });
    expect(today.friendPresence.map(item => item.hasPublished)).toEqual([true]);
    const serialized = JSON.stringify(today);
    for (const field of ["optionId", "thumbnailAssetId", "durationMs", "storageId", "caption", "replyId"]) expect(serialized).not.toContain(field);
    for (const client of [m.locked.client, m.pending.client]) {
      expect((await client.query(api.takes.feed, { roundId: m.roundId, cursor: null, limit: 20 })).items.map(item => item.author.id)).not.toContain(m.alex.profile.id);
      await expect(client.query(api.takes.detail, { originalId: m.original.originalId })).rejects.toThrow("NOT_FOUND");
      await expect(client.query(api.replies.list, { originalId: m.original.originalId, cursor: null, limit: 20 })).rejects.toThrow("NOT_FOUND");
      await expect(client.query(api.captions.get, { contentId: m.original.originalId, kind: "original" })).rejects.toThrow("NOT_FOUND");
      for (const asset of ["video", "thumbnail"] as const) await expect(playback(client, m.original.originalId, "original", asset)).rejects.toThrow("NOT_FOUND");
    }
    expect((await t.fetch(`/v1/media/${m.original.originalId}?token=${"0".repeat(64)}`)).status).toBe(404);
  });

  it("enforces Casey-visible and Dana-hidden in lists, visible counts, direct IDs, captions and both media assets", async () => {
    const t = setup();
    const m = await matrix(t);
    const caseyDetail = await m.casey.client.query(api.takes.detail, { originalId: m.original.originalId });
    const danaDetail = await m.dana.client.query(api.takes.detail, { originalId: m.original.originalId });
    expect(caseyDetail.visibleReplyCount).toBe(1);
    expect(danaDetail.visibleReplyCount).toBe(0);
    expect((await m.casey.client.query(api.replies.list, { originalId: m.original.originalId, cursor: null, limit: 50 })).items.map(item => item.id)).toEqual([m.reply.replyId]);
    expect(await m.dana.client.query(api.replies.list, { originalId: m.original.originalId, cursor: null, limit: 50 })).toEqual({ items: [], nextCursor: null });
    expect(await m.casey.client.query(api.captions.get, { contentId: m.reply.replyId, kind: "reply" })).toEqual({ status: "unavailable", text: null });
    for (const client of [m.dana.client, m.ellis.client, m.locked.client]) {
      await expect(client.query(api.captions.get, { contentId: m.reply.replyId, kind: "reply" })).rejects.toThrow("NOT_FOUND");
      for (const asset of ["video", "thumbnail"] as const) await expect(playback(client, m.reply.replyId, "reply", asset)).rejects.toThrow("NOT_FOUND");
    }
    await expect(m.ellis.client.query(api.takes.detail, { originalId: m.original.originalId })).rejects.toThrow("NOT_FOUND");
    for (const asset of ["video", "thumbnail"] as const) {
      const grant = await playback(m.casey.client, m.reply.replyId, "reply", asset);
      expect((await t.fetch(path(grant.url))).status).toBe(200);
    }
    const feed = await m.casey.client.query(api.takes.feed, { roundId: m.roundId, cursor: null, limit: 50 });
    expect(feed.items.map(item => item.id)).toContain(m.original.originalId);
    expect(feed.items.map(item => item.id)).not.toContain(m.reply.replyId);
    expect(feed.items.every(item => "optionId" in item && !("originalId" in item))).toBe(true);
  });

  it("revokes existing grants and interactions on remove/block, including the participants' edge", async () => {
    const t = setup();
    const m = await matrix(t);
    const grant = await playback(m.casey.client, m.reply.replyId, "reply");
    await m.casey.client.mutation(api.friends.remove, { userId: m.blair.profile.id });
    expect((await t.fetch(path(grant.url))).status).toBe(404);
    expect((await m.casey.client.query(api.takes.detail, { originalId: m.original.originalId })).visibleReplyCount).toBe(0);
    const ownGrant = await playback(m.blair.client, m.reply.replyId, "reply");
    await m.alex.client.mutation(api.blocks.set, { userId: m.blair.profile.id, blocked: true });
    expect((await t.fetch(path(ownGrant.url))).status).toBe(404);
    await expect(playback(m.alex.client, m.reply.replyId, "reply")).rejects.toThrow("NOT_FOUND");
    await expect(begin(m.blair.client, m.roundId, m.original.originalId)).rejects.toThrow("NOT_FOUND");
    await expect(m.blair.client.query(api.takes.detail, { originalId: m.original.originalId })).rejects.toThrow("NOT_FOUND");
    await expect(m.blair.client.mutation(api.friends.request, { userId: m.alex.profile.id })).rejects.toThrow("NOT_FOUND");
    await m.blair.client.mutation(api.replies.delete, { id: m.reply.replyId });
  });

  it("relocks on the successor's actual opening, while owners retain their own historical originals", async () => {
    const t = setup();
    const m = await matrix(t);
    const friendGrant = await playback(m.casey.client, m.original.originalId, "original");
    const ownerGrant = await playback(m.alex.client, m.original.originalId, "original");
    vi.setSystemTime(Date.now() + 1000);
    const next = await round(t, "round-two");
    expect((await m.casey.client.query(api.rounds.today, {})).canViewFriends).toBe(false);
    expect((await m.casey.client.query(api.takes.feed, { roundId: next, cursor: null, limit: 20 })).items).toEqual([]);
    expect((await t.fetch(path(friendGrant.url))).status).toBe(404);
    expect((await t.fetch(path(ownerGrant.url))).status).toBe(200);
    await expect(playback(m.casey.client, m.reply.replyId, "reply")).rejects.toThrow("NOT_FOUND");
    await publish(m.casey.client, next);
    await expect(m.casey.client.query(api.takes.detail, { originalId: m.original.originalId })).rejects.toThrow("NOT_FOUND");
    const history = await m.alex.client.query(api.profiles.mine, { cursor: null, limit: 20 });
    expect(history.originals.items.map(item => item.id)).toContain(m.original.originalId);
  });

  it("requires ordinary read access before reporting, and keeps reply management separate from parent access", async () => {
    const t = setup();
    const m = await matrix(t);
    await expect(m.dana.client.mutation(api.reports.create, { contentId: m.reply.replyId, kind: "reply", reason: "Harassment" })).rejects.toThrow("NOT_FOUND");
    expect(await m.casey.client.mutation(api.reports.create, { contentId: m.reply.replyId, kind: "reply", reason: "Harassment" })).toHaveProperty("id");
    await m.alex.client.mutation(api.takes.delete, { id: m.original.originalId });
    await expect(playback(m.blair.client, m.reply.replyId, "reply")).rejects.toThrow("NOT_FOUND");
    await expect(m.blair.client.query(api.replies.list, { originalId: m.original.originalId, cursor: null, limit: 20 })).rejects.toThrow("NOT_FOUND");
    await m.blair.client.mutation(api.replies.delete, { id: m.reply.replyId });
    await expect(m.casey.client.mutation(api.takes.delete, { id: m.original.originalId })).rejects.toThrow("NOT_FOUND");
  });
});
