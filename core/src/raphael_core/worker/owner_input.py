"""A loop-owned inbox; admission and its final drain share one event-loop boundary.

"""


class OwnerInput:
    def __init__(self):
        self.pending = []
        self.closed = False
        self._tickets = []
        self._consumed = set()
        # Told each ticket at the moment its words reach the model. What a model read is settled then, so that however its
        # loop ends, and when the process dies first, the same words never get a turn of their own as well.
        self.on_read = None

    def add(self, text, ticket=None):
        if self.closed:
            return False
        self.pending.append({"role": "user", "content": text})
        self._tickets.append(ticket)
        return True

    def drain(self, *, finishing=False):
        messages, self.pending = self.pending, []
        tickets, self._tickets = self._tickets, []
        for ticket in tickets:
            self.mark_consumed(ticket)
        if finishing and not messages:
            self.closed = True
        return messages

    def consumed(self, ticket):
        return ticket in self._consumed

    def mark_consumed(self, ticket):
        if ticket is None or ticket in self._consumed:
            return
        self._consumed.add(ticket)
        if self.on_read is not None:
            self.on_read(ticket)

    def leftover(self):
        return [ticket for ticket in self._tickets if ticket is not None]

    def set_aside(self):
        """Close without reading, as a turn that hands its work off ends: the words that came with no ticket are given back
        to be kept with the turn, and those with one stay unread, for their conversation's inbox to take back as a turn of
        their own."""
        self.closed = True
        untracked = [message for message, ticket in zip(self.pending, self._tickets) if ticket is None]
        kept = [(message, ticket) for message, ticket in zip(self.pending, self._tickets) if ticket is not None]
        self.pending = [message for message, _ in kept]
        self._tickets = [ticket for _, ticket in kept]
        return untracked

    def withdraw(self, ticket):
        kept = [(message, key) for message, key in zip(self.pending, self._tickets) if key != ticket]
        self.pending = [message for message, _ in kept]
        self._tickets = [key for _, key in kept]
