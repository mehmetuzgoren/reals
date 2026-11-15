import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { availableUser, viewer } from "./lib/auth";
import { blocked, friends, pairKey } from "./lib/access";
import { bounded, fail, notFound } from "./lib/errors";
import { pageLimit, publicProfile } from "./lib/dto";

export async function friendEdges(ctx: QueryCtx, userId: Id<"users">) {
  const low = await ctx.db.query("friendships").withIndex("by_low", q => q.eq("lowId", userId)).collect();
  const high = await ctx.db.query("friendships").withIndex("by_high", q => q.eq("highId", userId)).collect();
  return [...low, ...high];
}
async function removePair(ctx: MutationCtx, a: Id<"users">, b: Id<"users">) {
  const pair = pairKey(a, b);
  const edge = await ctx.db.query("friendships").withIndex("by_pair", q => q.eq("pair", pair)).unique();
  const pending = await ctx.db.query("friendRequests").withIndex("by_pair", q => q.eq("pair", pair)).unique();
  if (edge) await ctx.db.delete(edge._id);
  if (pending) await ctx.db.delete(pending._id);
}
export { removePair };

export const list = query({ args: {}, handler: async ctx => {
  const user = await viewer(ctx);
  const approved = [];
  for (const edge of await friendEdges(ctx, user._id)) {
    const other = await ctx.db.get(edge.lowId === user._id ? edge.highId : edge.lowId);
    if (availableUser(other) && await friends(ctx, user._id, other._id)) approved.push(publicProfile(other));
  }
  const incoming = [];
  const outgoing = [];
  for (const request of await ctx.db.query("friendRequests").withIndex("by_recipient", q => q.eq("recipientId", user._id)).collect()) {
    const other = await ctx.db.get(request.senderId);
    if (availableUser(other) && !(await blocked(ctx, user._id, other._id))) incoming.push({ id: request._id, profile: publicProfile(other), createdAt: request.createdAt });
  }
  for (const request of await ctx.db.query("friendRequests").withIndex("by_sender", q => q.eq("senderId", user._id)).collect()) {
    const other = await ctx.db.get(request.recipientId);
    if (availableUser(other) && !(await blocked(ctx, user._id, other._id))) outgoing.push({ id: request._id, profile: publicProfile(other), createdAt: request.createdAt });
  }
  const ownBlocks = [];
  for (const block of await ctx.db.query("blocks").withIndex("by_blocker", q => q.eq("blockerId", user._id)).collect()) {
    const other = await ctx.db.get(block.blockedId);
    if (availableUser(other)) ownBlocks.push(publicProfile(other));
  }
  return { approved, incoming, outgoing, blocked: ownBlocks };
} });

export const search = query({ args: { usernamePrefix: v.string(), limit: v.number() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const prefix = bounded(args.usernamePrefix.toLowerCase(), 2, 24, "username prefix");
  if (!/^[a-z0-9_]+$/.test(prefix)) return [];
  const users = await ctx.db.query("users").withIndex("by_username", q => q.gte("username", prefix).lt("username", prefix + "\uffff")).take(pageLimit(args.limit));
  const result = [];
  for (const other of users) {
    if (!availableUser(other) || other._id === user._id || await blocked(ctx, user._id, other._id)) continue;
    const pending = await ctx.db.query("friendRequests").withIndex("by_pair", q => q.eq("pair", pairKey(user._id, other._id))).unique();
    const relationship = await friends(ctx, user._id, other._id) ? "approved" : pending ? (pending.senderId === user._id ? "outgoing" : "incoming") : "none";
    result.push({ profile: publicProfile(other), relationship, requestId: pending?._id ?? null });
  }
  return result;
} });

export const request = mutation({ args: { userId: v.id("users") }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const other = await ctx.db.get(args.userId);
  if (!availableUser(other) || other._id === user._id || await blocked(ctx, user._id, other._id)) return notFound();
  if (await friends(ctx, user._id, other._id)) return { relationship: "approved", requestId: null };
  const pair = pairKey(user._id, other._id);
  const pending = await ctx.db.query("friendRequests").withIndex("by_pair", q => q.eq("pair", pair)).unique();
  if (pending) return { relationship: pending.senderId === user._id ? "outgoing" : "incoming", requestId: pending._id };
  const sent = await ctx.db.query("friendRequests").withIndex("by_sender", q => q.eq("senderId", user._id)).take(100);
  const received = await ctx.db.query("friendRequests").withIndex("by_recipient", q => q.eq("recipientId", other._id)).take(200);
  if (sent.length >= 100 || received.length >= 200) fail("LIMIT_REACHED", "Too many pending friend requests");
  const id = await ctx.db.insert("friendRequests", { senderId: user._id, recipientId: other._id, pair, createdAt: Date.now() });
  return { relationship: "outgoing", requestId: id };
} });
export const cancel = mutation({ args: { requestId: v.id("friendRequests") }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const request = await ctx.db.get(args.requestId);
  if (!request || request.senderId !== user._id) return notFound();
  await ctx.db.delete(request._id);
  return { ok: true };
} });
export const respond = mutation({ args: { requestId: v.id("friendRequests"), accept: v.boolean() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const request = await ctx.db.get(args.requestId);
  if (!request || request.recipientId !== user._id) return notFound();
  const sender = await ctx.db.get(request.senderId);
  if (!availableUser(sender) || await blocked(ctx, user._id, request.senderId)) return notFound();
  if (args.accept) {
    if ((await friendEdges(ctx, user._id)).length >= 200 || (await friendEdges(ctx, request.senderId)).length >= 200) fail("LIMIT_REACHED", "Friend limit reached");
    if (!(await friends(ctx, user._id, request.senderId))) {
      const [lowId, highId] = [user._id, request.senderId].sort();
      await ctx.db.insert("friendships", { lowId, highId, pair: request.pair, createdAt: Date.now() });
    }
  }
  await ctx.db.delete(request._id);
  return { relationship: args.accept ? "approved" : "none" };
} });
export const remove = mutation({ args: { userId: v.id("users") }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  await removePair(ctx, user._id, args.userId);
  return { ok: true, invalidatePrivateCache: true };
} });
