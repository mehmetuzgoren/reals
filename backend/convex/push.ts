"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPush } from "./lib/pushProvider";
import { randomBytes } from "node:crypto";
import type { Id } from "./_generated/dataModel";

export function pushMessage(target: { kind: string; roundId: string; contentId: string | null }) {
  return {
    notification: { title: "TAKE", body: target.kind === "daily" ? "A new question is ready. Give your take." : "You have a new video reply." },
    data: { type: target.kind, roundId: target.roundId, ...(target.contentId ? { contentId: target.contentId } : {}) },
    apns: { headers: { "apns-priority": "10", "apns-push-type": "alert" }, payload: { aps: { sound: "default" } } },
  };
}
type WorkerBatch = { lease: string; items: { id: Id<"deviceTokens"> }[]; nextCursor: string | null; done: boolean };

export const claimForWorker = internalAction({ args: { jobId: v.id("notificationJobs") }, returns: v.union(v.null(), v.object({ lease: v.string(), items: v.array(v.object({ id: v.id("deviceTokens") })), nextCursor: v.union(v.string(), v.null()), done: v.boolean() })), handler: async (ctx, args): Promise<WorkerBatch | null> => {
  const lease = randomBytes(16).toString("hex");
  if (!(await ctx.runMutation(internal.notifications.claim, { ...args, lease }))) return null;
  const batch = await ctx.runQuery(internal.notifications.batch, args);
  return batch ? { lease, items: batch.items, nextCursor: batch.nextCursor, done: batch.done } : null;
} });

export const deliver = internalAction({ args: { jobId: v.id("notificationJobs") }, handler: async (ctx, args) => {
  const batch = await ctx.runAction(internal.push.claimForWorker, args);
  if (!batch) return;
  const { lease } = batch;
  let unavailable = false;
  for (const device of batch.items) {
    const check = await ctx.runMutation(internal.notifications.target, { ...args, deviceId: device.id, lease });
    if (check.lostLease) return;
    const target = check.target;
    if (!target) continue;
    try {
      const outcome = await sendPush({ token: target.token, ...pushMessage(target) });
      const finished = await ctx.runMutation(internal.notifications.finishAttempt, { ...args, deviceId: device.id, lease, token: target.token, outcome });
      if (!finished.validLease) return;
      if (finished.retry) unavailable = true;
    } catch {
      unavailable = true;
    }
  }
  await ctx.runMutation(internal.notifications.progress, { ...args, lease, nextCursor: batch.nextCursor, done: batch.done, unavailable });
} });
