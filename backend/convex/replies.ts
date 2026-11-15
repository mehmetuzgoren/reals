import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { viewer } from "./lib/auth";
import { accessScope, authorizedContent, canViewReply } from "./lib/access";
import { replyDTO, pageLimit } from "./lib/dto";
import { fail, notFound } from "./lib/errors";

export const list = query({ args: { originalId: v.string(), cursor: v.union(v.string(), v.null()), limit: v.number() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const parent = await authorizedContent(ctx, user, args.originalId, "original");
  if (!("optionId" in parent)) return notFound();
  const eligible = [];
  const scope = accessScope();
  const replies = await ctx.db.query("videoReplies").withIndex("by_original_time", q => q.eq("originalId", parent._id)).take(51);
  if (replies.length > 50) fail("LIMIT_REACHED", "Reply visibility exceeds its pagination budget", true);
  for (const reply of replies) {
    if (await canViewReply(ctx, user, reply, scope)) eligible.push(reply);
  }
  const start = args.cursor === null ? 0 : eligible.findIndex(reply => reply._id === args.cursor) + 1;
  if (args.cursor !== null && start === 0) return notFound();
  const page = eligible.slice(start, start + pageLimit(args.limit));
  const items = [];
  for (const reply of page) items.push(await replyDTO(ctx, user, reply, scope));
  return { items, nextCursor: start + page.length < eligible.length ? page.at(-1)!._id : null };
} });
const deleteReply = mutation({ args: { id: v.id("videoReplies") }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const reply = await ctx.db.get(args.id);
  if (!reply || reply.authorId !== user._id) return notFound();
  await ctx.db.patch(reply._id, { deleted: true });
  await ctx.scheduler.runAfter(0, internal.cleanup.reply, { id: reply._id });
  return { ok: true };
} });
export { deleteReply as delete };
