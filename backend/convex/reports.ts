import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { kind } from "./schema";
import { viewer } from "./lib/auth";
import { authorizedContent } from "./lib/access";
import { bounded, fail } from "./lib/errors";

export const create = mutation({ args: { contentId: v.string(), kind, reason: v.string() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  await authorizedContent(ctx, user, args.contentId, args.kind);
  if ((await ctx.db.query("reports").withIndex("by_reporter", q => q.eq("reporterId", user._id)).take(100)).length >= 100) fail("LIMIT_REACHED", "Report limit reached");
  const id = await ctx.db.insert("reports", { reporterId: user._id, contentId: args.contentId, kind: args.kind, reason: bounded(args.reason, 3, 1000, "report reason"), createdAt: Date.now() });
  return { id };
} });
