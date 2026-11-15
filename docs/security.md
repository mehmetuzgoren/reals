# Product and privacy invariants

This is the integration acceptance policy, not a claim that an untested endpoint implements it. The [acceptance matrix](../verification/acceptance.md) identifies the evidence required from each layer.

## Round and publication

The server selects one global round; device dates and notification arrival do not change it. Posting ends only when the next round actually opens. Its question has prompt-specific option IDs, not a universal agree/disagree enum. Round 1 is **Do you like pineapple on pizza?** (Yes, No, Depends); round 2 is **Do you think Elon Musk is a genius? How is he successful?** (Yes, No, It's complicated). The second prompt and clips represent opinions, not an asserted biography or generated verdict.

Only trusted finalization of a valid original of at most 15,000 ms creates that user's successful receipt for that round. Selection, recording, placeholder creation, upload progress, processing, failure, cancellation, and a reply cannot unlock friends' content. Transactional uniqueness and owner/request idempotency must survive concurrent finalizations and retries.

Published position/media are immutable except deletion. Deleting an original removes access to its conversation/media but keeps the successful receipt and one-original limit; it neither relocks the author nor permits another original. Profile retains the user's own historical originals. Friends' old-round originals are not browseable in MVP. The main feed contains originals only; replies are flat, chronological children inside detail.

## One authorization policy, every surface

A locked client's Today response may contain the question/options, its own state, minimal approved-friend profiles, and safe `hasPublished` indicators. It must not contain friends' positions, thumbnails, transcripts, replies, storage IDs, or media URLs—even behind a blur. Search/request lists expose minimal profiles, not takes. Pending requests confer no media or content rights.

Owners can manage/view their originals. Another viewer needs a verified identity, a successful receipt for the **same current round**, approved current friendship with the original author, and no block in either direction. Apply the same rule to feed, known-ID detail, captions, thumbnail/video grants, and every subsequent media request.

A reply must first pass the parent-original check. Alex and Blair must remain approved/unblocked friends for Blair's reply on Alex's original to be viewable. A participant can view the exchange after that check; a third viewer additionally needs same-round publication and approved, unblocked friendships with **both** authors. A reply author may delete/manage their own upload without gaining access to someone else's now-hidden parent.

| Viewer after publication | Alex's original | Blair's reply on Alex |
| --- | --- | --- |
| Casey, friends with Alex and Blair | Visible | Visible |
| Dana, friends only with Alex | Visible | Hidden, including count/caption/thumbnail/media |
| A viewer friends only with Blair | Hidden | Hidden |
| A pending friend or unposted viewer | Hidden | Hidden |

Return viewer-filtered replies and counts. A successful `NOT_FOUND`-style denial must not reveal whether an inaccessible ID exists. No hidden author names, IDs, captions, push text, thumbnails, or media should be discoverable through another endpoint. Recheck active relationships for interactions, not only reads.

## Media expiry and revocation

The accepted design issues an opaque, high-entropy grant only after shared authorization. Bind its stored hash to the viewer, content, asset, and expiry; do not store/log plaintext tokens. A private HTTP route serves bytes itself and rechecks the viewer's current authorization on every GET/HEAD/Range request. Never redirect to a permanent raw Convex storage URL. Thumbnail access follows the same rules. Send `Cache-Control: private, no-store`, correct lengths/content types, and valid byte ranges for AVPlayer.

The grant's lifetime is at most **60 seconds**. Its URL is a temporary bearer capability usable by the player; binding the record to a viewer is not magic protection against forwarding already-issued bytes/URLs. The handler must resolve that bound viewer and check their **current** access on every request. Removal, a block, deletion, account disabling, or a new-round lock denies subsequent requests immediately even before nominal expiry. Expiration denies all later use regardless of access.

Already delivered bytes cannot be recalled, and an in-flight stream may have passed its authorization check before revocation. The client must cancel outstanding loads/subscriptions, pause/release the player, and clear relevant private thumbnail/caption/media state when identity, friendship, block state, round, or account changes. Revoke new server access immediately; do not promise retroactive deletion of a screen recording or downloaded bytes. Limit players to one active instance, pause on detail dismissal/navigation/background, and avoid eager downloads for all feed cells.

## Upload and account boundaries

Upload staging is owner-private and bound by a server-created intent. A caller cannot attach someone else's storage ID, replace validated bytes, spoof metadata, or finalize a different owner's intent. Inspect actual byte content; missing validation stays closed. Cleanup abandoned, canceled, failed, replaced, and deleted media without dropping successful receipts prematurely.

Demo identities, success simulation, fixtures, and round controls exist only in isolated demo services/storage. Production uses Firebase-verified identity and rejects missing configuration. Do not expose a public seed, arbitrary table reader, media-ID resolver, internal verifier result injection, or debug impersonation endpoint.

Account deletion must deny application access promptly, remove content/conversations/social edges/tokens, schedule media cleanup, and complete Firebase identity deletion/revocation. Record an honest pending/failed state if external cleanup fails. Preserve only data the documented deletion policy requires; an original's receipt-preserving behavior is not a license to keep a deleted account indefinitely.

## Assumptions to verify

Removal of the Alex↔Blair relationship hides their exchange from normal playback for everyone, while retaining author management rights. There is no friend-history browsing, public discovery, contact upload, mandatory guessing, opinion scoring, payments, or subscription UI. Captions may be unavailable; never fabricate a transcript. Report/block/delete affordances must use the same visibility boundary as the content itself.
