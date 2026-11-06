// Browser assertions run against the real app after the scene's user interactions.
export function checkRendered(name, context = {}) {
  const visible = element => element && element.checkVisibility() && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const require = (condition, message) => { if (!condition) throw new Error(`${name}: ${message}`); };
  if (name === "template-content" || name === "template-content-expanded") {
    const dialog = document.querySelector('.template-preview');
    const skills = [...dialog.querySelectorAll('.template-skill')];
    require(skills.length > 0, "skills have named rows and full-text disclosures");
    for (const skill of skills) {
      require(skill.querySelector('.row .t')?.textContent.trim() && skill.querySelector('.row .val')?.textContent.trim(), "skill name and description remain on the shared row");
      const detail = skill.querySelector('.card-detail'), toggle = skill.querySelector('[data-card-disclosure]');
      require(!/^\s*---\s*\n(?:name|description):/m.test(detail.textContent) && !/^description:/m.test(detail.textContent), "skill full text omits frontmatter");
      const expanded = name.endsWith('-expanded');
      require(detail.hidden !== expanded && toggle.getAttribute('aria-expanded') === String(expanded), "skill body follows the disclosure state");
      if (expanded) require(visible(detail) && detail.innerText.includes('先查證來源，再完成報告。'), "expanding reveals the complete skill body");
    }
    const brands = {gmail:'Gmail',github:'GitHub',googlecalendar:'Google Calendar'};
    for (const card of dialog.querySelectorAll('[data-template-connection]')) {
      const id = card.dataset.templateConnection;
      require(card.querySelector('.card-title').textContent === (brands[id] || id), "connection cards use catalogue display names");
    }
    return {check:name};
  }
  if (name === "creator-tabs") {
    const maker = document.querySelector(".cr-dialog"), heading = maker.querySelector(".mb-dlg-head h2");
    const box = heading.getBoundingClientRect();
    const previous = window.__look.creatorHeading;
    require(!previous || (previous.node === heading && Math.abs(previous.x - box.x) < 1 && Math.abs(previous.y - box.y) < 1), "switching tabs preserves the same title and position");
    window.__look.creatorHeading = {node:heading, x:box.x, y:box.y};
    require(maker.querySelectorAll('.cr-tabs .tabs.plain.fill > .tab').length === 2, "creator uses the member panel's shared tabs");
    require(document.querySelectorAll('.cr-dialog').length === 1, "tabs share one creation container");
    return {check:name};
  }
  // The member store's own checks; the plugin store's store-group-* checks live further down.
  if (["store-home", "store-category", "store-search", "store-empty", "store-offline", "store-preview", "store-warning", "store-export"].includes(name)) {
    const calls = window.__look.calls;
    require(!calls.some(c => c.method === "members.template" && ["import", "publish"].includes(c.params.action)), "browsing and review never install or publish");
    require(!calls.some(c => /connect$/.test(c.method || "")), "preview never connects apps");
    if (["store-home", "store-category", "store-search"].includes(name)) {
      require(visible(document.querySelector(".store-entry svg.slime")), "existing slime avatars");
      require(document.querySelectorAll("[data-category]").length === 9, "all plus eight categories");
      if (name === "store-home") require(document.querySelectorAll(".store-featured .store-entry").length === 2, "featured row");
      else require(document.querySelectorAll(".store-entry").length === 1, "local filter selects one entry");
      require(calls.filter(c => c.method === "members.template" && c.params.action === "catalog").length === 1, "filtering never refetches");
    } else if (["store-empty", "store-offline"].includes(name)) {
      require(document.querySelector(".store-results").textContent.includes("商店目前沒有內容"), "calm empty copy");
      require(!document.querySelector(".store-entry"), "no fabricated catalogue entries");
    } else {
      const dialog = document.querySelector(".template-preview");
      require(visible(dialog), "shared preview dialog");
      require(!dialog.querySelector('.card-status, .card-well'), "preview has no template status pill or padded list boxes");
      for (const field of dialog.querySelectorAll('.template-field')) {
        const heading = field.querySelector('h4').getBoundingClientRect(), text = field.querySelector('.template-text').getBoundingClientRect();
        require(text.top - heading.bottom <= 8, "full text follows its heading with compact spacing");
      }
      const template = window.__look.data.colleagueSample.template;
      require(dialog.textContent.includes(template.personality) && dialog.querySelector('.template-skill .card-detail').textContent.includes('先查證來源，再完成報告。') && dialog.textContent.includes(template.routines[0].prompt), "full personality, skill body and routine text");
      if (name === "store-export") {
        require(!window.__look.exportedTemplate && visible(dialog.querySelector('[data-dlg="export"]')), "review precedes file save");
      } else {
        require(dialog.textContent.includes("加入前不會授予任何權限"), "no permissions before explicit import");
        require(dialog.querySelectorAll('[data-dlg="connect"]').length === template.connections.length && [...dialog.querySelectorAll('[data-dlg="connect"]')].every(b => b.disabled), "one disabled connect action per app");
        require(dialog.textContent.includes("09:00"), "actual schedule visible");
        if (name === "store-warning") {
          const warning = dialog.querySelector('.template-warnings[role="status"]');
          require(warning && !warning.textContent.includes("template.") && !/[。.]\s*·/.test(warning.textContent), "one warning block uses localized sentences without stray punctuation");
          const lines = [...warning.querySelectorAll('p')];
          require(lines.length === 2 && lines[1].getBoundingClientRect().top - lines[0].getBoundingClientRect().bottom <= 8, "third-party and scan risks share compact spacing");
        }
      }
    }
    return {check:name};
  }
  if (name.startsWith("voice-call-")) {
    require(["voice-call-idle", "voice-call-panel", "voice-call-transcript", "voice-call-settings", "voice-call-ended", "voice-call-no-mic", "voice-call-busy"].includes(name), "known voice call check");
    const calls = window.__look.calls;
    if (["voice-call-idle", "voice-call-no-mic"].includes(name)) {
      const composer = document.querySelector('.page-agent .composer');
      require(document.querySelector('[data-mount="background-questions"]')?.nextElementSibling === composer, "background questions remain directly above the composer");
      require(composer?.contains(document.querySelector('.vc-failure')), "transient call failures stay inside the composer");
    }
    if (name === "voice-call-idle") {
      const button = document.querySelector('.cmp-voice[data-voice-call-start="true"]');
      require(visible(button), "empty member composer offers voice chat");
      require(button.dataset.tooltip === "按住說話；點一下開始語音對話" && button.getAttribute('aria-label') === button.dataset.tooltip, "one localized line explains both gestures");
      const tooltip = document.querySelector('.message-tooltip:not([hidden])');
      require(visible(tooltip) && tooltip.textContent === button.dataset.tooltip, "the shared visible tooltip explains both gestures");
      require(!calls.some(call => call.method === "voice_chat.start"), "hover never starts a call");
    }
    if (["voice-call-panel", "voice-call-transcript", "voice-call-settings"].includes(name)) {
      require(visible(document.querySelector('.voice-call')), "one call panel is visible");
      require(!visible(document.querySelector('.page-agent .composer')), "call replaces the composer");
      require(document.querySelectorAll('.voice-call svg.slime').length === 1, "one existing member slime");
      require(![...document.querySelectorAll('.ra-empty > .ra-hero')].some(visible), "the call does not duplicate the empty-thread character");
      require(calls.filter(call => call.method === "voice_chat.start").length === 1, "one call admission");
    }
    if (name === "voice-call-transcript") require(document.querySelectorAll('.voice-call [data-call-turn]').length === 1, "transcript contains the owner and member turn");
    if (name === "voice-call-settings") require(document.querySelectorAll('.vc-settings .sel').length === 3, "three shared dropdowns");
    if (name === "voice-call-ended") {
      require(document.querySelectorAll('[data-call-card]').length === 1, "one receipt after hang-up");
      require(!document.querySelector('.tn[data-id="8701"]'), "normal call turns fold under the card");
      require(document.querySelector('[data-call-rating="good"]').getAttribute('aria-pressed') === 'true', "local rating persists");
      const toggle = document.querySelector('[data-call-card] [data-card-disclosure]');
      require(toggle?.tagName === 'BUTTON' && toggle.textContent.trim() === '隱藏逐字稿', "the open transcript toggle is a button that says it hides");
      require(visible(document.querySelector('[data-call-card] .vc-transcript')), "the transcript opens inside the receipt");
      require(/已結束 · \d+:\d{2}/.test(document.querySelector('[data-call-card] [data-card-status-text]')?.textContent ?? ''), "the receipt says the call length beside its state");
      require(calls.some(call => call.method === "voice_chat.end") && calls.some(call => call.method === "voice_chat.feedback"), "hang-up and feedback cross the real IPC boundary");
    }
    if (name === "voice-call-no-mic") {
      require(visible(document.querySelector('.vc-card [data-missing-repair="dictation"]')), "one actionable shared repair entry");
      require(!visible(document.querySelector('.vc-failure')), "no duplicate failure sentence by the composer");
    }
    if (name === "voice-call-busy") {
      require(visible(document.querySelector('.vc-confirm [data-dlg="replace"]')), "explicit end and start confirmation");
      require(!calls.some(call => call.method === "voice_chat.end"), "opening confirmation does not hang up");
    }
    return { check: name };
  }
  if (name.startsWith("colleague-")) {
    const calls = window.__look.calls;
    if (name === "colleague-gallery") require(document.querySelectorAll('.template-gallery svg.slime').length === 8, "eight existing slime characters");
    if (name === "colleague-preview") {
      require(visible(document.querySelector('.template-preview')), "preview is visible");
      require([...document.querySelectorAll('.template-preview [data-dlg="connect"]')].every(button => button.disabled), "preview cannot grant connections");
      require(!calls.some(call => call.method === "members.template" && call.params.action === "import"), "preview never imports");
      const preview = document.querySelector('.template-preview'), notice = preview.querySelector('[data-template-notice]');
      require(preview.textContent.split(notice.textContent).length === 2 && preview.querySelector('.mb-dlg-act').firstElementChild === notice, "one quiet import notice directly precedes the footer buttons");
      const noticeBox = notice.getBoundingClientRect(), footerBox = preview.querySelector('.mb-dlg-act').getBoundingClientRect();
      require(noticeBox.top >= footerBox.top && noticeBox.bottom <= preview.querySelector('[data-dlg="import"]').getBoundingClientRect().top, "the entire import notice stays visible above the buttons");
      require(!preview.querySelector('.card-status, .card-well'), "no invented template or connection status and no padded list boxes");
      require(preview.querySelectorAll('.list .row').length === 2 && [...preview.querySelectorAll('.list .row')].every(row => row.querySelector('.t') && row.querySelector('.ctl .val')), "skills and paused routines reuse compact named list rows with muted detail");
    }
    if (name === "colleague-imported") {
      require(calls.some(call => call.method === "members.template" && call.params.action === "import"), "import follows explicit action");
      const member = window.__look.data.members.at(-1);
      require(member.tools.length === 0, "no imported app grants");
      require(window.__look.data.routines.filter(r => r.member_id === member.id).every(r => !r.enabled), "imported routines stay off");
    }
    if (name === "colleague-export") {
      const template = JSON.parse(window.__look.exportedTemplate);
      require(template.format === "raphael-member" && !template.memory && !template.tools && !template.avatar, "one recipe excludes private state and grants");
    }
    if (name === "colleague-greeting") require(visible(document.querySelector('[data-greeting-question]')) && document.querySelectorAll('[data-greeting-option]').length === 3, "shared choice form and free text");
    if (name === "colleague-goal") {
      require(calls.some(call => call.command === "agent_ask_text" && call.text === window.__look.data.colleagueSample.options[0]), "choice submits exactly the owner's words");
      require(document.querySelector('.ra-scroll').innerText.includes(window.__look.data.colleagueSample.outcomeQuestion), "one outcome question is visible");
    }
    if (name === "colleague-handoff") require(document.querySelector('.ra-scroll').innerText.includes('/home/cua/team/projects/'), "handoff cites a shared-team path");
    if (name === "colleague-accounts") require(document.querySelector('.cs-accts').textContent.includes('工作信箱') && document.querySelector('.cs-accts').textContent.includes('私人信箱'), "accounts have distinct public labels");
    if (name === "colleague-label-saved") require(calls.some(call => call.method === "connectors.label" && call.params.label === "研究信箱"), "owner label is saved by account id");
    if (name === "colleague-tunnel") require(document.querySelector('.au-tunnel').textContent.includes('tailscale funnel --bg http://127.0.0.1:43210'), "exact loopback-forward command");
    if (name === "colleague-tunnel-tested") require(document.querySelector('.au-tunnel').innerText.includes('已收到自測 POST'), "public URL probe returned to the editor");
    if (name === "colleague-tunnel-hmac") require(document.querySelector('[data-auth="hmac"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.au-hook-secret').type === 'text', "explicit HMAC choice and one-time key");
    if (name === "colleague-output") require(document.querySelector('#owner-output-folder').value === window.__look.data.colleagueSample.path && calls.some(call => call.command === "pick_output_folder") && calls.some(call => call.method === "settings.set" && call.params.key === "owner_output_folder" && call.params.value === window.__look.data.colleagueSample.path), "native picker result is stored in the existing typed field and settings");
    if (name === "colleague-output-cancel") require(calls.some(call => call.command === "pick_output_folder") && !calls.some(call => call.method === "settings.set" && call.params.key === "owner_output_folder"), "cancel never writes the folder setting");
    return {check:name};
  }
  if (name === 'reaction-layout-rest' || name === 'reaction-layout-hover') {
    const rows = [...document.querySelectorAll('.chat-message > .message-reactions')].filter(visible);
    require(rows.length > 0, 'there are saved reactions to inspect');
    const positions = rows.map(row => {
      const bubble = row.previousElementSibling, actions = row.nextElementSibling;
      require(bubble?.matches('.ans, .bubble') && actions?.matches('.message-actions'), 'reactions follow the bubble before the hover actions');
      const bounds = row.getBoundingClientRect(), message = row.parentElement.getBoundingClientRect();
      const gap = bounds.top - bubble.getBoundingClientRect().bottom;
      require(gap >= 0 && gap <= 8, 'reactions stay within eight pixels of their bubble');
      return { top: bounds.top, left: bounds.left, height: message.height };
    });
    if (name === 'reaction-layout-rest') window.__look.reactionPositions = positions;
    else {
      const before = window.__look.reactionPositions;
      require(before?.length === positions.length && positions.every((position, index) =>
        Object.keys(position).every(key => Math.abs(position[key] - before[index][key]) < 1)), 'hover keeps reactions and message height stationary');
      const actions = document.querySelector('.chat-message:hover > .message-actions');
      require(actions && getComputedStyle(actions).opacity === '1', 'hover reveals the existing message actions');
    }
    return { check: name, positions };
  }
  if (name.startsWith('vault-')) {
    const vault = document.querySelector('.vault');
    if (name === 'vault-payment') {
      const card = document.querySelector('[data-permission-card]');
      const body = card?.querySelector('.card-body');
      require(visible(body) && ['公司差旅卡', 'https://travel.example.invalid', 'NT$ 1,280', '最後付款由你完成'].every(text => body.innerText.includes(text)), 'payment visibly names the card, merchant, amount and owner final step without expanding details');
      require(!card.querySelector('[data-act="perm-always"]'), 'no standing payment approval is offered');
    } else if (name === 'vault-preview') {
      require(vault.querySelectorAll('[data-vault-import]').length === 2 && vault.querySelectorAll('[data-vault-import]:checked').length === 1, 'preview supports individual selection');
      require(!window.__look.calls.some(call => ['vault.add','vault.import'].includes(call.method)), 'preview writes no credentials');
    } else if (name.startsWith('vault-new-')) {
      const fields = { login:2, contact:4, card:4 }[name.slice(10)];
      require(vault.querySelectorAll('[id^="vault-value-"][type="password"]').length === fields, 'all private fields are masked');
      if (name === 'vault-new-card') require(vault.textContent.includes('最後的付款或送出由你完成'), 'card entry explains the final owner step');
    } else if (name === 'vault-menu') require(visible(document.querySelector('#app-popover [data-pick="edit"]')) && visible(document.querySelector('#app-popover [data-pick="remove"]')), 'entry actions use the shared row menu');
    else if (name === 'vault-filter') require(vault.querySelectorAll('.vault-row').length === 1 && vault.textContent.includes('公司差旅卡'), 'card filter selects only cards');
    else if (name === 'vault-sharing') require(vault.querySelectorAll('[data-vault-member]').length >= 2 && vault.querySelector('#vault-label').value === '出差聯絡資料', 'sharing preserves form input');
    else {
      require(vault.querySelectorAll('.vault-row').length === 3 && vault.textContent.includes('出差用公司卡'), 'all kinds and hints appear');
      const about = vault.querySelector(':scope > p.dim'), lines = new Map();
      for (let offset = 0; offset < about.firstChild.textContent.length; offset++) {
        if (!about.firstChild.textContent[offset].trim()) continue;
        const range = document.createRange(); range.setStart(about.firstChild, offset); range.setEnd(about.firstChild, offset + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        lines.set(top, (lines.get(top) || 0) + 1);
      }
      require(lines.size <= 1 || [...lines.values()].at(-1) > 1, 'vault description has no single-character last line');
      require(vault.querySelector('.tabs.plain[role="tablist"]') && !vault.querySelector('.tabs.seg'), 'kind navigation shares plain tabs with Connections');
      for (const tab of vault.querySelectorAll('.tabs .tab')) {
        const count = tab.querySelector('.n');
        require(count, 'each kind has a visible count');
        const range = document.createRange();
        range.selectNodeContents(tab);
        range.setEndBefore(count);
        const number = count.getBoundingClientRect(), label = range.getBoundingClientRect();
        require(number.top < label.bottom && number.bottom > label.top, 'filter counts remain on the label line');
      }
    }
    return { check: name, passed: true };
  }
  if (name === "about-no-updater-key" || name === "about-release-page-opened") {
    const section = document.querySelector("[data-updates]");
    require(visible(section) && section.textContent.includes("0.2.0"), "the current app version is visible");
    require(section.textContent.includes("新版本請到發布頁查看"), "release-page guidance is quiet and explicit");
    require(visible(section.querySelector('[data-act="update-releases"]')), "the shared release-page button is visible");
    require(!section.querySelector('[data-act="update-check"], [data-act="update-install"], [data-k="auto-update"], [role="alert"], .error'), "unavailable update controls and error tone are absent");
    if (name === "about-release-page-opened") {
      require(window.__look.urls.filter(url => url === "https://github.com/Jheng-Kai/Raphael/releases").length === 1, "one click opens the release page through the native opener boundary");
      require(window.__look.calls.filter(call => call.command === "update_control" && call.action === "check").length === 1, "opening the release page does not check for updates again");
    }
    return {check:name};
  }
  if (name.startsWith('member-panel-')) {
    const panel = document.querySelector('.mb-det'), selected = panel.querySelector('.mb-tabs [aria-selected="true"]');
    const tab = name.includes('library') ? 'library' : name.includes('details') || name.includes('task-') ? 'details' : 'computer';
    require([...panel.querySelectorAll('.mb-tabs [role="tab"]')].map(node => node.textContent).join('/') === '詳細資料/檔案庫/電腦', 'the shared tabs name the three destinations');
    require(selected?.dataset.tab === tab, 'the intended tab is selected');
    require(visible(panel.querySelector('.mb-panel-identity')), 'member face, name and role stay above the tabs');
    const face = panel.querySelector('.mb-panel-identity > .av').getBoundingClientRect(), named = panel.querySelector('.mb-panel-identity > b').getBoundingClientRect();
    require(face.width >= 56 && face.bottom <= named.top + 1 && Math.abs(face.left + face.width / 2 - (named.left + named.width / 2)) <= 1, 'a large face stands centred above the name, as Grok Bot\'s');
    for (const button of [...panel.querySelectorAll('.mb-det-head .btn.icon'), ...document.querySelectorAll('.page-agent .mb-head .btn.icon, .page-agent .cmp-bar .cmp-attach')].filter(visible)) {
      const style = getComputedStyle(button), box = button.getBoundingClientRect();
      require(parseFloat(style.borderRadius) >= box.width / 2 - 0.5 && Math.abs(box.width - box.height) < 1 && style.backgroundColor !== 'rgba(0, 0, 0, 0)', `the buttons on the window's edges are Grok Bot's soft round buttons (${button.getAttribute('aria-label') ?? button.dataset.act})`);
    }
    if (tab === 'details') for (const section of panel.querySelectorAll('.mb-tab-body > section')) {
      const head = section.querySelector(':scope > .mb-dh'), list = section.querySelector('.mb-task-list, .mb-rts, .conversation-rows, :scope > .mp-empty');
      if (!visible(head) || !visible(list)) continue;
      const pad = node => node ? parseFloat(getComputedStyle(node).paddingLeft) : 0, row = list.querySelector('.mb-task-open, .mb-rt, .conversation-open');
      const inner = list.getBoundingClientRect().left + pad(list) + pad(row), start = head.getBoundingClientRect().left + pad(head);
      require(Math.abs(inner - start) <= 1 && getComputedStyle(list).backgroundColor !== 'rgba(0, 0, 0, 0)', `a panel heading starts where the text of its tinted list starts (${Math.round(start)} vs ${Math.round(inner)})`);
    }
    if (tab === 'computer') {
      const live = visible(panel.querySelector('.desktop-screen iframe'));
      const runs = ['member', 'owner', 'connecting'].includes(panel.querySelector('.desktop-panel')?.dataset.desktopState);
      require(!!visible(panel.querySelector('[data-desktop="enlarge"]')) === runs, 'the preview opens the larger view whenever the computer runs');
      require(!visible(panel.querySelector('[data-desktop="take"]')), 'Take control waits in the larger view, never under the preview');
      if (live) require(panel.querySelector('[data-computer-state-text]')?.textContent === '執行中', 'the live header names the running state');
    }
    if (tab === 'details') require([...panel.querySelectorAll('.mb-dh')].filter(node => visible(node) && node.textContent === '對話').length === (panel.querySelector('[data-slot="conversations"]') ? 1 : 0), 'Details names the conversation section once, and only for Raphael');
    if (name === 'member-panel-task-stop' || name === 'member-panel-task-rerun') {
      const items = document.querySelectorAll('.menu [role="menuitem"]');
      require(items.length === 1 && items[0].textContent.trim() === (name.endsWith('stop') ? '停止' : '重新執行'), 'work exposes only the action for its current state');
      require(!window.__look.calls.some(call => ['worker.cancel','worker.rerun'].includes(call.method)), 'opening a menu does not mutate work');
    } else if (name === 'member-panel-details') {
      const rows = [...panel.querySelectorAll('.mb-task-row')];
      require(rows.length === 4 && rows.map(row => row.querySelector('small').textContent.split(' · ')[0]).join('/') === '進行中/等你/完成/失敗', 'work in hand comes first, then the newest finished work');
      require(rows.every(row => row.querySelector('time') && row.querySelector('[data-panel-task-menu]')), 'each work row has time and its menu');
      require(rows.every(row => row.parentElement === rows[0].parentElement && row.parentElement.matches('.mb-task-list')), 'all work sits in one list, as in Grok Bot');
      require(rows.every(row => parseFloat(getComputedStyle(row.querySelector('.mb-task-open')).borderTopWidth) === 0), 'no frame is drawn around each work row');
      const closeRight = panel.querySelector('[data-det="close"]').getBoundingClientRect().right, listBox = panel.querySelector('.mb-task-list').getBoundingClientRect(), tabBar = panel.querySelector('.mb-tabs .tabs').getBoundingClientRect();
      require(Math.abs(closeRight - listBox.right) < 1, `close stands on the content's right edge (${Math.round(closeRight)} vs ${Math.round(listBox.right)})`);
      require(Math.abs((tabBar.left + tabBar.right) / 2 - (listBox.left + listBox.right) / 2) < 1, 'the tabs sit in the middle of the content');
      require(!!panel.querySelector('.mb-panel-routines') && !panel.querySelector('[data-slot="conversations"]'), 'routines follow work, and a member has no conversation list');
    } else if (name === 'member-panel-details-empty') {
      require(panel.querySelector('.mb-panel-tasks').textContent.includes('還沒有工作'), 'work has a one-line empty state');
    } else if (name === 'member-panel-library' || name === 'member-panel-library-more') {
      require(panel.querySelectorAll('.team-file[data-panel-file]').length === (name.endsWith('-more') ? 15 : 12), 'library reuses file chips and its bounded next page');
      require(panel.querySelector('.mb-tab-body').textContent.includes('本週') && panel.querySelector('.mb-tab-body').textContent.includes('更早'), 'library groups recent and earlier files/pages');
    } else if (name === 'member-panel-library-empty') {
      require(panel.querySelector('.mb-tab-body').textContent === '還沒有檔案或頁面', 'library has one empty sentence');
    } else if (name === 'member-panel-computer-live') {
      require(visible(panel.querySelector('iframe')), 'the existing stream is visible');
      const open = panel.querySelector('[data-desktop="enlarge"]'), screen = panel.querySelector('.desktop-screen').getBoundingClientRect(), cover = open.getBoundingClientRect(), caption = panel.querySelector('.desktop-caption');
      require(visible(open) && Math.abs(cover.width - screen.width) <= 2 && Math.abs(cover.height - screen.height) <= 2, 'the whole preview is the button that opens the larger view');
      require(getComputedStyle(open.querySelector('.desktop-open-pill')).opacity === '0', 'the Open pill shows only under the pointer');
      require(visible(caption) && caption.textContent.endsWith('的畫面') && caption.getBoundingClientRect().top >= screen.bottom, 'the screen is captioned below with whose it is, as in Grok Bot');
    } else if (name === 'member-panel-computer-docker-stopped') {
      require(panel.querySelector('.desktop-message').textContent.includes('Docker Desktop'), 'the real local engine failure names Docker Desktop');
      require(panel.querySelector('[data-desktop="retry"]').textContent === '啟動 Docker Desktop' && panel.querySelector('[data-desktop-location]').textContent === '改用遠端電腦', 'both contextual recovery actions are offered');
      require(!window.__look.calls.some(call => call.params?.start_docker), 'reading never starts Docker');
    } else if (name === 'member-panel-computer-docker-missing') {
      require(visible(panel.querySelector('[data-act="docker-download"]')), 'missing installation retains the download action');
    } else if (name === 'member-panel-computer-remote') {
      require(panel.querySelector('.desktop-message').textContent.includes('studio-mini'), 'remote failure names the configured host');
    } else if (name === 'member-panel-docker-start') {
      const calls = window.__look.calls.filter(call => call.params?.start_docker);
      require(calls.length === 1 && calls[0].params.host === '' && calls[0].params.member_id === 1, 'one explicit press starts only the captured local engine');
      require(panel.querySelector('.desktop-error').getAttribute('role') === 'status', 'engine readiness is a status notice');
      require(panel.querySelector('.desktop-error').textContent === 'Docker Desktop 已準備好', 'engine readiness is reported beside its screen');
    } else if (name === 'member-panel-remote-location') {
      require(visible(document.querySelector('.computer-location-popover')), 'recovery opens the existing location control');
    } else if (name === 'member-panel-location-hover') {
      const button = panel.querySelector('.desktop-location-header [data-computer-location]'), style = getComputedStyle(button);
      require(button.matches(':hover') && button.textContent.includes('mac-mini'), 'the pointer is on the location button');
      const clear = value => value === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(value);
      require(clear(style.backgroundColor) && clear(style.borderTopColor), `the location shows no fill or frame under the pointer (${style.backgroundColor}, ${style.borderTopColor})`);
    }
    return {check:name, tab};
  }
  if (name === 'panel-state-layout') {
    const screen = document.querySelector('.desktop-panel .desktop-screen');
    const sentence = screen?.querySelector('.desktop-message, .missing-note, .desktop-stage');
    require(visible(screen) && visible(sentence), 'the screen contains its state sentence');
    const bounds = screen.getBoundingClientRect(), text = sentence.getBoundingClientRect();
    const inside = box => box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
    require(inside(text), 'the state sentence stays inside the screen');
    // The fake core answers an absent Docker when the scene sets no computer, as the real core does without Docker.
    const state = window.__look.data.desktop ?? { state: 'absent' };
    const phase = state.lifecycle ?? (['docker_stopped', 'remote_unavailable'].includes(state.error) || ['absent','unavailable','incompatible'].includes(state.state) || state.state === 'missing' && state.image === false ? 'unavailable'
      : ['stopped','missing'].includes(state.state) ? 'sleeping' : state.state === 'building' ? 'updating' : 'starting');
    const words = {sleeping:'休眠中',starting:'啟動中',waking:'喚醒中',updating:'更新中',repairing:'修復中',unavailable:'無法使用'};
    const header = document.querySelector('[data-computer-state-text]');
    require(visible(header) && header.textContent === words[phase], 'the short header word agrees with the screen state');
    const walker = document.createTreeWalker(document.querySelector('.mb-det'), NodeFilter.SHOW_TEXT);
    let occurrences = 0;
    while (walker.nextNode()) if (visible(walker.currentNode.parentElement)) occurrences += walker.currentNode.textContent.split(sentence.textContent).length - 1;
    require(occurrences === 1, 'the full state sentence appears only once');
    const location = document.querySelector('.desktop-location-header [data-computer-location]').getBoundingClientRect();
    const word = header.getBoundingClientRect();
    require(word.top < location.bottom && word.bottom > location.top, 'the short state stays on the location control row');
    require(visible(screen.querySelector('.desktop-boot-face')), 'each offline state uses the member face');
    const buttons = [...screen.querySelectorAll('button')].filter(visible);
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      require(inside(box), 'each state button stays inside the screen');
      require(box.right <= text.left || box.left >= text.right || box.bottom <= text.top || box.top >= text.bottom, 'the state sentence and buttons never overlap');
      require(box.top >= text.bottom, 'state actions follow the sentence');
      for (const other of buttons.filter(other => other !== button)) {
        const next = other.getBoundingClientRect();
        require(box.right <= next.left || box.left >= next.right || box.bottom <= next.top || box.top >= next.bottom, 'state buttons never overlap one another');
      }
    }
    return {check:name};
  }
  if (name.startsWith("app-update-")) {
    const section = document.querySelector("[data-updates]");
    require(visible(section) && section.textContent.includes("1.1.0"), "new version is visible");
    require(section.textContent.includes("改善更新安裝"), "release notes remain readable");
    require(visible(section.querySelector('[data-act="update-install"]')), "a framed install action is visible");
    if (name === "app-update-ready") require(section.textContent.includes("更新已驗證"), "verified state is explicit");
    require(section.querySelector('[data-k="auto-update"]').getAttribute("aria-checked") === (name === "app-update-auto" ? "true" : "false"), "auto updates are opt-in");
    return {check:name};
  }
  if (name === "app-memory-import" || name === "app-memory-result") {
    const imported = document.querySelector("[data-memory-import]");
    const owner = imported?.parentElement;
    const shared = owner?.querySelector('[data-mem-space="shared"]');
    require(owner?.querySelector("h2")?.textContent === "關於你" && shared && !!(shared.compareDocumentPosition(imported) & Node.DOCUMENT_POSITION_FOLLOWING), "memory import follows shared memory inside About you");
    require(visible(document.querySelector("[data-import-prompt]")), "handover prompt is visible");
    require(visible(document.querySelector("[data-import-answer]")), "owner answer field is visible");
    for (const field of document.querySelectorAll(".memory-import textarea")) {
      require(field.getBoundingClientRect().height >= 140, "memory import fields retain room for multiple lines");
    }
    if (name === "app-memory-result") {
      const result = document.querySelector(".import-result");
      require(visible(result) && result.textContent.includes("已保留 1 項") && result.textContent.includes("未加入 1 項"), "kept and refused items are listed");
      require(!result.textContent.includes("synthetic123"), "refused secrets are not echoed");
    }
    return {check:name};
  }
  if (name === "app-attachment-count") {
    require(document.querySelectorAll(".cmp-chip").length === 20, "exactly twenty files remain");
    require(!document.querySelector(".cmp-file").textContent.includes("超過數量"), "the twenty-first file is refused");
    return {check:name};
  }
  if (name === "app-attachment-size") {
    require(document.querySelectorAll(".cmp-chip").length === 0, "oversized files never reach the tray");
    require(!window.__look.calls.some(call => call.method === "attachments.upload"), "oversized files are refused before streaming");
    return {check:name};
  }
  if (name.startsWith('routine-test-')) {
    if (name === 'routine-test-menu') {
      require(document.querySelector('.mb-det')?.dataset.detailsTab === 'details' && visible(document.querySelector('.mb-panel-routines [data-routine="91"]')), 'the routine row stays in the Details routine section');
      require(document.querySelector('[data-routine="91"]')?.textContent.includes('台北'), 'the Details routine row retains the saved schedule zone');
      require(visible(document.querySelector('#app-popover [data-pick="test"]')), 'the row offers the shared test action');
    } else {
      const calls = window.__look.calls.filter(call=>call.method==='routines.run');
      require(calls.length === 1 && calls[0].params.id === 91, 'one real-boundary manual action targets the saved routine');
      if (name === 'routine-test-conversation') {
        require([...document.querySelectorAll('.mb-chat:not([hidden]) .ans')].some(node=>node.textContent.includes('已整理三則範例筆記')), 'the result appears in the owning member conversation');
      } else {
        const button = document.querySelector('[data-dlg="test"]'), status = document.querySelector('.au-test-status');
        require(visible(button) && button.disabled === (name === 'routine-test-running'), 'pending lasts until the recorded run finishes');
        if (name === 'routine-test-refused') require(status.textContent.includes('200') && status.getAttribute('role')==='alert', 'a refusal states the hourly reason');
        if (name === 'routine-test-done') require(status.textContent.includes('成功') && status.textContent.includes('範例筆記'), 'a completed run has its actual result');
        if (name !== 'routine-test-refused') require(/ · 今天 \d{2}:\d{2}(?: · |$)/.test(status.textContent), 'test results use the shared relative day and minute clock');
      }
    }
    return {check:name};
  }
  if (name === 'routine-when-words' || name === 'routine-when-editor') {
    const node = document.querySelector(name === 'routine-when-editor' ? '.au-trigger-preview' : '[data-routine="91"]');
    require(visible(node) && node.textContent.includes('08:00') && node.textContent.includes('台北') && node.textContent.includes('工作日'), 'schedule words include the saved time and zone');
    return {check:name};
  }
  if (name === 'routine-empty-words') {
    require(document.querySelector('.mb-panel-routines .mp-empty')?.textContent === '在對話中請成員建立例行任務', 'the empty state tells the owner to ask in chat');
    require(visible(document.querySelector('[data-det="routine-add"]')), 'the existing add button remains');
    return {check:name};
  }
  if (name === 'routine-run-history') {
    const history = document.querySelector('.au-run-history');
    require(visible(history) && ['執行中','成功','失敗','未使用舊資料'].every(word=>history.textContent.includes(word)), 'history has readable statuses and the failure reason');
    require([...history.querySelectorAll('[data-run-status]')].every(row => / · (今天|昨天) \d{2}:\d{2}(?!:)/.test(row.textContent)), 'each recent run uses a relative day and omits seconds');
    return {check:name};
  }
  if (name.startsWith('routine-recipe-')) {
    const fields = document.querySelector('.au-recipe-fields');
    require(visible(fields) && fields.textContent.includes(name.endsWith('sentry') ? 'data.issue.id' : 'event.data.id'), 'the recipe names real provider payload paths');
    require(document.querySelector('.au-webhook').textContent.includes('HTTPS'), 'the public relay prerequisite is explicit');
    require(document.querySelector('[data-dlg="hook-header"]') && document.querySelector('[data-dlg="hook-url"]'), 'the local URL and Bearer header have shared copy buttons');
    require(document.querySelector('.au-hook-secret').type === 'password', 'the key remains masked until requested');
    return {check:name};
  }
  if (name === 'routine-trigger-slack') {
    require(window.__look.calls.some(call=>call.method==='routines.list' && call.params.contains==='<@U012345>' && call.params.value==='C012345'), 'the phrase and selected channel reach the existing event boundary');
    require(document.querySelector('#au-event-contains').value==='<@U012345>', 'the mention is retained in the editor');
    const fields = [...document.querySelectorAll('.au-event-fields .mb-fin')];
    const button = document.querySelector('[data-dlg="event-check"]').getBoundingClientRect();
    for (const input of fields) {
      const box = input.getBoundingClientRect(), label = document.createRange();
      label.selectNodeContents(input.parentElement); label.setEndBefore(input);
      require(label.getBoundingClientRect().bottom <= box.top, 'event labels sit above their fields');
      require(Math.abs(box.height - button.height) <= 1, 'event fields and confirm action share the control height');
      require(Math.abs(box.bottom - button.bottom) <= 1, 'confirm action aligns with the fields it checks');
    }
    return {check:name};
  }
  if (name === 'routine-zone' || name === 'routine-zone-search') {
    require(visible(document.querySelector('[data-k="routine-timezone"]')), 'General contains a shared time-zone dropdown');
    if (name.endsWith('search')) require(document.querySelectorAll('[data-zone]').length === 1 && document.querySelector('[data-zone="Asia/Taipei"]'), 'city search narrows to the saved IANA zone');
    return {check:name};
  }
  if (name === 'routine-zone-saved' || name === 'routine-zone-reset') {
    const expected = name.endsWith('saved') ? 'America/New_York' : '';
    require(window.__look.data.settings.routine_timezone === expected, 'the real settings action persists the zone choice');
    require(window.__look.calls.some(call=>call.method==='settings.set' && call.params.key==='routine_timezone' && call.params.value===expected), 'the existing settings boundary owns persistence');
    return {check:name};
  }
  if (['reaction-picker','reaction-row','reaction-not-approval','room-thread-open','room-thread-chip','slack-draft','voice-memo'].includes(name)) {
    const calls = window.__look.calls, data = window.__look.data;
    require(!document.querySelector('.conversation-event-line[data-reaction]'), 'metadata adds no centered event line');
    require([...document.querySelectorAll('[data-reaction]')].every(button => button.getAttribute('aria-pressed') === 'true' && button.getAttribute('aria-label')?.includes(button.dataset.reaction)), 'selected reactions are named pressed toggles');
    if (name === 'reaction-picker') {
      const menu = document.querySelector('#app-popover');
      require(visible(menu) && ['👍','😂','👎','❤','🎉'].every(emoji=>menu.textContent.includes(emoji)), 'one compact pill of the five reactions Grok Bot offers');
    }
    if (name === 'reaction-row') require(document.querySelector('.tn[data-id="8201"] [data-reaction="👍"]') && document.querySelector('.tn[data-id="8201"] [data-reaction="❤"]'), 'saved reactions appear below their message');
    if (name === 'reaction-not-approval') {
      require(calls.some(call=>call.method==='agent.react' && call.params.emoji==='😂'), 'the actual reaction action reached core');
      require(!calls.some(call=>['agent.confirm','owner_questions.answer','integrations.draft_send'].includes(call.method)), 'a reaction never approves, answers or sends');
      const turn=data.turns.find(turn=>turn.id===8201);
      require(turn.drafts[0].state==='draft' && turn.owner_questions[0].state==='asked', 'draft and owner question remain pending');
      require(turn.permissions[0].state==='pending', 'permission remains pending');
    }
    if (name === 'room-thread-chip') require(document.querySelector('.room-thread-chip')?.textContent.includes('2 則回覆'), 'only a compact reply count under the root');
    if (name === 'room-thread-open') {
      require(visible(document.querySelector('.room-side-thread')), 'the side thread opens beside the room');
      require(document.querySelectorAll('.room-side-thread [data-side-message]').length===3, 'root and two replies are in the side thread');
      require(document.querySelector('.room-side-thread [data-side-message="8203"] .me .owner-message .bubble'), 'side replies retain the shared owner bubble');
      require(document.querySelectorAll('.au-room-thread [data-room-message]').length===1, 'side replies are absent from the main room');
      require(calls.some(call=>call.method==='rooms.messages' && call.params.thread_id===900), 'the side thread uses the core thread boundary');
    }
    if (name === 'slack-draft') {
      const card=document.querySelector('[data-draft-kind="slack"]');
      require(visible(card) && card.textContent.includes('需要你確認'), 'Slack uses the shared approval draft card');
      require(card.querySelector('[data-mail-field="to"]')?.value==='#研究討論' && !card.querySelector('[data-mail-field="subject"]'), 'channel and body replace email-only fields');
      require(calls.some(call=>call.method==='integrations.draft_save' && call.params.body.includes('週五')), 'owner edits persist through the existing versioned draft boundary');
      require(!calls.some(call=>call.method==='integrations.draft_send'), 'editing never sends');
    }
    if (name === 'voice-memo') {
      require(calls.some(call=>call.method==='agent.speak' && call.params.memo_action==='play') && calls.some(call=>call.method==='agent.speak' && call.params.memo_action==='pause'), 'Play and Pause use the existing read-aloud boundary');
      require(document.querySelector('.memo-transcript[open]')?.textContent.includes(data.chatMetadataSample.reply), 'expanded transcript is the member reply');
    }
    return {check:name};
  }
  if (name === 'calm-thread' || name === 'calm-thread-days') {
    const thread = document.querySelector('.tn[data-id="8101"]').parentElement;
    const days = thread.querySelectorAll('.day');
    const extras = [...thread.querySelectorAll('.sys,.task-actions,.timeline-event,.event-group')].filter(node => !node.closest('.work-body') && !node.parentElement.closest('.sys,.task-actions,.timeline-event,.event-group'));
    const count = {days:days.length, centredExtras:extras.length, verticalItems:days.length + extras.length + thread.querySelectorAll('.chat-message').length};
    require(days.length === (name === 'calm-thread-days' ? 2 : 1), `one divider per day: ${JSON.stringify(count)}`);
    require([...days].every(day => !/\d{2}:\d{2}/.test(day.textContent)), 'day dividers contain no clock');
    require(extras.length === 0, `no centred extras: ${JSON.stringify(count)}`);
    for (const id of [8101,8102]) {
      const turn = thread.querySelector(`[data-id="${id}"]`), reply = turn.querySelector('[data-reply="true"]');
      require(turn.textContent.split('Codex CLI 在回答完成前停止了。').length === 2, 'failure occurs once per turn');
      require(reply?.querySelector('.message-actions .rerun'), 'rerun belongs to the failed reply action row');
    }
    require(thread.querySelector('[data-id="8101"] .chat-message .routine-run-link')?.textContent.includes('NHK Easy News'), 'routine name belongs to the reply');
    require(getComputedStyle(thread.querySelector('[data-id="8102"] .message-actions:has(.rerun)')).opacity === '1', 'latest failed action is visible without hover');
    return {check:name,...count};
  }
  if (name === 'computer-header-layout') {
    const header = document.querySelector('.desktop-location-header');
    require(visible(header), 'the member panel header is visible');
    const selectors = ['.computer-lifecycle-state', '[data-computer-location]', '[data-computer-menu]'];
    const nodes = selectors.map(selector => header.querySelector(selector)).filter(node => visible(node) && (node.matches('button') || node.textContent.trim()));
    require(nodes.length === 3 && visible(document.querySelector('[data-det="gear"]')) && visible(document.querySelector('[data-det="close"]')), 'computer controls stay in their tab while gear and close remain available');
    const bounds = header.getBoundingClientRect(), boxes = nodes.map(node => node.getBoundingClientRect());
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      require(box.left >= bounds.left - 1 && box.right <= bounds.right + 1, 'every header control stays inside the panel');
      if (!i) continue;
      require(!!(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING), 'header order is state, location, overflow, gear, close');
      const before = boxes[i - 1];
      require(box.top >= before.bottom - 1 || box.left >= before.right - 1, 'header controls retain reading order without overlap');
    }
    return {check:name, controls:nodes.map(node => node.getAttribute('data-det') || node.className || node.textContent)};
  }
  if (name.startsWith('computer-maintenance-')) {
    const calls = window.__look.calls.filter(call => call.method === 'computer.lifecycle');
    if (name === 'computer-maintenance-menu') {
      const menu = document.querySelector('.menu');
      require(visible(menu) && menu.querySelectorAll('.mdesc').length === 6, 'each maintenance action explains preservation and removal');
      require([...menu.querySelectorAll('.mt')].slice(0,5).map(node=>node.textContent).join('/') === '稍候/重新啟動/更新/修復/重設', 'escalation order is fixed');
      require(!calls.length, 'opening the menu has no maintenance effect');
    } else if (name === 'computer-maintenance-reset') {
      require(visible(document.querySelector('.mb-confirm')) && document.querySelector('.mb-confirm').textContent.includes('成員共用'), 'reset names shared scope in the shared confirmation');
      require(!calls.length, 'reset has not been sent before yes');
    } else {
      const action = name === 'computer-maintenance-reset-done' ? 'reset' : name.split('-').at(-1);
      require(calls.length === 1 && calls[0].params.action === action && calls[0].params.target === 'synthetic-member' && calls[0].params.host === '', 'one action pins the captured computer');
      require(action !== 'reset' || calls[0].params.confirmed === true, 'reset carries explicit confirmation');
    }
    return {check:name};
  }
  if (name === 'computer-sleep-menu') {
    require([...document.querySelectorAll('.menu [data-value]')].map(node=>node.dataset.value).join(',') === '5,15,60,0', 'all four idle choices use the shared dropdown');
    return {check:name};
  }
  if (name.startsWith('computer-state-')) {
    // Since the panel tabs the header keeps a short word and the screen says the state once, with the member's face.
    const phase = name.slice('computer-state-'.length), status = document.querySelector('.computer-lifecycle-state'), panel = document.querySelector('.mb-det');
    const words = {sleeping:'電腦在休眠',waking:'正在喚醒',updating:'正在更新',repairing:'正在修復'};
    require(visible(status) && status.textContent.trim(), 'the header names the computer state in a short word');
    require(panel.textContent.includes(words[phase]), 'the screen says the computer state');
    require(panel.querySelector(`.desktop-boot-face svg.slime[data-state="${phase === 'sleeping' ? 'sleeping' : 'working'}"]`), 'the existing body state conveys sleeping or waking');
    return {check:name};
  }
  if (name === 'computer-low-disk') {
    const message = document.querySelector('.chat-message[data-reply="true"]');
    const text = message?.textContent ?? '';
    require(text.includes('downloads (200 MiB)') && text.includes('刪除前會先徵求你的同意'), 'conversation names largest folders and asks before deleting');
    require(visible(message) && message.scrollWidth <= message.clientWidth + 1, 'the full disk question wraps in a normal member message');
    require(!window.__look.calls.some(call => call.method === 'computer.lifecycle'), 'the disk warning performs no maintenance or deletion');
    return {check:name};
  }
  if (name === 'desktop-host-repair') {
    const repair = document.querySelector('[data-computer-host-repair]'), code = repair.querySelector('.message-code'), button = code.querySelector('[data-act="copy-code"]');
    const bounds = code.getBoundingClientRect(), dialog = repair.closest('[role="dialog"]').getBoundingClientRect();
    require(bounds.top >= dialog.top && bounds.bottom <= dialog.bottom && bounds.left >= dialog.left && bounds.right <= dialog.right, 'the entire command is readable after scrolling');
    require(code.querySelector('pre').scrollWidth <= code.clientWidth + 1, 'the command wraps at narrow widths');
    require(button.getAttribute('aria-label') === '已複製', 'the shared copy action completes inside Settings');
    return {check:name};
  }
  if (name === 'desktop-host-health') {
    const note = document.querySelector('[data-computer-host-health]');
    require(visible(note) && note.textContent.includes('正常'), 'each check has its own clear state');
    const repair = document.querySelector('[data-computer-host-repair]');
    require(visible(repair) && repair.textContent.includes('終端機') && repair.querySelector('code')?.textContent.includes('~/.zshenv'), 'host health says where to run the exact repair command');
    require(visible(repair.querySelector('[data-act="copy-code"]')), 'repair command uses the shared copy control');
    require(window.__look.calls.some(call => call.method === 'computer.viewer_status' && call.params.check_host && call.params.alias === 'studio-mini'), 'checks the selected alias through the existing owner RPC');
    return {check:name};
  }
  if (name === 'delete-member-computer') {
    const checkbox = document.querySelector('[data-remove-computer]');
    require(visible(checkbox) && checkbox.matches('.tg[role="switch"][aria-checked="false"]'), 'computer cleanup uses the shared switch and defaults to unchecked');
    require(checkbox.closest('.row').textContent.includes('小晴的電腦'), 'deletion names the member computer');
    require(!window.__look.calls.some(call => call.method === 'members.delete'), 'showing the option performs no deletion');
    return {check:name};
  }
  if (name === 'desktop-stream') {
    const frame = document.querySelector('iframe[data-desktop-stream]');
    require(visible(frame) && frame.contentDocument?.defaultView.__desktopConnections === 1, 'the existing viewer is connected before enlargement');
    window.__look.desktopStream = { frame, document: frame.contentDocument, opens: window.__look.calls.filter(call => call.method === 'computer.viewer_open').length, closes: window.__look.calls.filter(call => call.method === 'computer.viewer_close').length };
    return {check:name};
  }
  if (name === 'desktop-watch' || name === 'desktop-watch-collapse') {
    const panel = document.querySelector('.desktop-panel'), calls = window.__look.calls;
    require(!calls.some(call => call.method === 'computer.viewer_control'), 'watching never changes owner control');
    if (name === 'desktop-watch-collapse') {
      require(!panel.hasAttribute('data-expanded'), 'Esc returns to conversation');
      const before = window.__look.desktopStream, frame = document.querySelector('iframe[data-desktop-stream]');
      require(before && calls.filter(call => call.method === 'computer.viewer_open').length === before.opens && calls.filter(call => call.method === 'computer.viewer_close').length === before.closes && frame === before.frame && frame.contentDocument === before.document, 'collapse keeps the same stream without opening, closing or reloading');
    } else {
      require(document.documentElement.hasAttribute('data-desktop-watch'), 'watch mode is enlarged');
      const bounds = panel.getBoundingClientRect();
      require(Math.abs(bounds.right - innerWidth) <= 2 && bounds.left <= 2, 'the larger view fills the whole window, as in Grok Bot');
      require(getComputedStyle(document.querySelector('#nav')).visibility === 'hidden', 'the sidebar steps away under the larger view');
      const collapse = document.querySelector('.window-chrome > [data-desktop="collapse"]'), strip = document.querySelector('.window-chrome').getBoundingClientRect();
      require(visible(collapse) && collapse.getBoundingClientRect().bottom <= strip.bottom + 1 && collapse.getBoundingClientRect().right <= document.querySelector('.window-controls').getBoundingClientRect().left + 1, 'fold back sits beside the window buttons');
      const dock = panel.querySelector('.desktop-dock'), screenBox = panel.querySelector('.desktop-screen').getBoundingClientRect();
      require(visible(dock) && Math.abs((dock.getBoundingClientRect().left + dock.getBoundingClientRect().right) / 2 - innerWidth / 2) <= 2 && dock.getBoundingClientRect().top >= screenBox.bottom, 'one pill sits centred below the screen');
      require(Math.abs(screenBox.width / screenBox.height - 1280 / 900) < 0.03, 'the screen keeps its own proportions');
      require(dock.querySelector('.desktop-mode-label').textContent === (panel.dataset.desktopState === 'owner' ? '你正在操作' : '觀看中'), 'the pill says who holds the computer');
      if (name === 'desktop-watch' && window.__look.data.desktop.works?.some(work => work.state === 'running')) {
        const stop = panel.querySelector('[data-desktop="stop"]');
        require(visible(stop) && stop.title === stop.getAttribute('aria-label') && stop.title.trim(), 'Stop has its translated tooltip');
      }
      const frame = panel.querySelector('iframe');
      if (frame && visible(frame)) require(getComputedStyle(frame).pointerEvents === 'none', 'watch stays view-only');
    }
    return {check:name};
  }
  if (name === "owner-output-folder") {
    const input = document.querySelector('#owner-output-folder');
    const reference = document.querySelector('.owner-profile input.field');
    require(visible(input) && visible(reference), "General shows the output folder beside the existing owner fields");
    const control = input.closest('.field') ?? input;
    const box = control.getBoundingClientRect(), referenceBox = reference.getBoundingClientRect();
    const inset = input.getBoundingClientRect().left - box.left;
    require(Math.abs(box.height - referenceBox.height) <= 1, "the folder uses the same control height as the General owner field");
    require(inset >= 7, "the folder text retains the shared settings field inset");
    require(input.value === 'C:\\Owner\\Deliveries', "the saved output path remains visible");
    return { check: name, height: box.height, inset };
  }
  if (name.startsWith("skills-") || ["growing-skills", "member-shared-source", "skill-page"].includes(name)) {
    for (const label of document.querySelectorAll('[data-skill-provenance], .mp-resource p, .cs-item .ds, .cs-dialog > .cs-desc')) {
      const text = label.textContent.trim(), title = label.getAttribute('title') ?? '';
      require(!/^(learned|owner|imported)$/i.test(text) && !/(?:local:|github:|plugin:|[/\\]plugins[/\\]cache[/\\])/i.test(text + title), "R-SKILL-08: skill origins never show raw source values or plugin cache paths");
    }
  }
  if (name.startsWith("thread-window-")) {
    const pane = [...document.querySelectorAll('.mb-chat')].find(visible), scroll = pane?.querySelector('.ra-scroll');
    require(scroll, "the real conversation is open");
    const mounted = [...scroll.querySelectorAll('.tn[data-id], .tn[data-room-message]')];
    require(mounted.length <= 100, "no more than 100 turns are mounted");
    if (name === "thread-window-open") {
      require(mounted.length === 25, "only the newest 25 turns open");
      const quote = scroll.querySelector('button.message-quote, button.au-room-reply');
      require(quote, "the newest turn retains its actionable quote");
      const style = getComputedStyle(quote);
      require(style.borderTopWidth === "0px" && style.borderBottomWidth === "0px" && style.borderInlineEndWidth === "0px", "quote jumps retain the shared excerpt style without browser button borders");
    }
    if (name === "thread-window-earlier") {
      require(mounted.length === 45, "one earlier step mounts 20 more turns");
      const anchor = window.__windowAnchor;
      require(anchor.node.isConnected && Math.abs(anchor.node.getBoundingClientRect().top-anchor.top) <= 1, "the same reading anchor stays within one pixel");
    }
    if (name === "thread-window-find") {
      const mark = scroll.querySelector('mark.is-current'), turn = mark?.closest('[data-id], [data-room-message]');
      require(turn && (turn.dataset.id ?? turn.dataset.roomMessage) === "9005", "the old result is mounted before it is selected");
      require(visible(mark), "the selected result is visible");
    }
    if (name === "thread-window-quote") {
      const target = scroll.querySelector('.tn[data-id="9005"], .tn[data-room-message="9005"]');
      require(target && target.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top && target.getBoundingClientRect().top < scroll.getBoundingClientRect().bottom, "the unmounted quote source is revealed in the scrollport");
    }
    return {check:name,mounted:mounted.length,total:Number(scroll.dataset.windowTotal)};
  }
  if (["room-meeting", "room-meeting-board", "room-meeting-report"].includes(name)) {
    const pane = document.querySelector('.au-room-pane:not([hidden])');
    require(pane, "the real group conversation is open");
    const reports = [...pane.querySelectorAll('[data-room-report]')];
    require(reports.length === 1, "the completed task has one public report card");
    require(pane.querySelector('[data-room-act="private-work"][data-turn]'), "the report links to private work");
    require(!reports[0].querySelector('[data-owner-question], .permission-card'), "private approvals never enter the report");
    if (name === "room-meeting") require(pane.querySelectorAll('.au-room-thinking').length === 2, "two members can speak at once");
    const row = pane.querySelector('.room-meeting-row');
    require(visible(row) && !pane.querySelector('.ra-scroll').contains(row), "the compact work row is pinned outside the scrolling thread");
    const scroller = pane.querySelector('.ra-scroll'), beforeTop = scroller.scrollTop, rowTop = row.getBoundingClientRect().top;
    scroller.scrollTop += 100;
    require(row.getBoundingClientRect().top === rowTop, "the status row stays in place as the thread scrolls");
    scroller.scrollTop = beforeTop;
    require(row.textContent.includes('工作 1 · 決議 1'), "the row names work and decisions in the screen language");
    require(reports[0].querySelector('.team-file[data-room-act="artifact-open"]:not([disabled])'), "produced files use the shared actionable file chip");
    require(!reports[0].textContent.includes('fixture-repo') && !reports[0].querySelector('code,ul'), "the report never prints a digest or raw evidence list");
    if (name === "room-meeting-report") {
      reports[0].querySelector('[data-room-act="artifact-open"]').click();
      require(window.__look.openedTeamFile === 'task-artifact:42:501', "the file press reaches the native artifact resolver");
    }
    if (name === "room-meeting-board") {
      const board = document.querySelector('#app-popover [data-room-board]');
      require(board && board.textContent.includes('成果檢查') && board.textContent.includes('每個階段由一位成員負責'), "the board retains status and pinned decisions");
      require(board.querySelector('.room-board-member .card-status') && board.querySelector('.room-board-member .av'), "each member has their shared face and state pill");
      require(!board.querySelector('ul'), "pinned decisions are plain lines");
    }
    return {check:name,reports:reports.length};
  }
  if (name === "composio-readable-result") {
    const reply = [...document.querySelectorAll('.chat-message')].find(element => visible(element) && element.textContent.includes('Gmail'));
    require(reply && reply.textContent.includes('Gmail · 已完成：範例排程'), "the result names its app and localized outcome with useful fields");
    require(!reply.querySelector('.message-code') && !/tool_slug|successful|synthetic-hidden-value/.test(reply.textContent), "raw envelopes and hidden fields never enter the reply");
    return { check: name };
  }
  if (name === "permission-detail-label") {
    const labels = [...document.querySelectorAll('.permission-card .card-field > span:first-child')].filter(visible);
    require(labels.length > 0, "permission details expose real field labels");
    for (const label of labels) require(label.getBoundingClientRect().height <= parseFloat(getComputedStyle(label).lineHeight) + 1, "a detail label stays on one line at every viewport width");
    return { check: name, labels: labels.length };
  }
  if (["owner-question-pending", "owner-question-brought", "owner-question-pending-many"].includes(name)) {
    const host = [...document.querySelectorAll('.mb-chat')].find(element => visible(element.querySelector('.ra-scroll')) && element.querySelector('.pending-questions:not(.room-meeting-row)'));
    const row = host?.querySelector('.pending-questions:not(.room-meeting-row)'), scroll = host?.querySelector('.ra-scroll');
    require(host && scroll && row, "the open conversation owns the floating row");
    const cards = [...host.querySelectorAll('[data-owner-kind="ask_owner"][data-card-state="asked"]')];
    if (name === "owner-question-brought") {
      const call = window.__look.calls.find(call => call.method === 'owner_questions.bring');
      require(call, "one press calls the existing bring RPC");
      require(cards.some(card => visible(card) && card.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 2 && card.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top), "the moved card is at the newest visible turn");
      require(!visible(row), "the floating row disappears when its question is visible");
    } else {
      require(visible(row) && row.querySelectorAll('button').length === 1, "one compact row holds pending questions");
      require(row.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().top + 1, "the row sits above the scrollport");
      require(row.getBoundingClientRect().bottom < host.querySelector('.composer').getBoundingClientRect().top, "the floating row never covers the composer");
      if (name === "owner-question-pending-many") require(visible(document.querySelector('[role="menu"]')) && row.textContent.includes('2'), "a counted row opens the shared question list");
    }
    return { check: name, cards: cards.length };
  }
  if (name.startsWith("thread-new-divider")) {
    const scroller = document.querySelector('.mb-chat .ra-scroll');
    const divider = scroller.querySelector('.thread-new');
    if (name === "thread-new-divider-return") {
      require(!divider, "returning to a read thread has no divider");
      return { check: name };
    }
    if (name === "thread-new-divider-bottom" && !divider) {
      const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      require(Number(scroller.dataset.windowBefore) > 0 && Number(scroller.dataset.windowLater) === 0, "only the older window containing the boundary is unmounted");
      require(Number(scroller.dataset.windowMounted) <= 100 && bottom <= 2, "latest reveals a capped tail at the bottom");
      return {check:name,bottom,boundaryUnmounted:true};
    }
    require(divider && scroller.querySelectorAll('.thread-new').length === 1, "one independent divider is present");
    require(divider.nextElementSibling?.dataset.id === "7001", "the line precedes the first unseen turn");
    const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const top = divider.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (name === "thread-new-divider") require(top >= 0 && top <= 40 && bottom > 80, "a long run starts near the top");
    if (["thread-new-divider-short", "thread-new-divider-bottom"].includes(name)) require(bottom <= 2, "the thread opens or jumps to the bottom");
    if (name === "thread-new-divider-short") require(scroller.scrollHeight > scroller.clientHeight && top >= 0 && top < scroller.clientHeight, "seen history scrolls while the short unread run and its line fit");
    if (name === "thread-new-divider-snapshot") window.__unreadSnapshot = {
      divider, lines: [...scroller.querySelector('.thread').children].map(node => [node, node.innerHTML]),
      reads: window.__look.calls.filter(call => call.method === "members.read").length,
    };
    if (name === "thread-new-divider-stays") {
      const before = window.__unreadSnapshot;
      require(before.divider === divider, "the divider retains its identity");
      require(before.lines.every(([node, html]) => node.isConnected && node.innerHTML === html), "other lines retain their nodes and HTML");
      require(window.__look.calls.filter(call => call.method === "members.read").length === before.reads, "arrivals add no read per event");
    }
    require(getComputedStyle(divider, "::before").height === "1px", "the divider uses a hairline");
    require(getComputedStyle(divider).color === getComputedStyle(scroller.querySelector('.day')).color, "new and time labels share muted words");
    return { check: name, top, bottom };
  }
  if (name === 'desktop-own-wallpaper') {
    for (const image of [...document.querySelectorAll('.desktop-wallpaper[data-own]')].filter(visible)) {
      require(image.complete && image.naturalWidth > 0, 'the picture decoded');
      require(getComputedStyle(image).objectPosition === '50% 50%', 'the picture is centred as the guest zooms it');
      const pill = image.parentElement.querySelector('.desktop-preparation').getBoundingClientRect(), box = image.parentElement.getBoundingClientRect();
      require(pill.top >= box.top + box.height * 0.3 && pill.bottom <= box.bottom, 'the stage leaves the upper third of the picture clear');
    }
    return {check:name};
  }  if (name.startsWith('desktop-boot') || name.startsWith('desktop-period-')) {
    const panel = document.querySelector('.desktop-panel');
    const screen = name === 'desktop-boot-inline' ? document.querySelector('[data-card-desktop-screen], [data-card-screen]') : panel.querySelector('.desktop-screen');
    const preparation = screen.querySelector('.desktop-preparation');
    const wallpaper = screen.querySelector('.desktop-wallpaper');
    require(visible(preparation) && visible(wallpaper), 'the current stage stands on the full wallpaper');
    require(getComputedStyle(wallpaper).objectPosition === '50% 100%', 'the slimes at the bottom stay in view');
    require(getComputedStyle(wallpaper).opacity === '1' && getComputedStyle(screen.querySelector('.desktop-placeholder')).backgroundColor === 'rgba(0, 0, 0, 0)', 'only the small status pill dims the picture');
    const box = screen.getBoundingClientRect(), pill = preparation.getBoundingClientRect();
    require(pill.top >= box.top && pill.bottom <= box.bottom && pill.left >= box.left && pill.right <= box.right, 'the entire status pill fits inside the screen');
    require(!preparation.querySelector('ol, li, .spin, .desktop-build-progress'), 'one current stage replaces console details');
    require(visible(preparation.querySelector('.desktop-stage')), 'the current stage is readable');
    const face = preparation.querySelector('.av');
    require(visible(face), 'the member character is visible');
    require(Math.abs(face.getBoundingClientRect().width - (panel.hasAttribute('data-expanded') && name !== 'desktop-boot-inline' ? 96 : 64)) < 1, 'the character has its panel or expanded size');
    if (face.querySelector('img')) require([...face.querySelectorAll('img')].some(visible) && !face.querySelector('svg.slime'), 'Raphael keeps his emblem');
    else require(!!face.querySelector('svg.slime[data-state="working"]'), 'the member uses the shared working motion');
    require(!!preparation.querySelector('.desktop-first-build') === (panel.dataset.desktopState === 'building'), 'only a first build adds its quiet explanation');
    require(!preparation.querySelector('progress:not([value])'), 'no indeterminate progress line');
    if (!panel.hasAttribute('data-expanded') && name !== 'desktop-boot-inline') require(Math.abs(box.width / box.height - 1280 / 900) < .02, 'boot retains the running desktop aspect ratio');
    if (name.startsWith('desktop-period-')) require(wallpaper.getAttribute('src') === `/wallpapers/${name.slice('desktop-period-'.length)}.svg`, 'the fixed fixture hour selects its expected period');
    return {check:name};
  }
  if(name === "daily-newest") {require(document.querySelector('.conversation-caption').textContent==='Newest sample','the newest standard conversation opens');return {check:name};}
  if(name === "daily-copy") {const copied={"zh-TW":"已複製",en:"Copied",ja:"コピーしました"}[document.documentElement.lang];const tick=[...document.querySelectorAll('.thread button, .cn-setup-dialog button, .au-routine-dialog button')].find(el=>el.getAttribute('aria-label')===copied);require(tick&&tick.querySelector('svg'),'the pressed copy control displays its tick and copied name');require(tick.scrollWidth<=tick.clientWidth,'copied words fit in the fixed button width');return {check:name};}
  if(name === "daily-marks") {require(document.querySelectorAll('.sidebar-app-marks .mono').length===3,'three connected known apps show bare marks');return {check:name};}
  if(name === "daily-draft-member" || name === "daily-draft-room") {const input=document.querySelector(name.endsWith('room')?'#room-message':'.page-agent .mb-chat:not([hidden]) .cmp-input');require(input.value==='Unfinished sample draft','navigation restores this composer words');require(input.selectionStart===input.value.length,'caret returns to the end');return {check:name};}
  if (name === "group-live-line") {
    const row = document.querySelector('.au-room-thinking');
    require(visible(row?.querySelector('.live-action')), 'the working member has a visible action');
    require(row.querySelector('.live-action').textContent === '正在讀取 sample.md', 'tool words beat public progress in a group');
    require(row.querySelector('.av').getBoundingClientRect().width === 28, 'the group shares the 28px live face');
    return {check:name};
  }
  if (name.startsWith("presence-") || name.startsWith("transcript-") || name.startsWith("event-routine-") || name.startsWith("event-calendar-") || name === "event-lines-collapse" || name === "sidebar-row-time" || name === "sidebar-group-author") {
    const turn = document.querySelector('[data-id="651"]');
    if (name.startsWith("transcript-")) {
      require(!turn.querySelector('.ra-face, .me > .owner-face'), "private bubbles have no faces");
      const body = turn.querySelector(".ra-body");
      require(body.getBoundingClientRect().width > 200, "private replies use the content column, never the removed face column");
      require(![...turn.querySelectorAll('.work-toggle')].some(visible), "no default work chip");
    }
    if (name === "presence-states-sidebar") for (const [id, state] of [[1,"thinking"],[2,"working"],[3,"blocked"]]) require(document.querySelector(`[data-member="${id}"] .slime`)?.dataset.state === state, `sidebar member ${id} shows ${state}`);
    if (["presence-hover-action", "presence-sidebar-hover", "presence-rail-hover"].includes(name)) {
      const tips = [...document.querySelectorAll('[role="tooltip"]')].filter(visible);
      const nameFirst = name === "presence-rail-hover" && innerWidth >= 860;
      const member = window.__look.data.members.find(member => member.id === 1);
      require(tips.length === 1 && tips[0].textContent === `${nameFirst ? member.name + "\n" : ""}Comparing sample sources`, "one open tooltip follows the public action, with the rail name first");
      const box = tips[0].getBoundingClientRect(), chrome = document.querySelector('.window-chrome').getBoundingClientRect();
      require(box.left >= 8 && box.right <= innerWidth - 8 && box.top >= chrome.bottom + 8 && box.bottom <= innerHeight - 8, "the complete tooltip stays inside the viewport and clear of window controls");
      if (name === "presence-sidebar-hover" && innerWidth < 860) {
        const add = document.querySelector('[data-col="add"]'), control = add.getBoundingClientRect();
        require(control.top >= chrome.bottom && add.contains(document.elementFromPoint(control.x + control.width / 2, control.y + control.height / 2)), "the compact drawer add button stays below the chrome and receives pointer input");
      }
      if (name === "presence-hover-action") {
        const face = [...document.querySelectorAll('.mb-head .av')].find(visible), control = face.closest('button');
        require(box.top >= face.getBoundingClientRect().bottom + 6, "the header tooltip opens below the avatar");
        require(!document.documentElement.hasAttribute('data-keys') && getComputedStyle(control).outlineStyle === 'none', "pointer hover adds no keyboard focus ring");
        require(getComputedStyle(control).borderColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(control).boxShadow === 'none', "pointer hover adds no ring-like border or shadow");
      }
    }
    if (name === "presence-blocked-stays") require(document.querySelector('.mb-pill-face .slime')?.dataset.state === "blocked", "owner waiting remains blocked after refresh");
    if (name === "presence-waiting-colleague") require(document.querySelector('.mb-pill-face .slime')?.dataset.state === "waiting", "a colleague wait keeps its own silhouette");
    if (name === "transcript-working") {
      const live = turn.querySelector('.live-presence');
      require(visible(live) && live.querySelector('.av, .avatar').getBoundingClientRect().width === 28, "the live avatar is 28px");
      require(visible(live.querySelector('.live-action')), "the current action is visible beside the avatar");
      require(!turn.querySelector('.think, .work-time, .work-latest'), "no text dots or ticking line");
      require(live.dataset.tooltip === window.__look.data.presenceSample.progress, "public progress is the hover");
    }
    if (name === "transcript-hover-detail") {
      require(visible(turn.querySelector('.work-body')) && turn.querySelector('.work-body').textContent.includes("sample"), "hover action opens the same work detail");
      const controls = [...turn.querySelectorAll('.message-work')];
      require(controls.length === 2 && controls.every(control => control.getAttribute('aria-expanded') === 'true'), "both reply controls reflect the same expanded work detail");
    }
    if (name === "transcript-action-long") {
      const line = turn.querySelector('.live-action'), live = line.closest('.live-presence');
      require(visible(line) && getComputedStyle(line).whiteSpace === 'nowrap' && getComputedStyle(line).textOverflow === 'ellipsis', 'one action stays on one line');
      require(live.dataset.tooltip === line.textContent && line.textContent.startsWith('正在搜尋範例'), 'hover keeps the whole action');
      if (innerWidth <= 720) require(line.scrollWidth > line.clientWidth, 'a long line really ellipsizes at 720px');
      require(!turn.querySelector('.work-time, .work-latest, .think'), 'the action has no timer or text dots');
    }
    if (["transcript-action-list", "transcript-old-list"].includes(name)) {
      const body = turn.querySelector('.work-body');
      require(visible(body) && body.querySelectorAll('.work-sentences > li').length >= 2, 'the icon opens past action sentences');
      require(!body.querySelector('.step-mark, .step-ms'), 'rows have no ticks or per-row duration');
      require(!/local|NOTION_|COMPOSIO_/.test(body.textContent), 'old and new turns hide tool identifiers');
      require([...turn.querySelectorAll('.message-work')].every(button=>button.textContent === '' && button.dataset.tooltip.startsWith('查看過程')), 'process controls match adjacent icon buttons');
      require(body.lastElementChild.classList.contains('work-meta'), 'model and cost stay at the bottom');
    }
    if (name === "transcript-time-gap") require([...turn.parentElement.children].filter(line => line.classList.contains('day')).length === 1, "hour gaps within one day have one date separator");
    if (name === "event-routine-line") {
      require(turn.querySelector('.work-body[hidden] [data-routine="2"]') && !visible(turn.querySelector('[data-routine="2"]')), "the routine receipt is in closed reply detail");
      require(!turn.querySelector('.ra-body > .timeline-event'), "no separate event row interrupts the conversation");
    }
    if (name === "event-routine-spacing") {
      require(!turn.querySelector('.ra-body > .timeline-event,.ra-body > .event-group'), 'receipts add no rows between replies and cards');
      require(turn.querySelector('.work-body[hidden] .timeline-event'), 'the full receipt remains available in collapsed detail');
    }
    if (name === "event-routine-opens") require(visible(document.querySelector('.au-routine-dialog')) && document.querySelector('#au-title')?.value === window.__look.data.presenceSample.routine, "the named routine opens");
    if (name === "event-routine-find") {
      require(turn.querySelector('.event-line mark')?.textContent === window.__look.data.presenceSample.routine, "find marks the public receipt title");
      require(!turn.textContent.includes('"type"') && !turn.textContent.includes('"created"'), "transport metadata stays out of thread selection");
    }
    if (name === "event-routine-find-group") require(turn.querySelector('[data-event-group]')?.open && visible(turn.querySelector('.handoff-detail mark.is-current')), "the selected receipt is visible in the retained open group");
    if (name === "event-calendar-line") require(turn.querySelector('.work-body[hidden] [data-act="open-calendar-event"][data-event="1"][data-date="2026-10-24"]'), "the collapsed calendar receipt keeps its inspection target");
    if (name === "event-calendar-opens") require(visible(document.querySelector('.au-pop-detail')) && document.querySelector('.au-pop-detail h2')?.textContent === window.__look.data.presenceSample.calendar, "the named calendar event detail opens");
    if (name === "event-lines-collapse") {
      const group = turn.querySelector('[data-event-group]');
      require(group?.open && turn.querySelectorAll('[data-event-group] [data-routine="2"]').length === 3, "every receipt stays in the open group");
      require(visible(group.closest('.work-body')) && !turn.querySelector('.ra-body > .event-group'), 'the opened receipt group stays in reply detail without adding a transcript row');
    }
    if (name === "sidebar-row-time") {
      const row = document.querySelector('.side [data-member="1"]');
      require(!row.querySelector('.mb-row-t i') && !row.querySelector('time'), "the name and one line, without a role pill or a time, as Grok Bot's rows");
      require(!visible(row.parentElement.querySelector('.mb-more')), "no ⋯ shows under the pointer: a right click opens the row's menu, as Grok Bot's");
      const pair = [...document.querySelectorAll('.side .mb-item')].find(item => visible(item) && item.nextElementSibling?.matches('.mb-item') && !item.querySelector('.mb-tile'));
      const rows = pair ? [pair, pair.nextElementSibling].map(item => item.querySelector('.nav.mb-row').getBoundingClientRect()) : [];
      require(rows.length < 2 || (Math.abs(rows[0].height - 54) <= 1 && Math.abs(rows[1].top - rows[0].top - 58) <= 1), `rows are 54 px tall and 58 px apart, as Grok Bot's (${rows.map(box => Math.round(box.top) + '/' + Math.round(box.height)).join(' ')})`);
    }
    if (name === "sidebar-group-author") require([...document.querySelectorAll('.au-room-row .mb-row-p')].some(line => line.textContent.startsWith(`${window.__look.data.members.find(m => m.id === 1).name}：`)), "group preview starts with its author");
    return { check: name };
  }
  if (name.startsWith('level-')) {
    const panel = document.querySelector('.mb-det'), desktop = panel.querySelector('.desktop-panel');
    const calls = window.__look.calls;
    if (name === 'level-start-before' || name === 'level-start-after') {
      const widths = [panel.getBoundingClientRect().width, desktop.querySelector('.desktop-screen').getBoundingClientRect().width];
      if (name === 'level-start-before') window.__look.desktopWidths = widths;
      else require(widths.every((width, index) => Math.abs(width - window.__look.desktopWidths[index]) < 1), 'starting the computer preserves panel and screen widths');
    } else if (name.startsWith('level-status-')) {
      // No computer button in the header since 2026-11-06 (as Grok Bot's): a still dot beside the name says the computer works.
      const trigger = document.querySelector('.mb-chat .conversation-trigger'), active = name.endsWith('active');
      require(!document.querySelector('.mb-head [data-act="computer"]'), 'the header has no computer button');
      require(visible(trigger) && trigger.classList.contains('is-computer-active') === active, 'the name reflects running status');
      const dot = getComputedStyle(trigger.querySelector('.mb-pill'), '::after');
      if (active) {
        require(dot.content !== 'none' && parseFloat(dot.width) === 8 && dot.backgroundColor !== 'rgba(0, 0, 0, 0)' && dot.animationName === 'none', 'one still purple dot follows the name');
        require(trigger.getAttribute('aria-label').includes(' · ') && trigger.title.includes(' · '), 'the name says the computer is working, to a screen reader and on hover');
      } else require(dot.content === 'none' || dot.content === 'normal', 'an idle computer adds nothing to the name');
    } else if (name === 'level-panel' || name === 'level-off' || name === 'level-no-computer') {
      // Since the panel tabs the computer has its own tab, headed by its state and shared location control.
      require(panel.dataset.detailsTab === 'computer' && visible(panel.querySelector('[data-computer-location]')), 'the computer tab keeps its state header and shared location control');
      require(!panel.querySelector('[data-tab="routines"], .mb-rt [role="switch"], [data-desktop="expand"]') && !visible(panel.querySelector('[data-desktop="collapse"]')), 'there is no routines page, row switch or visible collapse control');
      if (name !== 'level-no-computer') require(visible(desktop) && visible(desktop.querySelector('.desktop-screen')), 'the computer tab shows the screen');
      if (name === 'level-off') require(visible(desktop.querySelector('.desktop-wallpaper')) && visible(desktop.querySelector('.desktop-screen [data-desktop="retry"]')) && !desktop.querySelector('iframe'), 'wallpaper and Start share the quiet screen');
    } else if (name === 'level-gear') {
      require(visible(panel.querySelector('.mb-who')) && visible(panel.querySelector('#mb-det-name')) && visible(panel.querySelector('[data-det="back"]')), 'identity and Back are available through the gear');
      require(!visible(desktop) && !panel.querySelector('[data-tab="routines"]'), 'settings has no separate computer or routines page');
    } else if (name === 'level-routine') {
      require(visible(document.querySelector('.au-routine-dialog [data-dlg="enabled"]')), 'pausing belongs inside the routine');
    } else if (name === 'level-strip') {
      const strip = document.querySelector('.window-chrome'), stripStyle = getComputedStyle(strip);
      require(strip.getBoundingClientRect().left === 0 && stripStyle.borderTopLeftRadius === '0px' && stripStyle.backgroundColor === getComputedStyle(panel).backgroundColor, 'the window strip reads as one surface with the bar');
    } else if (name === 'level-takeover' || name === 'level-menu') {
      const frame = desktop.querySelector('iframe'), dock = desktop.querySelector('.desktop-dock');
      require(desktop.hasAttribute('data-expanded') && visible(frame) && visible(dock), 'the same stream fills the window above its one pill');
      require(dock.textContent.includes('你正在操作') && visible(dock.querySelector('[data-desktop="return"]')), 'the pill says the owner is in control and offers handback');
      const box = frame.getBoundingClientRect();
      require(Math.abs(box.width / box.height - 1280 / 900) < 0.03 && (box.width >= innerWidth - 96 || box.height >= innerHeight - 160), 'the screen fills the window at its own proportions');
      require(!document.querySelector('[data-sidebar="open"]')?.checkVisibility({visibilityProperty:true}), 'takeover leaves no sidebar entry above its bar');
      const current = calls.findLast(call => call.method === 'computer.viewer_open').params.member_id;
      require(calls.filter(call => call.method === 'computer.viewer_open' && call.params.member_id === current).length === 1 && frame.contentWindow.__desktopConnections === 1, 'takeover opens no additional stream');
      if (name === 'level-menu') require(visible(document.querySelector('#app-popover [data-pick="files"]')) && visible(document.querySelector('#app-popover [data-pick="teach"]')), 'the shared menu holds files and teaching');
    } else if (name === 'level-reopen') {
      const frame = desktop.querySelector('iframe'), current = calls.findLast(call => call.method === 'computer.viewer_open').params.member_id;
      require(desktop.hasAttribute('data-expanded') && desktop.dataset.interactive === 'true' && frame.contentWindow.__desktopConnections === 1, 'a fresh connected stream accepts the new takeover');
      require(calls.filter(call => call.method === 'computer.viewer_open' && call.params.member_id === current).length === 2, 'reopening creates exactly one fresh member stream');
    } else if (name.startsWith('level-handback')) {
      require(!desktop.hasAttribute('data-expanded') && visible(document.querySelector('.composer')), 'handback returns to the conversation');
      if (innerWidth < 1440) require(document.querySelector('.conversation-trigger').getAttribute('aria-expanded') === 'false', 'handback closes the compact preview');
      require(calls.filter(call => call.method === 'computer.viewer_control' && !call.params.held).length === (name.endsWith('second') ? 2 : 1) && calls.some(call => call.method === 'computer.viewer_close'), 'each handback releases once and closes the stream');
    }
    return {check: name};
  }
  if (name.startsWith("card-connect-ended:")) {
    const status = document.querySelector('[data-connector="card-slack"] [data-card-status-text]');
    require(visible(status) && status.textContent === name.split(":")[1], `the pill names how the card ended: ${status?.textContent}`);
    return { check: name };
  }
  if (name === "menu-scroll-closed") {
    require(!document.querySelector('#app-popover, #app-submenu'), "outside scroll input or resizing closes every menu level");
    return { check: name };
  }
  if (name === "menu-hide-control") {
    const hide = document.querySelector('[data-det="hide"]');
    require(visible(hide) && hide.querySelectorAll('svg').length === 1, "Hide has only its action icon");
    const box = hide.getBoundingClientRect();
    require(box.top >= 0 && box.bottom <= innerHeight, `the action under review is inside the screenshot (${box.top}, ${box.bottom}; height ${innerHeight})`);
    return { check: name };
  }
  if (name === "menu-anchor-return") {
    const menu = document.getElementById('app-popover'), anchor = document.querySelector('.mb-col [data-member-more="1"]');
    require(visible(menu), "the real more-button press keeps its menu open");
    const box = menu.getBoundingClientRect(), control = anchor.getBoundingClientRect();
    require(Math.abs(box.right - control.right) <= 1 && Math.abs(box.top - control.bottom - 4) <= 1, "a fresh press returns the menu beneath its own control");
    return { check: name };
  }
  if (name === "menu-settings-redraw") {
    const anchor = document.querySelector('.sel[data-k="local-commands"]'), menu = document.getElementById('app-popover');
    require(visible(menu) && anchor.getAttribute('aria-expanded') === 'true', "the replacement control keeps its open menu");
    require(menu.querySelector('[data-value="never"][aria-checked="true"]'), "the refreshed choice keeps its check");
    return { check: name };
  }
  if (name === "submenu-placement" || name === "submenu-flip") {
    const parent = document.getElementById('app-popover'), child = document.getElementById('app-submenu');
    require(visible(parent) && visible(child), "both menu levels stay open");
    const row = parent.querySelector('[aria-haspopup="menu"][aria-expanded="true"]');
    require(row && row.getAttribute('aria-controls') === child.id, "the parent row declares its open child");
    const box = child.getBoundingClientRect(), main = parent.getBoundingClientRect(), anchor = row.getBoundingClientRect(), first = child.querySelector('button').getBoundingClientRect();
    require(Math.abs(first.top - anchor.top) <= 4, "the submenu's first row aligns with its parent row");
    require(Math.min(Math.abs(box.left - main.right), Math.abs(box.right - main.left)) <= 1, "the submenu touches a side of its parent");
    require(box.left >= 7 && box.right <= innerWidth - 7 && box.top >= 7 && box.bottom <= innerHeight - 7, "the submenu stays inside the window");
    require(getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)', "the parent row stays highlighted");
    require(child.querySelector('[aria-checked="true"]'), "the current group keeps its check");
    if (name === "submenu-flip" && innerWidth === 720) require(box.right <= main.left + 1, "the compact submenu flips left");
    return { check: name, side: box.left >= main.right - 1 ? "right" : "left", rowTop: anchor.top, firstTop: first.top };
  }
  if (name === "menu-move-picked") {
    require(!document.querySelector('#app-popover, #app-submenu'), "choosing closes both menu levels");
    require(window.__look.data.members.find(member => member.id === 1).group_id === 2, "the selected member moves to the chosen group");
    require(window.__look.calls.some(call => call.method === 'members.update' && call.params?.id === 1 && call.params?.group_id === 2), "the choice reaches the existing core boundary");
    return { check: name };
  }
  const disclosureContent = card => {
    const words = (root, excluded) => {
      const walker = document.createTreeWalker(root, 4), parts = [];
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (!parent || excluded?.contains(parent) || parent.closest('[hidden]') || !visible(parent)) continue;
        const closed = parent.closest('details:not([open])');
        if (closed && !parent.closest('summary')) continue;
        const text = node.textContent.trim().replace(/\s+/g, ' ');
        if (text) parts.push(text);
      }
      return parts;
    };
    for (const button of card.querySelectorAll('[data-card-disclosure]')) {
      if (button.closest('[hidden]')) continue;
      const detail = button.parentElement.querySelector('.card-detail');
      require(detail, 'a disclosure has content');
      const before = words(card, detail).join(' '), hidden = detail.hidden;
      try {
        detail.hidden = false;
        require(words(detail).some(text => !before.includes(text)), 'an opened disclosure adds visible text');
      } finally { detail.hidden = hidden; }
    }
  };
  if (name === 'card-disclosures') {
    for (const card of [...document.querySelectorAll('.conversation-card')].filter(visible)) disclosureContent(card);
    return {check:name};
  }
  if (name.startsWith("form-")) {
    const scope = document.querySelector('.page-agent:not([hidden]) > .mb-chat:not([hidden])');
    require(scope, 'form checks target the active conversation');
    const cards = [...scope.querySelectorAll('.message-forecast,.message-board,.message-chart')];
    if (name === "form-invalid" || name === "form-truncated") {
      require(!cards.length && scope.querySelector('.message-code pre')?.textContent.includes('{'), 'invalid and truncated JSON stays readable code');
    } else if (name === "form-streaming") {
      require(visible(scope.querySelector('.answer-form-pending')) && !scope.querySelector('.message-code') && !scope.textContent.includes('{"'), 'a form still arriving shows no JSON');
    } else {
      require(cards.length === (name === "form-room" ? 3 : 1), 'each valid form renders once in the reply');
      for (const card of cards) {
        require(!card.closest('.ans,.bubble'), 'forms are sibling timeline blocks');
        require(card.querySelector('button[data-rich-act="copy-source"]'), 'the shared copy button is present');
        require(!card.querySelector('script,img,iframe,[onerror],[src]'), 'form data cannot load or execute content');
        for (const node of card.querySelectorAll('.board-card,.forecast-day,.chart-legend')) require(node.scrollWidth <= node.clientWidth + 1, 'content wraps within its card');
        if (card.matches('.message-chart')) require(card.querySelectorAll('circle title,rect title').length >= 6, 'every plotted value has readable hover text');
      }
      if (name === "form-forecast") {
        require(cards[0].querySelectorAll('.forecast-day').length === 7, 'seven known days fit without a panel scrollbar');
        require(cards[0].querySelector('[aria-current="date"]'), 'today is marked in the forecast');
        require([...cards[0].querySelectorAll('.forecast-day > strong')].every(day => !/^\d{4}-/.test(day.textContent)), 'forecast column dates stay short, with the full date in a title');
      }
      if (name === "form-board") require(cards[0].querySelectorAll('.board-column').length === 5, 'five board columns wrap without dragging');
    }
    return { check: name, cards: cards.length };
  }
  if (name === "conversation-day-today" || name === "conversation-day-yesterday") {
    const days = [...document.querySelectorAll('.mb-chat .thread .day')], line = document.querySelector('.mb-chat .thread .tn');
    const label = name === "conversation-day-today" ? "今天" : "昨天";
    // The calm thread's divider is the bare word; older dividers added the date after it.
    const heading = days.at(-1)?.textContent.trim() ?? "";
    require(heading === label || heading.startsWith(`${label} `), `the last day heading says ${label} with the shared look clock`);
    if (name === "conversation-day-today") window.__look.midnightLine = line;
    else require(line === window.__look.midnightLine, "the date change retains the conversation line");
    return { check: name, label };
  }
  if (name.startsWith('moving-')) {
    if (name === 'moving-event-created' || name === 'moving-event-created-calendar') {
      const reads=window.__look.calls.filter(c=>c.method==='routines.list' && c.params.event);
      const created=window.__look.calls.filter(c=>c.method==='routines.create');
      require(reads.length===1 && created.length===1, 'one event read precedes one create');
      const calendar=name==='moving-event-created-calendar', event=created[0].params.when.event;
      require(event.items===`data.results.0.response.data.${calendar ? 'items' : 'messages'}` && created[0].params.when.filter.field==='', 'the detected ordinary condition is saved');
      const args=event.arguments.tools[0].arguments;
      if(calendar) require(event.since?.arg==='updatedMin' && event.since.format==='iso' && args.maxResults===50 && !('updatedMin' in args), 'Calendar preserves its moving window without a frozen timestamp');
      else require(args.max_results===20 && args.include_payload===false && args.verbose===false && event.id==='messageId', 'Gmail preserves its small read and observed identity');
      require(!document.querySelector('.au-routine-dialog'), 'successful save closes the editor');
      return {check:name};
    }
    if (name === 'moving-monthly-calendar') {
      require(visible(document.querySelector('[data-month-day="2026-11-30"] .is-routine')), 'date 31 clamps to November 30');
      return {check:name};
    }
    if (name === 'moving-minutes-calendar') {
      require(document.querySelectorAll('.au-all-day-row .is-rhythm').length === 1 && !document.querySelector('.au-occurrence'), 'minute work is one rhythm, without a grid full of runs');
      return {check:name};
    }
    if (name === 'moving-offer') {
      require(visible(document.querySelector('.mb-offer-t .routine-sentence strong')), 'suggested work shares the weighted trigger');
      return {check:name};
    }
    const form = document.querySelector('.au-routine-dialog');
    if (name === 'moving-sentence') {
      const line = document.querySelector('button[data-act="open-routine"]');
      require(visible(line) && line.closest('.chat-message .routine-origin') && line.textContent.trim(), 'the routine name is a real button inside its reply');
      return {check:name};
    }
    require(visible(form) && visible(form.querySelector('[data-dlg="trigger"]')), 'all triggers share the existing editor');
    if (name === 'moving-monthly') require(form.querySelector('#au-month-day')?.value === '31', 'the owner chooses a monthly date');
    if (name === 'moving-minutes') require(form.querySelector('[data-dlg="hours"]')?.textContent.includes('30'), 'the ordinary interval menu offers minutes');
    if (name.startsWith('moving-event')) {
      if (name==='moving-event-none') require(form.querySelector('[data-dlg="save"]')?.disabled && visible(form.querySelector('[data-missing-repair="connections"]')), 'no connected app has a settings entry');
      else if (name==='moving-event-undetectable') require(form.querySelector('[data-dlg="save"]')?.disabled && visible(form.querySelector('[role="alert"]')) && visible(form.querySelector('[data-dlg="event-check"]')), 'failed detection retains choice and retry');
      else if (name==='moving-event-input') {
        require(visible(form.querySelector('#au-event-value')) && !form.querySelector('#au-event-value').hasAttribute('pattern'), 'repository or channel uses plain input');
        const input=form.querySelector('#au-event-value'), box=input.getBoundingClientRect();
        const button=form.querySelector('[data-dlg="event-check"]').getBoundingClientRect();
        const label=document.createRange(); label.selectNodeContents(input.parentElement); label.setEndBefore(input);
        require(Math.abs(box.height-button.height)<=1, 'event scope and check share the control height');
        require(label.getBoundingClientRect().bottom<=box.top, 'event scope label stays above its input');
        require(Math.abs(box.bottom-button.bottom)<=1, 'event scope and check share a baseline');
      }
      else require(!form.querySelector('[data-dlg="save"]')?.disabled, 'a detected event can be saved');
      require(!form.textContent.includes('data.results') && !form.textContent.includes('tool_slug'), 'the owner sees no tool paths');
    }
    if (name.startsWith('moving-webhook')) {
      require(form.textContent.includes('127.0.0.1') && form.textContent.includes('HMAC-SHA256'), 'the details explain signed local deliveries');
      require(form.querySelector('.au-hook-secret')?.type === (name.endsWith('reveal') ? 'text' : 'password'), 'a secret is masked until requested');
      require(form.querySelector('.routine-sentence strong') && form.querySelector('.routine-object')?.textContent.includes('POST'), 'webhook uses the shared sentence');
      if (name==='moving-webhook-changed') require(visible(form.querySelector('[role="status"]')), 'a replacement address is explained');
    }
    return {check:name};
  }
  const rhythmTitle = (bar, timingAllowed) => {
    const title=bar.querySelector('b'), copy=bar.querySelector('.cal-chip-copy'), timing=bar.querySelector('small');
    require(title?.textContent==='Gmail 與行程檢查','the rhythm fixture exercises a long title');
    require(title.getBoundingClientRect().width>=Math.min(title.scrollWidth,copy.clientWidth)-1,'the rhythm title gets all the width it can use before timing');
    if(!timingAllowed) require(!timing && bar.querySelector('.av'),'month and Home keep only the face and title');
    else {
      require(timing,'day and week retain optional full timing');
      const shown=getComputedStyle(timing).visibility!=='hidden';
      require(!shown || timing.scrollWidth<=timing.clientWidth,'timing is whole or hidden, never truncated');
      if(copy.clientWidth>=title.scrollWidth+timing.scrollWidth+1) require(shown,'timing appears when the full title and timing fit');
    }
  };
  if (name.startsWith('calendar-remember') || name.startsWith('calendar-view-')) {
    const calendar=document.querySelector('.au-page:not([hidden])'), month=calendar?.querySelector('.au-month-view');
    const state={title:calendar?.querySelector('.au-toolbar h1')?.textContent,month:!!month,first:calendar?.querySelector('[data-month-day]')?.dataset.monthDay};
    require(state.month,'the chosen month view remains active');
    for(const more of [...month.querySelectorAll('.cal-more')].filter(visible)) require(more.scrollWidth<=more.clientWidth+1,'the month overflow count fits its button');
    for(const interval of [...month.querySelectorAll('.is-rhythm small')].filter(visible)) {
      const box=interval.getBoundingClientRect(), copy=interval.closest('.cal-chip-copy').getBoundingClientRect();
      require(interval.scrollWidth<=interval.clientWidth+1 && box.left>=copy.left-1 && box.right<=copy.right+1,'the whole month interval stays inside its chip');
    }
    if(name==='calendar-remember-save') window.__look.calendarRemember=state;
    if(name==='calendar-remember-return') require(JSON.stringify(state)===JSON.stringify(window.__look.calendarRemember),'returning from Home or a conversation keeps the same date and view');
    if(name==='calendar-view-stored' || name==='calendar-view-reload') require(localStorage.getItem('raphael.calendar.view')==='month','the view is a stored preference');
    if(name==='calendar-view-reload') {
      const today=new Date(), key=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      require(month.querySelector(`[data-month-day="${key}"][aria-current="date"]`),'a fresh launch starts on today with the stored view');
      require(calendar.querySelector('.au-calendar-side [aria-pressed="true"]')?.dataset.miniDate===key,'the previous launch date is not persisted');
    }
    return {check:name,...state};
  }
  if(name==='calendar-week-fit') {
    const main=document.querySelector('.au-page:not([hidden]) .au-calendar-main'), columns=[...main.querySelectorAll('.au-day-col')];
    const expected=main.clientWidth>=520?7:Math.max(1,Math.min(3,Math.floor((main.clientWidth-52)/100)));
    require(columns.length===expected,`${expected} days fit the actual calendar width ${main.clientWidth}`);
    const slots=[...main.querySelectorAll('[data-all-day]')];
    for(let i=0;i<columns.length;i++) {
      const a=columns[i].getBoundingClientRect(), b=slots[i].getBoundingClientRect();
      require(Math.abs(a.left-b.left)<1 && Math.abs(a.right-b.right)<1,'all-day slots line up with the hour columns');
    }
    const bars=[...main.querySelectorAll('.au-bar')];
    require(bars.some(bar=>bar.querySelector('.is-rhythm')) && bars.some(bar=>bar.querySelector('.is-own')),'rhythm and real all-day bars are both present');
    for(const bar of bars) {
      const first=Number(bar.style.gridColumnStart)-2, span=Number(bar.style.gridColumnEnd.replace('span','').trim());
      const a=columns[first].getBoundingClientRect(), b=columns[first+span-1].getBoundingClientRect(), box=bar.getBoundingClientRect();
      require(Math.abs(box.left-a.left-2)<1 && Math.abs(box.right-b.right+3)<1,'each bar spans its exact day columns');
    }
    if(expected<7) {
      const heading=main.closest('.au-page').querySelector('h1'), title=heading.textContent;
      require(title.includes(String(Number(columns[0].dataset.day.slice(-2)))) && title.includes(String(Number(columns.at(-1).dataset.day.slice(-2)))),'the fallback title names its actual dates');
      require(heading.scrollWidth<=heading.clientWidth+1,'the narrow date range title stays readable');
    }
    return {check:name,days:columns.length,width:main.clientWidth};
  }
  if(name.startsWith('calendar-nav-')) {
    const group=document.querySelector('.au-page:not([hidden]) .au-date-nav'), buttons=[...group.querySelectorAll('button')], today=group.querySelector('[data-au="today"]');
    require(buttons.map(button=>button.dataset.au).join(',')==='prev,today,next','the quiet control is previous, today, next at every width');
    const boxes=buttons.map(button=>{const box=button.getBoundingClientRect();return [box.x,box.y,box.width,box.height];});
    require(buttons.every(button=>parseFloat(getComputedStyle(button).borderTopWidth)===0),'date navigation has no border at rest');
    if(name==='calendar-nav-away') { require(!today.disabled,'today is available away from its range'); window.__look.calendarNavigation=boxes; }
    if(name==='calendar-nav-hover') {
      const probe=document.createElement('span');probe.style.color='var(--hover)';group.append(probe);
      const color=getComputedStyle(probe).color;probe.remove();
      require(getComputedStyle(today).backgroundColor===color,'today uses the shared hover surface');
    }
    if(name==='calendar-nav-today') {
      require(today.disabled && Number(getComputedStyle(today).opacity)<1,'today dims when this view already holds it');
      require(boxes.every((box,i)=>box.every((value,j)=>Math.abs(value-window.__look.calendarNavigation[i][j])<.5)),'dimming today never moves the controls');
    }
    return {check:name,boxes};
  }
  if (name.startsWith("calendar-rhythm") && name!=="calendar-rhythm-hidden") {
    const month=!!document.querySelector('.au-month-view');
    const bars=[...document.querySelectorAll('.au-page:not([hidden]) .is-rhythm')];
    require(bars.length>0,"the rhythm has a quiet bar");
    require(!document.querySelector('.au-day-col .cal-chip[data-entry^="routine:91:"]:not([data-status])'),"ordinary rhythm occurrences never fill the hours");
    require(!bars.some(bar=>bar.querySelector('time')),"a rhythm never has a clock");
    for(const bar of bars.filter(visible)) rhythmTitle(bar,!month);
    for (const mark of document.querySelectorAll('.au-page:not([hidden]) .cal-run-mark')) {
      const chip=mark.closest('.cal-chip');
      require(!chip.classList.contains('is-past') && Number(getComputedStyle(chip).opacity)===1,"failed and waiting runs never fade as past work");
    }
    if (month) for (const cell of document.querySelectorAll('.au-month-cell')) require(cell.querySelectorAll('.is-rhythm').length<=1,"at most one rhythm line per day");
    else require(document.querySelector('.au-all-day-row .is-rhythm .av'),"the bar keeps its member face");
    require(document.querySelector('.au-page .cal-chip[data-entry^="routine:91:"][data-status="error"]'),"the failure keeps its timed chip");
    require(document.querySelector('.au-page .cal-chip[data-entry^="routine:91:"] .cal-run-mark[data-status="confirm"]'),"the waiting run keeps its timed chip");
    require(document.querySelector('.au-page .cal-chip[data-entry^="routine:92:"] time'),"the daily routine remains a timed chip");
    if (name==="calendar-rhythm-popover") {
      const panel=document.querySelector('.au-pop-detail');
      require(visible(panel) && panel.querySelectorAll('[data-rhythm-time]').length===6,"today's six runs share the existing popover");
      for (const state of ['done','error','confirm','coming']) require(panel.querySelector(`[data-status="${state}"] .i`),`${state} has an icon`);
      require(panel.querySelector('[data-pop="open-routine"]') && panel.querySelector('[data-pop="off"]'),"edit and off are in the detail");
      const edit=panel.querySelector('[data-pop="open-routine"]'), off=panel.querySelector('[data-pop="off"]');
      const a=edit.getBoundingClientRect(), b=off.getBoundingClientRect(), x=edit.querySelector('span').getBoundingClientRect(), y=off.querySelector('span').getBoundingClientRect();
      require(Math.abs(a.top-b.top)<.5 && Math.abs(a.height-b.height)<.5 && Math.abs(x.top-y.top)<.5 && Math.abs(x.bottom-y.bottom)<.5,"edit and off share one row height and text baseline");
      const box=panel.getBoundingClientRect();require(box.bottom<=innerHeight && panel.scrollHeight<=panel.clientHeight+1,"the popover fits without an inner scroll");
    }
    return {check:name,bars:bars.length,month};
  }
  if (name==="calendar-rhythm-hidden") {
    require(!document.querySelector('.au-page:not([hidden]) .is-rhythm') && !document.querySelector('.au-page:not([hidden]) [data-entry^="routine:91:"]'),"one member checkbox hides bar and exception chips together");
    return {check:name};
  }
  if (name==="home-calendar-rhythm") {
    const bar=[...document.querySelectorAll('.ho-calendar .is-rhythm')].find(visible);
    require(visible(bar) && !bar.querySelector('time'),"Home draws the same quiet rhythm");
    rhythmTitle(bar,false);
    for (const mark of document.querySelectorAll('.ho-calendar .cal-run-mark')) require(!mark.closest('.cal-chip').classList.contains('is-past'),"Home exceptions never carry is-past");
    return {check:name};
  }
  if (name==="calendar-google-composio") {
    require(window.__look.data.managedConnectors.some(c=>c.id==='composio:googlecalendar' && c.status==='ACTIVE') && !window.__look.data.managedConnectors.some(c=>c.id==='google'),"only Composio is connected");
    require(document.querySelector('.au-page .cal-chip.is-event') && !document.querySelector('.au-page .cal-notice'),"the successful Composio reading is drawn");
    return {check:name};
  }
  if (name==="routine-window" || name==="routine-window-saved") {
    require(document.querySelector('[data-dlg="window-from"]')?.textContent.includes(name.endsWith('saved')?'07:00':'08:00'),"the window start is a real shared control");
    require(document.querySelector('[data-dlg="window-to"]')?.textContent.includes('23:00'),"the end is retained");
    require(!document.querySelector('.au-routine-dialog select, .au-routine-dialog input[type="time"]'),"no native time or select control");
    if (name.endsWith('saved')) require(window.__look.calls.some(c=>c.method==='routines.update' && c.params.id===91 && c.params.schedule.from==='07:00' && c.params.schedule.to==='23:00'),"one update saves the whole rhythm");
    return {check:name};
  }
  if (name.startsWith('polish-')) {
    const ruler = root => ['.mc-depth', '.mc-depth-title', '.mc-track', '.mc-range', '.mc-dots', '.mc-dot', '.mc-stops', '.mc-stop[data-on="true"]'].map(selector => {
      const el = document.querySelector(`${root} ${selector}`), s = getComputedStyle(el), b = el.getBoundingClientRect();
      return [s.display, s.fontSize, s.fontWeight, s.backgroundColor, s.borderRadius, s.rowGap, b.width, b.height];
    });
    if (name === 'polish-effort-reference') window.__polishRuler = ruler('.cb-now');
    if (name === 'polish-effort') require(JSON.stringify(ruler('.mc-effort')) === JSON.stringify(window.__polishRuler), 'title, track, dots, labels and sizes match the conversation ruler');
    if (name === 'polish-scrolled') require(document.querySelector('.modal-body').scrollTop > 0, 'the reset exercise starts from a genuinely scrolled pane');
    if (name === 'polish-scroll') require(document.querySelector('.modal-body').scrollTop === 0, 'newly opened pane starts at the top');
    if (name === 'polish-caption') require(window.__polishCaption === true && window.__polishCaptionOutside === true, 'all caption actions and drag worked once without dismissing');
    if (name === 'polish-search') {
      const pane = [...document.querySelectorAll('.ra-find')].find(el => visible(el));
      const proof = window.__polishSearch;
      if (proof?.total === 210) require(Math.abs(document.querySelector('[data-room-search]').getBoundingClientRect().y-document.querySelector('[data-room-menu]').getBoundingClientRect().y)<1, 'group search and menu stay in the shared header tool row');
      require(proof?.wrap && proof.stable && proof.noMatch && proof.closedInPlace, 'keyboard and icon navigation wrap, typing stays put, no-match and both close paths work');
      require(pane.querySelector('.ra-find-count').textContent === `${proof.total}/${proof.total}`, 'the full paginated history starts at its newest exact word');
      require(document.querySelectorAll('mark.is-current').length === 1, 'one exact word is the current target');
      require(getComputedStyle(document.querySelector('mark.is-current')).outlineStyle !== 'none', 'current target differs by outline as well as contrast');
      require([...document.querySelectorAll('mark[data-find-match]:not(.is-current)')].every(el=>getComputedStyle(el).textDecorationStyle==='dotted'), 'other exact matches remain visible even on owner bubbles');
      require(pane.querySelectorAll('button').length === 3, 'real previous, next and close controls');
    }
    if (name === 'polish-room-recording') {
      const composer = document.querySelector('.au-room-pane .composer');
      require(composer.dataset.taskState === 'recording' && composer.querySelector('.cmp-voice .cmp-plane'), 'group recording shows the same send glyph');
      require(composer.querySelector('.cmp-voice').getAttribute('aria-label') === document.querySelector('.cmp-send').getAttribute('aria-label'), 'group recording uses the shared send label');
    }
    return { check: name };
  }
  if (name.startsWith("mcp-proposal-")) {
    const card = document.querySelector('[data-mcp-proposal="mcp-sample"]');
    require(visible(card) && card.classList.contains("connector-card"), "the shared connection card is visible");
    require(!card.querySelector("pre, select, input[type=password]"), "configuration is editable controls, without JSON or secret values");
    require([...card.querySelectorAll("*")].every(node => !["auto", "scroll"].includes(getComputedStyle(node).overflowY) || node.scrollHeight <= node.clientHeight + 1), "the card has no inner scroll panel");
    require(card.scrollWidth <= card.clientWidth + 1, "the card reflows without horizontal overflow");
    const calls = window.__look.calls.filter(call => call.method === "integrations.proposal");
    require([...card.querySelectorAll("[data-mcp-field]")].every(field => field.matches("textarea.field") || field.closest(".field")), "public fields use the shared field component");
    if (name === "mcp-proposal-edit") require(calls.some(call => call.params.operation === "edit" && call.params.fields.name === "Sample MCP"), "the real save action carries edited fields");
    if (name === "mcp-proposal-tested") require(card.querySelectorAll(".mcp-tools").length === 2 && visible(card.querySelector('[data-mcp-operation="enable"]')), "both groups precede confirmation");
    if (name === "mcp-proposal-stdio") require(card.querySelectorAll("[data-mcp-choice]").length === 4 && !calls.some(call => call.params.local_choice), "local execution waits for the owner's explicit choice");
    if (name === "mcp-proposal-enabled") require(calls.filter(call => call.params.operation === "enable").length === 1 && !card.querySelector("[data-mcp-operation]"), "the tested revision enables once and settles");
    if (name === "mcp-proposal-cancelled") require(!calls.some(call => call.params.operation === "enable") && !card.querySelector("[data-mcp-operation]"), "cancellation never enables");
    if (name === "mcp-proposal-secret") {
      const secret = document.querySelector('[data-secret-card="card-mcp-key"] input');
      require(secret?.type === "password" && secret.value === "sample-owner-key", "values use the existing masked secret control");
      require(!document.body.innerText.includes("sample-owner-key") && !JSON.stringify(calls).includes("sample-owner-key"), "values never enter proposal RPCs or visible chat text");
      require(card.querySelector('[data-mcp-field="headers"]').value === "Authorization", "the editable proposal contains only the secret name");
    }
    return { check: name, operations: calls.map(call => call.params.operation) };
  }
  if (["work-messaging", "work-pairing", "work-connected"].includes(name)) {
    const sections = document.querySelectorAll('[data-msg-kind]');
    require(sections.length === 3, 'all three channels use the existing settings group');
    const slackMark = document.querySelector('[data-msg-kind=slack] .msg-name .logo-mono');
    const slackFills = [...(slackMark?.querySelectorAll('svg path') ?? [])].map(path => path.getAttribute('fill')?.toUpperCase());
    require(visible(slackMark) && slackMark.querySelector('svg path')?.getAttribute('d').startsWith('M5.042 15.165')
      && new Set(slackFills).size === 4 && ['#E01E5A', '#36C5F0', '#2EB67D', '#ECB22E'].every(fill => slackFills.includes(fill)),
    'Slack uses its real mark in its four official colours in both themes (R-UI-97)');
    if (name === 'work-messaging') {
      require(document.querySelectorAll('[data-msg-kind] input[type=password]').length === 3, 'each token has its own masked field');
      for (const kind of ['slack', 'discord']) require(visible(document.querySelector(`[data-msg-kind=${kind}] [data-msg=setup-link]`)), 'each work channel has the shared setup button');
      const links = window.__look.calls.filter(call => call.command === 'open_link').map(call => call.url);
      require(links.includes('https://api.slack.com/apps') && links.includes('https://discord.com/developers/applications'), 'setup buttons open only their fixed platform URLs');
    }
    if (name === 'work-pairing') {
      require(document.querySelector('[data-msg-kind=slack] [data-code=SL1234]') && document.querySelector('[data-msg-kind=discord] [data-code=DC1234]'), 'pairing codes stay with their own platform');
      require(!window.__look.calls.some(call => String(call.method ?? '').endsWith('.approve')), 'viewing never approves a pairing');
    }
    if (name === 'work-connected') {
      const calls = window.__look.calls.filter(call => call.method === 'messaging.slack.connect');
      require(calls.length === 1 && !document.querySelector('#msg-token-slack'), 'one Slack connect call clears its token');
    }
    return {check:name};
  }
  if (["file-changes", "file-partial", "file-confirm", "file-restored", "file-bypass"].includes(name)) {
    require(visible(document.querySelector('.desktop-checkpoints')), 'review stays in the existing computer panel');
    if (name === 'file-changes') require(visible(document.querySelector('.checkpoint details[open] pre')) && document.querySelector('.checkpoint pre').textContent.includes('新版研究摘要'), 'the owner can read the file diff');
    if (name === 'file-changes' || name === 'file-partial') {
      const diff = document.querySelector('.checkpoint pre').textContent;
      require(!/--- before|\+\+\+ after|@@/.test(diff) && diff.includes('− 舊版') && diff.includes('+ 新版'), 'line signs explain the changes without developer headers');
      require(document.querySelector('.checkpoint summary').textContent === '團隊資料夾 / report.md', 'paths use relative owner words');
    }
    if (name === 'file-partial') require(document.querySelector('.checkpoint').textContent.includes('未備份') && document.querySelector('.checkpoint-uncovered').textContent.includes('video.mp4') && !document.querySelector('.checkpoint-uncovered').textContent.includes('/home/cua/'), 'partial coverage names files and folders in owner words');
    const restores = window.__look.calls.filter(call => call.method === 'computer.checkpoints' && call.params.action === 'restore');
    for (const call of restores) require(call.params.review_token === 'a'.repeat(64), 'restore binds to the after-state the owner actually reviewed');
    if (name === 'file-confirm') require(visible(document.querySelector('.mb-confirm')) && restores.length === 0 && document.querySelector('.mb-confirm').textContent.includes('你後來修改'), 'restore waits for the shared confirmation and explains preservation');
    if (name === 'file-restored') require(restores.length === 1 && restores[0].params.confirmed === true && !document.querySelector('[data-checkpoint-restore]') && !document.querySelector('.mb-confirm'), 'the approved restore runs once and leaves no question open');
    if (name === 'file-bypass') require(restores.length === 1 && restores[0].params.confirmed === false && !document.querySelector('[data-checkpoint-restore]') && !document.querySelector('.mb-confirm'), 'full permission restores once without inventing owner confirmation');
    if (name === 'file-restored' || name === 'file-bypass') {
      const status = document.querySelector('.checkpoint-heading > span:last-child');
      const text = document.createRange();
      text.selectNodeContents(status);
      require(text.getClientRects().length === 1, 'the restored status stays on one readable line');
    }
    return {check:name};
  }
  if (["login-private", "login-saved"].includes(name)) {
    const card = document.querySelector('[data-secret-card=card-login]');
    require(visible(card), 'login uses the existing secret card');
    for (const secret of ['private-look-owner','private-look-password']) require(!document.body.innerText.includes(secret) && !document.documentElement.outerHTML.includes(secret) && !JSON.stringify(window.__look.calls).includes(secret), 'login values stay out of markup, text and trace');
    if (name === 'login-private') {
      require(card.querySelector('[data-secret-input]').type === 'password' && !card.querySelector('[data-act=card-save]').disabled, 'the password is masked and the same save button works');
      const user = card.querySelector('[data-login-user]'), password = card.querySelector('[data-secret-input]');
      const a = user.closest('.field').getBoundingClientRect(), b = password.closest('.field').getBoundingClientRect();
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = getComputedStyle(user).font;
      require(b.top > a.bottom && Math.abs(a.width - b.width) < 2 && user.getBoundingClientRect().width > measure.measureText(user.value).width + 20, 'labelled account and password stack at full width without clipping the account');
    }
    if (name === 'login-saved') require(!card.querySelector('input') && window.__look.calls.filter(call=>call.method==='integrations.card_save').length===1, 'save clears both fields in one call');
    return {check:name};
  }
  if (name.startsWith('completion-')) {
    const input = [...document.querySelectorAll('.composer textarea')].find(visible);
    require(input, 'the real composer is visible');
    if (name === 'completion-before') {
      window.__look.completionComposerBottom = input.closest('.composer').getBoundingClientRect().bottom;
      return {check:name};
    }
    if (name === 'completion-picked') {
      require(input.value === '/field-notes:review ' && !document.querySelector('#app-popover'), 'Tab inserts the distinct skill token and closes the menu');
      return {check:name, value:input.value};
    }
    const menu = document.querySelector('#app-popover'), box = menu?.getBoundingClientRect();
    require(visible(menu), 'the shared completion menu is visible');
    require(getComputedStyle(menu).position === 'fixed', 'completion is outside composer layout');
    if (window.__look.completionComposerBottom !== undefined) require(Math.abs(input.closest('.composer').getBoundingClientRect().bottom - window.__look.completionComposerBottom) <= 1, 'the menu never pushes the composer');
    require(box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 32 && box.bottom <= innerHeight - 8, 'the menu stays inside the window');
    require(menu.scrollHeight <= menu.clientHeight + 1 && getComputedStyle(menu).overflowY !== 'auto', 'all rows fit without an inner scrollbar');
    const rows = [...menu.querySelectorAll('[data-value]')], values = rows.map(row => row.dataset.value);
    const heads = [...menu.querySelectorAll('.menu-head')].map(head => head.textContent);
    const painted = [...menu.querySelectorAll('button')].filter(row => !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(row).backgroundColor));
    require(painted.length <= 1, 'pointer and keyboard never paint two active rows');
    require(painted.every(row => row.classList.contains('is-active')), 'the painted row is the keyboard selection');
    require(!menu.querySelector('.menu-head[tabindex], .menu-head[role="option"]'), 'headings are not options or focus targets');
    require(document.activeElement === input, 'completion keeps the input focus');
    for (const row of rows) {
      require(row.getBoundingClientRect().top >= box.top && row.getBoundingClientRect().bottom <= box.bottom, 'every option is visible');
      require(!row.querySelector('.ck'), 'completion shares the ordinary row without a check column');
      if (row.dataset.value?.startsWith('Notebook')) {
        const tag = row.querySelector('.mtag')?.textContent ?? null;
        const expected = row.dataset.value === 'Notebook 00' ? '需要登入' : row.dataset.value === 'Notebook 01' ? '需要金鑰' : null;
        require(tag === expected, 'services only tag sign-in or key requirements');
      }
    }
    if (name === 'completion-mentions' || name === 'completion-group') {
      require(heads.join('|') === (name === 'completion-group' ? '成員|連接的服務' : '成員|群組|連接的服務'), 'sections follow owner order');
      require(values.filter(value => value.startsWith('Notebook')).join('|') === [31,30,29,28,27].map(i=>`Notebook ${i}`).join('|'), 'only the five most recent ready services show');
      require(menu.textContent.includes('顯示全部 32 個'), 'show all is a real action with the full count');
      if (name === 'completion-group') {
        const data = window.__look.data, allowed = data.rooms.find(room => room.id === 1).member_ids;
        require(data.members.filter(member => !allowed.includes(member.id)).every(member => !values.includes(member.name)) && data.groups.every(group => !values.includes(group.name)), 'group membership limits mentions');
      }
    } else if (name === 'completion-filtered') {
      require(values.length === 8 && heads.join('|') === '連接的服務', 'aliases filter across sections with eight results');
    } else if (name === 'completion-expanded' || name === 'completion-expanded-last') {
      require(values.length === 8 && heads.join('|') === '連接的服務' && input.value === '@', 'show all opens bounded service pages in place');
      if (name.endsWith('-last')) require(values.includes('Notebook 00') && menu.textContent.includes('需要登入') && menu.textContent.includes('需要金鑰'), 'unready services follow ready services and keep their tags');
    } else {
      require(rows.every(row => row.querySelector('.mdesc')?.textContent), 'commands and skills have descriptions');
      if (name === 'completion-slash' || name === 'completion-clash') require(heads.join('|') === '指令|技能', 'commands and skills have separate headings');
      if (name === 'completion-plugin') require(heads.join('|') === '技能' && menu.querySelector('.msource')?.textContent === 'Field Notes', 'the plugin is quiet small print, never a section');
      if (name === 'completion-clash') require(values.join('|') === 'review|field-notes:review|desk-notes:review', 'clashes show qualified plugin names');
    }
    require(!/MCP|toolkit/.test(menu.textContent), 'implementation kinds never appear in discovery');
    return {check:name, headings:heads, values, box:{x:box.x,y:box.y,width:box.width,height:box.height}};
  }
  if (name.startsWith('media-models-')) {
    const image = document.querySelector('[data-row="image-model"]'), video = document.querySelector('[data-row="video-model"]');
    require(visible(image) && visible(video), 'both media choices use existing visible model rows');
    require(/API/.test(image.textContent) && /API/.test(video.textContent), 'both rows disclose the separate API bill');
    if (name === 'media-models-unset') {
      require(/未設定/.test(image.textContent) && /未設定/.test(video.textContent) && /沒有可用模型/.test(video.textContent), 'unset never chooses a model and video has no invented capability');
      require(!/與回答相同/.test(image.textContent + video.textContent), 'unset media never inherits the conversational model');
    } else if (name === 'media-models-set') {
      require(/Gemini Image/.test(image.textContent) && /圖片輸出.*30/.test(image.textContent), 'the selected drawing model has its image token price');
      require(/影片模型範例/.test(video.textContent) && /每次請求.*0.12/.test(video.textContent), 'video shows the explicit synthetic provider and request price');
    } else if (name === 'media-models-menu') {
      const menu = document.querySelector('.model-chooser');
      require(visible(menu) && /每張.*0.04/.test(menu.textContent) && /每次請求.*0.025/.test(menu.textContent) && /圖片輸出/.test(menu.textContent), 'image-only models keep their real pricing units');
      for (const price of menu.querySelectorAll('.mc-price')) {
        const row = price.closest('.mc-row'), model = row.querySelector('.mc-model');
        require(model.getBoundingClientRect().width >= 80 && price.getBoundingClientRect().right <= row.getBoundingClientRect().right,
          'the model name and every price unit remain inside the existing picker row');
      }
    } else if (name === 'media-models-repair') {
      require(['image-model', 'video-model'].includes(document.activeElement?.dataset.k), 'repair focuses the exact model control');
    }
    require(!window.__look.calls.some(c => c.method === 'settings.set' && ['image_model','video_model'].includes(c.params.key)), 'viewing or repair never chooses a paid model');
    return {check:name};
  }
  if (name === 'generated-media-bill') {
    const step = document.querySelector('.work-meta');
    require(visible(step) && /google\/gemini-image/.test(step.textContent) && /API 費用.*0.042/.test(step.textContent), 'the visible work step names the model and actual bill');
    require(visible(step.querySelector('.step-detail')) && !document.querySelector('.work-sentences .step-why'), 'a successful drawing bill stays in the neutral footer');
    return {check:name};
  }
  if (name === 'generated-image' || name === 'generated-video') {
    const selector = name === 'generated-image' ? 'img[data-attachment]' : 'video[data-attachment]';
    const element = document.querySelector('.ra-body ' + selector);
    require(document.querySelectorAll(selector).length === 1, 'the generated output is not also fabricated as owner input');
    require(visible(element) && element.src.startsWith('blob:'), name === 'generated-image' ? 'the stored image is loaded through attachments.get' : 'the stored video streams through attachment_source');
    require(name !== 'generated-image' || element.naturalWidth > 0, 'the image decoded');
    require(name !== 'generated-video' || element.controls && element.readyState >= 1, 'the existing video player has playable metadata');
    return {check:name,id:element.dataset.attachment};
  }
  if (name === 'dataset-chart') {
    require(visible(document.querySelector('.ra-body .attachment-file[data-id]')), 'the chart has a stored file action');
    return {check:name};
  }
  if (name === 'dataset-table') {
    const table = document.querySelector('.ra-body .message-table');
    require(visible(table) && table.textContent.includes('36') && table.textContent.includes('台北'), 'the continued query renders actual table values');
    return {check:name};
  }
  if (name === 'generated-missing') {
    const note = [...document.querySelectorAll('.ra-body .missing-note')].find(visible);
    require(visible(note) && /供應商/.test(note.textContent) && /畫圖|影片/.test(note.textContent), 'the visible notice names the capability and provider');
    require(/尚未選擇.*模型/.test(note.textContent) && /API 費用/.test(note.textContent) && /不會自動/.test(note.textContent), 'the notice explains the explicit choice and separate bill without choosing');
    require(visible(note.querySelector('[data-missing-repair="models"]')), 'the existing Models repair is offered');
    return {check:name};
  }
  if (name === 'generated-video-running') {
    require(visible(document.querySelector('.live-presence')) && visible(document.querySelector('.composer[data-task-state="running"] .cmp-voice')), 'the live avatar and the existing Stop remain visible');
    require(document.querySelector('.live-presence').dataset.tooltip.includes('正在製作影片'), 'the latest video progress is the avatar hover');
    return {check:name};
  }
  if (name === 'generated-video-cancelled') {
    require(window.__look.calls.filter(c => c.method === 'worker.cancel').length === 1, 'Stop dispatches exactly one task cancellation');
    require(!document.querySelector('.ra-body video[data-attachment]'), 'cancellation leaves no video artifact');
    return {check:name};
  }
  if (name.startsWith('teach-')) {
    const calls = window.__look.calls.filter(c => c.method === 'computer.teach');
    const actions = calls.map(c => c.params.action);
    const panel = document.querySelector('.desktop-panel');
    require(panel && (['teach-try','teach-discard'].includes(name) || visible(panel)), 'the demonstration belongs to the member computer panel');
    if (name === 'teach-shared') {
      require(visible(panel.querySelector('.desktop-teach-missing .missing-note')), 'the separate computer requirement is visible');
      require(panel.querySelector('[data-desktop="teach"]').disabled && visible(panel.querySelector('[data-missing-repair="computer"]')), 'repair uses the existing computer settings entry');
      require(!actions.length, 'a shared computer never starts recording');
      return {check:name};
    }
    require(actions[0] === 'start', 'only the owner button starts the recording');
    if (name === 'teach-recording') {
      require(visible(panel.querySelector('.desktop-recording')) && visible(panel.querySelector('[data-desktop="discard-teach"]')), 'privacy words and one-press discard stay visible');
      require(panel.querySelector('[data-desktop="teach"]').textContent === '停止錄製', 'the same button stops recording');
      require(!actions.includes('save'), 'recording does not publish a skill');
    } else if (name === 'teach-draft') {
      const editor = panel.querySelector('#mp-skill-text');
      require(visible(editor) && editor.value.includes('## Inputs') && editor.value.includes('## Verification'), 'the existing editor holds an editable skill with inputs and final checks');
      require(actions.includes('stop') && !actions.includes('save'), 'the draft is not saved automatically');
      require(editor.value.includes('Unsaved sample procedure') && !actions.includes('read'), 'Back preserves the unsaved editor without fetching over it');
    } else if (name === 'teach-discard') {
      require(actions.includes('discard') && !actions.includes('save') && panel.querySelector('.desktop-recording').hidden, 'discard clears the recording without publication');
      require(!panel.hasAttribute('data-expanded') && visible(document.querySelector('.composer')), 'discard returns to the conversation');
    } else {
      require(actions.includes('save') && calls.find(c=>c.params.action==='save').params.text.includes('## Procedure'), 'the owner explicitly saved the document');
      if (name === 'teach-saved') require(visible(panel.querySelector('[data-teach-input]')), 'the owner can enter a fresh input');
      if (name === 'teach-try') {
        require(!panel.hasAttribute('data-expanded') && visible(document.querySelector('.composer')), 'trying the skill returns to the conversation');
        const call = window.__look.calls.find(c=>c.command==='agent_ask_text');
        require(call && JSON.stringify(call).includes('checked-report') && JSON.stringify(call).includes('第二季報告'), 'the existing conversation receives the saved skill and new input');
        const saved = calls.find(c=>c.params.action==='save');
        const opened = window.__look.calls.findLast(c=>c.method==='computer.viewer_open' && c.params.member_id === saved.params.member_id);
        require(opened && call.memberId === opened.params.member_id && call.conversationId === opened.params.conversation_id, 'the trial stays in the demonstrated member conversation');
        return {check:name,actions,member:call.memberId,conversation:call.conversationId};
      }
    }
    return {check:name,actions};
  }
  if (name.startsWith("routine-event-")) {
    if (name === "routine-event-profile") {
      const list = document.querySelector('.mp-routine-list');
      require(visible(list) && list.textContent.includes('Gmail') && list.textContent.includes('client@example.com') && list.textContent.includes('上次檢查'), 'the profile shares readable trigger rows');
      require(visible(list.querySelector('[role="switch"]')), 'the profile keeps the existing switch');
      return { check: name };
    }
    const row = document.querySelector('[data-routine="90"]');
    require(visible(row), 'the event uses the existing routine list');
    require(row.textContent.includes('Gmail') && row.textContent.includes('上次檢查') && row.textContent.includes('上次觸發'), 'the row names the app, filter and both times');
    require(row.matches('button[data-det="routine-open"]') && !row.querySelector('[role="switch"]'), 'the routine opens directly, with pausing inside its editor');
    require([...row.querySelectorAll('.mb-rt-main span')].every(text => text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1), 'the exact filter and both times remain readable without truncation');
    const status = row.querySelector('.mb-rt-main > span:last-child');
    const timeLabels = ['上次檢查', '上次觸發'].map(label => {
      const start = status.textContent.indexOf(label), range = document.createRange();
      require(start >= 0, 'both time labels are present');
      range.setStart(status.firstChild, start); range.setEnd(status.firstChild, start + label.length);
      require(range.getClientRects().length === 1, 'each time label stays together');
      return range.getBoundingClientRect();
    });
    require(timeLabels[1].top > timeLabels[0].top, 'checked and fired times begin on separate lines');
    if (name === "routine-event-menu") {
      require(visible(row) && row.matches('button[data-det="routine-open"]'), 'the row itself opens the routine');
      return { check: name };
    }
    if (name === "routine-event-saved") {
      const call = window.__look.calls.find(call => call.method === 'routines.update' && call.params.id === 90);
      require(call?.params.when?.filter.equals === 'owner@example.com' && !call.params.schedule, 'save preserves when instead of adding a schedule');
      require(row.textContent.includes('owner@example.com'), 'the list shows the saved filter');
      require(row.textContent.includes('尚未'), 'changing the filter resets its checked baseline');
    } else if (name !== "routine-event-row") {
      const form = document.querySelector('.au-routine-dialog');
      require(visible(form?.querySelector('#au-filter')), 'the narrow filter is an ordinary labelled field');
      require(!form.querySelector('#au-time') && !form.textContent.includes('"arguments"'), 'the editor contains readable event words');
      require(visible(form.querySelector('[data-dlg="save"]')), 'the shared save button is visible');
      const fields = form.querySelector('.mb-dlg-body');
      require(fields.scrollHeight <= fields.clientHeight + 1, 'event fields have no inner scroll');
      if (name === "routine-event-missing") require(visible(form.querySelector('[data-missing-repair="connections"]')), 'missing connection offers the existing settings entry');
    }
    return { check: name };
  }
  if (name.startsWith("missing-")) {
    const noteScope = name === 'missing-vision' ? '#svc-dialog .missing-note' : name === 'missing-search' ? '.work-section .missing-note' : name === 'missing-voice' ? '.toast .missing-note' : '.missing-note';
    const note = [...document.querySelectorAll(noteScope)].find(visible);
    if (name === 'missing-onboarding-repair') {
      require(visible(document.querySelector('[data-act="rerun-guide"]')), 'repair reaches the existing Start tour action');
    } else if (name === 'missing-store-repair') {
      require(visible(document.querySelector('[data-k="conn-tab:store"][aria-selected="true"]')), 'repair switches the existing settings to Store');
    } else if (name === 'missing-provider-repair') {
      require(visible(document.querySelector('#pv-dialog')), 'provider repair opens the existing provider card');
      require(document.activeElement === document.querySelector('#pv-dialog [data-pv="replace"]'), 'provider repair focuses its credential action');
    } else if (name === 'missing-card-repair') {
      require(visible(document.querySelector('#conn-key')), 'the shared card opens the existing Composio key field');
      require(document.querySelector('.cs-key-form .note')?.textContent.includes('專案設定 › API 金鑰'), 'the form says where to obtain the project key before typing it');
    } else if (name.endsWith('-repair')) {
      const field = document.querySelector(name === 'missing-search-repair' ? '#svc-url' : '#svc-key-fish');
      require(visible(field), 'repair reaches the existing exact field');
      require(document.querySelector('[data-pane="tools"][aria-current="page"]'), 'service repairs open the shared Tools pane');
    } else if (name === 'missing-model-list') {
      require(visible(document.querySelector('[data-dlg="reload"]')), 'the empty account offers a real reload');
      require(document.querySelector('.mc-list').textContent.includes('重新讀取'), 'the reason names reloading in visible words');
    } else {
      require(visible(note) && note.textContent.length > 20, 'the reason is visible text');
      require(!note.querySelector('[title]'), 'no reason depends on a hover title');
      if (name === 'missing-search') require(note.textContent.includes('尚未設定 SearXNG 網址') && note.querySelectorAll('button').length === 1, 'the step says address, not key, with one action');
      if (name === 'missing-card') require(note.textContent.includes('設定 › 連接 › 商店') && note.querySelectorAll('button').length === 1, 'the card names its existing repair form with one action');
      if (name === 'missing-hidden') require(visible(document.querySelector('[data-hidden-retry]')), 'the unreadable list offers a real retry');
      if (name === 'missing-vision') require(document.querySelector('[data-svc="use"]').disabled && note.textContent.includes('回答模型無法讀取圖片'), 'same-as-answer says why it cannot be used');
    }
    return {check:name};
  }
  if (name === "generated-audio-missing" || name === "generated-audio-repair") {
    const thread = document.querySelector('.page-agent:not([hidden])');
    if (name === "generated-audio-missing") {
      require([...thread.querySelectorAll('[data-missing-repair="voice"]')].filter(visible).length === 1, "the missing voice service is said once with one repair");
      require(visible(thread.querySelector('.work-body')) && !thread.querySelector('.work-body [data-missing-repair]'), "the opened work does not repeat the reply's repair");
    } else {
      require(visible(document.querySelector('#svc-key-fish')), "the repair reaches the voice service key");
      require(document.querySelector('[data-pane="tools"][aria-current="page"]'), "the voice repair opens the shared Tools pane");
    }
    return {check:name};
  }
  if (name.startsWith("owner-card-room-")) {
    const kind = name.slice("owner-card-room-".length);
    const selector = { connect: "[data-connector]", secret: "[data-secret-card]", mail: "[data-mail-card]", page: ".pg-card" }[kind];
    const card = document.querySelector(`.au-room-thread ${selector}`);
    require(visible(card), "the existing card is visible inside the room conversation");
    require(kind === "page" ? !!card.querySelector("iframe") : !!card.querySelector("button"), "the shared card retains its real controls");
    if (kind === "connect") require(window.__look.calls.some(call => call.method === "integrations.card_connect"), "room sign-in uses the existing card service");
    if (kind === "secret") require(card.querySelector("input").type === "password" && card.querySelector("input").value === "synthetic-room-key", "the room keeps the shared masked key field");
    if (kind === "mail") require(card.dataset.version === "2" && card.querySelector('[data-mail-field="subject"]').value === "Room report for review", "room edits persist through the existing draft service");
    if (kind === "page") {
      require(window.__look.calls.filter(call => call.method === "owner_questions.answer").length === 1, "the page answers its waiting task once");
      require(!window.__look.calls.some(call => call.method === "rooms.send"), "the page result continues the existing task without another room request");
    }
    return { check: name, kind };
  }
  if (['card-question-typing','card-question-key','card-computer-inline','card-send-failed','card-send-retry','card-mail-failed','card-mail-retry','card-task-result','card-task-room','card-task-files','card-task-restored','card-task-prose','card-sheet','card-permission-settled'].includes(name)) {
    const calls = window.__look.calls;
    if (name === 'card-question-typing') require(!calls.some(call=>call.method==='owner_questions.answer'), 'typing A never answers the question');
    if (name === 'card-question-key') {
      const answers = calls.filter(call=>call.method==='owner_questions.answer');
      require(answers.length===1 && answers[0].params.answer==='星期二', 'B answers the second choice once');
    }
    if (name === 'card-computer-inline') {
      const frame = document.querySelector('[data-card-desktop-screen] iframe');
      require(visible(frame) && frame.contentDocument.defaultView.__desktopConnections===1, 'the existing single live stream is inside the card');
      require(calls.filter(call=>call.method==='computer.viewer_open' && call.params.member_id===1).length===1, 'one session is opened');
    }
    if (name.startsWith('card-send-')) {
      const sends=calls.filter(call=>call.command==='agent_ask_text');
      require(sends.length===(name.endsWith('retry')?2:1) && sends.every(call=>call.text==='Please review the project note.'), 'the exact restored words cross only the send boundary');
      if (name.endsWith('failed')) require(document.querySelector('.cmp-input').value==='Please review the project note.' && visible(document.querySelector('.composer-failure .card-status.is-failed')), 'failure keeps the draft and retry beside the composer');
      else require(document.querySelector('.cmp-input').value==='' && !document.querySelector('.composer-failure'), 'successful retry clears the draft and failure');
    }
    if (name.startsWith('card-mail-')) {
      const card=document.querySelector('[data-mail-card]'), sends=calls.filter(call=>call.method==='integrations.draft_send');
      if(name.endsWith('failed')) require(card.dataset.mailState==='failed' && card.querySelector('[data-mail-field=body]') && !card.querySelector('[data-act=mail-send]').disabled && window.__look.sent.length===0, 'failed mail is still editable with a usable retry');
      else require(card.dataset.mailState==='sent' && sends.length===2 && sends[1].params.retry_version===1 && window.__look.sent.length===1, 'an explicit version-bound retry sends once');
    }
    if (name === 'card-task-result') require(document.querySelector('[data-task-result="980"]').textContent.includes('+1 −1'), 'counts come from the actual checkpoint diff');
    if (name === 'card-task-room') require(document.querySelector('[data-task-result="950"]')?.textContent.includes('+1 \u22121'), 'room counts use the same actual checkpoint');
    if (name === 'card-task-files') require(visible(document.querySelector('.desktop-checkpoints')) && calls.some(call => call.method === 'computer.checkpoints'), 'the existing file view opens independently of a running computer');
    if (name === 'card-task-restored') {
      const restores = calls.filter(call => call.method === 'computer.checkpoints' && call.params.action === 'restore');
      require(restores.length === 1 && restores[0].params.review_token === 'a'.repeat(64) && !document.querySelector('[data-task-restore]'), 'one confirmed restore uses the exact reviewed checkpoint token');
    }
    if (name === 'card-task-prose') require(!document.querySelector('.task-result') && !document.querySelector('.tn[data-id="980"] .task-actions'), 'no files means no result card, and the reply already says it is finished');
    if (name === 'card-sheet') require(document.querySelectorAll('.conversation-card').length >= 9 && document.querySelector('[data-card-desktop-screen] iframe'), 'the sheet uses real production consumers, team rows and one live screen in one column');
    if (name === 'card-permission-settled') require(calls.filter(call=>call.command==='agent_question_answer').length===1 && !document.querySelector('[data-act=perm-once]'), 'one answer settles the card and removes controls');
    return {check:name};
  }
  if (name === 'card-message') {
    const card = document.querySelector('[data-permission-card]'), calls = window.__look.calls.filter(call => call.command === 'agent_question_answer');
    require(visible(card.querySelector('.card-detail')) && card.querySelectorAll('.card-field').length === 3, 'workspace, recipient and thread use real field rows');
    require(card.textContent.includes('#規劃') && card.textContent.includes('123.456') && card.textContent.includes('請確認範例排程，並回覆方便討論的時間。'), 'the exact connected message remains available');
    require(!card.querySelector('pre') && !card.textContent.includes('"body":'), 'draft fields never become raw JSON');
    if (card.querySelector('[data-card-retry]')) require(calls.length === 1 && card.dataset.cardState === 'pending' && visible(card.querySelector('.card-status.is-failed')), 'failed approval retains the unanswered original draft');
    else if (card.dataset.cardState !== 'pending') require(calls.length >= 1 && calls.length <= 2 && calls.every(call => call.id === card.dataset.permissionCard) && !card.querySelector('[data-act=perm-once]'), 'only the original approval is answered and settled');
    else require(calls.length === 0, 'reviewing a draft never approves it');
    return {check:name};
  }
  if (name === 'card-guide-retry') {
    const calls = window.__look.calls.filter(call => call.command === 'open_external_url');
    const field = document.querySelector('[data-inline-setup] [data-setup-field]');
    require(calls.length === 2 && window.__look.urls.length === 1, 'guide retry opens its URL once after a failed attempt');
    require(field?.value && !JSON.stringify(calls).includes(field.value), 'the guide never carries the unsent secret');
    require(!window.__look.calls.some(call => call.method === 'integrations.card_connect'), 'guide retry never submits the credential form');
    return {check:name};
  }
  if (name === 'card-failed-close') {
    const card = document.querySelector('.conversation-card[hidden]');
    require(card && !visible(card), 'the failed card closes locally');
    require(window.__look.sent.length === 0, 'closing never sends a message or mail');
    require(!window.__look.calls.some(call => /(?:discard|delete|cancel)$/.test(call.method)), 'closing keeps saved work');
    return {check:name};
  }
  if (name === "card-shell") {
    const cards = [...document.querySelectorAll('.conversation-card')].filter(visible);
    require(cards.length, 'a production conversation card is present');
    for (const card of cards) {
      disclosureContent(card);
      const box = card.getBoundingClientRect(), style = getComputedStyle(card), pill = card.querySelector('.card-status');
      require(box.width <= 480.5, `card width is at most 480px: ${box.width}`);
      const draftHost = card.closest('.draft-panel');
      if (draftHost) require(parseFloat(getComputedStyle(draftHost).borderTopWidth) === 0 && parseFloat(getComputedStyle(draftHost).paddingLeft) === 0, 'the draft host adds no second card frame');
      if (card.matches('[data-owner-question][data-card-state="asked"],[data-greeting-question][data-card-state="asked"]')) {
        const close = card.querySelector('[data-owner-answer="cancel"],[data-greeting-answer="cancel"]');
        require(!pill, 'a waiting question uses its title without a redundant status pill');
        require(close?.parentElement?.matches('.card-head') && close === close.parentElement.lastElementChild, 'question close follows the heading at the far right');
        require(Math.abs(close.getBoundingClientRect().right - (box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth))) < 1.5, 'question close aligns with the right padding');
      } else if (card.matches('[data-member-template],[data-template-connection][data-connected="false"]')) {
        require(!pill, 'a template and its unconnected requests have no invented status');
      } else {
        require(pill && pill.textContent.trim(), 'status always has a word');
        require(Math.abs(pill.getBoundingClientRect().right - (box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth))) < 1.5, 'pill aligns with the right padding');
      }
      // The computer screen's own character (booting, or saying its state in one sentence) belongs to the screen.
      require(![...card.querySelectorAll('.av,.slime,.ask-face,.bgq-face,.draft-face')].some(face => !face.closest('[data-card-desktop-screen] .desktop-boot-face, [data-card-screen] .desktop-boot-face')), 'no face is inside a card outside its computer screen');
      require(!card.querySelector('select'), 'no native select is inside a card');
      if (card.matches('[data-desktop-work][data-work-state="waiting_control"]')) {
        const turn = card.closest('.tn');
        require(turn && !turn.querySelector('.work-section.is-live,[data-work-start],.task-actions'), 'a computer handoff owns the waiting state without thinking, ticking or duplicate task controls');
        require(!turn?.hasAttribute('data-live'), 'the member is paused while waiting for computer handoff');
      }
      const taskLine = card.closest('.ra-body')?.querySelector(':scope > .task-actions');
      if (card.matches('.task-result,[data-owner-question],[data-greeting-question],[data-permission-card],[data-secret-card],[data-connector]')) require(!taskLine || taskLine.hidden || !visible(taskLine), 'the card replaces a duplicate task state line');
      for (const hint of [...card.querySelectorAll('.cn-hint')].filter(visible)) require(getComputedStyle(hint).whiteSpace === 'nowrap' && hint.getBoundingClientRect().height <= parseFloat(getComputedStyle(hint).lineHeight) + 1, 'field hints stay on one line');
        for (const well of [...card.querySelectorAll('.card-well')].filter(visible)) {
          const shade = value => value.match(/[\d.]+/g).slice(0, 3).reduce((sum, part) => sum + Number(part), 0);
          require(shade(getComputedStyle(well).backgroundColor) < shade(style.backgroundColor), 'the well is darker than its card');
        }
      for (const node of [card, ...card.querySelectorAll('*')].filter(visible)) {
        const css = getComputedStyle(node);
        require(!(['auto','scroll'].includes(css.overflowY) && node.scrollHeight > node.clientHeight + 2), `no inner scrollbar: ${node.className}`);
      }
      const primary = [...card.querySelectorAll('.card-actions,.sc-form,.question-submit')].filter(visible);
      for (const row of primary) {
        const buttons = [...row.querySelectorAll('button')].filter(visible), pri = buttons.find(button => button.classList.contains('pri'));
        if (pri) {
          require(buttons[0] === pri, 'primary button is first');
          require(getComputedStyle(pri).backgroundColor === 'rgb(255, 255, 255)', 'primary button is white in both themes');
        }
      }
      require(card.scrollWidth <= card.clientWidth + 1, 'card never scrolls sideways');
    }
    return {check:name,cards:cards.length};
  }
  if (name.startsWith("owner-question-")) {
    const card = document.querySelector('[data-owner-question="owner-choice"]');
    require(visible(card) && card.classList.contains("permission-card"), "the shared card is visible");
    const waiting = ["owner-question-asked", "owner-question-typed", "owner-question-background", "owner-question-room"].includes(name);
    require(card.dataset.cardState === (waiting ? "asked" : name === "owner-question-cancelled" ? "cancelled" : "answered"), "the persisted state is shown");
    if (name === "owner-question-cancelled") require(card.querySelector('.card-status.is-ready') && !card.querySelector('[data-card-disclosure]'), 'a cancelled question has a neutral decision and no redundant disclosure');
    const asked = card.querySelector(".card-title");
    require(getComputedStyle(asked).whiteSpace !== "nowrap" && asked.scrollWidth <= asked.clientWidth + 1, "the whole question shows, wrapped, never cut to one line");
    require(card.querySelectorAll("[data-owner-option]").length === (waiting ? 4 : 0), "choices are real buttons only while waiting");
    require(!card.querySelector("select"), "a short list needs no dropdown");
    const box = card.getBoundingClientRect(), column = card.parentElement.getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "the question fits its reply column");
    for (const control of card.querySelectorAll("button,input")) {
      const bounds = control.getBoundingClientRect();
      require(bounds.left >= box.left && bounds.right <= box.right + 1 && bounds.bottom <= box.bottom + 1, "every answer control fits the card");
    }
    const field = card.querySelector("[data-owner-answer-input]");
    if (field) {
      require(field.classList.contains("mb-fin") && field.tagName === "INPUT", "the answer uses the shared form field");
      require(field.scrollHeight <= field.clientHeight + 2, "the answer field has no inner scroll");
      const submit = card.querySelector('[data-owner-answer="text"]');
      require(visible(submit), 'the answer primary stays visible while empty or typed');
      require(submit.disabled === !field.value.trim(), 'only a nonempty answer enables submit');
      if (name === "owner-question-typed") {
        require(field.value === "請先確認下週的範例排程。" && !submit.disabled, 'typed text remains in the card before sending');
        require(getComputedStyle(submit).backgroundColor === 'rgb(255, 255, 255)', 'the enabled answer primary stays white while hovered');
        require(window.__look.calls.filter(call => call.method === 'owner_questions.answer').length === 0, 'typing never submits an answer');
      }
    }
    if (!waiting) require(window.__look.calls.filter(call => call.method === "owner_questions.answer").length === 1, "the original card was answered exactly once");
    if (name === "owner-question-background") {
      const summary = document.querySelector(".task-actions");
      require(!visible(summary), "the question replaces the redundant waiting/Stop line");
      require(!card.closest(".tn").querySelector(".work-section.is-live,[data-work-start]"), "waiting for the owner never keeps thinking or ticking");
    }
    return { check: name, state: card.dataset.cardState };
  }
  if (name.startsWith("local-command-setting") || name === "local-command-menu") {
    const picker = document.querySelector('[data-k="local-commands"]');
    require(visible(picker) && picker.classList.contains('sel'), 'local commands use the shared settings dropdown');
    if (name === "local-command-menu") {
      require([...document.querySelectorAll('.menu [data-value]')].map(item => item.dataset.value).join(',') === 'ask,always,never', 'the shared setting offers ask, always and never');
    }
    if (name === "local-command-setting-saved") {
      const saved = window.__look.calls.filter(call => call.method === 'settings.set' && call.params.key === 'local_commands_mode');
      require(saved.length === 1 && ['always', 'never'].includes(saved[0].params.value), 'the choice reaches shared core settings');
    }
    return {check:name, label:picker.textContent};
  }
  if (name === "local-command-card" || name === "local-command-settled") {
    const card = document.querySelector('[data-permission-card="perm-local"]'), box = card?.getBoundingClientRect();
    require(visible(card), 'the shared local command card is visible');
    const thread = card.closest('.ra-body') ?? card.closest('.bgq-list').parentElement;
    const column = thread.getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, 'R-UI-29: the command card fits its reply column');
    const command = card.querySelector('.local-command');
    require(command.textContent.includes('Get-Process | Sort-Object CPU') && command.textContent.includes('LoadPercentage'), 'the exact multiline command survives escaping');
    require(command.scrollWidth <= command.clientWidth + 1, 'long command lines wrap inside the card');
    if (card.dataset.cardState === 'pending') require(visible(card.querySelector('[data-act="local-settings"]')), 'command access can be managed from the opened details');
    else require(!card.querySelector('[data-act="local-settings"]'), 'settled commands remove their settings action');
    const answers = [...card.querySelectorAll('.cc-actions button')];
    if (name === "local-command-card") {
      require(answers.length === (card.dataset.kind === 'local_access' ? 4 : 2), 'first consent has four real answers; later commands have two');
      require(answers.every(button => !button.disabled), 'the card is answerable');
      require(answers[0].classList.contains('pri'), 'the primary answer comes first');
    } else {
      require(card.dataset.cardState !== 'pending' && !answers.length, 'the answer settles the same card');
      require(window.__look.calls.some(call => call.command === 'agent_question_answer'), 'the answer reaches the native question boundary');
    }
    for (const button of answers) {
      const b = button.getBoundingClientRect();
      require(b.left >= box.left && b.right <= box.right + 1 && b.bottom <= box.bottom + 1, 'all answer controls fit the card');
    }
    const outside = thread.cloneNode(true);
    outside.querySelectorAll('.permission-card').forEach(node => node.remove());
    require(!outside.textContent.includes('Get-Process'), 'R-AG-13: the command is absent from public timeline text');
    require(![...document.querySelectorAll('.ask-card')].some(visible), 'the command has one shared permission card');
    return {check:name, kind:card.dataset.kind, state:card.dataset.cardState, answers:answers.map(button=>button.textContent)};
  }
  if (name === 'appearance-focus') {
    const focused = document.activeElement, style = getComputedStyle(focused);
    require(focused?.matches('.menu [data-value]') && document.documentElement.hasAttribute('data-keys'), 'theme menu supports actual keyboard focus');
    require((parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none') || (style.boxShadow.includes('inset') && style.boxShadow.includes('2px')), 'keyboard focus has a visible ring');
    return {check:name, color:style.outlineColor, shadow:style.boxShadow, value:focused.dataset.value};
  }
  if (name === "appearance-settings") {
    const card = document.querySelector('.appearance-settings .slist');
    require(visible(card) && card.getBoundingClientRect().width <= 640, "appearance keeps a narrow reading measure");
    require(card.querySelectorAll('.row').length === 2 && card.querySelectorAll('.sel').length === 2, "theme and language share the row/dropdown component");
    for(const row of card.querySelectorAll('.row')){
      const box=row.getBoundingClientRect(), label=row.querySelector('.lbl').getBoundingClientRect(), picker=row.querySelector('.sel').getBoundingClientRect();
      require(label.left-box.left>=12&&box.right-picker.right>=12,"settings rows keep shared inner padding");
    }
    require(!document.querySelector('.skin-preview, [data-skin-choice]'), "preview gallery is retired");
    const choices=[...document.querySelectorAll('.menu [data-value]')];
    if(choices.length)require(choices.map(item=>item.dataset.value).join(',')==='system,light,dark','theme menu has exactly three appearance choices');
    return { check:name, width:card.getBoundingClientRect().width };
  }
  if (name === "theme-clarity") {
    const elements = [document.documentElement, document.body, document.querySelector('#main'), document.querySelector('.page-agent'), document.querySelector('.mb-chat')].filter(Boolean);
    const surfaces = elements.map(el => { const style = getComputedStyle(el); return { element:el.id || el.className || el.tagName, opacity:style.opacity, filter:style.filter, backdrop:style.backdropFilter, background:style.backgroundImage }; });
    require(surfaces.every(s => s.opacity === '1' && s.filter === 'none' && s.backdrop === 'none'), "root and conversation have no opacity or blur veil");
    require(getComputedStyle(document.querySelector('.mb-chat')).backgroundImage === 'none', "conversation has no tinted gradient");
    const root = getComputedStyle(document.documentElement), tokens = Object.fromEntries(['content', 'panel', 'text-2', 'text-3', 'accent', 'focus', 'selected'].map(key=>[key, root.getPropertyValue(`--${key}`).trim()]));
    require(Object.values(tokens).every(value=>/^#([0-9a-f]{2})\1\1$/i.test(value)), "both themes are neutral greys including text, accent, focus and selection");
    return {check:name, surfaces, tokens};
  }
  if(name==='home-hero'){
    const hero=document.querySelector('.page-home .ho-hero'), emblem=hero.querySelector(':scope > .av'), heading=hero.querySelector('h1'), date=hero.querySelector('.ho-date');
    const expected=innerWidth<=760?96:128, root=getComputedStyle(document.documentElement);
    require(Math.abs(emblem.getBoundingClientRect().width-expected)<1,'Home enlarges only the emblem at each viewport');
    require(getComputedStyle(heading).fontSize===root.getPropertyValue('--fs-h1').trim(),'Home report uses the original heading token');
    require(getComputedStyle(date).fontSize===root.getPropertyValue('--fs-md').trim(),'Home date keeps its existing type size');
    return {check:name,emblem:expected,heading:getComputedStyle(heading).fontSize};
  }
  if (name.startsWith("rich-")) {
    const scope = document.querySelector('.page-agent:not([hidden])');
    const cards = [...scope.querySelectorAll('.rich-block')];
    require(cards.length > 0 && !scope.querySelector('.ans .rich-block, .bubble .rich-block'), "rich cards are timeline blocks outside text bubbles");
    require(document.documentElement.scrollWidth <= innerWidth + 1 && scope.scrollWidth <= scope.clientWidth + 1, "rich content never overflows the page sideways");
    for (const card of cards) {
      require(card.scrollWidth <= card.clientWidth + 1, "each card contains its own overflow");
      require(card.getBoundingClientRect().right <= innerWidth + 1, "card fits the conversation column");
    }
    const diagram = scope.querySelector('.message-diagram');
    if (["rich-content", "rich-diagram", "rich-source", "rich-expand"].includes(name)) {
      require(diagram?.dataset.diagramState === "rendered" && diagram.querySelector('.diagram-view svg'), "Mermaid produces a visible SVG");
      const canvas = diagram.querySelector('.diagram-view > svg'), intrinsicWidth = canvas.viewBox.baseVal.width;
      require(!intrinsicWidth || canvas.getBoundingClientRect().width <= intrinsicWidth + 1, "inline diagrams fit the column without enlarging narrow diagrams into oversized text");
      const rows = [...canvas.querySelectorAll('.row-rect-odd path, .row-rect-even path')];
      if (rows.length) {
        const probe = document.createElement('span'); diagram.append(probe);
        const palette = ['--panel', '--surface-2'].map(token => { probe.style.color = getComputedStyle(scope).getPropertyValue(token); return getComputedStyle(probe).color; });
        probe.remove();
        require(rows.every(row => getComputedStyle(row).fill === 'none' || palette.includes(getComputedStyle(row).fill)), "ER data rows use theme token backgrounds in every theme");
        require([...canvas.querySelectorAll('marker circle')].every(circle => palette.includes(getComputedStyle(circle).fill)), "ER optional markers use the theme panel instead of fixed white");
        const label = canvas.querySelector('.edgeLabel text');
        require(label?.textContent.includes('contains'), "ER relationship retains its source label as SVG text");
        const background = canvas.querySelector('.edgeLabel rect');
        require(visible(label) && (!background || getComputedStyle(label).fill !== getComputedStyle(background).fill), "ER relationship text remains visible against its label background");
      }
      require(!diagram.querySelector('svg foreignObject, svg image, svg a, svg script, svg [onclick]'), "diagram contains no HTML, external images or click handlers");
    }
    if (name === "rich-content") {
      require(scope.querySelector('h2') && scope.querySelector('blockquote') && scope.querySelector('.message-task input:disabled') && scope.querySelector('ul ul'), "text additions stay in the text bubble");
      require(scope.querySelector('.message-table th strong') === null && scope.querySelector('.message-table td strong') && scope.querySelector('.message-table a'), "table cells support inline Markdown");
      require(scope.querySelector('.message-image') && !scope.querySelector('.message-image img'), "remote image is initially a consent card");
    }
    if (["rich-content", "rich-image"].includes(name)) require(!performance.getEntriesByType('resource').some(entry => entry.name.includes('images.example.test')), "no remote image request before consent");
    if (name === "rich-code") {
      const code = scope.querySelector('.message-code:not(.message-diagram)'), pre = code.querySelector('pre');
      require(code.querySelector('.rich-head').textContent.includes('bash') && code.querySelector('.hljs-built_in, .hljs-string'), "code language and syntax highlighting are visible");
      require(getComputedStyle(pre).whiteSpace === 'pre' && pre.scrollWidth > pre.clientWidth, "long commands scroll within their code block without wrapping");
    }
    if (name === "rich-source") require(!diagram.querySelector('pre').hidden && diagram.querySelector('[data-rich-act="view-source"]').getAttribute('aria-expanded') === 'true', "source toggle reveals complete source");
    if (name === "rich-expand") {
      const dialog = document.querySelector('.rich-view-dialog');
      require(visible(dialog?.querySelector('.diagram-view svg')) && dialog.querySelector('[data-dlg="close"]'), "expanded diagram uses the shared accessible dialog");
      require(dialog.getBoundingClientRect().width >= Math.min(1200, innerWidth - 48) - 1, "expanded view uses the large viewport-bound dialog width");
    }
    if (name === "rich-image") require(scope.querySelector('[data-rich-act="load-image"]') && !scope.querySelector('.message-image [src]'), "a real load control precedes any image source");
    if (name === "rich-image-loaded") require(scope.querySelector('.message-image img')?.referrerPolicy === 'no-referrer', "consented image omits referrer");
    if (name === "rich-table-example") {
      require(scope.querySelectorAll('th').length === 3 && scope.querySelector('.message-table a') && scope.querySelector('.message-table td code'), "owner example has three aligned columns, links and inline code");
      require(getComputedStyle(scope.querySelector('.message-table td')).overflowWrap === 'anywhere', "long Chinese cells wrap within the column");
    }
    if (name === "rich-wide-table") {
      const scroller = scope.querySelector('.message-table .rich-scroll');
      require(getComputedStyle(scroller).overflowX === 'auto', "wide table has a local horizontal scrollport");
      if (innerWidth < 1920) require(scroller.scrollWidth > scroller.clientWidth, "many columns use the card's local fallback scrolling");
    }
    if (name === "rich-fallback") require(diagram && !diagram.querySelector('pre').hidden && visible(diagram.querySelector('.rich-note')) && !diagram.querySelector('.diagram-view svg'), "incomplete or invalid diagram keeps source and a quiet note");
    return { check:name, cards:cards.length, diagram:diagram?.dataset.diagramState ?? null };
  }
  const selection = () => {
    const rows = [...document.querySelectorAll('#nav .nav[aria-current="true"], #nav [data-go][aria-current="page"]')];
    const home = !document.querySelector('.page-home').hidden;
    require(rows.length === 1, `only the current destination is selected, found ${rows.length}`);
    if (home) require(rows[0].matches('[data-go="home"]'), "Home selects only its own icon");
    else if (!document.querySelector('.page-agent').hidden) require(rows[0].matches('[data-member], [data-room]'), "chat selects only its conversation");
    return rows[0].getAttribute('data-go') ?? rows[0].getAttribute('data-member') ?? rows[0].getAttribute('data-room');
  };
  if (name === "sidebar-selection") return {check:name, selected:selection()};
  if (name === "home-hover-content") {
    const {normal, hovered} = context;
    require(normal.background === hovered.background, "hover preserves the block background");
    require(normal.layer === 'rgba(0, 0, 0, 0)' && hovered.layer === normal.layer, "the full-size click layer stays transparent");
    require(hovered.border === hovered.hoverEdge && hovered.border !== normal.border, "only the edge lights up with the sidebar spend card hover-edge token");
    const changed = hovered.visual.findIndex((value, index) => JSON.stringify(value) !== JSON.stringify(normal.visual[index]));
    require(changed < 0, `hover leaves all block geometry, text, icons, charts and inner colours unchanged: ${changed} ${JSON.stringify(normal.visual[changed])} -> ${JSON.stringify(hovered.visual[changed])}`);
    return {check:name, background:hovered.background, border:hovered.border};
  }
  if (name === "sidebar-shell") {
    selection();
    const nav = document.getElementById("nav"), column = nav.querySelector(".mb-col"), main = document.getElementById("main");
    const compact = matchMedia("(max-width: 859px)").matches, open = document.documentElement.hasAttribute("data-sidebar-open");
    require(document.querySelectorAll(".mb-col").length === 1 && column, "one global conversation list");
    require(!document.querySelector('[data-go="team"], .team-page, [data-col="collapse"], .nav-apps, [data-go="automations"]'), "retired navigation and icon rails are absent");
    const header=nav.querySelector('.mb-top');
    const rail=document.documentElement.hasAttribute('data-sidebar-collapsed');
    require(!nav.querySelector('.brand, .app-icon, [data-sidebar="collapse"]')&&nav.querySelector('.sidebar-foot-row [data-go="home"]'),'no brand and no fold button (the edge drags, as Grok Bot\'s); Home sits beside the owner');
    if(!compact){const edge=nav.querySelector(':scope > .side-edge'),box=edge?.getBoundingClientRect(),side=nav.getBoundingClientRect();require(edge&&edge.getAttribute('role')==='separator'&&getComputedStyle(edge).cursor==='col-resize'&&Math.abs(box.right-side.right)<1&&box.width<=8&&getComputedStyle(edge,'::after').content==='none','the list has a draggable edge at its right, with no handle drawn');}
    const pair=[...nav.querySelectorAll('[data-col]')];
    require(pair.map(button=>button.dataset.col).join()==='search,add'&&!column.querySelector('input'),'search then plus, as Grok Bot\'s, with no field standing in the list');
    for(const button of pair.filter(visible)){const box=button.getBoundingClientRect(),style=getComputedStyle(button);require(Math.abs(box.width-36)<1&&Math.abs(box.height-36)<1&&parseFloat(style.borderRadius)>=18&&style.backgroundColor!=='rgba(0, 0, 0, 0)'&&style.borderTopColor==='rgba(0, 0, 0, 0)','search and plus are 36px soft round buttons with no frame');}
    if(!rail&&pair.every(visible))require(pair.every(button=>button.parentElement===header)&&Math.abs(pair[0].getBoundingClientRect().top-pair[1].getBoundingClientRect().top)<1&&pair[1].getBoundingClientRect().right>pair[0].getBoundingClientRect().right,'search and plus stand side by side in the top row');
    require([...nav.querySelectorAll('.side-foot [data-go]')].map(el=>el.dataset.go).join()==='settings,settings,dictation,home','footer opens Connections above account, dictation and Home');
    if(!document.documentElement.hasAttribute('data-sidebar-collapsed')){const home=nav.querySelector('.sidebar-home'),box=home.getBoundingClientRect();require(Math.abs(box.width-36)<1&&Math.abs(box.height-36)<1&&getComputedStyle(home).borderRadius===getComputedStyle(nav.querySelector('.sidebar-dictation')).borderRadius,'Home keeps the shared icon surface');}
    for(const button of nav.querySelectorAll('.btn.icon:not([data-col]), .side-foot .nav'))if(visible(button)&&!visible(button.querySelector('.nav-t'))){const box=button.getBoundingClientRect(),corner=parseFloat(getComputedStyle(button).borderRadius);require(corner>0&&corner<Math.min(box.width,box.height)/2,`sidebar buttons are rounded squares, never circles (${button.className})`);}
    require(nav.querySelector('.side-foot [data-go="dictation"]').getAttribute('aria-label')&&!nav.querySelector('.side-foot [data-go="dictation"] .nav-t'),'dictation is a named icon button');
    require(nav.querySelector('.sidebar-account .owner-face')&&nav.querySelector('.sidebar-account').getAttribute('aria-label'),'account has its own face and accessible name');
    require(!nav.querySelector('.sidebar-account > svg.i')&&(rail||visible(nav.querySelector('.sidebar-account-name'))),'account shows its face and name, without a gear');
    require(!nav.querySelector('.au-rooms-section .mb-ghead, [data-room-new], .mb-sec[data-group="none"] .mb-ghead'),'only owner-created sections have headings');
    require(getComputedStyle(nav.querySelector('.side-foot')).borderTopWidth==='0px','footer has no separator');
    if (compact) {
      require(visible(document.querySelector('.sidebar-toggle')) && main.getBoundingClientRect().left < 1 && Math.abs(main.getBoundingClientRect().width - innerWidth) < 1, "compact content uses the whole window behind a menu button");
      require(nav.inert === !open && main.inert === open, "drawer owns focus and closes access to covered content");
    } else {
      const listWidth=rail?72:296;
      require(Math.abs(nav.getBoundingClientRect().width - listWidth) < 1 && main.getBoundingClientRect().left >= listWidth - 1, "desktop list retains its fixed width");
      require(!visible(document.querySelector('.sidebar-toggle')) && !visible(nav.querySelector('.sidebar-close')), "desktop has no drawer controls");
    }
    const chief = column.querySelector('.mb-chief');
    require(chief && chief.querySelector('b') && chief.querySelector('.av'), "the top member shows its face and name");
    if(chief)require(!document.querySelector('.mb-star'),'no member carries a star');
    if(!rail){const pill=nav.querySelector('.sidebar-apps'),name=pill.querySelector('.nav-t').getBoundingClientRect(),plug=pill.querySelector('.i').getBoundingClientRect(),owner=nav.querySelector('.sidebar-account-name').getBoundingClientRect(),face=nav.querySelector('.sidebar-account .owner-face').getBoundingClientRect();require(name.left>=plug.right+6&&name.left<=plug.right+16&&owner.left>=face.right+6&&owner.left<=face.right+16,'pill and account words start after their own leading mark');}
    const mic=nav.querySelector('.sidebar-dictation').getBoundingClientRect(),home=nav.querySelector('.sidebar-home').getBoundingClientRect();require(Math.abs(mic.width-home.width)<1&&Math.abs(mic.height-home.height)<1&&Math.abs(mic.width-36)<1,'both footer icon buttons share the top controls size');
    if(chief&&!rail&&!chief.matches('.mb-tile')&&(!compact||open))require(Math.abs(chief.querySelector('.av').getBoundingClientRect().width-40)<1&&chief.querySelector('.mb-row-main'),'an unpinned top member is an ordinary row');
    for(const row of column.querySelectorAll('.mb-row')){
      const time=row.querySelector('time');
      if(time&&!row.parentElement.matches(':hover, :focus-within'))require(getComputedStyle(time).opacity!=='0','row time stands beside the name until hover or focus swaps it for the overflow');
    }
    return { check:name, compact, open, folders:column.querySelectorAll('.mb-sec').length };
  }
  if(name==='sidebar-tile'){
    const tile=document.querySelector('#nav .mb-pinned .mb-tile');
    require(tile,'a pinned member is a tile');
    const box=tile.getBoundingClientRect(),face=tile.querySelector(':scope > .av').getBoundingClientRect(),label=tile.querySelector(':scope > b').getBoundingClientRect();
    require(face.width>=64&&Math.abs(face.left+face.width/2-(box.left+box.width/2))<1,'the tile has a larger centered face');
    require(label.top>=face.bottom&&Math.abs(label.left+label.width/2-(box.left+box.width/2))<1,'the name is centered below the face');
    return {check:name,face:face.width};
  }
  if(name==='messaging-paired-aligned'){
    const card=document.querySelector('[data-msg-kind="telegram"]'),mark=card?.querySelector('.msg-head .msg-mark'),face=card?.querySelector('.msg-sub .msg-avatar'),title=[...(card?.querySelectorAll('.row:not(.msg-head):not(.msg-sub) > .lbl')??[])].find(visible);
    require(visible(mark)&&visible(face)&&title,'the bot, a paired person and 中斷 Telegram are shown');
    const left=mark.getBoundingClientRect().left;
    require(Math.abs(face.getBoundingClientRect().left-left)<1&&Math.abs(title.getBoundingClientRect().left-left)<1,'the person and 中斷 Telegram start on the bot mark\'s left edge');
    return {check:name,left};
  }
  if(name==='sidebar-rail'){
    const nav=document.getElementById('nav'),compact=matchMedia('(max-width: 859px)').matches;
    if(compact){
      require(!document.documentElement.hasAttribute('data-sidebar-collapsed')&&!visible(nav.querySelector('.side-edge')),'on a narrow window the list is a drawer: it never folds to a rail and has no edge to drag');
      return {check:name,compact};
    }
    require(document.documentElement.hasAttribute('data-sidebar-collapsed')&&Math.abs(nav.getBoundingClientRect().width-72)<1,'the list collapses to a 72px rail');
    require(!visible(nav.querySelector('.sidebar-account-name')),'the rail shows no names');
    const faces=[...nav.querySelectorAll('.mb-row > .av, .mb-row > .room-avatar')].filter(visible);
    require(faces.length>0&&faces.every(face=>{const box=face.getBoundingClientRect();return Math.abs(box.left+box.width/2-36)<1;}),'every face is centered in the rail');
    require([...nav.querySelectorAll('.mb-item .btn.mb-more, .au-room-row .btn.au-room-more')].every(button=>getComputedStyle(button).display==='none'),'the rail draws no ⋯ over a face; a right click opens its menu');
    const search=nav.querySelector('.side-foot [data-col="search"]').getBoundingClientRect(),add=nav.querySelector('.side-foot [data-col="add"]').getBoundingClientRect(),owner=nav.querySelector('.sidebar-account').getBoundingClientRect();
    require(search.bottom<=add.top&&add.bottom<=owner.top,'search and plus sit above the owner in the rail');
    return {check:name,faces:faces.length};
  }
  if(name==='sidebar-search-before'||name==='sidebar-search-open'){
    const buttons=[...document.querySelectorAll('#nav [data-col]')];
    const positions=buttons.map(button=>button.getBoundingClientRect().toJSON());
    if(name==='sidebar-search-before'){
      require(buttons.map(button=>button.dataset.col).join()==='search,add'&&buttons.every(visible),'search and plus stand ready');
      window.__sidebarSearchPositions=positions;
      return {check:name,positions};
    }
    require(positions.every((box,index)=>Math.abs(box.x-window.__sidebarSearchPositions[index].x)<1&&Math.abs(box.y-window.__sidebarSearchPositions[index].y)<1),'opening search never moves its icon or plus');
    // Grok Bot's search is a card in the middle of the window over a dimmed page (owner, 2026-11-06).
    const card=document.querySelector('#app-popover.side-search'),input=card?.querySelector('.side-search-input');
    require(visible(card)&&document.activeElement===input,'search opens its card with the keys in its field');
    const box=card.getBoundingClientRect();
    require(Math.abs(box.left+box.width/2-innerWidth/2)<=2&&box.width<=560&&box.left>=12&&box.bottom<=innerHeight,'the card stands in the middle of the window');
    require(/\b\d{3,}px\b/.test(getComputedStyle(card).boxShadow),'the page behind the card is dimmed by its wide shadow');
    require(getComputedStyle(document.querySelector('.window-chrome')).backgroundColor==='rgba(0, 0, 0, 0)','the caption takes the same dim as everything else');
    const rows=[...card.querySelectorAll('.side-search-rows > .side-search-row')],add=card.querySelector('.side-search-new');
    require(rows.length>=2&&rows.every(row=>row.querySelector('.av')&&row.querySelector('.side-search-main b')),'every member is a row with its face and name');
    require(getComputedStyle(rows[0]).backgroundColor!=='rgba(0, 0, 0, 0)'&&getComputedStyle(rows[1]).backgroundColor==='rgba(0, 0, 0, 0)','the first row, which Enter opens, carries the soft fill');
    require(visible(add)&&add.getBoundingClientRect().bottom<=box.bottom+1&&add.getBoundingClientRect().top>=rows.at(-1).getBoundingClientRect().top,'新增成員 stands at the foot of the card');
    return {check:name,width:Math.round(box.width),rows:rows.length};
  }
  if (name === "slime-marks-at-rest") {
    const surfaces = [...document.querySelectorAll('.look-slime-board .slime-surface[data-state="idle"]')].filter(visible);
    require(surfaces.length >= 24, `every character is on the board: ${surfaces.length}`);
    let marked = 0;
    for (const surface of surfaces) {
      const drawing = surface.querySelector('svg.slime .slime-marks');
      if (!drawing || !drawing.children.length) continue;
      marked++;
      require(!surface.querySelector('.slime-idle, .slime-loop, .slime-drop'), "idle uses one resting vector without droplets");
      require(!surface.getAnimations({subtree:true}).some(animation => animation.playState === 'running'), "idle has no running animation");
      for (const part of drawing.querySelectorAll('path,circle,ellipse')) require(getComputedStyle(part).visibility === 'visible', "the resting vector wears its costume");
    }
    require(marked >= 20, `the characters with marks were all seen: ${marked}`);
    return {check:name,surfaces:surfaces.length,marked};
  }
  if (name === "dialog-caption") {
    const chrome = document.querySelector('.window-chrome'), dialog = [...document.querySelectorAll('.mb-scrim > .mb-dialog')].find(visible);
    require(dialog, "a dialog is open");
    require(getComputedStyle(chrome).backgroundColor === "rgba(0, 0, 0, 0)", "the caption takes the same dim as everything else");
    require(dialog.getBoundingClientRect().top >= chrome.getBoundingClientRect().bottom, "the dialog starts below the caption, its corners showing");
    const close = chrome.querySelector('.window-close'), box = close.getBoundingClientRect();
    require(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.window-close') === close, "the window buttons still answer over a dialog");
    return {check:name,top:dialog.getBoundingClientRect().top};
  }
  if (name === "sidebar-width") {
    // Grok Bot's list is dragged by its edge between a rail and about 400 px (owner, 2026-11-06).
    if (matchMedia('(max-width: 859px)').matches) return {check:name,compact:true};
    const nav = document.querySelector('#nav'), width = nav.getBoundingClientRect().width, stored = Number(localStorage.getItem('raphael.sidebar.width'));
    require(!document.documentElement.hasAttribute('data-sidebar-collapsed') && width >= 240 && width <= 400, "the list is open, between 240 and 400 px");
    require(Math.abs(width - stored) <= 1 && Math.abs(width - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'))) <= 1, "the width the edge was let go at is the list's, and is kept");
    require(width > 300, "the list is wider than its default");
    const main = document.querySelector('#main').getBoundingClientRect();
    require(Math.abs(main.left - width) <= 2, "the conversation starts where the list ends");
    require(!document.querySelector('[data-sidebar="collapse"]') && visible(nav.querySelector('.mb-top [data-col="search"]')), "no fold button, and search stands at the top of the wider list");
    return {check:name, width:Math.round(width)};
  }
  if (name === "panel-width" || name === "panel-closed") {
    const page = document.querySelector('.page-agent'), panel = page.querySelector('.mb-det');
    if (name === "panel-closed") {
      require(panel.hidden && page.dataset.det !== 'open', "dragged narrower than it can be, the panel closed");
      const trigger = document.querySelector('.conversation-trigger');
      require(visible(trigger) && trigger.getAttribute('aria-expanded') === 'false', "the header's name is there to open it again");
      return {check:name};
    }
    require(visible(panel) && !panel.hidden, "the panel is open");
    const width = panel.getBoundingClientRect().width, set = parseFloat(page.style.getPropertyValue('--pa-det'));
    require(Math.abs(width - set) <= 1 && Number(localStorage.getItem('raphael.panel.width')) === Math.round(set), "the panel takes the width it was dragged to, and keeps it");
    require(width >= 300 && width <= Math.min(720, innerWidth * 0.6) + 1, "within its range");
    const edge = panel.querySelector(':scope > .det-edge'), box = edge.getBoundingClientRect();
    require(edge.getAttribute('role') === 'separator' && Math.abs(box.left - panel.getBoundingClientRect().left) < 1 && getComputedStyle(edge, '::after').content === 'none', "its left edge drags it, with no handle drawn");
    return {check:name, width:Math.round(width)};
  }
  if (name === "sidebar-rail-folded") {
    if (matchMedia('(max-width: 859px)').matches) return {check:name,compact:true};
    const folder = document.querySelector('#nav .mb-sec[data-group="1"]');
    require(folder.dataset.open === "false" && folder.querySelector('.mb-gbody').inert, "the folder stays folded in the rail");
    require(folder.querySelectorAll('.mb-row').length > 0 && ![...folder.querySelectorAll('.mb-row')].some(visible), "a folded folder shows no faces in the rail");
    const open = document.querySelector('#nav .mb-sec[data-group="2"] .mb-row');
    require(visible(open), "an open folder keeps its faces in the rail");
    return {check:name};
  }
  if (name === "composer-slot-stop" || name === "composer-slot-send" || name === "composer-slot-armed") {
    const form = document.querySelector('.page-agent .composer'), send = form.querySelector('.cmp-send'), stop = form.querySelector('.cmp-voice');
    require(form.dataset.taskState === "running", "the work is still running");
    const shown = name === "composer-slot-send" ? send : stop, gone = shown === send ? stop : send;
    require(visible(shown) && !visible(gone), `${name}: one control fills the slot`);
    const box = shown.getBoundingClientRect(), place = `${Math.round(box.left)},${Math.round(box.top)},${box.width},${box.height}`;
    window.__lookSlot ??= place;
    require(window.__lookSlot === place, `the slot never moves: ${window.__lookSlot} then ${place}`);
    if (name === "composer-slot-armed") {
      require(stop.dataset.cancelArmed === "true", "Escape arms the Stop it shows");
      require(form.querySelector('.cmp-input').value === "還沒寫完", "the words stay in the field");
    }
    return {check:name,place};
  }
  if (name === "composer-queued" || name === "composer-queued-withdraw" || name === "composer-queued-stop" || name === "room-send-while-working") {
    const calls = window.__look.calls;
    if (name === "composer-queued") {
      const queued = [...document.querySelectorAll('.tn[data-status="queued"]')];
      require(queued.length === 2, "both queued messages are visible");
      require(queued.map(node => node.querySelector('.message-text').textContent).join('|') === "第二個範例請求|第三個範例請求", "the bubbles retain send order");
      require(queued.every(node => node.querySelector('button[data-act="more-message"][data-owner-act="cancel"]') && !node.querySelector('[data-owner-act="edit"]')), "queued bubbles offer withdraw instead of edit in their menu");
      require(queued.every(node => visible(node.querySelector('.queued-mark'))), "each queued mark is visible");
      const presence = [...document.querySelectorAll('.thread .live-presence')];
      require(presence.length === 1 && presence[0].getBoundingClientRect().top >= queued[1].getBoundingClientRect().bottom, "one live presence follows the newest message");
      const bubbles = queued.map(node => node.querySelector('.bubble').getBoundingClientRect());
      require(bubbles[1].top - bubbles[0].bottom <= 42, "consecutive owner bubbles keep a speaker-sized gap");
      require(!calls.some(call => call.method === "agent.history.stop" || call.method === "worker.cancel"), "admission stops no work");
      return {check:name,gap:bubbles[1].top-bubbles[0].bottom};
    }
    if (name === "composer-queued-withdraw") {
      require(document.querySelector('.cmp-input').value === "第二個範例請求", "withdraw returns the original words");
      require(calls.filter(call => call.command === "agent_retract").length === 1, "withdraw uses the existing path exactly once");
      require(document.querySelector('.composer').dataset.taskState === "running", "the first turn keeps working");
    } else if (name === "composer-queued-stop") {
      require(document.querySelector('.cmp-input').value === "目前草稿\n\n第二個範例請求\n\n第三個範例請求", "Stop returns every queued draft after current words");
      const stopped = calls.filter(call => call.method === "agent.history.stop");
      require(stopped.length === 1 && !/^(901|902)$/.test(stopped[0].params?.session_id ?? ''), "Stop targets the running turn exactly once");
    } else {
      const sent = calls.filter(call => call.method === "rooms.send");
      require(sent.length === 2 && sent[0].params.text === "第一個範例請求" && sent[1].params.text === "第二個範例請求", "room requests enter in order");
      require(sent[0].params.request_id !== sent[1].params.request_id, "room messages have independent admission identities");
      require(document.querySelector('#room-message').value === "", "the room field is ready for the next message");
      require(document.querySelector('.au-room-pane .composer').dataset.taskState === "running", "members keep working while the owner sends");
      require(!calls.some(call => call.method === "rooms.stop" || call.method === "worker.cancel"), "room admission stops nothing");
    }
    return {check:name};
  }
  if (name === "owner-additions-in-order") {
    const words = [...document.querySelectorAll('.thread .tn .owner-message .message-text')].map(node => node.textContent.trim());
    const at = ["第一則補充", "第二則補充", "第三則補充"].map(text => words.indexOf(text));
    require(at.every((index, i) => index >= 0 && (i === 0 || index > at[i - 1])), `every message shows, in the order sent: ${at}`);
    require(!window.__look.calls.some(call => call.method === "agent.history.stop" || call.method === "worker.cancel"), "sending stops nothing");
    require(window.__look.calls.filter(call => call.command === "agent_ask_text").length === 3, "each message went out once");
    const presence = [...document.querySelectorAll('.thread .live-presence')];
    const newest = document.querySelector('.tn[data-id="903"]');
    require(presence.length === 1 && presence[0].getBoundingClientRect().top >= newest.getBoundingClientRect().bottom, "live work stays under the newest addition");
    return {check:name,at};
  }
  if (name === "preview-card-wide") {
    const cards = [...document.querySelectorAll('.thread .preview-card')].filter(visible);
    require(cards.length === 2, `both links have a card: ${cards.length}`);
    const room = cards[0].closest('.ra-body').getBoundingClientRect().width, widths = cards.map(card => card.getBoundingClientRect().width);
    for (const width of widths) require(width >= Math.min(440, room) - 1, `a card is as wide as the media cards, whatever its words: ${width} of ${room}`);
    require(widths[0] === widths[1], `an internal address and a public one are the same width: ${widths}`);
    const internal = cards[0].querySelector('.preview-meta').innerText;
    require(internal.split(/\n/).filter(line => line.includes("127.0.0.1")).length === 1, `the address is not repeated: ${internal}`);
    for (const line of cards[0].querySelectorAll('.preview-meta > span')) require(line.scrollWidth <= cards[0].clientWidth, "the words stay inside the card");
    return {check:name,widths};
  }
  if (name === "owner-bubble-tinted" || name === "owner-bubble-neutral") {
    const bubble = [...document.querySelectorAll('.owner-message .bubble')].find(visible);
    const style = getComputedStyle(bubble), chat = bubble.closest('.mb-chat');
    const channel = value => value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
    const light = color => { const [r, g, b] = color.match(/[\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const [a, b] = [light(style.backgroundColor), light(style.color)], ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    require(ratio >= 4.5, `the words read on the bubble: ${ratio}`);
    const probe = document.createElement('i'); probe.style.background = 'var(--bubble)'; document.documentElement.append(probe);
    const neutral = getComputedStyle(probe).backgroundColor; probe.remove();
    if (name === "owner-bubble-neutral") {
      require(style.backgroundColor === neutral, `this conversation stays neutral: ${style.backgroundColor}`);
    } else {
      require(style.backgroundColor !== neutral, "the owner's bubble wears the member's colour");
      for (const link of bubble.querySelectorAll('.message-link, .btn.message-expand')) require(getComputedStyle(link).color === style.color, "a link and the expand control take the bubble's words colour");
      require(chat && chat.dataset.memberBubble !== undefined, "the colour comes from the member's conversation");
    }
    return {check:name,background:style.backgroundColor,ratio:Number(ratio.toFixed(2))};
  }
  if (name === "sidebar-folded") {
    const folder = document.querySelector('.mb-sec[data-group="1"]');
    require(folder.dataset.open === "false" && folder.querySelector('.mb-gbody').inert, "collapsed folder excludes its rows from focus");
    require(JSON.parse(localStorage.getItem('raphael.sidebar.folders')).includes(1), "folder choice persists");
    return {check:name};
  }
  if (name === "sidebar-room-avatar") {
    require(!document.querySelector('.au-room-heading > .room-avatar'), "the header shows its participants once");
    const participants=[...document.querySelectorAll('.au-room-faces .au-room-participant')];
    require(participants.length>=2, "the header retains its participant row and chief crown");
    require(participants.slice(1).every((face,i)=>face.getBoundingClientRect().left<participants[i].getBoundingClientRect().right),'header faces overlap');
    const composites=[...document.querySelectorAll('.room-avatar')].filter(visible);
    for (const composite of composites) {
      const box=composite.getBoundingClientRect();
      require(Math.abs(box.width-40)<1&&Math.abs(box.height-40)<1,'composite stays in the sidebar avatar slot');
      const faces=[...composite.children].map(face=>{const style=getComputedStyle(face),rect=face.getBoundingClientRect();require(style.overflow==='visible'&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.borderRadius==='0px'&&style.filter==='none'&&style.boxShadow==='none','bare faces keep hats without discs, crop or effects');require(rect.left>=box.left-1&&rect.right<=box.right+1&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1,'face slots stay inside the box');return rect;});
      if(faces.length>1)require(faces.some((face,i)=>faces.slice(i+1).some(other=>Math.min(face.right,other.right)>Math.max(face.left,other.left)+1&&Math.min(face.bottom,other.bottom)>Math.max(face.top,other.top)+1)),'the member faces form an overlapping cluster');
    }
    return {check:name,composites:composites.length,participants:participants.length};
  }
  if (name === "sidebar-room-summary") {
    const roomId = context.roomId ?? 1;
    const row = document.querySelector(`.au-room-row [data-room="${roomId}"]`);
    const last = context.latest ?? [...window.__look.data.messages].reverse().find(message => message.room_id === roomId && message.status === 'done' && message.text?.trim() && message.text.trim() !== '(pass)');
    require(last && row?.querySelector('.mb-row-p')?.textContent.endsWith(last.text.replace(/\s+/g, ' ')), "a room with messages shows its latest visible message, after who said it");
    const time = row.querySelector('time');
    require(visible(time) && time.dateTime === new Date(last.created).toISOString(), "that room's own row shows its latest message time");
    return {check:name, preview:row.querySelector('.mb-row-p').textContent, datetime:time.dateTime};
  }
  if (name === "sidebar-unread") {
    require(document.querySelector('.mb-col .mb-dot.is-unread') && document.querySelector('.mb-col time'), "new messages retain unread and time");
    require(document.querySelector('.au-room-row [data-room="1"] .mb-dot.is-unread'), "the unread room has its own unread marker");
    require(document.querySelector('.mb-col .room-avatar > .av'), "room list uses actual member faces");
    return {check:name};
  }
  if (name === "owner-avatar") {
    require(document.querySelector('[data-owner-photo] .owner-face'), "account exposes the shared photo picker");
    return {check:name};
  }
  if (name === "owner-avatar-saved") {
    const photo = window.__look.data.settings.owner_photo;
    require(photo?.startsWith('data:image/webp;base64,'), "the cropped owner photo is saved as bounded WebP");
    require(window.__look.calls.some(call => call.method === 'settings.set' && call.params.key === 'owner_photo'), "saving crosses the existing settings boundary");
    const faces = [...document.querySelectorAll('.sidebar-account .owner-face img, .me > .owner-face img')];
    require(faces.length >= 1 && faces.every(face => face.getAttribute('src') === photo), "the footer and any outgoing face share the saved photo");
    require(faces.every(face => face.naturalWidth === 192 && face.naturalHeight === 192), "owner photo is bounded to 192px");
    return {check:name, faces:faces.length};
  }
  if (name.startsWith("computer-") || ['desktop-owner','desktop-handback','desktop-viewer','desktop-offline','desktop-absent'].includes(name)) {
    const panel=document.querySelector('.desktop-panel'), frame=document.querySelector('iframe[data-desktop-stream]'), calls=window.__look.calls;
    if(name==='desktop-absent'){
      require(visible(panel)&&visible(panel.querySelector('.desktop-message')),'absent Docker says what is missing in the existing panel');
      require(visible(panel.querySelector('[data-act="docker-download"]')),'absent Docker offers its download in the computer panel');
      const downloadStyle = getComputedStyle(panel.querySelector('[data-act="docker-download"]'));
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const ink = luminance(downloadStyle.color), surface = luminance(downloadStyle.backgroundColor);
      require((Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05) >= 4.5, 'Docker download text retains readable contrast over the desktop frame');
      require(!panel.querySelector('.desktop-message').textContent.includes('設定 › 拉斐爾'),'Docker recovery never points to the removed Settings pane');
      require(!calls.some(call=>call.method==='computer.viewer_open'),'reading the missing state never starts a computer');
      return {check:name};
    }
    require(panel.closest('.mb-det') && (visible(panel) || visible(frame) || name==='computer-takeover-done' || name==='desktop-handback') && ![...document.querySelectorAll('[role="dialog"]')].some(visible), 'computer uses the existing viewer in its panel or card');
    const screenHit=panel.querySelector('[data-desktop="enlarge"]');
    if(frame&&!screenHit.hidden)require(getComputedStyle(screenHit).backgroundColor==='rgba(0, 0, 0, 0)','screen click target stays transparent including hover');
    const events=document.querySelectorAll('[data-desktop-work]');
    if(name.startsWith('computer-'))require(events.length===1&&events[0].matches(name==='computer-panel'?'.conversation-event-line':'.conversation-card')&&events[0].closest('.tn')?.dataset.id==='2','one work presentation belongs to the private turn');
    if(name==='computer-takeover')require(panel.querySelector('.desktop-request').textContent.includes('登入'),'request sits above the live screen');
    if(name==='computer-takeover-owner') {
      require(visible(document.querySelector('[data-card-desktop="return"]')), 'one explicit done action in the card');
      require(!panel.hasAttribute('data-expanded') && frame.closest('[data-card-desktop-screen]'), 'owner input stays in the conversation card');
      require(frame.contentDocument.defaultView.__desktopAcceptedKeys > 0, 'synthetic keyboard input reaches the RFB surface');
      require(!calls.some(call => JSON.stringify(call.params ?? {}).includes('synthetic-owner-input')), 'owner input never enters an RPC');
    }
    if(name==='computer-takeover-done')require(calls.filter(call=>call.method==='computer.viewer_control'&&!call.params.held&&call.params.takeover==='private-takeover-request').length===1,'one explicit handback with the current nonce');
    if(name==='computer-takeover-owner'||name==='desktop-owner'){
      require(panel.dataset.interactive==='true'&&getComputedStyle(frame).pointerEvents==='auto','click enables input in place');
        require(calls.filter(call=>call.method==='computer.viewer_open'&&call.params.member_id===1).length===1,'takeover keeps the same member session');
      require(frame.contentDocument.defaultView.__desktopConnections===1,'takeover keeps the same noVNC connection');
      const latency=Number(panel.dataset.controlLatencyMs);require(Number.isFinite(latency)&&latency<300,`local click-to-interactive ${latency}ms < 300ms`);
      require(!panel.dataset.acceptedInputLatencyMs,'the press on the button is not replayed into the computer');
      return {check:name,clickToInteractiveMs:latency,connections:1};
    }
    if(name==='desktop-handback') {
      require(panel.dataset.interactive==='false' && !frame && calls.some(call=>call.method==='computer.viewer_close'), 'handback closes the stream and returns to the conversation');
      return {check:name};
    }
      if(name==='desktop-viewer'){
        require(panel.hasAttribute('data-expanded')&&calls.filter(call=>call.method==='computer.viewer_open'&&call.params.member_id===1).length===1,'expansion uses the same member frame/session');
        require(frame.getBoundingClientRect().width>innerWidth*0.9,'expanded screen uses the window width');
      }
    if(name==='desktop-offline'){
      require(!frame,'offline screen has no blank frame');
      if(['starting','building','preparing'].includes(panel.dataset.desktopState)) {
        require(visible(panel.querySelector('.desktop-stage')) && !panel.querySelector('.desktop-preparation li'), 'preparation names only the current stage');
        require(!!panel.querySelector('progress[value]') === (panel.dataset.desktopState === 'building'), 'only a real fixture percent draws progress');
      }
      else require(visible(panel.querySelector('[data-desktop="retry"]')),'failure offers contextual retry');
      const bounds = panel.querySelector('.desktop-screen').getBoundingClientRect();
      for (const content of panel.querySelectorAll('.desktop-preparation > *')) {
        const box = content.getBoundingClientRect();
        require(box.top >= bounds.top && box.bottom <= bounds.bottom, 'preparation words and progress stay inside the screen');
      }
    }else require(visible(frame)||name==='computer-takeover-done','the active view streams the live screen or retains its settled card');
    return {check:name};
  }
  if (name === "host-settings-layout") {
    const panel = document.querySelector('.computer-location-popover');
    require(visible(panel), 'the shared location popover is visible');
    const lines = [...panel.querySelectorAll('p, .lbl .t')].filter(visible).flatMap(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.left);
    });
    const controls = [...panel.querySelectorAll('.sel, .field')].filter(visible).map(element => element.getBoundingClientRect());
    const left = panel.querySelector('.computer-location-purpose').getBoundingClientRect().left;
    const trigger = panel.querySelector('.sel'), span = trigger.querySelector('span'), style = getComputedStyle(trigger);
    const text = document.createRange(); text.selectNodeContents(span);
    const textLeft = text.getBoundingClientRect().left, contentLeft = trigger.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const failures = [];
    if (!lines.length || !controls.length || [...lines, ...controls.map(rect => rect.left)].some(x => Math.abs(x - left) > 1)) failures.push('all visible text lines and controls share one left edge within 1px');
    if (controls.some(rect => Math.abs(rect.right - controls[0].right) > 1)) failures.push('the select and SSH field share their right edge within 1px');
    if (getComputedStyle(span).textAlign !== 'left' || Math.abs(textLeft - contentLeft) > 1) failures.push('select trigger text is left-aligned inside its standard padding');
    require(!failures.length, failures.join('; '));
    return { check: name, left, lines, controls: controls.map(rect => ({ left: rect.left, right: rect.right })), textLeft, contentLeft };
  }
  if (name === "host-settings-local" || name === "host-settings-error") {
    const panel = document.querySelector('.computer-location-popover');
    require(visible(panel) && panel.textContent.includes('每位成員'), "the popover explains the shared scope");
    if (name.endsWith('local')) require(!panel.querySelector('input') && document.querySelector('[data-computer-location]').textContent.includes('本機'), "the header names the local host without repeating it in the popover");
    else require(panel.querySelector('input')?.value === 'studio-mini' && visible(panel.querySelector('[role="alert"]')), "remote failure stays in its host popover");
    return {check:name};
  }
  if (["settings-computer-result", "settings-computer-open", "settings-owner", "settings-tools", "settings-raphael-memory", "settings-raphael-voice", "settings-draft-grouped", "settings-speech-service"].includes(name)) {
    if (name === 'settings-computer-result') require(document.querySelectorAll('.set-hit').length === 1, "computer location has one search result");
    else if (name === 'settings-computer-open') require(!!document.querySelector('.modal-scrim[hidden]') && visible(document.querySelector('.mb-det [data-computer-location]')), "search closes Settings and opens the computer panel");
    else if (name === 'settings-owner') require(visible(document.querySelector('[data-owner="owner_name"]')) && !!document.querySelector('#agent-city') && !!document.querySelector('[data-mem-space="shared"]'), "owner profile retains weather and shared memory");
    else if (name === 'settings-tools') require(document.querySelector('[data-pane="tools"]')?.getAttribute('aria-current') === 'page' && !document.querySelector('[data-pane="agent"]'), "legacy agent pane resolves to Tools");
    else if (name === 'settings-raphael-memory') require(visible(document.querySelector('.mb-det [data-mem-space="own"]')) && document.querySelector('.mb-det [data-mem-space="own"]').textContent.includes('拉斐爾'), "Raphael memory belongs to the member panel");
    else if (name === 'settings-raphael-voice') { require(visible(document.querySelector('.mb-det #svc-voice-id')), "Raphael voice uses the member resource controls"); require(window.__look.calls.some(call => call.method === 'tts.preview') && window.__look.calls.some(call => call.method === 'settings.set' && call.params.key === 'tts_fish_voice'), 'preview retains its existing settings and RPC boundaries'); }
    else if (name === 'settings-speech-service') { require(visible(document.querySelector('#svc-dialog [type="password"]')) && !document.querySelector('#svc-voice-id, #svc-dialog [data-svc="try"]'), 'shared speech setup retains its key and leaves personal voice controls in details'); }
    else if (name === 'settings-draft-grouped') require(!!document.querySelector('.mb-panel-pages [data-det="draft"]') && document.querySelectorAll('.mb-panel-pages').length === 1, 'the draft switch belongs to the same resource list');
    return {check:name};
  }
  if (name === "host-settings-remote") {
    const input = document.querySelector('#computer-ssh-alias');
    require(visible(input) && input.value === 'studio-mini', "remote alias stays in its field");
    require(window.__look.calls.some(call => call.method === 'settings.set' && call.params.key === 'computer_ssh_alias' && call.params.value === 'studio-mini'), "the alias is saved through the existing settings boundary");
    require(!document.querySelector('[data-act="docker-download"]'), "remote hosts never require local Docker Desktop");
    require(visible(document.querySelector('[data-k="computer-host"]')), "the shared location dropdown stays available");
    return { check: name };
  }
  if (name === "host-panel-collapsed") {
    require(document.querySelector('.conversation-trigger')?.getAttribute('aria-expanded') === 'false', "closing the preview keeps its conversation");
    require(!document.documentElement.hasAttribute('data-desktop-expanded'), "collapse clears expansion");
    return { check: name };
  }
  if (name === "host-settings-invalid") {
    const input = document.querySelector('#computer-ssh-alias'), error = document.querySelector('[data-computer-host-error]');
    require(input?.value === '-oBad' && input.getAttribute('aria-invalid') === 'true' && visible(error), "invalid aliases remain in the field with a contextual error");
    require(getComputedStyle(error).whiteSpace === 'normal' && error.scrollWidth <= error.clientWidth + 1, "the complete alias error wraps inside its settings column");
    require(!window.__look.calls.some(call => call.method === 'settings.set' && call.params.key === 'computer_ssh_alias'), "invalid aliases never reach settings storage");
    return { check: name };
  }
  if (name === "desktop-install") {
    const buttons = document.querySelectorAll('[data-act="docker-download"]');
    require(buttons.length === 1 && visible(buttons[0]) && !buttons[0].disabled, "one usable Docker download action");
    return { check: name };
  }
  if (name === "desktop-frame") {
    const shell = document.querySelector('.desktop-shell');
    const inline = document.querySelector('[data-card-desktop-screen] iframe:not([hidden]), [data-card-screen] iframe:not([hidden])');
    const frame = inline ?? document.querySelector('.desktop-panel iframe');
    // Since the panel tabs the computer tab's header (state word and location) heads the screen; the old caption is hidden.
    const heading = inline ? inline.closest('.conversation-card')?.querySelector('.card-head') : document.querySelector('.desktop-panel[data-expanded] .desktop-dock') ?? document.querySelector('.desktop-location-header');
    // Native WebView checks enter the cross-origin viewer itself; look can inspect both documents.
    const embedded = !!document.querySelector('#noVNC_container');
    if (!embedded) {
      require(visible(inline?.parentElement ?? shell) && visible(heading), "the member computer has one frame and heading");
      require(document.querySelectorAll('.desktop-panel iframe, [data-card-desktop-screen] iframe, [data-card-screen] iframe').length === 1, "the existing viewer has one iframe");
      const channels = getComputedStyle(document.querySelector('.desktop-screen') ?? shell).backgroundColor.match(/[\d.]+/g).map(Number);
      require(channels.slice(0, 3).every(value => value <= 40), "the frame stays dark in both themes");
      if (!inline) require(!shell.querySelector('[data-desktop="collapse"]'), "preview has no fold control");
    }
    const doc = frame?.contentDocument ?? document;
    const win = doc.defaultView, canvas = doc.querySelector('#noVNC_container canvas');
    require(win.getComputedStyle(doc.body).backgroundColor === 'rgb(23, 23, 23)', "viewer gutters share the dark frame surface");
    require(visible(canvas) && canvas.width > 100, "the noVNC framebuffer is rendered");
    const box = canvas.getBoundingClientRect(), width = win.innerWidth, height = win.innerHeight;
    require(Math.min(Math.abs(box.width - width), Math.abs(box.height - height)) <= 2, "the canvas fills the frame on its limiting axis");
    require(box.left >= -1 && box.top >= -1 && box.right <= width + 1 && box.bottom <= height + 1, "the whole desktop fits without clipping");
    require(Math.abs(box.width / box.height - canvas.width / canvas.height) < 0.01, "the desktop keeps its framebuffer aspect ratio");
    const controls = [...doc.querySelectorAll('[id^="noVNC_"]')].filter(el => /control|handle|button|panel|status|dlg|logo|hint/i.test(el.id) && el.checkVisibility({ checkVisibilityCSS: true }) && visible(el));
    require(!controls.length, "no noVNC control element is visible");
    for (let el = canvas; el; el = el.parentElement) {
      const style = win.getComputedStyle(el);
      require([style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].every(value => parseFloat(value || "0") === 0), "no standalone noVNC background curve clips the desktop");
    }
    for (const x of [box.left + 2, box.right - 2]) for (const y of [box.top + 2, box.bottom - 2]) require(doc.elementFromPoint(x, y) === canvas, "every desktop corner is unobscured");
    return { check: name, canvas: box.toJSON(), framebuffer: { width: canvas.width, height: canvas.height }, viewport: { width, height }, visibleControls: controls.length };
  }
  if (name === "skill-learned-notice") {
    const notice = document.querySelector('.conversation-event-line'), reply = notice?.closest('.tn')?.querySelector('.ra');
    require(reply && !!(reply.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING), "learning review notices follow the reply that produced them");
    require([...document.querySelectorAll('.conversation-event-line')].some(el => visible(el) && el.textContent.includes("學會了：research-summary")), "a learned skill has one localized conversation line");
    require(visible(document.querySelector('.conversation-event-line .sys.event-line > .i')), "learned notices use the shared quiet system event with its small icon");
    require(!document.querySelector('.work-section')?.textContent.includes('skill_learned'), "internal skill payload never enters public work");
    return { check: name };
  }
  if (name === "member-shared-source") {
    const control = document.querySelector('[data-res="skill-toggle"][data-id="32"]'), row = control?.closest('.mp-resource');
    require(visible(control) && control.getAttribute('aria-checked') === 'true', "member details retain the enabled shared skill switch");
    require(row.textContent.includes('共享 · ~/.codex/skills/source-check') && !row.textContent.includes('local:'), "member details use the same readable source label");
    require(!row.querySelector('[data-res="skill-menu"]'), "inherited skills remain editable only in the library");
    return { check: name };
  }
  if (name === "growing-skills") {
    require(document.querySelector('.mb-det').textContent.includes("2026/10/29"), "skill dates follow the Chinese UI rather than the browser locale");
    const editor = document.querySelector('#mp-skill-text');
    require(visible(editor) && editor.value.includes("## Verification"), "the actual saved skill opens in the existing member pane");
    require(document.querySelector('.mb-det').textContent.includes("自行學會"), "learned provenance and date are shown");
    const learned = [...document.querySelectorAll('.mb-det .mp-resource')].find(row => row.querySelector('b')?.textContent === 'research-summary');
    require(learned?.querySelectorAll('[data-skill-provenance]').length === 1 && learned.querySelector('[data-skill-provenance]').textContent === '自行學會 · 2026/10/29', "a learned skill has exactly one localized origin and date line");
    const calls = window.__look.calls;
    require(calls.some(c => c.method === "members.skills.read"), "opening reads the real skill boundary");
    if (window.__look.data.skills[0].member_id === 1) require(!calls.some(c => c.method === "members.skills.update" || c.method === "members.skills.delete"), "reading the editor never mutates skills");
    else require(calls.some(c => c.method === "members.skills.delete") && calls.some(c => c.method === "members.skills.update" && c.params.undo), "Raphael deletes and restores through the same owner boundary");
    return { check: name };
  }
  if (name === "confirm-menu-label" || name === "confirm-menu-asks") {
    // R-UI-56: the item in the ⋯ names what it destroys, and its first press only asks.
    const item = document.querySelector('#app-popover [data-confirm-item]');
    require(visible(item) && item.classList.contains("danger"), "the ⋯ opens a danger item");
    require(document.querySelector('[data-overflow][aria-expanded="true"]'), "the menu belongs to a ⋯ button");
    require(/^確定/.test(item.textContent.trim()) === (name === "confirm-menu-asks"), `the item says ${item.textContent.trim()}`);
    const destroying = ["memory.clear", "memory.summary_clear", "secrets.clear_openrouter_key", "history.clear", "agent.history.clear"];
    require(!window.__look.calls.some(call => destroying.includes(call.method)), "nothing is destroyed before the second press");
    return { check: name };
  }
  if (name === "memory-clear-done") {
    const clears = window.__look.calls.filter(call => call.method === "memory.clear");
    require(clears.length === 1 && clears[0].params.space === "own", "one clear, of the member's own section");
    require(document.querySelector('.mb-det [data-mem-space="shared"] [data-mem="section-more"]'), "the shared document keeps its text and its ⋯");
    require(!document.querySelector('.mb-det [data-mem-space="own"] [data-mem="section-more"]'), "an empty section has nothing to clear");
    return { check: name };
  }
  if (name === "memory-summary-done") {
    require(window.__look.calls.some(call => call.method === "memory.summary_clear"), "the summary was cleared through the core");
    require(!window.__look.calls.some(call => call.method === "memory.clear"), "the notes were left alone");
    return { check: name };
  }
  if (name === "usage-key-removed") {
    require(window.__look.calls.some(call => call.method === "secrets.clear_openrouter_key"), "the key was removed through the core");
    require(visible(document.querySelector("#key-input")) && !document.querySelector('[data-act="key-menu"]'), "the row asks for a key and has nothing left to remove");
    return { check: name };
  }
  if (name === "messaging-user-removed") {
    require(window.__look.calls.some(call => call.method === "messaging.telegram.remove_user" && call.params.user_id === "42"), "the person was removed through the core");
    return { check: name };
  }
  if (name === "local-model-menu") {
    require(document.querySelector('#app-popover [data-pick="delete"]').textContent.includes("SenseVoice"), "the item names the model");
    require(!document.querySelector('.lm-row [data-act="delete"], .lm-del'), "no delete stands in the row");
    return { check: name };
  }
  if (name === "local-model-asks") {
    require(visible(document.querySelector('.lm-row[data-name="sensevoice"] .lm-confirm')), "the row asks before anything is deleted");
    require(!window.__look.calls.some(call => call.method === "models.delete"), "nothing is deleted before the answer");
    return { check: name };
  }
  if (name === "memory-document") {
    const own = document.querySelector('.mb-det [data-mem-space="own"]');
    const entries = [...own.querySelectorAll(".mem-doc .mem-entry")];
    require(entries.length >= 3 && entries.every(visible), "the memory reads as a document, a paragraph to an entry");
    require(!document.querySelector('.mb-det .mem-sub, .mb-det .mem-type, .mb-det [data-mem="more"], .mb-det #mb-memory-new'), "no rows, no type labels, no menu on each line");
    require(own.querySelector(".mem-tag")?.textContent === "待確認" && !own.textContent.includes("（待確認）"), "what nobody confirmed wears a tag");
    require(visible(own.querySelector('button[data-mem="edit"]')), "編輯 is a real button");
    const body = own.querySelector(".mem-doc");
    require(!["auto", "scroll"].includes(getComputedStyle(body).overflowY) && body.scrollHeight <= body.clientHeight + 1, "the document has no scroll of its own");
    require(!window.__look.calls.some(call => call.method === "memory.update"), "reading writes nothing");
    return { check: name };
  }
  if (name === "memory-editor") {
    const box = document.querySelector('.mb-det [data-mem-space="own"] textarea.mem-body');
    require(visible(box) && document.activeElement === box, "the box is open and has the focus");
    require(box.value.includes("專案每週三檢查原型") && box.value.includes("（待確認）"), "the box holds the whole document, as the file has it");
    require(box.scrollHeight <= box.clientHeight + 1, "the box grows with its text and never scrolls");
    const editor = box.closest("[data-mem-editor]");
    require(visible(editor.querySelector('[data-mem="save"]')) && visible(editor.querySelector('[data-mem="cancel"]')), "取消 and 儲存 are on screen");
    require(/\/ 2,200/.test(editor.querySelector(".mem-count")?.textContent ?? ""), "the box says how full the file is");
    return { check: name };
  }
  if (name === "member-edit-memory") {
    const box = document.querySelector("#mp-memory");
    require(visible(box) && box.value.includes("專案每週三檢查原型") && box.value.includes("（待確認）"), "the box holds the member's whole document");
    require(box.scrollHeight <= box.clientHeight + 1, "the box grows with its text and never scrolls");
    require(document.querySelectorAll('.mb-dialog [data-dlg="save"]').length === 1 && !document.querySelector('.mp-page:not([hidden]) .btn.sm'), "one 儲存, the dialog's own");
    return { check: name };
  }
  if (name === "settings-memory") {
    const shared = document.querySelector('[data-mem-space="shared"]');
    require(visible(shared) && !document.querySelector('[data-mem-space="own"]'), "General contains only shared owner memory");
    require(shared.querySelector(".mem-from")?.textContent.startsWith("拉斐爾 · "), "a shared entry says whom the owner told");
    return { check: name };
  }
  if (name === "memory-saved") {
    const saved = window.__look.calls.filter(call => call.method === "memory.update");
    require(saved.length === 1 && saved[0].params.space === "own" && saved[0].params.member_id === 1 && typeof saved[0].params.revision === "string", "one write, of this member's file, from the copy it was opened on");
    const own = document.querySelector('.mb-det [data-mem-space="own"]');
    require(own.textContent.includes("使用者改過的一段") && !own.textContent.includes("上一輪檢查"), "the document reads as saved");
    return { check: name };
  }

  if (name === "message-no-inner-scroll") {
    for (const node of document.querySelectorAll('.chat-message, .chat-message .bubble, .chat-message .ans, .message-text, .message-code pre')) {
      if (!visible(node)) continue;
      const style = getComputedStyle(node);
      require(!['auto', 'scroll'].includes(style.overflowY) || node.scrollHeight <= node.clientHeight + 1, `message has an inner vertical scrollbar: ${node.className}`);
      require(node.matches('.rich-block.message-code pre') || !['auto', 'scroll'].includes(style.overflowX) || node.scrollWidth <= node.clientWidth + 1, `message has an inner horizontal scrollbar: ${node.className}`);
    }
    return { check: name };
  }
  if (name === "message-no-raw-envelope") {
    for (const node of document.querySelectorAll('.ra .message-text')) {
      let value;
      try { value = JSON.parse(node.textContent.trim()); } catch { continue; }
      require(!value || Array.isArray(value) || typeof value !== 'object' || !('text' in value || 'messages' in value), "a conversation never renders a raw reply envelope");
    }
    return { check: name };
  }
  if (name === "reply-split") {
    const messages = [...document.querySelectorAll('.tn[data-id="2"] .ra-body .chat-message[data-reply]')];
    require(messages.length === 3, "three authored messages have separate bubbles");
    require(messages[1].querySelector('ul') && messages[2].querySelector('pre'), "lists and code blocks remain whole");
    return { check: name, messages: messages.length };
  }
  if (name === "reply-full") {
    const replies = [...document.querySelectorAll('.ra .chat-message:has(> .ans:not(.progress))')];
    require(replies.length > 0, "reply bubbles are present");
    for (const message of replies) {
      require(!message.hasAttribute('data-expandable') && !message.querySelector('[data-act="expand-message"]'), "replies never collapse");
      const text = message.querySelector('.message-text');
      if (text) require(text.clientHeight >= text.scrollHeight - 1, "the full reply is readable");
    }
    return { check: name, replies: replies.length };
  }
  if (name === "conversation-up" || name === "conversation-bottom") {
    const scroll = [...document.querySelectorAll('.ra-scroll')].find(visible);
    require(scroll, "a conversation scrollport is visible");
    require(getComputedStyle(scroll).scrollbarWidth === 'none' && scroll.offsetWidth - scroll.clientWidth <= 1, "only content occupies the message scrollport");
    const latest = scroll.parentElement.querySelector('.conversation-latest');
    require(visible(latest) === (name === "conversation-up"), "latest is visible only away from the bottom");
    if (visible(latest)) {
      const box = latest.getBoundingClientRect(), style = getComputedStyle(latest);
      require(Math.abs(box.width - box.height) <= 1 && parseFloat(style.borderRadius) > 0 && parseFloat(style.borderRadius) < box.width / 2, "latest is a rounded square button (R-UI-98)");
      require(style.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(style.borderWidth) >= 1, "latest has its own opaque surface above message content");
      const composer = [...scroll.parentElement.parentElement.querySelectorAll('.composer')].find(visible)?.getBoundingClientRect();
      require(composer && Math.abs(box.left + box.width / 2 - (composer.left + composer.width / 2)) <= 2 && box.bottom <= composer.top && composer.top - box.bottom <= 24, "latest sits centred just above the composer");
    }
    return { check: name, top: scroll.scrollTop, height: scroll.scrollHeight };
  }
  if (name === "learned-pill") {
    const pill = document.querySelector('#learned-pill');
    require(visible(pill) && !!pill.querySelector('img').getAttribute('src'), "one learned pill has Raphael's emblem");
    require(pill.textContent.includes('Composio') && !!pill.querySelector('button').textContent, "the batch and Undo are visible");
    return { check: name };
  }
  if (["message-preview", "message-expanded", "message-preview-member", "message-expanded-member"].includes(name)) {
    const message = [...document.querySelectorAll('.chat-message')].find(node => node.textContent.includes('整理每日新聞素材') && (!name.endsWith('-member') || node.closest('.ra')));
    require(!!message, "the long numbered workflow is visible");
    const text = message.querySelector('.message-text'), toggle = message.querySelector('[data-act="expand-message"]');
    require(visible(toggle), "a long message has one visible expand control");
    require(message.querySelectorAll('[data-act="expand-message"]').length === 1, "a long message has only one expand control");
    const expanded = name.startsWith("message-expanded");
    require(message.classList.contains('is-expanded') === expanded && toggle.getAttribute('aria-expanded') === String(expanded), "the expanded state and accessible control agree");
    const style = getComputedStyle(text);
    require(!!toggle.closest(".bubble"), "owner expansion remains inside the bubble");
    const control = getComputedStyle(toggle);
    require(control.fontSize === style.fontSize && control.color === style.color, "the expand control inherits the owner's message typography");
    require(control.borderColor === 'rgba(0, 0, 0, 0)', "the quiet expand control has no outline at rest or on hover");
    if (!toggle.matches(':hover')) require(control.backgroundColor === 'rgba(0, 0, 0, 0)', "the quiet expand control has no fill at rest");
    if (message.classList.contains('owner-message')) require(text.innerText.includes('\n\n'), "owner paragraphs retain their rendered line breaks");
    if (expanded) require(text.clientHeight >= text.scrollHeight - 1 && style.maskImage === 'none', "expanded text displays its complete body without a fade");
    else {
      require(text.scrollHeight > text.clientHeight + 1 && text.clientHeight <= parseFloat(style.lineHeight) * 8 + 1, "a preview shows at most eight lines");
      require(style.maskImage.includes('linear-gradient'), "the cut edge fades");
    }
    return { check: name, expanded, height: text.clientHeight, fullHeight: text.scrollHeight };
  }
  if (name === "home-lead-width") {
    const lead = document.querySelector('.ho-hero'), copy = lead.querySelector('h1').parentElement;
    require(Math.abs(copy.getBoundingClientRect().right - lead.getBoundingClientRect().right) < 1, "Home report uses all width beside its emblem");
    const title = lead.querySelector('h1'), lines = new Map();
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect(), key = Math.round(box.top);
        lines.set(key, (lines.get(key) ?? '') + node.data[i]);
      }
    }
    require(![...lines.values()].some(line => /^用\s*\d|^\d+%。?》/.test(line)), "the report never splits the budget phrase into a short tail");
    if (innerWidth === 1280 && innerHeight === 800) require([...document.querySelectorAll('.ho-stat')].every(card => card.getBoundingClientRect().bottom <= innerHeight), "all three stats and charts fit the default first screen");
    return { check: name, width: copy.getBoundingClientRect().width };
  }
  if (name === "onboarding-abilities-hero") {
    const title = document.querySelector('.ob-col h2');
    require(parseFloat(getComputedStyle(title).fontSize) >= 40, "abilities use the welcome hero headline size");
    require(!document.querySelector('.ob-sub'), "abilities have no optional-setup helper paragraph");
    return { check: name, fontSize: getComputedStyle(title).fontSize };
  }
  if (name === "details-quick-once") {
    const quick = [...document.querySelectorAll('.mb-det [data-conversation-open]')].filter(row => visible(row) && row.textContent.includes('快速提問'));
    require(quick.length === 1, "quick questions appear once as the accessible conversation item");
    return { check: name };
  }
  if (name === "conversation-scroll-edge") {
    const scroller = document.querySelector('.mb-chat .ra-scroll');
    require(getComputedStyle(scroller).maskImage !== 'none', "conversation top fades partially scrolled message fragments");
    require(/rgba\(0, 0, 0, 0\) (?:1[2-9]|[2-9]\d)px/.test(getComputedStyle(scroller).maskImage), "the top edge has a fully transparent band in both themes before the fade");
    return { check: name, scrollTop: scroller.scrollTop };
  }
  if (name === "toast-clearance") {
    const toasts = [...document.querySelectorAll('.toast')].filter(visible);
    const targets = [...document.querySelectorAll('.mb-det .mb-panel-row, .conversation-row, .composer')].filter(visible);
    for (const toast of toasts) for (const target of targets) {
      const a = toast.getBoundingClientRect(), b = target.getBoundingClientRect();
      require(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom, "shared success notices never cover list rows or the composer");
    }
    return { check: name, toasts: toasts.length, targets: targets.length };
  }
  if (name === "member-brain-saved") {
    const saved = window.__look.calls.filter(call => call.method === "members.update" && call.params.model);
    require(saved.length === 1 && saved[0].params.id === 1 && saved[0].params.model.startsWith("cli:codex"), "a member's composer saves that member's model");
    require(!window.__look.calls.some(call => call.method === "settings.set" && call.params.key === "agent_model"), "Raphael's model is not touched");
    require(window.__look.data.members.filter(member => member.id !== 1).every(member => !member.model?.startsWith("cli:codex")), "no other member moves");
    require(document.querySelector('.cb-menu [aria-checked="true"]') || document.querySelector('.cb-menu .cb-pick b')?.textContent.includes("GPT-6.1"), "the menu shows the choice");
    require(document.querySelector('.composer .cmp-model .mp-trigger').textContent.includes("Codex"), "reopened details show the selected CLI source");
    return { check: name, model: saved[0].params.model };
  }
  if (name.startsWith("member-model-")) {
    const raphael = window.__look.data.settings.agent_model, composer = document.querySelector(".composer .cmp-model .mp-trigger .mp-tname").textContent;
    const chosen = window.__look.data.members.find(member => member.id === 1).model;
    require(chosen.startsWith("cli:codex:gpt-6.1"), `the member holds its choice: ${chosen}`);
    require(!raphael.startsWith("cli:codex"), `Raphael's model did not move: ${raphael}`);
    require(!window.__look.calls.some(call => call.method === "settings.set" && call.params.key === "agent_model"), "nothing wrote Raphael's model");
    const codex = window.__look.data.clis.flatMap(cli => cli.models).find(model => chosen.startsWith(model.id))?.name;
    if (name === "member-model-own" || name === "member-model-kept") require(composer === codex, `this member's composer shows its model: ${composer} / ${codex}`);
    if (name === "member-model-others") require(composer !== codex, `another member's composer does not: ${composer}`);
    if (name === "member-model-settings") require(!document.querySelector('.modal-scrim [data-row="agent-model"]'), "Settings do not say what anyone answers on");
    return { check: name, chosen, raphael };
  }
  if (name === "room-question-card") {
    const card = document.querySelector('.au-room-pane .ra-bgq .permission-card');
    require(visible(card), "the card is in the group");
    require(card.getBoundingClientRect().bottom <= document.querySelector('.au-room-pane .composer').getBoundingClientRect().top + 1, "above the composer");
    require(document.querySelector('[data-room="1"] .mb-dot.is-wait'), "the group's row says something waits");
    require(!document.querySelector('.mb-col [data-member="1"] .mb-dot.is-wait'), "the member's row does not");
    return { check: name };
  }
  if (name === "question-reminder") {
    const toast = document.querySelector('.toast [data-question-room]').closest('.toast');
    require(toast.textContent.includes("小晴") && toast.textContent.includes("等你回答"), `says who waits: ${toast.textContent}`);
    return { check: name };
  }
  if (name === "composer-url-chip") {
    const field = [...document.querySelectorAll(".composer .cmp-field")].find(visible), input = field.querySelector(".cmp-input"), mirror = field.querySelector(".cmp-mirror"), chip = mirror.querySelector(".url-chip");
    require(chip && visible(chip) && chip.textContent.startsWith("x.com/someone/") && chip.textContent.endsWith("…"), `the link stands as its short name: ${chip?.textContent}`);
    require(!input.value.includes("https://") && input.value.includes("這個是我當時看到的"), "the field holds the short name and the words");
    require(getComputedStyle(input).color !== getComputedStyle(mirror).color, "only the copy is painted");
    require(Math.abs(input.scrollHeight - mirror.scrollHeight) <= 1, `the field and its copy wrap alike: ${input.scrollHeight} / ${mirror.scrollHeight}`);
    require(input.scrollHeight <= parseFloat(getComputedStyle(input).lineHeight) * 2 + 40, `the link takes no extra lines: ${input.scrollHeight}`);
    return { check: name, name: chip.textContent, height: input.scrollHeight };
  }
  if (name === "composer-link-sent") {
    const sent = window.__look.calls.filter(call => call.command === "agent_ask_text").at(-1);
    require(sent?.text?.includes("ref_src=twsrc") && sent.text.startsWith("https://x.com/someone/status/"), `the whole address goes out: ${sent?.text}`);
    require(document.querySelector(".composer .cmp-mirror .url-chip") === null, "the field is empty again");
    return { check: name };
  }
  if (name === "room-link-sent") {
    const sent = window.__look.calls.filter(call => call.method === "rooms.send").at(-1);
    require(sent?.params.text.includes("ref_src=twsrc") && sent.params.text.startsWith("https://x.com/someone/status/"), `the whole address goes out: ${sent?.params.text}`);
    return { check: name };
  }
  if (name === "room-composer-files") {
    const chips = [...document.querySelectorAll(".au-room-pane .composer .cmp-chip")];
    require(chips.length === 2, `both files are on the composer: ${chips.length}`);
    for (const chip of chips) {
      const thumb = chip.querySelector("img.cmp-thumb");
      require(thumb?.complete && thumb.naturalWidth > 0, "each shows its picture");
      require(chip.querySelector(".chip-x")?.getAttribute("aria-label"), "each can be taken off");
    }
    require(document.querySelector(".au-room-pane .attachment-drop").hidden, "the drop sign is gone after the drop");
    require(!document.querySelector(".au-room-pane .cmp-send").disabled, "they can be sent");
    return { check: name, files: chips.length };
  }
  if (name === "room-drop-sign") {
    const sign = document.querySelector(".au-room-pane .attachment-drop"), composer = document.querySelector(".au-room-pane .composer");
    require(sign.textContent.trim().length > 0, "the sign says what to do");
    require(sign.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top, "the sign stops above the composer");
    return { check: name };
  }
  if (name === "room-files-sent") {
    const sent = window.__look.calls.filter(call => call.method === "rooms.send").at(-1);
    require(sent?.params.attachments.length === 2, `both files went out: ${sent?.params.attachments.length}`);
    const pictures = [...document.querySelectorAll(".au-room-message .attachment-picture img")];
    require(pictures.length === 2 && pictures.every(image => image.complete && image.naturalWidth > 0), "the sent pictures show in the message");
    require(!document.querySelector(".au-room-pane .composer .cmp-chip"), "the composer is clear again");
    return { check: name };
  }
  if (name === "room-picture-opened") {
    const large = document.querySelector(".media-lightbox .lb-img");
    require(large?.complete && large.naturalWidth > 0, "the picture opens large");
    return { check: name };
  }
  if (name === "details-sheet") {
    const panel = document.querySelector('.mb-det:not([hidden])');
    require(visible(panel), "details are open");
    const scrim = document.querySelector('.mb-det-scrim'), sheet = getComputedStyle(panel).position === 'absolute';
    require(!!visible(scrim) === sheet, "overlay details have a conversation scrim only while they are a sheet");
    if (sheet) {
      const box = panel.getBoundingClientRect(), chat = document.querySelector('.mb-chat').getBoundingClientRect();
      const hit = document.elementFromPoint(chat.left + 4, Math.max(chat.top + 80, box.top + 80));
      require(hit === scrim, "the scrim intercepts conversation clicks");
      require(parseFloat(getComputedStyle(scrim).backgroundColor.split(',').at(-1)) > 0, "the scrim visibly separates the sheet");
    }
    return { check: name, sheet };
  }
  if (name === "settings-concise") {
    const host = document.querySelector('.modal-body');
    const pane = document.querySelector('.modal-scrim [data-pane][aria-current="page"]')?.dataset.pane;
    const labels = pane === 'general' ? ['[data-k="subtitles"]'] : pane === 'dictation' ? ['[data-k="languages"]'] : [];
    for (const selector of labels) require(!host.querySelector(selector)?.closest('.row')?.querySelector('.d'), "self-explanatory settings have no helper paragraph");
    require(!host.querySelector('.models-purpose-note, .run-retained, [data-price="note"]'), "skin, model and usage helpers are absent");
    if (pane === 'data') require(!host.querySelector('.foot'), "data has no helper footer");
    if (pane === 'messaging') require(!host.querySelector('.msg > .foot'), "Telegram keeps its controls without a setup paragraph");
    return { check: name, pane };
  }
  if (name === "models-responsive") {
    const rows = [...document.querySelectorAll('.row-model')];
    require(rows.length >= 3 && document.querySelector('[data-row="quick-model"]'), "Raphael's quick question and what serves dictation remain available");
    for (const row of rows) {
      const label = row.querySelector('.lbl').getBoundingClientRect(), picker = row.querySelector('.ctl').getBoundingClientRect();
      if (innerWidth <= 820) require(picker.top >= label.bottom - 1 && Math.abs(picker.left - label.left) < 1, "narrow model rows place purpose and price above the picker");
    }
    return { check: name, rows: rows.length };
  }
  if (name === "compact-action") {
    const action = document.querySelector('.keys-card [data-go="settings"]');
    require(visible(action) && action.classList.contains('icon') && !action.textContent.trim(), "secondary actions use a bare icon");
    require(!!action.getAttribute('aria-label') && action.title === action.getAttribute('aria-label'), "icon actions retain a localized name and tooltip");
    return { check: name, label: action.getAttribute('aria-label') };
  }
  if (name === "details-alignment") {
    const panel=document.querySelector('.mb-det:not([hidden])');
    if (!visible(panel)) return {check:name,open:false};
    // Conversations have no search field since each member has one (2026-11-06); the first block sets the inset.
    const blocks=[...panel.querySelectorAll('.mb-task-list, .mb-panel-pages, .mb-field > .sel, [data-member-brain] .mp-trigger')].filter(visible);
    if (!blocks.length) return {check:name,blocks:0};
    const reference=blocks[0].getBoundingClientRect();
    for (const block of blocks) {
      const box=block.getBoundingClientRect();
      require(Math.abs(box.left-reference.left)<1 && Math.abs(box.right-reference.right)<1,"every details block shares one inset");
    }
    return {check:name,blocks:blocks.length};
  }
  if (name === "conversation-header") {
    const header=document.querySelector('.mb-chat > .mb-head'), trigger=header.querySelector('.conversation-trigger');
    const caption=trigger.querySelector('.conversation-caption'), identity=trigger.querySelector('.mb-pill');
    const picker=header.querySelector('.mb-pick');
    if (visible(picker)) require(!visible(identity),"compact header shows identity once in the picker");
    for (const line of [caption,identity.querySelector('.mb-pill-t')].filter(visible)) {
      const range=document.createRange();range.selectNodeContents(line);
      const text=range.getBoundingClientRect(), box=line.getBoundingClientRect();
      require(text.top>=box.top-1 && text.bottom<=box.bottom+1 && line.scrollHeight<=line.clientHeight+1,`header text has a complete unclipped line (${line.className}: text=${text.height}, box=${box.height}, scroll=${line.scrollHeight}, client=${line.clientHeight})`);
    }
    return {check:name,captionHeight:caption.getBoundingClientRect().height,identity:visible(identity)};
  }
  if (name === "failure-owner-copy") {
    const replies = [...document.querySelectorAll('.tn .ra .chat-message')].filter(visible);
    const reply = replies.at(-1), preview = document.querySelector('.mb-col [data-member][aria-current="true"] .mb-row-p');
    require(visible(reply) && visible(preview), "the reply and its sidebar preview are visible");
    const copy = { reply: reply.textContent.trim(), preview: preview.textContent.trim() };
    for (const [surface, text] of Object.entries(copy)) {
      require(text.includes("Gmail") && text.includes("Composio 金鑰"), `${surface} says exactly what is missing for the connection`);
      require(!/[a-z]+_[a-z_]+|[（(]\s*(?:credits|usage_?limit|rate_?limit|overloaded|server|auth_?expired|network|permission_?denied|not_?found|tool_?broken|timeout|refused|unknown)\s*[）)]|;|not_?configured/i.test(text), `${surface} exposes no machine diagnostic or ASCII semicolon`);
    }
    require(!reply.querySelector("em"), "machine underscores cannot become italics in the reply");
    return { check: name, ...copy };
  }
  if (name === "details-pointer-focus") {
    const close = document.querySelector('.mb-det [data-det="close"]');
    require(visible(close), "details opened from the pointer");
    require(!document.documentElement.hasAttribute('data-keys'), "pointer modality is retained");
    require(document.activeElement !== close, "opening from a pointer does not move keyboard focus to Close");
    require(getComputedStyle(close).outlineStyle === 'none', "pointer opening has no focus outline");
    return {check:name};
  }
  if (name === "home-redesign") {
    selection();
    const page=document.querySelector('.page-home'), lead=page.querySelector('.ho-hero'), stats=[...page.querySelectorAll('.ho-stat')];
    require(!!lead.querySelector('h1') && getComputedStyle(lead).backgroundColor === 'rgba(0, 0, 0, 0)', "the report is the page headline without a card");
    require(page.querySelectorAll('.ho-card').length === 4 && !!page.querySelector('.ho-inbox'), "four equal blocks hold attention, spend, allowances and dictation");
    require(stats.length === 3, "three stats share one skeleton");
    require(parseFloat(getComputedStyle(page).maxWidth)===1080,"Home retains the supplied 1080px page measure");
    const boxes=stats.map(el=>el.getBoundingClientRect());
    const emblem=lead.querySelector('.av').getBoundingClientRect(), copy=lead.querySelector('.ho-lead-copy').getBoundingClientRect();
    require(copy.left >= emblem.right - 1 && copy.top < emblem.bottom && copy.bottom > emblem.top, "Home emblem and report stay side by side at narrow widths");
    const cards = [...page.querySelectorAll('.ho-card')].map(card => card.getBoundingClientRect());
    require(cards.every(box => Math.abs(box.width - cards[0].width) < 1 && Math.abs(box.height - cards[0].height) < 1), "all four blocks share their dimensions regardless of data");
    require(Math.abs(cards[0].top - cards[1].top) < 1 && Math.abs(cards[2].top - cards[3].top) < 1 && cards[2].top > cards[0].bottom, "four blocks retain their two-by-two positions");
    require(page.querySelectorAll('.ho-day').length === 42 && page.querySelectorAll('.ho-day[aria-current="date"]').length === 1, "a six-week month calendar marks today");
    require(page.querySelector('.ho-calendar').getBoundingClientRect().top >= cards[3].bottom, "the mini calendar stays below the four blocks");
    require(page.querySelectorAll('.ho-weekday').length === 7, "the month has a weekday header");
    require(page.querySelector('.ho-calendar').getBoundingClientRect().height >= 280, "the month fills a balanced area below the summaries");
    require(Math.abs(emblem.width-(innerWidth<=760?96:128))<1 && getComputedStyle(lead.querySelector('h1')).fontSize === getComputedStyle(document.documentElement).getPropertyValue('--fs-h1').trim(), "only the emblem grows; the report retains its heading token");
    require(!page.querySelector('.ho-week'), "the former week strip is removed");
    const blocks = [...page.querySelectorAll('.ho-card, .ho-calendar')];
    for (const block of blocks) {
      const target = block.querySelector(':scope > .ho-target');
      require(target?.tagName === 'BUTTON' && target.tabIndex === 0 && !!target.getAttribute('aria-label'), "each whole block has one named keyboard target");
      const box = block.getBoundingClientRect(), hit = target.getBoundingClientRect();
      require(['left', 'top', 'right', 'bottom'].every(edge => Math.abs(box[edge] - hit[edge]) <= 1), "the navigation target covers the entire block");
      require(!target.querySelector('button, a, input'), "inner controls remain separate from the block target");
      for (const x of [.1, .5, .9]) for (const y of [.1, .5, .9]) {
        const px = box.x + box.width * x, py = box.y + box.height * y;
        if (py >= innerHeight || py < 0) continue;
        const at = document.elementFromPoint(px, py);
        require(at === target || !!at?.closest('[data-home-item], [data-home-date], [data-home-month], [data-home-select], [data-home-event], [data-home-today]'), `every sampled point opens the block or its own inner action: ${block.className} ${x},${y} hits ${at?.className}`);
      }
    }
    return {check:name,stats:boxes.map(b=>({top:b.top,bottom:b.bottom}))};
  }
  if(name === "dictation-layout") {
    const cards=[...document.querySelectorAll('.page-overview .icard')].map(el=>el.getBoundingClientRect()), keys=document.querySelector('.keys-card').getBoundingClientRect(), activity=document.querySelector('.activity').getBoundingClientRect();
    require(cards.length===4 && Math.abs(cards[0].top-cards[1].top)<1 && cards[2].top>cards[0].bottom && Math.abs(cards[2].top-cards[3].top)<1,"dictation stats form a 2 by 2 grid");
    require(Math.abs(activity.right-cards[1].right)<1,"activity and the two stats columns share the same right edge");
    if(keys.left>cards[1].right) require(Math.abs(keys.top-cards[0].top)<1 && activity.top>=cards[2].bottom && Math.abs(activity.left-cards[0].left)<1,"shortcuts align with stats and activity follows in the left column");
    else require(activity.top>=cards[2].bottom && keys.top>=activity.bottom,"narrow order is stats, activity, shortcuts");
    return {check:name,columns:keys.left>cards[1].right?2:1};
  }
  if(name === "thread-measure") {
    const composer=[...document.querySelectorAll('.page-agent .composer')].find(el=>visible(el)&&!el.closest('[hidden]')), cap=parseFloat(getComputedStyle(composer).maxWidth);
    require(cap===896,"thread and composer use the shared 28-space 896px measure");
    require(composer.getBoundingClientRect().width<=cap+1,"composer respects its measure");
    if(innerWidth<1440) require(!document.querySelector('.page-agent[data-det="open"]'),"details start collapsed before they crowd the thread");
    return {check:name,width:composer.getBoundingClientRect().width,cap};
  }
  if(name === "no-naming") {
    require(!document.querySelector('.first-bot'),"no first Bot setup exists for an unconfigured empty thread");
    require(visible(document.querySelector('.page-agent .composer:not([hidden])')),"the ordinary composer is available immediately");
    return (async () => {
      const img=[...document.querySelectorAll('.ra-hero img')].find(visible);
      await img.decode();
      const size=img.getBoundingClientRect().width * devicePixelRatio;
      require(img.naturalWidth >= size, "the empty conversation avatar has enough source pixels for its display size");
      return {check:name,sourceWidth:img.naturalWidth,displayPixels:size};
    })();
  }
  if(name === "settings-alignment") {
    const host=document.querySelector('.modal-body'), style=getComputedStyle(host), right=host.getBoundingClientRect().left+parseFloat(style.paddingLeft)+Math.min(640,host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
    const rows=[...host.querySelectorAll('.cs, .cs-list, .slist, .cs-toolbar, .cs-head')].filter(el=>visible(el)&&!el.closest('[hidden]'));
    require(rows.length>0,"settings has measurable content");
    for(const row of rows) require(Math.abs(row.getBoundingClientRect().right-right)<2,`settings content shares one right edge: ${row.className}`);
    const close=document.querySelector('.modal-x')?.getBoundingClientRect();
    for(const action of host.querySelectorAll('.set-head > button, .set-head > .sel')) {
      const box=action.getBoundingClientRect();
      require(Math.abs(box.right-right)<2,"settings header actions share the content right edge");
      require(!close || box.right<=close.left || box.left>=close.right || box.bottom<=close.top || box.top>=close.bottom,"settings header actions clear the modal Close button");
    }
    return {check:name,right,rows:rows.length};
  }
  if(name === "welcome-alignment") {
    const col=document.querySelector('.ob-col').getBoundingClientRect(), foot=document.querySelector('.ob-foot').getBoundingClientRect();
    require(foot.top-col.bottom<=32 && foot.top>=col.bottom,"welcome content and Start form one centered block");
    const size=parseFloat(getComputedStyle(document.querySelector('.ob-col h2')).fontSize);
    require(size >= 40 && size <= 48, "welcome title is the 40–48px page hero");
    return {check:name,gap:foot.top-col.bottom};
  }
  if (name === "cancel-armed" || name === "cancel-cleared") {
    const button = document.querySelector('[data-cancel-armed="true"]');
    if(name === "cancel-cleared") { require(!button,"other input clears the gesture");return {check:name}; }
    require(visible(button),"the targeted Stop is visibly armed");
    require(button.dataset.cancelHint === "再按一次取消", "the cancellation hint follows the interface language");
    // A desktop question has no Stop beside it: the emblem carries the armed Escape.
    if (button.matches("canvas")) { require(!visible(document.querySelector("#overlay-stop")), "the emblem is armed because no Stop stands beside the question"); return {check:name,target:"emblem"}; }
    require(getComputedStyle(button,"::before").content === '"Esc"',"Esc replaces the Stop glyph");
    require(button.classList.contains("task-action"),"Stop shares the Send action component");
    const send=button.closest('form')?.querySelector('.cmp-send');
    if(send)require(getComputedStyle(send).color===getComputedStyle(button).color,"Stop and Send have exactly the same color");
    require(!(window.__look?.calls ?? []).some(call=>["agent_retract","overlay_cancel"].includes(call.command)||["rooms.stop","worker.cancel","agent.history.stop"].includes(call.method)||call.command==="window_hotkey"&&call.kind==="cancel"),"first Escape performs no cancellation");
    require(![...document.querySelectorAll(".message-tooltip")].some(visible),"the Escape hint replaces the ordinary Stop tooltip");
    return {check:name,hint:button.dataset.cancelHint};
  }
  if(name === "cancel-native-result" || name === "cancel-overlay-result" || name === "cancel-recording-result") {
    const command=name==="cancel-overlay-result"?"overlay_cancel":"window_hotkey";
    require(window.__look.calls.filter(call=>call.command===command&&(command!=="window_hotkey"||(name==="cancel-recording-result"?["cancel","cancel_key"]:["cancel"]).includes(call.kind))).length===1,name === "cancel-recording-result" ? "one Escape cancels recording or STT once" : "only the second Escape cancels once");
    require(!document.querySelector('[data-cancel-armed]'),"the armed state ends with cancellation");return {check:name};
  }
  if(name === "deleted-view") {
    require(visible(document.querySelector('.toast')),"a localized success notice is shown");
    require(![...document.querySelectorAll('.au-room-pane, .au-routine-dialog')].some(el=>visible(el)&&!el.closest('[hidden]')),"the deleted object's view is closed");
    require(!document.body.textContent.includes('not found'),"deletion never lands on a missing object");return {check:name};
  }
  if(name === "overlay-confirmation-content") {
    const title=document.querySelector('#ask-title').textContent.trim().replace(/…$/u,'');
    const details=document.querySelector('#ask-details').textContent.trim();
    require(!!title&&!details.includes(title),"details never repeat the intent title");
    const paragraphs=details.split(/\n+/u).map(line=>line.trim()).filter(Boolean);
    require(new Set(paragraphs).size===paragraphs.length,"each details paragraph is presented once");
    return {check:name,title,paragraphs:paragraphs.length};
  }
  if (name === "overlay-working-no-stop") {
    require(!visible(document.querySelector('#overlay-stop')), "ordinary working orb has no floating Stop button");
    return { check: name };
  }
  if(name === "overlay-confirm-without-stop") {
    require(visible(document.querySelector("#ask")) && !visible(document.querySelector("#overlay-stop")), "a question answers yes or no; Stop is in the app, not beside the question");
    const buttons=[...document.querySelectorAll("#ask .ask-btn")].filter(visible), card=document.querySelector("#ask").getBoundingClientRect();
    require(buttons.every(button=>button.getBoundingClientRect().width<card.width/2&&button.getBoundingClientRect().height<=32), "the answers are compact buttons, not halves of the card");
    return {check:name};
  }
  if(name === "overlay-stop-content") {
    const stop=document.querySelector('#overlay-stop'),label=stop?.querySelector('.overlay-stop-label');
    require(visible(stop)&&visible(label)&&!!label.textContent.trim(),"desktop Stop has a visible localized label instead of a lone empty square");
    require(label.textContent===stop.getAttribute('aria-label'),"visible Stop wording matches its accessible name");
    require(getComputedStyle(label).visibility==='visible',"the Stop label is readable before Escape is armed");
    return {check:name,label:label.textContent};
  }
  if(name.startsWith("overlay-confirmation")) {
    const card=document.querySelector('#ask'),title=document.querySelector('#ask-title'),details=document.querySelector('#ask-details'),actions=document.querySelector('.ask-actions');
    require(visible(card)&&!!title.textContent.trim(),"the confirmation has a clear intent title");
    const c=card.getBoundingClientRect(),a=actions.getBoundingClientRect(),d=details.getBoundingClientRect();
    require(!getComputedStyle(card).backgroundColor.includes('rgba'),"the card surface is opaque");
    require(c.left>=0&&c.top>=0&&c.right<=innerWidth&&c.bottom<=innerHeight,"the whole card fits the native overlay window");
    require(d.bottom<=a.top&&title.getBoundingClientRect().bottom<=a.top,"details and title never run underneath buttons");
    for(const button of actions.querySelectorAll('button:not([hidden])')){const b=button.getBoundingClientRect();require(b.left>=c.left&&b.right<=c.right&&b.bottom<=c.bottom,"every action stays inside its own card");}
    if(details.scrollHeight>details.clientHeight+1)require(visible(document.querySelector('#ask-expand')),"clamped details always offer See all");
    if(name.endsWith('expanded'))require(card.dataset.expanded==='true'&&getComputedStyle(details).overflowY==='auto',"expanded details remain scrollable");
    return {check:name,nativeViewport:{width:innerWidth,height:innerHeight},card:{width:c.width,height:c.height},details:details.textContent.length};
  }
  if (name === "content-width") {
    const settings = document.querySelector('.modal-scrim:not([hidden]) .set-content');
    if (visible(settings)) {
      const edge = settings.getBoundingClientRect();
      for (const child of settings.children) {
        if (!visible(child) || ['absolute', 'fixed'].includes(getComputedStyle(child).position)) continue;
        const box = child.getBoundingClientRect();
        require(box.left >= edge.left - 1 && box.right <= edge.right + 1, `settings content shares one measure: ${child.className}`);
      }
      const action = settings.querySelector('.set-head > :last-child:not(h1)');
      const form = settings.querySelector('.cs-form .add-grid');
      const contentRight = form ? form.getBoundingClientRect().left + form.clientWidth - parseFloat(getComputedStyle(form).paddingRight) : edge.right;
      if (visible(action)) require(Math.abs(action.getBoundingClientRect().right - contentRight) <= 1, "settings header action shares the content right edge");
      for (const selector of ['.cs:has(.cs-store-groups) .cs-find .field', '.cs-store-groups', '.cs-results']) {
        const control = settings.querySelector(selector);
        if (visible(control)) require(Math.abs(control.getBoundingClientRect().right - edge.right) <= 1, `settings toolbar shares the content right edge: ${selector}`);
      }
    }
    for (const grid of document.querySelectorAll('.cs-store .cs-grid')) {
      if (!visible(grid)) continue;
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).map(Number.parseFloat);
      for (const [index, card] of [...grid.children].entries())
        require(Math.abs(card.getBoundingClientRect().width - tracks[index % tracks.length]) <= 1, "store rows fill their allocated content track");
    }
    // Keep this measurable on the pre-token stylesheet too: all limits derive from the shared 32px space.
    const space = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-6'));
    require(space > 0, "the shared spacing scale is available");
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-5'));
    require(gap > 0, "the shared grid gap is available");
    const limits = { word: 10 * space, card: 12 * space, reading: 20 * space, thread: 28 * space, page: 3 * 12 * space + 2 * gap + 2 * space, workspace: 55 * space };
    const groups = [
      ['word', '.wrow'],
      ['card', '.ho-card:not(.page-home .ho-card), .cs-card, .run-tile, .au-occurrence, .icard, .keys-card:not(.page-overview .keys-card), .mb-panel-pages, .mb-det .mb-rt, .mb-det .mem'],
      ['reading', '.ho-row, .ho-slot, .card:not(.activity):not(.keys-card), .row, .list, .slist, .cs-list, .hist-top, .hrow, .cs-item, .mb-row, .mb-rt, .conversation-row, .ask-card, .bgq-card'],
      ['thread', '.ra-col, .composer'],
      ['page', '.page:not(.page-agent), .modal, .ho-hero, .page-overview .keys-card'],
      ['workspace', '.au-page'],
    ];
    const measurements = [];
    for (const [kind, selector] of groups) for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || element.closest('[hidden]')) continue;
      let scale = 1;
      const width = element.getBoundingClientRect().width / scale;
      measurements.push({ kind, class: element.className, width: Math.round(width * 100) / 100, max: limits[kind] });
    }
    const violations = measurements.filter(item => item.width > item.max + 1);
    require(violations.length === 0, `stretched content: ${JSON.stringify(violations)}`);
    const hero = document.querySelector('.page-home:not([hidden]) .ho-hero');
    let home;
    if (visible(hero)) {
      const page = hero.closest('.page-home'), style = getComputedStyle(page);
      const lead = hero.getBoundingClientRect(), bounds = page.getBoundingClientRect();
      const cards = [...page.querySelectorAll('.ho-card')].filter(visible).map(card => card.getBoundingClientRect());
      const available = bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      require(Math.abs(lead.width - available) <= 1, 'Home hero spans the card grid within the page measure');
      require(cards.length > 0 && cards.every(card => card.top >= lead.bottom - 1 && card.width <= lead.width + 1), 'Home hero leads every summary card');
      const rows = [];
      for (const card of cards) {
        let row = rows.find(row => Math.abs(row.top - card.top) <= 1);
        if (!row) rows.push(row = { top: card.top, count: 0 });
        row.count++;
      }
      require(cards.length === 4 && rows.length === 2 && rows.every(row => row.count === 2), `Home summary rows fill their columns: ${JSON.stringify(rows)}`);
      home = { heroWidth: lead.width, available, columns: rows[0].count, rows: rows.map(row => row.count) };
    }
    return { check: name, limits, measurements, ...(home ? { home } : {}) };
  }
  if (name.startsWith("locale-")) return (async () => {
    const { catalogs, getLocale } = await import('/src/main/i18n/index.ts');
    const locale = name.slice(7);
    require(document.documentElement.lang === locale && getLocale() === locale, "the setting is applied to the whole window");
    const current = new Set(Object.values(catalogs[locale]).map(value => value.trim()));
    const foreign = new Set(Object.entries(catalogs).filter(([key]) => key !== locale).flatMap(([, messages]) => Object.values(messages))
      .filter(value => !/[<{}]/.test(value) && !current.has(value.trim())).map(value => value.trim()));
    // User documents, names and backend prose retain the language in which they were written.
    const user = new Set();
    const collect = value => { if (typeof value === "string") user.add(value.trim()); else if (value && typeof value === "object") Object.values(value).forEach(collect); };
    collect(window.__look.data);
    const authored = [...user].filter(value => value && /[\u3400-\u9fff\u3040-\u30ff]/.test(value)).sort((a, b) => b.length - a.length);
    const stale = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const element = node.parentElement, text = node.textContent.trim();
      if (!text || !visible(element) || element.closest('[hidden], [inert], script, style, input, textarea, .message-text, .mb-preview, .mb-pv, .mem-entry')) continue;
      if (user.has(text)) continue;
      const interfaceText = authored.reduce((copy, value) => copy.split(value).join(""), text);
      if (foreign.has(text) || (locale === "en" && /[\u3400-\u9fff\u3040-\u30ff]/.test(interfaceText))) stale.push(text.slice(0, 90));
    }
    require(stale.length === 0, `visible interface copy is in ${locale}: ${JSON.stringify(stale)}`);
    require(!/Cannot set properties|TypeError|outerHTML/.test(document.querySelector('.toasts')?.textContent ?? ""), "no error toast");
    const pane = document.querySelector('.modal-scrim:not([hidden]) [data-pane][aria-current="page"]')?.dataset.pane;
    const page = [...document.querySelectorAll('.page[data-page]')].find(visible)?.dataset.page;
    const tab = document.querySelector('.page-dictation:not([hidden]) [data-dictation-tab][aria-selected="true"]')?.dataset.dictationTab;
    return { check: name, locale, surface: pane ? `settings:${pane}` : tab ? `dictation:${tab}` : page, stale };
  })();
  if (name === "conversation-sections") {
    // One conversation per member (owner, 2026-11-06): Raphael's panel has his conversation and his quick questions, nothing to add.
    const host = document.querySelector('.mb-det .conversation-list');
    require(visible(host), "the conversation list is visible");
    const heading = host.closest('section')?.querySelector(':scope > .mb-dh');
    require(heading?.textContent === "對話" && !heading.querySelector('button'), "one small heading names the rows, with no button beside it");
    const rows = [...host.querySelectorAll('[data-conversation-open]')];
    require(rows.map(row => row.querySelector('span')?.textContent).join("|") === "主要對話|快速提問", "the rows are his conversation and his quick questions");
    require(rows.filter(row => row.getAttribute('aria-current') === 'true').length === 1, "the open one is marked");
    require(!rows[0].closest('.conversation-row').querySelector('[data-conversation-more]') && !!rows[1].closest('.conversation-row').querySelector('[data-conversation-more]'), "only quick questions have a menu, to clear them");
    require(!document.querySelector('.mb-det [data-conversation-new], .mb-det .conversation-tools'), "nothing makes or searches conversations");
    return { check: name, rows: rows.length };
  }
  if (name === "message-menu") {
    const menu = document.querySelector('#app-popover');
    const picks = [...menu.querySelectorAll('[data-pick]')].map(item => item.dataset.pick).filter(pick => pick !== "regenerate");
    require(picks.join("|") === "reply|copy", "the menu is Reply and Copy, with no read aloud or delete");
    const reactions = [...menu.querySelectorAll('.menu-reactions [data-lead]')];
    require(reactions.map(button => button.dataset.lead).join(" ") === "👍 😂 👎 ❤️ 🎉 +" && reactions.every(visible), "Grok's five quick reactions and the slot for every emoji stand above the items");
    require(reactions[0].getBoundingClientRect().bottom <= menu.querySelector('[data-pick]').getBoundingClientRect().top + 1, "the reactions come first");
    return { check: name, picks };
  }
  if (name === "reaction-bar") {
    const bar = document.querySelector('#app-popover.reaction-bar');
    require(visible(bar), "the quick bar is open");
    const slots = [...bar.querySelectorAll('[data-quick]')];
    require(slots.map(slot => slot.dataset.quick).join(" ") === "👍 😂 👎 ❤️ 🎉 +", "five quick reactions in Grok's order, then every emoji");
    const tops = slots.map(slot => Math.round(slot.getBoundingClientRect().top));
    require(new Set(tops).size === 1, "the slots stand in one row");
    require(slots.every(slot => { const box = slot.getBoundingClientRect(); return box.width >= 32 && box.height >= 32; }), "each slot is a target of at least 32 px");
    require(visible(bar.querySelector('[data-quick="+"] svg.i')), "the last slot is drawn as a smiley with a plus");
    const box = bar.getBoundingClientRect();
    require(parseFloat(getComputedStyle(bar).borderTopLeftRadius) >= box.height / 2 - 1, "the bar is a pill");
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the bar is inside the viewport");
    return { check: name };
  }
  if (name === "emoji-picker" || name === "emoji-search") {
    const card = document.querySelector('#app-popover.emoji-picker');
    require(visible(card) && card.getAttribute('role') === 'dialog', "the card of every emoji is open");
    const box = card.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the card is inside the viewport");
    require(box.width >= 280 && box.width <= 320 && box.height <= 360, "the card is Grok's size: about 300 by 340 px");
    const input = card.querySelector('input');
    require(document.activeElement === input && input.placeholder !== "", "the search field is focused and says what it searches");
    const cells = [...card.querySelectorAll('.emoji-cell')].filter(visible);
    require(cells.length > 0, "emoji are shown");
    const first = cells[0].getBoundingClientRect();
    require(Math.abs(first.width - 34) <= 1 && Math.abs(first.height - 34) <= 1, "cells are 34 px");
    const row = cells.filter(cell => Math.round(cell.getBoundingClientRect().top) === Math.round(first.top));
    require(row.length === Math.min(8, cells.length), "a row holds eight emoji");
    const grid = card.querySelector('.emoji-grid'), foot = card.querySelector('.emoji-foot');
    require(grid.getBoundingClientRect().right <= box.right && foot.getBoundingClientRect().bottom <= box.bottom + 1, "the grid and its footer stay inside the card");
    if (name === "emoji-picker") {
      require(card.querySelector('.emoji-sec h4')?.textContent === "笑臉和情緒", "the grid opens at Smileys under its small label");
      require(grid.scrollHeight > grid.clientHeight, "the grid scrolls inside the card");
      require(card.querySelector('.emoji-foot-char').textContent === "😂" && card.querySelector('.emoji-foot-name').textContent !== "", "the footer names the emoji under the pointer");
    } else {
      require(!card.querySelector('.emoji-sec') && cells.some(cell => cell.dataset.emoji === "❤️"), "search shows matching emoji with no section labels");
    }
    require(window.__look.calls.every(call => !/react$/.test(call.method ?? "")), "opening the card reacts with nothing");
    return { check: name, cells: cells.length };
  }
  if (name === "member-no-conversations") {
    const panel = document.querySelector('.mb-det:not([hidden])');
    require(panel && visible(panel), "the details are open");
    require(!document.querySelector('.mb-det [data-slot="conversations"], .mb-det [data-conversation-new]'), "a member has no conversation list and nothing to add one");
    return { check: name };
  }
  if (name === "quick-clear-confirm") {
    const dialog = document.querySelector('.mb-confirm');
    require(visible(dialog) && dialog.querySelector('h2').textContent === '清除「快速提問」的紀錄？', "the shared confirmation names the history");
    require(dialog.querySelector('[data-dlg="delete"]').textContent === "清除紀錄", "the primary action clears history");
    require(!window.__look.calls.some(call => call.method === "conversations.clear"), "nothing clears before confirmation");
    return { check: name, title: dialog.querySelector('h2').textContent };
  }
  if (["quick-cleared", "conversation-empty"].includes(name)) {
    // The first .ra-empty in the document can be another conversation view's hidden one; any shown one counts.
    const empties = [...document.querySelectorAll('.ra-empty')];
    require(empties.some(visible), `the conversation shows its empty state (${empties.map(node => `${node.closest('[class*="page-"]')?.className ?? '?'} hidden=${node.hidden} shown=${node.checkVisibility()} ${Math.round(node.getBoundingClientRect().width)}x${Math.round(node.getBoundingClientRect().height)}`).join('; ')})`);
    require(!document.querySelector('.ra-col .tn, .ra-col .day, .ra-col .exchange-row'), "there are no turns, empty event lines or date separators");
    if (name === "quick-cleared") {
      require(window.__look.calls.filter(call => call.method === "conversations.clear" && call.params.id === 4).length === 1, "history is cleared exactly once");
      require(window.__look.data.conversations.some(c => c.id === 4 && c.kind === "quick"), "the quick identity remains");
    }
    return { check: name };
  }
  if (["composer-voice-destination", "composer-voice-answer"].includes(name)) {
    const calls = window.__look.calls.filter(call => call.command === "window_hotkey" && ["agent_down", "agent_up"].includes(call.kind));
    require(calls.length === 2, "one press and release crossed the native boundary");
    const args = calls[0], expected = args.memberId === 1 ? 11 : 1;
    require(args.conversationId === expected && calls[1].conversationId === expected && !args.destination, "voice names the member's one conversation");
    const slot = document.querySelector('.cmp-voice'), box = slot.getBoundingClientRect();
    require(slot.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), "the composer's voice or Stop control is unobscured");
    if (name === "composer-voice-destination") require(visible(document.querySelector('[data-key="hearing"]')) && document.querySelector('.composer').dataset.taskState === "ack", "the original thread has a waiting line and Stop");
    else require(visible(document.querySelector('.tn[data-id="301"]')) && !document.querySelector('[data-key="hearing"]'), "the answer replaces the pending line in this thread");
    return { check: name, member: args.memberId, conversation: expected };
  }
  if (name === "thread-clear-of-fade") {
    const scroller = [...document.querySelectorAll(".ra-scroll")].find(visible), top = scroller.getBoundingClientRect().top + 40;
    const first = scroller.querySelector(".thread > :first-child"), bubble = document.querySelector('[data-key="hearing"] .owner-message');
    require(first.classList.contains("day"), "what is on its way stands under its day");
    require(first.getBoundingClientRect().top >= top - 1 && bubble.getBoundingClientRect().top >= top - 1, "at rest the first lines stand clear of the fade");
    return { check: name, day: first.getBoundingClientRect().top, bubble: bubble.getBoundingClientRect().top };
  }
  // R-UI-42: system events are one centred grey line that never shows an internal number.
  const eventLines = expected => {
    const lines = [...document.querySelectorAll('.event-line')].filter(visible);
    require(lines.length === expected, `${expected} event lines are visible, found ${lines.length}: ${lines.map(line => line.textContent).join(' | ')}`);
    for (const line of lines) {
      const box = line.getBoundingClientRect(), column = line.closest('.ra-col').getBoundingClientRect();
      require(Math.abs(box.left + box.width / 2 - column.left - column.width / 2) <= 2, `"${line.textContent}" is centred in the thread`);
      require(!/#\d/.test(line.closest('.handoff-event, .conversation-event-line, li').textContent), `"${line.textContent}" shows no internal number`);
      const size = parseFloat(getComputedStyle(line).fontSize);
      require(!line.closest('.chat-message, .work-body') && size >= 12 && size <= 14, `event lines sit outside message bodies at a readable small size (${size}px)`);
      const control = line.closest('button');
      if (control) require(getComputedStyle(control).borderTopColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(control).backgroundColor === 'rgba(0, 0, 0, 0)', "an event line is never a pill");
    }
    return lines;
  };
  const plainWords = () => {
    const wrapped = /^\s*《(?:答|告|否|了|問|解|Answer|Notice|Negative|Understood|Question)[。.：:]/i;
    const words = [...document.querySelectorAll('.page-agent .ra .message-text, .page-agent .work-latest, .page-agent .work-progress, .page-agent .ask-q, .page-agent .bgq-line')].filter(visible);
    for (const text of words) require(!wrapped.test(text.textContent) && !/》\s*$/.test(text.textContent.replace(/《[^《》]*》/g, "")), `R-UI-42: Raphael's words read plainly: ${text.textContent.slice(0, 40)}`);
    return words.length;
  };
  if (name.startsWith("composer-stop-")) {
    const form = document.querySelector('.page-agent .composer'), button = form?.querySelector('.cmp-voice');
    require(visible(button), "the shared slot is visible");
    if (name === "composer-stop-slot") {
      require(["ack", "running", "waiting"].includes(form.dataset.taskState), "this thread has a cancellable reply");
      require(button.getAttribute("aria-label") === "停止" && visible(button.querySelector('svg')) && !button.querySelector('.av'), "Stop is drawn, never an emblem with a Stop label");
      require(!visible(form.querySelector('.cmp-send')) && !button.classList.contains('vm-away'), "Stop alone occupies the slot and voice animation cannot hide it");
    } else {
      require(form.dataset.taskState === "idle" && visible(button.querySelector('.av')), "the stopped reply releases the slot");
      const calls = window.__look.calls;
      require(!calls.some(call => call.command === "window_hotkey" && ["agent_down", "agent_up"].includes(call.kind)), "Stop starts no voice recording");
      if (name === "composer-stop-pending-result") {
        const send = calls.find(call => call.command === "agent_ask_text"), stops = calls.filter(call => call.method === "agent.history.stop");
        require(stops.length === 1 && stops[0].params.session_id === send.requestId && stops[0].params.member_id === 0, "exactly the pending request stops");
      } else if (name === "composer-stop-voice-result") {
        require(calls.filter(call => call.command === "window_hotkey" && call.kind === "cancel").length === 1, "the controller cancels processing once");
        require(!calls.some(call => call.method === "agent.history.stop"), "no session is guessed before the turn exists");
      } else {
        const stops = calls.filter(call => call.method === "worker.cancel");
        require(stops.length === 1 && stops[0].params.task_id === 71, "only the displayed background task stops");
      }
    }
    return { check: name, state: form.dataset.taskState };
  }
  if(name.startsWith("p04-")) {
    const messages=[...document.querySelectorAll('.au-room-thread .message-text')];
    if(name==='p04-blocked'){require(document.querySelector('[data-handoff]').textContent.includes('缺少驗收所需的檔案'),'missing artifact reason is actionable');require(!document.querySelector('[data-handoff] .message-quote'),"the request is only ever the delegating member's own message");}
    if(name==='p04-chief-last')require(document.querySelector('.au-room-thread .tn:last-child .au-room-wrapup') || document.querySelector('.au-room-thread .tn:last-child.au-room-wrapup'),'chief is last');
    if(name==='p04-status-only')require(!messages.some(message=>message.textContent.includes('正在發言')),'progress never enters final bodies');
    if(name==='p04-addresses')require(!messages.some(message=>/@(?:\s|$)/u.test(message.textContent)),'no dangling address');
    if(name==='p04-short')require(document.querySelector('.au-room-wrapup').textContent.includes('沒有可驗收的成果'),'zero results are explicit');
    if(name==='p04-task-slot'){
      const form=document.querySelector('.composer[data-task-state="running"]');
      require(visible(form.querySelector('.cmp-voice'))&&!visible(form.querySelector('.cmp-send')),'only Stop occupies the slot');
      require(form.querySelector('.cmp-voice').getAttribute('aria-label')==='停止','Stop is accessible');
      require(visible(form.querySelector('.cmp-voice svg'))&&!form.querySelector('.cmp-voice .av'),'Stop is drawn, not an emblem with a Stop label');
    }
    return {check:name,matched:true};
  }
  if (name.startsWith("p02-")) {
    const data = window.__look.data, calls = window.__look.calls;
    if (name === "p02-roster") require(calls.some(c => c.method === "members.list"), "shared roster boundary is read");
    if (name === "p02-mentions" || name === "p02-room-mentions") {
      const menu = document.querySelector("#app-popover");
      require(visible(menu), "mention menu is visible");
      require(menu.textContent.includes(data.members[1].name), "bot comes from the roster");
      require(data.servers.some(app => menu.textContent.includes(app.name)), "app comes from the same snapshot");
      const rows = [...menu.querySelectorAll('button')], row = label => rows.find(item => item.querySelector('.mt').textContent === label);
      for (const item of rows) require(visible(item.querySelector('.mlead > *')), `${item.textContent} leads with a face or a mark`);
      require(row("@" + data.members[1].name)?.querySelector('.mlead .av'), "a bot shows its member face");
      for (const app of data.servers) require(row("@" + app.name)?.querySelector('.mlead .mono'), `${app.name} shows its connection mark`);
      const columns = selector => rows.map(item => item.querySelector(selector).getBoundingClientRect().left);
      for (const selector of ['.mlead', '.mt']) require(Math.max(...columns(selector)) - Math.min(...columns(selector)) <= 1, `${selector} aligns in one column`);
    }
    if (name === "p02-picker") require(document.querySelectorAll(".room-picked span").length === 2, "Raphael and the selected colleague have chips");
    if (name === "p02-fallback") require(document.querySelector(".au-room-controls").textContent.includes("預設成員"), "fallback is visible");
    if (name === "p02-blocked") {
      const lines = eventLines(3), rows = [...document.querySelectorAll('.au-room-thread > li')];
      require(lines.every(line => line.closest('.au-room-thread > li.room-intent-blocked')), "blocked replies are lines of the thread");
      require(!document.querySelector('.au-room-controls')?.textContent.trim(), "nothing about blocked replies sits above the composer");
      const at = selector => rows.indexOf(document.querySelector(selector)?.closest('li'));
      const blocked = rows.filter(row => row.matches('.room-intent-blocked')).map(row => rows.indexOf(row));
      require(blocked[0] === at('[data-room-message="2"]') + 1 && blocked[1] === at('[data-room-message="7"]') + 1 && blocked[2] === blocked[1] + 1, "each blocked reply stands where its exchange stopped");
      require(lines[0].textContent === "小森 未能回覆：請求太頻繁而被限流" && lines[1].textContent === "小晴 未能回覆：已停止", "blocked replies name the member and why in the window language");
    }
    if (name === "p02-meeting-event") {
      // The day divider is no longer an event line; the meeting stays one line (an exchange, 2026-11-05).
      const line = eventLines(1).at(-1);
      require(line.closest('.conversation-event-line [data-meeting-room]') && line.textContent === "已開啟會議 產品方向討論", "the meeting is one centred line that opens its room");
      require(visible(line.querySelector('svg.i')) && !line.querySelector('.av'), "a small icon leads the line, beside no avatar");
    }
    if (name === "p02-meeting-open") require(document.querySelector(".au-room-heading b").textContent === data.rooms[0].name, "meeting link opens the real room pane");
    if (name === "p02-roles") require(calls.some(c => c.method === "rooms.update" && c.params.roles?.[1] === "moderator"), "room roles are persisted at the native boundary");
    if (name === "p02-long-exchange") {
      const exchange = data.roomExchanges.at(-1);
      require(exchange.hops > 3 && exchange.turns_taken > 6, "rendered exchange crosses both admission limits");
      require(exchange.reply_intents.every(intent => intent.state === "done"), "wrap-up has no pending intent");
    }
    return { check: name, matched: true };
  }
  if (name === "bot-renamed-centred") {
    const lines = [...document.querySelectorAll('.bot-renamed')].filter(visible);
    require(lines.length === 1 && lines[0].textContent === "已重新命名為 晨星", "one saved rename line");
    require(getComputedStyle(lines[0]).textAlign === "center", "rename line is centered");
    require(window.__look.data.members.length === 1 && window.__look.data.members[0].profile_ready, "profile saved without a second Bot");
    const answers = window.__look.calls.filter(call => call.command === 'agent_question_answer');
    require(answers.length === 1 && answers[0].drafts[0].member_id === 0, "shared apply boundary runs once");
    return { check: name };
  }
  if (name === "admin-draft-cancel" || name === "admin-edited-result") {
    const calls = window.__look.calls.filter(call => call.command === 'agent_question_answer');
    require(calls.length === 1 && calls[0].approved === (name === "admin-edited-result"), "one owner decision");
    const created = window.__look.data.members.filter(member => member.id >= 8);
    require(created.length === (name === "admin-edited-result" ? 2 : 0), "only selected drafts are applied");
    if (name === "admin-edited-result") {
      require(created[0].role === "首席營運長" && !created.some(member => member.name === "RD"), "edits and removal persist");
      require(calls[0].groups[0].name === "工作室", "edited group crosses the confirmation boundary");
      require(created.every(member => window.__look.data.groups.some(group => group.id === member.group_id && group.name === "工作室")), "edited group membership persists");
    }
    return { check: name, created: created.length };
  }
  if (name === "plain-bot-chat") {
    const replies = [...document.querySelectorAll('.tn[data-id="1"] .ra .chat-message .message-text')].filter(visible);
    require(replies.length === 2, "the core's two-message reply shows as two answers");
    require(replies[0].textContent.startsWith("這週的研究有三個重點") && replies[1].textContent.trim().endsWith("方便你接著討論。"), "the reply loses only its opening and closing marks");
    return { check: name, words: plainWords() };
  }
  if (name === "centred-system-events") {
    // Colleague exchanges and a meeting the chief opened stay one centred line each, as Grok Bot shows
    // "Created routines" (R-UI-101, 2026-11-06); other public notices fold into the reply's work.
    const nodes = eventLines(2), lines = nodes.map(line => line.textContent);
    const historic = window.__look.data.turns.find(turn => turn.id === 1).messages.find(message => message.kind === 'event' && message.seq !== 99);
    const body = document.querySelector('.tn[data-id="1"] .work-body[hidden]');
    require(lines[0].includes("2 則訊息") && lines[1].includes("已開啟會議 產品方向討論") && body?.textContent.includes(historic.text), 'colleague exchanges and the meeting stay outside collapsed work, other notices fold');
    const receipts = [...document.querySelectorAll('[data-handoff-group] [data-handoff] > summary')].map(line => line.textContent);
    require(receipts.join("|") === "已轉交給 小晴已完成|和 小森 討論執行中", "folded receipts retain their individual words and states");
    return { check: name, lines };
  }
  if (name.startsWith("handoff-group")) {
    const groups = [...document.querySelectorAll('[data-handoff-group]')].filter(visible);
    require(groups.length === (name === "handoff-group-room" ? 2 : 1), "only consecutive exchanges fold together");
    for (const group of groups) {
      const line = group.querySelector(':scope > summary .event-line'), box = line.getBoundingClientRect(), column = line.closest('.ra-col').getBoundingClientRect();
      require(Math.abs(box.left + box.width / 2 - column.left - column.width / 2) < 2, "exchange group is centred");
      require(box.left >= column.left - 1 && box.right <= column.right + 1, "names stay inside the conversation column");
      require(!line.querySelector('.i'), "no new disclosure chevron");
    }
    const group = groups[0], summary = group.querySelector(':scope > summary'), words = summary.textContent;
    if (name === "handoff-group-open") {
      require(group === window.__handoffGroup && group.open, "the same open group survives arriving data");
      require(document.querySelector('[data-handoff="800"]') === window.__handoffReceipt && window.__handoffReceipt.open, "the same individual receipt stays open");
      require(document.querySelector('.tn[data-id="1"] .me') === window.__handoffOwner && document.querySelector('.tn[data-id="1"] .ra') === window.__handoffAnswer, "new work leaves the question and answer nodes untouched");
      require(words.includes("11 則訊息") && visible(window.__handoffReceipt.querySelector('.message-text')), "new work updates the count without losing the result");
      require(visible(window.__handoffReceipt.querySelector('.message-quote')) && visible(window.__handoffReceipt.querySelector('.handoff-files')), "the original request and files remain readable");
    } else {
      require(groups.every(group => !group.open), "groups start closed even during work");
      require(![...group.querySelectorAll('[data-handoff] > summary')].some(visible), "individual rows are hidden until opened");
    }
    if (name === "handoff-group-done") require(!summary.querySelector('.event-state'), "done has no state words");
    if (name === "handoff-group-many") require(summary.querySelectorAll('.event-person').length === 3 && words.includes("其他 3 位"), "three people and a remainder");
    if (name === "handoff-group") {
      require(words.includes("10 則訊息"), "the count includes repeated people");
      require(summary.querySelector('.event-state')?.textContent === "等待你回答", "only the highest priority state is shown without counters");
      const person = summary.querySelector('.event-person:last-of-type'), following = person.nextSibling;
      const range = document.createRange(); range.setStart(following, 0); range.setEnd(following, 1);
      require(range.getBoundingClientRect().left - person.getBoundingClientRect().right >= 3, "CSS separates the Latin name from its Chinese join");
      const walker = document.createTreeWalker(summary, NodeFilter.SHOW_TEXT), tops = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const box of range.getClientRects()) if (!tops.some(top => Math.abs(top - box.top) < 4)) tops.push(box.top);
      }
      require(tops.length <= (innerWidth === 720 ? 2 : 1), `the collapsed group uses one text line, two at compact width (${tops.length})`);
    }
    return { check: name, groups: groups.length, words };
  }
    if (name === "member-deleted") {
      require(document.querySelector('.mb-pill-t')?.textContent === window.__look.data.members.find(item => item.id === 0)?.name, "deleting the selected member returns to Raphael");
    require(window.__look.calls.some(call => call.method === "members.delete" && call.params?.id === 2), "the core is asked to delete that member");
    require(!window.__look.data.members.some(item => item.id === 2) && !document.querySelector('[data-member="2"]'), "the member is gone from the team and the list");
    require(document.querySelector(".toast")?.textContent.includes("已刪除「小森」"), "a notice names who was deleted");
    return { check: name };
  }
  if (name === "work-dots" || name === "pending-work") {
    const section = document.querySelector(`${name === "pending-work" ? '.tn.is-pending ' : ''}.live-presence`);
    require(visible(section), "one live avatar shows pending work");
    require(!document.querySelector('.page-agent .ans.thinking, .page-agent .work-time, .page-agent .work-latest'), "no second waiting style or clock");
    require(!section.querySelector('button, [data-act]'), "pending work has no empty disclosure");
    return {check: name};
  }
  if (name === "conversation-running") {
    const calls = window.__look.calls.filter(call => call.method === "agent.history.list");
    require(calls.some(call => (call.params?.member_id ?? 0) === 0 && (call.params?.conversation_id ?? 1) === 1), "R-UI-32: running turn belongs to the open formal conversation");
    require([...document.querySelectorAll('.ra .live-presence')].some(visible), "R-UI-32: the live avatar is visible");
    require(![...document.querySelectorAll('.ra .chat-message')].some(visible), "R-UI-32: completed answer is absent while running");
    require(document.querySelector('.live-presence')?.dataset.tooltip === "已核對三份報告，正在彙整研究結論。", "R-UI-42: the public update is the avatar hover");
    return { check: name, running: true, words: plainWords() };
  }
  if (name === "live-scenario-owner-view") {
    const answers = [...document.querySelectorAll('.ra .chat-message > .ans')].filter(visible);
    require(answers.length === 1, "one owner-visible terminal answer");
    require(answers[0].textContent.includes("需要重新登入並授予讀取權限。"), "actionable zh-TW failure survives the real renderer");
    require(!answers[0].textContent.includes("正在查看"), "progress stays outside final messages");
    const calls = window.__look.calls.filter(call => call.method === "agent.history.list");
    require(calls.some(call => (call.params?.member_id ?? 0) === 0), "owner view reads Raphael's production RPC scope");
    return { check: name, answers: answers.length, scope: "personal", status: "missing-connection" };
  }
  if (name === "composer-learn") {
    const calls = window.__look.calls.filter(call => call.method === "dictionary.correct");
    require(calls.length === 1, "one native correction request");
    require(JSON.stringify(calls[0].params.edits) === JSON.stringify([{ before: "Please use Open Mouse", after: "Please use OpenMausBot" }]), "dictation evidence reaches the shared native tracker unchanged");
    require(!document.querySelector(".toast"), "the passive learned pill owns the notice, independently of the composer");
    return { check: name, edits: calls[0].params.edits, nativePill: "separate entry" };
  }
  if (name === "room-required-chief") {
    const chief = document.querySelector('[data-dlg="member"][data-member="0"]');
    require(chief?.disabled && chief.getAttribute('aria-pressed') === 'true', 'Raphael is required');
    return { check: name, chief: 0 };
  }
  if (name === "room-generated-name" || name === "room-edited-name") {
    const input = document.querySelector('#room-name');
    require(name === 'room-edited-name' ? input.value === '上線協作' : input.value.includes('小晴') && input.value.includes('拉斐爾'), 'generated name follows selection and preserves owner edits');
    return { check: name, value: input.value };
  }
  if (name === 'room-isolation-send') {
    require(window.__look.calls.some(c => c.method === 'rooms.send' && c.params.text === 'roomnonce-private-isolation'), 'room send reaches its own boundary');
    require(!window.__look.calls.some(c => c.method === 'agent.ask'), 'room send never uses private ask');
    require(!document.querySelector('[data-room-act="turn"]'), 'room messages have no private navigation');
    return { check: name };
  }
  if (name === 'room-private-isolation') {
    require(!document.querySelector('.mb-chat:not([hidden]) .thread')?.textContent.includes('roomnonce-private-isolation'), 'private history excludes room text');
    return { check: name };
  }
  if (['room-reply-owner','room-reply-peer','room-reply-source-missing'].includes(name)) {
    const id = name === 'room-reply-owner' ? 2 : 3;
    const chip = document.querySelector(`[data-room-message="${id}"] .au-room-reply`);
    require(visible(chip), 'source chip is visible');
    require(chip.textContent === (name === 'room-reply-owner' ? '回覆 你' : name === 'room-reply-peer' ? '回覆 小晴' : '來源訊息已無法取得'), 'chip uses server source identity');
    return { check: name, source: chip.textContent };
  }
  if (name === "quick-model-row") {
    const row = document.querySelector('[data-row="quick-model"]');
    const picker = row?.querySelector('.mp-trigger');
    require(visible(picker) && !!picker.querySelector('.mp-tname')?.textContent && !!picker.querySelector('.mp-source')?.textContent, "quick model uses the shared named provider card");
    const purpose = {"zh-TW": "拉斐爾的快速提問", "en": "Raphael's quick question", "ja": "ラファエルのクイック質問"}[document.documentElement.lang];
    require(!!purpose && row.querySelector('.t')?.textContent.trim() === purpose, "quick questions' row label states their purpose in the window language");
    require(!row.querySelector('.models-purpose-note'), "quick questions need no helper paragraph (R-UI-02)");
    require(!!row.querySelector('[data-price="quick-model"]')?.textContent, "quick questions show the effective model price");
    require(!row.querySelector('[data-k="quick-effort"]') && !row.querySelector('.sel:not(.mp-trigger)'), "quick questions' effort is chosen inside the model list, as the answer model's is, not beside it");
    return { check: name };
  }
  if (name === "quick-conversation-list") {
    const first = document.querySelector('.mb-det [data-conversation-open]');
    require(first?.dataset.conversationOpen === "4", "quick questions are pinned first");
    require(first?.textContent.includes("快速提問"), "the kind uses the window-language title");
    return { check: name, conversation: 4 };
  }
  if (name === "quick-conversation") {
    require(document.querySelector('.conversation-trigger')?.textContent.includes("快速提問"), "the opened conversation keeps its kind title");
    require(document.querySelector('.tn[data-id="90"] .me')?.textContent.includes("今天下午有哪些會議"), "the saved quick question is visible");
    require(!document.querySelector('.tn[data-id="1"]'), "formal history stays out of quick questions");
    return { check: name, conversation: 4 };
  }
  if (name === "quick-question-result") {
    const turn = document.querySelector('.tn[data-id="91"]');
    require(visible(turn) && turn.querySelector('.me')?.textContent.includes("明天早上要帶傘嗎"), "the Alt+Space question arrived in the open quick conversation");
    require(visible(turn.querySelector('.ra .chat-message[data-reply]')) && turn.querySelector('.ra .chat-message[data-reply]').textContent.includes("出門記得帶傘"), "its answer shows below its public step");
    // The calm thread keeps the model in the reply's work detail, not in the work button's tooltip.
    const meta = turn.querySelector('.work-meta')?.textContent ?? turn.querySelector('.message-work')?.dataset.tooltip ?? "";
    require(/luna/i.test(meta) && !/\bsol\b/i.test(meta), `the answer names the quick model that answered it: ${meta}`);
    require(document.querySelector('.conversation-trigger')?.textContent.includes("快速提問"), "the quick conversation stays open");
    require(!document.querySelector('.tn[data-id="1"]'), "formal history stays out of quick questions");
    return { check: name, model: meta, words: plainWords() };
  }
  if (name === "quick-formal-isolation-formal") {
    require(visible(document.querySelector('.tn[data-id="1"]')), "Raphael's formal thread is open");
    require(!document.querySelector('.tn[data-id="90"]'), "quick questions stay out of the formal thread");
    return { check: name };
  }
  if (name === "quick-formal-isolation") {
    const sent = window.__look.calls.filter(call => call.command === "agent_ask_text");
    require(sent.length === 2, `two typed questions reached the native boundary, found ${sent.length}`);
    require(sent[0].text === "整理這週的研究重點" && sent[0].conversationId === 1 && !("destination" in sent[0]), "the formal question names its thread and no quick destination");
    require(sent[1].text === "那明天呢？" && sent[1].conversationId === 4 && sent[1].destination === "quick", "the quick follow-up names the quick destination and its conversation");
    require(visible(document.querySelector('.tn[data-id="90"]')) && !document.querySelector('.tn[data-id="1"]'), "the quick thread shows only quick questions");
    return { check: name, sent: sent.map(call => ({ conversation: call.conversationId, destination: call.destination ?? null })) };
  }
  if (name === "quick-stop") {
    const stops = window.__look.calls.filter(call => call.method === "agent.history.stop");
    require(stops.length === 1 && stops[0].params.session_id === "look-quick" && stops[0].params.member_id === 0, "Stop names the running quick request alone");
    const turn = document.querySelector('.tn[data-id="90"]');
    require(turn?.dataset.status === "denied" && !turn.dataset.live, "the quick question ended where it ran");
    require(!document.querySelector('.composer[data-task-state="running"]'), "the gold slot is free again");
    require(window.__look.data.turns.find(item => item.id === 1)?.status === "done", "the formal thread is untouched");
    return { check: name };
  }
  if (name === "quick-model-selection") {
    const sets = window.__look.calls.filter(call => call.method === "settings.set").map(call => call.params);
    require(sets.some(set => set.key === "quick_model" && set.value === "cli:codex:gpt-6.1"), "the quick model is saved as the subscription model, its effort apart");
    require(sets.some(set => set.key === "quick_effort" && set.value === "high"), "the quick effort is saved on its own");
    require(!sets.some(set => set.key === "agent_model") && window.__look.data.settings.agent_model === "openai/gpt-6-sol", "Raphael's answer model stays as it was");
    const row = document.querySelector('[data-row="quick-model"]');
    require(row.querySelector('[data-k="quick-model"]')?.getAttribute('aria-label')?.includes("GPT-6.1"), "the row shows the chosen model");
    require(row.querySelector('[data-price="quick-model"]')?.textContent.trim() === "訂閱", "a subscription model shows it is billed by subscription");
    return { check: name, saved: sets.filter(set => set.key.startsWith("quick_")) };
  }
  if (name === "overlay-pages") {
    const line = document.querySelector(".subs.on .sub-line"), text = line?.textContent ?? "";
    require(text.startsWith("《答。1. 建立帳號") && !text.endsWith("》"), "the first page of the answer is on screen, the rest to come");
    require(!/https?:|www\.|\]\(|composio\.dev/.test(text), "the corner writes no address or link");
    const box = line.getBoundingClientRect(), height = parseFloat(getComputedStyle(line).lineHeight);
    require(box.height <= 2 * height + 1, `a page is two lines at most (${Math.round(box.height / height)})`);
    // The real window is the emblem's canvas and 40 px over it (overlay.rs `place`); the page must stay inside it.
    const canvas = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--c"));
    require(innerHeight - box.top <= canvas + 40, "the page stays inside the overlay window");
    return { check: name, text };
  }
  if (name === "overlay-step") {
    require(document.getElementById('progress')?.textContent === "《告。正在查看今天下午的行程。》", "the latest shared turn narration is the subtitle");
    return { check: name, text: document.getElementById('progress').textContent };
  }
  if (name === "cleanup-no-effort") {
    const row = document.querySelector('.model-chooser .mc-effort');
    require(row && !visible(row) && !row.querySelector('[data-effort]'), "cleanup has no unused effort row");
    return { check: name };
  }
  if (name === "model-effort-order") {
    const buttons = [...document.querySelectorAll('.model-chooser .mc-effort [data-effort]:not([data-effort=""])')];
    const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    require(buttons.length > 1, "the fixture exercises several effort choices");
    const values = buttons.map(button => button.dataset.effort);
    require(values.every((value, index) => index === 0 || order.indexOf(values[index - 1]) < order.indexOf(value)), "efforts run from shallow to deep regardless of catalog order");
    require(buttons.filter(visible).length === 1 && visible(document.querySelector(".mc-effort .mc-range")), "the shared ruler names its current stop and every offered level remains in the range");
    return { check: name, efforts: values };
  }
  if (name.startsWith("model-choice-")) {
    const dialog = document.querySelector('.model-chooser');
    const scroller = dialog?.querySelector('.mc-scroll');
    require(visible(scroller), "the model list is visible");
    const rows = [...dialog.querySelectorAll('.mc-row, .lm-row')];
    require(rows.length > 0, "the catalogue contains model choices");
    const viewport = scroller.getBoundingClientRect();
    if (name === "model-choice-scroll") {
      const last = rows.at(-1).getBoundingClientRect();
      require(last.bottom <= viewport.bottom + 1 && last.top >= viewport.top - 1, "the final model can be reached inside the list");
      return { check: name, rows: rows.length };
    }
    if (name === "model-choice-selection") {
      const selected = dialog.querySelector('.lm-main[aria-checked="true"]');
      require(selected?.dataset.name === 'qwen3-asr', "the preview selects exactly the requested local model");
      require(dialog.querySelectorAll('.lm-main[aria-checked="true"]').length === 1, "only one local radio is selected");
      require(document.activeElement === selected && parseFloat(getComputedStyle(selected).outlineWidth) >= 2, "keyboard focus stays visible on the choice");
      const mark = selected.querySelector('.ck svg');
      require(visible(mark) && mark.getBoundingClientRect().width <= 16 && getComputedStyle(mark).fill === 'none' && getComputedStyle(mark).stroke !== 'none', "the selected model has a bounded, visible check mark");
      require(!window.__look.calls.some(call => ['models.download', 'models.use', 'settings.set'].includes(call.method)), "previewing does not download or save settings");
      require(getComputedStyle(selected.closest('.lm-row')).backgroundColor !== getComputedStyle(rows[1]).backgroundColor, "selection has a distinct themed surface");
      return { check: name, selected: selected.dataset.name };
    }
    let minimumGap = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const box = rows[i].getBoundingClientRect(), style = getComputedStyle(rows[i]);
      require(box.left >= viewport.left && box.right <= viewport.right + 1, "model choices fit the scroll pane");
      require(style.borderTopStyle === 'solid' && parseFloat(style.borderTopWidth) <= 1, "choices use subtle designed borders instead of native button frames");
      const button = rows[i].matches('.lm-row') ? rows[i].querySelector('.lm-main') : rows[i];
      const buttonStyle = getComputedStyle(button);
      require(!['outset', 'inset'].includes(buttonStyle.borderTopStyle), "model buttons reset the browser's default border");
      require(parseFloat(buttonStyle.paddingTop) >= 12 && box.height >= 80, "each choice retains breathing room and a comfortable target");
      for (const text of button.querySelectorAll('.mp-line, .mp-sub, .mc-description')) {
        require(text.scrollWidth <= text.clientWidth + 1, "model metadata wraps within its column");
      }
      if (i > 0) minimumGap = Math.min(minimumGap, box.top - rows[i - 1].getBoundingClientRect().bottom);
    }
    require(rows.length < 2 || minimumGap >= 8, "adjacent model choices have at least eight pixels of separation");
    const footer = dialog.querySelector('.mb-dlg-act').getBoundingClientRect();
    require(viewport.bottom <= footer.top + 1, "scrolling choices cannot cover the fixed actions");
    return { check: name, rows: rows.length, minimumGap: Number.isFinite(minimumGap) ? minimumGap : null };
  }
  if (name === "delete-confirmation") {
    const dialogs = [...document.querySelectorAll('.mb-dialog.mb-confirm')];
    const dialog = dialogs.at(-1);
    require(visible(dialog), "the confirmation is visible");
    const buttons = [...dialog.querySelectorAll('.mb-dlg-act .btn')];
    require(buttons.map(button => button.dataset.dlg).join('|') === 'cancel|delete', "Cancel precedes Delete visually and in keyboard order");
    require(document.activeElement === buttons[0], "Cancel receives initial focus");
    require(visible(document.getElementById(dialog.getAttribute('aria-describedby'))), "the irreversible-action description is announced");
    require(buttons[1].classList.contains('pri'), "Delete uses the skin's primary accent");
    require(getComputedStyle(dialog.querySelector('.mb-dlg-act')).borderTopWidth === '0px', "no divider separates the compact footer");
    // Since 2026-11-03 the dialog's text buttons share the app's small radius, like every other text button.
    const small = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-sm'));
    require(buttons.every(button => parseFloat(getComputedStyle(button).borderRadius) === small), "actions share the app's small button radius");
    const box = dialog.getBoundingClientRect();
    const close = dialog.querySelector('[data-dlg="close"]').getBoundingClientRect();
    require(box.width <= 482 && box.left >= 0 && box.right <= innerWidth, "the compact panel fits the window");
    require(close.width >= 32 && close.height >= 32, "the close control retains its hit target");
    return { check: name, width: box.width, height: box.height };
  }
  if (name.startsWith("cli-account-")) {
    const row = document.querySelector('[data-cli-menu="codex"], [data-cli="codex"]')?.closest('.cli-card');
    require(visible(row), "the Codex card is visible");
    const calls = window.__look.calls;
    if (name === "cli-account-menu") {
      require(visible(document.querySelector('#app-popover.mb-menu [data-pick="disconnect"]')), "disconnect uses the shared row menu");
      require(!document.querySelector('select'), "no native select is introduced");
    } else {
      require(calls.filter(call => call.method === 'brains.cli_disconnect' && call.params.id === 'codex').length === 1, "one menu choice disconnects exactly once without confirmation");
      const cli = window.__look.data.clis.find(cli => cli.id === 'codex');
      require(cli.logged_in === true, "the CLI's own login remains intact");
      if (name === "cli-account-disconnected") {
        require(cli.disconnected && !cli.available && cli.models.length === 0, "disconnected CLI supplies no runnable models");
        require(visible(row.querySelector('[data-cli="codex"]')), "reconnection stays on the card");
        require(!row.querySelector('[data-cli-menu]'), "a disconnected card has no connected menu");
      } else {
        require(row.querySelector('[data-cli-menu="codex"]') && cli.available && !cli.disconnected, "reconnection restores the connected card, whose menu a right click opens");
        require(calls.filter(call => call.method === 'brains.cli_login' && call.params.id === 'codex').length === 1, "connect reaches the core once");
      }
    }
    return { check: name, text: row.textContent };
  }
  if (name === "room-discussion") {
    require(document.querySelectorAll('.au-room-reply').length >= 3, "multiple replies identify their colleagues");
    require(document.querySelector('.au-room-thread').textContent.includes('我不同意'), "members can disagree");
    require(visible(document.querySelector('.au-room-crown')), "Raphael has the chief badge");
    const crown = document.querySelector('.au-room-crown').getBoundingClientRect();
    const face = document.querySelector('.au-room-crown').parentElement.getBoundingClientRect();
    require(crown.right <= face.right && crown.left >= face.left, "the chief badge stays inside its participant slot");
    // Messages carry face, name and reply chip only; roles stay with the faces of the header and the member column.
    require(document.querySelectorAll('.au-room-participant[data-tooltip*=" · "]').length === 3, "header faces name each member and role");
    for (const meta of document.querySelectorAll('.au-room-meta')) require([...meta.children].every(child => child.matches('.au-room-author, .au-room-reply')), "no role tag above a message");
    return { check: name, replyChips: document.querySelectorAll('.au-room-reply').length };
  }
  if (name === "room-wrapup") {
    const card = document.querySelector('.au-room-wrapup');
    require(visible(card), "the closing message is visible");
    const answer = getComputedStyle(card.querySelector('.ans')), ordinary = getComputedStyle(document.querySelector('.au-room-message:not(.au-room-wrapup) .ra .ans'));
    require(answer.borderLeftWidth === '0px' && answer.borderTopWidth === '0px' && answer.backgroundColor === ordinary.backgroundColor && answer.paddingLeft === ordinary.paddingLeft, "it is a reply like any other");
    require(card.querySelector('.au-room-author')?.textContent === '拉斐爾' && visible(card.querySelector('.ra-face .av')), "face and name lead it like every reply");
    require(!card.querySelector('h1, h2, h3, h4') && !/###|結論|待你決定|下一步/.test(card.textContent), "no template headings");
    require(card.getBoundingClientRect().right <= innerWidth, "the wrap-up fits the viewport");
    return { check: name, author: 0 };
  }
  if (name === "room-responder") {
    const menu = document.querySelector('#app-popover');
    for (const value of ['auto', 'member:0', 'member:1', 'everyone']) require(visible(menu?.querySelector(`[data-value="${value}"]`)), `${value} is selectable`);
    const members = [...menu.querySelectorAll('[data-value^="member:"]')].map(row => row.dataset.value);
    require(members.join() === (window.__look.data.primaryId === 1 ? 'member:1,member:0' : 'member:0,member:1'), "responder choices follow the primary display exchange");
    require(!document.querySelector('.mb-dialog select'), "responder uses the app's selector");
    return { check: name, choices: 4 };
  }
  if (name === "room-reply-cancel") {
    require(!visible(document.querySelector('.cmp-quote')), "cancel removes the reply recipient");
    require(!window.__look.calls.some(call => call.method === 'rooms.send'), "cancel does not send a message");
    return { check: name, cancelled: true };
  }
  if (name === "room-reply-send") {
    require(window.__look.calls.some(call => call.method === 'rooms.send' && call.params.reply_to === 2), "reply reaches the core with the target message id");
    return { check: name, replyTo: 2 };
  }
  if (name === "room-stop") {
    require(window.__look.calls.some(call => call.method === 'rooms.stop' && call.params.room_id === 1), "stop reaches the core");
    require(!document.querySelector('[data-room-act="stop"]'), "no separate Stop pill remains");
    require(!document.querySelector('.au-room-pane .composer[data-task-state="running"]'), "terminal snapshot releases Stop");
    return { check: name, stopRequested: true };
  }
  if (name === "room-replies") {
    const chip = document.querySelector('[data-room-message="3"] .au-room-reply');
    require(visible(chip) && chip.textContent === "回覆 小晴", "the reply identifies its recipient");
    require(chip.getBoundingClientRect().right <= innerWidth, "the reply chip fits the viewport");
    return { check: name, recipient: 1 };
  }
  if (name === "room-thinking") {
    const exchange = window.__look.data.roomExchanges.at(-1);
    require(exchange.active_turn === 2 && exchange.reply_intents.filter(intent => intent.state === "running").length === 1, "the fixture matches one active core turn and queued reply intents");
    const rows = [...document.querySelectorAll('.au-room-thinking')];
    require(rows.length === 1 && visible(rows[0]), "only one member is shown speaking");
    require(getComputedStyle(rows[0]).flexDirection === 'row', "speaker face and status share one row");
    require(visible(rows[0].querySelector('.av')), "the speaker's face is visible");
    require(rows[0].textContent.startsWith("小晴") && visible(rows[0].querySelector('.live-action')), "the speaking row names the member and current action");
    return { check: name, speakingRows: rows.length };
  }
  if (name === "p03-handoff" || name === "p03-handoff-expanded") {
    const task = window.__look.data.roomHandoffs[0], event = document.querySelector(`[data-handoff="${task.task_id}"]`);
    require(visible(event) && document.querySelectorAll('[data-handoff]').length === 1, "one durable receipt is visible");
    require(!event.closest('.chat-message'), "handoffs are events outside message bodies");
    require(event.dataset.state === task.state, "receipt and rendered state agree");
    require(event.querySelector('summary').textContent.startsWith('已轉交給 小晴'), "the receipt names its assignee");
    require(visible(event.querySelector('summary .av')), "the compact line includes the member face");
    eventLines(1);
    require(task.ready_at_ms === task.created_at_ms && task.dispatch_policy === 'immediate', "source dates do not schedule work");
    if (name === "p03-handoff-expanded") {
      const detail = event.querySelector('.handoff-detail');
      require(event.open && visible(detail.querySelector('.message-text')), "expansion shows the persisted result");
      require(detail.querySelector('.message-quote')?.textContent === "你請小晴立即整理驗收報告。", "expansion shows what was asked");
      require(detail.querySelector('.handoff-files')?.textContent === "上線驗收報告.html", "expansion names the produced file, not its digest");
      require(!/#\d|digest|fixture-report/.test(detail.textContent), "expansion shows no internal ids");
    } else require(!event.open, "handoff details start collapsed");
    return { check: name, taskId: task.task_id, state: task.state, readyAt: task.ready_at_ms };
  }
  if (name === "room-row-menu") {
    require(!document.querySelector('[data-room-delete]'), "room rows have no direct delete button");
    const menu = document.querySelector('#app-popover');
    for (const action of ["rename", "members", "delete"]) require(visible(menu?.querySelector(`[data-pick="${action}"]`)), `${action} is available from the room menu`);
    return { check: name, actions: 3 };
  }
  if (name === "team-mentions" || name === "slash-commands") {
    const input = [...document.querySelectorAll('.composer textarea')].find(visible);
    const menu = document.querySelector('#app-popover');
    require(visible(input) && visible(menu), "the completion menu and its field are visible");
    const at = name === "team-mentions" ? input.value.lastIndexOf('@', input.selectionStart) : 0;
    require(at >= 0, "a completion character is present");
    const before = input.value.slice(0, at), prefix = before.split('\n').at(-1);
    const style = getComputedStyle(input), field = input.getBoundingClientRect(), box = menu.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const spacing = parseFloat(style.letterSpacing) || 0;
    const expected = field.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + context.measureText(prefix).width + prefix.length * spacing - input.scrollLeft;
    require(Math.abs(box.left - expected) <= 24, `menu starts beside the completion character: ${box.left} versus ${expected}`);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const lineTop = field.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + (before.split('\n').length - 1) * lineHeight - input.scrollTop;
    require(box.bottom <= lineTop + 4 || box.top >= lineTop + lineHeight - 4, "the menu sits above or below its text line");
    require(box.left >= 8 && box.right <= innerWidth - 8, "the menu stays inside the viewport");
    for (const item of menu.querySelectorAll('button')) {
      require(!item.querySelector('.ck'), "text completions do not reserve an empty icon/check column");
      const lead = item.querySelector('.mlead'), first = lead ?? item.querySelector('.mt'), itemBox = item.getBoundingClientRect();
      require(first && first.getBoundingClientRect().left - itemBox.left <= 12 && (!lead || lead.childElementCount > 0), "a completion starts at the row padding with its face, mark or text");
    }
    return { check: name, menuLeft: box.left, characterX: expected, delta: Math.abs(box.left - expected) };
  }
  if (name.startsWith("mention-")) {
    // A mention is a chip: its mark where the @ is, then its name, in a quiet pill apart from the words around it, and the words
    // themselves (what the core receives, copies and quotes) are the plain `@Name` they always were. The input method, when one
    // typed them, typed each character once and never lost the focus to the menu while it composed.
    const input = [...document.querySelectorAll('.composer textarea')].find(visible), log = window.__imeLog ?? [];
    require(input, "the composer field is on screen");
    const field = input.closest('.cmp-field'), mirror = field?.querySelector('.cmp-mirror');
    const chipsIn = root => [...root.querySelectorAll('.mention-chip')];
    const chipText = chip => chip.textContent;
    const chipLooks = chip => {
      const box = chip.getBoundingClientRect(), style = getComputedStyle(chip), at = chip.querySelector('.mention-at'), mark = chip.querySelector('.mention-ico > *');
      require(box.width > 0 && box.height >= 14, `${chipText(chip)} is drawn`);
      require(mark && visible(mark), `${chipText(chip)} shows its mark`);
      const markBox = mark.getBoundingClientRect(), nameRange = document.createRange();
      nameRange.selectNodeContents(chip.lastChild);
      require(markBox.left >= box.left - 1 && markBox.right <= nameRange.getBoundingClientRect().left + 1, `${chipText(chip)}: the mark stands before its name inside the chip`);
      require(markBox.width >= 10 && markBox.width <= 18 && Math.abs(markBox.height - markBox.width) <= 2, `${chipText(chip)}: the mark is a small square (${markBox.width} x ${markBox.height})`);
      require(style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.boxShadow !== 'none', `${chipText(chip)} stands apart from the words as a pill`);
      require(!chip.closest('a, button') && getComputedStyle(at).webkitTextFillColor === 'rgba(0, 0, 0, 0)', `${chipText(chip)} is not a control and does not show its @`);
      return { text: chipText(chip), kind: chip.dataset.mention, width: box.width, height: box.height, mark: markBox.width };
    };
    const overField = () => {
      const a = input.getBoundingClientRect(), b = mirror.getBoundingClientRect();
      require(field.classList.contains('has-mentions') && visible(mirror), "the field draws its chips");
      require(Math.abs(a.left - b.left) < .5 && Math.abs(a.top - b.top) < .5 && Math.abs(a.width - b.width) < .5 && Math.abs(a.height - b.height) < .5, "the drawn words sit exactly over the field");
      require(getComputedStyle(input).color === 'rgba(0, 0, 0, 0)' && getComputedStyle(mirror).pointerEvents === 'none' && mirror.getAttribute('aria-hidden') === 'true', "the field paints no text of its own, and the drawn copy takes no click and says nothing to a screen reader");
      const plain = mirror.textContent.replace(/\u200b/g, ''), expected = input.value;
      require(plain === expected, `the drawn words are the field's words: ${JSON.stringify(plain)} versus ${JSON.stringify(expected)}`);
    };
    // Where the field's own text starts: the first chip's @ stands exactly there, whatever the font draws.
    const startsWhereTheTextDoes = chip => {
      const style = getComputedStyle(input), context = document.createElement('canvas').getContext('2d');
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const before = input.value.slice(0, input.value.indexOf('@')), expected = input.getBoundingClientRect().left + parseFloat(style.paddingLeft) + context.measureText(before).width;
      const at = chip.querySelector('.mention-at').getBoundingClientRect().left;
      require(Math.abs(at - expected) <= 1.5, `the first chip starts where its text does: ${at} versus ${expected}`);
    };
    if (name === "mention-ime-open") {
      // The @ is still being composed: the menu is already there, and the focus has not moved.
      require(input.value === "@" && log.some(event => event.type === "compositionstart") && !log.some(event => event.type === "compositionend"), "the @ is being composed, not committed");
      require(visible(document.querySelector('#app-popover[data-team-mentions]')), "the mention menu is drawn while the @ is composed");
      require(!log.some(event => event.type === "blur") && document.activeElement === input, "the field kept the focus while it composed");
      return { check: name, events: log.map(event => event.type).join(' ') };
    }
    if (name === "mention-ime-at" || name === "mention-ime-filter") {
      const expected = { "mention-ime-at": "@", "mention-ime-filter": "@小" }[name];
      const order = log.map(event => event.type === "input" ? `input(${event.composing ? "composing" : "settled"}:${event.value})` : event.type).join(" ");
      require(input.value === expected, `the field holds ${JSON.stringify(input.value)}, not ${JSON.stringify(expected)}; the events came in the order ${order}`);
      require(log.some(event => event.type === "compositionstart") && log.some(event => event.type === "compositionend"), "the input method composed and committed");
      require(!log.slice(0, log.findIndex(event => event.type === "compositionend")).some(event => event.type === "blur"), "the field kept the focus until the input method had committed");
      require(document.activeElement === input, "the field still has the focus");
      require(visible(document.querySelector('#app-popover[data-team-mentions]')), "the mention menu follows the finished text");
      return { check: name, value: input.value, events: log.map(event => event.type).join(' ') };
    }
    if (name === "mention-ime-compose" || name === "mention-ime-commit") {
      const composing = name === "mention-ime-compose", expected = composing ? "@Notion ㄅ" : "@Notion 吧";
      require(input.value === expected, `the field holds ${JSON.stringify(input.value)}, not ${JSON.stringify(expected)}`);
      overField();
      const chips = chipsIn(mirror).map(chipLooks), underlined = mirror.querySelector('.cmp-composing');
      require(chips.length === 1 && chips[0].text === "@Notion", "the chip stays beside the words");
      require(composing ? underlined?.textContent === "ㄅ" && getComputedStyle(underlined).textDecorationLine === 'underline' : !underlined, composing ? "the syllable being composed is underlined" : "a committed word is plain");
      require(!log.some(event => event.type === "blur") && document.activeElement === input, "the field kept the focus");
      startsWhereTheTextDoes(chipsIn(mirror)[0]);
      return { check: name, chips, events: log.map(event => event.type).join(' ') };
    }
    if (name === "mention-chip-composer") {
      require(input.value === "請用 @Notion 整理這份報告，再問 @小森 ", `the words are the plain text, not ${JSON.stringify(input.value)}`);
      overField();
      const chips = chipsIn(mirror).map(chipLooks);
      require(JSON.stringify(chips.map(chip => [chip.text, chip.kind])) === JSON.stringify([["@Notion", "app"], ["@小森", "member"]]), "each address is a chip of its kind");
      startsWhereTheTextDoes(chipsIn(mirror)[0]);
      require(!document.querySelector('#app-popover'), "the menu closed once the name was chosen");
      return { check: name, chips };
    }
    if (name === "mention-chip-sent") {
      const sent = window.__look.calls.filter(call => call.command === "agent_ask_text");
      require(sent.length === 1 && sent[0].text === "請用 @Notion 整理這份報告，再問 @小森", `the core receives the words unchanged: ${JSON.stringify(sent.map(call => call.text))}`);
      const bubble = [...document.querySelectorAll('.tn.is-pending .owner-message .bubble')].find(visible);
      require(bubble, "the sent words are in a bubble");
      const chips = chipsIn(bubble).map(chipLooks);
      require(JSON.stringify(chips.map(chip => [chip.text, chip.kind])) === JSON.stringify([["@Notion", "app"], ["@小森", "member"]]), `the bubble draws the same chips: ${JSON.stringify(chips.map(chip => [chip.text, chip.kind]))}`);
      require(bubble.querySelector('.message-text').textContent === "請用 @Notion 整理這份報告，再問 @小森", "the bubble's words are the plain text, so copying and quoting read as typed");
      require(input.value === "" && !field.classList.contains('has-mentions') && mirror.textContent === "", "sending empties the field and its chips");
      return { check: name, chips, sent: sent[0].text };
    }
    if (name === "mention-chip-delete") {
      require(input.value === "請問 " && input.selectionStart === 3 && input.selectionEnd === 3, `one Backspace removed the whole chip: ${JSON.stringify(input.value)}`);
      require(!field.classList.contains('has-mentions') && mirror.textContent === "", "no chip is left");
      return { check: name, value: input.value };
    }
    if (name === "mention-chip-arrow-before") {
      require(input.selectionStart === 2 && input.selectionEnd === 2, `the caret crossed the chip in one step: ${input.selectionStart}`);
      overField();
      return { check: name, caret: input.selectionStart };
    }
    if (name === "mention-chip-arrow-selected") {
      require(input.selectionStart === 2 && input.selectionEnd === 5, `Shift took the whole chip: ${input.selectionStart}-${input.selectionEnd}`);
      return { check: name, selection: [input.selectionStart, input.selectionEnd] };
    }
    if (name === "mention-chip-room") {
      const room = [...document.querySelectorAll('#room-message')].find(visible);
      require(room && room === input, "the room's composer is the field");
      overField();
      const chips = chipsIn(mirror).map(chipLooks);
      require(JSON.stringify(chips.map(chip => [chip.text, chip.kind])) === JSON.stringify([["@Notion", "app"], ["@小晴", "member"]]), `a room draws its members and the apps, not a group it does not offer: ${JSON.stringify(chips.map(chip => chip.text))}`);
      return { check: name, chips };
    }
    throw new Error(`${name}: unknown mention check`);
  }  if (name === "composer-voice-idle" || name === "composer-voice-recording" || name === "composer-voice-sent") {
    // The composer's right-hand slot is one real button that keeps its place and size: the voice emblem at rest, the send glyph
    // while the owner speaks (pressing it sends what was said), the Stop square only once it is sent and for as long as it runs.
    const form = [...document.querySelectorAll('.composer')].find(visible), button = form.querySelector('.cmp-voice'), send = form.querySelector('.cmp-send');
    const box = button.getBoundingClientRect(), rect = { x: box.x, y: box.y, width: box.width, height: box.height };
    if (name === "composer-voice-idle") {
      require(form.dataset.taskState === "idle" && visible(button.querySelector('.av')), "at rest the button is the voice emblem");
      window.__voiceRect = rect;
      return { check: name, rect };
    }
    require(window.__voiceRect, "the button at rest was measured first");
    for (const key of ["x", "y", "width", "height"]) require(Math.abs(rect[key] - window.__voiceRect[key]) <= 0.5, `the button keeps its place and size (${key}: ${rect[key]} against ${window.__voiceRect[key]})`);
    require(button.tagName === 'BUTTON' && button.type === 'button' && !button.disabled && !visible(send), "one real button alone fills the slot, and it is enabled");
    require(!button.hasAttribute('title') && button.dataset.tooltip === button.getAttribute('aria-label'), "its one tooltip is its accessible label");
    if (name === "composer-voice-recording") {
      require(form.dataset.taskState === "recording", `the composer is recording: ${form.dataset.taskState}`);
      const plane = button.querySelector('svg.cmp-plane');
      require(visible(plane) && !button.querySelector('svg.i') && !button.querySelector('.av'), "the send glyph, not the Stop square and not the emblem");
      require(button.getAttribute('aria-label') === send.getAttribute('aria-label'), `its label is the send label: ${button.getAttribute('aria-label')}`);
      require(Math.round(plane.getBoundingClientRect().width) === 24 && getComputedStyle(button).color === getComputedStyle(send).color && getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)', "it looks as the send button does");
      require(!window.__look.calls.some(call => call.command === "window_hotkey" && ["agent_down", "agent_up", "cancel"].includes(call.kind)), "nothing has been pressed or sent yet");
      return { check: name, label: button.getAttribute('aria-label'), rect };
    }
    require(["ack", "running"].includes(form.dataset.taskState), `once it is sent the composer has a turn to stop: ${form.dataset.taskState}`);
    require(button.getAttribute('aria-label') === "停止" && visible(button.querySelector('svg.i')) && !button.querySelector('svg.cmp-plane') && !button.querySelector('.av'), "now the same button is Stop");
    const keys = window.__look.calls.filter(call => call.command === "window_hotkey").map(call => call.kind);
    require(keys.filter(kind => kind === "agent_down").length === 1 && keys.filter(kind => kind === "agent_up").length === 1 && !keys.includes("cancel"), `pressing it sent the recording once and cancelled nothing: ${keys}`);
    return { check: name, keys, rect };
  }
  if (name.startsWith("composer-history-")) {
    // The up arrow brings back what was typed (read once, from the core, when the walk begins), the down arrow walks forward to the
    // draft, and nothing is sent by either; a recalled address is a chip.
    const typedHistory = ["請 @小森 看一下這份報告", "整理這週的研究重點", "明天早上要帶傘嗎？"], draft = "還沒寫完的草稿";
    const input = [...document.querySelectorAll('.composer textarea')].find(visible);
    require(input, "the composer field is on screen");
    const reads = window.__look.calls.filter(call => call.method === "agent.history.sent").length;
    const sent = window.__look.calls.filter(call => call.command === "agent_ask_text");
    const field = input.closest('.cmp-field');
    const atEnd = () => input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const holds = (value, message) => require(input.value === value, `${message}: the field holds ${JSON.stringify(input.value)}, not ${JSON.stringify(value)}`);
    if (name === "composer-history-recall") {
      holds(typedHistory[0], "the up arrow brought back the last thing typed");
      require(atEnd() && document.activeElement === input, "the caret is at the end of the recalled words and the field keeps the focus");
      require(reads === 1 && !sent.length, `the history was read once and nothing was sent: ${reads} reads, ${sent.length} sent`);
      const chips = [...field.querySelectorAll('.cmp-mirror .mention-chip')].map(chip => chip.textContent);
      require(field.classList.contains('has-mentions') && chips.length === 1 && chips[0] === "@小森", `a recalled address is a chip, not raw text: ${JSON.stringify(chips)}`);
      require(!document.querySelector('#app-popover'), "a recalled message opens no menu");
      return { check: name, value: input.value, reads };
    }
    if (name === "composer-history-second") { holds(typedHistory[1], "the up arrow again brought back the one before"); return { check: name, value: input.value }; }
    if (name === "composer-history-oldest") { holds(typedHistory[2], "the oldest line stays where the walk ends"); require(reads === 1, "walking on reads nothing more"); return { check: name, value: input.value, reads }; }
    if (name === "composer-history-draft") {
      holds(draft, "the down arrow ended on the draft that was there before");
      require(atEnd() && !field.classList.contains('has-mentions') && !sent.length, "the draft is whole, its caret at the end, and nothing was sent");
      return { check: name, value: input.value };
    }
    if (name === "composer-history-sent") {
      require(sent.length === 1 && sent[0].text === `${typedHistory[1]}，並附上來源`, `the edited line went out as edited: ${JSON.stringify(sent.map(call => call.text))}`);
      require(input.value === "", "sending emptied the field");
      return { check: name, text: sent[0].text };
    }
    if (name === "composer-history-original") {
      holds(typedHistory[1], "the original line is still in the history, unedited");
      require(reads === 2 && sent.length === 1, `a new walk read the history again and sent nothing more: ${reads} reads, ${sent.length} sent`);
      return { check: name, value: input.value, reads };
    }
    if (name === "composer-history-menu") {
      holds("@", "an open mention menu keeps the arrow keys");
      require(reads === 0, "the history was not read");
      require(visible(document.querySelector('#app-popover[data-team-mentions]')) && document.activeElement === input, "the arrow moved the menu's highlight while the field keeps the focus");
      return { check: name };
    }
    if (name === "composer-history-room") {
      const room = [...document.querySelectorAll('#room-message')].find(visible);
      require(room && room === input, "the room's composer is the field");
      holds(typedHistory[0], "the room's composer walks the same history");
      require(reads === 1 && field.classList.contains('has-mentions'), "read once, and the recalled address is a chip there too");
      return { check: name, value: input.value };
    }
    throw new Error(`${name}: unknown history check`);
  }
  if (name === "context-menu" || name === "context-menu-key") {
    // R-UI-44: a right click anywhere on a row, or the menu key on it, opens the menu of its ⋯: the same menu a click on the ⋯ opens.
    const labels = () => [...document.querySelectorAll('#app-popover button')].map(button => button.textContent.trim().replace(/\s+/g, ' '));
    const popover = document.querySelector('#app-popover'), opener = document.querySelector('[data-overflow][aria-expanded="true"]');
    require(visible(popover) && opener, "a menu is open and belongs to a ⋯ button");
    const box = popover.getBoundingClientRect(), shown = labels(), at = window.__look.pointer;
    require(shown.length > 0, "the menu has items");
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu is inside the window");
    if (name === "context-menu") {
      require(at, "the scene right-clicked first");
      require(Math.abs(box.left - Math.max(8, Math.min(at.x, innerWidth - box.width - 8))) <= 2, `the menu starts at the pointer: its left edge is ${box.left}, the pointer is at ${at.x}`);
      require(box.top >= at.y || box.bottom <= at.y, "the menu does not cover the pointer");
    } else {
      const anchor = opener.getBoundingClientRect();
      // A row that draws no ⋯ (as Grok Bot's) has the menu in the row, 16 px in (context-menu.ts).
      let row = opener.parentElement; while (row && !row.getClientRects().length) row = row.parentElement;
      if (anchor.width) require(Math.abs(box.left - Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8))) <= 2, "a menu the key opens stands under its ⋯");
      else require(row && box.left >= row.getBoundingClientRect().left - 2 && box.left <= row.getBoundingClientRect().left + 24, "a menu the key opens stands in its row, which draws no ⋯");
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    require(!document.querySelector('#app-popover'), "Escape closes the menu");
    opener.click();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        try {
          if (document.querySelector('#app-popover')) {
            require(labels().join('|') === shown.join('|'), `the ⋯ gives the same menu: ${shown.join(' | ')} versus ${labels().join(' | ')}`);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            resolve({ check: name, items: shown, left: box.left, top: box.top, pointer: at ?? null });
          } else if (Date.now() - started > 1500) require(false, "a click on the ⋯ opens a menu too");
          else setTimeout(poll, 50);
        } catch (error) { reject(error); }
      };
      poll();
    });
  }
  if (name === "home-month") {
    const calendar = document.querySelector('.ho-calendar'), grid = calendar.querySelector('.ho-month');
    require(calendar.scrollHeight <= calendar.clientHeight + 1 && grid.scrollHeight <= grid.clientHeight + 1, 'the full month has no inner scroll or clipped week');
    require(grid.querySelectorAll('.ho-day').length === 42 && grid.querySelectorAll('.ho-weekday').length === 7, 'the month has six weeks and seven weekday initials');
    require(calendar.querySelectorAll('.ho-month-actions .btn.icon').length === 2, 'previous and next month are real icon buttons');
    require(!document.querySelector('.au-page:not([hidden])'), 'changing month retains Home');
    const adjacent = grid.querySelector('.ho-other-month .ho-date-btn');
    require(getComputedStyle(adjacent).color !== getComputedStyle(grid.querySelector('.ho-day:not(.ho-other-month) .ho-date-btn')).color, 'neighbouring month days are dimmed');
    const expanded = getComputedStyle(calendar).getPropertyValue('--home-calendar-expanded').trim() === '1';
    const frame = calendar.parentElement.getBoundingClientRect();
    require(expanded === (frame.width >= 900 && frame.height >= 460), 'the available container width and height choose the mode automatically');
    const bounds = calendar.getBoundingClientRect();
    const controls = [...calendar.querySelectorAll(':scope > header, [data-home-month], [data-home-today]')].map(node => {
      const box = node.getBoundingClientRect(); return [box.x - bounds.x, box.y - bounds.y, box.width, box.height];
    });
    const prior = window.__homeMonthBounds;
    if (prior?.width === frame.width && prior.height === frame.height) require(JSON.stringify(controls) === JSON.stringify(prior.controls), 'month changes preserve the header and control positions');
    window.__homeMonthBounds = {width:frame.width,height:frame.height,controls};
    const agenda = calendar.querySelector('.ho-agenda');
    require(expanded ? !visible(agenda) : visible(agenda), 'only compact mode shows the selected-day list');
    if (!expanded && !agenda.querySelector('.ho-agenda-row')) require(agenda.querySelectorAll('.ho-day-empty').length === 1 && agenda.querySelector('.ho-day-empty').textContent.trim(), 'an empty selected day has one quiet line');
    require(calendar.querySelectorAll('[data-home-today]').length === 1, 'Today keeps its fixed place beside both arrows');
    if (expanded) require([...calendar.querySelectorAll('.ho-day')].every(day => [...day.querySelectorAll('.ho-event-chip')].filter(visible).length <= (frame.height >= 600 ? 3 : 2)), 'each full-month day shows only the available two or three chips');
    return {check:name, month:calendar.dataset.month, expanded, width:frame.width, height:frame.height};
  }
  if (name === "home-calendar-day") {
    require(document.querySelectorAll('.au-day-col').length === 1 && !!document.querySelector('.au-day-col[data-day="2026-10-30"]'), "the month opens the exact selected day in the full calendar");
    return {check:name};
  }
  if (name === "home-overview") {
    for (const panel of document.querySelectorAll('.page-home .ho-card, .page-home .ho-card *')) {
      const style = getComputedStyle(panel);
      require(!['auto', 'scroll'].includes(style.overflowY) || panel.scrollHeight <= panel.clientHeight + 1, `Home has no scrolling inner panels: ${panel.className}`);
    }
    const home = document.querySelector('.page-home:not([hidden])');
    for (const card of home.querySelectorAll('.ho-card')) require(card.scrollHeight <= card.clientHeight + 1, `Home block content fits its stable size: ${card.className}`);
    for (const bars of home.querySelectorAll('.ho-bars')) require([...bars.querySelectorAll('rect')].some(rect => Number(rect.getAttribute('height')) > 2), "Home never draws a flat zero chart");
    require(![...home.querySelectorAll('.ho-big, .ho-meter-row b')].some(node => /^[—–-]$/.test(node.textContent.trim())), "Home never presents a lone dash as a stat");
    const emblem = home?.querySelector('.ho-hero > .av');
    require(visible(emblem) && emblem.getBoundingClientRect().width >= 60, "Raphael's emblem is large on Home");
    require(!!home.querySelector('h1.ho-said'), "Raphael reports in the page headline");
    require(!home.querySelector('.ho-hero [data-home-go="agent"], .ho-ask'), "the hero has no ask-Raphael icon: Raphael is asked on his own page");
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pictures = [...emblem.querySelectorAll('img')].map(image => image.getAttribute('src'));
    require(pictures.length === 2 && pictures.every(src => /-loop\.webp$/.test(src) !== reduced), reduced ? "under reduced motion Raphael's emblem is his still picture" : "Raphael's emblem is the turning loop");
    require(!home.querySelector('.ho-pending [data-home-item^="routine:"], .ho-pending [data-home-item^="report:"]'), "Pending lists only what waits for the owner");
    for (const card of home.querySelectorAll('.ho-card')) require(visible(card.querySelector(':scope > header .ho-open')), "every card opens its details from an icon");
    require(document.querySelector('#nav [data-go][aria-current="page"]')?.dataset.go === "home", "Home is the selected rail destination");
    require(document.querySelector('#nav .sidebar-foot-row [data-go="home"]'), "Home sits beside the owner");
    for (const chart of home.querySelectorAll('.ho-bars')) require(chart.getAttribute('aria-label'), "charts have an accessible description");
    // Each page is named on one line in the sidebar, at every width: 連結應用程式 and its number must fit the narrow sidebar too.
    for (const label of document.querySelectorAll('#nav .nav .nav-t')) if (visible(label))
      require(label.getBoundingClientRect().height < (parseFloat(getComputedStyle(label).lineHeight) || 20) * 1.5, `"${label.textContent}" does not fit on one line in the sidebar`);
    return { check: name, items: home.querySelectorAll('[data-home-item]').length, width: home.clientWidth };
  }
  if (name === "home-emblem-motion") {
    // The loop plays by itself, which a canvas cannot show (it draws the first frame), so the check is that the page
    // asks for the loop, and that what it asks for is an animation: its RIFF holds an ANIM header and many frames.
    const picture = [...document.querySelectorAll('.page-home:not([hidden]) .ho-hero > .av img')].find(visible);
    require(!matchMedia('(prefers-reduced-motion: reduce)').matches, "this scene runs with motion allowed");
    require(picture && /app-emblem-(?:light|dark)-loop\.webp$/.test(picture.getAttribute('src')), "Raphael's emblem on Home is the turning loop when motion is allowed");
    require(!document.querySelector('.page-home .ho-hero [data-home-go="agent"]'), "the hero has no ask-Raphael icon");
    return fetch(picture.getAttribute('src')).then(response => response.arrayBuffer()).then(buffer => {
      const view = new DataView(buffer), tag = at => String.fromCharCode(...new Uint8Array(buffer, at, 4));
      require(tag(0) === 'RIFF' && tag(8) === 'WEBP', "the loop is a WebP picture");
      let frames = 0, milliseconds = 0, animated = false;
      for (let at = 12; at + 8 <= buffer.byteLength; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1)) {
        if (tag(at) === 'ANIM') animated = true;
        if (tag(at) === 'ANMF') { frames++; milliseconds += view.getUint8(at + 8 + 12) | view.getUint8(at + 8 + 13) << 8 | view.getUint8(at + 8 + 14) << 16; }
      }
      require(animated && frames > 24 && milliseconds >= 2000, `the loop is an animation of many frames: ${frames} frames, ${milliseconds} ms`);
      return { check: name, frames, milliseconds };
    });
  }
  if (name === "home-report") {
    require(window.__look.calls.some(call => call.method === "agent.history.list" && call.params.member_id === 1), "Reported member history was requested");
    require(visible(document.querySelector('.tn[data-id="2"]')), "The reported turn is rendered");
    require(window.__look.calls.some(call => call.method === "agent.history.list" && call.params.conversation_id === 11 && call.params.around_id === 2), "The reported conversation was loaded around its exact turn");
    return { check: name, turnId: 2, memberId: 1 };
  }
  if (name === "calendar-now") {
    const line = document.querySelector('.au-now'), scroll = document.querySelector('.au-calendar-scroll');
    require(visible(line), "today has the current-time line");
    const box = line.getBoundingClientRect(), port = scroll.getBoundingClientRect(), head = scroll.querySelector('.au-grid-head').getBoundingClientRect();
    require(box.top >= head.bottom && box.bottom <= port.bottom, "it opens scrolled near now");
    return { check: name, top: box.top - port.top };
  }
  if (name === "calendar-overlaps") {
    const seen = [];
    for (const column of document.querySelectorAll('.au-day-col')) {
      const parts = [...column.querySelectorAll(':scope > .au-event')].map(part => part.getBoundingClientRect());
      for (const [index, a] of parts.entries()) for (const b of parts.slice(index + 1)) {
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top), overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (overlapY > 1) { seen.push(overlapX); require(overlapX <= 1, "events that overlap in time stand side by side"); }
      }
    }
    require(seen.length > 0, "the scene has events that overlap");
    return { check: name, overlaps: seen.length };
  }
  if (name === "calendar-month" || name === "calendar-month-more") {
    const view = document.querySelector('.au-month-view');
    require(visible(view) && view.querySelectorAll('.au-month-cell').length === 42 && view.querySelectorAll('.au-month-weekday').length === 7, "a month has six weeks under seven weekdays");
    require(view.scrollHeight <= view.clientHeight + 1 && view.scrollWidth <= view.clientWidth + 1, "the month fits with no scrolling");
    for (const cell of view.querySelectorAll('.au-month-cell')) {
      const bottom = cell.getBoundingClientRect().bottom;
      for (const chip of [...cell.querySelectorAll('.au-event, .cal-more')].filter(visible)) require(chip.getBoundingClientRect().bottom <= bottom + 1, "chips stay inside their day");
    }
    if (name === "calendar-month-more") require(/還有 \d+ 個/.test(view.querySelector('[data-month-day="2026-10-28"] .cal-more:not([hidden])')?.textContent ?? ""), "a day that does not fit counts the rest");
    return { check: name };
  }
  if (name === "calendar-empty") {
    const hint = document.querySelector('.au-empty-hint');
    require(visible(hint) && visible(hint.querySelector('[data-au="new"]')), "an empty calendar offers 建立");
    require(!document.querySelector('.cal-notice.is-unreadable'), "and stays calm");
    const box = hint.getBoundingClientRect();
    for (const day of document.querySelectorAll('.au-month-view .au-day-num')) {
      const date = day.getBoundingClientRect();
      require(date.bottom <= box.top || date.top >= box.bottom || date.right <= box.left || date.left >= box.right, "the empty hint leaves every month date clear");
    }
    return { check: name };
  }
  if (name === "calendar-editor") {
    const panel = document.querySelector('.au-pop-editor');
    require(visible(panel), "the small form is open");
    const box = panel.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the form fits the window");
    require(box.width <= 345, "it is a small popover, not a dialog");
    require(!document.querySelector('.mb-scrim'), "the calendar stays in view behind it");
    require(panel.contains(document.activeElement), "the keyboard is in the form");
    require(panel.querySelectorAll('input[type="time"], select').length === 0, "times are the shared dropdown");
    const draft = document.querySelector('.au-draft');
    if (draft && visible(draft) && innerWidth > 800) {
      const near = draft.getBoundingClientRect();
      require(box.left >= near.right - 1 || box.right <= near.left + 1, "it stands beside the slot, not over it");
    }
    return { check: name, width: box.width };
  }
  if (name === "calendar-drag-range") {
    const [from, to] = [...document.querySelectorAll('.au-pop-editor .sel > span')].map(node => node.textContent);
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    require(from === "12:00", `the drag sets the start: ${from}`);
    require(minutes(to) > minutes(from) && minutes(to) !== minutes(from) + 60, `and the end, by how far it went: ${to}`);
    return { check: name, from, to };
  }
  if (name === "calendar-saved") {
    const call = window.__look.calls.find(item => item.method === "calendar.add");
    require(call?.params.title === "拜訪客戶", "the form's words reach the core");
    require([...document.querySelectorAll('.cal-chip.is-own b')].some(node => node.textContent === "拜訪客戶"), "the event is drawn at once");
    require(!document.querySelector('.au-pop-editor') && !document.querySelector('.au-draft'), "the form and its placeholder are gone");
    return { check: name };
  }
  if (name === "calendar-detail-own" || name === "calendar-detail-read") {
    const panel = document.querySelector('.au-pop-detail');
    require(visible(panel), "the small detail is open");
    const box = panel.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "it fits the window");
    require(visible(panel.querySelector('.au-pop-time')) && visible(panel.querySelector('.au-pop-from')), "it says when and where it comes from");
    const own = name === "calendar-detail-own";
    require(Boolean(visible(panel.querySelector('[data-pop="edit"]'))) === own && Boolean(visible(panel.querySelector('[data-pop="more"]'))) === own, "only an own event can be changed here");
    require(![...panel.querySelectorAll('button')].some(button => /刪除/.test(button.getAttribute('aria-label') ?? button.textContent)), "what destroys waits in the ⋯");
    return { check: name };
  }
  if (name === "calendar-deleted") {
    require(window.__look.calls.some(item => item.method === "calendar.delete" && item.params.id === 1), "the core is told");
    require(!document.querySelector('[data-entry="own:1"]') && !document.querySelector('.au-pop-detail'), "the event and its detail are gone");
    require(/牙醫回診/.test(document.querySelector('.toast')?.textContent ?? ""), "the shared notice names it");
    return { check: name };
  }
  if (name === "calendar-moved" || name === "calendar-resized") {
    const call = window.__look.calls.find(item => item.method === "calendar.update" && item.params.id === 1);
    require(call, "the drag reaches the core");
    const start = new Date(call.params.start).getTime(), end = new Date(call.params.end).getTime(), hour = 3600000;
    if (name === "calendar-moved") require(end - start === hour && start !== new Date(2026, 9, 24, 14).getTime(), "moving keeps how long it lasts");
    else {
      require(start === new Date(2026, 9, 24, 14).getTime() && end > start + hour, "the edge changes when it ends, not when it starts");
      const chip = document.querySelector('.cal-chip[data-entry="own:1"]');
      require(chip.querySelector('time').getBoundingClientRect().top - chip.getBoundingClientRect().top <= 5, "a long event keeps its time at the start");
    }
    require(!document.querySelector('.au-pop-detail'), "a drag is not a click");
    return { check: name, start, end };
  }
  if (name === "calendar-google-off" || name === "calendar-google-closed" || name === "calendar-google-failed") {
    const rail = [...document.querySelectorAll('.au-calendar-side')].find(visible);
    const notice = rail.querySelector('.cal-notice');
    const words = notice?.textContent ?? "";
    if (name === "calendar-google-off") require(/未連接/.test(words) && visible(notice.querySelector('[data-calendar-go]')) && visible(notice.querySelector('[data-calendar-dismiss]')), "not connected is said, with the place to connect it, and can be closed");
    if (name === "calendar-google-closed") require(/未連接/.test(words) && !notice.querySelector('.btn'), "closed, only the words stay");
    if (name === "calendar-google-failed") require(/讀不到/.test(words) && /設定/.test(notice.querySelector('[data-calendar-go]')?.textContent ?? "") && !notice.querySelector('[data-calendar-dismiss]'), "a failed read says so and names where to check");
    require(!rail.querySelector('[data-source="google"]'), "no row for a calendar that is not read");
    require(document.querySelector('.au-page .cal-chip.is-own'), "own events always show");
    return { check: name };
  }
  if (name === "home-google-off" || name === "home-google-closed" || name === "home-google-failed") {
    const notice = document.querySelector('.ho-calendar .cal-notice');
    if (name === "home-google-closed") require(!notice, "closed, it stays closed");
    else {
      require(visible(notice), "Home says it too");
      const go = notice.querySelector('[data-home-go="connections"]');
      require(visible(go) && /設定/.test(go.textContent), "with the place to go");
      const words = notice.querySelector('.cal-notice-words').textContent;
      require(name === "home-google-off" ? /未連接/.test(words) : /讀不到/.test(words), `in plain words: ${words}`);
      const header = document.querySelector('.ho-calendar > header').getBoundingClientRect(), box = notice.getBoundingClientRect();
      require(box.top >= header.top - 1 && box.bottom <= header.bottom + 1, "in the block's header, moving nothing");
    }
    return { check: name };
  }
  if (name === "home-calendar-language") {
    const calendar = document.querySelector('.ho-calendar'), today = calendar.querySelector('.ho-day[aria-current="date"] b');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const probe = document.createElement('i'); probe.style.color = accent; document.body.append(probe); const expected = getComputedStyle(probe).color; probe.remove();
    require(getComputedStyle(today).backgroundColor === expected, "today is the same filled circle");
    const chips = [...calendar.querySelectorAll('.cal-chip')].filter(visible);
    require(chips.length > 0, "the block draws the calendar's own chip");
    require(chips.some(chip => chip.classList.contains('is-own')), "and the own events");
    for (const chip of chips) { const time = chip.querySelector('time'); if (time && !chip.textContent.includes('全天')) require(/^\d{2}:\d{2}$/.test(time.textContent), `the same time format: ${time.textContent}`); }
    return { check: name, chips: chips.length };
  }
  if (name === "calendar-all-day") {
    require(visible(document.querySelector('.au-all-day-event')), "all-day events remain in the pinned header");
    return { check: name };
  }
  if (name === "calendar-shell") {
    const grid = document.querySelector('.au-page:not([hidden]) .au-calendar-scroll'), side = document.querySelector('.au-page:not([hidden]) .au-calendar-side');
    require(visible(grid), "the calendar grid is visible");
    const hour = grid.querySelector('.au-slot').getBoundingClientRect().height;
    const header = grid.querySelector('.au-grid-head').getBoundingClientRect();
    require(hour <= 54 && hour * 11 <= grid.clientHeight - header.height + 1, "eleven working hours fit the calendar viewport without a long vertical scroll");
    require(visible(grid.querySelector('.au-all-day')), "the all-day row stays at the top of the calendar");
    require(grid.scrollWidth <= grid.clientWidth + 1, "the calendar never scrolls horizontally");
    const box = grid.getBoundingClientRect(), columns = [...grid.querySelectorAll('.au-day-col')];
    for (const column of columns) {
      const day = column.getBoundingClientRect();
      require(day.left >= box.left && day.right <= box.left + grid.clientWidth + 1, "every day fits inside the calendar viewport");
    }
    require(!document.querySelector('.au-page [data-view]'), "the calendar has no list view");
    require(document.querySelector('#nav [data-go][aria-current="page"]')?.dataset.go === "home", "the calendar belongs to Home in the rail");
    require(!document.querySelector('#nav .nav[data-go="automations"]'), "the rail has no automations entry");
    const compact = grid.closest('.au-page').clientWidth <= 760;
    require(visible(side) !== compact, "the month and members remain visible at 1120px; compact tools start below 760px content width");
    require(visible(document.querySelector('[data-au="tools"]')) === compact, "compact calendar tools have a toolbar icon");
    const contentWidth = grid.closest('.au-calendar-main').clientWidth;
    require(columns.length === 1 || columns.length === (contentWidth >= 520 ? 7 : Math.max(1,Math.min(3,Math.floor((contentWidth-52)/100)))), `a week uses seven days unless its actual content is too narrow: ${columns.length}`);
    require(getComputedStyle(grid).scrollbarWidth === "none", "the grid scrolls with no visible bar");
    if (visible(side)) {
      require(side.getBoundingClientRect().right <= grid.getBoundingClientRect().left + 1, "the month and what it shows sit in a rail on the left");
      for (const day of side.querySelectorAll('.au-month-grid > span')) {
        require(getComputedStyle(day).whiteSpace === "nowrap" && day.scrollWidth <= day.clientWidth + 1, "month weekday labels fit on one line");
      }
    }
    return { check: name, side: visible(side), days: columns.length, clientWidth: grid.clientWidth, scrollWidth: grid.scrollWidth };
  }
  if (name === "calendar-tools" || name === "calendar-tools-awake") {
    const panel = [...document.querySelectorAll('.au-calendar-side')].find(visible);
    require(panel && visible(panel.querySelector('[data-au="awake"]')) && visible(panel.querySelector('[data-drag-member]')), "month, members and keep-awake remain available");
    const weekdays = [...panel.querySelectorAll('.au-month-grid > span')];
    require(weekdays.map(day => day.textContent).join(' ') === '一 二 三 四 五 六 日', "mini month uses single-character weekdays");
    for (const day of weekdays) require(day.scrollWidth <= day.clientWidth + 1, "mini month weekdays fit");
    const popover = document.querySelector('.au-calendar-tools');
    if (popover) {
      const box = popover.getBoundingClientRect();
      require(box.left === 0 && box.top === 0 && Math.abs(box.height - innerHeight) <= 1 && box.right <= innerWidth - 8, "at a narrow width the rail is a drawer from the left");
    }
    if (name === "calendar-tools-awake") {
      require(panel.querySelector('[data-au="awake"]').getAttribute('aria-checked') === 'true', "keep-awake persists after redrawing the tools");
      require(window.__look.calls.some(call => call.command === 'schedule_keep_awake_set' && call.enabled), "keep-awake reaches the native boundary");
    }
    return { check: name, popover: !!popover, weekdays: weekdays.map(day => day.textContent) };
  }
  if (name === "admin-approval" || name === "admin-approval-long" || name === "admin-approval-batch") {
    const card = [...document.querySelectorAll('.ask-card')].find(visible);
    require(card, "approval card is visible");
    const details = card.querySelector('.ask-q'), yes = card.querySelector('.ask-yes'), no = card.querySelector('.ask-no');
    const box = card.getBoundingClientRect();
    require(box.width <= 480.5, "approval uses the shared card width");
    require(visible(yes) && visible(no), "both approval actions remain visible");
    require(yes.textContent.trim() === "允許" && no.textContent.trim() === "拒絕", "approval uses explicit allow and deny words");
    require(yes.getBoundingClientRect().right <= box.right && yes.getBoundingClientRect().bottom <= innerHeight, "approval action fits the card");
    require(yes.getBoundingClientRect().right <= no.getBoundingClientRect().left, "primary action comes first");
    if (name === "admin-approval-batch") {
      const text = details.textContent;
      for (const member of ["COO", "PM", "RD", "CEO", "CTO", "Marketing", "Finance", "Design"]) {
        require(text.includes("名稱：" + member), "all eight names are preserved");
      }
      require((text.match(/職責：/g) || []).length === 8 && (text.match(/簡介：/g) || []).length === 8 && (text.match(/群組：/g) || []).length === 8, "every member includes role, blurb and group");
      require(!text.includes(": "), "Chinese field labels use full-width colons");
      require([...document.querySelectorAll('.ask-card')].filter(visible).length === 1, "one card covers the whole batch");
    }
    if (name.endsWith("long") || name.endsWith("batch")) {
      if (name.endsWith("long")) require(details.textContent.includes("最後一項指示：保留完整決策紀錄。"), "full instructions are preserved");
      require(card.querySelector('[data-card-disclosure]').getAttribute('aria-expanded') === 'false', 'long approval details start folded');
      require(getComputedStyle(details).overflowY === 'visible', 'details use document scrolling');
    }
    return { check: name, height: box.height, detailsHeight: details.clientHeight, contentHeight: details.scrollHeight };
  }
  if (name === "member-draft" || name === "member-draft-edit") {
    const panel = [...document.querySelectorAll('.draft-panel')].find(visible);
    require(panel, "draft panel is visible");
    require(![...document.querySelectorAll('.ask-card')].some(visible), "plain ask card is hidden when draft panel is shown");
    const box = panel.getBoundingClientRect();
    require(box.top >= 0 && box.bottom <= innerHeight, "draft panel fits the viewport");
    const cards = [...panel.querySelectorAll('.draft-card')].filter(visible);
    const confirmBtn = panel.querySelector('[data-draft-act="confirm"]');
    const cancelBtn = panel.querySelector('[data-draft-act="cancel"]');
    require(visible(confirmBtn) && visible(cancelBtn), "confirm and cancel buttons are visible");
    require(confirmBtn.getBoundingClientRect().right <= cancelBtn.getBoundingClientRect().left, "primary action comes first");
    for (const card of cards) {
      const roleInput = card.querySelector('[data-draft-field="role"]');
      const nameInput = card.querySelector('[data-draft-field="name"]');
      const groupBtn = card.querySelector('[data-draft-act="group"]');
      require(nameInput.clientWidth >= 100, "the editable name stays readable");
      if (!visible(roleInput)) continue;
      const roleStyle = getComputedStyle(roleInput);
      const roleContentWidth = roleInput.clientWidth - parseFloat(roleStyle.paddingLeft) - parseFloat(roleStyle.paddingRight);
      const roleFontSize = parseFloat(roleStyle.fontSize);
      require(roleContentWidth >= roleFontSize * 8, `role field fits at least 8 CJK characters (${roleContentWidth}px vs ${roleFontSize * 8}px)`);
      require(roleInput.scrollWidth <= roleInput.clientWidth + 1, `role value is not clipped (${roleInput.value})`);
      require(nameInput.clientWidth >= roleFontSize * 4.5, "name field has enough width");
      require(groupBtn.getBoundingClientRect().width < roleInput.getBoundingClientRect().width, "group dropdown is narrower than role field");
    }
    if (name === "member-draft") {
      require(cards.length === 3, "three member draft cards are shown");
      require(confirmBtn.textContent.trim() === "建立 3 位成員", "primary button shows three members to create");
      const names = cards.map(c => c.querySelector('[data-draft-field="name"]')?.value);
      require(names.join(",") === "COO,PM,RD", "all three member draft names are populated");
    } else {
      require(cards.length === 2, "removing one draft leaves two cards");
      require(confirmBtn.textContent.trim() === "建立 2 位成員", "primary button updates count to two members");
      require(cards[0].querySelector('[data-draft-field="role"]')?.value === "首席營運長", "edited role field is preserved");
    }
    return { check: name, cards: cards.length, confirmLabel: confirmBtn.textContent.trim() };
  }
  if (name === "member-draft-submitted") {
    const calls=window.__look.calls.filter(call=>call.command==='agent_question_answer');
    require(calls.length===1&&calls[0].approved&&calls[0].drafts?.length===3,'confirmation submits the edited draft once');
    const turn=window.__look.data.turns.find(turn=>turn.status==='done'&&turn.detail?.includes('COO'));
    require(turn&&turn.text.startsWith('已建立'),'native boundary persists the settled draft');
    return {check:name,turnId:turn.id,conversationId:turn.conversation_id};
  }
  if (name === "member-draft-done") {
    const done = [...document.querySelectorAll('.draft-done')].find(visible);
    require(done, "settled one-line summary is visible");
    require(!document.querySelector('.draft-panel:not([hidden])'), "draft panel is closed after confirmation");
    const sumBtn = done.querySelector('[data-act="draft-done"]');
    require(visible(sumBtn) && done.querySelector(".card-title").textContent.includes("已建立 COO、PM、RD"), "settled summary lists created members");
    const list = done.querySelector('.draft-done-list');
    require(visible(list) && list.querySelectorAll('.draft-done-item').length === 3, "expanded summary shows created member details");
    const members = window.__look.data.members;
    for (const createdName of ["COO", "PM", "RD"]) {
      require(members.some(m => m.name === createdName), `${createdName} was added to members`);
    }
    const column = document.querySelector(".mb-col");
    if (visible(column)) {
      const colText = column.textContent + " " + [...column.querySelectorAll("[aria-label]")].map(el => el.getAttribute("aria-label")).join(" ");
      for (const createdName of ["COO", "PM", "RD"]) {
        require(colText.includes(createdName), `${createdName} appears in the left member column`);
      }
    }
    return { check: name, summary: sumBtn.textContent.trim(), members: members.length };
  }
  if (name === "admin-created" || name === "admin-denied") {
    const calls = window.__look.calls, members = window.__look.data.members;
    require(calls.some(call => call.command === "agent_question_answer" && call.approved === (name === "admin-created")), "owner answer reaches the native boundary");
    require(members.some(member => member.id === 8) === (name === "admin-created"), "team reflects the owner's decision");
    if (name === "admin-created") {
      const details = [...document.querySelectorAll('.mb-det')].find(visible);
      // The panel's tabs name the member in one line; the editable fields live in its settings.
      const identity = details?.querySelector('.mb-panel-identity');
      require(identity?.querySelector('b')?.textContent.trim() === "COO", "created member details are selected");
      require(identity.querySelector('small')?.textContent.includes("營運長"), "created role is shown");
      const created = members.find(member => member.id === 8);
      require(window.__look.data.groups.find(group => group.id === created.group_id)?.name === "個人公司", "member joins the approved group");
      require(created.preview === "" && created.last_at === null, "new conversation has no inherited activity");
      require(details.querySelector('.mb-av-slime svg'), "a member without a preset is a slime");
    }
    return { check: name, members: members.length };
  }
  if (name === "page-card") {
    const card = document.querySelector(".pg-card"), frame = card?.querySelector("iframe");
    require(frame?.getAttribute("sandbox") === "allow-scripts allow-forms", "the page runs sandboxed with an opaque origin");
    require(card.querySelector(".pg-body").dataset.state === "ready", "the page has loaded");
    const height = frame.getBoundingClientRect().height;
    require(height >= 180 && height !== 320, `the page is as tall as its content, not the reserved height: ${height}`);
    const line = card.closest(".tn, [data-key]").getBoundingClientRect(), box = card.getBoundingClientRect();
    require(box.left >= line.left && box.right <= line.right + 1, "the page stays inside the reply");
    return { check: name, height };
  }
  if (name === "page-placed" || name === "page-appended") {
    const input = [...document.querySelectorAll('.composer .cmp-input')].find(visible);
    const note = input?.closest('.composer').querySelector('.cmp-page-note');
    const expected = `${name === "page-appended" ? "我原本的草稿\n" : ""}把輕量後背包加入購物車`;
    require(input?.value === expected, "page text is a draft, preserving every existing word");
    require(document.activeElement === input, "the conversation composer has focus");
    require(visible(note) && note.textContent === "這段文字來自頁面，確認後再送出", "one localized note identifies page text before sending");
    require(note.getBoundingClientRect().height <= parseFloat(getComputedStyle(note).lineHeight) * 1.2, "the note stays on one line");
    require(!document.querySelector('.pg-view'), "placing from an expanded page returns to the conversation");
    require(!window.__look.calls.some(call => call.command === "agent_ask_text" || ["rooms.send", "owner_questions.answer"].includes(call.method)), "a page never sends an owner message or answers a question");
    return { check: name, text: input.value, note: note.textContent };
  }
  if (name === "page-spoke") {
    const asked = window.__look.calls.filter(call => call.command === "agent_ask_text");
    require(asked.length === 1 && JSON.stringify(asked[0]).includes("把輕量後背包加入購物車"), "only the owner's send submits the placed text once");
    require(![...document.querySelectorAll('.cmp-page-note')].some(visible), "the submitted draft no longer shows a page note");
    return { check: name };
  }
  if (name === "page-expanded") {
    const frame = document.querySelector(".pg-view iframe")?.getBoundingClientRect();
    require(frame && frame.width >= Math.min(1100, innerWidth * 0.6) && frame.height > innerHeight * 0.6, "the same page fills the large dialog");
    require(!document.querySelector(".pg-card .pg-body iframe"), "there is one frame, moved, not a second one");
    return { check: name };
  }
  if (name === "page-gone") {
    const failed = document.querySelector(".pg-failed");
    require(failed && !failed.hidden && failed.textContent.includes("NT$ 1,280"), "it says what it knows of the page");
    require(failed.querySelector('[data-page-act="retry"]'), "and offers to try again");
    require(document.querySelector(".pg-body").hidden, "no empty box is left");
    return { check: name };
  }
  if (name.startsWith("model-sync-")) {
    const saved = window.__look.data.settings.agent_model;
    const known = [...window.__look.data.catalog.llm, ...window.__look.data.clis.flatMap(cli => cli.models)];
    const named = known.find(model => model.id === saved.split("?")[0] || `@${model.provider_id}:${model.id}` === saved.split("?")[0])?.name;
    const composer = document.querySelector(".composer .cmp-model .mp-trigger .mp-tname").textContent;
    require(named && composer === named, `the composer shows the saved model: ${composer} / ${saved}`);
    if (name === "model-sync-composer") require(saved.startsWith("cli:codex:gpt-6.1"), `the composer's choice is what the core holds: ${saved}`);
    if (name === "model-sync-settings") {
      require(!document.querySelector('.modal-scrim [data-row="agent-model"]'), "Settings have no row for what Raphael answers on");
      require(document.querySelector('.modal-scrim [data-row="quick-model"]')?.textContent.includes("拉斐爾的快速提問"), "the quick question says it is Raphael's");
    }
    return { check: name, saved };
  }
  if (name === "composer-model-reading") {
    const pane = document.querySelector(".cb-menu .cb-pane");
    require(!pane.textContent.includes("尚無可用模型"), "a signed-in CLI whose models are coming is not called empty");
    require(pane.querySelector('[role="status"]'), "it says the models are being read");
    return { check: name };
  }
  if (name === "composer-model-arrived") {
    require(document.querySelectorAll(".cb-menu .cb-pane [data-model]").length >= 1 && !document.querySelector('.cb-menu .cb-pane [role="status"]'), "the models took the place of the message without reopening");
    return { check: name };
  }
  if (name === "depth-fill-covers-thumb") {
    const track = document.querySelector(".cb-now .mc-track"), range = track.querySelector(".mc-range");
    const place = range.getBoundingClientRect(), at = Number(range.value) / Number(range.max);
    const thumbRight = place.left + 2 + (place.width - 4 - 24) * at + 24;
    const fillRight = track.getBoundingClientRect().left + parseFloat(getComputedStyle(track, "::before").width);
    require(fillRight >= thumbRight && fillRight - thumbRight <= 3, `the fill ends just past the thumb: fill ${fillRight}, thumb ${thumbRight}`);
    return { check: name };
  }
  if (name === "composer-favorites") {
    const rows = [...document.querySelectorAll(".cb-menu .cb-list [data-model]")];
    require(rows.map(row => row.dataset.model).join() === "openai/gpt-6-luna,cli:codex:gpt-6.1", `what is starred, in order: ${rows.map(row => row.dataset.model)}`);
    require(rows.every(row => row.querySelector("small")?.textContent.trim()), "each says its source");
    require(document.querySelector(".cb-rail .cb-source")?.dataset.cbSource === "favorites", "first on the rail");
    require(document.querySelectorAll(".cb-menu .cb-source").length >= 3, "with the sources under it");
    return { check: name };
  }
  if (name === "composer-card-same") {
    const now = document.querySelector(".cb-now"), pick = now.querySelector(".cb-pick"), range = now.querySelector(".mc-range");
    require(visible(pick.querySelector("small")) && pick.querySelector("small").textContent.trim() && pick.querySelector("b").textContent.trim(), "the source above the model");
    require(pick.querySelector("small").getBoundingClientRect().bottom <= pick.querySelector("b").getBoundingClientRect().top + 1, "in that order");
    require(!/訂閱|方案|用量/.test(now.textContent) && !now.querySelector(".btn"), "no plan or usage on the card");
    require(range.max === "4" && now.querySelectorAll(".mc-dot").length === 5, "the same ruler of five stops");
    const offered = range.dataset.levels.split(",").filter(Boolean).length;
    require(offered ? now.querySelector('.mc-stop[data-on="true"]')?.dataset.effort : range.disabled && /不分思考程度/.test(now.textContent), "the stop it is on is named, or it says there is nothing to choose");
    const card = now.getBoundingClientRect(), track = range.getBoundingClientRect();
    const shape = [card.width, card.height, track.top - card.top, track.width].map(Math.round).join();
    window.__cbShape ??= shape;
    require(shape === window.__cbShape, `the same card whatever the source: ${shape} / ${window.__cbShape}`);
    return { check: name, source: pick.querySelector("small").textContent, model: pick.querySelector("b").textContent, offered, shape };
  }
  if (name === "composer-model-fold") {
    const all = document.querySelector(".cb-all");
    require(document.querySelectorAll(".cb-list [data-model]").length === 5, "five to begin with");
    require(/43/.test(all.textContent) && all.getAttribute("aria-expanded") === "false", "and says how many there are");
    require(document.querySelector('.cb-list [data-model="openai/gpt-6-luna"]') && document.querySelector('.cb-list [data-model="openai/gpt-6-sol"]'), "what is starred and what is chosen are among them");
    require(!document.querySelector(".cb-search"), "no search until the list is opened");
    return { check: name };
  }
  if (name === "composer-model-unfolded") {
    const list = document.querySelector(".cb-list");
    require(list.querySelectorAll("[data-model]").length === 43 && list.scrollHeight > list.clientHeight, "all of them, scrolling inside the card");
    require(visible(document.querySelector(".cb-search")) && document.querySelector(".cb-all").getAttribute("aria-expanded") === "true", "with a search and the way to fold them");
    return { check: name };
  }
  if (name === "composer-quick-read") {
    const composer = document.querySelector(".composer .cmp-model .mp-tname").textContent;
    require(composer === "GPT-6 Luna", `a quick conversation shows 快速提問's model: ${composer}`);
    require(document.querySelector('.cb-now .mc-stop[data-on="true"]')?.dataset.effort === window.__look.data.settings.quick_effort, "at 快速提問's depth");
    return { check: name };
  }
  if (name === "composer-quick-saved") {
    const saved = window.__look.data.settings;
    require(saved.quick_model === "cli:codex:gpt-6.1", `the choice is 快速提問's: ${saved.quick_model}`);
    require(saved.agent_model === "openai/gpt-6-sol", `the answer model is untouched: ${saved.agent_model}`);
    return { check: name };
  }
  if (name === "settings-chatgpt-row") {
    const price = document.querySelector('.modal-scrim [data-price="quick-model"]').textContent;
    require(price === "訂閱", `on the plan, not 價格未知: ${price}`);
    return { check: name };
  }
  if (name === "permission-menu") {
    const card = document.querySelector("#app-popover.cb-menu > .cb-card.cb-modes"), rows = [...(card?.querySelectorAll(".cb-row[data-mode]") ?? [])];
    require(card, "the permission choice is the same card as the model menu");
    require(rows.map(row => row.dataset.mode).join() === "direct,ask,plan,bypass", "four modes");
    require(rows.every(row => row.getAttribute("role") === "radio" && row.querySelector(".cb-name b")?.textContent.trim() && row.querySelector(".cb-name small")?.textContent.trim()), "each says what it does");
    require(card.querySelector(".cb-head h3")?.textContent.trim(), "the card has its title");
    require(new Set(rows.map(row => Math.round(row.querySelector(".cb-name b").getBoundingClientRect().left))).size === 1, "the names line up on the left");
    const chosen = rows.filter(row => row.getAttribute("aria-checked") === "true");
    require(chosen.length === 1 && chosen[0].querySelector(".cb-check svg").getBoundingClientRect().left >= chosen[0].querySelector(".cb-name").getBoundingClientRect().right, "one mode is checked, the check at the end of its row");
    require(document.querySelector("#app-popover").getBoundingClientRect().bottom <= document.querySelector(".cmp-mode").getBoundingClientRect().top + 1, "it opens above the button, inside the window");
    return { check: name };
  }  if (name === "chooser-chatgpt") {
    const rail = [...document.querySelectorAll(".model-chooser [data-source]")], chatgpt = document.querySelector('.model-chooser [data-source="chatgpt"]');
    require(rail[0] === chatgpt, "first in the rail");
    require(chatgpt.closest("section") === document.querySelector('.model-chooser [data-source="cli:codex"]').closest("section"), "under the subscriptions, with the CLIs");
    require(chatgpt.querySelector(".mono svg, .mono .logo, svg"), "with its mark");
    const pane = document.querySelector(".mc-pane");
    require(!/token/i.test(pane.textContent), "no per-token price");
    require(visible(pane.querySelector('[data-dlg="chatgpt"]')), "a real button to sign in");
    require(pane.querySelectorAll(".mc-signin p").length >= 2, "what signing in means, and what it does not");
    return { check: name };
  }
  if (name === "chooser-chatgpt-models") {
    require(!document.querySelector(".mc-signin"), "no sign-in left");
    require(visible(document.querySelector('.model-chooser [data-model="@chatgpt:gpt-6-sol"]')), "the plan's model");
    require(!/token/i.test(document.querySelector(".mc-pane-head").textContent), "no per-token price");
    return { check: name };
  }
  if (name === "composer-model-small" || name === "composer-model-browse") {
    const menu = document.querySelector(".cb-menu"), now = menu.querySelector(".cb-now"), list = menu.querySelector(".cb-body");
    require(visible(now) !== visible(list), "the card shows one view at a time");
    if (name === "composer-model-small") {
      require(visible(now) && !menu.querySelector(".cb-source, [data-model]"), "it opens on the model and its depth, no list");
      require(menu.querySelector(".cb-pick b")?.textContent.trim() && now.getBoundingClientRect().height < 200, "the small card says what is chosen");
    } else {
      const head = list.querySelector(".cb-head"), title = head.querySelector("h3 span").getBoundingClientRect(), card = list.getBoundingClientRect();
      require(visible(head.querySelector(".cb-back")), "a way back");
      const centre = (head.querySelector("h3").getBoundingClientRect().left + head.querySelector("h3").getBoundingClientRect().right) / 2;
      require(Math.abs(centre - (card.left + card.right) / 2) <= 2 && title.width > 0, "the title stands in the middle of the card");
      const rail = list.querySelector(".cb-rail"), pane = list.querySelector(".cb-pane");
      require(visible(rail) && visible(pane) && rail.getBoundingClientRect().right <= pane.getBoundingClientRect().left + 1, "the sources on the left, the models on the right");
      require(rail.querySelectorAll('[aria-pressed="true"]').length === 1, "the source shown is marked");
      require([...rail.querySelectorAll(".cb-name b")].every(name => name.scrollWidth <= name.clientWidth), "every source's name is whole");
      const box = menu.getBoundingClientRect();
      require(box.left >= 0 && box.right <= innerWidth && box.top >= 0, "the card fits the window");
      const first = rail.querySelector(".cb-source").getBoundingClientRect(), place = `${Math.round(first.left)},${Math.round(first.top)},${Math.round(list.getBoundingClientRect().height)}`;
      const wasPlace = window.__cbRail;
      window.__cbRail = place;
      if (wasPlace !== undefined) require(wasPlace === place, `a source pressed stays where it was: ${wasPlace} / ${place}`);
    }
    require(menu.getBoundingClientRect().bottom <= document.querySelector(".composer .cmp-model .mp-trigger").getBoundingClientRect().top + 1, "the card opens above the button, wherever the composer stands");
    const bottom = menu.getBoundingClientRect().bottom, was = window.__cbBottom;
    window.__cbBottom = bottom;
    if (was !== undefined) require(Math.abs(was - bottom) <= 1, "the card keeps standing on the composer when it turns");
    require(!/跟隨|連接其他來源/.test(menu.textContent), "nothing about following a default or adding a source");
    return { check: name };
  }
  if (name === "member-maker" || name === "member-maker-chosen") {
    const dialog = document.querySelector(".cr-dialog"), box = dialog.closest(".mb-scrim").getBoundingClientRect(), side = document.getElementById("nav").getBoundingClientRect();
    if (!matchMedia("(max-width: 859px)").matches) require(box.left >= side.right - 1 && visible(document.getElementById("nav")), "it stands where the conversation stands, the sidebar beside it");
    const face = dialog.querySelector(".cr-face svg.slime").getBoundingClientRect(), maker = dialog.querySelector(".cr-maker").getBoundingClientRect();
    require(face.width >= 100 && Math.abs(face.left + face.width / 2 - maker.left - maker.width / 2) <= 2, "the slime is large, in the middle");
    require(!dialog.querySelector('img, input[type="file"], [data-pick]'), "a member is a slime: no pictures to choose");
    require(dialog.querySelectorAll(".cr-colors [data-slime-color]").length >= 8 && dialog.querySelectorAll(".cr-characters [data-slime-character]").length >= 20, "every colour and character is on the page");
    require(dialog.querySelectorAll("input, textarea").length === 1, "it asks only for a name");
    const stands = dialog.querySelector(".cr-face svg.slime").parentElement;
    const painted = [...dialog.querySelectorAll(".cr-face svg.slime path")].filter(part => part.getBoundingClientRect().width && getComputedStyle(part).visibility !== "hidden").map(part => part.getBoundingClientRect());
    require(painted.length > 0, "the chosen slime is painted");
    for (let box = stands; box && box !== dialog; box = box.parentElement) {
      const seen = getComputedStyle(box);
      const bounds = box.getBoundingClientRect(), reserve = Number(seen.overflowClipMargin.match(/([\d.]+)px/)?.[1] ?? 0);
      const fits = seen.overflow === "visible" || painted.every(part => part.left >= bounds.left - reserve && part.right <= bounds.right + reserve && part.top >= bounds.top - reserve && part.bottom <= bounds.bottom + reserve);
      require(box.matches(".mb-dlg-body") || (seen.clipPath === "none" && fits), `nothing cuts the slime's wings and horns (.${box.className})`);
    }
    require(getComputedStyle(dialog.querySelector(".cr-face svg.slime")).clipPath === "none", "nothing cuts the slime's wings and horns");
    const start = dialog.querySelector('[data-dlg="create"]');
    if (name === "member-maker") require(start.disabled && document.activeElement === dialog.querySelector("#mb-new-name"), "the name has the focus and there is nothing to press yet");
    else {
      require(!start.disabled, "a name makes it pressable");
      require(dialog.querySelector('[data-slime-character="shion"]').getAttribute("aria-pressed") === "true" && dialog.querySelectorAll('[data-slime-color][aria-pressed="true"]').length === 0, "one slime is chosen");
    }
    return { check: name };
  }
  if (name === "member-maker-made") {
    const made = window.__look.calls.filter(call => call.method === "members.create");
    require(made.length === 1 && made[0].params.name === "哥布達" && made[0].params.avatar === "slime:gobta", "the member is made once, with its slime");
    require(visible(document.querySelector(".composer .cmp-input")), "its conversation is open");
    const greeting = [...document.querySelectorAll(".page-agent .ra-body")].filter(visible);
    require(greeting.length === 1 && greeting[0].textContent.includes("哥布達") && greeting[0].textContent.includes("？"), "it speaks first and asks what it is for");
    require(![...document.querySelectorAll(".page-agent .owner-message")].some(visible), "nothing is put in the owner's mouth");
    require(!visible(document.querySelector(".page-agent .work-toggle")), "no steps are claimed for what it said");
    require(!document.querySelector(".page-agent [data-greeting-question]"), "a model-written greeting carries no choice form");
    return { check: name };
  }
  if (name === "member-maker-greeting") {
    const turn = window.__look.data.turns.find(item => item.route === "greeting" && item.status === "running");
    require(turn && turn.question === "", "the greeting is a turn with no words of the owner's");
    const row = document.querySelector(`.page-agent .tn[data-id="${turn.id}"]`);
    require(visible(row) && row.dataset.live === "true", "the new member's greeting is under way in its conversation");
    require(visible(row.querySelector(".presence, .thinking, .live-presence, [data-presence]")), "the member shows it is typing");
    require(![...document.querySelectorAll(".page-agent .owner-message")].some(visible), "nothing is put in the owner's mouth");
    require(visible(document.querySelector(".composer .cmp-input")), "the owner can already write");
    return { check: name };
  }
  if (name === "composer-model-menu" || name === "composer-model-depth") {
    const menu = document.querySelector(".cb-menu"), box = menu.getBoundingClientRect(), composer = document.querySelector(".composer").getBoundingClientRect();
    require(!document.querySelector(".model-chooser"), "no separate dialog");
    require(box.bottom <= composer.top + 1 || box.top >= composer.bottom - 1 || box.bottom <= innerHeight, "the menu opens from the composer, inside the window");
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0, "the menu fits the window");
    require(!visible(menu.querySelector(".cb-body")) && menu.querySelector(".cb-pick b")?.textContent.includes("GPT-6.1"), "choosing a model turned the card back to it");
    const range = menu.querySelector(".cb-now .mc-range");
    require(range && menu.querySelectorAll(".mc-stop").length >= 2, "its depth of thought is a slider right there");
    require([...menu.querySelectorAll(".mc-stop")].filter(visible).length === 1, "only the stop it is on is named");
    if (name === "composer-model-depth") {
      const last = [...menu.querySelectorAll(".mc-stop")].filter(stop => stop.dataset.effort).at(-1);
      require(Number(range.value) === range.dataset.levels.split(",").findLastIndex(Boolean), "the slider stands at the chosen stop");
      const saved = window.__look.calls.filter(call => call.method === "members.update" && call.params.model).at(-1);
      require(saved.params.model.includes(last.dataset.effort), "the depth is saved with the member's model");
      require(document.querySelector(".composer .cmp-model .cb-depth")?.textContent === last.textContent, "the button says the depth");
    }
    return { check: name };
  }
  if (name === "slime-states") {
    const face = id => document.querySelector(`.mb-row[data-member="${id}"] svg.slime`);
    const wanted = { 1: ["thinking", "slime-thinking-body"], 2: ["working", "slime-working-body"], 3: ["computer", "slime-computer-body"] };
    for (const [id, [state, animation]] of Object.entries(wanted)) {
      const svg = face(id);
      require(svg?.dataset.state === state, `member ${id} shows ${state}, not ${svg?.dataset.state}`);
      const small = svg.getBoundingClientRect().width <= 72;
      const moving = small ? svg.closest('.slime-surface').querySelector('.slime-loop-body .slime-cels') : svg;
      const name=small ? 'slime-loop-x' : animation;
      require(moving?.getAnimations({ subtree: true }).some(running => running.animationName === name && running.playState === "running"), `member ${id} is really moving as ${state}`);
      const eye = getComputedStyle(svg.querySelector(".slime-eyes"));
      require(eye.stroke === "rgb(255, 255, 255)" && eye.d.startsWith("path("), "its eyes are the white bent path");
    }
    require(getComputedStyle(face(2).querySelector(".slime-eyes")).d.includes("48.53"), "working keeps its focused slit eyes");
    const rows = [...document.querySelectorAll(".mb-row svg.slime")];
    require(rows.length >= 3, "the list shows at least three slimes");
    for (const svg of rows) {
      const surface = svg.closest(".slime-surface"), resting = ["idle", "sleeping"].includes(svg.dataset.state);
      require(!surface.querySelector(".slime-drop, .slime-bubble, .slime-cel-prop"), "no state draws a droplet or a bubble");
      require(resting ? surface.getAnimations({ subtree: true }).length === 0 : surface.getAnimations({ subtree: true }).length > 0, `${svg.dataset.state} has ${resting ? "no" : "its working"} animation`);
      const box = svg.getBoundingClientRect(), row = svg.closest(".mb-row").getBoundingClientRect();
      require(box.top >= row.top - 1 && box.bottom <= row.bottom + 1, "a slime stays inside its row");
    }
    return { check: name, rows: rows.length };
  }
  if (name === "slime-liquid-still") {
    const poses = new Map();
    for (const svg of document.querySelectorAll('.look-slime-board svg.slime')) {
      const state = svg.dataset.state, body = getComputedStyle(svg.querySelector('.slime-motion'));
      require(svg.closest('.slime-surface').getAnimations({ subtree: true }).length === 0, `${state} has no reduced-motion animation`);
      require(getComputedStyle(svg.querySelector('.slime-press')).visibility === 'visible', `${state} retains its body`);
      require(!svg.closest('.slime-surface').querySelector('.slime-drop, .slime-bubble, .slime-cel-prop'), "no state draws a droplet or a bubble");
      poses.set(state, `${body.translate}/${body.rotate}/${body.scale}/${getComputedStyle(svg.querySelector('.slime-eyes')).d}`);
    }
    require(poses.size === 11 && new Set(poses.values()).size === 11, 'all eleven still poses differ');
    return { check: name, states: poses.size };
  }
  if (name === "slime-handover") {
    // Each row is a change of state: its first frame holds the old pose, its second the instant after the change, and it must not jump.
    for (const row of document.querySelectorAll(".look-slime-board > div")) {
      const [before, after] = [...row.querySelectorAll(".mb-av-slime")].map(face => {
        const svg = face.querySelector("svg.slime");
        const painted = (kind, fallback) => {
          const drawn=globalThis.__lookPaintedSlime?.(svg);
          if(drawn)return drawn[kind].getBoundingClientRect();
          const surface = svg.closest(".slime-surface");
          const strip = surface?.querySelector(`.slime-idle-${kind} .slime-cels`);
          if (svg.dataset.state !== "idle" || !strip || getComputedStyle(strip.parentElement).display === "none" || getComputedStyle(strip.parentElement).visibility === "hidden") return svg.querySelector(fallback).getBoundingClientRect();
          const frame = Math.round(-new DOMMatrix(getComputedStyle(strip).transform).e / (surface.clientWidth * 3));
          return strip.querySelectorAll(kind === "body" ? ".slime-cel-body" : "[data-idle-pose]")[frame].getBoundingClientRect();
        };
        const box = face.getBoundingClientRect(), body = painted("body", ".slime-body"), eyes = painted("eyes", ".slime-eyes");
        return { left: body.left - box.left, top: body.top - box.top, right: body.right - box.left, bottom: body.bottom - box.top, eyeX: (eyes.left + eyes.right) / 2 - box.left };
      });
      for (const edge of Object.keys(before)) require(Math.abs(before[edge] - after[edge]) <= 1, `a change of state jumps in ${row.textContent.slice(0, 3)}: ${edge} moved ${Math.abs(before[edge] - after[edge]).toFixed(1)}px`);
    }
    return { check: name, rows: document.querySelectorAll(".look-slime-board > div").length };
  }
  if (name === "slime-picker") {
    const menu = document.querySelector(".mb-avpop");
    require(menu && menu.querySelector('[data-slime-character="shion"]').getAttribute("aria-pressed") === "true", "the menu stays open on the chosen slime");
    require(menu.querySelectorAll('[aria-pressed="true"]').length === 1, "nothing else looks chosen");
    require(window.__look.data.members.find(row => row.id === 1)?.avatar === "slime:shion", "the member keeps it");
    return { check: name };
  }
  if (name === "conversation-picker") {
    const list = document.querySelector("#app-popover .conversation-menu-list");
    require(visible(list), "conversation list is visible");
    require(list.scrollWidth <= list.clientWidth + 1, `list overflows: ${list.scrollWidth} > ${list.clientWidth}`);
    const button = list.querySelector("[data-conversation-new]"), box = button.getBoundingClientRect(), parent = list.getBoundingClientRect();
    require(box.left >= parent.left && box.right <= parent.right + 1, "new conversation button fits inside the list");
    return { check: name, width: list.clientWidth, scrollWidth: list.scrollWidth };
  }
  if (name === "skills-plugin-details-bottom") {
    const button = document.querySelector('[data-set-mcp="1"] [data-conn="set-mcp"]');
    require(visible(button), "the second MCP server's setup action can be reached by scrolling");
    const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    require(hit && button.contains(hit), "the sticky set footer never covers the reached MCP setup action");
    return { check: name };
  }
  if (["skills-plugin-entry", "skills-marketplace", "skills-plugin-set", "skills-plugin-update", "skills-plugin-details"].includes(name)) {
    const section = document.querySelector('[data-skills-section]');
    require(section && document.querySelectorAll('[data-skills-section]').length === 1, "plugin sets stay in the one existing Skills section");
    if (name === "skills-plugin-entry") {
      const entries = [...document.querySelectorAll('[data-plugin-source]')];
      require(entries.length === 1 && entries[0].textContent.includes('research-tools · 1.2.0') && entries[0].textContent.includes('2 個技能'), "one plugin entry shows its name, version and skill count");
      require(document.querySelectorAll('.cs-dialog [data-conn="skill-import-local"]').length === 1, "one import action installs the entire plugin");
      require(document.querySelectorAll('.cs-dialog [data-conn="skill-import-alone"]').length === 2, "individual skill imports remain available in the disclosure");
      require(!document.querySelector('.cs-dialog').textContent.includes('local:'), "plugin entries hide internal source prefixes");
    }
    if (name === "skills-marketplace") {
      const supported = document.querySelector('[data-market-plugin="research-tools"]'), unsupported = document.querySelector('[data-market-plugin="npm-workflows"]');
      require(supported.textContent.includes('2.0.0') && !supported.querySelector('button').disabled, "a marketplace plugin shows the listed version and install action");
      require(unsupported.querySelector('button').disabled && unsupported.textContent.includes('僅支援 GitHub 來源'), "unsupported plugin sources explain why they cannot be installed");
      require(window.__look.calls.some(call => call.method === 'members.skills.list' && call.params.marketplace === 'sample/workflows'), "the owner adds the marketplace through the existing skill boundary");
    }
    if (name === "skills-plugin-set" || name === "skills-plugin-update") {
      const groups = [...section.querySelectorAll('[data-skill-set]')], rows = [...section.querySelectorAll('.cs-set .cs-skill')];
      require(groups.length === 1 && rows.length === 3 && rows.every(row => row.hasAttribute('data-library-skill')), "the set groups each shared skill and command exactly once");
      require(groups[0].textContent.includes('2 個技能 · 1 個指令'), "the installed set counts skills and slash commands separately");
      require(section.querySelectorAll('[data-conn="set-update"]').length === (name === 'skills-plugin-update' ? 1 : 0), "an update offer appears once for the complete set");
      require(section.querySelectorAll('[data-conn="skill-reimport"]').length === 0, "set members have no duplicate per-skill reimport action");
      if (name === 'skills-plugin-set') {
        const calls = window.__look.calls.filter(call => call.method === 'members.skills.import');
        require(calls.length === 1 && calls[0].params.plugin && calls[0].params.shared, "one owner action installs all plugin capabilities");
      }
      for (const button of section.querySelectorAll('[data-conn="set-update"]')) {
        const box = button.getBoundingClientRect(), parent = button.parentElement.getBoundingClientRect();
        require(box.left >= parent.left && box.right <= parent.right + 1, "the whole-set update fits its heading at every width");
      }
    }
    if (name === "skills-plugin-details") {
      const dialog = document.querySelector('[data-dialog="skill-set:1"]');
      require(visible(dialog) && dialog.querySelectorAll('.conversation-card.mcp-proposal').length === 2, "the set detail reuses one existing MCP card per declared server");
      require(dialog.querySelectorAll('[data-conn="set-mcp"]').length === 2 && !dialog.querySelector('[data-mcp-operation="enable"]'), "each server needs explicit setup before it can be added");
      require(dialog.textContent.includes('不執行事件鉤子、代理定義或其他外掛功能'), "the set states which plugin parts Raphael does not run");
      require(dialog.querySelector('[data-conn="set-delete"]') && dialog.querySelector('[data-conn="set-update"]'), "the set reuses the existing action row for removal and reimport");
    }
    require(!window.__look.calls.some(call => ['integrations.add','integrations.import','integrations.test','integrations.proposal'].includes(call.method)), "skill discovery, install and details never add or run MCP servers");
    return {check:name,sets:window.__look.data.skillSets.length};
  }
  if (["skills-section", "skills-installed-sources", "skills-import-shared", "skills-member-grants", "skills-source-changed"].includes(name)) {
    const sections = [...document.querySelectorAll('.cs-body [data-skills-section]')];
    require(sections.length === 1 && ![...document.querySelectorAll('.cs-body h2')].some(node => node.textContent === '技能庫'), "one skills section replaces the old split headings");
    const section = sections[0], heading = section.querySelector('.data-heading'), action = heading.querySelector('[data-conn="skill-discover"]');
    require(heading.querySelector('h2').textContent === '技能' && action.textContent.trim() === '匯入' && action.querySelector('svg'), "the skills header has one short icon action");
    const titleBox = heading.querySelector('h2').getBoundingClientRect(), actionBox = action.getBoundingClientRect();
    require(actionBox.left > titleBox.right && Math.abs((titleBox.top + titleBox.bottom - actionBox.top - actionBox.bottom) / 2) < 2, "import is aligned at the right of the skills heading");
    const firstApp = document.querySelector('.cs-body [data-stagger="installed"]');
    if (firstApp) require(Boolean(firstApp.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING), "skills follow the existing app section");
    const rows = [...section.querySelectorAll('.cs-skill')];
    const appSwitch = document.querySelector('.cs-item [data-conn="enable"]');
    for (const row of rows) {
      const control = row.querySelector('[data-conn="skill-enable"]'), open = row.querySelector('.cs-open');
      require(open && row.querySelector('.chev') && open.querySelectorAll('.ds').length === 2, "skill rows retain source, owner and document trigger");
      require(!open.textContent.includes('local:') && !open.textContent.includes('plugins/cache') && !open.textContent.includes('\\'), "skill source copy hides internal prefixes and cache paths");
      if (row.hasAttribute('data-library-skill')) {
        require(!control && open.querySelector('.cs-library-icon svg') && !open.querySelector('.slime'), "one neutral library row replaces inherited member rows");
        const iconBox = open.querySelector('.cs-library-icon svg').getBoundingClientRect();
        require(iconBox.width === 20 && iconBox.height === 20, "the library icon keeps the app icon size");
        const iconSlot = open.querySelector('.cs-library-icon').getBoundingClientRect();
        require(iconSlot.width === 28 && iconSlot.height === 28, "the library icon slot aligns with member faces");
        const members = window.__look.data.members.length;
        require(open.textContent.includes(`共享 · 已給 ${name === 'skills-member-grants' ? members - 1 : members} 位成員`), "the library row summarizes enabled member access");
      } else require(control, "private skill rows retain their member switch");
      require(!row.querySelector('button button'), "row actions are siblings rather than nested controls");
      if (appSwitch && control) require(Math.abs(control.getBoundingClientRect().height - appSwitch.getBoundingClientRect().height) < 1, "skill and neighbouring app switches share their size");
    }
    const library = rows.filter(row => row.hasAttribute('data-library-skill'));
    require(library.length === window.__look.data.skills.filter(skill => skill.member_id === -1).length, "each shared skill has exactly one Connections row");
    if (name === "skills-installed-sources") {
      const dialog = document.querySelector('[data-dialog="skill-import"] .cs-dialog');
      require(visible(dialog) && ['Claude Code', 'Codex', '外掛'].every((title, index) => dialog.querySelector(`[data-skill-origin="${index}"] h3`)?.textContent === title), "installed sources are grouped by origin");
      require(dialog.querySelectorAll('[data-conn="skill-import-local"]').length === 3, "each synthetic installed source offers import");
      require(dialog.textContent.includes('~/.claude/skills/weekly-summary') && dialog.textContent.includes('~/.codex/skills/source-check') && dialog.textContent.includes('文件工具 · 2.0.0'), "source groups show recognizable folders and plugin versions");
      require(!dialog.textContent.includes('local:') && !dialog.textContent.includes('plugins/cache'), "discovery hides internal source encodings too");
      require(window.__look.calls.some(call => call.method === 'members.skills.list' && call.params.discover), "the real discovery action crosses IPC");
    }
    if (name === "skills-import-shared") {
      require(!document.querySelector('[data-dialog="skill-import"]'), "successful import returns to the skills list");
      const calls = window.__look.calls.filter(call => call.method === 'members.skills.import');
      require(calls.length === 1 && calls[0].params.shared === true && calls[0].params.member_id === 0, "one package is imported through the shared owner scope");
      require(rows.length === 1 && library.length === 1 && library[0].textContent.includes('~/.claude/skills/weekly-summary'), "import creates a single attributed library row");
    }
    if (name === "skills-member-grants") {
      const dialog = document.querySelector('[data-dialog="skill:-1:20"]'), grants = [...dialog.querySelectorAll('[data-skill-grant]')];
      require(visible(dialog) && grants.length === window.__look.data.members.length && grants[0].dataset.skillGrant === '0', "the existing detail dialog lists every member with Raphael first");
      require(rows.length === 2 && section.querySelector('[data-k="cs-skill:1:21"]'), "the private skill keeps its separate member row");
      const on = dialog.querySelector('[data-k="cs-skill-enable:1:20"]'), off = dialog.querySelector('[data-k="cs-skill-enable:2:20"]');
      require(on?.getAttribute('aria-checked') === 'true' && off?.getAttribute('aria-checked') === 'false', "one member has the shared skill while another does not");
      for (const grant of grants) {
        const control = grant.querySelector('[role="switch"]'), box = control.getBoundingClientRect(), row = grant.getBoundingClientRect();
        require(visible(control) && box.right <= row.right + 1 && Math.abs(box.height - appSwitch.getBoundingClientRect().height) < 1, "grant switches use the existing control and fit their member rows");
      }
      const calls = window.__look.calls.filter(call => call.method === 'members.skills.update');
      require(calls.length === 3 && calls.map(call => `${call.params.member_id}:${call.params.enabled}`).join(',') === '1:false,2:false,1:true', "individual grants use ordinary member switches");
      require(window.__look.data.skills.find(skill => skill.id === 20).enabled, "individual choices never disable the library original");
    }
    if (name === "skills-source-changed") {
      const actions = [...section.querySelectorAll('[data-conn="skill-reimport"]')];
      require(actions.length === 1 && actions[0].parentElement.hasAttribute('data-library-skill') && actions[0].textContent.trim() === '重新匯入', "a changed shared source has one reimport action on its library row");
      require(library[0].textContent.includes('文件工具 · 2.0.0'), "imported plugins show their name and version");
      for (const button of actions) {
        const box = button.getBoundingClientRect(), chevron = button.parentElement.querySelector('.chev').getBoundingClientRect();
        require(box.right <= chevron.left && box.width > 0, "the single reimport action fits before the library chevron");
      }
    }
    return { check: name, rows: rows.length };
  }
  if (name === "apps-count") {
    const tab = document.querySelector('.modal-scrim [data-conn="tab"][data-id="installed"] .n');
    require(visible(tab) && !document.querySelector('.nav-apps'), "Settings alone contains the connected app count");
    const rows = document.querySelectorAll('.modal-scrim .cs-body [data-stagger="installed"] > .cs-item').length;
    return window.__TAURI_INTERNALS__.invoke("core_call", {method:"members.list",params:{}}).then(({team_context:roster})=>{
      require(String(roster.connected) === tab.textContent.trim() && rows === roster.connected, "Settings count agrees with the shared roster and installed rows");
      return {check:name,count:roster.connected,apps:roster.apps.length};
    });
  }
  if (name === "apps-unreadable") {
    const tab=document.querySelector('.modal-scrim [data-conn="tab"][data-id="installed"] .n');
    require(visible(tab) && tab.textContent.trim() === "—", "Settings states an unknown count without inventing a number");
    return window.__TAURI_INTERNALS__.invoke("core_call",{method:"members.list",params:{}}).then(({team_context:roster})=>{
      require(roster.connected === null && roster.inventory_state !== "complete", "the roster states no number either");
      return {check:name,state:roster.inventory_state};
    });
  }
  if (name === "connections-dialog-actions") {
    const dialog = document.querySelector('.cs-scrim .cs-dialog');
    const buttons = [...(dialog?.querySelectorAll('.action-row button') ?? [])];
    require(visible(dialog) && buttons.length > 0, "the dialog has footer actions");
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      require(box.width > 0 && box.height > 0 && (hit === button || button.contains(hit)), `footer action "${button.textContent.trim()}" is covered by a toast or another element`);
    }
    return { check: name, buttons: buttons.length };
  }
  if (name === "connections-binary") {
    const controls = [...document.querySelectorAll('.cs [aria-checked], .cs-scrim [aria-checked]')];
    require(controls.length > 0, "connections has switches");
    require(controls.every(node => ['true', 'false'].includes(node.getAttribute('aria-checked'))), "connections switches never have a mixed or middle state");
    return { check: name, switches: controls.length };
  }
  if (name === "connector-link-refused") {
    require(document.querySelector('.cs-dialog .note[role="alert"]')?.textContent.includes('Composio 尚未允許這個應用程式登入，請重試連結。'), "a toolkit refusal has dedicated actionable copy inside the app dialog");
    require(![...document.querySelectorAll('.toast')].some(node => node.textContent.includes('Composio 尚未允許')), "the sign-in refusal never covers the dialog as a toast");
    require(window.__look.calls.some(call => call.method === 'connectors.connect' && call.params.toolkit === 'notion'), "the real managed sign-in boundary was used");
    require(!document.body.textContent.includes('ToolRouterV2_ToolkitNotAllowed'), "provider error slugs never reach the interface");
    return { check: name };
  }
  if (name === "app-switch-all") {
    const calls = window.__look.calls.filter(call => call.method?.startsWith("integrations.set_") && call.params?.id === "github");
    const server = window.__look.data.servers.find(item => item.id === "github");
    require(calls.length === 2 && calls.every(call => call.method === 'integrations.set_enabled'), "app switches only enable and disable the app");
    require(calls[0].params.enabled === false && calls[1].params.enabled === true, "app turns off then on");
    require(server.enabled && server.tools.filter(tool => !tool.enabled).length === 18, "app changes preserve the 18 tool exclusions");
    return { check: name, calls: calls.length };
  }
  if (name === "connector-folded") {
    const dialog = document.querySelector(".modal-scrim .cs-dialog");
    require(visible(dialog) && dialog.querySelectorAll('[data-conn="enable"]').length === 1, "the app's dialog has its one switch");
    require(dialog.querySelector('[data-conn="enable"]').getAttribute("aria-checked") === "true", "the app stays enabled independently of tools");
    const kinds = [...dialog.querySelectorAll('[data-conn="kind"]')];
    require(kinds.length === 2 && kinds[0].dataset.kind === 'write' && kinds[1].dataset.kind === 'read', "both kinds are reachable above the folded list");
    require(kinds[0].getAttribute('aria-checked') === 'false' && kinds[1].getAttribute('aria-checked') === 'true', "kind switches reflect their own tools only");
    require(!dialog.querySelector('[data-conn="tool"]'), "individual switches remain folded");
    require(dialog.querySelector('[data-k="cs-count"]')?.textContent.includes("30/46"), "one line says how many tools are on");
    const calls = window.__look.calls.filter(call => call.method === 'integrations.set_tools_enabled' && call.params.id === 'github');
    require(calls.length === 3 && calls[0].params.tools.length === 16 && calls[0].params.enabled && calls[1].params.tools.length === 30 && calls[1].params.enabled && !calls[2].params.enabled, "each kind changes in a single bulk RPC");
    require(!window.__look.calls.some(call => call.method === 'integrations.set_tool_enabled' || call.method === 'integrations.set_enabled'), "kind switches never rewrite the app or loop through per-tool RPCs");
    require(dialog.scrollHeight <= dialog.clientHeight + 1, "the folded dialog fits without scrolling");
    return { check: name };
  }
  if (name === "connector-tools") {
    // An app's page: the account it is signed in with, N of its M tools on with a switch for each, and its actions flush with the dialog's edge.
    const dialog = document.querySelector(".modal-scrim .cs-dialog"), switches = [...(dialog?.querySelectorAll('[data-conn="tool"]') ?? [])];
    require(visible(dialog) && switches.length > 0, "the app's page and the switches of its tools are visible");
    require(dialog.querySelectorAll(".cs-acct").length > 0, "the account it is signed in with is listed");
    const on = switches.filter(node => node.getAttribute("aria-checked") === "true").length, count = dialog.querySelector('[data-k="cs-count"]')?.textContent ?? "";
    require(count.includes(`${on}/${switches.length}`), `the page says "${count}" while ${on} of ${switches.length} tools are on`);
    const acts = dialog.querySelector(".action-row.is-sticky"), box = acts.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
    require(acts.contains(document.elementFromPoint(box.left + box.width / 2, frame.bottom - 3)), "no tool shows through under the actions");
    const calls = window.__look.calls.filter(call => call.method === 'connectors.set_tools' && call.params.id === 'composio:notion');
    require(calls.length === 4 && calls.every(call => !('enabled' in call.params)), "managed kind switches only update disabled_tools");
    require(calls[0].params.disabled_tools.length === 3 && calls[1].params.disabled_tools.length === 0 && calls[2].params.disabled_tools.length === 6 && calls[3].params.disabled_tools.length === 0, "write and read permissions change independently and return on");
    return { check: name, on, tools: switches.length };
  }
  if (name === "skill-page") {
    const dialog = document.querySelector(".modal-scrim .cs-dialog.wide"), text = dialog?.querySelector("#skill-text");
    require(visible(dialog) && visible(text), "the page of a skill and its document are visible");
    const acts = [...dialog.querySelectorAll(".action-row > *")].flatMap(node => node.matches("button") ? [node] : [...node.querySelectorAll("button")]);
    const del = dialog.querySelector('[data-conn="skill-delete"]'), save = dialog.querySelector('[data-conn="skill-save"]');
    require(acts.indexOf(del) === 0 && acts.at(-1) === save, "delete is first and save is last in the action row");
    require(text.value.startsWith("---") && /\nname: [^\n]+\ndescription: [^\n]+\n---/.test(text.value), "the document is shown whole, from its first line");
    const box = text.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
    require(box.left >= frame.left && box.right <= frame.right, "the document sits inside its dialog");
    require(text.scrollWidth <= text.clientWidth + 1, "the document does not scroll sideways");
    require(dialog.querySelector('[data-cs-notice][role="status"]')?.textContent.includes('已儲存技能'), "save feedback stays inside the skill dialog");
    require(![...document.querySelectorAll('.toast')].some(node => node.textContent.includes('已儲存技能')), "skill saving never covers the dialog as a toast");
    require(text.scrollTop === 0, `the document starts at its first line, not ${text.scrollTop}px down (${text.clientHeight}px box, ${text.scrollHeight}px of text)`);
    return { check: name, rows: text.rows, chars: text.value.length, box: text.clientHeight, text: text.scrollHeight };
  }
  if (name === "settings-shell") {
    const modal = document.querySelector(".modal"), close = modal?.querySelector(".modal-x");
    require(visible(modal) && visible(close), "settings and its close control are visible");
    require(getComputedStyle(modal).borderTopLeftRadius === "12px", "settings uses the dialog radius rather than a pill");
    const box = close.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    require(close === hit || close.contains(hit), "rounded corners do not clip the close control");
    return { check: name, radius: getComputedStyle(modal).borderTopLeftRadius };
  }
  if (name === "dictation-heat-day") {
    const said = document.querySelector('.heat-said');
    require(visible(said) && /字/.test(said.textContent) && said.textContent.includes('10 月 24 日'), 'the pressed day says its words beside the grid');
    require(visible(document.querySelector('.page-overview .heat')) && !visible(document.querySelector('.day-row')), 'the grid stays, and no history opened');
    return { check: name, said: said.textContent };
  }
  if (name === "dictation-navigation") {
    const nav = document.querySelector(".dictation-nav"), tabs = [...nav.querySelectorAll('[role="tab"]')];
    const active = tabs.filter(tab => tab.getAttribute("aria-selected") === "true");
    require(nav.getAttribute("aria-orientation") === "horizontal" && active.length === 1, "one selected horizontal tab");
    const panel = document.getElementById(active[0].getAttribute("aria-controls"));
    require(visible(panel) && !panel.hidden, "selected navigation displays its panel");
    const navBox = nav.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
    require(navBox.bottom < panelBox.top, "tabs remain above the content");
    for (let i = 1; i < tabs.length; i++) require(tabs[i].getBoundingClientRect().left >= tabs[i - 1].getBoundingClientRect().right, "tabs form a horizontal row");
    require(panel.scrollWidth <= panel.clientWidth + 1, "selected content fits its column");
    return { check: name, selected: active[0].dataset.dictationTab, panelWidth: panel.clientWidth };
  }
  if (name === "dictation-overview") {
    const cards = [...document.querySelectorAll('.page-overview .icard')];
    require(cards.length === 4, "four independent totals are visible");
    const boxes = cards.map(card => card.getBoundingClientRect());
    const desktop = document.querySelector('.dictation-content').clientWidth >= 760;
    require(boxes[0].top === boxes[1].top && boxes[2].top > boxes[0].bottom && boxes[2].top === boxes[3].top, "totals keep two by two rows at every width");
    for (const card of cards) require(getComputedStyle(card).borderTopWidth === '1px' && getComputedStyle(card).backgroundColor !== 'rgba(0, 0, 0, 0)', "each total has its own card surface");
    const activity = document.querySelector('.page-overview .activity').getBoundingClientRect();
    const shortcuts = document.querySelector('.page-overview .keys-card').getBoundingClientRect();
    require(activity.top >= boxes[3].bottom, "activity follows the totals");
    require(desktop ? shortcuts.left >= activity.right : shortcuts.top >= activity.bottom && Math.abs(shortcuts.width - activity.width) < 1, "compact windows order totals, full-width activity, then full-width shortcuts");
    require(document.querySelector('.heat rect.h1, .heat rect.h2, .heat rect.h3, .heat rect.h4').getBoundingClientRect().width >= 17, "activity days retain larger readable cells");
    return { check: name, desktop, cardWidth: boxes[0].width };
  }
  if (name === "conversation-design") {
    const bubble = document.querySelector(".bubble"), answer = document.querySelector('[data-reply] > .ans');
    for (const element of [bubble, answer]) {
      require(visible(element), "owner and assistant messages are visible");
      const style = getComputedStyle(element);
      require(style.fontSize === "15px" && style.lineHeight === "24px", "messages use 15px type at 1.6 line height");
      require(style.borderTopLeftRadius === "12px", "messages use the shared card radius");
    }
    require(getComputedStyle(answer).borderTopWidth === "0px", "assistant bubble has no decorative border");
    plainWords();
    const column = document.querySelector(".mb-col");
    if (visible(column)) {
      const rows = [...column.querySelectorAll(".mb-row[data-member]")], first = rows[0];
      require(first.dataset.member === "0", "Raphael is first");
      if (!column.classList.contains("is-collapsed")) {
        require(Math.abs(first.querySelector(".av").getBoundingClientRect().width - 40) < 1, "the chief shares the conversation avatar size");
        for (const row of rows.slice(1)) require(Math.abs(row.querySelector(".av").getBoundingClientRect().width - 40) < 1, "other members share 40px faces");
      }
    }
    return { check: name, sidebarVisible: visible(column), fontSize: getComputedStyle(bubble).fontSize };
  }
  if (name === "member-column") return checkRendered("sidebar-shell");
  // Primary is a display position; the room's coordinator remains identity 0.
  if (name === "member-menu") {
    // Grok Bot's row menu (owner, 2026-11-06): groups split by hairlines, the destructive item last and red.
    const menu = document.querySelector('#app-popover');
    require(visible(menu), "the member's menu is open");
    const shape = [...menu.children].map(node => node.matches('[role="separator"]') ? "|" : node.dataset.pick).join(" ");
    require(shape === "pin move unread | edit | export-template | hide delete", `the menu is grouped as Grok's: ${shape}`);
    for (const line of menu.querySelectorAll('[role="separator"]')) {
      const box = line.getBoundingClientRect();
      require(box.height >= 1 && box.height <= 9 && box.width > menu.getBoundingClientRect().width * 0.7, "each hairline spans the menu");
    }
    const remove = menu.querySelector('[data-pick="delete"]');
    require(remove.classList.contains('danger') && getComputedStyle(remove).color !== getComputedStyle(menu.querySelector('[data-pick="pin"]')).color, "刪除 is last and red");
    require(!menu.querySelector('[data-pick="primary"], [data-pick="clear"], [data-pick="duplicate"], [data-pick="read-all"]'), "an ordinary member's menu has nothing more");
    const box = menu.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu is inside the viewport");
    return { check: name, shape };
  }
  if (name === "primary-menu") {
    const menu = document.querySelector('#app-popover');
    require(visible(menu), "the primary's menu is open");
    const items = [...menu.querySelectorAll('[data-pick]')], picks = items.map(item => item.dataset.pick), row = items[picks.indexOf('primary')];
    require(row && picks.at(-1) === 'primary' && picks.filter(pick => pick === 'primary').length === 1 && row.previousElementSibling?.matches('[role="separator"]'), "換成其他成員 is one item, last, after a hairline");
    require(visible(row.querySelector('.ck svg.i')) && row.textContent.trim() !== "" && !row.classList.contains('danger'), "the primary action keeps its label and a non-star icon");
    const box = menu.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu is inside the viewport");
    require(window.__look.calls.every(call => call.method !== "members.set_primary"), "opening the menu sets nothing");
    require(!document.querySelector('.mb-star'),'no member carries a star');
    return { check: name, items: picks.length };
  }
  if (name.startsWith("primary-")) {
    const data = window.__look.data, calls = window.__look.calls;
    const sets = calls.filter(call => call.method === "members.set_primary");
    const column = document.querySelector('.mb-col');
    require(!document.querySelector('.mb-star'),'no member carries a star');
    const order = nodes => [...nodes].map(node => Number(node.dataset.member ?? node.dataset.id ?? node.dataset.value ?? node.dataset.dragMember));
    const swapped = ids => {
      const result = [...ids], chief = result.indexOf(0), primary = result.indexOf(data.primaryId);
      if (chief >= 0 && primary >= 0) [result[chief], result[primary]] = [result[primary], result[chief]];
      return result;
    };
    const columnSwap = () => {
      const rows = [...column.querySelectorAll('.mb-list [data-member]')];
      require(Number(rows[0].dataset.member) === data.primaryId, "the primary occupies the column's top slot");
      require(rows.filter(row => row.dataset.member === '0').length === 1, "Raphael appears exactly once");
      require(column.querySelector('[data-member="0"] .av') && !column.querySelector('[data-member="0"] .mb-av'), "Raphael keeps his emblem in the exchanged slot");
      require(column.querySelector('.mb-sec [data-member="0"]') || data.primaryId === 0 || column.classList.contains('is-collapsed'), "Raphael takes the primary's group slot");
      return order(rows);
    };
    if (name === "primary-picker") {
      const dialog = document.querySelector('.mb-dialog.mb-primary-picker');
      require(visible(dialog), "the picker window is open");
      require(dialog.querySelector('h2').textContent.trim() !== "" && dialog.querySelector('h2').textContent === dialog.querySelector('[role="radiogroup"]').getAttribute('aria-label'), "it is titled 選擇主要成員, and its list is named by the title");
      const choices = [...dialog.querySelectorAll('[role="radio"]')];
      require(choices.length >= 3 && choices.every(button => button.tagName === 'BUTTON' && visible(button)), "the members are real buttons");
      require(!dialog.querySelector('select, input[type=radio], input[type=checkbox]'), "no native controls");
      require(data.primaryId === 1 && choices.some(button => button.dataset.id === '0') && !choices.some(button => button.dataset.id === '1'), "小晴 is the primary now and is not offered, and Raphael can be chosen again");
      const picked = choices.filter(button => button.getAttribute('aria-checked') === 'true');
      require(picked.length === 1 && picked[0].dataset.id === '2' && visible(picked[0].querySelector('svg.i')), "the member clicked is the one chosen, and it carries a check");
      const set = dialog.querySelector('[data-dlg="set"]'), actions = [...dialog.querySelectorAll('.mb-dlg-act .btn')];
      require(!set.disabled && set.classList.contains('pri'), "設為主要 is the enabled primary action");
      require(actions.at(-1) === set && actions.at(-2)?.dataset.dlg === 'cancel', "the primary action is rightmost and 取消 is just left of it");
      const box = dialog.getBoundingClientRect();
      require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the window is inside the viewport");
      for (const button of choices) {
        const b = button.getBoundingClientRect();
        require(b.left >= box.left && b.right <= box.right && b.height >= 40, `${button.textContent.trim()} is a whole row inside the window`);
      }
      require(sets.length === 0 && data.primaryId === 1, "nothing is set before 設為主要 is pressed");
      return { check: name, choices: choices.length, picked: picked[0].dataset.id };
    }
    if (name === "primary-mentions") {
      const rows = [...document.querySelectorAll('#app-popover[data-team-mentions] [data-value]')].slice(1, data.members.length + 1);
      const expected = swapped(data.members.map(m => m.id)).map(id => data.members.find(m => m.id === id).name);
      require(JSON.stringify(rows.map(row => row.dataset.value)) === JSON.stringify(expected), "mentions swap member order without changing names");
      return { check: name, members: expected };
    }
    if (name === "primary-room-picker" || name === "primary-routine-picker" || name === "primary-calendar") {
      const rows = [...document.querySelectorAll(name === 'primary-calendar' ? '[data-drag-member]' : '[data-dlg="member"]')].filter(visible);
      require(JSON.stringify(order(rows)) === JSON.stringify(swapped(data.members.map(m => m.id))), "member choices exchange only the primary and Raphael");
      if (name === 'primary-room-picker') {
        const chief = document.querySelector(`[data-dlg="member"][data-member="${data.primaryId}"]`);
        require(chief.disabled && chief.getAttribute('aria-pressed') === 'true', "the current chief is required");
        const picked = document.querySelector('[data-picked]');
        if (picked) {
          const expected = [...rows].filter(row => row.getAttribute('aria-pressed') === 'true').map(row => data.members.find(m => m.id === Number(row.dataset.member)).name);
          require(JSON.stringify([...picked.children].map(chip => chip.textContent)) === JSON.stringify(expected), "selected member chips retain the exchanged order after a click");
        }
      }
      if (name === 'primary-routine-picker') require(document.querySelector('[data-dlg="member"][data-member="0"]').getAttribute('aria-pressed') === 'true', "routine selection does not follow the display swap");
      return { check: name, members: order(rows) };
    }
    if (name === "primary-set") {
      require(sets.length === 1 && sets[0].params.id === 1 && data.primaryId === 1, "one boundary call chose 小晴 and nothing else");
      require(!document.querySelector('.mb-dialog'), "the window closed");
      require(!calls.some(call => /^(rooms|routines|worker|agent)\./.test(call.method ?? '') && /(update|create|delete|rerun|cancel|ask|stop)/.test(call.method)), "no room, routine, task or conversation was touched");
      const members = visible(column) ? columnSwap() : [];
      require(visible(document.querySelector('.mb-det .mb-who-face')), "the selected member's details remain available without a star");
      return { check: name, members };
    }
    require(sets.length === 0, "this scene only displays the existing primary");
    const members = visible(column) ? columnSwap() : [];
    if (name === "primary-column") return { check: name, members };
    const room = data.rooms[0], faces = [...document.querySelectorAll('.au-room-heading .au-room-participant')];
    require(room.member_ids.includes(0) && faces.length === room.member_ids.length, "every room member is still present");
    const crowned = faces.filter(face => face.querySelector('.au-room-crown'));
    require(crowned.length === 1 && crowned[0] === faces[0], "only the current chief wears the crown");
    require(data.members.find(m => m.id === data.primaryId).name === faces[0].dataset.tooltip.split(' · ')[0], "the room's face list follows primary display order");
    const card = document.querySelector('.au-room-wrapup');
    require(visible(card) && card.querySelector('.ra-face'), "the current chief writes the wrap-up");
    require(document.querySelectorAll('.au-room-wrapup').length === 1 && (document.querySelector('.au-room-thread .tn:last-child .au-room-wrapup') || document.querySelector('.au-room-thread .tn:last-child.au-room-wrapup')), "the room ends with one wrap-up");
    return { check: name, crowned: crowned[0].dataset.tooltip, members };
  }
  if (name === "store-toolbar-visible") {
    const pane = document.querySelector('.modal-body'), frame = pane.getBoundingClientRect();
    const strip = document.querySelector('.cs-store-groups').getBoundingClientRect();
    const controls = [document.querySelector('#conn-search'), ...[...document.querySelectorAll('.cs-store-groups button')].filter(button => {
      const box = button.getBoundingClientRect();
      return box.left >= strip.left && box.right <= strip.right;
    })];
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      require(box.top >= frame.top && box.bottom <= frame.bottom && control.contains(hit), "search and group chips stay visible while results scroll");
    }
    const results = document.querySelector('.cs-results');
    require(results && results.scrollTop > 0 && pane.scrollTop === 0, "only the catalog results scroll");
    return { check: name, scrollTop: results.scrollTop, controls: controls.length };
  }
  if (name === "connections-form-edges" || name === "connections-form-end") {
    const grid = document.querySelector('.cs-form .add-grid'), port = grid.getBoundingClientRect();
    const last = document.querySelector('#conn-limit'), edge = last.getBoundingClientRect().right;
    if (name === "connections-form-edges") {
      const add = document.querySelector('[data-k="conn-add"]'), save = document.querySelector('.add-acts [data-conn="connect"]');
      const rights = [add, save].map(button => button.getBoundingClientRect().right);
      require(rights.every(right => Math.abs(right - edge) <= 1), `header and footer actions share the form field right edge: fields ${edge}, actions ${rights.join(', ')}`);
      return { check: name, right: edge };
    }
    const footer = document.querySelector('.cs-form > .trust').getBoundingClientRect();
    for (const field of [document.querySelector('#conn-pairs').closest('.fld'), last.closest('.fld')]) {
      const box = field.getBoundingClientRect();
      // scroll-padding brings a field to exactly 16 px; sub-pixel layout may land a tenth short.
      require(box.top >= port.top - 1 && box.bottom <= Math.min(port.bottom, footer.top) - 15, "last fields scroll fully above the fixed footer with bottom space");
    }
    return { check: name, bottomGap: port.bottom - last.getBoundingClientRect().bottom };
  }
  if (name === "plugins-store-last-detail") {
    require(document.querySelector('.cs-page h2')?.textContent.includes('360'), "search reaches the last app's detail");
    return { check: name };
  }
  if (name === "plugins-store-empty") {
    require(visible(document.querySelector('.cs-none')) && document.querySelectorAll('.cs-card').length === 0, "empty query has a clear state and no stale rows");
    require(visible(document.querySelector('#conn-search')) && document.querySelectorAll('[data-conn="store-group"]').length === 10, "search and broad groups stay reachable");
    return { check: name };
  }
  if (["plugins-store-groups", "plugins-store-search", "plugins-store-category"].includes(name)) {
    const groups = document.querySelector('.cs-store-groups');
    const style = getComputedStyle(groups), chips = [...groups.querySelectorAll('button')];
    require(style.flexWrap === 'nowrap' && style.overflowX === 'auto' && style.scrollbarWidth === 'none', "category chips scroll on one row without a visible scrollbar");
    const chipRow = groups.closest('[data-chip-row]'), end = groups.scrollWidth - groups.clientWidth;
    require(style.maskImage.includes('linear-gradient') && chipRow.hasAttribute('data-more-before') === groups.scrollLeft > 1 && chipRow.hasAttribute('data-more-after') === groups.scrollLeft < end - 1, "category overflow fades only at an end with more chips behind it");
    require([['-1', 'data-more-before'], ['1', 'data-more-after']].every(([dir, more]) => !!visible(chipRow.querySelector(`[data-chip-step="${dir}"]`)) === chipRow.hasAttribute(more)), "an arrow stands only at an end with more categories behind it");
    require(chips.every(chip => Math.abs(chip.getBoundingClientRect().top - chips[0].getBoundingClientRect().top) <= 1), "every category chip shares one row");
    const rows = [...document.querySelectorAll('.cs-card')];
    const ids = rows.map(row => row.querySelector('[data-conn="open-store"]').dataset.id);
    require(new Set(ids).size === rows.length, "each app appears once");
    require(rows.length <= 42, "connected, popular and result pages keep DOM bounded");
    require(!document.querySelector('[data-k="conn-category"]'), "provider categories do not become a dropdown");
    require(document.querySelectorAll('[data-conn="store-group"]').length === 10, "nine broad groups and All are available");
    require(window.__look.calls.filter(c => c.method === 'connectors.catalog').every(c => !c.params?.search && !c.params?.category && !c.params?.cursor), "query and group changes search the complete local index");
    const pager = document.querySelector('.cs-store-pages .num');
    if (pager) require(Number(pager.textContent.split('/')[1].trim()) === Number(document.querySelector('[data-k="conn-tab:store"] .n').textContent), "store tab and pager count the same addable apps");
    if (name === "plugins-store-search") require(rows.length === 1 && rows[0].textContent.includes('360'), "search reaches the last app across groups");
    if (name === "plugins-store-category") require(document.querySelector('[data-conn="store-group"][data-id="productivity"]').getAttribute('aria-pressed') === 'true', "the chosen broad group stays pressed");
    return { check: name, rows: rows.length, ids };
  }
  if (name === "store-groups-wheel" || name === "store-groups-start") {
    const groups = document.querySelector('.cs-store-groups'), chipRow = groups.closest('[data-chip-row]'), body = document.querySelector('.modal-body');
    const before = chipRow.querySelector('[data-chip-step="-1"]'), after = chipRow.querySelector('[data-chip-step="1"]');
    const reachable = button => { const box = button.getBoundingClientRect(); return visible(button) && button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); };
    require(groups.scrollWidth > groups.clientWidth + 1, "the categories are wider than their row at this size");
    if (name === "store-groups-wheel") {
      require(groups.scrollLeft > 0 && chipRow.hasAttribute('data-more-before') && reachable(before), "the mouse wheel moved the categories sideways and the left arrow can be pressed");
      require(!body || body.scrollTop === 0, "the wheel over the categories did not scroll the page under them");
    } else require(groups.scrollLeft <= 1 && !visible(before) && reachable(after), "the left arrow brought the categories back to the start, where only the right arrow stands");
    return { check: name, scrollLeft: groups.scrollLeft };
  }  if (name === "store-group-focus") {
    const groups = document.querySelector('.cs-store-groups'), chip = document.activeElement;
    require(groups?.contains(chip) && chip.matches('[data-conn="store-group"]'), "keyboard focus reaches a category chip");
    const frame = groups.getBoundingClientRect(), box = chip.getBoundingClientRect();
    require(box.left >= frame.left - 1 && box.right <= frame.right + 1 && chip.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)), "the focused category is fully visible and clickable");
    return { check: name, category: chip.dataset.id, scrollLeft: groups.scrollLeft };
  }
  if (name === "store-group-end") {
    const groups = document.querySelector('.cs-store-groups'), frame = groups.getBoundingClientRect();
    const last = groups.querySelector('[data-id="other"]'), box = last.getBoundingClientRect();
    require(last.getAttribute('aria-pressed') === 'true' && document.activeElement === last, "keyboard selection retains the last category and focus after redraw");
    require(box.left >= frame.left - 1 && box.right <= frame.right + 1 && last.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)), "the last category is fully visible and reachable after horizontal scrolling");
    return { check: name, scrollLeft: groups.scrollLeft };
  }
  if (name === "plugins-store-settled") {
    const rows = [...document.querySelectorAll('.cs-card')];
    require(rows.length > 0 && rows.every(row => Number(getComputedStyle(row).opacity) >= .99), "all popular and result rows have finished fading in");
    const sections = [...document.querySelectorAll('.cs-sec')];
    for (let index = 1; index < sections.length; index++) {
      require(sections[index].getBoundingClientRect().top - sections[index - 1].getBoundingClientRect().bottom <= 32, "sections have only the shared spacing gap");
    }
    return { check: name, rows: rows.length, opacity: rows.map(row => Number(getComputedStyle(row).opacity)) };
  }
  if (name === "plugins-store-rows") {
    const rows = [...document.querySelectorAll('.cs-card')];
    require(rows.length > 0, "the store has app rows");
    const add = [...document.querySelectorAll('.cs-card [data-conn="join"]')];
    require(add.length > 0 && add.every(button => button.className === add[0].className && button.className === 'btn sm'), "every store add button has the same outlined class list");
    for (const row of rows) {
      const [main, action] = row.children;
      require(row.className === 'cs-card' && row.children.length === 2, "every app row has the same two slots");
      require(main.tagName === 'BUTTON' && main.className === 'btn cs-main' && main.dataset.conn === 'open-store', "every source uses the same detail button");
      require(main.children.length === 2 && main.children[0].className === 'ic' && main.children[1].className === 'tx', "every row has the same mark and text structure");
      const [title, summary] = main.children[1].children;
      require(main.children[1].children.length === 2 && title.tagName === 'SPAN' && title.className === 'nm' && summary.tagName === 'SPAN' && ['sub', 'sub wait'].includes(summary.className), "every row has the same name and one-line summary");
      require(action.matches('button.btn.sm[data-conn="join"], button.btn.sm[data-conn="cancel-login"], span.cs-state'), "every state stays in the shared inline action slot");
      const style = window.getComputedStyle(row);
      const divider = window.getComputedStyle(row, '::after');
      require(style.display === 'grid' && style.gridTemplateColumns.trim().split(/\s+/).length === 2 && parseFloat(style.borderRadius) > 0 && parseFloat(style.borderBottomWidth) === 0 && parseFloat(style.borderLeftWidth) === 0 && divider.height === '1px', "every source keeps the same compact row, a rounded hover and an inset divider");
      const frame = row.getBoundingClientRect();
      require([main, action, title, summary].every(node => {
        const box = node.getBoundingClientRect();
        return box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
      }), "store names, summaries and actions fit inside their row");
    }
    return { check: name, rows: rows.length, addClass: add[0].className };
  }
  if (name === "plugins-store") {
    const cards = [...document.querySelectorAll('.cs-card')];
    const ids = cards.map(card => card.querySelector('[data-conn="open-store"]')?.dataset.id);
    require(document.querySelectorAll('.cs-card [data-conn="join"]').length <= Number(document.querySelector('[data-k="conn-tab:store"] .n').textContent), "tab count includes all addable matches beyond the visible page");
    require(document.querySelector('[data-stagger="store:hot"] .cs-card') && document.querySelector('[data-stagger="store:all"] .cs-card'), "popular and all built-in sections remain available");
    require(window.__look.calls.some(c => c.method === 'integrations.catalog'), "built-in catalog uses the real IPC boundary");
    require(!document.querySelector('#conn-key'), "key form does not replace the store");
    require(new Set(ids).size === cards.length, "duplicate apps appear once");
    if (window.__look.data.composioConfigured) {
      require(document.querySelector('.cs-store-groups'), "all catalog sources share broad group chips");
      require(document.querySelector('[data-conn="open-store"][data-id="notion"]'), "the built-in app wins over its managed duplicate");
    } else {
      require(document.querySelector('[data-conn="configure-composio"]'), "optional Composio row follows the built-ins");
      require(!window.__look.calls.some(c => c.method === 'connectors.catalog'), "missing key never requests the managed catalog");
    }
    return { check: name, cards: cards.length };
  }
  if (name === "plugins-builtin-join") {
    require(window.__look.calls.some(c => c.method === 'integrations.connect' && c.params.catalog_id === 'github'), "own sign-in uses the built-in RPC");
    require(!window.__look.calls.some(c => c.method === 'connectors.connect'), "own sign-in is independent of Composio");
    require(visible(document.querySelector('.cs-card .sub.wait')), "the pending sign-in is visible");
    return { check: name };
  }
  if (name === "plugins-key-openrouter" || name === "plugins-key-consumer") {
    require(visible(document.querySelector('[role="dialog"] #conn-key')), "the key field belongs to a small connection dialog");
    const alert = document.querySelector('.cs-key-form [role="alert"]');
    const consumer = name === "plugins-key-consumer";
    const expected = consumer ? {
      "zh-TW": "這是 Composio 的消費者金鑰（ck_ 開頭）。請改用專案金鑰：Composio「Settings → Project Settings → API Keys」。",
      en: "This is a Composio consumer key (starting with ck_). Use a project key from Composio Settings → Project Settings → API Keys.",
      ja: "これは Composio のコンシューマーキー（ck_ で始まるキー）です。Composio の「Settings → Project Settings → API Keys」にあるプロジェクトキーを使用してください。",
    } : {
      "zh-TW": "這是 OpenRouter 的金鑰，請到「設定 → 模型與用量」輸入。",
      en: "This is an OpenRouter key. Enter it in Settings → Models and usage.",
      ja: "これは OpenRouter のキーです。「設定 → モデルと使用量」で入力してください。",
    };
    require(visible(alert) && Object.values(expected).includes(alert.textContent), "the key form explains how to correct the key type");
    require(document.querySelector('#conn-key').value === "", "the key field is cleared");
    require(!document.body.textContent.includes(consumer ? 'ck_look-synthetic' : 'sk-or-look-synthetic'), "the error never echoes the key");
    require(!window.__look.data.composioConfigured, "the wrong key never configures Composio");
    require(window.__look.calls.filter(c => c.method === 'connectors.set_key').length === 1, "the error comes through the real IPC boundary");
    return { check: name, message: alert.textContent };
  }
  if (name === "usage-plain") {
    // As plain as Grok Bot's (owner, 2026-11-06): what each subscription has left, then the key and what was spent.
    const panel = document.querySelector('#models-panel-usage');
    require(visible(panel), "the usage tab is open");
    require(!panel.querySelector('svg.ua-chart, .ua-chart, .run-tiles, .run-tile, .run-bill, .run-groups, table, [data-range], [data-run-act="export"], [data-run-act="period"], .foot'), "no periods, charts, breakdowns, tiles, exports or footnotes");
    const rows = ["openrouter-key", "raphael-spend", "openrouter-usage"].map(row => panel.querySelector(`[data-row="${row}"]`));
    require(rows.every(visible), "the key, what Raphael spent this month and the key's own usage are rows");
    const cards = [...panel.querySelectorAll('.run-subscription')].filter(visible), allowance = panel.querySelector('.run-allowance');
    const subscriptions = window.__look.data.allowances.brains.length;
    if (subscriptions) {
      require(cards.length >= subscriptions && allowance.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING, "each subscription has a card, above the rows");
      for (const track of panel.querySelectorAll('.run-allowance .run-bar-track')) {
        const fill = track.querySelector('i'), box = track.getBoundingClientRect();
        require(box.width > 0 && box.height === 7 && fill.getBoundingClientRect().height === 7, "allowance bars keep their visible height");
      }
    } else require(!visible(allowance), "with no subscription the allowance section stands aside");
    return { check: name, cards: cards.length };
  }
  if (name === "overlay-percentage") {
    const caption = document.querySelector("#progress");
    require(visible(caption) && /^\u300a \d+ % \u300b$/.test(caption.textContent), "original percentage caption is visible");
    require(Number(caption.textContent.match(/\d+/)[0]) > 0, "native progress advances beyond the initial zero");
    require(!document.body.textContent.includes("Transcribing") && !document.body.textContent.includes("\u8f49\u9304\u4e2d"), "elapsed-time captions are absent");
    return { check: name, caption: caption.textContent };
  }
  if (name === "member-details") {
    const panel = document.querySelector(".mb-det"), title = document.querySelector(".conversation-trigger");
    require(visible(panel), "details panel is visible");
    require(title.getAttribute("aria-expanded") === "true", "title reflects the panel state");
    require(title.getAttribute("aria-controls") === panel.id && !title.hasAttribute("aria-haspopup"), "title controls details without a popup");
    require([...title.querySelectorAll(".i")].every(icon => icon.closest(".mb-pill-face")), "title has no dropdown glyph outside its member avatar");
    // Only Raphael has conversation rows (his and quick questions); a member has none.
    const list = panel.querySelector(".conversation-list");
    require(!list || (visible(list) && list.scrollWidth <= list.clientWidth + 1), "Raphael's conversation rows fit the panel");
    const picker = panel.querySelector('[data-member-brain] .mp-trigger');
    if (picker) {
      require(panel.querySelectorAll('.mp-trigger').length === 1, "member details has one shared brain control");
      const mark = picker.querySelector('.mono'), source = picker.querySelector('.mp-source');
      if (mark) {
        const bounds = mark.getBoundingClientRect();
        require(bounds.width <= 28 && bounds.height <= 32, "the shared brain mark stays inside its control");
      }
      require(source.scrollWidth <= source.clientWidth + 1, "the complete brain source remains readable");
    }
    return { check: name, rows: list ? list.querySelectorAll('[data-conversation-open]').length : 0 };
  }
  if (name === "composer-pair") {
    const form = [...document.querySelectorAll(".composer")].find(visible);
    const send = form.querySelector(".cmp-send"), voice = form.querySelector(".cmp-voice");
    const hasDraft = !!form.querySelector("textarea").value.trim();
    const shown = hasDraft ? send : voice, gone = hasDraft ? voice : send, a = shown.getBoundingClientRect();
    require(a.width === 32 && a.height === 32, "the one right-hand control is 32px");
    require(gone.getBoundingClientRect().width === 0, "send and the emblem share one slot: only one shows");
    require(!!voice.querySelector('img[src*="app-emblem"], .av') && !voice.querySelector('.av-custom'), "the voice button is the gold emblem, never a picture");
    require(getComputedStyle(shown).backgroundColor === "rgba(0, 0, 0, 0)", "the slot is a bare icon with no background");
    require(send.disabled === !hasDraft, "send state follows draft text");
    return { check: name, shown: a.width, hasDraft, color: getComputedStyle(send).color };
  }
  if (name === "calendar-chips") {
    const chips = [...document.querySelectorAll(".au-occurrence")];
    require(chips.length > 0, "calendar has event chips");
    for (const chip of chips) {
      const time = chip.querySelector("time, small"), face = chip.querySelector(".av"), label = chip.querySelector("b");
      const bounds = chip.getBoundingClientRect();
      // Side by side, a chip gives its face up to its words; the face is back in the day view and the popover.
      if (chip.closest(".is-tight")) continue;
      require(visible(face), "member face is visible in every event chip");
      if (visible(face)) {
        const picture = face.getBoundingClientRect();
        require(Math.abs(picture.width - 20) < 1 && Math.abs(picture.height - 20) < 1, "event faces retain their 20px square rather than flexing with the copy");
      }
      require(visible(time) && /^\d{2}:\d{2}$/.test(time.textContent), `complete compact time: ${time?.textContent}`);
      const range = document.createRange(); range.selectNodeContents(time);
      const text = range.getBoundingClientRect();
      require(text.left >= bounds.left + 1 && text.right <= bounds.right - 1 && text.top >= bounds.top && text.bottom <= bounds.bottom,
        `time ${time.textContent} fits chip (${Math.round(text.width)}px text, ${Math.round(bounds.width)}px chip)`);
      require(text.right <= face.getBoundingClientRect().left - 1, "event time and fixed avatar do not overlap");
      require(chip.title.includes(label.textContent) && chip.title.includes(time.textContent), "tooltip preserves full title and time");
      require(getComputedStyle(label).whiteSpace === "normal" && getComputedStyle(label).webkitLineClamp === '2', "calendar titles allow two recognisable lines");
      const titleBox = label.getBoundingClientRect();
      require(titleBox.bottom <= bounds.bottom + 1 && titleBox.height <= parseFloat(getComputedStyle(label).lineHeight) * 2 + 1, "two title lines fit inside the event");
    }
    return { check: name, chips: chips.length };
  }
  if (name === "task-ending-reasons") {
    const turn = document.querySelector('.page-agent:not([hidden]) [data-status="cancelled"]');
    const body = turn?.querySelector('.work-body:not([hidden])');
    require(visible(body), "the cancelled turn can open its recorded work");
    const words = body.textContent;
    for (const reason of ["等待你在程式內核准", "這次記憶修改未符合記憶規則", "不允許讀取憑證儲存區", "這個網址尚未由你提供，也未出現在工具結果中"])
      require(words.includes(reason), `the recorded refusal is explained: ${reason}`);
    require(turn.textContent.includes("已核對兩個項目。") && turn.textContent.includes("7 次工具呼叫"), "the original answer and real count survive cancellation");
    require(!turn.querySelector('.live-presence'), "cancelled history is terminal");
    return { check: name, reasons: 4 };
  }
  if (name === "work-steps-own-words") {
    // Old turns name actions in sentences, without reconstructing private arguments.
    const body = document.querySelector('.page-agent:not([hidden]) .work-body');
    const rows = [...body.querySelectorAll('.work-sentences li')].filter(visible);
    const words = rows.map(row => row.textContent);
    require(visible(body) && rows.length === 6 && words.filter(word=>word === '查看了 Notion').length === 2, `each old step remains readable: ${words.join("|")}`);
    require(!words.some(word=>/^(讀取|修改)$|local/.test(word)), 'old steps never expose bare verbs or local');
    require(!rows.some(row => row.textContent.includes("拉斐爾") || row.querySelector('[title*="拉斐爾"], [aria-label*="拉斐爾"]')), "no row or picture names Raphael");
    require(!body.querySelector('.step-mark,.step-ms'), 'the list has no per-row ticks or milliseconds');
    return { check: name, words };
  }
  if (name === "bot-ask-centred" || name === "bot-ask-expanded") {
    const event = document.querySelector('[data-handoff="x71"]');
    const [line] = eventLines(1);
    require(line.textContent === "和 小晴 討論已完成", `the asker's line names the colleague and the state: ${line.textContent}`);
    require(visible(line.querySelector('.av')) && !event.closest('.chat-message'), "one faced line outside the messages");
    if (name === "bot-ask-expanded") {
      const detail = event.querySelector('.handoff-detail');
      require(event.open && detail.querySelector('.message-quote')?.textContent.includes("下週上市的新品代號是多少？"), "it opens on the question that was sent");
      require(detail.querySelector('.message-text')?.textContent.includes("NX-2026"), "and on the answer that came back");
      require(!/#\d|x71/.test(detail.textContent), "no internal ids");
    } else require(!event.open, "the line starts closed");
    return { check: name, open: event.open };
  }
  if (name === "bot-message-from" || name === "bot-exchange-count" || name === "bot-exchange-expanded") {
    // What a colleague handed over: one centred line where the owner's words would be, then the member's own turn.
    const event = document.querySelector('.exchange-event[data-exchange="71"]'), line = event.querySelector("summary");
    require(line.textContent.trim() === "訊息來自 小森", `the line reads who it came from: ${line.textContent}`);
    require(visible(line.querySelector('.av')), "the line carries the asker's face");
    require(document.querySelector('.tn[data-id="2"]').getBoundingClientRect().bottom <= event.getBoundingClientRect().top, "it sits where it came, after the member's own earlier turn");
    require(!document.querySelector('.tn[data-id="71"] .me'), "a colleague's request is never an owner bubble");
    if (name === "bot-exchange-expanded") require(event.open && [...event.querySelectorAll('.exchange-message')].filter(visible).length === 1, "it opens on what was asked");
    else require(!event.open, "the line starts closed");
    return { check: name, words: line.textContent };
  }
  if (name === "global-private-memory") {
    const shared = document.querySelector('.mb-det [data-mem-space="shared"]'), own = document.querySelector('.mb-det [data-mem-space="own"]');
    require(visible(shared) && visible(own), "the shared and the member's own memory are both on screen");
    require(shared.textContent.includes("品牌主色是金色") && shared.querySelector('.mem-from')?.textContent === "拉斐爾 · 2026/10/27", "the shared entry says whom the owner told it to and when in the UI date format");
    require(own.textContent.includes("專案每週三檢查原型") && !shared.textContent.includes("專案每週三檢查原型"), "the member's own entry stays in its own file");
    return { check: name };
  }
  if (name === "plugins-store-needs") {
    // The store says in words what each app asks for, on its row, before anything is pressed; no 加入 is dead.
    const expected = { "acme-ledger": "需要 API key", "parcel-desk": "需要 API key", "orbit-ads": "需要自己的開發者 app" };
    for (const [slug, words] of Object.entries(expected)) {
      const open = document.querySelector(`[data-conn="open-store"][data-id="${slug}"]`);
      require(open, `${slug} is in the store`);
      const need = open.querySelector('.sub .need');
      require(visible(need) && need.textContent === words, `${slug}'s row says "${words}" in visible words, not only in a title (${need?.textContent})`);
      const join = open.closest('.cs-card').querySelector('[data-conn="join"]');
      require(join && !join.disabled && !join.hasAttribute('title'), `${slug}'s 加入 is a live button with nothing hidden in a hover title`);
    }
    const dead = [...document.querySelectorAll('.cs-card [data-conn="join"]')].filter(button => button.disabled);
    require(dead.length === 0, `no 加入 in the store is disabled (${dead.length})`);
    return { check: name, rows: Object.keys(expected).length };
  }
  if (name === "plugins-store-needs-page") {
    const line = document.querySelector('.cs-page .cs-needs'), join = document.querySelector('.cs-page [data-conn="join"]');
    require(visible(line) && line.textContent.startsWith("需要 API key") && line.textContent.includes("Acme Ledger"), `the page says what the app needs (${line?.textContent})`);
    require(join && !join.disabled && join.textContent.includes("加入"), "加入 on the page is live");
    return { check: name, words: line.textContent };
  }
  if (name === "setup-added") {
    const key = "zk-look-0123456789", calls = window.__look.calls;
    require(!document.querySelector('.cn-setup-dialog'), "the form closed once the app was added");
    const sent = calls.filter(call => call.method === "connectors.connect");
    require(sent.length === 1 && sent[0].params.fields.generic_api_key === key && sent[0].params.toolkit === "acme-ledger", "the key crossed one call, connectors.connect, and no other");
    require(!JSON.stringify(calls.filter(call => call.method !== "connectors.connect")).includes(key) && !document.body.textContent.includes(key), "the key is on no page text and in no other call");
    require(visible(document.querySelector('[data-conn="open"][data-id="composio:acme-ledger"]')), "the app is among the connected ones");
    return { check: name };
  }
  if (name === "card-setup-form") {
    const slot = document.querySelector('[data-inline-setup]'), field = slot?.querySelector('[data-setup-field]');
    require(visible(slot) && field?.type === 'password' && field.value === 'zk-look-0123456789', 'the masked form lives in its conversation card');
    require(!document.querySelector('.cn-setup-dialog'), 'conversation setup has no modal');
    require(slot.querySelector('.card-detail').hidden && visible(slot.querySelector('.card-shield')), 'guide starts folded and storage is explained');
    require(!JSON.stringify(window.__look.calls).includes(field.value), 'typing sent no credential');
    return {check:name};
  }
  if (name.startsWith("setup-")) {
    // The form that asks for an app's own key, or its own developer app (connection-setup.ts).
    const key = "zk-look-0123456789", calls = window.__look.calls;
    const dialog = document.querySelector('.cn-setup-dialog'), frame = dialog.getBoundingClientRect();
    require(visible(dialog), "the form is open");
    require(frame.left >= 0 && frame.top >= 0 && frame.right <= window.innerWidth + 1 && frame.bottom <= window.innerHeight + 1, "the form fits the window");
    const add = dialog.querySelector('[data-dlg="add"]'), cancel = dialog.querySelector('[data-dlg="cancel"]');
    for (const button of [add, cancel]) {
      const box = button.getBoundingClientRect();
      require(visible(button) && box.top >= frame.top && box.bottom <= frame.bottom + 1 && box.right <= frame.right + 1, "the footer actions are inside the form");
    }
    const body = dialog.querySelector('.mb-dlg-body');
    require(body.scrollWidth <= body.clientWidth + 1, "nothing in the form runs sideways");
    const status = dialog.querySelector('[data-setup-status]'), alertText = status?.querySelector('[role="alert"]')?.textContent ?? "";
    const input = dialog.querySelector('[data-setup-field]');
    const seen = JSON.stringify(calls.filter(call => !["connectors.connect", "integrations.card_connect"].includes(call.method)));
    require(!document.body.textContent.includes(key) && !seen.includes(key), "the key is on no page text and in no call but the one that adds the app");
    if (["setup-key", "card-setup-form"].includes(name)) {
      require(dialog.querySelector('.mb-dlg-head h2').textContent.includes("Acme Ledger"), "the form is named for the app");
      require(dialog.querySelector('.cn-lead').textContent.includes("API key") && dialog.querySelector('.cn-keep').textContent.includes("Composio"), "it says what is needed and that Composio keeps it");
      const fields = [...dialog.querySelectorAll('[data-setup-field]')];
      require(fields.length === 1 && fields[0].type === "password" && fields[0].dataset.setupField === "generic_api_key" && fields[0].value === key, "exactly the key the app asks for, in a masked field");
      require(visible(dialog.querySelector('[data-dlg="guide"]')) && dialog.querySelectorAll('.cn-steps li').length === 3, "it says where to get it, in plain steps");
      require(!add.disabled && dialog.querySelectorAll('button:disabled').length === 0, "no control in the form is dead");
      require(!calls.some(call => ["connectors.connect", "integrations.card_connect"].includes(call.method)), "nothing was sent before 加入");
      if (name === "card-setup-form") require(!(document.querySelector('.composer textarea')?.value ?? "").includes(key), "nothing was typed into the chat");
    }
    if (name === "setup-noguide") {
      const where = dialog.querySelector('.cn-where');
      require(where.textContent.includes("目錄沒有附上取得方式") && visible(where.querySelector('[data-dlg="home"]')) && !where.querySelector('[data-dlg="guide"]'), "no guide: it says so and offers the service's own page");
    }
    if (name === "setup-own-app") {
      require(dialog.querySelector('.cn-lead').textContent.includes("開發者 app") && dialog.querySelector('.cn-keep').textContent.includes("Client ID"), "it says the service needs the owner's own developer app");
      require(dialog.querySelector('.cn-redirect input').value === "https://backend.composio.dev/api/v1/auth-apps/add" && visible(dialog.querySelector('[data-dlg="copy"]')), "it shows the address to register and a button to copy it");
      const id = dialog.querySelector('[data-setup-field="client_id"]'), secret = dialog.querySelector('[data-setup-field="client_secret"]');
      require(id.type === "text" && id.value === "look-client-id" && secret.type === "password" && secret.value === key, "the id is plain and the secret is masked");
      require(visible(dialog.querySelector('[data-dlg="guide"]')), "it links to the provider's developer portal");
    }
    if (name === "setup-rejected") {
      require(alertText.includes("沒有接受這把金鑰"), `the form says the key was not accepted (${alertText})`);
      require(input.value === "" && !input.disabled && !add.disabled && add.textContent.trim() === "加入", "the masked field is empty and the form can try again");
      require(calls.filter(call => call.method === "connectors.connect").length === 1, "one try reached the core");
    }
    if (name === "setup-composio-key") {
      require(alertText.includes("Composio 金鑰"), `the form says the Composio key is the problem (${alertText})`);
      require(visible(dialog.querySelector('[data-dlg="composio"]')) && dialog.querySelector('[data-dlg="composio"]').textContent.includes("加入 Composio 金鑰"), "it offers the place to add it");
    }
    if (name === "setup-plan-failed") {
      require(dialog.querySelector('.cn-setup').textContent.includes("讀不到 Acme Ledger 需要什麼") && visible(dialog.querySelector('[data-dlg="retry"]')), "it says it could not read what the app needs and offers to try again");
    }
    return { check: name, alert: alertText };
  }
  if (name === "card-setup-sent" || name === "card-key-rejected" || name === "card-composio-missing") {
    const key = "zk-look-0123456789", calls = window.__look.calls;
    const card = [...document.querySelectorAll('.connector-card')].find(visible);
    require(card, "the connector card is visible");
    const state = card.querySelector('.cc-state')?.textContent.trim() ?? "", action = [...card.querySelectorAll('button')].filter(visible);
    require(!document.body.textContent.includes(key), "the key is on no page text");
    if (name === "card-composio-missing") {
      require(card.dataset.cardState === "failed" && state.includes("還沒有 Composio 金鑰"), `the card says what is missing (${state})`);
      require(action.length === 2 && action[0].dataset.act === "card-settings" && action[0].textContent.trim() === "開啟連接設定" && action[1].hasAttribute("data-card-failed-close"), "the card offers the place to add it and a local close");
      return { check: name, state };
    }
    const sent = calls.filter(call => call.method === "integrations.card_connect");
    require(sent.length === 1 && sent[0].params.id === card.dataset.connector && sent[0].params.fields.generic_api_key === key, "the key crossed one call, integrations.card_connect");
    require(!JSON.stringify(calls.filter(call => call.method !== "integrations.card_connect")).includes(key), "no other call carries the key");
    require(!(document.querySelector('.composer textarea')?.value ?? "").includes(key), "nothing was typed into the chat");
    if (name === "card-setup-sent") require(card.dataset.cardState === "connected", "the card follows the core to connected");
    else {
      require(card.dataset.cardState === "failed" && state === "這把金鑰沒有被接受，請再填一次", `the card says the key was not accepted (${state})`);
      require(visible(card.querySelector("[data-inline-submit]")) && card.querySelector("input[type=password]").value === "", "the inline form returns with its secret cleared");
      const reply = [...document.querySelectorAll('.tn .ra .chat-message')].filter(visible).at(-1);
      require(reply.textContent.includes("沒有接受這把金鑰") && reply.textContent.includes("設定 › 連接 › 商店"), "the member names what to do and where");
    }
    return { check: name, state };
  }
  if (name.startsWith("connector-")) {
    // A connector card (connector-card.ts): the app's own bare mark, its name, where its sign-in stands and at most
    // one framed action, all inside the card, below the reply that asked for it.
    const cards = [...document.querySelectorAll('.connector-card')].filter(visible);
    require(cards.length === 1, `one connector card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(300, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    const mark = card.querySelector('.mono'), markStyle = mark && getComputedStyle(mark);
    require(visible(mark) && mark.querySelector('svg.logo path, img.logo'), "R-UI-34: the app's own catalog or bundled mark");
    if (name.startsWith('connector-slack')) require(mark.querySelector('img.logo')?.getAttribute('src') === window.__look.data.pluginCatalog.find(app => app.slug === 'slack').logo, "the card uses exactly the store's catalog logo");
    if (mark) require(markStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(markStyle.borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    const reply = [...card.closest('.tn').querySelectorAll('.ra .chat-message')].filter(visible).at(-1);
    require(reply && reply.getBoundingClientRect().bottom <= box.top + 1, "the card sits below the reply that asked for it");
    const buttons = [...card.querySelectorAll('button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom, "R-UI-25: the action is inside its card");
    }
    const status = card.querySelector('.cc-state'), said = status?.textContent.trim() ?? "", app = card.querySelector('.cc-name').textContent;
    const expected = {
      "connector-card": ["pending", "", "連結", true],
      "connector-slack": ["pending", "", "連結", true],
      "connector-slack-authorizing": ["authorizing", "等你在瀏覽器登入", "取消", false],
      "connector-authorizing": ["authorizing", "等你在瀏覽器登入", "取消", false],
      "connector-expired": ["pending", "授權已過期", "重新連結", true],
      "connector-key": ["pending", "需要你的 API key", "填入金鑰", true],
      "connector-app": ["pending", "需要你自己的開發者 app", "設定開發者 app", true],
      "connector-reconnected": ["connected", "已重新連結 · 2 個工具", null, false],
    }[name];
    require(expected, `no expectation for ${name}`);
    const [state, words, action, primary] = expected;
    if (!words) require(status?.textContent.trim(), "a pending card explains why connecting helps");
    require(card.dataset.cardState === state && (!words || said === words), `${app}'s card reads "${words}" (${card.dataset.cardState}: "${said}")`);
    const connectButton = card.querySelector('[data-act="card-connect"],[data-act="card-cancel"]');
    if (action === null) require(card.querySelector('.card-actions button:disabled'), 'connected card keeps its checked disabled button');
    else if (['connector-key','connector-app'].includes(name)) require(card.querySelector('[data-inline-setup]'), 'setup fields belong to the card');
    else require(connectButton?.textContent.trim() === action && connectButton.classList.contains('pri') === primary, 'the connection action matches the state');
    if (name === "connector-authorizing" || name === "connector-slack-authorizing") {
      require(visible(card.querySelector('.card-status.is-waiting i')), 'the card shows sign-in under way');
      require(window.__look.calls.some(call => call.method === "integrations.card_connect" && call.params?.id === card.dataset.connector),
        "Connect reached the core with the card's id");
    }
    if (name === "connector-reconnected") {
      // The calm thread keeps one centred line for the resumption.
      const line = eventLines(1).at(-1), resumed = document.querySelector('.tn[data-id="121"]');
      require(line.textContent === "Gmail 已連結，繼續原本的工作", `the resumed task opens with one line naming the app: ${line.textContent}`);
      const markBox = line.querySelector('.mono').getBoundingClientRect();
      require(markBox.width <= 20 && markBox.height <= 20, `the line's mark is no larger than its icons (${markBox.width}x${markBox.height})`);
      require(line.getBoundingClientRect().top >= box.bottom, "the resumed task comes after the card");
      require(!resumed.querySelector('.owner-message'), "the owner's request is not repeated as a new bubble");
      require([...resumed.querySelectorAll('.message-text')].some(text => visible(text) && text.textContent.includes("MC-4F2A")), "the resumed task's answer is shown");
      require(visible(card.querySelector('.card-status.is-done')), "the connected card carries its check");
      plainWords();
    }
    return { check: name, app, state: card.dataset.cardState, words: said };
  }
  if (name.startsWith("secret-") || name.startsWith("pc-")) {
    // The cards of a key (secret-card.ts) and of the owner's turn at the computer (computer-card.ts) are connector cards with a
    // second row: all inside the reply column, below the reply that asked, with real framed buttons inside the card.
    const secret = name.startsWith("secret-"), key = "sk-look-4c9f2b7e81d3";
    const cards = [...document.querySelectorAll(secret ? '.secret-card' : '.computer-card')].filter(visible);
    require(cards.length === 1, `one card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(300, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    const mark = card.querySelector('.mono'), markStyle = mark && getComputedStyle(mark);
    if (secret) require(visible(mark) && mark.querySelector('svg'), "the secret card has its app mark");
    if (mark) require(markStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(markStyle.borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    if (secret) require(mark.querySelector('svg.logo path'), "R-UI-34: the connection's own drawn mark, not a letter");
    const reply = [...card.closest('.tn').querySelectorAll('.ra .chat-message')].filter(visible).at(-1);
    require(reply && reply.getBoundingClientRect().bottom <= box.top + 1, "the card sits below the reply that asked for it");
    const buttons = [...card.querySelectorAll('button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom + 1, "R-UI-25: the action is inside its card");
      require(button.tagName === "BUTTON", "R-UI-17/18: a text action is a framed button");
    }
    const state = (card.querySelector('.cc-state') ?? card.querySelector('.card-status')).textContent.trim(), calls = window.__look.calls;
    const carrying = call => JSON.stringify(call.params ?? {}).includes(key);
    require(!document.documentElement.outerHTML.includes("開啟電腦") && !document.body.innerText.includes("開啟電腦"), "there is no 開啟電腦 step on the owner's own computer");
    if (name === "secret-masked") {
      const field = card.querySelector('input'), save = card.querySelector('[data-act="card-save"]');
      require(card.dataset.cardState === "pending" && card.textContent.includes("NOTION_TOKEN"), `the card names the secret it fills (${state})`);
      require(field.type === "password" && field.autocomplete === "off" && visible(field) && field.getBoundingClientRect().width >= 100, "the field is a masked field a key fits in");
      require(field.value === key && !field.hasAttribute('value'), "the characters live in the field only, never in its markup");
      require(!document.body.innerText.includes(key) && !document.documentElement.outerHTML.includes(key), "no characters of the key are drawn or in the page");
      require(save.textContent.trim() === "安全儲存" && save.classList.contains('pri') && !save.disabled, "one primary 安全儲存, ready");
      require(visible(card.querySelector('.field svg')), "the field carries its lock");
      require(!calls.some(carrying), "nothing was sent before the owner saved it");
    }
    if (name === "secret-saved-not-resumed") {
      require(card.dataset.cardState === "saved" && card.dataset.cardError === "resume_failed", `saved, and the task did not continue (${card.dataset.cardState}/${card.dataset.cardError})`);
      require(state === "金鑰已儲存，這項工作沒有繼續", `the card says both things: "${state}"`);
      require(!card.querySelector('input') && buttons.some(button => button.dataset.act === "card-resume" && button.textContent.trim() === "再試一次") && buttons[0].classList.contains('pri'), "no field is asked again: one primary 再試一次");
      require(visible(card.querySelector('.cc-name')) && !card.querySelector('.cc-done'), "the check is the resumed task's, not the saved key's");
      const sent = calls.filter(carrying);
      require(sent.length === 1 && sent[0].method === "integrations.card_save", "the key crossed one call, integrations.card_save, and no other");
      require(calls.filter(call => call.method === "agent.ask").length === 0 && !calls.some(call => String(call.method ?? "").startsWith("agent.") && carrying(call)), "never through the assistant");
      require(![...document.querySelectorAll('input, textarea')].some(field => field.value.includes(key)), "no field of the page still holds it");
      require(!document.body.innerText.includes(key) && !document.documentElement.outerHTML.includes(key), "the key is nowhere in the page");
      plainWords();
    }
    if (name.startsWith("pc-")) {
      const live = card.querySelector('.card-status');
      if (name !== "pc-handback") {
        require(card.dataset.cardState === "control", `the owner has the computer (${card.dataset.cardState})`);
        require(visible(live) && live.textContent.includes("需要你") && visible(live.querySelector('i')), "it says the owner is in control, with a dot and a word");
        require(visible(card.querySelector('[data-act="card-takeover"]')) && visible(card.querySelector('[data-act="card-done"]')) && visible(card.querySelector('[data-act="card-stop"]')), 'takeover, done and skip remain available');
        require(state.startsWith('請在「Google Chrome」登入你的帳號，完成後交還控制'), 'the card names the app to use');

      }
      if (name === "pc-takeover") {
        require(!card.dataset.cardNote && !card.querySelector('[data-card-note]'), "a first hand-over has no hint");
        require(!calls.some(call => String(call.method ?? "").startsWith("integrations.card_")), "nothing was pressed");
      }
      if (name === "pc-human-control") {
        require(card.dataset.cardNote === "still" && card.textContent.includes("看起來還沒完成，請再試一次"), "the card says the sign-in does not look done");
        require(calls.filter(call => call.method === "integrations.card_done").length === 1 && !calls.some(call => call.method === "integrations.card_stop"), "我完成了 was pressed once, 停止 never");
        require(!document.querySelector('[data-resumed]'), "the task did not resume");
      }
      if (name === "pc-handback") {
        require(card.dataset.cardState === "done" && card.querySelector(".card-detail[hidden]")?.textContent.includes("已交還控制 · 工作已繼續") && visible(card.querySelector('.card-status.is-done')), `the card says control went back and the task continued: "${state}"`);
        require(!card.querySelector("[data-act^=card-]"), "no action is left, and the owner no longer controls");
        // The calm thread keeps one centred line for the resumption.
        const line = eventLines(1).at(-1), resumed = document.querySelector('.tn[data-id="141"]');
        require(line.textContent === "電腦 已交還控制，繼續原本的工作", `the resumed task opens with one line: ${line.textContent}`);
        const markBox = line.querySelector('svg.i').getBoundingClientRect();
        require(markBox.width <= 20 && markBox.height <= 20, `the line's icon is no larger than the other lines' (${markBox.width}x${markBox.height})`);
        require(line.getBoundingClientRect().top >= box.bottom, "the resumed task comes after the card");
        require(!resumed.querySelector('.owner-message'), "the owner's request is not repeated as a new bubble");
        require([...resumed.querySelectorAll('.message-text')].some(text => visible(text) && text.textContent.includes("YT-4F2A")), "the resumed task's answer is shown");
        require(calls.filter(call => call.method === "integrations.card_done").length === 1, "我完成了 was pressed once");
        plainWords();
      }
    }
    return { check: name, state: card.dataset.cardState, words: state };
  }
  if (name === "local-permission-card" || name === "draft-preference-ask-first") {
    // A permission card (permission-card.ts) is a connector card with a second row for its answers, below the turn that asked.
    // The question it follows is answered there, once: the gold card stays away.
    const waiting = name === "local-permission-card";
    const cards = [...document.querySelectorAll('.permission-card')].filter(visible);
    require(cards.length === 1, `one permission card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(300, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    const mark = card.querySelector('.mono'), markStyle = mark && getComputedStyle(mark);
    require(visible(mark) && mark.querySelector('svg.logo path'), "R-UI-34: the service's own drawn mark");
    if (mark) require(markStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(markStyle.borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    const buttons = [...card.querySelectorAll('.card-actions > button')].filter(visible);
    require(buttons.map(button => button.textContent.trim()).join('|') === (waiting ? '允許一次|一律允許|拒絕' : '允許一次|拒絕'), 'permission actions keep once/always/deny semantics with primary first');
    require(buttons[0].classList.contains('pri') && buttons.every(button => !button.disabled), 'answers are available');
    require(card.querySelector('.card-title').textContent.includes('Gmail'), 'the title names who wants to act');
    require(card.querySelector('.card-detail').hidden && card.querySelector('.card-detail').textContent.includes('send_email'), 'the exact action remains in a folded disclosure');
    require(![...document.querySelectorAll('.ask-card')].some(visible), 'the permission is answered in one place');
    require(!window.__look.calls.some(call => call.command === 'agent_question_answer'), 'nothing was answered yet');
    if (!waiting) require(card.textContent.includes('寄信前先問'), 'the owner rule remains visible');
    plainWords();
    return { check: name, answers: buttons.map(button => button.textContent.trim()) };
  }
  if (name === "member-draft-switch") {
    // The preference to write mail as a draft first is a switch beside the one that asks before contacting colleagues.
    const toggle = document.querySelector('.mb-dialog [data-dlg="draft"]');
    require(visible(toggle) && toggle.getAttribute('role') === 'switch' && toggle.classList.contains('tg'), "the draft preference is a real switch");
    require(toggle.getAttribute('aria-checked') === 'false', "this member was set to send mail itself, so the switch is off");
    const row = toggle.closest('.mp-resource');
    // Slack drafts follow the same rule as mail since 1.2.
    require(row.querySelector('b').textContent === "郵件與 Slack 先擬成草稿，由我傳送", `the switch says what it does: ${row.querySelector('b').textContent}`);
    require(row.querySelector('p').textContent.includes("由你按「傳送」才會送出"), "its line says that only 傳送 sends");
    require(document.querySelectorAll('.mb-dialog .mp-resource [role="switch"]').length === 2, "it stands beside the one that asks before contacting colleagues");
    return { check: name };
  }
  if (name === "mail-handed-first" || name.startsWith("email-draft-")) {
    // An email card (mail-card.ts): who sends it and to whom, the subject and the body, with 捨棄 and 傳送. Only 傳送 sends,
    // and these scenes never press it: editing, discarding and handing over send nothing.
    const draftCalls = window.__look.calls.filter(call => String(call.method ?? "").startsWith("integrations.draft_"));
    require(window.__look.sent.length === 0 && !draftCalls.some(call => call.method === "integrations.draft_send"), "nothing was sent");
    const first = "a".repeat(64), second = "b".repeat(63) + "2", third = "b".repeat(63) + "3";
    if (name === "mail-handed-first") {
      // The calm thread's day divider is no longer an event line; the hand-off is the one line left.
      const line = eventLines(1).at(-1);
      require(line.textContent === "已轉交給 小森", `the first chat keeps one line naming the colleague: ${line.textContent}`);
      require(visible(line.querySelector('.av, svg, .mono')), "the colleague's face stands before the name");
      require(!document.querySelector('.mail-card, .mail-offer'), "the card and its choice are not in this chat any more");
      const handed = draftCalls.filter(call => call.method === "integrations.draft_handover");
      require(handed.length === 1 && handed[0].params.choice === "yes" && handed[0].params.id === "mail-1", "the owner's yes reached the core once");
      require(draftCalls.length === 1, "handing over saved and sent nothing");
      return { check: name, words: line.textContent };
    }
    if (name === "email-draft-discard") {
      const done = [...document.querySelectorAll('.mail-done')].filter(visible);
      require(done.length === 1 && done[0].dataset.mailState === "discarded", "the discarded draft is one quiet line");
      require(done[0].querySelector('.card-status').textContent.trim() === "已捨棄" && done[0].querySelector('.card-detail').textContent.includes("已捨棄，沒有寄出任何東西"), "the short status keeps the full explanation that nothing was sent in details");
      require(!done[0].querySelector('input, textarea, [data-act^=mail-]') && done[0].querySelector('.card-detail').hidden, "no field or action is left");
      require(draftCalls.length === 1 && draftCalls[0].method === "integrations.draft_discard" && draftCalls[0].params.id === "mail-1", "捨棄 reached the core once and nothing else did");
      const box = done[0].getBoundingClientRect(), column = done[0].closest('.ra-body').getBoundingClientRect();
      require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the line fits the reply column");
      return { check: name };
    }
    const cards = [...document.querySelectorAll('.mail-card')].filter(visible);
    require(cards.length === 1, `one email card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(360, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    require(card.scrollWidth <= card.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, "nothing scrolls sideways");
    const head = card.querySelector('.card-head .mono');
    require(visible(head) && head.querySelector('svg.logo path'), "R-UI-34: the sending app's own drawn mark");
    require(getComputedStyle(head).backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(getComputedStyle(head).borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    require(!card.querySelector('select'), "no native select: the sender is a dropdown");
    const labels = [...card.querySelectorAll('.mail-k')].filter(visible);
    require(labels.map(label => label.textContent).join("|") === "寄件者|收件者|副本|主旨", `the rows read 寄件者, 收件者, 副本, 主旨: ${labels.map(label => label.textContent)}`);
    const sender = card.querySelector('.mail-row .sel'), inputs = [...card.querySelectorAll('.mail-in')].filter(visible);
    require(visible(sender) && sender.dataset.act === "mail-from" && sender.textContent.trim() === "Gmail", "the sender is a dropdown showing Gmail");
    require(inputs.length === 3 && [sender, ...inputs].every(control => Math.abs(control.getBoundingClientRect().left - sender.getBoundingClientRect().left) <= 1), "the controls of the rows line up");
    require(labels.every(label => Math.abs(label.getBoundingClientRect().left - labels[0].getBoundingClientRect().left) <= 1), "the labels line up");
    const body = card.querySelector('.mail-body');
    require(visible(body) && body.getBoundingClientRect().height >= 100 && body.getBoundingClientRect().right <= box.right, "the body is a field that can be read");
    const buttons = [...card.querySelectorAll('.card-actions > button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom + 1, "R-UI-25: the action is inside its card");
      require(button.tagName === "BUTTON" && !button.disabled, "R-UI-17/18: a text action is a framed button that can be pressed");
    }
    require(buttons.map(button => button.textContent.trim()).join("|") === "傳送|捨棄" && buttons[0].classList.contains('pri') && !buttons[1].classList.contains('pri'), "R-UI-27: 捨棄 then the primary 傳送");
    require(!card.closest('.tn').querySelector('.event-line, .mail-offer'), "no other line or choice is in this turn");
    if (name === "email-draft-edit") {
      const value = field => card.querySelector(`[data-mail-field="${field}"]`).value;
      require(value("to") === "mei@example.com" && value("cc") === "boss@example.com", "the recipients are what the owner typed");
      require(value("subject") === "回覆：週四下午三點的會議（改期確認）" && value("body").startsWith("小美，您好："), "the subject is what the owner typed and the body is kept");
      require(card.dataset.version === "3" && card.dataset.digest === third, "each edit made a new version with a new digest");
      require(!card.querySelector('[data-card-disclosure]'), 'editable draft fields do not have a redundant disclosure');
      const saves = draftCalls.filter(call => call.method === "integrations.draft_save");
      require(saves.length === 2 && draftCalls.length === 2, "two edits made two saves and nothing else");
      require(saves[0].params.digest === first && saves[1].params.digest === second, "each save is on the digest the version before came back with");
      require(saves[1].params.cc === "boss@example.com" && saves[1].params.subject === "回覆：週四下午三點的會議（改期確認）" && saves[1].params.via === "mcp:gmail/send_email", "a save carries every field as the owner sees it");
      return { check: name, version: card.dataset.version };
    }
    // email-draft-handed-off: the colleague's chat holds the same version, editable, and says whose draft it is.
    require(name === "email-draft-handed-off", `no expectation for ${name}`);
    require(card.dataset.mailState === "draft" && card.dataset.version === "1" && card.dataset.digest === first, "it is the same version, with the same digest");
    require(card.querySelector('.card-body.cc-state')?.textContent.includes("來自 小晴 的草稿"), "it says whose draft it is");
    require(!card.querySelector('[data-card-disclosure]'), 'the author is visible without a redundant disclosure');
    require(![...card.querySelectorAll('input, textarea')].some(field => field.disabled) && !document.querySelector('.mail-offer, .event-line'), "it is editable, and asks nothing more");
    require(!document.body.innerText.includes("交給你") && !card.closest('.tn').querySelector('.owner-message'), "what the carrier turn is told is not shown, and no bubble is made of it");
    const handed = draftCalls.filter(call => call.method === "integrations.draft_handover");
    require(handed.length === 1 && handed[0].params.choice === "yes" && draftCalls.length === 1, "handing over was answered once, and nothing was saved");
    return { check: name, version: card.dataset.version };
  }
  throw new Error(`Unknown rendered check: ${name}`);
}
