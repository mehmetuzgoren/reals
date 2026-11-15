import FirebaseCore
import Foundation

struct LiveConfiguration {
    let convexURL: URL
    let convexSiteURL: URL
    let firebaseOptions: FirebaseOptions

    private init(convexURL: URL, convexSiteURL: URL, firebaseOptions: FirebaseOptions) {
        self.convexURL = convexURL
        self.convexSiteURL = convexSiteURL
        self.firebaseOptions = firebaseOptions
    }

    static func load(bundle: Bundle = .main) throws -> LiveConfiguration {
        guard let deployment = bundle.object(forInfoDictionaryKey: "CONVEX_URL") as? String,
              let site = bundle.object(forInfoDictionaryKey: "CONVEX_SITE_URL") as? String,
              bundle.object(forInfoDictionaryKey: "FirebaseAppDelegateProxyEnabled") as? Bool == false,
              bundle.object(forInfoDictionaryKey: "FirebaseMessagingAutoInitEnabled") as? Bool == false,
              let plist = bundle.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: plist),
              let projectID = options.projectID, validSetting(projectID),
              let apiKey = options.apiKey, validSetting(apiKey),
              validSetting(options.googleAppID),
              validSetting(options.gcmSenderID),
              options.bundleID == bundle.bundleIdentifier else {
            throw ServiceFailure.notConfigured
        }
        let convexURL = try origin(deployment)
        let convexSiteURL = try origin(site)
        guard convexURL.host?.lowercased() != convexSiteURL.host?.lowercased() else {
            throw ServiceFailure.notConfigured
        }
        if let expectedProject = bundle.object(forInfoDictionaryKey: "FIREBASE_PROJECT_ID") as? String {
            guard validSetting(expectedProject), expectedProject == projectID else { throw ServiceFailure.notConfigured }
        }
        return LiveConfiguration(convexURL: convexURL, convexSiteURL: convexSiteURL, firebaseOptions: options)
    }

    func uploadURL(_ value: String, uploadId: String, asset: String) throws -> URL {
        guard let url = URL(string: value), isSiteURL(url), url.query == nil,
              !uploadId.isEmpty, !uploadId.contains("/"), !uploadId.contains("%"),
              asset == "video" || asset == "avatar",
              url.path == "/v1/uploads/\(uploadId)/\(asset)" else {
            throw ServiceFailure(code: "INVALID_UPLOAD", message: "The server returned an unsafe upload destination.", retryable: false)
        }
        return url
    }

    func playbackURL(_ value: String) throws -> URL {
        guard let url = URL(string: value), isSiteURL(url), url.path.hasPrefix("/v1/media/"),
              url.path.split(separator: "/").count == 3, !url.path.contains("/../"),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.contains(where: { $0.name == "token" && !($0.value ?? "").isEmpty }) == true else {
            throw ServiceFailure(code: "INVALID_GRANT", message: "Secure playback is unavailable. Please try again.", retryable: true)
        }
        return url
    }

    private func isSiteURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == convexSiteURL.host?.lowercased()
            && (url.port ?? 443) == (convexSiteURL.port ?? 443)
            && url.user == nil && url.password == nil && url.fragment == nil
    }

    private static func validSetting(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowered = trimmed.lowercased()
        return !trimmed.isEmpty && trimmed == value && !value.contains("$(") && !value.contains("${")
            && !lowered.contains("replace_me") && !lowered.contains("your_project")
            && !lowered.contains("your-project") && !lowered.contains("example")
    }

    private static func origin(_ value: String) throws -> URL {
        guard validSetting(value), let url = URL(string: value), url.scheme?.lowercased() == "https",
              let host = url.host, host.contains("."), host != "localhost", !host.hasSuffix(".invalid"),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/", url.port == nil || url.port == 443 else {
            throw ServiceFailure.notConfigured
        }
        return url
    }
}
