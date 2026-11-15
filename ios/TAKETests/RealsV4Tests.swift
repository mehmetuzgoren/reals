import Foundation
import XCTest
@testable import TAKE

@MainActor
final class RealsV4Tests: XCTestCase {
    private var directory: URL!
    private var service: DemoService!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("RealsV4Tests-\(UUID().uuidString)", isDirectory: true)
        service = DemoService(directory: directory, reset: true, scenario: .mocks)
    }

    override func tearDown() async throws {
        service?.stopWatching()
        service = nil
        try? FileManager.default.removeItem(at: directory)
        directory = nil
    }

    private let roundID = "demo-round-mocks"
    private let battleID = "demo-mocks-battle"
    private func originalID(_ author: String) -> String { "\(roundID)-\(author)" }

    private func draft(parent: String? = nil, audience: Audience = .friends, duration: Double = 4_000) async throws -> PublicationDraft {
        let today = try await service.today()
        let round = try XCTUnwrap(today.round)
        let clip = RecordedClip(url: try XCTUnwrap(DemoService.fixtureURL()), durationMs: duration, source: .simulatorFixture, createdAt: Date())
        return PublicationDraft(id: UUID().uuidString, ownerId: try XCTUnwrap(service.viewerID), isDemo: true, roundId: round.id, optionId: parent == nil ? round.options[1].id : nil, originalId: parent, clip: clip, uploadId: nil, state: .preview, failure: nil, audience: audience)
    }

    @discardableResult
    private func publish(parent: String? = nil, audience: Audience = .friends) async throws -> PublicationResult {
        let draft = try await self.draft(parent: parent, audience: audience)
        let intent = try await service.beginUpload(draft: draft)
        try await service.upload(clip: try XCTUnwrap(draft.clip), intent: intent) { _ in }
        let result = try await service.finalize(uploadId: intent.uploadId)
        XCTAssertEqual(result.state, "published")
        return result
    }

    private func assertFailure<Value>(_ code: String, file: StaticString = #filePath, line: UInt = #line, _ operation: () async throws -> Value) async {
        do {
            _ = try await operation()
            XCTFail("Expected \(code)", file: file, line: line)
        } catch {
            XCTAssertEqual((error as? ServiceFailure)?.code, code, file: file, line: line)
        }
    }

    private func assertLocked(file: StaticString = #filePath, line: UInt = #line) async throws {
        let today = try await service.today()
        let friends = try await service.feed(roundId: roundID, cursor: nil)
        let publicTakes = try await service.forYou(roundId: roundID, cursor: nil)
        XCTAssertFalse(today.canViewFriends, file: file, line: line)
        XCTAssertNil(today.viewerReceipt, file: file, line: line)
        XCTAssertNil(today.ownOriginal, file: file, line: line)
        XCTAssertTrue(friends.items.isEmpty, file: file, line: line)
        XCTAssertNil(friends.nextCursor, file: file, line: line)
        XCTAssertTrue(publicTakes.items.isEmpty, file: file, line: line)
        XCTAssertNil(publicTakes.nextCursor, file: file, line: line)
    }

    private func storedState(_ scenario: DemoScenario = .mocks) throws -> DemoService.State {
        let file = directory.appendingPathComponent(scenario.rawValue, isDirectory: true).appendingPathComponent("state.json")
        return try JSONDecoder().decode(DemoService.State.self, from: Data(contentsOf: file))
    }

    private func replaceMockState(_ mutate: (inout DemoService.State) -> Void) throws {
        service.stopWatching()
        var state = try storedState()
        mutate(&state)
        let file = directory.appendingPathComponent("mocks", isDirectory: true).appendingPathComponent("state.json")
        try JSONEncoder().encode(state).write(to: file, options: .atomic)
        service = DemoService(directory: directory, scenario: .mocks)
    }

    private func pairOwnPublicTake(_ ownID: String) throws {
        let jordanID = originalID("jordan")
        try replaceMockState { state in
            state.battles = [DemoService.Battle(id: battleID, roundId: roundID, leftId: jordanID, rightId: ownID)]
        }
    }

    func testMocksDefaultPromptIsOfflineAndContainsNoUnlockedContent() async throws {
        XCTAssertTrue(service.isDemo)
        XCTAssertEqual(service.demoScenario, .mocks)
        XCTAssertNil(service as? any LiveAuthenticationService)
        let session = try await service.session()
        XCTAssertEqual(session.profile?.displayName, "You")
        XCTAssertEqual(session.profile?.username, "you")
        let today = try await service.today()
        XCTAssertEqual(today.round?.id, roundID)
        XCTAssertEqual(today.round?.question, "Is a hot dog a sandwich?")
        XCTAssertEqual(today.round?.options.map(\.label), ["Yes", "No"])
        try await assertLocked()
        let wire = String(decoding: try JSONEncoder().encode(today), as: UTF8.self)
        for forbidden in ["optionId", "thumbnailAssetId", "likeCount", "visibleCommentCount", "battleId", ".mp4"] {
            XCTAssertFalse(wire.contains(forbidden), forbidden)
        }
        await assertFailure("NOT_FOUND") { try await self.service.detail(originalId: self.originalID("sam")) }
        await assertFailure("NOT_FOUND") { try await self.service.detail(originalId: self.originalID("jordan")) }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: self.originalID("jordan"), kind: .original, asset: "video") }
        await assertFailure("NOT_FOUND") { try await self.service.comments(contentId: self.originalID("jordan"), kind: .original, cursor: nil) }
        await assertFailure("NOT_FOUND") { try await self.service.battle(battleId: self.battleID) }
    }

    func testBothFeedsWaitForSuccessfulOriginalPublicationNotUploadOrFailure() async throws {
        let draft = try await self.draft()
        let intent = try await service.beginUpload(draft: draft)
        XCTAssertEqual(intent.minDurationMs, 3_000)
        XCTAssertEqual(intent.maxDurationMs, 15_000)
        XCTAssertEqual(intent.maxBytes, 8_388_608)
        try await assertLocked()
        service.failNextUpload()
        await assertFailure("DEMO_UPLOAD_FAILED") {
            try await self.service.upload(clip: try XCTUnwrap(draft.clip), intent: intent) { _ in }
        }
        try await assertLocked()
        try await service.upload(clip: try XCTUnwrap(draft.clip), intent: intent) { _ in }
        let uploaded = try await service.uploadStatus(uploadId: intent.uploadId)
        XCTAssertEqual(uploaded.progress, 1)
        XCTAssertNil(uploaded.result)
        try await assertLocked()
        let result = try await service.finalize(uploadId: intent.uploadId)
        XCTAssertEqual(result.state, "published")
        XCTAssertEqual(result.receipt?.roundId, roundID)
        let repeated = try await service.finalize(uploadId: intent.uploadId)
        XCTAssertEqual(repeated, result)
        let friends = try await service.feed(roundId: roundID, cursor: nil)
        let publicTakes = try await service.forYou(roundId: roundID, cursor: nil)
        XCTAssertEqual(friends.items.map(\.author.displayName), ["Sam", "Priya"])
        XCTAssertEqual(publicTakes.items.map(\.author.username), ["jordan.lee", "mira_k"])
    }

    func testAnotherRoundsReceiptDoesNotUnlockEitherFeedOrKnownIDs() async throws {
        try replaceMockState { state in
            state.receipts.append(DemoService.Receipt(userId: "casey", value: SubmissionReceipt(roundId: DemoService.round(1).id, publishedAt: 1_700_000_000_000, originalId: nil)))
        }
        try await assertLocked()
        let jordanID = originalID("jordan")
        await assertFailure("NOT_FOUND") { try await self.service.detail(originalId: jordanID) }
        await assertFailure("NOT_FOUND") { try await self.service.replies(originalId: jordanID, cursor: nil) }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: "\(jordanID)-reply-1", kind: .reply, asset: "video") }
        await assertFailure("NOT_FOUND") { try await self.service.toggleLike(contentId: jordanID, kind: .original) }
        await assertFailure("NOT_FOUND") { try await self.service.createComment(contentId: jordanID, kind: .original, text: "A fictional demo opinion.") }
        await assertFailure("NOT_FOUND") { try await self.service.vote(battleId: self.battleID, side: .left) }
    }

    func testExactSamPriyaAndPublicSeedCountsAndReplyOrder() async throws {
        try await publish()
        let sam = try await service.detail(originalId: originalID("sam"))
        let priya = try await service.detail(originalId: originalID("priya"))
        let jordan = try await service.detail(originalId: originalID("jordan"))
        XCTAssertEqual(sam.audience, .friends)
        XCTAssertEqual(sam.optionId, "mocks-yes")
        XCTAssertEqual(sam.likeCount, 3)
        XCTAssertEqual(sam.visibleCommentCount, 1)
        XCTAssertEqual(sam.visibleReplyCount, 3)
        XCTAssertEqual(priya.optionId, "mocks-no")
        XCTAssertEqual(priya.likeCount, 5)
        XCTAssertEqual(priya.visibleCommentCount, 2)
        XCTAssertEqual(priya.visibleReplyCount, 0)
        XCTAssertEqual(jordan.audience, .public)
        XCTAssertEqual(jordan.likeCount, 248)
        XCTAssertEqual(jordan.visibleCommentCount, 56)
        XCTAssertEqual(jordan.visibleReplyCount, 14)
        XCTAssertEqual(jordan.battle?.battleId, battleID)
        XCTAssertEqual(jordan.battle?.opponent.username, "mira_k")
        let replies = try await service.replies(originalId: sam.id, cursor: nil)
        XCTAssertEqual(replies.items.map(\.author.displayName), ["Priya", "Dev", "Maya"])
        XCTAssertEqual(replies.items.first?.likeCount, 4)
        XCTAssertEqual(replies.items.first?.visibleCommentCount, 0)
        XCTAssertTrue(replies.items.allSatisfy { $0.audience == .friends })
        XCTAssertNil(replies.nextCursor)
        let comments = try await service.comments(contentId: sam.id, kind: .original, cursor: nil)
        XCTAssertEqual(comments.items.first?.author.displayName, "Dev")
        XCTAssertEqual(comments.items.first?.text, "By that logic a taco is a sandwich too.")
        XCTAssertTrue(service.isSampleClip(sam.id, kind: .original))
        XCTAssertTrue(service.isSampleClip(jordan.id, kind: .original))
    }

    func testPublicCommentsPaginateAll56VisibleRowsChronologicallyExactlyOnce() async throws {
        try await publish()
        let first = try await service.comments(contentId: originalID("jordan"), kind: .original, cursor: nil)
        XCTAssertEqual(first.items.count, 50)
        let cursor = try XCTUnwrap(first.nextCursor)
        XCTAssertEqual(cursor, first.items.last?.commentId)
        let second = try await service.comments(contentId: originalID("jordan"), kind: .original, cursor: cursor)
        XCTAssertEqual(second.items.count, 6)
        XCTAssertNil(second.nextCursor)
        let comments = first.items + second.items
        XCTAssertEqual(Set(comments.map(\.commentId)).count, 56)
        XCTAssertEqual(comments.map(\.createdAt), comments.map(\.createdAt).sorted())
        XCTAssertEqual(comments.first?.author.id, "mock-guest-1")
        XCTAssertEqual(comments.last?.author.id, "mock-guest-56")
        XCTAssertTrue(comments.allSatisfy { !$0.viewerCanDelete })
    }

    func testLikesToggleOnePersonsSingleLikeAndPersistAcrossReload() async throws {
        try await publish()
        let samID = originalID("sam")
        let liked = try await service.toggleLike(contentId: samID, kind: .original)
        XCTAssertTrue(liked.liked)
        XCTAssertEqual(liked.likeCount, 4)
        let unliked = try await service.toggleLike(contentId: samID, kind: .original)
        XCTAssertFalse(unliked.liked)
        XCTAssertEqual(unliked.likeCount, 3)
        _ = try await service.toggleLike(contentId: samID, kind: .original)
        service = DemoService(directory: directory, scenario: .mocks)
        let restored = try await service.detail(originalId: samID)
        XCTAssertTrue(restored.viewerLiked)
        XCTAssertEqual(restored.likeCount, 4)
        let state = try storedState()
        XCTAssertEqual(state.likes.filter { $0.userId == "casey" && $0.contentId == samID && $0.kind == .original }.count, 1)
        let replyLike = try await service.toggleLike(contentId: "\(samID)-reply-1", kind: .reply)
        XCTAssertEqual(replyLike.likeCount, 5)
        let unchanged = try await service.detail(originalId: samID)
        XCTAssertEqual(unchanged.likeCount, 4)
    }

    func testReplyInheritsPublicAudienceWithoutReplacingOriginalReceipt() async throws {
        let original = try await publish()
        let result = try await publish(parent: originalID("jordan"))
        let replyID = try XCTUnwrap(result.replyId)
        let replies = try await service.replies(originalId: originalID("jordan"), cursor: nil)
        let reply = try XCTUnwrap(replies.items.first { $0.id == replyID })
        XCTAssertEqual(reply.audience, .public)
        XCTAssertEqual(replies.items.count, 15)
        XCTAssertNil(result.receipt)
        let today = try await service.today()
        XCTAssertEqual(today.viewerReceipt, original.receipt)
        XCTAssertEqual(today.ownOriginal?.audience, .friends)
        let publicTakes = try await service.forYou(roundId: roundID, cursor: nil)
        XCTAssertEqual(publicTakes.items.count, 2)
        XCTAssertFalse(publicTakes.items.contains { $0.id == replyID })
    }

    func testReplyDraftCannotPromoteFriendsParentToPublic() async throws {
        try await publish()
        let result = try await publish(parent: originalID("sam"), audience: .public)
        let replyID = try XCTUnwrap(result.replyId)
        let replies = try await service.replies(originalId: originalID("sam"), cursor: nil)
        XCTAssertEqual(replies.items.first { $0.id == replyID }?.audience, .friends)
        let publicTakes = try await service.forYou(roundId: roundID, cursor: nil)
        XCTAssertFalse(publicTakes.items.contains { $0.id == originalID("sam") || $0.id == replyID })
    }

    func testPublicAccessCannotBypassRevokedFriendsParentAccess() async throws {
        try await publish()
        try await service.removeFriend(userId: "sam")
        let publicTake = try await service.detail(originalId: originalID("jordan"))
        XCTAssertEqual(publicTake.audience, .public)
        await assertFailure("NOT_FOUND") { try await self.service.detail(originalId: self.originalID("sam")) }
        await assertFailure("NOT_FOUND") { try await self.service.replies(originalId: self.originalID("sam"), cursor: nil) }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: "\(self.originalID("sam"))-reply-1", kind: .reply, asset: "video") }
        await assertFailure("NOT_FOUND") { try await self.service.comments(contentId: self.originalID("sam"), kind: .original, cursor: nil) }
    }

    func testBlockedPublicAuthorRevokesFeedBattleAndDirectInteractions() async throws {
        try await publish()
        let jordanID = originalID("jordan")
        try await service.block(userId: "jordan", blocked: true)
        let feed = try await service.forYou(roundId: roundID, cursor: nil)
        XCTAssertEqual(feed.items.map(\.author.username), ["mira_k"])
        XCTAssertNil(feed.items.first?.battle)
        await assertFailure("NOT_FOUND") { try await self.service.detail(originalId: jordanID) }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: jordanID, kind: .original, asset: "video") }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: "\(jordanID)-reply-1", kind: .reply, asset: "video") }
        await assertFailure("NOT_FOUND") { try await self.service.comments(contentId: jordanID, kind: .original, cursor: nil) }
        await assertFailure("NOT_FOUND") { try await self.service.toggleLike(contentId: jordanID, kind: .original) }
        await assertFailure("NOT_FOUND") { try await self.service.battle(battleId: self.battleID) }
        try await service.block(userId: "jordan", blocked: false)
        let restored = try await service.detail(originalId: jordanID)
        XCTAssertEqual(restored.visibleCommentCount, 56)
    }

    func testBlockedReplyCommenterFiltersCountsAndPaginationBeforeSlicing() async throws {
        try await publish()
        let jordanID = originalID("jordan")
        try await service.block(userId: "mock-guest-1", blocked: true)
        let jordan = try await service.detail(originalId: jordanID)
        XCTAssertEqual(jordan.visibleReplyCount, 13)
        XCTAssertEqual(jordan.visibleCommentCount, 55)
        XCTAssertEqual(jordan.likeCount, 248)
        let replies = try await service.replies(originalId: jordanID, cursor: nil)
        XCTAssertEqual(replies.items.count, 13)
        XCTAssertFalse(replies.items.contains { $0.author.id == "mock-guest-1" })
        let first = try await service.comments(contentId: jordanID, kind: .original, cursor: nil)
        let second = try await service.comments(contentId: jordanID, kind: .original, cursor: try XCTUnwrap(first.nextCursor))
        XCTAssertEqual(first.items.count, 50)
        XCTAssertEqual(second.items.count, 5)
        XCTAssertNil(second.nextCursor)
        XCTAssertFalse((first.items + second.items).contains { $0.author.id == "mock-guest-1" })
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: "\(jordanID)-reply-1", kind: .reply, asset: "video") }
        try await service.block(userId: "dev", blocked: true)
        let sam = try await service.detail(originalId: originalID("sam"))
        XCTAssertEqual(sam.visibleReplyCount, 2)
        XCTAssertEqual(sam.visibleCommentCount, 0)
    }

    func testPrivateAuthorCommenterFriendshipRevocationHidesThirdViewerCounts() async throws {
        try await publish()
        try replaceMockState { state in state.friendships.removeAll { $0 == "dev:sam" } }
        let friends = try await service.friends()
        XCTAssertTrue(friends.approved.contains { $0.id == "sam" })
        XCTAssertTrue(friends.approved.contains { $0.id == "dev" })
        let sam = try await service.detail(originalId: originalID("sam"))
        XCTAssertEqual(sam.visibleReplyCount, 2)
        XCTAssertEqual(sam.visibleCommentCount, 0)
        let comments = try await service.comments(contentId: sam.id, kind: .original, cursor: nil)
        XCTAssertTrue(comments.items.isEmpty)
        await assertFailure("NOT_FOUND") { try await self.service.report(contentId: "\(sam.id)-comment-1", kind: .comment, reason: "Demo privacy regression") }
    }

    func testCommentsTrimAndAllowOnlyTheirAuthorOrContentOwnerToDelete() async throws {
        try await publish()
        let samID = originalID("sam")
        let created = try await service.createComment(contentId: samID, kind: .original, text: "  A fictional lunch debate. \n")
        let page = try await service.comments(contentId: samID, kind: .original, cursor: nil)
        let comment = try XCTUnwrap(page.items.first { $0.commentId == created.commentId })
        XCTAssertEqual(comment.text, "A fictional lunch debate.")
        XCTAssertTrue(comment.viewerCanDelete)
        XCTAssertFalse(try XCTUnwrap(page.items.first { $0.author.id == "dev" }).viewerCanDelete)
        await assertFailure("FORBIDDEN") { try await self.service.deleteComment(commentId: "\(samID)-comment-1") }
        await assertFailure("INVALID_ARGUMENT") { try await self.service.createComment(contentId: samID, kind: .original, text: " \n ") }
        await assertFailure("INVALID_ARGUMENT") { try await self.service.createComment(contentId: samID, kind: .original, text: String(repeating: "x", count: 301)) }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: comment.commentId, kind: .comment, asset: "video") }
        try await service.deleteComment(commentId: comment.commentId)
        let restored = try await service.detail(originalId: samID)
        XCTAssertEqual(restored.visibleCommentCount, 1)
    }

    func testBattleStarts55To45AndEachPersonHasOneMovableVote() async throws {
        try await publish()
        let initial = try await service.battle(battleId: battleID)
        XCTAssertEqual(initial.left.author.username, "jordan.lee")
        XCTAssertEqual(initial.right.author.username, "mira_k")
        XCTAssertEqual(initial.leftVotes, 55)
        XCTAssertEqual(initial.rightVotes, 45)
        XCTAssertNil(initial.viewerVote)
        XCTAssertTrue(initial.viewerCanVote)
        let left = try await service.vote(battleId: battleID, side: .left)
        XCTAssertEqual(left.leftVotes, 56)
        XCTAssertEqual(left.rightVotes, 45)
        let repeatedLeft = try await service.vote(battleId: battleID, side: .left)
        XCTAssertEqual(repeatedLeft, left)
        let right = try await service.vote(battleId: battleID, side: .right)
        XCTAssertEqual(right.leftVotes, 55)
        XCTAssertEqual(right.rightVotes, 46)
        XCTAssertEqual(right.viewerVote, .right)
        let repeatedRight = try await service.vote(battleId: battleID, side: .right)
        XCTAssertEqual(repeatedRight, right)
        let state = try storedState()
        XCTAssertEqual(state.votes.filter { $0.battleId == battleID && $0.userId == "casey" }.count, 1)
    }

    func testPublicTakeAuthorCannotVoteInTheirBattle() async throws {
        let publication = try await publish(audience: .public)
        try pairOwnPublicTake(try XCTUnwrap(publication.originalId))
        let battle = try await service.battle(battleId: battleID)
        XCTAssertEqual(battle.right.author.id, service.viewerID)
        XCTAssertFalse(battle.viewerCanVote)
        await assertFailure("FORBIDDEN") { try await self.service.vote(battleId: self.battleID, side: .left) }
        await assertFailure("FORBIDDEN") { try await self.service.vote(battleId: self.battleID, side: .right) }
        let unchanged = try await service.battle(battleId: battleID)
        XCTAssertEqual(unchanged.leftVotes, 55)
        XCTAssertEqual(unchanged.rightVotes, 45)
        XCTAssertNil(unchanged.viewerVote)
    }

    func testZeroVoteBattleHasNoInventedVotesBeforeFirstSelection() async throws {
        try await publish()
        try replaceMockState { state in state.votes.removeAll() }
        let initial = try await service.battle(battleId: battleID)
        XCTAssertEqual(initial.leftVotes, 0)
        XCTAssertEqual(initial.rightVotes, 0)
        XCTAssertNil(initial.viewerVote)
        XCTAssertTrue(initial.viewerCanVote)
        let first = try await service.vote(battleId: battleID, side: .right)
        XCTAssertEqual(first.leftVotes, 0)
        XCTAssertEqual(first.rightVotes, 1)
        XCTAssertEqual(first.viewerVote, .right)
    }

    func testOriginalDeletionCascadesRepliesLikesCommentsBattleButKeepsUnlock() async throws {
        let original = try await publish(audience: .public)
        let ownID = try XCTUnwrap(original.originalId)
        let reply = try await publish(parent: ownID)
        let replyID = try XCTUnwrap(reply.replyId)
        _ = try await service.toggleLike(contentId: ownID, kind: .original)
        _ = try await service.toggleLike(contentId: replyID, kind: .reply)
        _ = try await service.createComment(contentId: ownID, kind: .original, text: "Fictional original comment.")
        _ = try await service.createComment(contentId: replyID, kind: .reply, text: "Fictional reply comment.")
        try pairOwnPublicTake(ownID)
        try await service.deleteContent(id: ownID, kind: .original)
        let state = try storedState()
        XCTAssertFalse(state.originals.contains { $0.summary.id == ownID })
        XCTAssertFalse(state.replies.contains { $0.summary.originalId == ownID })
        XCTAssertFalse(state.likes.contains { $0.contentId == ownID || $0.contentId == replyID })
        XCTAssertFalse(state.comments.contains { $0.contentId == ownID || $0.contentId == replyID })
        XCTAssertFalse(state.battles.contains { $0.id == battleID })
        XCTAssertFalse(state.votes.contains { $0.battleId == battleID })
        let today = try await service.today()
        XCTAssertTrue(today.canViewFriends)
        XCTAssertEqual(today.viewerReceipt?.roundId, roundID)
        XCTAssertNil(today.viewerReceipt?.originalId)
        XCTAssertNil(today.ownOriginal)
        let survivor = try await service.detail(originalId: originalID("jordan"))
        XCTAssertNil(survivor.battle)
        XCTAssertEqual(survivor.visibleReplyCount, 14)
        await assertFailure("NOT_FOUND") { try await self.service.battle(battleId: self.battleID) }
        await assertFailure("NOT_FOUND") { try await self.service.playback(contentId: replyID, kind: .reply, asset: "video") }
        await assertFailure("NOT_FOUND") { try await self.service.comments(contentId: ownID, kind: .original, cursor: nil) }
        let replacement = try await draft()
        await assertFailure("ALREADY_PUBLISHED") { try await self.service.beginUpload(draft: replacement) }
    }

    func testScenarioPersistenceAndResetNeverMixLegacyWithMocks() async throws {
        let mockPublication = try await publish()
        let mockID = try XCTUnwrap(mockPublication.originalId)
        _ = try await service.toggleLike(contentId: originalID("sam"), kind: .original)
        service.switchScenario(.legacy)
        let legacyLocked = try await service.today()
        XCTAssertEqual(legacyLocked.round?.question, "Do you like pineapple on pizza?")
        XCTAssertNil(legacyLocked.viewerReceipt)
        let legacyPublication = try await publish()
        let legacyID = try XCTUnwrap(legacyPublication.originalId)
        service.switchScenario(.mocks)
        let restored = try await service.today()
        XCTAssertEqual(restored.viewerReceipt?.originalId, mockID)
        let sam = try await service.detail(originalId: originalID("sam"))
        XCTAssertEqual(sam.likeCount, 4)
        let mockClip = try XCTUnwrap(storedState().originals.first { $0.summary.id == mockID }?.clip.url)
        let legacyClip = try XCTUnwrap(storedState(.legacy).originals.first { $0.summary.id == legacyID }?.clip.url)
        XCTAssertNotEqual(mockClip, legacyClip)
        XCTAssertTrue(mockClip.path.hasPrefix(directory.appendingPathComponent("mocks").path + "/"))
        XCTAssertTrue(legacyClip.path.hasPrefix(directory.appendingPathComponent("legacy").path + "/"))
        service.reset()
        try await assertLocked()
        let legacy = DemoService(directory: directory, scenario: .legacy)
        let legacyRestored = try await legacy.today()
        XCTAssertEqual(legacyRestored.viewerReceipt?.originalId, legacyID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: legacyClip.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: mockClip.path))
        legacy.stopWatching()
    }

    func testMissingLegacyAudienceDecodesAsFriendsNeverPublic() async throws {
        try await publish()
        let original = try await service.detail(originalId: originalID("jordan"))
        let replies = try await service.replies(originalId: original.id, cursor: nil)
        let reply = try XCTUnwrap(replies.items.first)
        var originalJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        for key in ["audience", "likeCount", "viewerLiked", "visibleCommentCount", "battle"] { originalJSON.removeValue(forKey: key) }
        let decodedOriginal = try JSONDecoder().decode(OriginalSummary.self, from: JSONSerialization.data(withJSONObject: originalJSON))
        XCTAssertEqual(decodedOriginal.audience, .friends)
        XCTAssertEqual(decodedOriginal.likeCount, 0)
        XCTAssertFalse(decodedOriginal.viewerLiked)
        XCTAssertEqual(decodedOriginal.visibleCommentCount, 0)
        XCTAssertNil(decodedOriginal.battle)
        var replyJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(reply)) as? [String: Any])
        for key in ["audience", "likeCount", "viewerLiked", "visibleCommentCount"] { replyJSON.removeValue(forKey: key) }
        let decodedReply = try JSONDecoder().decode(ReplySummary.self, from: JSONSerialization.data(withJSONObject: replyJSON))
        XCTAssertEqual(decodedReply.audience, .friends)
        XCTAssertEqual(decodedReply.likeCount, 0)
        XCTAssertFalse(decodedReply.viewerLiked)
        let legacyDraft = try await draft(parent: original.id, audience: .public)
        var draftJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(legacyDraft)) as? [String: Any])
        draftJSON.removeValue(forKey: "audience")
        let decodedDraft = try JSONDecoder().decode(PublicationDraft.self, from: JSONSerialization.data(withJSONObject: draftJSON))
        XCTAssertEqual(decodedDraft.audience, .friends)
        let intentJSON = Data("{\"uploadId\":\"legacy-intent\",\"uploadUrl\":\"demo://private-staging/legacy-intent\",\"expiresAt\":1700300000000,\"maxDurationMs\":15000,\"maxBytes\":8388608}".utf8)
        let intent = try JSONDecoder().decode(UploadIntent.self, from: intentJSON)
        XCTAssertEqual(intent.minDurationMs, 3_000)
    }
}
