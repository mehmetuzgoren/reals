# Reals privacy and product invariants

These are acceptance requirements, not claims that every lane has passed. The live backend is currently v3; the requested public/social extension is v4 and still needs its owner-published shapes and implementation evidence. See the [acceptance matrix](../verification/acceptance.md).

## Identity and publication

Convex Auth owns identity and session revocation. Every operation derives its viewer server-side, never from a client user ID. Production uses Apple browser OAuth; username/password identities and their existing sessions are allowed only in exact development mode. Demo services/storage never impersonate production.

Only trusted finalization of a valid original creates that viewer's exact-round receipt. Selection, preview, upload progress, processing, failure, cancellation and a reply do not unlock content. The server owns global round selection and zoned windows; notification arrival/device dates do not select rounds. Previous posting closes only when a successor actually opens.

One original per viewer/round, immutable position/media and owner/request idempotency must survive retries and concurrency. Deleting an original removes its conversation/media but preserves its receipt and one-original limit. Account deletion is separate: it tombstones the app identity, revokes all sessions and clears its app data. It needs a fresh same-account sign-in within five minutes; refresh does not reset that clock. Never claim deletion of the person's upstream Apple account.

## Friends audience

A locked Today response may include prompt/options, the viewer's own state, minimal approved-friend profiles and safe publication flags. It must not include friends' positions, thumbnails, captions, replies, media URLs or storage IDs behind a blur. Pending requests grant nothing.

An original's non-owner needs a live authenticated identity, a receipt for the same current round, an approved/unblocked friendship with its author and no block either way. The parent check comes first for a reply. Both conversation authors must remain approved/unblocked friends; an eligible third viewer also needs approved/unblocked relationships with both.

| Posted viewer | Alex's friends-only original | Blair's reply on Alex |
| --- | --- | --- |
| Casey, friends with Alex and Blair | Visible | Visible |
| Dana, friends only with Alex | Visible | Hidden, including count/caption/thumbnail/media |
| Friend of Blair only | Hidden | Hidden |

Return viewer-filtered replies and counts. Known-ID queries, captions, grants, bytes and interactions must apply the same policy. Generic not-found denials must not distinguish inaccessible objects from missing ones. Own management rights must not unlock a now-hidden parent. Main feeds contain originals only; video replies stay flat under their original.

## Accepted v4 public and social rules

“Share to For You” is off by default. An original's audience is immutable `friends` or `public`. Replies cannot choose an audience; they inherit the parent. Public does **not** mean logged-out: viewers still need the same-round receipt and no block with the author of each visible original/reply/comment/battle side.

For You returns public originals only, newest first, excluding the viewer's own content and blocks. Friends-only content must never enter For You, a battle, direct-ID public access or public media grants. Comments on friends-only content use the author/commenter relationship intersection, so their visible counts cannot reveal hidden comments. Public comments still exclude blocks.

One like per viewer/item is transactional; no liker-list endpoint is requested. Comments are trimmed plain text, 1–300 characters, rate-limited and deletable by commenter or content author. Report/block rules apply to comments too. Battles pair eligible unpaired public originals with different authors/options; viewers must see both sides. Authors cannot vote, a viewer has one changeable vote, and deleting either side deletes the battle/votes. Content/account deletion also cascades likes/comments/votes as applicable.

These are v4 gates, not results from the older v3 tests or demo images. Exact functions/DTOs are adopted only after the backend owner publishes them.

## Media and revocation

Uploads are owner-private intents bound to actual authenticated bytes. Clients cannot attach storage IDs, replace bound bytes or submit trusted verification metadata. Missing/failed verification stays closed. V4 requires 3–15 seconds; the current deployed v3 enforces a positive duration ≤15 seconds. Application video remains ≤8 MiB.

Playback uses opaque ≤60-second grants; serve bytes through the authorized HTTP handler, never permanent storage redirects. Recheck the bound viewer's current access on every GET/HEAD/Range, including new-round locks, remove/block, account disabling/deletion and expiry. Use private/no-store, correct content type/length and byte ranges. The current generic HTTP denial is exactly `{ failure: { code: "NOT_FOUND", message: "Not found", retryable: false } }`; extra hidden fields are not acceptable.

Already delivered bytes cannot be recalled. Clients must stop/release players, cancel outstanding work and clear private thumbnails/captions/subscriptions/drafts when identity or access changes. A screenshot cannot prove this lifecycle. Avatars are normalized minimal profile assets, not private-video resolvers.

## Auth handoff and remaining limits

The app's random relay nonce must match before any redemption; Convex's separate saved OAuth state is used for redemption. Reject missing, repeated, mismatched, expired or replayed handoffs. The HTTPS relay has one fixed custom-scheme destination, strict nonce/code shapes and no-store/no-referrer; it logs no codes and accepts no redirect URL from a caller.

APNs tokens/preferences are private. Current remote delivery is unavailable, not a mocked success; eventual workers must recheck live authorization/preferences and send no opinions, captions or private author data. Captions may be unavailable, never fabricated. Payments, subscriptions, public profile pages and rankings remain out of scope. Real Apple OAuth, hosted verified media, signed-device push and physical capture remain separate unexecuted lanes.
