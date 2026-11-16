import AuthenticationServices
import ConvexMobile
import Foundation
import Security
import UIKit

struct ConvexAuthTokens: Codable, Sendable, Equatable {
    let accessToken: String
    let refreshToken: String
    let refreshTokenExpiresAt: Double
    let userId: String
    var isValid: Bool { !accessToken.isEmpty && !refreshToken.isEmpty && !userId.isEmpty && refreshTokenExpiresAt.isFinite && refreshTokenExpiresAt > 0 }
}

struct ConvexSession: Sendable {
    let bindingID: UUID
    let uid: String
    let accessToken: String
}

struct ConvexStoredSession: Codable, Equatable {
    let bindingID: UUID
    let tokens: ConvexAuthTokens
    let method: String
}

struct ConvexSessionStore {
    let account: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.take.app.convex-auth", kSecAttrAccount as String: account]
    }

    func load() throws -> ConvexStoredSession? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        Self.report(status, operation: "read")
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Self.unavailable(status) }
        guard let value = try? JSONDecoder().decode(ConvexStoredSession.self, from: data), value.tokens.isValid,
              value.method == "apple" || value.method == "usernamePassword" else {
            try clear()
            return nil
        }
        return value
    }

    func save(_ value: ConvexStoredSession) throws {
        let data = try JSONEncoder().encode(value)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        Self.report(status, operation: "update")
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let added = SecItemAdd(item as CFDictionary, nil)
            Self.report(added, operation: "add")
            guard added == errSecSuccess else { throw Self.unavailable(added) }
        } else if status != errSecSuccess { throw Self.unavailable(status) }
    }

    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        Self.report(status, operation: "delete")
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.unavailable(status) }
    }

    private static func report(_ status: OSStatus, operation: String) {
        #if DEBUG
        if ProcessInfo.processInfo.environment["TAKE_KEYCHAIN_DIAGNOSTICS"] == "1" {
            print("TAKE Keychain \(operation) OSStatus=\(status)")
        }
        #endif
    }

    private static func unavailable(_ status: OSStatus) -> ServiceFailure {
        ServiceFailure(code: "AUTH_STORAGE_\(status)", message: "Secure sign-in storage isn't available. Unlock your device and try again.", retryable: true)
    }
}

@MainActor
final class ConvexAuthentication: NSObject, ConvexMobile.AuthProvider, ASWebAuthenticationPresentationContextProviding {
    typealias T = ConvexSession

    var onSessionInvalidated: (() -> Void)?
    var onTokenRefreshUnavailable: (() -> Void)?
    var currentSessionID: UUID? { storedSession?.bindingID }
    var currentUID: String? { storedSession?.tokens.userId }
    var isDevelopmentSession: Bool { storedSession?.method == "usernamePassword" }

    private let configuration: LiveConfiguration
    private let publicClient: ConvexClient
    private let store: ConvexSessionStore
    private var storedSession: ConvexStoredSession?
    private var onIdToken: (@Sendable (String?) -> Void)?
    private var tokenRevision = 0
    private var refreshTask: Task<ConvexAuthTokens, Error>?
    private var refreshTaskID: UUID?
    private var browser: ASWebAuthenticationSession?
    private var browserContinuation: CheckedContinuation<URL, Error>?
    private var browserID: UUID?
    private var signInID: UUID?

    init(configuration: LiveConfiguration) throws {
        self.configuration = configuration
        publicClient = ConvexClient(deploymentUrl: configuration.convexURL.absoluteString)
        store = ConvexSessionStore(account: configuration.convexURL.absoluteString)
        storedSession = try store.load()
        super.init()
    }

    func signInWithApple(expectedUserID: String? = nil) async throws {
        let attempt = UUID()
        cancelBrowser()
        signInID = attempt
        defer { if signInID == attempt { signInID = nil } }
        let relayNonce = try Self.relayNonce()
        var relay = URLComponents(url: configuration.convexSiteURL.appendingPathComponent("auth/ios"), resolvingAgainstBaseURL: false)!
        relay.queryItems = [URLQueryItem(name: "state", value: relayNonce)]
        let response: AppleStartResponse = try await withLiveTimeout(seconds: 30) {
            try await self.publicClient.mutation("auth:startSignInWithApple", with: ["redirectTo": relay.url!.absoluteString])
        }
        try Task.checkCancellation()
        guard signInID == attempt, Self.isHandoffToken(response.state),
              let url = URL(string: response.redirect), url.scheme == "https", url.host == "appleid.apple.com", url.path == "/auth/authorize",
              url.port == nil || url.port == 443, url.user == nil, url.password == nil, url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.filter({ $0.name == "state" }).map(\.value) == [response.state],
              components.queryItems?.filter({ $0.name == "redirect_uri" }).map(\.value) == [configuration.convexSiteURL.appendingPathComponent("oauth/apple/callback").absoluteString] else { throw Self.invalidResponse }
        var handoff = ConvexAppleHandoff(relayNonce: relayNonce, oauthState: response.state)
        let callback = try await openBrowser(url)
        guard signInID == attempt else { throw CancellationError() }
        let redemption = try handoff.consume(callback)
        let result: SignInResponse = try await withLiveTimeout(seconds: 30) {
            try await self.publicClient.mutation("auth:completeSignInWithApple", with: ["state": redemption.state, "code": redemption.code])
        }
        try Task.checkCancellation()
        guard signInID == attempt, result.status == "complete", let tokens = result.tokens else { throw CancellationError() }
        try await accept(tokens, method: "apple", expectedUserID: expectedUserID)
    }

    func signInDevelopment(username: String, password: String, createAccount: Bool, expectedUserID: String? = nil) async throws {
        #if DEBUG
        guard !ProcessInfo.processInfo.arguments.contains("--demo") else { throw ServiceFailure.notConfigured }
        #else
        throw ServiceFailure.notConfigured
        #endif
        let attempt = UUID()
        cancelBrowser(); signInID = attempt
        defer { if signInID == attempt { signInID = nil } }
        let result: SignInResponse = try await withLiveTimeout(seconds: 30) {
            try await self.publicClient.mutation(createAccount ? "auth:signUpWithUsernamePassword" : "auth:signInWithUsernamePassword", with: ["username": username, "password": password])
        }
        try Task.checkCancellation()
        guard signInID == attempt else { throw CancellationError() }
        guard result.status == "complete", let tokens = result.tokens else {
            throw ServiceFailure(code: "DEVELOPMENT_SIGN_IN_FAILED", message: "Development sign-in was refused. Check the credentials and that this deployment enables development authentication.", retryable: false)
        }
        try await accept(tokens, method: "usernamePassword", expectedUserID: expectedUserID)
    }

    nonisolated func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> ConvexSession {
        try await establishSession(onIdToken: onIdToken)
    }

    nonisolated func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> ConvexSession {
        try await establishSession(onIdToken: onIdToken)
    }

    nonisolated func extractIdToken(from authResult: ConvexSession) -> String { authResult.accessToken }

    nonisolated func logout() async throws { try await endSession() }

    func freshAccessToken() async throws -> String {
        guard let session = storedSession else { throw Self.unauthenticated }
        let revision = tokenRevision
        let token = try await Self.retrieveToken({
            let task: Task<ConvexAuthTokens, Error>
            let taskID: UUID
            if let refreshTask = self.refreshTask, let refreshTaskID = self.refreshTaskID { task = refreshTask; taskID = refreshTaskID }
            else {
                taskID = UUID()
                task = Task {
                    let response: RefreshResponse = try await withLiveTimeout(seconds: 30) {
                        try await self.publicClient.mutation("auth:refreshSession", with: ["refreshToken": session.tokens.refreshToken])
                    }
                    guard response.kind == "rotated", let tokens = response.tokens, tokens.isValid, tokens.userId == session.tokens.userId else { throw Self.unauthenticated }
                    guard revision == self.tokenRevision, self.currentSessionID == session.bindingID else { throw CancellationError() }
                    let updated = ConvexStoredSession(bindingID: session.bindingID, tokens: tokens, method: session.method)
                    try self.store.save(updated)
                    self.storedSession = updated
                    return tokens
                }
                self.refreshTask = task
                self.refreshTaskID = taskID
            }
            defer { if self.refreshTaskID == taskID { self.refreshTask = nil; self.refreshTaskID = nil } }
            _ = try await task.value
            guard revision == self.tokenRevision, self.currentSessionID == session.bindingID else { throw CancellationError() }
            guard let token = self.storedSession?.tokens.accessToken else { throw Self.unauthenticated }
            return token
        }, isCurrent: { revision == self.tokenRevision && self.currentSessionID == session.bindingID }, onFailure: handleTokenFailure)
        onIdToken?(token)
        return token
    }

    func resetTokenBinding() {
        tokenRevision += 1
        refreshTask?.cancel(); refreshTask = nil; refreshTaskID = nil
        onIdToken?(nil); onIdToken = nil
    }

    static func retrieveToken(_ operation: () async throws -> String, isCurrent: () -> Bool,
                              onFailure: (Error) -> ServiceFailure) async throws -> String {
        do {
            let token = try await operation()
            guard isCurrent() else { throw CancellationError() }
            return token
        } catch {
            guard isCurrent() else { throw CancellationError() }
            throw onFailure(error)
        }
    }

    nonisolated static func isTransientTokenError(_ error: Error) -> Bool {
        if error is URLError || error is CancellationError { return true }
        if let failure = error as? ServiceFailure { return failure.retryable }
        if case ClientError.ConvexError = error { return false }
        return error is ClientError
    }

    nonisolated static func callbackCode(_ url: URL, expectedState: String) throws -> String {
        guard url.scheme == "take", url.host == "auth", url.path == "/convex", url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw CancellationError() }
        let codes = components.queryItems?.filter { $0.name == "code" } ?? []
        let states = components.queryItems?.filter { $0.name == "state" } ?? []
        guard Self.isHandoffToken(expectedState), components.queryItems?.count == 2, states.count == 1, states[0].value == expectedState,
              codes.count == 1, let code = codes[0].value, Self.isHandoffToken(code) else { throw CancellationError() }
        return code
    }

    nonisolated static func relayNonce() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Self.invalidResponse }
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    nonisolated static func isHandoffToken(_ value: String) -> Bool {
        value.utf8.count == 43 && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    private func establishSession(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> ConvexSession {
        self.onIdToken = onIdToken
        guard let id = currentSessionID else { onIdToken(nil); throw Self.unauthenticated }
        let token = try await freshAccessToken()
        guard id == currentSessionID else { throw CancellationError() }
        guard let uid = currentUID else { throw Self.unauthenticated }
        return ConvexSession(bindingID: id, uid: uid, accessToken: token)
    }

    private func accept(_ tokens: ConvexAuthTokens, method: String, expectedUserID: String?) async throws {
        try Task.checkCancellation()
        guard tokens.isValid else { throw Self.invalidResponse }
        if let expectedUserID, expectedUserID != tokens.userId {
            try? await revoke(tokens.refreshToken)
            throw ServiceFailure(code: "ACCOUNT_MISMATCH", message: "Sign in to the same account to confirm deletion. Your current account hasn't changed.", retryable: false)
        }
        let session = ConvexStoredSession(bindingID: UUID(), tokens: tokens, method: method)
        try store.save(session)
        resetTokenBinding()
        storedSession = session
    }

    private func handleTokenFailure(_ error: Error) -> ServiceFailure {
        resetTokenBinding()
        if Self.isTransientTokenError(error) {
            onTokenRefreshUnavailable?()
            return ServiceFailure(code: "AUTH_NETWORK", message: "Couldn't refresh sign-in. Reconnect and try again; your saved recording stays on this device.", retryable: true)
        }
        storedSession = nil
        try? store.clear()
        onSessionInvalidated?()
        return Self.unauthenticated
    }

    private func endSession() async throws {
        let token = storedSession?.tokens.refreshToken
        signInID = nil
        cancelBrowser()
        resetTokenBinding()
        storedSession = nil
        try store.clear()
        if let token { try? await revoke(token) }
    }

    private func revoke(_ refreshToken: String) async throws {
        let _: Void = try await withLiveTimeout(seconds: 5) {
            try await self.publicClient.mutation("auth:signOut", with: ["refreshToken": refreshToken])
        }
    }

    private func openBrowser(_ url: URL) async throws -> URL {
        let id = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()); return }
                browserID = id
                browserContinuation = continuation
                let browser = ASWebAuthenticationSession(url: url, callbackURLScheme: "take") { [weak self] callback, error in
                    Task { @MainActor [weak self] in
                        guard let self, self.browserID == id else { return }
                        self.browserID = nil; self.browser = nil
                        let continuation = self.browserContinuation; self.browserContinuation = nil
                        if let callback { continuation?.resume(returning: callback) }
                        else { continuation?.resume(throwing: error ?? CancellationError()) }
                    }
                }
                browser.presentationContextProvider = self
                browser.prefersEphemeralWebBrowserSession = true
                self.browser = browser
                if !browser.start() { cancelBrowser() }
            }
        } onCancel: {
            Task { @MainActor [weak self] in if self?.browserID == id { self?.cancelBrowser() } }
        }
    }

    private func cancelBrowser() {
        browserID = nil
        browser?.cancel(); browser = nil
        let continuation = browserContinuation; browserContinuation = nil
        continuation?.resume(throwing: CancellationError())
    }

    nonisolated private static var unauthenticated: ServiceFailure {
        ServiceFailure(code: "UNAUTHENTICATED", message: "Sign in with Apple to continue.", retryable: false)
    }

    nonisolated private static var invalidResponse: ServiceFailure {
        ServiceFailure(code: "INVALID_AUTH_RESPONSE", message: "Sign-in couldn't be verified. Please start again.", retryable: false)
    }
}

struct ConvexAppleHandoff {
    let relayNonce: String
    let oauthState: String
    let createdAt: Date
    private var consumed = false

    init(relayNonce: String, oauthState: String, createdAt: Date = Date()) {
        self.relayNonce = relayNonce
        self.oauthState = oauthState
        self.createdAt = createdAt
    }

    mutating func consume(_ callback: URL, now: Date = Date()) throws -> (state: String, code: String) {
        guard !consumed else { throw CancellationError() }
        consumed = true
        guard now.timeIntervalSince(createdAt) >= 0, now.timeIntervalSince(createdAt) < 300,
              ConvexAuthentication.isHandoffToken(oauthState) else { throw CancellationError() }
        return (oauthState, try ConvexAuthentication.callbackCode(callback, expectedState: relayNonce))
    }
}

struct SignInResponse: Decodable {
    let status: String
    let tokens: ConvexAuthTokens?
}

private struct AppleStartResponse: Decodable {
    let redirect: String
    let state: String
}

struct RefreshResponse: Decodable {
    let kind: String
    let tokens: ConvexAuthTokens?
}
