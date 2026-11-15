import SwiftUI
import UIKit

enum TakeTheme {
    static let background = Color(red: 0.065, green: 0.073, blue: 0.07)
    static let surface = Color(red: 0.115, green: 0.125, blue: 0.12)
    static let raised = Color(red: 0.17, green: 0.18, blue: 0.17)
    static let white = Color(red: 0.96, green: 0.95, blue: 0.90)
    static let muted = Color(red: 0.67, green: 0.70, blue: 0.66)
    static let lime = Color(red: 0.80, green: 0.96, blue: 0.35)
    static let lavender = Color(red: 0.76, green: 0.70, blue: 0.94)
    static let coral = Color(red: 1, green: 0.57, blue: 0.45)
    static func accent(_ index: Int) -> Color { [lime, lavender, coral][abs(index) % 3] }
    @MainActor static func haptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) { UIImpactFeedbackGenerator(style: style).impactOccurred() }
}

struct PrimaryButton: View {
    let title: String
    var symbol: String? = nil
    var color: Color = TakeTheme.lime
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let symbol { Image(systemName: symbol) }
                Text(title).font(.headline)
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 12)
            .foregroundStyle(TakeTheme.background)
            .background(disabled ? TakeTheme.muted : color, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityIdentifier(title)
    }
}

struct AvatarView: View {
    let profile: PublicProfile
    var size: CGFloat = 44
    private var tint: Color { TakeTheme.accent(profile.id.utf8.reduce(0) { $0 + Int($1) }) }
    var body: some View {
        Group {
            if let descriptor = profile.avatar, let url = URL(string: descriptor.url) {
                if url.isFileURL, let image = UIImage(contentsOfFile: url.path) { Image(uiImage: image).resizable().scaledToFill() }
                else { AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initial } }
            } else if let image = UIImage(named: "avatar-\(profile.id)") {
                Image(uiImage: image).resizable().scaledToFill()
            } else { initial }
        }
        .frame(width: size, height: size)
        .background(tint.opacity(0.17), in: Circle())
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
    private var initial: some View { Text(profile.initial).font(.system(size: size * 0.42, weight: .bold, design: .rounded)).foregroundStyle(tint) }
}

struct Eyebrow: View {
    let text: String
    var color: Color = TakeTheme.muted
    var body: some View { Text(text).font(.caption.weight(.bold)).tracking(2).foregroundStyle(color) }
}

struct EmptyCard: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.largeTitle).foregroundStyle(TakeTheme.lavender)
            Text(title).font(.title3.bold()).foregroundStyle(TakeTheme.white)
            Text(message).font(.subheadline).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(28).background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }
}

struct InlineNotice: View {
    let text: String
    var color: Color = TakeTheme.coral
    var body: some View {
        Label(text, systemImage: "info.circle").font(.subheadline).foregroundStyle(color).padding(16).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
    }
}

extension View {
    func takeScreen() -> some View { self.background(TakeTheme.background).foregroundStyle(TakeTheme.white).toolbarBackground(TakeTheme.background, for: .navigationBar).toolbarColorScheme(.dark, for: .navigationBar) }
    func takeCard() -> some View { self.padding(20).background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 24)) }
}
