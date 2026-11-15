import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { identity } from "./lib/auth";
import { fail } from "./lib/errors";

export const requestDeletion = action({ args: {}, handler: async (ctx): Promise<{ state: string; jobId: string }> => {
  const auth = await identity(ctx);
  const authTime = auth.auth_time;
  if (typeof authTime !== "number" || !Number.isFinite(authTime) || authTime * 1000 < Date.now() - 300000 || authTime * 1000 > Date.now() + 60000) fail("REAUTH_REQUIRED", "Sign in again before deleting your account");
  return ctx.runMutation(internal.accounts.start, {});
} });
export const start = internalMutation({ args: {}, handler: async ctx => {
  const auth = await identity(ctx);
  const user = await ctx.db.query("users").withIndex("by_identity", q => q.eq("issuer", auth.issuer).eq("subject", auth.subject)).unique();
  if (!user) fail("PROFILE_REQUIRED", "Profile not found");
  const existing = await ctx.db.query("deletionJobs").withIndex("by_user", q => q.eq("userId", user._id)).unique();
  if (existing) return { state: existing.state, jobId: existing._id };
  const jobId = await ctx.db.insert("deletionJobs", { userId: user._id, state: "pending", firebaseState: "pending", createdAt: Date.now() });
  if (user.avatarStorageId) await ctx.scheduler.runAfter(0, internal.cleanup.asset, { storageId: user.avatarStorageId });
  await ctx.db.patch(user._id, { status: "deleting", username: null, displayName: "Deleted account", avatarStorageId: null, avatarWidth: 0, avatarHeight: 0, preferences: { dailyQuestion: false, directReply: false } });
  await ctx.scheduler.runAfter(0, internal.cleanup.account, { jobId });
  await ctx.scheduler.runAfter(0, internal.accountWorker.deleteFirebaseIdentity, { jobId });
  return { state: "pending", jobId };
} });
export const firebaseTarget = internalQuery({ args: { jobId: v.id("deletionJobs") }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  const user = job ? await ctx.db.get(job.userId) : null;
  return job && user && user.status !== "active" && job.firebaseState !== "deleted" ? { subject: user.subject } : null;
} });
export const recordFirebaseDeletion = internalMutation({ args: { jobId: v.id("deletionJobs"), state: v.union(v.literal("deleted"), v.literal("unconfigured"), v.literal("failed")) }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (job) await ctx.db.patch(job._id, { firebaseState: args.state, state: args.state === "deleted" && job.state === "data_deleted" ? "complete" : job.state });
} });
export const retryIdentityDeletion = internalMutation({ args: {}, handler: async ctx => {
  for (const job of await ctx.db.query("deletionJobs").withIndex("by_state", q => q.eq("state", "data_deleted")).take(50)) {
    if (job.firebaseState !== "deleted") await ctx.scheduler.runAfter(0, internal.accountWorker.deleteFirebaseIdentity, { jobId: job._id });
  }
} });
