import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { kind } from "./schema";
import { viewer } from "./lib/auth";
import { accessScope, authorizedContent, canViewComment, readUser } from "./lib/access";
import { pageLimit, publicProfile, publicProfileValidator } from "./lib/dto";
import { fail, notFound } from "./lib/errors";
import { changeCommentCount, tombstoneComment } from "./lib/interactions";
import { orderKey, visiblePage } from "./lib/pagination";

export const list = query({
  args: { contentId: v.string(), kind, cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: v.object({
    items: v.array(v.object({ commentId: v.id("comments"), author: publicProfileValidator, text: v.string(), createdAt: v.number(), viewerCanDelete: v.boolean() })),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const scope = accessScope();
    const content = await authorizedContent(ctx, user, args.contentId, args.kind, scope);
    let after = null;
    if (args.cursor !== null) {
      const id = ctx.db.normalizeId("comments", args.cursor);
      const comment = id ? await ctx.db.get(id) : null;
      if (!comment || comment.contentId !== content._id || comment.kind !== args.kind || !(await canViewComment(ctx, user, comment, scope, content))) return notFound();
      after = comment.orderKey;
    }
    const page = await visiblePage(after, pageLimit(args.limit), (key, size) => ctx.db.query("comments").withIndex("by_content_kind_deleted_order", q => {
      const range = q.eq("contentId", content._id).eq("kind", args.kind).eq("deleted", false);
      return key === null ? range : range.gt("orderKey", key);
    }).order("asc").take(size), comment => canViewComment(ctx, user, comment, scope, content));
    const items = [];
    for (const comment of page.items) items.push({
      commentId: comment._id, author: publicProfile((await readUser(ctx, comment.authorId, scope))!),
      text: comment.text, createdAt: comment.createdAt, viewerCanDelete: user._id === comment.authorId || user._id === content.authorId,
    });
    return { items, nextCursor: page.hasMore ? page.items.at(-1)!._id : null };
  },
});

export const create = mutation({
  args: { contentId: v.string(), kind, text: v.string() },
  returns: v.object({ commentId: v.id("comments") }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const content = await authorizedContent(ctx, user, args.contentId, args.kind);
    const text = args.text.trim();
    if (text.length < 1 || text.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail("INVALID_ARGUMENT", "Comments must contain 1 to 300 plain-text characters");
    const window = await ctx.db.query("commentRateWindows").withIndex("by_user", q => q.eq("userId", user._id)).unique();
    const now = Date.now();
    const timestamps = (window?.timestamps ?? []).filter(time => time > now - 60000);
    if (timestamps.length >= 20) fail("RATE_LIMITED", "You can post 20 comments per minute", true);
    timestamps.push(now);
    if (window) await ctx.db.patch(window._id, { timestamps });
    else await ctx.db.insert("commentRateWindows", { userId: user._id, timestamps });
    const commentId = await ctx.db.insert("comments", { contentId: content._id, kind: args.kind, authorId: user._id, text, createdAt: now, deleted: false, orderKey: "" });
    await ctx.db.patch(commentId, { orderKey: orderKey(now, (await ctx.db.get(commentId))!._creationTime, commentId) });
    await changeCommentCount(ctx, content._id, args.kind, user._id, 1);
    return { commentId };
  },
});

const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return notFound();
    if (comment.authorId !== user._id) {
      const id = ctx.db.normalizeId(comment.kind === "original" ? "originalTakes" : "videoReplies", comment.contentId);
      const content = id ? await ctx.db.get(id) : null;
      if (!content || content.authorId !== user._id) return notFound();
    }
    await tombstoneComment(ctx, comment);
    await ctx.scheduler.runAfter(0, internal.cleanup.comment, { id: comment._id });
    return { ok: true as const };
  },
});
export { deleteComment as delete };
