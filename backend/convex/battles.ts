import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { voteSide } from "./schema";
import { viewer } from "./lib/auth";
import { accessScope } from "./lib/access";
import { visibleBattle } from "./lib/battles";
import { originalDTO, originalSummaryValidator } from "./lib/dto";
import { fail, notFound } from "./lib/errors";

export const get = query({
  args: { battleId: v.id("battles") },
  returns: v.object({
    battleId: v.id("battles"), roundId: v.id("rounds"), left: originalSummaryValidator, right: originalSummaryValidator,
    leftVotes: v.number(), rightVotes: v.number(), viewerVote: v.union(voteSide, v.null()), viewerCanVote: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const scope = accessScope();
    const pair = await visibleBattle(ctx, user, args.battleId, scope);
    if (!pair) return notFound();
    const vote = await ctx.db.query("battleVotes").withIndex("by_battle_user", q => q.eq("battleId", pair.battle._id).eq("userId", user._id)).unique();
    return {
      battleId: pair.battle._id, roundId: pair.battle.roundId,
      left: await originalDTO(ctx, user, pair.left, scope), right: await originalDTO(ctx, user, pair.right, scope),
      leftVotes: pair.battle.leftVotes, rightVotes: pair.battle.rightVotes, viewerVote: vote?.side ?? null,
      viewerCanVote: user._id !== pair.left.authorId && user._id !== pair.right.authorId,
    };
  },
});

export const vote = mutation({
  args: { battleId: v.id("battles"), side: voteSide },
  returns: v.object({ leftVotes: v.number(), rightVotes: v.number(), viewerVote: voteSide }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const pair = await visibleBattle(ctx, user, args.battleId);
    if (!pair) return notFound();
    if (user._id === pair.left.authorId || user._id === pair.right.authorId) fail("FORBIDDEN", "Battle authors cannot vote");
    const own = await ctx.db.query("battleVotes").withIndex("by_battle_user", q => q.eq("battleId", pair.battle._id).eq("userId", user._id)).unique();
    let { leftVotes, rightVotes } = pair.battle;
    if (own?.side !== args.side) {
      if (own?.side === "left") leftVotes--;
      if (own?.side === "right") rightVotes--;
      if (args.side === "left") leftVotes++;
      else rightVotes++;
      if (!Number.isSafeInteger(leftVotes) || !Number.isSafeInteger(rightVotes) || leftVotes < 0 || rightVotes < 0) fail("LIMIT_REACHED", "Vote count is unavailable");
      if (own) await ctx.db.patch(own._id, { side: args.side });
      else await ctx.db.insert("battleVotes", { battleId: pair.battle._id, userId: user._id, side: args.side });
      await ctx.db.patch(pair.battle._id, { leftVotes, rightVotes });
    }
    return { leftVotes, rightVotes, viewerVote: args.side };
  },
});
