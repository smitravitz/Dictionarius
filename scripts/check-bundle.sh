#!/usr/bin/env bash
# Check an Android app bundle (.aab) tells Google Play to leave the definitions and their
# layers uncompressed in the APKs it makes, so the app can read a block where it lies
# (RangedAssets.java; noCompress in android/app/build.gradle).
#
#   bash scripts/check-bundle.sh path/to/app.aab
set -euo pipefail

bundle="$1"

# The bundle's settings (BundleConfig.pb) list what stays uncompressed, as patterns. The
# build tools may write each letter as a pair, [dD][eE]…, to match either case, so pairs are
# folded back to one letter before looking.
patterns=$(unzip -p "$bundle" BundleConfig.pb | strings | sed 's/\[\(.\).\]/\1/g')

failed=0
for kind in definitions examples etymology pronunciation; do
  if grep -qi "$kind\.bin" <<< "$patterns"; then
    echo "$kind.bin: left uncompressed"
  else
    echo "::error::the app bundle doesn't keep $kind.bin uncompressed, so Google Play's APKs couldn't read it in place"
    failed=1
  fi
done
exit "$failed"
