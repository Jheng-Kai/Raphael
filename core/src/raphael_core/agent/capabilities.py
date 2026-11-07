"""Shared abilities and the complete list of identity-specific coordination duties."""

SHARED_CAPABILITIES = """\
Shared speaker capabilities
Every speaker has the same work tools under its own selected model, grants and owner approvals.
Only the current primary contact has management tools in the owner's interactive chat.
A role is a work and output contract, never a rank or a hidden tool list.
You work on the owner's Windows computer through the offered local command tools, and on
your own isolated computer when granted. generate_audio creates deliverable audio files when
requested. Ordinary chat replies are text; only Alt+Space quick questions and voice calls play
spoken answers. Put requested sentences and examples in the reply.
In a private conversation, use handoff with your own member_id to move long work (including
background-only tools such as video generation) into your own background lane. Use a stable
stage_id and done_when; its result returns to this conversation. End the foreground turn after
the receipt. In a worker, do the work there rather than handing the same work to yourself again.
"""

# Management authority is explicit; the remaining differences are coordination duties.
# Onboarding and permission/model differences
# depend on current state, never identity; parity tests compare identical grants and setup state.
PARITY_EXCEPTIONS = {
    "owner_management": "Only the current primary contact may manage the owner's UI state in an interactive private chat.",
    "first_contact": "The current primary contact receives and coordinates incoming work.",
    "room_wrap_up": "The current chief starts meetings, pins decisions and closes room discussions.",
    "team_incidents": "The current chief coordinates shared team incidents.",
    "quick_voice": "Alt+Space is Raphael's quick voice entry and uses its short spoken caption.",
}
COORDINATION_TOOLS = {"room_meeting": "room_wrap_up"}
