# Reals for iPhone

Native SwiftUI, iOS 18+, AVFoundation/AVKit, Convex Auth and application services. Open **TAKE.xcodeproj** and select the shared **TAKE** scheme. The project is checked in: no generator, CocoaPods, Node, or backend deployment is needed to build the offline app.

## Run offline

Launch the app and choose **Try the demo**. The default offline scenario opens on “Is a hot dog a sandwich?” with Yes and No choices. The visible product is **Reals**; internal project and scheme names remain TAKE. The eight-mock flow has no bottom tab bar: vote, record, post, browse My friends or For You, open a take or reply, and view a public battle. Demo startup never creates Convex clients or registers push tokens. Demo data and drafts are isolated from live storage; sign-out and reset do not erase live data.

Select an answer to open Record. On a simulator without a camera, long-press the shutter and explicitly consent to the labeled fictional four-second sample before previewing and posting it. On hardware, use the front camera and microphone for a genuine recording. The post step defaults **Share to For You** off. Only a confirmed publication unlocks the round; failed uploads keep a retry draft rather than granting a receipt.

The mock scenario seeds real local social records rather than decorative counts: Sam has 3 likes, 1 comment and 3 replies; Priya has 5 likes, 2 comments and no replies; public Jordan has 248 likes, 56 comments and 14 replies, with a battle against mira_k. Likes, comments and battle votes update demo data. Public and private visibility still follows the viewer's receipt and access rules.

Long-press the **Reals** title in demo to open the hidden lab and switch to the legacy rounds and privacy matrix. The legacy `--demo --reset-demo` route remains available for regression testing: Casey/Dana, the pineapple round, relationship changes, failed-upload recovery and subsequent-round relocking remain isolated from the mock scenario. Bundled clips are fictional samples with synthetic sound, not camera footage; explicit consent is required, and fixture provenance is rejected by live publication. See Resources/Samples.md.

## Build and test

On macOS with Xcode and an iOS 18.5 simulator:

```sh
cd ios
bash scripts/build-simulator.sh
bash scripts/test-simulator.sh
```

Set `TAKE_TEST_DESTINATION='platform=iOS Simulator,id=<UDID>'` to select another installed device. The build output is `build/Build/Products/Debug-iphonesimulator/TAKE.app`; XCTest results go to `build/TAKE-tests.xcresult`. The existing privacy/lifecycle suite and legacy UI regression remain unchanged. The new mock UI test route uses `--demo --mock-demo --reset-mock-demo`; feature cases are being added alongside the existing suite. Screenshot verification should inventory prompt, record, friends feed, take, reply, For You, public take and battle when those screens are visible. The new mocks and their tests are under source verification, not yet native-verified. A Revyl build uploads only `reals/ios` relative to this workspace root and runs these scripts on remote macOS; Linux is not an iOS compiler.

SPM pins ConvexMobile exactly **0.8.2**. No Firebase or payment SDK is linked.

The simulator scripts use ad-hoc Sign to Run Locally and simulator-only Keychain entitlements; they require no Apple account, certificate or provisioning profile. XCTest enables diagnostics containing only Keychain operation names and numeric OSStatus values, never credentials or account values. Physical-device signing remains separate.

## Run on your iPhone

A free Apple ID is enough. You need a Mac with the latest Xcode and an iPhone on iOS 18 or later.

1. Connect the iPhone with a cable, unlock it and tap **Trust** when it asks whether to trust this computer.
2. Turn on Developer Mode: **Settings → Privacy & Security → Developer Mode**, then restart the phone and confirm. The switch appears after the phone has been connected to Xcode once.
3. In Xcode, add your Apple ID under **Xcode → Settings → Accounts**. A free account appears as a *Personal Team*. Select it, choose **Manage Certificates…**, and add an **Apple Development** certificate if none is listed.
4. Find your team ID. It is the `OU` value printed by:
   ```sh
   security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
   ```
5. Copy `Config/Public.example.xcconfig` to `Config/Public.local.xcconfig` (git ignores it) and set a bundle identifier that is unique to you plus your team ID:
   ```
   PRODUCT_BUNDLE_IDENTIFIER = com.yourname.reals
   DEVELOPMENT_TEAM = ABCDE12345
   ```
   `com.take.app` is only the default. You don't need to change project settings; automatic signing creates the free provisioning profile.
6. Open **TAKE.xcodeproj**, pick the **TAKE** scheme and your iPhone as the run destination, and press **Run**.
7. The first launch is blocked until you trust yourself as the developer: open **Settings → General → VPN & Device Management**, tap your Apple ID under *Developer App*, tap **Trust**, then open Reals again.

Apps signed by a free account stop launching 7 days after installation. Run from Xcode again to reinstall; free accounts are also limited to a few sideloaded apps at a time. Reals doesn't need the Sign in with Apple or push capabilities that free accounts can't sign: Apple sign-in runs as browser OAuth. **Try the demo** works offline, the camera records real takes on the phone, and the Debug build talks to the development deployment described below.

## Configure live services

Debug builds default to the public development origins `https://first-mandrill-982.convex.cloud` and `https://first-mandrill-982.convex.site` when settings are absent or placeholders. To configure other origins, copy `Config/Public.example.xcconfig` to ignored `Config/Public.local.xcconfig` and set `CONVEX_URL` and the distinct `CONVEX_SITE_URL`. Both must be HTTPS origins without a path, credentials, query or fragment; the example uses Xcode's `$()` expansion to avoid interpreting `//` as an xcconfig comment. Release builds fail closed on missing or placeholder configuration. Bundle identifier and team come from the same xcconfig files (see Run on your iPhone). Apple provider credentials belong only in the Convex deployment, never the app, git or logs.

Apple sign-in uses browser OAuth through `ASWebAuthenticationSession`, the configured site origin's fixed `/auth/ios` relay, and `take://auth/convex`. The app generates a random 43-character base64url relay nonce and verifies its return; this nonce is distinct from the OAuth state returned by Convex and used to redeem the code. Cancellation or invalid callbacks do not block the offline demo. See the services README for the exact wire protocol.

Debug builds offer a labeled username/password developer screen from Welcome; it is outside the demo. The backend authoritatively enforces development-only sign-in and rejects developer sessions outside development. The UI and launch settings are not authorization boundaries.

ProductionService implements the accepted named Convex APIs and DTO envelopes. Video/avatars upload raw bytes to the returned owner-authenticated site HTTP route, honoring the current 8 MiB video and 2 MiB avatar intent limits. Capture's ordinary H.264/AAC MP4 export trims to 14.9 seconds and caps at 8 MiB. Finalization/status must confirm publication before a receipt can unlock Today. Retries retain the request ID and upload ID. Private video and thumbnail grants must use the configured site `/v1/media/…?token=…` route and expire in at most 60 seconds; raw storage URLs and video redirects are rejected. Native playback downloads only the selected bounded clip into a protected active-only temporary file with an ephemeral no-cache session, then clears the player/file at the grant deadline even if AVPlayer's controls paused it. Playing again requests fresh access. No video is eagerly loaded for a locked viewer. Caption status is unavailable-safe.

The currently deployed development checkpoint has no configured media verifier, so live publication fails closed; the offline demo does not prove live publishing. Public takes, comments and battles do not weaken private receipt, authorization or recovery boundaries.

Account deletion requires a fresh sign-in to the same account and a new session no more than five minutes old. If `REAUTH_REQUIRED` is returned, sign in again and retry deletion; refreshing a token does not count as reauthentication.

Notification permission follows an explanation and does not block posting. APNs registration defaults off, and neither Firebase nor a push entitlement is required for the current configuration. Device registration support is not a remote delivery provider; remote push delivery is unavailable.

## Boundaries and verification

SwiftUI screens are separate from shared DTOs, injected TakeService implementations, capture/audio and playback. Demo authorization checks query, direct content, caption and media paths, not only UI filtering. Production delegates content authorization, immutable publication, media inspection, account cleanup and scheduling to trusted Convex functions. Published originals cannot change position/media; deleting preserves the successful receipt.

Auth/signing head `cdfb950ad3528a746656e3f30c16a1b0b7f3a734` passed 26 unit tests and one UI test in Revyl build `01M7GP9Y3PERS0FH48BS79D1BW`. That run predates the eight-mock UI and v4 changes; no native verification of those changes is claimed. Hardware capture, live Apple OAuth, deployed media verification and remote delivery require separate verification. Whop is a future provider only; no payment UI exists.
