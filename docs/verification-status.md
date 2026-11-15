# Reals verification status

## Current truth — November 15, 2026

The development **v4 backend is live** at `902c8f8`, but no hosted verifier exists. Signed-in no-media locks/social/sessions and v4 negative guards passed independently. Positive publication/private-media behavior and the eight-screen mock-exact native artifact remain unverified. The [v4 contract](wire-v4.md) is implemented/deployed, not a claim that all outcomes passed. The three PRs remain independent and based on `main` at `3151ed0772f208dcb1700580bf85bdeed79c23b2`.

| Layer | Exact checkpoint and evidence boundary |
| --- | --- |
| Backend live v4 | [PR #3](https://github.com/mehmetuzgoren/reals/pull/3), `902c8f84c1abf998728e0c5c4b566a614b9e3aca`, confirmed deployed by Development after v3 `a48095d`. Bootstrap remains development-only password sign-in, Apple placeholders, site origin and America/Los_Angeles 10–20 settings. This verification reran real signed-in/v4 routes after that confirmation, not an environment dump or deployment. |
| Native Convex Auth source | [PR #2](https://github.com/mehmetuzgoren/reals/pull/2), `027d48899d0cd0726a9365e3039858fb816a84e0`. Auth/APNs request names and nonce/OAuth-state distinction were source-read. No build or phone result from this auth head is claimed. |
| Last installed visual artifact | Native `566d250882aa0ee55775efc2753bb3a9eeacb239`, build `01M7GKCYFDRXT36B8TEGNYAXGK`, managed version `3eb64da0-defc-4e79-a01b-b04065151b92`. Six monochrome states independently captured; this predates Convex-only auth and the new eight-screen mocks. |
| Docs/tooling | [PR #1](https://github.com/mehmetuzgoren/reals/pull/1), live-boundary probe plus 26 tooling tests. Review at `5308700` cleared the earlier deployed-boundary delta. Final-head CI/review is recorded in the PR, not inferred from that earlier review. |

## Independently executed hosted boundary probe

`node verification/deployment-probe.mjs verification/deployment.example.json` passed **19/19** real development-boundary assertions against `https://first-mandrill-982.convex.cloud` and `https://first-mandrill-982.convex.site`.

It checked unauthenticated session/content denial, the current APNs registration argument shape reaching its auth guard, placeholder Apple start/completion rejection, eight malformed relay cases, fixed code/error destinations with no-store/no-referrer, the Apple **POST** callback route and invalid-grant GET/HEAD denial. No account, password session, published fixture, valid video or real Apple identity was used.

The initial run exposed a probe mismatch: media denial is a strict JSON `failure` envelope, not only plain text. It was reconciled against the actual backend `lib/http.ts` and live response, with extra-field/wrong-code/revealing-message regressions. The probe now also rejects unexpected API error text and revealing relay bodies; it accepts only the exact public guard messages and reviewed Convex framework wrappers. All 19 checks passed after those changes. GET `/oauth/apple/callback` returns 404 because the registered callback is POST; an empty POST returns 400. This is route presence, not provider success.

The full **25-assertion published-fixture privacy/media probe remains unrun** on this deployment. Dedicated signed-in QA accounts now exist, but published original/reply fixtures and a hosted verifier are still absent. A green boundary probe does not clear this gate.

## Independently executed signed-in checks without media

Development authorized live creation of `qa_reals_a`, `qa_reals_b` and `qa_reals_c`. Passwords/tokens stay only on the verification machine in a 0700 directory/0600 file, never in this repository or shared records. The bootstrap passed **19/19** live assertions at 23:09:44 UTC, before v4 deployment was confirmed. After Development confirmed `902c8f8`, the complete no-media matrix passed **86/86** at 23:19:42 UTC and the added v4 matrix passed **39/39** at 23:19:46 UTC on November 15. Those are 125 current-head signed-in assertions plus the earlier 19 bootstrap assertions, separate from the 19 unauthenticated boundary assertions above. No app, phone or video was involved.

- All three development signups returned signed sessions bound to distinct users; pre-onboarding sessions required profiles, onboarding succeeded, and subsequent sessions returned the correct public profile.
- A current open round existed, so no seed was needed. All three Today states had no receipt/original and stayed locked. Feeds were exactly empty with null cursors before and after friendship; Today exposed only eligible public friend presence with `hasPublished: false`.
- A requested B, both pending directions matched, B accepted, and both saw approved friendship. C could not accept their request, A could not accept its own outgoing request, and B could not cancel an incoming request. Removal cleared both sides; friendship was restored at the end and C stayed unrelated.
- Missing original/reply IDs yielded generic `NOT_FOUND` for detail/reply lists, captions and video/thumbnail grants for all three accounts. These were deliberately nonexistent IDs, **not inaccessible published content**, so they do not prove the reply intersection, hidden counts or live grant revocation.
- Refresh rotated tokens for the same user and the refreshed JWT read the correct profile. Sign-out made authentication false, the previously valid JWT lost application access, refresh returned `noSession`, and password sign-in restored the same user for each account.
- For You returned exactly an empty page/null cursor without a receipt, including oversized pagination with an unknown cursor. Missing originals/replies denied like toggles and comment reads/creation. A well-formed, table-valid but nonexistent battle ID denied reads and votes on both sides with `NOT_FOUND`, not argument validation. All three accounts stayed locked after these denied interactions. No likes/comments/votes/battles were created.

The first attempt used access JWTs that had expired while the harness was prepared; the gateway correctly returned 401. Refreshing the fixture sessions fixed that setup issue. Three social-denial checks initially rejected the actual public source-path wrapper; after correcting the exact expected path, the entire 86-assertion pass was rerun successfully. The shared strict validator now also accepts the reviewed real `NOT_FOUND` request-ID/stack envelopes, including the nested media-action frame, while rejecting added diagnostics or unknown paths. No backend defect was observed in these checks.

Still required: published receipt/unlock, original/reply visibility and filtered counts, positive media/Range/expiry, remove/block/delete revocation of real grants, next-round relock and successful v4 public/friends feeds, likes/comments/battle votes, author exclusions and cascades on real published fixtures. Missing-ID denial does not prove existing private-content authorization. Real Apple OAuth, production developer-session rejection and live account deletion remain separate unexecuted lanes.

## Local and historical results

At earlier v3 backend `a48095d`, the source owner reported 75 backend tests, 3 actual HTTP/FFmpeg integrations, 61 worker host tests, strict local Convex analysis/codegen and a local signed-session/deletion smoke. Its read-only reviewer reported 50 targeted tests. Those are historical owner/reviewer results, not a new independent local v4 execution by this thread. Current v4 evidence here is the explicitly scoped live matrix above.

This thread previously executed backend `fbb0033da8108b2e9b4b51d77eb01bb19b3548fb`: typecheck +43 tests and 3 actual authenticated HTTP-worker/FFmpeg integrations, Node 24.22.3 / FFmpeg 6.1.1. Worker 61 passed at `468c817` and its tree was unchanged at `fbb0033`. These older identity-based snapshots do not establish current Convex Auth or v4 correctness.

Current tooling: **26/26** local tests, with 12 boundary/denial-envelope regressions added since the earlier 14-test checkpoint; the fake transport checks tooling only. The existing 25-assertion mock privacy transport and 189 historical DTO mutations are not hosted product results. CI runs tooling without secrets; backend CI skips this docs-only checkout. Current-push CI/review is recorded in the PR, not assumed from earlier green runs.

## Cloud-iPhone evidence and next pass

The existing QA iPhone 16, `machine_01M7GH513G4W7SCZWF4QPRXEZZ`, is asleep. At visual source `566d250` this thread installed and captured, in order: Casey locked pineapple with all three options; round shutter/15-second timer; revealed originals feed; Casey seeing Blair's reply on Alex (1 visible); Dana seeing zero replies; the exact Elon Musk second question relocking Dana. Native owner reports 22 unit +1 UI tests at that build; this thread did not independently reread its full XCTest log.

These six screenshots and their build manifest remain historical. Native replies were tall cards requiring scroll, unlike the then-reference's compact reply row. The new eight-screen mock replaces that design again, including Reals branding, no tab bar, public/social screens and full-screen replies. No new mock screenshot or visual approval is claimed.

An earlier `1005036` / build `01M7GGW83TZ9P83QH3V1W10F0K` session covered explicit sample consent/preview, Casey reply publication and Dana simulated failure/save/locked/reopen/retry. All video evidence is fictional illustrated samples/synthetic tones, not physical recording. Network stayed available; no network-denied, independently audible or continuous recording result exists.

## Remaining gates

- Receive the succeeded mock build from Development, compare all eight screens mock-left/app-right, list every difference and rerun the old Demo privacy/round checks; release the phone afterward.
- Compare the matching native head with deployed backend `902c8f8`, then extend strict positive-content probe schemas without weakening existing privacy assertions. The native mock artifact has not been routed here.
- Provision a hosted verifier and dedicated signed-in published fixtures for full live media/privacy/revocation and upload acceptance. Development's internal seed creates plans only.
- Real Apple OAuth/relay, live account deletion, production rejection of developer identities, signed-device remote APNs and physical capture/audio/permissions/lifecycle remain separate lanes. Development-password session refresh/sign-out were verified above.
- Review deployment ingress/cache/log/retention/load policy. No merge or auto-merge is authorized.
