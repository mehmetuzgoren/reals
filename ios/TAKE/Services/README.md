# Production service integration

The wire reference is the shared TAKE integration contract plus wire addendum v1. The production implementation contains no demo identities, sample-media fallback, Firebase Storage, Firestore, or Cloud Functions.

## Construction and UI interfaces

`ProductionService` is `@MainActor` and implements both `TakeService` and `AppleAuthenticationService`. Create it only after the person chooses live mode:

```swift
let service = try ProductionService.make()
```

`LiveConfiguration.load(bundle:)` and `ProductionService(configuration:)` support explicit injection of a validated bundle configuration. Loading configuration reads settings but does not start Firebase. Constructing the production service configures Firebase and creates exactly one `ConvexClientWithAuth<FirebaseSession>`. Demo startup must not construct either production service or `FirebaseAuthentication`.

Required bundle configuration is `CONVEX_URL`, `CONVEX_SITE_URL`, a matching `GoogleService-Info.plist`, `FirebaseAppDelegateProxyEnabled = false`, and `FirebaseMessagingAutoInitEnabled = false`. Both URLs are distinct HTTPS origins with no path, credentials, query, or fragment. `FIREBASE_PROJECT_ID` is optional; when present it must match the Firebase plist. Missing, unresolved, placeholder, or mismatched settings fail closed with `NOT_CONFIGURED`. Provider private keys and APNs credentials do not belong in this bundle.

Pass `prepareAppleRequest(_:)` to the Apple button's request handler and await `completeAppleSignIn(_:)` for its successful authorization. The adapter uses 32 cryptographically random bytes, SHA-256 nonce hashing, a matching request state and five-minute nonce lifetime, then Firebase's Apple credential flow. A same-Apple-account repeat sign-in reauthenticates the Firebase user. After completion, await `session()`; `viewerID` is the backend profile ID, never a client-selected identity or Firebase UID. Finish onboarding when required.

Install `@UIApplicationDelegateAdaptor(TakeAppDelegate.self)` in the SwiftUI app. `TakeAppDelegate` never configures Firebase. Its APNs callbacks and the notification-center delegate use `NotificationCoordinator.shared`, which is a `@MainActor ObservableObject`:

- `configure(service: any TakeService)` connects an established live session; demo services are ignored.
- `requestPermission() async` asks the OS only after the UI has explained daily-question/direct-reply notifications. It is not called automatically by configuration.
- `refreshRegistration() async` updates delivery after foregrounding or permission changes, waits for an APNs token before requesting the FCM token, and synchronizes the installation with the backend.
- `signOutCleanup() async` disables local push registration, attempts authenticated backend unregister before Firebase sign-out, and retires the FCM token. The UI must await it. `ProductionService.signOut()` also calls it defensively.
- `onOpen: (() -> Void)?` routes taps to the UI, which should select Today and refetch authorized state. No payload-supplied content ID is trusted. Cold-start taps remain pending until a live session and handler exist.
- `authorizationStatus`, `isRegistered`, and `errorMessage` are published UI state. Cleanup errors do not prevent local sign-out.

Observe `.takePrivateAccessInvalidated` to clear players, private thumbnails, captions, and UI caches. It fires on session resets, remove/block/respond changes, and content deletion. `.takeSessionEnded` additionally signals a cleared service session. The production service itself retains no media grants, private image caches, or private response disk cache. UI relationship and round observers must also clear already-delivered media; bytes already played cannot be revoked by a client or server.

Transient Firebase token-refresh transport errors push nil to Convex, invalidate in-flight requests and retained subscriptions, and post `.takeAuthenticationPaused`. The UI clears private content but retains the current owner's saved retry recording. A successful explicit or foreground refresh reauthenticates and restarts subscriptions. Confirmed identity changes, permanent authentication failures, and explicit sign-out instead end the session and remove that owner's draft. Stale token callbacks from an earlier binding cannot affect a newer session.

## Transport and wire behavior

Every contract function is implemented with its named kind: one-shot queries use cancellable subscriptions; Today has a retained subscription canceled by `stopWatching()`. Authentication uses the Convex 0.8.2 `AuthProvider` signatures `login(onIdToken:)`, `loginFromCache(onIdToken:)`, `logout()`, and `extractIdToken(from:)`. Firebase token refreshes push only Firebase ID tokens through the callback; invalid sessions push nil. Subscription/query/upload work and pending private state are canceled or invalidated on identity changes and sign-out.

`watchConversation(originalId:_:) -> () -> Void` watches authorized `takes:detail` and the first `replies:list` page (`cursor: null`, `limit: 20`), calling its data-free callback on updates or errors so the UI refetches and removes revoked content. Its returned closure cancels both subscriptions. `stopWatching()` and session invalidation cancel every retained Today, graph, and conversation watcher. `watchToday` also watches `friends:list`; graph changes after the initial emission, or graph watcher errors, post the private-access invalidation event even if safe Today presence data did not change.

DTOs decode directly into the domain models accepted in addendum v1, including the array returned by `friends:search`, the `blocked` list, and relationship literal `approved`. Void mutation/action acknowledgments accept any valid JSON result rather than assuming a null/string response. Pagination limits use `Double` so Convex receives ordinary JSON numbers, not encoded int64 values. ConvexError data is decoded as `ServiceFailure`; unknown failures get a generic connection error without logging tokens or HTTP bodies.

Video upload uses `uploads:begin` with the persisted draft UUID as `requestId`, then authenticated `POST /v1/uploads/<uploadId>/video` using the returned upload URL. Drafts must belong to the current backend viewer, must not be demo drafts, and must contain a camera-sourced local MP4 with video and audio. Bundled files and simulator-fixture sources are rejected. The client checks actual AVFoundation duration and byte count, applies the tighter returned limits with a 15,000 ms/20 MiB ceiling, snapshots the file, and streams it with URLSession. Progress remains below 1 until the HTTP binding succeeds. Request redirects are refused; response bodies are bounded to 64 KiB; cookies, credentials, and URL caching are disabled. Temporary snapshots are protected and removed after completion/cancellation. Trusted backend validation is still mandatory; client checks are not authorization or proof of media provenance.

`uploads:finalize` is an action with the server upload ID; `uploads:status` is an owner query. Neither records a local successful receipt. Retries preserve the same draft request ID/upload ID and rely on the backend's transactional idempotency. Processing remains processing until the server returns a published result.

Video and thumbnail playback both call `media:createPlaybackGrant`. The client accepts only the configured site origin's `/v1/media/<grantId>?token=...` route and rejects raw storage/download URLs. Expiry is checked against the Today server-clock offset with five seconds of clock/response tolerance. The backend must enforce its actual at-most-60-second lifetime and current authorization on every request, including Range/HEAD. Captions call `captions:get`; only a ready response can contain nonempty caption text, with no fabricated fallback.

Avatar intents use the addendum envelope `{uploadId,uploadUrl,expiresAt,acceptedMimeTypes,maxBytes,maxWidth,maxHeight}`. Photos up to 20 MiB are decoded through bounded ImageIO thumbnailing off the main actor, orientation-normalized, stripped of metadata, and encoded as accepted JPEG/PNG within the tighter server limits, at most 2048 squared and 5 MiB. The returned URL must be `POST /v1/uploads/<uploadId>/avatar` on the site origin. Its successful `{uploadId}` acknowledgement is checked before `profiles:update`. Passing null for `avatarUploadId` retains the current photo.

All social, profile, preferences, content deletion/reporting, device-token, and account-deletion calls use the named functions in the contract. Account deletion calls `accounts:requestDeletion`, then signs out; Firebase identity cleanup/revocation and recent-auth enforcement remain server responsibilities.

One-shot queries/mutations have 30-second client deadlines, actions 60 seconds, HTTP uploads a 300-second resource deadline, and sign-out unregister/token retirement five-second deadlines each. A timeout cannot undo a mutation already accepted by the server; status checks and idempotent request IDs are essential before retrying publication. Offline device unregister/FCM retirement is best effort; local APNs registration and FCM auto-init are disabled even when the backend is unreachable.

## API references and verification boundary

The native project owner must pin `ConvexMobile` exactly 0.8.2 and Firebase exactly 13.2.0; this service ownership does not include the Xcode project/package lockfile. Firebase tag 13.2.0 was confirmed at `efad2b784dfae43404dc1fcfdf272981b235e71f` during implementation. The existing token APIs remain available in 13.2.0 but are deprecated in favor of its newer Firebase Installation registration APIs; this code intentionally uses registration tokens to match the agreed FCM HTTP-v1 backend contract.

- [Convex 0.8.2 AuthProvider/client source](https://github.com/convex/convex-swift/blob/0.8.2/Sources/ConvexMobile/ConvexMobile.swift)
- [Convex encoding source](https://github.com/convex/convex-swift/blob/0.8.2/Sources/ConvexMobile/Encoding.swift)
- [Firebase Apple sign-in](https://firebase.google.com/docs/auth/ios/apple)
- [Firebase 13.2.0 OAuthProvider source](https://github.com/firebase/firebase-ios-sdk/blob/13.2.0/FirebaseAuth/Sources/Swift/AuthProvider/OAuthProvider.swift)
- [Firebase 13.2.0 Auth/token-listener source](https://github.com/firebase/firebase-ios-sdk/blob/13.2.0/FirebaseAuth/Sources/Swift/Auth/Auth.swift)
- [Firebase 13.2.0 ID-token source](https://github.com/firebase/firebase-ios-sdk/blob/13.2.0/FirebaseAuth/Sources/Swift/User/User.swift)
- [Firebase 13.2.0 Messaging header](https://github.com/firebase/firebase-ios-sdk/blob/13.2.0/FirebaseMessaging/Sources/Public/FirebaseMessaging/FIRMessaging.h)
- [FCM Apple setup](https://firebase.google.com/docs/cloud-messaging/ios/get-started)
- [FCM Apple message handling](https://firebase.google.com/docs/cloud-messaging/ios/receive-messages)

Linux verification parsed the four Swift service files with tree-sitter-swift and compared all domain protocol methods and named contract functions with their implementations. It is not an Apple SDK typecheck. No iOS build, Apple/Firebase login, deployed Convex request, live upload/playback, remote push, or physical-device test was performed by this service subagent. The native owner owns the remote build and compilation fixes; deployment credentials and real providers are required for end-to-end verification.
