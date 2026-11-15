import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var optionID: String?
    @State private var draft: PublicationDraft?
    @State private var showDemo = false
    @State private var scrollID: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                header
                if let state = model.today, let round = state.round {
                    if state.canViewFriends { unlocked(state, round: round) }
                    else { locked(state, round: round) }
                } else if model.today != nil {
                    EmptyCard(symbol: "sun.horizon", title: "A little room for anticipation.", message: "The next question hasn't dropped yet. We'll let you know when it does. You can still find your friends.")
                } else {
                    EmptyCard(symbol: "arrow.triangle.2.circlepath", title: "Finding today's question", message: "Pull to refresh. A connection is needed in live mode; Demo Mode works completely offline.")
                    Button("Try again") { Task { await model.refresh() } }.frame(maxWidth: .infinity, minHeight: 44)
                }
                if let saved = model.recoveredDraft, saved.roundId == model.today?.round?.id {
                    Button { draft = saved } label: { Label("Resume your saved \(saved.kind == .reply ? "reply" : "take")", systemImage: "arrow.clockwise").font(.headline).frame(maxWidth: .infinity, minHeight: 52) }.buttonStyle(.bordered).tint(TakeTheme.lavender)
                }
            }
            .scrollTargetLayout().padding(24).padding(.bottom, 20)
        }
        .scrollPosition(id: $scrollID, anchor: .top)
        .refreshable { await model.refresh() }
        .navigationBarHidden(true)
        .takeScreen()
        .sheet(item: $draft, onDismiss: { Task { await model.refresh() } }) { draft in ComposerView(initialDraft: draft, round: model.today?.round).environmentObject(model) }
        .sheet(isPresented: $showDemo) { DemoControlsView().environmentObject(model) }
        .overlay(alignment: .top) {
            if model.reveal {
                Label("You're in. Meet the other sides.", systemImage: "lock.open.fill").font(.headline).foregroundStyle(TakeTheme.background).padding(18).background(TakeTheme.lime, in: Capsule()).padding(.top, 18).padding(.horizontal).allowsHitTesting(false).transition(reduceMotion ? .opacity : .move(edge: .top)).onAppear { Task { try? await Task.sleep(for: .seconds(3)); withAnimation(reduceMotion ? nil : .easeOut) { model.reveal = false } } }
            }
        }
        .onChange(of: model.today?.round?.id) { _, _ in optionID = nil; scrollID = nil }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("TAKE").font(.system(size: 32, weight: .black, design: .rounded)).tracking(-1.5)
                Text("A different kind of daily.").font(.caption).foregroundStyle(TakeTheme.muted)
            }
            Spacer()
            if model.isDemo {
                Button { showDemo = true } label: { Label("Demo", systemImage: "slider.horizontal.3").font(.caption.bold()).padding(.horizontal, 14).padding(.vertical, 12).frame(minHeight: 44).background(TakeTheme.raised, in: Capsule()) }.accessibilityIdentifier("Demo controls")
            }
        }
    }

    private func locked(_ state: TodayState, round: DailyRound) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack { Eyebrow(text: "TODAY'S QUESTION", color: TakeTheme.lime); Spacer(); Label("Locked", systemImage: "lock.fill").font(.caption.bold()).foregroundStyle(TakeTheme.muted) }
            Text(round.question).font(.system(.largeTitle, design: .rounded, weight: .bold)).tracking(-0.9).fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            Text("No right answer. Just your take.").font(.body).foregroundStyle(TakeTheme.muted)
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "WHERE DO YOU STAND?")
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 9) { options(round) }
                    VStack(spacing: 9) { options(round) }
                }
            }
            PrimaryButton(title: "Give your take", symbol: "video.fill", disabled: optionID == nil) { createDraft(round) }
            HStack(spacing: 8) { Image(systemName: "timer"); Text("15 seconds. Front camera. All you.") }.font(.caption).foregroundStyle(TakeTheme.muted).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Image(systemName: "lock.fill").font(.title3).foregroundStyle(TakeTheme.lime)
                    VStack(alignment: .leading, spacing: 4) { Text("Your friends' takes are waiting.").font(.headline); Text("Post yours to open the conversation.").font(.subheadline).foregroundStyle(TakeTheme.muted) }
                }
                Rectangle().fill(TakeTheme.raised).frame(height: 1)
                if state.friendPresence.isEmpty {
                    Text("Start with a friend. You can still post your first take.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                    Button("Find your friends") { model.selectedTab = 1 }.font(.headline).frame(minHeight: 44)
                } else {
                    HStack(alignment: .center, spacing: 12) {
                        HStack(spacing: -10) { ForEach(state.friendPresence.prefix(4), id: \.profile.id) { person in AvatarView(profile: person.profile, size: 42).overlay(Circle().stroke(TakeTheme.surface, lineWidth: 3)) } }
                        VStack(alignment: .leading, spacing: 3) { Text("\(state.friendPresence.filter(\.hasPublished).count) friends have posted").font(.subheadline.bold()); Text("Their opinions stay private until you do.").font(.caption).foregroundStyle(TakeTheme.muted) }
                    }
                }
            }.takeCard()
            HStack(alignment: .top, spacing: 10) { Image(systemName: "person.2.badge.shield.checkmark").foregroundStyle(TakeTheme.lavender); Text("Only approved friends who posted this round can see your video. No public feed, ever.").font(.caption).foregroundStyle(TakeTheme.muted) }
        }
    }

    @ViewBuilder private func options(_ round: DailyRound) -> some View {
        ForEach(Array(round.options.enumerated()), id: \.element.id) { index, option in
            Button { optionID = option.id; TakeTheme.haptic() } label: {
                HStack(spacing: 6) { if optionID == option.id { Image(systemName: "checkmark.circle.fill") }; Text(option.label).font(.headline).fixedSize(horizontal: true, vertical: false) }.frame(maxWidth: .infinity, minHeight: 50).padding(.horizontal, 14).background(optionID == option.id ? TakeTheme.accent(index) : TakeTheme.surface, in: RoundedRectangle(cornerRadius: 16)).foregroundStyle(optionID == option.id ? TakeTheme.background : TakeTheme.white).overlay(RoundedRectangle(cornerRadius: 16).stroke(optionID == option.id ? TakeTheme.accent(index) : TakeTheme.raised, lineWidth: 1))
            }.buttonStyle(.plain).accessibilityAddTraits(optionID == option.id ? .isSelected : []).accessibilityIdentifier("Position \(option.label)")
        }
    }

    private func unlocked(_ state: TodayState, round: DailyRound) -> some View {
        Group {
            VStack(alignment: .leading, spacing: 12) {
                HStack { Eyebrow(text: "TODAY'S QUESTION", color: TakeTheme.lime); Spacer(); Image(systemName: "lock.open.fill").foregroundStyle(TakeTheme.lime) }
                Text(round.question).font(.title.bold()).tracking(-0.5)
                Text("You showed up. Now see their side.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                if let own = state.ownOriginal {
                    NavigationLink { TakeDetailView(originalID: own.id, round: round) } label: { HStack { Image(systemName: "checkmark.circle.fill"); Text("Your take · \(round.label(for: own.optionId))").font(.subheadline.bold()); Spacer(); Image(systemName: "arrow.up.right") }.foregroundStyle(TakeTheme.lime).padding(16).background(TakeTheme.lime.opacity(0.08), in: RoundedRectangle(cornerRadius: 16)) }
                } else {
                    Text("Your take was deleted. Your successful post still keeps this round unlocked.").font(.caption).foregroundStyle(TakeTheme.muted)
                }
            }
            HStack { Eyebrow(text: "FRIENDS' TAKES"); Spacer(); Text("\(model.feed.count)").font(.caption.monospaced()).foregroundStyle(TakeTheme.muted) }
            if model.feed.isEmpty {
                EmptyCard(symbol: "bubble.left.and.bubble.right", title: "You're early. That's a good thing.", message: "Your approved friends' originals will appear here when they post. Replies live inside each conversation.")
            }
            ForEach(model.feed) { original in
                VStack(alignment: .leading, spacing: 0) {
                    ContentVideoCard(id: original.id, author: original.author, kind: .original, durationMs: original.durationMs, option: round.label(for: original.optionId))
                    NavigationLink { TakeDetailView(originalID: original.id, round: round) } label: {
                        HStack { Label(original.visibleReplyCount == 0 ? "Start a conversation" : "\(original.visibleReplyCount) video \(original.visibleReplyCount == 1 ? "reply" : "replies")", systemImage: "bubble.left"); Spacer(); Image(systemName: "arrow.up.right") }.font(.subheadline.bold()).padding(18).foregroundStyle(TakeTheme.white)
                    }
                }.background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 26)).clipShape(RoundedRectangle(cornerRadius: 26)).id(original.id)
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
