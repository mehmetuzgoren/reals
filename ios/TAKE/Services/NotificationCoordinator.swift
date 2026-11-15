import Combine
import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationCoordinator: NSObject, ObservableObject {
    static let shared = NotificationCoordinator()

    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var isRegistered = false
    @Published private(set) var errorMessage: String?

    var onOpen: (() -> Void)? {
        didSet { deliverPendingOpen() }
    }

    private weak var service: (any TakeService)?
    private let center = UNUserNotificationCenter.current()
    private var apnsToken: String?
    private var registration: (viewer: String, token: String)?
    private var registrationTask: Task<Void, Never>?
    private var registrationEpoch = UUID()
    private var pendingOpen = false
    private var isRefreshing = false
    private var refreshAgain = false
    private var apnsRegistrationStarted = false
    private let apnsRegistrationEnabled = Bundle.main.object(forInfoDictionaryKey: "TAKE_APNS_REGISTRATION_ENABLED") as? Bool == true

    private var installationID: String {
        let key = "TAKE.live.installationID"
        if let id = UserDefaults.standard.string(forKey: key) { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }

    private override init() {
        super.init()
    }

    func configure(service: any TakeService) {
        registrationEpoch = UUID()
        registrationTask?.cancel()
        registrationTask = nil
        refreshAgain = false
        self.service = nil
        registration = nil
        apnsToken = nil
        apnsRegistrationStarted = false
        isRegistered = false
        errorMessage = nil
        guard !service.isDemo else {
            pendingOpen = false
            UIApplication.shared.unregisterForRemoteNotifications()
            return
        }
        self.service = service
        center.delegate = self
        deliverPendingOpen()
        scheduleRefresh()
    }

    func requestPermission() async {
        guard !Task.isCancelled, let service, !service.isDemo, let viewer = service.viewerID else { return }
        let epoch = registrationEpoch
        do {
            let settings = await center.notificationSettings()
            guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer else { return }
            if settings.authorizationStatus == .notDetermined {
                _ = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            }
            guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer else { return }
            errorMessage = nil
            await refreshRegistration()
        } catch {
            guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer else { return }
            errorMessage = "Notification permission couldn't be requested. You can change it in Settings."
        }
    }

    func refreshRegistration() async {
        guard !Task.isCancelled, let service, !service.isDemo, let viewer = service.viewerID else { return }
        guard !isRefreshing else { refreshAgain = true; return }
        isRefreshing = true
        defer {
            isRefreshing = false
            if refreshAgain {
                refreshAgain = false
                scheduleRefresh()
            }
        }
        let epoch = registrationEpoch
        let settings = await center.notificationSettings()
        guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer else { return }
        authorizationStatus = settings.authorizationStatus
        let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
        guard allowed else {
            UIApplication.shared.unregisterForRemoteNotifications()
            apnsRegistrationStarted = false
            apnsToken = nil
            registration = nil
            isRegistered = false
            errorMessage = nil
            let installationId = installationID
            do {
                try await withLiveTimeout(seconds: 5) {
                    guard !Task.isCancelled, epoch == self.registrationEpoch, self.service === service, service.viewerID == viewer else { throw CancellationError() }
                    try await service.unregisterDevice(installationId: installationId)
                }
            } catch {
                guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer else { return }
                errorMessage = "Couldn't remove this device's notification registration. Registration is disabled on this phone."
            }
            return
        }
        if registration?.viewer != viewer {
            registration = nil
            isRegistered = false
        }
        if apnsRegistrationEnabled, !apnsRegistrationStarted {
            apnsRegistrationStarted = true
            errorMessage = nil
            UIApplication.shared.registerForRemoteNotifications()
        }
        guard let token = apnsToken else {
            if !apnsRegistrationEnabled {
                errorMessage = "Remote push delivery isn't configured for this build. You can still save notification preferences."
            }
            return
        }
        if registration?.viewer == viewer, registration?.token == token, isRegistered { return }
        let installationId = installationID
        do {
            try await withLiveTimeout(seconds: 10) {
                guard !Task.isCancelled, epoch == self.registrationEpoch, self.service === service, service.viewerID == viewer, self.apnsToken == token else { throw CancellationError() }
                try await service.registerDevice(installationId: installationId, deviceToken: token, enabled: true)
            }
            guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer, apnsToken == token else { return }
            registration = (viewer, token)
            isRegistered = true
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, epoch == registrationEpoch, self.service === service, service.viewerID == viewer, apnsToken == token else { return }
            errorMessage = "Couldn't save this device's notification token. Open TAKE again when you're connected."
        }
    }

    func signOutCleanup() async {
        let previousService = service
        let previousViewer = previousService?.viewerID
        registrationEpoch = UUID()
        let epoch = registrationEpoch
        registrationTask?.cancel()
        registrationTask = nil
        refreshAgain = false
        service = nil
        registration = nil
        apnsToken = nil
        apnsRegistrationStarted = false
        isRegistered = false
        pendingOpen = false
        errorMessage = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()
        if let previousService, !previousService.isDemo, let previousViewer {
            let installationId = installationID
            do {
                try await withLiveTimeout(seconds: 5) {
                    guard !Task.isCancelled, epoch == self.registrationEpoch, self.service == nil, previousService.viewerID == previousViewer else { throw CancellationError() }
                    try await previousService.unregisterDevice(installationId: installationId)
                }
            } catch {
                guard epoch == registrationEpoch, service == nil else { return }
                if !(error is CancellationError) {
                    errorMessage = "Couldn't remove this device from your account. Remote notification registration is disabled on this phone."
                }
            }
        }
        guard epoch == registrationEpoch, service == nil else { return }
        try? await center.setBadgeCount(0)
    }

    func didRegisterAPNs(_ token: Data) {
        guard apnsRegistrationEnabled, apnsRegistrationStarted, !token.isEmpty, let service, !service.isDemo, service.viewerID != nil else { return }
        let deviceToken = token.map { String(format: "%02x", $0) }.joined()
        apnsRegistrationStarted = true
        if apnsToken == deviceToken, registration?.viewer == service.viewerID, isRegistered { return }
        apnsToken = deviceToken
        registration = nil
        isRegistered = false
        scheduleRefresh()
    }

    func didFailAPNsRegistration() {
        guard let service, !service.isDemo, service.viewerID != nil, apnsRegistrationStarted else { return }
        apnsRegistrationStarted = false
        apnsToken = nil
        registration = nil
        registrationTask?.cancel()
        refreshAgain = false
        isRegistered = false
        errorMessage = "Remote notifications aren't available on this device yet. You can still use TAKE."
    }

    func notificationOpened() {
        pendingOpen = true
        deliverPendingOpen()
    }

    private func deliverPendingOpen() {
        guard pendingOpen, let service, !service.isDemo, service.viewerID != nil, let onOpen else { return }
        pendingOpen = false
        onOpen()
    }

    private func scheduleRefresh() {
        registrationTask?.cancel()
        registrationTask = Task { [weak self] in
            guard !Task.isCancelled else { return }
            await self?.refreshRegistration()
        }
    }
}

extension NotificationCoordinator: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run {
            guard let service = self.service, !service.isDemo, service.viewerID != nil else { return [] }
            return [.banner, .list, .sound]
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier else { return }
        await MainActor.run { self.notificationOpened() }
    }
}

@MainActor
final class TakeAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationCoordinator.shared
        if launchOptions?[.remoteNotification] != nil { NotificationCoordinator.shared.notificationOpened() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCoordinator.shared.didRegisterAPNs(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCoordinator.shared.didFailAPNsRegistration()
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        completionHandler(.noData)
    }
}
