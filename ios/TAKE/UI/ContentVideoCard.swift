import AVKit
import SwiftUI

struct ContentVideoCard: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var playback = PlaybackCoordinator.shared
    let id: String
    let author: PublicProfile
    let kind: ContentKind
    let durationMs: Double
    var option: String? = nil
    @State private var thumbnail: UIImage?
    @State private var loading = false
    @State private var failure: String?
    @State private var caption: CaptionResult?
    @State private var showCaptions = false
    @State private var attemptedPlayback = false
    private var sample: Bool { (model.service as? DemoService)?.isSampleClip(id, kind: kind) == true }
    private var active: Bool { playback.activeID == id }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                if active, let player = playback.player {
                    VideoPlayer(player: player).frame(minHeight: 340).accessibilityLabel("Video by \(author.displayName)")
                } else {
                    ZStack {
                        LinearGradient(colors: [TakeTheme.raised, TakeTheme.background], startPoint: .topLeading, endPoint: .bottomTrailing)
                        if let thumbnail { Image(uiImage: thumbnail).resizable().scaledToFill().frame(height: 350).clipped() }
                        else if sample, let image = UIImage(named: "poster-\(author.id)") { Image(uiImage: image).resizable().scaledToFill().frame(height: 350).clipped() }
                        else { VStack(spacing: 14) { AvatarView(profile: author, size: 110); Text("\(author.displayName)'s \(kind == .original ? "take" : "reply")").font(.headline).foregroundStyle(TakeTheme.white) } }
                        LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                        Button { Task { await play() } } label: {
                            Group { if loading { ProgressView().tint(TakeTheme.background) } else { Image(systemName: "play.fill").font(.title2).offset(x: 2) } }.frame(width: 68, height: 68).foregroundStyle(TakeTheme.background).background(TakeTheme.white.opacity(0.96), in: Circle())
                        }.buttonStyle(.plain).disabled(loading).accessibilityLabel("Play \(author.displayName)'s \(kind == .original ? "take" : "reply")").accessibilityIdentifier("Play \(author.displayName)")
                    }.frame(height: 350)
                }
                if !active {
                    VStack(alignment: .leading, spacing: 8) {
                        if let option { Text(option).font(.headline.bold()).foregroundStyle(TakeTheme.background).padding(.horizontal, 14).padding(.vertical, 8).background(TakeTheme.lime, in: Capsule()) }
                        HStack { if sample { Label("LOCAL SAMPLE", systemImage: "sparkles").font(.caption2.bold()).tracking(1) }; Spacer(); Text("\(Int((durationMs / 1_000).rounded(.up)))s").font(.caption.monospaced().bold()) }.foregroundStyle(.white)
                    }.padding(20).allowsHitTesting(false)
                }
            }
            HStack(spacing: 12) {
                AvatarView(profile: author, size: 40)
                VStack(alignment: .leading, spacing: 2) { Text(author.displayName).font(.headline); Text("@\(author.username)").font(.caption).foregroundStyle(TakeTheme.muted) }
                Spacer()
                Button { Task { await toggleCaptions() } } label: { Image(systemName: "captions.bubble").font(.title3).frame(width: 44, height: 44).foregroundStyle(TakeTheme.muted) }.accessibilityLabel("Captions")
            }.padding(18)
            if sample { Text("Fictional sample video with synthetic sound. Not a live recording.").font(.caption2).foregroundStyle(TakeTheme.muted).padding(.horizontal, 18).padding(.bottom, 12) }
            if showCaptions { Text(caption?.status == "ready" ? (caption?.text ?? "Captions unavailable.") : "Captions aren't available for this video.").font(.subheadline).foregroundStyle(TakeTheme.muted).padding(.horizontal, 18).padding(.bottom, 16) }
            if let failure { InlineNotice(text: failure).padding([.horizontal, .bottom], 16) }
        }
        .background(TakeTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .task(id: id) { await loadThumbnail() }
        .onDisappear { if active { playback.pause() } }
        .onChange(of: playback.activeID) { _, activeID in if let activeID, activeID != id { attemptedPlayback = false } }
        .onChange(of: playback.errorMessage) { _, message in if attemptedPlayback, let message { failure = message } }
    }
    private func play() async {
        guard let service = model.service else { return }
        loading = true; failure = nil; attemptedPlayback = true
        let epoch = model.generation
        let revision = model.accessRevision
        do {
            let grant = try await service.playback(contentId: id, kind: kind, asset: "video")
            guard model.isCurrentAccess(generation: epoch, revision: revision), let url = URL(string: grant.url) else { throw ServiceFailure.notFound }
            playback.play(id: id, url: url)
        } catch { failure = "Video unavailable. \(error.localizedDescription) Tap play to try again." }
        loading = false
    }
    private func loadThumbnail() async {
        guard !model.isDemo, let service = model.service else { return }
        let epoch = model.generation
        let revision = model.accessRevision
        do {
            let grant = try await service.playback(contentId: id, kind: kind, asset: "thumbnail")
            guard model.isCurrentAccess(generation: epoch, revision: revision), let url = URL(string: grant.url) else { return }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let (bytes, response) = try await session.data(from: url)
            guard model.isCurrentAccess(generation: epoch, revision: revision), (response as? HTTPURLResponse)?.statusCode == 200, bytes.count <= 5_242_880 else { return }
            thumbnail = UIImage(data: bytes)
        } catch {}
    }
    private func toggleCaptions() async {
        showCaptions.toggle()
        guard showCaptions, caption == nil else { return }
        do { caption = try await model.service?.captions(contentId: id, kind: kind) }
        catch { caption = CaptionResult(status: "unavailable", text: nil) }
    }
}
