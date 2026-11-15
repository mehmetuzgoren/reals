import SwiftUI

struct FriendsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var search = ""
    @State private var results: [SearchResult] = []
    @State private var searching = false
    @State private var working = false
    @State private var removeTarget: PublicProfile?
    @State private var blockTarget: PublicProfile?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Your circle.").font(.title2.bold()).tracking(-0.5)
                    Text("Find friends by username. No contacts upload, no public discovery.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                }
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(TakeTheme.muted)
                    TextField("Search a username", text: $search).textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search).accessibilityIdentifier("Search a username")
                    if searching { ProgressView().tint(TakeTheme.white) }
                    if !search.isEmpty { Button { search = ""; results = [] } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(TakeTheme.muted).frame(width: 44, height: 44) }.accessibilityLabel("Clear search") }
                }.padding(.leading, 16).padding(.vertical, 6).background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 18))
                if !search.isEmpty {
                    Eyebrow(text: "SEARCH RESULTS")
                    if results.isEmpty, !searching { Text("No matching usernames. Try another prefix.").foregroundStyle(TakeTheme.muted).font(.subheadline) }
                    ForEach(results) { result in searchRow(result) }
                } else if let state = model.friends {
                    if !state.incoming.isEmpty {
                        sectionHeader("WAITING ON YOU", count: state.incoming.count)
                        ForEach(state.incoming) { request in
                            VStack(spacing: 12) {
                                person(request.profile)
                                HStack(spacing: 10) {
                                    PrimaryButton(title: "Accept", disabled: working) { action { try await $0.respond(requestId: request.id, accept: true) } }
                                    Button("Decline") { action { try await $0.respond(requestId: request.id, accept: false) } }.font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 54).foregroundStyle(TakeTheme.muted).disabled(working)
                                }
                            }.takeCard()
                        }
                    }
                    sectionHeader("APPROVED FRIENDS", count: state.approved.count)
                    if state.approved.isEmpty { EmptyCard(symbol: "person.2", title: "A small circle starts with one.", message: "Search a friend's username above. Only accepted requests open the door to each other's takes.") }
                    ForEach(state.approved) { profile in
                        HStack {
                            person(profile)
                            Menu {
                                Button("Remove friend", role: .destructive) { removeTarget = profile }
                                Button("Block", role: .destructive) { blockTarget = profile }
                            } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).foregroundStyle(TakeTheme.muted) }.accessibilityLabel("Manage friendship with \(profile.displayName)")
                        }.takeCard()
                    }
                    if !state.outgoing.isEmpty {
                        sectionHeader("REQUESTS SENT", count: state.outgoing.count)
                        ForEach(state.outgoing) { request in
                            VStack(alignment: .leading, spacing: 10) {
                                person(request.profile)
                                Text("Pending requests don't share takes.").font(.caption).foregroundStyle(TakeTheme.muted)
                                Button("Cancel request") { action { try await $0.cancelRequest(requestId: request.id) } }.font(.subheadline.bold()).foregroundStyle(TakeTheme.white).frame(minHeight: 44).disabled(working)
                            }.takeCard()
                        }
                    }
                    if !state.blocked.isEmpty {
                        sectionHeader("BLOCKED", count: state.blocked.count)
                        ForEach(state.blocked) { profile in HStack { person(profile); Button("Unblock") { action { try await $0.block(userId: profile.id, blocked: false) } }.font(.caption.bold()).frame(minHeight: 44).disabled(working) }.takeCard() }
                        Text("Unblocking doesn't restore a friendship. Send a new request if you both want to reconnect.").font(.caption).foregroundStyle(TakeTheme.muted)
                    }
                } else { ProgressView().frame(maxWidth: .infinity).padding(40) }
            }.padding(24).padding(.bottom, 24)
        }
        .navigationTitle("Friends").navigationBarTitleDisplayMode(.inline).takeScreen()
        .refreshable { await model.refresh() }
        .task(id: search) { await runSearch() }
        .confirmationDialog("Remove \(removeTarget?.displayName ?? "friend")?", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
            Button("Remove friend", role: .destructive) { if let target = removeTarget { action { try await $0.removeFriend(userId: target.id) } }; removeTarget = nil }
        } message: { Text("New access to each other's takes and replies is revoked immediately.") }
        .confirmationDialog("Block \(blockTarget?.displayName ?? "person")?", isPresented: Binding(get: { blockTarget != nil }, set: { if !$0 { blockTarget = nil } }), titleVisibility: .visible) {
            Button("Block and remove friendship", role: .destructive) { if let target = blockTarget { action { try await $0.block(userId: target.id, blocked: true) } }; blockTarget = nil }
        } message: { Text("This also removes pending requests. They won't be notified.") }
    }
    private func sectionHeader(_ title: String, count: Int) -> some View { HStack { Eyebrow(text: title); Spacer(); Text("\(count)").font(.caption.monospaced()).foregroundStyle(TakeTheme.muted) } }
    private func person(_ profile: PublicProfile) -> some View {
        HStack(spacing: 12) { AvatarView(profile: profile); VStack(alignment: .leading, spacing: 4) { Text(profile.displayName).font(.headline); Text("@\(profile.username)").font(.caption).foregroundStyle(TakeTheme.muted) }; Spacer(minLength: 0) }
    }
    private func searchRow(_ result: SearchResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            person(result.profile)
            switch result.relationship {
            case "approved": Label("Already friends", systemImage: "checkmark.circle.fill").foregroundStyle(TakeTheme.white).font(.subheadline)
            case "incoming":
                if let id = result.requestId { Button("Accept request") { action { try await $0.respond(requestId: id, accept: true) } }.frame(minHeight: 44).disabled(working) }
            case "outgoing":
                if let id = result.requestId { Button("Cancel request") { action { try await $0.cancelRequest(requestId: id) } }.frame(minHeight: 44).disabled(working) }
            case "blocked", "self": EmptyView()
            default: Button { action { try await $0.requestFriend(userId: result.profile.id) } } label: { Label("Send friend request", systemImage: "person.badge.plus").font(.subheadline.bold()).frame(minHeight: 44) }.disabled(working)
            }
        }.takeCard()
    }
    private func runSearch() async {
        guard !search.isEmpty, let service = model.service else { results = []; return }
        let query = search
        searching = true
        do {
            try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation()
            let values = try await service.search(username: query)
            guard query == search else { return }
            results = values; searching = false
        } catch is CancellationError {} catch { searching = false; model.error = error.localizedDescription }
    }
    private func action(_ work: @escaping (any TakeService) async throws -> Void) {
        guard let service = model.service else { return }
        working = true
        Task {
            do { try await work(service); TakeTheme.haptic(); await model.relationshipChanged() }
            catch { model.error = error.localizedDescription }
            working = false
        }
    }
}
