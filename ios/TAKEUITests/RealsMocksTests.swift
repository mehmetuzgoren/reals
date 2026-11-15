import XCTest

@MainActor
final class RealsMocksTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testEightMockScreensWithExplicitOfflineSamplePublication() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--mock-demo", "--reset-mock-demo"]
        app.launch()

        let prompt = app.staticTexts["Is a hot dog a sandwich?"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 15))
        requireHittable(app.buttons["Position No"])
        XCTAssertTrue(app.staticTexts["Today's prompt"].exists)
        XCTAssertTrue(app.staticTexts["Post your take to see your friends'."].exists)
        XCTAssertEqual(app.tabBars.count, 0)
        attachScreen(1, app: app)

        app.buttons["Position No"].tap()
        let shutter = app.buttons["Start recording"]
        requireHittable(shutter)
        XCTAssertTrue(app.staticTexts["Camera preview"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Your position: No"].exists)
        XCTAssertTrue(app.staticTexts["0:00 / 0:15"].exists)
        XCTAssertTrue(app.staticTexts["3 to 15 seconds. Retake as many times as you like."].exists)
        attachScreen(2, app: app)

        shutter.press(forDuration: 0.9)
        let sample = app.buttons["Use labeled 4-second sample"]
        requireHittable(sample)
        sample.tap()
        XCTAssertTrue(app.staticTexts["0:04 / 0:15"].waitForExistence(timeout: 8))
        let post = app.buttons["Post"]
        for _ in 0..<3 where !post.isHittable { app.scrollViews.firstMatch.swipeUp() }
        requireHittable(post)
        XCTAssertTrue(app.staticTexts["Demo sample · Not recorded live."].exists)
        post.tap()

        let myFriends = app.buttons["My friends"]
        let sam = app.buttons["Open take Sam"]
        requireHittable(sam, timeout: 20)
        requireHittable(myFriends)
        XCTAssertTrue(myFriends.isSelected)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        attachScreen(3, app: app)

        sam.tap()
        requireHittable(app.buttons["Back"])
        requireHittable(app.buttons["Open replies"])
        XCTAssertTrue(app.staticTexts["Sam · Yes"].waitForExistence(timeout: 8))
        XCTAssertEqual(app.buttons["Like"].value as? String, "3, not liked")
        XCTAssertEqual(app.buttons["Comments"].value as? String, "1")
        requireHittable(app.buttons["Reply"])
        pauseVideo(app)
        attachScreen(4, app: app)

        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Reply 1 of 3"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Priya"].exists)
        XCTAssertTrue(app.staticTexts["Replying to Sam"].exists)
        XCTAssertEqual(app.buttons["Like"].value as? String, "4, not liked")
        XCTAssertEqual(app.buttons["Comments"].value as? String, "0")
        pauseVideo(app)
        attachScreen(5, app: app)

        app.buttons["Back"].tap()
        requireHittable(app.buttons["For You"])
        app.buttons["For You"].tap()
        let jordan = app.buttons["Open take jordan.lee"]
        requireHittable(jordan)
        XCTAssertTrue(app.buttons["For You"].isSelected)
        attachScreen(6, app: app)

        jordan.tap()
        requireHittable(app.buttons["Battle"])
        requireHittable(app.buttons["Open replies"])
        XCTAssertTrue(app.staticTexts["jordan.lee · Yes"].waitForExistence(timeout: 8))
        XCTAssertEqual(app.buttons["Like"].value as? String, "248, not liked")
        XCTAssertEqual(app.buttons["Comments"].value as? String, "56")
        pauseVideo(app)
        attachScreen(7, app: app)

        app.buttons["Battle"].tap()
        requireHittable(app.buttons["Battle left"])
        requireHittable(app.buttons["Battle right"])
        XCTAssertTrue(app.staticTexts["Battle"].exists)
        XCTAssertTrue(app.staticTexts["55%"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["45%"].exists)
        XCTAssertTrue(app.staticTexts["Tap the take you think is right"].exists)
        XCTAssertTrue((app.buttons["Battle left"].value as? String)?.contains("jordan.lee, Yes") == true)
        XCTAssertTrue((app.buttons["Battle right"].value as? String)?.contains("mira_k, No") == true)
        XCTAssertTrue(app.buttons["Play left take"].exists)
        XCTAssertTrue(app.buttons["Play right take"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        attachScreen(8, app: app)
    }

    private func requireHittable(_ element: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), file: file, line: line)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: timeout), .completed, file: file, line: line)
    }

    private func pauseVideo(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let player = app.buttons["Play take"]
        requireHittable(player, file: file, line: line)
        let playing = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Playing"), object: player)
        if XCTWaiter.wait(for: [playing], timeout: 5) == .completed { player.tap() }
        let paused = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Paused"), object: player)
        XCTAssertEqual(XCTWaiter.wait(for: [paused], timeout: 8), .completed, file: file, line: line)
        XCTAssertFalse(app.alerts.firstMatch.exists, file: file, line: line)
    }

    private func attachScreen(_ number: Int, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = String(format: "mocks-v2-screen-%02d", number)
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
