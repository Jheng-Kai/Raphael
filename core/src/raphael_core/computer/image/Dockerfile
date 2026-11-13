# Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.
FROM docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b
USER root
COPY desktop/ /opt/raphael-desktop/
RUN set -eux; \
    install -d -o cua -g cua /home/cua/team /home/cua/.config/xfce4/xfconf/xfce-perchannel-xml; \
    install -o cua -g cua /opt/raphael-desktop/xfce4-panel.xml /opt/raphael-desktop/xfce4-desktop.xml /home/cua/.config/xfce4/xfconf/xfce-perchannel-xml/; \
    install -d -o cua -g cua /home/cua/.config/xfce4/panel; \
    for panel in 0 1 2 3 4 5; do \
      for item in '1 browser' '2 files' '3 terminal'; do \
        set -- $item; \
        launcher=$((panel * 3 + $1)); \
        install -d -o cua -g cua "/home/cua/.config/xfce4/panel/launcher-$launcher"; \
        install -o cua -g cua "/opt/raphael-desktop/$2.desktop" "/home/cua/.config/xfce4/panel/launcher-$launcher/"; \
      done; \
    done; \
    install -m 0755 /opt/raphael-desktop/raphael-browser /usr/local/bin/raphael-browser; \
    install -m 0755 /opt/raphael-desktop/raphael-seat-browser /usr/local/bin/raphael-seat-browser; \
    install -m 0755 /opt/raphael-desktop/prepare-desktop /usr/local/bin/prepare-raphael-desktop; \
    install -d -o cua -g cua /home/cua/.local /home/cua/.local/share /home/cua/.local/share/applications /home/cua/.config/autostart; \
    install -o cua -g cua /opt/raphael-desktop/browser.desktop /home/cua/.local/share/applications/raphael-browser.desktop; \
    install -o cua -g cua /opt/raphael-desktop/prepare-desktop.desktop /home/cua/.config/autostart/; \
    printf '[Default Applications]\nx-scheme-handler/http=raphael-browser.desktop\nx-scheme-handler/https=raphael-browser.desktop\ntext/html=raphael-browser.desktop\n' > /home/cua/.config/mimeapps.list; \
    chown cua:cua /home/cua/.config/mimeapps.list; \
    for app in pulseaudio xfce4-pulseaudio-plugin; do \
      printf '[Desktop Entry]\nType=Application\nName=Disabled audio startup\nHidden=true\n' > "/home/cua/.config/autostart/$app.desktop"; \
    done
COPY THIRD_PARTY_NOTICES.txt /usr/local/share/licenses/raphael/THIRD_PARTY_NOTICES.txt
COPY Apache-2.0.txt /usr/local/share/licenses/raphael/Apache-2.0.txt
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64) wheel_url='https://files.pythonhosted.org/packages/3b/b0/97f6d8828b8a6ca3649ad7150ddbc23addde56f014c9bd407876484ecb8d/cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl'; wheel_sha='e530ee36226d99516ef7ec696ba31d516e487ae5e5effdd5e2610c56af3eee19'; wheel_path='/tmp/cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl'; lib_triplet='x86_64-linux-gnu' ;; \
      aarch64|arm64) wheel_url='https://files.pythonhosted.org/packages/dc/33/81e2531353837f80358fbf56629a74f50d7f097af4b5f67626b0afce2d61/cua_driver-0.37.0-py3-none-manylinux_2_31_aarch64.whl'; wheel_sha='1a0103fd7fa5e9d51ee3ce26d502eb4187702282b3f4bcf1e9c09c6ce9f9d558'; wheel_path='/tmp/cua_driver-0.37.0-py3-none-manylinux_2_31_aarch64.whl'; lib_triplet='aarch64-linux-gnu' ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    for ssl_lib in "/lib/$lib_triplet/libssl.so.3" "/lib/$lib_triplet/libcrypto.so.3"; do \
      if [ -e "$ssl_lib" ] && [ ! -s "$ssl_lib" ]; then \
        echo "pinned base image is defective on $arch: $ssl_lib is zero bytes, so curl cannot start — re-pull or replace the base image instead of debugging the wheel download" >&2; \
        exit 1; \
      fi; \
    done; \
    curl -fsSL "$wheel_url" -o "$wheel_path"; \
    echo "$wheel_sha  $wheel_path" | sha256sum -c -; \
    /opt/venv/bin/python -m pip install --no-cache-dir --force-reinstall --no-deps "$wheel_path"; \
    rm -f "$wheel_path"; \
    driver_bin="$(find /opt/venv/lib -path '*/cua_driver/bin/cua-driver' -type f -print -quit)"; \
    test -n "$driver_bin"; \
    install -D -m 0755 "$driver_bin" /usr/local/libexec/raphael/cua-driver; \
    install -d -o cua -g cua -m 0700 /home/cua/workspace; \
    test "$(/usr/local/libexec/raphael/cua-driver --version)" = "cua-driver 0.37.0"
# Install before XFCE starts so the panel and window manager see the font too.
# Noto Sans CJK JP is distributed under the SIL Open Font License 1.1.
RUN set -eux; \
    install -d -m 0755 /usr/local/share/fonts; \
    curl -fsSL 'https://raw.githubusercontent.com/notofonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf' -o /usr/local/share/fonts/NotoSansCJKjp-Regular.otf; \
    echo '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5  /usr/local/share/fonts/NotoSansCJKjp-Regular.otf' | sha256sum -c -; \
    chmod 0644 /usr/local/share/fonts/NotoSansCJKjp-Regular.otf; \
    install -d -m 0755 /usr/local/share/licenses/noto-cjk; \
    curl -fsSL 'https://raw.githubusercontent.com/notofonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/LICENSE' -o /usr/local/share/licenses/noto-cjk/OFL.txt; \
    echo '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2  /usr/local/share/licenses/noto-cjk/OFL.txt' | sha256sum -c -; \
    fc-cache -f
RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -eu' \
      'workspace=/home/cua/workspace' \
      'profiles="$workspace/.browser-profiles"' \
      'mkdir -p "$profiles/google-chrome" "$profiles/chromium" "$profiles/mozilla" "$HOME/.config"' \
      'if ! chmod 0700 "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium" "$profiles/mozilla" 2>/dev/null; then' \
      '  for directory in "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium" "$profiles/mozilla"; do' \
      '    test -r "$directory" && test -w "$directory" && test -x "$directory"' \
      '  done' \
      'fi' \
      'migrate_profile() {' \
      '  source="$1"' \
      '  target="$profiles/$2"' \
      '  if [ -d "$source" ] && [ ! -L "$source" ] && [ -z "$(find "$target" -mindepth 1 -print -quit)" ]; then' \
      '    cp -a "$source"/. "$target"/' \
      '  fi' \
      '  rm -rf "$source"' \
      '  ln -s "$target" "$source"' \
      '}' \
      'migrate_profile "$HOME/.config/google-chrome" google-chrome' \
      'migrate_profile "$HOME/.config/chromium" chromium' \
      'migrate_profile "$HOME/.mozilla" mozilla' \
      'find "$profiles" \( -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie -o -name .parentlock -o -name lock -type l \) -delete' \
      > /usr/local/bin/prepare-raphael-workspace.sh \
    && chmod 0755 /usr/local/bin/prepare-raphael-workspace.sh
# A bot's own desktop: a 200 ms (not 800) watch for windows an action opens still sees a browser's popups; no cursor glide; plain logs.
RUN printf '%s\n' \
      '#!/bin/sh' \
      '/usr/local/bin/prepare-raphael-workspace.sh' \
      'attempt=0' \
      'until DISPLAY=:1 xset q >/dev/null 2>&1; do' \
      '  attempt=$((attempt + 1))' \
      '  if [ "$attempt" -ge 45 ]; then echo "X display :1 did not become ready within 45 seconds" >&2; exit 1; fi' \
      '  sleep 1' \
      'done' \
      'overlay_flag=' \
      'if /usr/local/libexec/raphael/cua-driver serve --help 2>&1 | grep -q -- --no-overlay; then overlay_flag=--no-overlay; fi' \
      'exec env CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 CUA_DRIVER_BROWSER_NO_SANDBOX=1 CUA_DRIVER_BROWSER_PROFILE_ROOT=/home/cua/workspace/.browser-profiles/driver NO_COLOR=1 /usr/local/libexec/raphael/cua-driver serve --socket /run/user/1000/raphael-cua.sock --permission-mode standard --grant existing-profile --cursor-reduced-motion on $overlay_flag' \
      > /usr/local/bin/start-raphael-cua-driver.sh \
    && chmod 0755 /usr/local/bin/start-raphael-cua-driver.sh
RUN printf '%s\n' \
      '' \
      '[program:raphael-cua-driver]' \
      'command=/usr/local/bin/start-raphael-cua-driver.sh' \
      'user=cua' \
      'environment=HOME="/home/cua",USER="cua",DISPLAY=":1"' \
      'autorestart=true' \
      'startsecs=2' \
      'stdout_logfile=/var/log/supervisor/cua-driver.log' \
      'stderr_logfile=/var/log/supervisor/cua-driver.error.log' \
      'priority=30' \
      >> /etc/supervisor/supervisord.conf
# The driver's page tools drive a root-owned system Chromium. With every capability dropped it cannot make its own
# sandbox, and the container is one already. Chromium opens every new window beside its first, whatever screen the
# pointer is on, and the driver has no tool that moves one: wmctrl puts a member's window on its own screen.
# The desktop draws its picture through gdk-pixbuf, which reads SVG only with librsvg's loader: without it the
# town (five SVG drawings) was never drawn and the desktop stayed one flat colour.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends chromium tigervnc-scraping-server wmctrl librsvg2-common; \
    rm -rf /var/lib/apt/lists/*; \
    printf 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --test-type"\n' > /etc/chromium.d/raphael-container; \
    chromium --version; \
    test -n "$(find /usr/lib -name 'libpixbufloader-svg.so' -print -quit)"
# What a bot's computer has from its first start (owner, 2026-11-13, of Grok Bot's computer: 「他們會有 chrome 等等之類的
# 我們一開始就要把環境架設好了 不會只有 cua」). Nothing in a computer is root, so a member cannot add a system package
# later: what its work is likely to reach for is here. The base already has curl, ffmpeg, node and Python 3.13.
# The CJK and emoji fonts are Debian's: until now only the Japanese cut was there, and Chinese was drawn in its shapes.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git wget zip unzip jq ripgrep npm sqlite3 poppler-utils build-essential \
      less nano tree file fonts-noto-cjk fonts-noto-color-emoji; \
    rm -rf /var/lib/apt/lists/*; \
    fc-cache -f; \
    git --version; npm --version; rg --version | head -n 1
# Google's own Chrome is the members' browser where Google builds one (amd64): it is what an owner signs in to
# Google with, and it is taken from Google's own repository, signed with Google's key, at the version that is
# current when the image is built. There is no Chrome for arm64 Linux: there the browser stays Chromium.
RUN set -eux; \
    if [ "$(dpkg --print-architecture)" = amd64 ]; then \
      curl -fsSL https://dl.google.com/linux/linux_signing_key.pub -o /usr/share/keyrings/google-linux.asc; \
      printf 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.asc] https://dl.google.com/linux/chrome/deb/ stable main\n' > /etc/apt/sources.list.d/raphael-google-chrome.list; \
      apt-get update; \
      apt-get install -y --no-install-recommends google-chrome-stable; \
      rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/raphael-google-chrome.list; \
      /opt/google/chrome/chrome --version; \
    fi
# What the members' browser keeps, and whose it is, as the browser's own policy: it holds whatever a profile says and
# whether or not the profile could be written. Every member reads the one profile. So the browser is never signed in
# to as a browser and never syncs: an owner who signs in to Google on a page is otherwise offered "Turn on sync",
# and his own saved passwords, history and bookmarks would come down into a profile every member reads. And it
# keeps no password, card or address that is typed into it. Signing in to a site is untouched: that is a cookie.
RUN set -eux; \
    for folder in /etc/opt/chrome/policies/managed /etc/chromium/policies/managed; do \
      install -d -m 0755 "$folder"; \
      printf '%s\n' '{"BrowserSignin": 0, "SyncDisabled": true, "PasswordManagerEnabled": false, "AutofillCreditCardEnabled": false, "AutofillAddressEnabled": false}' > "$folder/raphael.json"; \
      chmod 0644 "$folder/raphael.json"; \
      /usr/bin/python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$folder/raphael.json"; \
    done
# Firefox ESR came with the base image and is no one's browser here: the members' is Google's Chrome (Chromium on
# arm64) and the driver's is Chromium, so a second browser was only a place an owner would sign in for nobody
# (owner, 2026-11-14: 「Firefox 應該是沒有用了，你可以幫我把它從印象檔中移除，沒有關係。」). Purging it also takes its
# alternatives, its menu entry and its mime registrations; what the base put beside it that no package owns (and
# XFCE's own helper entry for it, which only lists it among the applications to prefer) is removed by name.
# The base's own layer still holds the files, so this makes the image no smaller: it removes the browser, not the
# bytes. The two scripts that still named Firefox (the workspace's profile folders, and the last
# fallback of raphael-browser) are patched here, in the image, and not in desktop/ or the step that wrote them:
# any change to desktop/ or to an earlier step makes every step after it run again, and a PC that built layer 9
# would download Chrome and the packages anew. A profile folder an existing workspace already has is the owner's
# and stays.
RUN set -eux; \
    apt-get purge -y --auto-remove firefox-esr; \
    rm -rf /etc/firefox-esr /usr/lib/mozilla /usr/lib/firefox-esr /usr/share/xfce4/helpers/firefox.desktop /home/cua/.mozilla; \
    sed -i -e '/migrate_profile "\$HOME\/\.mozilla" mozilla/d' -e 's# "\$profiles/mozilla"##g' \
      -e 's/ -o -name \.parentlock -o -name lock -type l//' /usr/local/bin/prepare-raphael-workspace.sh; \
    sed -i 's|^exec firefox "\$@"$|echo "raphael-browser: this computer has no browser" >\&2; exit 1|' /usr/local/bin/raphael-browser; \
    sh -n /usr/local/bin/prepare-raphael-workspace.sh; \
    sh -n /usr/local/bin/raphael-browser; \
    test -z "$(grep -il -e mozilla -e parentlock /usr/local/bin/prepare-raphael-workspace.sh || true)"; \
    test -z "$(grep -il firefox /usr/local/bin/raphael-browser /usr/share/applications/mimeinfo.cache || true)"; \
    test -z "$(dpkg-divert --list | grep -i firefox || true)"; \
    test -z "$(dpkg -l | grep -i firefox || true)"; \
    test -z "$(command -v firefox || command -v firefox-esr || true)"; \
    test ! -e /usr/share/applications/firefox-esr.desktop; \
    test -z "$(grep -ril firefox /usr/share/xfce4/helpers || true)"; \
    /usr/lib/chromium/chromium --version
# The desktop says which browser it opens, and each of its ways to a browser opens the computer's own (owner,
# 2026-11-13, of the panel: 「但看起來底下不是顯示 Chrome ㄟ?」). Measured on layer 8: the panel's launcher wore a globe
# named "Browser" over Google Chrome; XFCE's own "Web Browser" named a helper that does not exist and asked which
# application to prefer; the menu's Google Chrome and x-www-browser could not start at all (Chrome's own entry makes
# a sandbox, and nothing in a computer can); the menu's Chromium and Firefox were each a second browser with a
# profile of its own, where an owner signs in for nobody. So: the launcher and the menu's one browser carry the
# browser's own name and mark; the helper, the other browser entries and x-www-browser all start raphael-browser.
# Named here and not in desktop/: which browser there is, is known only once the steps above have run.
RUN set -eux; \
    if [ -x /opt/google/chrome/chrome ]; then name='Google Chrome' icon=google-chrome; else name=Chromium icon=chromium; fi; \
    test -e "/usr/share/icons/hicolor/48x48/apps/$icon.png"; \
    for file in /home/cua/.config/xfce4/panel/launcher-*/browser.desktop /home/cua/.local/share/applications/raphael-browser.desktop; do \
      sed -i -e "s/^Name=.*/Name=$name/" -e "s/^Icon=.*/Icon=$icon/" "$file"; \
      grep -qx "Icon=$icon" "$file"; \
    done; \
    printf '%s\n' '[Desktop Entry]' 'Version=1.0' 'Type=X-XFCE-Helper' "Name=$name" "Icon=$icon" 'StartupNotify=true' \
      'X-XFCE-Binaries=raphael-browser;' 'X-XFCE-Category=WebBrowser' 'X-XFCE-Commands=%B;' 'X-XFCE-CommandsWithParameter=%B "%s";' \
      > /usr/share/xfce4/helpers/raphael-browser.desktop; \
    sed -i 's/^WebBrowser=.*/WebBrowser=raphael-browser/' /home/cua/.config/xfce4/helpers.rc; \
    grep -qx 'WebBrowser=raphael-browser' /home/cua/.config/xfce4/helpers.rc; \
    for entry in google-chrome com.google.Chrome chromium; do \
      if [ -e "/usr/share/applications/$entry.desktop" ]; then \
        printf '%s\n' '[Desktop Entry]' 'Type=Application' "Name=$name" 'Exec=raphael-browser %U' "Icon=$icon" 'Terminal=false' 'NoDisplay=true' \
          > "/home/cua/.local/share/applications/$entry.desktop"; \
      fi; \
    done; \
    chown cua:cua /home/cua/.config/xfce4/helpers.rc /home/cua/.config/xfce4/panel/launcher-*/browser.desktop /home/cua/.local/share/applications/*.desktop; \
    for link in x-www-browser gnome-www-browser; do \
      update-alternatives --install "/usr/bin/$link" "$link" /usr/local/bin/raphael-browser 500; \
    done; \
    test "$(readlink -f /usr/bin/x-www-browser)" = /usr/local/bin/raphael-browser
# The helper is standard library only: Debian's Python runs it without anything from /opt/venv.
# Its X readiness wait also handles supervisor starting before the X socket is ready.
# Without CAP_KILL, supervisor only restarts what exits; the helper ends its own children.
# Nothing may call supervisorctl stop or restart in a computer.
# A program that fails to start startretries times is FATAL for good, because nothing here can start it again:
# the screens are retried for as long as the computer runs.
RUN install -m 0755 /opt/raphael-desktop/start-novnc.sh /usr/local/bin/start-novnc.sh; \
    printf '%s\n' \
      '' \
      '[program:raphael-screens]' \
      'command=/usr/bin/python3 /opt/raphael-desktop/screens.py' \
      'user=cua' \
      'environment=HOME="/home/cua",USER="cua",DISPLAY=":1"' \
      'autorestart=true' \
      'startsecs=2' \
      'startretries=1000000' \
      'stdout_logfile=/var/log/supervisor/screens.log' \
      'stderr_logfile=/var/log/supervisor/screens.error.log' \
      'priority=25' \
      >> /etc/supervisor/supervisord.conf
# Layer 11 (owner, 2026-11-14: 「電腦的部分你可能要再改好一下…你就一次把所有東西都修復吧」). Two scripts of the image are
# replaced by the ones in layer11/: raphael-seat-browser, which waited 15 s for a browser's first window and 5 s for it
# to settle where a loaded PC took 13 to 41 s (it now waits a minute and 30 s, by the clock and not by a count of looks),
# and screens.py, which now writes the panels' configuration in the order of dependence (what a panel holds before the
# panel, the list of panels last) and restarts panels that stay empty (a panel was seen 12 px wide for twenty seconds and
# more). They are in layer11/ and not in desktop/ for the reason the step above gives: any change to
# desktop/ or to a step before this one makes every step after it run again, and a PC that built layer 10 would download
# Chrome and the packages anew. desktop/raphael-seat-browser and desktop/screens.py stay as layer 10 had them, byte for
# byte, and are what this step writes over; nothing reads them but this build.
COPY layer11/ /opt/raphael-layer11/
RUN set -eux; \
    install -m 0755 /opt/raphael-layer11/raphael-seat-browser /usr/local/bin/raphael-seat-browser; \
    install -m 0644 /opt/raphael-layer11/screens.py /opt/raphael-desktop/screens.py; \
    sh -n /usr/local/bin/raphael-seat-browser; \
    /usr/bin/python3 -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' /opt/raphael-desktop/screens.py; \
    rm -rf /opt/raphael-layer11
LABEL org.raphael.computer="1" \
      org.raphael.computer.driver="0.37.0" \
      org.raphael.computer.base="docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b" \
      org.raphael.computer.layer="11"
