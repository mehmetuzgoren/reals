import { v, ConvexError } from "convex/values";
import { action, query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { kind, failure, audience } from "./schema";
import { viewer } from "./lib/auth";
import { canReply, currentRound, originalAudience, receipt } from "./lib/access";
import { pairOriginal } from "./lib/battles";
import { orderKey } from "./lib/pagination";
import { receiptDTO } from "./lib/dto";
import { bounded, fail, httpOrigin, notFound } from "./lib/errors";
import type { Failure } from "./lib/errors";
import { sha256, randomToken, verifyVideo } from "./lib/verification";

export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_DURATION_MS = 3000;
export const MAX_DURATION_MS = 15000;
const leaseMs = 120000;

async function eligible(ctx: QueryCtx, user: Doc<"users">, upload: Pick<Doc<"uploads">, "kind" | "roundId" | "optionId" | "originalId">) {
  const round = await currentRound(ctx);
  if (!round || round._id !== upload.roundId) fail("ROUND_CLOSED", "This round is no longer accepting takes");
  if (upload.kind === "original") {
    if (upload.originalId !== null || !round.options.some(option => option.id === upload.optionId)) fail("INVALID_OPTION", "Choose an answer for this round");
    if (await receipt(ctx, user._id, upload.roundId)) fail("ALREADY_PUBLISHED", "You already published in this round");
  } else {
    if (upload.optionId !== null || !upload.originalId) fail("INVALID_ARGUMENT", "Replies require a parent and no position");
    const parent = await ctx.db.get(upload.originalId);
    if (!parent || parent.roundId !== round._id || !(await canReply(ctx, user, parent))) return notFound();
    if ((await ctx.db.query("videoReplies").withIndex("by_original_time", q => q.eq("originalId", parent._id)).take(50)).length >= 50) fail("LIMIT_REACHED", "This conversation has reached its reply limit");
  }
}
async function owned(ctx: QueryCtx, uploadId: string) {
  const user = await viewer(ctx);
  const id = ctx.db.normalizeId("uploads", uploadId);
  const upload = id ? await ctx.db.get(id) : null;
  if (!upload || upload.ownerId !== user._id) return notFound();
  return { user, upload };
}
export async function publicationResult(ctx: QueryCtx, upload: Doc<"uploads">) {
  return {
    state: upload.state === "published" ? "published" as const : upload.state === "failed" || upload.state === "cancelled" ? "failed" as const : "processing" as const,
    originalId: upload.publishedOriginalId, replyId: upload.publishedReplyId,
    receipt: upload.state === "published" && upload.kind === "original" ? receiptDTO(await receipt(ctx, upload.ownerId, upload.roundId)) : null,
    failure: upload.failure,
  };
}
async function discard(ctx: MutationCtx, upload: Doc<"uploads">, error: Failure, state: "failed" | "cancelled" = "failed") {
  if (upload.storageId) await ctx.scheduler.runAfter(0, internal.cleanup.asset, { storageId: upload.storageId });
  await ctx.db.patch(upload._id, { state, failure: error, storageId: null, sha256: null, lease: null, leaseUntil: 0 });
}

export const begin = mutation({ args: { requestId: v.string(), kind, roundId: v.id("rounds"), optionId: v.union(v.string(), v.null()), originalId: v.union(v.id("originalTakes"), v.null()), audience: v.optional(audience) },
  returns: v.object({ uploadId: v.id("uploads"), uploadUrl: v.string(), expiresAt: v.number(), minDurationMs: v.literal(3000), maxDurationMs: v.literal(15000), maxBytes: v.number() }), handler: async (ctx, args) => {
  const user = await viewer(ctx);
  if (args.kind === "reply" && args.audience !== undefined) fail("INVALID_ARGUMENT", "Replies inherit their parent's audience");
  const requestId = bounded(args.requestId, 8, 128, "request ID");
  const origin = httpOrigin();
  let upload = await ctx.db.query("uploads").withIndex("by_owner_request", q => q.eq("ownerId", user._id).eq("requestId", requestId)).unique();
  if (upload) {
    if (upload.kind !== args.kind || upload.roundId !== args.roundId || upload.optionId !== args.optionId || upload.originalId !== args.originalId ||
      (args.kind === "original" && (upload.audience ?? "friends") !== (args.audience ?? "friends"))) fail("CONFLICT", "This request ID belongs to another publication");
    if (upload.state !== "published" && upload.expiresAt <= Date.now()) fail("UPLOAD_EXPIRED", "Start a new upload");
  } else {
    await eligible(ctx, user, args);
    const active = [
      ...await ctx.db.query("uploads").withIndex("by_owner_state_expiry", q => q.eq("ownerId", user._id).eq("state", "uploading").gt("expiresAt", Date.now())).take(3),
      ...await ctx.db.query("uploads").withIndex("by_owner_state_expiry", q => q.eq("ownerId", user._id).eq("state", "processing").gt("expiresAt", Date.now())).take(3),
    ];
    if (active.length >= 3) fail("LIMIT_REACHED", "Too many active uploads");
    const id = await ctx.db.insert("uploads", {
      ...args, audience: args.kind === "original" ? args.audience ?? "friends" : originalAudience((await ctx.db.get(args.originalId!))!),
      requestId, ownerId: user._id, expiresAt: Date.now() + 600000, createdAt: Date.now(),
      state: "uploading", storageId: null, sha256: null, byteCount: 0, lease: null, leaseUntil: 0, failure: null,
      publishedOriginalId: null, publishedReplyId: null,
    });
    upload = (await ctx.db.get(id))!;
  }
  return { uploadId: upload._id, uploadUrl: `${origin}/v1/uploads/${upload._id}/video`, expiresAt: upload.expiresAt, minDurationMs: MIN_DURATION_MS, maxDurationMs: MAX_DURATION_MS, maxBytes: MAX_BYTES } as const;
} });
export const status = query({ args: { uploadId: v.string() }, handler: async (ctx, args) => {
  const { upload } = await owned(ctx, args.uploadId);
  return {
    state: upload.state === "cancelled" ? "failed" : upload.state,
    progress: upload.state === "published" ? 1 : null,
    result: upload.state === "published" ? await publicationResult(ctx, upload) : null, failure: upload.failure,
  };
} });
export const cancel = mutation({ args: { uploadId: v.string() }, handler: async (ctx, args) => {
  const { upload } = await owned(ctx, args.uploadId);
  if (upload.state === "published") fail("CONFLICT", "Delete the published content instead");
  await discard(ctx, upload, { code: "CANCELLED", message: "Upload cancelled", retryable: false }, "cancelled");
  return { ok: true };
} });

export const claimUpload = internalMutation({ args: { uploadId: v.string(), lease: v.string() }, handler: async (ctx, args) => {
  const { user, upload } = await owned(ctx, args.uploadId);
  if (upload.expiresAt <= Date.now()) fail("UPLOAD_EXPIRED", "Upload expired");
  await eligible(ctx, user, upload);
  if (upload.state !== "uploading" || upload.storageId || upload.leaseUntil > Date.now()) fail("CONFLICT", "Upload already received or in progress", true);
  await ctx.db.patch(upload._id, { lease: args.lease, leaseUntil: Date.now() + leaseMs });
  return upload._id;
} });
export const releaseUpload = internalMutation({ args: { uploadId: v.string(), lease: v.string() }, handler: async (ctx, args) => {
  const id = ctx.db.normalizeId("uploads", args.uploadId);
  const upload = id ? await ctx.db.get(id) : null;
  if (upload && upload.state === "uploading" && upload.lease === args.lease) await ctx.db.patch(upload._id, { lease: null, leaseUntil: 0 });
} });
export const bindUpload = internalMutation({ args: { uploadId: v.id("uploads"), lease: v.string(), storageId: v.id("_storage"), sha256: v.string(), byteCount: v.number() }, handler: async (ctx, args) => {
  const { user, upload } = await owned(ctx, args.uploadId);
  if (upload.state !== "uploading" || upload.storageId || upload.lease !== args.lease || upload.leaseUntil <= Date.now() || upload.expiresAt <= Date.now()) return false;
  await eligible(ctx, user, upload);
  if (args.byteCount <= 0 || args.byteCount > MAX_BYTES || !/^[a-f0-9]{64}$/.test(args.sha256)) return false;
  await ctx.db.patch(upload._id, { storageId: args.storageId, sha256: args.sha256, byteCount: args.byteCount, lease: null, leaseUntil: 0 });
  return true;
} });
export const claimFinalization = internalMutation({ args: { uploadId: v.string(), lease: v.string() }, handler: async (ctx, args) => {
  const { user, upload } = await owned(ctx, args.uploadId);
  if (upload.state === "published" || upload.state === "cancelled" || (upload.state === "failed" && !upload.failure?.retryable)) return { upload: null, result: await publicationResult(ctx, upload) };
  if (upload.expiresAt <= Date.now()) {
    await discard(ctx, upload, { code: "UPLOAD_EXPIRED", message: "Upload expired", retryable: false });
    return { upload: null, result: await publicationResult(ctx, (await ctx.db.get(upload._id))!) };
  }
  if (upload.leaseUntil > Date.now()) return { upload: null, result: await publicationResult(ctx, upload) };
  if (!upload.storageId || !upload.sha256) fail("INVALID_MEDIA", "Upload the video before publishing");
  try { await eligible(ctx, user, upload); }
  catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    await discard(ctx, upload, error.data as Failure);
    return { upload: null, result: await publicationResult(ctx, (await ctx.db.get(upload._id))!) };
  }
  await ctx.db.patch(upload._id, { state: "processing", failure: null, lease: args.lease, leaseUntil: Date.now() + leaseMs });
  return { upload, result: null };
} });
export const recordFailure = internalMutation({ args: { uploadId: v.id("uploads"), lease: v.string(), failure }, handler: async (ctx, args) => {
  const upload = await ctx.db.get(args.uploadId);
  if (!upload || upload.state !== "processing" || upload.lease !== args.lease) return;
  if (args.failure.retryable) await ctx.db.patch(upload._id, { state: "failed", failure: args.failure, lease: null, leaseUntil: 0 });
  else await discard(ctx, upload, args.failure);
} });
export const commit = internalMutation({ args: {
  uploadId: v.id("uploads"), lease: v.string(), sha256: v.string(), durationMs: v.number(),
  width: v.number(), height: v.number(), thumbnailStorageId: v.union(v.id("_storage"), v.null()),
}, handler: async (ctx, args) => {
  const { user, upload } = await owned(ctx, args.uploadId);
  if (upload.state === "published") return { committed: false, result: await publicationResult(ctx, upload) };
  if (upload.state !== "processing" || upload.lease !== args.lease || upload.leaseUntil <= Date.now()) fail("CONFLICT", "Processing attempt expired", true);
  let invalid: Failure | null = null;
  if (upload.expiresAt <= Date.now()) invalid = { code: "UPLOAD_EXPIRED", message: "Upload expired", retryable: false };
  if (!upload.storageId || args.sha256 !== upload.sha256 || !Number.isFinite(args.durationMs) || args.durationMs < MIN_DURATION_MS || args.durationMs > MAX_DURATION_MS ||
    !Number.isInteger(args.width) || !Number.isInteger(args.height) || args.width <= 0 || args.height <= 0 || Math.max(args.width, args.height) > 4096 || Math.min(args.width, args.height) > 2160) invalid = { code: "INVALID_MEDIA", message: "A valid video between 3 and 15 seconds is required", retryable: false };
  if (!invalid) {
    try { await eligible(ctx, user, upload); }
    catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      invalid = error.data as Failure;
    }
  }
  if (invalid) {
    await discard(ctx, upload, invalid);
    return { committed: false, result: await publicationResult(ctx, (await ctx.db.get(upload._id))!) };
  }
  const publishedAt = Date.now();
  let publishedOriginalId = null;
  let publishedReplyId = null;
  const content = { authorId: user._id, roundId: upload.roundId, publishedAt, durationMs: args.durationMs, videoStorageId: upload.storageId!, thumbnailStorageId: args.thumbnailStorageId, deleted: false };
  if (upload.kind === "original") {
    publishedOriginalId = await ctx.db.insert("originalTakes", { ...content, optionId: upload.optionId!, audience: upload.audience ?? "friends" });
    await ctx.db.patch(publishedOriginalId, { orderKey: orderKey(publishedAt, (await ctx.db.get(publishedOriginalId))!._creationTime, publishedOriginalId) });
    await ctx.db.insert("submissionReceipts", { userId: user._id, roundId: upload.roundId, publishedAt, originalId: publishedOriginalId });
    await pairOriginal(ctx, (await ctx.db.get(publishedOriginalId))!);
  } else {
    publishedReplyId = await ctx.db.insert("videoReplies", { ...content, originalId: upload.originalId! });
    const parent = (await ctx.db.get(upload.originalId!))!;
    if (parent.authorId !== user._id) {
      const jobId = await ctx.db.insert("notificationJobs", { kind: "reply", roundId: upload.roundId, replyId: publishedReplyId, recipientId: parent.authorId, cursor: null, state: "pending", attempts: 0 });
      await ctx.scheduler.runAfter(0, internal.push.deliver, { jobId });
    }
  }
  await ctx.db.patch(upload._id, { state: "published", publishedOriginalId, publishedReplyId, storageId: null, sha256: null, lease: null, leaseUntil: 0, failure: null });
  return { committed: true, result: await publicationResult(ctx, (await ctx.db.get(upload._id))!) };
} });

export const finalize = action({ args: { uploadId: v.string() }, handler: async (ctx, args): Promise<{
  state: "processing" | "published" | "failed"; originalId: string | null; replyId: string | null;
  receipt: { roundId: string; publishedAt: number; originalId: string | null } | null; failure: Failure | null;
}> => {
  const lease = randomToken();
  const claim = await ctx.runMutation(internal.uploads.claimFinalization, { ...args, lease });
  if (!claim.upload) return claim.result;
  const upload: Doc<"uploads"> = claim.upload;
  let thumbnailStorageId = null;
  try {
    const blob = await ctx.storage.get(upload.storageId!);
    if (!blob || blob.size !== upload.byteCount || blob.size > MAX_BYTES) fail("INVALID_MEDIA", "Uploaded bytes are unavailable or invalid");
    const bytes = await blob.arrayBuffer();
    const hash = await sha256(bytes);
    if (hash !== upload.sha256) fail("INVALID_MEDIA", "Uploaded bytes do not match this intent");
    const verified = await verifyVideo(bytes, hash);
    if (verified.thumbnail) thumbnailStorageId = await ctx.storage.store(new Blob([verified.thumbnail], { type: "image/jpeg" }));
    const committed = await ctx.runMutation(internal.uploads.commit, {
      uploadId: upload._id, lease, sha256: hash, durationMs: verified.durationMs, width: verified.width, height: verified.height, thumbnailStorageId,
    });
    if (!committed.committed && thumbnailStorageId) await ctx.storage.delete(thumbnailStorageId);
    return committed.result;
  } catch (error) {
    if (thumbnailStorageId) await ctx.storage.delete(thumbnailStorageId);
    const failure: Failure = error instanceof ConvexError ? error.data as Failure : { code: "PROCESSING_UNAVAILABLE", message: "Video processing is temporarily unavailable", retryable: true };
    await ctx.runMutation(internal.uploads.recordFailure, { uploadId: upload._id, lease, failure });
    const state = await ctx.runQuery(internal.uploadState.result, { uploadId: upload._id });
    return state;
  }
} });
