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
# A bot's own desktop: a 200 ms (not 800) watch for windows an action opens still sees Firefox popups; no cursor glide; plain logs.
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
      'exec env CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 CUA_DRIVER_BROWSER_NO_SANDBOX=1 CUA_DRIVER_BROWSER_PROFILE_ROOT=/home/cua/workspace/.browser-profiles/driver NO_COLOR=1 /usr/local/libexec/raphael/cua-driver serve --socket /run/user/1000/raphael-cua.sock --permission-mode standard --cursor-reduced-motion on $overlay_flag' \
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
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends chromium tigervnc-scraping-server wmctrl; \
    rm -rf /var/lib/apt/lists/*; \
    printf 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --test-type"\n' > /etc/chromium.d/raphael-container; \
    chromium --version
# The helper is standard library only: Debian's Python runs it without anything from /opt/venv.
# Its X readiness wait also handles supervisor starting before the X socket is ready.
# Without CAP_KILL, supervisor only restarts what exits; the helper ends its own children.
# Nothing may call supervisorctl stop or restart in a computer.
RUN install -m 0755 /opt/raphael-desktop/start-novnc.sh /usr/local/bin/start-novnc.sh; \
    printf '%s\n' \
      '' \
      '[program:raphael-screens]' \
      'command=/usr/bin/python3 /opt/raphael-desktop/screens.py' \
      'user=cua' \
      'environment=HOME="/home/cua",USER="cua",DISPLAY=":1"' \
      'autorestart=true' \
      'startsecs=2' \
      'stdout_logfile=/var/log/supervisor/screens.log' \
      'stderr_logfile=/var/log/supervisor/screens.error.log' \
      'priority=25' \
      >> /etc/supervisor/supervisord.conf
LABEL org.raphael.computer="1" \
      org.raphael.computer.driver="0.37.0" \
      org.raphael.computer.base="docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b" \
      org.raphael.computer.layer="5"
