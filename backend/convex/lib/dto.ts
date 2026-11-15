import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { audience } from "../schema";
import { accessScope, canViewReply, contentAudience, originalAudience, readBudget, readUser } from "./access";
import { visibleBattle } from "./battles";
import { fail } from "./errors";
import { likeState, visibleCommentCount } from "./interactions";

export const publicProfileValidator = v.object({ id: v.id("users"), username: v.string(), displayName: v.string(), avatar: v.union(v.object({ url: v.string() }), v.null()) });
export const originalSummaryValidator = v.object({
  id: v.id("originalTakes"), roundId: v.id("rounds"), author: publicProfileValidator, optionId: v.string(),
  publishedAt: v.number(), durationMs: v.number(), thumbnailAssetId: v.union(v.id("originalTakes"), v.null()),
  visibleReplyCount: v.number(), audience, likeCount: v.number(), viewerLiked: v.boolean(), visibleCommentCount: v.number(),
  battle: v.union(v.object({ battleId: v.id("battles"), opponent: publicProfileValidator }), v.null()),
});
export const replySummaryValidator = v.object({
  id: v.id("videoReplies"), originalId: v.id("originalTakes"), roundId: v.id("rounds"), author: publicProfileValidator,
  publishedAt: v.number(), durationMs: v.number(), thumbnailAssetId: v.union(v.id("videoReplies"), v.null()),
  audience, likeCount: v.number(), viewerLiked: v.boolean(), visibleCommentCount: v.number(),
});

export function publicProfile(user: Doc<"users">) {
  const origin = process.env.TAKE_HTTP_ORIGIN;
  return {
    id: user._id, username: user.username!, displayName: user.displayName,
    avatar: user.avatarStorageId && origin ? { url: `${origin}/v1/avatars/${user._id}` } : null,
  };
}
export function roundDTO(round: Doc<"rounds">, isCurrent: boolean) {
  return { id: round._id, question: round.question, options: round.options, opensAt: round.opensAt!, closesAt: round.closesAt, isCurrent };
}
export function receiptDTO(receipt: Doc<"submissionReceipts"> | null) {
  return receipt ? { roundId: receipt.roundId, publishedAt: receipt.publishedAt, originalId: receipt.originalId } : null;
}
export async function visibleReplyCount(ctx: QueryCtx, user: Doc<"users">, original: Doc<"originalTakes">, scope = accessScope()) {
  const replies = await ctx.db.query("videoReplies").withIndex("by_original_time", q => q.eq("originalId", original._id)).take(51);
  readBudget(scope, replies.length);
  if (replies.length > 50) fail("LIMIT_REACHED", "Reply visibility exceeds its counting budget", true);
  let count = 0;
  for (const reply of replies) if (await canViewReply(ctx, user, reply, scope)) count++;
  return count;
}
export async function originalDTO(ctx: QueryCtx, user: Doc<"users">, original: Doc<"originalTakes">, scope = accessScope()) {
  const author = await readUser(ctx, original.authorId, scope);
  const pair = original.battleId ? await visibleBattle(ctx, user, original.battleId, scope) : null;
  const opponent = pair ? await readUser(ctx, pair.left._id === original._id ? pair.right.authorId : pair.left.authorId, scope) : null;
  return {
    id: original._id, roundId: original.roundId, author: publicProfile(author!), optionId: original.optionId,
    publishedAt: original.publishedAt, durationMs: original.durationMs,
    thumbnailAssetId: original.thumbnailStorageId ? original._id : null, visibleReplyCount: await visibleReplyCount(ctx, user, original, scope),
    audience: originalAudience(original), ...await likeState(ctx, user._id, original._id, "original"),
    visibleCommentCount: await visibleCommentCount(ctx, user, original, scope),
    battle: pair && opponent ? { battleId: pair.battle._id, opponent: publicProfile(opponent) } : null,
  };
}
export async function replyDTO(ctx: QueryCtx, user: Doc<"users">, reply: Doc<"videoReplies">, scope = accessScope()) {
  const author = await readUser(ctx, reply.authorId, scope);
  return {
    id: reply._id, originalId: reply.originalId, roundId: reply.roundId, author: publicProfile(author!),
    publishedAt: reply.publishedAt, durationMs: reply.durationMs, thumbnailAssetId: reply.thumbnailStorageId ? reply._id : null,
    audience: await contentAudience(ctx, reply, scope), ...await likeState(ctx, user._id, reply._id, "reply"),
    visibleCommentCount: await visibleCommentCount(ctx, user, reply, scope),
  };
}
export function pageLimit(limit: number) { return Math.min(50, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 20))); }
