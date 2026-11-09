#!/usr/bin/env bash
# Runs inside the container (tools/low-ram/Dockerfile): for each memory size, starts a
# fresh emulated phone, installs Dictionarius and puts it through the low-memory tests.
# Writes /results/summary.txt, plus screenshots, a scroll video and logs per size.

set -euo pipefail   # stop at the first failed command instead of carrying on

ram_sizes="${RAM_SIZES:-2048 1536}"
core_count="${CORES:-2}"
release_tag="${APK_TAG:-}"
app="io.github.smitravitz.dictionarius"
summary="/results/summary.txt"

# Step 1: the app. Your own APK if one was passed in, else a release's from GitHub.
if [[ -f /app.apk ]]; then
  cp /app.apk /tmp/app.apk
  apk_name="your APK"
else
  if [[ -n "$release_tag" ]]; then
    release_url="https://api.github.com/repos/smitravitz/Dictionarius/releases/tags/$release_tag"
  else
    release_url="https://api.github.com/repos/smitravitz/Dictionarius/releases/latest"
  fi
  # The release's APK: its download address, from the release's list of files.
  apk_url="$(curl -fsSL "$release_url" | jq -r '[.assets[] | select(.name | endswith(".apk"))][0].browser_download_url')"
  apk_name="$(basename "$apk_url")"
  echo "Downloading $apk_name"
  curl -fsSL -o /tmp/app.apk "$apk_url"
fi

# Small helpers, used by every run below.

# Saves what the screen shows now as <name>.png in this run's folder.
screenshot() {
  local name="$1"
  adb exec-out screencap -p > "$run_folder/$name.png"
}

# Opens the app and prints how long Android took to show it (TotalTime, in ms).
open_app() {
  adb shell am start -W -n "$app/.MainActivity" | sed -n -E 's/^TotalTime: *([0-9]+).*/\1/p'
}

# Saves the screen's accessibility tree (what's on screen, as text and boxes) and prints
# its path. A WebView's page shows up in it as ordinary text and fields.
screen_text() {
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null
  adb exec-out cat /sdcard/ui.xml > "$run_folder/ui.xml"
  echo "$run_folder/ui.xml"
}

# Types a search into the app's search field (found in the accessibility tree).
search_for() {
  local text="$1"
  local tree field bounds
  local -a numbers
  tree="$(screen_text)"
  # The first text field on screen, and its box: bounds="[left,top][right,bottom]".
  field="$(grep -oE '<node[^>]*class="android.widget.EditText"[^>]*>' "$tree" | sed -n 1p)"
  bounds="$(echo "$field" | sed -n -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/p')"
  if [[ -z "$bounds" ]]; then
    echo "  couldn't find the search field on screen" >&2
    return 1
  fi
  read -r -a numbers <<< "$bounds"
  adb shell input tap $(( (numbers[0] + numbers[2]) / 2 )) $(( (numbers[1] + numbers[3]) / 2 ))
  sleep 1
  adb shell input text "$text"
  sleep 3   # results, counted
}

# Prints a process's memory in MB (its proportional share, PSS: what it really costs).
memory_of() {
  local process="$1"
  local kilobytes
  kilobytes="$(adb shell dumpsys meminfo "$process" | sed -n -E 's/.*TOTAL PSS: *([0-9]+).*/\1/p' | sed -n 1p)"
  if [[ -z "$kilobytes" ]]; then
    echo "?"
  else
    echo $(( kilobytes / 1024 ))
  fi
}

# Prints the memory of the WebView's renderer processes in MB: the page runs there, not in
# the app's own process. They're the "sandboxed_process" ones (only this app uses one here).
webview_memory() {
  local total=0
  local pid megabytes
  for pid in $(adb shell ps -A -o PID,NAME | awk '/sandboxed_process/ {print $1}'); do
    megabytes="$(memory_of "$pid")"
    if [[ "$megabytes" != "?" ]]; then
      total=$(( total + megabytes ))
    fi
  done
  echo "$total"
}

# Says yes if the app's process is alive.
app_alive() {
  if adb shell pidof "$app" > /dev/null; then
    echo yes
  else
    echo no
  fi
}

# Says yes if the search typed earlier is still there (the app kept its place).
kept_search() {
  local tree
  tree="$(screen_text)"
  if grep -q 'text="eren"' "$tree"; then
    echo yes
  else
    echo no
  fi
}

{
  echo "Dictionarius on a low-memory phone: $apk_name, $core_count cores, $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "Timings come from an emulator on your PC's CPU: a real cheap phone is slower. Memory is realistic."
  echo
} > "$summary"

# Step 2: one fresh phone per memory size.
for ram in $ram_sizes; do
  run_folder="/results/ram-$ram"
  mkdir -p "$run_folder"
  echo "=== $ram MB, $core_count cores"

  # A headless phone (no window, software graphics), wiped so the app starts from scratch.
  emulator -avd lowram -memory "$ram" -cores "$core_count" -no-window -no-audio -no-boot-anim \
    -no-snapshot -wipe-data -gpu swiftshader_indirect > "$run_folder/emulator.log" 2>&1 &
  emulator_pid=$!

  # Wait until Android has finished starting (it says so in sys.boot_completed).
  adb wait-for-device
  waited=0
  until [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; do
    sleep 2
    waited=$(( waited + 2 ))
    if (( waited > 600 )); then
      echo "The phone didn't start in 10 minutes; see $run_folder/emulator.log" >&2
      exit 1
    fi
  done
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell wm dismiss-keyguard
  adb root > /dev/null   # Google APIs images allow root: needed to kill the app as Android would
  adb wait-for-device
  adb install -r /tmp/app.apk > /dev/null
  adb logcat -c   # from here on, the log is the app's run only

  # Test 1: a cold start, and how long until search is ready (the word count shows).
  echo "  cold start"
  adb shell am force-stop "$app"
  start_ms="$(open_app)"
  ready_after="not seen in 90 s"
  started=$SECONDS
  while (( SECONDS - started < 90 )); do
    if grep -qE '[0-9],[0-9]{3} words' "$(screen_text)"; then   # the word count, wherever it sits
      ready_after="$(( SECONDS - started )) s (±2)"
      break
    fi
    sleep 1
  done
  screenshot "1-start"

  # Test 2: a search, a scroll (filmed), a word opened; memory after.
  echo "  search, scroll, a word"
  search_ok=yes
  if ! search_for "eren"; then
    search_ok=no
  fi
  screenshot "2-results"
  adb shell input keyevent KEYCODE_ESCAPE   # put the keyboard away
  adb shell screenrecord --time-limit 8 /sdcard/scroll.mp4 &
  recorder_pid=$!
  for _ in 1 2 3 4 5 6; do   # six swipes up the list
    adb shell input swipe 540 1700 540 700 250
    sleep 1
  done
  wait "$recorder_pid" || true   # screenrecord can fail under software graphics; the rest carries on
  adb pull /sdcard/scroll.mp4 "$run_folder/3-scroll.mp4" > /dev/null || true
  adb shell input tap 540 1300   # a word in the middle of the list
  sleep 3
  screenshot "4-word"
  app_mb="$(memory_of "$app")"
  webview_mb="$(webview_memory)"
  adb shell input keyevent KEYCODE_BACK   # back to the list

  # Test 3: memory pressure while open: still running?
  echo "  memory pressure"
  adb shell am send-trim-memory "$app" RUNNING_CRITICAL
  sleep 3
  alive_after_pressure="$(app_alive)"
  screenshot "5-after-pressure"

  # Test 4: killed in the background (as Android's low-memory killer does: kill -9, no
  # warning), reopened. Search typed afresh first, so there's a place to keep.
  echo "  killed in the background"
  if ! search_for "eren"; then
    search_ok=no
  fi
  adb shell input keyevent KEYCODE_HOME
  sleep 2
  app_pid="$(adb shell pidof "$app" | tr -d '\r')"
  if [[ -n "$app_pid" ]]; then
    adb shell kill -9 "$app_pid"
  fi
  sleep 2
  killed="no"
  if [[ "$(app_alive)" == "no" ]]; then
    killed="yes"
  fi
  restart_ms="$(open_app)"
  sleep 6
  kept_after_kill="$(kept_search)"
  screenshot "6-reopened-after-kill"

  # Test 5: "Don't keep activities": Android throws the screen away whenever you leave it.
  echo "  don't keep activities"
  adb shell settings put global always_finish_activities 1
  adb shell am force-stop "$app"   # the setting holds for activities started after it
  open_app > /dev/null
  sleep 8
  if ! search_for "eren"; then
    search_ok=no
  fi
  adb shell input keyevent KEYCODE_HOME
  sleep 2
  open_app > /dev/null
  sleep 6
  kept_after_recreate="$(kept_search)"
  screenshot "7-reopened-after-recreate"
  adb shell settings put global always_finish_activities 0

  # Crashes in the log: the app's own, and the WebView's renderer dying.
  adb logcat -d > "$run_folder/logcat.txt"
  app_crashes="$(awk '/FATAL EXCEPTION/ {n++} END {print n+0}' "$run_folder/logcat.txt")"
  renderer_deaths="$(awk 'tolower($0) ~ /render(er)? ?process.*(gone|crash|died)/ {n++} END {print n+0}' "$run_folder/logcat.txt")"

  {
    echo "== $ram MB"
    echo "Cold start (Android's TotalTime):        ${start_ms:-?} ms"
    echo "Search ready (word count shown) after:   $ready_after"
    echo "Search typed through the screen:         $search_ok"
    echo "Memory, app process:                     $app_mb MB"
    echo "Memory, WebView renderer:                $webview_mb MB"
    echo "Still running after memory pressure:     $alive_after_pressure"
    echo "Killed in the background:                $killed; reopened in ${restart_ms:-?} ms; search kept: $kept_after_kill"
    echo "Screen thrown away and rebuilt:          search kept: $kept_after_recreate"
    echo "App crashes / WebView renderer deaths:   $app_crashes / $renderer_deaths"
    echo "Screens, video and log:                  low-ram-results/ram-$ram/"
    echo
  } >> "$summary"

  # Done with this phone.
  adb emu kill > /dev/null
  wait "$emulator_pid" || true
done

cat "$summary"
