"use node";

import { randomInt } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { dailyPlans } from "./lib/schedule";

export const plan = internalAction({ args: {}, handler: async ctx => {
  const timeZone = process.env.TAKE_ROUND_TIMEZONE ?? "America/Los_Angeles";
  const startHour = Number(process.env.TAKE_ROUND_START_HOUR ?? "10");
  const endHour = Number(process.env.TAKE_ROUND_END_HOUR ?? "20");
  for (const plan of dailyPlans(Date.now(), timeZone, startHour, endHour, () => randomInt(0, 2 ** 32) / 2 ** 32)) {
    await ctx.runMutation(internal.rounds.plan, plan);
  }
} });
