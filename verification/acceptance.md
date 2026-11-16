# Independent Takes acceptance matrix

These are required outcomes, not completed checkboxes. Use dedicated staging for destructive server cases and isolated Demo for fictional UI. Record source/build/command evidence for every executed row. “Boundary probe” means `deployment-probe.mjs`; “privacy probe” means the authenticated `take-probe.mjs`, not their fake transports. A separate three-account matrix at [deployed `807e034`](../docs/verification-status.md) now covers published private/public API scenarios; it does not clear every row or native/hardware acceptance.

| ID | Scenario and required result | Evidence lane |
| --- | --- | --- |
| A01 | Fresh unconfigured offline demo needs no account or secret; services/storage stay isolated; missing live configuration fails closed. Network-denied operation is checked separately. | Native test + cloud UI + network test |
| A02 | Mock demo defaults to hot-dog Yes/No; old pineapple/Elon rounds remain behind Demo controls; global zoned round/window is authoritative. | Mock side-by-side + scheduler tests |
| A03 | Locked Today exposes only safe prompt/own/minimal friend state, never others' positions/captions/replies/media/storage metadata. | Privacy probe + DTO review |
| A04 | Locked direct original/reply/caption/video/thumbnail access is denied; another round's receipt does not help. | Privacy probe + backend tests |
| A05 | Option → Record → 3–15-second capture or explicit fictional sample → preview/retake → Post → reveal. Shutter cannot stop before 3 seconds and auto-stops at 15. | Mock UI + actual hardware |
| A06 | Upload/processing/failure/cancel never create a receipt. Missing bytes, malformed/under-three/over-fifteen-second media and unauthorized intents fail closed under in-Convex structural checks. | Backend/media + hosted API + failure UI |
| A07 | One original per round survives concurrent finalization, retries, bound-byte replay and repeated request IDs; replies cannot create receipts. | Backend + live publication |
| A08 | Friends/For You lists contain originals only; full-screen replies stay flat, visible-only and navigable. | Privacy probe + cloud UI |
| A09 | Casey sees Blair's reply on Alex; Dana sees Alex but no Blair reply/count/name/caption/thumbnail/media, even by known ID. | Privacy probe + Demo controls |
| A10 | A Blair-only friend cannot access Alex's parent/reply; pending requests grant nothing; only recipient accepts; search exposes minimal profiles. | Backend + direct API |
| A11 | Remove/block either way immediately denies reads/interactions and existing grants; no hidden audience enters notification targets. | Backend + live HTTP |
| A12 | HEAD/Range/206, no storage redirects, private/no-store, ≤60-second opaque grants; later expiry/revocation denies bytes. | Privacy probe + timed/revocation HTTP |
| A13 | Original deletion removes conversation/media but preserves receipt/uniqueness; account deletion revokes sessions and cascades content/social/device state without deleting an Apple account. | Backend + native + hosted deletion |
| A14 | Next round relocks, prior receipts don't unlock it, own history remains reachable and friends' old-round content cannot be browsed. | Demo + backend |
| A15 | Players/subscriptions/private caches/drafts clear or stop on navigation/background/identity/round/social change; no eager full-feed downloads. | Native tests + lifecycle UI |
| A16 | APNs token/preferences are private and exact-shaped; sender stays unavailable until a real worker exists; eventual delivery honors current permission/access and refetches on tap. | Boundary probe + backend + signed-device worker |
| A17 | Convex Auth 2.0.0 browser flow checks relay nonce before redemption with separate saved OAuth state; production rejects developer identities; wrong/expired/revoked sessions fail. | Source + hosted real auth |
| A18 | Camera/mic denial, interruption, orientation/audio, upload retry, saved draft and cleanup recover without premature unlock; actual capture bytes satisfy verifier. | Native/cloud injectable + physical device |
| A19 | Eight mocked screens match strings/elements/order/alignment/colors with only the two explicit exceptions; Friends/Profile remain reachable without a tab bar. | Eight mock-left/app-right comparisons |
| A20 | No payments/subscriptions, ranking, liker lists, public profile pages or audience editing; no invented captions/transcripts. | Product/source walkthrough |
| A21 | V4: friends is default; public is explicit/immutable; replies inherit audience and cannot supply their own. | DTO/backend + Post UI |
| A22 | V4: For You includes only visible public originals, newest first, not self; same-round receipt and bidirectional blocks govern known IDs/grants too. | Backend + deployed public/privacy probe |
| A23 | V4: one transactional like; 1–300-character rate-limited comments; author/commenter deletion; viewer-filtered comment counts and report/block permissions. | Backend + comments/like UI |
| A24 | V4: battle pairing has different eligible authors/options; authors cannot vote; one changeable vote; zero-vote 50/50 and rounded percentages total 100. | Backend + Battle UI |
| A25 | V4: content/account deletion cascades likes/comments/votes/battles and surviving-side battle pointers; blocks hide both sides. | Backend + direct APIs |

## Evidence record

Record full native/backend/docs/base SHAs, commands/counts, build/version/test IDs, phone model/runtime/session, scenario IDs, comparisons/differences and outstanding lanes. Do not include secrets, real profile/media data, tokens or grant URLs. A screenshot is not direct-ID denial, audible playback or network-isolation proof; a server test is not native rendering.
