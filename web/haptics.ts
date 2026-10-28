/**
 * Small vibrations for the position slider. In the app, the platform's own
 * haptics (crisp ticks); in a browser, the Vibration API where it exists
 * (Android Chrome); elsewhere, nothing.
 */
import { Capacitor } from "@capacitor/core";

type Plugin = typeof import("@capacitor/haptics");
let plugin: Plugin | null = null;
if (Capacitor.isNativePlatform()) {
  void import("@capacitor/haptics").then((p) => (plugin = p));
}

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed here (no user gesture yet, or blocked): stay silent.
  }
};

/** A selection started: one soft pulse. */
export function pulse() {
  if (plugin) {
    void plugin.Haptics.impact({ style: plugin.ImpactStyle.Light });
    void plugin.Haptics.selectionStart();
  } else vibrate(15);
}

/** The selection moved one step. */
export function tick() {
  if (plugin) void plugin.Haptics.selectionChanged();
  else vibrate(5);
}

/** The selection ended. */
export function release() {
  if (plugin) void plugin.Haptics.selectionEnd();
}
