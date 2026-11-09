# An Android emulator in a box, set up like a cheap phone, for tools/low-ram/run.sh.
# Ubuntu, Java 17, the Android command-line tools, the emulator and one Android 15
# system image (Google APIs, so its WebView is a current one). About 6 GB once built.
# x86_64 hosts only: the system image is x86_64 and runs on the host's KVM.
FROM ubuntu:24.04

# Java for the Android tools; the libraries the emulator links against, even without a
# window; curl and jq to fetch the app's release; unzip for the tools' zip.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      openjdk-17-jdk-headless ca-certificates curl jq unzip \
      libpulse0 libgl1 libnss3 libnspr4 libxcomposite1 libxcursor1 libxi6 libxtst6 \
      libasound2t64 libxdamage1 libxrandr2 libxkbfile1 libdbus-1-3 libx11-6 libx11-xcb1 \
      libxext6 libxfixes3 libxrender1 libfontconfig1 libxkbcommon0 libxkbcommon-x11-0 \
 && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/emulator:$PATH

# The command-line tools (version 12.0; sdkmanager then fetches current packages).
ARG CMDLINE_TOOLS=11076708
RUN mkdir -p "$ANDROID_HOME/cmdline-tools" \
 && curl -fsSL -o /tmp/tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip" \
 && unzip -q /tmp/tools.zip -d "$ANDROID_HOME/cmdline-tools" \
 && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
 && rm /tmp/tools.zip

# adb, the emulator and the system image; the licences accepted up front.
ARG SYSTEM_IMAGE="system-images;android-35;google_apis;x86_64"
RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platform-tools" "emulator" "$SYSTEM_IMAGE" > /dev/null

# The phone itself: a Pixel 4 shape. Its memory and cores are set when it starts.
RUN echo no | avdmanager create avd -n lowram -k "$SYSTEM_IMAGE" -d pixel_4

COPY inside.sh /usr/local/bin/low-ram-test
RUN chmod +x /usr/local/bin/low-ram-test
ENTRYPOINT ["/usr/local/bin/low-ram-test"]
