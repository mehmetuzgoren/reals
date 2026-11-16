# Takes verification status

## Current truth — November 15, 2026

The development backend is live at **`807e034` with in-Convex structural media checks**; no external verifier is required. The new published-content matrix passed **84/84 hosted scenario assertions plus one local fixture check**. It covers actual publication/receipts, private intersections/counts/grants/removal revocation and successful v4 interactions, not native rendering or physical capture. PR #3 merged; backend follow-up #4 supplies the current checker. Docs PR #1 remains draft on its original `3151ed0` base pending the routed mock artifact.

| Layer | Exact checkpoint and evidence boundary |
| --- | --- |
| Backend live media head | [PR #4](https://github.com/mehmetuzgoren/reals/pull/4), `807e0345f80e6f0f91796edc813f13f9c29ad353`, confirmed deployed by Development after v4 `902c8f8` / merged PR #3. Bootstrap remains development-only password sign-in, Apple placeholders and Los Angeles 10–20 settings. This thread independently exercised deployed APIs, not an environment dump or deployment. |
| Native source / fixture | [PR #2](https://github.com/mehmetuzgoren/reals/pull/2), `89910ba95cf3db872abf552c56895c6e22d0470d`: bundled `sample-mock.mp4` bytes and AVAssetExportSession configuration were source-read. Earlier auth/APNs/nonce source-read was `027d488`. No current native build/phone result or actual AVAssetExportSession output is claimed. |
| Last installed visual artifact | Native `566d250882aa0ee55775efc2753bb3a9eeacb239`, build `01M7GKCYFDRXT36B8TEGNYAXGK`, managed version `3eb64da0-defc-4e79-a01b-b04065151b92`. Six monochrome states independently captured; this predates Convex-only auth and the new eight-screen mocks. |
| Docs/tooling | [PR #1](https://github.com/mehmetuzgoren/reals/pull/1), live-boundary probe plus 26 tooling tests. Review at `5308700` cleared the earlier deployed-boundary delta. Final-head CI/review is recorded in the PR, not inferred from that earlier review. |

## Independently executed published-media API matrix

At `807e034`, the main three-account matrix passed **73 hosted scenario assertions +1 local fixture check** at 23:54:04 UTC on November 15. A follow-up passed **6/6** public-playback/expiry scenarios at 23:56:37 UTC: grant issuance, exact GET bytes, HEAD length, one-byte Range, then generic GET/HEAD denial after waiting beyond expiry. A **5/5** revocation-timing follow-up passed at 00:00:25 UTC on November 16 (still November 15 in Los Angeles). It recorded six post-removal GET/HEAD denials with **59,126–59,416 ms remaining after each response**. This closes the first harness's timing-evidence gap: a pre-removal expiry check alone did not prove the grant remained unexpired when denial arrived. These are 84 hosted scenarios, not 84 HTTP requests; a scenario can check multiple calls. No run woke a phone or started a build.

The fixture is the exact synthetic native `sample-mock.mp4` from `89910ba`: 720×1280 H.264 plus mono AAC, four seconds, 29,721 bytes, moov before mdat, SHA-256 `0bcb95b579d4f9236054a13dcc79919ee71c510b53e11aa735c78cb3d78218f6`. It matches the requested media format but is **not an AVAssetExportSession-produced clip or physical recording**. The one-second negative was a trimmed copy. Actual export-preset/device compatibility and sound remain unverified.

- A published a friends-only original; B/C published opposing public originals through `uploads:begin` → bearer-authenticated raw POST → `uploads:finalize`. Upload alone left each locked; only published originals created their exact-round receipts. B's post unlocked A's original in B's friends feed; posted, unrelated C was still denied it. No seed was needed.
- B published a private reply and private comment on A. A/B saw exactly one of each. C temporarily became A's friend only: C could read A's parent but saw zero replies/comments and could not obtain its hidden reply's grant, read its caption, like it or list its comments. Removing A–C immediately denied C's still-unexpired parent grant. Removing A–B hid replies/comments, revoked B's parent and own-reply grants, and denied new grants; restoring A–B restored the exchange. C finishes unrelated.
- Authorized private and public grants delivered exact source bytes, HEAD length and one-byte Range/206, with private/no-store and no redirect. Corrupted grants were denied. The public follow-up waited for real expiry before GET/HEAD denial; it did not substitute token corruption or expired JWTs for grant expiry.
- For You returned public originals only, not friends-only A or the viewer's own take. Public likes toggled without duplicates; a visible private reply could be liked; a trimmed public comment was readable/countable by unrelated posted C. Opposing B/C originals paired automatically. Non-author A voted left, changed right and repeated without duplication; both authors were forbidden to vote.

QA content is intentionally retained: three originals, one reply, two comments, two current likes and one battle with A's single right-side vote. A/B remain approved friends, C unrelated. No account/content deletion or block was performed. Failed/cancelled QA intents and expired grant records may also remain. Passwords/refresh/access tokens and grant URLs remain machine-only.

Expected live negative responses were exact and non-retryable:

```json
{"failure":{"code":"INVALID_MEDIA","message":"Unsupported upload content type","retryable":false}}
```

That non-MP4 MIME POST returned HTTP 422. A one-second MP4 and non-MP4 bytes disguised as `video/mp4` were accepted as staged bytes, then `uploads:finalize` returned HTTP 200 with this failed publication result, never a receipt:

```json
{"status":"success","value":{"failure":{"code":"INVALID_MEDIA","message":"Unsupported or structurally invalid MP4/MOV video","retryable":false},"originalId":null,"receipt":null,"replyId":null,"state":"failed"}}
```

No unexpected live failure occurred. The original strict-v3 25-case CLI fixture run remains unexecuted; these results came from a separate exact-v4 three-account harness and must not be conflated with it. Actual AVAssetExportSession/camera output, current mock rendering, block/delete/account cascades, concurrency, legacy thumbnails and next-round live relock remain separate gates.

## Independently executed hosted boundary probe

`node verification/deployment-probe.mjs verification/deployment.example.json` passed **19/19** real development-boundary assertions against `https://first-mandrill-982.convex.cloud` and `https://first-mandrill-982.convex.site`.

It checked unauthenticated session/content denial, the current APNs registration argument shape reaching its auth guard, placeholder Apple start/completion rejection, eight malformed relay cases, fixed code/error destinations with no-store/no-referrer, the Apple **POST** callback route and invalid-grant GET/HEAD denial. No account, password session, published fixture, valid video or real Apple identity was used.

The initial run exposed a probe mismatch: media denial is a strict JSON `failure` envelope, not only plain text. It was reconciled against the actual backend `lib/http.ts` and live response, with extra-field/wrong-code/revealing-message regressions. The probe now also rejects unexpected API error text and revealing relay bodies; it accepts only the exact public guard messages and reviewed Convex framework wrappers. All 19 checks passed after those changes. GET `/oauth/apple/callback` returns 404 because the registered callback is POST; an empty POST returns 400. This is route presence, not provider success.

The original **25-assertion CLI fixture probe remains unrun** because its strict v3 positive-content schemas and original fixture layout need reconciliation. The newer published matrix above does not use that CLI. Dedicated accounts/published QA content now exist and no hosted verifier is required. A green unauthenticated boundary probe alone never establishes that published coverage.

## Historical signed-in checks without media — deployed `902c8f8`

Development authorized live creation of `qa_reals_a`, `qa_reals_b` and `qa_reals_c`. Passwords/tokens stay only on the verification machine in a 0700 directory/0600 file, never in this repository or shared records. The bootstrap passed **19/19** live assertions at 23:09:44 UTC, before v4 deployment was confirmed. After Development confirmed `902c8f8`, the complete no-media matrix passed **86/86** at 23:19:42 UTC and the added v4 matrix passed **39/39** at 23:19:46 UTC on November 15. Those are 125 current-head signed-in assertions plus the earlier 19 bootstrap assertions, separate from the 19 unauthenticated boundary assertions above. No app, phone or video was involved.

- All three development signups returned signed sessions bound to distinct users; pre-onboarding sessions required profiles, onboarding succeeded, and subsequent sessions returned the correct public profile.
- A current open round existed, so no seed was needed. All three Today states had no receipt/original and stayed locked. Feeds were exactly empty with null cursors before and after friendship; Today exposed only eligible public friend presence with `hasPublished: false`.
- A requested B, both pending directions matched, B accepted, and both saw approved friendship. C could not accept their request, A could not accept its own outgoing request, and B could not cancel an incoming request. Removal cleared both sides; friendship was restored at the end and C stayed unrelated.
- Missing original/reply IDs yielded generic `NOT_FOUND` for detail/reply lists, captions and video/thumbnail grants for all three accounts. These were deliberately nonexistent IDs, **not inaccessible published content**, so they do not prove the reply intersection, hidden counts or live grant revocation.
- Refresh rotated tokens for the same user and the refreshed JWT read the correct profile. Sign-out made authentication false, the previously valid JWT lost application access, refresh returned `noSession`, and password sign-in restored the same user for each account.
- For You returned exactly an empty page/null cursor without a receipt, including oversized pagination with an unknown cursor. Missing originals/replies denied like toggles and comment reads/creation. A well-formed, table-valid but nonexistent battle ID denied reads and votes on both sides with `NOT_FOUND`, not argument validation. All three accounts stayed locked after these denied interactions. No likes/comments/votes/battles were created.

The first attempt used access JWTs that had expired while the harness was prepared; the gateway correctly returned 401. Refreshing the fixture sessions fixed that setup issue. Three social-denial checks initially rejected the actual public source-path wrapper; after correcting the exact expected path, the entire 86-assertion pass was rerun successfully. The shared strict validator now also accepts the reviewed real `NOT_FOUND` request-ID/stack envelopes, including the nested media-action frame, while rejecting added diagnostics or unknown paths. No backend defect was observed in these checks.

At this earlier checkpoint, published receipt/unlock, visibility/counts, media and v4 success paths were still unexecuted; the later `807e034` matrix above supplies only its explicitly named coverage. These earlier missing-ID denials themselves do not prove existing private-content authorization. Real Apple OAuth, production developer-session rejection and live account deletion remain separate unexecuted lanes.

## Local and historical results

At current `807e034`, the source owner reports strict Convex analysis/codegen, TypeScript, 101 API tests and 31 actual-media integrations with no external verification fetch. This thread did not rerun those local suites. Earlier v3 `a48095d` owner/reviewer results (75 backend /3 HTTP-FFmpeg /61 worker and 50 targeted tests) remain historical. Current independent evidence here is the explicitly scoped live matrix above.

This thread previously executed backend `fbb0033da8108b2e9b4b51d77eb01bb19b3548fb`: typecheck +43 tests and 3 actual authenticated HTTP-worker/FFmpeg integrations, Node 24.22.3 / FFmpeg 6.1.1. Worker 61 passed at `468c817` and its tree was unchanged at `fbb0033`. These older identity-based snapshots do not establish current Convex Auth or v4 correctness.

Current tooling: **26/26** local tests, with 12 boundary/denial-envelope regressions added since the earlier 14-test checkpoint; the fake transport checks tooling only. The existing 25-assertion mock privacy transport and 189 historical DTO mutations are not hosted product results. CI runs tooling without secrets; its backend job runs when source is present, including the merged base, and otherwise explicitly skips. That checkout may differ from deployed `807e034`. Current-push CI/review is recorded in the PR, not assumed from earlier green runs.

## Cloud-iPhone evidence and next pass

The existing QA iPhone 16, `machine_01M7GH513G4W7SCZWF4QPRXEZZ`, is asleep. At visual source `566d250` this thread installed and captured, in order: Casey locked pineapple with all three options; round shutter/15-second timer; revealed originals feed; Casey seeing Blair's reply on Alex (1 visible); Dana seeing zero replies; the exact Elon Musk second question relocking Dana. Native owner reports 22 unit +1 UI tests at that build; this thread did not independently reread its full XCTest log.

These six screenshots and their build manifest remain historical. Native replies were tall cards requiring scroll, unlike the then-reference's compact reply row. The new eight-screen mock replaces that design again, including Reals branding, no tab bar, public/social screens and full-screen replies. No new mock screenshot or visual approval is claimed.

An earlier `1005036` / build `01M7GGW83TZ9P83QH3V1W10F0K` session covered explicit sample consent/preview, Casey reply publication and Dana simulated failure/save/locked/reopen/retry. All video evidence is fictional illustrated samples/synthetic tones, not physical recording. Network stayed available; no network-denied, independently audible or continuous recording result exists.

## Remaining gates

- Receive the succeeded mock build from Development, compare all eight screens mock-left/app-right, list every difference and rerun the old Demo privacy/round checks; release the phone afterward.
- Obtain actual AVAssetExportSession-produced MP4/camera bytes and the matching native artifact for exact client-export/upload/playback compatibility. The synthetic bundled clip does not establish that provenance.
- Extend the original CLI's strict positive-content schemas to actual v4 serializers without weakening privacy assertions. Separately test live block/delete/account cascades, concurrency, overlong/oversized variants, legacy thumbnails and next-round relock; preserve the retained QA content unless cleanup is authorized. No verifier hosting is needed.
- Real Apple OAuth/relay, live account deletion, production rejection of developer identities, signed-device remote APNs and physical capture/audio/permissions/lifecycle remain separate lanes. Development-password session refresh/sign-out were verified above.
- Review deployment ingress/cache/log/retention/load policy. No merge or auto-merge is authorized.
