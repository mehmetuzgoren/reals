import { convexTest } from "convex-test";
import { vi } from "vitest";
import { registerCore, sessionIdentity } from "@convex-dev/auth/test";
import { registerPassword } from "@convex-dev/auth/components/password/test";
import { registerUsername } from "@convex-dev/auth/components/username/test";
import { registerAppleOauth } from "@convex-dev/auth/components/apple/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { dailyPlans } from "../convex/lib/schedule";
import * as verification from "../convex/lib/verification";
import { fixtureBytes } from "./media-fixtures";
export { fixtureBytes } from "./media-fixtures";

export const modules = import.meta.glob("../convex/**/*.ts");
export function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
  vi.stubEnv("CONVEX_CLOUD_URL", "https://take-test.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://take-test.convex.site");
  vi.stubEnv("TAKE_DEPLOYMENT_ENV", "development");
  vi.stubEnv("TAKE_HTTP_ORIGIN", "https://take-test.convex.site");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external request"));
  vi.spyOn(verification, "verifyVideo");
  const t = convexTest({ schema, modules, transactionLimits: true });
  registerCore(t);
  registerPassword(t);
  registerUsername(t);
  registerAppleOauth(t);
  return t;
}
export type Test = ReturnType<typeof setup>;
export type Actor = ReturnType<Test["withIdentity"]>;
const sessions = new WeakMap<Test, Map<string, { accessToken: string }>>();
export const testPassword = "test-only development password";
export function sessionClient(t: Test, tokens: { accessToken: string }) {
  return t.withIdentity({ ...sessionIdentity(tokens), issuer: "https://take-test.convex.cloud/components/auth" });
}
export async function actor(t: Test, name: string, extra: Record<string, string | number> = {}) {
  if (!sessions.has(t)) sessions.set(t, new Map());
  const cache = sessions.get(t)!;
  let tokens = cache.get(name);
  if (!tokens) {
    const result = await t.mutation(api.auth.signUpWithUsernamePassword, { username: name, password: testPassword });
    if (result.status !== "complete") throw new Error("Fixture sign-up failed");
    tokens = result.tokens;
    cache.set(name, tokens);
  }
  return t.withIdentity({ ...sessionIdentity(tokens), issuer: "https://take-test.convex.cloud/components/auth", ...extra });
}
export async function user(t: Test, name: string) {
  const client = await actor(t, name);
  const profile = await client.mutation(api.profiles.completeOnboarding, { username: name, displayName: name[0].toUpperCase() + name.slice(1) });
  return { client, profile };
}
export async function round(t: Test, key = "test-round") {
  const { windowStartsAt, windowEndsAt } = dailyPlans(Date.now(), "America/Los_Angeles", 10, 20, () => 0)[0];
  const id = await t.mutation(internal.rounds.plan, {
    planKey: key, plannedAt: Date.now(), windowStartsAt, windowEndsAt, question: "Do you like pineapple on pizza?",
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "depends", label: "Depends" }],
  });
  await t.mutation(internal.rounds.open, { id });
  return id;
}
export async function befriend(a: Actor, aId: Id<"users">, b: Actor, bId: Id<"users">) {
  const pending = await a.mutation(api.friends.request, { userId: bId });
  if (!pending.requestId) throw new Error("Expected a pending request");
  await b.mutation(api.friends.respond, { requestId: pending.requestId, accept: true });
  return aId;
}
let sequence = 0;
export async function begin(client: Actor, roundId: Id<"rounds">, parent: Id<"originalTakes"> | null = null, requestId = `test-request-${++sequence}`) {
  return client.mutation(api.uploads.begin, { requestId, kind: parent ? "reply" : "original", roundId, originalId: parent, optionId: parent ? null : "yes" });
}
export async function send(client: Actor, intent: { uploadUrl: string }, bytes = fixtureBytes) {
  return client.fetch(new URL(intent.uploadUrl).pathname, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: bytes });
}
export async function publish(client: Actor, roundId: Id<"rounds">, parent: Id<"originalTakes"> | null = null) {
  const intent = await begin(client, roundId, parent);
  const response = await send(client, intent);
  if (response.status !== 200) throw new Error(`Upload failed: ${await response.text()}`);
  const result = await client.action(api.uploads.finalize, { uploadId: intent.uploadId });
  if (result.state !== "published") throw new Error(`Publication failed: ${JSON.stringify(result)}`);
  return { intent, result, originalId: result.originalId as Id<"originalTakes">, replyId: result.replyId as Id<"videoReplies"> };
}
export async function playback(client: Actor, contentId: string, kind: "original" | "reply", asset: "video" | "thumbnail" = "video") {
  return client.action(api.media.createPlaybackGrant, { contentId, kind, asset });
}
export function path(url: string) { const parsed = new URL(url); return parsed.pathname + parsed.search; }
export async function seedLegacyThumbnail(t: Test, contentId: Id<"originalTakes"> | Id<"videoReplies">) {
  await t.run(async ctx => {
    const thumbnailStorageId = await ctx.storage.store(new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }));
    await ctx.db.patch(contentId, { thumbnailStorageId });
  });
}
export async function matrix(t: Test) {
  const alex = await user(t, "alex");
  const blair = await user(t, "blair");
  const casey = await user(t, "casey");
  const dana = await user(t, "dana");
  const ellis = await user(t, "ellis");
  const locked = await user(t, "locked");
  const pending = await user(t, "pending");
  for (const [a, b] of [[alex, blair], [alex, casey], [alex, dana], [blair, casey], [blair, ellis], [alex, locked]]) {
    await befriend(a.client, a.profile.id, b.client, b.profile.id);
  }
  await alex.client.mutation(api.friends.request, { userId: pending.profile.id });
  const roundId = await round(t);
  const original = await publish(alex.client, roundId);
  for (const person of [blair, casey, dana, ellis, pending]) await publish(person.client, roundId);
  const reply = await publish(blair.client, roundId, original.originalId);
  await seedLegacyThumbnail(t, original.originalId);
  await seedLegacyThumbnail(t, reply.replyId);
  return { alex, blair, casey, dana, ellis, locked, pending, roundId, original, reply };
}
