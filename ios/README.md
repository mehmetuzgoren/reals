# TAKE for iPhone

Native SwiftUI, iOS 18+, AVFoundation/AVKit, Firebase Apple authentication and FCM, Convex application services. Open **TAKE.xcodeproj** and select the shared **TAKE** scheme. The project is checked in: no generator, CocoaPods, Node, or backend deployment is needed to build the offline app.

## Run offline

Build for an iPhone simulator, launch TAKE, and choose **Explore Demo Mode**. The demo never creates Firebase/Convex clients or registers push tokens. Demo data persists separately under Application Support/TAKE/Demo and DemoDrafts. Live drafts use LiveDrafts and are bound to the authenticated viewer. Sign-out clears the current local draft, subscriptions and private playback. Reset Demo clears all demo samples, edits and drafts without touching live storage.

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

SPM pins ConvexMobile **0.8.2** and FirebaseAuth/FirebaseMessaging/FirebaseCore **13.2.0**. The committed Package.resolved captures transitive dependencies after resolution. Only the Auth/Messaging/Core products are linked; no Firestore, Cloud Functions, Firebase Storage, Whop or payment SDK is used.

## Configure live services

The unconfigured app intentionally keeps live sign-in unavailable and the complete demo accessible. Technical setup is not part of onboarding. Live construction is lazy and fails closed unless the public origins and a matching Firebase client plist are present.

1. Copy `Config/Public.example.xcconfig` to ignored `Config/Public.local.xcconfig`. Set `CONVEX_URL`, the distinct `CONVEX_SITE_URL`, and `FIREBASE_PROJECT_ID`. The example uses Xcode's `$()` expansion to avoid `//` being parsed as an xcconfig comment. Both origins must be HTTPS, root-only, and distinct.
2. Put your Firebase iOS client file at ignored `Config/GoogleService-Info.plist`. Its registered bundle identifier must match the app target. The build phase copies it only if present; stale built plists are removed when absent. `.capyignore` excludes local settings/client configuration from unconfigured cloud demo archives.
3. Set a real bundle identifier and Apple team in Xcode, enable Sign in with Apple and Push Notifications, and use matching provisioning profiles. The checked entitlement template uses `APNS_ENVIRONMENT=development` for Debug and `production` for Release. Configure the Apple provider in Firebase Auth and APNs credentials in Firebase Messaging. Keep private keys/service accounts off the app, git and build logs.
4. Deploy the matching backend and Firebase custom-JWT issuer/audience/JWKS configuration described in the root production guide. The native client sends refreshed **Firebase ID tokens**, never a chosen user ID or the Apple token, to Convex. Apple sign-in uses a secure nonce and state; returning Apple users reauthenticate. Profile creation is separate, transactional on the server, and does not depend on avatar success.

ProductionService implements the accepted named Convex APIs and DTO envelopes. Video/avatars upload raw bytes to the returned owner-authenticated site HTTP route, honoring the current 8 MiB video and 2 MiB avatar intent limits. Capture's ordinary H.264/AAC MP4 export trims to 14.9 seconds and caps at 8 MiB. Finalization/status must confirm publication before a receipt can unlock Today. Retries retain the request ID and upload ID. Private video and thumbnail grants must use the configured site `/v1/media/…?token=…` route and expire in at most 60 seconds; raw storage URLs and video redirects are rejected. Native playback downloads only the selected bounded clip into a protected active-only temporary file with an ephemeral no-cache session, then clears the player/file at the grant deadline even if AVPlayer's controls paused it. Playing again requests fresh access. No video is eagerly loaded for a locked viewer. Caption status is unavailable-safe.

Account deletion requires a Firebase authentication time within five minutes, not merely a freshly refreshed token. If the server requests reauthentication, sign out, sign in with Apple again, then return to Profile and retry deleting within five minutes. The app displays this route rather than treating an old identity token as recent authentication.

Notification permission follows an explanatory screen. FCM auto-init/swizzling are off in Info.plist. After a live authenticated session, the coordinator checks permission, routes APNs/FCM tokens to the device API, disables/unregisters on sign-out, and re-fetches authorized Today state on a generic notification tap. Denied permission does not block posting. Daily/reply preferences are independent. Simulator local behavior is not evidence of real remote delivery.

## Boundaries and verification

SwiftUI screens are separate from shared DTOs, injected TakeService implementations, capture/audio and playback. Demo authorization checks query, direct content, caption and media paths, not only UI filtering. Production delegates content authorization, immutable publication, media inspection, account cleanup and scheduling to trusted Convex functions. Published originals cannot change position/media; deleting preserves the successful receipt.

Unit tests cover offline/no-Firebase launch, locked data/direct media, exact prompts/options, failed-upload retry, same-round receipts, pending requests, Casey/Dana replies/counts/direct-media intersection, remove/block revocation, one-original/idempotency, deletion, originals-only feed, relocking, persistence and actual fixture audio/video tracks. Hardware camera/microphone quality, audio interruptions, orientation, Apple signing, a real Firebase→Convex token, deployed private media inspection, and FCM/APNs delivery require their corresponding external services/device; an unsigned simulator build cannot prove them. Whop is a future provider only; no payment UI exists.
