# Owner management

Owner follow-up (2026-11-08): ask_member and handoff refuse operational delegated
member management before another member turn/task starts, with guidance to use
the caller's own owner-private management tools. Since the fixed tool list (2026-11-10,
below) a find_tools result is an ordinary tool result: the CLI never restarts for it.
team_overview defaults to a compact complete roster with role, selected model and
skill/command/routine counts; optional member_id returns one full detail record.
DataFloor protects both Windows Raphael and Raphael Dev data roots, configured
RAPHAEL_DATA_DIR/RAPHAEL_HOME and the directory of an active raphael.db, requiring
single-call consent for reads and refusing writes regardless of action mode.
Offline regressions: tests/members/test_meetings_followup.py,
tests/members/test_answering.py, tests/background/test_handoff.py,
tests/background/test_cli_found_tools.py and tests/agent/test_data_floor.py under core/.

R-AG-MGMT-01 through 03: peer/shared management belongs to the current primary contact,
not Raphael by name. Every member can manage its own profile, picture, skills, commands,
voice and own memory in an interactive owner chat. Identity 0 can change its own voice
settings. Other speakers retain the same work tools. API and CLI
private owner chats use the same offer, registry, services and approval gate.
Rooms, exchanges and background work cannot acquire administration. Quick voice
creation retains its existing owner entry only when its speaker is the live primary.

The authoritative action-to-RPC/schema/tier table is core/src/raphael_core/management.py.
Settings use one whitelisted settings_update tool; member_manage, room_manage
and dictionary_manage select only their own table rows and revalidate the selected
schema on the server. The initial UI inventory and resulting rows are recorded in .fold/ui-actions.md.
Architecture guards read the app API and Rust allowlist and classify settings per
key. Owner-only reasons are beside the registry; no generic RPC or setting writer
is exposed. Every destructive row, primary transfer and retention shortening
requires a one-time exact-action approval even in bypass. Member deletion retains
the existing T3 gold hold-to-confirm card; other destructive actions reuse it.

Offline: tests/members/test_management.py covers current/stale primary refusal,
primary moves, every destructive row in all four modes, exact approval and replay,
real folder/profile/command services and deleting the requesting conversation.
Speaker parity excludes only management and existing coordination duties.

Deferred selected look scope (both themes, 1120,720,1920x1080):
admin-approval, admin-approval-batch, admin-approval-long, admin-delete-approval,
admin-approved, admin-denied, member-draft, member-draft-edit, member-draft-done,
primary-contact-set, room-question-card and card-background. Compare the T3 member-delete approval with each new
destructive summary at identical theme and width; inspect complete target names,
all profile fields, retention before/after and absence of an Always action.

The unit brief forbids look/native/network/paid APIs. No new layout is introduced;
these scenes are a deferred integration selection, not captured visual evidence.
Judge must use that selected run after capture in an authorized environment.
Guardian mappings include the new area tools. New live management cells have no
driver yet and remain explicit unbuilt failures; mapping is not acceptance.
Live/provider checks require separate authorization and prove a different boundary.

## Management discovery follow-up

The primary's default turn hides all 35 management definitions in Snapshot.management.
find_tools returns the matching definitions (name, description, input schema) and the
model calls one with use_tool; the request's words only rank what find_tools returns
and never list a tool (fixed tool list, below). Non-primary speakers discover only the
narrowed self-management catalog; non-owner scopes have none. Exact target/field checks
and the existing approval checks remain authoritative.

tests/members/test_management_discovery.py pins the default widest native offer at
43 (52 before the fixed list; the feat/members baseline is 60), pins API/CLI default
prompt budgets, discovers every management tool, and exercises folder deletion, room
renaming and member-model changes through use_tool with production API and
authenticated loopback MCP paths, the list unchanged. It also covers same-turn
discovery/execution and non-owner refusal. Token figures use the existing
memory.terms.estimate_tokens estimator, not provider billing or latency measurements.

## Fixed tool list (owner, 2026-11-09, decision 2; built 2026-11-10)

Every member is listed one set of tools, sorted by name, byte for byte the same through a
conversation and from task to task of one kind (core/src/raphael_core/background/snapshot.py).
What is listed follows the member and the path (owner's private chat, background, room), never
the request, its files, a find_tools search or a connection that comes or goes. A connection's
tools, management, the commands for this PC except `open`, the desktop `computer`,
`generate_audio` and `slack_draft` are found with find_tools and called with use_tool, down the
same gate, steps, audit and guardrails as a direct call. `open` and `update_page` stay listed: a
model picks a listed look-alike (`show`, `show_page`) over searching for a hidden tool. The core's
pinned tools (local commands, the member's computer, media models, Composio's router) stay listed.
The member's computer catalog (a grant, the driver's own catalog) is the one change a task's list
can still take. Offline: core/tests/members/test_fixed_tools.py (three turns, API and CLI MCP,
identical lists; find and use in one turn) and core/tests/background/test_fixed_tools.py (worker,
TaskRun, CLI member loop, connections changing mid-task). Live (Codex subscription, 2026-11-10):
Guardian cells members, approval-yes, approval-no (find_tools then use_tool), open and
routine-create pass on cli:codex:gpt-6-luna?effort=low.

## Settings panel intent (2026-11-07)

The window may send setup-telegram, setup-slack, setup-discord, share-template or settings.
Settings is valid for member 0; share-template still requires a nonzero member. The trusted
rule travels beside the owner message, never inside the visible history. Tests in
core/tests/members/test_chat_settings.py cover API/CLI self scope, peer refusal, real
profile/command/skill/voice/memory writes and exact-action deletion approval.
The window-owned settings button and visual/native acceptance remain an integration handoff.
