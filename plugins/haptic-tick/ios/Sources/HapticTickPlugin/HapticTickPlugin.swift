import Capacitor
import UIKit

/// Haptic feedback for the position slider. iOS haptics need no permission.
@objc(HapticTickPlugin)
public class HapticTickPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticTickPlugin"
    public let jsName = "HapticTick"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pulse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tick", returnType: CAPPluginReturnPromise)
    ]

    // Created on first use, on the main thread, like all UIKit objects.
    private var impact: UIImpactFeedbackGenerator?
    private var selection: UISelectionFeedbackGenerator?

    /// A hold that opened something: one light tap, and get ready for ticks.
    @objc public func pulse(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let impact = self.impact ?? UIImpactFeedbackGenerator(style: .light)
            let selection = self.selection ?? UISelectionFeedbackGenerator()
            self.impact = impact
            self.selection = selection
            impact.impactOccurred()
            selection.prepare()
        }
        call.resolve()
    }

    /// One step along a scale: the picker-wheel tick.
    @objc public func tick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let selection = self.selection ?? UISelectionFeedbackGenerator()
            self.selection = selection
            selection.selectionChanged()
            selection.prepare()
        }
        call.resolve()
    }
}
