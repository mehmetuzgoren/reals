import Combine
import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var service: (any TakeService)?
    @Published var viewer: PublicProfile?
    @Published var today: TodayState?
    @Published var feed: [OriginalSummary] = []
    @Published var feedCursor: String?
    @Published var friends: FriendsState?
    @Published var profile: ProfileState?
    @Published var needsOnboarding = false
    @Published var busy = false
    @Published var error: String?
    @Published var generation = UUID()
    @Published private(set) var accessRevision = UUID()
    @Published var recoveredDraft: PublicationDraft?
    @Published var reveal = false
    @Published var selectedTab = 0
    private var refreshTask: Task<Void, Never>?

    var isDemo: Bool { service?.isDemo == true }
    var demo: (any DemoControlling)? { service as? any DemoControlling }

    func enterDemo() async {
        let previousService = service
        invalidate()
        viewer = nil; needsOnboarding = false
        if let previousService, !previousService.isDemo { try? await previousService.signOut() }
        let demo = DemoService(reset: ProcessInfo.processInfo.arguments.contains("--reset-demo"))
        service = demo
        UserDefaults.standard.set("demo", forKey: "TAKE.lastMode")
        await establishSession()
    }

    func restoreLive() async {
        guard service == nil else { return }
        do { service = try ProductionService.make(); await establishSession() }
        catch { service = nil; UserDefaults.standard.removeObject(forKey: "TAKE.lastMode") }
    }

    func prepareLive() throws -> any AppleAuthenticationService {
        if let authentication = service as? any AppleAuthenticationService { return authentication }
        let live = try ProductionService.make()
        service = live
        return live
    }

    func establishSession() async {
        guard let service else { return }
        let epoch = generation
        busy = true
        do {
            let session = try await service.session()
            guard epoch == generation, self.service === service else { return }
            viewer = session.profile
            needsOnboarding = session.needsOnboarding
            if !service.isDemo { UserDefaults.standard.set("live", forKey: "TAKE.lastMode") }
            if !needsOnboarding {
                if !service.isDemo { NotificationCoordinator.shared.configure(service: service) }
                await refresh()
                guard epoch == generation, self.service === service else { return }
                watch()
            }
        } catch { if epoch == generation { self.error = error.localizedDescription } }
        if epoch == generation { busy = false }
    }

    func completeProfile(username: String, name: String) async {
        guard let service else { return }
        let epoch = generation
        busy = true
        do {
            let profile = try await service.completeOnboarding(username: username, displayName: name)
            guard epoch == generation, self.service === service else { return }
            viewer = profile
            needsOnboarding = false
            await establishSession()
        } catch { if epoch == generation { self.error = error.localizedDescription } }
        if epoch == generation { busy = false }
    }

    func watch() {
        guard let service else { return }
        service.stopWatching()
        let epoch = generation
        service.watchToday { [weak self] result in
            guard let self, self.generation == epoch else { return }
            switch result {
            case .success(let state):
                guard self.acceptToday(state) else { return }
                self.refreshTask?.cancel()
                if state.canViewFriends { self.refreshTask = Task { await self.refreshFeed() } }
            case .failure(let failure):
                self.today = nil; self.feed = []; self.feedCursor = nil
                self.clearPrivateContent()
                self.error = failure.localizedDescription
            }
        }
    }

    func refresh() async {
        guard let service else { return }
        let epoch = generation
        var revision = accessRevision
        do {
            let state = try await service.today()
            guard isCurrentAccess(generation: epoch, revision: revision), acceptToday(state) else { return }
            revision = accessRevision
            let friends = try await service.friends()
            let profile = try await service.profile(cursor: nil)
            guard isCurrentAccess(generation: epoch, revision: revision) else { return }
            self.friends = friends; self.profile = profile; viewer = profile.profile
            if state.canViewFriends { await refreshFeed() }
            recoverDraft()
        } catch {
            guard isCurrentAccess(generation: epoch, revision: revision) else { return }
            today = nil; feed = []; PlaybackCoordinator.shared.clear()
            clearPrivateContent()
            self.error = error.localizedDescription
        }
    }

    func refreshFeed(more: Bool = false) async {
        guard let service, let round = today?.round, today?.canViewFriends == true else { return }
        let epoch = generation
        let revision = accessRevision
        do {
            let page = try await service.feed(roundId: round.id, cursor: more ? feedCursor : nil)
            guard isCurrentAccess(generation: epoch, revision: revision), today?.round?.id == round.id, today?.canViewFriends == true else { return }
            feed = more ? feed + page.items.filter { item in !feed.contains(where: { $0.id == item.id }) } : page.items
            feedCursor = page.nextCursor
        } catch { if isCurrentAccess(generation: epoch, revision: revision) { self.error = error.localizedDescription } }
    }

    @discardableResult
    func acceptToday(_ state: TodayState) -> Bool {
        guard state.serverNow.isFinite, state.serverNow >= (today?.serverNow ?? -.infinity) else { return false }
        guard !state.canViewFriends || (state.round != nil && state.viewerReceipt?.roundId == state.round?.id) else { today = nil; clearPrivateContent(); return false }
        let changedRound = today != nil && today?.round?.id != state.round?.id
        let lostAccess = today?.canViewFriends == true && !state.canViewFriends
        if changedRound || lostAccess {
            clearPrivateContent()
            if recoveredDraft?.roundId != state.round?.id { clearDraft() }
        }
        if changedRound || !state.canViewFriends { feed = []; feedCursor = nil }
        today = state
        return true
    }

    func isCurrentAccess(generation: UUID, revision: UUID) -> Bool { self.generation == generation && accessRevision == revision }

    private func clearPrivateContent() {
        accessRevision = UUID()
        feed = []; feedCursor = nil
        PlaybackCoordinator.shared.clear()
        URLCache.shared.removeAllCachedResponses()
    }

    func relationshipChanged() async {
        invalidate(keepSession: true)
        await refresh()
        watch()
    }

    func switchIdentity(_ identity: DemoIdentity) async {
        guard let demo else { return }
        invalidate(keepSession: true)
        demo.switchIdentity(identity)
        await establishSession()
    }

    func signOut() async {
        guard let service else { return }
        busy = true
        do {
            if !service.isDemo { await NotificationCoordinator.shared.signOutCleanup() }
            clearDraft()
            try await service.signOut()
            invalidate()
            self.service = nil; viewer = nil; needsOnboarding = false
            UserDefaults.standard.removeObject(forKey: "TAKE.lastMode")
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    func invalidate(keepSession: Bool = false) {
        generation = UUID()
        accessRevision = UUID()
        refreshTask?.cancel(); refreshTask = nil
        service?.stopWatching()
        PlaybackCoordinator.shared.clear()
        URLCache.shared.removeAllCachedResponses()
        today = nil; feed = []; feedCursor = nil; friends = nil; profile = nil; recoveredDraft = nil
        if !keepSession { selectedTab = 0 }
    }

    private var draftDirectory: URL? {
        guard let id = service?.viewerID ?? viewer?.id else { return nil }
        let safeID = Data(id.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TAKE/\(isDemo ? "DemoDrafts" : "LiveDrafts")/\(safeID)", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    func saveDraft(_ value: PublicationDraft) -> PublicationDraft {
        guard value.ownerId == service?.viewerID, value.isDemo == isDemo, value.roundId == today?.round?.id, let directory = draftDirectory else { return value }
        var draft = value
        if let clip = draft.clip {
            let destination = directory.appendingPathComponent("\(draft.id).mp4")
            if clip.url != destination {
                do {
                    if !FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.copyItem(at: clip.url, to: destination) }
                    draft.clip = RecordedClip(url: destination, durationMs: clip.durationMs, source: clip.source, createdAt: clip.createdAt)
                } catch { self.error = "Couldn't save this draft. Keep TAKE open and try again." }
            }
        }
        if let data = try? JSONEncoder().encode(draft) { try? data.write(to: directory.appendingPathComponent("draft.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        recoveredDraft = draft
        return draft
    }

    func recoverDraft() {
        guard let directory = draftDirectory, let data = try? Data(contentsOf: directory.appendingPathComponent("draft.json")), var draft = try? JSONDecoder().decode(PublicationDraft.self, from: data), draft.ownerId == service?.viewerID, draft.isDemo == isDemo, draft.roundId == today?.round?.id, let clip = draft.clip, FileManager.default.fileExists(atPath: clip.url.path), draft.kind == .reply || today?.viewerReceipt == nil else { recoveredDraft = nil; return }
        if draft.state == .uploading || draft.state == .recording { draft.state = .failed; draft.failure = "Your recording is safe. Retry to check publication and continue." }
        recoveredDraft = draft
    }

    func clearDraft() {
        if let url = recoveredDraft?.clip?.url, url.path.hasPrefix(FileManager.default.temporaryDirectory.path), url.path.contains("TAKECapture-") { try? FileManager.default.removeItem(at: url) }
        if let directory = draftDirectory, let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { for file in files { try? FileManager.default.removeItem(at: file) } }
        recoveredDraft = nil
    }

    func sessionEnded() {
        clearDraft()
        invalidate()
        viewer = nil; service = nil; needsOnboarding = false
        UserDefaults.standard.removeObject(forKey: "TAKE.lastMode")
    }

    func resetDemo() async {
        guard isDemo else { return }
        let drafts = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TAKE/DemoDrafts", isDirectory: true)
        try? FileManager.default.removeItem(at: drafts)
        demo?.reset()
        await relationshipChanged()
    }

    func publish(_ initial: PublicationDraft, update: @escaping (PublicationDraft, Double) -> Void) async throws -> PublicationDraft {
        guard let service, initial.ownerId == service.viewerID, initial.isDemo == service.isDemo, let clip = initial.clip else { throw ServiceFailure.notFound }
        guard service.isDemo || clip.source == .camera else { throw ServiceFailure(code: "INVALID_MEDIA", message: "Live takes require a video recorded in TAKE.", retryable: false) }
        var draft = saveDraft(initial)
        let epoch = generation
        let revision = accessRevision
        var uploaded = false
        var processing = false
        if let id = draft.uploadId {
            let status = try await service.uploadStatus(uploadId: id)
            guard isCurrentAccess(generation: epoch, revision: revision) else { throw ServiceFailure.notFound }
            if let result = status.result, result.state == "published" { return try await finish(draft, result: result, epoch: epoch, revision: revision) }
            uploaded = (status.progress ?? 0) >= 1
            processing = status.state == "processing"
        }
        let intent: UploadIntent
        if !processing {
            intent = try await service.beginUpload(draft: draft)
            guard isCurrentAccess(generation: epoch, revision: revision) else { throw ServiceFailure.notFound }
            draft.uploadId = intent.uploadId
            draft.state = .uploading; draft.failure = nil; draft = saveDraft(draft); update(draft, uploaded ? 1 : 0)
            if !uploaded {
                let uploadingDraft = draft
                try await service.upload(clip: clip, intent: intent) { progress in update(uploadingDraft, progress) }
            }
        }
        guard isCurrentAccess(generation: epoch, revision: revision), let uploadID = draft.uploadId else { throw ServiceFailure.notFound }
        draft.state = .processing; draft = saveDraft(draft); update(draft, 1)
        var result = try await service.finalize(uploadId: uploadID)
        for _ in 0..<20 where result.state == "processing" {
            try await Task.sleep(for: .seconds(2))
            guard isCurrentAccess(generation: epoch, revision: revision) else { throw ServiceFailure.notFound }
            let status = try await service.uploadStatus(uploadId: uploadID)
            if let complete = status.result { result = complete }
            else if status.state == "failed" { throw status.failure ?? ServiceFailure(code: "PROCESSING_FAILED", message: "This video couldn't be processed. Retake or retry.", retryable: true) }
        }
        guard result.state != "processing" else { throw ServiceFailure(code: "STILL_PROCESSING", message: "Your video is still processing. Your draft is saved. Check again shortly; your feed won't unlock until publication is confirmed.", retryable: true) }
        return try await finish(draft, result: result, epoch: epoch, revision: revision)
    }

    private func finish(_ draft: PublicationDraft, result: PublicationResult, epoch: UUID, revision: UUID) async throws -> PublicationDraft {
        guard isCurrentAccess(generation: epoch, revision: revision), result.state == "published" else { throw result.failure ?? ServiceFailure.notFound }
        if draft.kind == .original { guard result.receipt?.roundId == draft.roundId else { throw ServiceFailure.notFound } }
        var complete = draft; complete.state = .published; complete.failure = nil
        clearDraft()
        TakeTheme.haptic(.medium)
        reveal = draft.kind == .original
        await refresh()
        return complete
    }
}
