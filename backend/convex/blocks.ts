import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { viewer } from "./lib/auth";
import { fail, notFound } from "./lib/errors";
import { removePair } from "./friends";

export const set = mutation({ args: { userId: v.id("users"), blocked: v.boolean() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const other = await ctx.db.get(args.userId);
  if (!other || other.status !== "active" || other._id === user._id) return notFound();
  const block = await ctx.db.query("blocks").withIndex("by_pair", q => q.eq("blockerId", user._id).eq("blockedId", other._id)).unique();
  if (args.blocked) {
    if (!block) {
      if ((await ctx.db.query("blocks").withIndex("by_blocker", q => q.eq("blockerId", user._id)).take(500)).length >= 500) fail("LIMIT_REACHED", "Block limit reached");
      await ctx.db.insert("blocks", { blockerId: user._id, blockedId: other._id, createdAt: Date.now() });
    }
    await removePair(ctx, user._id, other._id);
  } else if (block) await ctx.db.delete(block._id);
  return { blocked: args.blocked, invalidatePrivateCache: true };
} });
