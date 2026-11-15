import Foundation

struct AvatarDescriptor: Codable, Equatable {
    let url: String
}

struct PublicProfile: Codable, Equatable, Identifiable {
    let id: String
    var username: String
    var displayName: String
    var avatar: AvatarDescriptor?
    var initial: String { String(displayName.prefix(1)).uppercased() }
}

struct AnswerOption: Codable, Equatable, Identifiable {
    let id: String
    let label: String
}

struct DailyRound: Codable, Equatable, Identifiable {
    let id: String
    let question: String
    let options: [AnswerOption]
    let opensAt: Double
    var closesAt: Double?
    var isCurrent: Bool
    func label(for option: String) -> String { options.first { $0.id == option }?.label ?? "Take" }
}

struct SubmissionReceipt: Codable, Equatable {
    let roundId: String
    let publishedAt: Double
    var originalId: String?
}

struct FriendPresence: Codable, Equatable {
    let profile: PublicProfile
    let hasPublished: Bool
}

struct TodayState: Codable, Equatable {
    let serverNow: Double
    let round: DailyRound?
    let viewerReceipt: SubmissionReceipt?
    let canViewFriends: Bool
    let ownOriginal: OriginalSummary?
    let friendPresence: [FriendPresence]
}

enum Audience: String, Codable, CaseIterable { case friends, `public` }

struct BattleReference: Codable, Equatable {
    let battleId: String
    let opponent: PublicProfile
}

struct OriginalSummary: Codable, Equatable, Identifiable {
    let id: String
    let roundId: String
    let author: PublicProfile
    let optionId: String
    let publishedAt: Double
    let durationMs: Double
    let thumbnailAssetId: String?
    var visibleReplyCount: Int
    var audience: Audience
    var likeCount: Int
    var viewerLiked: Bool
    var visibleCommentCount: Int
    var battle: BattleReference?

    init(id: String, roundId: String, author: PublicProfile, optionId: String, publishedAt: Double, durationMs: Double, thumbnailAssetId: String?, visibleReplyCount: Int, audience: Audience = .friends, likeCount: Int = 0, viewerLiked: Bool = false, visibleCommentCount: Int = 0, battle: BattleReference? = nil) {
        self.id = id
        self.roundId = roundId
        self.author = author
        self.optionId = optionId
        self.publishedAt = publishedAt
        self.durationMs = durationMs
        self.thumbnailAssetId = thumbnailAssetId
        self.visibleReplyCount = visibleReplyCount
        self.audience = audience
        self.likeCount = likeCount
        self.viewerLiked = viewerLiked
        self.visibleCommentCount = visibleCommentCount
        self.battle = battle
    }

    private enum CodingKeys: String, CodingKey {
        case id, roundId, author, optionId, publishedAt, durationMs, thumbnailAssetId, visibleReplyCount, audience, likeCount, viewerLiked, visibleCommentCount, battle
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        roundId = try values.decode(String.self, forKey: .roundId)
        author = try values.decode(PublicProfile.self, forKey: .author)
        optionId = try values.decode(String.self, forKey: .optionId)
        publishedAt = try values.decode(Double.self, forKey: .publishedAt)
        durationMs = try values.decode(Double.self, forKey: .durationMs)
        thumbnailAssetId = try values.decodeIfPresent(String.self, forKey: .thumbnailAssetId)
        visibleReplyCount = try values.decode(Int.self, forKey: .visibleReplyCount)
        audience = try values.decodeIfPresent(Audience.self, forKey: .audience) ?? .friends
        likeCount = try values.decodeIfPresent(Int.self, forKey: .likeCount) ?? 0
        viewerLiked = try values.decodeIfPresent(Bool.self, forKey: .viewerLiked) ?? false
        visibleCommentCount = try values.decodeIfPresent(Int.self, forKey: .visibleCommentCount) ?? 0
        battle = try values.decodeIfPresent(BattleReference.self, forKey: .battle)
    }
}

struct ReplySummary: Codable, Equatable, Identifiable {
    let id: String
    let originalId: String
    let roundId: String
    let author: PublicProfile
    let publishedAt: Double
    let durationMs: Double
    let thumbnailAssetId: String?
    var audience: Audience
    var likeCount: Int
    var viewerLiked: Bool
    var visibleCommentCount: Int

    init(id: String, originalId: String, roundId: String, author: PublicProfile, publishedAt: Double, durationMs: Double, thumbnailAssetId: String?, audience: Audience = .friends, likeCount: Int = 0, viewerLiked: Bool = false, visibleCommentCount: Int = 0) {
        self.id = id
        self.originalId = originalId
        self.roundId = roundId
        self.author = author
        self.publishedAt = publishedAt
        self.durationMs = durationMs
        self.thumbnailAssetId = thumbnailAssetId
        self.audience = audience
        self.likeCount = likeCount
        self.viewerLiked = viewerLiked
        self.visibleCommentCount = visibleCommentCount
    }

    private enum CodingKeys: String, CodingKey {
        case id, originalId, roundId, author, publishedAt, durationMs, thumbnailAssetId, audience, likeCount, viewerLiked, visibleCommentCount
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        originalId = try values.decode(String.self, forKey: .originalId)
        roundId = try values.decode(String.self, forKey: .roundId)
        author = try values.decode(PublicProfile.self, forKey: .author)
        publishedAt = try values.decode(Double.self, forKey: .publishedAt)
        durationMs = try values.decode(Double.self, forKey: .durationMs)
        thumbnailAssetId = try values.decodeIfPresent(String.self, forKey: .thumbnailAssetId)
        audience = try values.decodeIfPresent(Audience.self, forKey: .audience) ?? .friends
        likeCount = try values.decodeIfPresent(Int.self, forKey: .likeCount) ?? 0
        viewerLiked = try values.decodeIfPresent(Bool.self, forKey: .viewerLiked) ?? false
        visibleCommentCount = try values.decodeIfPresent(Int.self, forKey: .visibleCommentCount) ?? 0
    }
}

struct LikeResult: Codable, Equatable {
    let liked: Bool
    let likeCount: Int
}

struct CommentSummary: Codable, Equatable, Identifiable {
    let commentId: String
    let author: PublicProfile
    let text: String
    let createdAt: Double
    let viewerCanDelete: Bool
    var id: String { commentId }
}

struct CreateCommentResult: Codable, Equatable {
    let commentId: String
}

enum BattleSide: String, Codable { case left, right }

struct BattleState: Codable, Equatable, Identifiable {
    let battleId: String
    let roundId: String
    let left: OriginalSummary
    let right: OriginalSummary
    let leftVotes: Int
    let rightVotes: Int
    let viewerVote: BattleSide?
    let viewerCanVote: Bool
    var id: String { battleId }
}

struct BattleVoteResult: Codable, Equatable {
    let leftVotes: Int
    let rightVotes: Int
    let viewerVote: BattleSide
}

struct Page<T: Codable & Equatable>: Codable, Equatable {
    var items: [T]
    let nextCursor: String?
}

struct NotificationPreferences: Codable, Equatable {
    var dailyQuestion: Bool
    var directReply: Bool
}

struct ViewerSession: Codable, Equatable {
    let profile: PublicProfile?
    let needsOnboarding: Bool
}

struct FriendRequest: Codable, Equatable, Identifiable {
    let id: String
    let profile: PublicProfile
    let createdAt: Double
}

struct FriendsState: Codable, Equatable {
    var approved: [PublicProfile]
    var incoming: [FriendRequest]
    var outgoing: [FriendRequest]
    var blocked: [PublicProfile]
}

struct SearchResult: Codable, Equatable, Identifiable {
    let profile: PublicProfile
    let relationship: String
    let requestId: String?
    var id: String { profile.id }
}

struct ProfileState: Codable, Equatable {
    var profile: PublicProfile
    var preferences: NotificationPreferences
    var originals: Page<OriginalSummary>
}

enum ContentKind: String, Codable { case original, reply, comment }
enum ClipSource: String, Codable { case camera, simulatorFixture }

struct RecordedClip: Codable, Equatable {
    let url: URL
    let durationMs: Double
    let source: ClipSource
    let createdAt: Date
}

enum PublicationState: String, Codable { case draft, recording, preview, uploading, processing, published, failed }

struct PublicationDraft: Codable, Equatable, Identifiable {
    let id: String
    let ownerId: String
    let isDemo: Bool
    let roundId: String
    let optionId: String?
    let originalId: String?
    var clip: RecordedClip?
    var uploadId: String?
    var state: PublicationState
    var failure: String?
    var audience: Audience
    var kind: ContentKind { originalId == nil ? .original : .reply }

    init(id: String, ownerId: String, isDemo: Bool, roundId: String, optionId: String?, originalId: String?, clip: RecordedClip?, uploadId: String?, state: PublicationState, failure: String?, audience: Audience = .friends) {
        self.id = id
        self.ownerId = ownerId
        self.isDemo = isDemo
        self.roundId = roundId
        self.optionId = optionId
        self.originalId = originalId
        self.clip = clip
        self.uploadId = uploadId
        self.state = state
        self.failure = failure
        self.audience = audience
    }

    private enum CodingKeys: String, CodingKey {
        case id, ownerId, isDemo, roundId, optionId, originalId, clip, uploadId, state, failure, audience
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        ownerId = try values.decode(String.self, forKey: .ownerId)
        isDemo = try values.decode(Bool.self, forKey: .isDemo)
        roundId = try values.decode(String.self, forKey: .roundId)
        optionId = try values.decodeIfPresent(String.self, forKey: .optionId)
        originalId = try values.decodeIfPresent(String.self, forKey: .originalId)
        clip = try values.decodeIfPresent(RecordedClip.self, forKey: .clip)
        uploadId = try values.decodeIfPresent(String.self, forKey: .uploadId)
        state = try values.decode(PublicationState.self, forKey: .state)
        failure = try values.decodeIfPresent(String.self, forKey: .failure)
        audience = try values.decodeIfPresent(Audience.self, forKey: .audience) ?? .friends
    }
}

struct UploadIntent: Codable, Equatable {
    let uploadId: String
    let uploadUrl: String
    let expiresAt: Double
    let minDurationMs: Double
    let maxDurationMs: Double
    let maxBytes: Double

    init(uploadId: String, uploadUrl: String, expiresAt: Double, minDurationMs: Double = 3_000, maxDurationMs: Double, maxBytes: Double) {
        self.uploadId = uploadId
        self.uploadUrl = uploadUrl
        self.expiresAt = expiresAt
        self.minDurationMs = minDurationMs
        self.maxDurationMs = maxDurationMs
        self.maxBytes = maxBytes
    }

    private enum CodingKeys: String, CodingKey {
        case uploadId, uploadUrl, expiresAt, minDurationMs, maxDurationMs, maxBytes
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        uploadId = try values.decode(String.self, forKey: .uploadId)
        uploadUrl = try values.decode(String.self, forKey: .uploadUrl)
        expiresAt = try values.decode(Double.self, forKey: .expiresAt)
        minDurationMs = try values.decodeIfPresent(Double.self, forKey: .minDurationMs) ?? 3_000
        maxDurationMs = try values.decode(Double.self, forKey: .maxDurationMs)
        maxBytes = try values.decode(Double.self, forKey: .maxBytes)
    }
}

struct ServiceFailure: Error, Codable, Equatable, LocalizedError {
    let code: String
    let message: String
    let retryable: Bool
    var errorDescription: String? { message }
    static let notFound = ServiceFailure(code: "NOT_FOUND", message: "This take is no longer available to you.", retryable: false)
    static let notConfigured = ServiceFailure(code: "NOT_CONFIGURED", message: "Live TAKE isn't available in this build. You can explore the offline demo.", retryable: false)
}

struct PublicationResult: Codable, Equatable {
    let state: String
    let originalId: String?
    let replyId: String?
    let receipt: SubmissionReceipt?
    let failure: ServiceFailure?
}

struct UploadStatus: Codable, Equatable {
    let state: String
    let progress: Double?
    let result: PublicationResult?
    let failure: ServiceFailure?
}

struct PlaybackGrant: Codable, Equatable {
    let url: String
    let expiresAt: Double
}

struct CaptionResult: Codable, Equatable {
    let status: String
    let text: String?
}

extension Date {
    var milliseconds: Double { timeIntervalSince1970 * 1_000 }
    init(milliseconds: Double) { self.init(timeIntervalSince1970: milliseconds / 1_000) }
}
