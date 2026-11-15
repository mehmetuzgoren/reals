import AuthenticationServices
import Foundation

@MainActor
protocol TakeService: AnyObject {
    var isDemo: Bool { get }
    var viewerID: String? { get }
    func session() async throws -> ViewerSession
    func completeOnboarding(username: String, displayName: String) async throws -> PublicProfile
    func today() async throws -> TodayState
    func watchToday(_ receive: @escaping (Result<TodayState, Error>) -> Void)
    func stopWatching()
    func watchConversation(originalId: String, _ changed: @escaping () -> Void) -> () -> Void
    func feed(roundId: String, cursor: String?) async throws -> Page<OriginalSummary>
    func detail(originalId: String) async throws -> OriginalSummary
    func replies(originalId: String, cursor: String?) async throws -> Page<ReplySummary>
    func beginUpload(draft: PublicationDraft) async throws -> UploadIntent
    func upload(clip: RecordedClip, intent: UploadIntent, progress: @escaping (Double) -> Void) async throws
    func finalize(uploadId: String) async throws -> PublicationResult
    func uploadStatus(uploadId: String) async throws -> UploadStatus
    func cancelUpload(uploadId: String) async throws
    func playback(contentId: String, kind: ContentKind, asset: String) async throws -> PlaybackGrant
    func captions(contentId: String, kind: ContentKind) async throws -> CaptionResult
    func friends() async throws -> FriendsState
    func search(username: String) async throws -> [SearchResult]
    func requestFriend(userId: String) async throws
    func cancelRequest(requestId: String) async throws
    func respond(requestId: String, accept: Bool) async throws
    func removeFriend(userId: String) async throws
    func block(userId: String, blocked: Bool) async throws
    func profile(cursor: String?) async throws -> ProfileState
    func updateProfile(displayName: String, avatar: Data?) async throws -> PublicProfile
    func setNotifications(_ preferences: NotificationPreferences) async throws
    func deleteContent(id: String, kind: ContentKind) async throws
    func report(contentId: String, kind: ContentKind, reason: String) async throws
    func registerDevice(installationId: String, fcmToken: String, enabled: Bool) async throws
    func unregisterDevice(installationId: String) async throws
    func requestDeletion() async throws
    func signOut() async throws
}

@MainActor
protocol AppleAuthenticationService: AnyObject {
    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) throws
    func completeAppleSignIn(_ authorization: ASAuthorization) async throws
}

enum DemoIdentity: String, CaseIterable, Identifiable, Codable {
    case alex, blair, casey, dana
    var id: String { rawValue }
    var name: String { rawValue.capitalized }
}

@MainActor
protocol DemoControlling: AnyObject {
    var identity: DemoIdentity { get }
    func switchIdentity(_ identity: DemoIdentity)
    func releaseRound(_ number: Int)
    func simulatePublication()
    func failNextUpload()
    func reset()
}
