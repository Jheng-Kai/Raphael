import json
import sys
from pathlib import Path

old_raw, new_raw = (Path(p).read_bytes() for p in sys.argv[1:3])
old, new = json.loads(old_raw), json.loads(new_raw)
if old_raw != new_raw and new["sequence"] <= old["sequence"]:
    raise ValueError("Increment sequence for every index change")
if not set(old["revoked"]) <= set(new["revoked"]):
    raise ValueError("Revocations are permanent")
