import AVKit
import SwiftUI

struct ComposerView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var capture = CaptureController()
    @ObservedObject private var playback = PlaybackCoordinator.shared
    let initialDraft: PublicationDraft
    let round: DailyRound?
    @State private var draft: PublicationDraft
    @State private var progress = 0.0
    @State private var publishing = false
    @State private var showDiscard = false
    @State private var showFixtureConfirmation = false
    @State private var publicationTask: Task<Void, Never>?

    init(initialDraft: PublicationDraft, round: DailyRound?) {
        self.initialDraft = initialDraft; self.round = round
        _draft = State(initialValue: initialDraft)
    }
    private var hasClip: Bool { draft.clip != nil }
    private var title: String { draft.kind == .reply ? "Video reply" : "Your take" }
    private var previewID: String { "preview-\(draft.id)" }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack { Eyebrow(text: draft.state.rawValue.uppercased(), color: draft.state == .failed ? TakeTheme.coral : TakeTheme.lime); Spacer(); Label("15s max", systemImage: "timer").font(.caption.bold()).foregroundStyle(TakeTheme.muted) }
                    Text(round?.question ?? "Today's question").font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
                    if let option = round?.options.first(where: { $0.id == draft.optionId }) { Text("Your position: \(option.label)").font(.subheadline.bold()).foregroundStyle(TakeTheme.lime) }
                    cameraSurface
                    if let clip = draft.clip {
                        if clip.source == .simulatorFixture { InlineNotice(text: "SIMULATOR FIXTURE · A bundled 4-second fictional sample with synthetic sound. This wasn't captured live and can only be published in Demo Mode.", color: TakeTheme.lavender) }
                        HStack {
                            Button { playPreview() } label: { Label("Preview with sound", systemImage: "speaker.wave.2.fill").font(.subheadline.bold()).frame(minHeight: 44) }.disabled(publishing)
                            Spacer()
                            Text(String(format: "%.1fs / 15s", clip.durationMs / 1_000)).font(.caption.monospaced()).foregroundStyle(TakeTheme.muted)
                        }
                        if publishing {
                            VStack(alignment: .leading, spacing: 10) {
                                ProgressView(value: progress).tint(TakeTheme.lime)
                                Text(draft.state == .processing ? "Processing your video. Your take isn't public yet." : "Uploading privately… \(Int(progress * 100))%").font(.subheadline).foregroundStyle(TakeTheme.muted)
                            }.accessibilityElement(children: .combine)
                        }
                        if let failure = draft.failure { InlineNotice(text: failure) }
                        PrimaryButton(title: publishing ? (draft.state == .processing ? "Processing…" : "Uploading…") : (draft.state == .failed ? "Retry publication" : "Publish \(draft.kind == .reply ? "reply" : "take")"), symbol: publishing ? nil : "arrow.up", disabled: publishing) { publish() }
                        Button("Retake") { Task { await retake() } }.frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(TakeTheme.muted).disabled(publishing)
                    } else { captureControls }
                    Label(draft.kind == .reply ? "Replies are visible only to eligible friends of both people in the conversation." : "Only approved friends who posted this round can see your take.", systemImage: "person.2.badge.shield.checkmark").font(.caption).foregroundStyle(TakeTheme.muted)
                    if !hasClip { Text("Camera and microphone are used only to record your take. You can stop early; recording stops automatically at 15 seconds.").font(.caption).foregroundStyle(TakeTheme.muted) }
                }.padding(24)
            }
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline).takeScreen()
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { close() }.disabled(publishing) } }
            .interactiveDismissDisabled(publishing || capture.state == .recording)
        }
        .onChange(of: capture.clip) { _, clip in
            guard let clip else { return }
            draft.clip = clip; draft.state = .preview; draft.failure = nil
            draft = model.saveDraft(draft)
            if draft.clip?.url == clip.url { _ = capture.detachClip() }
        }
        .onChange(of: capture.state) { _, state in
            if state == .recording { draft.state = .recording }
            if state == .failed { draft.state = .failed; draft.failure = capture.errorMessage }
        }
        .onChange(of: playback.errorMessage) { _, message in if let message, draft.clip != nil { draft.failure = message } }
        .confirmationDialog("Use a simulator fixture?", isPresented: $showFixtureConfirmation, titleVisibility: .visible) {
            Button("Use labeled 4-second sample") { useFixture() }
        } message: { Text("This uses bundled fictional video, not the camera. It stays in Demo Mode and can never be sent to live TAKE.") }
        .confirmationDialog("Keep this recording?", isPresented: $showDiscard, titleVisibility: .visible) {
            Button("Save draft and close") { draft = model.saveDraft(draft); dismiss() }
            Button("Discard recording", role: .destructive) { Task { if let id = draft.uploadId { try? await model.service?.cancelUpload(uploadId: id) }; model.clearDraft(); dismiss() } }
        }
        .onDisappear { capture.shutdown(); if playback.activeID == previewID { playback.clear() } }
    }

    private var cameraSurface: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28).fill(TakeTheme.surface)
            if let clip = draft.clip {
                if playback.activeID == previewID, let player = playback.player { VideoPlayer(player: player) }
                else { Button { playPreview() } label: { VStack(spacing: 16) { Image(systemName: "play.circle.fill").font(.system(size: 58)).foregroundStyle(TakeTheme.lime); Text(clip.source == .camera ? "Your recording is ready." : "Labeled sample is ready.").font(.headline) } }.buttonStyle(.plain).accessibilityLabel("Preview your video with sound") }
            } else if capture.state == .ready || capture.state == .recording || capture.state == .exporting {
                CapturePreview(session: capture.session)
                VStack { Spacer(); HStack { Circle().fill(capture.state == .recording ? TakeTheme.coral : TakeTheme.lime).frame(width: 9, height: 9); Text(capture.state == .recording ? String(format: "%04.1fs", capture.elapsed) : "Front camera · Portrait").font(.subheadline.monospaced().bold()).foregroundStyle(.white) }.padding(14).background(.black.opacity(0.5), in: Capsule()).padding(20) }
                if capture.state == .exporting { ProgressView("Preparing MP4…").padding(20).background(TakeTheme.background.opacity(0.85), in: RoundedRectangle(cornerRadius: 16)) }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "video.badge.waveform").font(.system(size: 52, weight: .light)).foregroundStyle(TakeTheme.lavender)
                    Text("A face. A voice. A point of view.").font(.headline).multilineTextAlignment(.center)
                    Text("Your camera stays off until you enable it.").font(.subheadline).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center)
                }.padding(24)
            }
        }.frame(height: 380).clipShape(RoundedRectangle(cornerRadius: 28))
    }

    private var captureControls: some View {
        VStack(spacing: 14) {
            if capture.state == .recording {
                PrimaryButton(title: "Stop recording", symbol: "stop.fill", color: TakeTheme.coral) { capture.stop(); TakeTheme.haptic(.medium) }
            } else if capture.state == .ready {
                PrimaryButton(title: "Start recording", symbol: "record.circle", color: TakeTheme.coral) { playback.clear(); capture.start(); TakeTheme.haptic(.medium) }
            } else {
                PrimaryButton(title: capture.state == .preparing ? "Preparing camera…" : "Enable camera & microphone", symbol: "camera.fill", disabled: capture.state == .preparing || capture.state == .exporting) { Task { await capture.prepare() } }
            }
            if let failure = capture.errorMessage {
                InlineNotice(text: failure)
                Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }.frame(minHeight: 44)
            }
            #if targetEnvironment(simulator)
            if model.isDemo, capture.state != .recording {
                Button { showFixtureConfirmation = true } label: { Label("Use simulator sample instead", systemImage: "play.rectangle.on.rectangle").font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 48) }.tint(TakeTheme.lavender).accessibilityIdentifier("Use simulator sample instead")
                Text("Explicit fixture flow · No camera recording is simulated.").font(.caption2).foregroundStyle(TakeTheme.muted)
            }
            #endif
        }
    }

    private func useFixture() {
        guard model.isDemo, let url = DemoService.fixtureURL() else { return }
        capture.shutdown()
        draft.clip = RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date())
        draft.state = .preview; draft.failure = nil
        draft = model.saveDraft(draft)
        playPreview()
    }
    private func playPreview() { if let clip = draft.clip { playback.play(id: previewID, url: clip.url) } }
    private func retake() async {
        if let id = draft.uploadId { try? await model.service?.cancelUpload(uploadId: id) }
        playback.clear(); model.clearDraft()
        draft = PublicationDraft(id: UUID().uuidString, ownerId: draft.ownerId, isDemo: draft.isDemo, roundId: draft.roundId, optionId: draft.optionId, originalId: draft.originalId, clip: nil, uploadId: nil, state: .draft, failure: nil)
        await capture.retake()
    }
    private func close() {
        if capture.state == .recording { capture.stop(); return }
        if draft.clip != nil, draft.state != .published { showDiscard = true } else { dismiss() }
    }
    private func publish() {
        publishing = true; playback.clear(); capture.shutdown()
        publicationTask = Task {
            do {
                draft = try await model.publish(draft) { value, fraction in draft = value; progress = fraction }
                dismiss()
            } catch {
                draft.state = .failed; draft.failure = error.localizedDescription
                draft = model.saveDraft(draft)
            }
            publishing = false
        }
    }
}
