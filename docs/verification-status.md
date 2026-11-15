# Verification status

## Exact sources and artifact boundary

The three PRs remain independent and main-based; this docs branch does not include the application trees. All evidence below identifies the source actually exercised. No merge, hosted deployment, or final-corrected-pair acceptance is implied.

| Layer | Snapshot / evidence |
| --- | --- |
| Base | `main` at `3151ed0772f208dcb1700580bf85bdeed79c23b2`. |
| Docs/probe | [PR #1](https://github.com/mehmetuzgoren/reals/pull/1); earlier full tooling review at `cdd871db9147b09337c8f93a01f1603c5446ccfa`. Setup reconciliation then tightened the media cap to 8 MiB with a boundary regression; the narrow delta was independently rechecked at `f2e885c01226a62831e6e3e683b9466ac10a72e9`. |
| Native UI actually installed | [PR #2](https://github.com/mehmetuzgoren/reals/pull/2), source `1005036a4fe5c67ec7409844bbdbec83ad679578`; managed Revyl build `01M7GGW83TZ9P83QH3V1W10F0K`, version `b73f5572-2591-4bad-8ddf-e473fb8258ff`; bundle `com.take.app` version/build `1.0`/`1`. |
| Native compatibility source inspected | `566d250882aa0ee55775efc2753bb3a9eeacb239`; includes `dbc769d` capture/export 8 MiB cap, explicit 8/10/50 page sizes, upload acknowledgment binding, downloaded-player expiry, then bound-byte retry reconciliation and the monochrome restyle. This is source inspection, not a succeeded visual artifact. |
| Backend independently executed | [PR #3](https://github.com/mehmetuzgoren/reals/pull/3), corrected source `fbb0033da8108b2e9b4b51d77eb01bb19b3548fb`; detached review checkout, Node 24.22.3, FFmpeg 6.1.1. Earlier baseline was `468c8176b8ce6cea81b5c8182b7cf3dfe82b8486`. |

Development identified a native bound-byte retry-reconciliation defect and backend push-fanout/planner-window defects. The corrected backend was independently rerun; the native recovery delta was compared with its actual status/finalization behavior. Native DTOs, adapter, capture and player code are unchanged from the earlier compatibility snapshot. Its new retry path finalizes the existing intent before any repost and permits repost only for uploading-state missing-byte `INVALID_MEDIA`; three native regression fixtures cover verifier outage, lost acknowledgment and genuinely unbound bytes. These native tests have not been rerun by this Linux verification thread. The phone remains asleep to release shared Revyl capacity and will not resume before the succeeded replacement artifact is routed.

## Independently executed local checks

At corrected backend `fbb0033`, `npm ci && npm run check` independently passed TypeScript and **43 tests** in five files (earlier `468c817`: 33). These invoke registered Convex functions/routes in `convex-test` with injected identities. Existing privacy/publication cases remain; ten added regressions cover malformed-token fanout, per-page retry/crash exhaustion, terminal final-page failure, initial planning after a local window, expired/stale opening rejection, numeric bounds, and actual in-window catch-up without backdating. New persisted `windowStartsAt` / `windowEndsAt` stay internal and do not change the public Round DTO. This is actual application-test execution, not real Firebase JWT or hosted Convex acceptance.

At `fbb0033`, `npm run test:media` independently passed **3 integration tests** again, using the actual authenticated HTTP worker and real FFprobe/FFmpeg decoding through Convex publication/media routes. Valid video produced a receipt and exact private bytes; silent/overlong/truncated media did not unlock; normalized avatar output was bound correctly. `npm --prefix verifier run check` previously passed **61 worker tests** at `468c817`; a direct git comparison confirms the entire worker tree is unchanged at `fbb0033`, so that unchanged suite was not rerun. These use a local worker, not a deployed HTTPS service, and do not test bytes captured by an iPhone.

Current docs/probe checks contain **14 tests**, including an added exact-8-MiB / over-limit regression for the delivered application cap, and seven-file local-link validation. The clean mock exercises **25 probe assertions**, not a live product. Independent tooling review of the earlier 13-test revision found nested Round and discarded log/error/success-value validation gaps; all were corrected with strict recursive DTO validation before projection. Its final read-only recheck rejected **189** independent extra/missing/wrong-type mutations and found no remaining tooling blocker. The real-deployment probe has not run.

CI runs the tooling without secrets. Once backend source is present, it also installs the locked backend, typechecks/tests it, and runs actual media integrations/worker checks with FFmpeg. The backend job is explicitly skipped on this docs-only checkout; skipped work is not a product pass.

## Cloud-iPhone observations, not physical capture

One iPhone 16 cloud session, machine `machine_01M7GH513G4W7SCZWF4QPRXEZZ`, installed the succeeded `1005036` artifact above. The native owner reports Xcode 27 (`27A266a`), arm64 iOS 18.5, **18 unit + 1 UI tests**, zero failures. This verification thread independently installed/drove the artifact but did not rerun or independently read its complete XCTest result bundle.

Observed without account or production configuration: Explore Demo Mode; Casey locked on pineapple; explicit four-second simulator-fixture consent and preview; Casey original publication and a two-friend-original reveal; Blair's reply visible in Alex's conversation to Casey; Casey reply publication increasing the conversation to two while the main friends feed remained two originals; Dana simulated failed upload retaining a saved draft and staying locked; reopen/retry succeeding with only Alex in Dana's friends feed. Public evidence is fictional illustrated local media with synthetic tones, not physical recordings, speech, or transcripts. Screenshots are preserved with the build/scenario manifest in the Development handoff and issue SQU-5.

Dana's hidden reply/count inside the conversation and the second-round exact prompt/relock remain targeted final-artifact observations. The saved colored UI is **pre-restyle**: the requested four-screen monochrome redesign will need its own final-source screenshots, not reuse of this visual evidence. Other tabs, preferences/history/relationships/deletion, accessibility settings, interruption/player lifecycle, and physical permissions have not all been independently driven. A screenshot of playback does not prove audible sound or lifecycle behavior. Network was available: no airplane-mode/traffic-isolation result is claimed. The phone lane exposes screenshots, not a supported recording action; no walkthrough video is claimed.

## Remaining gates

| Gate | Evidence still needed |
| --- | --- |
| Final native artifact | Succeeded build/source matching the recovery + monochrome restyle, four reference-corresponding screenshots, Dana conversation hiding, second-round relock, and targeted final recovery checks. Backend `fbb0033` local checks are complete. |
| Real staging acceptance | Dedicated Convex/site origins, actual acceptance fixture, real Firebase identities/tokens supplied securely, hosted verifier path and real authenticated upload/grants/probe. The development seed makes round plans only. |
| Apple auth/deletion | Signed app, real Apple/Firebase sign-in/reauthentication, current `auth_time`, and completed upstream identity-cleanup evidence. |
| Remote notifications | Actual signed-device FCM/APNs foreground/background/cold-start delivery, permission/preferences/token rotation and invalid-token behavior. Current native taps select/refetch Today rather than deep-linking to a conversation. |
| Physical capture | Real front camera/microphone, sound, orientation/interruption, early/15-second stop, actual H.264/AAC export fitting 8 MiB and trusted verifier acceptance. |
| Deployment policy | TLS/ingress quotas, no private caching or sensitive logs, resource/retention/bandwidth budget and load checks. |

External service/hardware gates remain explicit limits, not a request to stop completing the local runnable delivery. [Acceptance criteria](../verification/acceptance.md) distinguish these lanes. No product-ready or production-ready conclusion follows solely from tooling CI, mocked identity tests, or the older demo artifact.
