import SwiftUI

struct DemoControlsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var resetConfirmation = false
    @State private var failureArmed = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Developer-only Demo controls", systemImage: "wrench.and.screwdriver").font(.headline).foregroundStyle(TakeTheme.white)
                    Text("These controls affect only isolated, persisted offline sample data. They never change a live account or bypass server authorization.").font(.subheadline).foregroundStyle(TakeTheme.muted)
                }
                Section("Offline scenario") {
                    Button("Eight mock screens") { Task { await model.enterDemo(scenario: .mocks); dismiss() } }.accessibilityIdentifier("Use mock screens")
                    Button("Legacy rounds and privacy matrix") { Task { await model.enterDemo(scenario: .legacy); dismiss() } }.accessibilityIdentifier("Use privacy matrix")
                }
                if model.demo?.demoScenario == .legacy {
                Section("Fictional identity") {
                    ForEach(DemoIdentity.allCases) { identity in
                        Button { Task { await model.switchIdentity(identity); dismiss() } } label: {
                            HStack { Text(identity.name); Spacer(); if model.demo?.identity == identity { Image(systemName: "checkmark").foregroundStyle(TakeTheme.white) } }
                        }.foregroundStyle(TakeTheme.white).accessibilityIdentifier("Switch to \(identity.name)")
                    }
                }
                Section("Release a question") {
                    Button("1 · Pineapple on pizza") { release(1) }.accessibilityIdentifier("Release round 1")
                    Button("2 · Elon Musk opinion") { release(2) }.accessibilityIdentifier("Release round 2")
                    Text("A new round locks viewers who haven't posted for that exact question.").font(.caption).foregroundStyle(TakeTheme.muted)
                }
                Section("Publication scenarios") {
                    Button("Simulate successful sample publication") { model.demo?.simulatePublication(); dismiss() }.accessibilityIdentifier("Simulate successful publication")
                    Text("Developer shortcut: records a successful demo-only sample receipt. The normal Record → Preview → Publish flow remains available.").font(.caption).foregroundStyle(TakeTheme.muted)
                    Button(failureArmed ? "Next upload will fail" : "Fail the next upload") { model.demo?.failNextUpload(); failureArmed = true }.foregroundStyle(TakeTheme.white).accessibilityIdentifier("Fail next upload")
                    Text("A failed upload keeps the feed locked. Retry the saved clip to finish publication.").font(.caption).foregroundStyle(TakeTheme.muted)
                }
                Section("Visibility matrix") {
                    Text("Casey is friends with Alex and Blair: after posting, Casey sees Alex's original and Blair's reply.")
                    Text("Dana is friends only with Alex: after posting, Dana sees Alex's original but not Blair's reply or hidden counts.")
                    Text("Alex and Blair already posted both sample questions. Casey and Dana start locked. Dana → Casey and Blair → Dana are pending requests, not friendships.")
                }.font(.subheadline).foregroundStyle(TakeTheme.muted)
                }
                if model.demo?.demoScenario == .mocks {
                    Section("Mock screen scenarios") {
                        Button("Reveal today's takes") { model.demo?.simulatePublication(); dismiss() }
                        Button(failureArmed ? "Next upload will fail" : "Fail the next upload") { model.demo?.failNextUpload(); failureArmed = true }
                        Text("The main record flow uses an explicitly selected offline sample when no camera is available. Long-press the shutter to choose it.").font(.caption).foregroundStyle(TakeTheme.muted)
                    }
                }
                Section { Button("Reset all offline demo data", role: .destructive) { resetConfirmation = true } }
            }
            .scrollContentBackground(.hidden).takeScreen().navigationTitle("Demo lab").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .confirmationDialog("Reset the demo?", isPresented: $resetConfirmation, titleVisibility: .visible) { Button("Reset samples and local changes", role: .destructive) { Task { await model.resetDemo(); dismiss() } } } message: { Text("This restores this offline scenario's sample clips and relationships. It doesn't touch live Reals data.") }
    }
    private func release(_ number: Int) { model.demo?.releaseRound(number); PlaybackCoordinator.shared.clear(); Task { await model.refresh(); dismiss() } }
}
