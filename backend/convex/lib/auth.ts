import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { fail } from "./errors";

export function availableUser(user: Doc<"users"> | null): user is Doc<"users"> {
  return !!user && user.status === "active" && (user.authMethod === "apple" || process.env.TAKE_DEPLOYMENT_ENV === "development");
}
export async function identity(ctx: Pick<QueryCtx, "auth" | "runQuery">) {
  const value = await ctx.auth.getUserIdentity();
  const cloud = process.env.CONVEX_CLOUD_URL;
  if (!cloud || !value || value.issuer !== `${cloud}/components/auth` || !value.subject) {
    fail("UNAUTHENTICATED", "Sign in with Apple to continue");
  }
  const userId = await getAuthUserId(ctx);
  if (!userId) fail("UNAUTHENTICATED", "This session is unavailable");
  return { userId, sessionId: value.subject };
}
export async function authenticatedUser(ctx: QueryCtx | MutationCtx) {
  const auth = await identity(ctx);
  const user = await ctx.db.get(auth.userId);
  if (!availableUser(user)) fail("UNAUTHENTICATED", "This account is unavailable");
  return user;
}
export async function optionalViewer(ctx: QueryCtx | MutationCtx) {
  const user = await authenticatedUser(ctx);
  return user.username === null ? null : user;
}
export async function viewer(ctx: QueryCtx | MutationCtx) {
  const user = await optionalViewer(ctx);
  if (!user) fail("PROFILE_REQUIRED", "Complete your profile to continue");
  return user;
}
