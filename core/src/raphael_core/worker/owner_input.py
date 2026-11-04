"""A loop-owned inbox; admission and its final drain share one event-loop boundary.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
"""


class OwnerInput:
    def __init__(self):
        self.pending = []
        self.closed = False
        self._tickets = []
        self._consumed = set()

    def add(self, text, ticket=None):
        if self.closed:
            return False
        self.pending.append({"role": "user", "content": text})
        self._tickets.append(ticket)
        return True

    def drain(self, *, finishing=False):
        messages, self.pending = self.pending, []
        self._consumed.update(ticket for ticket in self._tickets if ticket is not None)
        self._tickets = []
        if finishing and not messages:
            self.closed = True
        return messages

    def consumed(self, ticket):
        return ticket in self._consumed

    def mark_consumed(self, ticket):
        if ticket is not None:
            self._consumed.add(ticket)

    def leftover(self):
        return [ticket for ticket in self._tickets if ticket is not None]

    def withdraw(self, ticket):
        kept = [(message, key) for message, key in zip(self.pending, self._tickets) if key != ticket]
        self.pending = [message for message, _ in kept]
        self._tickets = [key for _, key in kept]
