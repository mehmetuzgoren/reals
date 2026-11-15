# TAKE backend

Convex owns authentication, application data, authorization, private files, scheduling and transactions. Convex Auth 2.0.0 supplies Apple browser OAuth and an exact-development-only password sign-in path. Account deletion atomically tombstones the user and revokes all sessions. Remote push is explicitly unavailable behind a provider boundary; there is no external identity SDK, push sender, payment or Whop dependency.

## Run and check

Use Node 24 and run these commands from `backend/`:

```sh
npm ci
npm run check
npm audit
npm run test:media
cd verifier
npm ci
npm test
```

The main tests execute registered functions and HTTP routes through `convex-test` with transaction limits, actual Convex Auth password signup, Argon2 WASM hashing and component sessions. Uploads use the in-Convex structural media checker; successful push outcomes remain test doubles because the shipped push provider never reports a send. The separate `test:media` suite uses `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` only to generate and inspect synthetic fixtures. Its main positive is a fast-start 720×1280 H.264/stereo AAC MP4, matching the native export format; it also covers HEVC MOV, exact duration boundaries, receipt/unlock, private playback/revocation and original JPEG/PNG avatar bytes. It makes no external verification request. The historical `verifier/` service and its decoder tests are retained unchanged but are not used by publication. No private footage is committed. See [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md) for deployment checks and policy limits.

Official Convex-generated API, server and schema-derived data-model bindings are checked in, so `npm run check` needs no deployment credentials. `npm run codegen` regenerates them against the selected deployment. Normal `npx convex dev`/`deploy` performs authoritative Convex code generation, bundling and backend analysis; run it again after adding modules. Do not treat TypeScript alone as a successful cloud deployment.

## Client contract

The public names and JSON envelopes implement the accepted TAKE integration contract and wire addendum v4. Timestamps are milliseconds; nullable fields are explicit `null`. The client authenticates the Convex SDK and HTTP upload requests with a **Convex Auth access token**, not an Apple identity token or user ID. Errors are `ConvexError({ code, message, retryable })`; private HTTP failures have `{ failure: { code, message, retryable } }`. Denied content and missing content use the same `NOT_FOUND`/HTTP 404 envelope.

`uploads:begin` returns an owner-authenticated POST URL, `minDurationMs: 3000`, `maxDurationMs: 15000` and the actual byte cap. Originals accept optional `audience: "friends" | "public"`, defaulting to friends; replies reject an audience argument and inherit the parent. Audience is fixed at intent creation and cannot change on retry or after publication. POST the raw exported H.264/AAC portrait MP4 as `video/mp4` with `Authorization: Bearer <Convex Auth access token>`. The response is `{ uploadId }`; do not send a storage ID to `finalize`. Retry a lost POST only while it has not bound bytes. After bytes are bound, use `uploads:status` and retry `uploads:finalize`; a conflicting second POST cannot replace the object. Retryable processing failure retains staging bytes until expiry. Terminal failure/cancellation deletes staging asynchronously. Only `published` is an unlock.

Playback and thumbnail grants last 60 seconds. Fetch the returned URL directly with AVPlayer/URLSession; the grant is opaque and requires no undocumented AVPlayer header injection. Request a fresh grant for retries/long pauses. Each GET/HEAD rechecks current database authorization, returns bytes, and never redirects to a reusable storage URL. Clear player, thumbnail, caption and subscription caches on sign-out or social changes. Already delivered bytes cannot be revoked.

Avatar uploads use their own authenticated intent and a 2 MiB/2048×2048 input bound. POST raw JPEG/PNG to the returned URL. Convex checks the actual image structure, dimensions and hash, then preserves the original bytes and MIME type; it does not decode, resize or strip metadata. `profiles:update` consumes the viewer's verified intent. `avatarUploadId: null` keeps the existing avatar. Avatars are deliberately public minimal-profile assets at `/v1/avatars/<userId>`, with no opinion data or storage-ID resolution endpoint. They are not a bypass for private thumbnails or videos.

Video verification runs inside Convex with no external host, media variables or runtime binaries. It checks bounded MP4/MOV boxes, sample tables and sample ranges, one portrait H.264/HEVC video track, at most one AAC audio track, 3–15-second duration and the 8 MiB cap. New publications have `thumbnailAssetId: null`; clients use their placeholder. Legacy thumbnail authorization remains supported. Structural checks do not prove full codec decodability or audible audio, and do not normalize metadata.

The original-only feed caps at eight items, profile-history pages at ten, and reply pages at 50. Feed and reply pagination are applied **after** audience filtering, so strangers' originals and hidden replies do not create returned IDs, counts or empty-page cursors. Social changes can invalidate a cursor; refetch from the first page then. Captions are explicitly `unavailable` until a real transcription integration exists.

## Public takes and interactions

`takes:forYou({ roundId, cursor, limit })` returns the same `{ items, nextCursor }` envelope as the friends feed, newest first, with only visible public originals and never the viewer's own. Both feeds require an actual current-round publication receipt. Public direct reads, replies, comments and media grants require a receipt in the content's exact round and no block in either direction with the relevant author; public never means anonymous access. The friends feed remains the viewer's own and approved friends' originals. Legacy content without an audience stays friends-only.

Original and reply summaries add `audience`, `likeCount`, `viewerLiked` and `visibleCommentCount`; original summaries also add `battle: { battleId, opponent: PublicProfile } | null`. Profiles include `username` and `displayName`. `likes:toggle({ contentId, kind })` returns `{ liked, likeCount }`; there is no list of likers. `comments:list({ contentId, kind, cursor, limit })` returns visible oldest-first `{ items: [{ commentId, author, text, createdAt, viewerCanDelete }], nextCursor }`. `comments:create({ contentId, kind, text })` accepts trimmed plain text of 1–300 characters and returns `{ commentId }`, limited to 20 creations per user per 60-second window even after deletion. `comments:delete({ commentId })` returns `{ ok: true }` for the commenter or content author. `reports:create` accepts `kind: "comment"`. Friends comments use the same current approved/unblocked intersection as private video replies, never a hidden parent bypass.

Publishing a public original atomically pairs it with the oldest unpaired public opposite-option original in the same round, from another unblocked author. Each original has at most one battle. `battles:get({ battleId })` returns `{ battleId, roundId, left, right, leftVotes, rightVotes, viewerVote, viewerCanVote }`; `left` and `right` are original summaries, with the earlier publication on the left. Both sides must be visible. `battles:vote({ battleId, side: "left" | "right" })` returns `{ leftVotes, rightVotes, viewerVote }`; votes are unique per viewer and changeable, and either author is forbidden to vote. Deleting a side unlinks the battle and its votes; deletion cleanup also removes content likes/comments, and account cleanup removes authored interactions elsewhere. No new notification, ranking, payment or public-profile endpoint is introduced.
