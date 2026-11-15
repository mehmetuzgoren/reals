import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupApple } from "@convex-dev/auth/methods/apple/server";
import { setupUsernamePassword } from "@convex-dev/auth/methods/username-password/server";
import { v } from "convex/values";
import type { DefaultFunctionArgs, RegisteredMutation } from "convex/server";
import { components, internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { fail } from "./lib/errors";

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

const apple = setupApple(auth, {
  component: components.authApple,
  allowedRedirectOrigins: process.env.CONVEX_SITE_URL ? [process.env.CONVEX_SITE_URL] : [],
}).attachUserCallbacks({ createUser: internal.authUsers.createApple, onSignIn: internal.authUsers.signInApple });

const development = setupUsernamePassword(auth, {
  component: components.authPassword,
  usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.authUsers.createDevelopment, onSignIn: internal.authUsers.signInDevelopment });

function requireApple() {
  if ([process.env.AUTH_APPLE_CLIENT_ID, process.env.AUTH_APPLE_TEAM_ID, process.env.AUTH_APPLE_KEY_ID, process.env.AUTH_APPLE_PRIVATE_KEY].some(value => !value?.trim() || value.trim() === "unconfigured")) fail("PROCESSING_UNAVAILABLE", "Apple sign-in is not configured");
}
function requireDevelopment() {
  if (process.env.TAKE_DEPLOYMENT_ENV !== "development") fail("UNAUTHENTICATED", "Development sign-in is disabled");
}
function invoke<Args extends DefaultFunctionArgs, Result>(method: RegisteredMutation<"public", Args, Result>, ctx: MutationCtx, args: Args): Result {
  return (method as typeof method & { _handler: (ctx: MutationCtx, args: Args) => Result })._handler(ctx, args);
}
export const startSignInWithApple = mutation({ args: { redirectTo: v.string() }, handler: async (ctx, args) => {
  requireApple();
  return invoke(apple.startSignInWithApple, ctx, args);
} });
export const completeSignInWithApple = mutation({ args: { state: v.string(), code: v.string() }, handler: async (ctx, args) => {
  requireApple();
  return invoke(apple.completeSignInWithApple, ctx, args);
} });
export const signUpWithUsernamePassword = mutation({ args: { username: v.string(), password: v.string() }, handler: async (ctx, args) => {
  requireDevelopment();
  return invoke(development.signUpWithUsernamePassword, ctx, args);
} });
export const signInWithUsernamePassword = mutation({ args: { username: v.string(), password: v.string() }, handler: async (ctx, args) => {
  requireDevelopment();
  return invoke(development.signInWithUsernamePassword, ctx, args);
} });
