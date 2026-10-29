#!/usr/bin/env bash
# One-time setup for publishing Android releases. Run it from your clone, on your
# own computer, after `gh auth login`:
#
#   bash scripts/setup-release.sh path/to/headwords.bin
#
# It does three things:
#   1. Creates the app's signing key in ~/.dictionarius/ (only if there isn't one yet).
#   2. Stores the key in the repository's GitHub Actions secrets, so the release
#      workflow can sign APKs. The key itself stays on this computer and in GitHub.
#   3. Uploads the data every APK bundles: the word index and, next to it, its
#      definitions (headwords.definitions.bin), as a GitHub release named
#      data-<first 8 characters of data/headwords.sha256's own checksum>.
#
# Running it again is safe: it reuses the key and skips data that's already uploaded.
set -euo pipefail

index_file="${1:-dist/headwords.bin}"
definitions_file="${index_file%.bin}.definitions.bin"   # the builder writes it next to the index
key_dir="$HOME/.dictionarius"
keystore="$key_dir/release.p12"
password_file="$key_dir/release-password.txt"
key_alias="dictionarius"

# --- Check the tools and inputs ---
for tool in gh openssl; do
  if ! command -v "$tool" > /dev/null; then
    echo "Missing '$tool'. Install it, then run this again." >&2
    exit 1
  fi
done
if [ ! -f "$index_file" ]; then
  echo "No word index at '$index_file'. Pass its path: bash scripts/setup-release.sh path/to/headwords.bin" >&2
  exit 1
fi
if [ ! -f data/headwords.sha256 ]; then
  echo "Run this from the top folder of your Dictionarius clone." >&2
  exit 1
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
echo "Repository: $repo"

# --- 1. The signing key ---
# Android only installs an update signed with the same key as the installed app,
# so this key must never change or be lost.
if [ -f "$keystore" ]; then
  echo "Using your existing signing key: $keystore"
else
  echo "Creating a signing key: $keystore"
  mkdir -p "$key_dir"
  chmod 700 "$key_dir"

  # A random password, kept in a file only you can read
  openssl rand -base64 32 | tr -d '\n' > "$password_file"
  chmod 600 "$password_file"

  # A self-signed certificate valid for 30 years (Android asks for at least 25),
  # packed with its private key into a password-protected PKCS#12 keystore
  openssl req -x509 -newkey rsa:4096 -sha256 -days 10950 -nodes \
    -subj "/CN=Dictionarius" \
    -keyout "$key_dir/key.pem" -out "$key_dir/cert.pem" 2> /dev/null
  openssl pkcs12 -export -name "$key_alias" \
    -inkey "$key_dir/key.pem" -in "$key_dir/cert.pem" \
    -out "$keystore" -passout "file:$password_file"
  rm "$key_dir/key.pem" "$key_dir/cert.pem"
  chmod 600 "$keystore"
fi

# --- 2. GitHub Actions secrets ---
echo "Saving the key in $repo's Actions secrets"
openssl base64 -A -in "$keystore" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$repo"
gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$repo" < "$password_file"
gh secret set ANDROID_KEY_PASSWORD --repo "$repo" < "$password_file"
gh secret set ANDROID_KEY_ALIAS --repo "$repo" --body "$key_alias"

# --- 3. The word index and its definitions ---
# data/headwords.sha256 lists the checksum of each data file releases are built with.
check_file() {
  name="$1"   # its name in the checksum list
  path="$2"   # where it is on this computer
  expected=$(grep " $name\$" data/headwords.sha256 | cut -d' ' -f1)
  if [ -z "$expected" ]; then
    echo "data/headwords.sha256 has no line for $name." >&2
    exit 1
  fi
  if [ ! -f "$path" ]; then
    echo "Missing $path (the index builder writes it next to the index)." >&2
    exit 1
  fi
  actual=$(openssl dgst -sha256 -r "$path" | cut -d' ' -f1)
  if [ "$actual" != "$expected" ]; then
    echo "$path doesn't match data/headwords.sha256:" >&2
    echo "  expected $expected" >&2
    echo "  got      $actual" >&2
    echo "If you rebuilt it on purpose, put the new checksums in data/headwords.sha256:" >&2
    echo "  shasum -a 256 headwords.bin headwords.definitions.bin > data/headwords.sha256" >&2
    exit 1
  fi
}
check_file headwords.bin "$index_file"
check_file headwords.definitions.bin "$definitions_file"

# One release per set of data files, named after the checksum list's own checksum.
list_sum=$(openssl dgst -sha256 -r data/headwords.sha256 | cut -d' ' -f1)
tag="data-${list_sum:0:8}"
if gh release view "$tag" --repo "$repo" > /dev/null 2>&1; then
  echo "The data is already uploaded ($tag)"
else
  echo "Uploading the word index and definitions as release $tag"
  # The release workflow looks for files named exactly like this.
  upload_dir=$(mktemp -d)
  cp "$index_file" "$upload_dir/headwords.bin"
  cp "$definitions_file" "$upload_dir/headwords.definitions.bin"
  notes="The English word index and definitions that Dictionarius app builds bundle. Not an app download.

Words and definitions from [Wiktionary](https://en.wiktionary.org), by Wiktionary contributors, via [wiktextract](https://github.com/tatuylonen/wiktextract). Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); normalized, indexed and packed by scripts/build_fm_index.py.

SHA-256:
\`\`\`
$(cat data/headwords.sha256)
\`\`\`"
  # A pre-release, so it never shows up as the app's latest release (or in Obtainium)
  gh release create "$tag" "$upload_dir/headwords.bin" "$upload_dir/headwords.definitions.bin" --repo "$repo" \
    --prerelease --latest=false \
    --title "App data ${list_sum:0:8}" --notes "$notes"
  rm -r "$upload_dir"
fi

echo
echo "Done. Back up the folder $key_dir (the key and its password) somewhere safe."
echo "If it's lost, installed copies of the app can't be updated: everyone would have to uninstall first."
