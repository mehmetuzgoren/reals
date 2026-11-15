import AuthenticationServices
import AVFoundation
import Combine
import ConvexMobile
import Foundation
import ImageIO
import UniformTypeIdentifiers

extension Notification.Name {
    static let takePrivateAccessInvalidated = Notification.Name("TAKE.privateAccessInvalidated")
    static let takeSessionEnded = Notification.Name("TAKE.sessionEnded")
}

@MainActor
final class ProductionService: TakeService, AppleAuthenticationService {
    let isDemo = false
    private(set) var viewerID: String?

    private let configuration: LiveConfiguration
    private let authentication: FirebaseAuthentication
    private let client: ConvexClientWithAuth<FirebaseSession>
    private var authenticationTask: Task<FirebaseSession, Error>?
    private var authenticatedUID: String?
    private var allowsSessionRestore = true
    private var sessionEpoch = UUID()
    private var watchEpoch = UUID()
    private var watchTask: Task<Void, Never>?
    private var friendsWatchTask: Task<Void, Never>?
    private var conversationTasks: [UUID: [Task<Void, Never>]] = [:]
    private var pendingQueries: [UUID: () -> Void] = [:]
    private var transfers: [String: PrivateUploadTransfer] = [:]
    private var uploadProgress: [String: Double] = [:]
    private var uploadIntents: [String: UploadIntent] = [:]
    private var uploadClips: [String: RecordedClip] = [:]
    private var serverClockOffset: Double = 0

    static func make(bundle: Bundle = .main) throws -> ProductionService {
        try ProductionService(configuration: LiveConfiguration.load(bundle: bundle))
    }

    init(configuration: LiveConfiguration) throws {
        self.configuration = configuration
        authentication = try FirebaseAuthentication(configuration: configuration)
        client = ConvexClientWithAuth(deploymentUrl: configuration.convexURL.absoluteString, authProvider: authentication)
        authentication.onSessionInvalidated = { [weak self] in
            self?.clearSession()
            Task { await NotificationCoordinator.shared.signOutCleanup() }
        }
    }

    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) throws {
        try authentication.prepareAppleRequest(request)
    }

    func completeAppleSignIn(_ authorization: ASAuthorization) async throws {
        await NotificationCoordinator.shared.signOutCleanup()
        clearSession()
        authentication.resetTokenBinding()
        try await authentication.completeAppleSignIn(authorization)
        allowsSessionRestore = true
        let epoch = sessionEpoch
        let result = await client.login()
        guard epoch == sessionEpoch else { throw CancellationError() }
        let session = try result.get()
        authenticatedUID = session.uid
    }

    func session() async throws -> ViewerSession {
        let value: ViewerSession = try await query("viewer:session")
        viewerID = value.profile?.id
        return value
    }

    func completeOnboarding(username: String, displayName: String) async throws -> PublicProfile {
        let profile: PublicProfile = try await mutation("profiles:completeOnboarding", ["username": username, "displayName": displayName])
        viewerID = profile.id
        return profile
    }

    func today() async throws -> TodayState {
        let value: TodayState = try await query("rounds:today")
        synchronizeClock(value)
        return value
    }

    func watchToday(_ receive: @escaping (Result<TodayState, Error>) -> Void) {
        stopWatching()
        let epoch = watchEpoch
        watchTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await ensureAuthenticated()
                for try await value in client.subscribe(to: "rounds:today", yielding: TodayState.self).values {
                    guard !Task.isCancelled, epoch == watchEpoch else { return }
                    synchronizeClock(value)
                    receive(.success(value))
                }
            } catch {
                guard !Task.isCancelled, epoch == watchEpoch else { return }
                receive(.failure(Self.failure(error)))
            }
        }
        friendsWatchTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await ensureAuthenticated()
                var previous: FriendsState?
                for try await graph in client.subscribe(to: "friends:list", yielding: FriendsState.self).values {
                    guard !Task.isCancelled, epoch == watchEpoch else { return }
                    if let previous, previous != graph { invalidatePrivateAccess() }
                    previous = graph
                }
            } catch {
                guard !Task.isCancelled, epoch == watchEpoch else { return }
                invalidatePrivateAccess()
                receive(.failure(Self.failure(error)))
            }
        }
    }

    func stopWatching() {
        watchEpoch = UUID()
        watchTask?.cancel()
        watchTask = nil
        friendsWatchTask?.cancel()
        friendsWatchTask = nil
        let conversations = conversationTasks.values.flatMap { $0 }
        conversationTasks.removeAll()
        conversations.forEach { $0.cancel() }
    }

    func watchConversation(originalId: String, _ changed: @escaping () -> Void) -> () -> Void {
        let id = UUID()
        let epoch = sessionEpoch
        conversationTasks[id] = [
            conversationWatch("takes:detail", ["originalId": originalId], yielding: OriginalSummary.self, id: id, epoch: epoch, changed: changed),
            conversationWatch("replies:list", ["originalId": originalId, "cursor": nil, "limit": 20.0], yielding: Page<ReplySummary>.self, id: id, epoch: epoch, changed: changed)
        ]
        return { [weak self] in
            let tasks = self?.conversationTasks.removeValue(forKey: id)
            tasks?.forEach { $0.cancel() }
        }
    }

    func feed(roundId: String, cursor: String?) async throws -> Page<OriginalSummary> {
        try await query("takes:feed", ["roundId": roundId, "cursor": cursor, "limit": 20.0])
    }

    func detail(originalId: String) async throws -> OriginalSummary {
        try await query("takes:detail", ["originalId": originalId])
    }

    func replies(originalId: String, cursor: String?) async throws -> Page<ReplySummary> {
        try await query("replies:list", ["originalId": originalId, "cursor": cursor, "limit": 20.0])
    }

    func beginUpload(draft: PublicationDraft) async throws -> UploadIntent {
        try await ensureAuthenticated()
        guard !draft.isDemo, let viewerID, draft.ownerId == viewerID, let clip = draft.clip,
              !draft.id.isEmpty, draft.kind == .reply || draft.optionId != nil else {
            throw Self.invalidMedia
        }
        let epoch = sessionEpoch
        try await validateClip(clip, maxBytes: 20 * 1_024 * 1_024, maxDuration: 15_000)
        guard epoch == sessionEpoch else { throw CancellationError() }
        let intent: UploadIntent = try await mutation("uploads:begin", [
            "requestId": draft.id, "kind": draft.kind.rawValue, "roundId": draft.roundId,
            "optionId": draft.optionId, "originalId": draft.originalId
        ])
        _ = try configuration.uploadURL(intent.uploadUrl, uploadId: intent.uploadId, asset: "video")
        guard !intent.uploadId.isEmpty, intent.expiresAt.isFinite,
              intent.expiresAt > serverNow, intent.maxBytes.isFinite, intent.maxBytes > 0,
              intent.maxDurationMs.isFinite, intent.maxDurationMs > 0, intent.maxDurationMs <= 15_000 else {
            throw ServiceFailure(code: "UPLOAD_EXPIRED", message: "This upload is unavailable. Please try again.", retryable: true)
        }
        uploadIntents[intent.uploadId] = intent
        uploadClips[intent.uploadId] = clip
        return intent
    }

    func upload(clip: RecordedClip, intent: UploadIntent, progress: @escaping (Double) -> Void) async throws {
        try await ensureAuthenticated()
        guard uploadIntents[intent.uploadId] == intent, uploadClips[intent.uploadId] == clip,
              intent.expiresAt > serverNow, transfers[intent.uploadId] == nil else {
            throw ServiceFailure(code: "INVALID_UPLOAD", message: "Check this upload's status or start it again.", retryable: true)
        }
        let epoch = sessionEpoch
        let maxBytes = min(intent.maxBytes, 20 * 1_024 * 1_024)
        try await validateClip(clip, maxBytes: maxBytes, maxDuration: intent.maxDurationMs)
        let destination = try configuration.uploadURL(intent.uploadUrl, uploadId: intent.uploadId, asset: "video")
        let token = try await authentication.freshIDToken()
        guard epoch == sessionEpoch else { throw CancellationError() }
        let snapshot = try await Task.detached(priority: .utility) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("TAKE-live-\(UUID().uuidString).mp4")
            try FileManager.default.copyItem(at: clip.url, to: url)
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size > 0, Double(size) <= maxBytes else { throw Self.invalidMedia }
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
                return url
            } catch {
                try? FileManager.default.removeItem(at: url)
                throw error
            }
        }.value
        defer { try? FileManager.default.removeItem(at: snapshot) }
        try Task.checkCancellation()
        guard epoch == sessionEpoch else { throw CancellationError() }
        let transfer = PrivateUploadTransfer { value in
            Task { @MainActor [weak self] in
                guard let self, epoch == self.sessionEpoch else { return }
                guard value > (self.uploadProgress[intent.uploadId] ?? 1) else { return }
                self.uploadProgress[intent.uploadId] = value
                progress(value)
            }
        }
        transfers[intent.uploadId] = transfer
        uploadProgress[intent.uploadId] = 0
        defer {
            transfers[intent.uploadId] = nil
            uploadProgress[intent.uploadId] = nil
        }
        var request = URLRequest(url: destination)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        request.setValue(String(try snapshot.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0), forHTTPHeaderField: "Content-Length")
        do {
            progress(0)
            try await transfer.run(request: request, file: snapshot)
            guard epoch == sessionEpoch else { throw CancellationError() }
            uploadProgress[intent.uploadId] = 1
            progress(1)
        } catch {
            throw Self.failure(error)
        }
    }

    func finalize(uploadId: String) async throws -> PublicationResult {
        let result: PublicationResult = try await action("uploads:finalize", ["uploadId": uploadId])
        guard ["processing", "published", "failed"].contains(result.state),
              result.state != "published" || (result.failure == nil && (result.originalId != nil || result.replyId != nil)) else {
            throw Self.invalidResponse
        }
        return result
    }

    func uploadStatus(uploadId: String) async throws -> UploadStatus {
        let status: UploadStatus = try await query("uploads:status", ["uploadId": uploadId])
        guard status.progress == nil || (status.progress!.isFinite && (0...1).contains(status.progress!)) else {
            throw Self.invalidResponse
        }
        return status
    }

    func cancelUpload(uploadId: String) async throws {
        transfers[uploadId]?.cancel()
        try await acknowledge("uploads:cancel", ["uploadId": uploadId])
        uploadIntents[uploadId] = nil
        uploadClips[uploadId] = nil
    }

    func playback(contentId: String, kind: ContentKind, asset: String) async throws -> PlaybackGrant {
        guard asset == "video" || asset == "thumbnail" else { throw ServiceFailure.notFound }
        let grant: PlaybackGrant = try await action("media:createPlaybackGrant", ["contentId": contentId, "kind": kind.rawValue, "asset": asset])
        _ = try configuration.playbackURL(grant.url)
        guard grant.expiresAt.isFinite, grant.expiresAt > serverNow,
              grant.expiresAt <= serverNow + 65_000 else {
            throw ServiceFailure(code: "INVALID_GRANT", message: "Secure playback expired. Please try again.", retryable: true)
        }
        return grant
    }

    func captions(contentId: String, kind: ContentKind) async throws -> CaptionResult {
        let result: CaptionResult = try await query("captions:get", ["contentId": contentId, "kind": kind.rawValue])
        guard ["unavailable", "pending", "ready", "failed"].contains(result.status),
              result.status == "ready" || result.text == nil else { throw Self.invalidResponse }
        if result.status == "ready", result.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            throw Self.invalidResponse
        }
        return result
    }

    func friends() async throws -> FriendsState {
        try await query("friends:list")
    }

    func search(username: String) async throws -> [SearchResult] {
        try await query("friends:search", ["usernamePrefix": username, "limit": 20.0])
    }

    func requestFriend(userId: String) async throws {
        try await acknowledge("friends:request", ["userId": userId])
    }

    func cancelRequest(requestId: String) async throws {
        try await acknowledge("friends:cancel", ["requestId": requestId])
    }

    func respond(requestId: String, accept: Bool) async throws {
        try await acknowledge("friends:respond", ["requestId": requestId, "accept": accept])
        invalidatePrivateAccess()
    }

    func removeFriend(userId: String) async throws {
        try await acknowledge("friends:remove", ["userId": userId])
        invalidatePrivateAccess()
    }

    func block(userId: String, blocked: Bool) async throws {
        try await acknowledge("blocks:set", ["userId": userId, "blocked": blocked])
        invalidatePrivateAccess()
    }

    func profile(cursor: String?) async throws -> ProfileState {
        try await query("profiles:mine", ["cursor": cursor, "limit": 20.0])
    }

    func updateProfile(displayName: String, avatar: Data?) async throws -> PublicProfile {
        var avatarUploadID: String?
        if let avatar {
            guard !avatar.isEmpty, avatar.count <= 20 * 1_024 * 1_024 else {
                throw ServiceFailure(code: "INVALID_AVATAR", message: "Choose a photo smaller than 20 MB.", retryable: false)
            }
            let intent: AvatarUploadIntent = try await mutation("profiles:beginAvatarUpload", ["requestId": UUID().uuidString])
            guard intent.expiresAt.isFinite, intent.expiresAt > serverNow, intent.maxBytes.isFinite,
                  intent.expiresAt <= serverNow + 605_000, intent.maxBytes >= 1,
                  intent.maxWidth > 0, intent.maxHeight > 0,
                  intent.acceptedMimeTypes.contains("image/jpeg") || intent.acceptedMimeTypes.contains("image/png"),
                  !intent.uploadId.isEmpty else {
                throw ServiceFailure(code: "INVALID_AVATAR", message: "This image doesn't meet the profile photo limits. Choose a smaller image.", retryable: false)
            }
            let destination = try configuration.uploadURL(intent.uploadUrl, uploadId: intent.uploadId, asset: "avatar")
            let epoch = sessionEpoch
            let (image, contentType) = try await Task.detached(priority: .utility) {
                let failure = ServiceFailure(code: "INVALID_AVATAR", message: "This photo couldn't be resized safely. Choose another image.", retryable: false)
                guard let source = CGImageSourceCreateWithData(avatar as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
                      CGImageSourceGetCount(source) == 1,
                      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                      let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
                      let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
                      width > 0, height > 0, width <= 16_384, height <= 16_384,
                      Double(width) * Double(height) <= 100_000_000 else { throw failure }
                let jpeg = intent.acceptedMimeTypes.contains("image/jpeg")
                let type = jpeg ? UTType.jpeg.identifier : UTType.png.identifier
                let maxBytes = Int(min(intent.maxBytes, 5 * 1_024 * 1_024))
                var maxSide = min(2_048, min(intent.maxWidth, intent.maxHeight))
                for attempt in 0..<5 {
                    try Task.checkCancellation()
                    let options: [CFString: Any] = [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceShouldCacheImmediately: true,
                        kCGImageSourceThumbnailMaxPixelSize: maxSide
                    ]
                    guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw failure }
                    let output = NSMutableData()
                    guard let encoder = CGImageDestinationCreateWithData(output as CFMutableData, type as CFString, 1, nil) else { throw failure }
                    CGImageDestinationAddImage(encoder, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.85 - Double(attempt) * 0.1] as CFDictionary)
                    guard CGImageDestinationFinalize(encoder) else { throw failure }
                    if output.length <= maxBytes { return (output as Data, jpeg ? "image/jpeg" : "image/png") }
                    maxSide = max(1, Int(Double(maxSide) * min(0.8, sqrt(Double(maxBytes) / Double(output.length)) * 0.9)))
                }
                throw failure
            }.value
            guard epoch == sessionEpoch else { throw CancellationError() }
            let token = try await authentication.freshIDToken()
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("TAKE-avatar-\(UUID().uuidString)")
            try image.write(to: file, options: [.atomic, .completeFileProtection])
            defer { try? FileManager.default.removeItem(at: file) }
            guard epoch == sessionEpoch else { throw CancellationError() }
            var request = URLRequest(url: destination)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            request.setValue(String(image.count), forHTTPHeaderField: "Content-Length")
            let transfer = PrivateUploadTransfer(progress: { _ in })
            transfers[intent.uploadId] = transfer
            defer { transfers[intent.uploadId] = nil }
            try await transfer.run(request: request, file: file, expectedUploadID: intent.uploadId)
            guard epoch == sessionEpoch else { throw CancellationError() }
            avatarUploadID = intent.uploadId
        }
        let updated: PublicProfile = try await mutation("profiles:update", ["displayName": displayName, "avatarUploadId": avatarUploadID])
        return updated
    }

    func setNotifications(_ preferences: NotificationPreferences) async throws {
        try await acknowledge("profiles:setNotifications", ["dailyQuestion": preferences.dailyQuestion, "directReply": preferences.directReply])
    }

    func deleteContent(id: String, kind: ContentKind) async throws {
        try await acknowledge(kind == .original ? "takes:delete" : "replies:delete", ["id": id])
        invalidatePrivateAccess()
    }

    func report(contentId: String, kind: ContentKind, reason: String) async throws {
        try await acknowledge("reports:create", ["contentId": contentId, "kind": kind.rawValue, "reason": reason])
    }

    func registerDevice(installationId: String, fcmToken: String, enabled: Bool) async throws {
        guard !installationId.isEmpty, !fcmToken.isEmpty else { throw Self.invalidResponse }
        try await acknowledge("devices:register", ["installationId": installationId, "fcmToken": fcmToken, "platform": "ios", "notificationsEnabled": enabled])
    }

    func unregisterDevice(installationId: String) async throws {
        let _: IgnoredResponse = try await mutation("devices:unregister", ["installationId": installationId], timeout: 5)
    }

    func requestDeletion() async throws {
        let _: IgnoredResponse = try await action("accounts:requestDeletion")
        try await signOut()
    }

    func signOut() async throws {
        await NotificationCoordinator.shared.signOutCleanup()
        allowsSessionRestore = false
        clearSession()
        do {
            try await authentication.logout()
        } catch {
            await client.logout()
            throw error
        }
        await client.logout()
    }

    private var serverNow: Double { Date().milliseconds + serverClockOffset }

    private func synchronizeClock(_ state: TodayState) {
        if state.serverNow.isFinite { serverClockOffset = state.serverNow - Date().milliseconds }
    }

    private func ensureAuthenticated() async throws {
        try Task.checkCancellation()
        guard allowsSessionRestore, let uid = authentication.currentUID else { throw Self.unauthenticated }
        if authenticatedUID == uid { return }
        let epoch = sessionEpoch
        let task: Task<FirebaseSession, Error>
        if let authenticationTask { task = authenticationTask }
        else {
            task = Task { try (await client.loginFromCache()).get() }
            authenticationTask = task
        }
        defer { if epoch == sessionEpoch { authenticationTask = nil } }
        let session = try await task.value
        guard epoch == sessionEpoch, session.uid == authentication.currentUID, allowsSessionRestore else {
            throw Self.unauthenticated
        }
        authenticatedUID = session.uid
        try Task.checkCancellation()
    }

    private func conversationWatch<Value: Decodable>(_ name: String, _ args: [String: ConvexEncodable?], yielding: Value.Type,
                                                      id: UUID, epoch: UUID, changed: @escaping () -> Void) -> Task<Void, Never> {
        Task { [weak self] in
            guard let self else { return }
            do {
                try await ensureAuthenticated()
                for try await _ in client.subscribe(to: name, with: args, yielding: yielding).values {
                    guard !Task.isCancelled, epoch == sessionEpoch, conversationTasks[id] != nil else { return }
                    changed()
                }
            } catch {
                guard !Task.isCancelled, epoch == sessionEpoch, conversationTasks[id] != nil else { return }
                changed()
            }
        }
    }

    private func query<T: Decodable>(_ name: String, _ args: [String: ConvexEncodable?] = [:]) async throws -> T {
        try await ensureAuthenticated()
        let epoch = sessionEpoch
        let id = UUID()
        let task = Task { @MainActor [client] () throws -> T in
            try await withLiveTimeout(seconds: 30) {
                for try await value in client.subscribe(to: name, with: args, yielding: T.self).values {
                    return value
                }
                throw Self.invalidResponse
            }
        }
        pendingQueries[id] = { task.cancel() }
        defer { pendingQueries[id] = nil }
        do {
            let value = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            try Task.checkCancellation()
            guard epoch == sessionEpoch else { throw CancellationError() }
            return value
        } catch {
            throw Self.failure(error)
        }
    }

    private func mutation<T: Decodable>(_ name: String, _ args: [String: ConvexEncodable?] = [:], timeout: TimeInterval = 30) async throws -> T {
        try await ensureAuthenticated()
        let epoch = sessionEpoch
        do {
            let value: T = try await withLiveTimeout(seconds: timeout) { [client] in
                try await client.mutation(name, with: args)
            }
            try Task.checkCancellation()
            guard epoch == sessionEpoch else { throw CancellationError() }
            return value
        } catch { throw Self.failure(error) }
    }

    private func action<T: Decodable>(_ name: String, _ args: [String: ConvexEncodable?] = [:]) async throws -> T {
        try await ensureAuthenticated()
        let epoch = sessionEpoch
        do {
            let value: T = try await withLiveTimeout(seconds: 60) { [client] in
                try await client.action(name, with: args)
            }
            try Task.checkCancellation()
            guard epoch == sessionEpoch else { throw CancellationError() }
            return value
        } catch { throw Self.failure(error) }
    }

    private func acknowledge(_ name: String, _ args: [String: ConvexEncodable?] = [:]) async throws {
        let _: IgnoredResponse = try await mutation(name, args)
    }

    private func validateClip(_ clip: RecordedClip, maxBytes: Double, maxDuration: Double) async throws {
        guard clip.source == .camera, clip.url.isFileURL, clip.url.pathExtension.lowercased() == "mp4",
              clip.durationMs.isFinite, clip.durationMs > 0, clip.durationMs <= maxDuration,
              !clip.url.resolvingSymlinksInPath().path.hasPrefix(Bundle.main.bundleURL.resolvingSymlinksInPath().path + "/") else {
            throw Self.invalidMedia
        }
        let values = try clip.url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let size = values.fileSize, size > 0, Double(size) <= maxBytes else {
            throw Self.invalidMedia
        }
        let asset = AVURLAsset(url: clip.url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let duration = try await asset.load(.duration)
        let videos = try await asset.loadTracks(withMediaType: .video)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        let actualDuration = CMTimeGetSeconds(duration) * 1_000
        guard actualDuration.isFinite, actualDuration > 0, actualDuration <= maxDuration,
              !videos.isEmpty, !audio.isEmpty else { throw Self.invalidMedia }
    }

    private func clearSession() {
        sessionEpoch = UUID()
        authenticatedUID = nil
        viewerID = nil
        authenticationTask?.cancel()
        authenticationTask = nil
        stopWatching()
        let queries = Array(pendingQueries.values)
        pendingQueries.removeAll()
        queries.forEach { $0() }
        let activeTransfers = Array(transfers.values)
        transfers.removeAll()
        activeTransfers.forEach { $0.cancel() }
        uploadProgress.removeAll()
        uploadIntents.removeAll()
        uploadClips.removeAll()
        serverClockOffset = 0
        invalidatePrivateAccess()
        NotificationCenter.default.post(name: .takeSessionEnded, object: self)
    }

    private func invalidatePrivateAccess() {
        NotificationCenter.default.post(name: .takePrivateAccessInvalidated, object: self)
    }

    private static var unauthenticated: ServiceFailure {
        ServiceFailure(code: "UNAUTHENTICATED", message: "Sign in with Apple to continue.", retryable: false)
    }

    nonisolated private static var invalidMedia: ServiceFailure {
        ServiceFailure(code: "INVALID_MEDIA", message: "Live takes require an in-app MP4 recording with audio, up to 15 seconds and 20 MB. Demo clips can't be uploaded.", retryable: false)
    }

    private static var invalidResponse: ServiceFailure {
        ServiceFailure(code: "INVALID_RESPONSE", message: "TAKE couldn't verify the server response. Please try again.", retryable: true)
    }

    private static func failure(_ error: Error) -> Error {
        if error is CancellationError || error is ServiceFailure { return error }
        if case let ClientError.ConvexError(data) = error,
           let failure = try? JSONDecoder().decode(ServiceFailure.self, from: Data(data.utf8)) {
            return failure
        }
        return ServiceFailure(code: "NETWORK_ERROR", message: "Couldn't connect to TAKE. Check your connection and try again.", retryable: true)
    }
}

private struct AvatarUploadIntent: Decodable {
    let uploadId: String
    let uploadUrl: String
    let expiresAt: Double
    let acceptedMimeTypes: [String]
    let maxBytes: Double
    let maxWidth: Int
    let maxHeight: Int
}

private struct IgnoredResponse: Decodable {
    init(from decoder: Decoder) throws {}
}

@MainActor
func withLiveTimeout<Value>(seconds: TimeInterval, operation: @escaping @MainActor () async throws -> Value) async throws -> Value {
    let completion = LiveRequestCompletion<Value>()
    return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
            completion.continuation = continuation
            completion.work = Task {
                do { completion.finish(.success(try await operation())) }
                catch { completion.finish(.failure(error)) }
            }
            completion.deadline = Task {
                do { try await Task.sleep(for: .seconds(seconds)) }
                catch { return }
                completion.finish(.failure(ServiceFailure(code: "REQUEST_TIMEOUT", message: "TAKE didn't respond in time. Check your connection and try again.", retryable: true)))
            }
        }
    } onCancel: {
        Task { @MainActor in completion.finish(.failure(CancellationError())) }
    }
}

@MainActor
private final class LiveRequestCompletion<Value> {
    var continuation: CheckedContinuation<Value, Error>?
    var work: Task<Void, Never>?
    var deadline: Task<Void, Never>?

    func finish(_ result: Result<Value, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        work?.cancel()
        deadline?.cancel()
        work = nil
        deadline = nil
        continuation.resume(with: result)
    }
}

private final class PrivateUploadTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let progress: @Sendable (Double) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var session: URLSession?
    private var task: URLSessionUploadTask?
    private var response: HTTPURLResponse?
    private var expectedUploadID: String?
    private var body = Data()
    private var wasCancelled = false
    private let responseLimit = 65_536

    init(progress: @escaping @Sendable (Double) -> Void) {
        self.progress = progress
    }

    func run(request: URLRequest, file: URL, expectedUploadID: String? = nil) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                lock.lock()
                guard !wasCancelled else {
                    lock.unlock()
                    continuation.resume(throwing: CancellationError())
                    return
                }
                let configuration = URLSessionConfiguration.ephemeral
                configuration.urlCache = nil
                configuration.urlCredentialStorage = nil
                configuration.httpCookieStorage = nil
                configuration.httpShouldSetCookies = false
                configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
                configuration.timeoutIntervalForRequest = 60
                configuration.timeoutIntervalForResource = 300
                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
                let task = session.uploadTask(with: request, fromFile: file)
                self.continuation = continuation
                self.expectedUploadID = expectedUploadID
                self.session = session
                self.task = task
                lock.unlock()
                task.resume()
            }
        } onCancel: {
            self.cancel()
        }
    }

    func cancel() {
        lock.lock()
        wasCancelled = true
        let task = task
        lock.unlock()
        task?.cancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        progress(min(0.99, max(0, Double(totalBytesSent) / Double(totalBytesExpectedToSend))))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.expectedContentLength <= Int64(responseLimit) else {
            completionHandler(.cancel)
            return
        }
        self.response = response
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard body.count + data.count <= responseLimit else {
            dataTask.cancel()
            return
        }
        body.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let continuation = continuation
        self.continuation = nil
        self.task = nil
        self.session = nil
        let cancelled = wasCancelled
        lock.unlock()
        session.finishTasksAndInvalidate()
        guard let continuation else { return }
        if cancelled || (error as? URLError)?.code == .cancelled {
            continuation.resume(throwing: CancellationError())
        } else if error != nil {
            continuation.resume(throwing: ServiceFailure(code: "UPLOAD_NETWORK", message: "The upload was interrupted. Your recording is safe to retry.", retryable: true))
        } else if let response, (200..<300).contains(response.statusCode) {
            if let expectedUploadID,
               (try? JSONDecoder().decode(UploadAcknowledgment.self, from: body).uploadId) != expectedUploadID {
                continuation.resume(throwing: ServiceFailure(code: "INVALID_RESPONSE", message: "The profile photo upload couldn't be verified. Please try again.", retryable: true))
            } else {
                continuation.resume()
            }
        } else if let failure = try? JSONDecoder().decode(ServiceFailure.self, from: body) {
            continuation.resume(throwing: failure)
        } else if let failure = try? JSONDecoder().decode(HTTPFailure.self, from: body) {
            continuation.resume(throwing: failure.error)
        } else {
            let status = response?.statusCode ?? 0
            let failure: ServiceFailure
            switch status {
            case 401:
                failure = ServiceFailure(code: "UNAUTHENTICATED", message: "Sign in again before uploading.", retryable: false)
            case 403, 404:
                failure = .notFound
            case 409:
                failure = ServiceFailure(code: "CONFLICT", message: "This upload changed. Check its publication status before retrying.", retryable: true)
            case 413, 415, 422:
                failure = ServiceFailure(code: "INVALID_MEDIA", message: "This recording couldn't be accepted. Retake a video up to 15 seconds and 20 MB.", retryable: false)
            default:
                failure = ServiceFailure(code: "UPLOAD_FAILED", message: "Couldn't upload this recording. Please try again.", retryable: status == 0 || status == 408 || status == 429 || status >= 500)
            }
            continuation.resume(throwing: failure)
        }
    }

    private struct HTTPFailure: Decodable {
        let error: ServiceFailure
    }

    private struct UploadAcknowledgment: Decodable {
        let uploadId: String
    }
}
