"""A site that requires a client certificate, for a real Chrome on a Mac or on Windows (R-COMP-CERT-02). Not a test: a
workflow runs it in the background and then the tests of `test_host_certificate.py` that read its answer.

It makes a throwaway certificate authority, a server certificate for 127.0.0.1 and a client certificate that Chrome finds
with no prompt (a keychain of its own on a Mac, put first in the user's search list with `set-key-partition-list`; the
current user's personal store on Windows), and serves two sites on loopback:

- `site`: requires a client certificate from the authority, and answers `CLIENT-CN=<the certificate's common name>`;
- `other`: requires one from a second authority that has no certificate here, so Chrome has nothing to choose.

It writes the two addresses to the file named by `--out` and serves until it is stopped, then removes what it added.
It changes the machine's trust and certificate stores, so it refuses to run anywhere but a throwaway machine: GitHub's
runner (`GITHUB_ACTIONS`), or a machine whose owner says so with `RAPHAEL_MTLS_THROWAWAY=1`. Never run it on a PC that
matters.
"""

import argparse
import http.server
import json
import os
import shutil
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
WINDOWS = sys.platform == "win32"


def openssl():
    if not WINDOWS:
        return "/usr/bin/openssl"
    found = shutil.which("openssl")
    return found or r"C:\Program Files\Git\usr\bin\openssl.exe"


def run(*argv, check=True):
    result = subprocess.run([str(item) for item in argv], capture_output=True, text=True,
                            env={**os.environ, "MSYS_NO_PATHCONV": "1", "MSYS2_ARG_CONV_EXCL": "*"})
    if check and result.returncode:
        raise SystemExit(f"{argv[0]} failed ({result.returncode}): {result.stderr.strip() or result.stdout.strip()}")
    return result


def authority(folder, name):
    """A certificate authority named `name`: its key and certificate."""
    config = folder / f"{name}.cnf"
    config.write_text(f"[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=v3_ca\n[dn]\nCN={name}\nO=Raphael test\n"
                      "[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n"
                      "subjectKeyIdentifier=hash\n")
    run(openssl(), "genrsa", "-out", folder / f"{name}.key", "2048")
    run(openssl(), "req", "-x509", "-new", "-key", folder / f"{name}.key", "-sha256", "-days", "2",
        "-config", config, "-out", folder / f"{name}.pem")


def issue(folder, authority_name, name, common_name, extensions):
    (folder / f"{name}.ext").write_text(extensions)
    run(openssl(), "genrsa", "-out", folder / f"{name}.key", "2048")
    run(openssl(), "req", "-new", "-key", folder / f"{name}.key", "-subj", f"/CN={common_name}/O=Raphael test",
        "-out", folder / f"{name}.csr")
    run(openssl(), "x509", "-req", "-in", folder / f"{name}.csr", "-CA", folder / f"{authority_name}.pem",
        "-CAkey", folder / f"{authority_name}.key", "-CAcreateserial", "-days", "2", "-sha256",
        "-extfile", folder / f"{name}.ext", "-out", folder / f"{name}.pem")


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


def thumbprint(pem):
    text = run(openssl(), "x509", "-in", pem, "-noout", "-fingerprint", "-sha1").stdout
    return text.split("=", 1)[1].strip().replace(":", "")


def powershell(script):
    return run("powershell", "-NoProfile", "-NonInteractive", "-Command", script)


def main():
    if sys.platform not in ("darwin", "win32"):
        raise SystemExit("this fixture needs a Mac's keychain or Windows' certificate store")
    if os.environ.get("GITHUB_ACTIONS") != "true" and os.environ.get("RAPHAEL_MTLS_THROWAWAY") != "1":
        raise SystemExit("this fixture changes the machine's certificate stores: it runs only on a throwaway machine")
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
    # Windows reads the older PKCS#12 encryption everywhere; a Mac's openssl writes it already.
    old = ["-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1"] if WINDOWS else []
    run(openssl(), "pkcs12", "-export", *old, "-inkey", folder / "client.key", "-in", folder / "client.pem",
        "-certfile", folder / "Raphael Test CA.pem", "-out", folder / "client.p12", "-passout", f"pass:{PASSWORD}", "-name", NAME)
    if WINDOWS:
        authority_thumbprint, client_thumbprint = thumbprint(folder / "Raphael Test CA.pem"), thumbprint(folder / "client.pem")
        # The server's own authority is trusted for the machine, as the owner's company's is.
        run("certutil", "-addstore", "-f", "Root", folder / "Raphael Test CA.pem")
        powershell(f"Import-PfxCertificate -FilePath '{folder / 'client.p12'}' -CertStoreLocation Cert:\\CurrentUser\\My "
                   f"-Password (ConvertTo-SecureString -String '{PASSWORD}' -AsPlainText -Force) | Out-Null")
        print(powershell("Get-ChildItem Cert:\\CurrentUser\\My | Format-List Subject, Thumbprint, HasPrivateKey").stdout, flush=True)
        keychain = ""
    else:
        keychain = str(folder / "test.keychain-db")
        before = [line.strip().strip('"') for line in run("security", "list-keychains", "-d", "user").stdout.splitlines() if line.strip()]
        run("security", "create-keychain", "-p", PASSWORD, keychain)
        run("security", "set-keychain-settings", "-lut", "21600", keychain)
        run("security", "unlock-keychain", "-p", PASSWORD, keychain)
        run("security", "list-keychains", "-d", "user", "-s", keychain, *before)
    try:
        if not WINDOWS:
            # -A: any application may use the key with no prompt; the partition list lets Chrome (Google's team id) sign with it.
            run("security", "import", folder / "client.p12", "-k", keychain, "-P", PASSWORD, "-f", "pkcs12", "-A")
            run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,teamid:EQHXZ8M8AV", "-s", "-k", PASSWORD, keychain)
            run("sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain",
                folder / "Raphael Test CA.pem", check=False)
        # `other` has the same server certificate: only the client authority differs.
        site = serve(folder, "Raphael Test CA", "site")
        other = serve(folder, "Raphael Other CA", "other")
        Path(arguments.out).write_text(json.dumps({"site": site, "other": other, "keychain": keychain, "common_name": NAME}))
        print(f"serving {site} and {other}", flush=True)
        while True:
            time.sleep(1)
    finally:
        if WINDOWS:
            powershell(f"Remove-Item Cert:\\CurrentUser\\My\\{client_thumbprint} -ErrorAction SilentlyContinue")
            run("certutil", "-delstore", "Root", authority_thumbprint, check=False)
        else:
            run("security", "list-keychains", "-d", "user", "-s", *before, check=False)
            run("security", "delete-keychain", keychain, check=False)


if __name__ == "__main__":
    main()
