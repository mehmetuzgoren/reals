import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { actor, setup, user, round, publish, path, playback, befriend } from "./helpers";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("identity-derived social and profile APIs", () => {
  it("denies disabled accounts' old tokens and grants without deleting their identity tombstones", async () => {
    const t = setup(); const alex = await user(t, "alex"); const id = await round(t);
    const original = await publish(alex.client, id); const grant = await playback(alex.client, original.originalId, "original");
    await t.mutation(internal.admin.setDisabled, { userId: alex.profile.id, disabled: true });
    await expect(alex.client.query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.mutation(api.profiles.completeOnboarding, { username: "newname", displayName: "Alex" })).rejects.toThrow("UNAUTHENTICATED");
    expect((await t.fetch(path(grant.url))).status).toBe(404);
    await t.mutation(internal.admin.setDisabled, { userId: alex.profile.id, disabled: false });
    expect((await alex.client.query(api.viewer.session, {})).needsOnboarding).toBe(false);
  });
  it("requires verified identity, normalizes unique usernames transactionally and never accepts a viewer ID", async () => {
    const t = setup();
    await expect(t.query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(actor(t, "wrong", { issuer: "https://securetoken.google.com/other" }).query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    const a = actor(t, "apple-uid-one"); const b = actor(t, "apple-uid-two");
    expect(await a.query(api.viewer.session, {})).toEqual({ profile: null, needsOnboarding: true });
    const results = await Promise.allSettled([a, b].map(client => client.mutation(api.profiles.completeOnboarding, { username: "  ALEx ", displayName: "Alex" })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const profile = await t.run(ctx => ctx.db.query("users").first());
    expect(profile?.username).toBe("alex");
    await expect(a.query(api.viewer.session, { userId: profile!._id } as never)).rejects.toThrow();
  });

  it("enforces sender cancellation, recipient acceptance and minimal canonical envelopes", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const blair = await user(t, "blair"); const casey = await user(t, "casey");
    const request = await alex.client.mutation(api.friends.request, { userId: blair.profile.id });
    expect((await alex.client.query(api.friends.search, { usernamePrefix: "bl", limit: 10 }))[0]).toMatchObject({ profile: blair.profile, relationship: "outgoing", requestId: request.requestId });
    const incoming = (await blair.client.query(api.friends.list, {})).incoming;
    expect(incoming).toMatchObject([{ id: request.requestId, profile: alex.profile, createdAt: expect.any(Number) }]);
    expect(incoming[0].createdAt - Date.now()).toBeLessThan(10);
    await expect(alex.client.mutation(api.friends.respond, { requestId: request.requestId!, accept: true })).rejects.toThrow("NOT_FOUND");
    await expect(casey.client.mutation(api.friends.cancel, { requestId: request.requestId! })).rejects.toThrow("NOT_FOUND");
    await blair.client.mutation(api.friends.respond, { requestId: request.requestId!, accept: true });
    expect(await alex.client.query(api.friends.list, {})).toEqual({ approved: [blair.profile], incoming: [], outgoing: [], blocked: [] });
    expect((await blair.client.query(api.friends.search, { usernamePrefix: "al", limit: 10 }))[0].relationship).toBe("approved");
    await alex.client.mutation(api.blocks.set, { userId: blair.profile.id, blocked: true });
    expect((await blair.client.query(api.friends.list, {})).blocked).toEqual([]);
    expect((await alex.client.query(api.friends.list, {})).blocked).toEqual([blair.profile]);
    expect(await blair.client.query(api.friends.search, { usernamePrefix: "al", limit: 10 })).toEqual([]);
    await alex.client.mutation(api.blocks.set, { userId: blair.profile.id, blocked: false });
    expect((await alex.client.query(api.friends.list, {})).approved).toEqual([]);
    const cancel = await alex.client.mutation(api.friends.request, { userId: casey.profile.id });
    await alex.client.mutation(api.friends.cancel, { requestId: cancel.requestId! });
    const decline = await alex.client.mutation(api.friends.request, { userId: casey.profile.id });
    await casey.client.mutation(api.friends.respond, { requestId: decline.requestId!, accept: false });
    expect((await alex.client.query(api.friends.list, {})).outgoing).toEqual([]);
  });

  it("validates and binds avatar bytes separately and never exposes private storage URLs", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const blair = await user(t, "blair");
    const intent = await alex.client.mutation(api.profiles.beginAvatarUpload, { requestId: "avatar-request-123" });
    expect(intent).toMatchObject({ acceptedMimeTypes: ["image/jpeg", "image/png"], maxWidth: 2048, maxHeight: 2048, maxBytes: 2097152 });
    expect((await blair.client.fetch(new URL(intent.uploadUrl).pathname, { method: "POST", headers: { "Content-Type": "image/png" }, body: "fake" })).status).toBe(404);
    await expect(alex.client.mutation(api.profiles.update, { displayName: "Changed", avatarUploadId: intent.uploadId })).rejects.toThrow("INVALID_MEDIA");
    const response = await alex.client.fetch(new URL(intent.uploadUrl).pathname, { method: "POST", headers: { "Content-Type": "image/png" }, body: "test-image-bytes-validated-by-mocked-worker" });
    expect(await response.json()).toEqual({ uploadId: intent.uploadId });
    await expect(blair.client.mutation(api.profiles.update, { displayName: "Blair", avatarUploadId: intent.uploadId })).rejects.toThrow("NOT_FOUND");
    const updated = await alex.client.mutation(api.profiles.update, { displayName: "Changed", avatarUploadId: intent.uploadId });
    expect(updated.avatar).toEqual({ url: `https://take-test.convex.site/v1/avatars/${alex.profile.id}` });
    const avatar = await t.fetch(path(updated.avatar!.url));
    expect(avatar.status).toBe(200); expect(avatar.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await avatar.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
    expect(await alex.client.mutation(api.profiles.update, { displayName: "Again", avatarUploadId: null })).toMatchObject({ displayName: "Again", avatar: updated.avatar });
    const profile = await alex.client.query(api.profiles.mine, { cursor: null, limit: 20 });
    expect(profile).toMatchObject({ originals: { items: [], nextCursor: null }, preferences: { dailyQuestion: true, directReply: true } });
    expect(JSON.stringify(profile)).not.toContain("StorageId");
    expect(await alex.client.mutation(api.profiles.setNotifications, { dailyQuestion: false, directReply: true })).toEqual({ dailyQuestion: false, directReply: true });
  });

  it("requires recent reauthentication, revokes immediately, cleans the graph and prevents token resurrection", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await befriend(alex.client, alex.profile.id, blair.client, blair.profile.id);
    const id = await round(t); const original = await publish(alex.client, id);
    const grant = await playback(alex.client, original.originalId, "original");
    await alex.client.mutation(api.devices.register, { installationId: "test-installation-1", fcmToken: "test-not-a-real-fcm-token-123456", platform: "ios", notificationsEnabled: true });
    await expect(actor(t, "alex", { auth_time: Date.now() / 1000 - 301 }).action(api.accounts.requestDeletion, {})).rejects.toThrow("REAUTH_REQUIRED");
    const deleted = await alex.client.action(api.accounts.requestDeletion, {});
    expect(deleted.state).toBe("pending");
    expect((await t.fetch(path(grant.url))).status).toBe(404);
    await expect(alex.client.query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.mutation(api.profiles.completeOnboarding, { username: "resurrected", displayName: "Resurrected" })).rejects.toThrow("UNAUTHENTICATED");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const data = await t.run(async ctx => ({ user: await ctx.db.get(alex.profile.id), friends: await ctx.db.query("friendships").collect(), originals: await ctx.db.query("originalTakes").collect(), devices: await ctx.db.query("deviceTokens").collect(), jobs: await ctx.db.query("deletionJobs").collect() }));
    expect(data.user).toMatchObject({ status: "deleted", displayName: "Deleted account", username: null, subject: "alex" });
    expect(data.friends).toEqual([]); expect(data.originals).toEqual([]); expect(data.devices).toEqual([]);
    expect(data.jobs[0]).toMatchObject({ state: "data_deleted", firebaseState: "unconfigured" });
    await expect(actor(t, "alex").mutation(api.profiles.completeOnboarding, { username: "alexagain", displayName: "Alex" })).rejects.toThrow("UNAUTHENTICATED");
    expect((await blair.client.query(api.friends.list, {})).approved).toEqual([]);
  });
});
