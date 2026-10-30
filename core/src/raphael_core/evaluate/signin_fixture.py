"""Local-only sign-in page for the existing Docker native journey. No credentials persist."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PAGE = b'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Local test sign-in</title>
<style>body{font:20px system-ui;background:#eef3fa;color:#182332;display:grid;place-content:center;height:90vh}
form{display:grid;gap:16px;width:360px}input,button{font:inherit;padding:12px}h1{font-size:28px}</style>
<body onclick="if(event.target===this) document.querySelector('input').focus()">
<form method="post"><h1>Local test sign-in</h1><label>Email<input name="email" type="email" autofocus required></label>
<label>Password<input name="password" type="password" required autocomplete="off"></label><button>Sign in</button></form></body></html>'''


class SignIn(BaseHTTPRequestHandler):
    signed_in = False
    continued = 0

    def log_message(self, *_):
        pass

    def reply(self, content, status=200, kind="text/html"):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path == "/state":
            self.reply(json.dumps({"signed_in": self.signed_in, "continued": self.continued}).encode(), kind="application/json")
        else:
            self.reply(b"<h1>Signed in. Return control to your member.</h1>" if self.signed_in else PAGE)

    def do_POST(self):
        size = min(4096, int(self.headers.get("Content-Length", 0)))
        self.rfile.read(size)  # Discard owner input without retaining or reporting it.
        if self.path == "/finish":
            if not self.signed_in or self.continued:
                self.reply(b"refused", 409)
                return
            type(self).continued += 1
        else:
            type(self).signed_in = True
        self.reply(b"<h1>Signed in. Return control to your member.</h1>")


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8765), SignIn).serve_forever()
