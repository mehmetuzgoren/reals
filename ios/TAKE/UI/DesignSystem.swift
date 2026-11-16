import SwiftUI
import UIKit

enum TakeTheme {
    static let background = Color.black
    static let surface = Color(white: 17.0 / 255.0)
    static let raised = Color(white: 0.12)
    static let white = Color.white
    static let muted = Color(white: 142.0 / 255.0)
    @MainActor static func haptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) { UIImpactFeedbackGenerator(style: style).impactOccurred() }
}

struct PrimaryButton: View {
    let title: String
    var symbol: String? = nil
    var color: Color = TakeTheme.white
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
            .background(disabled ? TakeTheme.muted : color, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityIdentifier(title)
    }
}

struct AvatarView: View {
    let profile: PublicProfile
    var size: CGFloat = 44
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
        .background(TakeTheme.raised, in: Circle())
        .clipShape(Circle())
        .saturation(0)
        .accessibilityHidden(true)
    }
    private var initial: some View { Text(profile.initial).font(.system(size: size * 0.42, weight: .bold)).foregroundStyle(TakeTheme.white) }
}

struct Eyebrow: View {
    let text: String
    var color: Color = TakeTheme.muted
    var body: some View { Text(text).font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(color) }
}

struct RealsAvatar: View {
    let profile: PublicProfile
    var size: CGFloat = 32
    var body: some View {
        Group {
            if let descriptor = profile.avatar, let url = URL(string: descriptor.url), url.scheme == "https" {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initial }
            } else { initial }
        }
        .frame(width: size, height: size)
        .background(Color(white: 42.0 / 255.0), in: Circle())
        .clipShape(Circle())
        .saturation(0)
        .accessibilityHidden(true)
    }
    private var initial: some View { Text(profile.initial).font(.system(size: size * 0.43, weight: .medium)).foregroundStyle(.white) }
}

struct RealsPlayTriangle: View {
    var body: some View { Image(systemName: "play.fill").font(.system(size: 15, weight: .regular)).foregroundStyle(TakeTheme.muted) }
}

struct EmptyCard: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.largeTitle).foregroundStyle(TakeTheme.white)
            Text(title).font(.title3.bold()).foregroundStyle(TakeTheme.white)
            Text(message).font(.subheadline).foregroundStyle(TakeTheme.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(28).background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }
}

struct InlineNotice: View {
    let text: String
    var color: Color = TakeTheme.white
    var body: some View {
        Label(text, systemImage: "info.circle").font(.subheadline).foregroundStyle(color).padding(16).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
    }
}

extension View {
    func takeScreen() -> some View { self.background(TakeTheme.background).foregroundStyle(TakeTheme.white).toolbarBackground(TakeTheme.background, for: .navigationBar).toolbarColorScheme(.dark, for: .navigationBar) }
    func takeCard() -> some View { self.padding(20).background(TakeTheme.surface, in: RoundedRectangle(cornerRadius: 24)) }
}

extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        gestureRecognizer !== interactivePopGestureRecognizer || viewControllers.count > 1
    }
}
