import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const kind = v.union(v.literal("original"), v.literal("reply"));
export const audience = v.union(v.literal("friends"), v.literal("public"));
export const voteSide = v.union(v.literal("left"), v.literal("right"));
export const failure = v.object({ code: v.string(), message: v.string(), retryable: v.boolean() });
export const option = v.object({ id: v.string(), label: v.string() });
export const preferences = v.object({ dailyQuestion: v.boolean(), directReply: v.boolean() });

export default defineSchema({
  users: defineTable({
    authMethod: v.union(v.literal("apple"), v.literal("developmentPassword")), username: v.union(v.string(), v.null()),
    displayName: v.string(), status: v.union(v.literal("active"), v.literal("disabled"), v.literal("deleting"), v.literal("deleted")),
    avatarStorageId: v.union(v.id("_storage"), v.null()), avatarWidth: v.number(), avatarHeight: v.number(),
    preferences, createdAt: v.number(),
  }).index("by_username", ["username"]).index("by_avatar", ["avatarStorageId"]),
  friendRequests: defineTable({
    senderId: v.id("users"), recipientId: v.id("users"), pair: v.string(), createdAt: v.number(),
  }).index("by_pair", ["pair"]).index("by_sender", ["senderId"]).index("by_recipient", ["recipientId"]),
  friendships: defineTable({
    lowId: v.id("users"), highId: v.id("users"), pair: v.string(), createdAt: v.number(),
  }).index("by_pair", ["pair"]).index("by_low", ["lowId"]).index("by_high", ["highId"]),
  blocks: defineTable({ blockerId: v.id("users"), blockedId: v.id("users"), createdAt: v.number() })
    .index("by_pair", ["blockerId", "blockedId"]).index("by_blocker", ["blockerId"]).index("by_blocked", ["blockedId"]),
  rounds: defineTable({
    planKey: v.string(), question: v.string(), options: v.array(option), plannedAt: v.number(),
    windowStartsAt: v.number(), windowEndsAt: v.number(),
    opensAt: v.union(v.number(), v.null()), closesAt: v.union(v.number(), v.null()),
  }).index("by_plan", ["planKey"]).index("by_planned", ["plannedAt"]),
  currentRound: defineTable({ key: v.literal("global"), roundId: v.id("rounds") }).index("by_key", ["key"]),
  originalTakes: defineTable({
    authorId: v.id("users"), roundId: v.id("rounds"), optionId: v.string(), publishedAt: v.number(),
    audience: v.optional(audience), battleId: v.optional(v.id("battles")), orderKey: v.optional(v.string()),
    durationMs: v.number(), videoStorageId: v.id("_storage"), thumbnailStorageId: v.union(v.id("_storage"), v.null()),
    deleted: v.boolean(),
  }).index("by_round_author", ["roundId", "authorId"]).index("by_round_time", ["roundId", "publishedAt"])
    .index("by_round_audience_deleted_order", ["roundId", "audience", "deleted", "orderKey"])
    .index("by_round_audience_deleted_battle_option_time", ["roundId", "audience", "deleted", "battleId", "optionId", "publishedAt"])
    .index("by_author", ["authorId"]).index("by_video", ["videoStorageId"]).index("by_thumbnail", ["thumbnailStorageId"]),
  submissionReceipts: defineTable({
    userId: v.id("users"), roundId: v.id("rounds"), publishedAt: v.number(), originalId: v.union(v.id("originalTakes"), v.null()),
  }).index("by_round_user", ["roundId", "userId"]).index("by_user", ["userId"]),
  videoReplies: defineTable({
    authorId: v.id("users"), originalId: v.id("originalTakes"), roundId: v.id("rounds"), publishedAt: v.number(),
    durationMs: v.number(), videoStorageId: v.id("_storage"), thumbnailStorageId: v.union(v.id("_storage"), v.null()),
    deleted: v.boolean(),
  }).index("by_original_time", ["originalId", "publishedAt"]).index("by_author", ["authorId"])
    .index("by_video", ["videoStorageId"]).index("by_thumbnail", ["thumbnailStorageId"]),
  uploads: defineTable({
    ownerId: v.id("users"), requestId: v.string(), kind, roundId: v.id("rounds"),
    audience: v.optional(audience),
    optionId: v.union(v.string(), v.null()), originalId: v.union(v.id("originalTakes"), v.null()),
    expiresAt: v.number(), createdAt: v.number(),
    state: v.union(v.literal("uploading"), v.literal("processing"), v.literal("published"), v.literal("failed"), v.literal("cancelled")),
    storageId: v.union(v.id("_storage"), v.null()), sha256: v.union(v.string(), v.null()), byteCount: v.number(),
    lease: v.union(v.string(), v.null()), leaseUntil: v.number(), failure: v.union(failure, v.null()),
    publishedOriginalId: v.union(v.id("originalTakes"), v.null()), publishedReplyId: v.union(v.id("videoReplies"), v.null()),
  }).index("by_owner_request", ["ownerId", "requestId"]).index("by_expiry", ["expiresAt"])
    .index("by_owner", ["ownerId"]).index("by_storage", ["storageId"])
    .index("by_owner_state_expiry", ["ownerId", "state", "expiresAt"]).index("by_state_expiry", ["state", "expiresAt"]),
  avatarUploads: defineTable({
    ownerId: v.id("users"), requestId: v.string(), expiresAt: v.number(),
    state: v.union(v.literal("uploading"), v.literal("ready"), v.literal("used"), v.literal("cancelled")),
    lease: v.union(v.string(), v.null()), leaseUntil: v.number(),
    storageId: v.union(v.id("_storage"), v.null()), width: v.number(), height: v.number(),
  }).index("by_owner_request", ["ownerId", "requestId"]).index("by_owner", ["ownerId"]).index("by_expiry", ["expiresAt"]).index("by_storage", ["storageId"])
    .index("by_owner_state_expiry", ["ownerId", "state", "expiresAt"]),
  mediaGrants: defineTable({
    tokenHash: v.string(), viewerId: v.id("users"), contentId: v.string(), kind,
    asset: v.union(v.literal("video"), v.literal("thumbnail")), expiresAt: v.number(),
  }).index("by_hash", ["tokenHash"]).index("by_expiry", ["expiresAt"]).index("by_viewer", ["viewerId"])
    .index("by_viewer_expiry", ["viewerId", "expiresAt"]),
  deviceTokens: defineTable({
    userId: v.id("users"), installationId: v.string(), token: v.string(), platform: v.literal("ios"),
    notificationsEnabled: v.boolean(), updatedAt: v.number(),
  }).index("by_owner_installation", ["userId", "installationId"]).index("by_user", ["userId"])
    .index("by_token", ["token"]),
  likes: defineTable({ contentId: v.string(), kind, userId: v.id("users"), createdAt: v.number() })
    .index("by_content_kind_user", ["contentId", "kind", "userId"]).index("by_user", ["userId"]),
  likeCounts: defineTable({ contentId: v.string(), kind, count: v.number() })
    .index("by_content_kind", ["contentId", "kind"]),
  comments: defineTable({
    contentId: v.string(), kind, authorId: v.id("users"), text: v.string(), createdAt: v.number(),
    deleted: v.boolean(), orderKey: v.string(),
  }).index("by_content_kind_deleted_order", ["contentId", "kind", "deleted", "orderKey"])
    .index("by_content_kind", ["contentId", "kind"]).index("by_author", ["authorId"]),
  commentCounts: defineTable({ contentId: v.string(), kind, authorId: v.id("users"), count: v.number() })
    .index("by_content_kind_author", ["contentId", "kind", "authorId"]),
  commentRateWindows: defineTable({ userId: v.id("users"), timestamps: v.array(v.number()) })
    .index("by_user", ["userId"]),
  battles: defineTable({
    roundId: v.id("rounds"), leftId: v.id("originalTakes"), rightId: v.id("originalTakes"),
    leftVotes: v.number(), rightVotes: v.number(),
  }),
  battleVotes: defineTable({ battleId: v.id("battles"), userId: v.id("users"), side: voteSide })
    .index("by_battle_user", ["battleId", "userId"]).index("by_user", ["userId"]),
  reports: defineTable({ reporterId: v.id("users"), contentId: v.string(), kind: v.union(kind, v.literal("comment")), reason: v.string(), createdAt: v.number() })
    .index("by_target", ["contentId"]).index("by_reporter", ["reporterId"]),
  notificationJobs: defineTable({
    kind: v.union(v.literal("daily"), v.literal("reply")), roundId: v.id("rounds"),
    replyId: v.union(v.id("videoReplies"), v.null()), recipientId: v.union(v.id("users"), v.null()),
    cursor: v.union(v.string(), v.null()), state: v.union(v.literal("pending"), v.literal("sent"), v.literal("unavailable")),
    attempts: v.number(),
    lease: v.optional(v.string()), leaseUntil: v.optional(v.number()),
  }).index("by_round", ["roundId"]).index("by_state", ["state"]),
  notificationDeliveries: defineTable({
    jobId: v.id("notificationJobs"), deviceId: v.id("deviceTokens"), userId: v.id("users"), state: v.literal("sent"),
  }).index("by_job_device", ["jobId", "deviceId"]).index("by_user", ["userId"]),
  deletionJobs: defineTable({
    userId: v.id("users"), state: v.union(v.literal("pending"), v.literal("complete")),
    createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_state", ["state"]),
});
