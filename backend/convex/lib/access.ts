import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { fail, notFound } from "./errors";
import { availableUser } from "./auth";

export function accessScope() {
  return {
    users: new Map<Id<"users">, Doc<"users"> | null>(),
    parents: new Map<Id<"originalTakes">, Doc<"originalTakes"> | null>(),
    relationships: new Map<string, boolean>(),
    blocks: new Map<string, boolean>(),
    receipts: new Map<string, Doc<"submissionReceipts"> | null>(),
    current: undefined as Doc<"rounds"> | null | undefined,
    reads: 0,
  };
}
export type AccessScope = ReturnType<typeof accessScope>;
export type Content = Doc<"originalTakes"> | Doc<"videoReplies">;
export type ContentKind = "original" | "reply";
export function readBudget(scope: AccessScope, count = 1) {
  scope.reads += count;
  if (scope.reads > 3000) fail("LIMIT_REACHED", "This view exceeds its visibility budget", true);
}
export async function readUser(ctx: QueryCtx, id: Id<"users">, scope: AccessScope) {
  if (!scope.users.has(id)) {
    readBudget(scope);
    scope.users.set(id, await ctx.db.get(id));
  }
  return scope.users.get(id)!;
}

export function pairKey(a: Id<"users">, b: Id<"users">) { return [a, b].sort().join(":"); }
export async function blocked(ctx: QueryCtx, a: Id<"users">, b: Id<"users">, scope?: AccessScope) {
  const pair = pairKey(a, b);
  if (scope?.blocks.has(pair)) return scope.blocks.get(pair)!;
  if (scope) readBudget(scope, 2);
  const result = !!(await ctx.db.query("blocks").withIndex("by_pair", q => q.eq("blockerId", a).eq("blockedId", b)).unique()) ||
    !!(await ctx.db.query("blocks").withIndex("by_pair", q => q.eq("blockerId", b).eq("blockedId", a)).unique());
  scope?.blocks.set(pair, result);
  return result;
}
export async function friends(ctx: QueryCtx, a: Id<"users">, b: Id<"users">, scope?: AccessScope) {
  if (a === b) return true;
  const pair = pairKey(a, b);
  if (scope?.relationships.has(pair)) return scope.relationships.get(pair)!;
  if (scope) readBudget(scope);
  const allowed = !(await blocked(ctx, a, b, scope)) && !!(await ctx.db.query("friendships").withIndex("by_pair", q => q.eq("pair", pair)).unique());
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
export function originalAudience(original: Doc<"originalTakes">) { return original.audience ?? "friends"; }
export async function contentAudience(ctx: QueryCtx, content: Content, scope = accessScope()) {
  if ("optionId" in content) return originalAudience(content);
  if (!scope.parents.has(content.originalId)) {
    readBudget(scope);
    scope.parents.set(content.originalId, await ctx.db.get(content.originalId));
  }
  const parent = scope.parents.get(content.originalId);
  return parent ? originalAudience(parent) : "friends";
}
export async function canViewOriginal(ctx: QueryCtx, user: Doc<"users">, original: Doc<"originalTakes"> | null, scope = accessScope()) {
  if (!original || original.deleted || !availableUser(user)) return false;
  const author = await readUser(ctx, original.authorId, scope);
  if (!availableUser(author)) return false;
  const isPublic = originalAudience(original) === "public";
  if (!isPublic && original.authorId === user._id) return true;
  if (!isPublic) {
    if (scope.current === undefined) scope.current = await currentRound(ctx);
    if (scope.current?._id !== original.roundId) return false;
  }
  const key = `${user._id}:${original.roundId}`;
  if (!scope.receipts.has(key)) {
    readBudget(scope);
    scope.receipts.set(key, await receipt(ctx, user._id, original.roundId));
  }
  return !!scope.receipts.get(key) && (isPublic ? !(await blocked(ctx, user._id, original.authorId, scope)) : await friends(ctx, user._id, original.authorId, scope));
}
export async function canViewReply(ctx: QueryCtx, user: Doc<"users">, reply: Doc<"videoReplies"> | null, scope = accessScope()) {
  if (!reply || reply.deleted || !availableUser(user)) return false;
  if (!scope.parents.has(reply.originalId)) {
    readBudget(scope);
    scope.parents.set(reply.originalId, await ctx.db.get(reply.originalId));
  }
  const parent = scope.parents.get(reply.originalId)!;
  const author = await readUser(ctx, reply.authorId, scope);
  if (!parent || reply.roundId !== parent.roundId || !availableUser(author) || !(await canViewOriginal(ctx, user, parent, scope))) return false;
  if (originalAudience(parent) === "public") return !(await blocked(ctx, user._id, reply.authorId, scope));
  if (!(await friends(ctx, parent.authorId, reply.authorId, scope))) return false;
  if (user._id === parent.authorId || user._id === reply.authorId) return true;
  return await friends(ctx, user._id, reply.authorId, scope);
}
export async function canViewContent(ctx: QueryCtx, user: Doc<"users">, content: Content, scope = accessScope()) {
  return "optionId" in content ? canViewOriginal(ctx, user, content, scope) : canViewReply(ctx, user, content, scope);
}
export async function authorizedContent(ctx: QueryCtx, user: Doc<"users">, contentId: string, kind: ContentKind, scope = accessScope()) {
  if (kind === "original") {
    const id = ctx.db.normalizeId("originalTakes", contentId);
    const content = id ? await ctx.db.get(id) : null;
    if (!content || !(await canViewOriginal(ctx, user, content, scope))) return notFound();
    return content;
  }
  const id = ctx.db.normalizeId("videoReplies", contentId);
  const content = id ? await ctx.db.get(id) : null;
  if (!content || !(await canViewReply(ctx, user, content, scope))) return notFound();
  return content;
}
export async function canReply(ctx: QueryCtx, user: Doc<"users">, parent: Doc<"originalTakes"> | null) {
  return !!parent && (await currentRound(ctx))?._id === parent.roundId && !!(await receipt(ctx, user._id, parent.roundId)) &&
    await canViewOriginal(ctx, user, parent) && (originalAudience(parent) === "public" || await friends(ctx, user._id, parent.authorId));
}
export async function canViewCommentAuthor(ctx: QueryCtx, user: Doc<"users">, content: Content, authorId: Id<"users">, scope = accessScope()) {
  if (!(await canViewContent(ctx, user, content, scope))) return false;
  if (!availableUser(await readUser(ctx, authorId, scope)) || await blocked(ctx, user._id, authorId, scope)) return false;
  if (await contentAudience(ctx, content, scope) === "public") return true;
  if (!(await friends(ctx, content.authorId, authorId, scope))) return false;
  if (user._id === content.authorId || user._id === authorId) return true;
  return await friends(ctx, user._id, content.authorId, scope) && await friends(ctx, user._id, authorId, scope);
}
export async function canViewComment(ctx: QueryCtx, user: Doc<"users">, comment: Doc<"comments"> | null, scope = accessScope(), content?: Content) {
  if (!comment || comment.deleted) return false;
  if (!content) {
    const id = ctx.db.normalizeId(comment.kind === "original" ? "originalTakes" : "videoReplies", comment.contentId);
    content = id ? (await ctx.db.get(id)) ?? undefined : undefined;
  }
  if (!content || content._id !== comment.contentId || ("optionId" in content ? "original" : "reply") !== comment.kind) return false;
  return canViewCommentAuthor(ctx, user, content, comment.authorId, scope);
}
export async function authorizedComment(ctx: QueryCtx, user: Doc<"users">, commentId: string, scope = accessScope()) {
  const id = ctx.db.normalizeId("comments", commentId);
  const comment = id ? await ctx.db.get(id) : null;
  if (!comment || !(await canViewComment(ctx, user, comment, scope))) return notFound();
  return comment;
}
