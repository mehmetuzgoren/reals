# Independent acceptance matrix

Use a dedicated staging deployment for destructive server cases and isolated Demo Mode for fictional UI cases. Every executed row needs a source SHA/build/session or command result; unchecked rows remain unverified. `probe` means `take-probe.mjs` against real services, not its mocked transport tests.

| ID | Scenario and required result | Evidence lane |
| --- | --- | --- |
| A01 | Fresh offline launch without URLs/plist/account enters explicit Demo Mode; fixtures/services/storage are isolated. Unconfigured production fails closed. | Native test + cloud UI + source/config review |
| A02 | Pineapple prompt/options, then Elon prompt/options, match the brief; global server round/DST window is authoritative; previous posting closes only on actual next opening. | Cloud UI + backend scheduler tests |
| A03 | Locked Today exposes only minimal approved-friend profiles/safe posted flags, never position/thumbnail/caption/reply/media/storage metadata. | Probe + DTO/source review |
| A04 | Locked feed, known original/reply IDs, captions, thumbnails, and video grants are denied. Another round's receipt does not help. | Probe + backend tests |
| A05 | Position selection → actual capture or explicit ≤15-second simulator fixture → preview/retake → publish → reveal; cancellation/denials recover. | Cloud UI; actual capture requires hardware |
| A06 | Draft/recording/uploading/processing/failed states never create a receipt or unlock. Missing/failed verifier and malformed/>15-second/unauthorized bytes fail closed. | Backend tests + live verifier + native failure UI |
| A07 | One original per round survives concurrent finalization, retries, replaced/replayed upload bytes and repeated request IDs. A reply cannot create a receipt. | Backend tests + independent integration review |
| A08 | Main feed contains originals only; scrolling/navigation preserve state; detail has flat chronological eligible replies and a working record/publish-reply flow. | Probe + cloud UI |
| A09 | Posted Casey sees Alex's original and Blair's reply. Posted Dana sees Alex only; no hidden reply count/name/ID/caption/thumbnail/video leak by known ID. | Probe + cloud UI |
| A10 | A Blair-only friend cannot access Alex's parent or reply. Pending requests grant nothing; only recipient can accept; search exposes minimal profiles. | Backend tests + direct endpoint checks |
| A11 | Remove/block in either direction immediately denies new reads/interactions and previously issued grant requests. Hidden reply audiences never enter push payloads. | Backend tests + live HTTP + notification review |
| A12 | Video/thumbnail delivery supports HEAD and Range/206, no redirects/raw storage URLs, private no-store, opaque ≤60-second grants; expiry denies later requests. | Probe + expiry/revocation live test |
| A13 | Delete original removes conversation/media but preserves receipt/unlock/one-original limit. Reply authors can delete without gaining hidden-parent access. Account deletion clears social/content/device state and handles Firebase cleanup honestly. | Backend tests + live integration/native UI |
| A14 | New round relocks the feed, old friends' content cannot be browsed, own history remains in Profile. | Cloud UI + backend tests |
| A15 | One active player; pause/release on navigation/background; no eager media downloads; identity/round/remove/block changes clear relevant subscriptions/private caches/drafts. | Native tests + source review + cloud lifecycle checks |
| A16 | Server opens before daily push; generic daily/direct-reply notifications honor current authorization/preferences; tap re-fetches; invalid tokens retire. | Backend sender tests + real signed-device FCM/APNs |
| A17 | Firebase nonce/Apple flow and refreshed ID token authenticate Convex with correct issuer/audience; missing/wrong/expired tokens and client impersonation fail. | Source review + real provider/deployment |
| A18 | Camera/mic denial, capture interruption/background/audio changes, upload retry, local-draft cleanup and playback failure are recoverable; portrait/audio/15-second cutoff are real. | Native tests + cloud injectable cases + physical capture |
| A19 | Three tabs, request lifecycle/remove/block, editable profile/avatar/preferences/sign-out/delete/report affordances work; Dynamic Type/VoiceOver/Reduce Motion are checked explicitly. | Cloud UI + native tests + accessibility session |
| A20 | No subscriptions/payment UI, public discovery/followers/circles/codes/live debates/rankings/predictions/guessing gate/AI scoring. Captions may be unavailable, never fabricated. | Source/product walkthrough |

## Evidence record

Record native SHA, backend SHA, docs SHA, base SHA, commands, test counts, build/test IDs, artifact reference, phone model/runtime/session, scenario IDs, screenshots/videos, observed failures, unresolved items, and external/hardware limits. Do not include secrets, real profile/media data, token values, or grant URLs. A screenshot cannot establish direct-ID denial or network independence; a server test cannot establish native playback or camera behavior.
