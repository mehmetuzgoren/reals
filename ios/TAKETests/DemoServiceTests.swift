import AVFoundation
import FirebaseCore
import FirebaseAuth
import XCTest
@testable import TAKE

@MainActor
final class DemoServiceTests: XCTestCase {
    private var directory: URL!
    private var service: DemoService!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("TAKETests-\(UUID().uuidString)")
        service = DemoService(directory: directory, reset: true)
    }
    override func tearDown() async throws { service.stopWatching(); try? FileManager.default.removeItem(at: directory); service = nil }

    private func draft(_ originalId: String? = nil) async throws -> PublicationDraft {
        let today = try await service.today()
        return PublicationDraft(id: UUID().uuidString, ownerId: service.viewerID!, isDemo: true, roundId: today.round!.id, optionId: originalId == nil ? today.round!.options[0].id : nil, originalId: originalId, clip: RecordedClip(url: try XCTUnwrap(DemoService.fixtureURL()), durationMs: 4_000, source: .simulatorFixture, createdAt: Date()), uploadId: nil, state: .preview, failure: nil)
    }
    private func publish(_ draft: PublicationDraft) async throws -> PublicationResult {
        let intent = try await service.beginUpload(draft: draft)
        try await service.upload(clip: try XCTUnwrap(draft.clip), intent: intent) { _ in }
        return try await service.finalize(uploadId: intent.uploadId)
    }
    private func denied<T>(_ operation: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await operation(); XCTFail("Expected fail-closed access", file: file, line: line) }
        catch { XCTAssertEqual((error as? ServiceFailure)?.code, "NOT_FOUND", file: file, line: line) }
    }
    private func checkTrue(_ value: Bool, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) { XCTAssertTrue(value, message, file: file, line: line) }
    private func checkFalse(_ value: Bool, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) { XCTAssertFalse(value, message, file: file, line: line) }
    private func checkEqual<T: Equatable>(_ first: T, _ second: T, file: StaticString = #filePath, line: UInt = #line) { XCTAssertEqual(first, second, file: file, line: line) }

    func testOfflineUnconfiguredDemoLaunchContainsNoFriendsOpinions() async throws {
        XCTAssertNil(FirebaseApp.app())
        checkEqual(service.identity, .casey)
        let state = try await service.today()
        checkFalse(state.canViewFriends)
        XCTAssertNil(state.viewerReceipt)
        XCTAssertNil(state.ownOriginal)
        checkEqual(state.friendPresence.count, 2)
        let encoded = String(decoding: try JSONEncoder().encode(state), as: UTF8.self)
        for privateKey in ["optionId", "thumbnailAssetId", "caption", "storageId", "mp4", "ReplySummary"] { checkFalse(encoded.contains(privateKey), privateKey) }
        await denied { try await self.service.feed(roundId: state.round!.id, cursor: nil) }
        await denied { try await self.service.detail(originalId: "demo-round-1-alex") }
        await denied { try await self.service.playback(contentId: "demo-round-1-alex", kind: .original, asset: "video") }
        await denied { try await self.service.playback(contentId: "demo-round-1-blair-reply", kind: .reply, asset: "video") }
        await denied { try await self.service.captions(contentId: "demo-round-1-alex", kind: .original) }
    }

    func testExactPromptsAndOptions() {
        checkEqual(DemoService.round(1).question, "Do you like pineapple on pizza?")
        checkEqual(DemoService.round(1).options.map(\.label), ["Yes", "No", "Depends"])
        checkEqual(DemoService.round(2).question, "Do you think Elon Musk is a genius? How is he successful?")
        checkEqual(DemoService.round(2).options.map(\.label), ["Yes", "No", "It's complicated"])
    }

    func testFailureDoesNotUnlockAndSameDraftCanRetry() async throws {
        let draft = try await draft()
        let intent = try await service.beginUpload(draft: draft)
        checkFalse(try await service.today().canViewFriends)
        service.failNextUpload()
        do { try await service.upload(clip: draft.clip!, intent: intent) { _ in }; XCTFail("Simulated upload must fail") } catch { checkEqual((error as? ServiceFailure)?.code, "DEMO_UPLOAD_FAILED") }
        checkFalse(try await service.today().canViewFriends)
        try await service.upload(clip: draft.clip!, intent: intent) { _ in }
        checkFalse(try await service.today().canViewFriends)
        let result = try await service.finalize(uploadId: intent.uploadId)
        checkEqual(result.state, "published")
        checkEqual(result.receipt?.roundId, draft.roundId)
        checkTrue(try await service.today().canViewFriends)
        checkEqual(try await service.finalize(uploadId: intent.uploadId), result)
    }

    func testCaseySeesIntersectionReplyAndDanaCannotReadItByIDOrMedia() async throws {
        _ = try await publish(draft())
        let caseyOriginal = try await service.detail(originalId: "demo-round-1-alex")
        checkEqual(caseyOriginal.visibleReplyCount, 1)
        let caseyReplies = try await service.replies(originalId: caseyOriginal.id, cursor: nil)
        checkEqual(caseyReplies.items.map(\.id), ["demo-round-1-blair-reply"])
        checkTrue(try await service.playback(contentId: caseyReplies.items[0].id, kind: .reply, asset: "video").url.hasPrefix("file:"))
        service.switchIdentity(.dana)
        _ = try await publish(draft())
        checkEqual(try await service.detail(originalId: caseyOriginal.id).visibleReplyCount, 0)
        checkTrue(try await service.replies(originalId: caseyOriginal.id, cursor: nil).items.isEmpty)
        await denied { try await self.service.playback(contentId: "demo-round-1-blair-reply", kind: .reply, asset: "video") }
        await denied { try await self.service.playback(contentId: "demo-round-1-blair-reply", kind: .reply, asset: "thumbnail") }
        await denied { try await self.service.captions(contentId: "demo-round-1-blair-reply", kind: .reply) }
        await denied { try await self.service.detail(originalId: "demo-round-1-blair") }
    }

    func testPendingRequestDoesNotGrantAccessAndOnlyRecipientCanRespond() async throws {
        _ = try await publish(draft())
        service.switchIdentity(.dana)
        _ = try await publish(draft())
        await denied { try await self.service.detail(originalId: "demo-round-1-blair") }
        await denied { try await self.service.respond(requestId: "request-dana-casey", accept: true) }
        service.switchIdentity(.casey)
        try await service.respond(requestId: "request-dana-casey", accept: true)
        checkTrue(try await service.friends().approved.contains { $0.id == "dana" })
    }

    func testRemoveAndBlockRevokeDirectMediaAndVisibleCounts() async throws {
        _ = try await publish(draft())
        _ = try await service.playback(contentId: "demo-round-1-blair-reply", kind: .reply, asset: "video")
        try await service.removeFriend(userId: "blair")
        checkEqual(try await service.detail(originalId: "demo-round-1-alex").visibleReplyCount, 0)
        await denied { try await self.service.playback(contentId: "demo-round-1-blair-reply", kind: .reply, asset: "video") }
        try await service.block(userId: "alex", blocked: true)
        await denied { try await self.service.detail(originalId: "demo-round-1-alex") }
        await denied { try await self.service.playback(contentId: "demo-round-1-alex", kind: .original, asset: "video") }
    }

    func testReceiptSurvivesDeletionAndNextRoundRelocks() async throws {
        let result = try await publish(draft())
        try await service.deleteContent(id: result.originalId!, kind: .original)
        let after = try await service.today()
        checkTrue(after.canViewFriends)
        XCTAssertNil(after.ownOriginal)
        XCTAssertNil(after.viewerReceipt?.originalId)
        do { _ = try await service.beginUpload(draft: draft()); XCTFail("No second original") } catch { checkEqual((error as? ServiceFailure)?.code, "ALREADY_PUBLISHED") }
        service.releaseRound(2)
        let newRound = try await service.today()
        checkFalse(newRound.canViewFriends)
        checkEqual(newRound.round?.id, "demo-round-2")
        await denied { try await self.service.feed(roundId: "demo-round-2", cursor: nil) }
        await denied { try await self.service.detail(originalId: "demo-round-1-alex") }
    }

    func testReplyPublicationDoesNotCreateFeedItem() async throws {
        _ = try await publish(draft())
        let before = try await service.feed(roundId: "demo-round-1", cursor: nil)
        let reply = try await publish(draft("demo-round-1-alex"))
        XCTAssertNotNil(reply.replyId)
        XCTAssertNil(reply.receipt)
        let after = try await service.feed(roundId: "demo-round-1", cursor: nil)
        checkEqual(before.items.map(\.id), after.items.map(\.id))
        let conversation = try await service.replies(originalId: "demo-round-1-alex", cursor: nil)
        checkEqual(conversation.items.count, 2)
        checkEqual(conversation.items.last?.id, reply.replyId)
    }

    func testSameRequestFinalizationsAreIdempotent() async throws {
        let value = try await draft()
        let intent = try await service.beginUpload(draft: value)
        try await service.upload(clip: value.clip!, intent: intent) { _ in }
        async let first = service.finalize(uploadId: intent.uploadId)
        async let second = service.finalize(uploadId: intent.uploadId)
        let results = try await [first, second]
        checkEqual(results[0], results[1])
        checkEqual(try await service.profile(cursor: nil).originals.items.count, 1)
    }

    func testDemoPersistsSeparatelyAndResetRestoresMatrix() async throws {
        _ = try await publish(draft())
        let reopened = DemoService(directory: directory)
        checkTrue(try await reopened.today().canViewFriends)
        reopened.releaseRound(2)
        checkFalse(try await reopened.today().canViewFriends)
        reopened.reset()
        checkEqual(reopened.identity, .casey)
        checkFalse(try await reopened.today().canViewFriends)
        checkEqual(try await reopened.friends().approved.map(\.id).sorted(), ["alex", "blair"])
    }

    func testBundledFixturesArePlayableBoundedMP4WithAudio() async throws {
        for name in ["sample-alex", "sample-blair"] {
            let url = try XCTUnwrap(DemoService.fixtureURL(name))
            let asset = AVURLAsset(url: url)
            checkTrue(try await asset.load(.isPlayable))
            let duration = try await asset.load(.duration).seconds
            XCTAssertGreaterThan(duration, 0)
            XCTAssertLessThanOrEqual(duration, 15)
            checkFalse(try await asset.loadTracks(withMediaType: .audio).isEmpty)
            checkFalse(try await asset.loadTracks(withMediaType: .video).isEmpty)
        }
    }

    func testConcurrentDifferentOriginalsCommitOnlyOnce() async throws {
        let first = try await draft()
        let second = try await draft()
        let firstIntent = try await service.beginUpload(draft: first)
        let secondIntent = try await service.beginUpload(draft: second)
        try await service.upload(clip: first.clip!, intent: firstIntent) { _ in }
        try await service.upload(clip: second.clip!, intent: secondIntent) { _ in }
        let firstTask = Task { try await service.finalize(uploadId: firstIntent.uploadId) }
        let secondTask = Task { try await service.finalize(uploadId: secondIntent.uploadId) }
        var successes = 0
        for task in [firstTask, secondTask] {
            do { _ = try await task.value; successes += 1 }
            catch { checkEqual((error as? ServiceFailure)?.code, "ALREADY_PUBLISHED") }
        }
        checkEqual(successes, 1)
        checkEqual(try await service.profile(cursor: nil).originals.items.count, 1)
    }

    func testDeletionRemovesContentAndRelationships() async throws {
        let result = try await publish(draft())
        try await service.requestDeletion()
        service.switchIdentity(.alex)
        checkFalse(try await service.friends().approved.contains { $0.id == "casey" })
        await denied { try await self.service.detail(originalId: result.originalId!) }
        checkTrue(try await service.search(username: "casey").isEmpty)
    }

    func testStaleIdentityCannotPersistAnotherViewersDraft() async throws {
        let model = AppModel()
        model.service = service
        model.viewer = try await service.session().profile
        model.acceptToday(try await service.today())
        let prior = try await draft()
        service.switchIdentity(.dana)
        _ = model.saveDraft(prior)
        XCTAssertNil(model.recoveredDraft)
    }

    func testNewRoundRejectsOutOfOrderUnlockedSnapshotAndMediaCallback() async throws {
        _ = try await publish(draft())
        let model = AppModel()
        model.service = service
        let old = try await service.today()
        checkTrue(model.acceptToday(old))
        let generation = model.generation
        let revision = model.accessRevision
        service.releaseRound(2)
        let next = try await service.today()
        let orderedNext = TodayState(serverNow: old.serverNow + 100, round: next.round, viewerReceipt: next.viewerReceipt, canViewFriends: next.canViewFriends, ownOriginal: next.ownOriginal, friendPresence: next.friendPresence)
        checkTrue(model.acceptToday(orderedNext))
        checkFalse(model.isCurrentAccess(generation: generation, revision: revision))
        checkFalse(model.acceptToday(old))
        checkFalse(model.today!.canViewFriends)
        checkEqual(model.today!.round!.id, "demo-round-2")
        checkTrue(model.feed.isEmpty)
    }

    func testSignOutRemovesPersistedDraftBeforeIdentityIsCleared() async throws {
        let model = AppModel()
        model.service = service
        model.viewer = try await service.session().profile
        model.acceptToday(try await service.today())
        let stored = model.saveDraft(try await draft())
        let file = try XCTUnwrap(stored.clip?.url)
        checkTrue(FileManager.default.fileExists(atPath: file.path))
        await model.signOut()
        checkFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertNil(model.recoveredDraft)
        XCTAssertNil(model.service)
    }

    func testTransientAuthenticationFailureRevokesAccessButPreservesRetryClip() async throws {
        checkTrue(FirebaseAuthentication.isTransientTokenError(NSError(domain: AuthErrorDomain, code: AuthErrorCode.networkError.rawValue)))
        checkTrue(FirebaseAuthentication.isTransientTokenError(URLError(.notConnectedToInternet)))
        checkFalse(FirebaseAuthentication.isTransientTokenError(NSError(domain: AuthErrorDomain, code: AuthErrorCode.userDisabled.rawValue)))
        let model = AppModel()
        model.service = service
        model.viewer = try await service.session().profile
        model.acceptToday(try await service.today())
        let stored = model.saveDraft(try await draft())
        let file = try XCTUnwrap(stored.clip?.url)
        let epoch = model.generation
        let revision = model.accessRevision
        model.authenticationPaused()
        checkFalse(model.isCurrentAccess(generation: epoch, revision: revision))
        XCTAssertNil(model.today)
        checkEqual(model.recoveredDraft?.id, stored.id)
        checkTrue(FileManager.default.fileExists(atPath: file.path))
        await model.refresh()
        XCTAssertNotNil(model.today)
        checkEqual(model.recoveredDraft?.id, stored.id)
        checkTrue(FileManager.default.fileExists(atPath: file.path))
        model.clearDraft()
    }

    func testCachedAndForcedTokenBoundaryNotifiesCurrentFailureOnly() async throws {
        var failureCalls = 0
        let failure: (Error) -> ServiceFailure = { error in
            failureCalls += 1
            return ServiceFailure(code: FirebaseAuthentication.isTransientTokenError(error) ? "AUTH_NETWORK" : "UNAUTHENTICATED", message: "Unavailable", retryable: true)
        }
        do {
            _ = try await FirebaseAuthentication.retrieveToken({ throw URLError(.notConnectedToInternet) }, isCurrent: { true }, onFailure: failure)
            XCTFail("A cached refresh must fail closed")
        } catch { checkEqual((error as? ServiceFailure)?.code, "AUTH_NETWORK") }
        checkEqual(failureCalls, 1)
        do {
            _ = try await FirebaseAuthentication.retrieveToken({ throw URLError(.notConnectedToInternet) }, isCurrent: { false }, onFailure: failure)
            XCTFail("An old binding must be cancelled")
        } catch { checkTrue(error is CancellationError) }
        do {
            _ = try await FirebaseAuthentication.retrieveToken({ "older-binding-token" }, isCurrent: { false }, onFailure: failure)
            XCTFail("An old binding must not return a token")
        } catch { checkTrue(error is CancellationError) }
        checkEqual(failureCalls, 1)
        checkEqual(try await FirebaseAuthentication.retrieveToken({ "current-binding-token" }, isCurrent: { true }, onFailure: failure), "current-binding-token")
        checkEqual(failureCalls, 1)
    }
}
