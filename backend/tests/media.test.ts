import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { byteRange, readBody } from "../convex/lib/http";
import http from "../convex/http";
import { setup, user, round, begin, send, publish, path, playback, fixtureBytes, seedLegacyThumbnail } from "./helpers";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("private HTTP bytes", () => {
  it("enforces the deadline in HTTP even when a query cache supplies a stale authorization result", async () => {
    setup();
    const storage = { get: vi.fn(async () => new Blob(["private"])) };
    const match = http.lookup("/v1/media/test", "GET")!;
    const handler = match[0] as unknown as { _handler: (ctx: unknown, request: Request) => Promise<Response> };
    const response = await handler._handler({
      runQuery: async () => ({ expiresAt: Date.now() - 1, storageId: "test", mimeType: "video/mp4" }), storage,
    }, new Request(`https://take-test.convex.site/v1/media/test?token=${"a".repeat(64)}`));
    expect(response.status).toBe(404);
    expect(storage.get).not.toHaveBeenCalled();
  });
  it("serves bytes without redirects, with Range, suffixes, HEAD and no-store headers", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const id = await round(t);
    const original = await publish(alex.client, id);
    const grant = await playback(alex.client, original.originalId, "original");
    const issued = (await t.run(ctx => ctx.db.query("mediaGrants").first()))!;
    expect(grant.expiresAt - issued._creationTime).toBeLessThanOrEqual(60000);
    expect(grant.expiresAt - issued._creationTime).toBeGreaterThan(59000);
    expect(grant.url).not.toContain("storage");
    const full = await t.fetch(path(grant.url));
    expect(full.status).toBe(200);
    expect(full.headers.get("Location")).toBeNull();
    expect(full.headers.get("Cache-Control")).toContain("private, no-store");
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    expect(full.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(fixtureBytes);
    const partial = await t.fetch(path(grant.url), { headers: { Range: "bytes=2-8" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe(`bytes 2-8/${fixtureBytes.length}`);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(fixtureBytes.slice(2, 9));
    const suffix = await t.fetch(path(grant.url), { headers: { Range: "bytes=-5" } });
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(fixtureBytes.slice(-5));
    const head = await t.fetch(path(grant.url), { method: "HEAD", headers: { Range: "bytes=0-1" } });
    expect(head.status).toBe(206);
    expect(head.headers.get("Content-Length")).toBe("2");
    expect(await head.text()).toBe("");
    for (const Range of ["bytes=999-", "bytes=1-0", "bytes=0-1,3-4", "invalid"]) expect((await t.fetch(path(grant.url), { headers: { Range } })).status).toBe(416);
  });

  it("stores only token hashes and rejects forged, expired, and deleted-content grants uniformly", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const id = await round(t);
    const original = await publish(alex.client, id);
    const grant = await playback(alex.client, original.originalId, "original");
    const rawToken = new URL(grant.url).searchParams.get("token")!;
    const rows = await t.run(ctx => ctx.db.query("mediaGrants").collect());
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(rawToken);
    expect(rows[0]).toMatchObject({ contentId: original.originalId, viewerId: alex.profile.id, asset: "video" });
    const forged = new URL(grant.url); forged.searchParams.set("token", "0".repeat(64));
    const forgedResponse = await t.fetch(path(forged.toString()));
    expect(forgedResponse.status).toBe(404);
    vi.setSystemTime(grant.expiresAt);
    const expired = await t.fetch(path(grant.url));
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual(await forgedResponse.json());
    await seedLegacyThumbnail(t, original.originalId);
    const newer = await playback(alex.client, original.originalId, "original", "thumbnail");
    await alex.client.mutation(api.takes.delete, { id: original.originalId });
    expect((await t.fetch(path(newer.url))).status).toBe(404);
    expect((await t.fetch("/v1/media/not-an-id?token=abc")).status).toBe(404);
  });

  it("checks upload byte count independently of Content-Length and rejects unbounded/unsupported bodies", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const id = await round(t);
    const intent = await begin(alex.client, id);
    const route = new URL(intent.uploadUrl).pathname;
    const oversized = new Uint8Array(intent.maxBytes + 1);
    const huge = await alex.client.fetch(route, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: oversized });
    expect(huge.status).toBe(413);
    expect((await alex.client.fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(422);
    expect((await send(alex.client, intent)).status).toBe(200);
    const metadata = await t.run(ctx => ctx.db.query("uploads").first());
    expect(metadata?.byteCount).toBe(fixtureBytes.byteLength);
    expect(metadata?.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readBody(new Request("https://unit.test", { method: "POST", headers: { "Content-Length": "100" }, body: "short" }), 200)).rejects.toThrow("INVALID_MEDIA");
    await expect(readBody(new Request("https://unit.test", { method: "POST", headers: { "Content-Length": "nonsense" }, body: "short" }), 200)).rejects.toThrow("TOO_LARGE");
  });

  it("cleans expired staging and crash-orphans without deleting referenced or fresh bytes", async () => {
    const t = setup();
    const alex = await user(t, "alex"); const id = await round(t);
    const original = await publish(alex.client, id);
    const blair = await user(t, "blair");
    const staging = await begin(blair.client, id); await send(blair.client, staging);
    const stagedId = (await t.run(ctx => ctx.db.get(staging.uploadId)))!.storageId!;
    const orphan = await t.run(ctx => ctx.storage.store(new Blob(["orphan"])));
    vi.setSystemTime(Date.now() + 3600001);
    const fresh = await t.run(ctx => ctx.storage.store(new Blob(["fresh"])));
    await t.mutation(internal.cleanup.expired, {});
    await t.mutation(internal.cleanup.orphans, { cursor: null });
    const retained = await t.run(async ctx => ({ staged: await ctx.storage.get(stagedId), orphan: await ctx.storage.get(orphan), fresh: !!(await ctx.storage.get(fresh)), published: await ctx.db.get(original.originalId) }));
    expect(retained.staged).toBeNull(); expect(retained.orphan).toBeNull(); expect(retained.fresh).toBe(true);
    expect(retained.published).not.toBeNull();
    const grant = await playback(alex.client, original.originalId, "original");
    expect((await t.fetch(path(grant.url))).status).toBe(200);
  });

  it("parses only safe single byte ranges", () => {
    expect(byteRange(null, 10)).toBeNull();
    expect(byteRange("bytes=0-999", 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange("bytes=-999", 10)).toEqual({ start: 0, end: 9 });
    for (const header of ["bytes=-0", "bytes=9007199254740992-", "bytes=-", "Bytes=0-1", "bytes=1.5-9"]) expect(byteRange(header, 10)).toBe("invalid");
  });
});
