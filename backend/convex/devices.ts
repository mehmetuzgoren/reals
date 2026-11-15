import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { viewer } from "./lib/auth";
import { bounded, fail } from "./lib/errors";

export const register = mutation({ args: { installationId: v.string(), fcmToken: v.string(), platform: v.literal("ios"), notificationsEnabled: v.boolean() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const installationId = bounded(args.installationId, 8, 128, "installation ID");
  const fcmToken = bounded(args.fcmToken, 20, 4096, "notification token");
  const current = await ctx.db.query("deviceTokens").withIndex("by_owner_installation", q => q.eq("userId", user._id).eq("installationId", installationId)).unique();
  const sameToken = await ctx.db.query("deviceTokens").withIndex("by_token", q => q.eq("fcmToken", fcmToken)).unique();
  if (sameToken && sameToken._id !== current?._id) await ctx.db.delete(sameToken._id);
  if (!current && (await ctx.db.query("deviceTokens").withIndex("by_user", q => q.eq("userId", user._id)).take(10)).length >= 10) fail("LIMIT_REACHED", "Too many registered installations");
  const fields = { ...args, installationId, fcmToken, userId: user._id, updatedAt: Date.now() };
  if (current) await ctx.db.patch(current._id, fields);
  else await ctx.db.insert("deviceTokens", fields);
  return { ok: true };
} });
export const unregister = mutation({ args: { installationId: v.string() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const token = await ctx.db.query("deviceTokens").withIndex("by_owner_installation", q => q.eq("userId", user._id).eq("installationId", args.installationId)).unique();
  if (token) await ctx.db.delete(token._id);
  return { ok: true };
} });
