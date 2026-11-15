import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { canViewReply, currentRound } from "./lib/access";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

async function devicePage(ctx: QueryCtx, job: Doc<"notificationJobs">) {
  return job.recipientId
    ? { page: await ctx.db.query("deviceTokens").withIndex("by_user", q => q.eq("userId", job.recipientId!)).collect(), isDone: true, continueCursor: "" }
    : await ctx.db.query("deviceTokens").paginate({ cursor: job.cursor, numItems: 50 });
}

export const claim = internalMutation({ args: { jobId: v.id("notificationJobs"), lease: v.string() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.state === "sent" || (job.leaseUntil ?? 0) > Date.now()) return false;
  if (job.attempts >= 5) {
    const page = await devicePage(ctx, job);
    await ctx.db.patch(job._id, { state: page.isDone ? "unavailable" : "pending", cursor: page.isDone ? job.cursor : page.continueCursor, attempts: page.isDone ? job.attempts : 0, leaseUntil: 0 });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.push.deliver, { jobId: job._id });
    return false;
  }
  await ctx.db.patch(job._id, { state: "pending", attempts: job.attempts + 1, lease: args.lease, leaseUntil: Date.now() + 300000 });
  return true;
} });

export const batch = internalQuery({ args: { jobId: v.id("notificationJobs") }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.state === "sent") return null;
  if ((await currentRound(ctx))?._id !== job.roundId) return { items: [], nextCursor: null, done: true, kind: job.kind, roundId: job.roundId, contentId: null };
  const page = await devicePage(ctx, job);
  const items = [];
  for (const device of page.page) {
    const user = await ctx.db.get(device.userId);
    if (!device.notificationsEnabled || user?.status !== "active") continue;
    if (job.kind === "daily" && !user.preferences.dailyQuestion) continue;
    if (job.kind === "reply") {
      const reply = job.replyId ? await ctx.db.get(job.replyId) : null;
      if (!user.preferences.directReply || !(await canViewReply(ctx, user, reply))) continue;
    }
    items.push({ id: device._id });
  }
  return { items, nextCursor: page.isDone ? null : page.continueCursor, done: page.isDone, kind: job.kind, roundId: job.roundId, contentId: job.kind === "reply" ? job.replyId : null };
} });
export const target = internalMutation({ args: { jobId: v.id("notificationJobs"), deviceId: v.id("deviceTokens"), lease: v.string() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.state !== "pending" || job.lease !== args.lease || (job.leaseUntil ?? 0) <= Date.now()) return { lostLease: true, target: null };
  await ctx.db.patch(job._id, { leaseUntil: Date.now() + 300000 });
  const device = await ctx.db.get(args.deviceId);
  const skip = { lostLease: false, target: null };
  if (!device || !device.notificationsEnabled || (await currentRound(ctx))?._id !== job.roundId) return skip;
  const user = await ctx.db.get(device.userId);
  if (user?.status !== "active") return skip;
  if (await ctx.db.query("notificationDeliveries").withIndex("by_job_device", q => q.eq("jobId", job._id).eq("deviceId", device._id)).unique()) return skip;
  if (job.kind === "daily" && !user.preferences.dailyQuestion) return skip;
  if (job.kind === "reply") {
    if (job.recipientId !== user._id || !user.preferences.directReply || !job.replyId || !(await canViewReply(ctx, user, await ctx.db.get(job.replyId)))) return skip;
  }
  return { lostLease: false, target: { token: device.fcmToken, kind: job.kind, roundId: job.roundId, contentId: job.kind === "reply" ? job.replyId : null } };
} });
export const finishAttempt = internalMutation({ args: { jobId: v.id("notificationJobs"), deviceId: v.id("deviceTokens"), lease: v.string(), token: v.string(), outcome: v.union(v.literal("sent"), v.literal("invalid")) }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.state !== "pending" || job.lease !== args.lease || (job.leaseUntil ?? 0) <= Date.now()) return { validLease: false, retry: false };
  const device = await ctx.db.get(args.deviceId);
  if (!device) return { validLease: true, retry: false };
  if (args.outcome === "invalid") {
    if (device.fcmToken !== args.token) return { validLease: true, retry: true };
    await ctx.db.delete(device._id);
    return { validLease: true, retry: false };
  }
  const prior = await ctx.db.query("notificationDeliveries").withIndex("by_job_device", q => q.eq("jobId", args.jobId).eq("deviceId", args.deviceId)).unique();
  if (!prior) await ctx.db.insert("notificationDeliveries", { jobId: args.jobId, deviceId: args.deviceId, userId: device.userId, state: "sent" });
  return { validLease: true, retry: false };
} });
export const progress = internalMutation({ args: { jobId: v.id("notificationJobs"), lease: v.string(), nextCursor: v.union(v.string(), v.null()), done: v.boolean(), unavailable: v.boolean() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.state !== "pending" || job.lease !== args.lease || (job.leaseUntil ?? 0) <= Date.now()) return;
  if (args.unavailable) {
    await ctx.db.patch(job._id, { state: "unavailable", leaseUntil: 0 });
    await ctx.scheduler.runAfter(job.attempts >= 5 ? 0 : Math.min(3600000, 60000 * 2 ** job.attempts), internal.push.deliver, { jobId: job._id });
    return;
  }
  await ctx.db.patch(job._id, { cursor: args.nextCursor, state: args.done ? "sent" : "pending", attempts: 0, leaseUntil: 0 });
  if (!args.done) await ctx.scheduler.runAfter(0, internal.push.deliver, { jobId: job._id });
} });
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
  const jobs = [];
  for (const state of ["sent", "unavailable"] as const) jobs.push(...await ctx.db.query("notificationJobs").withIndex("by_state", q => q.eq("state", state).lt("_creationTime", Date.now() - 30 * 86400000)).take(10));
  for (const job of jobs) {
    const deliveries = await ctx.db.query("notificationDeliveries").withIndex("by_job_device", q => q.eq("jobId", job._id)).take(50);
    for (const delivery of deliveries) await ctx.db.delete(delivery._id);
    if (deliveries.length < 50) await ctx.db.delete(job._id);
  }
  if (jobs.length) await ctx.scheduler.runAfter(0, internal.notifications.cleanup, {});
} });
export const recover = internalMutation({ args: {}, handler: async ctx => {
  for (const job of await ctx.db.query("notificationJobs").withIndex("by_state", q => q.eq("state", "pending")).take(50)) {
    if ((job.leaseUntil ?? 0) < Date.now() && job._creationTime < Date.now() - 300000) await ctx.scheduler.runAfter(0, internal.push.deliver, { jobId: job._id });
  }
} });
