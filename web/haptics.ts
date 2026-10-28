/**
 * Small vibrations for the position slider. In the app, the platform's own
 * haptics through a tiny local plugin (plugins/haptic-tick) that needs no
 * permission: View.performHapticFeedback on Android, UIFeedbackGenerator on
 * iOS. In a browser, the Vibration API where it exists (Android Chrome);
 * elsewhere, nothing.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface HapticTick {
  /** A hold that opened something: one soft pulse. */
  pulse(): Promise<void>;
  /** One step along a scale. */
  tick(): Promise<void>;
}

const native = Capacitor.isNativePlatform() ? registerPlugin<HapticTick>("HapticTick") : null;

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed here (no user gesture yet, or blocked): stay silent.
  }
};

/** A selection started: one soft pulse. */
export function pulse() {
  if (native) void native.pulse().catch(() => {});
  else vibrate(15);
}

/** The selection moved one step. */
export function tick() {
  if (native) void native.tick().catch(() => {});
  else vibrate(5);
}

/** The selection ended: nothing to feel. */
export function release() {}
