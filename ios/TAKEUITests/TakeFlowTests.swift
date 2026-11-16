import XCTest

final class TakeFlowTests: XCTestCase {
    func testExplicitFixturePublicationAndNewRoundLock() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--reset-demo"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Do you like pineapple on pizza?"].waitForExistence(timeout: 12))
        app.buttons["Position Yes"].tap()
        app.buttons["Give your take"].tap()
        XCTAssertTrue(app.buttons["Use simulator sample instead"].waitForExistence(timeout: 8))
        app.buttons["Use simulator sample instead"].tap()
        app.buttons["Use labeled 4-second sample"].tap()
        XCTAssertTrue(app.buttons["Publish take"].waitForExistence(timeout: 6))
        app.buttons["Publish take"].tap()
        XCTAssertTrue(app.staticTexts["FRIENDS' TAKES"].waitForExistence(timeout: 10))
        app.buttons["Demo controls"].tap()
        app.buttons["Release round 2"].tap()
        XCTAssertTrue(app.staticTexts["Do you think Elon Musk is a genius? How is he successful?"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["Give your take"].exists)
        XCTAssertFalse(app.staticTexts["FRIENDS' TAKES"].exists)
    }
}
