"""Sign exact index bytes; the repository secret never reaches a package or log."""
import base64
import os
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from validate import ROOT, validate

validate(ROOT)
key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(os.environ.pop("CATALOG_SIGNING_KEY"), validate=True))
(ROOT / "index.json.sig").write_bytes(base64.b64encode(key.sign((ROOT / "index.json").read_bytes())))
