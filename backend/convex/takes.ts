import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { viewer } from "./lib/auth";
import { accessScope, authorizedContent, canViewOriginal, currentRound, receipt } from "./lib/access";
import { originalDTO, pageLimit } from "./lib/dto";
import { notFound } from "./lib/errors";
import { friendEdges } from "./friends";

export const feed = query({ args: { roundId: v.id("rounds"), cursor: v.union(v.string(), v.null()), limit: v.number() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  if ((await currentRound(ctx))?._id !== args.roundId || !(await receipt(ctx, user._id, args.roundId))) return { items: [], nextCursor: null };
  const scope = accessScope();
  const audience = [user._id, ...(await friendEdges(ctx, user._id)).map(edge => edge.lowId === user._id ? edge.highId : edge.lowId)];
  const eligible = [];
  for (const authorId of audience) {
    const original = await ctx.db.query("originalTakes").withIndex("by_round_author", q => q.eq("roundId", args.roundId).eq("authorId", authorId)).unique();
    if (original && await canViewOriginal(ctx, user, original, scope)) eligible.push(original);
  }
  eligible.sort((a, b) => b.publishedAt - a.publishedAt || b._creationTime - a._creationTime || b._id.localeCompare(a._id));
  const start = args.cursor === null ? 0 : eligible.findIndex(original => original._id === args.cursor) + 1;
  if (args.cursor !== null && start === 0) return notFound();
  const page = eligible.slice(start, start + Math.min(8, pageLimit(args.limit)));
  const items = [];
  for (const original of page) items.push(await originalDTO(ctx, user, original, scope));
  return { items, nextCursor: start + page.length < eligible.length ? page.at(-1)!._id : null };
} });
export const detail = query({ args: { originalId: v.string() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const content = await authorizedContent(ctx, user, args.originalId, "original");
  if (!("optionId" in content)) return notFound();
  return originalDTO(ctx, user, content);
} });
const deleteTake = mutation({ args: { id: v.id("originalTakes") }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const original = await ctx.db.get(args.id);
  if (!original || original.authorId !== user._id) return notFound();
  await ctx.db.patch(original._id, { deleted: true });
  const success = await receipt(ctx, user._id, original.roundId);
  if (success) await ctx.db.patch(success._id, { originalId: null });
  await ctx.scheduler.runAfter(0, internal.cleanup.original, { id: original._id });
  return { ok: true };
} });
export { deleteTake as delete };
