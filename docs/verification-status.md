# Verification status

## Exact sources and artifact boundary

The three PRs remain independent and main-based; this docs branch does not include the application trees. All evidence below identifies the source actually exercised. No merge, hosted deployment, or final-corrected-pair acceptance is implied.

| Layer | Snapshot / evidence |
| --- | --- |
| Base | `main` at `3151ed0772f208dcb1700580bf85bdeed79c23b2`. |
| Docs/probe | [PR #1](https://github.com/mehmetuzgoren/reals/pull/1); final independent tooling review at `cdd871db9147b09337c8f93a01f1603c5446ccfa`. Later source/setup/evidence edits do not change the probe. |
| Native UI actually installed | [PR #2](https://github.com/mehmetuzgoren/reals/pull/2), source `1005036a4fe5c67ec7409844bbdbec83ad679578`; managed Revyl build `01M7GGW83TZ9P83QH3V1W10F0K`, version `b73f5572-2591-4bad-8ddf-e473fb8258ff`; bundle `com.take.app` version/build `1.0`/`1`. |
| Native compatibility source inspected | `dbc769de2b1d2d712fc48e91c6f01809236d4db4`; capture/export 8 MiB cap, explicit 8/10/50 page sizes, upload acknowledgment binding, and downloaded-player expiry. Its queued build was superseded before final acceptance. |
| Backend independently executed | [PR #3](https://github.com/mehmetuzgoren/reals/pull/3), source `468c8176b8ce6cea81b5c8182b7cf3dfe82b8486`; detached review checkout, Node 24.22.3, FFmpeg 6.1.1. |

Development subsequently identified a native bound-byte retry-reconciliation defect and backend push-fanout/planner-window defects. Their corrected heads and replacement native artifact must be rechecked on the changed paths; older green tests/screenshots do not prove those corrections. The phone was slept immediately to release shared Revyl capacity for that replacement build. It will not be resumed before the succeeded artifact is routed.

## Independently executed local checks

At backend `468c817`, `npm ci && npm run check` passed TypeScript and **33 tests** in five files. These invoke registered Convex functions/routes in `convex-test` with injected identities. Covered scenarios include locked/pending direct IDs, Casey/Dana list/count/caption/video/thumbnail visibility, remove/block revocation, grant expiry/Range/HEAD/no-store, idempotent/concurrent publication, preserved deletion receipts, new-round relock, avatars, recent reauthentication/tombstones, and generic preference-aware mocked push. This is actual application-test execution, not real Firebase JWT or hosted Convex acceptance.

At the same head, `npm run test:media` passed **3 integration tests**, using the actual authenticated HTTP worker and real FFprobe/FFmpeg decoding through Convex publication/media routes. Valid video produced a receipt and exact private bytes; silent/overlong/truncated media did not unlock; normalized avatar output was bound correctly. `npm --prefix verifier run check` independently passed **61 worker tests**, covering real generated MP4/image fixtures, HTTP auth/hash/bounds/timeouts/capacity/cleanup and normalization. These use a local worker, not a deployed HTTPS service, and do not test bytes captured by an iPhone.

Current docs/probe checks contain **14 tests**, including an added exact-8-MiB / over-limit regression for the delivered application cap, and seven-file local-link validation. The clean mock exercises **25 probe assertions**, not a live product. Independent tooling review of the earlier 13-test revision found nested Round and discarded log/error/success-value validation gaps; all were corrected with strict recursive DTO validation before projection. Its final read-only recheck rejected **189** independent extra/missing/wrong-type mutations and found no remaining tooling blocker. The real-deployment probe has not run.

CI runs the tooling without secrets. Once backend source is present, it also installs the locked backend, typechecks/tests it, and runs actual media integrations/worker checks with FFmpeg. The backend job is explicitly skipped on this docs-only checkout; skipped work is not a product pass.

## Cloud-iPhone observations, not physical capture

One iPhone 16 cloud session, machine `machine_01M7GH513G4W7SCZWF4QPRXEZZ`, installed the succeeded `1005036` artifact above. The native owner reports Xcode 27 (`27A266a`), arm64 iOS 18.5, **18 unit + 1 UI tests**, zero failures. This verification thread independently installed/drove the artifact but did not rerun or independently read its complete XCTest result bundle.

Observed without account or production configuration: Explore Demo Mode; Casey locked on pineapple; explicit four-second simulator-fixture consent and preview; Casey original publication and a two-friend-original reveal; Blair's reply visible in Alex's conversation to Casey; Casey reply publication increasing the conversation to two while the main friends feed remained two originals; Dana simulated failed upload retaining a saved draft and staying locked; reopen/retry succeeding with only Alex in Dana's friends feed. Public evidence is fictional illustrated local media with synthetic tones, not physical recordings, speech, or transcripts. Screenshots are preserved with the build/scenario manifest in the Development handoff and issue SQU-5.

Dana's hidden reply/count inside the conversation and the second-round exact prompt/relock remain targeted final-artifact observations. The saved colored UI is **pre-restyle**: the requested four-screen monochrome redesign will need its own final-source screenshots, not reuse of this visual evidence. Other tabs, preferences/history/relationships/deletion, accessibility settings, interruption/player lifecycle, and physical permissions have not all been independently driven. A screenshot of playback does not prove audible sound or lifecycle behavior. Network was available: no airplane-mode/traffic-isolation result is claimed. The phone lane exposes screenshots, not a supported recording action; no walkthrough video is claimed.

## Remaining gates

| Gate | Evidence still needed |
| --- | --- |
| Corrected head pair | Exact corrected native/backend SHAs, changed-path regressions, succeeded replacement artifact, targeted final phone retest. |
| Real staging acceptance | Dedicated Convex/site origins, actual acceptance fixture, real Firebase identities/tokens supplied securely, hosted verifier path and real authenticated upload/grants/probe. The development seed makes round plans only. |
| Apple auth/deletion | Signed app, real Apple/Firebase sign-in/reauthentication, current `auth_time`, and completed upstream identity-cleanup evidence. |
| Remote notifications | Actual signed-device FCM/APNs foreground/background/cold-start delivery, permission/preferences/token rotation and invalid-token behavior. Current native taps select/refetch Today rather than deep-linking to a conversation. |
| Physical capture | Real front camera/microphone, sound, orientation/interruption, early/15-second stop, actual H.264/AAC export fitting 8 MiB and trusted verifier acceptance. |
| Deployment policy | TLS/ingress quotas, no private caching or sensitive logs, resource/retention/bandwidth budget and load checks. |

External service/hardware gates remain explicit limits, not a request to stop completing the local runnable delivery. [Acceptance criteria](../verification/acceptance.md) distinguish these lanes. No product-ready or production-ready conclusion follows solely from tooling CI, mocked identity tests, or the older demo artifact.
