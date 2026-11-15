import { afterEach, describe, expect, it, vi } from "vitest";
import { api, components } from "../convex/_generated/api";
import { actor, path, playback, publish, round, sessionClient, setup, testPassword, user } from "./helpers";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function signUp(t: ReturnType<typeof setup>, username = "authfixture") {
  const result = await t.mutation(api.auth.signUpWithUsernamePassword, { username, password: testPassword });
  if (result.status !== "complete") throw new Error("Sign-up failed");
  return { tokens: result.tokens, client: sessionClient(t, result.tokens) };
}
const appleVariables = ["AUTH_APPLE_CLIENT_ID", "AUTH_APPLE_TEAM_ID", "AUTH_APPLE_KEY_ID", "AUTH_APPLE_PRIVATE_KEY"];

describe("Convex Auth session and account boundary", () => {
  it("configures only deployment-signed ES256 sessions without external identity configuration", async () => {
    setup();
    const { default: config } = await import("../convex/auth.config");
    expect(config.providers).toEqual([{
      type: "customJwt", applicationID: "convex-auth", algorithm: "ES256",
      issuer: "https://take-test.convex.cloud/components/auth", jwks: "https://take-test.convex.cloud/.well-known/jwks.json",
    }]);
  });
  it("runs actual password sign-up, sign-in, rotating refresh and sign-out without an external identity SDK", async () => {
    const t = setup();
    const { tokens, client } = await signUp(t);
    expect(tokens).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), userId: expect.any(String) });
    expect(await client.query(api.auth.isAuthenticated, {})).toBe(true);
    expect(await client.query(api.viewer.session, {})).toEqual({ needsOnboarding: true, profile: null });
    expect(await t.mutation(api.auth.signInWithUsernamePassword, { username: "authfixture", password: "an incorrect password" })).toMatchObject({ status: "error", userError: { error: "INVALID_CREDENTIALS" } });
    const rotated = await t.mutation(api.auth.refreshSession, { refreshToken: tokens.refreshToken });
    if (rotated.kind !== "rotated") throw new Error("Refresh failed");
    expect(rotated.tokens.userId).toBe(tokens.userId);
    expect(rotated.tokens.refreshToken).not.toBe(tokens.refreshToken);
    const current = sessionClient(t, rotated.tokens);
    const profile = await current.mutation(api.profiles.completeOnboarding, { username: "publicname", displayName: "Public name" });
    expect(profile.id).toBe(tokens.userId);
    await current.mutation(api.auth.signOut, { refreshToken: rotated.tokens.refreshToken });
    expect(await client.query(api.auth.isAuthenticated, {})).toBe(false);
    await expect(current.query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    expect(await t.mutation(api.auth.refreshSession, { refreshToken: rotated.tokens.refreshToken })).toEqual({ kind: "noSession" });
    const signedIn = await t.mutation(api.auth.signInWithUsernamePassword, { username: "authfixture", password: testPassword });
    if (signedIn.status !== "complete") throw new Error("Sign-in failed");
    expect((await sessionClient(t, signedIn.tokens).query(api.viewer.session, {})).profile?.id).toBe(profile.id);
  });

  it("rejects an unknown session, a user id posing as a session, and a foreign issuer even with a live session id", async () => {
    const t = setup(); const { tokens } = await signUp(t);
    const issuer = "https://take-test.convex.cloud/components/auth";
    for (const subject of ["unknown-session", tokens.userId]) {
      await expect(t.withIdentity({ issuer, subject }).query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    }
    const foreign = await actor(t, "foreignfixture", { issuer: "https://other.convex.cloud/components/auth" });
    await expect(foreign.query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
  });

  it.each(["production", "Development", "", undefined])("rejects development sign-in and already-issued sessions when deployment mode is %s", async mode => {
    const t = setup(); const alex = await user(t, "alex"); const id = await round(t);
    const original = await publish(alex.client, id);
    const grant = await playback(alex.client, original.originalId, "original");
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" })));
    await t.run(ctx => ctx.db.patch(alex.profile.id, { avatarStorageId: storageId, avatarWidth: 1, avatarHeight: 1 }));
    vi.stubEnv("TAKE_DEPLOYMENT_ENV", mode);
    await expect(t.mutation(api.auth.signUpWithUsernamePassword, { username: "productionfixture", password: testPassword })).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(api.auth.signInWithUsernamePassword, { username: "alex", password: testPassword })).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.query(api.rounds.today, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.query(api.friends.list, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.query(api.profiles.mine, { cursor: null, limit: 10 })).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.mutation(api.profiles.completeOnboarding, { username: "different", displayName: "Different" })).rejects.toThrow("UNAUTHENTICATED");
    await expect(alex.client.mutation(api.uploads.begin, { requestId: "production-fixture", kind: "original", roundId: id, optionId: "yes", originalId: null })).rejects.toThrow("UNAUTHENTICATED");
    await expect(playback(alex.client, original.originalId, "original")).rejects.toThrow("UNAUTHENTICATED");
    expect((await t.fetch(path(grant.url))).status).toBe(404);
    expect((await t.fetch(`/v1/avatars/${alex.profile.id}`)).status).toBe(404);
  });

  it.each(appleVariables)("refuses placeholder or missing %s before starting or completing Apple authentication", async missing => {
    const t = setup();
    vi.stubEnv("TAKE_DEPLOYMENT_ENV", "production");
    for (const name of appleVariables) vi.stubEnv(name, "configured-test-value");
    for (const value of ["unconfigured", "", undefined]) {
      vi.stubEnv(missing, value);
      await expect(t.mutation(api.auth.startSignInWithApple, { redirectTo: "https://take-test.convex.site/auth/ios?state=" + "s".repeat(43) })).rejects.toThrow("PROCESSING_UNAVAILABLE");
      await expect(t.mutation(api.auth.completeSignInWithApple, { state: "s".repeat(43), code: "c".repeat(43) })).rejects.toThrow("PROCESSING_UNAVAILABLE");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps refresh distinct from reauthentication and revokes every session atomically at deletion", async () => {
    const t = setup(); const first = await signUp(t);
    await first.client.mutation(api.profiles.completeOnboarding, { username: "authfixture", displayName: "Fixture" });
    const before = await t.run(ctx => ctx.runQuery(components.auth.public.listSessions, { userId: first.tokens.userId }));
    vi.setSystemTime(Date.now() + 301000);
    const refreshed = await t.mutation(api.auth.refreshSession, { refreshToken: first.tokens.refreshToken });
    if (refreshed.kind !== "rotated") throw new Error("Refresh failed");
    const refreshedClient = sessionClient(t, refreshed.tokens);
    const after = await t.run(ctx => ctx.runQuery(components.auth.public.listSessions, { userId: first.tokens.userId }));
    expect(after[0].creationTime).toBe(before[0].creationTime);
    await expect(refreshedClient.action(api.accounts.requestDeletion, {})).rejects.toThrow("REAUTH_REQUIRED");
    expect((await first.client.query(api.viewer.session, {})).needsOnboarding).toBe(false);
    const fresh = await t.mutation(api.auth.signInWithUsernamePassword, { username: "authfixture", password: testPassword });
    if (fresh.status !== "complete") throw new Error("Reauthentication failed");
    const client = sessionClient(t, fresh.tokens);
    const deletion = await client.action(api.accounts.requestDeletion, {});
    expect(deletion.state).toBe("pending");
    expect(await t.run(ctx => ctx.runQuery(components.auth.public.listSessions, { userId: first.tokens.userId }))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("users").first())).toMatchObject({ status: "deleting", username: null });
    for (const session of [first.tokens, refreshed.tokens, fresh.tokens]) {
      expect(await t.mutation(api.auth.refreshSession, { refreshToken: session.refreshToken })).toEqual({ kind: "noSession" });
      await expect(sessionClient(t, session).query(api.viewer.session, {})).rejects.toThrow("UNAUTHENTICATED");
    }
    await expect(t.mutation(api.auth.signInWithUsernamePassword, { username: "authfixture", password: testPassword })).rejects.toThrow("UNAUTHENTICATED");
    expect(await t.mutation(api.auth.signUpWithUsernamePassword, { username: "authfixture", password: testPassword })).toMatchObject({ status: "error", userError: { error: "USERNAME_TAKEN" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.mutation(api.auth.signInWithUsernamePassword, { username: "authfixture", password: testPassword })).rejects.toThrow("UNAUTHENTICATED");
  });
});

describe("fixed stateless iOS OAuth relay", () => {
  const state = "s".repeat(43); const code = "c".repeat(43);
  it("forwards only a one-time code and relay nonce to the fixed custom scheme without storing data", async () => {
    const t = setup();
    const response = await t.fetch(`/auth/ios?state=${state}&convexAuthCode=${code}&redirectTo=https://attacker.test&token=discarded`);
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location")!);
    expect(target.protocol).toBe("take:"); expect(target.hostname).toBe("auth"); expect(target.pathname).toBe("/convex");
    expect([...target.searchParams]).toEqual([["state", state], ["code", code]]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await t.run(ctx => ctx.db.query("users").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("mediaGrants").collect())).toEqual([]);
  });
  it.each([
    `convexAuthCode=${code}`, `state=&convexAuthCode=${code}`, `state=malformed&convexAuthCode=${code}`,
    `state=${state}&state=${state}&convexAuthCode=${code}`, `state=${state}`,
    `state=${state}&convexAuthCode=malformed`, `state=${state}&convexAuthCode=${code}&convexAuthCode=${code}`,
    `state=${state}&convexAuthCode=${code}&convexAuthError=access_denied`, `state=${state}&convexAuthError=untrusted`,
  ])("returns 400 without a redirect for invalid callback %s", async query => {
    const t = setup(); const response = await t.fetch(`/auth/ios?${query}`);
    expect(response.status).toBe(400); expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each(["access_denied", "expired", "oauth_error"])("returns an allowlisted %s outcome without a code", async error => {
    const t = setup(); const response = await t.fetch(`/auth/ios?state=${state}&convexAuthError=${error}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`take://auth/convex?state=${state}&error=${error}`);
  });
});
