import Cocoa
import WebKit

final class DriveWindow: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let web = WKWebView()

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let page = Bundle.main.url(forResource: "index", withExtension: "html") else { exit(1) }
        let menu = NSMenu()
        let applicationItem = NSMenuItem()
        menu.addItem(applicationItem)
        let commands = NSMenu()
        commands.addItem(withTitle: "Quit Beyond the Bend", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = commands
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1040, height: 650),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Beyond the Bend"
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        if CommandLine.arguments.contains("--smoke-test") {
            let deadline = Date().addingTimeInterval(45)
            Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                self.web.evaluateJavaScript("Boolean(window.__btb?.car.isReady && document.querySelector('#map-road').getAttribute('d'))") { ready, _ in
                    if ready as? Bool == true { print("WebKit loaded the offline map and car"); exit(0) }
                    if Date() > deadline { exit(1) }
                }
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = DriveWindow()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
