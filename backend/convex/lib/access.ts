import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { notFound } from "./errors";
import { availableUser } from "./auth";

export function accessScope() {
  return {
    users: new Map<Id<"users">, Doc<"users"> | null>(),
    parents: new Map<Id<"originalTakes">, Doc<"originalTakes"> | null>(),
    relationships: new Map<string, boolean>(),
    receipts: new Map<string, Doc<"submissionReceipts"> | null>(),
    current: undefined as Doc<"rounds"> | null | undefined,
  };
}
type AccessScope = ReturnType<typeof accessScope>;
export async function readUser(ctx: QueryCtx, id: Id<"users">, scope: AccessScope) {
  if (!scope.users.has(id)) scope.users.set(id, await ctx.db.get(id));
  return scope.users.get(id)!;
}

export function pairKey(a: Id<"users">, b: Id<"users">) { return [a, b].sort().join(":"); }
export async function blocked(ctx: QueryCtx, a: Id<"users">, b: Id<"users">) {
  return !!(await ctx.db.query("blocks").withIndex("by_pair", q => q.eq("blockerId", a).eq("blockedId", b)).unique()) ||
    !!(await ctx.db.query("blocks").withIndex("by_pair", q => q.eq("blockerId", b).eq("blockedId", a)).unique());
}
export async function friends(ctx: QueryCtx, a: Id<"users">, b: Id<"users">, scope?: AccessScope) {
  if (a === b) return true;
  const pair = pairKey(a, b);
  if (scope?.relationships.has(pair)) return scope.relationships.get(pair)!;
  const allowed = !(await blocked(ctx, a, b)) && !!(await ctx.db.query("friendships").withIndex("by_pair", q => q.eq("pair", pair)).unique());
  scope?.relationships.set(pair, allowed);
  return allowed;
}
export async function currentRound(ctx: QueryCtx) {
  const pointer = await ctx.db.query("currentRound").withIndex("by_key", q => q.eq("key", "global")).unique();
  return pointer ? ctx.db.get(pointer.roundId) : null;
}
export async function receipt(ctx: QueryCtx, userId: Id<"users">, roundId: Id<"rounds">) {
  return ctx.db.query("submissionReceipts").withIndex("by_round_user", q => q.eq("roundId", roundId).eq("userId", userId)).unique();
}
export async function canViewOriginal(ctx: QueryCtx, user: Doc<"users">, original: Doc<"originalTakes"> | null, scope = accessScope()) {
  if (!original || original.deleted || !availableUser(user)) return false;
  const author = await readUser(ctx, original.authorId, scope);
  if (!availableUser(author)) return false;
  if (original.authorId === user._id) return true;
  if (scope.current === undefined) scope.current = await currentRound(ctx);
  if (scope.current?._id !== original.roundId) return false;
  const key = `${user._id}:${original.roundId}`;
  if (!scope.receipts.has(key)) scope.receipts.set(key, await receipt(ctx, user._id, original.roundId));
  return !!scope.receipts.get(key) && await friends(ctx, user._id, original.authorId, scope);
}
export async function canViewReply(ctx: QueryCtx, user: Doc<"users">, reply: Doc<"videoReplies"> | null, scope = accessScope()) {
  if (!reply || reply.deleted || !availableUser(user)) return false;
  if (!scope.parents.has(reply.originalId)) scope.parents.set(reply.originalId, await ctx.db.get(reply.originalId));
  const parent = scope.parents.get(reply.originalId)!;
  const author = await readUser(ctx, reply.authorId, scope);
  if (!parent || reply.roundId !== parent.roundId || !availableUser(author) || !(await canViewOriginal(ctx, user, parent, scope))) return false;
  if (!(await friends(ctx, parent.authorId, reply.authorId, scope))) return false;
  if (user._id === parent.authorId || user._id === reply.authorId) return true;
  return await friends(ctx, user._id, reply.authorId, scope);
}
export async function authorizedContent(ctx: QueryCtx, user: Doc<"users">, contentId: string, kind: "original" | "reply") {
  if (kind === "original") {
    const id = ctx.db.normalizeId("originalTakes", contentId);
    const content = id ? await ctx.db.get(id) : null;
    if (!content || !(await canViewOriginal(ctx, user, content))) return notFound();
    return content;
  }
  const id = ctx.db.normalizeId("videoReplies", contentId);
  const content = id ? await ctx.db.get(id) : null;
  if (!content || !(await canViewReply(ctx, user, content))) return notFound();
  return content;
}
export async function canReply(ctx: QueryCtx, user: Doc<"users">, parent: Doc<"originalTakes"> | null) {
  return !!parent && (await currentRound(ctx))?._id === parent.roundId && !!(await receipt(ctx, user._id, parent.roundId)) &&
    await canViewOriginal(ctx, user, parent) && await friends(ctx, user._id, parent.authorId);
}
