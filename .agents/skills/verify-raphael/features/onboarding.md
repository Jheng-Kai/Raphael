# Onboarding

## Sub-features

While the guide is up the window is the card itself (owner, 2026-11-07, as Typeless's): guide-window.ts
sizes it to 960 x 640 under the control strip, centres it, turns off resizing and maximizing (no maximize
button, no resize edges, a double-click on the strip does nothing) and gives back the earlier size, place
and maximized state when the guide ends; `guide-window-fixed` in the onboarding scene checks the requests.
The welcome's language dropdown stands alone, with no 「介面語言」 label (its name is its aria-label).

A welcome with the language dropdown, then three steps that are each a choice, then entry into
the usable app with first-run state saved. There are no practice lessons, no microphone step and
no completion screen (owner, 2026-11-07). Everything sits in one card of a designed size (at most
960 x 640) in the middle of the window, with no progress bar: the step on the left (a way back, the
headline, the choice, one wide primary button) and Raphael's first blue slime with one sentence
about the step on the right; below 860px wide that side goes and the welcome shows his face. The
rerun from Settings exists for the current setup round only.

1. **AI tools** (`onboarding-tools`, `onboarding-tools-key`): ChatGPT sign-in, the Claude Code,
   Codex and Antigravity command-line accounts and the OpenRouter key, as items with their state.
   ChatGPT and the command-line tools are driven by the same account controller as Settings >
   Models (`createCliBrains`); the key uses the same masked field, paste button and core call.
2. **Services** (`onboarding-services`): up to six popular apps of the Connect apps store, from
   the built-in catalog plus the Composio-managed apps when Composio is set up; only apps that ask
   for no more than a sign-in. One sign-in button each, then a Connected state.
3. **Abilities** (`onboarding-abilities`, `onboarding-abilities-choice`): the shared abilities
   of Settings > Tools (web search, reading web pages, images, PDFs, speech) as the very rows and
   dialogs of that pane (`createServices`): each says which service it uses, keeps its switch and
   opens, inside the card, the choice of service with its key, and for images the model picker.

Every step can be gone past without choosing. The last step's primary button finishes; a first
run then saves the device setting `onboarded`, a rerun from Settings does not.

## How to get to it (user POV)

Launch with a fresh isolated data directory. Press Start, then Continue through the three steps
and finish on the third to land on the Home overview. Never reset an installed user's onboarding
state.

## Driving it with look

```powershell
npm run look -- onboarding onboarding-tools onboarding-tools-key onboarding-services onboarding-abilities onboarding-abilities-choice after-onboarding --theme both --width 1120,720,1920x1080
```

Keep the welcome and each step's PNGs, the contact sheet and the report. Each scene presses the
real Next button from the welcome; `onboarding-services` signs in to Gmail through the managed
connector and `onboarding-abilities` switches reading web pages off, so the rendered checks see a
changed state. Check that each item keeps its mark, name and control in one row, that the controls
are real buttons and switches, that nothing is cut off at 720 wide (one column) and that the dark
theme has no light edges. Native proof needs an authorized fresh `RAPHAEL_DATA_DIR`: finish the
steps, relaunch and verify onboarding stays dismissed and the chosen tools, services and switches
persist. Keep sanitized readback and stop the owned dev process.

## Gotchas

Each scene begins fresh. The onboarding variant overrides the ordinary onboarded device setting.
The look mock signs no one in to ChatGPT, has all three command-line tools ready and the
OpenRouter key set; `integrations.connect` is cancelled there, so only a managed app proves a
completed sign-in. Credentials, real browser logins, command-line sign-in and native persistence
remain separate checks.

## UI audit regression coverage

R-UI-35: every `.ob-item` keeps its control on the right of its name, inside its card
(audit.mjs, audit.test.mjs); the card keeps its designed size, sits in the middle and shows
Raphael's side when wide. R-UI-37: a headline of at least 28px per screen (`.ob-col > h2`; the
dialogs of the abilities keep their own size) and a primary action that fills the action row. `onboarding-tools`, `onboarding-services` and
`onboarding-abilities` carry the rendered check of the same name: the expected items, the control
inside the card and centred, whole names, a headline and no purpose line.

UI hand-off also runs these named scenes at 1920x1080 in both themes, as required by the shared
guardian hand-off gate.

## No conversation setup (owner round 4)

Raphael is usable immediately, including fresh installs and cleared conversations. The frontend
no longer uses profile_ready to hide the ordinary empty thread/composer. The naming/personality/
work wizard, its styles and its strings are removed. The ordinary editable member proposal
remains available from Create from description.

```powershell
npm run look -- no-naming onboarding after-onboarding --theme both --width 1120,720,1920x1080
```

The welcome stands in the middle of the card's left side. Manual initial and
second launches reveal/focus the main window; only --autostart stays hidden. Every launch opens
at the designed 1280x800, centred; window-state restores nothing, not even a last maximized
window. Rust policy regressions live in first_run.rs and window_state_tests in lib.rs.
