import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { orderKey } from "../convex/lib/pagination";
import { setup, user, round, begin, send, publish, matrix, playback, path, type Actor } from "./helpers";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

let sequence = 0;
async function post(client: Actor, roundId: Id<"rounds">, options: { audience?: "friends" | "public"; optionId?: string; parent?: Id<"originalTakes"> } = {}) {
  const intent = await client.mutation(api.uploads.begin, {
    requestId: "public-test-request-" + ++sequence, roundId,
    kind: options.parent ? "reply" : "original", originalId: options.parent ?? null,
    optionId: options.parent ? null : options.optionId ?? "yes",
    ...(!options.parent ? { audience: options.audience ?? "public" } : {}),
  });
  expect((await send(client, intent)).status).toBe(200);
  const result = await client.action(api.uploads.finalize, { uploadId: intent.uploadId });
  expect(result).toMatchObject({ state: "published", failure: null });
  return { originalId: result.originalId as Id<"originalTakes">, replyId: result.replyId as Id<"videoReplies">, intent };
}
function forYou(client: Actor, roundId: Id<"rounds">, cursor: string | null = null, limit = 8) {
  return client.query(api.takes.forYou, { roundId, cursor, limit });
}
function commentList(client: Actor, contentId: string, kind: "original" | "reply" = "original", cursor: string | null = null, limit = 50) {
  return client.query(api.comments.list, { contentId, kind, cursor, limit });
}
function comment(client: Actor, contentId: string, text: string, kind: "original" | "reply" = "original") {
  return client.mutation(api.comments.create, { contentId, kind, text });
}
function like(client: Actor, contentId: string, kind: "original" | "reply" = "original") {
  return client.mutation(api.likes.toggle, { contentId, kind });
}
async function publicWorld() {
  const t = setup();
  const owner = await user(t, "owner");
  const responder = await user(t, "responder");
  const observer = await user(t, "observer");
  const locked = await user(t, "locked");
  const roundId = await round(t);
  const original = await post(owner.client, roundId);
  await publish(responder.client, roundId);
  await publish(observer.client, roundId);
  return { t, owner, responder, observer, locked, roundId, original };
}
async function battleWorld() {
  const t = setup();
  const left = await user(t, "left_author");
  const right = await user(t, "right_author");
  const voter = await user(t, "voter");
  const second = await user(t, "second_voter");
  const locked = await user(t, "locked");
  const roundId = await round(t);
  const a = await post(left.client, roundId, { optionId: "yes" });
  vi.setSystemTime(Date.now() + 10);
  const b = await post(right.client, roundId, { optionId: "no" });
  await publish(voter.client, roundId);
  await publish(second.client, roundId);
  const detail = await voter.client.query(api.takes.detail, { originalId: a.originalId });
  expect(detail.battle).not.toBeNull();
  return { t, left, right, voter, second, locked, roundId, a, b, battleId: detail.battle!.battleId };
}

describe("v4 audience and public authorization", () => {
  it("defaults originals to friends, returns the new limits and binds audience immutably to an intent", async () => {
    const t = setup();
    const owner = await user(t, "owner");
    const roundId = await round(t);
    const intent = await begin(owner.client, roundId, null, "immutable-audience-request");
    expect(intent).toMatchObject({ minDurationMs: 3000, maxDurationMs: 15000, maxBytes: 8 * 1024 * 1024 });
    expect(await owner.client.mutation(api.uploads.begin, { requestId: "immutable-audience-request", kind: "original", roundId, originalId: null, optionId: "yes", audience: "friends" })).toEqual(intent);
    await expect(owner.client.mutation(api.uploads.begin, { requestId: "immutable-audience-request", kind: "original", roundId, originalId: null, optionId: "yes", audience: "public" })).rejects.toThrow("CONFLICT");
    await send(owner.client, intent);
    const result = await owner.client.action(api.uploads.finalize, { uploadId: intent.uploadId });
    expect(result.state).toBe("published");
    expect(await owner.client.query(api.takes.detail, { originalId: result.originalId! })).toMatchObject({ audience: "friends", battle: null, likeCount: 0, viewerLiked: false, visibleCommentCount: 0 });
    await expect(owner.client.action(api.uploads.finalize, { uploadId: intent.uploadId, audience: "public" } as never)).rejects.toThrow();
  });

  it("never exposes friends originals through For You, battles, direct ids, captions, interactions or grants", async () => {
    const t = setup();
    const owner = await user(t, "private_owner");
    const stranger = await user(t, "stranger");
    const publicAuthor = await user(t, "public_author");
    const roundId = await round(t);
    const original = await publish(owner.client, roundId);
    const a = await post(stranger.client, roundId, { optionId: "yes" });
    const b = await post(publicAuthor.client, roundId, { optionId: "no" });
    const page = await forYou(stranger.client, roundId);
    expect(page.items.map(item => item.id)).toEqual([b.originalId]);
    expect(await owner.client.query(api.takes.detail, { originalId: original.originalId })).toMatchObject({ audience: "friends", battle: null });
    await expect(stranger.client.query(api.takes.detail, { originalId: original.originalId })).rejects.toThrow("NOT_FOUND");
    await expect(stranger.client.query(api.replies.list, { originalId: original.originalId, cursor: null, limit: 50 })).rejects.toThrow("NOT_FOUND");
    await expect(stranger.client.query(api.captions.get, { contentId: original.originalId, kind: "original" })).rejects.toThrow("NOT_FOUND");
    await expect(commentList(stranger.client, original.originalId)).rejects.toThrow("NOT_FOUND");
    await expect(comment(stranger.client, original.originalId, "Must stay private")).rejects.toThrow("NOT_FOUND");
    await expect(like(stranger.client, original.originalId)).rejects.toThrow("NOT_FOUND");
    await expect(playback(stranger.client, original.originalId, "original")).rejects.toThrow("NOT_FOUND");
    await expect(playback(stranger.client, original.originalId, "original", "thumbnail")).rejects.toThrow("NOT_FOUND");
    const publicSummary = await stranger.client.query(api.takes.detail, { originalId: a.originalId });
    const battle = await stranger.client.query(api.battles.get, { battleId: publicSummary.battle!.battleId });
    expect([battle.left.id, battle.right.id]).toEqual([a.originalId, b.originalId]);
    expect(JSON.stringify(battle)).not.toContain(original.originalId);
  });

  it("treats missing legacy audience fields as friends on intents and published content", async () => {
    const t = setup(); const owner = await user(t, "owner"); const stranger = await user(t, "stranger");
    const roundId = await round(t);
    const intent = await begin(owner.client, roundId, null, "legacy-upload-request");
    await t.run(async ctx => { await ctx.db.patch(intent.uploadId, { audience: undefined }); });
    await expect(owner.client.mutation(api.uploads.begin, { requestId: "legacy-upload-request", kind: "original", roundId, originalId: null, optionId: "yes", audience: "public" })).rejects.toThrow("CONFLICT");
    await send(owner.client, intent);
    const published = await owner.client.action(api.uploads.finalize, { uploadId: intent.uploadId });
    await t.run(async ctx => { await ctx.db.patch(published.originalId as Id<"originalTakes">, { audience: undefined, orderKey: undefined }); });
    await publish(stranger.client, roundId);
    expect(await owner.client.query(api.takes.detail, { originalId: published.originalId! })).toMatchObject({ audience: "friends", battle: null });
    expect(await forYou(stranger.client, roundId)).toEqual({ items: [], nextCursor: null });
    await expect(stranger.client.query(api.takes.detail, { originalId: published.originalId! })).rejects.toThrow("NOT_FOUND");
    await expect(playback(stranger.client, published.originalId!, "original")).rejects.toThrow("NOT_FOUND");
  });

  it("returns only visible public originals newest first, excludes self and locks until actual publication", async () => {
    const t = setup();
    const a = await user(t, "author_a"); const b = await user(t, "author_b"); const viewer = await user(t, "viewer");
    const roundId = await round(t);
    const first = await post(a.client, roundId);
    vi.setSystemTime(Date.now() + 10);
    const second = await post(b.client, roundId);
    expect(await forYou(viewer.client, roundId)).toEqual({ items: [], nextCursor: null });
    const pending = await begin(viewer.client, roundId);
    await send(viewer.client, pending);
    expect(await forYou(viewer.client, roundId)).toEqual({ items: [], nextCursor: null });
    await viewer.client.action(api.uploads.finalize, { uploadId: pending.uploadId });
    const page = await forYou(viewer.client, roundId, null, 1);
    expect(page.items.map(item => item.id)).toEqual([second.originalId]);
    expect(page.items[0].author).toMatchObject({ username: "author_b", displayName: "Author_b" });
    expect(page.nextCursor).not.toBeNull();
    const last = await forYou(viewer.client, roundId, page.nextCursor, 1);
    expect(last.items.map(item => item.id)).toEqual([first.originalId]);
    expect(last.nextCursor).toBeNull();
    expect((await viewer.client.query(api.takes.feed, { roundId, cursor: null, limit: 8 })).items.map(item => item.author.id)).toEqual([viewer.profile.id]);
    await expect(t.query(api.takes.forYou, { roundId, cursor: null, limit: 8 })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("inherits a public reply audience without friendship and rejects every explicit reply audience", async () => {
    const w = await publicWorld();
    for (const audience of ["friends", "public"] as const) {
      await expect(w.responder.client.mutation(api.uploads.begin, { requestId: "forbidden-reply-audience-" + audience, roundId: w.roundId, kind: "reply", originalId: w.original.originalId, optionId: null, audience })).rejects.toThrow("INVALID_ARGUMENT");
    }
    const response = await post(w.responder.client, w.roundId, { parent: w.original.originalId });
    const replies = await w.observer.client.query(api.replies.list, { originalId: w.original.originalId, cursor: null, limit: 50 });
    expect(replies.items).toHaveLength(1);
    expect(replies.items[0]).toMatchObject({ id: response.replyId, audience: "public", likeCount: 0, viewerLiked: false, visibleCommentCount: 0 });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ audience: "public", visibleReplyCount: 1 });
    expect(await w.observer.client.query(api.captions.get, { contentId: response.replyId, kind: "reply" })).toEqual({ status: "unavailable", text: null });
    const grant = await playback(w.observer.client, response.replyId, "reply");
    expect((await w.t.fetch(path(grant.url))).status).toBe(200);
    await expect(w.locked.client.query(api.replies.list, { originalId: w.original.originalId, cursor: null, limit: 50 })).rejects.toThrow("NOT_FOUND");
    await expect(playback(w.locked.client, response.replyId, "reply")).rejects.toThrow("NOT_FOUND");
  });

  it("retains friends reply audiences and refuses audience escalation on private parents", async () => {
    const t = setup(); const m = await matrix(t);
    const list = await m.casey.client.query(api.replies.list, { originalId: m.original.originalId, cursor: null, limit: 50 });
    expect(list.items[0]).toMatchObject({ id: m.reply.replyId, audience: "friends" });
    await expect(m.blair.client.mutation(api.uploads.begin, { requestId: "escalate-private-reply", kind: "reply", roundId: m.roundId, originalId: m.original.originalId, optionId: null, audience: "public" })).rejects.toThrow("INVALID_ARGUMENT");
    expect(await forYou(m.casey.client, m.roundId)).toEqual({ items: [], nextCursor: null });
  });

  it("checks the exact publication round rather than any receipt and keeps old friends content private", async () => {
    const t = setup(); const author = await user(t, "author"); const viewer = await user(t, "viewer"); const other = await user(t, "other");
    const firstRound = await round(t);
    const original = await post(author.client, firstRound);
    await publish(viewer.client, firstRound);
    vi.setSystemTime(Date.now() + 1000);
    const secondRound = await round(t, "second-round");
    await publish(other.client, secondRound);
    await expect(other.client.query(api.takes.detail, { originalId: original.originalId })).rejects.toThrow("NOT_FOUND");
    await expect(playback(other.client, original.originalId, "original")).rejects.toThrow("NOT_FOUND");
    expect(await viewer.client.query(api.takes.detail, { originalId: original.originalId })).toMatchObject({ id: original.originalId, audience: "public" });
    expect(await forYou(viewer.client, firstRound)).toEqual({ items: [], nextCursor: null });
  });

  it.each(["viewer", "author"] as const)("revokes public reads and existing HTTP grants for a block initiated by %s", async blocker => {
    const w = await publicWorld();
    const grant = await playback(w.observer.client, w.original.originalId, "original");
    const thumbnail = await playback(w.observer.client, w.original.originalId, "original", "thumbnail");
    const a = blocker === "viewer" ? w.observer : w.owner;
    const b = blocker === "viewer" ? w.owner : w.observer;
    await a.client.mutation(api.blocks.set, { userId: b.profile.id, blocked: true });
    expect(await forYou(w.observer.client, w.roundId)).toEqual({ items: [], nextCursor: null });
    await expect(w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).rejects.toThrow("NOT_FOUND");
    await expect(like(w.observer.client, w.original.originalId)).rejects.toThrow("NOT_FOUND");
    await expect(comment(w.observer.client, w.original.originalId, "Hidden")).rejects.toThrow("NOT_FOUND");
    await expect(playback(w.observer.client, w.original.originalId, "original")).rejects.toThrow("NOT_FOUND");
    expect((await w.t.fetch(path(grant.url))).status).toBe(404);
    expect((await w.t.fetch(path(thumbnail.url))).status).toBe(404);
  });

  it("hides blocked or disabled public reply/comment authors before counts, cursors, reports and bytes", async () => {
    const w = await publicWorld();
    const response = await post(w.responder.client, w.roundId, { parent: w.original.originalId });
    const hidden = await comment(w.responder.client, w.original.originalId, "A public comment");
    const visible = await comment(w.owner.client, w.original.originalId, "The visible comment");
    const grant = await playback(w.observer.client, response.replyId, "reply");
    await w.responder.client.mutation(api.blocks.set, { userId: w.observer.profile.id, blocked: true });
    const summary = await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId });
    expect(summary).toMatchObject({ visibleReplyCount: 0, visibleCommentCount: 1 });
    expect(await w.observer.client.query(api.replies.list, { originalId: w.original.originalId, cursor: null, limit: 1 })).toEqual({ items: [], nextCursor: null });
    const comments = await commentList(w.observer.client, w.original.originalId, "original", null, 1);
    expect(comments.items.map(item => item.commentId)).toEqual([visible.commentId]);
    expect(comments.nextCursor).toBeNull();
    expect(JSON.stringify(comments)).not.toContain(hidden.commentId);
    await expect(w.observer.client.mutation(api.reports.create, { contentId: hidden.commentId, kind: "comment", reason: "Hidden comment" })).rejects.toThrow("NOT_FOUND");
    await expect(like(w.observer.client, response.replyId, "reply")).rejects.toThrow("NOT_FOUND");
    expect((await w.t.fetch(path(grant.url))).status).toBe(404);
    await w.responder.client.mutation(api.blocks.set, { userId: w.observer.profile.id, blocked: false });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ visibleReplyCount: 1, visibleCommentCount: 2 });
    await w.t.run(async ctx => { await ctx.db.patch(w.responder.profile.id, { status: "disabled" }); });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ visibleReplyCount: 0, visibleCommentCount: 1 });
  });

  it("rechecks public reply blocks after verification before committing", async () => {
    const w = await publicWorld();
    const intent = await begin(w.responder.client, w.roundId, w.original.originalId);
    await send(w.responder.client, intent);
    const verifier = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
      await w.owner.client.mutation(api.blocks.set, { userId: w.responder.profile.id, blocked: true });
      return verifier(input, init);
    });
    expect(await w.responder.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", replyId: null, failure: { code: "NOT_FOUND" } });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ visibleReplyCount: 0 });
  });

  it("rejects below-minimum trusted verifier output without a successful receipt", async () => {
    const t = setup(); const owner = await user(t, "owner"); const roundId = await round(t);
    const intent = await begin(owner.client, roundId); await send(owner.client, intent);
    vi.mocked(fetch).mockImplementationOnce(async (_input, init) => Response.json({ sha256: new Headers(init?.headers).get("X-Content-SHA256"), durationMs: 2999.99, width: 360, height: 640, videoCodec: "h264", audioCodec: "aac" }));
    expect(await owner.client.action(api.uploads.finalize, { uploadId: intent.uploadId })).toMatchObject({ state: "failed", receipt: null, failure: { code: "INVALID_MEDIA", retryable: false } });
    expect(await owner.client.query(api.rounds.today, {})).toMatchObject({ canViewFriends: false, viewerReceipt: null, ownOriginal: null });
  });
});

describe("v4 likes and comments", () => {
  it("serializes one changeable like per viewer/item and never authorizes by a mismatched kind", async () => {
    const w = await publicWorld();
    const response = await post(w.responder.client, w.roundId, { parent: w.original.originalId });
    expect(await like(w.observer.client, w.original.originalId)).toEqual({ liked: true, likeCount: 1 });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ likeCount: 1, viewerLiked: true });
    expect(await w.owner.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ likeCount: 1, viewerLiked: false });
    expect(await like(w.observer.client, w.original.originalId)).toEqual({ liked: false, likeCount: 0 });
    await Promise.all([like(w.observer.client, w.original.originalId), like(w.observer.client, w.original.originalId)]);
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ likeCount: 0, viewerLiked: false });
    await like(w.observer.client, response.replyId, "reply");
    expect((await w.observer.client.query(api.replies.list, { originalId: w.original.originalId, cursor: null, limit: 50 })).items[0]).toMatchObject({ likeCount: 1, viewerLiked: true });
    await expect(like(w.observer.client, response.replyId, "original")).rejects.toThrow("NOT_FOUND");
    await expect(like(w.locked.client, response.replyId, "reply")).rejects.toThrow("NOT_FOUND");
    await expect(w.t.mutation(api.likes.toggle, { contentId: w.original.originalId, kind: "original" })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("trims and bounds plain comments, orders visible pagination and allows only the commenter/content author to delete", async () => {
    const w = await publicWorld();
    for (const text of [" ", "x".repeat(301), "bad\u0000text"]) await expect(comment(w.responder.client, w.original.originalId, text)).rejects.toThrow("INVALID_ARGUMENT");
    const first = await comment(w.responder.client, w.original.originalId, "  <b>plain text</b>  ");
    vi.setSystemTime(Date.now() + 1);
    const second = await comment(w.observer.client, w.original.originalId, "x".repeat(300));
    const page = await commentList(w.observer.client, w.original.originalId, "original", null, 1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ commentId: first.commentId, text: "<b>plain text</b>", viewerCanDelete: false, author: { username: "responder", displayName: "Responder" } });
    expect(page.nextCursor).not.toBeNull();
    const last = await commentList(w.observer.client, w.original.originalId, "original", page.nextCursor, 1);
    expect(last.items).toMatchObject([{ commentId: second.commentId, viewerCanDelete: true }]);
    expect(last.nextCursor).toBeNull();
    expect((await commentList(w.owner.client, w.original.originalId)).items.every(item => item.viewerCanDelete)).toBe(true);
    await expect(w.responder.client.mutation(api.comments.delete, { commentId: second.commentId })).rejects.toThrow("NOT_FOUND");
    const report = await w.observer.client.mutation(api.reports.create, { contentId: first.commentId, kind: "comment", reason: "An actual visible comment" });
    expect(report.id).toBeTruthy();
    await expect(w.locked.client.mutation(api.reports.create, { contentId: first.commentId, kind: "comment", reason: "Cannot see it" })).rejects.toThrow("NOT_FOUND");
    expect(await w.observer.client.mutation(api.comments.delete, { commentId: second.commentId })).toEqual({ ok: true });
    expect(await w.owner.client.mutation(api.comments.delete, { commentId: first.commentId })).toEqual({ ok: true });
    expect(await commentList(w.observer.client, w.original.originalId)).toEqual({ items: [], nextCursor: null });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ visibleCommentCount: 0 });
  });

  it("uses current private intersection visibility for comments and counts, including parent access and friendship revocation", async () => {
    const t = setup(); const m = await matrix(t);
    const byAuthor = await comment(m.alex.client, m.original.originalId, "From the original author");
    const byResponder = await comment(m.blair.client, m.original.originalId, "Only the intersection");
    expect((await commentList(m.casey.client, m.original.originalId)).items.map(item => item.commentId)).toEqual([byAuthor.commentId, byResponder.commentId]);
    const dana = await commentList(m.dana.client, m.original.originalId, "original", null, 1);
    expect(dana.items.map(item => item.commentId)).toEqual([byAuthor.commentId]);
    expect(dana.nextCursor).toBeNull();
    expect(await m.dana.client.query(api.takes.detail, { originalId: m.original.originalId })).toMatchObject({ visibleCommentCount: 1 });
    await expect(commentList(m.ellis.client, m.original.originalId)).rejects.toThrow("NOT_FOUND");
    await expect(commentList(m.locked.client, m.original.originalId)).rejects.toThrow("NOT_FOUND");
    const onReply = await comment(m.casey.client, m.reply.replyId, "This still needs the parent", "reply");
    await m.alex.client.mutation(api.friends.remove, { userId: m.blair.profile.id });
    expect((await commentList(m.casey.client, m.original.originalId)).items.map(item => item.commentId)).toEqual([byAuthor.commentId]);
    await expect(commentList(m.blair.client, m.reply.replyId, "reply")).rejects.toThrow("NOT_FOUND");
    await expect(m.casey.client.mutation(api.reports.create, { contentId: onReply.commentId, kind: "comment", reason: "Parent was revoked" })).rejects.toThrow("NOT_FOUND");
    await expect(m.casey.client.mutation(api.reports.create, { contentId: byResponder.commentId, kind: "comment", reason: "Commenter was revoked" })).rejects.toThrow("NOT_FOUND");
    expect(await m.blair.client.mutation(api.comments.delete, { commentId: byResponder.commentId })).toEqual({ ok: true });
    expect(await m.blair.client.mutation(api.comments.delete, { commentId: onReply.commentId })).toEqual({ ok: true });
  });

  it("counts comments beyond the page limit exactly and never returns a cursor for hidden commenters", async () => {
    const w = await publicWorld();
    let hiddenId: string | null = null;
    for (const [person, count] of [[w.responder, 20], [w.owner, 20], [w.observer, 16]] as const) {
      for (let index = 0; index < count; index++) {
        const created = await comment(person.client, w.original.originalId, person.profile.username + " " + index);
        if (person === w.responder) hiddenId = created.commentId;
      }
    }
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ visibleCommentCount: 56 });
    const first = await commentList(w.observer.client, w.original.originalId, "original", null, 999);
    expect(first.items).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    const last = await commentList(w.observer.client, w.original.originalId, "original", first.nextCursor, 999);
    expect(last.items).toHaveLength(6); expect(last.nextCursor).toBeNull();
    await w.observer.client.mutation(api.blocks.set, { userId: w.responder.profile.id, blocked: true });
    expect(await w.observer.client.query(api.takes.detail, { originalId: w.original.originalId })).toMatchObject({ visibleCommentCount: 36 });
    const filtered = await commentList(w.observer.client, w.original.originalId, "original", null, 999);
    expect(filtered.items).toHaveLength(36); expect(filtered.nextCursor).toBeNull();
    expect(filtered.items.every(item => item.author.id !== w.responder.profile.id)).toBe(true);
    await expect(commentList(w.observer.client, w.original.originalId, "original", hiddenId, 1)).rejects.toThrow("NOT_FOUND");
  });

  it("rate-limits comment creation per user even after deletion and resets only after the window", async () => {
    const w = await publicWorld();
    const first = await comment(w.responder.client, w.original.originalId, "First");
    for (let index = 1; index < 20; index++) await comment(w.responder.client, w.original.originalId, "Comment " + index);
    await w.responder.client.mutation(api.comments.delete, { commentId: first.commentId });
    await expect(comment(w.responder.client, w.original.originalId, "Over the limit")).rejects.toThrow("RATE_LIMITED");
    expect((await comment(w.observer.client, w.original.originalId, "Another user has a separate budget")).commentId).toBeTruthy();
    vi.setSystemTime(Date.now() + 60001);
    expect((await comment(w.responder.client, w.original.originalId, "New window")).commentId).toBeTruthy();
  });
});

describe("v4 battles and deletion cascades", () => {
  it("publishes and pages public takes despite a large unpaired same-option pool", async () => {
    const t = setup(); const seed = await user(t, "seed_author"); const newcomer = await user(t, "new_author"); const opponent = await user(t, "opponent");
    const roundId = await round(t);
    const first = await post(seed.client, roundId);
    await t.run(async ctx => {
      const source = (await ctx.db.get(first.originalId))!;
      const profile = (await ctx.db.get(seed.profile.id))!;
      const { _id: _userId, _creationTime: _userCreated, ...userFields } = profile;
      const { _id: _originalId, _creationTime: _originalCreated, ...originalFields } = source;
      for (let index = 0; index < 280; index++) {
        const authorId = await ctx.db.insert("users", { ...userFields, username: "seed_" + index, displayName: "Seed " + index });
        const publishedAt = source.publishedAt + index + 1;
        const id = await ctx.db.insert("originalTakes", { ...originalFields, authorId, publishedAt, orderKey: "" });
        await ctx.db.patch(id, { orderKey: orderKey(publishedAt, (await ctx.db.get(id))!._creationTime, id) });
        await ctx.db.insert("submissionReceipts", { userId: authorId, roundId, publishedAt, originalId: id });
      }
    });
    vi.setSystemTime(Date.now() + 1000);
    const published = await post(newcomer.client, roundId);
    expect(await newcomer.client.query(api.takes.detail, { originalId: published.originalId })).toMatchObject({ battle: null });
    expect((await forYou(newcomer.client, roundId, null, 999)).items).toHaveLength(8);
    const paired = await post(opponent.client, roundId, { optionId: "no" });
    const detail = await opponent.client.query(api.takes.detail, { originalId: paired.originalId });
    const battle = await opponent.client.query(api.battles.get, { battleId: detail.battle!.battleId });
    expect([battle.left.id, battle.right.id]).toEqual([first.originalId, paired.originalId]);
  });

  it("pairs the oldest eligible public opponent, never friends content or same-option takes", async () => {
    const t = setup();
    const a = await user(t, "author_a"); const b = await user(t, "author_b"); const c = await user(t, "author_c");
    const privateAuthor = await user(t, "private_author"); const d = await user(t, "author_d");
    const roundId = await round(t);
    const first = await post(a.client, roundId, { optionId: "yes" });
    vi.setSystemTime(Date.now() + 1);
    const second = await post(b.client, roundId, { optionId: "yes" });
    const privateTake = await post(privateAuthor.client, roundId, { audience: "friends", optionId: "no" });
    expect(await a.client.query(api.takes.detail, { originalId: first.originalId })).toMatchObject({ battle: null });
    const third = await post(c.client, roundId, { optionId: "no" });
    const paired = await c.client.query(api.takes.detail, { originalId: first.originalId });
    expect(paired.battle).toMatchObject({ opponent: { id: c.profile.id, username: "author_c" } });
    const battle = await c.client.query(api.battles.get, { battleId: paired.battle!.battleId });
    expect([battle.left.id, battle.right.id]).toEqual([first.originalId, third.originalId]);
    expect(await b.client.query(api.takes.detail, { originalId: second.originalId })).toMatchObject({ battle: null });
    const fourth = await post(d.client, roundId, { optionId: "no" });
    const other = await d.client.query(api.takes.detail, { originalId: second.originalId });
    const otherBattle = await d.client.query(api.battles.get, { battleId: other.battle!.battleId });
    expect([otherBattle.left.id, otherBattle.right.id]).toEqual([second.originalId, fourth.originalId]);
    expect(await privateAuthor.client.query(api.takes.detail, { originalId: privateTake.originalId })).toMatchObject({ audience: "friends", battle: null });
  });

  it("skips blocked pairing candidates in both directions and never pairs across rounds", async () => {
    const t = setup(); const a = await user(t, "author_a"); const b = await user(t, "author_b"); const c = await user(t, "author_c"); const d = await user(t, "author_d");
    const roundId = await round(t);
    const first = await post(a.client, roundId);
    const second = await post(b.client, roundId);
    await a.client.mutation(api.blocks.set, { userId: c.profile.id, blocked: true });
    const third = await post(c.client, roundId, { optionId: "no" });
    const paired = await c.client.query(api.takes.detail, { originalId: third.originalId });
    const battle = await c.client.query(api.battles.get, { battleId: paired.battle!.battleId });
    expect([battle.left.id, battle.right.id]).toEqual([second.originalId, third.originalId]);
    expect(await a.client.query(api.takes.detail, { originalId: first.originalId })).toMatchObject({ battle: null });
    vi.setSystemTime(Date.now() + 1000);
    const next = await round(t, "next-round");
    const otherRound = await post(d.client, next, { optionId: "no" });
    expect(await d.client.query(api.takes.detail, { originalId: otherRound.originalId })).toMatchObject({ battle: null });
  });

  it("authorizes both battle sides, refuses authors and serializes one changeable vote per viewer", async () => {
    const w = await battleWorld();
    expect(await w.voter.client.query(api.battles.get, { battleId: w.battleId })).toMatchObject({ leftVotes: 0, rightVotes: 0, viewerVote: null, viewerCanVote: true });
    for (const author of [w.left, w.right]) {
      expect(await author.client.query(api.battles.get, { battleId: w.battleId })).toMatchObject({ viewerCanVote: false });
      await expect(author.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })).rejects.toThrow("FORBIDDEN");
    }
    await expect(w.locked.client.query(api.battles.get, { battleId: w.battleId })).rejects.toThrow("NOT_FOUND");
    await expect(w.locked.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })).rejects.toThrow("NOT_FOUND");
    expect(await w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })).toEqual({ leftVotes: 1, rightVotes: 0, viewerVote: "left" });
    expect(await w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })).toEqual({ leftVotes: 1, rightVotes: 0, viewerVote: "left" });
    expect(await w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "right" })).toEqual({ leftVotes: 0, rightVotes: 1, viewerVote: "right" });
    await Promise.all([w.second.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" }), w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })]);
    expect(await w.voter.client.query(api.battles.get, { battleId: w.battleId })).toMatchObject({ leftVotes: 2, rightVotes: 0, viewerVote: "left" });
    await Promise.all([w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "right" }), w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })]);
    const after = await w.voter.client.query(api.battles.get, { battleId: w.battleId });
    expect(after.leftVotes + after.rightVotes).toBe(2);
  });

  it.each(["viewer", "author"] as const)("hides battle metadata, reads and voting after a %s blocks either side", async blocker => {
    const w = await battleWorld();
    if (blocker === "viewer") await w.voter.client.mutation(api.blocks.set, { userId: w.right.profile.id, blocked: true });
    else await w.right.client.mutation(api.blocks.set, { userId: w.voter.profile.id, blocked: true });
    expect(await w.voter.client.query(api.takes.detail, { originalId: w.a.originalId })).toMatchObject({ battle: null });
    await expect(w.voter.client.query(api.battles.get, { battleId: w.battleId })).rejects.toThrow("NOT_FOUND");
    await expect(w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "left" })).rejects.toThrow("NOT_FOUND");
    const page = await forYou(w.voter.client, w.roundId);
    expect(page.items.map(item => item.id)).toEqual([w.a.originalId]);
    expect(JSON.stringify(page)).not.toContain(w.battleId);
    expect(JSON.stringify(page)).not.toContain(w.right.profile.id);
  });

  it("deletes original/reply interactions and battle votes while retaining the original receipt and surviving opponent", async () => {
    const w = await battleWorld();
    const response = await post(w.voter.client, w.roundId, { parent: w.a.originalId });
    await like(w.second.client, w.a.originalId); await like(w.second.client, response.replyId, "reply");
    await comment(w.second.client, w.a.originalId, "On the original");
    const replyComment = await comment(w.second.client, response.replyId, "On the reply", "reply");
    await w.right.client.mutation(api.reports.create, { contentId: replyComment.commentId, kind: "comment", reason: "A visible reply comment" });
    await w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "right" });
    await like(w.second.client, w.b.originalId);
    await w.left.client.mutation(api.takes.delete, { id: w.a.originalId });
    expect(await w.voter.client.query(api.takes.detail, { originalId: w.b.originalId })).toMatchObject({ battle: null, likeCount: 1 });
    await expect(w.voter.client.query(api.battles.get, { battleId: w.battleId })).rejects.toThrow("NOT_FOUND");
    expect(await w.left.client.query(api.rounds.today, {})).toMatchObject({ viewerReceipt: { roundId: w.roundId, originalId: null }, canViewFriends: true, ownOriginal: null });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await w.t.run(async ctx => ({
      original: await ctx.db.get(w.a.originalId), reply: await ctx.db.get(response.replyId),
      likes: await ctx.db.query("likes").collect(), comments: await ctx.db.query("comments").collect(),
      votes: await ctx.db.query("battleVotes").collect(), reports: await ctx.db.query("reports").collect(),
    }));
    expect(rows.original).toBeNull(); expect(rows.reply).toBeNull();
    expect(rows.likes).toHaveLength(1); expect(rows.likes[0].contentId).toBe(w.b.originalId);
    expect(rows.comments).toEqual([]); expect(rows.votes).toEqual([]); expect(rows.reports).toEqual([]);
  });

  it("deletes a reply's interactions without deleting its parent or the parent's battle", async () => {
    const w = await battleWorld();
    const response = await post(w.voter.client, w.roundId, { parent: w.a.originalId });
    await like(w.second.client, response.replyId, "reply");
    await comment(w.second.client, response.replyId, "A reply comment", "reply");
    await expect(w.second.client.mutation(api.replies.delete, { id: response.replyId })).rejects.toThrow("NOT_FOUND");
    await w.voter.client.mutation(api.replies.delete, { id: response.replyId });
    expect(await w.second.client.query(api.takes.detail, { originalId: w.a.originalId })).toMatchObject({ visibleReplyCount: 0, battle: { battleId: w.battleId } });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await w.t.run(async ctx => ({ likes: await ctx.db.query("likes").collect(), comments: await ctx.db.query("comments").collect() }))).toEqual({ likes: [], comments: [] });
    expect(await w.second.client.query(api.battles.get, { battleId: w.battleId })).toMatchObject({ battleId: w.battleId });
  });

  it("cascades an account's likes/comments/votes elsewhere and removes battles when a side deletes their account", async () => {
    const w = await battleWorld();
    await like(w.voter.client, w.a.originalId);
    await comment(w.voter.client, w.a.originalId, "Account-owned comment elsewhere");
    await w.voter.client.mutation(api.battles.vote, { battleId: w.battleId, side: "right" });
    await w.voter.client.action(api.accounts.requestDeletion, {});
    expect(await w.second.client.query(api.takes.detail, { originalId: w.a.originalId })).toMatchObject({ visibleCommentCount: 0 });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await w.second.client.query(api.takes.detail, { originalId: w.a.originalId })).toMatchObject({ likeCount: 0, visibleCommentCount: 0 });
    expect(await w.second.client.query(api.battles.get, { battleId: w.battleId })).toMatchObject({ leftVotes: 0, rightVotes: 0 });
    await w.left.client.action(api.accounts.requestDeletion, {});
    expect(await w.second.client.query(api.takes.detail, { originalId: w.b.originalId })).toMatchObject({ battle: null });
    await expect(w.second.client.query(api.battles.get, { battleId: w.battleId })).rejects.toThrow("NOT_FOUND");
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await w.t.run(async ctx => ({ likes: await ctx.db.query("likes").collect(), comments: await ctx.db.query("comments").collect(), votes: await ctx.db.query("battleVotes").collect(), battles: await ctx.db.query("battles").collect() }))).toEqual({ likes: [], comments: [], votes: [], battles: [] });
  });
});
