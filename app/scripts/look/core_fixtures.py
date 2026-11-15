"""What the core itself sends for the member Library, for the look run (runner.mjs `coreFixtures`).

The core's own Library reads a synthetic database, so a scene shows the list the core would hand the app, never a copy of the
rule (R-PANEL-10). Invented neutral data only. Prints one JSON object.
"""
import json
import sys

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.pages import PageStore
from raphael_core.brain import db
from raphael_core.members.library import snapshot

MEMBER = 1


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
    print(json.dumps({"coreLibrary": library(now_ms)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
