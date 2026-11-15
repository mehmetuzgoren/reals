# TAKE backend

Convex owns application data, authorization, private files, scheduling and transactions. Firebase is used only for Apple authentication, FCM and identity deletion. There is no Firestore, Firebase Storage, Firebase Cloud Functions, payment or Whop SDK integration. Whop is a future payment extension, not a current dependency.

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

The main tests execute registered Convex functions and HTTP routes through `convex-test`, with transaction limits enabled. Their verifier transport and FCM sender are test doubles; they are not claims of Firebase JWT, remote delivery or cloud deployment verification. The separate `test:media` suite requires `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`: it generates real clips/images, starts the actual verifier HTTP server on loopback, and exercises owner upload, trusted finalization, receipt/unlock, private playback/revocation, invalid-media denial and avatar normalization through Convex functions. It rewrites only the verifier origin to loopback HTTP; TLS, Firebase identity and Convex storage remain outside that test's real-service boundary. `verifier/` tests also run FFprobe/FFmpeg against adversarial media and the authenticated HTTP service. No sample or private footage is committed. See [DEPLOYMENT.md](DEPLOYMENT.md) for the real-service boundary and [SECURITY.md](SECURITY.md) for invariants and operational limits.

Official Convex-generated API, server and schema-derived data-model bindings are checked in, so `npm run check` needs no deployment credentials. `npm run codegen` regenerates them against the selected deployment. Normal `npx convex dev`/`deploy` performs authoritative Convex code generation, bundling and backend analysis; run it again after adding modules. Do not treat TypeScript alone as a successful cloud deployment.

## Client contract

The public names and JSON envelopes implement the accepted TAKE integration contract and wire addendum. Timestamps are milliseconds; nullable fields are explicit `null`. The client authenticates the Convex SDK and HTTP upload requests with a **Firebase ID token**, not an Apple token or user ID. Errors are `ConvexError({ code, message, retryable })`; private HTTP failures have `{ failure: { code, message, retryable } }`. A denied content request and a missing content request both use `NOT_FOUND`/HTTP 404.

`uploads:begin` returns an owner-authenticated POST URL and the actual byte cap. POST the raw exported H.264/AAC portrait MP4 as `video/mp4` with `Authorization: Bearer <Firebase ID token>`. The response is `{ uploadId }`; do not send a storage ID to `finalize`. Retry a lost POST only while it has not bound bytes. After bytes are bound, use `uploads:status` and retry `uploads:finalize`; a conflicting second POST cannot replace the object. Retryable processing failure retains staging bytes until expiry. Terminal failure/cancellation deletes staging asynchronously. Only `published` is an unlock.

Playback and thumbnail grants last 60 seconds. Fetch the returned URL directly with AVPlayer/URLSession; the grant is opaque and requires no undocumented AVPlayer header injection. Request a fresh grant for retries/long pauses. Each GET/HEAD rechecks current database authorization, returns bytes, and never redirects to a reusable storage URL. Clear player, thumbnail, caption and subscription caches on sign-out or social changes. Already delivered bytes cannot be revoked.

Avatar uploads use their own authenticated intent and a 2 MiB/2048×2048 input bound. POST raw JPEG/PNG to the returned URL. The worker decodes and normalizes to a metadata-free JPEG of at most 512×512; only that sanitized output becomes a minimal profile avatar. `profiles:update` consumes the viewer's verified intent. `avatarUploadId: null` keeps the existing avatar. Avatars are deliberately public minimal-profile assets at `/v1/avatars/<userId>`, with no opinion data and no storage-ID resolution endpoint. They are not a bypass for private thumbnails or videos.

The original-only feed caps at eight items, profile-history pages at ten, and reply pages at 50. Feed and reply pagination are applied **after** audience filtering, so strangers' originals and hidden replies do not create returned IDs, counts or empty-page cursors. Social changes can invalidate a cursor; refetch from the first page then. Captions are explicitly `unavailable` until a real transcription integration exists.
