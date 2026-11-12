import type { CapacitorConfig } from "@capacitor/cli";

// The native app shells (android/ and ios/) load the web build from build/web.
const config: CapacitorConfig = {
  appId: "io.github.smitravitz.dictionarius",
  appName: "Dictionarius",
  webDir: "build/web",
  ios: {
    // The dark paper (web/styles.css) behind the page until it draws: the app starts dark,
    // and a web view is white until then (test/web-app.test.ts keeps the two the same).
    backgroundColor: "#0e1420",
  },
  plugins: {
    SystemBars: {
      // The page draws behind the status and navigation bars (viewport-fit=cover)
      // and pads itself with env(safe-area-inset-*).
      initialViewportFitValueHint: "cover",
      // Light icons from launch: the app starts dark (web/theme-choice.ts); web/theme.ts
      // turns them dark if light is picked.
      style: "DARK",
    },
  },
};

export default config;
