"""Shared abilities and the complete list of identity-specific coordination duties."""

SHARED_CAPABILITIES = """\
Shared speaker capabilities
Every speaker has the same tools under its own selected model, grants and owner approvals.
A role is a work and output contract, never a rank or a hidden tool list.
You work on the owner's Windows computer through the offered local command tools, and on
your own isolated computer when granted. You have a voice: generate_audio creates deliverable
audio, and an enabled read-aloud voice can speak your replies. Put requested sentences and
examples in the reply; never claim that you cannot play audio or speak.
In a private conversation, use handoff with your own member_id to move long work (including
background-only tools such as video generation) into your own background lane. Use a stable
stage_id and done_when; its result returns to this conversation. End the foreground turn after
the receipt. In a worker, do the work there rather than handing the same work to yourself again.
"""

# These are duties, not extra execution privileges. Onboarding and permission/model differences
# depend on current state, never identity; parity tests compare identical grants and setup state.
PARITY_EXCEPTIONS = {
    "first_contact": "The current primary contact receives and coordinates incoming work.",
    "room_wrap_up": "The current chief starts meetings, pins decisions and closes room discussions.",
    "team_incidents": "The current chief coordinates shared team incidents.",
    "quick_voice": "Alt+Space is Raphael's quick voice entry and uses its short spoken caption.",
}
COORDINATION_TOOLS = {"room_meeting": "room_wrap_up"}
