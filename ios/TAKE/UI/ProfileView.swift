import AuthenticationServices
import PhotosUI
import SwiftUI
import UIKit
import UserNotifications

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    @State private var editing = false
    @State private var showDemo = false
    @State private var showNotifications = false
    @State private var showSignOut = false
    @State private var showDeletion = false
    @State private var deleting = false
    @State private var showDeveloperReauthentication = false
    @State private var showReauthentication = false
    @ObservedObject private var notifications = NotificationCoordinator.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let state = model.profile {
                    VStack(spacing: 14) {
                        AvatarView(profile: state.profile, size: 96)
                        VStack(spacing: 5) { Text(state.profile.displayName).font(.largeTitle.bold()); Text("@\(state.profile.username)").font(.subheadline).foregroundStyle(TakeTheme.muted) }
                        Button("Edit profile") { editing = true }.font(.subheadline.bold()).padding(.horizontal, 24).frame(minHeight: 44).background(TakeTheme.raised, in: Capsule())
                    }.frame(maxWidth: .infinity).padding(.vertical, 12)
                    VStack(alignment: .leading, spacing: 20) {
                        HStack { Image(systemName: "bell.badge").foregroundStyle(TakeTheme.white); Text("A nudge, not a noise.").font(.headline) }
                        Text("A daily question and eligible direct video replies. Never hidden opinions or previews in a notification.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                        Toggle("Daily question", isOn: preferenceBinding(daily: true)).tint(TakeTheme.white)
                        Toggle("Direct video replies", isOn: preferenceBinding(daily: false)).tint(TakeTheme.white)
                        if !model.isDemo {
                            Text(notificationSummary).font(.caption).foregroundStyle(TakeTheme.muted)
                            if let error = notifications.errorMessage { InlineNotice(text: error) }
                        }
                        Button(!model.isDemo && notifications.authorizationStatus != .notDetermined ? "Open notification settings" : "Enable notifications on this device") {
                            if !model.isDemo, notifications.authorizationStatus != .notDetermined, let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                            else { showNotifications = true }
                        }.font(.subheadline.bold()).frame(minHeight: 44)
                    }.takeCard()
                    HStack { Eyebrow(text: "YOUR PAST PERSPECTIVES"); Spacer(); Text("\(state.originals.items.count)").font(.caption.monospaced()).foregroundStyle(TakeTheme.muted) }
                    if state.originals.items.isEmpty { EmptyCard(symbol: "rectangle.stack", title: "Your perspective has a home.", message: "Your own published takes stay here. Friends' past rounds aren't browseable.") }
                    ForEach(state.originals.items) { original in
                        NavigationLink { OwnHistoryView(original: original) } label: {
                            HStack(spacing: 16) {
                                Image(systemName: "play.rectangle.fill").font(.title).foregroundStyle(TakeTheme.white).frame(width: 60, height: 68).background(TakeTheme.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(historyTitle(original)).font(.headline).multilineTextAlignment(.leading)
                                    Text(Date(milliseconds: original.publishedAt), style: .date).font(.caption).foregroundStyle(TakeTheme.muted)
                                }
                                Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(TakeTheme.muted)
                            }.takeCard()
                        }.buttonStyle(.plain)
                    }
                    if let cursor = state.originals.nextCursor { Button("Load more of your takes") { Task { await loadMore(cursor) } }.frame(maxWidth: .infinity, minHeight: 44) }
                    VStack(spacing: 6) {
                        row("Sign out", symbol: "rectangle.portrait.and.arrow.right") { showSignOut = true }
                        row(deleting ? "Deleting account…" : "Delete account", symbol: "trash", color: TakeTheme.white) { showDeletion = true }
                    }.padding(8).background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 24))
                    Text("Takes").font(.caption).foregroundStyle(TakeTheme.muted).frame(maxWidth: .infinity).padding(.bottom, 20)
                } else { ProgressView().frame(maxWidth: .infinity).padding(40) }
            }.padding(24)
        }
        .navigationTitle("Profile").navigationBarTitleDisplayMode(.inline).takeScreen()
        .toolbar(.visible, for: .navigationBar)
        .refreshable { await model.refresh() }
        .sheet(isPresented: $editing) { EditProfileView().environmentObject(model) }
        .sheet(isPresented: $showDemo) { DemoControlsView().environmentObject(model) }
        .sheet(isPresented: $showDeveloperReauthentication, onDismiss: {
            Task { if !model.isDemo, model.viewer != nil { await model.refresh(); model.watch() } }
        }) {
            DeveloperSignInView(reauthenticate: true, onAuthenticated: { await deleteAccount(reauthenticated: true) }).environmentObject(model)
        }
        .alert("Sign in again to confirm", isPresented: $showReauthentication) {
            Button("Cancel", role: .cancel) {}
            Button("Sign in again") { Task { await deleteAccount() } }
        } message: { Text("Your account hasn't been deleted. Complete a fresh sign-in to this same account, then confirm deletion again.") }
        .alert("Just the things worth opening.", isPresented: $showNotifications) {
            Button("Not now", role: .cancel) {}
            Button("Enable notifications") { Task { if model.isDemo { model.error = "Demo Mode stays offline and doesn't register push tokens. Your preferences are saved only in this demo." } else { await NotificationCoordinator.shared.requestPermission() } } }
        } message: { Text("We'll ask iOS to allow the daily prompt and eligible direct replies. You can say no and still post whenever the question is open.") }
        .confirmationDialog("Sign out of Takes?", isPresented: $showSignOut, titleVisibility: .visible) { Button("Sign out", role: .destructive) { Task { await model.signOut() } } } message: { Text("Private playback and subscriptions will be cleared. Your local retry draft will be removed from this device.") }
        .confirmationDialog("Delete your account and videos?", isPresented: $showDeletion, titleVisibility: .visible) { Button("Delete account permanently", role: .destructive) { Task { await deleteAccount() } } } message: { Text(model.isDemo ? "This removes this fictional identity's content and relationships in the offline demo. You can restore all sample data with Reset Demo." : "Your videos and social relationships will be removed. This can't be undone. A recent Apple sign-in may be required.") }
    }
    private var notificationSummary: String {
        switch notifications.authorizationStatus {
        case .notDetermined: return "Choose whether iOS may notify you. Posting never requires notification permission."
        case .denied: return "Notifications are off in iOS. You can still post and reply."
        default: return notifications.isRegistered ? "This device is registered for your selected notifications." : "iOS permission is on. Device delivery registration is still pending."
        }
    }
    private func preferenceBinding(daily: Bool) -> Binding<Bool> {
        Binding(get: { daily ? model.profile?.preferences.dailyQuestion ?? false : model.profile?.preferences.directReply ?? false }, set: { value in
            guard var preferences = model.profile?.preferences else { return }
            let prior = preferences
            if daily { preferences.dailyQuestion = value } else { preferences.directReply = value }
            model.profile?.preferences = preferences
            Task { do { try await model.service?.setNotifications(preferences) } catch { model.profile?.preferences = prior; model.error = error.localizedDescription } }
        })
    }
    private func historyTitle(_ original: OriginalSummary) -> String {
        if original.roundId == DemoService.round(1).id { return DemoService.round(1).question }
        if original.roundId == DemoService.round(2).id { return DemoService.round(2).question }
        return original.roundId == model.today?.round?.id ? model.today?.round?.question ?? "Your take" : "Your past take"
    }
    private func row(_ title: String, symbol: String, color: Color = TakeTheme.white, action: @escaping () -> Void) -> some View { Button(action: action) { HStack(spacing: 14) { Image(systemName: symbol).frame(width: 24); Text(title).font(.subheadline.bold()); Spacer(); Image(systemName: "chevron.right").font(.caption) }.foregroundStyle(color).padding(14).frame(minHeight: 48) }.disabled(deleting) }
    private func loadMore(_ cursor: String) async {
        do { if let next = try await model.service?.profile(cursor: cursor) { model.profile = ProfileState(profile: next.profile, preferences: next.preferences, originals: Page(items: (model.profile?.originals.items ?? []) + next.originals.items, nextCursor: next.originals.nextCursor)) } }
        catch { model.error = error.localizedDescription }
    }
    private func deleteAccount(reauthenticated: Bool = false) async {
        guard let service = model.service else { return }
        if !service.isDemo, !reauthenticated, let authentication = service as? any LiveAuthenticationService, authentication.isDevelopmentSession {
            showDeveloperReauthentication = true
            return
        }
        deleting = true
        defer { deleting = false }
        do {
            if !service.isDemo, !reauthenticated {
                guard let authentication = service as? any LiveAuthenticationService else { throw ServiceFailure.notConfigured }
                try await authentication.reauthenticateWithApple()
            }
            guard model.service === service else { throw CancellationError() }
            try await service.requestDeletion()
            await model.signOut()
        }
        catch {
            if (error as? ServiceFailure)?.code == "REAUTH_REQUIRED" { showReauthentication = true }
            else if !(error is CancellationError), (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin { model.error = (error as? ServiceFailure)?.message ?? "Couldn't confirm deletion. Your account hasn't been deleted. Please try again." }
            if model.service === service, model.viewer != nil { await model.refresh(); model.watch() }
        }
    }
}

struct EditProfileView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var avatar: Data?
    @State private var saving = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Your name") { TextField("Display name", text: $name).textContentType(.name); Text("Your username is @\(model.viewer?.username ?? "").").font(.caption).foregroundStyle(TakeTheme.muted) }
                Section("Your face") {
                    if let avatar, let image = UIImage(data: avatar) { Image(uiImage: image).resizable().scaledToFill().frame(width: 90, height: 90).clipShape(Circle()).accessibilityLabel("Selected profile photo") }
                    PhotosPicker(selection: $selectedPhoto, matching: .images) { Label("Choose a profile photo", systemImage: "photo") }.frame(minHeight: 44)
                    Text("Your avatar is visible in friend search. Use an image you're happy to share.").font(.caption).foregroundStyle(TakeTheme.muted)
                }
                Section { PrimaryButton(title: saving ? "Saving…" : "Save profile", disabled: saving || name.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await save() } }.listRowBackground(Color.clear) }
            }.scrollContentBackground(.hidden).takeScreen().navigationTitle("Edit profile").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) } }
        }
        .onAppear { name = model.viewer?.displayName ?? "" }
        .task(id: selectedPhoto) {
            guard let selectedPhoto else { return }
            do {
                if let data = try await selectedPhoto.loadTransferable(type: Data.self), data.count <= 25_165_824, let image = UIImage(data: data) {
                    let ratio = min(1, 1_024 / max(image.size.width, image.size.height))
                    let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
                    avatar = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82)
                } else { model.error = "Choose a supported image smaller than 24 MiB." }
            } catch { model.error = "Couldn't load that photo. Try another image." }
        }
    }
    private func save() async {
        saving = true
        do { model.viewer = try await model.service?.updateProfile(displayName: name, avatar: avatar); await model.relationshipChanged(); dismiss() }
        catch { model.error = error.localizedDescription }
        saving = false
    }
}

struct OwnHistoryView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let original: OriginalSummary
    @State private var authorized: OriginalSummary?
    @State private var failure: String?
    @State private var showDelete = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Eyebrow(text: "YOUR PERSPECTIVE", color: TakeTheme.white)
                if let value = authorized { ContentVideoCard(id: value.id, author: value.author, kind: .original, durationMs: value.durationMs) }
                else if let failure { InlineNotice(text: failure) }
                else { ProgressView() }
                Text("Your own take is preserved here. Friends' past rounds aren't a browseable archive.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                Button("Delete this take", role: .destructive) { showDelete = true }.frame(minHeight: 44)
            }.padding(24)
        }.takeScreen().navigationTitle("Your take").navigationBarTitleDisplayMode(.inline)
        .task { do { authorized = try await model.service?.detail(originalId: original.id) } catch { failure = error.localizedDescription } }
        .onDisappear { PlaybackCoordinator.shared.pause() }
        .confirmationDialog("Delete this take?", isPresented: $showDelete, titleVisibility: .visible) { Button("Delete take and conversation", role: .destructive) { Task { do { try await model.service?.deleteContent(id: original.id, kind: .original); PlaybackCoordinator.shared.clear(); await model.refresh(); dismiss() } catch { model.error = error.localizedDescription } } } } message: { Text("Your successful submission still counts. Deleting doesn't let you publish another original for this round.") }
    }
}
