import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { kind } from "./schema";
import { availableUser, viewer } from "./lib/auth";
import { authorizedContent } from "./lib/access";
import { fail, httpOrigin, notFound } from "./lib/errors";
import { randomToken, sha256 } from "./lib/verification";

const asset = v.union(v.literal("video"), v.literal("thumbnail"));
export const createPlaybackGrant = action({ args: { contentId: v.string(), kind, asset }, handler: async (ctx, args): Promise<{ url: string; expiresAt: number }> => {
  const token = randomToken();
  const tokenHash = await sha256(new TextEncoder().encode(token).buffer);
  const origin = httpOrigin();
  const result = await ctx.runMutation(internal.media.issue, { ...args, tokenHash });
  return { url: `${origin}/v1/media/${result.id}?token=${token}`, expiresAt: result.expiresAt };
} });
export const issue = internalMutation({ args: { contentId: v.string(), kind, asset, tokenHash: v.string() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const content = await authorizedContent(ctx, user, args.contentId, args.kind);
  if (args.asset === "thumbnail" && !content.thumbnailStorageId) return notFound();
  const grants = await ctx.db.query("mediaGrants").withIndex("by_viewer_expiry", q => q.eq("viewerId", user._id).gt("expiresAt", Date.now())).take(200);
  if (grants.length >= 200) fail("LIMIT_REACHED", "Too many active playback requests", true);
  const expiresAt = Date.now() + 60000;
  const id = await ctx.db.insert("mediaGrants", { ...args, viewerId: user._id, expiresAt });
  return { id, expiresAt };
} });
export const resolve = internalQuery({ args: { grantId: v.string(), tokenHash: v.string() }, handler: async (ctx, args) => {
  const id = ctx.db.normalizeId("mediaGrants", args.grantId);
  const grant = id ? await ctx.db.get(id) : null;
  if (!grant || grant.tokenHash !== args.tokenHash || grant.expiresAt <= Date.now()) return notFound();
  const user = await ctx.db.get(grant.viewerId);
  if (!availableUser(user)) return notFound();
  const content = await authorizedContent(ctx, user, grant.contentId, grant.kind);
  const storageId = grant.asset === "video" ? content.videoStorageId : content.thumbnailStorageId;
  if (!storageId) return notFound();
  return { storageId, expiresAt: grant.expiresAt, mimeType: grant.asset === "video" ? "video/mp4" : "image/jpeg" };
} });
