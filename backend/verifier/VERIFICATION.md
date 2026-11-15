# Verifier delivery evidence — 2026-11-15

## Delivered scope

All repository changes are under `backend/verifier/`, based on `3151ed0772f208dcb1700580bf85bdeed79c23b2`. They are intentionally uncommitted; no branch, commit, push, or PR was created. No media fixtures, `.env`, production credentials, root backend files, or Convex files are included. `SHA256SUMS` identifies every other delivered file; run `sha256sum -c SHA256SUMS` from this directory after transfer.

The service exposes authenticated `POST /verify`, `POST /verify-avatar`, and `GET /health`. Video has an independent 20 MiB hard ceiling; the caller may enforce a lower policy cap. Avatar input is at most 2 MiB and 2048 px per axis; normalized JPEG output is at most 512 px per axis. The README contains the exact binary protocol, bounded environment variables, secure container deployment command, and storage-hash/owner-binding requirements.

## Final test and build results

From the repository root:

```sh
cd backend/verifier
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

**Passed: 61 tests, 0 failures, 0 skipped; exit 0.** Host runtime: Node 24.22.3, Ubuntu FFmpeg/ffprobe 6.1.1. The check command syntax-checks all five source modules and runs the real HTTP/decoder suite. The final run's node:test duration was 8784 ms; this is not a throughput benchmark.

From the repository root:

```sh
docker build --pull --progress=plain -t take-media-verifier:local backend/verifier
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --cpus 2 --memory 768m --memory-swap 768m \
  --pids-limit 64 --ulimit nofile=256:256 --ulimit core=0:0 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
  -v "$PWD/backend/verifier/test:/app/test:ro" \
  take-media-verifier:local npm run check
```

**Build passed; container suite passed: 61 tests, 0 failures, 0 skipped; exit 0.** The final container node:test duration was 11520 ms. Its source hashes were compared with the checkout and match. The tests run with real installed codecs, no external network, a read-only root, dropped capabilities, nonroot UID 1000, and the displayed resource limits.

- Final local image ID: `sha256:fef359f28cb29a2b108038493cc43047f3702b6e94a064ca92b009279ff98bc8`.
- Base image digest: `node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0`.
- Container runtime: Node `v24.22.3`, FFmpeg/ffprobe `7.1.5-0+deb13u1`, `uid=1000(node) gid=1000(node)`.

An additional smoke run used the final image's actual `tini`/Node entrypoint and a test-only server secret. It confirmed unauthenticated health returns 401; authenticated health returns only `{"ok":true}`; a newly encoded 30 FPS / 600-tick H.264 + stereo AAC MP4 returns HTTP 200 with its exact input hash and 1000 ms / 96×160 metadata; and a newly encoded PNG returns HTTP 200 with its exact input hash and a bounded JPEG. SIGTERM exited cleanly with code 0. Starting the final image without a secret exited nonzero with a generic configuration error. All smoke containers were removed; no ffmpeg/ffprobe processes remained.

## Security review and regressions

An independent read-only subagent reviewed authentication, exact-body hashing, duration/orientation/codec validation, actual full decoding, image normalization/privacy, bounded resources, and container hardening. Its final verdict found **no remaining blocker** in the revised paths. It made no repository edits or PR calls; no automatic platform review is being claimed.

The review identified and verified fixes for these concrete boundary defects:

1. FFmpeg can infer incorrect video packet/frame durations at a 600-tick timebase, including hiding a 15100 ms final sample behind 15000 ms headers. The verifier now reads bounded raw movie/track/edit/media/sample timing from MP4 bytes, matches exact sample durations to packet DTS and decoded PTS, and checks every real sample end. Two runtime-generated fake-final-sample/edit regressions reject. The saved exploit with SHA-256 `84e0cd8e47062c3d7c227260a87af03836ee6c71d83ad479e6f4e522dae4593a` also returned **422 INVALID_MEDIA** against the final source.
2. FFmpeg tolerates some truncated or extra PNG zlib data. The verifier now checks complete, exact-length, bounded streaming IDAT inflation, PNG critical structure/CRCs/filter bytes and Adam7 pass sizes before full FFmpeg decode. Valid interlaced and 2048×2048 PNG controls pass; malformed/truncated/extra-data cases reject.
3. Speculative JPEG input probing can falsely warn about a missing EOI on valid normalized flat images. Complete explicitly mapped image decoding now skips that speculative probe while still rejecting every warning/error during the actual full decode. Valid JPEG round trips pass; truncated JPEG entropy with a present EOI rejects.

The reviewer independently ran 61 tests in the hardened container and 22 saved probe cases (19 invalid rejects, three valid controls). Those executions preceded the final one-line edit-list tightening. It then verified that the final `mp4.mjs` differed solely by rejecting two-entry edit lists whose first edit is not empty, and read-only reviewed that guard with no new concern. The owner subsequently ran the complete **61-test host and container suites on that exact final source**, as recorded above.

Other exercised boundaries include genuine display rotation versus landscape/scale/shear matrices, exact 15000 ms at two timebases, native-profile stereo AAC, silent/absent/wrong-codec audio, corrupt late bytes that pass metadata-only probing, truncation, wrong hashes/secrets, malformed/duplicate headers, unsupported routes/types/encodings, advertised and actual chunked 20 MiB / 2 MiB oversize bodies, absolute body/request/process deadlines, excess child output, concurrency rejection, disconnect cancellation, temporary cleanup, metadata stripping, and normalized-output re-decode. Fixtures are created at runtime, not committed.

## Final source identities

```text
4ab33f1903cd880340793ef14ef00660c753011b050da3a6fb2b55f4db37e0d4  src/config.mjs
45b6a4e2e7f970a914f1c385eb52728dbd81d0a874c6b0b7c296c08d93ac6609  src/media.mjs
34a6f0bc8901a05f52cb2eb4c17a2578a276b743864b3aa6c924c006e311d593  src/mp4.mjs
6a84d0d6022bdc6e4c9efc6222052c4531eb1dd11a40c22477ab2af8dd3086bb  src/process.mjs
0a270c027b6b1dc28b726bfdb10a47e32ae1b86a6831d895eceff5ec0605b8ea  src/server.mjs
```

## Unverified external integration

This delivery does not claim a deployed HTTPS/TLS service, live Convex storage/ownership integration, a native-device capture/export, remote production credentials, or a worst-case throughput/load benchmark. The backend owner must transfer these files, independently hash the actual owner-bound storage bytes, call the service with a bounded fetch/response read, compare its returned hash, and recheck authorization/round/idempotency before publication. Service failure, invalid media, busy capacity, timeout, or hash mismatch must never create a receipt. The worker's ceiling does not raise a stricter backend upload cap.
