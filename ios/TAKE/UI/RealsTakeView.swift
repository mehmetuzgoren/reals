import AVFoundation
import SwiftUI
import UIKit

struct RealsTakeView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let originalID: String
    let round: DailyRound
    var initialReply = false
    @State private var original: OriginalSummary?
    @State private var replies: [ReplySummary] = []
    @State private var cursor: String?
    @State private var selectedReplyID: String?
    @State private var openedInitialReply = false
    @State private var paging = false
    @State private var liking = false
    @State private var failure: String?
    @State private var draft: PublicationDraft?
    @State private var comments: CommentDestination?
    @State private var battle: BattleDestination?
    @State private var cancelWatch: (() -> Void)?
    @State private var visible = false
    @State private var viewEpoch = UUID()
    @State private var loadEpoch = UUID()

    private struct CommentDestination: Identifiable {
        let contentID: String
        let kind: ContentKind
        var id: String { "\(kind.rawValue):\(contentID)" }
    }

    private struct BattleDestination: Identifiable {
        let id: String
    }

    private var selectedReply: ReplySummary? { replies.first { $0.id == selectedReplyID } }
    private var authorizationID: String { "\(model.generation)-\(model.accessRevision)-\(round.id)" }

    var body: some View {
        GeometryReader { _ in
            ZStack {
                TakeTheme.surface
                if let original {
                    let reply = selectedReply
                    let contentID = reply?.id ?? original.id
                    let kind: ContentKind = reply == nil ? .original : .reply
                    RealsVideoSurface(contentID: contentID, kind: kind, roundID: round.id, autoplay: true) { message in
                        if visible { failure = message }
                    }
                    .id(contentID)
                    VStack {
                        HStack {
                            backButton
                            Spacer()
                            if let reply, let index = replies.firstIndex(where: { $0.id == reply.id }) {
                                Text("Reply \(index + 1) of \(max(original.visibleReplyCount, replies.count))")
                                    .font(.system(size: 14, weight: .bold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(TakeTheme.background, in: Capsule())
                                    .padding(.trailing, 4)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 52)
                        Spacer()
                    }
                    VStack {
                        Spacer()
                        HStack(alignment: .bottom, spacing: 10) {
                            identity(original: original, reply: reply)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            rail(contentID: contentID, kind: kind, likeCount: reply?.likeCount ?? original.likeCount, liked: reply?.viewerLiked ?? original.viewerLiked, commentCount: reply?.visibleCommentCount ?? original.visibleCommentCount)
                        }
                        .padding(.leading, 16)
                        .padding(.trailing, 16)
                        .padding(.bottom, reply == nil ? 84 : 32)
                    }
                    if reply == nil, original.visibleReplyCount > 0 {
                        VStack {
                            Spacer()
                            Button { Task { await pageReply(forward: true) } } label: {
                                VStack(spacing: 6) {
                                    Image(systemName: "chevron.up").font(.system(size: 12, weight: .medium))
                                    Text("Swipe up for \(original.visibleReplyCount) \(original.visibleReplyCount == 1 ? "reply" : "replies")")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                                .foregroundStyle(TakeTheme.muted)
                                .frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Open replies")
                            .accessibilityIdentifier("Open replies")
                            .padding(.bottom, 26)
                        }
                    }
                } else {
                    VStack {
                        HStack { backButton; Spacer() }
                            .padding(.horizontal, 12)
                            .padding(.top, 52)
                        Spacer()
                    }
                }
            }
            .foregroundStyle(TakeTheme.white)
            .simultaneousGesture(DragGesture(minimumDistance: 35).onEnded { value in
                guard abs(value.translation.height) > abs(value.translation.width) else { return }
                Task { await pageReply(forward: value.translation.height < 0) }
            })
        }
        .ignoresSafeArea()
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .statusBarHidden()
        .preferredColorScheme(.dark)
        .task(id: authorizationID) { await startConversation() }
        .onChange(of: model.generation) { _, _ in invalidate(); dismiss() }
        .onChange(of: model.accessRevision) { _, _ in invalidate(); dismiss() }
        .onChange(of: model.today?.round?.id) { _, id in if id != round.id { invalidate(); dismiss() } }
        .onDisappear {
            visible = false
            viewEpoch = UUID()
            loadEpoch = UUID()
            cancelWatch?(); cancelWatch = nil
        }
        .sheet(item: $comments, onDismiss: { Task { await load() } }) { destination in
            RealsCommentsView(contentID: destination.contentID, kind: destination.kind, conversationID: originalID)
                .environmentObject(model)
        }
        .fullScreenCover(item: $draft, onDismiss: { Task { await load() } }) { value in
            RealsComposerView(initialDraft: value, round: round).environmentObject(model)
        }
        .fullScreenCover(item: $battle, onDismiss: { Task { await load() } }) { destination in
            RealsBattleView(battleID: destination.id, round: round).environmentObject(model)
        }
        .alert("Reals", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) { failure = nil }
        } message: { Text(failure ?? "") }
    }

    private var backButton: some View {
        Button { dismiss() } label: {
            Image(systemName: "chevron.left").font(.system(size: 20, weight: .regular)).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Back")
        .accessibilityIdentifier("Back")
    }

    private func identity(original: OriginalSummary, reply: ReplySummary?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if reply == nil, original.audience == .public, let reference = original.battle {
                Button {
                    guard RealsContentAccess(model: model, roundID: round.id) != nil else { return }
                    PlaybackCoordinator.shared.pause()
                    battle = BattleDestination(id: reference.battleId)
                } label: {
                    HStack(spacing: 7) {
                        RealsCrossedSwords().stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round)).frame(width: 13, height: 13)
                        Text("Battle vs \(reference.opponent.username)").font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(TakeTheme.background)
                    .padding(.horizontal, 13)
                    .frame(height: 32)
                    .background(TakeTheme.white, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Battle")
                .accessibilityIdentifier("Battle")
                .padding(.bottom, 3)
            }
            HStack(spacing: 10) {
                RealsAvatar(profile: reply?.author ?? original.author, size: 36)
                if let reply {
                    Text(reply.audience == .public ? reply.author.username : reply.author.displayName)
                        .font(.system(size: 17, weight: .bold))
                } else {
                    Text("\(original.audience == .public ? original.author.username : original.author.displayName) · \(round.label(for: original.optionId))")
                        .font(.system(size: 17, weight: .bold))
                }
            }
            Text(reply == nil ? round.question : "Replying to \(original.audience == .public ? original.author.username : original.author.displayName)")
                .font(.system(size: 15))
                .foregroundStyle(TakeTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func rail(contentID: String, kind: ContentKind, likeCount: Int, liked: Bool, commentCount: Int) -> some View {
        VStack(spacing: 22) {
            Button { Task { await toggleLike(contentID: contentID, kind: kind) } } label: {
                VStack(spacing: 6) {
                    Image(systemName: liked ? "heart.fill" : "heart").font(.system(size: 23, weight: .regular))
                    Text("\(likeCount)").font(.system(size: 14, weight: .semibold))
                }
                .frame(width: 52, height: 46)
            }
            .disabled(liking)
            .accessibilityLabel("Like")
            .accessibilityIdentifier("Like")
            .accessibilityValue("\(likeCount), \(liked ? "liked" : "not liked")")
            Button {
                guard RealsContentAccess(model: model, roundID: round.id) != nil else { return }
                PlaybackCoordinator.shared.pause()
                comments = CommentDestination(contentID: contentID, kind: kind)
            } label: {
                VStack(spacing: 6) {
                    Image(systemName: "bubble.left").font(.system(size: 22, weight: .regular))
                    Text("\(commentCount)").font(.system(size: 14, weight: .semibold))
                }
                .frame(width: 52, height: 46)
            }
            .accessibilityLabel("Comments")
            .accessibilityIdentifier("Comments")
            .accessibilityValue("\(commentCount)")
            Button { makeReply() } label: {
                VStack(spacing: 6) {
                    Image(systemName: "video").font(.system(size: 23, weight: .regular))
                    Text("Reply").font(.system(size: 14, weight: .semibold))
                }
                .frame(width: 52, height: 46)
            }
            .accessibilityLabel("Reply")
            .accessibilityIdentifier("Reply")
        }
        .buttonStyle(.plain)
    }

    private func startConversation() async {
        visible = true
        viewEpoch = UUID()
        liking = false; paging = false
        cancelWatch?(); cancelWatch = nil
        guard let access = RealsContentAccess(model: model, roundID: round.id) else { invalidate(); return }
        let epoch = viewEpoch
        await load()
        guard visible, epoch == viewEpoch, access.isCurrent(model), original != nil, !Task.isCancelled else { return }
        cancelWatch = access.service.watchConversation(originalId: originalID) {
            guard visible, epoch == viewEpoch, access.isCurrent(model) else { return }
            Task { await load() }
        }
    }

    private func load() async {
        guard visible, let access = RealsContentAccess(model: model, roundID: round.id) else { return }
        let epoch = UUID(); loadEpoch = epoch
        let screen = viewEpoch
        do {
            let value = try await access.service.detail(originalId: originalID)
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            let page = try await access.service.replies(originalId: originalID, cursor: nil)
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            guard value.roundId == round.id else { throw ServiceFailure.notFound }
            original = value
            replies = page.items
            cursor = page.nextCursor
            if let selectedReplyID, !replies.contains(where: { $0.id == selectedReplyID }) { self.selectedReplyID = nil }
            if !openedInitialReply {
                openedInitialReply = true
                if initialReply { selectedReplyID = replies.first?.id }
            }
            paging = false
        } catch {
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            original = nil; replies = []; cursor = nil; selectedReplyID = nil
            PlaybackCoordinator.shared.clear()
            failure = error.localizedDescription
        }
    }

    private func pageReply(forward: Bool) async {
        guard visible, !paging, RealsContentAccess(model: model, roundID: round.id) != nil else { return }
        guard let selectedReplyID, let index = replies.firstIndex(where: { $0.id == selectedReplyID }) else {
            if forward { self.selectedReplyID = replies.first?.id }
            return
        }
        if !forward {
            self.selectedReplyID = index == 0 ? nil : replies[index - 1].id
            return
        }
        if index + 1 < replies.count { self.selectedReplyID = replies[index + 1].id; return }
        guard let cursor, let access = RealsContentAccess(model: model, roundID: round.id) else { return }
        let epoch = UUID(); loadEpoch = epoch
        let screen = viewEpoch
        paging = true
        do {
            let page = try await access.service.replies(originalId: originalID, cursor: cursor)
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            replies += page.items.filter { item in !replies.contains { $0.id == item.id } }
            self.cursor = page.nextCursor
            if index + 1 < replies.count { self.selectedReplyID = replies[index + 1].id }
            paging = false
        } catch {
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            paging = false
            if (error as? ServiceFailure)?.code == "NOT_FOUND" { await load() }
            else { failure = error.localizedDescription }
        }
    }

    private func toggleLike(contentID: String, kind: ContentKind) async {
        guard visible, !liking, let access = RealsContentAccess(model: model, roundID: round.id) else { return }
        let screen = viewEpoch
        liking = true
        do {
            let result = try await access.service.toggleLike(contentId: contentID, kind: kind)
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            if kind == .original, original?.id == contentID {
                original?.likeCount = result.likeCount
                original?.viewerLiked = result.liked
            } else if let index = replies.firstIndex(where: { $0.id == contentID }) {
                replies[index].likeCount = result.likeCount
                replies[index].viewerLiked = result.liked
            }
            liking = false
        } catch {
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            liking = false
            failure = error.localizedDescription
        }
    }

    private func makeReply() {
        guard visible, let original, let access = RealsContentAccess(model: model, roundID: round.id), let owner = access.service.viewerID else { return }
        PlaybackCoordinator.shared.pause()
        if let saved = model.recoveredDraft, saved.kind == .reply, saved.originalId == original.id, saved.ownerId == owner,
           saved.isDemo == access.service.isDemo, saved.roundId == original.roundId {
            draft = saved
            return
        }
        draft = PublicationDraft(id: UUID().uuidString, ownerId: owner, isDemo: access.service.isDemo, roundId: original.roundId, optionId: nil, originalId: original.id, clip: nil, uploadId: nil, state: .draft, failure: nil, audience: original.audience)
    }

    private func invalidate() {
        visible = false
        viewEpoch = UUID(); loadEpoch = UUID()
        cancelWatch?(); cancelWatch = nil
        original = nil; replies = []; cursor = nil; selectedReplyID = nil
        draft = nil; comments = nil; battle = nil
        paging = false; liking = false; failure = nil
    }
}

@MainActor
struct RealsContentAccess {
    let service: any TakeService
    private let generation: UUID
    private let revision: UUID
    private let roundID: String

    init?(model: AppModel, roundID: String? = nil) {
        guard let service = model.service, let currentRound = model.today?.round,
              model.today?.canViewFriends == true, model.today?.viewerReceipt?.roundId == currentRound.id,
              roundID == nil || roundID == currentRound.id else { return nil }
        self.service = service
        generation = model.generation
        revision = model.accessRevision
        self.roundID = currentRound.id
    }

    func isCurrent(_ model: AppModel) -> Bool {
        model.isCurrentAccess(generation: generation, revision: revision) && model.service === service && model.today?.round?.id == roundID && model.today?.canViewFriends == true && model.today?.viewerReceipt?.roundId == roundID
    }
}

struct RealsVideoSurface: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var playback = PlaybackCoordinator.shared
    let contentID: String
    let kind: ContentKind
    let roundID: String
    var autoplay = false
    var centerButtonOnly = false
    var playLabel = "Play take"
    let onFailure: (String) -> Void
    @State private var playerKey = UUID().uuidString
    @State private var requestEpoch = UUID()
    @State private var ownsPlayback = false
    @State private var paused = true
    @State private var requesting = false

    private var authorizationID: String { "\(model.generation)-\(model.accessRevision)-\(contentID)" }
    private var currentPlayer: AVPlayer? {
        guard ownsPlayback, playback.activeID == nil || playback.activeID == playerKey else { return nil }
        return playback.player
    }

    var body: some View {
        ZStack {
            TakeTheme.surface.allowsHitTesting(false)
            if let player = currentPlayer {
                RealsPlayerLayer(player: player).allowsHitTesting(false)
            }
            if centerButtonOnly {
                playButton.frame(width: 44, height: 44)
            } else {
                playButton.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .clipped()
        .task(id: authorizationID) {
            releasePlayback()
            if autoplay, scenePhase == .active { await requestPlayback() }
        }
        .onChange(of: playback.activeID) { _, id in
            if let id, id != playerKey { ownsPlayback = false; paused = true }
            else if id == nil { paused = true }
        }
        .onChange(of: playback.player) { _, player in
            if player != nil, ownsPlayback, playback.activeID == playerKey { paused = false }
        }
        .onChange(of: playback.errorMessage) { _, message in
            if ownsPlayback, let message, RealsContentAccess(model: model, roundID: roundID) != nil { onFailure(message) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active, ownsPlayback, playback.activeID == playerKey { playback.pause(); paused = true }
        }
        .onDisappear { releasePlayback() }
    }

    private var playButton: some View {
        Button { Task { await togglePlayback() } } label: {
            ZStack {
                Color.clear
                if paused || currentPlayer == nil { RealsPlayTriangle() }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playLabel)
        .accessibilityIdentifier(playLabel)
        .accessibilityValue(paused ? "Paused" : "Playing")
    }

    private func togglePlayback() async {
        guard scenePhase == .active, !requesting, RealsContentAccess(model: model, roundID: roundID) != nil else { return }
        if ownsPlayback, playback.activeID == playerKey, let player = playback.player {
            if paused { player.play(); paused = false }
            else { player.pause(); paused = true }
            return
        }
        await requestPlayback()
    }

    private func requestPlayback() async {
        guard let access = RealsContentAccess(model: model, roundID: roundID), scenePhase == .active else { return }
        let epoch = UUID(); requestEpoch = epoch
        requesting = true
        do {
            let grant = try await access.service.playback(contentId: contentID, kind: kind, asset: "video")
            guard epoch == requestEpoch, access.isCurrent(model), scenePhase == .active, !Task.isCancelled else { return }
            guard let url = URL(string: grant.url) else { throw ServiceFailure.notFound }
            let expiresAt = access.service.isDemo ? nil : Date().addingTimeInterval((grant.expiresAt - access.service.serverNow) / 1_000)
            ownsPlayback = true
            paused = true
            playback.play(id: playerKey, url: url, expiresAt: expiresAt)
            if playback.player != nil { paused = false }
            requesting = false
        } catch {
            guard epoch == requestEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            requesting = false
            onFailure(error.localizedDescription)
        }
    }

    private func releasePlayback() {
        requestEpoch = UUID()
        requesting = false
        if ownsPlayback, playback.activeID == nil || playback.activeID == playerKey { playback.clear() }
        ownsPlayback = false
        paused = true
    }
}

private struct RealsPlayerLayer: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.videoGravity = .resizeAspectFill
        view.playerLayer.player = player
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) { uiView.playerLayer.player = player }
    static func dismantleUIView(_ uiView: PlayerView, coordinator: ()) { uiView.playerLayer.player = nil }

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

private struct RealsCrossedSwords: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.75, y: rect.minY + rect.height * 0.75))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.14, y: rect.minY + rect.height * 0.35))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.35, y: rect.minY + rect.height * 0.14))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.88, y: rect.minY + rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.25, y: rect.minY + rect.height * 0.75))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.88, y: rect.minY + rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.65, y: rect.minY + rect.height * 0.14))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.88, y: rect.minY + rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.86, y: rect.minY + rect.height * 0.35))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.58, y: rect.minY + rect.height * 0.78))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.78, y: rect.minY + rect.height * 0.58))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.22, y: rect.minY + rect.height * 0.58))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.42, y: rect.minY + rect.height * 0.78))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.74, y: rect.minY + rect.height * 0.74))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.88, y: rect.minY + rect.height * 0.88))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.26, y: rect.minY + rect.height * 0.74))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.88))
        return path
    }
}
