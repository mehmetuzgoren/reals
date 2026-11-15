import type { QueryCtx, MutationCtx } from "../_generated/server";
import { fail } from "./errors";

export async function identity(ctx: Pick<QueryCtx, "auth">) {
  const value = await ctx.auth.getUserIdentity();
  const project = process.env.FIREBASE_PROJECT_ID;
  if (!project || !value || value.issuer !== `https://securetoken.google.com/${project}` || !value.subject || value.subject.length > 128) {
    fail("UNAUTHENTICATED", "Sign in with Apple to continue");
  }
  return value;
}
export async function optionalViewer(ctx: QueryCtx | MutationCtx) {
  const auth = await identity(ctx);
  const user = await ctx.db.query("users").withIndex("by_identity", q => q.eq("issuer", auth.issuer).eq("subject", auth.subject)).unique();
  if (user && user.status !== "active") fail("UNAUTHENTICATED", "This account is unavailable");
  return user;
}
export async function viewer(ctx: QueryCtx | MutationCtx) {
  const user = await optionalViewer(ctx);
  if (!user) fail("PROFILE_REQUIRED", "Complete your profile to continue");
  return user;
}
