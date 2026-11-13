import XCTest

/// Opens the installed app in a simulator and does what a person does first: waits for the
/// word list, searches for a piece of a word, opens a word and reads its meaning. Each screen
/// is kept as a picture (ios.yml pulls them out of the result).
///
/// It is the only thing that runs the real iOS app before a phone does: the page in iOS's own
/// web view, its worker loading the word list, and a meaning read out of the definitions
/// file a block at a time. The app must be built with the sample word list named as the real
/// one is (ios.yml does that), and it finds the page's parts the way VoiceOver does.
final class SimulatorRun: XCTestCase {
    /// A piece to type, a word among its results, and words from that word's meaning and
    /// example in the sample list (test/fixtures/headwords-sample.golden.json).
    private let piece = "ingot"
    private let word = "ingot"
    private let fromItsMeaning = "cast metal"

    private let app = XCUIApplication(bundleIdentifier: "io.github.smitravitz.dictionarius")

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        keep("last-screen") // whatever was showing, pass or fail
    }

    func testSearchAndOpenAWord() {
        app.launch()

        // The word list loaded: the count of words shows.
        XCTAssertTrue(anything(containing: " words").waitForExistence(timeout: 90), "the word list never loaded")
        skipTheTour(waiting: 20)
        keep("1-start")

        // Type a piece of a word.
        let box = searchBox()
        XCTAssertTrue(box.waitForExistence(timeout: 20), "no search box")
        tapOnScreen(box)
        box.typeText(piece)
        skipTheTour(waiting: 3)
        let row = anything(labelled: word)
        XCTAssertTrue(row.waitForExistence(timeout: 30), "no results for \(piece)")
        keep("2-search")

        // Open the word: its meaning comes from the definitions file, read in place.
        tapOnScreen(row)
        XCTAssertTrue(anything(containing: fromItsMeaning).waitForExistence(timeout: 30), "the word's meaning never showed")
        keep("3-word")
    }

    /// A first start shows the tour, and this isn't about the tour: Skip ends it, once it offers to.
    private func skipTheTour(waiting seconds: TimeInterval) {
        let skip = app.buttons["Skip"]
        if skip.waitForExistence(timeout: seconds) { tapOnScreen(skip) }
    }

    /// Taps the middle of where `element` is on the screen. Every tap here goes this way:
    /// XCUITest's own tap first works out a "hit point" inside the element, which it often
    /// can't do for the page inside a web view (it finds the result row, then reports it
    /// "not hittable"). Where the element is drawn is what a finger goes by anyway.
    private func tapOnScreen(_ element: XCUIElement) {
        let frame = element.frame
        XCTAssertFalse(frame.isEmpty, "\(element) has no place on the screen")
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX, dy: frame.midY))
            .tap()
    }

    /// The search box, whichever kind of field iOS takes it for.
    private func searchBox() -> XCUIElement {
        for kind in [app.searchFields, app.textFields, app.comboBoxes] where kind.firstMatch.exists {
            return kind.firstMatch
        }
        return app.searchFields.firstMatch
    }

    /// The first thing on the page whose name is exactly `label` (a row of the results).
    private func anything(labelled label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", label)).firstMatch
    }

    /// The first thing on the page whose name or text has `text` in it.
    private func anything(containing text: String) -> XCUIElement {
        app.webViews.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text)).firstMatch
    }

    /// Keeps a picture of the screen with the test's result.
    private func keep(_ name: String) {
        let picture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        picture.name = name
        picture.lifetime = .keepAlways
        add(picture)
    }
}
