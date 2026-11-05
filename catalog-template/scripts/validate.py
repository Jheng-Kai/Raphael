"""Validate the existing raphael-member v1 wire format before catalogue review/signing."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

import jsonschema

ROOT = Path(__file__).resolve().parents[1]
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[\"']?[^\s\"']{8,}", re.I)


def validate(root):
    raw = (root / "index.json").read_bytes()
    if len(raw) > 256 * 1024:
        raise ValueError("Index exceeds 256 KiB")
    index = json.loads(raw)
    jsonschema.validate(index, json.loads((ROOT / "index.schema.json").read_bytes()))
    identifiers = [e["id"] for e in index["entries"]]
    if len(set(identifiers)) != len(identifiers) or len(set(index["revoked"])) != len(index["revoked"]):
        raise ValueError("Duplicate catalogue identities")
    for entry in index["entries"]:
        expected = f"packages/{entry['id']}/member.raphael-member"
        if entry["package"] != expected:
            raise ValueError("Unsafe package path")
        path = root / expected
        if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != root.parent):
            raise ValueError("Package links are forbidden")
        data = path.read_bytes()
        if len(data) > 512 * 1024 or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError("Package size or digest mismatch")
        package = json.loads(data)
        jsonschema.validate(package, json.loads((ROOT / "member.schema.json").read_bytes()))
        files = 1
        for skill in package["skills"]:
            files += 1 + len(skill.get("files", {}))
            for name, content in skill.get("files", {}).items():
                part = PurePosixPath(name)
                if (not name or "\\" in name or ":" in name or part.is_absolute() or part.as_posix() != name or any(p.startswith(".") for p in part.parts)
                        or part.name.casefold() in ("skill.md", "memory.md", "user.md", "soul.md")
                        or part.suffix.lower() not in (".md", ".txt", ".json", ".py", ".sh", ".js", ".ts", ".ps1", ".toml", ".yaml", ".yml")
                        or "\x00" in content or len(content.encode()) > 128 * 1024):
                    raise ValueError("Unsafe skill dependency")
            if len(skill["text"].encode()) > 128 * 1024:
                raise ValueError("Skill too large")
        if files > 100:
            raise ValueError("Package exceeds 100 files")
        def strings(item):
            if isinstance(item, str):
                yield item
            elif isinstance(item, list):
                for child in item:
                    yield from strings(child)
            elif isinstance(item, dict):
                for key, child in item.items():
                    yield key
                    yield from strings(child)
        if any(SECRET.search(text) for text in strings(package)):
            raise ValueError("Remove private credentials before publishing")
        if entry["skills"] != len(package["skills"]) or entry["routines"] != len(package["routines"]) or entry["connections"] != package["connections"]:
            raise ValueError("Catalogue counts do not match package")
    return index


if __name__ == "__main__":
    validate(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT)
    print("Catalogue schema, digest, size and secret checks passed")
