# Setup: offline first, production fail-closed

These commands and configuration names were read from the delivered native and backend source, not inferred from the interface contract. The implementations are separate PRs; use the corresponding checkout or an explicitly combined integration checkout. [Verification status](verification-status.md) records the tested heads. This guide does not imply that hosted services, Apple signing, or production credentials have been provisioned.

## Native offline demo

On macOS, open `ios/TAKE.xcodeproj`, select the shared **TAKE** scheme, and run on an iOS 18+ iPhone simulator. No project generator, CocoaPods, Node, account, Firebase client file, or Convex deployment is required. The demonstrated native lane used arm64 iPhone 16 / iOS 18.5 with Xcode 27 (`27A266a`); an older Xcode minimum has not been independently established.

```sh
cd ios
bash scripts/build-simulator.sh
SIM_ID="$(xcrun simctl create TAKE-tests com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-18-5)"
TAKE_TEST_DESTINATION="platform=iOS Simulator,id=$SIM_ID" bash scripts/test-simulator.sh
```

Use an installed simulator runtime and its actual identifier if your Mac differs. The scripts build arm64 because the pinned Convex framework lacks an x86_64 simulator slice. The app is `build/Build/Products/Debug-iphonesimulator/TAKE.app`; test results are `build/TAKE-tests.xcresult`. A build alone is not XCTest evidence.

Choose **Explore Demo Mode**. Casey starts locked on the pineapple question. Choose Yes/No/Depends → Give your take → Use simulator sample instead → explicitly confirm **Use labeled 4-second sample** → preview → publish. The illustrated portraits and synthetic tones are bundled fictional samples, not live capture, speech, or transcripts. Real hardware submissions use the in-app front camera and microphone.

Today and Profile expose **Developer-only Demo controls**. Switch Casey/Dana to check the reply audience, release the second question to test exact-round relock, arm **Fail the next upload** before creating a take, and reset all demo data when needed. `--demo --reset-demo` is the deterministic test launch. Demo state/drafts live separately under Application Support/TAKE/Demo and DemoDrafts; live drafts use LiveDrafts and are viewer-bound. Production rejects fixture provenance. Test network-denied operation separately; an unconfigured launch with working network is not that evidence.

Swift Package Manager pins `ConvexMobile` **0.8.2** and Firebase Auth/Core/Messaging **13.2.0**. The checked-in `Package.resolved` contains 14 resolved pins. No Firestore, Cloud Functions, Firebase Storage, payment, or Whop SDK is required.

## Configuration inventory

Never commit credentials, project-specific Firebase files, tokens, grants, recordings, or signing material. Ignore rules are not a substitute for checking tracked files. Native configuration is public client configuration, not permission to include server secrets.

| Name / item | Actual location / purpose |
| --- | --- |
| `CONVEX_URL` | `ios/Config/Public.local.xcconfig`; HTTPS Convex query/mutation/action origin. |
| `CONVEX_SITE_URL` | Same file; separate HTTPS HTTP upload/media origin. Do not derive custom domains by suffix replacement. |
| `FIREBASE_PROJECT_ID` | Native xcconfig and Convex deployment; must match the Firebase client plist, token issuer/audience, and server account project. |
| `GoogleService-Info.plist` | Ignored `ios/Config/GoogleService-Info.plist`; downloaded for the exact native bundle ID. |
| Apple bundle / team IDs | Xcode signing, Apple App ID, Firebase Apple app, APNs topic, and profile must agree. Current demo bundle is `com.take.app`; no distribution team is configured here. |
| `CONVEX_DEPLOYMENT` | Ignored developer environment; selects a development deployment, not an app credential. |
| `CONVEX_DEPLOY_KEY` | Deployment automation secret only, never native runtime or probe input. |
| `TAKE_HTTP_ORIGIN` | Convex deployment; exact HTTPS site/custom HTTP origin, no trailing slash. |
| `MEDIA_VERIFIER_ORIGIN` | Convex deployment; trusted worker HTTPS origin, no path/trailing slash. |
| `MEDIA_VERIFIER_SECRET` | Convex server secret; matches worker `VERIFY_SHARED_SECRET`, at least 32 random characters. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Convex server secret; Firebase Admin Auth cleanup and FCM HTTP-v1 permissions, same Firebase project. A developer's local credential-file path is not this hosted value. |
| `TAKE_ROUND_TIMEZONE` | Convex deployment; defaults to `America/Los_Angeles`. |
| `TAKE_ROUND_START_HOUR`, `TAKE_ROUND_END_HOUR` | Convex deployment; integer local hours, defaults 10 and 20, start < end. |
| `TAKE_DEPLOYMENT_ENV`, `TAKE_ALLOW_DEV_SEED` | Convex deployment; production uses `production` / `false`. Development seeding requires `development` / `true`. |
| Apple sign-in key, APNs key, signing certificate/profile | Secret provider/signing configuration, not native xcconfig or Convex source. Apple sign-in and APNs keys serve different purposes. |

For live native configuration:

```sh
cp ios/Config/Public.example.xcconfig ios/Config/Public.local.xcconfig
```

Edit the ignored copy and add the matching ignored Firebase plist. Preserve the example's `https:/$()/...` xcconfig escaping: a literal `//` starts a comment in this format. `Config/Base.xcconfig` includes the local file; the build copies the optional Firebase plist. `LiveConfiguration` rejects missing/placeholders, invalid HTTPS origins, identical deployment/site hosts, or mismatched Firebase project/bundle IDs. `FirebaseAppDelegateProxyEnabled=false` and `FirebaseMessagingAutoInitEnabled=false` are intentional: delegates and consent are handled explicitly. Live configuration is excluded from the unconfigured demo archive.

## Convex application backend

Use Node 24 and the checked-in npm lockfile. Actual dependencies include Convex **1.50.0**, Firebase Admin **14.5.1**, Temporal polyfill **0.5.1**, and Vitest **5.1.0**.

```sh
cd backend
npm ci
npm run check
npx convex dev
```

`convex dev` selects/authenticates a development project, generates bindings, and pushes schema/functions. The first successful push requires deployment `FIREBASE_PROJECT_ID`; set it in the selected deployment through its dashboard or `npx convex env set FIREBASE_PROJECT_ID <project-id>`. Use the secret manager/dashboard for secret values, not shell history. Inspect `backend/.env.example` for names; it is not configured credentials. Verify the target before `npm run deploy` (`convex deploy`). The verification workflow never deploys.

The backend owns `convex/schema.ts`, indexes, generated bindings, HTTP routes, crons, and internal workers. Indexes are not uniqueness constraints: serializable mutations enforce unique usernames, request transitions, idempotency, and one original/receipt per viewer/round. `npx convex run planner:plan '{}'` is an administrator-only CLI invocation of an internal function; the hourly planner maintains today and the next two local dates. Production clients cannot release rounds or select an identity.

The development seed is deliberately narrow:

```sh
CONVEX_DEPLOYMENT=dev:<development-name> npm run seed:dev
```

It additionally requires deployment `TAKE_DEPLOYMENT_ENV=development` and `TAKE_ALLOW_DEV_SEED=true`, refuses production/extra arguments, and creates only the two round plans. **It does not create Firebase identities, friendships, uploaded media, receipts, or the probe's acceptance fixture.** The [deployed probe](../verification/README.md) needs a dedicated staging fixture populated through real authenticated onboarding/publication: Alex↔Blair, Alex↔Casey, Blair↔Casey, Alex↔Dana, no Blair↔Dana; published Alex original/Blair reply; Casey/Dana receipts; and a separate locked identity. Keep fixture IDs and tokens private. Native demo fixtures never write to this deployment.

### Firebase ID-token boundary

`convex/auth.config.ts` uses custom JWT / RS256, issuer `https://securetoken.google.com/<FIREBASE_PROJECT_ID>`, audience `applicationID=<FIREBASE_PROJECT_ID>`, and JWKS `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`. The native auth provider exchanges Apple credentials with Firebase and supplies **Firebase ID tokens**, never Apple tokens or a client-selected viewer. HTTP uploads authenticate the same project/identity using `Authorization: Bearer <Firebase ID token>`.

Application tombstones reject disabled/deleting identities and their existing grants immediately. Custom JWT validation does not check Firebase-console-only revocation/disablement on every request. Administrators must first invoke internal `admin:setDisabled` through the authorized CLI/dashboard; it cannot reactivate deletion tombstones. On staging, test real accepted Firebase tokens and absent/expired/wrong-issuer/wrong-audience/Apple-token rejection. Unit-test identities are not that check. See [Firebase verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens) and [Convex custom JWTs](https://docs.convex.dev/auth/advanced/custom-jwt).

### Trusted media worker and uploads

The delivered `backend/verifier/` is a separate Node 24 service with actual FFprobe/FFmpeg, not an executable inside Convex. Its README is the deployment authority for the pinned container, nonroot user, bounded CPU/memory/process/tmp space, authenticated TLS ingress, deadlines, concurrency, and log redaction. Local tests require FFmpeg/FFprobe 6.1+ at `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`; the container supplies FFmpeg 7.

```sh
cd backend/verifier
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

From the repository root, `docker build --pull -t take-media-verifier:local backend/verifier` builds the service. Follow its README's constrained container test/run commands; do not expose an unconstrained unauthenticated port. Worker `VERIFY_SHARED_SECRET` must match Convex `MEDIA_VERIFIER_SECRET`; worker `PORT` defaults to 8080. Convex must reach its configured HTTPS origin, not the worker host's loopback address.

`POST /verify` and `/verify-avatar` accept the exact uncompressed binary body as `application/octet-stream`, an exact lowercase SHA-256 in `X-Content-SHA256`, and server-only `Authorization: Bearer ...`. They never fetch a client URL. Video response keys are `sha256`, `durationMs`, `width`, `height`, `videoCodec`, `audioCodec`, `thumbnailBase64`; avatar response keys are `sha256`, `mimeType`, `width`, `height`, `imageBase64`. Convex bounds the response, validates its shape/hash, and rechecks authorization in the final transaction. Failed/unconfigured inspection creates no successful receipt or unlock. No transcription service is claimed; captions return `unavailable` / `null`.

Native publication is `uploads:begin` → owner-authenticated `POST /v1/uploads/<uploadId>/video` → `uploads:finalize` / `uploads:status`. The actual app cap is **8 MiB**, maximum **15,000 ms**, portrait nonfragmented H.264/AAC-LC MP4 with square pixels and at most 60 fps. Native export has a 14.9-second safety trim and an 8 MiB file limit. Worker silence checks reject effectively silent audio. Physical capture/export bytes still require a real-device roundtrip; source compatibility is not that evidence.

Avatar intents accept at most **2 MiB** and **2048×2048**. Native downsamples/re-encodes before upload; the trusted worker fully validates and normalizes to a metadata-free JPEG at most **512 px**. Only the normalized selected avatar is served from `/v1/avatars/<userId>`; arbitrary storage IDs cannot be used to retrieve staging/video.

Video intents last ten minutes; processing/upload leases last two minutes. Private media uses opaque **60-second** grants at `/v1/media/<grantId>?token=...`, not `storage.getUrl()` or redirects. Every GET/HEAD/Range rechecks current access; responses are `private, no-store`. Redact grant query strings, headers, bodies, and device tokens in ingress/APM logs. See [revocation policy](security.md#media-expiry-and-revocation). Feed/history/reply pages cap at **8/10/50**, respectively; conversations cap at 50 stored replies. Social changes can invalidate a visible-only cursor; restart from `null` on `NOT_FOUND`.

### Scheduling, cleanup, and costs

The server chooses the random daily opening inside the configured local-hour window using DST-aware dates. The previous round closes only when its successor actually opens, then a generic push job is enqueued. Device dates and missed pushes never select/unlock a round.

Bounded jobs clean expired staging/grants, orphan objects, superseded avatars, deleted conversations, and account data. Deleting an original preserves its successful receipt and one-original limit. Account deletion tombstones revoke access before asynchronous Firebase identity cleanup. Convex reads/storage/private bandwidth, worker CPU, and FCM incur service costs; application limits do not replace ingress quotas, retention policy, or load testing.

## Apple sign-in, notifications, and deletion

Register the exact Apple bundle with the Sign in with Apple and Push Notifications capabilities; add matching Firebase Apple-app/provider configuration and signed provisioning. Keep private keys and service-account JSON outside git and the app bundle. Nonce generation/validation and Firebase ID-token refresh are implemented, but real Apple authentication/signing remain external verification gates.

The app explains notifications before OS permission, maps APNs tokens manually, refreshes FCM registration, persists daily-question/direct-reply preferences, and attempts authenticated unregister/token retirement on sign-out. Configure Firebase's APNs auth key/team/key ID and a least-privilege same-project FCM Admin credential. Backend payload data is `type` (`daily` / `reply`), `roundId`, and optional `contentId`; alerts never include opinions, captions, media, or reply authors. Invalid tokens are retired. The current native tap handler selects Today and refetches authorized state; it does **not** route directly to a payload-selected conversation, and no `take://` scheme is registered.

Deletion requires Firebase `auth_time` within five minutes, not merely a refreshed token. On `REAUTH_REQUIRED`, Profile instructs sign-out and Apple sign-in again, then retry within five minutes. Local cleanup/tombstones and queued upstream Firebase deletion are distinct outcomes; do not call upstream identity deletion complete while its job is unconfigured/failed.

Use a signed physical iPhone to verify real Apple auth/deletion, camera/audio/orientation/interruption, and foreground/background/cold-start FCM/APNs. Simulator fixtures, local notification injection, and mocked sends do not satisfy those gates. See [testing](testing.md) for the exact evidence boundary. Whop requires no setup now.
