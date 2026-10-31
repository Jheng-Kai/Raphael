"""A loop-owned inbox; admission and its final drain share one event-loop boundary.

The user-role message after a tool batch follows Hermes agent_runtime_helpers.py
(MIT, c419cf7c); see THIRD_PARTY_NOTICES.md.
"""


class OwnerInput:
    def __init__(self):
        self.pending = []
        self.closed = False

    def add(self, text):
        if self.closed:
            return False
        self.pending.append({"role": "user", "content": text})
        return True

    def drain(self, *, finishing=False):
        messages, self.pending = self.pending, []
        if finishing and not messages:
            self.closed = True
        return messages
