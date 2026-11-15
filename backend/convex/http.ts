import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fail, notFound } from "./lib/errors";
import { httpError, privateHeaders, readBody, byteRange } from "./lib/http";
import { randomToken, sha256, verifyAvatar } from "./lib/verification";
import { MAX_BYTES } from "./uploads";

const http = httpRouter();
const upload = httpAction(async (ctx, request) => {
  let storageId = null;
  let bound = false;
  let uploadId = "";
  let mode = "";
  const lease = randomToken();
  try {
    const match = /^\/v1\/uploads\/([^/]+)\/(video|avatar)$/.exec(new URL(request.url).pathname);
    if (!match) return notFound();
    [, uploadId, mode] = match;
    const claimedId = await ctx.runMutation(mode === "video" ? internal.uploads.claimUpload : internal.profiles.claimAvatar, { uploadId, lease });
    const mime = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (mode === "video" ? mime !== "video/mp4" : mime !== "image/jpeg" && mime !== "image/png") fail("INVALID_MEDIA", "Unsupported upload content type");
    const bytes = await readBody(request, mode === "video" ? MAX_BYTES : 2 * 1024 * 1024);
    const hash = await sha256(bytes);
    if (mode === "video") {
      storageId = await ctx.storage.store(new Blob([bytes], { type: "video/mp4" }));
      bound = await ctx.runMutation(internal.uploads.bindUpload, { uploadId: claimedId as Id<"uploads">, lease, storageId, sha256: hash, byteCount: bytes.byteLength });
    } else {
      const verified = await verifyAvatar(bytes, hash);
      storageId = await ctx.storage.store(new Blob([verified.image], { type: "image/jpeg" }));
      bound = await ctx.runMutation(internal.profiles.bindAvatar, { uploadId: claimedId as Id<"avatarUploads">, lease, storageId, width: verified.width, height: verified.height });
    }
    if (!bound) fail("CONFLICT", "Upload could not be bound to this intent", true);
    return Response.json({ uploadId }, { headers: privateHeaders });
  } catch (error) { return httpError(error); }
  finally {
    if (storageId && !bound) await ctx.storage.delete(storageId);
    if (!bound && uploadId) await ctx.runMutation(mode === "video" ? internal.uploads.releaseUpload : internal.profiles.releaseAvatar, { uploadId, lease });
  }
});
http.route({ pathPrefix: "/v1/uploads/", method: "POST", handler: upload });

const media = httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    const grantId = /^\/v1\/media\/([^/]+)$/.exec(url.pathname)?.[1];
    const token = url.searchParams.get("token");
    if (!grantId || !token || !/^[a-f0-9]{64}$/.test(token)) return notFound();
    const tokenHash = await sha256(new TextEncoder().encode(token).buffer);
    const asset = await ctx.runQuery(internal.media.resolve, { grantId, tokenHash });
    if (asset.expiresAt <= Date.now()) return notFound();
    const blob = await ctx.storage.get(asset.storageId);
    if (!blob || asset.expiresAt <= Date.now()) return notFound();
    const range = byteRange(request.headers.get("Range"), blob.size);
    const headers: Record<string, string> = { ...privateHeaders, "Content-Type": asset.mimeType, "Accept-Ranges": "bytes" };
    if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${blob.size}` } });
    const body = range ? blob.slice(range.start, range.end + 1, asset.mimeType) : blob;
    headers["Content-Length"] = String(body.size);
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${blob.size}`;
    return new Response(request.method === "HEAD" ? null : body, { status: range ? 206 : 200, headers });
  } catch (error) { return httpError(error); }
});
http.route({ pathPrefix: "/v1/media/", method: "GET", handler: media });

http.route({ pathPrefix: "/v1/avatars/", method: "GET", handler: httpAction(async (ctx, request) => {
  try {
    const userId = /^\/v1\/avatars\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1];
    if (!userId) return notFound();
    const storageId = await ctx.runQuery(internal.profiles.avatarAsset, { userId });
    const blob = storageId ? await ctx.storage.get(storageId) : null;
    if (!blob) return notFound();
    return new Response(blob, { headers: { ...privateHeaders, "Content-Type": "image/jpeg", "Content-Length": String(blob.size) } });
  } catch (error) { return httpError(error); }
}) });
export default http;
