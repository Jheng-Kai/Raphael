# Navigation: the start, the sidebar's foot and the account menu

## Sub-features

### Product contract (R-SIDE-01 and R-SIDE-02)

There is no Home page. The app opens on the chief's conversation, and the calendar opens only when it is asked for. A daily
report is something the owner asks Raphael for, not a page. The foot of the sidebar is the owner's face and the Connections
pill; dictation and the calendar sit beside it in the account menu, and the pill has an effect on hover.

- **The start.** The app opens on Raphael's conversation, the top row of the sidebar selected, on a first run after the guide, and for
  every route that went to Home (the tray's first item, which now says 打開 Raphael, `START_PAGE` in `navigation-pages.ts`). The
  guide itself is as it was. There is no house button and no page button in the sidebar: the only places a row stands selected are the
  open conversation's own (away from the conversation page none is).
- **The foot (list).** One row at the bottom of the list: the owner's round face (32px; a real button named by the owner;
  it opens the account menu) and, taking the rest of the row, the 連結應用程式 pill (36px, fully round, `--surface-2`, no frame, no
  tooltip): its words (medium weight) and the connected apps' marks (up to three) are one group centred in it, the marks right after the
  words, each on a white tile (`.sidebar-app-mark`, 14 x 16px, radius 4px, `--marks-tile`) with the tiles touching at rest. The update notice stays above
  the row. The words never wrap; the marks that do not fit are dropped, last first (`fitMarks` in `sidebar.ts`, on every resize of the
  pill); only a translation longer than the whole pill is cut, with an ellipsis.
- **The hover.** Under the pointer the marks fan out like a hand of cards, with measured values: the outer ones move 3px away
  from the middle one and turn 8deg outward, the middle one lifts 1.5px, all grow to 1.1, in 180ms ease-out and back in 280ms ease-in-out;
  the fill takes the hover token and the words do not move. Tile `transform` only, finite, none under reduced motion. The values are
  `--marks-spread`, `--marks-lift`, `--marks-scale`, `--marks-turn`, `--marks-time-in`, `--marks-ease-in`, `--marks-time-out` and
  `--marks-ease-out` on `.sidebar-apps`, retuned in one place.
- **The account menu.** Pressing the face opens it above the face, left edges together (beside the whole rail, 8px past its right edge, ending where the face ends): 用量 (a chevron and no number: one provider's figure under the bare word would read as everyone's; pointing at it or pressing it opens a submenu at its right
  edge with a block for every provider the owner uses, in a stable order: the subscriptions the reading returns (Claude, Codex, Antigravity, in its order), the ChatGPT sign-in, then OpenRouter. A subscription: its tightest window's name such as 「Codex 每週」 and its 已使用 N%, with no reset time;
  one that reported no percentage says what it reported (可使用, 接近額度上限, 額度已用完); a reported window past its reset is 已重置 with no number; one that cannot be read keeps its block and says 無法讀取 (the ChatGPT sign-in has no usage to read). OpenRouter: 「OpenRouter 本月 US$3.21」, and what is left of the key's limit under it. Every provider in use is shown, unless it cannot be.
  Then a hairline and 管理用量, which opens Settings at its usage section; with no provider known the row has no chevron and opens that section directly), 聽寫 (the dictation page), 行事曆 (the calendar on today),
  a hairline, 設定. Enter or Space on the face opens it with the focus on the first row, the arrows move, Esc closes it (the submenu alone
  first) and returns the focus to the face, a press outside closes it, the face again closes it (R-UI-124). It uses the app's menu tokens.
- **The member search.** The search button, Ctrl+Shift+F and the palette's Search (on the rail, which has no button, Ctrl+Shift+F) open one card in the middle of the dimmed window, across and down at every size (R-MENU-04): 560 px wide (the window's less 24), 480 px tall (the window's less 96), so the words typed never move it, always below the window controls and inside the window. `sidebar-search` (button, typing never moves it), `sidebar-search-rail` (Ctrl+Shift+F on the rail) and `shortcut-search` (the palette) each check it with `search-card-middle`.
- **The rail.** Under 860px, or dragged narrow, the foot is a column: the plus alone (no search on the rail; Ctrl+Shift+F still opens it), the apps icon (Lucide `grid-2x2-plus`, accessible name
  only, no tooltip), then the face (named on hover, as the other faces of the rail). The menu is the same, opening beside the rail and covering none of its buttons.
- **What the numbers are.** `usage.allowances` (`api.usageAllowances()`), `chatgpt.status` and `status.get` (OpenRouter's own reading of the key), each read at each opening of the menu, shown at once from
  the last readings and landing as they arrive (a slow Codex read never holds back the others); a reading that fails changes only its own provider's block. What each reading means is decided once in `usage-blocks.ts`,
  which Settings' usage cards read as well, so the menu and the cards cannot disagree. Another unit owns how the allowances read refreshes.

## How to get to it (user POV)

Open the app: the chief of staff's conversation (Raphael's when there is no slime). Press the round face at the bottom left (the bottom of the rail): 用量, 聽寫, 行事曆, Raphael (its own conversation; the guided tour presses 聽寫, 行事曆 and this row in turn, onboarding.md), 設定. The
pill beside it is 連結應用程式.

## Driving it with look

```powershell
npm run look -- start-conversation start-startup-order foot-rest foot-starter-apps foot-apps-one foot-apps-one-starter foot-apps-two foot-apps-three foot-account-menu foot-usage-submenu foot-usage-two foot-usage-credits foot-usage-default foot-usage-owner foot-usage-none foot-usage-manage foot-account-keys foot-usage-keys foot-account-outside foot-account-dictation foot-account-calendar foot-account-settings foot-pill-hover foot-pill-reduced foot-pill-narrow daily-footer-away sidebar-air sidebar-air-foot sidebar-rail opener-toggle-settings opener-toggle-account-menu after-onboarding --theme both --width 1120,720,1920x1080
```

The Connections pill always shows three marks beside its words, read by `foot-pill-marks-<ids>` in the order the scene's apps must give: the connected
apps' own first (most recently used first), then the starters that are not connected (Gmail, Notion, Google Calendar) up to three. foot-starter-apps has no app
connected (gmail, notion, googlecalendar), foot-apps-one has Slack (slack, gmail, notion), foot-apps-one-starter has Notion (notion, gmail, googlecalendar: the
starter stands once), foot-apps-two has Slack and GitHub (github, slack, gmail) and foot-apps-three has three apps (linear, github, slack: no starter stays). On the rail
there are no marks.
start-conversation and foot-rest measure the foot at rest in both shapes (the list's one row: face 32px, pill 36px and round on
`--surface-2`, 8px between, the pill to the foot's right edge, one row of two, words whole; the rail's column with the 36px icon button
and the face) and fail on any Home, house, microphone or page button; foot-account-menu measures the menu (six rows with distinct Lucide
icons, Raphael's own slime on its row, a hairline each side of Raphael, placement above the face or right of it on the rail, inside the window, the chevron at the
right and no number, menu tokens); foot-usage-submenu and foot-usage-two the submenu (its place at the menu's edge and level with its row, one block per
provider of the mock (the subscriptions in its order, the ChatGPT sign-in when signed in, OpenRouter with a key), in a stable order, each with name and its words (a number with no reset line, 已重置, 無法讀取 or OpenRouter's spend), then a hairline and 管理用量; the first with Claude, Codex and Antigravity (the fixture's Gemini CLI) and OpenRouter, the second with the two the owner has connected and OpenRouter;
foot-usage-owner the owner's own mix (Codex live at 65% used, Claude whose reported window has reset, the ChatGPT sign-in, OpenRouter with its own spend: exactly those four blocks, in that order, Claude with no number);
foot-usage-default the same with the fixture's own windows; foot-usage-none the row with nothing connected (no key either: no number, no chevron, no submenu); foot-account-keys and foot-usage-keys the keyboard
(focus on each row, ArrowRight, Escape closing the submenu alone and then the menu, the focus back on the face); foot-account-outside a
press inside the conversation closing the menu and its submenu; foot-pill-hover the marks' translate, turn and scale against the named values after the
motion settles (nothing to move on the rail) and foot-pill-narrow the narrowest list with the pill's words whole and the marks dropped.
sidebar-air checks the foot with the list's other geometry. Inspect every sheet and the full-size images in both themes.

Native readable-layout inspects the start at 720, 1920x1080 and 1280x800 and opens the calendar from the account menu; the calendar journey
opens a member's event on the Calendar page; the sidebar-foot journey measures the foot and the menu in the real WebView. The native
journeys were rewritten for this change and have not been run.

## Gotchas

### Data and refresh boundaries

`home.overview` stays, but only as the calendar's projection: `calendar_events`, `calendar_google` (and `calendar`, `calendar_items`,
`calendar_counts`, `today`, `reports`, `counts`, which the core's tests keep). The daily line Raphael's own model wrote for Home
(`today_plan`, `DailyNarratives`, `home.changed`), the health check, the charts, the spend, allowance and dictation figures and the
status report are no longer built or sent: the model is no longer asked once a day for nothing, and a calendar read no longer starts a CLI
allowance read. The owner's time zone, which Home sent with every start, now comes with `members.viewing` (the open conversation) and
reaches the calendar's zone and the computers' clock through `members.timezone_seen` (`home.note_timezone`).

Google Calendar uses connectors.status(refresh=false) and the existing private calendar_list_events tool only when ACTIVE/enabled; the
`composio:googlecalendar` toolkit also supplies it through the fixed core read path, and the direct Google sign-in wins when readable.
Unavailable, disabled or expired connections yield no connected events, and `calendar_google` says which it was; own events and local
routines remain available. Offline pytest covers the projection and HTTP doubles; browser fixtures prove the UI.

## First start-up

The first start of the app must not be slow. The first view (the roster, the rooms, the open conversation) is asked for first;
the model, app and Settings read-ahead (`models.catalog`, `brains.cli`, Connect apps, Settings) wait until the first view is answered and
then run one at a time (`app/src/main/startup-reads.ts`, R-START-02). Scene: `start-startup-order` gives the mock core a 60 ms answer time
and fails if `models.catalog` or `brains.cli` began while `members.list` or `rooms.list` was still waiting for its answer, if those two
overlapped, or if a first-view read was never asked for. The roster carries no pictures (`members.picture`, R-START-06): the look mock
still inlines `avatar_url`, so the picture path is covered by vitest, not by look.

## Back and Forward

Mouse Back (XButton1), Mouse Forward (XButton2), left Alt+Left/Right and Command+[ / Command+] in the main window use R-NAV-03 and R-NAV-04. Place history retains fifty visits and skips deleted destinations. Each Back press closes the current menu, goes up one level, closes an opened layer at its root, or retraces a place. Forward reverses the Back steps of a layer from the place where it was left, until a new choice. Tabs and sections are not steps.

| Surface | Back | Forward |
| --- | --- | --- |
| Member conversation, older conversation, group room | Previous retained conversation or room. An unanswered card or unsent composer draft keeps the current place. | Next retained place. The same guard applies. |
| Calendar / Automations | Previous place. Day, week and month, date and mini calendar, and filter controls stay within Calendar. | Next place. |
| Dictation | Previous place. Overview, History and Dictionary are sibling tabs. A date filter, search or pagination does not add a stop. | Next place, with the current Dictation tab. |
| Settings | Close Settings over the current place from General, Models, Usage, Tools, Team skills, Dictation, Safety or About. | Reopen the selected Settings section. |
| Settings ? Usage / Overview / Analysis, period and chart controls | Close Settings. The usage tabs and filters stay within the section. | Reopen Settings on the selected Usage tab. |
| Connect apps / Connectors / categories, search, recommendations | Close Connectors over the same place. | Reopen its list and selected category. |
| Connectors ? Connected apps ? app or server, including Slack; tools and audit disclosures | Return to the list that opened the app or server. From Connected apps return to Connectors. Disclosures stay within the app page. | Open the list or app or server that Back left. |
| Connectors ? Add or edit server; Composio key | A clean editor returns to its source page or list. An unsaved or busy editor keeps its input. | Reopen the editor after a clean exit. |
| Connection setup / device sign-in / CLI welcome | Keep the setup or sign-in and its own actions. | Keep the setup or sign-in and its own actions. |
| Models ? provider directory ? provider setup; configured provider | A clean new provider goes to the directory. From the directory or a configured provider go to Models. Busy, dirty and confirmation states stay open. | Reopen the directory or provider setup that was left. |
| Tools ? search, read, image or PDF service picker ? service setup | A clean setup goes to the service list. From the list go to Tools. A dirty or busy setup stays open. | Reopen the service list or selected setup. |
| Team skills ? plugin ? skill details; standalone skill details | Close skill details to the plugin or list, then leave the plugin for Team skills, then close Settings. Import fields with unsaved text stay put. | Reopen Team skills, then plugin, then skill details in that order when each was closed. |
| Member settings / Tools, Skills and Commands, Persona and Instructions, Notifications | Close member settings to the same conversation. Profile fields which save on blur use that save path. | Reopen member settings on the selected section. |
| Member settings ? skill, command, cover repositioning or inline import | Return from a clean skill or command to its section. Exit an unchanged cover adjustment. Keep edits, a changed cover and a nonempty import field. | Reopen a skill or command that Back left. |
| Member side panel / Details, Library, Computer; Library filters | Close an owner-opened panel to the same conversation. A column shown by default leaves Back to the place or a more specific layer. Tab and filter changes stay in the panel. | Reopen the panel on the same tab. |
| Computer location / local or SSH host | Close the clean picker. Keep a changed SSH alias and let its normal save finish. | Reopen the location picker. |
| Computer watch and teaching review | Return from a clean review or fold the enlarged watch view. Owner control and in-progress or dirty review keep their own actions. | Restore the review or enlarged watch view that was left. |
| Group side thread | Close the clean thread to the room. Keep unsent content and pending questions. | Reopen the same side thread. |
| Peer conversation, opened HTML/plugin page or report | Return to the surrounding conversation or room. | Reopen the same peer conversation, page or report if it is still available. |
| Conversation Find and floating working card | Close Find or return the card to its original position. | Reopen Find or put the card back in its floating position. |
| Conversation picture, picture draft and fullscreen video | Close the viewer. The place, draft chips and video playback position stay with their source. | Reopen the same viewer. |
| Calendar event and rhythm detail | Close the detail to Calendar. | Reopen the detail. |
| Calendar editor, routine details, routine template review | Return a clean editor to its source. Keep edited fields. A preview of a routine or template field returns to the review. The clean top-level review closes over its place. | Reopen the clean editor or review level. |
| Member maker and avatar picker / slime tabs | Close the clean maker or the avatar picker. The maker keeps unsaved name and avatar changes. Tab choices stay within the picker. Photo crop keeps its edit controls. | Reopen on the selected tab. |
| Model chooser / source tabs, filter, effort; composer model card ? sources ? models | Close the chooser from any source. From a composer model card inner page go to its parent, and from its root close it. | Reopen the chooser on its selected source or replay the composer model card levels. |
| Primary contact or replacement, date, emoji, working folder and action mode pickers | Close the picker over its opener. | Reopen with its current selection, shown month or emoji search. |
| Member store, template gallery and review / summary, profile, skills, routines, connections | Close a clean top-level dialog over its opener. A template detail goes to its review summary. | Reopen the preserved dialog or review detail with its controls. |
| Member/group forms, shortcut editor, MCP import and Settings/vault/safety inline forms | Close a clean dismissible dialog. Keep edited fields or follow the existing cancellation and recording policy. | Reopen a clean reversible dialog. Recovery and recording controls keep their own actions. |
| Confirmation dialogs, menu confirmations, dictionary import review and inline permission / yes-no cards | Keep the question open for its answer controls. | Keep the question open. |
| Dictionary add word | Close the empty add form. Keep entered words in the form. | Reopen the empty add form. |
| First-run and replayed setup guide / welcome, tools, services, abilities | Return to the previous step within the guide. At the first step stay there. | Advance only to a guide step just left. |
| Transient menus and popovers | Dismiss the top menu or popover only, as Escape does. Includes account and usage submenu, member/group/sidebar context, composer + and its submenus, slash/mention, reaction bar, link preview, message quote control, dropdowns, actions, language/time zone and calendar tools. | While open, consume Forward. Dismissed transient menus are not destinations. |
| Other sibling controls / library filters, categories, usage periods, emoji categories, room meeting views, calendar views | Use the containing surface's action. Changing the sibling adds no step. | Restore the containing surface where supported. |
| Native file and OS dialogs, external browser, separate dictation / quick overlay windows | They own their own input. The main-window place history is not used. | They own their own input. |

## Verification

```powershell
npm run look -- nav-steps-member-settings nav-side-member-settings nav-steps-skill-arrow nav-steps-settings nav-steps-conversations nav-side-members nav-side-panel nav-layer-settings nav-side-settings nav-layer-plus nav-layer-picture nav-layer-maker nav-side-slack nav-side-plugin --theme both --width 1120,720,1920x1080
```

The scenes use the real main-window entry. Conversation checks keep the selected member and header in agreement. The member settings, side panel, maker, Settings and Usage scenes assert the selected sibling after Forward. The Slack and plugin scenes assert each nested level and the unchanged conversation beneath it. The composer menu checks one dismissal per Back; the picture journey keeps both group attachments. Native side buttons and macOS navigation chords remain separate acceptance.
