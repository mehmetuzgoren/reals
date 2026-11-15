import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { accessScope, canViewReply, readUser } from "./access";

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
  const replies = await ctx.db.query("videoReplies").withIndex("by_original_time", q => q.eq("originalId", original._id)).collect();
  let count = 0;
  for (const reply of replies) if (await canViewReply(ctx, user, reply, scope)) count++;
  return count;
}
export async function originalDTO(ctx: QueryCtx, user: Doc<"users">, original: Doc<"originalTakes">, scope = accessScope()) {
  const author = await readUser(ctx, original.authorId, scope);
  return {
    id: original._id, roundId: original.roundId, author: publicProfile(author!), optionId: original.optionId,
    publishedAt: original.publishedAt, durationMs: original.durationMs,
    thumbnailAssetId: original.thumbnailStorageId ? original._id : null, visibleReplyCount: await visibleReplyCount(ctx, user, original, scope),
  };
}
export async function replyDTO(ctx: QueryCtx, reply: Doc<"videoReplies">) {
  const author = await ctx.db.get(reply.authorId);
  return {
    id: reply._id, originalId: reply.originalId, roundId: reply.roundId, author: publicProfile(author!),
    publishedAt: reply.publishedAt, durationMs: reply.durationMs, thumbnailAssetId: reply.thumbnailStorageId ? reply._id : null,
  };
}
export function pageLimit(limit: number) { return Math.min(50, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 20))); }
