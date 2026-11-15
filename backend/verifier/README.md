# Trusted TAKE media verifier

This is a separate Node 24 service, not a Convex function. Its container installs real `ffprobe` and `ffmpeg`. It accepts bytes only, hashes the exact body, fully decodes accepted media, and fails closed when configuration, decoding, capacity, or timing checks fail. There are no third-party Node dependencies, remote URL fetches, transcripts, public storage, or client credentials here.

## API

All routes require `Authorization: Bearer <VERIFY_SHARED_SECRET>`. The secret is server-only, 32–512 printable non-space ASCII characters; generate 32 random bytes or more. Missing/short configuration prevents startup. Missing, duplicate, or wrong authorization returns 401. Never put this secret in an iOS app, a client environment variable, a URL, a log, or git.

### `POST /verify`

Send the **actual stored MP4 bytes** as the entire uncompressed `application/octet-stream` body, not JSON, multipart, a URL, a pathname, or client metadata. Include exactly one `X-Content-SHA256` header containing the lowercase, 64-character SHA-256 of those exact bytes. Content-Length is optional; the actual byte count is enforced for chunked requests too.

Success is exactly:

```json
{
  "sha256": "<lowercase SHA-256 of the exact input>",
  "durationMs": 1000,
  "width": 720,
  "height": 1280,
  "videoCodec": "h264",
  "audioCodec": "aac",
  "thumbnailBase64": "<metadata-free JPEG, or null>"
}
```

The illustrative dimensions above are not fixture claims. Width/height are **displayed** dimensions, after applying the MP4 right-angle display rotation. The worker checks both the MP4 structure and codec headers, then decodes every video frame and the entire AAC track using strict error detection. It cross-checks frame counts, dimensions, square pixels, decoded presentation timestamps against MP4 sample timing, the final sample end, FPS, audio continuity/sample counts, and decoded audio peak. It does not trust duration headers alone or use FFmpeg's sometimes-inaccurate decoded-frame duration field as the presentation duration. Truncation, corrupt decode output, warnings, incomplete tracks, frame changes, and false metadata fail closed. No `-t`, `-shortest`, or first-frame-only validation can hide a corrupt or overlong tail.

Accepted video is ordinary non-fragmented MP4, at most 20 MiB, exactly one H.264 video track and one AAC-LC audio track, 8-bit 4:2:0 Baseline/Main/High, square pixels, portrait (`height > width`), positive FPS at most 60, dimensions at most 4096 on either axis and at most 2160×3840 pixels. Container and track durations and the **last decoded video frame end** must be positive and at most 15,000 ms, with no video-duration grace period. Both tracks must begin within 100 ms of zero. Decoded audio must cover the video within 200 ms, be mono/stereo at 8–96 kHz, and peak above −80 dBFS. Missing audio and all-silent/effectively silent AAC are invalid. One final AAC frame's codec padding is allowed in decoded samples, not in declared duration or video timestamps. This detects unusable silence, not whether the person spoke or which opinion they expressed.

The accepted native export profile is H.264/AAC-LC MP4, 30 FPS or lower, portrait or a correctly rotated portrait presentation, and square pixels. MOV, fragmented MP4, HEVC, extra tracks, unsupported color formats, and ambiguous orientation are rejected rather than guessed. The native client must export capture before uploading.

The bounded MP4 box reader checks movie/track/edit-list duration limits directly and expands the video `stts` sample table into at most 900 exact durations, cross-checking its total with the media header. Video packet DTS is checked against that sample sequence; decoded PTS is checked one-to-one against the packet sequence, and every displayed sample end uses its duration from the actual `stts` bytes. Neither ffprobe's packet-duration inference nor an FPS tolerance can hide an overlong final sample. Normal-rate, flattened edit lists (optionally with one short leading empty edit) are supported; repeated media, dwell edits, and timing inconsistencies are rejected.

Packet inspection disables ffprobe's codec parser (`+noparse`); the separate full decode still uses the real codec parser and strict error checks. Integer tick-to-millisecond ceilings keep a 15,000 ms native 600-tick-timescale clip valid without accepting any video end beyond the cap.

A thumbnail is generated only **after** full video/audio verification. It is at most 320 px per axis and 512 KiB before base64. If optional thumbnail generation fails, the value is `null`; no client thumbnail or invented image is substituted.

### `POST /verify-avatar`

Use the same authorization, `application/octet-stream` content type, and exact-body `X-Content-SHA256`. The body is at most 2 MiB and must be one JPEG or PNG image. Success is exactly:

```json
{
  "sha256": "<lowercase SHA-256 of the original input>",
  "width": 512,
  "height": 342,
  "mimeType": "image/jpeg",
  "imageBase64": "<normalized JPEG>"
}
```

The original input hash is **not** the hash of the normalized JPEG. The worker validates PNG critical chunks/order/CRCs or JPEG scan/marker boundaries before probing, rejects APNG/concatenated images and unsupported signatures, and limits source dimensions to 2048 per axis / 4,194,304 pixels before full decode. It separately inflates the complete PNG IDAT zlib stream with bounded streaming buffers and exact raster/filter lengths (including Adam7), rejecting truncation, extra compressed/inflated data and unknown critical chunks even when ffmpeg tolerates them. It then fully decodes the image with ffmpeg, requires exactly one decoded frame, and re-encodes a JPEG of at most 512 px per axis and 512 KiB. All JPEG APP/COM metadata, including EXIF, ICC, GPS and source comments, is removed. Alpha is not retained in the JPEG. Original avatar bytes must remain private staging input and must never be served as the resulting profile asset.

Full image decoding uses an explicitly mapped image stream and disables the speculative `find_stream_info` decode, which can issue a false missing-EOI warning on valid flat JPEGs. The complete decode itself still rejects every warning/error; truncated JPEG entropy with a present EOI marker is covered by a regression fixture.

### `GET /health`

Authenticated only; returns `{"ok":true}` after the executable startup checks have succeeded. It does not echo configuration or secrets. There is no unauthenticated probe endpoint.

### Errors

Errors have `{ "error": { "code": "...", "message": "..." } }`; no command output, media metadata, paths, or credentials are included. Every response is `Cache-Control: no-store` and closes its connection. Expected statuses are 400 (malformed/hash mismatch), 401 (authentication), 404 (unknown exact route/method), 408 (receive/whole-request deadline), 413 (body cap), 415 (content type/encoding), 417 (unsupported Expect), 422 (invalid/unsupported media), 429 (capacity; `Retry-After: 1`), 503 (unavailable), and 504 (child-process deadline). A timeout/unavailable/busy response must never cause publication or a receipt.

## Bounds and configuration

These application configuration variables are supported. The service rejects invalid/out-of-range values rather than accepting an unbounded setting. Timeout values are positive integer milliseconds; body/process timeouts are additionally clamped to the whole-request timeout. Temporary files use Node's OS temporary directory (`/tmp` in the container).

| Variable | Default | Allowed maximum |
| --- | --- | --- |
| `VERIFY_SHARED_SECRET` | required | 32–512 non-space ASCII characters |
| `PORT` | 8080 | 65535 |
| `VERIFY_MAX_BYTES` | 20971520 | 20971520 |
| `VERIFY_MAX_AVATAR_BYTES` | 2097152 | 2097152 |
| `VERIFY_MAX_DURATION_MS` | 15000 | 15000 |
| `VERIFY_MAX_CONCURRENCY` | 2 | 4 |
| `VERIFY_MAX_CONNECTIONS` | 32 | 64 |
| `VERIFY_REQUEST_TIMEOUT_MS` | 25000 | 30000 |
| `VERIFY_BODY_TIMEOUT_MS` | 5000 | 10000 |
| `VERIFY_PROCESS_TIMEOUT_MS` | 8000 | 10000 |

The concurrency slot covers receiving, hashing, probing, full decode, normalization, and cleanup. There is no work queue. Each slot runs at most one child at a time. Children use fixed absolute binaries and argument arrays (no shell), one decode/filter thread, a 64 MiB individual-allocation limit, file/pipe-only protocols, and disabled MP4 external data references/absolute paths. Captured output across all child pipes is at most 2 MiB, video packet/metadata probe output at most 512 KiB (image probe: 128 KiB), and image output at most 512 KiB. Child deadline, request abort, excess output, or client disconnect kills the process group and waits for exit before releasing capacity or deleting its files. PNG raster inflation emits at most the dimension-derived scanline length, uses 16 KiB output chunks without retaining the inflated image, and is cancelled on the same request deadline.

Headers are capped at 8 KiB / 32 parsed fields, header receive time at 5 s, connections at the configured maximum, and each socket at one request. Body bytes are buffered only up to their cap. Files have unpredictable private temporary directories and mode 0600; the only written input is the exact, hash-matched body. Temporary input is removed on success/failure/abort. Use the container limits below for an OS-enforced total memory, process, CPU and temporary-space bound, including a hard kill/crash. ffmpeg's allocation flag is not a substitute for the container memory limit.

## Local verification

On Linux install Node 24 and ffmpeg/ffprobe **6.1 or later** at `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` (the deployment image supplies FFmpeg 7). From the repository root:

```sh
cd backend/verifier
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Tests generate real H.264/AAC, rotated, landscape, absent/silent audio, wrong-codec, 15,000 ms / over-limit / forged-duration / corrupt / truncated MP4, JPEG, PNG, APNG, GIF, oversized-dimension and corrupt image fixtures **at runtime** with ffmpeg. No media files are committed. The suite exercises both real HTTP endpoints, exact hashes, auth, body caps including chunked input, slow bodies, whole-request and real subprocess timeouts, output caps, client disconnect, capacity, temporary cleanup, normalized output re-decode and metadata removal. It does not mock the production decoder or substitute metadata-only results.

## Container deployment

Build from the repository root; the build context is deliberately only this directory:

```sh
docker build --pull -t take-media-verifier:local backend/verifier
```

Run the same suite against the installed container codec version before deployment (from the repository root):

```sh
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --cpus 2 --memory 768m --memory-swap 768m \
  --pids-limit 64 --ulimit nofile=256:256 --ulimit core=0:0 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
  -v "$PWD/backend/verifier/test:/app/test:ro" \
  take-media-verifier:local npm run check
```

The base image is pinned to the tested Node 24 image digest. Debian FFmpeg security packages are deliberately refreshed at image build time; a rebuilt image must pass this suite before promotion. Update the base digest through the same tested process when taking Node security updates.

For a single host behind a TLS reverse proxy, create a local **ignored** configuration file without printing its value:

```sh
(umask 077; printf 'VERIFY_SHARED_SECRET=%s\nPORT=8080\n' "$(openssl rand -hex 32)" > backend/verifier/.env)
docker run -d --name take-media-verifier --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --cpus 2 --memory 768m --memory-swap 768m --pids-limit 64 \
  --ulimit nofile=256:256 --ulimit core=0:0 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
  --env-file backend/verifier/.env \
  -p 127.0.0.1:8080:8080 take-media-verifier:local
```

The image runs as the existing unprivileged `node` user, uses `tini` for signal forwarding/reaping, contains no secret or source media, and fails startup if the secret/binaries are missing. Do not bake the `.env` into an image; `.dockerignore` excludes it. In managed hosting use the secret manager instead of an env file. The shown 64 MiB tmpfs supports the default two uploads; if concurrency is raised to four use a **bounded** 128 MiB tmpfs and reassess the memory/CPU budget. Resource exhaustion must remain a failed/retryable verification, not a fallback acceptance.

Terminate TLS at an authenticated deployment/reverse proxy and expose only these exact routes to the backend. Keep port 8080 off the public network; Convex must call the deployed HTTPS origin, not this host's loopback address. Restrict ingress to trusted backend egress/private network where available. Disable request body and Authorization header logging at the proxy/APM; do not put the bearer credential in a query string. Set an upstream response deadline of at most 35 s, a request-body cap of 20 MiB (the avatar route is further limited to 2 MiB in this service), and a short header/body timeout. Do not add a public direct-storage redirect or an unauthenticated proxy bypass. Rotate the secret atomically in this service and the backend; a mismatch fails closed.

For an authenticated health probe, use the deployment secret manager to set a header; do not paste its value into shell history. A missing secret can be tested safely with `docker run --rm take-media-verifier:local`, which must exit nonzero.

## Convex integration and publication binding

1. An authenticated backend operation must first establish the owner-bound upload intent and read **that intent's actual private storage Blob**. Never let a client choose a storage ID or a verifier URL as proof of ownership.
2. Enforce the actual Blob size, read its actual bytes, compute SHA-256 server-side, and call the fixed configured HTTPS `/verify` (or `/verify-avatar`) with that binary body, exact hash header, and server-only shared secret. Use a bounded fetch deadline, e.g. 35,000 ms for the service's at-most-30,000 ms request cap, and a bounded JSON response read (video/avatars each fit below 750 KiB). Do not call ffmpeg inside Convex or trust client-reported duration/MIME/hash.
3. Require HTTP 200, the exact expected response shape, a lowercase returned hash **equal to the independently computed storage-byte hash**, bounded positive dimensions/duration and the expected codecs/MIME. For thumbnails and avatars also bound/decode the base64 output and its declared type. Reject every missing field, malformed response, failed/slow fetch, or mismatch; never create a successful receipt on these paths.
4. Recheck that the same storage object is still bound to the same upload/owner, and recheck current round, relationship, original/reply rules and idempotency in the final transaction. The hash binds a successful result to these bytes, not to a user, upload intent, or current authorization by itself. The service is deliberately not an authorization authority for TAKE users.
5. Store only the normalized avatar JPEG as the profile asset, bind it to the owner's intent, and clean up original staging bytes. The avatar response hash binds its input; compute a separate hash if the backend needs to identify the normalized output. Keep video and thumbnail delivery behind the application's current shared authorization/private-media grants. This service never serves uploaded originals and never returns a storage URL.

This package does not provision the TLS host, a Convex deployment, Apple credentials, or a native app. Those external integrations require deployment credentials and end-to-end verification; a green local fixture suite is not evidence that a particular phone capture or remote production deployment was tested.
