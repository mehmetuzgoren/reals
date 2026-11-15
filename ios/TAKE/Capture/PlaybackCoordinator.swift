import AVFoundation
import Combine
import UIKit

@MainActor
final class PlaybackCoordinator: ObservableObject {
    static let shared = PlaybackCoordinator()

    @Published private(set) var activeID: String?
    @Published private(set) var player: AVPlayer?
    @Published private(set) var errorMessage: String?

    private var requestID = UUID()
    private var download: PrivatePlaybackDownload?
    private var privateFile: URL?
    private var expiryTask: Task<Void, Never>?
    private var itemObservation: NSKeyValueObservation?
    private var itemObservers: [NSObjectProtocol] = []
    private var lifecycleObservers: [NSObjectProtocol] = []
    private let cleanupQueue = DispatchQueue(label: "take.playback.cleanup", qos: .utility)

    private init() {
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  value == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor [weak self] in self?.pause() }
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  value == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            Task { @MainActor [weak self] in self?.pause() }
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.clear() }
        })
    }

    deinit {
        download?.cancel()
        expiryTask?.cancel()
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        itemObservers.forEach(NotificationCenter.default.removeObserver)
        let file = privateFile
        let owner = requestID
        cleanupQueue.async {
            if let file { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
            MediaAudioSession.shared.deactivate(owner: owner)
        }
    }

    func play(id: String, url: URL, expiresAt: Date? = nil) {
        clear()
        guard UIApplication.shared.applicationState == .active else { return }
        guard expiresAt.map({ $0 > Date() }) ?? url.isFileURL else {
            fail("Secure playback expired. Tap play to request fresh access.")
            return
        }
        let token = requestID
        activeID = id
        if let expiresAt {
            expiryTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(max(0, expiresAt.timeIntervalSinceNow))) }
                catch { return }
                guard let self, self.requestID == token else { return }
                let wasActive = self.activeID == id
                self.clear()
                if wasActive { self.errorMessage = "Secure playback expired. Tap play to request fresh access." }
            }
        }
        if url.isFileURL {
            installPlayer(url: url, id: id, token: token)
            return
        }
        guard url.scheme?.lowercased() == "https" else {
            fail("This take doesn't have a secure playback URL.")
            return
        }
        let loader = PrivatePlaybackDownload(url: url) { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, self.requestID == token, self.activeID == id else {
                    if case .success(let file) = result {
                        DispatchQueue.global(qos: .utility).async {
                            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
                        }
                    }
                    return
                }
                self.download = nil
                switch result {
                case .success(let file):
                    self.privateFile = file
                    self.installPlayer(url: file, id: id, token: token)
                case .failure:
                    self.fail("This take couldn't be loaded. Try again to request fresh access.")
                }
            }
        }
        download = loader
        loader.start()
    }

    func pause() {
        player?.pause()
        activeID = nil
        if let download {
            download.cancel()
            self.download = nil
            let owner = requestID
            requestID = UUID()
            MediaAudioSession.shared.deactivate(owner: owner)
        } else {
            MediaAudioSession.shared.deactivate(owner: requestID)
        }
    }

    func clear() {
        pause()
        expiryTask?.cancel(); expiryTask = nil
        requestID = UUID()
        itemObservation?.invalidate()
        itemObservation = nil
        itemObservers.forEach(NotificationCenter.default.removeObserver)
        itemObservers.removeAll()
        player?.currentItem?.asset.cancelLoading()
        player?.replaceCurrentItem(with: nil)
        player = nil
        errorMessage = nil
        if let privateFile {
            cleanupQueue.async { try? FileManager.default.removeItem(at: privateFile.deletingLastPathComponent()) }
            self.privateFile = nil
        }
    }

    private func installPlayer(url: URL, id: String, token: UUID) {
        guard requestID == token, activeID == id else { return }
        let item = AVPlayerItem(asset: AVURLAsset(url: url))
        item.preferredForwardBufferDuration = 1
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = false
        let player = AVPlayer(playerItem: item)
        player.allowsExternalPlayback = false
        player.isMuted = false
        player.volume = 1
        player.actionAtItemEnd = .pause
        self.player = player

        itemObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            Task { @MainActor [weak self] in
                guard let self, self.requestID == token else { return }
                self.fail("This take couldn't be played. Please try again.")
            }
        }
        itemObservers.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.requestID == token else { return }
                self.pause()
                self.player?.seek(to: .zero)
            }
        })
        itemObservers.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.requestID == token else { return }
                self.fail("Playback was interrupted. Please try again.")
            }
        })
        MediaAudioSession.shared.activatePlayback(owner: token) { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, self.requestID == token, self.activeID == id,
                      UIApplication.shared.applicationState == .active else {
                    MediaAudioSession.shared.deactivate(owner: token)
                    return
                }
                switch result {
                case .success:
                    self.player?.play()
                case .failure:
                    self.fail("Sound couldn't start. Please try playing this take again.")
                }
            }
        }
    }

    private func fail(_ message: String) {
        clear()
        errorMessage = message
    }
}

private final class PrivatePlaybackDownload: NSObject, URLSessionDataDelegate {
    private let url: URL
    private let completion: (Result<URL, Error>) -> Void
    private var session: URLSession!
    private var data = Data()
    private var failure: Error?
    private let maximumBytes = 20 * 1_024 * 1_024

    init(url: URL, completion: @escaping (Result<URL, Error>) -> Void) {
        self.url = url
        self.completion = completion
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = false
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.qualityOfService = .userInitiated
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
    }

    func start() {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("video/mp4", forHTTPHeaderField: "Accept")
        session.dataTask(with: request).resume()
    }

    func cancel() {
        session.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.expectedContentLength <= Int64(maximumBytes),
              response.mimeType?.lowercased() == "video/mp4" else {
            failure = URLError(.badServerResponse)
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard failure == nil else { return }
        guard data.count <= maximumBytes - self.data.count else {
            failure = URLError(.dataLengthExceedsMaximum)
            dataTask.cancel()
            return
        }
        self.data.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer {
            data.removeAll()
            session.finishTasksAndInvalidate()
        }
        if let error = failure ?? error {
            completion(.failure(error))
            return
        }
        guard !data.isEmpty else {
            completion(.failure(URLError(.zeroByteResource)))
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("TAKEPlayback-\(UUID().uuidString)", isDirectory: true)
        let file = directory.appendingPathComponent("active.mp4")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            completion(.success(file))
        } catch {
            try? FileManager.default.removeItem(at: directory)
            completion(.failure(error))
        }
    }
}
