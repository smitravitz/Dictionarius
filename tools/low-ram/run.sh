#!/usr/bin/env bash
# Tests Dictionarius on an emulated cheap phone (2 GB, then 1.5 GB of memory, 2 cores),
# inside Docker. Results (numbers, screenshots, a scroll video, logs) land in
# low-ram-results/ next to where you run it.
# Run: bash tools/low-ram/run.sh        (or with an APK of your own: APK=path/to.apk bash tools/low-ram/run.sh)

set -euo pipefail   # stop at the first failed command instead of carrying on

# Settings: change these, or set them when you run it (RAM_SIZES="1024" bash tools/low-ram/run.sh)
ram_sizes="${RAM_SIZES:-2048 1536}"   # memory in MB for each run, one emulator start per size
core_count="${CORES:-2}"              # CPU cores the phone gets
release_tag="${APK_TAG:-}"            # a release such as v0.6.3; empty means the newest
own_apk="${APK:-}"                    # an APK file to test instead of a release's

image_name="dictionarius-low-ram"
script_folder="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # where this script and the Dockerfile are
results_folder="$PWD/low-ram-results"

# Step 1: check this machine can run it.
# The emulator needs KVM, the Linux kernel's support for running virtual machines fast.
if ! command -v docker > /dev/null; then   # command -v checks Docker is installed; > /dev/null hides its path
  echo "Docker isn't installed: https://docs.docker.com/engine/install/ubuntu/" >&2   # >&2 sends it to the error stream
  exit 1
fi
if [[ ! -e /dev/kvm ]]; then
  echo "No /dev/kvm: turn on virtualisation (VT-x or AMD-V) in your BIOS/UEFI settings." >&2
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This needs an x86_64 machine (the emulator's system image is x86_64)." >&2
  exit 1
fi

# Step 2: build the image (the first time takes a while: it downloads about 2 GB).
docker build -t "$image_name" "$script_folder"

# Step 3: run the tests in a fresh container, KVM passed in, results written out here.
mkdir -p "$results_folder"
docker_options=(--rm --device /dev/kvm -v "$results_folder:/results")
docker_options+=(-e "RAM_SIZES=$ram_sizes" -e "CORES=$core_count" -e "APK_TAG=$release_tag")
# What it's running on, for the summary: the CPU, its threads, the memory, Docker's version.
host_cpu="$(sed -n -E 's/^model name\s*:\s*(.*)/\1/p' /proc/cpuinfo | sed -n 1p)"
host_ram_mb="$(( $(sed -n -E 's/^MemTotal: *([0-9]+).*/\1/p' /proc/meminfo) / 1024 ))"
docker_options+=(-e "HOST_CPU=$host_cpu" -e "HOST_CORES=$(nproc)" -e "HOST_RAM_MB=$host_ram_mb")
docker_options+=(-e "DOCKER_VERSION=$(docker version --format '{{.Server.Version}}')")
if [[ -n "$own_apk" ]]; then
  # Your own APK, readable inside the container at /app.apk.
  apk_path="$(cd "$(dirname "$own_apk")" && pwd)/$(basename "$own_apk")"
  docker_options+=(-v "$apk_path:/app.apk:ro")
fi
docker run "${docker_options[@]}" "$image_name"

echo
echo "Done. The summary: $results_folder/summary.txt"
