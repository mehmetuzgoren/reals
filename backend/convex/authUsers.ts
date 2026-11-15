import { vAppleProfile } from "@convex-dev/auth/methods/apple/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { availableUser } from "./lib/auth";
import { fail } from "./lib/errors";

const appleMethod = v.object({ name: v.literal("apple"), profile: vAppleProfile });
const developmentMethod = v.object({ name: v.literal("usernamePassword"), profile: v.object({}) });

async function create(ctx: MutationCtx, authMethod: "apple" | "developmentPassword") {
  if (authMethod === "developmentPassword" && process.env.TAKE_DEPLOYMENT_ENV !== "development") fail("UNAUTHENTICATED", "Development sign-in is disabled");
  return ctx.db.insert("users", {
    authMethod, username: null, displayName: "", status: "active",
    avatarStorageId: null, avatarWidth: 0, avatarHeight: 0,
    preferences: { dailyQuestion: true, directReply: true }, createdAt: Date.now(),
  });
}
export const createApple = internalMutation({ args: { method: appleMethod }, returns: v.id("users"), handler: async ctx => create(ctx, "apple") });
export const createDevelopment = internalMutation({ args: { method: developmentMethod }, returns: v.id("users"), handler: async ctx => create(ctx, "developmentPassword") });
export const signInApple = internalMutation({ args: { method: appleMethod, userId: v.id("users") }, returns: v.null(), handler: async (ctx, args) => {
  const user = await ctx.db.get(args.userId);
  if (!availableUser(user) || user.authMethod !== "apple") fail("UNAUTHENTICATED", "This account is unavailable");
  return null;
} });
export const signInDevelopment = internalMutation({ args: { method: developmentMethod, userId: v.id("users") }, returns: v.null(), handler: async (ctx, args) => {
  const user = await ctx.db.get(args.userId);
  if (process.env.TAKE_DEPLOYMENT_ENV !== "development" || !availableUser(user) || user.authMethod !== "developmentPassword") fail("UNAUTHENTICATED", "This account is unavailable");
  return null;
} });
