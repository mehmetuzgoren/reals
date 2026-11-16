import SwiftUI

@main
struct TAKEApp: App {
    @UIApplicationDelegateAdaptor(TakeAppDelegate.self) private var appDelegate
    var body: some Scene { WindowGroup { RootView() } }
}
