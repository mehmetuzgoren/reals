import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { availableUser } from "./auth";
import { accessScope, blocked, canViewOriginal, originalAudience, readUser } from "./access";
import { fail } from "./errors";

export async function visibleBattle(ctx: QueryCtx, user: Doc<"users">, battleId: Id<"battles">, scope = accessScope()) {
  const battle = await ctx.db.get(battleId);
  if (!battle) return null;
  const left = await ctx.db.get(battle.leftId);
  const right = await ctx.db.get(battle.rightId);
  if (!left || !right || left.battleId !== battle._id || right.battleId !== battle._id ||
    left.roundId !== battle.roundId || right.roundId !== battle.roundId ||
    originalAudience(left) !== "public" || originalAudience(right) !== "public" ||
    !(await canViewOriginal(ctx, user, left, scope)) || !(await canViewOriginal(ctx, user, right, scope))) return null;
  return { battle, left, right };
}
export async function pairOriginal(ctx: MutationCtx, original: Doc<"originalTakes">) {
  if (originalAudience(original) !== "public" || original.deleted || original.battleId) return;
  const round = await ctx.db.get(original.roundId);
  if (!round) fail("ROUND_CLOSED", "This round is unavailable");
  const options = [...new Set(round.options.map(option => option.id))].filter(optionId => optionId !== original.optionId);
  if (options.length > 16) fail("LIMIT_REACHED", "Battle pairing exceeds its option budget", true);
  const candidates = (await Promise.all(options.map(optionId => ctx.db.query("originalTakes").withIndex("by_round_audience_deleted_battle_option_time", q =>
    q.eq("roundId", original.roundId).eq("audience", "public").eq("deleted", false).eq("battleId", undefined).eq("optionId", optionId)).order("asc").take(257)))).flat();
  const compare = (a: Doc<"originalTakes">, b: Doc<"originalTakes">) => a.publishedAt - b.publishedAt || a._creationTime - b._creationTime || a._id.localeCompare(b._id);
  candidates.sort(compare);
  const scope = accessScope();
  for (const candidate of candidates.slice(0, 256)) {
    if (candidate.authorId === original.authorId || candidate.optionId === original.optionId) continue;
    if (!availableUser(await readUser(ctx, candidate.authorId, scope)) || await blocked(ctx, original.authorId, candidate.authorId, scope)) continue;
    const [left, right] = compare(candidate, original) < 0 ? [candidate, original] : [original, candidate];
    const battleId = await ctx.db.insert("battles", { roundId: original.roundId, leftId: left._id, rightId: right._id, leftVotes: 0, rightVotes: 0 });
    await ctx.db.patch(left._id, { battleId });
    await ctx.db.patch(right._id, { battleId });
    return;
  }
  if (candidates.length > 256) fail("LIMIT_REACHED", "Battle pairing exceeds its visibility budget", true);
}
export async function unlinkBattle(ctx: MutationCtx, original: Doc<"originalTakes">) {
  if (!original.battleId) return;
  const battle = await ctx.db.get(original.battleId);
  await ctx.db.patch(original._id, { battleId: undefined });
  if (!battle) return;
  for (const id of [battle.leftId, battle.rightId]) {
    if (id === original._id) continue;
    const other = await ctx.db.get(id);
    if (other?.battleId === battle._id) await ctx.db.patch(id, { battleId: undefined });
  }
  await ctx.db.delete(battle._id);
  await ctx.scheduler.runAfter(0, internal.cleanup.battle, { battleId: battle._id });
}
export async function removeVote(ctx: MutationCtx, vote: Doc<"battleVotes">) {
  const battle = await ctx.db.get(vote.battleId);
  if (battle) {
    const field = vote.side === "left" ? "leftVotes" : "rightVotes";
    if (!Number.isSafeInteger(battle[field]) || battle[field] < 1) fail("LIMIT_REACHED", "Vote count is unavailable");
    await ctx.db.patch(battle._id, { [field]: battle[field] - 1 });
  }
  await ctx.db.delete(vote._id);
}
