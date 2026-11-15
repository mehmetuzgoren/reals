import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fail } from "./lib/errors";

export const seed = internalAction({ args: {}, handler: async ctx => {
  if (process.env.TAKE_DEPLOYMENT_ENV !== "development" || process.env.TAKE_ALLOW_DEV_SEED !== "true") fail("NOT_FOUND", "Development seeding is disabled");
  await ctx.runAction(internal.planner.plan, {});
  return { seeded: "server round plans only; no users, receipts or authentication bypass" };
} });
