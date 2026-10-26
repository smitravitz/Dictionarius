#!/usr/bin/env bash
# Download the public benchmark datasets into bench/data/ (git-ignored).
#
#   words    dwyl/english-words "words_alpha.txt" — ~370k English words (Unlicense)
#   webster  Webster's 1913 dictionary as JSON — ~102k entries (public domain)
#
# Usage:  bash bench/fetch_data.sh [words|webster|all]     (default: all)

set -euo pipefail

which_data="${1:-all}"

# Work out where bench/data/ is, no matter where the script is run from.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data_dir="$script_dir/data"
mkdir -p "$data_dir"

words_url="https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt"
webster_url="https://raw.githubusercontent.com/matthewreagan/WebstersEnglishDictionary/master/dictionary_compact.json"

# Download one file, skipping it if it is already there.
fetch() {
  local url="$1"
  local target="$2"
  if [ -s "$target" ]; then
    echo "already have $(basename "$target")"
    return
  fi
  echo "downloading $(basename "$target") ..."
  curl --fail --silent --show-error --location --output "$target" "$url"
}

if [ "$which_data" = "words" ] || [ "$which_data" = "all" ]; then
  fetch "$words_url" "$data_dir/words_alpha.txt"
fi

if [ "$which_data" = "webster" ] || [ "$which_data" = "all" ]; then
  fetch "$webster_url" "$data_dir/webster.json"
fi

echo "data ready in $data_dir"
