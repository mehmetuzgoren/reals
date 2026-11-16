import AVFoundation

final class MediaAudioSession {
    static let shared = MediaAudioSession()

    private let queue = DispatchQueue(label: "take.media.audio", qos: .userInitiated)
    private var owner: UUID?

    private init() {}

    func activateCapture(owner: UUID) throws {
        try queue.sync {
            self.owner = owner
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetooth])
            try audio.setActive(true)
        }
    }

    func activatePlayback(owner: UUID, completion: @escaping (Result<Void, Error>) -> Void) {
        queue.async {
            let result = Result<Void, Error> {
                self.owner = owner
                let audio = AVAudioSession.sharedInstance()
                try audio.setCategory(.playback, mode: .moviePlayback)
                try audio.setActive(true)
            }
            completion(result)
        }
    }

    func deactivate(owner: UUID) {
        queue.async {
            guard self.owner == owner else { return }
            self.owner = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}
