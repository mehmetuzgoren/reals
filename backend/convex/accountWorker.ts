"use node";

import { v } from "convex/values";
import { getAuth } from "firebase-admin/auth";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { firebaseApp } from "./lib/firebase";

export const deleteFirebaseIdentity = internalAction({ args: { jobId: v.id("deletionJobs") }, handler: async (ctx, args) => {
  const target = await ctx.runQuery(internal.accounts.firebaseTarget, args);
  if (!target) return;
  let state: "deleted" | "unconfigured" | "failed" = "unconfigured";
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const auth = getAuth(firebaseApp());
      await auth.revokeRefreshTokens(target.subject);
      await auth.deleteUser(target.subject);
      state = "deleted";
    } catch (error) { state = (error as { code?: string }).code === "auth/user-not-found" ? "deleted" : "failed"; }
  }
  await ctx.runMutation(internal.accounts.recordFirebaseDeletion, { ...args, state });
} });
