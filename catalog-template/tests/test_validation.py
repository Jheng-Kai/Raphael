"""Good/bad pull request inputs, entirely offline and without a signing key."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from validate import validate


class CatalogueValidation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = dict(format="raphael-member", version=1, name="Writer", role="Editor", personality="Careful", instructions="Check sources", reply_style="full",
            skills=[{"text":"---\nname: Editing\ndescription: Check clarity\n---\nReview the draft"}], routines=[], connections=[])
        self.entry = dict(id="writer", name="Writer", creator="Example", category="marketing", summary="Edit a draft", avatar="shuna", featured=True,
            package="packages/writer/member.raphael-member", sha256="", version="1.0.0", created="2026-11-05", updated="2026-11-05", skills=1, routines=0, connections=[])

    def save(self):
        path = self.root / self.entry["package"]
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(self.package).encode()
        path.write_bytes(raw)
        self.entry["sha256"] = hashlib.sha256(raw).hexdigest()
        (self.root / "index.json").write_text(json.dumps(dict(format="raphael-catalog", version=1, sequence=1, entries=[self.entry], revoked=[])))

    def test_good_pull_request(self):
        self.save()
        self.assertEqual(validate(self.root)["entries"][0]["id"], "writer")

    def test_the_description_a_member_writes_for_its_template_is_kept_and_bounded(self):
        # The template author always writes one, so a publish request carrying it must pass.
        self.package["description"] = "Checks a guide for plain words."
        self.save()
        self.assertEqual(validate(self.root)["entries"][0]["id"], "writer")
        self.package["description"] = "x" * 281
        self.save()
        with self.assertRaises(Exception):
            validate(self.root)

    def test_secret_in_pull_request_is_refused(self):
        self.package["instructions"] = "password: seeded-private-credential"
        self.save()
        with self.assertRaisesRegex(ValueError, "credentials"):
            validate(self.root)

    def test_private_fields_and_invalid_triggers_are_refused(self):
        self.package["memory"] = "private"
        self.save()
        with self.assertRaises(Exception):
            validate(self.root)
        self.package.pop("memory")
        self.package["routines"] = [{"title":"Review", "prompt":"Check", "schedule":None, "when":{"unexpected":True}}]
        self.entry["routines"] = 1
        self.save()
        with self.assertRaises(Exception):
            validate(self.root)

    def test_size_file_count_and_digest_are_enforced(self):
        self.package["skills"][0]["files"] = {f"file-{i}.txt":"x" for i in range(100)}
        self.save()
        with self.assertRaisesRegex(ValueError, "100 files"):
            validate(self.root)
        self.package["skills"][0].pop("files")
        self.save()
        path = self.root / self.entry["package"]
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "digest"):
            validate(self.root)
        path.write_bytes(b"x" * (512 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, "size"):
            validate(self.root)


if __name__ == "__main__":
    unittest.main()
