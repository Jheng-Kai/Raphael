# Speaker capability parity (2026-11-04)

R-AG-PARITY-01..03 cover the shared tool/capability contract, private long-work lane,
Raphael owner instructions, draft preference and movable coordination. Models,
permission cards, approvals and Alt+Space ownership stay unchanged.

## Offline evidence

- core/tests/agent/test_speaker_parity.py builds all three speaker offers with either
  primary and compares complete definitions and the one shared capability statement.
- core/tests/members/test_capability_parity.py captures actual API and CLI turns after
  moving the primary, including identity 0 without a role.
- core/tests/background/test_private_self_lane.py captures actual API/CLI worker offers
  and exercises named-conversation self-work, selected brain, idempotency and cancellation.
- core/tests/agent/test_answers.py checks the quick voice owner instruction.
- core/tests/members/test_service.py checks persisted draft preference and real primary role.
- app/src/main/member-details.test.ts checks the same switch calls for Raphael and members.

Run touched tests while iterating. At handoff run the whole core suite once after
.fold/wait-heavy.ps1, then npm.cmd run verify once after another waiter.

## Deferred UI acceptance

Selected scenes: speaker-draft-chief, speaker-draft-member, speaker-draft-profile. Both themes; widths
1120,720,1920x1080. Compare Raphael and member details draft switches at the same
theme/width, and the member profile Soul draft switch: shared words, tg component,
state and row styling. speaker-draft-chief and speaker-draft-member open settings and toggle the real switch off. The settings row is new; browser geometry, keyboard focus,
contact sheets and full-size images have not been inspected in this unit.
The deferred command is:

```powershell
npm run look -- speaker-draft-chief speaker-draft-member speaker-draft-profile --theme both --width 1120,720,1920x1080
```

The brief explicitly forbids look and native. Judge requires those same selected
look artifacts and authorized network, so it is SKIP here. Real provider/CLI behavior,
video generation, native persistence, audio and OS hotkeys remain unverified.
