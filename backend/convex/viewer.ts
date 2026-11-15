import { query } from "./_generated/server";
import { optionalViewer } from "./lib/auth";
import { publicProfile } from "./lib/dto";

export const session = query({ args: {}, handler: async ctx => {
  const user = await optionalViewer(ctx);
  return { profile: user ? publicProfile(user) : null, needsOnboarding: !user };
} });
