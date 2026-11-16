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
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                AvatarView(profile: author, size: 34)
                Text(author.displayName).font(.subheadline.bold())
                Spacer(minLength: 8)
                if let option { Text(option).font(.subheadline).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.trailing) }
                Button { Task { await toggleCaptions() } } label: { Image(systemName: "captions.bubble").font(.body).frame(width: 44, height: 44).foregroundStyle(TakeTheme.muted) }.accessibilityLabel("Captions")
            }
            ZStack(alignment: .bottomLeading) {
                if active, let player = playback.player {
                    VideoPlayer(player: player).accessibilityLabel("Video by \(author.displayName)")
                } else {
                    ZStack {
                        TakeTheme.surface
                        if let thumbnail { Image(uiImage: thumbnail).resizable().scaledToFit() }
                        else if sample, let image = UIImage(named: "poster-\(author.id)") { Image(uiImage: image).resizable().scaledToFit().saturation(0) }
                        Button { Task { await play() } } label: {
                            Group { if loading { ProgressView().tint(TakeTheme.white) } else { Image(systemName: "play.fill").font(.title2).offset(x: 2) } }.frame(width: 64, height: 64).foregroundStyle(TakeTheme.white).background(TakeTheme.background.opacity(0.5), in: Circle())
                        }.buttonStyle(.plain).disabled(loading).accessibilityLabel("Play \(author.displayName)'s \(kind == .original ? "take" : "reply")").accessibilityIdentifier("Play \(author.displayName)")
                    }
                }
                if !active {
                    HStack { if sample { Text("LOCAL SAMPLE").font(.caption2.bold()).tracking(1) }; Spacer(); Text("\(Int((durationMs / 1_000).rounded(.up)))s").font(.caption.monospaced()) }.foregroundStyle(TakeTheme.white).padding(16).background(.black.opacity(0.35)).allowsHitTesting(false)
                }
            }
            .aspectRatio(9.0 / 13.0, contentMode: .fit)
            .background(TakeTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 22))
            if sample { Text("Fictional sample · Synthetic sound · Not a live recording").font(.caption2).foregroundStyle(TakeTheme.muted) }
            if showCaptions { Text(caption?.status == "ready" ? (caption?.text ?? "Captions unavailable.") : "Captions aren't available for this video.").font(.subheadline).foregroundStyle(TakeTheme.muted) }
            if let failure { InlineNotice(text: failure) }
        }
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
            let expiresAt = service.isDemo ? nil : Date().addingTimeInterval((grant.expiresAt - service.serverNow) / 1_000)
            playback.play(id: id, url: url, expiresAt: expiresAt)
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
