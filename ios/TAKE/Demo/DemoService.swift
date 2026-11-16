import Foundation

@MainActor
class DemoService: TakeService, DemoControlling {
    struct StoredOriginal: Codable {
        var summary: OriginalSummary
        var clip: RecordedClip
    }
    struct StoredReply: Codable {
        var summary: ReplySummary
        var clip: RecordedClip
    }
    struct Receipt: Codable {
        let userId: String
        var value: SubmissionReceipt
    }
    struct Request: Codable {
        let id: String
        let sender: String
        let recipient: String
        let createdAt: Double
    }
    struct Upload: Codable {
        let owner: String
        let draft: PublicationDraft
        var clip: RecordedClip?
        var result: PublicationResult?
    }
    struct Like: Codable {
        let userId: String
        let contentId: String
        let kind: ContentKind
    }
    struct Comment: Codable {
        let id: String
        let contentId: String
        let kind: ContentKind
        let authorId: String
        let text: String
        let createdAt: Double
    }
    struct Battle: Codable {
        let id: String
        let roundId: String
        let leftId: String
        let rightId: String
    }
    struct Vote: Codable {
        let battleId: String
        let userId: String
        var side: BattleSide
    }
    struct CommentCreation: Codable {
        let userId: String
        let createdAt: Double
    }
    struct State: Codable {
        var schemaVersion = 4
        var scenario: DemoScenario = .legacy
        var identity: DemoIdentity = .casey
        var round = 1
        var profiles: [PublicProfile]
        var friendships: [String]
        var blocks: [String] = []
        var requests: [Request]
        var receipts: [Receipt]
        var originals: [StoredOriginal]
        var replies: [StoredReply]
        var uploads: [String: Upload] = [:]
        var preferences: [String: NotificationPreferences] = [:]
        var failNext = false
        var likes: [Like] = []
        var comments: [Comment] = []
        var battles: [Battle] = []
        var votes: [Vote] = []
        var commentCreations: [CommentCreation] = []
    }

    let isDemo = true
    var viewerID: String? { state.identity.rawValue }
    var serverNow: Double { Date().milliseconds }
    var identity: DemoIdentity { state.identity }
    private(set) var demoScenario: DemoScenario
    private var state: State
    private let rootDirectory: URL
    private var directory: URL { rootDirectory.appendingPathComponent(demoScenario.rawValue, isDirectory: true) }
    private var epoch = 0
    private var listener: ((Result<TodayState, Error>) -> Void)?
    private var conversationListeners: [UUID: () -> Void] = [:]
    private var mine: PublicProfile { state.profiles.first { $0.id == identity.rawValue } ?? PublicProfile(id: identity.rawValue, username: "deleted", displayName: "Deleted demo account", avatar: nil) }
    private var currentRound: DailyRound { demoScenario == .mocks ? Self.mockRound : Self.round(state.round) }

    init(directory: URL? = nil, reset: Bool = false, scenario: DemoScenario = .legacy) {
        rootDirectory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TAKE/Demo", isDirectory: true)
        demoScenario = scenario
        state = Self.seed(scenario)
        load(reset: reset)
    }

    private func load(reset: Bool = false) {
        if reset, let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for file in files { try? FileManager.default.removeItem(at: file) }
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("state.json")
        if !reset, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(State.self, from: data), saved.schemaVersion == 4, saved.scenario == demoScenario {
            state = saved
        } else {
            state = Self.seed(demoScenario)
        }
        if !state.profiles.contains(where: { $0.id == state.identity.rawValue }), let active = DemoIdentity.allCases.first(where: { candidate in state.profiles.contains { $0.id == candidate.rawValue } }) { state.identity = active }
        persist()
    }

    static let mockRound = DailyRound(id: "demo-round-mocks", question: "Is a hot dog a sandwich?", options: [AnswerOption(id: "mocks-yes", label: "Yes"), AnswerOption(id: "mocks-no", label: "No")], opensAt: 1_700_300_000_000, closesAt: nil, isCurrent: true)

    static func round(_ number: Int) -> DailyRound {
        let labels = number == 1 ? ["Yes", "No", "Depends"] : ["Yes", "No", "It's complicated"]
        return DailyRound(id: "demo-round-\(number)", question: number == 1 ? "Do you like pineapple on pizza?" : "Do you think Elon Musk is a genius? How is he successful?", options: labels.enumerated().map { AnswerOption(id: "r\(number)-\($0.offset)", label: $0.element) }, opensAt: 1_700_000_000_000 + Double(number * 86_400_000), closesAt: nil, isCurrent: true)
    }

    static func fixtureURL(_ name: String = "sample-alex") -> URL? {
        Bundle.main.url(forResource: name, withExtension: "mp4")
    }

    private static func seed(_ scenario: DemoScenario) -> State {
        scenario == .mocks ? seedMocks() : seedLegacy()
    }

    private static func seedLegacy() -> State {
        let profiles = DemoIdentity.allCases.map { PublicProfile(id: $0.rawValue, username: $0.rawValue + "_take", displayName: $0.name, avatar: nil) }
        var originals: [StoredOriginal] = []
        var receipts: [Receipt] = []
        var replies: [StoredReply] = []
        for number in 1...2 {
            let round = round(number)
            for (index, id) in ["alex", "blair"].enumerated() {
                let profile = profiles.first { $0.id == id }!
                let original = OriginalSummary(id: "\(round.id)-\(id)", roundId: round.id, author: profile, optionId: round.options[index].id, publishedAt: round.opensAt + Double(index * 5_000), durationMs: 4_000, thumbnailAssetId: nil, visibleReplyCount: 0)
                let clip = RecordedClip(url: fixtureURL("sample-\(id)") ?? URL(fileURLWithPath: "/missing-demo-fixture"), durationMs: 4_000, source: .simulatorFixture, createdAt: Date(milliseconds: original.publishedAt))
                originals.append(StoredOriginal(summary: original, clip: clip))
                receipts.append(Receipt(userId: id, value: SubmissionReceipt(roundId: round.id, publishedAt: original.publishedAt, originalId: original.id)))
            }
            let reply = ReplySummary(id: "\(round.id)-blair-reply", originalId: "\(round.id)-alex", roundId: round.id, author: profiles[1], publishedAt: round.opensAt + 20_000, durationMs: 4_000, thumbnailAssetId: nil)
            replies.append(StoredReply(summary: reply, clip: RecordedClip(url: fixtureURL("sample-blair") ?? URL(fileURLWithPath: "/missing-demo-fixture"), durationMs: 4_000, source: .simulatorFixture, createdAt: Date(milliseconds: reply.publishedAt))))
        }
        return State(profiles: profiles, friendships: [pair("alex", "blair"), pair("alex", "casey"), pair("blair", "casey"), pair("alex", "dana")], requests: [Request(id: "request-dana-casey", sender: "dana", recipient: "casey", createdAt: Date().milliseconds), Request(id: "request-blair-dana", sender: "blair", recipient: "dana", createdAt: Date().milliseconds)], receipts: receipts, originals: originals, replies: replies)
    }

    private static func seedMocks() -> State {
        let round = mockRound
        let friends = ["casey", "sam", "priya", "dev", "maya"]
        var profiles = [PublicProfile(id: "casey", username: "you", displayName: "You", avatar: nil)]
        profiles += ["sam", "priya", "dev", "maya"].map { PublicProfile(id: $0, username: $0, displayName: $0.capitalized, avatar: nil) }
        profiles += [PublicProfile(id: "jordan", username: "jordan.lee", displayName: "Jordan", avatar: nil), PublicProfile(id: "mira", username: "mira_k", displayName: "Mira", avatar: nil)]
        let guests = (1...248).map { PublicProfile(id: "mock-guest-\($0)", username: "mock_guest_\($0)", displayName: "Guest \($0)", avatar: nil) }
        profiles += guests
        var state = State(scenario: .mocks, profiles: profiles, friendships: [], requests: [], receipts: [], originals: [], replies: [])
        for (index, first) in friends.enumerated() {
            for second in friends.dropFirst(index + 1) { state.friendships.append(pair(first, second)) }
        }
        state.friendships.append(pair("priya", guests[0].id))
        let url = fixtureURL("sample-mock") ?? URL(fileURLWithPath: "/missing-demo-fixture/sample-mock.mp4")
        for (index, author) in profiles.enumerated() where author.id != "casey" {
            let hasOriginal = author.id != "dev" && author.id != "maya"
            let id = "\(round.id)-\(author.id)"
            let publishedAt: Double
            switch author.id {
            case "sam": publishedAt = round.opensAt + 60_000
            case "priya": publishedAt = round.opensAt + 30_000
            case "jordan", "mira": publishedAt = round.opensAt + 90_000
            default: publishedAt = round.opensAt + Double(index)
            }
            if hasOriginal {
                let summary = OriginalSummary(id: id, roundId: round.id, author: author, optionId: author.id == "priya" || author.id == "mira" ? round.options[1].id : round.options[0].id, publishedAt: publishedAt, durationMs: 4_000, thumbnailAssetId: nil, visibleReplyCount: 0, audience: author.id == "jordan" || author.id == "mira" ? .public : .friends)
                state.originals.append(StoredOriginal(summary: summary, clip: RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date(milliseconds: publishedAt))))
            }
            state.receipts.append(Receipt(userId: author.id, value: SubmissionReceipt(roundId: round.id, publishedAt: publishedAt, originalId: hasOriginal ? id : nil)))
        }
        let samId = "\(round.id)-sam"
        let priyaId = "\(round.id)-priya"
        let jordanId = "\(round.id)-jordan"
        let miraId = "\(round.id)-mira"
        for (index, authorId) in ["priya", "dev", "maya"].enumerated() {
            let author = profiles.first { $0.id == authorId }!
            let publishedAt = round.opensAt + 100_000 + Double(index)
            let summary = ReplySummary(id: "\(samId)-reply-\(index + 1)", originalId: samId, roundId: round.id, author: author, publishedAt: publishedAt, durationMs: 4_000, thumbnailAssetId: nil)
            state.replies.append(StoredReply(summary: summary, clip: RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date(milliseconds: publishedAt))))
        }
        for (index, author) in guests.prefix(14).enumerated() {
            let publishedAt = round.opensAt + 110_000 + Double(index)
            let summary = ReplySummary(id: "\(jordanId)-reply-\(index + 1)", originalId: jordanId, roundId: round.id, author: author, publishedAt: publishedAt, durationMs: 4_000, thumbnailAssetId: nil, audience: .public)
            state.replies.append(StoredReply(summary: summary, clip: RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date(milliseconds: publishedAt))))
        }
        state.likes += ["priya", "dev", "maya"].map { Like(userId: $0, contentId: samId, kind: .original) }
        state.likes += ["priya", "sam", "dev", "maya", guests[0].id].map { Like(userId: $0, contentId: priyaId, kind: .original) }
        state.likes += ["sam", "priya", "dev", "maya"].map { Like(userId: $0, contentId: "\(samId)-reply-1", kind: .reply) }
        state.likes += guests.map { Like(userId: $0.id, contentId: jordanId, kind: .original) }
        state.comments = [Comment(id: "\(samId)-comment-1", contentId: samId, kind: .original, authorId: "dev", text: "By that logic a taco is a sandwich too.", createdAt: round.opensAt + 120_000), Comment(id: "\(priyaId)-comment-1", contentId: priyaId, kind: .original, authorId: "sam", text: "I'm counting it as its own thing.", createdAt: round.opensAt + 120_001), Comment(id: "\(priyaId)-comment-2", contentId: priyaId, kind: .original, authorId: "maya", text: "A bun doesn't make it a sandwich.", createdAt: round.opensAt + 120_002)]
        let lines = ["The bun is doing a lot of work here.", "A hot dog gets its own category.", "This is a very important lunch debate.", "I can see both sides of this one."]
        for (index, author) in guests.prefix(56).enumerated() {
            state.comments.append(Comment(id: "\(jordanId)-comment-\(index + 1)", contentId: jordanId, kind: .original, authorId: author.id, text: lines[index % lines.count], createdAt: round.opensAt + 130_000 + Double(index)))
        }
        let battleId = "demo-mocks-battle"
        state.battles = [Battle(id: battleId, roundId: round.id, leftId: jordanId, rightId: miraId)]
        state.votes = guests.prefix(100).enumerated().map { Vote(battleId: battleId, userId: $0.element.id, side: $0.offset < 55 ? .left : .right) }
        return state
    }

    private static func pair(_ a: String, _ b: String) -> String { [a, b].sorted().joined(separator: ":") }
    private static func newestFirst(_ values: [OriginalSummary]) -> [OriginalSummary] {
        values.sorted { (a: OriginalSummary, b: OriginalSummary) -> Bool in a.publishedAt == b.publishedAt ? a.id < b.id : a.publishedAt > b.publishedAt }
    }
    private func blocked(_ a: String, _ b: String) -> Bool { state.blocks.contains(a + ":" + b) || state.blocks.contains(b + ":" + a) }
    private func friends(_ a: String, _ b: String) -> Bool { a != b && !blocked(a, b) && state.friendships.contains(Self.pair(a, b)) }
    private func receipt(_ user: String, _ round: String) -> SubmissionReceipt? { state.receipts.first { $0.userId == user && $0.value.roundId == round }?.value }
    private func profile(_ id: String) -> PublicProfile? { state.profiles.first { $0.id == id } }

    private func canView(_ original: OriginalSummary) -> Bool {
        let viewer = identity.rawValue
        guard profile(viewer) != nil, profile(original.author.id) != nil, !blocked(viewer, original.author.id) else { return false }
        if viewer == original.author.id { return true }
        guard receipt(viewer, original.roundId) != nil else { return false }
        return original.audience == .public || (original.roundId == currentRound.id && friends(viewer, original.author.id))
    }

    private func canView(_ reply: ReplySummary) -> Bool {
        guard let original = state.originals.first(where: { $0.summary.id == reply.originalId })?.summary, canView(original), reply.roundId == original.roundId, profile(reply.author.id) != nil else { return false }
        let viewer = identity.rawValue
        guard !blocked(viewer, reply.author.id) else { return false }
        if original.audience == .public { return true }
        guard friends(original.author.id, reply.author.id) else { return false }
        return viewer == original.author.id || viewer == reply.author.id || (receipt(viewer, reply.roundId) != nil && friends(viewer, reply.author.id))
    }

    private func visibleContent(_ contentId: String, _ kind: ContentKind) -> (authorId: String, audience: Audience)? {
        switch kind {
        case .original:
            guard let original = state.originals.first(where: { $0.summary.id == contentId })?.summary, canView(original) else { return nil }
            return (original.author.id, original.audience)
        case .reply:
            guard let reply = state.replies.first(where: { $0.summary.id == contentId })?.summary, canView(reply), let original = state.originals.first(where: { $0.summary.id == reply.originalId })?.summary else { return nil }
            return (reply.author.id, original.audience)
        case .comment:
            return nil
        }
    }

    private func canView(_ comment: Comment) -> Bool {
        guard let content = visibleContent(comment.contentId, comment.kind), profile(comment.authorId) != nil, !blocked(mine.id, comment.authorId) else { return false }
        if content.audience == .public { return true }
        guard content.authorId == comment.authorId || friends(content.authorId, comment.authorId) else { return false }
        return mine.id == content.authorId || mine.id == comment.authorId || (friends(mine.id, content.authorId) && friends(mine.id, comment.authorId))
    }

    private func summary(_ original: OriginalSummary) -> OriginalSummary {
        var result = original
        result.visibleReplyCount = state.replies.filter { $0.summary.originalId == original.id && canView($0.summary) }.count
        result.likeCount = state.likes.filter { $0.contentId == original.id && $0.kind == .original }.count
        result.viewerLiked = state.likes.contains { $0.contentId == original.id && $0.kind == .original && $0.userId == mine.id }
        result.visibleCommentCount = state.comments.filter { $0.contentId == original.id && $0.kind == .original && canView($0) }.count
        result.battle = nil
        if original.audience == .public, let battle = state.battles.first(where: { $0.leftId == original.id || $0.rightId == original.id }), let sides = visibleSides(battle) {
            result.battle = BattleReference(battleId: battle.id, opponent: original.id == sides.left.id ? sides.right.author : sides.left.author)
        }
        return result
    }

    private func summary(_ reply: ReplySummary) -> ReplySummary {
        var result = reply
        result.audience = state.originals.first { $0.summary.id == reply.originalId }?.summary.audience ?? .friends
        result.likeCount = state.likes.filter { $0.contentId == reply.id && $0.kind == .reply }.count
        result.viewerLiked = state.likes.contains { $0.contentId == reply.id && $0.kind == .reply && $0.userId == mine.id }
        result.visibleCommentCount = state.comments.filter { $0.contentId == reply.id && $0.kind == .reply && canView($0) }.count
        return result
    }

    private func visibleSides(_ battle: Battle) -> (left: OriginalSummary, right: OriginalSummary)? {
        guard let left = state.originals.first(where: { $0.summary.id == battle.leftId })?.summary, let right = state.originals.first(where: { $0.summary.id == battle.rightId })?.summary, left.audience == .public, right.audience == .public, left.roundId == battle.roundId, right.roundId == battle.roundId, canView(left), canView(right) else { return nil }
        return (left, right)
    }

    private func page<T: Codable & Equatable>(_ values: [T], cursor: String?, limit: Int, id: (T) -> String) -> Page<T> {
        let start: Int
        if let cursor {
            guard let index = values.firstIndex(where: { id($0) == cursor }) else { return Page(items: [], nextCursor: nil) }
            start = index + 1
        } else { start = 0 }
        let end = min(start + limit, values.count)
        let items = Array(values[start..<end])
        return Page(items: items, nextCursor: end < values.count ? items.last.map(id) : nil)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(state) { try? data.write(to: directory.appendingPathComponent("state.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
    private func changed() {
        persist()
        for callback in conversationListeners.values { callback() }
        if let listener { Task { do { listener(.success(try await today())) } catch { listener(.failure(error)) } } }
    }

    func session() async throws -> ViewerSession { ViewerSession(profile: mine, needsOnboarding: false) }
    func completeOnboarding(username: String, displayName: String) async throws -> PublicProfile {
        let value = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard value.range(of: "^[a-z0-9_]{3,24}$", options: .regularExpression) != nil, !state.profiles.contains(where: { $0.username == value && $0.id != mine.id }) else { throw ServiceFailure(code: "INVALID_USERNAME", message: "Choose an available username with 3–24 letters, numbers or underscores.", retryable: false) }
        let index = state.profiles.firstIndex { $0.id == mine.id }!
        state.profiles[index].username = value
        return try await updateProfile(displayName: displayName, avatar: nil)
    }
    func today() async throws -> TodayState {
        let round = currentRound
        let published = receipt(identity.rawValue, round.id)
        return TodayState(serverNow: Date().milliseconds, round: round, viewerReceipt: published, canViewFriends: published != nil, ownOriginal: state.originals.first { $0.summary.roundId == round.id && $0.summary.author.id == mine.id }.map { summary($0.summary) }, friendPresence: state.profiles.filter { friends(mine.id, $0.id) }.map { FriendPresence(profile: $0, hasPublished: receipt($0.id, round.id) != nil) })
    }
    func watchToday(_ receive: @escaping (Result<TodayState, Error>) -> Void) { listener = receive; changed() }
    func stopWatching() { listener = nil; conversationListeners = [:] }
    func watchConversation(originalId: String, _ changed: @escaping () -> Void) -> () -> Void {
        let id = UUID()
        conversationListeners[id] = changed
        return { [weak self] in self?.conversationListeners.removeValue(forKey: id) }
    }
    func feed(roundId: String, cursor: String?) async throws -> Page<OriginalSummary> {
        guard roundId == currentRound.id, receipt(mine.id, roundId) != nil else {
            if demoScenario == .legacy { throw ServiceFailure.notFound }
            return Page(items: [], nextCursor: nil)
        }
        let viewer = mine.id
        let visible: [OriginalSummary] = state.originals.map(\.summary).filter { (item: OriginalSummary) -> Bool in
            item.roundId == roundId && item.author.id != viewer && friends(viewer, item.author.id) && canView(item)
        }
        let values: [OriginalSummary] = Self.newestFirst(visible).map { (item: OriginalSummary) -> OriginalSummary in summary(item) }
        return page(values, cursor: cursor, limit: 8, id: { $0.id })
    }
    func forYou(roundId: String, cursor: String?) async throws -> Page<OriginalSummary> {
        guard roundId == currentRound.id, receipt(mine.id, roundId) != nil else { return Page(items: [], nextCursor: nil) }
        let viewer = mine.id
        let visible: [OriginalSummary] = state.originals.map(\.summary).filter { (item: OriginalSummary) -> Bool in
            item.roundId == roundId && item.audience == .public && item.author.id != viewer && canView(item)
        }
        let values: [OriginalSummary] = Self.newestFirst(visible).map { (item: OriginalSummary) -> OriginalSummary in summary(item) }
        return page(values, cursor: cursor, limit: 8, id: { $0.id })
    }
    func detail(originalId: String) async throws -> OriginalSummary {
        guard let original = state.originals.first(where: { $0.summary.id == originalId })?.summary, canView(original) else { throw ServiceFailure.notFound }
        return summary(original)
    }
    func replies(originalId: String, cursor: String?) async throws -> Page<ReplySummary> {
        _ = try await detail(originalId: originalId)
        let visible: [ReplySummary] = state.replies.map(\.summary).filter { (item: ReplySummary) -> Bool in item.originalId == originalId && canView(item) }
        let ordered: [ReplySummary] = visible.sorted { (a: ReplySummary, b: ReplySummary) -> Bool in a.publishedAt == b.publishedAt ? a.id < b.id : a.publishedAt < b.publishedAt }
        let values: [ReplySummary] = ordered.map { (item: ReplySummary) -> ReplySummary in summary(item) }
        return page(values, cursor: cursor, limit: 50, id: { $0.id })
    }
    func toggleLike(contentId: String, kind: ContentKind) async throws -> LikeResult {
        guard visibleContent(contentId, kind) != nil else { throw ServiceFailure.notFound }
        let liked: Bool
        if let index = state.likes.firstIndex(where: { $0.contentId == contentId && $0.kind == kind && $0.userId == mine.id }) {
            state.likes.remove(at: index)
            liked = false
        } else {
            state.likes.append(Like(userId: mine.id, contentId: contentId, kind: kind))
            liked = true
        }
        let result = LikeResult(liked: liked, likeCount: state.likes.filter { $0.contentId == contentId && $0.kind == kind }.count)
        changed()
        return result
    }
    func comments(contentId: String, kind: ContentKind, cursor: String?) async throws -> Page<CommentSummary> {
        guard let content = visibleContent(contentId, kind) else { throw ServiceFailure.notFound }
        let values = state.comments.filter { $0.contentId == contentId && $0.kind == kind && canView($0) }.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }.compactMap { comment -> CommentSummary? in
            guard let author = profile(comment.authorId) else { return nil }
            return CommentSummary(commentId: comment.id, author: author, text: comment.text, createdAt: comment.createdAt, viewerCanDelete: mine.id == author.id || mine.id == content.authorId)
        }
        return page(values, cursor: cursor, limit: 50, id: { $0.commentId })
    }
    func createComment(contentId: String, kind: ContentKind, text: String) async throws -> CreateCommentResult {
        guard visibleContent(contentId, kind) != nil else { throw ServiceFailure.notFound }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 300 else { throw ServiceFailure(code: "INVALID_ARGUMENT", message: "Use a comment with 1–300 characters.", retryable: false) }
        let now = serverNow
        state.commentCreations.removeAll { $0.createdAt <= now - 60_000 }
        guard state.commentCreations.filter({ $0.userId == mine.id }).count < 20 else { throw ServiceFailure(code: "RATE_LIMITED", message: "Give the conversation a moment, then try again.", retryable: true) }
        let id = "demo-comment-\(UUID().uuidString)"
        state.comments.append(Comment(id: id, contentId: contentId, kind: kind, authorId: mine.id, text: value, createdAt: now))
        state.commentCreations.append(CommentCreation(userId: mine.id, createdAt: now))
        changed()
        return CreateCommentResult(commentId: id)
    }
    func deleteComment(commentId: String) async throws {
        guard let comment = state.comments.first(where: { $0.id == commentId }), canView(comment), let content = visibleContent(comment.contentId, comment.kind) else { throw ServiceFailure.notFound }
        guard comment.authorId == mine.id || content.authorId == mine.id else { throw ServiceFailure(code: "FORBIDDEN", message: "You can't delete this comment.", retryable: false) }
        state.comments.removeAll { $0.id == commentId }
        changed()
    }
    func battle(battleId: String) async throws -> BattleState {
        guard let battle = state.battles.first(where: { $0.id == battleId }), let sides = visibleSides(battle) else { throw ServiceFailure.notFound }
        let votes = state.votes.filter { $0.battleId == battleId }
        return BattleState(battleId: battleId, roundId: battle.roundId, left: summary(sides.left), right: summary(sides.right), leftVotes: votes.filter { $0.side == .left }.count, rightVotes: votes.filter { $0.side == .right }.count, viewerVote: votes.first { $0.userId == mine.id }?.side, viewerCanVote: mine.id != sides.left.author.id && mine.id != sides.right.author.id)
    }
    func vote(battleId: String, side: BattleSide) async throws -> BattleVoteResult {
        let battle = try await battle(battleId: battleId)
        guard battle.viewerCanVote else { throw ServiceFailure(code: "FORBIDDEN", message: "You can't vote on your own battle.", retryable: false) }
        if let index = state.votes.firstIndex(where: { $0.battleId == battleId && $0.userId == mine.id }) {
            state.votes[index].side = side
        } else { state.votes.append(Vote(battleId: battleId, userId: mine.id, side: side)) }
        let votes = state.votes.filter { $0.battleId == battleId }
        let result = BattleVoteResult(leftVotes: votes.filter { $0.side == .left }.count, rightVotes: votes.filter { $0.side == .right }.count, viewerVote: side)
        changed()
        return result
    }
    private func validate(_ draft: PublicationDraft) throws {
        guard draft.kind != .comment, profile(mine.id) != nil else { throw ServiceFailure.notFound }
        guard draft.isDemo, draft.ownerId == mine.id, draft.roundId == currentRound.id else { throw ServiceFailure(code: "ROUND_CLOSED", message: "A new question is here. Record a take for today's round.", retryable: false) }
        if let originalId = draft.originalId {
            guard let parent = state.originals.first(where: { $0.summary.id == originalId })?.summary, canView(parent), parent.roundId == currentRound.id, receipt(mine.id, parent.roundId) != nil, parent.audience == .public || friends(mine.id, parent.author.id) else { throw ServiceFailure.notFound }
            guard draft.optionId == nil else { throw ServiceFailure(code: "INVALID_ARGUMENT", message: "A reply inherits its original's audience and round.", retryable: false) }
            guard state.replies.filter({ $0.summary.originalId == originalId }).count < 50 else { throw ServiceFailure(code: "LIMIT_REACHED", message: "This conversation has reached its reply limit.", retryable: false) }
        } else {
            guard receipt(mine.id, draft.roundId) == nil else { throw ServiceFailure(code: "ALREADY_PUBLISHED", message: "You've already given your take this round.", retryable: false) }
            guard currentRound.options.contains(where: { $0.id == draft.optionId }) else { throw ServiceFailure(code: "INVALID_OPTION", message: "Choose a position first.", retryable: false) }
        }
    }
    func beginUpload(draft: PublicationDraft) async throws -> UploadIntent {
        if let upload = state.uploads[draft.id] {
            guard upload.owner == mine.id else { throw ServiceFailure.notFound }
            guard upload.draft.roundId == draft.roundId, upload.draft.originalId == draft.originalId, upload.draft.optionId == draft.optionId, upload.draft.isDemo == draft.isDemo, draft.ownerId == upload.owner, draft.kind == .reply || upload.draft.audience == draft.audience else { throw ServiceFailure(code: "CONFLICT", message: "This upload is already bound to a different take.", retryable: false) }
            return intent(draft.id)
        }
        try validate(draft)
        state.uploads[draft.id] = Upload(owner: mine.id, draft: draft)
        changed()
        return intent(draft.id)
    }
    private func intent(_ id: String) -> UploadIntent { UploadIntent(uploadId: id, uploadUrl: "demo://private-staging/\(id)", expiresAt: Date().milliseconds + 3_600_000, minDurationMs: demoScenario == .legacy ? 0 : 3_000, maxDurationMs: 15_000, maxBytes: demoScenario == .legacy ? 20_971_520 : 8_388_608) }
    func upload(clip: RecordedClip, intent: UploadIntent, progress: @escaping (Double) -> Void) async throws {
        guard let existing = state.uploads[intent.uploadId], existing.owner == mine.id else { throw ServiceFailure.notFound }
        if existing.clip != nil { progress(1); return }
        let startedAt = epoch
        for step in 1...5 { try await Task.sleep(for: .milliseconds(110)); progress(Double(step) / 5) }
        guard epoch == startedAt, var upload = state.uploads[intent.uploadId], upload.owner == mine.id else { throw ServiceFailure.notFound }
        if upload.clip != nil { progress(1); return }
        guard !state.failNext else {
            state.failNext = false; changed()
            throw ServiceFailure(code: "DEMO_UPLOAD_FAILED", message: "Simulated upload failure. Your clip is saved; retry when you're ready. Publication wasn't confirmed, so no new access was granted.", retryable: true)
        }
        guard clip.durationMs.isFinite, clip.durationMs > 0, clip.durationMs <= 15_000, demoScenario == .legacy || clip.durationMs >= 3_000, FileManager.default.fileExists(atPath: clip.url.path) else { throw ServiceFailure(code: "INVALID_MEDIA", message: demoScenario == .legacy ? "This clip is missing or longer than 15 seconds. Please retake it." : "Record a clip between 3 and 15 seconds.", retryable: false) }
        if demoScenario == .mocks {
            let values = try FileManager.default.attributesOfItem(atPath: clip.url.path)
            guard let bytes = values[.size] as? NSNumber, bytes.doubleValue <= 8_388_608 else { throw ServiceFailure(code: "INVALID_MEDIA", message: "Keep your clip under 8 MiB.", retryable: false) }
        }
        let target = directory.appendingPathComponent("upload-\(UUID().uuidString).mp4")
        if target != clip.url { try? FileManager.default.removeItem(at: target); try FileManager.default.copyItem(at: clip.url, to: target) }
        upload.clip = RecordedClip(url: target, durationMs: clip.durationMs, source: clip.source, createdAt: clip.createdAt)
        state.uploads[intent.uploadId] = upload; changed()
    }
    func finalize(uploadId: String) async throws -> PublicationResult {
        guard let existing = state.uploads[uploadId], existing.owner == mine.id else { throw ServiceFailure.notFound }
        if let result = existing.result { return result }
        try validate(existing.draft)
        guard existing.clip != nil else { throw ServiceFailure(code: "INVALID_MEDIA", message: "Upload your video before publishing.", retryable: true) }
        let startedAt = epoch
        try await Task.sleep(for: .milliseconds(200))
        guard epoch == startedAt, var upload = state.uploads[uploadId], upload.owner == mine.id else { throw ServiceFailure.notFound }
        if let completed = upload.result { return completed }
        try validate(upload.draft)
        guard let clip = upload.clip, demoScenario == .legacy || clip.durationMs >= 3_000 else { throw ServiceFailure(code: "INVALID_MEDIA", message: "Record a clip between 3 and 15 seconds.", retryable: false) }
        let now = Date().milliseconds
        let result: PublicationResult
        if let parent = upload.draft.originalId {
            guard let original = state.originals.first(where: { $0.summary.id == parent })?.summary else { throw ServiceFailure.notFound }
            let reply = ReplySummary(id: "demo-reply-\(uploadId)", originalId: parent, roundId: currentRound.id, author: mine, publishedAt: now, durationMs: clip.durationMs, thumbnailAssetId: nil, audience: original.audience)
            state.replies.append(StoredReply(summary: reply, clip: clip))
            result = PublicationResult(state: "published", originalId: parent, replyId: reply.id, receipt: nil, failure: nil)
        } else {
            let original = OriginalSummary(id: "demo-original-\(uploadId)", roundId: currentRound.id, author: mine, optionId: upload.draft.optionId!, publishedAt: now, durationMs: clip.durationMs, thumbnailAssetId: nil, visibleReplyCount: 0, audience: upload.draft.audience)
            state.originals.append(StoredOriginal(summary: original, clip: clip))
            if original.audience == .public { pairBattle(original) }
            let receipt = SubmissionReceipt(roundId: currentRound.id, publishedAt: now, originalId: original.id)
            state.receipts.append(Receipt(userId: mine.id, value: receipt))
            result = PublicationResult(state: "published", originalId: original.id, replyId: nil, receipt: receipt, failure: nil)
        }
        upload.result = result; state.uploads[uploadId] = upload; changed()
        return result
    }
    private func pairBattle(_ original: OriginalSummary) {
        guard original.audience == .public, !state.battles.contains(where: { $0.leftId == original.id || $0.rightId == original.id }) else { return }
        let paired = Set(state.battles.flatMap { [$0.leftId, $0.rightId] })
        let candidates: [OriginalSummary] = state.originals.map(\.summary).filter { (item: OriginalSummary) -> Bool in
            guard item.id != original.id, item.audience == .public, item.roundId == original.roundId else { return false }
            guard item.author.id != original.author.id, item.optionId != original.optionId else { return false }
            return !blocked(item.author.id, original.author.id) && !paired.contains(item.id)
        }
        guard let opponent = candidates.min(by: { (a: OriginalSummary, b: OriginalSummary) -> Bool in a.publishedAt == b.publishedAt ? a.id < b.id : a.publishedAt < b.publishedAt }) else { return }
        let originalIsLeft = original.publishedAt == opponent.publishedAt ? original.id < opponent.id : original.publishedAt < opponent.publishedAt
        state.battles.append(Battle(id: "demo-battle-\(UUID().uuidString)", roundId: original.roundId, leftId: originalIsLeft ? original.id : opponent.id, rightId: originalIsLeft ? opponent.id : original.id))
    }
    func uploadStatus(uploadId: String) async throws -> UploadStatus {
        guard let upload = state.uploads[uploadId], upload.owner == mine.id else { throw ServiceFailure.notFound }
        return UploadStatus(state: upload.result?.state ?? "uploading", progress: upload.clip == nil ? 0 : 1, result: upload.result, failure: nil)
    }
    func cancelUpload(uploadId: String) async throws {
        guard let upload = state.uploads[uploadId], upload.owner == mine.id else { throw ServiceFailure.notFound }
        guard upload.result == nil else { return }
        if let url = upload.clip?.url { try? FileManager.default.removeItem(at: url) }
        state.uploads.removeValue(forKey: uploadId); changed()
    }
    func playback(contentId: String, kind: ContentKind, asset: String) async throws -> PlaybackGrant {
        guard kind != .comment, asset == "video" || asset == "thumbnail" else { throw ServiceFailure.notFound }
        let clip: RecordedClip
        switch kind {
        case .original:
            guard let value = state.originals.first(where: { $0.summary.id == contentId }), canView(value.summary) else { throw ServiceFailure.notFound }
            clip = value.clip
        case .reply:
            guard let value = state.replies.first(where: { $0.summary.id == contentId }), canView(value.summary) else { throw ServiceFailure.notFound }
            clip = value.clip
        case .comment:
            throw ServiceFailure.notFound
        }
        guard asset == "video" else { throw ServiceFailure.notFound }
        let resolved = clip.source == .simulatorFixture && !FileManager.default.fileExists(atPath: clip.url.path) ? Self.fixtureURL(clip.url.deletingPathExtension().lastPathComponent) ?? clip.url : clip.url
        return PlaybackGrant(url: resolved.absoluteString, expiresAt: Date().milliseconds + 60_000)
    }
    func captions(contentId: String, kind: ContentKind) async throws -> CaptionResult {
        _ = try await playback(contentId: contentId, kind: kind, asset: "video")
        return CaptionResult(status: "unavailable", text: nil)
    }
    func isSampleClip(_ id: String, kind: ContentKind) -> Bool {
        if kind == .original, let value = state.originals.first(where: { $0.summary.id == id }), canView(value.summary) { return value.clip.source == .simulatorFixture }
        if kind == .reply, let value = state.replies.first(where: { $0.summary.id == id }), canView(value.summary) { return value.clip.source == .simulatorFixture }
        return false
    }
    func friends() async throws -> FriendsState {
        let id = mine.id
        return FriendsState(approved: state.profiles.filter { friends(id, $0.id) }, incoming: state.requests.filter { $0.recipient == id }.compactMap { r in profile(r.sender).map { FriendRequest(id: r.id, profile: $0, createdAt: r.createdAt) } }, outgoing: state.requests.filter { $0.sender == id }.compactMap { r in profile(r.recipient).map { FriendRequest(id: r.id, profile: $0, createdAt: r.createdAt) } }, blocked: state.profiles.filter { state.blocks.contains(id + ":" + $0.id) })
    }
    func search(username: String) async throws -> [SearchResult] {
        guard !username.isEmpty else { return [] }
        return state.profiles.filter { $0.id != mine.id && $0.username.hasPrefix(username.lowercased()) && !blocked(mine.id, $0.id) }.map { value in
            let request = state.requests.first { ($0.sender == mine.id && $0.recipient == value.id) || ($0.recipient == mine.id && $0.sender == value.id) }
            return SearchResult(profile: value, relationship: friends(mine.id, value.id) ? "approved" : request.map { $0.sender == mine.id ? "outgoing" : "incoming" } ?? "none", requestId: request?.id)
        }
    }
    func requestFriend(userId: String) async throws {
        guard userId != mine.id, profile(userId) != nil, !blocked(mine.id, userId) else { throw ServiceFailure.notFound }
        guard !friends(mine.id, userId), !state.requests.contains(where: { Self.pair($0.sender, $0.recipient) == Self.pair(mine.id, userId) }) else { return }
        state.requests.append(Request(id: UUID().uuidString, sender: mine.id, recipient: userId, createdAt: Date().milliseconds)); changed()
    }
    func cancelRequest(requestId: String) async throws {
        guard let request = state.requests.first(where: { $0.id == requestId }), request.sender == mine.id else { throw ServiceFailure.notFound }
        state.requests.removeAll { $0.id == requestId }; changed()
    }
    func respond(requestId: String, accept: Bool) async throws {
        guard let request = state.requests.first(where: { $0.id == requestId }), request.recipient == mine.id, !blocked(request.sender, request.recipient) else { throw ServiceFailure.notFound }
        if accept { state.friendships.append(Self.pair(request.sender, request.recipient)) }
        state.requests.removeAll { $0.id == requestId }; changed()
    }
    func removeFriend(userId: String) async throws { let edge = Self.pair(mine.id, userId); state.friendships.removeAll { $0 == edge }; changed() }
    func block(userId: String, blocked: Bool) async throws {
        let owner = mine.id
        let edge = Self.pair(owner, userId)
        let key = owner + ":" + userId
        state.blocks.removeAll { $0 == key }
        if blocked {
            state.blocks.append(key)
            state.friendships.removeAll { $0 == edge }
            state.requests.removeAll { Self.pair($0.sender, $0.recipient) == edge }
        }
        changed()
    }
    func profile(cursor: String?) async throws -> ProfileState {
        ProfileState(profile: mine, preferences: state.preferences[mine.id] ?? NotificationPreferences(dailyQuestion: true, directReply: true), originals: Page(items: state.originals.map(\.summary).filter { $0.author.id == mine.id }.sorted { $0.publishedAt > $1.publishedAt }.map { summary($0) }, nextCursor: nil))
    }
    func updateProfile(displayName: String, avatar: Data?) async throws -> PublicProfile {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 50 else { throw ServiceFailure(code: "INVALID_PROFILE", message: "Use a display name with 1–50 characters.", retryable: false) }
        let index = state.profiles.firstIndex { $0.id == mine.id }!
        state.profiles[index].displayName = name
        if let avatar {
            let file = directory.appendingPathComponent("avatar-\(mine.id).jpg")
            try avatar.write(to: file, options: .atomic)
            state.profiles[index].avatar = AvatarDescriptor(url: file.absoluteString)
        }
        changed(); return mine
    }
    func setNotifications(_ preferences: NotificationPreferences) async throws { state.preferences[mine.id] = preferences; changed() }
    func deleteContent(id: String, kind: ContentKind) async throws {
        switch kind {
        case .original:
            guard let index = state.originals.firstIndex(where: { $0.summary.id == id && $0.summary.author.id == mine.id }) else { throw ServiceFailure.notFound }
            let removed = state.originals.remove(at: index)
            removeLocal(removed.clip.url)
            for reply in state.replies.filter({ $0.summary.originalId == id }) {
                removeLocal(reply.clip.url)
                removeInteractions(reply.summary.id, .reply)
            }
            state.replies.removeAll { $0.summary.originalId == id }
            removeInteractions(id, .original)
            let battles = Set(state.battles.filter { $0.leftId == id || $0.rightId == id }.map(\.id))
            state.battles.removeAll { battles.contains($0.id) }
            state.votes.removeAll { battles.contains($0.battleId) }
            for index in state.receipts.indices where state.receipts[index].value.originalId == id { state.receipts[index].value.originalId = nil }
        case .reply:
            guard let index = state.replies.firstIndex(where: { $0.summary.id == id && $0.summary.author.id == mine.id }) else { throw ServiceFailure.notFound }
            removeLocal(state.replies.remove(at: index).clip.url)
            removeInteractions(id, .reply)
        case .comment:
            try await deleteComment(commentId: id)
            return
        }
        changed()
    }
    private func removeInteractions(_ contentId: String, _ kind: ContentKind) {
        state.likes.removeAll { $0.contentId == contentId && $0.kind == kind }
        state.comments.removeAll { $0.contentId == contentId && $0.kind == kind }
    }
    private func removeLocal(_ url: URL) { if url.standardizedFileURL.path.hasPrefix(directory.standardizedFileURL.path + "/") { try? FileManager.default.removeItem(at: url) } }
    func report(contentId: String, kind: ContentKind, reason: String) async throws {
        if kind == .comment {
            guard let comment = state.comments.first(where: { $0.id == contentId }), canView(comment) else { throw ServiceFailure.notFound }
        } else {
            guard visibleContent(contentId, kind) != nil else { throw ServiceFailure.notFound }
        }
    }
    func registerDevice(installationId: String, deviceToken: String, enabled: Bool) async throws {}
    func unregisterDevice(installationId: String) async throws {}
    func requestDeletion() async throws {
        stopWatching()
        epoch += 1
        let owner = mine.id
        for original in state.originals.filter({ $0.summary.author.id == mine.id }) { try await deleteContent(id: original.summary.id, kind: .original) }
        for reply in state.replies.filter({ $0.summary.author.id == mine.id }) { try await deleteContent(id: reply.summary.id, kind: .reply) }
        state.friendships.removeAll { $0.split(separator: ":").contains(Substring(owner)) }
        state.requests.removeAll { $0.sender == owner || $0.recipient == owner }
        state.receipts.removeAll { $0.userId == owner }
        state.preferences.removeValue(forKey: owner)
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { for file in files where file.lastPathComponent.hasPrefix("avatar-\(owner)") { try? FileManager.default.removeItem(at: file) } }
        for upload in state.uploads.values where upload.owner == owner { if let url = upload.clip?.url { removeLocal(url) } }
        state.uploads = state.uploads.filter { $0.value.owner != owner }
        state.likes.removeAll { $0.userId == owner }
        state.comments.removeAll { $0.authorId == owner }
        state.votes.removeAll { $0.userId == owner }
        state.commentCreations.removeAll { $0.userId == owner }
        state.blocks.removeAll { $0.split(separator: ":").contains(Substring(owner)) }
        state.profiles.removeAll { $0.id == owner }
        persist()
    }
    func signOut() async throws { epoch += 1; stopWatching() }
    func switchScenario(_ scenario: DemoScenario) {
        guard demoScenario != scenario else { return }
        persist()
        epoch += 1
        demoScenario = scenario
        load()
        changed()
    }
    func switchIdentity(_ identity: DemoIdentity) { guard profile(identity.rawValue) != nil else { return }; epoch += 1; state.identity = identity; changed() }
    func releaseRound(_ number: Int) { guard (1...2).contains(number) else { return }; switchScenario(.legacy); epoch += 1; state.round = number; changed() }
    func simulatePublication() {
        guard receipt(mine.id, currentRound.id) == nil, let url = Self.fixtureURL(demoScenario == .mocks ? "sample-mock" : "sample-alex") else { return }
        let id = UUID().uuidString
        let draft = PublicationDraft(id: id, ownerId: mine.id, isDemo: true, roundId: currentRound.id, optionId: currentRound.options[0].id, originalId: nil, clip: nil, uploadId: id, state: .preview, failure: nil)
        state.uploads[id] = Upload(owner: mine.id, draft: draft, clip: RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date()))
        Task { _ = try? await finalize(uploadId: id) }
    }
    func failNextUpload() { state.failNext = true; changed() }
    func reset() {
        epoch += 1
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { for file in files { try? FileManager.default.removeItem(at: file) } }
        state = Self.seed(demoScenario); changed()
    }
}
