# Onboarding

## Sub-features

While the guide is up the window is the card itself (owner, 2026-11-07, as Typeless's): guide-window.ts
sizes it to 1080 x 720 under the control strip (owner, 2026-11-09: 「導覽的頁面有一點點太小」; on a screen
whose free area is smaller it takes that area less a 32 px edge, never below the app's 720 x 480), centres it,
turns off resizing and maximizing (no maximize
button, no resize edges, a double-click on the strip does nothing) and gives back the earlier size, place
and maximized state when the guide ends; `guide-window-fixed` in the onboarding scene checks the requests.
The welcome's language is a quiet button at the card's top left (globe, the language's own name, chevron; its
name is its aria-label) that opens the language picker (language-picker.ts: each language in its own script, a
search field once there are more than eight; owner, 2026-11-08).

A welcome, then three steps that are each a choice, then entry into the usable app with first-run
state saved. There are no practice lessons, no microphone step and no completion screen (owner,
2026-11-07). Everything sits in one card of a designed size (at most 1080 x 720) in the middle of
the window, with no progress bar and no side, as Grok Bot's first run (owner, 2026-11-07): every
step is one calm centred column, a title (three of the team's own characters float by it, aria-hidden,
others on every step and in other places — Gobta, Shion, Ranga; Shuna, Diablo, Benimaru; Milim, Souei,
Rigurd — owner 2026-11-08; gone below 640px wide), the choice, and under it two round buttons
together in the middle of the card: the way back at the left and the way on at the right, each a 48 px circle
holding one filled triangle that points where it goes (the same drawing, turned round for the way back), 12 px
apart. Neither has words: each is named for assistive tech and in its tooltip, 上一步 and 下一步 (開始使用, or 完成
on a rerun, on the last step, whose way on holds a check instead of a triangle). The way on is a circle of the
solid accent; the way back is on a quiet grey, one step lighter under the pointer, takes the app's focus ring
from the keyboard and comes before the primary in the tab order; neither has an edge. The guide's own sizes are
the one exception to the shared button height, kept by the owner on 2026-11-08. On 2026-11-11 the owner sent
back, in turn: the two stacked pills, because the stack took room the AI tools and services steps need
(「導覽這個 button…上下堆疊會造成我們畫面有些空間比較緊，像是選擇 AI 工具，還有連接你的服務這邊會比較需要空間。
感覺左右放，或者左右放那個箭頭之類的，或許會比較好」); a round arrow beside one wide pill in the middle
(「這個不是這樣做，我要的是左右 button」); and a worded pill at each end of the row (「改成集中在中間這邊好不好？
然後 icon 改一下，可以改特別一點點，不一定要寫字，can 用兩個三角形之類的」). The pair stands in the same place on
every step and never stacks, and the height a second pill used belongs to the step's content. The welcome keeps
its one wide pill (360 px) in the middle, with a round × at its left on a rerun; a status in a tile
wraps inside it in every language. There is no back arrow at the top; the first run's welcome has the pill alone.
The left slot is the way out of the screen: on a rerun's welcome (the guide opened again from Settings, scene
`onboarding-rerun`) it is the same round button holding a × named 取消, which leaves the guide (a close is the × alone,
never a word button; owner, 2026-11-11), so nothing in the guide stacks.

0. **Welcome** (`onboarding`, check `onboarding-welcome`): Raphael's emblem (the voice screen's
   canvas renderer, appearing as on the desktop), his name as one wordmark for every language,
   「智慧之王ラファエル」 (`public/brand/wordmark.svg` through a CSS mask in the text colour; a reader
   hears `onboarding.welcomeTitle`; owner, 2026-11-08), and under it what the team can do typed
   instead of a slogan (owner, 2026-11-08): an ask appears a letter at a time with a caret, Raphael's
   answer in his manner (告。/解。/否。) fades in under it, then the ask is deleted and the next typed (six
   pairs, `onboarding.demo*`); with reduced motion the first pair stands; a reader hears one sentence
   (`onboarding.demoSummary`). Then one pill, 開始.
1. **AI tools** (`onboarding-tools`, `onboarding-tools-key`): a store (owner, 2026-11-08: every
   tool equal, never ordered by what one owner set up). A search box (typos forgiven, R-FIND-01),
   then 熱門, the same for everyone (`POPULAR_TOOLS`: ChatGPT, Claude Code, Codex, OpenRouter,
   Anthropic, Google Gemini), then every other tool under its kind (subscription accounts, official,
   gateways and clouds, this computer), each kind by name. The two store steps use a 900 px column.
   Every tile is one row, as a store's app is (owner, 2026-11-09: the tiles were too tall, an email
   broke over two lines and OpenRouter's heavy mark sat unevenly): the mark at 20 px in a 36 px soft
   square, the name over one quiet line that ends in … instead of wrapping (ChatGPT signed in shows
   only its account), and on the right its one button, then the check of a ready tile (black edge in
   light, lifted fill in dark; the check carries the word a reader hears). Three tiles to a row where
   each gets at least 256 px, two in a 720 px window. OpenRouter is a tile too: 連接 (or the check
   and 更換) opens the masked field, 取消 and 貼上 across its row while the key is typed. ChatGPT and
   the command-line tools are driven by the same account controller as Settings > Models
   (`createCliBrains`); the key uses the same masked field, paste button and core call.
2. **Services** (`onboarding-services`, `onboarding-service-waiting`, `onboarding-services-composio`,
   `onboarding-composio-key`, `onboarding-composio-saved`, `onboarding-services-n8n`): a search box,
   then, when Composio has no key, Composio's card across the step (owner, 2026-11-09: 「要讓他們先連上
   Composio，然後如果沒有的話，才只顯示…沒有 Composio 也可以顯示的 connectors」): 連接 opens its
   masked key field with 取消 and 貼上 in the card, and its line says where the project key is; a
   refused key is told beside it in the store's own words, a saved one reads the store again with
   Composio's apps and the card goes. Under it 「不用 Composio 也能連接」 (熱門 once Composio is set up)
   and up to eighteen popular apps that ask only a sign-in, from the built-in catalog plus the
   Composio-managed apps once it has a key. A search looks through every app the guide knows,
   whatever it asks (typed letters first, near spellings only when nothing matches, at most thirty):
   an app that wants its own key or developer app has 加入, which opens the store's own form
   (connection-setup.ts); n8n, which runs on the owner's own server (connections.ts `ownServerApps`),
   has 加入, which opens its address and access token across its tile with 取消 and 連接, and Enter
   adds it through `integrations.add` with the store's header (owner, 2026-11-09: 「搜尋 n8n 也找不到」).
   A tile that only signs in is one whole button with 登入 on its right; a connected one has the check.
   A waiting tile keeps its words inside it in every language and its 取消 stops the wait at once, even
   when the login never answers; lists the core does not answer within 15 s turn into 重試 (owner,
   2026-11-08: the step spun on after a cancelled Slack sign-in).
3. **Abilities** (`onboarding-abilities`, `onboarding-abilities-choice`): the shared abilities
   of Settings > Tools (web search, reading web pages, images and PDFs; no speech since 2026-11-10) as the very rows and
   dialogs of that pane (`createServices`): each says which service it uses, keeps its switch and
   opens, inside the card, the choice of service with its key, and for images the model picker.

Every step can be gone past without choosing. The last step's primary button finishes; a first
run then saves the device setting `onboarded`, a rerun from Settings does not.

## How to get to it (user POV)

Launch with a fresh isolated data directory. Press Start, then Continue through the three steps
and finish on the third to land on Raphael's conversation. Never reset an installed user's onboarding
state.

## Driving it with look

```powershell
npm run look -- onboarding onboarding-tools onboarding-tools-key onboarding-back-hover onboarding-back-focus onboarding-rerun onboarding-services onboarding-service-waiting onboarding-services-composio onboarding-composio-key onboarding-composio-saved onboarding-services-n8n onboarding-abilities onboarding-abilities-choice after-onboarding --theme both --width 1120,720,1920x1080
```

Keep the welcome and each step's PNGs, the contact sheet and the report. Each scene presses the
real Next button from the welcome; `onboarding-services` signs in to Gmail through the managed
connector and `onboarding-abilities` switches reading web pages off, so the rendered checks see a
changed state. The Composio scenes start without a key: `onboarding-composio-key` types a consumer
key (refused beside its field), `onboarding-composio-saved` a project key (the card goes and
Composio's apps join); `onboarding-services-n8n` searches n8n and opens its address field (check
`onboarding-composio` for the card). Check that each tile is one row with its mark in its square,
its name, one line and its control on the right inside it, that the tiles stand in three columns
(two at 720), that the controls are real buttons and switches, that the foot is the pair (two round buttons
together in the middle, the way back's triangle pointing left and the way on's pointing right, a check on the
last step, in the same place on every step, never stacked at 720) and the
grid fades out over it, that the steps' content ends above the foot, that nothing is cut off at 720 wide
and that the dark theme has no light edges. `onboarding-back-hover` hovers the way back (a lighter surface than at rest)
and `onboarding-back-focus` presses Shift+Tab from the primary (the way back takes the app's focus ring, so it
is before the primary in the tab order); `onboarding-rerun` opens the guide from Settings 導覽 and checks that the
welcome's row is the × and the pill on one line. Native proof needs an authorized fresh `RAPHAEL_DATA_DIR`: finish the
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
`onboarding.back` and goes back, then the pill and nothing else; the first run's welcome draws the pill alone and
a rerun's the × (named 取消, leaves the guide) then the pill.

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

The welcome stands in the middle of the card. Manual initial and
second launches reveal/focus the main window; only --autostart stays hidden. Every launch opens
at the designed 1280x800, centred; window-state restores nothing, not even a last maximized
window. Rust policy regressions live in first_run.rs and window_state_tests in lib.rs.
