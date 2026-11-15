# Independent integration probe

`take-probe.mjs` is a dependency-free Node 24 client for the **real deployed** Convex HTTP Functions API and private media route. It does not implement the app's authorization policy, substitute demo identities, upload media, or seed a database. It creates short-lived playback grant records and reads bounded media ranges; otherwise it does not mutate fixture state.

## Fixture prerequisites

Use a dedicated non-production deployment with the actual backend source. Through its trusted internal seed/setup lane, create:

- Alex's published original and Blair's single published reply in the current round, with valid playable private MP4 bytes.
- Approved Alex↔Blair, Alex↔Casey, Blair↔Casey, and Alex↔Dana relationships; no Blair↔Dana relationship or blocks.
- Successful current-round originals/receipts for Casey and Dana.
- A separate locked profile with no current-round receipt, approved friendship with Alex, and no original. This identity must be valid, not unauthenticated.

Obtain fresh **Firebase ID tokens** for Casey, Dana, and the locked account from the same configured Firebase project, using the normal trusted sign-in lane. Set `TAKE_CASEY_ID_TOKEN`, `TAKE_DANA_ID_TOKEN`, and `TAKE_LOCKED_ID_TOKEN` securely in the process environment. Do not put them in shell history, a checked-in file, an issue, or a probe command argument. Deployment keys and Apple tokens are not user ID tokens.

Create an untracked manifest outside the repo, for example `~/.capy/work/take-staging/probe.json`, containing exactly:

```json
{
  "convexUrl": "https://YOUR-DEPLOYMENT.convex.cloud",
  "siteUrl": "https://YOUR-DEPLOYMENT.convex.site",
  "roundId": "OPAQUE_CURRENT_ROUND_ID",
  "originalId": "OPAQUE_ALEX_ORIGINAL_ID",
  "replyId": "OPAQUE_BLAIR_REPLY_ID"
}
```

The manifest has identifiers only, no secrets; still keep real fixture metadata private. Configure both origins explicitly. The runner requires HTTPS origins without credentials, paths, queries, or fragments and never follows redirects. It sends user tokens only to the configured Functions API. Playback requests go only to the configured site origin returned in an authorized grant.

```sh
node verification/take-probe.mjs ~/.capy/work/take-staging/probe.json
```

The runner exits nonzero on any failed assertion or missing configuration and never silently skips to mocks. Logs contain static scenario IDs and PASS/FAIL only, not response bodies, tokens, IDs, grant URLs, captions, or names. Keep backend logging equally strict. A failing denied check can mean wrong fixture/configuration; inspect privately rather than exposing raw HTTP data in CI logs.

## What it checks

Casey/Dana same-round receipts, originals-only feed across pagination, viewer-filtered detail counts and flat replies, authorized original playback, Casey reply caption/video, Dana known-ID reply caption/video/thumbnail denial, locked safe Today/feed and known-ID content/media denials. Media checks require HEAD, exact single-byte Range/206, MP4, a 20 MiB cap, no redirect, private/no-store, and corrupt-token denial. It rejects grants longer than 60 seconds **plus a 2-second client/server clock allowance**; use server-time/source checks for the strict server-side ≤60-second limit.

The accepted response shapes come from the integration contract plus wire addendum v1. Exact backend error/HTTP behavior must be reconciled at the delivered head. The runner recursively validates locked Round/options and minimal profiles, rejects unexpected response-envelope fields and nonempty client-visible `logLines`, and requires a structured `NOT_FOUND` denial with only `code`, `message`, and `retryable`. Allowed denial text is the generic `Not found`, `Content unavailable`, or `Unavailable`, not hidden object details. Framework error text may only repeat that generic failure; adapt any framework wrapper only after examining the actual delivered envelope. Media error bodies must likewise be empty or generic. Network failures, missing functions, malformed JSON, and invalid-argument errors never count as successful security denial. This intentionally strict no-log/no-detail staging policy can flag harmless diagnostics for review; it never silently allows arbitrary error/log text.

## What it does not prove

This is not the full acceptance gate. It does not test expiry by waiting, remove/block/deletion revocation of an already-issued URL, physical capture, real verifier processing, pending requests, concurrent publication, failure/new-round transitions, native cache/player lifecycle, Apple authentication itself, or remote APNs delivery. Use [the acceptance matrix](acceptance.md) and [test lanes](../docs/testing.md) for those checks. It exercises negative thumbnail authorization but needs a separately seeded real thumbnail for positive thumbnail delivery evidence.

Unit tests inject a fake transport solely to prove the probe catches leaks/protocol failures and does not misclassify network errors. They are never reported as backend, JWT, media, or UI test results. Run:

```sh
node --test verification/*.test.mjs
node verification/check-docs.mjs
```

The link check validates local file destinations, not external URLs or Markdown fragment anchors. The CI workflow runs only these tooling checks and needs no secrets or service access. Keep real staging probes out of public PR CI until their fixture/credential lane is secured.
