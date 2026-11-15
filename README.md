# TAKE

A native iPhone app for one daily video opinion: choose a position, publish up to 15 seconds, then see that round's originals from approved friends. Replies stay inside their original's conversation and are visible only to their eligible audience.

## Start here

The app, backend, and verification ship in separate PRs: [native #2](https://github.com/mehmetuzgoren/reals/pull/2), [backend #3](https://github.com/mehmetuzgoren/reals/pull/3), and [docs #1](https://github.com/mehmetuzgoren/reals/pull/1). The docs-only branch does not duplicate their source; commands below require the corresponding implementation checkout. [Verification status](docs/verification-status.md) identifies the exact tested snapshots and remaining gates.

The demo needs no account, Firebase configuration, Convex deployment, or secrets. Open `ios/TAKE.xcodeproj`, choose the shared TAKE scheme and an iOS 18+ iPhone simulator, run, and choose **Explore Demo Mode**. The [native setup guide](docs/setup.md#native-offline-demo) includes exact build commands and package pins. Simulator samples are explicitly labeled fictional footage, not camera recordings. Unconfigured demo operation was observed on a cloud iPhone; a network-denied test is still separate.

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
