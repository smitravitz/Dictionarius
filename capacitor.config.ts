import type { CapacitorConfig } from "@capacitor/cli";

// The native app shells (Android now, iOS later) load the web build from build/web.
const config: CapacitorConfig = {
  appId: "io.github.smitravitz.dictionarius",
  appName: "Dictionarius",
  webDir: "build/web",
  plugins: {
    SystemBars: {
      // The page draws behind the status and navigation bars (viewport-fit=cover)
      // and pads itself with env(safe-area-inset-*).
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
