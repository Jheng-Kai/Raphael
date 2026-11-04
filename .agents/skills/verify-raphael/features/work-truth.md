# Delegated work and truthful run endings

The core owns this behavior through existing history, background tasks, room messages,
tool snapshots and the single CLI driver. R-WORK-06 through R-WORK-15 add no page,
RPC, schema migration or alternative brain loop.

- History context and search admit the selected member's own exchange rows, including
  delegated work. Private conversation filtering still applies to private rows; other
  members and room turns remain isolated.
- Worker attachment inputs reuse agent/attachment_inputs.earlier_files (at most eight
  unique earlier stored files). The source conversation's recent context supplies the
  IDs. Existing AttachmentStore validates paths; the existing numbered read_attachment
  path and native CLI images receive the restored bytes. Missing stored files are omitted.
- Local foreground timeout returns a failed PluginResult with timeout and partial-output
  guidance. PowerShell process defaults cover UTF-8 input/output and encoding-aware
  cmdlets, including Get-Content and Set-Content. Explicit per-command encoding wins.
- Startup ends legacy queued work and repairs unfinished turns of already interrupted
  tasks. Durable queued handoffs and waiting continuations remain recoverable; running
  uncertain effects are never replayed. A worker that disappears closes as interrupted
  with worker_lost; a parent already requeued after child completion is preserved.
- room_list returns the caller's real room IDs, names and membership, including the
  chief only where actually a member. room_post publishes a completed room turn as
  the caller, checks current membership, and deduplicates a retry of the same source
  turn and text. Posting a review does not start another discussion or create a room.
  Existing room_meeting exact-membership reuse, size limits and discussion design stay.
- Search allows one retry, respecting numeric/date Retry-After. Waits use at most
  eight seconds and the remaining twelve-second budget. A longer cooldown causes a
  bounded wait and a rate-limit result without another early provider request.
  Early Windows timer wakeups recheck the cooldown before sending.
- AgentService normalizes progress before storing it: one chief prefix, plain members.
  Routine worker metadata is mirrored into agent_steps as it changes and settles;
  history views show the mirrored steps once; arguments/results remain outside this audit.
- team_overview resolves brains from each member's own selection (or the existing
  chief default), and tools from the same worker snapshot, including hidden catalog
  entries. It reports configured native file/image limits and computer grants,
  without asserting provider health, quota or a running computer.

## Offline verification

Use the named tests in R-WORK-06 through R-WORK-15, plus background handoff/restart,
room scope, CLI images, member administration and architecture boundary tests.
The whole core suite is required for this unit; use .fold/wait-heavy.ps1 first.
No app/src changes or look run are part of this unit. UI scene, judge, native,
real CLI/provider and network behavior remain integration acceptance boundaries.

Codex current-image support already exists: CliLoop selects image attachments;
Driver copies validated bytes to temporary paths and sends localImage entries in
app-server turn/start. Existing offline subprocess and member-turn tests cover it:
core/tests/agent/test_cli_images.py::test_native_images_are_supplied_in_provider_format_and_cleaned;
core/tests/members/test_cli_brains.py::test_cli_turn_delivers_only_current_images_natively.
Local codex --help documents -i/--image. No signed-in model request is needed or
performed. This does not establish real model vision quality or provider availability.

The existing Guardian manifest now maps room_list and room_post to
S21.meetings.list and S21.meetings.post. Those live cells remain unimplemented;
the mapping guard is offline coverage metadata, never a live acceptance claim.
