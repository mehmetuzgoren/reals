import AuthenticationServices
import SwiftUI
import UIKit

struct RootView: View {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if model.needsOnboarding { ProfileOnboardingView() }
            else if model.viewer != nil { MainTabsView().id(model.generation.uuidString + model.accessRevision.uuidString) }
            else { WelcomeView() }
        }
        .environmentObject(model)
        .preferredColorScheme(.dark)
        .tint(TakeTheme.white)
        .alert("A quick heads-up", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
        .task {
            NotificationCoordinator.shared.onOpen = { Task { model.selectedTab = 0; await model.refresh() } }
            if UserDefaults.standard.string(forKey: "TAKE.lastMode") == "demo" || ProcessInfo.processInfo.arguments.contains("--demo") { await model.enterDemo() }
            else if UserDefaults.standard.string(forKey: "TAKE.lastMode") == "live" { await model.restoreLive() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { PlaybackCoordinator.shared.pause() }
            if phase == .active, model.viewer != nil { Task { await model.refresh(); if !model.isDemo { await NotificationCoordinator.shared.refreshRegistration() } } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .takePrivateAccessInvalidated)) { _ in
            PlaybackCoordinator.shared.clear(); URLCache.shared.removeAllCachedResponses()
            if model.viewer != nil, !model.isDemo { Task { await model.relationshipChanged() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .takeSessionEnded)) { _ in if !model.isDemo, model.viewer != nil || model.needsOnboarding { model.sessionEnded() } }
        .onReceive(NotificationCenter.default.publisher(for: .takeAuthenticationPaused)) { _ in if !model.isDemo, model.viewer != nil { model.authenticationPaused() } }
    }
}

struct WelcomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var signingIn = false
    @State private var showDeveloperSignIn = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Text("TAKE").font(.system(size: 22, weight: .bold)).tracking(-0.6).frame(maxWidth: .infinity)
                .padding(.top, 28)
                VStack(alignment: .leading, spacing: 18) {
                    Text("One question.\nYour perspective.").font(.system(.largeTitle, weight: .bold)).tracking(-1)
                    Text("Up to 15 seconds. Just you and the people you know.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                }
                .padding(.top, 76).padding(.bottom, 24)
                VStack(alignment: .leading, spacing: 18) {
                    step("01", "Pick a side", "A fresh question, at a surprise time each day.")
                    step("02", "Give your take", "Up to 15 seconds. You post before you peek.")
                    step("03", "Open the conversation", "See friends who posted. Reply with a video.")
                }
                PrimaryButton(title: "Explore Demo Mode", symbol: "play.fill") { Task { await model.enterDemo() } }
                Text("Offline. Fictional friends. Clearly labeled sample clips. No account needed.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                BrowserAppleSignInButton {
                    Task {
                        signingIn = true
                        defer { signingIn = false }
                        let epoch = model.generation
                        do {
                            let authentication = try model.prepareLive()
                            try await authentication.signInWithApple()
                            guard epoch == model.generation, model.service === authentication else { return }
                            await model.establishSession()
                        } catch {
                            if epoch == model.generation, !(error is CancellationError), (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                                model.error = "Couldn't sign in with Apple. Check your connection and try again."
                            }
                        }
                    }
                }
                .frame(height: 54).clipShape(Capsule())
                .disabled(signingIn || (try? LiveConfiguration.load()) == nil)
                if (try? LiveConfiguration.load()) == nil { Text("Live sign-in isn't available in this build. The complete offline demo is ready to explore.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity) }
                Text("Only approved friends who have posted can see your take. No public profiles. No followers.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            }
            .padding(24).frame(maxWidth: 580)
        }
        .takeScreen()
        .sheet(isPresented: $showDeveloperSignIn) { DeveloperSignInView().environmentObject(model) }
        .onAppear {
            showDeveloperSignIn = ProcessInfo.processInfo.arguments.contains("--development-auth") && !ProcessInfo.processInfo.arguments.contains("--demo")
        }
    }
    private func step(_ number: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Text(number).font(.caption.monospaced().bold()).foregroundStyle(TakeTheme.white).padding(10).background(TakeTheme.raised, in: Circle())
            VStack(alignment: .leading, spacing: 3) { Text(title).font(.headline); Text(text).font(.subheadline).foregroundStyle(TakeTheme.muted) }
        }
    }
}

struct BrowserAppleSignInButton: UIViewRepresentable {
    let action: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .white)
        button.addTarget(context.coordinator, action: #selector(Coordinator.signIn), for: .touchUpInside)
        return button
    }
    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        button.isEnabled = context.environment.isEnabled
        context.coordinator.action = action
    }
    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action; super.init() }
        @objc func signIn() { action() }
    }
}

struct DeveloperSignInView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var reauthenticate = false
    var onAuthenticated: (() async -> Void)?
    @State private var username = ""
    @State private var password = ""
    @State private var createAccount = false
    @State private var signingIn = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Development deployments only. This screen isn't part of TAKE or Offline Demo Mode.")
                    if reauthenticate { Text("Sign in to the same account again to confirm deletion. A refreshed session isn't enough.") }
                }
                Section("Development credentials") {
                    TextField("Authentication username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username)
                    SecureField("Password", text: $password).textContentType(createAccount ? .newPassword : .password)
                    if !reauthenticate { Toggle("Create a development account", isOn: $createAccount) }
                }
                if let failure { Section { Text(failure).foregroundStyle(TakeTheme.muted) } }
                Section {
                    Button(signingIn ? "Signing in…" : reauthenticate ? "Sign in again to confirm" : createAccount ? "Create development account" : "Sign in to development") { Task { await signIn() } }
                        .disabled(signingIn || username.isEmpty || password.isEmpty)
                }
            }
            .disabled(signingIn)
            .scrollContentBackground(.hidden).takeScreen().navigationTitle("Developer sign-in")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { password = ""; dismiss() }.disabled(signingIn) } }
        }
        .interactiveDismissDisabled(signingIn)
        .onDisappear { password = "" }
    }

    private func signIn() async {
        signingIn = true; failure = nil
        defer { password = ""; signingIn = false }
        let epoch = model.generation
        do {
            guard ProcessInfo.processInfo.arguments.contains("--development-auth"), !model.isDemo else { throw ServiceFailure.notConfigured }
            let authentication = try model.prepareLive()
            try await authentication.signInDevelopment(username: username, password: password, createAccount: !reauthenticate && createAccount, reauthenticate: reauthenticate)
            guard epoch == model.generation, model.service === authentication else { return }
            if let onAuthenticated { await onAuthenticated(); dismiss() }
            else {
                await model.establishSession()
                if model.viewer != nil || model.needsOnboarding { dismiss() }
            }
        } catch {
            guard epoch == model.generation else { return }
            failure = (error as? ServiceFailure)?.message ?? "Development sign-in was refused. Check your credentials and that the server enables development authentication."
        }
    }
}

struct ProfileOnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @State private var username = ""
    @State private var name = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: "MAKE IT YOURS", color: TakeTheme.white)
                        Text("A name. A face.\nA point of view.").font(.largeTitle.bold())
                        Text("Your username helps friends find you. You can add a photo in Profile.").foregroundStyle(TakeTheme.muted)
                    }.listRowBackground(Color.clear)
                }
                Section("Your profile") {
                    TextField("Display name", text: $name).textContentType(.name).accessibilityIdentifier("Display name")
                    TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username).accessibilityIdentifier("Username")
                }
                Section {
                    PrimaryButton(title: model.busy ? "Saving…" : "Let's take a side", disabled: model.busy || name.isEmpty || username.count < 3) { Task { await model.completeProfile(username: username, name: name) } }.listRowBackground(Color.clear)
                    Button("Back to welcome") { Task { await model.signOut() } }.foregroundStyle(TakeTheme.muted)
                }
            }.scrollContentBackground(.hidden).takeScreen()
        }
    }
}

struct MainTabsView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack { TodayView() }.tabItem { Label("Today", systemImage: "square.stack.fill") }.tag(0)
            NavigationStack { FriendsView() }.tabItem { Label("Friends", systemImage: "person.2.fill") }.tag(1)
            NavigationStack { ProfileView() }.tabItem { Label("Profile", systemImage: "person.crop.circle") }.tag(2)
        }
        .toolbarBackground(TakeTheme.surface, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .onChange(of: model.selectedTab) { _, _ in PlaybackCoordinator.shared.pause() }
    }
}
