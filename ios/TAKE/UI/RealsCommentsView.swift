import SwiftUI

struct RealsCommentsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let contentID: String
    let kind: ContentKind
    var conversationID: String? = nil
    @State private var comments: [CommentSummary] = []
    @State private var cancelWatch: (() -> Void)?
    @State private var cursor: String?
    @State private var text = ""
    @State private var loading = false
    @State private var sending = false
    @State private var failure: String?
    @State private var reportedComment: CommentSummary?
    @State private var scrollTarget: String?
    @State private var visible = false
    @State private var roundID: String?
    @State private var viewEpoch = UUID()
    @State private var loadEpoch = UUID()
    @FocusState private var composing: Bool

    private var authorizationID: String { "\(model.generation)-\(model.accessRevision)-\(contentID)-\(kind.rawValue)" }
    private var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(comments) { comment in
                        HStack(alignment: .top, spacing: 12) {
                            RealsAvatar(profile: comment.author, size: 36)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(comment.author.displayName).font(.system(size: 14, weight: .bold))
                                Text(comment.text).font(.system(size: 14)).fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .contextMenu {
                            if comment.viewerCanDelete {
                                Button("Delete comment", role: .destructive) { Task { await delete(comment) } }
                            } else {
                                Button("Report comment") { reportedComment = comment }
                            }
                        }
                        .id(comment.id)
                        .task(id: cursor) {
                            if comment.id == comments.last?.id, cursor != nil { _ = await load(more: true) }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 20)
            }
            .refreshable { _ = await load() }
            .onChange(of: scrollTarget) { _, id in
                if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
            }
        }
        .background(TakeTheme.surface)
        .foregroundStyle(TakeTheme.white)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(TakeTheme.surface)
        .task(id: authorizationID) {
            visible = true
            viewEpoch = UUID()
            roundID = model.today?.round?.id
            cancelWatch?(); cancelWatch = nil
            _ = await load()
            guard visible, !Task.isCancelled, let access = RealsContentAccess(model: model, roundID: roundID) else { return }
            let screen = viewEpoch
            cancelWatch = access.service.watchConversation(originalId: conversationID ?? contentID) {
                guard visible, screen == viewEpoch, access.isCurrent(model) else { return }
                Task { _ = await load(minimumCount: comments.count) }
            }
        }
        .onChange(of: text) { _, value in if value.count > 300 { text = String(value.prefix(300)) } }
        .onChange(of: model.generation) { _, _ in invalidate(); dismiss() }
        .onChange(of: model.accessRevision) { _, _ in invalidate(); dismiss() }
        .onChange(of: model.today?.round?.id) { _, id in if id != roundID { invalidate(); dismiss() } }
        .onDisappear { invalidate() }
        .confirmationDialog("Report comment", isPresented: Binding(get: { reportedComment != nil }, set: { if !$0 { reportedComment = nil } }), titleVisibility: .visible) {
            ForEach(["Harassment or bullying", "Hate or harmful content", "Privacy or other concern"], id: \.self) { reason in
                Button(reason) {
                    let comment = reportedComment
                    reportedComment = nil
                    Task { if let comment { await report(comment, reason: reason) } }
                }
            }
        }
        .alert("Reals", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) { failure = nil }
        } message: { Text(failure ?? "") }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Add a comment", text: $text, axis: .vertical)
                .font(.system(size: 14))
                .lineLimit(1...4)
                .focused($composing)
                .submitLabel(.send)
                .onSubmit { Task { await send() } }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(Color(white: 0.11), in: RoundedRectangle(cornerRadius: 24))
                .accessibilityIdentifier("Add a comment")
            Button { Task { await send() } } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(TakeTheme.background)
                    .frame(width: 44, height: 44)
                    .background(TakeTheme.white, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(trimmedText.isEmpty || sending)
            .accessibilityLabel("Send comment")
            .accessibilityIdentifier("Send comment")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(TakeTheme.surface)
    }

    @discardableResult
    private func load(more: Bool = false, revealID: String? = nil, minimumCount: Int = 0) async -> Bool {
        guard visible, kind != .comment, let access = RealsContentAccess(model: model, roundID: roundID) else { return false }
        if more, loading || cursor == nil { return false }
        let epoch = UUID(); loadEpoch = epoch
        let screen = viewEpoch
        var next = more ? cursor : nil
        var values = more ? comments : []
        loading = true
        do {
            repeat {
                let requestedCursor = next
                let page = try await access.service.comments(contentId: contentID, kind: kind, cursor: requestedCursor)
                guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return false }
                values += page.items.filter { item in !values.contains { $0.id == item.id } }
                next = page.nextCursor == requestedCursor ? nil : page.nextCursor
                let revealed = revealID.map { id in values.contains { $0.id == id } } ?? true
                if revealed, values.count >= minimumCount { break }
            } while next != nil
            comments = values
            cursor = next
            loading = false
            if let revealID { scrollTarget = revealID }
            return true
        } catch {
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return false }
            loading = false
            if (error as? ServiceFailure)?.code == "NOT_FOUND" { comments = []; cursor = nil }
            failure = error.localizedDescription
            return false
        }
    }

    private func send() async {
        guard visible, !sending, !trimmedText.isEmpty, kind != .comment, let access = RealsContentAccess(model: model, roundID: roundID) else { return }
        let screen = viewEpoch
        let submittedText = trimmedText
        sending = true
        do {
            let result = try await access.service.createComment(contentId: contentID, kind: kind, text: submittedText)
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            text = ""
            composing = false
            _ = await load(revealID: result.commentId)
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            sending = false
        } catch {
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            sending = false
            failure = error.localizedDescription
        }
    }

    private func delete(_ comment: CommentSummary) async {
        guard visible, comment.viewerCanDelete, let access = RealsContentAccess(model: model, roundID: roundID) else { return }
        let screen = viewEpoch
        do {
            try await access.service.deleteComment(commentId: comment.commentId)
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            comments.removeAll { $0.id == comment.id }
            _ = await load()
        } catch {
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            failure = error.localizedDescription
        }
    }

    private func report(_ comment: CommentSummary, reason: String) async {
        guard visible, !comment.viewerCanDelete, let access = RealsContentAccess(model: model, roundID: roundID) else { return }
        let screen = viewEpoch
        do {
            try await access.service.report(contentId: comment.commentId, kind: .comment, reason: reason)
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
        } catch {
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            failure = error.localizedDescription
        }
    }

    private func invalidate() {
        cancelWatch?(); cancelWatch = nil
        visible = false
        viewEpoch = UUID(); loadEpoch = UUID()
        comments = []; cursor = nil; text = ""; reportedComment = nil; scrollTarget = nil
        loading = false; sending = false; failure = nil
    }
}
