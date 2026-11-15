"use node";

import { v } from "convex/values";
import { getMessaging } from "firebase-admin/messaging";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { firebaseApp } from "./lib/firebase";
import { randomBytes } from "node:crypto";
import type { Id } from "./_generated/dataModel";

export function pushMessage(target: { kind: string; roundId: string; contentId: string | null }) {
  return {
    notification: { title: "TAKE", body: target.kind === "daily" ? "A new question is ready. Give your take." : "You have a new video reply." },
    data: { type: target.kind, roundId: target.roundId, ...(target.contentId ? { contentId: target.contentId } : {}) },
    apns: { headers: { "apns-priority": "10", "apns-push-type": "alert" }, payload: { aps: { sound: "default" } } },
  };
}
export const deliver = internalAction({ args: { jobId: v.id("notificationJobs") }, handler: async (ctx, args) => {
  const lease = randomBytes(16).toString("hex");
  if (!(await ctx.runMutation(internal.notifications.claim, { ...args, lease }))) return;
  const batch = await ctx.runQuery(internal.notifications.batch, args);
  if (!batch) return;
  let unavailable = false;
  for (const device of batch.items as { id: Id<"deviceTokens"> }[]) {
    const check = await ctx.runMutation(internal.notifications.target, { ...args, deviceId: device.id, lease });
    if (check.lostLease) return;
    const target = check.target;
    if (!target) continue;
    try {
      await getMessaging(firebaseApp()).send({ token: target.token, ...pushMessage(target) });
      const finished = await ctx.runMutation(internal.notifications.finishAttempt, { ...args, deviceId: device.id, lease, token: target.token, outcome: "sent" });
      if (!finished.validLease) return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        const finished = await ctx.runMutation(internal.notifications.finishAttempt, { ...args, deviceId: device.id, lease, token: target.token, outcome: "invalid" });
        if (!finished.validLease) return;
        if (finished.retry) unavailable = true;
      } else unavailable = true;
    }
  }
  await ctx.runMutation(internal.notifications.progress, { ...args, lease, nextCursor: batch.nextCursor, done: batch.done, unavailable });
} });
