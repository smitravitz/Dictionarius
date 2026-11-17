import XCTest

/// Opens the installed app in a simulator and does what a person does first: waits for the
/// word list, searches for a fragment of a word, opens a word and reads its meaning. Each screen
/// is kept as a picture (ios.yml pulls them out of the result).
///
/// It is the only thing that runs the real iOS app before a phone does: the page in iOS's own
/// web view, its worker loading the word list, and a meaning read out of the definitions
/// file a block at a time. The app must be built with the sample word list named as the real
/// one is (ios.yml does that), and it finds the page's parts the way VoiceOver does.
final class SimulatorRun: XCTestCase {
    /// A fragment to type, a word among its results, and words from that word's meaning and
    /// example in the sample list (test/fixtures/headwords-sample.golden.json).
    private let fragment = "ingot"
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

        // Type a fragment of a word.
        let box = searchBox()
        XCTAssertTrue(box.waitForExistence(timeout: 20), "no search box")
        tapOnScreen(box)
        box.typeText(fragment)
        skipTheTour(waiting: 3)
        guard let row = resultRow(labelled: word, below: box, waiting: 30) else {
            return XCTFail("no results for \(fragment)")
        }
        keep("2-search")

        // Open the word: its meaning comes from the definitions file, read in place. While
        // the box has the focus, a tap on a word only puts the keyboard away (the app's rule:
        // the list moves as the keyboard closes, so the tap could land on another word), so
        // a person taps it again once the keyboard has gone.
        let tapped = "\(row.elementType.rawValue) '\(row.label)' at \(row.frame); the box at \(box.frame)"
        tapOnScreen(row)
        let keyboardGone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 0"), object: app.keyboards)
        let gone = XCTWaiter().wait(for: [keyboardGone], timeout: 10)
        keep("2b-first-tap")
        let focused = (box.value(forKey: "hasKeyboardFocus") as? Bool).map(String.init) ?? "unknown"
        XCTAssertEqual(gone, .completed, "the keyboard stayed up after a tap on \(tapped); the box focused: \(focused)")
        guard let rowAgain = resultRow(labelled: word, below: box, waiting: 10) else {
            return XCTFail("the results went with the keyboard")
        }
        tapOnScreen(rowAgain) // found afresh: the list moved as the keyboard closed
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

    /// A row of the results named `label`: the first thing of that name below the search
    /// box. Not simply the first on the page: typed in full, the word is also the text in
    /// the box, which comes first and is no result.
    private func resultRow(labelled label: String, below box: XCUIElement, waiting seconds: TimeInterval) -> XCUIElement? {
        let named = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", label))
        let deadline = Date().addingTimeInterval(seconds)
        repeat {
            let floor = box.frame.maxY
            let row = named.allElementsBoundByIndex.first { $0.exists && !$0.frame.isEmpty && $0.frame.minY >= floor }
            if let row { return row }
            Thread.sleep(forTimeInterval: 0.5)
        } while Date() < deadline
        return nil
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
