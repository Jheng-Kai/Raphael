"""Native fake history, scoped by session and fed only by submitted CLI prompts."""

import json
import re


class NativeContext:
    def __init__(self):
        self.sessions = {}
        self.calls = []

    def receive(self, system, user, session):
        native = session or f"fixture-native-{len(self.sessions) + 1}"
        state = self.sessions.setdefault(native, {"roster": None, "history": []})
        snapshots = re.findall(r"<team_roster>\s*(.*?)\s*</team_roster>", system + "\n" + user, re.S)
        if snapshots:
            state["roster"] = json.loads(snapshots[-1])
        if "Team changed (" in user:
            # Public inventories are single-line JSON; line replacements carry the new inventory.
            edits = user.split("Team changed (", 1)[1].split("\n\nMemory", 1)[0]
            for line in edits.splitlines():
                if line.startswith("{"):
                    snapshot = json.loads(line)
                    if "members" in snapshot and "self_id" in snapshot:
                        state["roster"] = snapshot
        assert state["roster"] is not None, "The native session was never given a roster"
        self.calls.append({"session": session, "native": native, "system": system, "user": user,
                           "roster": state["roster"]})
        # Fixture brains read their effective history through their existing system argument.
        effective = system + "\n" + "\n".join(state["history"])
        effective += "\n<team_roster>\n" + json.dumps(state["roster"], ensure_ascii=False) + "\n</team_roster>"
        state["history"].append(user)
        return native, effective

    def answered(self, native, answer):
        self.sessions[native]["history"].append(answer)
