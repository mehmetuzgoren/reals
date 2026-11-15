import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { accessScope, canViewCommentAuthor, readBudget } from "./access";
import type { Content, ContentKind } from "./access";
import { fail } from "./errors";

export async function likeState(ctx: QueryCtx, userId: Id<"users">, contentId: string, kind: ContentKind) {
  const total = await ctx.db.query("likeCounts").withIndex("by_content_kind", q => q.eq("contentId", contentId).eq("kind", kind)).unique();
  const own = await ctx.db.query("likes").withIndex("by_content_kind_user", q => q.eq("contentId", contentId).eq("kind", kind).eq("userId", userId)).unique();
  return { likeCount: total?.count ?? 0, viewerLiked: !!own };
}
export async function changeLikeCount(ctx: MutationCtx, contentId: string, kind: ContentKind, delta: 1 | -1) {
  const total = await ctx.db.query("likeCounts").withIndex("by_content_kind", q => q.eq("contentId", contentId).eq("kind", kind)).unique();
  const count = (total?.count ?? 0) + delta;
  if (!Number.isSafeInteger(count) || count < 0) fail("LIMIT_REACHED", "Like count is unavailable");
  if (total) await ctx.db.patch(total._id, { count });
  else await ctx.db.insert("likeCounts", { contentId, kind, count });
  return count;
}
export async function removeLike(ctx: MutationCtx, like: Doc<"likes">) {
  await changeLikeCount(ctx, like.contentId, like.kind, -1);
  await ctx.db.delete(like._id);
}
export async function changeCommentCount(ctx: MutationCtx, contentId: string, kind: ContentKind, authorId: Id<"users">, delta: 1 | -1) {
  const total = await ctx.db.query("commentCounts").withIndex("by_content_kind_author", q => q.eq("contentId", contentId).eq("kind", kind).eq("authorId", authorId)).unique();
  const count = (total?.count ?? 0) + delta;
  if (!Number.isSafeInteger(count) || count < 0) fail("LIMIT_REACHED", "Comment count is unavailable");
  if (count === 0 && total) await ctx.db.delete(total._id);
  else if (total) await ctx.db.patch(total._id, { count });
  else await ctx.db.insert("commentCounts", { contentId, kind, authorId, count });
}
export async function tombstoneComment(ctx: MutationCtx, comment: Doc<"comments">) {
  if (comment.deleted) return;
  await changeCommentCount(ctx, comment.contentId, comment.kind, comment.authorId, -1);
  await ctx.db.patch(comment._id, { deleted: true });
}
export async function visibleCommentCount(ctx: QueryCtx, user: Doc<"users">, content: Content, scope = accessScope()) {
  const kind = "optionId" in content ? "original" : "reply";
  const totals = await ctx.db.query("commentCounts").withIndex("by_content_kind_author", q => q.eq("contentId", content._id).eq("kind", kind)).take(257);
  readBudget(scope, totals.length);
  if (totals.length > 256) fail("LIMIT_REACHED", "Comment visibility exceeds its counting budget", true);
  let count = 0;
  for (const total of totals) {
    if (await canViewCommentAuthor(ctx, user, content, total.authorId, scope)) count += total.count;
  }
  if (!Number.isSafeInteger(count) || count < 0) fail("LIMIT_REACHED", "Comment count is unavailable");
  return count;
}
