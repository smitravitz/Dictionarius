#!/usr/bin/env bash
# Runs inside the container (tools/low-ram/Dockerfile): for each memory size, starts a
# fresh emulated phone, installs Dictionarius and puts it through the low-memory tests.
# Writes /results/summary.txt (everything needed to judge the run, as text), plus per size
# a timeline, screenshots, the screen's text at each step, a scroll video and the log.

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

# ---------------------------------------------------------------------------------------
# Helpers, used by every run below. They all write into this run's folder ($run_folder).

# A line in the run's timeline, seconds since the phone was ready.
note() {
  local message="$1"
  # To the screen through stderr: helpers whose output is captured call this too.
  printf '%6s s  %s\n' "$(( SECONDS - run_started ))" "$message" | tee -a "$run_folder/timeline.txt" >&2
}

# Saves what the screen shows now as <name>.png.
screenshot() {
  local name="$1"
  adb exec-out screencap -p > "$run_folder/$name.png"
}

# Opens the app and prints Android's verdict: how it started (COLD: a new process; WARM:
# the process was alive but the screen was rebuilt; HOT: the screen was still there) and
# how long it took to show (TotalTime, ms).
open_app() {
  local output state milliseconds
  output="$(adb shell am start -W -n "$app/.MainActivity" | tr -d '\r')"
  state="$(echo "$output" | sed -n -E 's/^LaunchState: *([A-Z]+).*/\1/p')"
  milliseconds="$(echo "$output" | sed -n -E 's/^TotalTime: *([0-9]+).*/\1/p')"
  echo "${state:-?} ${milliseconds:-?} ms"
}

# Saves the screen's accessibility tree (its text and boxes; a WebView's page shows up in
# it as ordinary text and fields) as <name>.xml, and prints the file's path.
screen_text() {
  local name="${1:-now}"
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adb exec-out cat /sdcard/ui.xml > "$run_folder/$name.xml"
  echo "$run_folder/$name.xml"
}

# The screen's state in one line: is the search field there, the word count, a loading
# message, word rows, a word's page? (yes/no each), from a saved tree.
screen_state() {
  local tree="$1"
  local field count loading rows
  field=no; count=no; loading=no; rows=no
  if grep -q 'class="android.widget.EditText"' "$tree"; then field=yes; fi
  if grep -qE '[0-9],[0-9]{3} words' "$tree"; then count=yes; fi
  if grep -qi 'loading' "$tree"; then loading=yes; fi
  if grep -qE ' in all' "$tree"; then rows=yes; fi
  echo "field=$field count=$count loading=$loading results=$rows"
}

# Every distinct bit of text on a saved screen, one per line, for comparing two screens.
texts_of() {
  local tree="$1"
  grep -oE 'text="[^"]+"' "$tree" | sort -u
}

# How much of screen A's text is on screen B, as a percentage.
same_screen() {
  local before="$1" after="$2"
  local total shared
  total="$(texts_of "$before" | awk 'END {print NR}')"
  shared="$(comm -12 <(texts_of "$before") <(texts_of "$after") | awk 'END {print NR}')"
  if (( total == 0 )); then
    echo "?"
  else
    echo "$(( shared * 100 / total ))%"
  fi
}

# Types a search into the app's search field, waiting up to 60 s for the field. Logs the
# attempt and prints "yes" if the text then shows in the field, else why not.
search_for() {
  local text="$1" step_name="$2"
  local waited tree field bounds outcome
  local -a numbers
  waited=0
  while true; do
    tree="$(screen_text "$step_name-before")"
    field="$(grep -oE '<node[^>]*class="android.widget.EditText"[^>]*>' "$tree" | sed -n 1p)"
    if [[ -n "$field" ]]; then break; fi
    if (( waited >= 60 )); then
      note "search ($step_name): no search field on screen after 60 s"
      echo "no field"
      return
    fi
    sleep 2
    waited=$(( waited + 2 ))
  done
  # The field's box: bounds="[left,top][right,bottom]"; tap its middle, then type.
  bounds="$(echo "$field" | sed -n -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/p')"
  read -r -a numbers <<< "$bounds"
  adb shell input tap $(( (numbers[0] + numbers[2]) / 2 )) $(( (numbers[1] + numbers[3]) / 2 ))
  sleep 1
  adb shell input keyevent KEYCODE_MOVE_END
  adb shell input keyevent --longpress KEYCODE_DEL > /dev/null 2>&1   # clear what was there
  adb shell input text "$text"
  sleep 3   # results, counted
  tree="$(screen_text "$step_name-after")"
  if grep -q "text=\"$text\"" "$tree"; then
    outcome=yes
  else
    outcome="typed, but the field doesn't show \"$text\""
  fi
  note "search ($step_name): $outcome; screen: $(screen_state "$tree")"
  echo "$outcome"
}

# A process's memory in MB (its proportional share, PSS: what it really costs the phone).
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

# The WebView's renderer processes in MB: the page runs there, not in the app's process.
# They're the "sandboxed_process" ones (only this app uses a WebView here).
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

# Memory now, in one line: the app, the WebView, and what the phone has left.
memory_line() {
  local available_kb
  available_kb="$(adb shell cat /proc/meminfo | sed -n -E 's/^MemAvailable: *([0-9]+).*/\1/p')"
  echo "app $(memory_of "$app") MB, WebView $(webview_memory) MB, phone has $(( ${available_kb:-0} / 1024 )) MB left"
}

app_pid() {
  adb shell pidof "$app" | tr -d '\r'
}

# ---------------------------------------------------------------------------------------
# Step 2: what's being tested on, at the top of the summary.
{
  echo "Dictionarius on a low-memory phone"
  echo "App:      $apk_name"
  echo "Host:     ${HOST_CPU:-?} (${HOST_CORES:-?} threads), ${HOST_RAM_MB:-?} MB RAM; Docker ${DOCKER_VERSION:-?}"
  echo "Phone:    emulated Pixel 4 shape, $core_count cores, software graphics (no GPU in Docker)"
  echo "Run:      $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "Timings run on the host's CPU with software graphics: they don't match a real phone either way."
  echo "Memory is the figure to trust."
  echo
} > "$summary"

# Step 3: one fresh phone per memory size.
for ram in $ram_sizes; do
  run_folder="/results/ram-$ram"
  rm -rf "$run_folder"
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
  adb root > /dev/null   # Google APIs images allow root: needed to kill the app as Android would
  adb wait-for-device
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell wm dismiss-keyguard
  # Animations off (Android's "Remove animations"; the WebView takes it as reduced motion):
  # reading the screen's text waits for a still screen, and the start screen's drifting
  # pieces made each read take seconds, so the start couldn't be timed closely.
  for scale in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb shell settings put global "$scale" 0
  done
  adb install -r /tmp/app.apk > /dev/null
  adb logcat -c   # from here on, the log is the app's run only
  run_started=$SECONDS
  android_version="$(adb shell getprop ro.build.version.release | tr -d '\r')"
  webview_version="$(adb shell dumpsys package com.google.android.webview | sed -n -E 's/^ *versionName=(.*)/\1/p' | sed -n 1p | tr -d '\r')"
  app_version="$(adb shell dumpsys package "$app" | sed -n -E 's/^ *versionName=(.*)/\1/p' | sed -n 1p | tr -d '\r')"
  note "phone ready: Android $android_version, WebView $webview_version, app $app_version; $(memory_line)"

  # Test 1: a cold start, filmed: the screen every 2 s for 30 s, as text and a picture.
  adb shell am force-stop "$app"
  start_result="$(open_app)"
  note "cold start: $start_result"
  field_at="not within 30 s"
  count_at="not within 30 s"
  film_started=$SECONDS
  filmstrip=""
  for frame_number in $(seq -w 0 15); do
    elapsed=$(( SECONDS - film_started ))
    tree="$(screen_text "start-$frame_number")"
    state="$(screen_state "$tree")"
    screenshot "start-$frame_number"
    filmstrip+="    +${elapsed}s  $state"$'\n'
    if [[ "$field_at" == "not within 30 s" && "$state" == *"field=yes"* ]]; then field_at="${elapsed} s"; fi
    if [[ "$count_at" == "not within 30 s" && "$state" == *"count=yes"* ]]; then count_at="${elapsed} s"; fi
    if (( SECONDS - film_started >= 30 )); then break; fi
    sleep 1
  done
  note "search field shown after $field_at; word count after $count_at"
  memory_after_start="$(memory_line)"

  # Test 2: a search, a filmed scroll with frame stats, a word opened.
  search_one="$(search_for "eren" "search-1")"
  memory_after_search="$(memory_line)"
  screenshot "2-results"
  adb shell input keyevent KEYCODE_ESCAPE   # put the keyboard away
  adb shell dumpsys gfxinfo "$app" reset > /dev/null
  adb shell screenrecord --time-limit 8 /sdcard/scroll.mp4 &
  recorder_pid=$!
  for _ in 1 2 3 4 5 6; do   # six swipes up the list
    adb shell input swipe 540 1700 540 700 250
    sleep 1
  done
  wait "$recorder_pid" || true   # screenrecord can fail under software graphics; the rest carries on
  adb pull /sdcard/scroll.mp4 "$run_folder/3-scroll.mp4" > /dev/null 2>&1 || true
  frames="$(adb shell dumpsys gfxinfo "$app" | tr -d '\r' | sed -n -E 's/^Total frames rendered: *([0-9]+).*/\1/p' | sed -n 1p)"
  janky="$(adb shell dumpsys gfxinfo "$app" | tr -d '\r' | sed -n -E 's/^Janky frames: *(.*)/\1/p' | sed -n 1p)"
  note "scroll: ${frames:-?} frames, janky ${janky:-?}"
  adb shell input tap 540 1300   # a word in the middle of the list
  sleep 3
  screenshot "4-word"
  word_screen="$(screen_text "4-word")"
  memory_after_word="$(memory_line)"
  note "a word opened; screen: $(screen_state "$word_screen")"

  # Test 3: memory pressure while open: still running?
  adb shell am send-trim-memory "$app" RUNNING_CRITICAL
  sleep 3
  if [[ -n "$(app_pid)" ]]; then alive_after_pressure=yes; else alive_after_pressure=no; fi
  memory_after_pressure="$(memory_line)"
  screenshot "5-after-pressure"
  note "memory pressure: still running $alive_after_pressure; $memory_after_pressure"

  # Test 4: killed in the background with a word's page up (as Android's low-memory killer
  # does: kill -9, no warning), then reopened. Does it come back to the same page?
  adb shell input keyevent KEYCODE_HOME
  sleep 2
  pid_before="$(app_pid)"
  if [[ -n "$pid_before" ]]; then
    adb shell kill -9 "$pid_before"
  fi
  sleep 2
  if [[ -z "$(app_pid)" ]]; then killed=yes; else killed=no; fi
  note "killed in the background: $killed (pid $pid_before)"
  reopen_result="$(open_app)"
  note "reopened: $reopen_result"
  restored_after="not within 60 s"
  reopen_started=$SECONDS
  same_as_before="?"
  while (( SECONDS - reopen_started < 60 )); do
    tree="$(screen_text "6-reopened")"
    same_as_before="$(same_screen "$word_screen" "$tree")"
    if [[ "$same_as_before" != "?" ]] && (( ${same_as_before%\%} >= 80 )); then
      restored_after="$(( SECONDS - reopen_started )) s"
      break
    fi
    sleep 2
  done
  screenshot "6-reopened-after-kill"
  note "back on the same page: $restored_after (screen ${same_as_before} the same as before the kill)"

  # Crashes in the log: the app's own, and the WebView's renderer dying; the first lines.
  adb logcat -d > "$run_folder/logcat.txt"
  app_crashes="$(awk '/FATAL EXCEPTION/ {n++} END {print n+0}' "$run_folder/logcat.txt")"
  renderer_deaths="$(awk 'tolower($0) ~ /render(er)? ?process.*(gone|crash|died)/ {n++} END {print n+0}' "$run_folder/logcat.txt")"
  # (Errors only: AndroidRuntime's other lines are the test's own screen reader starting.)
  crash_lines="$(grep -iE 'FATAL EXCEPTION| E AndroidRuntime|render(er)? ?process.*(gone|crash|died)' "$run_folder/logcat.txt" | sed -n 1,12p || true)"

  {
    echo "== $ram MB (Android $android_version, WebView $webview_version, app $app_version)"
    echo "Cold start:                     $start_result (LaunchState, TotalTime)"
    echo "Search field shown after:       $field_at"
    echo "Word count shown after:         $count_at"
    echo "Start, every 2 s (screen's text: field, word count, a loading message, results):"
    printf '%s' "$filmstrip"
    echo "Search typed:                   $search_one"
    echo "Scroll (frame stats):           ${frames:-?} frames, janky ${janky:-?}"
    echo "Memory after start:             $memory_after_start"
    echo "Memory after a search:          $memory_after_search"
    echo "Memory with a word open:        $memory_after_word"
    echo "Memory after pressure:          $memory_after_pressure (still running: $alive_after_pressure)"
    echo "Killed in the background:       $killed; reopened $reopen_result; back on the same page: $restored_after"
    echo "App crashes / renderer deaths:  $app_crashes / $renderer_deaths"
    if [[ -n "$crash_lines" ]]; then
      echo "First crash lines:"
      while IFS= read -r line; do
        echo "    $line"
      done <<< "$crash_lines"
    fi
    echo "Timeline:"
    sed 's/^/  /' "$run_folder/timeline.txt"
    echo "Files: low-ram-results/ram-$ram/ (screenshots, the screen's text as .xml, 3-scroll.mp4, logcat.txt)"
    echo
  } >> "$summary"

  # Done with this phone.
  adb emu kill > /dev/null
  wait "$emulator_pid" || true
done

cat "$summary"
