# TAKE

A native iPhone app for one daily video opinion: choose a position, publish up to 15 seconds, then see that round's originals from approved friends. Replies stay inside their original's conversation and are visible only to their eligible audience.

## Start here

The repository is being built in separate native, backend, and verification PRs. **This documentation snapshot starts from the `.gitignore`-only bootstrap; it does not yet include an app or backend.** Commands that require `ios/` or `backend/` become runnable only with those implementation PRs. [Verification status](docs/verification-status.md) separates executed checks from planned acceptance gates.

The offline demo must need no account, Firebase configuration, Convex deployment, network, or secrets. Once the native source is present, open `ios/TAKE.xcodeproj`, choose the shared TAKE scheme and an iOS 18+ iPhone simulator, run, and choose **Demo Mode**. The [native setup guide](docs/setup.md#native-offline-demo) records the intended flow and the implementation details that still need confirmation. A simulator fixture is labeled sample footage, not a camera recording.

The demo includes two questions, fictional Alex/Blair/Casey/Dana profiles, playable local clips, identity switching, round release, reset, and simulated publication controls. None of those controls may enter production services or authorization.

## Architecture

- SwiftUI, AVFoundation capture, and AVKit playback on iOS 18+; injected, isolated demo and production services.
- Convex application data, trusted TypeScript functions, storage, scheduling, and private media delivery. No Firestore, Firebase Cloud Functions, or Firebase Storage.
- Firebase Authentication with Sign in with Apple; the **Firebase ID token** authenticates Convex. Firebase Cloud Messaging delivers through APNs.
- Revyl builds the native project on macOS and runs cloud-iPhone checks. Linux checks are not iOS build or device evidence.
- Whop is a future payment provider only. This version has no payments, subscriptions, or paywall.

Only a server-confirmed original publication unlocks the same round. Failed uploads, selection, previews, and replies do not unlock it. Deleting a published original preserves its receipt and one-original limit. A new server round relocks friends' content. The main feed contains originals only.

Casey, a mutual friend of Alex and Blair who has posted, can see Blair's reply on Alex's original. Dana, a posted friend of Alex only, cannot see that reply, its count, caption, thumbnail, or media—even by known ID. See [privacy and product invariants](docs/security.md).

## Development and verification

Node 24 is sufficient for the dependency-free documentation/probe checks:

```sh
node --test verification/*.test.mjs
node verification/check-docs.mjs
```

These test the verification tooling, not a deployed product. The [acceptance matrix](verification/acceptance.md) covers the end-to-end loop, authorization, media, failure recovery, and device-only gates. The [deployed probe](verification/README.md) exercises real Convex read/media endpoints once a dedicated staging fixture and Firebase identities exist; it is never silently substituted with a mock.

For production prerequisites and deployment, read [setup](docs/setup.md). For macOS builds, the Revyl walkthrough, and hardware checks, read [testing](docs/testing.md). Do not commit credentials, Firebase client files, private recordings, build artifacts, or playback grants.
