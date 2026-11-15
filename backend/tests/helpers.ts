import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const modules = import.meta.glob("../convex/**/*.ts");
export function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T20:00:00Z"));
  vi.stubEnv("FIREBASE_PROJECT_ID", "take-test");
  vi.stubEnv("TAKE_HTTP_ORIGIN", "https://take-test.convex.site");
  vi.stubEnv("MEDIA_VERIFIER_ORIGIN", "https://verifier.test");
  vi.stubEnv("MEDIA_VERIFIER_SECRET", "test-only-verifier-secret-not-a-credential");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const hash = new Headers(init?.headers).get("X-Content-SHA256");
    if (String(_input).endsWith("/verify-avatar")) return Response.json({ sha256: hash, width: 64, height: 64, mimeType: "image/jpeg", imageBase64: "/9j/2Q==" });
    return Response.json({ sha256: hash, durationMs: 1000, width: 360, height: 640, videoCodec: "h264", audioCodec: "aac", thumbnailBase64: "/9j/2Q==" });
  });
  return convexTest({ schema, modules, transactionLimits: true });
}
export type Test = ReturnType<typeof setup>;
export type Actor = ReturnType<Test["withIdentity"]>;
export function actor(t: Test, subject: string, extra: Record<string, string | number> = {}) {
  return t.withIdentity({ issuer: "https://securetoken.google.com/take-test", subject, auth_time: Date.now() / 1000, ...extra });
}
export async function user(t: Test, name: string) {
  const client = actor(t, name);
  const profile = await client.mutation(api.profiles.completeOnboarding, { username: name, displayName: name[0].toUpperCase() + name.slice(1) });
  return { client, profile };
}
export async function round(t: Test, key = "test-round") {
  const id = await t.mutation(internal.rounds.plan, {
    planKey: key, plannedAt: Date.now(), question: "Do you like pineapple on pizza?",
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
export const fixtureBytes = new TextEncoder().encode("unit-test bytes; actual decoder is tested in verifier/");
export async function send(client: Actor, intent: { uploadUrl: string }) {
  return client.fetch(new URL(intent.uploadUrl).pathname, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: fixtureBytes });
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
  return { alex, blair, casey, dana, ellis, locked, pending, roundId, original, reply };
}
