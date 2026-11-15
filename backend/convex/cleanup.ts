import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { unlinkBattle, removeVote } from "./lib/battles";
import { removeLike, tombstoneComment } from "./lib/interactions";
import type { ContentKind } from "./lib/access";

async function deleteAssets(ctx: MutationCtx, content: Doc<"originalTakes"> | Doc<"videoReplies">) {
  await ctx.storage.delete(content.videoStorageId);
  if (content.thumbnailStorageId) await ctx.storage.delete(content.thumbnailStorageId);
}
async function deleteReports(ctx: MutationCtx, contentId: string, size = 64) {
  const reports = await ctx.db.query("reports").withIndex("by_target", q => q.eq("contentId", contentId)).take(size);
  for (const report of reports) await ctx.db.delete(report._id);
  return reports.length === size;
}
async function eraseComment(ctx: MutationCtx, comment: Doc<"comments">) {
  await tombstoneComment(ctx, comment);
  if (await deleteReports(ctx, comment._id, 16)) return false;
  await ctx.db.delete(comment._id);
  return true;
}
async function eraseInteractions(ctx: MutationCtx, contentId: string, kind: ContentKind) {
  const likes = await ctx.db.query("likes").withIndex("by_content_kind_user", q => q.eq("contentId", contentId).eq("kind", kind)).take(32);
  for (const like of likes) await removeLike(ctx, like);
  const comments = await ctx.db.query("comments").withIndex("by_content_kind", q => q.eq("contentId", contentId).eq("kind", kind)).take(8);
  let more = likes.length === 32 || comments.length === 8;
  for (const comment of comments) if (!(await eraseComment(ctx, comment))) more = true;
  if (!more) {
    const total = await ctx.db.query("likeCounts").withIndex("by_content_kind", q => q.eq("contentId", contentId).eq("kind", kind)).unique();
    if (total) await ctx.db.delete(total._id);
  }
  return more;
}
async function eraseReply(ctx: MutationCtx, reply: Doc<"videoReplies">) {
  if (!reply.deleted) await ctx.db.patch(reply._id, { deleted: true });
  const moreReports = await deleteReports(ctx, reply._id);
  const moreInteractions = await eraseInteractions(ctx, reply._id, "reply");
  if (moreReports || moreInteractions) {
    await ctx.scheduler.runAfter(0, internal.cleanup.reply, { id: reply._id });
    return false;
  }
  await deleteAssets(ctx, reply);
  await ctx.db.delete(reply._id);
  return true;
}
export const asset = internalMutation({ args: { storageId: v.id("_storage") }, handler: async (ctx, args) => { await ctx.storage.delete(args.storageId); } });
export const comment = internalMutation({ args: { id: v.id("comments") }, returns: v.null(), handler: async (ctx, args) => {
  const content = await ctx.db.get(args.id);
  if (content?.deleted && !(await eraseComment(ctx, content))) await ctx.scheduler.runAfter(0, internal.cleanup.comment, args);
  return null;
} });
export const battle = internalMutation({ args: { battleId: v.id("battles") }, returns: v.null(), handler: async (ctx, args) => {
  if (await ctx.db.get(args.battleId)) return null;
  const votes = await ctx.db.query("battleVotes").withIndex("by_battle_user", q => q.eq("battleId", args.battleId)).take(64);
  for (const vote of votes) await ctx.db.delete(vote._id);
  if (votes.length === 64) await ctx.scheduler.runAfter(0, internal.cleanup.battle, args);
  return null;
} });
export const reply = internalMutation({ args: { id: v.id("videoReplies") }, handler: async (ctx, args) => {
  const content = await ctx.db.get(args.id);
  if (content?.deleted) await eraseReply(ctx, content);
} });
export const original = internalMutation({ args: { id: v.id("originalTakes") }, handler: async (ctx, args) => {
  const content = await ctx.db.get(args.id);
  if (!content?.deleted) return;
  await unlinkBattle(ctx, content);
  const replies = await ctx.db.query("videoReplies").withIndex("by_original_time", q => q.eq("originalId", content._id)).take(10);
  for (const reply of replies) await eraseReply(ctx, reply);
  const moreReports = await deleteReports(ctx, content._id);
  const moreInteractions = await eraseInteractions(ctx, content._id, "original");
  if (replies.length || moreReports || moreInteractions) {
    await ctx.scheduler.runAfter(0, internal.cleanup.original, args);
    return;
  }
  await deleteAssets(ctx, content);
  await ctx.db.delete(content._id);
} });
export const expired = internalMutation({ args: {}, handler: async ctx => {
  const now = Date.now();
  const uploads = [];
  for (const state of ["uploading", "processing", "failed", "cancelled"] as const) {
    uploads.push(...await ctx.db.query("uploads").withIndex("by_state_expiry", q => q.eq("state", state).lte("expiresAt", now)).take(25));
  }
  for (const upload of uploads) {
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
  }
  const avatars = await ctx.db.query("avatarUploads").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(100);
  for (const upload of avatars) {
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
  }
  const grants = await ctx.db.query("mediaGrants").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(200);
  for (const grant of grants) await ctx.db.delete(grant._id);
  if (uploads.length >= 25 || avatars.length === 100 || grants.length === 200) await ctx.scheduler.runAfter(0, internal.cleanup.expired, {});
} });

async function referenced(ctx: MutationCtx, storageId: Id<"_storage">) {
  return !!(await ctx.db.query("uploads").withIndex("by_storage", q => q.eq("storageId", storageId)).first()) ||
    !!(await ctx.db.query("avatarUploads").withIndex("by_storage", q => q.eq("storageId", storageId)).first()) ||
    !!(await ctx.db.query("users").withIndex("by_avatar", q => q.eq("avatarStorageId", storageId)).first()) ||
    !!(await ctx.db.query("originalTakes").withIndex("by_video", q => q.eq("videoStorageId", storageId)).first()) ||
    !!(await ctx.db.query("originalTakes").withIndex("by_thumbnail", q => q.eq("thumbnailStorageId", storageId)).first()) ||
    !!(await ctx.db.query("videoReplies").withIndex("by_video", q => q.eq("videoStorageId", storageId)).first()) ||
    !!(await ctx.db.query("videoReplies").withIndex("by_thumbnail", q => q.eq("thumbnailStorageId", storageId)).first());
}
export const orphans = internalMutation({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, args) => {
  const page = await ctx.db.system.query("_storage").paginate({ cursor: args.cursor, numItems: 50 });
  for (const object of page.page) if (object._creationTime < Date.now() - 3600000 && !(await referenced(ctx, object._id))) await ctx.storage.delete(object._id);
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.cleanup.orphans, { cursor: page.continueCursor });
} });

export const account = internalMutation({ args: { jobId: v.id("deletionJobs") }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.state !== "pending") return;
  const user = await ctx.db.get(job.userId);
  if (!user || user.status === "active") return;
  let more = false;
  const originals = await ctx.db.query("originalTakes").withIndex("by_author", q => q.eq("authorId", user._id)).take(10);
  for (const content of originals) {
    await ctx.db.patch(content._id, { deleted: true });
    await unlinkBattle(ctx, content);
    await ctx.scheduler.runAfter(0, internal.cleanup.original, { id: content._id });
  }
  if (originals.length) more = true;
  const ownReplies = await ctx.db.query("videoReplies").withIndex("by_author", q => q.eq("authorId", user._id)).take(10);
  if (ownReplies.length === 10) more = true;
  for (const reply of ownReplies) {
    if (!(await eraseReply(ctx, reply))) more = true;
  }
  const likes = await ctx.db.query("likes").withIndex("by_user", q => q.eq("userId", user._id)).take(64);
  for (const like of likes) await removeLike(ctx, like);
  if (likes.length === 64) more = true;
  const comments = await ctx.db.query("comments").withIndex("by_author", q => q.eq("authorId", user._id)).take(8);
  for (const comment of comments) if (!(await eraseComment(ctx, comment))) more = true;
  if (comments.length === 8) more = true;
  const votes = await ctx.db.query("battleVotes").withIndex("by_user", q => q.eq("userId", user._id)).take(64);
  for (const vote of votes) await removeVote(ctx, vote);
  if (votes.length === 64) more = true;
  const rows = [
    await ctx.db.query("friendRequests").withIndex("by_sender", q => q.eq("senderId", user._id)).take(64),
    await ctx.db.query("friendRequests").withIndex("by_recipient", q => q.eq("recipientId", user._id)).take(64),
    await ctx.db.query("friendships").withIndex("by_low", q => q.eq("lowId", user._id)).take(64),
    await ctx.db.query("friendships").withIndex("by_high", q => q.eq("highId", user._id)).take(64),
    await ctx.db.query("blocks").withIndex("by_blocker", q => q.eq("blockerId", user._id)).take(64),
    await ctx.db.query("blocks").withIndex("by_blocked", q => q.eq("blockedId", user._id)).take(64),
    await ctx.db.query("submissionReceipts").withIndex("by_user", q => q.eq("userId", user._id)).take(64),
    await ctx.db.query("mediaGrants").withIndex("by_viewer", q => q.eq("viewerId", user._id)).take(64),
    await ctx.db.query("deviceTokens").withIndex("by_user", q => q.eq("userId", user._id)).take(64),
    await ctx.db.query("notificationDeliveries").withIndex("by_user", q => q.eq("userId", user._id)).take(64),
    await ctx.db.query("reports").withIndex("by_reporter", q => q.eq("reporterId", user._id)).take(64),
    await ctx.db.query("commentRateWindows").withIndex("by_user", q => q.eq("userId", user._id)).take(64),
  ];
  for (const batch of rows) {
    for (const row of batch) await ctx.db.delete(row._id);
    if (batch.length === 64) more = true;
  }
  for (const upload of await ctx.db.query("uploads").withIndex("by_owner", q => q.eq("ownerId", user._id)).take(64)) {
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    more = true;
  }
  for (const upload of await ctx.db.query("avatarUploads").withIndex("by_owner", q => q.eq("ownerId", user._id)).take(64)) {
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    more = true;
  }
  if (more) await ctx.scheduler.runAfter(100, internal.cleanup.account, args);
  else {
    await ctx.db.patch(user._id, { status: "deleted" });
    await ctx.db.patch(job._id, { state: "complete" });
  }
} });
