"""Tests for the privacy audit (scripts/audit_privacy.py).

Run: python -m unittest scripts/test_audit_privacy.py
Each test builds a small made-up project in a temporary folder.
"""

import json
import os
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import audit_privacy  # noqa: E402

BUDGET = """
[android]
permissions = []
[network]
hosts = []
links = ["en.wiktionary.org"]
"""
MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application android:allowBackup="false" android:label="x">
    </application>
    {permissions}
</manifest>
"""
PAGE = """<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src 'self' data:">
{head}
</head><body>{body}</body></html>
"""
PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>{keys}</dict></plist>
"""
PRIVACY_MANIFEST = PLIST.format(keys="<key>NSPrivacyTracking</key><false/>"
                                "<key>NSPrivacyTrackingDomains</key><array/>"
                                "<key>NSPrivacyCollectedDataTypes</key><array/>"
                                "<key>NSPrivacyAccessedAPITypes</key><array/>")
GRADLE = "android { dependenciesInfo { includeInApk = false\n includeInBundle = false } }\n"


class Project:
    """A clean, offline project to break one way at a time."""

    def __init__(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = self.dir.name
        self.write("privacy.toml", BUDGET)
        self.write("package.json", json.dumps({"dependencies": {"@capacitor/core": "^8.0.0"}}))
        self.write("android/app/src/main/AndroidManifest.xml", MANIFEST.format(permissions=""))
        self.write("android/app/build.gradle", GRADLE)
        self.write("web/index.html", PAGE.format(head="", body=""))
        self.write("web/main.ts", 'const words = await fetch("words.json");\n')

    def write(self, path, text):
        full = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(textwrap.dedent(text))

    def add_ios(self, info="", manifest=PRIVACY_MANIFEST, project="PrivacyInfo.xcprivacy in Resources"):
        """The iOS app: its Info.plist, its privacy manifest and the Xcode project that packs it."""
        self.write("ios/App/App/Info.plist", PLIST.format(keys="<key>CFBundleName</key><string>x</string>" + info))
        if manifest is not None:
            self.write("ios/App/App/PrivacyInfo.xcprivacy", manifest)
        self.write("ios/App/App.xcodeproj/project.pbxproj", f"// {project}\n")

    def errors(self):
        return [f.what for f in audit_privacy.audit(self.root) if f.level == "error"]

    def warnings(self):
        return [f.what for f in audit_privacy.audit(self.root) if f.level == "warning"]


class Audit(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.dir.cleanup()

    def test_a_clean_offline_project_passes(self):
        self.assertEqual(audit_privacy.audit(self.p.root), [])

    def test_a_permission_in_the_app_manifest(self):
        self.p.write("android/app/src/main/AndroidManifest.xml",
                     MANIFEST.format(permissions='<uses-permission android:name="android.permission.INTERNET" />'))
        self.assertEqual(self.p.errors(), ["requests android.permission.INTERNET, which privacy.toml doesn't allow"])

    def test_a_permission_the_budget_allows(self):
        self.p.write("privacy.toml", BUDGET.replace("permissions = []", 'permissions = ["android.permission.CAMERA"]'))
        self.p.write("android/app/src/main/AndroidManifest.xml",
                     MANIFEST.format(permissions='<uses-permission android:name="android.permission.CAMERA" />'))
        self.assertEqual(self.p.errors(), [])

    def test_a_plugin_adds_a_permission_unless_the_app_removes_it(self):
        self.p.write("package.json", json.dumps({"dependencies": {"@capacitor/haptics": "^8.0.0"}}))
        self.p.write("node_modules/@capacitor/haptics/android/src/main/AndroidManifest.xml",
                     '<manifest><uses-permission android:name="android.permission.VIBRATE" /></manifest>')
        self.assertEqual(self.p.errors(),
                         ["dependency @capacitor/haptics adds android.permission.VIBRATE, which privacy.toml doesn't allow"])
        self.p.write("android/app/src/main/AndroidManifest.xml", MANIFEST.format(
            permissions='<uses-permission android:name="android.permission.VIBRATE" tools:node="remove" />'))
        self.assertEqual(self.p.errors(), [])

    def test_a_local_plugin_is_checked_too(self):
        self.p.write("package.json", json.dumps({"dependencies": {"tick": "file:plugins/tick"}}))
        self.p.write("plugins/tick/android/src/main/AndroidManifest.xml",
                     '<manifest><uses-permission android:name="android.permission.VIBRATE"/></manifest>')
        self.assertEqual(len(self.p.errors()), 1)

    def test_tracking_and_non_free_libraries(self):
        self.p.write("package.json", json.dumps({"dependencies": {"firebase": "^12", "@sentry/capacitor": "^1", "vite": "^7"}}))
        self.p.write("android/app/build.gradle", GRADLE + 'dependencies { implementation "com.google.android.gms:play-services-location:21.0.0" }\n')
        self.assertEqual(sorted(self.p.errors()), [
            "@sentry/capacitor is a tracking or non-free library",
            "com.google.android.gms is a tracking or non-free library",
            "firebase is a tracking or non-free library",
        ])

    def test_a_web_font_is_an_automatic_request(self):
        self.p.write("web/index.html", PAGE.format(
            head='<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">', body=""))
        self.assertEqual(self.p.errors(), ["loads or requests fonts.googleapis.com by itself"])

    def test_a_request_to_a_server(self):
        self.p.write("web/main.ts", 'fetch("https://example.org/latest.json");\n'
                                    'navigator.sendBeacon("https://stats.example.com/hit", data);\n')
        self.assertEqual(self.p.errors(), ["loads or requests example.org by itself",
                                           "loads or requests stats.example.com by itself"])

    def test_a_link_the_user_taps_is_fine_if_listed(self):
        self.p.write("web/main.ts", 'link.href = `https://en.wiktionary.org/wiki/${word}`;\n')
        self.assertEqual(self.p.errors(), [])
        self.p.write("web/main.ts", 'link.href = "https://example.com/";\n')
        self.assertEqual(self.p.errors(), ["points at example.com, which privacy.toml doesn't list"])

    def test_a_listed_link_is_not_enough_to_load_from(self):
        self.p.write("web/index.html", PAGE.format(head="", body='<img src="https://en.wiktionary.org/logo.png">'))
        self.assertEqual(self.p.errors(), ["loads or requests en.wiktionary.org by itself"])

    def test_namespaces_and_tests_are_ignored(self):
        self.p.write("web/style.css", 'a { background: url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'/>"); }\n')
        self.p.write("web/main.test.ts", 'fetch("https://example.org/");\n')
        self.assertEqual(self.p.errors(), [])

    def test_an_offline_page_needs_a_content_security_policy(self):
        self.p.write("web/index.html", "<!doctype html><html><head></head><body></body></html>")
        self.assertEqual(self.p.errors(), ["no Content-Security-Policy keeps this page offline"])
        self.p.write("web/index.html", PAGE.replace("connect-src 'self'", "connect-src 'self' https://example.org")
                     .format(head="", body=""))
        self.assertIn("no Content-Security-Policy keeps this page offline", self.p.errors())

    def test_android_settings(self):
        self.p.write("android/app/src/main/AndroidManifest.xml",
                     MANIFEST.format(permissions="").replace('android:allowBackup="false"', 'android:allowBackup="true"'))
        self.p.write("android/app/build.gradle", "android { }\n")
        self.assertEqual(len(self.p.warnings()), 2)

    def test_a_clean_ios_app_passes(self):
        self.p.add_ios()
        self.assertEqual(self.p.errors(), [])

    def test_an_ios_usage_description_beyond_the_budget(self):
        self.p.add_ios(info="<key>NSCameraUsageDescription</key><string>To scan words</string>")
        self.assertEqual(self.p.errors(), ["declares NSCameraUsageDescription, which privacy.toml doesn't allow"])
        self.p.write("privacy.toml", BUDGET + '[ios]\nusage_descriptions = ["NSCameraUsageDescription"]\n')
        self.assertEqual(self.p.errors(), [])

    def test_ios_may_not_switch_off_transport_security(self):
        self.p.add_ios(info="<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>")
        self.assertEqual(self.p.errors(), ["App Transport Security is switched off (NSAllowsArbitraryLoads)"])

    def test_an_ios_app_needs_a_privacy_manifest_that_ships(self):
        self.p.add_ios(manifest=None)
        self.assertEqual(self.p.errors(), ["the iOS app has no privacy manifest (PrivacyInfo.xcprivacy)"])
        # Written, but not among the files Xcode packs into the app: Apple never sees it.
        self.p.add_ios(project="nothing")
        self.assertEqual(self.p.errors(), ["the privacy manifest isn't in the Xcode project, so it isn't in the app"])

    def test_an_ios_privacy_manifest_that_tracks_or_collects(self):
        self.p.add_ios(manifest=PRIVACY_MANIFEST.replace("<key>NSPrivacyTracking</key><false/>", "<key>NSPrivacyTracking</key><true/>"))
        self.assertEqual(self.p.errors(), ["the privacy manifest says the app tracks people (NSPrivacyTracking)"])
        self.p.add_ios(manifest=PRIVACY_MANIFEST.replace(
            "<key>NSPrivacyCollectedDataTypes</key><array/>",
            "<key>NSPrivacyCollectedDataTypes</key><array><dict><key>NSPrivacyCollectedDataType</key>"
            "<string>NSPrivacyCollectedDataTypeDeviceID</string></dict></array>"))
        self.assertEqual(self.p.errors(), ["the privacy manifest says the app collects data (NSPrivacyCollectedDataTypes)"])
        self.p.add_ios(manifest=PRIVACY_MANIFEST.replace(
            "<key>NSPrivacyTrackingDomains</key><array/>",
            "<key>NSPrivacyTrackingDomains</key><array><string>example.org</string></array>"))
        self.assertEqual(self.p.errors(), ["the privacy manifest lists tracking domains (NSPrivacyTrackingDomains)"])

    def test_reading_aapt2_output(self):
        text = ("package: io.example\n"
                "uses-permission: name='android.permission.INTERNET'\n"
                "permission: io.example.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION\n"
                "uses-permission: name='io.example.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'\n"
                "uses-permission-sdk-23: name='android.permission.CAMERA'\n")
        self.assertEqual(audit_privacy.parse_aapt2_permissions(text), {
            "android.permission.INTERNET", "io.example.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
            "android.permission.CAMERA"})

    def test_apk_permissions_beyond_the_budget(self):
        budget = audit_privacy.load_budget(self.p.root)
        found = audit_privacy.check_apk({"android.permission.VIBRATE"}, budget, "app.apk")
        self.assertEqual([f.what for f in found], ["the APK requests android.permission.VIBRATE, which privacy.toml doesn't allow"])


if __name__ == "__main__":
    unittest.main()
