import SwiftUI

struct RealsHomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var draft: PublicationDraft?
    @State private var publicSelected = false
    @State private var showDemo = false

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let unit = size.height / 852
            ZStack(alignment: .topLeading) {
                TakeTheme.background
                if let state = model.today, let round = state.round {
                    if state.canViewFriends { feed(round, size: size, unit: unit) }
                    else { prompt(round, size: size, unit: unit) }
                    header.frame(width: size.width).position(x: size.width / 2, y: (state.canViewFriends ? 72 : 81.5) * unit)
                } else {
                    header.frame(width: size.width).position(x: size.width / 2, y: 81.5 * unit)
                    emptyState.frame(width: size.width - 40).position(x: size.width / 2, y: size.height / 2)
                }
            }
        }
        .ignoresSafeArea()
        .takeScreen()
        .toolbar(.hidden, for: .navigationBar)
        .fullScreenCover(item: $draft, onDismiss: { Task { await model.refresh() } }) { draft in
            RealsComposerView(initialDraft: draft, round: model.today?.round).environmentObject(model)
        }
        .sheet(isPresented: $showDemo) { DemoControlsView().environmentObject(model) }
        .onChange(of: model.today?.round?.id) { _, _ in publicSelected = false }
    }

    private var header: some View {
        ZStack {
            Text("Takes").font(.system(size: 20, weight: .bold))
                .accessibilityIdentifier("Takes")
                .onLongPressGesture(minimumDuration: 0.7) { if model.isDemo { showDemo = true } }
            HStack {
                Spacer()
                NavigationLink { FriendsView() } label: {
                    Image(systemName: "person.2").font(.system(size: 17, weight: .regular)).frame(width: 44, height: 44)
                }
                .accessibilityLabel("Friends").accessibilityIdentifier("Friends")
                .padding(.trailing, 9)
            }
        }
        .frame(height: 44)
    }

    @ViewBuilder private var emptyState: some View {
        if model.today != nil {
            Text("Next prompt at 10 AM").font(.system(size: 15)).foregroundStyle(TakeTheme.muted)
        } else if !model.busy {
            Button("Couldn't load today's prompt. Try again") { Task { await model.refresh() } }
                .font(.system(size: 15)).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center)
        }
    }

    private func prompt(_ round: DailyRound, size: CGSize, unit: CGFloat) -> some View {
        let lines = Self.promptLines(round.question)
        let rows = CGFloat((round.options.count + 1) / 2)
        return ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 8.8 * unit) {
                Text("Today's prompt").font(.system(size: 15)).foregroundStyle(TakeTheme.muted)
                VStack(alignment: .leading, spacing: -6.4) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.system(size: 40, weight: .bold)).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(round.question)
                .accessibilityAddTraits([.isStaticText, .isHeader])
            }
            .frame(width: size.width - 40, alignment: .leading)
            .offset(x: 20, y: 357.4 * unit)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(Array(round.options.enumerated()), id: \.element.id) { index, option in
                    Button { record(round: round, optionID: option.id) } label: {
                        Text(option.label).font(.system(size: 17, weight: .bold)).frame(maxWidth: .infinity, minHeight: 56)
                            .foregroundStyle(index == 0 ? Color.black : Color.white)
                            .background(index == 0 ? Color.white : Color.black, in: Capsule())
                            .overlay(Capsule().stroke(Color.white, lineWidth: 1))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("Position \(option.label)")
                }
            }
            .frame(width: size.width - 40)
            .position(x: size.width / 2, y: (752.5 - (rows - 1) * 34) * unit)
            Text("Post your take to see your friends'.").font(.system(size: 14)).foregroundStyle(TakeTheme.muted)
                .frame(width: size.width - 40).position(x: size.width / 2, y: 809.9 * unit)
        }
    }

    static func promptLines(_ question: String) -> [String] {
        let words = question.split(separator: " ").map(String.init)
        guard question.count <= 26, words.count > 1 else { return [question] }
        var best = [question]
        var bestDifference = Int.max
        for index in 1..<words.count {
            let first = words[..<index].joined(separator: " ")
            let second = words[index...].joined(separator: " ")
            let difference = abs(first.count - second.count)
            if difference < bestDifference { best = [first, second]; bestDifference = difference }
        }
        return best
    }

    private func feed(_ round: DailyRound, size: CGSize, unit: CGFloat) -> some View {
        let originals = (publicSelected ? model.publicFeed : model.feed).filter { $0.author.id != model.viewer?.id }
        let listTop = 158 * unit
        return ZStack(alignment: .topLeading) {
            HStack(spacing: 30.5) {
                feedTab("My friends", selected: !publicSelected) { publicSelected = false }
                feedTab("For You", selected: publicSelected) { publicSelected = true }
            }
            .position(x: size.width / 2, y: 132.3 * unit)
            ScrollView {
                LazyVStack(spacing: 28.6) {
                    if originals.isEmpty {
                        Text(publicSelected ? "No public takes yet" : "No friends have posted yet")
                            .font(.system(size: 15)).foregroundStyle(TakeTheme.muted).padding(.top, 24)
                    }
                    ForEach(originals) { original in
                        RealsFeedCard(original: original, round: round, publicName: publicSelected)
                            .onAppear { if original.id == originals.last?.id { loadMore() } }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 169.8 * unit - listTop)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refresh() }
            .frame(width: size.width, height: size.height - listTop)
            .offset(y: listTop)
            .simultaneousGesture(DragGesture(minimumDistance: 40).onEnded { gesture in
                if abs(gesture.translation.width) > abs(gesture.translation.height) * 1.5, abs(gesture.translation.width) > 60 {
                    publicSelected = gesture.translation.width < 0
                }
            })
        }
    }

    private func loadMore() {
        Task {
            if publicSelected, model.publicFeedCursor != nil { await model.refreshPublicFeed(more: true) }
            else if !publicSelected, model.feedCursor != nil { await model.refreshFeed(more: true) }
        }
    }

    private func feedTab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 17, weight: .semibold))
                .foregroundStyle(selected ? Color.white : TakeTheme.muted)
                .padding(.bottom, 12.9)
                .overlay(alignment: .bottom) { Rectangle().fill(selected ? Color.white : Color.clear).frame(height: 2) }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func record(round: DailyRound, optionID: String) {
        guard let owner = model.service?.viewerID else { return }
        PlaybackCoordinator.shared.clear()
        if let saved = model.recoveredDraft, saved.roundId == round.id, saved.kind == .original, saved.optionId == optionID, saved.ownerId == owner {
            draft = saved
        } else {
            draft = PublicationDraft(id: UUID().uuidString, ownerId: owner, isDemo: model.isDemo, roundId: round.id, optionId: optionID, originalId: nil, clip: nil, uploadId: nil, state: .draft, failure: nil)
        }
    }
}

private struct RealsFeedCard: View {
    @EnvironmentObject private var model: AppModel
    let original: OriginalSummary
    let round: DailyRound
    let publicName: Bool
    @State private var comments = false
    @State private var liking = false
    @State private var thumbnail: UIImage?
    private var name: String { publicName ? original.author.username : original.author.displayName }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                RealsAvatar(profile: original.author, size: 32)
                Text(name).font(.system(size: 16, weight: .bold)).lineLimit(1)
                Spacer(minLength: 8)
                Text(round.label(for: original.optionId)).font(.system(size: 15)).foregroundStyle(TakeTheme.muted).lineLimit(1)
            }
            .frame(height: 32)
            NavigationLink { RealsTakeView(originalID: original.id, round: round) } label: {
                ZStack {
                    TakeTheme.surface
                    if let thumbnail { Image(uiImage: thumbnail).resizable().scaledToFill() }
                    RealsPlayTriangle()
                }
                .aspectRatio(0.9212, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .contentShape(RoundedRectangle(cornerRadius: 24))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open take \(name)")
            .accessibilityIdentifier("Open take \(name)")
            .padding(.top, 9.5)
            HStack(spacing: 27) {
                Button { Task { await toggleLike() } } label: {
                    count(symbol: original.viewerLiked ? "heart.fill" : "heart", value: original.likeCount)
                }
                .disabled(liking)
                .accessibilityLabel("Like \(name)'s take")
                .accessibilityValue("\(original.likeCount), \(original.viewerLiked ? "liked" : "not liked")")
                Button { comments = true } label: { count(symbol: "bubble.left", value: original.visibleCommentCount) }
                    .accessibilityLabel("Comments on \(name)'s take")
                NavigationLink { RealsTakeView(originalID: original.id, round: round, initialReply: true) } label: {
                    count(symbol: "video", value: original.visibleReplyCount)
                }
                .accessibilityLabel("Replies to \(name)'s take")
                Spacer(minLength: 0)
            }
            .buttonStyle(.plain)
            .frame(height: 28)
            .padding(.top, 19.8)
        }
        .sheet(isPresented: $comments, onDismiss: { Task { await model.refreshFeed(); await model.refreshPublicFeed() } }) {
            RealsCommentsView(contentID: original.id, kind: .original).environmentObject(model)
        }
        .task(id: original.id) { await loadThumbnail() }
    }

    private func count(symbol: String, value: Int) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 18, weight: .regular))
            Text("\(value)").font(.system(size: 16, weight: .semibold))
        }
        .frame(minHeight: 28)
        .contentShape(Rectangle())
    }

    private func toggleLike() async {
        guard let service = model.service, !liking else { return }
        liking = true
        defer { liking = false }
        let epoch = model.generation
        let revision = model.accessRevision
        do {
            let result = try await service.toggleLike(contentId: original.id, kind: .original)
            guard model.isCurrentAccess(generation: epoch, revision: revision), model.service === service else { return }
            if let index = model.feed.firstIndex(where: { $0.id == original.id }) { model.feed[index].viewerLiked = result.liked; model.feed[index].likeCount = result.likeCount }
            if let index = model.publicFeed.firstIndex(where: { $0.id == original.id }) { model.publicFeed[index].viewerLiked = result.liked; model.publicFeed[index].likeCount = result.likeCount }
        } catch {
            if model.isCurrentAccess(generation: epoch, revision: revision) { model.error = error.localizedDescription }
        }
    }

    private func loadThumbnail() async {
        guard !model.isDemo, let service = model.service else { return }
        let epoch = model.generation
        let revision = model.accessRevision
        do {
            let grant = try await service.playback(contentId: original.id, kind: .original, asset: "thumbnail")
            guard model.isCurrentAccess(generation: epoch, revision: revision), grant.expiresAt > service.serverNow, let url = URL(string: grant.url), url.scheme == "https" else { return }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let (data, response) = try await session.data(from: url)
            guard !Task.isCancelled, model.isCurrentAccess(generation: epoch, revision: revision), grant.expiresAt > service.serverNow,
                  (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 5_242_880 else { return }
            thumbnail = UIImage(data: data)
            try await Task.sleep(for: .seconds(max(0, (grant.expiresAt - service.serverNow) / 1_000)))
            thumbnail = nil
        } catch {}
    }
}
