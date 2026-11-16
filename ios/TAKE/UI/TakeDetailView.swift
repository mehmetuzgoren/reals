import SwiftUI

struct TakeDetailView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let originalID: String
    let round: DailyRound
    @State private var original: OriginalSummary?
    @State private var replies: [ReplySummary] = []
    @State private var cursor: String?
    @State private var failure: String?
    @State private var draft: PublicationDraft?
    @State private var reported = false
    @State private var deleteID: String?
    @State private var deleteKind: ContentKind = .original
    @State private var reportID: String?
    @State private var reportKind: ContentKind = .original
    @State private var blockID: String?
    @State private var cancelWatch: (() -> Void)?
    @State private var loadEpoch = UUID()
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                Text(round.question).font(.caption).foregroundStyle(TakeTheme.muted).padding(.top, 8)
                if let original {
                    ContentVideoCard(id: original.id, author: original.author, kind: .original, durationMs: original.durationMs, option: round.label(for: original.optionId))
                    controls(id: original.id, author: original.author, kind: .original)
                    HStack { Text("Video replies").font(.headline); Spacer(); Text("\(original.visibleReplyCount) visible").font(.caption).foregroundStyle(TakeTheme.muted) }
                    Text("Replies are shared only where friendships overlap.").font(.caption).foregroundStyle(TakeTheme.muted)
                    if replies.isEmpty { EmptyCard(symbol: "bubble.left.and.bubble.right", title: "Room for your perspective.", message: "No replies are visible to you yet. Keep it human. Keep it kind.") }
                    ForEach(replies) { reply in
                        VStack(alignment: .leading, spacing: 10) {
                            ContentVideoCard(id: reply.id, author: reply.author, kind: .reply, durationMs: reply.durationMs)
                            controls(id: reply.id, author: reply.author, kind: .reply)
                        }
                    }
                    if cursor != nil { Button("Load more replies") { Task { await load(more: true) } }.frame(minHeight: 44) }
                } else if let failure { EmptyCard(symbol: "lock", title: "This conversation is unavailable.", message: failure) }
                else { ProgressView("Opening conversation…").frame(maxWidth: .infinity).padding(50) }
                if reported { InlineNotice(text: "Report received. Thanks for helping keep Takes safe.") }
            }.padding(.horizontal, 22).padding(.vertical, 12).padding(.bottom, 24)
        }
        .takeScreen().navigationTitle(original?.author.displayName ?? "Take & replies").navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if let original, original.roundId == model.today?.round?.id, original.author.id != model.viewer?.id, model.today?.canViewFriends == true {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your side of the conversation.").font(.subheadline.weight(.medium))
                        Text("Reply with a video, up to 15 seconds.").font(.caption).foregroundStyle(TakeTheme.muted)
                    }
                    Spacer(minLength: 0)
                    Button { makeReply(original) } label: { Image(systemName: "video").font(.title3.weight(.semibold)).frame(width: 54, height: 54).foregroundStyle(TakeTheme.background).background(TakeTheme.white, in: Circle()) }.accessibilityLabel("Reply with video").accessibilityIdentifier("Reply with video")
                }.padding(.horizontal, 22).padding(.vertical, 12).background(TakeTheme.background)
            }
        }
        .task {
            await load()
            cancelWatch = model.service?.watchConversation(originalId: originalID) { Task { await load() } }
        }
        .onChange(of: model.today?.round?.id) { _, _ in original = nil; replies = []; Task { await load() } }
        .onChange(of: model.today?.canViewFriends) { _, canView in if canView != true { original = nil; replies = []; PlaybackCoordinator.shared.clear(); Task { await load() } } }
        .refreshable { await load() }
        .onDisappear { PlaybackCoordinator.shared.pause(); cancelWatch?(); cancelWatch = nil; loadEpoch = UUID() }
        .sheet(item: $draft, onDismiss: { Task { await load() } }) { value in ComposerView(initialDraft: value, round: round).environmentObject(model) }
        .confirmationDialog("Delete this video?", isPresented: Binding(get: { deleteID != nil }, set: { if !$0 { deleteID = nil } }), titleVisibility: .visible) {
            Button("Delete video", role: .destructive) { let id = deleteID; deleteID = nil; Task { if let id { await remove(id) } } }
        } message: { Text(deleteKind == .original ? "The conversation will be removed too. Your successful submission still counts; you can't post another original this round." : "This reply will be permanently removed.") }
        .confirmationDialog("Report this video", isPresented: Binding(get: { reportID != nil }, set: { if !$0 { reportID = nil } }), titleVisibility: .visible) {
            ForEach(["Harassment or bullying", "Hate or harmful content", "Privacy or other concern"], id: \.self) { reason in Button(reason) { let id = reportID; reportID = nil; Task { do { if let id { try await model.service?.report(contentId: id, kind: reportKind, reason: reason); reported = true } } catch { model.error = error.localizedDescription } } } }
        }
        .confirmationDialog("Block this person?", isPresented: Binding(get: { blockID != nil }, set: { if !$0 { blockID = nil } }), titleVisibility: .visible) {
            Button("Block and remove friendship", role: .destructive) { let id = blockID; blockID = nil; Task { do { if let id { try await model.service?.block(userId: id, blocked: true); await model.relationshipChanged(); dismiss() } } catch { model.error = error.localizedDescription } } }
        } message: { Text("You'll lose access to each other's takes and eligible replies. They won't be notified.") }
    }
    private func controls(id: String, author: PublicProfile, kind: ContentKind) -> some View {
        HStack {
            if kind == .reply { Text(Date(milliseconds: replies.first(where: { $0.id == id })?.publishedAt ?? 0), style: .time).font(.caption).foregroundStyle(TakeTheme.muted) }
            Spacer()
            Menu {
                if author.id == model.viewer?.id { Button("Delete video", role: .destructive) { deleteKind = kind; deleteID = id } }
                else {
                    Button("Report video") { reportKind = kind; reportID = id }
                    Button("Block \(author.displayName)", role: .destructive) { blockID = author.id }
                }
            } label: { Label("More", systemImage: "ellipsis").font(.caption).frame(minWidth: 60, minHeight: 44).foregroundStyle(TakeTheme.muted) }
        }
    }
    private func load(more: Bool = false) async {
        guard let service = model.service else { return }
        let epoch = UUID(); loadEpoch = epoch
        let session = model.generation
        let revision = model.accessRevision
        do {
            let value = try await service.detail(originalId: originalID)
            let page = try await service.replies(originalId: originalID, cursor: more ? cursor : nil)
            guard epoch == loadEpoch, model.isCurrentAccess(generation: session, revision: revision) else { return }
            original = value; replies = more ? replies + page.items : page.items; cursor = page.nextCursor; failure = nil
        } catch {
            guard epoch == loadEpoch, model.isCurrentAccess(generation: session, revision: revision) else { return }
            original = nil; replies = []; cursor = nil; PlaybackCoordinator.shared.clear()
            if more, (error as? ServiceFailure)?.code == "NOT_FOUND" { await load() }
            else { failure = error.localizedDescription }
        }
    }
    private func makeReply(_ original: OriginalSummary) {
        guard let owner = model.service?.viewerID else { return }
        PlaybackCoordinator.shared.pause()
        draft = PublicationDraft(id: UUID().uuidString, ownerId: owner, isDemo: model.isDemo, roundId: original.roundId, optionId: nil, originalId: original.id, clip: nil, uploadId: nil, state: .draft, failure: nil)
    }
    private func remove(_ id: String) async {
        do { try await model.service?.deleteContent(id: id, kind: deleteKind); PlaybackCoordinator.shared.clear(); await model.refresh(); if deleteKind == .original { dismiss() } else { await load() } }
        catch { model.error = error.localizedDescription }
    }
}
