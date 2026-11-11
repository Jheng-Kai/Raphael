# Desktop security and release path

The 2026-11-05 review covers the Tauri command/window boundary, capabilities and
asset scope, Markdown/HTML/SVG rendering, openers, passive overlays and hotkeys,
stdio and loopback IPC, signed updates, installer/release workflows and lockfiles.
Treat model and external content as untrusted; owner-window identity does not make
an embedded page an owner instruction.

R-SEC-01: AttachmentStore.open_path admits only reviewed document/media/archive
extensions. Unknown/native executable associations fail without preventing upload
or model reading. Existing HTML/SVG open in the external handler; this does not
guarantee a safe third-party handler or macro-free document.

R-SEC-02: prepare-release-assets rejects noncanonical numeric versions before writes.
R-SEC-03: the release job pins a new tag to github.sha and checks the resolved commit
of an existing tag before publication. Offline Bash fakes cover missing/matching/
mismatching tags and API failure. No GitHub request or release is made by tests.

From app/: tsc --noEmit; the Vitest suite (two workers on the shared machine);
from core/: pytest tests/services/test_attachment_upload.py
tests/services/test_attachments.py tests/services/test_file_reader.py tests/architecture.
The security audit also exercises existing page/viewer/web/RFB fake tests and Rust
command, RPC, hotkey, overlay and signed-updater tests. Evidence and exact commands
are retained in .fold/report.md. The isolated Cargo target is .fold/cargo-target.

Follow-up 1 changes the composer UI and closes the original SEC-05 decision.
R-CARD-11 / R-SEC-05 require page text to be placed in the focused composer with
a localized provenance note, never submitted by the page. The owner submits it;
a waiting page question continues only then. Page success is placed, never sent.
Provenance survives drafts/failures and transcription does not auto-submit it.
The selected page-card/room look matrix and its evidence are in conversation.md
and .fold/report.md. Native installed-app, live provider and real GitHub release
acceptance remain unverified. The original red evidence is retained.

R-SEC-04: core_process.rs bounds each child-process stdout/log line, drains excess
bytes without allocating, and resumes at the next newline. Rust regression tests
cover excess lines with/without a delimiter, recovery, exact limits and UTF-8 bytes.
The command-window guard also enumerates member_template_file and pick_output_folder;
both already checked require_main before this audit.
