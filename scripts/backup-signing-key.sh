#!/usr/bin/env bash
# Backs up ~/.dictionarius (the app's signing key and its password) as an encrypted, numbered file:
# dictionarius-key-v1-2026-10-28.tar.gz.enc, then v2, v3… Android only installs updates signed with
# this same key, and GitHub secrets can't be read back, so keep a copy somewhere other than this computer.
# Run: bash scripts/backup-signing-key.sh   (it asks for a passphrase; remember it, it isn't stored)
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -in BACKUP_FILE | tar -xzf - -C "$HOME"

set -euo pipefail   # stop at the first failed command instead of carrying on

key_folder="$HOME/.dictionarius"          # what setup-release.sh created
backup_folder="$HOME/Documents/dictionarius-backups" # where backups go; point it at a USB drive or synced folder

# Step 1: make sure there's a key to back up.
if [[ ! -d "$key_folder" ]]; then
  echo "Folder not found: $key_folder" >&2   # >&2 sends the message to the error stream
  exit 1
fi
mkdir -p "$backup_folder"

# Step 2: pick the next version number: the first one no backup has yet, so nothing is overwritten.
version=1
today=$(date +%Y-%m-%d)
while ls "$backup_folder"/dictionarius-key-v"$version"-*.tar.gz.enc >/dev/null 2>&1; do   # 2>&1 hides "no such file"
  version=$((version + 1))
done
backup_file="$backup_folder/dictionarius-key-v$version-$today.tar.gz.enc"

# Step 3: pack the folder and encrypt it. openssl asks for the passphrase twice.
# -pbkdf2 turns the passphrase into the key slowly, so guessing it is slow too.
tar -C "$HOME" -czf - .dictionarius |   # -C: pack the folder by its own name, not the full path
  openssl enc -aes-256-cbc -pbkdf2 -salt -out "$backup_file"

# Step 4: prove the backup opens before trusting it: decrypt it and list what's inside.
echo "Checking the backup (enter the passphrase once more):"
openssl enc -d -aes-256-cbc -pbkdf2 -in "$backup_file" | tar -tzf -

echo "Saved backup v$version: $backup_file"
