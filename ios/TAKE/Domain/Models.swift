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

struct OriginalSummary: Codable, Equatable, Identifiable {
    let id: String
    let roundId: String
    let author: PublicProfile
    let optionId: String
    let publishedAt: Double
    let durationMs: Double
    let thumbnailAssetId: String?
    var visibleReplyCount: Int
}

struct ReplySummary: Codable, Equatable, Identifiable {
    let id: String
    let originalId: String
    let roundId: String
    let author: PublicProfile
    let publishedAt: Double
    let durationMs: Double
    let thumbnailAssetId: String?
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

enum ContentKind: String, Codable { case original, reply }
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
    var kind: ContentKind { originalId == nil ? .original : .reply }
}

struct UploadIntent: Codable, Equatable {
    let uploadId: String
    let uploadUrl: String
    let expiresAt: Double
    let maxDurationMs: Double
    let maxBytes: Double
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
