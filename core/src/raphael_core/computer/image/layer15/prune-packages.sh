#!/bin/sh
set -eu

# Browser media is handled by Chrome. Raphael's attachment decoding runs on the host.
# Let apt keep any libraries or NumPy still needed by XFCE, VNC or websockify.
installed() {
  dpkg-query -W -f='${db:Status-Status}\t${Package}\n' | awk -v pattern="$1" '$1 == "installed" && $2 ~ pattern {print $2}'
}
compilers='(gcc|g[+][+]|cpp)(-[0-9]+)?'
codecs='lib(avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale|postproc|x265|codec2|mfx|flite)-?[0-9].*'
optional=$(installed "^($compilers|$codecs|python3-numpy)$")
if [ -n "$optional" ]; then
  # apt-mark takes one argument per package.
  apt-mark auto $optional
fi
removed=$(installed '^(chromium(-common|-sandbox)?|build-essential|ffmpeg)$')
# Make was installed through build-essential, but members also use it on its own.
apt-mark manual make
apt-get purge -y --auto-remove $removed
apt-get clean
rm -rf /etc/chromium /etc/chromium.d
rm -f /home/cua/.local/share/applications/chromium.desktop /usr/share/xfce4/helpers/chromium.desktop

test -z "$(installed '^(chromium(-common|-sandbox)?|firefox-esr|build-essential|ffmpeg)$')"
test ! -e /usr/lib/chromium/chromium
test ! -e /usr/lib/firefox-esr
test "$(stat -Lc %u /opt/google/chrome/google-chrome)" = 0
/opt/google/chrome/chrome --version
test "$(readlink -f /usr/bin/x-www-browser)" = /usr/local/bin/raphael-browser
test -s /etc/opt/chrome/policies/managed/raphael.json
test -n "$(find /usr/lib -name 'libpixbufloader-svg.so' -print -quit)"
test -e /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
test -s /usr/share/novnc/vnc.html
for command in Xtigervnc X0tigervnc startxfce4 xfce4-panel xfdesktop wmctrl websockify git node npm; do
  command -v "$command"
done
websockify --help >/dev/null
make --version
/opt/venv/bin/python --version
test "$(/usr/local/libexec/raphael/cua-driver --version)" = "cua-driver 0.37.0"

# ldd can exit successfully even when a library cannot be resolved.
libraries=$(ldd /opt/google/chrome/chrome)
if printf '%s\n' "$libraries" | grep -F 'not found'; then
  exit 1
fi
