import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { fail, notFound } from "./lib/errors";

export const setDisabled = internalMutation({ args: { userId: v.id("users"), disabled: v.boolean() }, handler: async (ctx, args) => {
  const user = await ctx.db.get(args.userId);
  if (!user) return notFound();
  if (user.status === "deleting" || user.status === "deleted") fail("CONFLICT", "A deletion tombstone cannot be reactivated");
  await ctx.db.patch(user._id, { status: args.disabled ? "disabled" : "active" });
  return { ok: true };
} });
