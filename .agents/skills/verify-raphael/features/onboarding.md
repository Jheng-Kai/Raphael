# Onboarding

## Sub-features

While the guide is up the window is the card itself: guide-window.ts
sizes it to 1080 x 720 under the control strip (on a screen
whose free area is smaller it takes that area less a 32 px edge, never below the app's 720 x 480), centres it,
turns off resizing and maximizing (no maximize
button, no resize edges, a double-click on the strip does nothing) and gives back the earlier size, place
and maximized state when the guide ends; `guide-window-fixed` in the onboarding scene checks the requests.
The welcome's language is a quiet button at the card's top left (globe, the language's own name, chevron; its
name is its aria-label) that opens the language picker (language-picker.ts: each language in its own script, a
search field once there are more than eight).

A welcome, the first slime (its look and its name), then three steps that are each a choice, then entry into the usable
app with first-run state saved. There are no practice lessons, no microphone step and no completion screen. Everything sits in one card of a designed size (at most 1080 x 720) in the middle of
the window, with no progress bar and no side: every
step is one calm centred column, a title (three of the team's slimes float by it, aria-hidden,
others on every step and in other places; gone below 640px wide), the choice, and under it two round buttons
together in the middle of the card: the way back at the left and the way on at the right, the shared 36 px round back button and a 48 px forward circle holding a filled right-pointing triangle, 12 px apart. Neither has words: each is named for assistive tech and in its tooltip, 上一步 and 下一步 (開始使用, or 完成
on a rerun, on the last step, whose way on holds a check instead of a triangle). The way on is a circle of the
solid accent; the way back is on a quiet grey, one step lighter under the pointer, takes the app's focus ring
from the keyboard and comes before the primary in the tab order; neither has an edge. The guide's primary action is
the one exception to the shared button height. The pair is neither two stacked pills (the stack takes room the AI tools
and services steps need), nor a round arrow beside one wide pill, nor a worded pill at each end of the row: it is two
round buttons together in the middle, without words. The pair stands in the same place on
every step and never stacks, and the height a second pill used belongs to the step's content. The welcome keeps
its one wide pill (360 px) in the middle and nothing else; a status in a tile
wraps inside it in every language. There is no back arrow at the top: the welcome has the pill alone, with nothing but 開始 on the first page; a close mark shows only for someone who has been
through the guide before, never on a first run. The guide is the first run's only:
Settings has no 導覽 entry any more;
`settings-owner` checks that General has no way back into it.

0. **Welcome** (`onboarding`, check `onboarding-welcome`): Raphael's emblem (the voice screen's
   canvas renderer, appearing as on the desktop), its name as one wordmark for every language,
   「智慧之王ラファエル」 (`public/brand/wordmark.svg` through a CSS mask in the text colour; a reader
   hears `onboarding.welcomeTitle`), and under it what the team can do typed
   instead of a slogan: an ask appears a letter at a time with a caret, Raphael's
   answer in its manner (告。/解。/否。) fades in under it, then the ask is deleted and the next typed (six
   pairs, `onboarding.demo*`); with reduced motion the first pair stands; a reader hears one sentence
   (`onboarding.demoSummary`). Then one pill, 開始.
1. **The first slime** (`onboarding-slime`, checks `onboarding-slime-waits` and `onboarding-slime`, R-CHIEF-01, R-RAPHAEL-UI-06): the owner's
   first slime, their chief of staff from then on, is a slime of their own, not Raphael. Its slime stands large in the middle (112 px,
   wearing the chief's crown), under it its name in the guide's own pill field (at most 16 characters, centred), and under
   that the members' own slime picker (slime-tabs.ts, the one 新增角色 and the member settings open) without the popover's
   chrome; its look starts as the first blue slime and a press dresses it at once. The name is the one thing the guide asks
   of everyone: the built-in name is never put in the field, and the way on (and Enter in the field) waits for a name. The
   way on makes the slime (`members.create {name, avatar}`: a real member, which the core makes the chief of staff) and writes nothing as Raphael's; a refusal is said and the step stays
   (so does Raphael's own name, which no slime bears); going back and on again with nothing changed sends nothing, a changed name or look updates the slime it made (`members.update {id, name, avatar}`) and never makes another. A chief slime the owner already has (the guide shown again)
   stands in the field and is the one updated. No floating
   slimes on this step: the slime being made is the picture.
2. **AI tools** (`onboarding-tools`): a store (every
   tool equal, never ordered by what one owner set up). A search box (typos forgiven, R-FIND-01),
   then 熱門, the same for everyone (`POPULAR_TOOLS`: ChatGPT, Claude Code, Codex, OpenAI,
   Anthropic, Google Gemini), then every other tool under its kind (subscription accounts, official,
   gateways and clouds, this computer), each kind by name. OpenRouter is a gateway among the others. The two store steps use a 900 px column.
   Every tile is one row, as a store's app is (a tile is never tall, an email never
   breaks over two lines and OpenRouter's heavy mark does not sit unevenly): the mark at 20 px in a 36 px soft
   square, the name over one quiet line that ends in … instead of wrapping (ChatGPT signed in shows
   only its account), and on the right its one button, then the check of a ready tile (black edge in
   light, lifted fill in dark; the check carries the word a reader hears). Three tiles to a row where
   each gets at least 256 px, two in a 720 px window. Every provider, OpenRouter included, has 連接,
   which opens the same editor as Settings › 模型 › 新增供應商 (`onboarding-provider-editor`: tested before it is saved, R-PROV-TEST-01); the guide has no key tile of its own
   (R-COPY-02). ChatGPT and the command-line tools are driven by the same account controller as
   Settings > Models (`createCliBrains`).
3. **Services** (`onboarding-services`, `onboarding-service-waiting`, `onboarding-services-composio`,
   `onboarding-composio-key`, `onboarding-composio-saved`, `onboarding-services-n8n`): a search box,
   then, when Composio has no key, Composio's card across the step (Composio is connected first, and only
   without it are the connectors that need no Composio shown): 連接 opens its
   masked key field with 取消 and 貼上 in the card, and its line says where the project key is; a
   refused key is told beside it in the store's own words, a saved one reads the store again with
   Composio's apps and the card goes. Under it 「不用 Composio 也能連接」 (熱門 once Composio is set up)
   and up to eighteen popular apps that ask only a sign-in, from the built-in catalog plus the
   Composio-managed apps once it has a key. A search looks through every app the guide knows,
   whatever it asks (typed letters first, near spellings only when nothing matches, at most thirty):
   an app that wants its own key or developer app has 加入, which opens the store's own form
   (connection-setup.ts); n8n, which runs on the owner's own server (connections.ts `ownServerApps`),
   has 加入, which opens its address and access token across its tile with 取消 and 連接, and Enter
   adds it through `integrations.add` with the store's header.
   A tile that only signs in is one whole button with 登入 on its right; a connected one has the check.
   A waiting tile keeps its words inside it in every language and its 取消 stops the wait at once, even
   when the login never answers; lists the core does not answer within 15 s turn into 重試 (a cancelled
   sign-in never leaves the step spinning).
4. **Abilities** (`onboarding-abilities`, `onboarding-abilities-choice`): the shared abilities
   of Settings > Tools (web search, reading web pages, images and PDFs; no speech) as the very rows and
   dialogs of that pane (`createServices`): each says which service it uses, keeps its switch and
   opens, inside the card, the choice of service with its key, and for images the model picker. That choice dims the whole
   window like every dialog, the caption strip included (R-UI-141); the window buttons stay on top of the dim.

Every choice can be gone past without choosing; the first slime asks only for its name. The last step's primary button finishes; a first
run then saves the device setting `onboarded`, a rerun from Settings does not.

## How to get to it (user POV)

Launch with a fresh isolated data directory. Press Start, name the first slime (and choose its look), then Continue
through the three steps and finish on the third to land on the conversation of the slime you named. Never reset an installed user's onboarding
state.

## Driving it with look

```powershell
npm run look -- onboarding onboarding-slime onboarding-tools onboarding-provider-editor onboarding-back-hover onboarding-back-focus settings-owner onboarding-services onboarding-service-waiting onboarding-services-composio onboarding-composio-key onboarding-composio-saved onboarding-services-n8n onboarding-abilities onboarding-abilities-choice after-onboarding --theme both --width 1120,720,1920x1080
```

Keep the welcome and each step's PNGs, the contact sheet and the report. Each scene presses the
real Next button from the welcome and names the first slime 小藍 in the red horned slime on the way (`after-onboarding`
checks `first-slime-named`: one `members.create` kept both in a new member, the chief of staff, Raphael is as it was, and the sidebar's first row wears them); `onboarding-services` signs in to Gmail through the managed
connector and `onboarding-abilities` switches reading web pages off, so the rendered checks see a
changed state. The Composio scenes start without a key: `onboarding-composio-key` types a consumer
key (refused beside its field), `onboarding-composio-saved` a project key (the card goes and
Composio's apps join); `onboarding-services-n8n` searches n8n and opens its address field (check
`onboarding-composio` for the card). Check that each tile is one row with its mark in its square,
its name, one line and its control on the right inside it, that the tiles stand in three columns
(two at 720), that the controls are real buttons and switches, that the foot is the pair (two round buttons
together in the middle, the shared back chevron and a forward triangle pointing right, a check on the
last step, in the same place on every step, never stacked at 720) and the
grid fades out over it, that the steps' content ends above the foot, that nothing is cut off at 720 wide
and that the dark theme has no light edges. `onboarding-back-hover` hovers the way back (a lighter surface than at rest)
and `onboarding-back-focus` presses Shift+Tab from the primary (the way back takes the app's focus ring, so it
is before the primary in the tab order). Native proof needs an authorized fresh `RAPHAEL_DATA_DIR`: finish the
steps, relaunch and verify onboarding stays dismissed and the chosen tools, services and switches
persist. Keep sanitized readback and stop the owned dev process.

## Gotchas

Each scene begins fresh. The onboarding variant overrides the ordinary onboarded device setting.
The look mock signs no one in to ChatGPT, has all three command-line tools ready and the
OpenRouter key set; `integrations.connect` is cancelled there, so only a managed app proves a
completed sign-in. Credentials, real browser logins, command-line sign-in and native persistence
remain separate checks.

## UI audit regression coverage

R-UI-35: the choice is tiles in a grid of three (rows for the abilities) with each tile's control
inside it and clear of its name; the card keeps its designed size and sits in the middle. The
rendered checks enforce this on `.ob-tile`: one row of at most 64 px (a wrapping status excepted),
the 36 px mark square, the line on one line and the control on the right of the name, centred (the
older `.ob-item` hook of audit.mjs matches no element of the guide any more).
R-UI-37: a headline of at least 28px per screen (`.ob-col > h2`; the dialogs of the abilities keep
their own size) and a primary action that fills what the back arrow leaves of the action row (`.ob-actions`, 360px
wide with the arrow, a circle as tall as the pill, at its left; R-UI-16 lets this one icon button keep the
grey surface of the pill it replaced).
`onboarding`, `onboarding-tools`, `onboarding-services` and `onboarding-abilities` carry the
rendered check of the same name (`onboarding-welcome` for the welcome): the expected tiles in three
columns, the control inside its tile, whole names, a headline, the floating slimes clear of the
title, the arrow and the pill on one centred row as wide as the welcome's pill (the foot one control
tall plus its padding, the content ending above it) and no purpose line. Vitest
(`onboarding/mount.test.ts`): a step with a way back draws the arrow, which has no text and the name
`onboarding.back` and goes back, then the pill and nothing else; the welcome draws the pill alone on a first run and
on a rerun, and the way back from the first step returns to it.

UI hand-off also runs these named scenes at 1920x1080 in both themes, as required by the shared
guardian hand-off gate.

## No conversation setup

Raphael is usable immediately, including fresh installs and cleared conversations. The frontend
no longer uses profile_ready to hide the ordinary empty thread/composer. The naming/personality/
work wizard, its styles and its strings are removed. The ordinary editable member proposal
remains available from Create from description.

```powershell
npm run look -- no-naming onboarding after-onboarding --theme both --width 1120,720,1920x1080
```

The welcome stands in the middle of the card. Manual initial and
second launches reveal/focus the main window; only --autostart stays hidden. Every launch opens
at the designed 1280x800, centred; window-state restores nothing, not even a last maximized
window. Rust policy regressions live in first_run.rs and window_state_tests in lib.rs.
