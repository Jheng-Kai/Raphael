"""What the core itself sends for the work card and the member Library, for the look run (runner.mjs `coreFixtures`).

The core's own CheckpointStore reads synthetic files and its own Library reads a synthetic database, so a scene shows the list
the core would hand the app, never a copy of the rule (R-CARD-20, R-PANEL-10). Invented neutral data only. Prints one JSON object.
"""
import json
import sys
import tempfile
from pathlib import Path

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.pages import PageStore
from raphael_core.brain import db
from raphael_core.computer.checkpoints import CheckpointStore
from raphael_core.members.library import snapshot

MEMBER, TURN = 1, 980
HASH = "acc20f9519bca6400afa6a868abca8258e7bc15ef7d0b1e2" * 3
# What tools leave while a member works: npm's content store under a hidden folder (files named by bare hashes, the owner's card of
# 2026-11-14), a package store, a build cache, lock files, a partial render and a temporary folder.
LEFTOVERS = [*(f".npm-cache/_cacache/content-v2/sha512/{HASH[n:n + 2]}/{HASH[n + 2:n + 4]}/{HASH[n + 4:n + 128]}" for n in range(0, 24, 2)),
             *(f".npm-cache/_cacache/index-v5/{HASH[n:n + 2]}/{HASH[n + 2:n + 4]}/{HASH[n + 4:n + 64]}" for n in range(0, 12, 2)),
             "宣傳片/node_modules/remotion/package.json", "宣傳片/node_modules/.bin/remotion", "宣傳片/.remotion/cache/bundle.js",
             "宣傳片/package-lock.json", "宣傳片/out/宣傳影片.mp4.part", "宣傳片/tmp/frame-0001.png", HASH[:64], HASH[:32] + ".json"]


def checkpoints(base, leftovers_only):
    root, team = base / "workspace", base / "team"
    root.mkdir()
    team.mkdir()
    store = CheckpointStore(base / "archive", [root, team])
    store.begin(member=MEMBER, turn=TURN)
    for name in LEFTOVERS:
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_bytes(b"\0tool")
    if not leftovers_only:
        (root / "宣傳片" / "src").mkdir(parents=True)
        (root / "宣傳片" / "src" / "Promo.tsx").write_text("export const Promo = () => null;\n", encoding="utf-8")
        (root / "宣傳片" / "package.json").write_text('{"name": "promo"}\n', encoding="utf-8")
        (team / "宣傳片").mkdir()
        (team / "宣傳片" / "宣傳影片.mp4").write_bytes(b"\0\0\0\x18ftypmp42")

    def guest(path):
        for local, mount in ((root, "/home/cua/workspace"), (team, "/home/cua/team")):
            if Path(path).is_relative_to(local):
                return f"{mount}/{Path(path).relative_to(local).as_posix()}"
        return path

    views = store.list(member=MEMBER)
    return [{**view, "uncovered": [guest(path) for path in view["uncovered"]],
             "files": [{**file, "path": guest(file["path"])} for file in view["files"]]} for view in views]


def library(now_ms):
    conn = db.connect(":memory:")
    minute = 60_000

    def turn(at, route="worker", **extra):
        history = AgentHistory(conn, lambda: at)
        return history, history.add(session_id="look", question="", route=route, prefix="", text="", status="done",
                                    member_id=MEMBER, **extra)

    def media(history, identifier, name, key, mime):
        history.add_message(identifier, "media", json.dumps({"attachment": {"id": key, "name": name, "mime": mime, "size": 4096}}))

    # The member's own background work names the member itself as `peer_id`; its video and its page are the owner's.
    history, work = turn(now_ms - 20 * minute, source="worker", peer_id=MEMBER)
    media(history, work, "宣傳影片.mp4", "d" * 32 + ".mp4", "video/mp4")
    conversation = conn.execute("SELECT conversation_id FROM agent_turns WHERE id=?", (work,)).fetchone()[0]
    PageStore(conn, now_ms=lambda: now_ms - 21 * minute).write(turn_id=work, member_id=MEMBER, conversation_id=conversation,
                                                              title="分鏡表", html="<p>分鏡</p>")
    history, asked = turn(now_ms - 40 * minute, source="app", route="answer")
    history.add_message(asked, "reply", "腳本在這裡：[腳本.pdf](attachment:" + "e" * 32 + ".pdf)")
    # A colleague's hand-off names another member: what it hands over is that colleague's, not the owner's.
    history, handed = turn(now_ms - 30 * minute, source="worker", peer_id=MEMBER + 1)
    media(history, handed, "給同事的版本.mp4", "f" * 32 + ".mp4", "video/mp4")
    return snapshot(conn, MEMBER, [], 100)


def main():
    now_ms = int(sys.argv[1])
    output = {"coreLibrary": library(now_ms), "coreCheckpoints": {}}
    for shape, leftovers_only in (("core-noise", True), ("core-work", False)):
        with tempfile.TemporaryDirectory() as base:
            output["coreCheckpoints"][shape] = checkpoints(Path(base), leftovers_only)
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
