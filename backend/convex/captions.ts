import { v } from "convex/values";
import { query } from "./_generated/server";
import { kind } from "./schema";
import { viewer } from "./lib/auth";
import { authorizedContent } from "./lib/access";

export const get = query({ args: { contentId: v.string(), kind }, handler: async (ctx, args) => {
  await authorizedContent(ctx, await viewer(ctx), args.contentId, args.kind);
  return { status: "unavailable", text: null };
} });
