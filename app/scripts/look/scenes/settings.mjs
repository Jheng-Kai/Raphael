import { scene, click, hover, type, wait, waitGone, codexArrives, page, settings, scroll, key, navKey, check, member, rightClick, sideButton } from "./steps.mjs";

const connections = settings("connections");
// A long 關於我: eight sentences, more than the four lines the field shows at rest.
const aboutLong = Array.from({ length: 8 }, (_, at) => `第 ${at + 1} 句：我在做一個語言學習的產品，希望大家像學母語一樣，透過長時間的環境和使用自然學會一種語言。`).join("");
const add = [...connections, click('[data-k="conn-add"]')];
const custom = [...add, click('.menu [data-value="custom"]')];
// One view (R-APPS-01): the apps are what 連結應用程式 opens on, and the chip at the top right opens the connected ones.
const linked = [...connections, click('[data-conn="connected"]'), wait('.cs-linked')];
const serverDetail = [...linked, click('[data-conn="open"][data-id="notes"]'), wait('.cs-page')];
const store = [...connections, wait('.cs-card')];
// A key made up for the scenes: it is typed into a masked field and must reach nothing but the one call that adds the app.
const setupKey = "zk-look-0123456789";
const usage = [...settings("usage"), wait('[data-usage-tab="overview"][aria-selected="true"]'), wait('[data-row="raphael-spend"]')];
const analysis = [...usage, click('[data-usage-tab="analysis"]'), wait('[data-ua-card="cost"]')];
const cliAsk = [...settings("models"), scroll(".cli-accounts"), click('[data-cli-disconnect="codex"]'), wait(".mb-dialog.mb-delete")];
const cliDisconnected = [...cliAsk, click('.mb-delete [data-dlg="delete"]'), wait('[data-cli="codex"]')];
const modelChooser = role => [...settings("models"), click(`.modal-scrim [data-model-picker="${role}"] .mp-trigger`), wait(".model-chooser .mc-row")];
const localChooser = [...modelChooser("stt"), click('[data-source="local-speech"]'), wait(".lm-main")];
const downloaded = [
  { name: "qwen3-asr", title: "Qwen3-ASR", languages: ["zh", "en", "ja", "ko", "yue"], note: "dictionary", size: 878702423, ready: false },
  { name: "sensevoice", title: "SenseVoice", languages: ["zh", "en", "ja", "ko", "yue"], note: "fast", size: 163002883, ready: true },
];
const dictation = tab => [page("dictation"), click(`[data-dictation-tab="${tab}"]`), check("dictation-navigation"), ...(tab === "overview" ? [wait('.page-overview .icard'), check("dictation-overview")] : [])];
// 編輯快捷鍵 (shortcut-editor.ts): the one place where the shortcuts change; Ctrl+F8 is recorded for 貼上上一次.
const keysDialog = [...settings("dictation"), click('.modal-scrim [data-act="keys-edit"]'), wait('.kd-dialog [data-dlg="record"][data-field="paste_last_keys"]')];
const pasteRecorded = [...keysDialog, click('.kd-dialog [data-field="paste_last_keys"]'), wait(".kd-dialog [data-recording]"),
  { action: "key", key: "F8", ctrl: true }, waitGone(".kd-dialog [data-recording]")];
// The first slime (the guide's step 1): the owner names it and dresses it in the red horned slime; its way on waits for the name.
const pickFirstSlime = [click('.ob-first-picker [data-slime-tab="red"]'), click('.ob-first-picker [data-slime-character="horns-red"]')];
const named = [click('[data-ob="next"]'), wait('#ob-first-name'), type('#ob-first-name', '小藍'), ...pickFirstSlime, click('[data-ob="next"]')];
export default [
  scene("nav-layer-settings", "Back closes Settings from Usage analysis and Forward restores analysis", [
    ...analysis, navKey("back"), check("nav-settings-closed"),
    navKey("forward"), wait('.modal [data-usage-tab="analysis"][aria-selected="true"]'),
  ]),
  scene("nav-side-settings", "Mouse Back closes Settings in one step and Forward restores Tools", [
    member(1), member(2), check("nav-conversation-2"), ...settings("tools"), check("nav-settings-tools"),
    sideButton("back"), waitGone('.modal-scrim[data-page="settings"]:not([hidden])'), check("nav-side-settings-closed"),
    sideButton("forward"), check("nav-settings-tools"),
  ]),


  scene("settings-owner", "Owner identity leads General, with no weather city to set", [...settings("general"), wait('[data-owner="owner_name"]'), check('settings-owner')]),
  scene("settings-owner-about-typing", "關於我 being written: no drag handle, and the box grows with every line of a long text", [...settings("general"), wait('[data-owner="owner_about"]'), type('[data-owner="owner_about"]', aboutLong), check('owner-about-typing')]),
  scene("settings-owner-about-rest", "關於我 left with a long text: four lines and its start in sight, the rest folded, the settings under it in reach", [...settings("general"), wait('[data-owner="owner_about"]'), type('[data-owner="owner_about"]', aboutLong), click('[data-owner="owner_name"]'), check('owner-about-rest')]),
  scene("settings-about-brand", "The about tab's mark and name cannot be selected", [...settings("about"), wait('.about-brand'), check('about-brand-unselectable')]),
  // R-TIDY-01, R-KEYS-EDIT-01: the key that tidies the selected text is listed with the other shortcuts, Right Alt+T by default, and changed
  // with them in the one 編輯 dialog.
  scene("settings-tidy-key", "The 聽寫 tab lists every shortcut read-only in the order of use, 整理選取文字 third with its key, as wide as the others, and one 編輯 at the section's top right", [...settings("dictation"), wait('.modal-scrim [data-row="tidy-hotkey"]'), check("settings-tidy-key")]),
  scene("settings-keys-dialog", "編輯 opens one dialog whose rows are the list's, with no frame: all five shortcuts in the order of use, a pencil after the caps of each but Esc, 貼上上一次 too; a key recorded waits in it until 儲存", [...pasteRecorded, check("settings-keys-dialog")]),
  scene("settings-keys-recording", "The pencil of a shortcut puts the words that ask for the new keys, and Esc to cancel, where its caps were, still with no frame", [
    ...keysDialog, click('.kd-dialog [data-field="tidy_keys"]'), wait(".kd-dialog [data-recording] .rec-hint"), check("settings-keys-recording")]),
  scene("settings-keys-saved", "儲存 sends the new keys through the device settings, closes the dialog, and the list shows them", [
    ...pasteRecorded, click('.kd-dialog [data-dlg="save"]'), waitGone(".kd-dialog"), check("settings-keys-saved")]),
  scene("dictation-keys-dialog", "The 聽寫 overview's 編輯 opens the same dialog over the page", [
    ...dictation("overview"), click('.page-overview .keys-card [data-act="keys-edit"]'), wait('.kd-dialog [data-dlg="record"]'), check("dictation-keys-dialog")]),
  // R-PRIV-MIC-01: a Mac's meter never opens the microphone before the owner allows it; 測試麥克風 asks macOS, once.
  scene("settings-mic-undecided", "A Mac whose microphone macOS has not asked about: 聽寫 says so with 測試麥克風, and the meter stays closed until it is pressed", [...settings("dictation"), wait('.modal-scrim [data-act="mic-ask"]'), check("settings-mic-undecided")], { microphone: "undecided" }),
  scene("settings-mic-denied", "A Mac whose microphone was refused: 聽寫 says where to allow it, its button opens that pane, and the meter stays closed", [...settings("dictation"), wait('.modal-scrim .missing-note [data-missing-pane]'), check("settings-mic-denied")], { microphone: "denied", mac: true }),
  // R-PRIV-AX-01: on a Mac without Accessibility no global key is heard, so no paste or tidy fails to say so; 聽寫 says it instead.
  scene("settings-accessibility-off", "A Mac without Accessibility: 聽寫 says so above the shortcuts, and its one button opens the pane", [...settings("dictation"), wait('.modal-scrim .missing-note [data-missing-pane]'), check("settings-accessibility-off")], { accessibility: false }),

  scene("local-command-settings-gone", "Safety has no local commands row and no 電腦操作 section: only the vault and the rules are left", [...settings("safety"), scroll(".modal-scrim .modal-body .sgroup:last-of-type"), check("local-command-setting-gone")]),
  scene("theme-clarity", "Computed real-entry surfaces have no fogging veil or tinted conversation gradient", [member(1), check("theme-clarity")]),
  scene("model-sync", "Raphael's model is chosen on its own page; Settings hold only its quick question", [
    click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-src'), click('.cb-menu [data-cb-source="cli:codex"]'), click('.cb-menu [data-model="cli:codex:gpt-6.1"]'), wait('.cb-now:not([hidden]) .cb-pick'), check("model-sync-composer"),
    click('.composer .cmp-model .mp-trigger'), waitGone('.cb-menu'),
    ...settings("models"), check("model-sync-settings"),
  ]),
  scene("model-sync-member", "A model chosen in a member's conversation stays that member's: Raphael, Settings and the others keep theirs", [
  member(1), click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-src'), click('.cb-menu [data-cb-source="cli:codex"]'), click('.cb-menu [data-model="cli:codex:gpt-6.1"]'), wait('.cb-now:not([hidden]) .cb-pick'), check("member-model-own"),
  click('.composer .cmp-model .mp-trigger'), waitGone('.cb-menu'), member(2), check("member-model-others"), member(1), check("member-model-kept"), ...settings("models"), check("member-model-settings")]),
  scene("settings-chatgpt-row", "A model on the ChatGPT plan has its maker's mark and says it is on the plan", [...settings("models"), wait('.modal-scrim [data-row="quick-model"] .mp-trigger'), check("settings-chatgpt-row")], { chatgptSignedIn: true }),
  // The models are held back by the mock until the `codex-arrives` step, so the menu is seen in both states whatever the speed of the run:
  // first "being read" (nothing is known of them yet), then the models in its place, and a menu opened again shows them at once (R-START-05).
  scene("composer-model-arrives", "A CLI's models arrive while its menu is open, with no dead end; once known they are there at once", [click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-src'), click('.cb-menu [data-cb-source="cli:codex"]'), check("composer-model-reading"), codexArrives(), wait('.cb-menu [data-model="cli:codex:gpt-6.1"]'), check("composer-model-arrived"), key("Escape"), waitGone('.cb-menu'), click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-src'), click('.cb-menu [data-cb-source="cli:codex"]'), check("composer-model-arrived")], { codexLate: true }),
  scene("quick-model-menu", "Quick questions shared model picker in existing model settings", [...settings("models"), click('[data-k="quick-model"]'), wait('.model-chooser'), click('[data-source="openrouter"]'), wait('.model-chooser [data-model="openai/gpt-6-luna"]'), check("price-parts")]),
  scene("quick-effort-menu", "Quick questions pick their effort inside the shared model list, as the answer model does, starting quick (low)", [
    ...settings("models"), check("quick-model-row"), click('[data-k="quick-model"]'), wait('.model-chooser'), click('.model-chooser [data-source="cli:codex"]'),
    click('.model-chooser [data-model="cli:codex:gpt-6.1"]'), wait('.model-chooser .mc-effort [data-effort="low"][data-on="true"]'), check("model-effort-order")]),
  scene("quick-model-selection", "Quick questions take a subscription model and its own effort while Raphael's answer model stays", [
    ...settings("models"), click('[data-k="quick-model"]'), wait('.model-chooser'), click('.model-chooser [data-source="cli:codex"]'),
    click('.model-chooser [data-model="cli:codex:gpt-6.1"]'), { action: "slider-stop", selector: ".model-chooser .mc-range", level: "high" }, click('.model-chooser [data-dlg="use"]'),
    wait('[data-k="quick-model"][aria-label*="GPT-6.1"]'), check("quick-model-row"), check("quick-model-selection")]),
  ...["answer", "cleanup", "stt"].map(role => scene(`model-choices-${role}`, `Spaced ${role} choices with separate metadata and actions`, [...modelChooser(role), check("model-choice-layout"), check("price-parts"), ...(role === "answer" ? [check("model-effort-order")] : role === "cleanup" ? [check("cleanup-no-effort")] : [])])),
  // A fresh install with nothing connected, not the owner's own setup: no service is named anywhere (R-DEFAULT-05).
  scene("settings-models-fresh", "Nothing connected: every model row is unset, no provider is named, and speech to text offers this computer's models alone", [...settings("models"), check("settings-models-fresh"), click('.modal-scrim [data-model-picker="stt"] .mp-trigger'), wait(".model-chooser [data-source]"), wait(".model-chooser .lm-main"), check("chooser-no-unconnected")], { noSources: true }),
  // The owner's case: OpenRouter turned off, speech on this computer, an OpenRouter cloud model kept from before.
  scene("chooser-openrouter-off", "A provider turned off is never listed, even when it holds the cloud model kept for later", [...settings("models"), click('.modal-scrim [data-model-picker="stt"] .mp-trigger'), wait(".model-chooser [data-source]"), check("chooser-no-unconnected")], { openrouterOff: true, localSpeech: true }),
  // 連接其他來源 from speech to text: only the services that turn speech into text, and no subscription (R-DEFAULT-05).
  scene("settings-provider-directory-stt", "Connecting another source from speech to text lists only the services that can do it, says why, and keeps its x in view", [...settings("models"), click('.modal-scrim [data-model-picker="stt"] .mp-trigger'), wait('.model-chooser [data-dlg="sources"]'), click('.model-chooser [data-dlg="sources"]'), wait("#pv-dialog .pv-for"), check("provider-directory-stt")]),
  scene("settings-provider-directory", "新增供應商 lists every way to connect, subscriptions first, each kind saying what it means and what it costs", [...settings("models"), click('[data-pv="directory"]'), wait('#pv-dialog'), check("provider-directory")]),
  scene("settings-local-stt", "Speech to text on this PC reads SenseVoice · 本機 with no mark of the cloud model kept for later", [...settings("models"), wait('.modal-scrim [data-model-picker="stt"] .mp-trigger'), check("settings-local-stt")], { localSpeech: true }),
  scene("model-choices-local", "Local speech choices keep subtle borders, spacing and readable metadata", [...localChooser, scroll('.lm-row:last-child'), check("model-choice-scroll"), scroll('.lm-row:first-child'), check("model-choice-layout")]),
  scene("model-choices-local-selected", "Preview a local model without downloading and keep keyboard focus visible", [...localChooser, click('.lm-main[data-name="qwen3-asr"]'), key("Tab"), { action: "focus", selector: '.lm-main[data-name="qwen3-asr"]' }, check("model-choice-selection"), check("model-choice-layout")]),
  scene("model-choices-local-menu", "Deleting a downloaded local model waits in its row's ⋯ and asks in the red dialog", [...localChooser, click('[data-act="local-menu"][data-name="sensevoice"]'), wait('#app-popover [data-pick="delete"]'), check("local-model-menu"), click('#app-popover [data-pick="delete"]'), wait('.mb-delete'), check("local-model-asks")], { localModels: downloaded }),
  scene("context-menu-local-model", "A right click on a downloaded local model's row opens the menu of its ⋯", [...localChooser, rightClick('.lm-row[data-name="sensevoice"]'), wait('#app-popover'), check("context-menu"), rightClick('.lm-row[data-name="sensevoice"]'), wait('#app-popover')], { localModels: downloaded }),
  scene("chatgpt-signed-out", "ChatGPT sign-in is the first subscription account", [...settings("models"), scroll(".cli-accounts"), wait('[data-chatgpt="sign-in"]')]),
  scene("chooser-chatgpt-signed-out", "ChatGPT signed out while it holds the choice is still listed, says what signing in means and has the button for it", [...settings("models"), click('.modal-scrim [data-model-picker="answer"] .mp-trigger'), wait('.model-chooser [data-source="chatgpt"]'), click('.model-chooser [data-source="chatgpt"]'), wait('.mc-signin'), check("chooser-chatgpt")], { quickChatgpt: true }),
  scene("chooser-chatgpt-signed-in", "Signing in again from the chooser brings the plan's models into it", [...settings("models"), click('.modal-scrim [data-model-picker="answer"] .mp-trigger'), wait('.model-chooser [data-source="chatgpt"]'), click('.model-chooser [data-source="chatgpt"]'), wait('.mc-signin'), click('.model-chooser [data-dlg="chatgpt"]'), wait('.model-chooser [data-model="@chatgpt:gpt-6-sol"]'), check("chooser-chatgpt-models")], { quickChatgpt: true }),
  scene("chooser-claude-models", "Claude Code lists every model it runs with its version in the name and the exact model in each row, in the shape of the Codex list", [
    ...modelChooser("answer"), click('.model-chooser [data-source="cli:claude"]'), wait('.model-chooser [data-model="cli:claude:claude-opus-5-5"]'), check("chooser-claude"),
    click('.model-chooser [data-source="cli:codex"]'), wait('.model-chooser [data-model="cli:codex:gpt-6.1"]'), check("chooser-claude-style"),
    // the picture ends on the Claude Code tab
    click('.model-chooser [data-source="cli:claude"]'), wait('.model-chooser [data-model="cli:claude:claude-opus-5-5"]'), check("chooser-claude")]),
  scene("chooser-claude-older", "The end of Claude Code's list, its oldest models with their dated ids, still whole in the row at every width", [
    ...modelChooser("answer"), click('.model-chooser [data-source="cli:claude"]'), wait('.model-chooser [data-model="cli:claude:claude-haiku-4-5-20251001"]'),
    scroll('.model-chooser [data-model="cli:claude:claude-haiku-4-5-20251001"]'), check("chooser-claude")]),
  scene("composer-model-alias", "A member saved with Claude Code's alias reads the model it is on, with its version, and its row is the one checked", [
    member(3), click('.composer .cmp-model .mp-trigger'), wait('.cb-menu .cb-now'), click('.cb-pick'),
    click('.cb-menu [data-cb-source="cli:claude"]'), wait('.cb-menu [data-model="cli:claude:claude-haiku-5-5"]'), check("composer-claude-alias-row"), check("composer-claude-alias")], { claudeAlias: true }),
  scene("chatgpt-signed-in", "A signed-in ChatGPT account shows its email and its unplug", [...settings("models"), scroll(".cli-accounts"), click('[data-chatgpt="sign-in"]'), wait("[data-chatgpt-disconnect]")]),
  scene("cli-account-disconnect-ask", "A connected CLI's card has the unplugged plug, no ⋯: it asks in the red dialog before it disconnects", [...cliAsk, check("cli-account-disconnect-ask")]),
  // Settings has no right click: a CLI's card in 模型 opens its menu only from its ⋯.
  // Settings has no ⋯: a rule's row has its pencil and its trash, and the trash asks in the red dialog (no 復原 toast).
  scene("safety-rules-icons", "Each safety rule has a pencil and a trash on its row, never a ⋯", [...settings("safety"), wait(".rules-row"), scroll(".rules"), check("safety-rules-icons")], { safetyRules: true }),
  scene("safety-rule-delete-dialog", "A rule's trash asks in the red dialog naming the rule; Settings stays open and nothing is deleted yet", [...settings("safety"), wait(".rules-row"), scroll(".rules"), click('.rules-row [data-rule="delete"][data-id="2"]'), wait(".mb-dialog.mb-delete"), check("safety-rule-delete-dialog")], { safetyRules: true }),
  scene("settings-cli-no-right-click", "A right click on a CLI's card in 模型 opens no menu: 中斷連線 is its unplug", [...settings("models"), scroll(".cli-accounts"), rightClick('.cli-card:has([data-cli-disconnect="codex"]) .nm'), check("no-menu-open")]),
  scene("cli-account-disconnected", "Disconnect only in Raphael and offer reconnection", [...cliDisconnected, check("cli-account-disconnected")]),
  scene("cli-account-reconnected", "Reconnect a signed-in CLI without starting login", [...cliDisconnected, click('[data-cli="codex"]'), wait('[data-cli-disconnect="codex"]'), check("cli-account-reconnected")]),
  ...["minimize", "maximize", "close"].map(control => scene(`window-hover-${control}`, `Transparent ${control} caption hover`, [{ action: "window-control", control }])),
  scene("window-hover-restore", "Restore caption keeps its centered glyph and transparent hover", [{ action: "window-control", control: "maximize", restore: true }]),
  scene("window-hover-modal", "Caption hover stays usable while settings dim the window", [...settings("models"), { action: "window-control", control: "close", hoverOnly: true }]),
  scene("connections-recommended", "Under the connected apps, a few popular ones not added yet, each addable in place", [...settings("connections"), check("connections-recommended")]),
  ...["general", "appearance", "connections", "models", "dictation", "tools", "safety", "about"].map(pane => scene(pane === "general" ? "profile" : pane, `${pane} settings pane`, [...settings(pane), ...(pane === "appearance" ? [check("appearance-settings")] : [])])),
  scene("dictation-languages", "The spoken languages: one row per language, one button, and every language with several written forms carries its dropdown on the row, chosen or not", [...settings("dictation"), click('[data-k="languages"]'), wait('.lang-panel [data-language="zh"]'), hover('.lang-panel [data-language="zh"]'), check("language-rows")]),
  scene("dictation-language-variant-hover", "A written form is the settings rows' dropdown: no box or fill at rest or under the pointer, only its words brighten, its row lit behind it", [...settings("dictation"), click('[data-k="languages"]'), wait('.lang-panel [data-variant-menu="zh"]'), hover('.lang-panel [data-variant-menu="zh"]'), check("language-variant-hover")]),
  scene("dictation-language-variant-focus", "Tab from 中文 reaches its written form's dropdown, which draws the app's keyboard ring with no fill", [...settings("dictation"), click('[data-k="languages"]'), wait('.lang-panel [data-variant-menu="zh"]'), key('Tab'), check("language-variant-focus")]),
  scene("dictation-language-variants", "A written form's dropdown opens the forms of its language beside the picker, never under it", [...settings("dictation"), click('[data-k="languages"]'), wait('.lang-panel [data-variant-menu="zh"]'), click('.lang-panel [data-variant-menu="zh"]'), wait('.lang-variant-menu [data-variant="zh-TW"]')]),
  scene("dictation-language-untick", "Pressing the checked 中文 row with its written forms open unticks it and updates the picker and Settings together", [
    ...settings("dictation"), click('[data-k="languages"]'),
    wait('.lang-panel [data-language="zh"][aria-pressed="true"]'), wait('.lang-panel [data-language="en"][aria-pressed="true"]'),
    click('.lang-panel [data-variant-menu="zh"]'), wait('.lang-variant-menu [data-variant="zh-TW"][aria-checked="true"]'),
    click('.lang-panel [data-language="zh"]'), check("language-untick"),
  ]),
  scene("dictation-language-variants-toggle", "Pressing the dropdown again folds the written forms away and leaves the picker open", [...settings("dictation"), click('[data-k="languages"]'), wait('.lang-panel [data-variant-menu="zh"]'), click('.lang-panel [data-variant-menu="zh"]'), wait('.lang-variant-menu [data-variant="zh-TW"]'), click('.lang-panel [data-variant-menu="zh"]'), waitGone('.lang-variant-menu'), check("language-variants-toggle")]),
  scene("appearance-menu", "One shared theme dropdown without a preview gallery", [...settings("appearance"), click('[data-k="appearance"]'), wait('.menu [data-value="dark"]'), check("appearance-settings")]),
  scene("appearance-keyboard", "Theme choices retain visible keyboard focus in every palette", [...settings("appearance"), click('[data-k="appearance"]'), key('Tab'), {...key('Tab'),shift:true}, key('ArrowDown'), check('appearance-settings'), check('appearance-focus')]),
  scene("plugins-installed", "Unified managed, private Google and custom MCP plugins", [...linked, wait('[data-conn="open"][data-id="composio:notion"]')]),
  scene("plugins-detail", "Managed tools grouped by write and read", [...linked, click('[data-conn="open"][data-id="composio:notion"]'), click('[data-conn="tool-list"]'), wait('[data-conn="tool"][data-tool="NOTION_SEARCH"]'), check("plugins-detail")]),
  scene("store-n8n", "n8n is in the store, and 連結 hands it to Raphael in the conversation, where he sets it up", [
    ...store, type('#conn-search', 'n8n'), wait('[data-conn="open-store"][data-id="n8n"]'), check("store-n8n"),
    click('[data-conn="join"][data-id="n8n"]'), wait('.page-agent:not([hidden]) .composer'), check("store-in-chat"),
  ]),
  // R-CONNECT-02: the owner's own Google is reachable where the Google row is; 加入 leaves for the conversation.
  scene("store-google", "The owner's own Google is in the store as one row, like n8n", [
    ...store, type('#conn-search', 'Google'), wait('[data-conn="open-store"][data-id="google"]'), check("store-google"),
  ], { noOwnGoogle: true }),
  scene("store-google-in-chat", "加入 on the owner's own Google leaves for the conversation with the owner's words, where the member shows the card that walks the steps", [
    ...store, type('#conn-search', 'Google'), wait('[data-conn="open-store"][data-id="google"]'),
    click('[data-conn="join"][data-id="google"]'), wait('.page-agent:not([hidden]) .composer .cmp-input'), check("store-google-in-chat"),
  ], { noOwnGoogle: true }),
  scene("plugins-store", "Search-first catalog of the apps not added yet, in bounded pages", [
    ...store, check("plugins-store"), check("plugins-store-rows"), check("plugins-store-groups"),
    type('#conn-search', '360'), wait('[data-conn="open-store"][data-id$="-359"]'), check("plugins-store-search"),
    click('[data-conn="open-store"][data-id$="-359"]'), wait('.cs-page'), check("plugins-store-last-detail"),
    click('[data-conn="back"]'), wait('.cs-chips'), type('#conn-search', ''), wait('.cs-sec'),
  ], { pluginsMany: true }),
  scene("plugins-store-category", "Broad category chips filter the complete local index", [
    ...store, check("plugins-store-groups"), { action: "focus", selector: '[data-conn="store-group"][data-id=""]' },
    key("Tab"), key("Enter"), check("store-group-focus"),
    click('[data-conn="store-group"][data-id="productivity"]'), check("plugins-store-category"), check("plugins-store-rows"),
  ], { pluginsMany: true }),
  scene("plugins-store-search", "Search reaches a late catalog result by keyboard", [
    ...store, { ...type('#conn-search', '360'), measure: { name: "store-search-paint", budgetMs: 250, maxLongTaskMs: 50, readySelector: '[data-conn="open-store"][data-id$="-359"]' } },
    wait('[data-conn="open-store"][data-id$="-359"]'), check("plugins-store-search"), check("plugins-store-rows"),
  ], { pluginsMany: true }),
  scene("plugins-store-all", "A chosen category lists all its apps, a screenful at a time, with the top row and the chips staying put", [
    ...store, { ...click('[data-conn="store-group"][data-id="productivity"]'), measure: { name: "store-all-paint", budgetMs: 250, maxLongTaskMs: 50 } }, check("plugins-store-groups"),
    scroll('.cs-card:last-child'), check("store-toolbar-visible"), scroll('.cs-card:last-child'), check("plugins-store-rows"),
  ], { pluginsMany: true }),
  scene("plugins-store-empty", "An unmatched query keeps search and category navigation", [
    ...store, type('#conn-search', 'no-such-catalog-app-xyz'), wait('.cs-none'), check("plugins-store-empty"),
  ], { pluginsMany: true }),
  { ...scene("plugins-store-motion", "Every row is there and nothing is still moving before the native-style capture, without a blank band", [
    ...store, { action: "settle-motion" }, check("plugins-store-settled"), check("plugins-store-groups"),
  ], { pluginsMany: true }), motion: true },
  scene("plugins-store-key", "Built-in services with optional Composio setup", [...store, wait('[data-conn="configure-composio"]'), check("plugins-store"), check("plugins-store-rows"), check("composio-foot")], { composioConfigured: false }),
  scene("plugins-store-key-openrouter", "An OpenRouter key gets an actionable, value-free Composio error", [
    ...connections, wait('[data-conn="configure-composio"]'), click('[data-conn="configure-composio"]'), wait('#conn-key'),
    type('#conn-key', 'sk-or-look-synthetic'), click('[data-conn="save-key"]'), wait('.cs-key-form [role="alert"]'), check("plugins-key-openrouter"), check("plugins-store-rows"), check("composio-foot"),
  ], { composioConfigured: false }),
  scene("plugins-store-key-consumer", "A consumer key directs the owner to a Composio project key without echoing it", [
    ...connections, wait('[data-conn="configure-composio"]'), click('[data-conn="configure-composio"]'), wait('#conn-key'),
    type('#conn-key', 'ck_look-synthetic'), click('[data-conn="save-key"]'), wait('.cs-key-form [role="alert"]'), check("plugins-key-consumer"), check("plugins-store-rows"), check("composio-foot"),
  ], { composioConfigured: false }),
  scene("plugins-store-needs", "A row stays plain (the mark, the name, 連結) and says nothing of what the app asks for: its page does", [
    ...store, click('[data-conn="store-group"][data-id="productivity"]'), wait('[data-conn="join"][data-id="acme-ledger"]'), check("plugins-store-needs"), check("plugins-store-rows"),
  ]),
  scene("plugins-store-needs-page", "The page of an app that asks for a key asks nothing of the owner: its 連結 is live and its info says how it signs in", [
    ...store, click('[data-conn="open-store"][data-id="acme-ledger"]'), wait('.cs-page [data-conn="join"]'), check("plugins-store-needs-page"),
  ]),
  scene("plugins-setup-key", "連結 on an app that asks for a key hands it to Raphael: his conversation opens and 幫我連接 is sent with the intent connect-app", [
    ...store, click('[data-conn="join"][data-id="acme-ledger"]'), wait('.page-agent:not([hidden]) .composer'), check("store-in-chat"),
  ]),
  scene("plugins-setup-own-app", "An app that needs a developer app of the owner's own is handed to Raphael the same way", [
    ...store, click('[data-conn="join"][data-id="orbit-ads"]'), wait('.page-agent:not([hidden]) .composer'), check("store-in-chat"),
  ]),
  scene("plugins-connecting", "Built-in sign-in works without Composio", [...store, click('[data-conn="join"][data-id="github"]'), wait('.cs-card .sub.wait'), check("plugins-builtin-join"), check("plugins-store-rows"), check("composio-foot")], { composioConfigured: false, pluginsConnecting: true }),
  scene("connections-hover", "MCP server hover", [...linked, hover('[data-k="cs-open:notes"]')]),
  scene("server-menu", "MCP server detail actions", [...serverDetail, click('[data-conn="server-menu"][data-id="notes"]')]),
  scene("connections-add-menu", "Add a connection menu", add),
  scene("connections-command", "Command MCP form keeps its last fields above aligned footer actions", [...custom, check("connections-form-edges"), scroll('#conn-limit'), check("connections-form-end")]),
  scene("connections-test", "MCP test result", [...custom, type("#conn-name", "專案筆記"), type("#conn-command", "npx"), type("#conn-args", "-y\nnotes-server\nC:/Work/Team notes"), click('[data-conn="test-draft"]'), scroll(".add-grid [role=status]")]),
  scene("connections-url", "HTTP MCP form", [...custom, click('[data-k="conn-type"]'), click('.menu [data-value="http"]')]),
  scene("connections-edit", "Edit MCP server", [...serverDetail, click('[data-conn="server-menu"][data-id="notes"]'), click('[data-conn="edit-server"]')]),
  scene("connections-delete", "Custom MCP deletion waits in the overflow menu and asks in the red dialog", [...serverDetail, click('[data-conn="server-menu"][data-id="notes"]'), click('[data-conn="disconnect"]'), wait('.mb-delete'), check("connections-delete-ask")]),
  scene("connections-paste", "Paste MCP JSON", [...add, click('.menu [data-value="paste"]')]),
  scene("connections-paste-preview", "Preview MCP JSON", [...add, click('.menu [data-value="paste"]'), type("[data-mcp-json]", '{"mcpServers":{"專案筆記":{"command":"npx","args":["notes-server"]}}}'), click('[data-dlg="preview"]')]),
  scene("connections-discover", "Discover local MCP definitions", [...add, click('.menu [data-value="import"]')]),
  scene("connections-empty", "Connections without servers: the one view, with no chip of the connected apps", [...connections, check("connections-empty")], { servers: [], managedConnectors: [] }),
  scene("connections-discover-empty", "Discovery without candidates", [...add, click('.menu [data-value="import"]')], { servers: [], candidates: [] }),
  scene("usage", "Usage: this month's spending with a coloured bar and what each subscription has left; no OpenRouter key section", [...usage, wait(".run-subscription"), check("usage-plain")]),
  scene("usage-allowances-chatgpt", "ChatGPT sits with the other subscriptions, with the button to its own usage page", [...usage, wait('[data-allowance="chatgpt"]'), scroll('[data-allowance="chatgpt"]'), check("usage-plain")], { chatgptSignedIn: true }),
  scene("usage-owner", "The owner's own mix: Codex live, Claude whose window has reset (已重置, no stale number or bar), the ChatGPT sign-in and OpenRouter's own spend, one card each as the account menu's blocks", [...usage, wait('[data-allowance="openrouter"]'), check("usage-plain"), check("usage-owner-cards")], { usageOwner: true }),
  scene("usage-empty", "With no subscription signed in, the rows of what was spent stand alone", [...usage, check("usage-plain")], { usageEmpty: true }),
  scene("settings-usage-overview", "Usage › 概覽: 這個月's card with the limit and its gear, then 方案額度, one card per subscription with each window's reset and what is left", [...usage, wait(".run-subscription"), check("usage-plain"), check("usage-overview")]),
  scene("settings-usage-cap", "The gear of 這個月 opens the monthly limit: 設上限 with an amount, stored at once, the card's bar follows; 不設上限 takes it away", [
    ...usage, click('[data-act="usage-cap"]'), wait("#app-popover.usage-cap"), check("usage-cap-open"),
    click('#app-popover [data-cap-mode="none"]'), wait('#app-popover [data-cap-mode="none"][aria-pressed="true"]'), check("usage-cap-none"),
    click('#app-popover [data-cap-mode="set"]'), wait("#app-popover #limit-input"),
    type("#app-popover #limit-input", "30"), key("Enter"), check("usage-cap-set"),
  ]),
  scene("settings-usage-analytics", "Usage › 分析: 花費紀錄 by purpose with its stacked bars and legend, 誰花最多 with five rows and 顯示更多, 工具使用 and 訊息 lines, and 30 days", [
    ...analysis, check("usage-analytics"), scroll('[data-ua-section="people"]'), click("[data-ua-more]"), wait('.ua-table tbody tr:nth-child(6)'), scroll('[data-ua-section="messages"]'),
    click('[data-ua-messages="source"]'), wait('[data-ua-messages="source"][aria-pressed="true"]'), scroll('[data-ua-section="cost"]'), click('[data-ua-range="30d"]'), wait('.ua-bars[data-n="30"]'), check("usage-analytics-month"),
    // The picture ends on 工具使用 and 訊息, under the chart and the people the checks read.
    scroll('[data-ua-section="messages"]'),
  ]),
  // The top of 分析 as it opens: 花費紀錄's bars, legend and 誰花最多, the picture the scene above scrolls past.
  scene("settings-usage-analytics-top", "Usage › 分析 as it opens: 花費紀錄 with its 7 天 bars, legend and the start of 誰花最多", [...analysis, check("usage-analytics")]),
  // Every chart answers the pointer (R-USE-03): the day under it says its date and each line's value in the app's own tip.
  scene("settings-usage-bar-hover", "Usage › 分析: a bar of 花費紀錄 under the pointer lights, the others step back, and its tip says the day, its total and what each colour cost", [...analysis, hover('[data-ua-card="cost"] .ua-bars'), check("usage-reading-bar")]),
  scene("settings-usage-line-hover", "Usage › 分析: a day of 工具使用 under the pointer shows a guide, a dot on each line and a tip with each line's count", [...analysis, scroll('[data-ua-section="tools"]'), hover('[data-ua-card="tools"] .ua-linebox'), check("usage-reading-line")]),
  scene("settings-usage-people-less", "Usage › 分析: 顯示更多 shows everyone, then the same button says 顯示較少 and folds 誰花最多 back to five, keeping the focus", [
    ...analysis, scroll('[data-ua-section="people"]'), click("[data-ua-more]"), wait('.ua-table tbody tr:nth-child(6)'), check("usage-people-all"),
    click("[data-ua-more]"), waitGone('.ua-table tbody tr:nth-child(6)'), check("usage-people-less"),
  ]),
  scene("settings-usage-analytics-empty", "Usage › 分析 with nothing in the period: one quiet line a section, no chart frames", [...usage, click('[data-usage-tab="analysis"]'), wait('[data-ua-section="messages"]'), check("usage-analytics-empty")], { usageEmpty: true }),
  scene("usage-opens-quietly", "The app reads the allowances once after it starts, and Settings again each time it opens, on any tab: no refresh button, the numbers already there, the same numbers touch nothing, a new number replaces the old in place", [
    check("usage-open-launch"), ...settings("general"), check("usage-open-general"),
    click('.modal-scrim [data-pane="usage"]'), wait(".run-subscription"), check("usage-plain"), check("usage-open-arm"),
    click(".modal-x"), { action: "advance-time", ms: 31000 }, ...settings("usage"), wait(".run-subscription"), check("usage-open-same"),
    check("usage-open-lower"), click(".modal-x"), { action: "advance-time", ms: 31000 }, ...settings("usage"), wait(".run-subscription"), check("usage-open-changed"), check("usage-plain"),
  ], { traceCalls: true }),
  ...["overview", "history", "dictionary"].map(tab => scene(`dictation-${tab}`, `Dictation ${tab}`, [...dictation(tab), ...(tab === "history" ? [wait(".hrow"), check("history-sent-to")] : []), ...(tab === "dictionary" ? [wait(".wrow"), click('[data-act="word-menu"]'), wait('#app-popover [data-pick="delete"]'), key("Escape")] : [])], tab === "dictionary" ? {
    dictionary: ["Raphael", "Methelia", "GitHub", "Composio", "OpenRouter", "Notion", "Slack", "Telegram", "Calendar", "Claude", "Codex", "Gemini"].map((word, index) => ({ id: index + 1, word, misheard: index === 0 ? ["Rafael"] : [], source: index % 2 ? "learned" : "manual", created_at_ms: 1792720800000 })),
  } : {})),
  scene("dictation-keyboard", "Horizontal dictation navigation with keyboard focus", [...dictation("overview"), key("ArrowRight"), wait('[data-dictation-tab="history"][aria-selected="true"]'), key("ArrowLeft"), wait('[data-dictation-tab="overview"][aria-selected="true"]'), key("End"), key("Home"), wait('[data-dictation-tab="overview"][aria-selected="true"]'), key("End"), wait('[data-dictation-tab="dictionary"][aria-selected="true"]'), check("dictation-navigation")]),
  scene("dictation-heat-hover", "A heatmap day under the pointer shows its words above it, outlined; nothing waits for a press", [...dictation("overview"), hover('.heat [data-date="2026-10-24"]'), check("dictation-heat-hover"), check("dictation-right-edge")]),
  // The first days of a month put its name in the heatmap's last column, and the newest day is at the grid's right end.
  scene("dictation-heat-edge", "In a month's first days its name ends at the heatmap's right edge, and the newest day's words stay inside the window", [...dictation("overview"), hover('.heat [data-date="2026-11-02"]'), check("dictation-heat-hover"), check("dictation-right-edge")], { statsUntil: "2026-11-02" }),
  scene("dictation-notice", "Dictation connection notice", dictation("overview"), { problem: true }),
  scene("conversation-notice", "Conversation connection notice", [], { problem: true }),
  scene("onboarding", "First-run welcome: Raphael's emblem, its name, one promise, the language dropdown and one wide black pill", [wait('#ob:not([hidden]) [data-ob="next"]'), wait('.ob-emblem canvas.ob-emb'), check("guide-window-fixed"), check("onboarding-welcome")], { onboarding: true }),
  scene("onboarding-slime", "First-run step 1: the first slime large, its name the one thing asked (the way on waits for it), the members' slime picker under it; a press dresses it at once", [click('[data-ob="next"]'), wait('#ob-first-name'), wait('.ob-first-picker [data-slime-character="blue-plain"][aria-pressed="true"]'), check("onboarding-slime-waits"), type('#ob-first-name', '小藍'), ...pickFirstSlime, wait('.ob-foot [data-ob="next"]:not([disabled])'), check("onboarding-slime")], { onboarding: true }),
  scene("onboarding-tools", "First-run step 2: the AI tools as a store of one-row tiles, a search box, 熱門 the same for everyone, then each kind by name",[...named, wait('[data-ob-tools] [data-item="claude"].on .ob-tick'), check("onboarding-tools")], { onboarding: true }),
  scene("onboarding-back-hover", "First-run step 2: the round way back of the foot's pair takes a lighter surface under the pointer", [...named, wait('.ob-foot [data-ob="back"]'), hover('.ob-foot [data-ob="back"]'), check("onboarding-back-hover")], { onboarding: true }),
  scene("onboarding-back-focus", "First-run step 2: Shift+Tab from the primary lands on the round way back, with the app's focus ring", [...named, wait('.ob-foot [data-ob="back"]'), { action: "focus", selector: '.ob-foot [data-ob="next"]' }, { ...key("Tab"), shift: true }, check("onboarding-back-focus")], { onboarding: true }),
  scene("onboarding-services", "First-run step 3: a search box and the popular services of the store as tiles, one sign-in each", [...named, click('[data-ob="next"]'), wait('[data-ob-services] .ob-tile'), click('[data-item="gmail"][data-ob="conn-login"]'), wait('[data-item="gmail"].on .ob-tick'), check("onboarding-services")], { onboarding: true }),
  scene("onboarding-services-composio", "First-run step 3 without Composio: its card first, then the apps that need none", [...named, click('[data-ob="next"]'), wait('.ob-composio [data-ob="composio-open"]'), check("onboarding-services"), check("onboarding-composio")], { onboarding: true, composioConfigured: false }),
  scene("onboarding-composio-key", "Composio's key is typed in its card; a consumer key is refused beside its field", [...named, click('[data-ob="next"]'), wait('.ob-composio [data-ob="composio-open"]'), click('[data-ob="composio-open"]'), wait('#ob-composio-input'), type('#ob-composio-input', 'ck_look-0123'), click('[data-ob="composio-paste"]'), wait('.ob-composio [role="alert"]'), check("onboarding-services"), check("onboarding-composio")], { onboarding: true, composioConfigured: false }),
  scene("onboarding-composio-saved", "A saved Composio key adds its apps to the step and the card goes", [...named, click('[data-ob="next"]'), wait('.ob-composio [data-ob="composio-open"]'), click('[data-ob="composio-open"]'), wait('#ob-composio-input'), type('#ob-composio-input', 'ak_look-0123'), click('[data-ob="composio-paste"]'), waitGone('.ob-composio'), wait('[data-ob-services] .ob-tile'), check("onboarding-services")], { onboarding: true, composioConfigured: false }),
  scene("onboarding-services-n8n", "A search finds n8n; its address and key are typed across its tile", [...named, click('[data-ob="next"]'), wait('[data-ob-services] .ob-tile'), type('#ob-find', 'n8n'), wait('[data-item="n8n"] [data-ob="server-open"]'), click('[data-item="n8n"] [data-ob="server-open"]'), wait('#ob-server-url'), type('#ob-server-url', 'https://flows.example.test/mcp-server/http'), check("onboarding-services")], { onboarding: true }),
  scene("onboarding-service-waiting", "A tile waiting for its sign-in keeps its words inside it in every language", [...named, click('[data-ob="next"]'), wait('[data-ob-services] .ob-tile'), click('[data-item="linear"][data-ob="conn-login"]'), wait('[data-item="linear"] [data-ob="conn-cancel"]'), check("onboarding-services")], { onboarding: true, pluginsConnecting: true }),
  scene("onboarding-abilities", "First-run step 4: the abilities as Settings › 工具's rows, each saying what it uses, with its switch", [...named, click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-svc="toggle"][data-id="read"]'), wait('[data-svc="toggle"][data-id="read"][aria-checked="false"]'), check("onboarding-abilities")], { onboarding: true }),
  scene("onboarding-abilities-choice", "First-run step 4: an ability opens its choice of service in the card, as in Settings", [...named, click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-svc="open"][data-id="search"]'), wait('.ob-card #svc-dialog .svc-srv')], { onboarding: true }),
  scene("onboarding-slime-crown", "First-run step 1: the first slime in a brown headband slime wears one crown on its head, large", [click('[data-ob="next"]'), wait('#ob-first-name'), type('#ob-first-name', '小藍'), click('.ob-first-picker [data-slime-tab="brown"]'), click('.ob-first-picker [data-slime-character="headband-brown"]'), wait('.ob-first-face .slime-surface[style*="#8E7254"]'), check('chief-crown')], { onboarding: true }),
  scene("after-onboarding", "Finishing the guide opens the conversation of the slime the owner named, the app's start", [...named, click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-ob="next"]'), wait(".page-agent:not([hidden]) .conversation-trigger"), wait('.mb-col .mb-chief[aria-current="true"]'), check("sidebar-shell"), check("first-slime-named"), check("page-unshifted")], { onboarding: true }),
];
