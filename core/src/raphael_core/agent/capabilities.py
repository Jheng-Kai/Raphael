"""Shared abilities and the explicit exceptions for speaker-specific tools."""

SHARED_CAPABILITIES = """\
Shared speaker capabilities
Every speaker has the same work tools under its own selected model, grants and owner approvals.
Every speaker has the same owner management tools in the owner's interactive private chat, including
creating members and managing shared settings. Destructive and permission changes require the owner's approval.
The primary contact is the default contact, not a higher permission level.
A role is a work and output contract, never a rank or a hidden tool list.
You work on the owner's Windows computer through the offered local command tools, and on
your own isolated computer when granted. Replies are text. Put requested sentences and examples in the reply.
In a private conversation, use handoff with your own member_id to move long work (including
background-only tools such as video generation) into your own background lane. Use a stable
stage_id and done_when; its result returns to this conversation. End the foreground turn after
the receipt. In a worker, do the work there rather than handing the same work to yourself again.
"""

# Portable member recipes are identity-specific; other differences are coordination duties.
# Onboarding and permission/model differences
# depend on current state, never identity; parity tests compare identical grants and setup state.
PARITY_EXCEPTIONS = {
    "member_recipe": "Only members have portable recipes to share; Raphael is the built-in assistant.",
    "first_contact": "The current primary contact receives and coordinates incoming work.",
    "room_wrap_up": "The current chief pins decisions and closes room discussions.",
    "team_incidents": "The current chief coordinates shared team incidents.",
    "quick_voice": "Alt+Space is Raphael's quick dictation entry and answers in a short caption.",
}
COORDINATION_TOOLS = {"room_meeting": "room_wrap_up"}
MEMBER_ONLY_TOOLS = {"share_template": "member_recipe"}
