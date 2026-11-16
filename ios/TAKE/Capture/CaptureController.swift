import AudioToolbox
import AVFoundation
import Combine
import UIKit

enum CaptureState: Equatable {
    case idle, preparing, ready, recording, exporting, preview, failed
}

@MainActor
final class CaptureController: NSObject, ObservableObject {
    @Published private(set) var state: CaptureState = .idle
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var errorMessage: String?
    @Published private(set) var clip: RecordedClip?

    let session: AVCaptureSession

    var cameraAvailable: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
        #endif
    }

    private let engine: CaptureEngine
    private var generation = UUID()
    private var clockTask: Task<Void, Never>?
    private var backgroundObserver: NSObjectProtocol?

    override init() {
        let session = AVCaptureSession()
        self.session = session
        engine = CaptureEngine(session: session)
        super.init()
        engine.onEvent = { [weak self] id, event in
            Task { @MainActor [weak self] in
                self?.receive(event, id: id)
            }
        }
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch self.state {
                case .preparing, .ready, .recording, .exporting:
                    self.fail("Recording stopped when Takes went into the background. Please try again.")
                    self.engine.reset()
                case .idle, .preview, .failed:
                    break
                }
            }
        }
    }

    deinit {
        clockTask?.cancel()
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
        engine.reset()
    }

    func prepare() async {
        guard state == .idle || state == .failed else { return }
        let id = UUID()
        generation = id
        state = .preparing
        errorMessage = nil
        elapsed = 0
        PlaybackCoordinator.shared.clear()

        #if DEBUG
        if !cameraAvailable {
            do {
                try await engine.prepareSample(id: id)
                guard generation == id else { return }
                state = .ready
            } catch {
                guard generation == id else { return }
                fail((error as? LocalizedError)?.errorDescription ?? "The debug sample couldn't start.")
            }
            return
        }
        #endif

        guard cameraAvailable else {
            fail("A front camera isn't available on this device.")
            return
        }
        guard await requestAccess(for: .video), generation == id else {
            if generation == id { fail("Allow camera access in Settings to record your take.") }
            return
        }
        guard await requestAccess(for: .audio), generation == id else {
            if generation == id { fail("Allow microphone access in Settings to record with sound.") }
            return
        }
        guard !Task.isCancelled, UIApplication.shared.applicationState == .active else {
            fail("Return to Takes and try recording again.")
            return
        }

        do {
            try await engine.prepare(id: id)
            guard generation == id else { return }
            if Task.isCancelled || UIApplication.shared.applicationState != .active {
                engine.reset()
                fail("Return to Takes and try recording again.")
                return
            }
            state = .ready
        } catch {
            guard generation == id else { return }
            fail((error as? LocalizedError)?.errorDescription ?? "The camera couldn't start. Please try again.")
        }
    }

    func start() {
        guard state == .ready, UIApplication.shared.applicationState == .active else { return }
        elapsed = 0
        errorMessage = nil
        state = .recording
        engine.start(id: generation)
    }

    func stop() {
        guard state == .recording, elapsed >= 3 else { return }
        state = .exporting
        clockTask?.cancel()
        clockTask = nil
        engine.stop(id: generation)
    }

    func retake() async {
        shutdown()
        await prepare()
    }

    func shutdown() {
        generation = UUID()
        clockTask?.cancel()
        clockTask = nil
        clip = nil
        elapsed = 0
        errorMessage = nil
        state = .idle
        engine.reset()
    }

    func detachClip() -> RecordedClip? {
        guard let clip else { return nil }
        engine.relinquish(clip.url)
        self.clip = nil
        return clip
    }

    private func requestAccess(for mediaType: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: mediaType)
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    private func receive(_ event: CaptureEvent, id: UUID) {
        guard generation == id else { return }
        switch event {
        case .started:
            guard state == .recording else { return }
            let startedAt = ProcessInfo.processInfo.systemUptime
            clockTask?.cancel()
            clockTask = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 50_000_000) }
                    catch { return }
                    guard let self, self.generation == id, self.state == .recording else { return }
                    self.elapsed = min(15, ProcessInfo.processInfo.systemUptime - startedAt)
                    if self.elapsed >= 15 { self.stop() }
                }
            }
        case .exporting:
            clockTask?.cancel()
            clockTask = nil
            state = .exporting
        case .finished(let clip):
            clockTask?.cancel()
            clockTask = nil
            self.clip = clip
            elapsed = clip.durationMs / 1_000
            state = .preview
        case .failed(let message):
            fail(message)
        }
    }

    private func fail(_ message: String) {
        generation = UUID()
        clockTask?.cancel()
        clockTask = nil
        clip = nil
        elapsed = 0
        errorMessage = message
        state = .failed
    }
}

private enum CaptureEvent {
    case started, exporting
    case finished(RecordedClip)
    case failed(String)
}

private struct CaptureFailure: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

private final class CaptureEngine: NSObject, AVCaptureFileOutputRecordingDelegate {
    var onEvent: ((UUID, CaptureEvent) -> Void)?

    private struct Recording {
        let id: UUID
        let url: URL
        let createdAt: Date
        var stopRequested = false
    }

    private let session: AVCaptureSession
    private let output = AVCaptureMovieFileOutput()
    private let queue = DispatchQueue(label: "take.capture.session", qos: .userInitiated)
    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("TAKECapture-\(UUID().uuidString)", isDirectory: true)
    private var observers: [NSObjectProtocol] = []
    private var operationID: UUID?
    private var isPrepared = false
    private var recording: Recording?
    private var ownedFiles: Set<URL> = []
    private var exportTask: Task<Void, Never>?
    private var usesSample = false

    init(session: AVCaptureSession) {
        self.session = session
        super.init()
        observe(AVCaptureSession.wasInterruptedNotification, object: session) { engine, _ in
            guard engine.isPrepared || engine.recording != nil else { return }
            engine.invalidate("The camera was interrupted. Your take wasn't saved. Please try again.")
        }
        observe(AVCaptureSession.runtimeErrorNotification, object: session) { engine, _ in
            guard engine.isPrepared || engine.recording != nil else { return }
            engine.invalidate("The camera stopped unexpectedly. Please try recording again.")
        }
        observe(AVAudioSession.interruptionNotification, object: nil) { engine, notification in
            guard engine.isPrepared || engine.recording != nil,
                  let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  value == AVAudioSession.InterruptionType.began.rawValue else { return }
            engine.invalidate("Recording was interrupted by another audio session. Please try again.")
        }
        observe(AVAudioSession.routeChangeNotification, object: nil) { engine, notification in
            guard engine.isPrepared || engine.recording != nil,
                  let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: value) else { return }
            switch reason {
            case .newDeviceAvailable, .oldDeviceUnavailable, .noSuitableRouteForCategory:
                engine.invalidate("The microphone or audio route changed. Please record your take again.")
            default:
                break
            }
        }
        observe(AVAudioSession.mediaServicesWereResetNotification, object: nil) { engine, _ in
            guard engine.isPrepared || engine.recording != nil else { return }
            engine.invalidate("Audio services restarted. Please try recording again.")
        }
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        let session = session
        let output = output
        let task = exportTask
        let files = ownedFiles
        let directory = directory
        let owner = operationID
        queue.async {
            task?.cancel()
            if output.isRecording { output.stopRecording() }
            if session.isRunning { session.stopRunning() }
            if let owner { MediaAudioSession.shared.deactivate(owner: owner) }
            for url in files { try? FileManager.default.removeItem(at: url) }
            if (try? FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty) == true {
                try? FileManager.default.removeItem(at: directory)
            }
        }
    }

    func prepare(id: UUID) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                guard self.recording == nil else {
                    continuation.resume(throwing: CaptureFailure("The camera is finishing the previous take. Please try again."))
                    return
                }
                self.invalidate(nil)
                self.operationID = id
                do {
                    try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
                    try self.configure()
                    try MediaAudioSession.shared.activateCapture(owner: id)
                    self.session.startRunning()
                    guard self.session.isRunning else { throw CaptureFailure("The camera couldn't start. Please try again.") }
                    self.isPrepared = true
                    continuation.resume()
                } catch {
                    self.invalidate(nil)
                    continuation.resume(throwing: CaptureFailure("The camera or microphone couldn't start. Check access in Settings and try again."))
                }
            }
        }
    }

    #if DEBUG
    func prepareSample(id: UUID) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                guard self.recording == nil else {
                    continuation.resume(throwing: CaptureFailure("The previous take is still finishing. Please try again."))
                    return
                }
                self.invalidate(nil)
                guard Bundle.main.url(forResource: "sample-mock", withExtension: "mp4") != nil else {
                    continuation.resume(throwing: CaptureFailure("The debug sample clip is missing from this build."))
                    return
                }
                do {
                    try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
                } catch {
                    continuation.resume(throwing: CaptureFailure("The debug sample couldn't start. Please try again."))
                    return
                }
                self.operationID = id
                self.usesSample = true
                self.isPrepared = true
                continuation.resume()
            }
        }
    }

    private static func sampleRecording(seconds: Double) async throws -> AVAsset {
        guard let url = Bundle.main.url(forResource: "sample-mock", withExtension: "mp4") else {
            throw CaptureFailure("The debug sample clip is missing from this build.")
        }
        let source = AVURLAsset(url: url)
        guard let video = try await source.loadTracks(withMediaType: .video).first,
              let audio = try await source.loadTracks(withMediaType: .audio).first else {
            throw CaptureFailure("The debug sample clip needs video and sound.")
        }
        let videoRange = try await video.load(.timeRange)
        let audioRange = try await audio.load(.timeRange)
        let unit = CMTimeMinimum(videoRange.duration, audioRange.duration)
        let composition = AVMutableComposition()
        guard unit.seconds > 0,
              let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw CaptureFailure("The debug sample clip is unreadable.")
        }
        videoTrack.preferredTransform = try await video.load(.preferredTransform)
        let target = CMTime(seconds: min(15, max(3, seconds)), preferredTimescale: 600)
        var cursor = CMTime.zero
        while cursor < target {
            let length = CMTimeMinimum(unit, target - cursor)
            try videoTrack.insertTimeRange(CMTimeRange(start: videoRange.start, duration: length), of: video, at: cursor)
            try audioTrack.insertTimeRange(CMTimeRange(start: audioRange.start, duration: length), of: audio, at: cursor)
            cursor = cursor + length
        }
        return composition
    }
    #endif

    func start(id: UUID) {
        queue.async {
            #if DEBUG
            if self.usesSample {
                guard self.operationID == id, self.isPrepared, self.recording == nil else {
                    if self.operationID == id { self.invalidate("The debug sample isn't ready. Please try again.") }
                    return
                }
                self.recording = Recording(id: id, url: self.directory.appendingPathComponent("\(UUID().uuidString).mov"), createdAt: Date())
                self.onEvent?(id, .started)
                return
            }
            #endif
            guard self.operationID == id, self.isPrepared, self.session.isRunning,
                  !self.session.isInterrupted, self.recording == nil else {
                if self.operationID == id { self.invalidate("The camera isn't ready. Please try recording again.") }
                return
            }
            let url = self.directory.appendingPathComponent("\(UUID().uuidString).mov")
            self.ownedFiles.insert(url)
            self.recording = Recording(id: id, url: url, createdAt: Date())
            if let connection = self.output.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
            self.output.startRecording(to: url, recordingDelegate: self)
        }
    }

    func stop(id: UUID) {
        queue.async {
            guard self.operationID == id, self.recording?.id == id else { return }
            #if DEBUG
            if self.usesSample, let recording = self.recording {
                self.recording = nil
                self.isPrepared = false
                let seconds = Date().timeIntervalSince(recording.createdAt)
                self.onEvent?(id, .exporting)
                self.export(recording) { try await CaptureEngine.sampleRecording(seconds: seconds) }
                return
            }
            #endif
            self.recording?.stopRequested = true
            if self.output.isRecording { self.output.stopRecording() }
        }
    }

    func reset() {
        queue.async { self.invalidate(nil) }
    }

    func relinquish(_ url: URL) {
        queue.async { self.ownedFiles.remove(url) }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL, from connections: [AVCaptureConnection]) {
        queue.async {
            guard let recording = self.recording, recording.url == fileURL else { return }
            guard self.operationID == recording.id, !recording.stopRequested else {
                if self.output.isRecording { self.output.stopRecording() }
                return
            }
            self.onEvent?(recording.id, .started)
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        queue.async {
            guard let recording = self.recording, recording.url == outputFileURL else {
                try? FileManager.default.removeItem(at: outputFileURL)
                return
            }
            self.recording = nil
            guard self.operationID == recording.id else {
                self.remove(outputFileURL)
                return
            }
            self.stopSession(owner: recording.id)
            let failure = error as NSError?
            let finishedSuccessfully = failure?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool == true
            if failure != nil && !finishedSuccessfully {
                self.invalidate("Your take couldn't be saved. Please record it again.")
                return
            }
            self.onEvent?(recording.id, .exporting)
            self.export(recording) { AVURLAsset(url: recording.url) }
        }
    }

    private func configure() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)
        session.automaticallyConfiguresApplicationAudioSession = false
        session.usesApplicationAudioSession = true
        if session.canSetSessionPreset(.hd1280x720) {
            session.sessionPreset = .hd1280x720
        } else if session.canSetSessionPreset(.vga640x480) {
            session.sessionPreset = .vga640x480
        } else {
            throw CaptureFailure("This camera doesn't support recording a take.")
        }
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
              let microphone = AVCaptureDevice.default(for: .audio) else {
            throw CaptureFailure("A front camera and microphone are required.")
        }
        let videoInput = try AVCaptureDeviceInput(device: camera)
        let audioInput = try AVCaptureDeviceInput(device: microphone)
        guard session.canAddInput(videoInput) else { throw CaptureFailure("The camera isn't available.") }
        session.addInput(videoInput)
        guard session.canAddInput(audioInput) else { throw CaptureFailure("The microphone isn't available.") }
        session.addInput(audioInput)
        guard session.canAddOutput(output) else { throw CaptureFailure("Recording isn't available.") }
        session.addOutput(output)
        output.maxRecordedDuration = CMTime(seconds: 15, preferredTimescale: 600)
        output.maxRecordedFileSize = 24 * 1_024 * 1_024
        output.minFreeDiskSpaceLimit = 50 * 1_024 * 1_024
        guard let connection = output.connection(with: .video),
              connection.isVideoRotationAngleSupported(90), output.availableVideoCodecTypes.contains(.h264) else {
            throw CaptureFailure("This camera doesn't support the required video format.")
        }
        connection.videoRotationAngle = 90
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = false
        }
        output.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.h264], for: connection)
        guard output.connection(with: .audio) != nil else { throw CaptureFailure("Recording with sound isn't available.") }
    }

    private func export(_ recording: Recording, source: @escaping () async throws -> AVAsset) {
        let url = directory.appendingPathComponent("\(UUID().uuidString).mp4")
        ownedFiles.insert(url)
        exportTask = Task.detached(priority: .userInitiated) { [weak self] in
            do {
                let asset = try await source()
                let duration = try await asset.load(.duration)
                let video = try await asset.loadTracks(withMediaType: .video)
                let audio = try await asset.loadTracks(withMediaType: .audio)
                guard duration.seconds.isFinite, duration.seconds >= 3, !video.isEmpty, !audio.isEmpty,
                      let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720),
                      exporter.supportedFileTypes.contains(.mp4) else {
                    throw CaptureFailure("Your take needs playable video and sound. Please record it again.")
                }
                let sourceVideo = video[0]
                var transform = try await sourceVideo.load(.preferredTransform)
                let naturalSize = try await sourceVideo.load(.naturalSize)
                var frame = CGRect(origin: .zero, size: naturalSize).applying(transform)
                if abs(frame.width) > abs(frame.height) {
                    transform = transform.concatenating(CGAffineTransform(rotationAngle: -.pi / 2))
                    frame = CGRect(origin: .zero, size: naturalSize).applying(transform)
                }
                let upright = CGSize(width: abs(frame.width).rounded(), height: abs(frame.height).rounded())
                let instruction = AVMutableVideoCompositionInstruction()
                instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
                let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: sourceVideo)
                layer.setTransform(transform.concatenating(CGAffineTransform(translationX: -frame.minX, y: -frame.minY)), at: .zero)
                instruction.layerInstructions = [layer]
                let orientation = AVMutableVideoComposition()
                orientation.renderSize = upright
                orientation.frameDuration = CMTime(value: 1, timescale: 30)
                orientation.instructions = [instruction]
                exporter.videoComposition = orientation
                exporter.outputURL = url
                exporter.outputFileType = .mp4
                exporter.shouldOptimizeForNetworkUse = true
                exporter.fileLengthLimit = 32 * 1_024 * 1_024
                exporter.timeRange = CMTimeRange(start: .zero, duration: CMTimeMinimum(duration, CMTime(seconds: 14.9, preferredTimescale: 600)))
                try await withTaskCancellationHandler {
                    try Task.checkCancellation()
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        exporter.exportAsynchronously {
                            if exporter.status == .completed {
                                continuation.resume()
                            } else {
                                continuation.resume(throwing: CaptureFailure("Your take couldn't be prepared for upload. Please try recording again."))
                            }
                        }
                    }
                } onCancel: {
                    exporter.cancelExport()
                }
                try Task.checkCancellation()
                let result = AVURLAsset(url: url)
                let finalDuration = try await result.load(.duration).seconds
                let finalVideo = try await result.loadTracks(withMediaType: .video)
                let finalAudio = try await result.loadTracks(withMediaType: .audio)
                guard !finalVideo.isEmpty, !finalAudio.isEmpty else {
                    throw CaptureFailure("Your take is missing video or sound. Please record it again.")
                }
                let bytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard bytes > 0 else {
                    throw CaptureFailure("Your take couldn't be saved. Please try again.")
                }
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
                try Task.checkCancellation()
                let clip = RecordedClip(url: url, durationMs: finalDuration * 1_000, source: .camera, createdAt: recording.createdAt)
                if let self {
                    self.queue.async {
                        self.remove(recording.url)
                        guard self.operationID == recording.id else { self.remove(url); return }
                        self.exportTask = nil
                        self.operationID = nil
                        self.onEvent?(recording.id, .finished(clip))
                    }
                } else {
                    try? FileManager.default.removeItem(at: recording.url)
                    try? FileManager.default.removeItem(at: url)
                }
            } catch {
                if let self {
                    self.queue.async {
                        self.remove(recording.url)
                        self.remove(url)
                        guard self.operationID == recording.id else { return }
                        self.exportTask = nil
                        self.invalidate((error as? LocalizedError)?.errorDescription ?? "Your take couldn't be saved. Please try again.")
                    }
                } else {
                    try? FileManager.default.removeItem(at: recording.url)
                    try? FileManager.default.removeItem(at: url)
                }
            }
        }
    }

    private func observe(_ name: Notification.Name, object: Any?, receive: @escaping (CaptureEngine, Notification) -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: nil) { [weak self] notification in
            guard let self else { return }
            self.queue.async { receive(self, notification) }
        })
    }

    private func invalidate(_ message: String?) {
        let id = operationID
        operationID = nil
        isPrepared = false
        usesSample = false
        exportTask?.cancel()
        exportTask = nil
        if output.isRecording { output.stopRecording() }
        stopSession(owner: id)
        let activeURL = recording?.url
        for url in ownedFiles where url != activeURL { remove(url) }
        if let id, let message { onEvent?(id, .failed(message)) }
    }

    private func stopSession(owner: UUID?) {
        isPrepared = false
        if session.isRunning { session.stopRunning() }
        if let owner { MediaAudioSession.shared.deactivate(owner: owner) }
    }

    private func remove(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
        ownedFiles.remove(url)
    }
}
