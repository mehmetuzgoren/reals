import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { kind } from "./schema";
import { viewer } from "./lib/auth";
import { authorizedContent } from "./lib/access";
import { changeLikeCount } from "./lib/interactions";

export const toggle = mutation({
  args: { contentId: v.string(), kind },
  returns: v.object({ liked: v.boolean(), likeCount: v.number() }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const content = await authorizedContent(ctx, user, args.contentId, args.kind);
    const own = await ctx.db.query("likes").withIndex("by_content_kind_user", q => q.eq("contentId", content._id).eq("kind", args.kind).eq("userId", user._id)).unique();
    const likeCount = await changeLikeCount(ctx, content._id, args.kind, own ? -1 : 1);
    if (own) await ctx.db.delete(own._id);
    else await ctx.db.insert("likes", { contentId: content._id, kind: args.kind, userId: user._id, createdAt: Date.now() });
    return { liked: !own, likeCount };
  },
});
