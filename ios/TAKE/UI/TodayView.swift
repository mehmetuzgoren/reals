import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var optionID: String?
    @State private var draft: PublicationDraft?
    @State private var showDemo = false
    @State private var scrollID: String?

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    header
                    if let state = model.today, let round = state.round {
                        if state.canViewFriends { unlocked(state, round: round) }
                        else { locked(state, round: round, availableHeight: geometry.size.height) }
                    } else if model.today != nil {
                        EmptyCard(symbol: "sun.horizon", title: "A little room for anticipation.", message: "The next question hasn't dropped yet. We'll let you know when it does. You can still find your friends.")
                    } else {
                        EmptyCard(symbol: "arrow.triangle.2.circlepath", title: "Finding today's question", message: "Pull to refresh. A connection is needed in live mode; Demo Mode works completely offline.")
                        Button("Try again") { Task { await model.refresh() } }.frame(maxWidth: .infinity, minHeight: 44)
                    }
                    if let saved = model.recoveredDraft, saved.roundId == model.today?.round?.id {
                        Button { draft = saved } label: { Label("Resume your saved \(saved.kind == .reply ? "reply" : "take")", systemImage: "arrow.clockwise").font(.headline).frame(maxWidth: .infinity, minHeight: 52) }.buttonStyle(.bordered).tint(TakeTheme.white)
                    }
                }
                .scrollTargetLayout().padding(.horizontal, 22).padding(.top, 8).padding(.bottom, 24)
            }
            .scrollPosition(id: $scrollID, anchor: .top)
            .refreshable { await model.refresh() }
        }
        .navigationBarHidden(true)
        .takeScreen()
        .sheet(item: $draft, onDismiss: { Task { await model.refresh() } }) { draft in ComposerView(initialDraft: draft, round: model.today?.round).environmentObject(model) }
        .sheet(isPresented: $showDemo) { DemoControlsView().environmentObject(model) }
        .overlay(alignment: .top) {
            if model.reveal {
                Label("You're in. Meet the other sides.", systemImage: "lock.open.fill").font(.headline).foregroundStyle(TakeTheme.background).padding(18).background(TakeTheme.white, in: Capsule()).padding(.top, 18).padding(.horizontal).allowsHitTesting(false).transition(reduceMotion ? .opacity : .move(edge: .top)).onAppear { Task { try? await Task.sleep(for: .seconds(3)); withAnimation(reduceMotion ? nil : .easeOut) { model.reveal = false } } }
            }
        }
        .onChange(of: model.today?.round?.id) { _, _ in optionID = nil; scrollID = nil }
    }

    private var header: some View {
        ZStack {
            Text("TAKE").font(.system(size: 22, weight: .bold)).tracking(-0.6)
            HStack {
                if model.isDemo {
                    Button { showDemo = true } label: { Text("Demo").font(.caption.weight(.medium)).foregroundStyle(TakeTheme.muted).frame(minWidth: 44, minHeight: 44) }.accessibilityIdentifier("Demo controls")
                }
                Spacer()
                Button { model.selectedTab = 1 } label: { Image(systemName: "person.2").font(.system(size: 19)).frame(width: 44, height: 44) }.accessibilityLabel("Open friends")
            }
        }
        .frame(minHeight: 44)
    }

    private func locked(_ state: TodayState, round: DailyRound, availableHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: max(100, availableHeight * 0.25))
            VStack(alignment: .leading, spacing: 12) {
                Text("Today's prompt").font(.subheadline.weight(.medium)).foregroundStyle(TakeTheme.muted)
                Text(round.question).font(.system(.largeTitle, weight: .bold)).tracking(-1.1).fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 60)
            VStack(spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { options(round) }
                    VStack(spacing: 9) { options(round) }
                }
                PrimaryButton(title: "Give your take", symbol: "video", disabled: optionID == nil) { createDraft(round) }
                Text("Post your take to see your friends'.").font(.caption).foregroundStyle(TakeTheme.muted)
                if !state.friendPresence.isEmpty { Text("\(state.friendPresence.filter(\.hasPublished).count) friends have posted · 15 seconds max").font(.caption2).foregroundStyle(TakeTheme.muted) }
            }
            .frame(maxWidth: .infinity)
        }
        .frame(minHeight: max(540, availableHeight - 100))
    }

    @ViewBuilder private func options(_ round: DailyRound) -> some View {
        ForEach(round.options) { option in
            Button { optionID = option.id; TakeTheme.haptic() } label: {
                Text(option.label).font(.subheadline.bold()).fixedSize(horizontal: true, vertical: false).padding(.horizontal, 18).frame(maxWidth: .infinity, minHeight: 52).foregroundStyle(optionID == option.id ? TakeTheme.background : TakeTheme.white).background(optionID == option.id ? TakeTheme.white : TakeTheme.background, in: Capsule()).overlay(Capsule().stroke(TakeTheme.white, lineWidth: 1))
            }.buttonStyle(.plain).accessibilityAddTraits(optionID == option.id ? .isSelected : []).accessibilityIdentifier("Position \(option.label)")
        }
    }

    private func unlocked(_ state: TodayState, round: DailyRound) -> some View {
        Group {
            VStack(alignment: .leading, spacing: 12) {
                Text(round.question).font(.subheadline).foregroundStyle(TakeTheme.muted)
                if let own = state.ownOriginal {
                    NavigationLink { TakeDetailView(originalID: own.id, round: round) } label: { HStack { Image(systemName: "checkmark.circle"); Text("Your take · \(round.label(for: own.optionId))").font(.caption.weight(.medium)); Spacer(); Image(systemName: "chevron.right") }.foregroundStyle(TakeTheme.white).frame(minHeight: 44) }
                } else {
                    Text("Your take was deleted. Your successful post still keeps this round unlocked.").font(.caption).foregroundStyle(TakeTheme.muted)
                }
            }
            HStack { Text("My friends").font(.headline).padding(.bottom, 10).overlay(alignment: .bottom) { Rectangle().fill(TakeTheme.white).frame(height: 1) }.accessibilityIdentifier("FRIENDS' TAKES"); Spacer() }
            if model.feed.isEmpty {
                EmptyCard(symbol: "bubble.left.and.bubble.right", title: "You're early. That's a good thing.", message: "Your approved friends' originals will appear here when they post. Replies live inside each conversation.")
            }
            ForEach(model.feed) { original in
                VStack(alignment: .leading, spacing: 8) {
                    ContentVideoCard(id: original.id, author: original.author, kind: .original, durationMs: original.durationMs, option: round.label(for: original.optionId))
                    NavigationLink { TakeDetailView(originalID: original.id, round: round) } label: {
                        HStack { Label(original.visibleReplyCount == 0 ? "Reply with video" : "\(original.visibleReplyCount) video \(original.visibleReplyCount == 1 ? "reply" : "replies")", systemImage: "video"); Spacer(); Image(systemName: "chevron.right") }.font(.caption.weight(.medium)).frame(minHeight: 44).foregroundStyle(TakeTheme.white)
                    }
                }.id(original.id)
            }
            if model.feedCursor != nil { Button("Load more takes") { Task { await model.refreshFeed(more: true) } }.frame(maxWidth: .infinity, minHeight: 48) }
        }
    }

    private func createDraft(_ round: DailyRound) {
        guard let owner = model.service?.viewerID, let optionID else { return }
        PlaybackCoordinator.shared.pause()
        draft = PublicationDraft(id: UUID().uuidString, ownerId: owner, isDemo: model.isDemo, roundId: round.id, optionId: optionID, originalId: nil, clip: nil, uploadId: nil, state: .draft, failure: nil)
    }
}
