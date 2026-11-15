import AuthenticationServices
import SwiftUI

struct RootView: View {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if model.needsOnboarding { ProfileOnboardingView() }
            else if model.viewer != nil { MainTabsView().id(model.generation) }
            else { WelcomeView() }
        }
        .environmentObject(model)
        .preferredColorScheme(.dark)
        .tint(TakeTheme.lime)
        .alert("A quick heads-up", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
        .task {
            NotificationCoordinator.shared.onOpen = { Task { model.selectedTab = 0; await model.refresh() } }
            if UserDefaults.standard.string(forKey: "TAKE.lastMode") == "demo" || ProcessInfo.processInfo.arguments.contains("--demo") { await model.enterDemo() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { PlaybackCoordinator.shared.pause() }
            if phase == .active, model.viewer != nil { Task { await model.refresh() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .takePrivateAccessInvalidated)) { _ in
            PlaybackCoordinator.shared.clear(); URLCache.shared.removeAllCachedResponses()
            if model.viewer != nil, !model.isDemo { Task { await model.relationshipChanged() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .takeSessionEnded)) { _ in if !model.isDemo, model.viewer != nil || model.needsOnboarding { model.sessionEnded() } }
    }
}

struct WelcomeView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Text("TAKE").font(.system(size: 30, weight: .black, design: .rounded)).tracking(-1)
                    Spacer()
                    Eyebrow(text: "A LITTLE PERSPECTIVE", color: TakeTheme.lime)
                }
                .padding(.top, 28)
                ZStack {
                    RoundedRectangle(cornerRadius: 36).fill(TakeTheme.lavender).rotationEffect(.degrees(-4))
                    VStack(alignment: .leading, spacing: 18) {
                        HStack { Image(systemName: "quote.opening").font(.system(size: 44, weight: .black)); Spacer(); Text("15s").font(.headline).padding(12).background(.black.opacity(0.08), in: Capsule()) }
                        Text("Big question.\nSmall takes.").font(.system(.largeTitle, design: .rounded, weight: .black)).tracking(-1)
                        HStack(spacing: -9) {
                            ForEach(DemoIdentity.allCases) { identity in AvatarView(profile: PublicProfile(id: identity.rawValue, username: identity.rawValue, displayName: identity.name, avatar: nil), size: 52).overlay(Circle().stroke(TakeTheme.lavender, lineWidth: 3)) }
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.title.bold())
                        }
                    }
                    .padding(28).foregroundStyle(TakeTheme.background)
                }
                .padding(.vertical, 12)
                VStack(alignment: .leading, spacing: 12) {
                    Text("Less scrolling.\nMore seeing each other.").font(.title.bold()).tracking(-0.5)
                    Text("One daily question. Your honest opinion. The people you actually know.").font(.body).foregroundStyle(TakeTheme.muted)
                }
                VStack(alignment: .leading, spacing: 18) {
                    step("01", "Pick a side", "A fresh question, at a surprise time each day.")
                    step("02", "Give your take", "Up to 15 seconds. You post before you peek.")
                    step("03", "Open the conversation", "See friends who posted. Reply with a video.")
                }
                PrimaryButton(title: "Explore Demo Mode", symbol: "play.fill") { Task { await model.enterDemo() } }
                Text("Offline. Fictional friends. Clearly labeled sample clips. No account needed.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                SignInWithAppleButton(.signIn) { request in
                    do { try model.prepareLive().prepareAppleRequest(request) }
                    catch { model.error = error.localizedDescription }
                } onCompletion: { result in
                    Task {
                        do {
                            let authentication = try model.prepareLive()
                            try await authentication.completeAppleSignIn(result.get())
                            await model.establishSession()
                        } catch { model.error = error.localizedDescription }
                    }
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 54).clipShape(RoundedRectangle(cornerRadius: 18))
                .disabled((try? LiveConfiguration.load()) == nil)
                if (try? LiveConfiguration.load()) == nil { Text("Live sign-in isn't available in this build. The complete offline demo is ready to explore.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity) }
                Text("Only approved friends who have posted can see your take. No public profiles. No followers.").font(.caption).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            }
            .padding(24).frame(maxWidth: 580)
        }
        .takeScreen()
    }
    private func step(_ number: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Text(number).font(.caption.monospaced().bold()).foregroundStyle(TakeTheme.lime).padding(10).background(TakeTheme.raised, in: Circle())
            VStack(alignment: .leading, spacing: 3) { Text(title).font(.headline); Text(text).font(.subheadline).foregroundStyle(TakeTheme.muted) }
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
                        Eyebrow(text: "MAKE IT YOURS", color: TakeTheme.lime)
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
