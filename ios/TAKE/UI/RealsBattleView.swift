import SwiftUI

struct RealsBattleView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let battleID: String
    let round: DailyRound
    @State private var battle: BattleState?
    @State private var voting = false
    @State private var failure: String?
    @State private var cancelLeftWatch: (() -> Void)?
    @State private var cancelRightWatch: (() -> Void)?
    @State private var visible = false
    @State private var viewEpoch = UUID()
    @State private var loadEpoch = UUID()

    private var authorizationID: String { "\(model.generation)-\(model.accessRevision)-\(round.id)" }
    private var leftPercent: Int {
        guard let battle else { return 50 }
        let left = Double(max(0, battle.leftVotes))
        let right = Double(max(0, battle.rightVotes))
        guard left + right > 0 else { return 50 }
        return min(100, max(0, Int((left / (left + right) * 100).rounded())))
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                ZStack {
                    Text("Battle").font(.system(size: 17, weight: .bold))
                    HStack {
                        Button { dismiss() } label: {
                            Image(systemName: "chevron.left").font(.system(size: 20, weight: .regular)).frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Back")
                        .accessibilityIdentifier("Back")
                        Spacer()
                    }
                }
                .frame(height: 44)
                .padding(.horizontal, 12)
                .padding(.top, 52)
                Text(round.question)
                    .font(.system(size: 26, weight: .bold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 20)
                if let battle {
                    HStack(spacing: 10) {
                        card(battle.left, side: .left, selected: battle.viewerVote == .left)
                        card(battle.right, side: .right, selected: battle.viewerVote == .right)
                    }
                    .frame(height: max(240, geometry.size.height - 322))
                    .padding(.horizontal, 20)
                    VStack(spacing: 8) {
                        GeometryReader { bar in
                            HStack(spacing: 3) {
                                Capsule().fill(TakeTheme.white).frame(width: max(0, bar.size.width - 3) * CGFloat(leftPercent) / 100)
                                Capsule().fill(Color(white: 0.29)).frame(width: max(0, bar.size.width - 3) * CGFloat(100 - leftPercent) / 100)
                            }
                        }
                        .frame(height: 4)
                        HStack {
                            Text("\(leftPercent)%").foregroundStyle(TakeTheme.white)
                            Spacer()
                            Text("\(100 - leftPercent)%").foregroundStyle(TakeTheme.muted)
                        }
                        .font(.system(size: 15, weight: .bold))
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                } else {
                    Spacer()
                }
                Spacer(minLength: 20)
                Text("Tap the take you think is right")
                    .font(.system(size: 15))
                    .foregroundStyle(TakeTheme.muted)
                    .padding(.bottom, 48)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(TakeTheme.background)
            .foregroundStyle(TakeTheme.white)
        }
        .ignoresSafeArea()
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .statusBarHidden()
        .preferredColorScheme(.dark)
        .task(id: authorizationID) { await startBattle() }
        .onChange(of: model.generation) { _, _ in invalidate(); dismiss() }
        .onChange(of: model.accessRevision) { _, _ in invalidate(); dismiss() }
        .onChange(of: model.today?.round?.id) { _, id in if id != round.id { invalidate(); dismiss() } }
        .onDisappear { invalidate() }
        .alert("Takes", isPresented: Binding(get: { failure != nil && failure?.isCancellationMessage != true }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) { failure = nil }
        } message: { Text(failure ?? "") }
    }

    private func card(_ original: OriginalSummary, side: BattleSide, selected: Bool) -> some View {
        ZStack(alignment: .bottomLeading) {
            Button { Task { await vote(side) } } label: {
                RoundedRectangle(cornerRadius: 24).fill(TakeTheme.surface)
            }
            .buttonStyle(.plain)
            .disabled(voting)
            .accessibilityLabel(side == .left ? "Battle left" : "Battle right")
            .accessibilityIdentifier(side == .left ? "Battle left" : "Battle right")
            .accessibilityValue("\(original.author.username), \(round.label(for: original.optionId))\(selected ? ", selected" : "")")
            RealsVideoSurface(contentID: original.id, kind: .original, roundID: round.id, centerButtonOnly: true, playLabel: side == .left ? "Play left take" : "Play right take") { message in
                if visible { failure = message }
            }
            .id(original.id)
            VStack(alignment: .leading, spacing: 3) {
                Text(original.author.username).font(.system(size: 15, weight: .bold))
                Text(round.label(for: original.optionId)).font(.system(size: 14)).foregroundStyle(TakeTheme.muted)
            }
            .padding(14)
            .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay {
            if selected { RoundedRectangle(cornerRadius: 24).strokeBorder(TakeTheme.white, lineWidth: 2).allowsHitTesting(false) }
        }
    }

    private func startBattle() async {
        visible = true
        viewEpoch = UUID()
        cancelLeftWatch?(); cancelLeftWatch = nil
        cancelRightWatch?(); cancelRightWatch = nil
        guard let access = RealsContentAccess(model: model, roundID: round.id) else { invalidate(); return }
        let epoch = viewEpoch
        await load()
        guard visible, epoch == viewEpoch, access.isCurrent(model), let battle, !Task.isCancelled else { return }
        cancelLeftWatch = access.service.watchConversation(originalId: battle.left.id) {
            guard visible, epoch == viewEpoch, access.isCurrent(model) else { return }
            Task { await load() }
        }
        cancelRightWatch = access.service.watchConversation(originalId: battle.right.id) {
            guard visible, epoch == viewEpoch, access.isCurrent(model) else { return }
            Task { await load() }
        }
    }

    private func load() async {
        guard visible, let access = RealsContentAccess(model: model, roundID: round.id) else { return }
        let epoch = UUID(); loadEpoch = epoch
        let screen = viewEpoch
        do {
            let value = try await access.service.battle(battleId: battleID)
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            guard value.roundId == round.id, value.left.roundId == round.id, value.right.roundId == round.id, value.left.audience == .public, value.right.audience == .public else { throw ServiceFailure.notFound }
            battle = value
        } catch {
            guard visible, screen == viewEpoch, epoch == loadEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            battle = nil; voting = false
            PlaybackCoordinator.shared.clear()
            failure = error.localizedDescription
        }
    }

    private func vote(_ side: BattleSide) async {
        guard visible, !voting, let battle, let access = RealsContentAccess(model: model, roundID: round.id) else { return }
        guard battle.viewerCanVote else {
            failure = "You can't vote in your own battle."
            return
        }
        let screen = viewEpoch
        voting = true
        do {
            let result = try await access.service.vote(battleId: battleID, side: side)
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            voting = false
            guard let current = self.battle, current.battleId == battle.battleId else { return }
            loadEpoch = UUID()
            self.battle = BattleState(battleId: current.battleId, roundId: current.roundId, left: current.left, right: current.right, leftVotes: result.leftVotes, rightVotes: result.rightVotes, viewerVote: result.viewerVote, viewerCanVote: current.viewerCanVote)
        } catch {
            guard visible, screen == viewEpoch, access.isCurrent(model), !Task.isCancelled else { return }
            voting = false
            failure = error.localizedDescription
        }
    }

    private func invalidate() {
        visible = false
        viewEpoch = UUID(); loadEpoch = UUID()
        cancelLeftWatch?(); cancelLeftWatch = nil
        cancelRightWatch?(); cancelRightWatch = nil
        battle = nil; voting = false; failure = nil
    }
}
