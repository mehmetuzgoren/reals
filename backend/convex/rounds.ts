import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { option } from "./schema";
import { viewer } from "./lib/auth";
import { currentRound, friends, receipt } from "./lib/access";
import { friendEdges } from "./friends";
import { originalDTO, publicProfile, receiptDTO, roundDTO } from "./lib/dto";

export const today = query({ args: {}, handler: async ctx => {
  const user = await viewer(ctx);
  const round = await currentRound(ctx);
  const success = round ? await receipt(ctx, user._id, round._id) : null;
  const own = success?.originalId ? await ctx.db.get(success.originalId) : null;
  const friendPresence = [];
  if (round) for (const edge of await friendEdges(ctx, user._id)) {
    const other = await ctx.db.get(edge.lowId === user._id ? edge.highId : edge.lowId);
    if (other?.status === "active" && await friends(ctx, user._id, other._id)) {
      friendPresence.push({ profile: publicProfile(other), hasPublished: !!(await receipt(ctx, other._id, round._id)) });
    }
  }
  return {
    serverNow: Date.now(), round: round ? roundDTO(round, true) : null, viewerReceipt: receiptDTO(success),
    canViewFriends: !!success, ownOriginal: own && !own.deleted ? await originalDTO(ctx, user, own) : null, friendPresence,
  };
} });
export const plan = internalMutation({ args: { planKey: v.string(), plannedAt: v.number(), question: v.string(), options: v.array(option) }, handler: async (ctx, args) => {
  const existing = await ctx.db.query("rounds").withIndex("by_plan", q => q.eq("planKey", args.planKey)).unique();
  if (existing) return existing._id;
  const id = await ctx.db.insert("rounds", { ...args, opensAt: null, closesAt: null });
  await ctx.scheduler.runAt(Math.max(Date.now(), args.plannedAt), internal.rounds.open, { id });
  return id;
} });
export const open = internalMutation({ args: { id: v.id("rounds") }, handler: async (ctx, args) => {
  const round = await ctx.db.get(args.id);
  if (!round || round.opensAt !== null || round.plannedAt > Date.now()) return false;
  const pointer = await ctx.db.query("currentRound").withIndex("by_key", q => q.eq("key", "global")).unique();
  const previous = pointer ? await ctx.db.get(pointer.roundId) : null;
  if (previous && previous.plannedAt >= round.plannedAt) return false;
  const openedAt = Date.now();
  if (previous) await ctx.db.patch(previous._id, { closesAt: openedAt });
  await ctx.db.patch(round._id, { opensAt: openedAt });
  if (pointer) await ctx.db.patch(pointer._id, { roundId: round._id });
  else await ctx.db.insert("currentRound", { key: "global", roundId: round._id });
  const jobId = await ctx.db.insert("notificationJobs", { kind: "daily", roundId: round._id, replyId: null, recipientId: null, cursor: null, state: "pending", attempts: 0 });
  await ctx.scheduler.runAfter(0, internal.push.deliver, { jobId });
  return true;
} });
