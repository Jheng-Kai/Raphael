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
  entries. It reports configured native file/image limits and the local-command mode,
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

## A member does what its owner asks, and says plainly what it did not (R-WORK-16 through R-WORK-20, 2026-11-14)

Owner: a language-teaching member, asked for daily reading pages from real news for his own study in his own app, refused on copyright,
delivered a headline, closed every reply with a disclaimer, and did not open a blocked page in its own computer though told to.
A core-only unit: prompt words and one card line, no page, RPC or schema change; every check is offline.

- Prompt causes, found in `agent/persona.py`: no word of copyright anywhere (the refusals were the model's own, with nothing saying this
  is the owner's own app); a report "with checks and anything unfinished" (task, CLI task, routine) and a part-answer that must "name the
  gap" (the closing disclaimers); a closed page to be replaced by "another source … rewritten simply for a learner" (the thin pages and
  the browser not opened). Not changed: `READ_NEEDS_BROWSER` and the wake policy (R-COMP-WAKE-01), the secret check of pages
  (R-PAGE-05), the report page's "recorded facts" line (R-PAGE-01).
- `_OWNER_WORK` ("Doing the owner's work") is in every member's reply prompt (API, narrated, CLI conversation), every member task and
  routine prompt and the chief's task prompt. The chief's conversation prompt carries only the shortened gap rule: the default prompt is
  held to a size budget (`core/tests/members/test_management_discovery.py`, before 15902 / 15166 tokens, after 15909 / 15174, limits 16048 / 15212).
- A page the member wrote is a card line in the turns its later turns read (`agent/card_context.py`): title, page_id, revision, when made
  (and changed), and the first 360 characters of its visible text ("It begins: ..."); a plugin's page keeps title and ids only. There is
  still no tool that reads a page back whole; `update_page` with the id replaces it.
- A routine's run gets `ROUTINE_REPORT` after its task (never in the system prompt, R-CACHE-02).

Offline: `core/tests/agent/test_member_behaviour.py`, `core/tests/agent/test_card_context.py`, `core/tests/background/test_routine_report.py`,
and the default prompt budget (`npm run verify -- --contract`). Not covered offline, left to a live brain run: whether a given model, told
all this, still refuses; that needs a paid run on the owner's own models.

## A failure is information (R-PERSIST-01 through R-PERSIST-08, 2026-11-14)

Owner: members give up too fast; like Hermes Agent, a member keeps trying the next plausible way and asks only for what only
he can give. A core-only unit: harness words, the failure text, two notes, a reader fallback and a history projection. No
page, RPC, schema or stored member data (routines, skills, instructions, memory) changes; every check is offline.

- The rule lives once, in `agent/self_check.DOCTRINE` (part of the shared contract every prompt reads). The caps it replaced
  were in `ABOUT_INDEX`, `DOCTRINE`, `failures.CORRECTIVE_NOTE`, `data_floor.WRITE_REFUSAL`, `tool_guardrails._diagnose`
  and `persona._WORK_RULES`; `narration.NARRATION_RULES` lost "Only open a browser when the owner asks". The default prompt
  test measures the budget (API / CLI: 15939 / 15204 before, 15929 / 15206 after, limits 16048 / 15212).
- How a failure reads: `worker.loop.failure_text`, used by `result_text` (API turns, background API runs, a paused call's
  answer) and by `agent/cli/loop.CliLoop._tool` (interactive and background CLI). `REFUSED` (owner and safety rules),
  `NOT_MADE` (held back by the harness), everything else "failed" with the harness's words of what to do instead (no code
  beside them) or its own kind and words (2000 characters, redacted), and "Another way may still work." `worker/context.py` still tells refused and failed calls apart by these words.
- The note before a turn may end: `failures.failure_ledger`, sent by `run_task` once for each round of failed calls
  (`corrective_rounds`: 1 in a narrated turn, 2 in `worker/runner.py`) and by `CliLoop._ledger` with a tool's first
  failure. `OWNER_DENIED` stops it; `NOT_MADE` kinds never start it. Background tests that script a run ending on a
  failed call give the model one more reply for it (`test_handoff`, `test_routine_health`).
- Guards: `worker/stall_guards._INTENT` (announced steps) and `ToolGuardrails._across` (failures of different tools).
- Replayed turns: `AgentHistory.with_work` sets `Turn.stopped` for a short "could not" reply whose last step failed
  (`history.gave_up_words`); `memory.conversation.turn_text` and `attribution.unfinished_note` read it. The fold's
  instructions (`_SUMMARY_SYSTEM`) and `SUMMARY_HEADER` (API `build_user_message`, CLI `fresh_user` / `resumed_user`).
- Reading: `ServiceHub.read` / `backup_reader` (`WHOLE_READ_FAILURES`), `tools.web_read` (`BROWSER_MAY_READ`,
  `READ_CAUSES`), `services/web.needs_rendered_read` (consent and terms words).
- `self_check.own_connections` adds `your_connections` to the snapshot.

Offline: `core/tests/agent/test_persistence.py`, `core/tests/worker/test_persistence_guards.py`,
`core/tests/services/test_read_fallback.py`, the existing worker, agent, memory, services and background folders, and
`npm run verify -- --contract` (scenario drivers and the prompt budget). Not covered offline, left to a live brain run on the
owner's own models: whether a given model, told all this, now opens its browser or tries another source instead of
stopping; a live read of a real consent page; a real reading service's fallback.
