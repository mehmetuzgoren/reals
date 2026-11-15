import { action, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { authenticatedUser, identity } from "./lib/auth";
import { fail } from "./lib/errors";

export const requestDeletion = action({ args: {}, handler: async (ctx): Promise<{ state: string; jobId: string }> => ctx.runMutation(internal.accounts.start, {}) });
export const start = internalMutation({ args: {}, handler: async ctx => {
  const user = await authenticatedUser(ctx);
  const { sessionId } = await identity(ctx);
  const sessions = await ctx.runQuery(components.auth.public.listSessions, { userId: user._id });
  const current = sessions.find(session => session.sessionId === sessionId);
  const now = Date.now();
  if (!current || current.creationTime < now - 300000 || current.creationTime > now + 60000) fail("REAUTH_REQUIRED", "Sign in again before deleting your account");
  const jobId = await ctx.db.insert("deletionJobs", { userId: user._id, state: "pending", createdAt: now });
  await ctx.db.patch(user._id, { status: "deleting", username: null, displayName: "Deleted account", avatarStorageId: null, avatarWidth: 0, avatarHeight: 0, preferences: { dailyQuestion: false, directReply: false } });
  await ctx.runMutation(components.auth.public.revokeSessions, { sessionIds: sessions.map(session => session.sessionId) });
  if (user.avatarStorageId) await ctx.scheduler.runAfter(0, internal.cleanup.asset, { storageId: user.avatarStorageId });
  await ctx.scheduler.runAfter(0, internal.cleanup.account, { jobId });
  return { state: "pending", jobId };
} });
