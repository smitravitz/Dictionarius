# dictionarius-haptic-tick

A tiny Capacitor plugin for the position slider's haptics, made so the app needs no permission.

| Call | Android | iOS |
|---|---|---|
| `pulse()` | `HapticFeedbackConstants.LONG_PRESS` | `UIImpactFeedbackGenerator(style: .light)` |
| `tick()` | `HapticFeedbackConstants.CLOCK_TICK` | `UISelectionFeedbackGenerator` |

Android's `View.performHapticFeedback` doesn't need the VIBRATE permission (unlike `Vibrator`, which
`@capacitor/haptics` uses), and it follows the phone's own "touch feedback" setting. iOS haptics
never need a permission.

It lives in this repository and is installed from it (`"dictionarius-haptic-tick": "file:plugins/haptic-tick"`).
The web code registers it with `registerPlugin("HapticTick")`; see `web/haptics.ts`.
