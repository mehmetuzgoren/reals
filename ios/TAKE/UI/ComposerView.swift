import AVKit
import SwiftUI

struct ComposerView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
    private var previewID: String { "preview-\(draft.id)" }
    private var captureButtonTitle: String {
        if capture.state == .recording { return "Stop recording" }
        if capture.state == .ready { return "Start recording" }
        return capture.state == .preparing ? "Preparing camera…" : "Enable camera & microphone"
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 8) {
                        Button { close() } label: {
                            Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                        }.buttonStyle(.plain).accessibilityLabel("Close").accessibilityIdentifier("Close").disabled(publishing)
                        Text(round?.question ?? "Today's question")
                            .font(.subheadline.weight(.semibold)).multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, minHeight: 44)
                        Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
                    }
                    cameraSurface
                    if let clip = draft.clip {
                        HStack {
                            Button { playPreview() } label: { Label("Preview with sound", systemImage: "speaker.wave.2.fill").font(.subheadline.bold()).frame(minHeight: 44) }.disabled(publishing)
                            Spacer()
                            Text(draft.state.rawValue.capitalized).font(.caption).foregroundStyle(TakeTheme.muted)
                        }
                        if clip.source == .simulatorFixture { InlineNotice(text: "SIMULATOR FIXTURE · A bundled 4-second fictional sample with synthetic sound. This wasn't captured live and can only be published in Demo Mode.", color: TakeTheme.muted) }
                        if publishing {
                            VStack(alignment: .leading, spacing: 10) {
                                ProgressView(value: progress).tint(TakeTheme.white)
                                Text(draft.state == .processing ? "Confirming publication. Your feed unlocks only after the server confirms." : "Uploading privately… \(Int(progress * 100))%").font(.subheadline).foregroundStyle(TakeTheme.muted)
                            }.accessibilityElement(children: .combine)
                        }
                        if let failure = draft.failure { InlineNotice(text: failure, color: TakeTheme.muted) }
                        PrimaryButton(title: publishing ? (draft.state == .processing ? "Processing…" : "Uploading…") : (draft.state == .failed ? "Retry publication" : "Publish \(draft.kind == .reply ? "reply" : "take")"), symbol: publishing ? nil : "arrow.up", color: TakeTheme.white, disabled: publishing) { publish() }
                        Button("Retake") { Task { await retake() } }.frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(TakeTheme.muted).disabled(publishing)
                    } else { captureControls }
                    Label(draft.kind == .reply ? "Replies are visible only to eligible friends of both people in the conversation." : "Only approved friends who posted this round can see your take.", systemImage: "person.2.badge.shield.checkmark").font(.caption).foregroundStyle(TakeTheme.muted)
                    if !hasClip { Text("Camera and microphone are used only to record your take. You can stop early; recording stops automatically at 15 seconds.").font(.caption).foregroundStyle(TakeTheme.muted) }
                }.padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            }
            .takeScreen().tint(TakeTheme.white)
            .toolbar(.hidden, for: .navigationBar)
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
                else { Button { playPreview() } label: { VStack(spacing: 12) { Image(systemName: "play.fill").font(.system(size: 28)).foregroundStyle(TakeTheme.white); Text(clip.source == .camera ? "Your recording is ready." : "Labeled sample is ready.").font(.subheadline).foregroundStyle(TakeTheme.muted) }.padding(24) }.buttonStyle(.plain).accessibilityLabel("Preview your video with sound") }
            } else if capture.state == .ready || capture.state == .recording || capture.state == .exporting {
                CapturePreview(session: capture.session)
                VStack { Spacer(); Text(capture.state == .recording ? "Recording" : "Front camera · Portrait").font(.caption).foregroundStyle(TakeTheme.white).padding(.horizontal, 14).padding(.vertical, 10).background(TakeTheme.background.opacity(0.7), in: Capsule()).padding(16) }
                if capture.state == .exporting { ProgressView("Preparing MP4…").padding(20).background(TakeTheme.background.opacity(0.85), in: RoundedRectangle(cornerRadius: 16)) }
            } else {
                VStack(spacing: 10) {
                    Text("Camera preview").font(.subheadline)
                    Text("Your camera stays off until you enable it.").font(.caption)
                }.foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).padding(24)
            }
        }
        .aspectRatio(9.0 / 14.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .overlay(alignment: .top) {
            let metadataLayout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            metadataLayout {
                if let option = round?.options.first(where: { $0.id == draft.optionId }) {
                    Text(option.label).font(.caption.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(TakeTheme.background.opacity(0.7), in: Capsule())
                        .overlay { Capsule().stroke(TakeTheme.white.opacity(0.7), lineWidth: 1) }
                        .accessibilityLabel("Your position: \(option.label)")
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                Text(String(format: "0:%02d / 0:15", Int((draft.clip?.durationMs ?? capture.elapsed * 1_000) / 1_000)))
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 8)
                    .background(TakeTheme.background.opacity(0.7), in: Capsule())
            }
            .foregroundStyle(TakeTheme.white).padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .allowsHitTesting(false)
        }
    }

    private var captureControls: some View {
        VStack(spacing: 14) {
            Button {
                if capture.state == .recording { capture.stop(); TakeTheme.haptic(.medium) }
                else if capture.state == .ready { playback.clear(); capture.start(); TakeTheme.haptic(.medium) }
                else { Task { await capture.prepare() } }
            } label: {
                VStack(spacing: 8) {
                    ZStack {
                        Circle().stroke(TakeTheme.white, lineWidth: 3)
                        if capture.state == .preparing || capture.state == .exporting { ProgressView().tint(TakeTheme.white) }
                        else if capture.state == .recording { RoundedRectangle(cornerRadius: 6).fill(TakeTheme.white).frame(width: 30, height: 30) }
                        else { Circle().fill(TakeTheme.white).padding(7) }
                    }.frame(width: 80, height: 80)
                    Text(captureButtonTitle).font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain).disabled(capture.state == .preparing || capture.state == .exporting)
            .accessibilityLabel(captureButtonTitle).accessibilityIdentifier(captureButtonTitle)
            Text("Up to 15 seconds. Retake as many times as you like.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            if let failure = capture.errorMessage {
                InlineNotice(text: failure, color: TakeTheme.muted)
                Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }.frame(minHeight: 44)
            }
            #if targetEnvironment(simulator)
            if model.isDemo, capture.state != .recording {
                Button { showFixtureConfirmation = true } label: { Label("Use simulator sample instead", systemImage: "play.rectangle.on.rectangle").font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 48) }.tint(TakeTheme.white).accessibilityIdentifier("Use simulator sample instead")
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
