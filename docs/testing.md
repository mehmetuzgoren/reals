# Verification lanes

Tests are evidence for the layer they actually exercised. A syntax check is not an iOS build; a simulator fixture is not a camera recording; a mocked FCM sender is not APNs delivery. Record exact source SHAs, commands, build IDs, and device/session identifiers for every result. [Current evidence](verification-status.md) must stay honest.

## Repository and backend

Run `node --test verification/*.test.mjs` and `node verification/check-docs.mjs` for the independent probe/documentation tooling. The workflow runs these without secrets. Do not label that job product acceptance.

After receiving the backend PR, inspect its package scripts and run its lockfile install, typecheck, and tests at the exact head. Independently review public DTOs against native decoders and exercise reads/media through [the deployed probe](../verification/README.md) when a real staging deployment and Firebase tokens are available. Backend unit tests with seeded identities do not establish real JWT, HTTP delivery, FCM, or verifier connectivity.

For combined unmerged integration, keep the docs PR free of other owners' code. Use a disposable worktree/scratch checkout, apply the native/backend trees at their supplied heads, and record both full SHAs plus docs SHA. Do not mistake the working tree's base SHA for the pair under test. Route defects with file/line, expected/actual behavior, and reproduction to the Captain; do not patch another owner's directories.

## Native build and XCTest

The accepted project/scheme/output below are pending confirmation from the native implementation. On a Mac or Revyl's native macOS build runner, from `ios/`:

```sh
xcodebuild -resolvePackageDependencies -project TAKE.xcodeproj -scheme TAKE
xcodebuild -project TAKE.xcodeproj -scheme TAKE -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

Expected output is `build/Build/Products/Debug-iphonesimulator/TAKE.app`. Native owns its actual Revyl build and XCTest. Resolve an available iOS 18.5 simulator **by its actual UUID** before using `xcodebuild test`; do not guess a device name or report generic-destination `build` as tests. Retain the result bundle/log/build ID and package-resolution evidence.

The unsigned build omits Apple signing verification. No Xcode or simulator toolchain is installed on the Linux workspace; `swiftc -parse` where available still cannot typecheck SwiftUI/AVFoundation app code for iOS.

## One final Revyl cloud-iPhone session

Use the built-in mobile/phone lane, not a Revyl MCP or plugin. Read the cloud-phones and computer-use instructions before controlling it. Attach an iOS 18.5 cloud iPhone and install the native owner's **already succeeded artifact**. Do not spend another build or session merely to restate its claim.

Before installing, record native/backend/docs heads, build ID, artifact path or managed-build reference, bundle ID, runtime, and model. Start clean demo data and keep all evidence fictional/public-safe. A phone session is bounded; finish the acceptance loop and sleep/remove the phone when done.

1. Launch without production config. Confirm Demo Mode is accessible without login/network and all three tabs work. Save a screenshot of the locked prompt, safe friend indicators, option labels, and explicit demo state.
2. Pick a position, open record, and use the explicitly labeled simulator fixture if capture hardware is unavailable. Confirm the 15-second rule, preview/retake, visibility copy, publication state/progress, and reveal. Never call that fixture live recorded video.
3. Confirm the main feed contains originals only. Play one original, navigate to its detail and chronological flat replies, then publish a video reply. Confirm return navigation keeps sensible feed position and no other cell keeps playing.
4. Switch to posted Casey and then Dana. Casey must see Blair's reply on Alex; Dana must see Alex but not Blair's reply or its count. This UI observation complements, not replaces, direct-ID/media server probes.
5. Release round 2. Confirm the exact Elon Musk question/options and the feed re-lock. Previous-round receipts must not unlock it. Confirm own history remains in Profile and friends' old rounds cannot be browsed.
6. Exercise denied camera/microphone, failed upload/processing, retry, background/interruption, playback failure, friendship removal/block, and identity reset where real UI controls support them. Note what is not injectable instead of claiming it was tested.
7. Check large text, accessible names/positions not conveyed only by color, Reduce Motion, safe areas, and player pause on navigation/background where the cloud runtime exposes those settings. VoiceOver must be a separate explicit check, not inferred from readable screenshots.

Save screenshots and supported screen recordings under the crew's `renders/REAL-7/`, with a manifest tying each to its step/build/session. Publish only final public-safe UI evidence to a PR. A screenshot demonstrates a state, not sound, network independence, correct backend authorization, or continuous player lifecycle. Cloud-phone recording support must be checked in the actual tool; do not promise a video from a screenshot-only lane.

## Real staging and hardware gates

Run all [acceptance scenarios](../verification/acceptance.md), not just the happy path. Use a dedicated non-production deployment and actual Firebase identities. Cover valid/invalid token claims; actual verifier inspection and >15-second/malformed media rejection; owner-private staging; locked and Casey/Dana direct-ID/caption/thumbnail/video denials; stale-grant expiry and removal/block/deletion; concurrent/idempotent publication; receipt-preserving deletion; next-round scheduling; and generic, preference-aware notification targets.

On an actual signed iPhone, verify portrait front-camera + microphone recording, early stop and automatic 15-second cutoff, sound in preview/playback, orientation/interruption/audio-session changes, export/upload of actual capture bytes, permission denial/recovery, and file cleanup. Simulator fixtures do not satisfy these rows. No physical iPhone was connected at bootstrap.

With Apple/Firebase/FCM credentials configured, verify real Apple sign-in, reauthentication/account deletion, foreground/background/cold-start remote APNs delivery, notification preferences/denial/token rotation, invalid-token retirement, and authorization re-fetch for a stale deep link. Provider documentation and mocked sends do not satisfy these rows.

## Review and release

Automatic PR review is off. Obtain a separate read-only reviewer for this documentation/probe PR and record their reviewed head and findings/disposition. Cross-layer integration review must use actual native/backend heads; a contract-only review cannot pass it. CI green plus a clean read-only review is not the full behavior gate. Do not call the product ready while app installation/walkthrough or required privacy behavior is untested. Never merge without explicit authorization.
