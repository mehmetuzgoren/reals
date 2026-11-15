import AVKit
import SwiftUI

struct RealsComposerView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @StateObject private var capture = CaptureController()
    @ObservedObject private var playback = PlaybackCoordinator.shared
    let round: DailyRound?
    @State private var draft: PublicationDraft
    @State private var replyOriginal: OriginalSummary?
    @State private var progress = 0.0
    @State private var publishing = false
    @State private var changingTake = false
    @State private var active = true
    @State private var showDiscard = false
    @State private var showSampleConfirmation = false
    @State private var recordingError: String?
    @State private var captureTask: Task<Void, Never>?
    @State private var publicationTask: Task<Void, Never>?

    init(initialDraft: PublicationDraft, round: DailyRound?) {
        self.round = round
        _draft = State(initialValue: initialDraft)
    }

    private var previewID: String { "reals-preview-\(draft.id)" }
    private var currentIdentity: Bool {
        active && draft.ownerId == model.service?.viewerID && draft.isDemo == model.isDemo && draft.roundId == model.today?.round?.id
    }
    private var title: String {
        if draft.kind == .reply { return replyOriginal.map { "Reply to \($0.author.displayName)" } ?? "Reply" }
        return round?.question ?? "Today's prompt"
    }
    private var option: String? {
        guard let id = draft.optionId ?? model.today?.ownOriginal?.optionId else { return nil }
        return round?.options.first { $0.id == id }?.label
    }

    var body: some View {
        GeometryReader { geometry in
            let unit = geometry.size.height / 852
            ScrollView {
                VStack(spacing: 0) {
                    header.padding(.top, 60.2 * unit).padding(.bottom, 19.8 * unit)
                    cameraSurface
                        .frame(height: 565.7 * unit)
                        .padding(.horizontal, 20)
                    if draft.clip != nil {
                        postControls.padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 36)
                    } else {
                        shutter.padding(.top, 20.6 * unit)
                        Text("3 to 15 seconds. Retake as many times as you like.")
                            .font(.system(size: 14)).foregroundStyle(TakeTheme.muted)
                            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                            .frame(minHeight: 17).padding(.horizontal, 20)
                            .padding(.top, 15.1 * unit)
                            .padding(.bottom, 20)
                    }
                }.frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
            }.scrollIndicators(.hidden).scrollBounceBehavior(.basedOnSize)
        }
        .background(TakeTheme.background).foregroundStyle(TakeTheme.white).tint(TakeTheme.white)
        .ignoresSafeArea().preferredColorScheme(.dark)
        .statusBarHidden().persistentSystemOverlays(.hidden)
        .toolbar(.hidden, for: .navigationBar)
        .interactiveDismissDisabled(publishing || changingTake || capture.state == .recording || capture.state == .exporting)
        .onAppear { active = true }
        .task {
            guard currentIdentity else { dismiss(); return }
            if draft.clip != nil { playPreview() } else { prepareCameraPreview() }
            _ = await loadReplyOriginal()
        }
        .onChange(of: capture.clip) { _, clip in
            guard let clip, currentIdentity else { return }
            draft.clip = clip; draft.state = .preview; draft.failure = nil
            draft = model.saveDraft(draft)
            if draft.clip?.url == clip.url { _ = capture.detachClip() }
            playPreview()
        }
        .onChange(of: capture.state) { _, state in
            if state == .recording { draft.state = .recording }
            if state == .failed {
                draft.state = .failed; draft.failure = capture.errorMessage
                recordingError = capture.errorMessage
            }
        }
        .onChange(of: playback.errorMessage) { _, message in
            guard let message, draft.clip != nil, currentIdentity else { return }
            draft.failure = message
            draft = model.saveDraft(draft)
        }
        .onChange(of: model.generation) { _, _ in invalidate() }
        .onChange(of: model.accessRevision) { _, _ in invalidate() }
        .confirmationDialog("Use a demo sample?", isPresented: $showSampleConfirmation, titleVisibility: .visible) {
            Button("Use labeled 4-second sample") { useSample() }.accessibilityIdentifier("Use labeled 4-second sample")
        } message: {
            Text("This is bundled fictional video with synthetic sound, not a camera recording. It stays in Demo Mode and can never be sent to live Reals.")
        }
        .confirmationDialog("Keep this recording?", isPresented: $showDiscard, titleVisibility: .visible) {
            Button("Save draft and close") {
                guard currentIdentity else { dismiss(); return }
                draft = model.saveDraft(draft)
                dismiss()
            }
            Button("Discard recording", role: .destructive) {
                Task { await discard() }
            }
        }
        .alert("Couldn't continue", isPresented: Binding(get: { recordingError != nil }, set: { if !$0 { recordingError = nil } })) {
            Button("OK", role: .cancel) { recordingError = nil }
        } message: { Text(recordingError ?? "") }
        .onDisappear {
            active = false
            captureTask?.cancel(); publicationTask?.cancel()
            capture.shutdown()
            if playback.activeID == previewID { playback.clear() }
        }
    }

    private var header: some View {
        Text(title).font(.system(size: 17, weight: .bold)).multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 58).frame(maxWidth: .infinity, minHeight: 44)
            .overlay(alignment: .leading) {
                Button { close() } label: {
                    Image(systemName: "chevron.left").font(.system(size: 19, weight: .regular)).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).padding(.leading, 8)
                .accessibilityLabel("Close").accessibilityIdentifier("Close")
                .disabled(publishing || changingTake || capture.state == .exporting)
            }
    }

    private var cameraSurface: some View {
        ZStack {
            TakeTheme.surface
            if draft.clip != nil {
                if playback.activeID == previewID, let player = playback.player {
                    VideoPlayer(player: player)
                } else {
                    Button { playPreview() } label: {
                        Image(systemName: "play.fill").font(.system(size: 24)).foregroundStyle(TakeTheme.muted).frame(minWidth: 44, minHeight: 44)
                    }.buttonStyle(.plain).accessibilityLabel("Preview with sound")
                }
            } else if capture.state == .ready || capture.state == .recording || capture.state == .exporting {
                CapturePreview(session: capture.session)
            } else {
                Text("Camera preview").font(.system(size: 14)).foregroundStyle(TakeTheme.muted)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(alignment: .top) {
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
            layout {
                if let option {
                    Text(option).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(TakeTheme.surface.opacity(0.8), in: Capsule())
                        .overlay { Capsule().stroke(TakeTheme.white, lineWidth: 1) }
                        .accessibilityLabel("Your position: \(option)")
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                Text(String(format: "0:%02d / 0:15", Int((draft.clip?.durationMs ?? capture.elapsed * 1_000) / 1_000)))
                    .font(.system(size: 16, weight: .semibold).monospacedDigit())
                    .padding(.vertical, 7)
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading).allowsHitTesting(false)
        }
    }

    @ViewBuilder private var shutter: some View {
        if model.isDemo {
            shutterButton
                .highPriorityGesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in requestSample() })
                .accessibilityAction(named: Text("Demo recording sample")) { requestSample() }
        } else { shutterButton }
    }

    private var shutterButton: some View {
        Button { pressShutter() } label: {
            ZStack {
                Circle().strokeBorder(TakeTheme.white, lineWidth: 4)
                if capture.state == .preparing || capture.state == .exporting {
                    ProgressView().tint(TakeTheme.white)
                } else if capture.state == .recording {
                    RoundedRectangle(cornerRadius: 5).fill(TakeTheme.white).frame(width: 27, height: 27)
                } else { Circle().fill(TakeTheme.white).padding(8) }
            }.frame(width: 76, height: 76).contentShape(Circle())
        }
        .buttonStyle(.plain).disabled(publishing || changingTake || capture.state == .preparing || capture.state == .exporting)
        .accessibilityLabel(capture.state == .recording ? "Stop recording" : "Start recording")
        .accessibilityIdentifier(capture.state == .recording ? "Stop recording" : "Start recording")
    }

    private var postControls: some View {
        VStack(alignment: .leading, spacing: 16) {
            if draft.kind == .original {
                Toggle("Share to For You", isOn: Binding(get: { draft.audience == .public }, set: { share in
                    guard currentIdentity, !publishing, draft.uploadId == nil else { return }
                    draft.audience = share ? .public : .friends
                    draft = model.saveDraft(draft)
                }))
                .font(.headline).tint(TakeTheme.muted).disabled(publishing || draft.uploadId != nil)
                Text("Anyone who has posted today can see public takes.").font(.footnote).foregroundStyle(TakeTheme.muted)
            } else if draft.audience == .public {
                Text("Replies to public takes are public.").font(.footnote).foregroundStyle(TakeTheme.muted)
            }
            if draft.clip?.source == .simulatorFixture {
                Text("Demo sample · Not recorded live.").font(.footnote).foregroundStyle(TakeTheme.muted)
            }
            if publishing {
                ProgressView(value: progress).tint(TakeTheme.white)
                Text(draft.state == .processing ? "Confirming publication…" : "Uploading… \(Int(progress * 100))%")
                    .font(.footnote).foregroundStyle(TakeTheme.muted)
            }
            if let failure = draft.failure { Text(failure).font(.footnote).foregroundStyle(TakeTheme.muted).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: 12) {
                Button { Task { await retake() } } label: {
                    Text("Retake").font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                        .contentShape(Capsule()).overlay { Capsule().stroke(TakeTheme.white, lineWidth: 1) }
                }.accessibilityIdentifier("Retake")
                Button { publish() } label: {
                    Text("Post").font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(TakeTheme.background).background(TakeTheme.white, in: Capsule())
                }.accessibilityIdentifier("Post")
            }.buttonStyle(.plain).disabled(publishing || changingTake)
        }
    }

    private func pressShutter() {
        guard currentIdentity, !publishing, !changingTake, draft.clip == nil else { return }
        if capture.state == .recording {
            if capture.elapsed >= 3 { capture.stop(); TakeTheme.haptic(.medium) }
            return
        }
        guard capture.state == .idle || capture.state == .failed || capture.state == .ready else { return }
        captureTask = Task {
            if capture.state != .ready { await capture.prepare() }
            guard !Task.isCancelled, currentIdentity, capture.state == .ready else { return }
            playback.clear(); capture.start(); TakeTheme.haptic(.medium)
        }
    }

    private func prepareCameraPreview() {
        guard currentIdentity, draft.clip == nil, capture.cameraAvailable, capture.state == .idle else { return }
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        guard status != .denied, status != .restricted else { return }
        captureTask?.cancel()
        captureTask = Task { await capture.prepare() }
    }

    private func requestSample() {
        guard currentIdentity, model.isDemo, draft.isDemo, draft.clip == nil,
              capture.state != .recording, capture.state != .preparing, capture.state != .exporting else { return }
        showSampleConfirmation = true
    }

    private func useSample() {
        guard currentIdentity, model.isDemo, draft.isDemo else { return }
        guard let url = DemoService.fixtureURL("sample-mock"), FileManager.default.fileExists(atPath: url.path) else {
            recordingError = "The labeled demo sample is unavailable. No camera recording was simulated."
            return
        }
        captureTask?.cancel(); capture.shutdown()
        draft.clip = RecordedClip(url: url, durationMs: 4_000, source: .simulatorFixture, createdAt: Date())
        draft.state = .preview; draft.failure = nil
        draft = model.saveDraft(draft)
        playPreview()
    }

    private func playPreview() {
        guard currentIdentity, let clip = draft.clip else { return }
        playback.play(id: previewID, url: clip.url)
    }

    private func loadReplyOriginal() async -> Bool {
        guard draft.kind == .reply else { return true }
        guard let originalID = draft.originalId, let service = model.service, currentIdentity else { return false }
        let epoch = model.generation, revision = model.accessRevision
        do {
            let original = try await service.detail(originalId: originalID)
            guard !Task.isCancelled, currentIdentity, model.isCurrentAccess(generation: epoch, revision: revision) else { return false }
            replyOriginal = original
            draft.audience = original.audience
            if draft.clip != nil { draft = model.saveDraft(draft) }
            return true
        } catch {
            guard !Task.isCancelled, currentIdentity, model.isCurrentAccess(generation: epoch, revision: revision) else { return false }
            replyOriginal = nil
            draft.failure = error.localizedDescription
            return false
        }
    }

    private func retake() async {
        guard currentIdentity, !publishing, !changingTake else { return }
        changingTake = true
        defer { changingTake = false }
        if let id = draft.uploadId {
            do { try await model.service?.cancelUpload(uploadId: id) }
            catch { if currentIdentity { draft.failure = error.localizedDescription }; return }
        }
        guard currentIdentity, !Task.isCancelled else { return }
        captureTask?.cancel(); playback.clear(); capture.shutdown(); model.clearDraft()
        draft = PublicationDraft(id: UUID().uuidString, ownerId: draft.ownerId, isDemo: draft.isDemo, roundId: draft.roundId, optionId: draft.optionId, originalId: draft.originalId, clip: nil, uploadId: nil, state: .draft, failure: nil, audience: draft.audience)
        prepareCameraPreview()
    }

    private func close() {
        guard !publishing, !changingTake else { return }
        if capture.state == .recording { capture.stop(); return }
        if draft.clip != nil, draft.state != .published { showDiscard = true }
        else { captureTask?.cancel(); capture.shutdown(); dismiss() }
    }

    private func discard() async {
        guard currentIdentity, !publishing, !changingTake else { return }
        changingTake = true
        defer { changingTake = false }
        if let id = draft.uploadId {
            do { try await model.service?.cancelUpload(uploadId: id) }
            catch { if currentIdentity { draft.failure = error.localizedDescription }; return }
        }
        guard currentIdentity, !Task.isCancelled else { return }
        model.clearDraft(); dismiss()
    }

    private func publish() {
        guard currentIdentity, draft.clip != nil, !publishing, !changingTake else { return }
        publishing = true
        let epoch = model.generation, revision = model.accessRevision
        playback.clear(); capture.shutdown()
        publicationTask = Task {
            defer { publishing = false }
            if draft.kind == .reply {
                guard await loadReplyOriginal() else { return }
            }
            guard !Task.isCancelled, currentIdentity, model.isCurrentAccess(generation: epoch, revision: revision) else { return }
            do {
                draft = try await model.publish(draft) { value, fraction in
                    guard currentIdentity, model.isCurrentAccess(generation: epoch, revision: revision) else { return }
                    draft = value; progress = fraction
                }
                guard !Task.isCancelled, currentIdentity, draft.state == .published else { return }
                dismiss()
            } catch {
                guard !Task.isCancelled, currentIdentity, model.isCurrentAccess(generation: epoch, revision: revision) else { return }
                draft.state = .failed; draft.failure = error.localizedDescription
                draft = model.saveDraft(draft)
            }
        }
    }

    private func invalidate() {
        captureTask?.cancel(); publicationTask?.cancel()
        capture.shutdown()
        if playback.activeID == previewID { playback.clear() }
        dismiss()
    }
}
