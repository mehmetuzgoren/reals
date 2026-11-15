import AuthenticationServices
import ConvexMobile
import CryptoKit
import FirebaseAuth
import FirebaseCore
import Foundation
import Security

struct FirebaseSession: Sendable {
    let uid: String
    let idToken: String
}

@MainActor
final class FirebaseAuthentication: ConvexMobile.AuthProvider, AppleAuthenticationService {
    typealias T = FirebaseSession

    var onSessionInvalidated: (() -> Void)?
    var onTokenRefreshUnavailable: (() -> Void)?
    var currentUID: String? { auth.currentUser?.uid }

    private let auth: Auth
    private var pendingAppleRequest: (nonce: String, state: String, createdAt: Date)?
    private var tokenListener: NSObjectProtocol?
    private var onIdToken: (@Sendable (String?) -> Void)?
    private var boundUID: String?
    private var tokenRevision = 0

    init(configuration: LiveConfiguration) throws {
        if let app = FirebaseApp.app() {
            guard app.options.projectID == configuration.firebaseOptions.projectID,
                  app.options.googleAppID == configuration.firebaseOptions.googleAppID,
                  app.options.bundleID == configuration.firebaseOptions.bundleID else {
                throw ServiceFailure.notConfigured
            }
        } else {
            FirebaseApp.configure(options: configuration.firebaseOptions)
        }
        auth = Auth.auth()
        NotificationCoordinator.shared.firebaseDidConfigure()
    }

    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) throws {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw ServiceFailure(code: "SECURE_RANDOM_FAILED", message: "Apple sign-in couldn't start securely. Please try again.", retryable: true)
        }
        let nonce = bytes.map { String(format: "%02x", $0) }.joined()
        let state = UUID().uuidString
        pendingAppleRequest = (nonce, state, Date())
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        request.state = state
    }

    func completeAppleSignIn(_ authorization: ASAuthorization) async throws {
        defer { pendingAppleRequest = nil }
        guard let pending = pendingAppleRequest, Date().timeIntervalSince(pending.createdAt) < 300,
              let apple = authorization.credential as? ASAuthorizationAppleIDCredential,
              apple.state == pending.state,
              let tokenData = apple.identityToken, let token = String(data: tokenData, encoding: .utf8),
              !token.isEmpty else {
            throw ServiceFailure(code: "INVALID_APPLE_RESPONSE", message: "Apple sign-in expired. Please start again.", retryable: true)
        }
        let credential = OAuthProvider.appleCredential(withIDToken: token, rawNonce: pending.nonce, fullName: apple.fullName)
        do {
            if let user = auth.currentUser,
               user.providerData.contains(where: { $0.providerID == "apple.com" && $0.uid == apple.user }) {
                _ = try await user.reauthenticate(with: credential)
            } else {
                _ = try await auth.signIn(with: credential)
            }
        } catch {
            throw Self.failure(error)
        }
    }

    nonisolated func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> FirebaseSession {
        try await establishSession(onIdToken: onIdToken)
    }

    nonisolated func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> FirebaseSession {
        try await establishSession(onIdToken: onIdToken)
    }

    nonisolated func extractIdToken(from authResult: FirebaseSession) -> String {
        authResult.idToken
    }

    nonisolated func logout() async throws {
        try await endSession()
    }

    func freshIDToken() async throws -> String {
        guard let user = auth.currentUser, user.uid == boundUID else {
            throw Self.unauthenticated
        }
        let revision = tokenRevision
        let token = try await Self.retrieveToken(
            { try await user.getIDToken(forcingRefresh: true) },
            isCurrent: { revision == self.tokenRevision && self.auth.currentUser?.uid == user.uid && self.boundUID == user.uid },
            onFailure: handleTokenFailure
        )
        onIdToken?(token)
        return token
    }

    func resetTokenBinding() {
        tokenRevision += 1
        if let tokenListener {
            auth.removeIDTokenDidChangeListener(tokenListener)
            self.tokenListener = nil
        }
        onIdToken?(nil)
        onIdToken = nil
        boundUID = nil
    }

    private func establishSession(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> FirebaseSession {
        self.onIdToken = onIdToken
        guard let user = auth.currentUser else {
            onIdToken(nil)
            throw Self.unauthenticated
        }
        if let boundUID, boundUID != user.uid {
            onIdToken(nil)
            onSessionInvalidated?()
        }
        boundUID = user.uid
        tokenRevision += 1
        let revision = tokenRevision
        if tokenListener == nil {
            tokenListener = auth.addIDTokenDidChangeListener { [weak self] _, user in
                let uid = user?.uid
                Task { @MainActor [weak self] in
                    await self?.tokenChanged(uid: uid)
                }
            }
        }
        let token = try await Self.retrieveToken(
            { try await user.getIDToken(forcingRefresh: true) },
            isCurrent: { revision == self.tokenRevision && self.auth.currentUser?.uid == user.uid && self.boundUID == user.uid },
            onFailure: handleTokenFailure
        )
        return FirebaseSession(uid: user.uid, idToken: token)
    }

    private func tokenChanged(uid: String?) async {
        guard let boundUID else { return }
        guard let user = auth.currentUser, uid == boundUID, user.uid == boundUID else {
            onIdToken?(nil)
            onSessionInvalidated?()
            return
        }
        let revision = tokenRevision
        do {
            let token = try await Self.retrieveToken(
                { try await user.getIDToken(forcingRefresh: false) },
                isCurrent: { revision == self.tokenRevision && self.auth.currentUser?.uid == boundUID && self.boundUID == boundUID },
                onFailure: handleTokenFailure
            )
            onIdToken?(token)
        } catch {}
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
        let value = error as NSError
        return value.domain == AuthErrorDomain && value.code == AuthErrorCode.networkError.rawValue
    }

    private func handleTokenFailure(_ error: Error) -> ServiceFailure {
        onIdToken?(nil)
        if Self.isTransientTokenError(error) { onTokenRefreshUnavailable?() }
        else { onSessionInvalidated?() }
        return Self.failure(error)
    }

    private func endSession() throws {
        pendingAppleRequest = nil
        resetTokenBinding()
        do {
            try auth.signOut()
        } catch {
            throw Self.failure(error)
        }
    }

    private static var unauthenticated: ServiceFailure {
        ServiceFailure(code: "UNAUTHENTICATED", message: "Sign in with Apple to continue.", retryable: false)
    }

    private static func failure(_ error: Error) -> ServiceFailure {
        if let failure = error as? ServiceFailure { return failure }
        let code = (error as NSError).code
        if isTransientTokenError(error) {
            return ServiceFailure(code: "AUTH_NETWORK", message: "Couldn't reach sign-in. Check your connection and try again.", retryable: true)
        }
        if code == AuthErrorCode.requiresRecentLogin.rawValue {
            return ServiceFailure(code: "REAUTHENTICATION_REQUIRED", message: "Sign in with Apple again before deleting your account.", retryable: false)
        }
        return ServiceFailure(code: "UNAUTHENTICATED", message: "Apple sign-in couldn't be verified. Please sign in again.", retryable: false)
    }
}
