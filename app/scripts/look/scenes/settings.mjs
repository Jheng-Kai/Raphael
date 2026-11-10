import { scene, click, hover, type, wait, waitGone, page, settings, scroll, key, check, member, rightClick } from "./steps.mjs";

const connections = settings("connections");
const add = [...connections, click('[data-k="conn-add"]')];
const custom = [...add, click('.menu [data-value="custom"]')];
const serverDetail = [...connections, click('[data-conn="open"][data-id="notes"]')];
const store = [...connections, { ...click('[data-conn="tab"][data-id="store"]'), measure: { name: "store-render-paint", budgetMs: 250, maxLongTaskMs: 50 } }, wait('.cs-card'), waitGone('[data-cs-pending]')];
// A key made up for the scenes: it is typed into a masked field and must reach nothing but the one call that adds the app.
const setupKey = "zk-look-0123456789";
const usage = [...settings("models"), click('[data-models-tab="usage"]'), wait('[data-row="raphael-spend"]')];
const cliMenu = [...settings("models"), scroll(".cli-accounts"), click('[data-cli-menu="codex"]')];
const cliDisconnected = [...cliMenu, click('#app-popover [data-pick="disconnect"]'), wait('[data-cli="codex"]')];
const modelChooser = role => [...settings("models"), click(`.modal-scrim [data-model-picker="${role}"] .mp-trigger`), wait(".model-chooser .mc-row")];
const localChooser = [...modelChooser("stt"), click('[data-source="local-speech"]'), wait(".lm-main")];
const downloaded = [
  { name: "qwen3-asr", title: "Qwen3-ASR", languages: ["zh", "en", "ja", "ko", "yue"], note: "dictionary", size: 878702423, ready: false },
  { name: "sensevoice", title: "SenseVoice", languages: ["zh", "en", "ja", "ko", "yue"], note: "fast", size: 163002883, ready: true },
];
const dictation = tab => [page("dictation"), click(`[data-dictation-tab="${tab}"]`), check("dictation-navigation"), ...(tab === "overview" ? [wait('.page-overview .icard'), check("dictation-overview")] : [])];
export default [


  scene("settings-owner", "Owner identity leads General, with no weather city to set", [...settings("general"), wait('[data-owner="owner_name"]'), check('settings-owner')]),

  scene("local-command-settings", "One shared local command dropdown beside computer use", [...settings("safety"), scroll('[data-k="local-commands"]'), check("local-command-setting"), click('[data-k="local-commands"]'), wait('.menu [data-value="never"]'), check("local-command-menu")]),
  ...["always", "never"].map(mode => scene(`local-command-setting-${mode}`, `Save the shared ${mode} command permission`, [...settings("safety"), scroll('[data-k="local-commands"]'), click('[data-k="local-commands"]'), click(`.menu [data-value="${mode}"]`), check("local-command-setting-saved") ])),
  scene("theme-clarity", "Computed real-entry surfaces have no fogging veil or tinted conversation gradient", [member(1), check("theme-clarity")]),
  scene("model-sync", "Raphael's model is chosen on his own page; Settings hold only his quick question", [
    click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-pick'), click('.cb-menu [data-cb-source="cli:codex"]'), click('.cb-menu [data-model="cli:codex:gpt-6.1"]'), wait('.cb-now:not([hidden]) .cb-pick'), check("model-sync-composer"),
    click('.composer .cmp-model .mp-trigger'), waitGone('.cb-menu'),
    ...settings("models"), check("model-sync-settings"),
  ]),
  scene("model-sync-member", "A model chosen in a member's conversation stays that member's: Raphael, Settings and the others keep theirs", [
  member(1), click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-pick'), click('.cb-menu [data-cb-source="cli:codex"]'), click('.cb-menu [data-model="cli:codex:gpt-6.1"]'), wait('.cb-now:not([hidden]) .cb-pick'), check("member-model-own"),
  click('.composer .cmp-model .mp-trigger'), waitGone('.cb-menu'), member(2), check("member-model-others"), member(1), check("member-model-kept"), ...settings("models"), check("member-model-settings")]),
  scene("settings-chatgpt-row", "A model on the ChatGPT plan has its maker's mark and says it is on the plan", [...settings("models"), wait('.modal-scrim [data-row="quick-model"] .mp-trigger'), check("settings-chatgpt-row")], { chatgptSignedIn: true }),
  scene("composer-model-arrives", "A CLI's models arrive while its menu is open, with no dead end", [click('.composer .cmp-model .mp-trigger'), wait('.cb-menu'), click('.cb-pick'), click('.cb-menu [data-cb-source="cli:codex"]'), check("composer-model-reading"), wait('.cb-menu [data-model="cli:codex:gpt-6.1"]'), check("composer-model-arrived")], { codexLate: 1500 }),
  scene("quick-model-menu", "Quick questions shared model picker in existing model settings", [...settings("models"), click('[data-k="quick-model"]'), wait('.model-chooser'), click('[data-source="openrouter"]'), wait('.model-chooser [data-model="openai/gpt-6-luna"]')]),
  scene("quick-effort-menu", "Quick questions pick their effort inside the shared model list, as the answer model does, starting quick (low)", [
    ...settings("models"), check("quick-model-row"), click('[data-k="quick-model"]'), wait('.model-chooser'), click('.model-chooser [data-source="cli:codex"]'),
    click('.model-chooser [data-model="cli:codex:gpt-6.1"]'), wait('.model-chooser .mc-effort [data-effort="low"][data-on="true"]'), check("model-effort-order")]),
  scene("quick-model-selection", "Quick questions take a subscription model and its own effort while Raphael's answer model stays", [
    ...settings("models"), click('[data-k="quick-model"]'), wait('.model-chooser'), click('.model-chooser [data-source="cli:codex"]'),
    click('.model-chooser [data-model="cli:codex:gpt-6.1"]'), { action: "slider-stop", selector: ".model-chooser .mc-range", level: "high" }, click('.model-chooser [data-dlg="use"]'),
    wait('[data-k="quick-model"][aria-label*="GPT-6.1"]'), check("quick-model-row"), check("quick-model-selection")]),
  ...["answer", "cleanup", "stt"].map(role => scene(`model-choices-${role}`, `Spaced ${role} choices with separate metadata and actions`, [...modelChooser(role), check("model-choice-layout"), ...(role === "answer" ? [check("model-effort-order")] : role === "cleanup" ? [check("cleanup-no-effort")] : [])])),
  scene("model-choices-local", "Local speech choices keep subtle borders, spacing and readable metadata", [...localChooser, scroll('.lm-row:last-child'), check("model-choice-scroll"), scroll('.lm-row:first-child'), check("model-choice-layout")]),
  scene("model-choices-local-selected", "Preview a local model without downloading and keep keyboard focus visible", [...localChooser, click('.lm-main[data-name="qwen3-asr"]'), key("Tab"), { action: "focus", selector: '.lm-main[data-name="qwen3-asr"]' }, check("model-choice-selection"), check("model-choice-layout")]),
  scene("model-choices-local-menu", "Deleting a downloaded local model waits in its row's ⋯ and still asks in the row", [...localChooser, click('[data-act="local-menu"][data-name="sensevoice"]'), wait('#app-popover [data-pick="delete"]'), check("local-model-menu"), click('#app-popover [data-pick="delete"]'), wait('.lm-confirm'), check("local-model-asks")], { localModels: downloaded }),
  scene("context-menu-local-model", "A right click on a downloaded local model's row opens the menu of its ⋯", [...localChooser, rightClick('.lm-row[data-name="sensevoice"]'), wait('#app-popover'), check("context-menu"), rightClick('.lm-row[data-name="sensevoice"]'), wait('#app-popover')], { localModels: downloaded }),
  scene("chatgpt-signed-out", "ChatGPT sign-in is the first subscription account", [...settings("models"), scroll(".cli-accounts"), wait('[data-chatgpt="sign-in"]')]),
  scene("chooser-chatgpt-signed-out", "Choosing a model, ChatGPT is a subscription that says what signing in means and has the button for it", [...modelChooser("answer"), click('.model-chooser [data-source="chatgpt"]'), wait('.mc-signin'), check("chooser-chatgpt")]),
  scene("chooser-chatgpt-signed-in", "Signing in from the chooser brings the plan's models into it", [...modelChooser("answer"), click('.model-chooser [data-source="chatgpt"]'), wait('.mc-signin'), click('.model-chooser [data-dlg="chatgpt"]'), wait('.model-chooser [data-model="@chatgpt:gpt-6-sol"]'), check("chooser-chatgpt-models")]),
  scene("chatgpt-signed-in", "A signed-in ChatGPT account shows its email and a menu", [...settings("models"), scroll(".cli-accounts"), click('[data-chatgpt="sign-in"]'), wait("[data-chatgpt-menu]")]),
  scene("cli-account-menu", "Connected CLI account row actions", [...cliMenu, check("cli-account-menu")]),
  scene("cli-account-disconnected", "Disconnect only in Raphael and offer reconnection", [...cliDisconnected, check("cli-account-disconnected")]),
  scene("cli-account-reconnected", "Reconnect a signed-in CLI without starting login", [...cliDisconnected, click('[data-cli="codex"]'), wait('[data-cli-menu="codex"]'), check("cli-account-reconnected")]),
  ...["minimize", "maximize", "close"].map(control => scene(`window-hover-${control}`, `Transparent ${control} caption hover`, [{ action: "window-control", control }])),
  scene("window-hover-restore", "Restore caption keeps its centered glyph and transparent hover", [{ action: "window-control", control: "maximize", restore: true }]),
  scene("window-hover-modal", "Caption hover stays usable while settings dim the window", [...settings("models"), { action: "window-control", control: "close", hoverOnly: true }]),
  scene("connections-recommended", "Under the connected apps, a few popular ones not added yet, each addable in place", [...settings("connections"), check("connections-recommended")]),
  ...["general", "appearance", "connections", "models", "dictation", "tools", "safety", "messaging", "about"].map(pane => scene(pane === "general" ? "profile" : pane, `${pane} settings pane`, [...settings(pane), ...(pane === "appearance" ? [check("appearance-settings")] : [])])),
  scene("appearance-menu", "One shared theme dropdown without a preview gallery", [...settings("appearance"), click('[data-k="appearance"]'), wait('.menu [data-value="dark"]'), check("appearance-settings")]),
  scene("appearance-keyboard", "Theme choices retain visible keyboard focus in every palette", [...settings("appearance"), click('[data-k="appearance"]'), key('Tab'), {...key('Tab'),shift:true}, key('ArrowDown'), check('appearance-settings'), check('appearance-focus')]),
  scene("plugins-installed", "Unified managed, private Google and custom MCP plugins", [...connections, wait('[data-conn="open"][data-id="composio:notion"]')]),
  scene("plugins-detail", "Managed tools grouped by write and read", [...connections, click('[data-conn="open"][data-id="composio:notion"]'), click('[data-conn="tool-list"]'), wait('[data-conn="tool"][data-tool="NOTION_SEARCH"]')]),
  scene("store-n8n", "n8n is in the store, and 加入 leaves for the conversation with the owner's words, where the member sets it up (owner, 2026-11-09)", [
    ...store, type('#conn-search', 'n8n'), wait('[data-conn="open-store"][data-id="n8n"]'), check("store-n8n"),
    click('[data-conn="join"][data-id="n8n"]'), wait('.page-agent:not([hidden]) .composer textarea'), check("store-in-chat"),
  ]),
  scene("plugins-store", "Search-first catalog of the apps not added yet, in bounded pages", [
    ...store, check("plugins-store"), check("plugins-store-rows"), check("plugins-store-groups"),
    type('#conn-search', '360'), wait('[data-conn="open-store"][data-id$="-359"]'), check("plugins-store-search"),
    click('[data-conn="open-store"][data-id$="-359"]'), wait('.cs-page'), check("plugins-store-last-detail"),
    click('[data-conn="back"]'), wait('.cs-store-groups'), type('#conn-search', ''), wait('[data-conn="store-page"]'),
  ], { pluginsMany: true }),
  scene("plugins-store-category", "Broad category chips filter the complete local index", [
    ...store, check("plugins-store-groups"), { action: "focus", selector: '[data-conn="store-group"][data-id=""]' },
    ...Array.from({ length: 9 }, () => key("Tab")), key("Enter"), check("store-group-end"),
    click('[data-conn="store-group"][data-id="productivity"]'), check("plugins-store-category"), check("plugins-store-rows"),
  ], { pluginsMany: true }),
  scene("plugins-store-wheel", "The mouse wheel and the arrows move the category chips sideways", [
    ...store, check("plugins-store-groups"), { action: "wheel", selector: ".cs-store-groups", deltaY: 300 }, check("store-groups-wheel"), check("plugins-store-groups"),
    click('[data-chip-step="-1"]'), wait('[data-chip-row]:not([data-more-before])'), check("store-groups-start"), check("plugins-store-groups"),
  ], { pluginsMany: true }),
  scene("plugins-store-search", "Search reaches a late catalog result by keyboard", [
    ...store, { ...type('#conn-search', '360'), measure: { name: "store-search-paint", budgetMs: 250, maxLongTaskMs: 50, readySelector: '[data-conn="open-store"][data-id$="-359"]' } },
    wait('[data-conn="open-store"][data-id$="-359"]'), check("plugins-store-search"), check("plugins-store-rows"),
  ], { pluginsMany: true }),
  scene("plugins-store-all", "All apps use bounded pages without omitting late entries", [
    ...store, { ...click('[data-conn="store-group"][data-id=""]'), measure: { name: "store-all-paint", budgetMs: 250, maxLongTaskMs: 50 } }, check("plugins-store-groups"),
    scroll('.cs-store-pages'), check("store-toolbar-visible"),
    click('[data-conn="store-page"][data-id="1"]'), check("plugins-store-groups"), check("plugins-store-rows"),
    scroll('.cs-store-pages'), check("store-toolbar-visible"),
  ], { pluginsMany: true }),
  scene("plugins-store-empty", "An unmatched query keeps search and category navigation", [
    ...store, type('#conn-search', 'no-such-catalog-app-xyz'), wait('.cs-none'), check("plugins-store-empty"),
  ], { pluginsMany: true }),
  { ...scene("plugins-store-motion", "All popular rows finish entering before the native-style capture, without a blank band", [
    ...store, { action: "settle-motion" }, check("plugins-store-settled"), check("plugins-store-groups"),
  ], { pluginsMany: true }), motion: true },
  scene("plugins-store-key", "Built-in services with optional Composio setup", [...store, wait('[data-conn="configure-composio"]'), check("plugins-store"), check("plugins-store-rows"), scroll('.cs-composio-setup')], { composioConfigured: false }),
  scene("plugins-store-key-openrouter", "An OpenRouter key gets an actionable, value-free Composio error", [
    ...connections, click('[data-conn="tab"][data-id="store"]'), wait('[data-conn="configure-composio"]'), click('[data-conn="configure-composio"]'), wait('#conn-key'),
    type('#conn-key', 'sk-or-look-synthetic'), click('[data-conn="save-key"]'), wait('.cs-key-form [role="alert"]'), check("plugins-key-openrouter"), check("plugins-store-rows"),
  ], { composioConfigured: false }),
  scene("plugins-store-key-consumer", "A consumer key directs the owner to a Composio project key without echoing it", [
    ...connections, click('[data-conn="tab"][data-id="store"]'), wait('[data-conn="configure-composio"]'), click('[data-conn="configure-composio"]'), wait('#conn-key'),
    type('#conn-key', 'ck_look-synthetic'), click('[data-conn="save-key"]'), wait('.cs-key-form [role="alert"]'), check("plugins-key-consumer"), check("plugins-store-rows"),
  ], { composioConfigured: false }),
  scene("plugins-store-needs", "A row says in words what the app asks for before anything is pressed: its own key, or its own developer app", [
    ...store, click('[data-conn="store-group"][data-id="productivity"]'), wait('[data-conn="join"][data-id="acme-ledger"]'), check("plugins-store-needs"), check("plugins-store-rows"),
  ]),
  scene("plugins-store-needs-page", "The page of an app that asks for a key says so beside its 加入, which is never dead", [
    ...store, click('[data-conn="open-store"][data-id="acme-ledger"]'), wait('.cs-page .cs-needs'), check("plugins-store-needs-page"),
  ]),
  scene("plugins-setup-key", "加入 on an app that needs a key asks for exactly that key in a masked field, says where to get it and that Composio keeps it", [
    ...store, click('[data-conn="join"][data-id="acme-ledger"]'), wait('.cn-setup-dialog [data-setup-field]'), type('.cn-setup-dialog [data-setup-field]', setupKey), check("setup-key"),
  ]),
  scene("plugins-setup-noguide", "When the catalog has no guide the form says so and offers the service's own page", [
    ...store, click('[data-conn="join"][data-id="parcel-desk"]'), wait('.cn-setup-dialog [data-setup-field]'), check("setup-noguide"),
  ]),
  scene("plugins-setup-own-app", "An app that needs a developer app of the owner's own is set up in the conversation: 加入 leaves with the owner's words", [
    ...store, click('[data-conn="join"][data-id="orbit-ads"]'), wait('.page-agent:not([hidden]) .composer textarea'), check("store-in-chat"),
  ]),
  scene("plugins-setup-added", "The key goes to the core in one call; the dialog closes and the app is among the connected ones", [
    ...store, click('[data-conn="join"][data-id="acme-ledger"]'), wait('.cn-setup-dialog [data-setup-field]'), type('.cn-setup-dialog [data-setup-field]', setupKey),
    click('.cn-setup-dialog [data-dlg="add"]'), waitGone('.cn-setup-dialog'), wait('[data-conn="open"][data-id="composio:acme-ledger"]'), check("setup-added"),
  ]),
  scene("plugins-setup-rejected", "A key Composio does not accept says so in the dialog, empties the masked field and keeps the form to try again", [
    ...store, click('[data-conn="join"][data-id="acme-ledger"]'), wait('.cn-setup-dialog [data-setup-field]'), type('.cn-setup-dialog [data-setup-field]', setupKey),
    click('.cn-setup-dialog [data-dlg="add"]'), wait('.cn-setup-dialog [data-setup-status] [role="alert"]'), check("setup-rejected"),
  ], { connectFails: "key_rejected" }),
  scene("plugins-setup-composio-key", "With no working Composio key the form says that and offers the place to add it", [
    ...store, click('[data-conn="join"][data-id="acme-ledger"]'), wait('.cn-setup-dialog [data-setup-field]'), type('.cn-setup-dialog [data-setup-field]', setupKey),
    click('.cn-setup-dialog [data-dlg="add"]'), wait('.cn-setup-dialog [data-dlg="composio"]'), check("setup-composio-key"),
  ], { connectFails: "missing_key" }),
  scene("plugins-setup-plan-failed", "When what the app needs cannot be read the dialog says so and offers to try again", [
    ...store, click('[data-conn="join"][data-id="acme-ledger"]'), wait('.cn-setup-dialog [data-dlg="retry"]'), check("setup-plan-failed"),
  ], { toolkitPlanFails: true }),
  scene("plugins-connecting", "Built-in sign-in works without Composio", [...store, click('[data-conn="join"][data-id="github"]'), wait('.cs-card .sub.wait'), check("plugins-builtin-join"), check("plugins-store-rows")], { composioConfigured: false, pluginsConnecting: true }),
  scene("connections-hover", "MCP server hover", [...connections, hover('[data-k="cs-open:notes"]')]),
  scene("server-menu", "MCP server detail actions", [...serverDetail, click('[data-conn="server-menu"][data-id="notes"]')]),
  scene("connections-add-menu", "Add a connection menu", add),
  scene("connections-command", "Command MCP form keeps its last fields above aligned footer actions", [...custom, check("connections-form-edges"), scroll('#conn-limit'), check("connections-form-end")]),
  scene("connections-test", "MCP test result", [...custom, type("#conn-name", "專案筆記"), type("#conn-command", "npx"), type("#conn-args", "-y\nnotes-server\nC:/Work/Team notes"), click('[data-conn="test-draft"]'), scroll(".add-grid [role=status]")]),
  scene("connections-url", "HTTP MCP form", [...custom, click('[data-k="conn-type"]'), click('.menu [data-value="http"]')]),
  scene("connections-edit", "Edit MCP server", [...serverDetail, click('[data-conn="server-menu"][data-id="notes"]'), click('[data-conn="edit-server"]')]),
  scene("connections-delete", "Custom MCP deletion confirmation in overflow", [...serverDetail, click('[data-conn="server-menu"][data-id="notes"]'), click('[data-conn="disconnect"]')]),
  scene("connections-paste", "Paste MCP JSON", [...add, click('.menu [data-value="paste"]')]),
  scene("connections-paste-preview", "Preview MCP JSON", [...add, click('.menu [data-value="paste"]'), type("[data-mcp-json]", '{"mcpServers":{"專案筆記":{"command":"npx","args":["notes-server"]}}}'), click('[data-dlg="preview"]')]),
  scene("connections-discover", "Discover local MCP definitions", [...add, click('.menu [data-value="import"]')]),
  scene("connections-empty", "Connections without servers", [...connections, click('[data-conn="tab"][data-id="installed"]')], { servers: [], managedConnectors: [] }),
  scene("connections-discover-empty", "Discovery without candidates", [...add, click('.menu [data-value="import"]')], { servers: [], candidates: [] }),
  scene("usage", "Usage: this month's spending with a coloured bar, what each subscription has left, then the key", [...usage, wait(".run-subscription"), check("usage-plain")]),
  scene("usage-allowances-chatgpt", "ChatGPT sits with the other subscriptions, with the button to its own usage page", [...usage, wait('[data-allowance="chatgpt"]'), scroll('[data-allowance="chatgpt"]'), check("usage-plain")], { chatgptSignedIn: true }),
  scene("usage-empty", "With no subscription signed in, the rows of what was spent stand alone", [...usage, check("usage-plain")], { usageEmpty: true }),
  ...["overview", "history", "dictionary"].map(tab => scene(`dictation-${tab}`, `Dictation ${tab}`, [...dictation(tab), ...(tab === "history" ? [wait(".hrow"), check("history-sent-to")] : []), ...(tab === "dictionary" ? [wait(".wrow"), click('[data-act="word-menu"]'), wait('#app-popover [data-pick="delete"]'), key("Escape")] : [])], tab === "dictionary" ? {
    dictionary: ["Raphael", "Methelia", "GitHub", "Composio", "OpenRouter", "Notion", "Slack", "Telegram", "Calendar", "Claude", "Codex", "Gemini"].map((word, index) => ({ id: index + 1, word, misheard: index === 0 ? ["Rafael"] : [], source: index % 2 ? "learned" : "manual", created_at_ms: 1792720800000 })),
  } : {})),
  scene("dictation-keyboard", "Horizontal dictation navigation with keyboard focus", [...dictation("overview"), key("ArrowRight"), wait('[data-dictation-tab="history"][aria-selected="true"]'), key("ArrowLeft"), wait('[data-dictation-tab="overview"][aria-selected="true"]'), key("End"), key("Home"), wait('[data-dictation-tab="overview"][aria-selected="true"]'), key("End"), wait('[data-dictation-tab="dictionary"][aria-selected="true"]'), check("dictation-navigation")]),
  scene("dictation-heat-press", "Pressing a heatmap day shows its words above it; nothing shows under the pointer", [...dictation("overview"), click('.heat [data-date="2026-10-24"]'), check("dictation-heat-press")]),
  scene("dictation-notice", "Dictation connection notice", dictation("overview"), { problem: true }),
  scene("conversation-notice", "Conversation connection notice", [], { problem: true }),
  scene("onboarding", "First-run welcome: Raphael's emblem, his name, one promise, the language dropdown and one wide black pill", [wait('#ob:not([hidden]) [data-ob="next"]'), wait('.ob-emblem canvas.ob-emb'), check("guide-window-fixed"), check("onboarding-welcome")], { onboarding: true }),
  scene("onboarding-tools", "First-run step 1: the AI tools as a store of one-row tiles, a search box, 熱門 the same for everyone, then each kind by name",[click('[data-ob="next"]'), wait('[data-ob-tools] [data-item="claude"].on .ob-tick'), check("onboarding-tools")], { onboarding: true }),
  scene("onboarding-tools-key", "First-run step 1: the OpenRouter key being replaced shows its field and paste button", [click('[data-ob="next"]'), wait('[data-ob="key-replace"]'), click('[data-ob="key-replace"]'), wait("#ob-key-input"), check("onboarding-tools")], { onboarding: true }),
  scene("onboarding-back-hover", "First-run step 1: the round back arrow takes a lighter surface under the pointer (owner, 2026-11-11)", [click('[data-ob="next"]'), wait('.ob-foot [data-ob="back"]'), hover('.ob-foot [data-ob="back"]'), check("onboarding-back-hover")], { onboarding: true }),
  scene("onboarding-back-focus", "First-run step 1: Shift+Tab from the pill lands on the round back arrow, with the app's focus ring (owner, 2026-11-11)", [click('[data-ob="next"]'), wait('.ob-foot [data-ob="back"]'), { action: "focus", selector: '.ob-foot [data-ob="next"]' }, { ...key("Tab"), shift: true }, check("onboarding-back-focus")], { onboarding: true }),
  scene("onboarding-rerun", "The guide opened again from Settings: its welcome is one row, a round × to leave and the pill (owner, 2026-11-11)", [...settings("general"), click('[data-act="rerun-guide"]'), wait('#ob:not([hidden]) [data-ob="next"]'), wait('.ob-emblem canvas.ob-emb'), check("onboarding-rerun")]),
  scene("onboarding-services", "First-run step 2: a search box and the popular services of the store as tiles, one sign-in each", [click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-services] .ob-tile'), click('[data-item="gmail"][data-ob="conn-login"]'), wait('[data-item="gmail"].on .ob-tick'), check("onboarding-services")], { onboarding: true }),
  scene("onboarding-services-composio", "First-run step 2 without Composio: its card first, then the apps that need none", [click('[data-ob="next"]'), click('[data-ob="next"]'), wait('.ob-composio [data-ob="composio-open"]'), check("onboarding-services"), check("onboarding-composio")], { onboarding: true, composioConfigured: false }),
  scene("onboarding-composio-key", "Composio's key is typed in its card; a consumer key is refused beside its field", [click('[data-ob="next"]'), click('[data-ob="next"]'), wait('.ob-composio [data-ob="composio-open"]'), click('[data-ob="composio-open"]'), wait('#ob-composio-input'), type('#ob-composio-input', 'ck_look-0123'), click('[data-ob="composio-paste"]'), wait('.ob-composio [role="alert"]'), check("onboarding-services"), check("onboarding-composio")], { onboarding: true, composioConfigured: false }),
  scene("onboarding-composio-saved", "A saved Composio key adds its apps to the step and the card goes", [click('[data-ob="next"]'), click('[data-ob="next"]'), wait('.ob-composio [data-ob="composio-open"]'), click('[data-ob="composio-open"]'), wait('#ob-composio-input'), type('#ob-composio-input', 'ak_look-0123'), click('[data-ob="composio-paste"]'), waitGone('.ob-composio'), wait('[data-ob-services] .ob-tile'), check("onboarding-services")], { onboarding: true, composioConfigured: false }),
  scene("onboarding-services-n8n", "A search finds n8n; its address and key are typed across its tile", [click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-services] .ob-tile'), type('#ob-find', 'n8n'), wait('[data-item="n8n"] [data-ob="server-open"]'), click('[data-item="n8n"] [data-ob="server-open"]'), wait('#ob-server-url'), type('#ob-server-url', 'https://flows.example.test/mcp-server/http'), check("onboarding-services")], { onboarding: true }),
  scene("onboarding-service-waiting", "A tile waiting for its sign-in keeps its words inside it in every language", [click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-services] .ob-tile'), click('[data-item="linear"][data-ob="conn-login"]'), wait('[data-item="linear"] [data-ob="conn-cancel"]'), check("onboarding-services")], { onboarding: true, pluginsConnecting: true }),
  scene("onboarding-abilities", "First-run step 3: the abilities as Settings › 工具's rows, each saying what it uses, with its switch", [click('[data-ob="next"]'), click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-svc="toggle"][data-id="read"]'), wait('[data-svc="toggle"][data-id="read"][aria-checked="false"]'), check("onboarding-abilities")], { onboarding: true }),
  scene("onboarding-abilities-choice", "First-run step 3: an ability opens its choice of service in the card, as in Settings", [click('[data-ob="next"]'), click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-svc="open"][data-id="search"]'), wait('.ob-card #svc-dialog .svc-srv')], { onboarding: true }),
  scene("after-onboarding", "Finishing the third step opens the home overview", [click('[data-ob="next"]'), click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-ob="next"]'), wait(".page-home:not([hidden]) .ho-hero"), check("home-overview")], { onboarding: true }),
];
