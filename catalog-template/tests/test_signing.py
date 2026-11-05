"""Exercise the real signing job with an ephemeral key, without GitHub or an account."""
import base64
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption


class CatalogueSigning(unittest.TestCase):
    def test_signs_exact_validated_bytes_and_keeps_key_out_of_output(self):
        source = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            for name in ("sign.py", "validate.py"):
                shutil.copyfile(source / "scripts" / name, root / "scripts" / name)
            for name in ("index.json", "index.schema.json", "member.schema.json"):
                shutil.copyfile(source / name, root / name)
            key = Ed25519PrivateKey.generate()
            secret = base64.b64encode(key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())).decode()
            result = subprocess.run([sys.executable, str(root / "scripts/sign.py")], env={**os.environ,"CATALOG_SIGNING_KEY":secret}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(secret, result.stdout + result.stderr)
            signature = base64.b64decode((root / "index.json.sig").read_bytes(), validate=True)
            key.public_key().verify(signature, (root / "index.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
