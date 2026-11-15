# Reals setup

Use the native/backend PR checkout for its commands; this docs-only branch contains neither implementation. [Verification status](verification-status.md) records exact heads. Reals is the product name; the current Xcode target, storage paths and bundle identifier may retain internal `TAKE` names. The eight-screen replacement UI is pending its own build, not established by older demo screenshots.

## Native offline demo

On macOS open `ios/TAKE.xcodeproj` and select the shared **TAKE** scheme. No generator, CocoaPods, Node, backend account or secret is required for the isolated demo. The executed lane was arm64 iPhone 16 / iOS 18.5, Xcode 27; ConvexMobile **0.8.2** is pinned. An older Xcode minimum has not been independently established.

```sh
cd ios
bash scripts/build-simulator.sh
SIM_ID="$(xcrun simctl create TAKE-tests com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-18-5)"
TAKE_TEST_DESTINATION="platform=iOS Simulator,id=$SIM_ID" bash scripts/test-simulator.sh
```

Choose a runtime/UUID actually installed on your Mac. Scripts build arm64; output is `build/Build/Products/Debug-iphonesimulator/TAKE.app` and test results are `build/TAKE-tests.xcresult`. A build is not a test pass.

At auth source `027d488`, choose **Explore Demo Mode**, then Casey's pineapple option → Give your take → scroll to Use simulator sample instead → confirm the labeled four-second fixture → preview → publish. The existing Demo lab switches Casey/Dana, releases the Elon round and injects upload failure. The new mock-exact version instead starts on “Is a hot dog a sandwich?”, opens Record directly from Yes/No, removes the tab bar and exposes old privacy rounds by long-pressing **Reals**. Those are replacement-build acceptance requirements, not this source's observed behavior.

Illustrated samples and synthetic tones are fictional, not camera recordings or spoken testimony. Demo data/drafts use Application Support/TAKE/Demo and DemoDrafts; viewer-bound live drafts use LiveDrafts. Production rejects fixture provenance. Unconfigured demo launch has been observed; network-denied operation is a separate unexecuted lane.

## Native live configuration

```sh
cp ios/Config/Public.example.xcconfig ios/Config/Public.local.xcconfig
```

Edit the ignored file, preserving xcconfig's `$()` escape so `//` does not start a comment:

```text
CONVEX_URL = https:/$()/first-mandrill-982.convex.cloud
CONVEX_SITE_URL = https:/$()/first-mandrill-982.convex.site
```

Both are distinct HTTPS origins with no path/query/fragment/credentials. The SDK URL and HTTP origin are separate; do not infer custom domains by replacing a suffix. Missing/placeholders fail closed. No server secret belongs in xcconfig, plist or the app. Apple provider credentials are deployment-only. Signing team/profile and any future APNs entitlement remain signed-device configuration, not proof of notification delivery.

The app registers the internal `take` callback scheme. Apple browser auth uses `ASWebAuthenticationSession` and `take://auth/convex`. The separately labeled developer username/password screen at `027d488` requires `--development-auth` and is outside Demo; backend enforcement, not a launch flag, makes it development-only.

## Live development deployment

Development deployed backend `a48095d8730507a63bc99f033ad69d799613d579` to project `mehmet-uzgoren/reals`, deployment `first-mandrill-982` on November 15, 2026. SDK: `https://first-mandrill-982.convex.cloud`; HTTP: `https://first-mandrill-982.convex.site`. The boundary probe independently reaches its deployed auth/relay/media routes. A root-page 404 is not a deployment-health test.

Dependencies at this source: Convex **1.50.0**, Convex Auth **2.0.0**, Temporal polyfill **0.5.1**, Vitest **5.1.0**. On Node 24:

```sh
cd backend
npm ci
npm run check
npx convex deploy
```

Use the intended project's secure scoped `CONVEX_DEPLOY_KEY`, never a client credential. With this deploy-key lane, omit `--deployment` from `npx convex env set/list`: that flag selects a member-auth flow instead. Do not print the key or copy an environment dump into logs. Human member login is a different lane.

Deployment bootstrap values are non-secret:

```dotenv
TAKE_DEPLOYMENT_ENV=development
AUTH_APPLE_CLIENT_ID=unconfigured
AUTH_APPLE_TEAM_ID=unconfigured
AUTH_APPLE_KEY_ID=unconfigured
AUTH_APPLE_PRIVATE_KEY=unconfigured
TAKE_HTTP_ORIGIN=https://first-mandrill-982.convex.site
TAKE_ROUND_TIMEZONE=America/Los_Angeles
TAKE_ROUND_START_HOUR=10
TAKE_ROUND_END_HOUR=20
TAKE_ALLOW_DEV_SEED=false
```

These are the operator-reported live settings, not values exposed by the probe. The Apple component requires all four bindings at installation; both Apple start/completion reject placeholders. Real production Apple auth needs the Services ID, team ID, key ID and server-only `.p8` private key in those same variables. Convex supplies `CONVEX_CLOUD_URL` / `CONVEX_SITE_URL`, token signing and JWKS; do not provision a custom JWT issuer or signing secret.

Current auth functions are mutations: `auth:signUpWithUsernamePassword({ username, password })`, `auth:signInWithUsernamePassword({ username, password })`, `auth:startSignInWithApple({ redirectTo })`, `auth:completeSignInWithApple({ state, code })`, `auth:refreshSession({ refreshToken })` and `auth:signOut({ refreshToken })`. Passwords require at least ten characters. There is no `auth:signIn` or anonymous provider. Password sign-in and existing password-created identities are denied unless deployment mode is exactly `development`.

Apple's HTTPS return is `/oauth/apple/callback`, a **POST** route. An empty POST returns 400 on the live deployment; GET returns 404 because it is not that route's method. The app generates a 43-character base64url relay nonce in `redirectTo=<site>/auth/ios?state=<nonce>` and separately saves the returned OAuth state. The fixed relay forwards the nonce/code only to `take://auth/convex`. Verify the returned nonce before redeeming with the saved **OAuth state**; they are distinct. Missing/duplicate/malformed relay fields give 400/no Location, always no-store/no-referrer. The live probe checks this fixed routing, not real Apple authentication.

Access tokens default to 60 seconds; refresh securely through Convex Auth and replace the SDK session. Sign-out clears private state and revokes the session. Account deletion requires a fresh sign-in to the same account within five minutes; refresh does not reset session age. Failure is `REAUTH_REQUIRED`. Deletion tombstones the app user and revokes its sessions; it does not delete the person's Apple account.

## Verifier and notification boundary

The verifier is **not hosted**. Live publication cannot create a receipt without it. `MEDIA_VERIFIER_ORIGIN` must eventually be the worker's HTTPS origin; `MEDIA_VERIFIER_SECRET` must match its server-only `VERIFY_SHARED_SECRET` (at least 32 random characters). Do not set a pretend worker URL or accept client metadata as verification.

The backend caps video at **8 MiB**, ordinary non-fragmented portrait H.264/AAC-LC MP4, square pixels, ≤60 FPS and ≤15,000 ms. Native export uses a timing margin. The worker's standalone body cap is 20 MiB; that does not widen the application's 8 MiB cap. Avatars accept ≤2 MiB / 2048×2048 JPEG/PNG and become metadata-free ≤512px JPEG. The [published v4 contract](wire-v4.md) adds `minDurationMs: 3000`; its implementation/ready head is pending, not proved by the live v3 deployment.

The worker uses actual stored bytes plus `X-Content-SHA256` at authenticated `POST /verify` / `POST /verify-avatar`. It is a separate Node 24 / FFmpeg service, not code that runs inside Convex:

```sh
cd backend/verifier
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm start
```

Supply `VERIFY_SHARED_SECRET` securely before starting and use FFmpeg/FFprobe 6.1+ at `/usr/bin`. Optional `PORT` defaults to 8080. Before hosting, follow the actual `backend/verifier/README.md` container/TLS/resource/ingress instructions; local startup is not HTTPS deployment. Never expose storage redirects, private body/header logs or an unauthenticated verifier bypass.

`devices:register({ installationId, token, platform: "ios", notificationsEnabled })` accepts the APNs token's hex encoding, not a delivery claim. `devices:unregister({ installationId })` removes that install. The shipped sender reports unavailable; there is no working remote push provider yet.

## Round data and v4

The internal development seed requires explicit `TAKE_DEPLOYMENT_ENV=development` and `TAKE_ALLOW_DEV_SEED=true`; restore the latter to false afterward. It creates three eligible round-plan dates, not users, friendships, private media or the deployed probe's fixture. Today is eligible only before its configured local window ends; openings persist their original window and refuse expired/stale plans.

A fresh empty deployment needs no backfill. Reused draft rows need reviewed identity migration and `windowStartsAt` / `windowEndsAt` backfill from the original zoned plan/policy before applying the strict schema. Never widen windows or backdate openings to bypass it. V4's published rule treats a missing legacy stored audience as friends, never public; returned summaries still require the new fields. Ready-head migration guidance remains necessary before upgrading live data.
