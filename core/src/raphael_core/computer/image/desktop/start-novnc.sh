#!/bin/sh
set -eu
tokens=/run/user/1000/raphael-vnc-tokens
attempt=0
until test -f "$tokens" && /usr/bin/python3 -c 'import socket; socket.create_connection(("127.0.0.1", 5901), timeout=1).close()' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then echo 'VNC screen tokens did not become ready within 90 attempts' >&2; exit 1; fi
  sleep 1
done
exec websockify --web=/usr/share/novnc --token-plugin TokenFile --token-source "$tokens" "${NOVNC_PORT:-6901}"
