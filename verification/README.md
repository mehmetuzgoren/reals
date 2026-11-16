# Independent Takes probes

For live sample accounts and repeatable per-round posts, see [sample seeding](seeding.md). Unlike the read-only probes below, that script deliberately creates development content through the real app API.

Both Node 24 runners use real HTTPS endpoints, refuse redirects and log static scenario IDs plus PASS/FAIL only. They never log credentials, IDs, response bodies, grants, private metadata or fixture names. Fake transports in unit tests verify the tools, not the product.

## Live bootstrap boundary probe

```sh
node verification/deployment-probe.mjs verification/deployment.example.json
```

The checked-in example names the public `first-mandrill-982` cloud and site origins only. To target another deployment, use a two-field manifest outside git:

```json
{
  "convexUrl": "https://YOUR-DEPLOYMENT.convex.cloud",
  "siteUrl": "https://YOUR-DEPLOYMENT.convex.site"
}
```

This mode needs no credential, creates no account/fixture and checks 19 deployed boundaries: unauthenticated auth/content/device guards; Apple unavailable with the **known bootstrap placeholders**; strict fixed relay; POST Apple callback route; invalid media GET/HEAD denial. It never redeems a real callback. Once real Apple configuration exists, the unavailable-Apple expectation is no longer the appropriate lane: run real provider acceptance separately.

This is not signed-in or valid-media acceptance. A missing route, malformed envelope, unexpected success, open redirect, cacheable relay/denial or transport error fails. The callback is POST: empty POST gives 400; GET may correctly give 404. The root page is not a health endpoint.

## Authenticated privacy/media probe

`take-probe.mjs` checks the Functions API/media route with strict v3 positive-content shapes. It creates short-lived grant records and reads bounded bytes but does not seed users/content or upload media. Its original 25-case fixture run remains **unexecuted**: reconcile its schemas against actual v4 serializers first. Backend `807e034` now checks media inside Convex; there is no missing external verifier requirement. Separate three-account live publication/private/v4 results are recorded in [status](../docs/verification-status.md), not reported as this CLI run.

Use a dedicated non-production deployment and create through trusted setup:

- Alex's valid published original and Blair's single published reply in the current round.
- Approved Alex↔Blair, Alex↔Casey, Blair↔Casey and Alex↔Dana friendships, with no Blair↔Dana edge or blocks.
- Published current-round originals/receipts for Casey and Dana.
- A locked profile, approved friend of Alex, with no current-round receipt.

Get fresh **Convex Auth access tokens** through the normal sign-in lane, not a deploy key, Apple token, user ID or demo identity. Set `REALS_CASEY_ACCESS_TOKEN`, `REALS_DANA_ACCESS_TOKEN` and `REALS_LOCKED_ACCESS_TOKEN` securely in the runner's environment. They must be distinct and unexpired; default access-token life is only 60 seconds. This runner does not renew sessions. A token expiring during a run makes it fail, never a successful access denial. Never put tokens in arguments, git, shell history, an issue or logs.

Keep the identifier manifest outside the repository, for example `~/.capy/work/reals-staging/probe.json`:

```json
{
  "convexUrl": "https://YOUR-DEPLOYMENT.convex.cloud",
  "siteUrl": "https://YOUR-DEPLOYMENT.convex.site",
  "roundId": "OPAQUE_CURRENT_ROUND_ID",
  "originalId": "OPAQUE_ALEX_ORIGINAL_ID",
  "replyId": "OPAQUE_BLAIR_REPLY_ID"
}
```

```sh
node verification/take-probe.mjs ~/.capy/work/reals-staging/probe.json
```

Both modes require distinct explicit HTTPS origins without credentials/path/query/fragment. The bearer is sent only to the configured Functions origin; private grant requests must use the configured HTTP origin. Never follow a redirect to raw storage.

The authenticated mode checks **25 assertions**: Casey/Dana exact-round receipts, originals-only pagination, visible-only detail/replies, authorized original video, Casey reply caption/video, Dana known-ID caption/video/thumbnail denials, and locked Today/feed/direct-ID/media denials. Valid media requires HEAD, exact one-byte Range/206, MP4, ≤8 MiB, private/no-store, no redirect and corrupt-token denial. Grant expiry allows a two-second client/server clock margin around the server's ≤60-second limit.

Every consumed v3 DTO is recursively validated before projection. Unknown/missing/wrong-type fields, response logs, unsafe denial text and wrong error codes fail. Generic HTTP media failures accept only empty/generic text or the exact actual JSON `{ failure: { code: "NOT_FOUND", message: "Not found", retryable: false } }` shape with an allowlisted generic message. Extra fields or a revealing message fail. Network/missing-function/invalid-argument failures cannot count as authorization denial.

V4's [deployed shapes](../docs/wire-v4.md) add audience, For You, likes, comments and battles. This runner's positive-content schemas remain strict v3: additive fields fail for review rather than silently admitting unexamined metadata. Its unchanged Today/empty-feed/denial checks ran at `902c8f8`; a separate exact-v4 QA harness exercised real published content at `807e034`. Keep friends-only fixture invariants and extend this CLI's positive-content validation before its complete fixture run. New content's `thumbnailAssetId` is null; positive legacy-thumbnail delivery needs an actual legacy fixture.

## Limits and local tooling

Neither CLI creates publications or proves real Apple sign-in, physical recording/audio, concurrent publication, new-round transitions, native cache/player lifecycle, block/delete revocation or positive legacy-thumbnail delivery. Separate live QA results cover development session refresh/sign-out, publication, selected private/public access, friendship-removal revocation and explicitly recorded expiry checks; they are not blanket acceptance. APNs registration is not delivery.

```sh
node --test verification/*.test.mjs
node verification/check-docs.mjs
```

CI runs those secret-free checks, not the hosted probe. Its conditional backend job runs only when implementation source is present. See the [acceptance matrix](acceptance.md), [test lanes](../docs/testing.md) and [exact status](../docs/verification-status.md).
