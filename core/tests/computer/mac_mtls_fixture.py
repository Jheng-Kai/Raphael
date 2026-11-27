"""A site that requires a client certificate, for a real Chrome on a Mac (R-COMP-CERT-02). Not a test: the macOS workflow runs
it in the background and then the tests of `test_host_certificate.py` that read its answer.

It makes a throwaway certificate authority, a server certificate for 127.0.0.1 and a client certificate in a keychain of its
own that is put first in the user's search list (so Chrome finds it with no prompt: `set-key-partition-list`), and serves two
sites on loopback:

- `site`: requires a client certificate from the authority, and answers `CLIENT-CN=<the certificate's common name>`;
- `other`: requires one from a second authority that has no certificate in the keychain, so Chrome has nothing to choose.

It writes the two addresses to the file named by `--out` and serves until it is stopped. Only a Mac's `security` tool and
`/usr/bin/openssl` are used; nothing of the owner's own keychains is changed except the search list, restored on exit.
"""

import argparse
import http.server
import json
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

NAME = "raphael-test-client"
PASSWORD = "raphael-test"


def run(*argv, check=True):
    result = subprocess.run(list(argv), capture_output=True, text=True)
    if check and result.returncode:
        raise SystemExit(f"{argv[0]} failed ({result.returncode}): {result.stderr.strip() or result.stdout.strip()}")
    return result


def authority(folder, name):
    """A certificate authority named `name`: its key and certificate."""
    config = folder / f"{name}.cnf"
    config.write_text(f"[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=v3_ca\n[dn]\nCN={name}\nO=Raphael test\n"
                      "[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n"
                      "subjectKeyIdentifier=hash\n")
    run("/usr/bin/openssl", "genrsa", "-out", str(folder / f"{name}.key"), "2048")
    run("/usr/bin/openssl", "req", "-x509", "-new", "-key", str(folder / f"{name}.key"), "-sha256", "-days", "2",
        "-config", str(config), "-out", str(folder / f"{name}.pem"))


def issue(folder, authority_name, name, common_name, extensions):
    (folder / f"{name}.ext").write_text(extensions)
    run("/usr/bin/openssl", "genrsa", "-out", str(folder / f"{name}.key"), "2048")
    run("/usr/bin/openssl", "req", "-new", "-key", str(folder / f"{name}.key"), "-subj", f"/CN={common_name}/O=Raphael test",
        "-out", str(folder / f"{name}.csr"))
    run("/usr/bin/openssl", "x509", "-req", "-in", str(folder / f"{name}.csr"), "-CA", str(folder / f"{authority_name}.pem"),
        "-CAkey", str(folder / f"{authority_name}.key"), "-CAcreateserial", "-days", "2", "-sha256",
        "-extfile", str(folder / f"{name}.ext"), "-out", str(folder / f"{name}.pem"))


def serve(folder, trusted, label):
    """A TLS site on loopback that requires a client certificate issued by `trusted`; its address."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(folder / "server.pem"), str(folder / "server.key"))
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(str(folder / f"{trusted}.pem"))

    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            self.request.do_handshake()
            super().setup()

        def do_GET(self):
            subject = dict(item[0] for item in self.request.getpeercert().get("subject", ()))
            body = f"<html><title>{label}</title><body>CLIENT-CN={subject.get('commonName', '?')}</body></html>".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

        def get_request(self):
            sock, address = self.socket.accept()
            return context.wrap_socket(sock, server_side=True, do_handshake_on_connect=False), address

        def handle_error(self, request, client_address):
            pass  # a client that has no certificate to offer ends the handshake

    server = Server(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"https://127.0.0.1:{server.server_address[1]}/"


def main():
    if sys.platform != "darwin":
        raise SystemExit("this fixture needs a Mac's keychain")
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()
    folder = Path(tempfile.mkdtemp(prefix="raphael-mtls-"))
    authority(folder, "Raphael Test CA")
    authority(folder, "Raphael Other CA")
    issue(folder, "Raphael Test CA", "server", "localhost",
          "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n"
          "keyUsage=digitalSignature,keyEncipherment\n")
    issue(folder, "Raphael Test CA", "client", NAME, "extendedKeyUsage=clientAuth\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\n")
    run("/usr/bin/openssl", "pkcs12", "-export", "-inkey", str(folder / "client.key"), "-in", str(folder / "client.pem"),
        "-certfile", str(folder / "Raphael Test CA.pem"), "-out", str(folder / "client.p12"), "-passout", f"pass:{PASSWORD}",
        "-name", NAME)
    keychain = str(folder / "test.keychain-db")
    before = [line.strip().strip('"') for line in run("security", "list-keychains", "-d", "user").stdout.splitlines() if line.strip()]
    run("security", "create-keychain", "-p", PASSWORD, keychain)
    run("security", "set-keychain-settings", "-lut", "21600", keychain)
    run("security", "unlock-keychain", "-p", PASSWORD, keychain)
    run("security", "list-keychains", "-d", "user", "-s", keychain, *before)
    try:
        # -A: any application may use the key with no prompt; the partition list lets Chrome (Google's team id) sign with it.
        run("security", "import", str(folder / "client.p12"), "-k", keychain, "-P", PASSWORD, "-f", "pkcs12", "-A")
        run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,teamid:EQHXZ8M8AV", "-s", "-k", PASSWORD, keychain)
        # The server's own authority is trusted for this machine, as the owner's company's is (the runner is thrown away).
        run("sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain",
            str(folder / "Raphael Test CA.pem"), check=False)
        # `other` has the same server certificate: only the client authority differs.
        site = serve(folder, "Raphael Test CA", "site")
        other = serve(folder, "Raphael Other CA", "other")
        Path(arguments.out).write_text(json.dumps({"site": site, "other": other, "keychain": keychain, "common_name": NAME}))
        print(f"serving {site} and {other}", flush=True)
        while True:
            time.sleep(1)
    finally:
        run("security", "list-keychains", "-d", "user", "-s", *before, check=False)
        run("security", "delete-keychain", keychain, check=False)


if __name__ == "__main__":
    main()
