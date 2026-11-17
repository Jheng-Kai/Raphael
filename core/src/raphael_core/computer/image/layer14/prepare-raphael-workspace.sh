#!/bin/sh
set -eu
workspace=/home/cua/workspace
profiles="$workspace/.browser-profiles"
# Image layer 14 installs this copy only where the members' browser was Debian's Chromium (arm64) and is Google's Chrome
# from now on. Chromium's profiles are not opened by Chrome: once in a workspace, before any browser starts, they are
# removed and the members sign in again. They are the members' own profile, driver/main (the shared computer's browser
# and the driver of a computer of a member's own both open it; the driver makes it again, with its own mark in it, the
# next time it starts its browser), and the profile Chromium kept when it was started without one. The rest of driver/,
# google-chrome and every other file of the workspace stay. The mark file says it was done; a workspace whose
# profile folder is a link is left as it is.
dropped="$profiles/.raphael-chromium-dropped"
if [ "$(dpkg --print-architecture)" = arm64 ] && [ ! -e "$dropped" ] && [ ! -L "$profiles" ] && [ ! -L "$profiles/driver" ]; then
  if rm -rf "$profiles/driver/main" "$profiles/chromium"; then
    mkdir -p "$profiles"
    : > "$dropped"
  fi
fi
mkdir -p "$profiles/google-chrome" "$profiles/chromium" "$HOME/.config"
if ! chmod 0700 "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium" 2>/dev/null; then
  for directory in "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium"; do
    test -r "$directory" && test -w "$directory" && test -x "$directory"
  done
fi
migrate_profile() {
  source="$1"
  target="$profiles/$2"
  if [ -d "$source" ] && [ ! -L "$source" ] && [ -z "$(find "$target" -mindepth 1 -print -quit)" ]; then
    cp -a "$source"/. "$target"/
  fi
  rm -rf "$source"
  ln -s "$target" "$source"
}
migrate_profile "$HOME/.config/google-chrome" google-chrome
migrate_profile "$HOME/.config/chromium" chromium
find "$profiles" \( -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie \) -delete
