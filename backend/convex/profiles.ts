import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticatedUser, availableUser, viewer } from "./lib/auth";
import { bounded, fail, httpOrigin, notFound } from "./lib/errors";
import { originalDTO, pageLimit, publicProfile } from "./lib/dto";
import { accessScope } from "./lib/access";

export const completeOnboarding = mutation({ args: { username: v.string(), displayName: v.string() }, handler: async (ctx, args) => {
  const user = await authenticatedUser(ctx);
  if (user.username !== null) return publicProfile(user);
  const username = args.username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fail("INVALID_ARGUMENT", "Username must be 3–24 letters, numbers or underscores");
  if (await ctx.db.query("users").withIndex("by_username", q => q.eq("username", username)).unique()) fail("USERNAME_TAKEN", "This username is taken");
  await ctx.db.patch(user._id, { username, displayName: bounded(args.displayName, 1, 60, "display name") });
  return publicProfile((await ctx.db.get(user._id))!);
} });
export const mine = query({ args: { cursor: v.union(v.string(), v.null()), limit: v.number() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const page = await ctx.db.query("originalTakes").withIndex("by_author", q => q.eq("authorId", user._id)).order("desc")
    .paginate({ cursor: args.cursor, numItems: Math.min(10, pageLimit(args.limit)) });
  const items = [];
  const scope = accessScope();
  for (const original of page.page) if (!original.deleted) items.push(await originalDTO(ctx, user, original, scope));
  return { profile: publicProfile(user), preferences: user.preferences, originals: { items, nextCursor: page.isDone ? null : page.continueCursor } };
} });
export const setNotifications = mutation({ args: { dailyQuestion: v.boolean(), directReply: v.boolean() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  await ctx.db.patch(user._id, { preferences: args });
  return args;
} });
export const beginAvatarUpload = mutation({ args: { requestId: v.string() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const requestId = bounded(args.requestId, 8, 128, "request ID");
  const existing = await ctx.db.query("avatarUploads").withIndex("by_owner_request", q => q.eq("ownerId", user._id).eq("requestId", requestId)).unique();
  const origin = httpOrigin();
  let uploadId = existing?._id;
  let expiresAt = existing?.expiresAt ?? Date.now() + 600000;
  if (existing && (existing.expiresAt <= Date.now() || existing.state === "cancelled" || existing.state === "used")) fail("UPLOAD_EXPIRED", "Start a new avatar upload");
  if (!uploadId) {
    const active = [
      ...await ctx.db.query("avatarUploads").withIndex("by_owner_state_expiry", q => q.eq("ownerId", user._id).eq("state", "uploading").gt("expiresAt", Date.now())).take(3),
      ...await ctx.db.query("avatarUploads").withIndex("by_owner_state_expiry", q => q.eq("ownerId", user._id).eq("state", "ready").gt("expiresAt", Date.now())).take(3),
    ];
    if (active.length >= 3) fail("LIMIT_REACHED", "Too many active avatar uploads");
    uploadId = await ctx.db.insert("avatarUploads", { ownerId: user._id, requestId, expiresAt, state: "uploading", lease: null, leaseUntil: 0, storageId: null, width: 0, height: 0 });
  }
  return { uploadId, uploadUrl: `${origin}/v1/uploads/${uploadId}/avatar`, expiresAt, maxBytes: 2 * 1024 * 1024, acceptedMimeTypes: ["image/jpeg", "image/png"], maxWidth: 2048, maxHeight: 2048 };
} });
export const update = mutation({ args: { displayName: v.string(), avatarUploadId: v.union(v.string(), v.null()) }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const displayName = bounded(args.displayName, 1, 60, "display name");
  let avatarStorageId = user.avatarStorageId;
  let avatarWidth = user.avatarWidth;
  let avatarHeight = user.avatarHeight;
  if (args.avatarUploadId !== null) {
    const id = ctx.db.normalizeId("avatarUploads", args.avatarUploadId);
    const upload = id ? await ctx.db.get(id) : null;
    if (!upload || upload.ownerId !== user._id) return notFound();
    if (upload.expiresAt <= Date.now()) fail("UPLOAD_EXPIRED", "Avatar upload expired");
    if (upload.state === "used" && upload.storageId === null) {
      await ctx.db.patch(user._id, { displayName });
      return publicProfile((await ctx.db.get(user._id))!);
    }
    if (upload.state !== "ready" || !upload.storageId) fail("INVALID_MEDIA", "Upload and verify the avatar first");
    avatarStorageId = upload.storageId;
    avatarWidth = upload.width;
    avatarHeight = upload.height;
    await ctx.db.patch(upload._id, { state: "used", storageId: null });
    if (user.avatarStorageId) await ctx.scheduler.runAfter(0, internal.cleanup.asset, { storageId: user.avatarStorageId });
  }
  await ctx.db.patch(user._id, { displayName, avatarStorageId, avatarWidth, avatarHeight });
  return publicProfile((await ctx.db.get(user._id))!);
} });
export const claimAvatar = internalMutation({ args: { uploadId: v.string(), lease: v.string() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const id = ctx.db.normalizeId("avatarUploads", args.uploadId);
  const upload = id ? await ctx.db.get(id) : null;
  if (!upload || upload.ownerId !== user._id) return notFound();
  if (upload.expiresAt <= Date.now()) fail("UPLOAD_EXPIRED", "Avatar upload expired");
  if (upload.state !== "uploading" || upload.leaseUntil > Date.now()) fail("CONFLICT", "Avatar upload already received or in progress", true);
  await ctx.db.patch(upload._id, { lease: args.lease, leaseUntil: Date.now() + 120000 });
  return upload._id;
} });
export const bindAvatar = internalMutation({ args: { uploadId: v.id("avatarUploads"), lease: v.string(), storageId: v.id("_storage"), width: v.number(), height: v.number() }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const upload = await ctx.db.get(args.uploadId);
  if (!upload || upload.ownerId !== user._id || upload.state !== "uploading" || upload.lease !== args.lease || upload.leaseUntil <= Date.now() || upload.expiresAt <= Date.now()) return false;
  if (!Number.isInteger(args.width) || !Number.isInteger(args.height) || args.width < 1 || args.height < 1 || args.width > 2048 || args.height > 2048) return false;
  await ctx.db.patch(upload._id, { storageId: args.storageId, width: args.width, height: args.height, state: "ready", lease: null, leaseUntil: 0 });
  return true;
} });
export const releaseAvatar = internalMutation({ args: { uploadId: v.string(), lease: v.string() }, handler: async (ctx, args) => {
  const id = ctx.db.normalizeId("avatarUploads", args.uploadId);
  const upload = id ? await ctx.db.get(id) : null;
  if (upload?.state === "uploading" && upload.lease === args.lease) await ctx.db.patch(upload._id, { lease: null, leaseUntil: 0 });
} });
export const avatarAsset = internalQuery({ args: { userId: v.string() }, handler: async (ctx, args) => {
  const id = ctx.db.normalizeId("users", args.userId);
  const user = id ? await ctx.db.get(id) : null;
  return availableUser(user) ? user.avatarStorageId : null;
} });
