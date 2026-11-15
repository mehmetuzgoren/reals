import Combine
import FirebaseCore
import FirebaseMessaging
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
    private var fcmToken: String?
    private var registration: (viewer: String, token: String)?
    private var registrationTask: Task<Void, Never>?
    private var registrationEpoch = UUID()
    private var pendingOpen = false
    private var isRefreshing = false
    private var refreshAgain = false
    private var firebaseReady = false
    private var messagingStarted = false

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
        guard !service.isDemo else { return }
        registrationEpoch = UUID()
        self.service = service
        center.delegate = self
        if FirebaseApp.app() != nil { firebaseDidConfigure() }
        deliverPendingOpen()
        scheduleRefresh()
    }

    func requestPermission() async {
        guard let service, !service.isDemo, service.viewerID != nil, firebaseReady else { return }
        do {
            let settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            }
            errorMessage = nil
            await refreshRegistration()
        } catch {
            errorMessage = "Notification permission couldn't be requested. You can change it in Settings."
        }
    }

    func refreshRegistration() async {
        guard !isRefreshing else { refreshAgain = true; return }
        guard let service, !service.isDemo, let viewer = service.viewerID, firebaseReady, FirebaseApp.app() != nil else { return }
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
        guard epoch == registrationEpoch, self.service === service else { return }
        authorizationStatus = settings.authorizationStatus
        let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
        guard allowed else {
            Messaging.messaging().isAutoInitEnabled = false
            UIApplication.shared.unregisterForRemoteNotifications()
            do {
                if let fcmToken {
                    try await service.registerDevice(installationId: installationID, fcmToken: fcmToken, enabled: false)
                } else {
                    try await service.unregisterDevice(installationId: installationID)
                }
                guard epoch == registrationEpoch else { return }
                registration = nil
                isRegistered = false
                errorMessage = nil
            } catch {
                guard epoch == registrationEpoch else { return }
                errorMessage = "Couldn't update notification delivery. Open TAKE again when you're connected."
            }
            return
        }
        messagingStarted = true
        Messaging.messaging().isAutoInitEnabled = true
        Messaging.messaging().delegate = self
        UIApplication.shared.registerForRemoteNotifications()
        guard Messaging.messaging().apnsToken != nil else { return }
        do {
            let token: String
            if let fcmToken { token = fcmToken }
            else { token = try await withLiveTimeout(seconds: 10) { try await Messaging.messaging().token() } }
            guard epoch == registrationEpoch, self.service === service, service.viewerID == viewer else { return }
            guard !token.isEmpty else { return }
            fcmToken = token
            if registration?.viewer == viewer, registration?.token == token, isRegistered { return }
            try await service.registerDevice(installationId: installationID, fcmToken: token, enabled: true)
            guard epoch == registrationEpoch, self.service === service else { return }
            registration = (viewer, token)
            isRegistered = true
            errorMessage = nil
        } catch {
            guard epoch == registrationEpoch else { return }
            errorMessage = "Couldn't enable notification delivery. Open TAKE again when you're connected."
        }
    }

    func signOutCleanup() async {
        let previousService = service
        let shouldRetireToken = messagingStarted
        registrationEpoch = UUID()
        registrationTask?.cancel()
        registrationTask = nil
        refreshAgain = false
        service = nil
        registration = nil
        fcmToken = nil
        isRegistered = false
        pendingOpen = false
        if previousService != nil || shouldRetireToken { errorMessage = nil }
        if firebaseReady, FirebaseApp.app() != nil {
            Messaging.messaging().isAutoInitEnabled = false
            UIApplication.shared.unregisterForRemoteNotifications()
        }
        if let previousService, !previousService.isDemo, previousService.viewerID != nil {
            do {
                try await previousService.unregisterDevice(installationId: installationID)
            } catch {
                errorMessage = "This device couldn't be removed from your account while offline. Push registration has been disabled on this phone."
            }
        }
        if shouldRetireToken, firebaseReady, FirebaseApp.app() != nil {
            do {
                try await withLiveTimeout(seconds: 5) { try await Messaging.messaging().deleteToken() }
                messagingStarted = false
            } catch {
                errorMessage = "Push registration is disabled. Its delivery token couldn't be retired while offline."
            }
        }
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()
        try? await center.setBadgeCount(0)
    }

    func firebaseDidConfigure() {
        guard FirebaseApp.app() != nil else { return }
        firebaseReady = true
        Messaging.messaging().isAutoInitEnabled = false
        Messaging.messaging().delegate = self
        center.delegate = self
    }

    func didRegisterAPNs(_ token: Data) {
        guard firebaseReady, FirebaseApp.app() != nil, let service, !service.isDemo, service.viewerID != nil else { return }
        Messaging.messaging().apnsToken = token
        scheduleRefresh()
    }

    func didFailAPNsRegistration() {
        guard service != nil else { return }
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

extension NotificationCoordinator: MessagingDelegate {
    nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        Task { @MainActor [weak self] in
            guard let self, let service = self.service, !service.isDemo, service.viewerID != nil else { return }
            if self.fcmToken == fcmToken, self.isRegistered { return }
            self.fcmToken = fcmToken
            self.registration = nil
            self.isRegistered = false
            self.scheduleRefresh()
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
        if FirebaseApp.app() != nil { NotificationCoordinator.shared.firebaseDidConfigure() }
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
