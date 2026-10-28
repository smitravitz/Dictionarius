#!/usr/bin/env python3
"""Check the app against its privacy budget (privacy.toml).

  python scripts/audit_privacy.py                      # the source tree
  python scripts/audit_privacy.py --apk app-debug.apk  # and the permissions a built APK requests

It looks for:
  - Android permissions beyond the budget: in the app's manifest, in the manifests of the
    Capacitor plugins it depends on, and (with --apk) in the APK itself, which also shows
    what androidx and other libraries merge in;
  - known tracking or non-free libraries in package.json and Gradle files;
  - network use in the app's code: every http(s) URL must point at a host the budget lists,
    and anything the app loads or requests by itself (fetch, <script src>, a web font, a CSS
    url()) must point at one of network.hosts, not just network.links;
  - a Content-Security-Policy that keeps the WebView offline when the budget allows no hosts;
  - Android settings that leak data or hurt F-Droid builds (cloud backup, debuggable,
    cleartext traffic, Google's dependency-info block).

Exits with 1 when anything breaks the budget, so CI can stop the build. Standard library
only (Python 3.11+); reading an APK needs aapt2 (Android build-tools) or androguard.
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from typing import NamedTuple

# Known tracking or non-free libraries (F-Droid flags or rejects these). Not exhaustive.
NPM_BLOCKLIST = (
    "firebase", "@firebase/", "@capacitor-firebase/", "@capacitor/push-notifications",
    "@capacitor/google-maps", "@sentry/", "@bugsnag/", "@datadog/", "posthog-js",
    "mixpanel-browser", "@amplitude/", "@segment/", "react-ga", "logrocket", "@vercel/analytics",
    "@react-native-firebase/", "onesignal", "@onesignal/", "appsflyer", "@newrelic/",
)
GRADLE_BLOCKLIST = (
    "com.google.android.gms", "com.google.firebase", "com.crashlytics", "com.google.android.play",
    "com.google.mlkit", "com.huawei.hms", "com.facebook", "com.appsflyer", "com.adjust",
    "io.branch", "com.onesignal", "com.mixpanel", "com.amplitude", "com.segment", "io.sentry",
    "com.bugsnag", "com.newrelic", "com.datadoghq", "com.microsoft.appcenter", "com.flurry",
    "com.applovin", "com.unity3d.ads",
)
# URLs that name a format, not a server.
NAMESPACE_HOSTS = {"www.w3.org", "schemas.android.com", "schemas.microsoft.com", "ns.adobe.com", "purl.org"}
SOURCE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css", ".vue", ".svelte")

URL = re.compile(r"""https?://([A-Za-z0-9.-]+)[^\s"'`)<>]*""")
# The app loads or requests these by itself, without a tap.
AUTOMATIC = [
    re.compile(r"""<(?:script|img|iframe|source|audio|video|embed)\b[^>]*\bsrc\s*=\s*["']?https?://([A-Za-z0-9.-]+)""", re.I),
    re.compile(r"""<link\b[^>]*\bhref\s*=\s*["']?https?://([A-Za-z0-9.-]+)""", re.I),
    re.compile(r"""(?:url\(|@import\s+)["']?https?://([A-Za-z0-9.-]+)""", re.I),
    re.compile(r"""(?:fetch|sendBeacon|importScripts|import|new\s+(?:WebSocket|EventSource|Worker))\s*\(\s*["'`]https?://([A-Za-z0-9.-]+)"""),
    re.compile(r"""\.open\(\s*["'`][A-Z]+["'`]\s*,\s*["'`]https?://([A-Za-z0-9.-]+)"""),  # XMLHttpRequest
]
USES_PERMISSION = re.compile(r"<uses-permission(?:-sdk-23)?\b([^>]*)/?>", re.S)
ATTR = re.compile(r"""([\w:]+)\s*=\s*["']([^"']*)["']""")


class Finding(NamedTuple):
    level: str  # "error" (breaks the budget) or "warning"
    what: str
    where: str
    fix: str


def load_budget(root):
    path = os.path.join(root, "privacy.toml")
    with open(path, "rb") as f:
        data = tomllib.load(f)
    return {
        "permissions": set(data.get("android", {}).get("permissions", [])),
        "usage_descriptions": set(data.get("ios", {}).get("usage_descriptions", [])),
        "hosts": set(data.get("network", {}).get("hosts", [])),
        "links": set(data.get("network", {}).get("links", [])),
        "sources": data.get("audit", {}).get("sources", ["web", "src"]),
    }


def rel(root, path):
    return os.path.relpath(path, root)


def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def manifest_permissions(text):
    """(requested, removed) permission names in a manifest's text."""
    requested, removed = set(), set()
    for m in USES_PERMISSION.finditer(text):
        attrs = dict(ATTR.findall(m.group(1)))
        name = attrs.get("android:name")
        if not name:
            continue
        (removed if attrs.get("tools:node") == "remove" else requested).add(name)
    return requested, removed


def plugin_manifests(root):
    """Android manifests of the npm dependencies that ship native code (Capacitor plugins)."""
    pkg_path = os.path.join(root, "package.json")
    if not os.path.exists(pkg_path):
        return []
    deps = json.loads(read(pkg_path)).get("dependencies", {})
    out = []
    for name, spec in deps.items():
        base = os.path.join(root, spec[5:]) if spec.startswith("file:") else os.path.join(root, "node_modules", name)
        for candidate in glob.glob(os.path.join(base, "android", "**", "src", "main", "AndroidManifest.xml"), recursive=True):
            out.append((name, candidate))
    return out


def check_manifests(root, budget):
    findings = []
    app_manifests = glob.glob(os.path.join(root, "android", "app", "src", "*", "AndroidManifest.xml"))
    removed = set()
    for path in app_manifests:
        text = read(path)
        requested, gone = manifest_permissions(text)
        removed |= gone
        for p in sorted(requested - budget["permissions"]):
            findings.append(Finding("error", f"requests {p}, which privacy.toml doesn't allow", rel(root, path),
                                    "remove it, and the code that needs it, or add it to privacy.toml on purpose"))
        attrs = dict(ATTR.findall(text[text.find("<application"):text.find(">", text.find("<application"))]))
        if attrs.get("android:allowBackup", "true") == "true" and "android:dataExtractionRules" not in attrs:
            findings.append(Finding("warning", "allowBackup is on: Android may copy app data to the vendor's cloud",
                                    rel(root, path), 'android:allowBackup="false" or dataExtractionRules without cloud-backup'))
        if attrs.get("android:debuggable") == "true":
            findings.append(Finding("error", "the app is debuggable", rel(root, path), "remove android:debuggable"))
        if attrs.get("android:usesCleartextTraffic") == "true":
            findings.append(Finding("error", "cleartext (http) traffic is allowed", rel(root, path),
                                    'remove android:usesCleartextTraffic="true"'))
    for name, path in plugin_manifests(root):
        requested, _ = manifest_permissions(read(path))
        for p in sorted(requested - removed - budget["permissions"]):
            findings.append(Finding("error", f"dependency {name} adds {p}, which privacy.toml doesn't allow", rel(root, path),
                                    "use a permission-free alternative, or remove it in the app manifest with "
                                    'tools:node="remove" once nothing calls it'))
    for path in glob.glob(os.path.join(root, "android", "app", "build.gradle*")):
        if not re.search(r"includeInApk\s*=?\s*false", read(path)):
            findings.append(Finding("warning", "Google's dependency-info block goes into the APK; F-Droid can't verify it",
                                    rel(root, path), "dependenciesInfo { includeInApk = false; includeInBundle = false }"))
    return findings


def check_dependencies(root):
    findings = []
    pkg_path = os.path.join(root, "package.json")
    if os.path.exists(pkg_path):
        for name in json.loads(read(pkg_path)).get("dependencies", {}):
            if any(name == b or (b.endswith("/") and name.startswith(b)) or name.startswith(b + "-") for b in NPM_BLOCKLIST):
                findings.append(Finding("error", f"{name} is a tracking or non-free library", "package.json",
                                        "remove it; F-Droid flags or rejects apps that ship it"))
    for path in glob.glob(os.path.join(root, "android", "**", "*.gradle*"), recursive=True):
        if "/build/" in path:
            continue
        text = read(path)
        for group in GRADLE_BLOCKLIST:
            if re.search(r"""["']""" + re.escape(group) + r"[.:]", text):
                findings.append(Finding("error", f"{group} is a tracking or non-free library", rel(root, path),
                                        "remove it; F-Droid flags or rejects apps that ship it"))
    return findings


def source_files(root, budget):
    for top in budget["sources"]:
        for dirpath, dirnames, filenames in os.walk(os.path.join(root, top)):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", "build")]
            for name in filenames:
                if name.endswith(SOURCE_EXTENSIONS) and ".test." not in name and ".spec." not in name:
                    yield os.path.join(dirpath, name)


def check_network(root, budget):
    findings = []
    allowed = budget["hosts"] | budget["links"]
    for path in source_files(root, budget):
        text = read(path)
        for n, line in enumerate(text.splitlines(), 1):
            where = f"{rel(root, path)}:{n}"
            automatic = {m.group(1).lower() for pattern in AUTOMATIC for m in pattern.finditer(line)}
            for host in sorted(automatic - budget["hosts"]):
                findings.append(Finding("error", f"loads or requests {host} by itself", where,
                                        "bundle the file in the app, or add the host to network.hosts on purpose"))
            for m in URL.finditer(line):
                host = m.group(1).lower()
                if host in NAMESPACE_HOSTS or host in automatic or host in allowed:
                    continue
                findings.append(Finding("error", f"points at {host}, which privacy.toml doesn't list", where,
                                        "remove it, or list it under network.links (a link the user taps) or network.hosts"))
    return findings


CSP = re.compile(r"""<meta[^>]+http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*content\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)


def check_csp(root, budget):
    """With no hosts allowed, every page needs a CSP whose connect-src (or default-src) is 'self'."""
    if budget["hosts"]:
        return []
    findings = []
    for path in source_files(root, budget):
        if not path.endswith(".html"):
            continue
        m = CSP.search(read(path))
        directives = {}
        if m:
            for part in (m.group(1) or m.group(2)).split(";"):
                words = part.split()
                if words:
                    directives[words[0]] = words[1:]
        sources = directives.get("connect-src", directives.get("default-src"))
        if sources is None or set(sources) - {"'self'", "'none'"}:
            findings.append(Finding("error", "no Content-Security-Policy keeps this page offline", rel(root, path),
                                    "add <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'self'; ...\">"))
    return findings


def parse_aapt2_permissions(text):
    """Requested permissions from `aapt2 dump permissions` output."""
    out = set()
    for line in text.splitlines():
        m = re.match(r"\s*uses-permission(?:-sdk-23)?:\s*name='([^']+)'", line)
        if m:
            out.add(m.group(1))
    return out


def apk_permissions(apk):
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    tools = sorted(glob.glob(os.path.join(sdk, "build-tools", "*", "aapt2"))) if sdk else []
    aapt2 = tools[-1] if tools else shutil.which("aapt2")
    if aapt2:
        out = subprocess.run([aapt2, "dump", "permissions", apk], capture_output=True, text=True, check=True)
        return parse_aapt2_permissions(out.stdout)
    try:
        from androguard.core.apk import APK
    except ImportError:
        sys.exit("reading an APK needs aapt2 (Android build-tools) or androguard (pip install androguard)")
    return set(APK(apk).get_permissions())


def check_apk(permissions, budget, apk):
    return [Finding("error", f"the APK requests {p}, which privacy.toml doesn't allow", apk,
                    'find what merges it in (a library\'s manifest) and remove it with tools:node="remove" '
                    "once nothing needs it, or add it to privacy.toml on purpose")
            for p in sorted(permissions - budget["permissions"])]


def audit(root, apk=None):
    budget = load_budget(root)
    findings = check_manifests(root, budget) + check_dependencies(root) + check_network(root, budget) + check_csp(root, budget)
    if apk:
        findings += check_apk(apk_permissions(apk), budget, apk)
    return findings


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".", help="the repository (default: here)")
    ap.add_argument("--apk", help="a built APK whose permissions to check too")
    args = ap.parse_args()
    findings = audit(args.root, args.apk)
    for f in sorted(findings, key=lambda f: f.level != "error"):
        print(f"{f.level.upper():8}{f.where}: {f.what}\n        fix: {f.fix}")
    errors = sum(f.level == "error" for f in findings)
    warnings = len(findings) - errors
    print(f"privacy audit: {errors} error(s), {warnings} warning(s)" + (" (APK checked)" if args.apk else ""))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
