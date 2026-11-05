# Owner management

R-AG-MGMT-01 through 03: management belongs to the current primary contact,
not Raphael by name. Other speakers retain the same work tools. API and CLI
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
The existing find_tools exposes matching native definitions; request-intent matching
also adds the relevant areas before either the API or CLI turn starts. CLI MCP lists
the same selected tools. Other speakers and non-owner scopes have no management
catalog to discover, and the existing execution/approval checks remain authoritative.

tests/members/test_management_discovery.py pins the default widest native offer at
51 (the feat/members baseline is 60), pins API/CLI default prompt budgets, discovers
every management tool, and exercises folder deletion, room renaming and member-model
changes with production API and authenticated loopback MCP paths. It also covers
same-turn discovery/execution and non-owner refusal. Token figures use the existing
memory.terms.estimate_tokens estimator, not provider billing or latency measurements.
