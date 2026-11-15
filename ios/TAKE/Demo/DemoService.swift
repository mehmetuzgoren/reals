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
    struct State: Codable {
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
    }

    let isDemo = true
    var viewerID: String? { state.identity.rawValue }
    var serverNow: Double { Date().milliseconds }
    var identity: DemoIdentity { state.identity }
    private var state: State
    private let directory: URL
    private var listener: ((Result<TodayState, Error>) -> Void)?
    private var conversationListeners: [UUID: () -> Void] = [:]
    private var mine: PublicProfile { state.profiles.first { $0.id == identity.rawValue } ?? PublicProfile(id: identity.rawValue, username: "deleted", displayName: "Deleted demo account", avatar: nil) }
    private var currentRound: DailyRound { Self.round(state.round) }

    init(directory: URL? = nil, reset: Bool = false) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TAKE/Demo", isDirectory: true)
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        let file = self.directory.appendingPathComponent("state.json")
        if !reset, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(State.self, from: data) {
            state = saved
        } else {
            state = Self.seed()
        }
        if !state.profiles.contains(where: { $0.id == state.identity.rawValue }), let active = DemoIdentity.allCases.first(where: { candidate in state.profiles.contains { $0.id == candidate.rawValue } }) { state.identity = active }
        persist()
    }

    static func round(_ number: Int) -> DailyRound {
        let labels = number == 1 ? ["Yes", "No", "Depends"] : ["Yes", "No", "It's complicated"]
        return DailyRound(id: "demo-round-\(number)", question: number == 1 ? "Do you like pineapple on pizza?" : "Do you think Elon Musk is a genius? How is he successful?", options: labels.enumerated().map { AnswerOption(id: "r\(number)-\($0.offset)", label: $0.element) }, opensAt: 1_700_000_000_000 + Double(number * 86_400_000), closesAt: nil, isCurrent: true)
    }

    static func fixtureURL(_ name: String = "sample-alex") -> URL? {
        Bundle.main.url(forResource: name, withExtension: "mp4")
    }

    private static func seed() -> State {
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

    private static func pair(_ a: String, _ b: String) -> String { [a, b].sorted().joined(separator: ":") }
    private func blocked(_ a: String, _ b: String) -> Bool { state.blocks.contains(a + ":" + b) || state.blocks.contains(b + ":" + a) }
    private func friends(_ a: String, _ b: String) -> Bool { a != b && !blocked(a, b) && state.friendships.contains(Self.pair(a, b)) }
    private func receipt(_ user: String, _ round: String) -> SubmissionReceipt? { state.receipts.first { $0.userId == user && $0.value.roundId == round }?.value }
    private func profile(_ id: String) -> PublicProfile? { state.profiles.first { $0.id == id } }

    private func canView(_ original: OriginalSummary) -> Bool {
        let viewer = identity.rawValue
        if viewer == original.author.id { return true }
        return original.roundId == currentRound.id && receipt(viewer, original.roundId) != nil && friends(viewer, original.author.id)
    }

    private func canView(_ reply: ReplySummary) -> Bool {
        guard let original = state.originals.first(where: { $0.summary.id == reply.originalId })?.summary, canView(original), friends(original.author.id, reply.author.id) else { return false }
        let viewer = identity.rawValue
        return viewer == original.author.id || viewer == reply.author.id || (receipt(viewer, reply.roundId) != nil && friends(viewer, reply.author.id))
    }

    private func summary(_ original: OriginalSummary) -> OriginalSummary {
        var result = original
        result.visibleReplyCount = state.replies.filter { $0.summary.originalId == original.id && canView($0.summary) }.count
        return result
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
        guard roundId == currentRound.id, receipt(mine.id, roundId) != nil else { throw ServiceFailure.notFound }
        let values = state.originals.filter { $0.summary.roundId == roundId && $0.summary.author.id != mine.id && canView($0.summary) }.sorted { $0.summary.publishedAt > $1.summary.publishedAt }.map { summary($0.summary) }
        return Page(items: values, nextCursor: nil)
    }
    func detail(originalId: String) async throws -> OriginalSummary {
        guard let original = state.originals.first(where: { $0.summary.id == originalId })?.summary, canView(original) else { throw ServiceFailure.notFound }
        return summary(original)
    }
    func replies(originalId: String, cursor: String?) async throws -> Page<ReplySummary> {
        _ = try await detail(originalId: originalId)
        return Page(items: state.replies.map(\.summary).filter { $0.originalId == originalId && canView($0) }.sorted { $0.publishedAt < $1.publishedAt }, nextCursor: nil)
    }
    private func validate(_ draft: PublicationDraft) throws {
        guard draft.isDemo, draft.ownerId == mine.id, draft.roundId == currentRound.id else { throw ServiceFailure(code: "ROUND_CLOSED", message: "A new question is here. Record a take for today's round.", retryable: false) }
        if let originalId = draft.originalId {
            guard let parent = state.originals.first(where: { $0.summary.id == originalId })?.summary, canView(parent), parent.roundId == currentRound.id, friends(mine.id, parent.author.id) else { throw ServiceFailure.notFound }
        } else {
            guard receipt(mine.id, draft.roundId) == nil else { throw ServiceFailure(code: "ALREADY_PUBLISHED", message: "You've already given your take this round.", retryable: false) }
            guard currentRound.options.contains(where: { $0.id == draft.optionId }) else { throw ServiceFailure(code: "INVALID_OPTION", message: "Choose a position first.", retryable: false) }
        }
    }
    func beginUpload(draft: PublicationDraft) async throws -> UploadIntent {
        if let upload = state.uploads[draft.id], upload.owner == mine.id { return intent(draft.id) }
        try validate(draft)
        state.uploads[draft.id] = Upload(owner: mine.id, draft: draft)
        changed()
        return intent(draft.id)
    }
    private func intent(_ id: String) -> UploadIntent { UploadIntent(uploadId: id, uploadUrl: "demo://private-staging/\(id)", expiresAt: Date().milliseconds + 3_600_000, maxDurationMs: 15_000, maxBytes: 20_971_520) }
    func upload(clip: RecordedClip, intent: UploadIntent, progress: @escaping (Double) -> Void) async throws {
        guard var upload = state.uploads[intent.uploadId], upload.owner == mine.id else { throw ServiceFailure.notFound }
        for step in 1...5 { try await Task.sleep(for: .milliseconds(110)); progress(Double(step) / 5) }
        guard !state.failNext else {
            state.failNext = false; changed()
            throw ServiceFailure(code: "DEMO_UPLOAD_FAILED", message: "Simulated upload failure. Your clip is saved; retry when you're ready. Publication wasn't confirmed, so no new access was granted.", retryable: true)
        }
        guard clip.durationMs > 0, clip.durationMs <= 15_000, FileManager.default.fileExists(atPath: clip.url.path) else { throw ServiceFailure(code: "INVALID_MEDIA", message: "This clip is missing or longer than 15 seconds. Please retake it.", retryable: false) }
        let target = directory.appendingPathComponent("\(intent.uploadId).mp4")
        if target != clip.url { try? FileManager.default.removeItem(at: target); try FileManager.default.copyItem(at: clip.url, to: target) }
        upload.clip = RecordedClip(url: target, durationMs: clip.durationMs, source: clip.source, createdAt: clip.createdAt)
        state.uploads[intent.uploadId] = upload; changed()
    }
    func finalize(uploadId: String) async throws -> PublicationResult {
        guard var upload = state.uploads[uploadId], upload.owner == mine.id else { throw ServiceFailure.notFound }
        if let result = upload.result { return result }
        try validate(upload.draft)
        guard let clip = upload.clip else { throw ServiceFailure(code: "INVALID_MEDIA", message: "Upload your video before publishing.", retryable: true) }
        try await Task.sleep(for: .milliseconds(200))
        if let completed = state.uploads[uploadId]?.result { return completed }
        try validate(upload.draft)
        let now = Date().milliseconds
        let result: PublicationResult
        if let parent = upload.draft.originalId {
            let reply = ReplySummary(id: "demo-reply-\(uploadId)", originalId: parent, roundId: currentRound.id, author: mine, publishedAt: now, durationMs: clip.durationMs, thumbnailAssetId: nil)
            state.replies.append(StoredReply(summary: reply, clip: clip))
            result = PublicationResult(state: "published", originalId: parent, replyId: reply.id, receipt: nil, failure: nil)
        } else {
            let original = OriginalSummary(id: "demo-original-\(uploadId)", roundId: currentRound.id, author: mine, optionId: upload.draft.optionId!, publishedAt: now, durationMs: clip.durationMs, thumbnailAssetId: nil, visibleReplyCount: 0)
            state.originals.append(StoredOriginal(summary: original, clip: clip))
            let receipt = SubmissionReceipt(roundId: currentRound.id, publishedAt: now, originalId: original.id)
            state.receipts.append(Receipt(userId: mine.id, value: receipt))
            result = PublicationResult(state: "published", originalId: original.id, replyId: nil, receipt: receipt, failure: nil)
        }
        upload.result = result; state.uploads[uploadId] = upload; changed()
        return result
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
        guard asset == "video" || asset == "thumbnail" else { throw ServiceFailure.notFound }
        let clip: RecordedClip
        if kind == .original {
            guard let value = state.originals.first(where: { $0.summary.id == contentId }), canView(value.summary) else { throw ServiceFailure.notFound }
            clip = value.clip
        } else {
            guard let value = state.replies.first(where: { $0.summary.id == contentId }), canView(value.summary) else { throw ServiceFailure.notFound }
            clip = value.clip
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
        if kind == .original {
            guard let index = state.originals.firstIndex(where: { $0.summary.id == id && $0.summary.author.id == mine.id }) else { throw ServiceFailure.notFound }
            let removed = state.originals.remove(at: index)
            removeLocal(removed.clip.url)
            state.replies.filter { $0.summary.originalId == id }.forEach { removeLocal($0.clip.url) }
            state.replies.removeAll { $0.summary.originalId == id }
            for index in state.receipts.indices where state.receipts[index].value.originalId == id { state.receipts[index].value.originalId = nil }
        } else {
            guard let index = state.replies.firstIndex(where: { $0.summary.id == id && $0.summary.author.id == mine.id }) else { throw ServiceFailure.notFound }
            removeLocal(state.replies.remove(at: index).clip.url)
        }
        changed()
    }
    private func removeLocal(_ url: URL) { if url.path.hasPrefix(directory.path) { try? FileManager.default.removeItem(at: url) } }
    func report(contentId: String, kind: ContentKind, reason: String) async throws { _ = try await playback(contentId: contentId, kind: kind, asset: "video") }
    func registerDevice(installationId: String, deviceToken: String, enabled: Bool) async throws {}
    func unregisterDevice(installationId: String) async throws {}
    func requestDeletion() async throws {
        stopWatching()
        let owner = mine.id
        for original in state.originals.filter({ $0.summary.author.id == mine.id }) { try await deleteContent(id: original.summary.id, kind: .original) }
        for reply in state.replies.filter({ $0.summary.author.id == mine.id }) { try await deleteContent(id: reply.summary.id, kind: .reply) }
        state.friendships.removeAll { $0.split(separator: ":").contains(Substring(owner)) }
        state.requests.removeAll { $0.sender == owner || $0.recipient == owner }
        state.receipts.removeAll { $0.userId == owner }
        state.preferences.removeValue(forKey: owner)
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { for file in files where file.lastPathComponent.hasPrefix("avatar-\(owner)") { try? FileManager.default.removeItem(at: file) } }
        state.uploads = state.uploads.filter { $0.value.owner != owner }
        state.blocks.removeAll { $0.split(separator: ":").contains(Substring(owner)) }
        state.profiles.removeAll { $0.id == owner }
        persist()
    }
    func signOut() async throws { stopWatching() }
    func switchIdentity(_ identity: DemoIdentity) { guard profile(identity.rawValue) != nil else { return }; state.identity = identity; changed() }
    func releaseRound(_ number: Int) { guard (1...2).contains(number) else { return }; state.round = number; changed() }
    func simulatePublication() {
        guard receipt(mine.id, currentRound.id) == nil, let url = Self.fixtureURL() else { return }
        let id = UUID().uuidString
        let draft = PublicationDraft(id: id, ownerId: mine.id, isDemo: true, roundId: currentRound.id, optionId: currentRound.options[0].id, originalId: nil, clip: nil, uploadId: id, state: .preview, failure: nil)
        state.uploads[id] = Upload(owner: mine.id, draft: draft, clip: RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date()))
        Task { _ = try? await finalize(uploadId: id) }
    }
    func failNextUpload() { state.failNext = true; changed() }
    func reset() {
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { for file in files { try? FileManager.default.removeItem(at: file) } }
        state = Self.seed(); changed()
    }
}
