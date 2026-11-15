# TAKE for iPhone

Native SwiftUI, iOS 18+, AVFoundation/AVKit, Convex Auth and application services. Open **TAKE.xcodeproj** and select the shared **TAKE** scheme. The project is checked in: no generator, CocoaPods, Node, or backend deployment is needed to build the offline app.

## Run offline

Build for an iPhone simulator, launch TAKE, and choose **Explore Demo Mode**. The demo never creates Convex clients or registers push tokens. Demo data persists separately under Application Support/TAKE/Demo and DemoDrafts. Live drafts use LiveDrafts and are bound to the authenticated viewer. Sign-out clears the current local draft, subscriptions and private playback. Reset Demo clears all demo samples, edits and drafts without touching live storage.

The starting identity is Casey, locked on the pineapple question. Choose Yes/No/Depends → Give your take → **Use simulator sample instead** → explicitly confirm the four-second fixture → preview with sound → publish. On hardware, enable the camera/microphone and make a genuine recording instead. Capture uses the front camera, portrait orientation, audio, early stop, automatic 15-second stop and H.264/AAC MP4 export.

Today and Profile expose **Developer-only Demo controls** only in Demo Mode. Switch to Dana, simulate a successful sample publication and open Alex's take: Blair's reply and hidden count are absent. Casey can see that reply after posting because Casey is friends with both people. Release the second question to relock viewers who have not posted for that exact round. Arm **Fail the next upload** before the normal flow to test failure, saved draft and retry without premature unlocking. Alex/Blair start with originals in both rounds; Dana → Casey and Blair → Dana are pending requests, not access grants.

The bundled videos are procedurally illustrated fictional portraits with synthetic tones, not actual camera footage or spoken testimony. Both the asset and UI say **LOCAL SAMPLE**. There are no invented captions, transcripts or remote media dependencies. See Resources/Samples.md. Fixture provenance is rejected by live publication, including when copied to a draft directory.

## Build and test

On macOS with Xcode and an iOS 18.5 simulator:

```sh
cd ios
bash scripts/build-simulator.sh
bash scripts/test-simulator.sh
```

Set `TAKE_TEST_DESTINATION='platform=iOS Simulator,id=<UDID>'` to select another installed device. The build output is `build/Build/Products/Debug-iphonesimulator/TAKE.app`; XCTest results go to `build/TAKE-tests.xcresult`. The test script includes unit/privacy/lifecycle tests and an XCUITest covering the explicit simulator fixture → preview → publish → reveal → new-round-lock loop. Tests launch with `--demo --reset-demo` and never contact production. A Revyl build uploads only `reals/ios` relative to this workspace root and runs these same scripts on remote macOS. The Linux machine is not an iOS compiler.

SPM pins ConvexMobile exactly **0.8.2**. No Firebase or payment SDK is linked.

The simulator scripts use ad-hoc Sign to Run Locally and simulator-only Keychain entitlements; they require no Apple account, certificate or provisioning profile. XCTest enables diagnostics containing only Keychain operation names and numeric OSStatus values, never credentials or account values. Physical-device signing remains separate.

## Configure live services

The unconfigured app keeps live sign-in unavailable and the complete demo accessible. Copy `Config/Public.example.xcconfig` to the ignored `Config/Public.local.xcconfig` and set `CONVEX_URL` and the distinct `CONVEX_SITE_URL`. Both must be HTTPS origins without a path, credentials, query or fragment; the example uses Xcode's `$()` expansion to avoid interpreting `//` as an xcconfig comment. Missing or placeholder values fail closed. Set an appropriate bundle identifier, Apple team and provisioning profile. Apple provider credentials belong only in the Convex deployment, never the app, git or logs.

Apple sign-in uses browser OAuth through `ASWebAuthenticationSession`, the configured site origin's fixed `/auth/ios` relay, and `take://auth/convex`. The app generates a random 43-character base64url relay nonce and verifies its return; this nonce is distinct from the OAuth state returned by Convex and used to redeem the code. Cancellation or invalid callbacks do not block the offline demo. See the services README for the exact wire protocol.

The separately labeled username/password developer screen launches only with `--development-auth`, without `--demo`, and stays outside normal and demo flows. The backend must enforce development-only sign-in and reject developer sessions outside the development environment; a launch argument is not an authorization boundary.

ProductionService implements the accepted named Convex APIs and DTO envelopes. Video/avatars upload raw bytes to the returned owner-authenticated site HTTP route, honoring the current 8 MiB video and 2 MiB avatar intent limits. Capture's ordinary H.264/AAC MP4 export trims to 14.9 seconds and caps at 8 MiB. Finalization/status must confirm publication before a receipt can unlock Today. Retries retain the request ID and upload ID. Private video and thumbnail grants must use the configured site `/v1/media/…?token=…` route and expire in at most 60 seconds; raw storage URLs and video redirects are rejected. Native playback downloads only the selected bounded clip into a protected active-only temporary file with an ephemeral no-cache session, then clears the player/file at the grant deadline even if AVPlayer's controls paused it. Playing again requests fresh access. No video is eagerly loaded for a locked viewer. Caption status is unavailable-safe.

Account deletion requires a fresh sign-in to the same account and a new session no more than five minutes old. If `REAUTH_REQUIRED` is returned, sign in again and retry deletion; refreshing a token does not count as reauthentication.

Notification permission follows an explanation and does not block posting. APNs registration defaults off, and neither Firebase nor a push entitlement is required for the current configuration. Device registration support is not a remote delivery provider; remote push delivery is unavailable.

## Boundaries and verification

SwiftUI screens are separate from shared DTOs, injected TakeService implementations, capture/audio and playback. Demo authorization checks query, direct content, caption and media paths, not only UI filtering. Production delegates content authorization, immutable publication, media inspection, account cleanup and scheduling to trusted Convex functions. Published originals cannot change position/media; deleting preserves the successful receipt.

The prior visual head `566d250` passed 22 unit tests and one UI test with zero failures in Revyl build `01M7GKCYFDRXT36B8TEGNYAXGK`; that build predates this authentication migration. The auth head has not yet been built. Hardware camera/microphone quality, Apple signing and live OAuth, deployed private media inspection, and remote delivery require separate verification. Whop is a future provider only; no payment UI exists.
