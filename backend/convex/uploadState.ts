import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { viewer } from "./lib/auth";
import { notFound } from "./lib/errors";
import { publicationResult } from "./uploads";

export const result = internalQuery({ args: { uploadId: v.id("uploads") }, handler: async (ctx, args) => {
  const user = await viewer(ctx);
  const upload = await ctx.db.get(args.uploadId);
  if (!upload || upload.ownerId !== user._id) return notFound();
  return publicationResult(ctx, upload);
} });
