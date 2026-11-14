// Browser assertions run against the real app after the scene's user interactions.
export function checkRendered(name, context = {}) {
  const visible = element => element && element.checkVisibility() && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const require = (condition, message) => { if (!condition) throw new Error(`${name}: ${message}`); };
  // A computer that is not showing its live screen draws nothing over its wallpaper: no words, face,
  // progress, status sentence, recovery button, Open pill or caption. One press anywhere on the screen (its cover) starts it.
  const shownText = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = '';
    while (walker.nextNode()) if (walker.currentNode.textContent.trim() && visible(walker.currentNode.parentElement)) text += walker.currentNode.textContent;
    return text.trim();
  };
  const requireBareScreen = (screen, context = 'the screen') => {
    require(visible(screen.querySelector('.desktop-wallpaper')), `${context} shows its wallpaper`);
    require(shownText(screen) === '', `${context} carries no words ("${shownText(screen).slice(0, 40)}")`);
    require(![...screen.querySelectorAll('.desktop-boot-face, .desktop-preparation, .desktop-message, .desktop-stage, .desktop-first-build, progress, svg.slime, .av, [data-act="docker-download"], [data-desktop-location], [data-desktop="retry"]')].some(visible), `${context} draws no face, progress, sentence or recovery button`);
    const buttons = [...screen.querySelectorAll('button')].filter(visible);
    require(buttons.every(button => button.matches('[data-desktop="enlarge"]') || button.parentElement === screen), `${context} has no button but its own cover`);
    require(![...screen.querySelectorAll('.desktop-open-pill')].some(visible), `${context} shows no Open pill`);
  };
  /** The state the panel keeps in data for a fixture, now that nothing says it in words. */
  const expectedDesktopState = state => state.lifecycle || ['starting', 'building', 'preparing'].includes(state.state) ? state.state
    : ['stopped', 'missing'].includes(state.state) ? 'stopped' : 'unavailable';
  if (name.startsWith("template-review-")) {
    // A template reviewed as separate pages: a first page of who it is and rows that open pages.
    const dialog = document.querySelector('.mb-dialog.tpr'), body = dialog.querySelector('.mb-dlg-body'), head = dialog.querySelector('.mb-dlg-head');
    const template = window.__look.data.colleagueSample.template;
    const back = head.querySelector('[data-tpl-back]'), title = head.querySelector('h2');
    if (name === "template-review-main") {
      require(dialog.dataset.page === 'main' && !back && getComputedStyle(title).visibility === 'hidden', "the first page has no title or back arrow");
      require(visible(body.querySelector('.tpr-hero .tpr-face')) && body.querySelector('.tpr-hero b').textContent === template.name, "the face and the name first");
      const rows = [...body.querySelectorAll('.tpr-list > .tpr-row')];
      require(rows.map(row => row.dataset.tplGo).join() === 'context,routines,integrations' && rows.every(row => row.tagName === 'BUTTON' && visible(row.querySelector('svg.i'))), `three rows that open pages: ${rows.map(row => row.dataset.tplGo)}`);
      require(/指示/.test(rows[0].textContent) && rows[1].textContent.includes(template.routines[0].title), "each row says what is inside");
      require(!body.querySelector('.tpl-card, [data-tpl-skill], .card-detail'), "no long list of everything on the first page");
      // Its foot is its own next step (加入, 發佈) when it has one; closing is the × alone, never a 「關閉」.
      const foot = [...dialog.querySelectorAll('.mb-dlg-act .btn')];
      require(foot.every(visible) && !foot.some(button => button.dataset.dlg === "close" || button.textContent.trim() === "關閉"), "no 「關閉」 under the dialog's ×");
    } else {
      require(dialog.dataset.page !== 'main' && visible(back) && title.textContent.trim() && getComputedStyle(title).textAlign === 'center', "a page has a back arrow and its title in the middle of the head");
    }
    if (name === "template-review-context") {
      const fields = [...body.querySelectorAll('.tpr-field > h4')].map(h => h.textContent);
      const field = label => [...body.querySelectorAll('.tpr-field')].find(section => section.querySelector('h4').textContent === label)?.textContent ?? '';
      require(fields.join() === '角色,指示,個性,回覆風格,技能' && field('指示').includes(template.instructions.trim().slice(0, 12)) && field('角色').includes(template.role), `who it is, then its instructions in full: ${fields}`);
      require(body.textContent.includes(template.personality.trim().slice(0, 12)), "the personality in full");
      require(body.querySelectorAll('[data-tpl-go^="skill:"]').length === template.skills.length, "one row per skill, each opening its page");
    }
    if (name === "template-review-skill") {
      require(body.textContent.includes('先查證來源，再完成報告。') && !/^---/m.test(body.textContent) && !/^description:/m.test(body.textContent), "the skill's text in full, without its front matter");
    }
    if (name === "template-review-routine") {
      const routine = template.routines[0];
      require(title.textContent === routine.title, "the routine's name is the page's title");
      const fields = [...body.querySelectorAll('.tpr-field > h4')].map(h => h.textContent);
      require(fields.includes('內容') && fields.includes('觸發方式') && body.textContent.includes(routine.prompt.trim().slice(0, 12)), `its content and trigger: ${fields}`);
      require(/09:00/.test(body.textContent) && /暫停/.test(body.textContent), "the schedule in words, and that it starts paused");
    }
    for (const box of body.querySelectorAll('.tpr-box')) {
      const style = getComputedStyle(box);
      require(style.overflowY !== 'auto' && style.overflowY !== 'scroll', "no box scrolls inside");
    }
    return { check: name, page: dialog.dataset.page };
  }
  if (name === "template-content" || name === "template-content-expanded") {
    const dialog = document.querySelector('.template-preview');
    // One row per skill: its name, one line, and its text behind a disclosure.
    const skills = [...dialog.querySelectorAll('[data-tpl-skill]')];
    require(skills.length > 0, "skills have named rows and full-text disclosures");
    for (const skill of skills) {
      require(skill.querySelector('.tpl-row-t > b')?.textContent.trim() && skill.querySelector('.tpl-row-t > span')?.textContent.trim(), "skill name and description stay on its row");
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
  if (name === "store-page") {
    // The store is a page of its own where the conversation stands (the sidebar's + › 商店), no part of 新增成員 (owner, 2026-11-11).
    const dialog = document.querySelector(".store-dialog"), scrim = dialog.closest(".mb-scrim"), side = document.getElementById("nav").getBoundingClientRect();
    require(document.querySelectorAll(".mb-scrim").length === 1 && scrim.classList.contains("store-scrim"), "one page for the store");
    require(matchMedia("(max-width: 859px)").matches || scrim.getBoundingClientRect().left >= side.right - 1, "it stands where the conversation stands, the sidebar beside it");
    require(dialog.querySelector(".mb-dlg-head h2").textContent.trim() === "商店" && !dialog.querySelector('.tabs, [role="tab"], #mb-new-name, .cr-dialog'), "its own title, no tabs, no 新增成員");
    const search = dialog.querySelector("[data-store-search]"), templates = dialog.querySelector('.store-bar [data-dlg="templates"]');
    require(visible(search) && visible(templates) && templates.textContent.trim() === "從範本開始", "the search and the template button stand in one bar");
    const s = search.getBoundingClientRect(), tb = templates.getBoundingClientRect();
    require(Math.abs(s.bottom - tb.bottom) <= 1.5 && tb.left >= s.right - 1 && tb.right <= scrim.getBoundingClientRect().right, "the template button is beside the search, on its line");
    require(!window.__look.calls.some(call => call.method === "members.create"), "looking makes nobody");
    return { check: name };
  }
  // The member store's own checks; the plugin store's store-group-* checks live further down.
  if (["store-home", "store-category", "store-search", "store-empty", "store-offline", "store-closed", "store-preview", "store-warning", "store-export"].includes(name)) {
    const calls = window.__look.calls;
    require(!calls.some(c => c.method === "members.template" && ["import", "publish"].includes(c.params.action)), "browsing and review never install or publish");
    require(!calls.some(c => /connect$/.test(c.method || "")), "preview never connects apps");
    if (["store-home", "store-category", "store-search"].includes(name)) {
      require(visible(document.querySelector(".store-entry svg.slime")), "existing slime avatars");
      require(document.querySelectorAll("[data-category]").length === 9, "all plus eight categories");
      if (name === "store-home") require(document.querySelectorAll(".store-featured .store-entry").length === 2, "featured row");
      else require(document.querySelectorAll(".store-entry").length === 1, "local filter selects one entry");
      require(calls.filter(c => c.method === "members.template" && c.params.action === "catalog").length === 1, "filtering never refetches");
    } else if (name === "store-closed") {
      const results = document.querySelector(".store-results");
      require(results.textContent.trim() === "商店還沒開放" && visible(results.querySelector("[data-store-closed]")), "the store says it is not open yet, and nothing else");
      require(!visible(document.querySelector("[data-store-search]")) && !visible(document.querySelector(".store-categories")), "no search or categories for a store with nothing in it");
      require(!document.querySelector(".store-entry") && !document.body.textContent.includes("離線"), "no entries and no offline claim");
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
      require(dialog.textContent.includes(template.personality) && dialog.querySelector('[data-tpl-skill] .card-detail').textContent.includes('先查證來源，再完成報告。') && dialog.textContent.includes(template.routines[0].prompt), "full personality, skill body and routine text");
      if (name === "store-export") {
        // The template card reviews in this dialog and saves from the card.
        require(!window.__look.exportedTemplate && (visible(dialog.querySelector('[data-dlg="export"]')) || visible(document.querySelector('[data-template-card-id] [data-act="template-save"]'))), "review precedes file save");
      } else {
        require(dialog.textContent.includes("加入前不會授予任何權限"), "no permissions before explicit import");
        require(dialog.querySelectorAll('[data-dlg="connect"]').length === template.connections.length && [...dialog.querySelectorAll('[data-dlg="connect"]')].every(b => b.disabled), "one disabled connect action per app");
        require(dialog.textContent.includes("09:00"), "actual schedule visible");
        if (name === "store-warning") {
          const warning = dialog.querySelector('.tpl-alert[role="status"]');
          require(warning && !warning.textContent.includes("template.") && !/[。.]\s*·/.test(warning.textContent), "one warning block uses localized sentences without stray punctuation");
          const lines = [...warning.querySelectorAll('p')];
          require(lines.length === 2 && lines[1].getBoundingClientRect().top - lines[0].getBoundingClientRect().bottom <= 8, "third-party and scan risks share compact spacing");
        }
      }
    }
    return {check:name};
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
      // One row per skill and per paused routine: its name, then one muted line.
      const rows = [...preview.querySelectorAll('[data-tpl-skill], [data-tpl-routine]')];
      require(rows.length === 2 && rows.every(row => row.querySelector('.tpl-row-t > b')?.textContent.trim() && row.querySelector('.tpl-row-t > span')?.textContent.trim()), "skills and paused routines are named rows with one muted line");
    }
    if (name === "colleague-imported") {
      require(calls.some(call => call.method === "members.template" && call.params.action === "import"), "import follows explicit action");
      const member = window.__look.data.members.at(-1);
      require(member.tools.length === 0, "no imported app grants");
      require(window.__look.data.routines.filter(r => r.member_id === member.id).every(r => !r.enabled), "imported routines stay off");
    }
    if (name === "colleague-save-cancelled") {
      const card = document.querySelector('[data-template-card-id="tpl-1"]');
      require(calls.some(call => call.command === "member_template_file" && call.action === "save"), "the owner's save dialog was opened");
      require(!window.__look.exportedTemplate, "a cancelled dialog writes nothing");
      require(card.dataset.cardState === "draft" && !card.textContent.includes("已儲存"), "the card does not say saved");
      require(!calls.some(call => call.method === "members.template_card_export" && call.params.saved === true), "the core is not told it was saved");
      require([...card.querySelectorAll(".card-actions button")].every(button => !button.disabled), "the card's buttons are back");
    }
    if (name === "colleague-published") {
      const card = document.querySelector('[data-template-card-id="tpl-1"]'), where = card.querySelector("[data-template-where]"), next = card.querySelector(".template-next");
      require(card.dataset.cardState === "published" && visible(where) && visible(next), "the card says where the files are and what to do next");
      require(where.textContent.includes("template-exports") && where.textContent.includes("3f9a1c07d2e84b56"), "the path of the prepared folder is written out");
      const edge = card.getBoundingClientRect().right;
      require(where.getBoundingClientRect().right <= edge + 0.5 && next.getBoundingClientRect().right <= edge + 0.5, "the path and the sentence wrap inside the card");
      const buttons = [...card.querySelectorAll(".card-actions button")];
      require(buttons.map(button => button.dataset.act).join() === "template-open,template-folder,template-view" && buttons.every(visible), "open the GitHub page, show the files, view");
      require(buttons[0].classList.contains("pri") && !buttons[1].classList.contains("pri"), "the GitHub page is the one primary button");
    }
    if (name === "colleague-bad-file") {
      const toast = document.querySelector(".toast");
      require(visible(toast) && toast.textContent.includes("損壞或不完整"), "the file is said to be damaged, in the owner's words");
      require(!/JSON|Unexpected|SyntaxError|Invalid/.test(toast.textContent), "no parser or core wording");
      require(!document.querySelector(".template-preview"), "nothing is previewed");
      require(!calls.some(call => call.method === "members.template" && call.params.action !== "catalog"), "the core is never asked about a file that cannot be one (the store's own catalogue read is not about the file)");
    }
    if (name === "colleague-name-empty") {
      const dialog = document.querySelector(".template-preview"), field = dialog.querySelector("[data-template-name]"), line = dialog.querySelector(".field-error");
      require(field.getAttribute("aria-invalid") === "true" && visible(line) && line.textContent === "請輸入名字", "the field is marked and one line says what to do");
      require(getComputedStyle(field).borderTopColor === getComputedStyle(line).color, "the field's edge and the line share the error colour");
      require(!calls.some(call => call.method === "members.template" && call.params.action === "import"), "nothing is added");
      require(!dialog.querySelector('[data-dlg="import"]').disabled, "the owner can try again");
    }
    if (name === "colleague-export") {
      const template = JSON.parse(window.__look.exportedTemplate);
      require(template.format === "raphael-member" && !template.memory && !template.tools && !template.avatar, "one recipe excludes private state and grants");
    }
    if (name === "colleague-setup-card") {
      // The first message of a new member: its own line and the one question card, read as one message.
      const body = [...document.querySelectorAll(".page-agent .ra-body")].filter(visible);
      require(body.length === 1, `the line and its card are one message: ${body.length} bodies`);
      const card = body[0].querySelector('[data-owner-question="setup-first"][data-card-state="asked"]');
      require(visible(card), "the question card stands in the same message");
      const line = [...body[0].querySelectorAll("[data-seq]")].find(item => item.textContent.includes("很高興加入你的團隊"));
      require(visible(line), "the member's own greeting line is there");
      require(line.getBoundingClientRect().bottom <= card.getBoundingClientRect().top + 1, "the line stands above the card");
      const options = [...card.querySelectorAll("[data-owner-option]")].filter(visible);
      require(options.length === 4 && options.map(item => item.querySelector("[data-choice-letter]").textContent).join("") === "ABCD", "four options with their letters");
      require(visible(card.querySelector("[data-owner-answer-input]")) && visible(card.querySelector('[data-owner-answer="cancel"]')), "the owner's own answer and the close are on the card");
      require(![...document.querySelectorAll(".page-agent .owner-message")].some(visible), "nothing is put in the owner's mouth");
      require(!document.querySelector("[data-greeting-question],[data-greeting-option]"), "the idle greeting clone is gone: the card is the ordinary one");
      const wide = Math.max(...[line, card].map(item => item.getBoundingClientRect().width));
      require(card.getBoundingClientRect().right <= document.querySelector(".page-agent .ra-scroll, .page-agent").getBoundingClientRect().right + 1, `the card stays inside the conversation: ${wide}`);
    }
    if (name === "colleague-setup-job") {
      // The card answered and the job saved: the answer is the card's, one quiet line says the job, one sentence, then the first-task card.
      const first = document.querySelector('[data-owner-question="setup-first"]');
      require(first && first.dataset.cardState === "answered" && first.textContent.includes("整理 Gmail 信件，每天幫我回覆重要的信"), "the first card stands answered, with the owner's answer in it");
      require(![...document.querySelectorAll(".page-agent .owner-message")].some(visible), "the answer is not said again as a message");
      const line = [...document.querySelectorAll(".page-agent .conversation-event-line")].find(item => item.textContent.includes("已設定職務：信件管家"));
      require(visible(line), "one quiet line says the job was set");
      const ack = [...document.querySelectorAll("[data-seq]")].find(item => item.textContent.includes("我負責幫你整理信件"));
      const card = document.querySelector('[data-owner-question="setup-task"][data-card-state="asked"]');
      require(visible(ack) && visible(card), "the member's sentence and the first-task card are shown");
      const order = [first, line, ack, card].map(item => item.getBoundingClientRect().top);
      require(order.every((top, index) => index === 0 || top >= order[index - 1] - 1), `they read in order: ${order.join(",")}`);
      require(card.querySelectorAll("[data-owner-option]").length === 2, "two concrete tasks, and the owner's own answer");
      require(document.querySelectorAll('[data-card-state="asked"]').length === 1, "one open card at a time");
      const box = line.getBoundingClientRect(), page = document.querySelector(".page-agent").getBoundingClientRect();
      require(Math.abs((box.left + box.right) / 2 - (page.left + page.right) / 2) < page.width * 0.2, "the line is centred in the conversation");
    }
    if (name === "colleague-setup-connect") {
      const card = document.querySelector("[data-connector]");
      const note = document.querySelector("[data-setup-note]");
      require(visible(card) && card.dataset.cardState === "pending", "the connect card for the one app");
      require(visible(note) && note.textContent.includes("沒有你的同意，我不會寄出或更動任何東西"), "one quiet line says nothing is sent or changed without a yes");
      require(card.getBoundingClientRect().bottom <= note.getBoundingClientRect().top + 1, "the line stands under the card");
      require(card.getBoundingClientRect().left <= note.getBoundingClientRect().left + 1 && note.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1, "the line stands within the card's width");
      require(parseFloat(getComputedStyle(note).fontSize) <= parseFloat(getComputedStyle(document.body).fontSize), "and is quiet");
      require(visible([...document.querySelectorAll(".conversation-event-line")].find(item => item.textContent.includes("已設定職務：信件管家"))), "the job line precedes it");
      require(document.querySelectorAll('[data-owner-question][data-card-state="asked"]').length === 0, "no second question while the app is asked for");
    }
    if (name === "colleague-setup-collapsed") {
      // A clear answer that gives a name, a job and a task: it renames, saves, says so and starts, with no card after.
      const renamed = [...document.querySelectorAll(".bot-renamed")].find(item => item.textContent.trim() === "已重新命名為 阿信");
      require(visible(renamed), "the rename stands as the first Bot's rename does");
      require(visible([...document.querySelectorAll(".conversation-event-line")].find(item => item.textContent.includes("已設定職務：信件管家"))), "the job line");
      require(visible([...document.querySelectorAll("[data-seq]")].find(item => item.textContent.includes("現在先整理今天的未讀信"))), "it says what it starts");
      require(document.querySelectorAll('[data-owner-question][data-card-state="asked"]').length === 0, "no further card");
      require(document.querySelector('[data-owner-question="setup-first"]').dataset.cardState === "answered", "the first card stays answered where it was asked");
      require(![...document.querySelectorAll(".page-agent .owner-message")].some(visible), "the answer is not said again as a message");
    }
    if (name === "colleague-handoff") require(document.querySelector('.ra-scroll').innerText.includes('/home/cua/team/projects/'), "handoff cites a shared-team path");
    if (name === "colleague-accounts") require(document.querySelector('.cs-accts').textContent.includes('工作信箱') && document.querySelector('.cs-accts').textContent.includes('私人信箱'), "accounts have distinct public labels");
    if (name === "colleague-label-saved") require(calls.some(call => call.method === "connectors.label" && call.params.label === "研究信箱"), "owner label is saved by account id");
    if (name === "colleague-tunnel") require(document.querySelector('.au-tunnel').textContent.includes('tailscale funnel --bg http://127.0.0.1:43210'), "exact loopback-forward command");
    if (name === "colleague-tunnel-tested") require(document.querySelector('.au-tunnel').innerText.includes('已收到自測 POST'), "public URL probe returned to the editor");
    if (name === "colleague-tunnel-hmac") require(document.querySelector('[data-auth="hmac"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.au-hook-secret').type === 'text', "explicit HMAC choice and one-time key");
    if (name === "colleague-output") {
      const path = window.__look.data.colleagueSample.path, row = document.querySelector('[data-row="output-folder"]');
      require(calls.some(call => call.command === "pick_output_folder") && calls.some(call => call.method === "settings.set" && call.params.key === "owner_output_folder" && call.params.value === path), "native picker result is stored in settings");
      require(row.querySelector('.output-name')?.textContent === path.split('\\').pop() && row.querySelector('.output-path')?.textContent === path, "the chosen folder shows its name on the button and its whole path under the row name");
    }
    if (name === "colleague-output-cancel") require(calls.some(call => call.command === "pick_output_folder") && !calls.some(call => call.method === "settings.set" && call.params.key === "owner_output_folder"), "cancel never writes the folder setting");
    return {check:name};
  }
  // R-ACCT-01: the accounts of an app, and a sign-in that waits.
  if (name.startsWith("accounts-") || name.startsWith("sign-in-")) {
    const log = window.__look.calls, made = method => log.filter(call => call.method === method);
    const card = document.querySelector(".cs-accts"), rows = [...(card?.querySelectorAll(".cs-acct") ?? [])];
    const inside = (node, box) => { const a = node.getBoundingClientRect(), b = box.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; };
    if (name === "accounts-card") {
      require(visible(card) && rows.length === 2, `the card lists the connected account and the young sign-in, not the old one (${rows.length} rows)`);
      require(rows.map(row => row.querySelector(".nm").textContent).join("|") === "Jack|帳號 2", "the rows are named Jack and 帳號 2");
      require(rows.map(row => row.querySelector(".st").textContent).join("|") === "已連結|等待登入", "the rows say 已連結 and 等待登入");
      require(rows.every(row => row.querySelector(".i") && row.querySelector('[data-conn="account-menu"]')), "each row is a person, a name, a status and a ⋯");
      require(!card.querySelector('[data-conn="account-label"]') && !card.textContent.includes("帳號名稱"), "the 帳號名稱 button is gone");
      require(rows.every(row => { const more = row.querySelector('[data-conn="account-menu"]'); return visible(more) && inside(more, row) && more.getBoundingClientRect().height <= 30; }), "every ⋯ is whole inside its row and at most 30 px");
      require(rows.every(row => Math.abs(row.getBoundingClientRect().height - rows[0].getBoundingClientRect().height) < 1), "the rows are one height");
      require(rows.every(row => row.scrollWidth <= row.clientWidth + 1), "no row is cut at its side");
      require(visible(card.querySelector('[data-conn="add-account"]')), "加入另一個帳號 is still there");
      require(made("connectors.status").length > 0, "the list was read from the core");
    }
    if (name === "accounts-menu") {
      const items = [...document.querySelectorAll('#app-popover [role="menuitem"]')];
      require(items.map(item => item.textContent).join("|") === "重新命名|移除", "the menu has 重新命名 and 移除, in that order");
      require(items[1].classList.contains("danger") && !items[0].classList.contains("danger"), "移除 is red and last");
      require(items.every(item => visible(item)) && inside(document.querySelector("#app-popover"), document.documentElement), "the menu is whole in the window");
      require(document.querySelector('[data-conn="account-menu"][data-account="ca_wait"]').getAttribute("aria-expanded") === "true", "the ⋯ that opened it says so");
    }
    if (name === "accounts-remove-ask") {
      const dialog = document.querySelector(".mb-delete");
      require(visible(dialog) && inside(dialog, document.documentElement), "the question is whole in the window");
      require(dialog.querySelector("h2, .mb-dlg-title, [id*=title]")?.textContent === "移除「工作信箱」？", "the title is 移除「工作信箱」？");
      require(dialog.querySelector("p")?.textContent === "成員將無法再使用這個帳號。", "one sentence says members lose this account");
      const buttons = [...dialog.querySelectorAll(".mb-dlg-act .btn, .action-row .btn")];
      require(buttons.map(button => button.textContent).join("|") === "取消|移除", "the buttons are 取消 and 移除");
      require(made("connectors.remove_account").length === 0, "nothing is removed before the answer");
      require(document.activeElement === buttons[0], "the focus starts on 取消");
    }
    if (name === "accounts-removed") {
      const call = made("connectors.remove_account");
      require(call.length === 1 && call[0].params.id === "composio:gmail" && call[0].params.account_id === "ca_me", "the core was asked to remove that one account");
      require(rows.map(row => row.querySelector(".nm").textContent).join("|") === "Jack" && !document.querySelector(".mb-delete"), "only Jack is left and the question is closed");
    }
    if (name === "accounts-removed-waiting") {
      const call = made("connectors.remove_account");
      require(call.length === 1 && call[0].params.account_id === "ca_wait", "the core was asked to remove the waiting sign-in");
      require(!document.querySelector(".mb-delete") && rows.length === 1, "no question was asked and one row is left");
    }
    if (name === "accounts-remove-last") {
      require(made("connectors.remove_account").length === 0 && !document.querySelector(".mb-delete"), "the last connected account asks the app's own question, not another");
      const confirm = document.querySelector('.menu [data-conn="disconnect"]');
      require(visible(confirm) && confirm.textContent === "確定中斷？", "the app's menu asks 確定中斷？");
    }
    if (name === "sign-in-waits") {
      const cancel = document.querySelector('[data-conn="cancel-login"]'), joins = [...document.querySelectorAll('[data-conn="join"]')];
      require(visible(cancel) && !cancel.disabled && cancel.textContent === "取消", "the waiting row has an enabled 取消");
      require(joins.length > 3 && joins.every(button => !button.disabled), `every other 連結 is pressable (${joins.length} buttons)`);
      require(made("connectors.connect").length === 1 && made("connectors.connect")[0].params.toolkit === "slack", "one sign-in was started");
      require(!document.querySelector(".toast"), "nothing is said");
    }
    if (name === "sign-in-replaced") {
      const connects = made("connectors.connect").map(call => call.params.toolkit);
      require(connects.join("|") === "slack|gmail", `the second 連結 started after the first (${connects.join("|")})`);
      require(made("integrations.connect_cancel").length === 1, "the first sign-in was ended at the core once");
      require(document.querySelectorAll('[data-conn="cancel-login"]').length === 1, "only one sign-in waits");
      require(!document.querySelector('[data-conn="join"][data-id="slack"]')?.disabled && visible(document.querySelector('[data-conn="join"][data-id="slack"]')), "Slack is 連結 again");
      require(!document.querySelector(".toast"), "the ended sign-in says nothing");
    }
    if (name === "sign-in-cancelled") {
      require(made("integrations.connect_cancel").length === 1 && made("connectors.connect").length === 1, "取消 told the core once");
      require(!document.querySelector('[data-conn="cancel-login"]') && !document.querySelector(".toast"), "no wait is left and nothing is said");
    }
    return { check: name };
  }
  if (name === 'reaction-owner') {
    const message = document.querySelector('.tn[data-id="8201"] .owner-message'), row = message?.querySelector('.message-reactions');
    require(row && visible(row) && row.closest('.bubble'), "the owner's reactions are drawn on the owner's own bubble");
    const chips = [...row.querySelectorAll('[data-reaction]')];
    require(chips.map(chip => chip.dataset.reaction).join(' ') === '🎉', `the one reaction is there, never a second (${chips.map(chip => chip.dataset.reaction).join(' ')})`);
    return { check: name };
  }
  if (['reaction-bar-given', 'reaction-replaced', 'reaction-taken-back', 'reaction-ask', 'reaction-thinking', 'reaction-silent', 'reaction-changed'].includes(name)) {
    // One reaction per message (owner, 2026-11-14): another emoji replaces the one given, the same again takes it back.
    const calls = window.__look.calls.filter(call => call.method === 'agent.react'), message = document.querySelector('.tn[data-id="8201"]');
    const chips = [...message.querySelectorAll('[data-reaction]')].map(chip => chip.dataset.reaction);
    if (name === 'reaction-bar-given') {
      const bar = document.querySelector('#app-popover.reaction-bar');
      require(visible(bar), 'the bar is open');
      require([...bar.querySelectorAll('[aria-pressed="true"]')].map(button => button.dataset.quick).join(' ') === '👍', 'the bar presses only the one reaction the reply has');
    }
    if (name === 'reaction-replaced') {
      require(chips.join(' ') === '😂', `the reply carries only the new emoji (${chips.join(' ')})`);
      require(calls.length === 1 && calls[0].params.emoji === '😂' && calls[0].params.active === true, 'choosing another emoji is one reaction call, not a removal and a second one');
      require(message.querySelectorAll('.message-reactions .reaction').length === 1 && visible(message.querySelector('.message-reactions')), 'one chip stands on the bubble');
    }
    if (name === 'reaction-taken-back') {
      require(chips.length === 0 && !message.querySelector('.message-reactions'), 'the same emoji again takes the reaction back and leaves no chip');
      require(calls.length === 1 && calls[0].params.emoji === '👍' && calls[0].params.active === false, 'the call was the removal of that emoji');
    }
    const owner_said_nothing = () => !window.__look.calls.some(call => ['agent.ask', 'agent.confirm', 'owner_questions.answer'].includes(call.method));
    if (name === 'reaction-ask') {
      const ask = document.querySelector('.tn[data-id="8202"]');
      require(chips.join(' ') === '👎', `the reply keeps its thumbs down (${chips.join(' ')})`);
      require(ask && visible(ask.querySelector('.chat-message[data-reply]')) && ask.textContent.includes(window.__look.data.chatMetadataSample.askWhatWasWrong), 'the member asks what was wrong, as a message of its own');
      require(!ask.querySelector('.owner-message, .me'), 'the ask carries no message of the owner');
      require(!ask.querySelector('.live-presence') && !ask.dataset.live, 'the member is no longer shown at work once it has spoken');
      require(owner_said_nothing(), 'the owner said nothing and answered nothing');
    }
    if (name === 'reaction-thinking') {
      // The reaction is analysed at once (owner, 2026-11-14): the member's usual presence stands under the reply while it thinks.
      const turn = document.querySelector('.tn[data-id="8202"]'), presence = turn?.querySelector('.live-presence');
      require(turn && turn.dataset.live === 'true' && visible(presence), 'the member shows at work at once');
      require(presence.textContent.trim().length > 0 && visible(presence.querySelector('.live-action')), 'the presence says what the member is doing');
      require(!turn.querySelector('.owner-message, .me, .chat-message[data-reply], .message-text'), 'it has said nothing yet and carries no message of the owner');
      require(chips.length === 1 && calls.length === 1, `the reply carries the one reaction (${chips.join(' ')})`);
      require(owner_said_nothing() && !document.querySelector('.toast'), 'the owner said nothing, and nothing was announced');
    }
    if (name === 'reaction-silent') {
      // A member that needs no words leaves nothing behind: no turn, presence, message, card, failure or notice.
      require(!document.querySelector('.tn[data-id="8202"]') && !document.querySelector('.live-presence') && !document.querySelector('[data-live="true"]'), 'the member is no longer shown at work and no turn is left');
      require(document.querySelectorAll('.tn').length === 1, `the thread holds only the reply that was reacted to (${document.querySelectorAll('.tn').length})`);
      require(chips.join(' ') === '👍' && visible(message.querySelector('.message-reactions')), 'the reaction stays on the reply');
      require(!document.querySelector('.toast, .is-latest-failure, .turn-signin, .failure-detail, [data-act="rerun"], [data-act="regenerate"]'), 'no notice, failure or button stands in its place');
      require(owner_said_nothing(), 'the owner said nothing and answered nothing');
    }
    if (name === 'reaction-changed') {
      require(chips.join(' ') === '👎' && calls.length === 2, `the reply carries only the new emoji (${chips.join(' ')})`);
      require(document.querySelectorAll('.live-presence').length === 1 && document.querySelectorAll('.tn[data-live="true"]').length === 1, 'one analysis is under way, never two');
      require(owner_said_nothing(), 'the owner said nothing and answered nothing');
    }
    return { check: name };
  }
  if (name === 'reaction-signin') {
    const message = document.querySelector('.chat-message[data-reply]'), row = message?.querySelector('.message-reactions'), strip = message?.querySelector(':scope > .turn-signin');
    const button = strip?.querySelector('[data-act="cli-signin"]');
    require(visible(row) && visible(strip) && visible(button), 'the failed reply has its reaction and its 重新登入 button');
    require(row.querySelector('[data-reaction="👎"]'), 'the reaction is 👎');
    require(!strip.contains(row) && !strip.nextElementSibling?.matches('.message-reactions'), 'the reaction is not a part under the button');
    const bubble = row.closest('.ans').getBoundingClientRect(), pill = row.getBoundingClientRect(), under = button.getBoundingClientRect();
    require(pill.top < bubble.top && pill.bottom < bubble.bottom, "the reaction stands on the bubble's top edge");
    require(pill.bottom < under.top, 'and above the button, never below it');
    return { check: name, strip: Math.round(strip.getBoundingClientRect().right - bubble.right) };
  }
  if (name === 'reaction-layout-rest' || name === 'reaction-layout-hover') {
    const rows = [...document.querySelectorAll('.chat-message .message-reactions')].filter(visible);
    require(rows.length > 0, 'there are saved reactions to inspect');
    const overlaps = (a, b, depth = 0.5) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > depth;
    const positions = rows.map(row => {
      const message = row.closest('.chat-message'), owner = message.classList.contains('owner-message'), bubble = row.closest('.ans, .bubble');
      // Drawn inside the first bubble, so the cards, buttons and failure rows that follow it never take them from it.
      require(bubble && message.contains(bubble), 'reactions are drawn inside their bubble');
      const bounds = row.getBoundingClientRect(), edge = bubble.getBoundingClientRect(), whole = message.getBoundingClientRect();
      const ring = { left: bounds.left - 2, right: bounds.right + 2, top: bounds.top - 2, bottom: bounds.bottom + 2 };
      // Standing on the bubble's top-right corner (the owner's top-left), over its top edge, clear of the bubble above.
      require(bounds.top < edge.top && bounds.bottom > edge.top, 'reactions straddle the top edge of their bubble');
      require(owner ? bounds.left >= edge.left - 6 && bounds.left <= edge.left + 2 : bounds.right <= edge.right + 6 && bounds.right >= edge.right - 2, `reactions stand on the bubble's top-${owner ? 'left' : 'right'} corner`);
      require(getComputedStyle(row).position === 'absolute', 'reactions take no room in the message');
      const above = [...document.querySelectorAll('.chat-message :is(.ans, .bubble)')].filter(other => other !== bubble).map(other => other.getBoundingClientRect())
        .filter(other => other.width && other.bottom <= edge.top + 1 && other.right > ring.left && other.left < ring.right).sort((a, b) => b.bottom - a.bottom)[0];
      if (above) require(ring.top >= above.bottom, `reactions keep clear of the bubble above (${Math.round(ring.top)} < ${Math.round(above.bottom)})`);
      const words = [...bubble.querySelectorAll('.message-text')].some(text => {
        const walk = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          if ([...range.getClientRects()].some(rect => overlaps(rect, bounds, 1))) return true;
        }
        return false;
      });
      require(!words, "reactions never cover the bubble's words");
      const others = [...message.children].filter(part => part !== row && !part.contains(bubble) && visible(part) && !part.matches('.message-reactions'));
      require(!others.some(part => overlaps(part.getBoundingClientRect(), bounds)), `reactions cover none of the message's other parts, hover actions included (${others.map(part => part.className).join(' ')})`);
      const column = row.closest('.tn')?.getBoundingClientRect() ?? whole;
      require(bounds.left >= Math.max(0, column.left - 1) && bounds.right <= Math.min(window.innerWidth, column.right + 1), 'reactions stay inside the column');
      const centre = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
      const heart = [edge.left + edge.width / 2, edge.top + edge.height / 2];
      // A bubble behind a panel that opened over it (a side thread at 720) is not looked at, so neither are its reactions.
      const seen = heart[1] > 0 && heart[1] < window.innerHeight && !!document.elementFromPoint(...heart)?.closest('.ans, .bubble')?.isSameNode(bubble);
      if (seen && centre[1] > 0 && centre[1] < window.innerHeight) require(document.elementFromPoint(...centre)?.closest('.message-reactions') === row, 'nothing clips or covers the reactions');
      return { top: bounds.top, left: bounds.left, height: whole.height };
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
    // The face sits inside the avatar button since 415811f0 (a bot opens from its name), so it is found beneath the identity.
    const face = panel.querySelector('.mb-panel-identity .av').getBoundingClientRect(), named = panel.querySelector('.mb-panel-identity > b').getBoundingClientRect();
    require(face.width >= 56 && face.bottom <= named.top + 1 && Math.abs(face.left + face.width / 2 - (named.left + named.width / 2)) <= 1, 'a large face stands centred above the name');
    for (const button of [...panel.querySelectorAll('.mb-det-head .btn.icon'), ...document.querySelectorAll('.page-agent .mb-head .btn.icon, .page-agent .cmp-bar .cmp-attach')].filter(visible)) {
      const style = getComputedStyle(button), box = button.getBoundingClientRect();
      require(parseFloat(style.borderRadius) >= box.width / 2 - 0.5 && Math.abs(box.width - box.height) < 1 && style.backgroundColor !== 'rgba(0, 0, 0, 0)', `the buttons on the window's edges are soft round buttons (${button.getAttribute('aria-label') ?? button.dataset.act})`);
    }
    // The computer lives in the third tab only (owner, 2026-11-14): no Details view of any member has a row, heading, press or screen for it.
    if (tab === 'details') require(!panel.querySelector('.mb-tab-body [class*="computer"], .mb-tab-body [data-det^="computer"], .mb-tab-body [data-k*="computer"], .mb-tab-body [data-computer-thumb]') && ![...panel.querySelectorAll('.mb-tab-body .mb-dh')].some(node => node.textContent === '電腦'), 'Details has no computer row, heading or screen: the computer is the third tab');
    if (tab === 'details') for (const section of panel.querySelectorAll('.mb-tab-body > section')) {
      const head = section.querySelector(':scope > .mb-dh'), list = section.querySelector('.mb-rts, .conversation-rows, :scope > .mp-empty');
      if (!visible(head) || !visible(list)) continue;
      const pad = node => node ? parseFloat(getComputedStyle(node).paddingLeft) : 0, row = list.querySelector('.mb-rt, .conversation-open');
      const inner = list.getBoundingClientRect().left + pad(list) + pad(row), start = head.getBoundingClientRect().left + pad(head);
      require(Math.abs(inner - start) <= 1 && getComputedStyle(list).backgroundColor !== 'rgba(0, 0, 0, 0)', `a panel heading starts where the text of its tinted list starts (${Math.round(start)} vs ${Math.round(inner)})`);
    }
    if (tab === 'computer') {
      const live = visible(panel.querySelector('.desktop-screen iframe'));
      const phase = panel.querySelector('.desktop-panel')?.dataset.desktopState, cover = panel.querySelector('[data-desktop="enlarge"]');
      const runs = ['member', 'owner', 'connecting'].includes(phase), asleep = !!cover?.hasAttribute('data-asleep'), preparing = ['starting', 'building', 'preparing'].includes(phase);
      // The whole screen is the one press: it opens the larger view while the computer runs and starts it in every other state but getting ready.
      require(!!visible(cover) === !preparing && (!asleep || phase === 'stopped'), 'the screen is the one press that opens or starts the computer, except while it is getting ready');
      require(!visible(panel.querySelector('[data-desktop="take"]')), 'Take control waits in the larger view, never under the preview');
      require(!visible(panel.querySelector('.desktop-caption')), 'no caption stands under the screen');
      require(!!visible(panel.querySelector('.computer-lifecycle-state')) === runs, 'the header names the state only once the computer runs');
      if (!runs) requireBareScreen(panel.querySelector('.desktop-screen'));
      if (live) require(panel.querySelector('[data-computer-state-text]')?.textContent === '執行中', 'the live header names the running state');
    }
    if (tab === 'details') require([...panel.querySelectorAll('.mb-dh')].filter(node => visible(node) && node.textContent === '對話').length === (panel.querySelector('[data-slot="conversations"]') ? 1 : 0), 'Details names the conversation section once, and only for Raphael');
    if (name === 'member-panel-details') {
      // The list of what the member did was removed: Details begins with the routines.
      require(!panel.querySelector('.mb-panel-tasks, .mb-task-list, [data-panel-task]'), 'Details has no work list');
      require(panel.querySelector('.mb-tab-body > section')?.matches('.mb-panel-routines') && !panel.querySelector('[data-slot="conversations"]'), 'routines come first, and a member has no conversation list');
      const closeRight = panel.querySelector('[data-det="close"]').getBoundingClientRect().right, listBox = panel.querySelector('.mb-rts').getBoundingClientRect(), tabBar = panel.querySelector('.mb-tabs .tabs').getBoundingClientRect();
      // R-TOP-01: where the panel's top row reaches the window's three buttons, close ends 14 px before them; elsewhere it
      // stands on the content's right edge as before.
      const controls = document.querySelector('.window-controls')?.getBoundingClientRect(), head = panel.querySelector('.mb-det-head').getBoundingClientRect();
      const underControls = controls && head.right > controls.left && head.top < controls.bottom;
      const wanted = underControls ? controls.left - 14 : listBox.right;
      require(Math.abs(closeRight - wanted) <= 2, `close stands ${underControls ? "14 px before the window's buttons" : "on the content's right edge"} (${Math.round(closeRight)} vs ${Math.round(wanted)})`);
      require(Math.abs((tabBar.left + tabBar.right) / 2 - (listBox.left + listBox.right) / 2) < 1, 'the tabs sit in the middle of the content');
      require(['mb-panel-routines', 'mb-panel-suggest'].join() === [...panel.querySelectorAll('.mb-tab-body > section')].map(section => section.className).join(), 'a member\'s Details holds the routines and the chat platforms');
    } else if (name === 'member-panel-details-empty') {
      require(!panel.querySelector('.mb-panel-tasks') && panel.querySelector('.mb-panel-routines .mp-empty'), 'an empty Details is one quiet routine line and no work list');
    } else if (name.startsWith('member-panel-details-no-computer-')) {
      // The computer lives in the third tab only (owner, 2026-11-14), whatever its state and whoever the member: Details has its routines, for Raphael
      // his conversations, and the chat platforms, and nothing else. The tab itself stays.
      const raphael = name.endsWith('-raphael'), body = panel.querySelector('.mb-tab-body');
      require([...body.querySelectorAll(':scope > section')].map(section => section.className).join() === (raphael ? 'mb-panel-routines,,mb-panel-suggest' : 'mb-panel-routines,mb-panel-suggest'), `Details holds the routines${raphael ? ', the conversations' : ''} and the chat platforms (${[...body.querySelectorAll(':scope > section')].map(section => section.className)})`);
      require(!!panel.querySelector('[data-slot="conversations"]') === raphael, 'only Raphael has the conversation section');
      require(!!panel.querySelector('.mb-tabs [data-tab="computer"]'), 'the third tab, the computer, is still there');
    } else if (/^member-panel-library(?:-pages|-media|-files|-long)?$/.test(name)) {
      // The Library, as Grok Bot's (owner, 2026-11-12): chips for the kinds there are, a quiet label per recency group and each
      // group's items in one rounded card of one-line rows (a 20 px mark and the title). No links, no times, never a 「顯示更多」.
      const chipName = (/-(pages|media|files)$/.exec(name) ?? [])[1] ?? 'all', long = name.endsWith('-long');
      const body = panel.querySelector('.mb-tab-body'), groups = [...body.querySelectorAll('.lib-group')], rows = [...body.querySelectorAll('.lib-row')];
      const bar = body.querySelector('.lib-filters'), chips = [...body.querySelectorAll('.lib-filters [data-lib-filter]')], scroll = panel.querySelector('.mb-det-scroll');
      const rgb = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = value => { const [r, g, b] = rgb(value).map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      require(!body.querySelector('[data-panel-more], .lib-more, .lib-pic, .team-file, time') && !body.querySelector('[data-panel-file^="link:"]') && !/example\.com/.test(body.textContent), 'no links, no times, no 「顯示更多」');
      // The chips: one row above the groups, each hugging its word, the pressed one the light chip.
      require(chips.map(button => button.textContent).join() === '全部,頁面,媒體,檔案', `the chips are 全部, 頁面, 媒體, 檔案 (${chips.map(button => button.textContent)})`);
      require(bar.getBoundingClientRect().bottom <= groups[0].getBoundingClientRect().top + 1, 'the chips stand above the first group');
      require(new Set(chips.map(button => Math.round(button.getBoundingClientRect().top))).size === 1 && chips.every(button => Math.abs(button.getBoundingClientRect().height - 26) <= 1), 'the chips are one row of 26 px pills');
      const pressed = chips.filter(button => button.getAttribute('aria-pressed') === 'true');
      require(pressed.length === 1 && pressed[0].dataset.libFilter === chipName, `the ${chipName} chip is the one pressed (${pressed.map(button => button.dataset.libFilter)})`);
      const lit = getComputedStyle(pressed[0]), quiet = getComputedStyle(chips.find(button => button !== pressed[0]));
      require(lit.backgroundColor !== quiet.backgroundColor && contrast(lit.color, lit.backgroundColor) >= 7 && Math.abs(luminance(lit.backgroundColor) - luminance(getComputedStyle(panel).backgroundColor)) > 0.3, 'the pressed chip is the light one with dark words (inverted against the panel)');
      // The groups: newest first under today, yesterday, past week, older, each one card.
      const order = ['今天', '昨天', '過去一週', '更早'], labels = groups.map(group => group.querySelector('.mb-dh').textContent);
      require(labels.length && labels.every(label => order.includes(label)) && labels.join() === order.filter(label => labels.includes(label)).join(), `groups run by recency (${labels})`);
      const cards = groups.map(group => group.querySelectorAll(':scope > .lib-card'));
      require(cards.every(found => found.length === 1), 'each group is one card');
      const box = [...body.querySelectorAll('.lib-card')], first = box[0].getBoundingClientRect();
      for (const card of box) {
        const rect = card.getBoundingClientRect(), style = getComputedStyle(card);
        require(Math.abs(rect.left - first.left) <= 1 && Math.abs(rect.right - first.right) <= 1, 'the cards are one width');
        require(parseFloat(style.borderTopWidth) === 1 && parseFloat(style.borderTopLeftRadius) >= 11 && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && Math.abs(parseFloat(style.paddingLeft) - 8) <= 1, 'a card is a framed rounded surface with 8 px inside');
        require(Math.abs(rect.left - chips[0].getBoundingClientRect().left) <= 1, 'the chips start at the card edge');
      }
      require(panel.scrollWidth <= panel.clientWidth + 1 && scroll.scrollWidth <= scroll.clientWidth + 1 && first.right <= panel.getBoundingClientRect().right, 'nothing overflows the panel sideways');
      // The rows: one line of 36 px, a 20 px mark and the title, titles in one column, nothing framed.
      require(rows.length === ({ all: 18, pages: 2, media: 5, files: 11 }[chipName] + (long ? 80 : 0)), `the ${chipName} chip lists its deliverables (${rows.length})`);
      const kindsOf = { all: ['page', 'image', 'video', 'audio', 'document', 'archive'], pages: ['page'], media: ['image', 'video', 'audio'], files: ['document', 'archive', 'file'] }[chipName];
      require(rows.every(row => kindsOf.includes(row.querySelector('.lib-icon').dataset.kind)), `only the ${chipName} kinds are listed`);
      const titleLeft = rows[0].querySelector('.lib-title').getBoundingClientRect().left;
      for (const row of rows) {
        const rect = row.getBoundingClientRect(), mark = row.querySelector('.lib-icon').getBoundingClientRect(), title = row.querySelector('.lib-title'), style = getComputedStyle(row);
        require(row.tagName === 'BUTTON' && Math.abs(rect.height - 36) <= 1, `a row is a 36 px button (${rect.height})`);
        require(Math.abs(mark.width - 20) <= 1 && Math.abs(mark.height - 20) <= 1 && row.querySelector('.lib-icon > .i, .lib-icon > img'), 'a 20 px mark');
        require(title.textContent.trim() && Math.abs(title.getBoundingClientRect().left - titleLeft) <= 1 && title.getBoundingClientRect().left >= mark.right + 8, 'titles start in one column after the mark');
        require(row.scrollWidth <= row.clientWidth + 1 && title.getBoundingClientRect().right <= rect.right, 'a long title is cut by its row, never wider');
        require(parseFloat(style.borderTopWidth) === 0 && (row.matches(':hover') || style.backgroundColor === 'rgba(0, 0, 0, 0)'), 'rows are not framed');
        require(row.children.length === 2, 'a row is its mark and its title, nothing else');
      }
      // The group label starts where the marks do.
      for (const group of groups) {
        const label = group.querySelector('.mb-dh'), range = document.createRange(); range.selectNodeContents(label);
        require(Math.abs(range.getBoundingClientRect().left - group.querySelector('.lib-icon').getBoundingClientRect().left) <= 2, 'the label starts where the marks begin');
      }
      const marks = new Map(rows.map(row => [row.querySelector('.lib-icon').dataset.kind, row.querySelector('.lib-icon > .i')?.innerHTML]));
      require(new Set([...marks.values()].filter(Boolean)).size === [...marks.values()].filter(Boolean).length, 'different kinds wear different marks');
      if (['all', 'media'].includes(chipName) && !long) {
        const thumbs = [...body.querySelectorAll('.lib-thumb')];
        require(thumbs.length === 3 && thumbs.every(thumb => thumb.querySelector('img[src]') && Math.abs(thumb.getBoundingClientRect().width - 20) <= 1 && Math.abs(thumb.getBoundingClientRect().height - 20) <= 1 && parseFloat(getComputedStyle(thumb).borderTopLeftRadius) >= 3), "today's three pictures are 20 px rounded thumbnails, loaded");
        require(!rows.some(row => row.querySelector('.lib-icon[data-kind="image"] > .i')), 'a picture with a stored copy is never the plain icon');
      }
      if (['all', 'files'].includes(chipName) && !long) {
        const word = rows.find(row => row.dataset.panelFile === 'delivered-file:long');
        require(word && word.querySelector('.lib-title').scrollWidth > word.querySelector('.lib-title').clientWidth, 'a very long file name ends in an ellipsis');
        require(rows.find(row => row.dataset.panelFile === 'delivered-file:bundle')?.querySelector('.lib-icon').dataset.kind === 'archive', 'the kind sets the mark');
      }
      if (long) require(scroll.scrollHeight > scroll.clientHeight * 2, 'a long list scrolls inside the panel');
    } else if (/^member-panel-library-single(?:-pages)?$/.test(name)) {
      // A Library of one kind alone: the same four chips in order, 26 px pills in one row; the kind it has under 全部, and the chip
      // of a kind it has not as one quiet line (never a blank, never the 全部 sentence) under the label's inset.
      const body = panel.querySelector('.mb-tab-body'), chips = [...body.querySelectorAll('.lib-filters [data-lib-filter]')], pages = name.endsWith('-pages');
      require(chips.map(button => button.dataset.libFilter).join() === 'all,pages,media,files' && chips.map(button => button.textContent).join() === '全部,頁面,媒體,檔案', `a Library of one kind still has the four chips in order (${chips.map(button => button.textContent)})`);
      require(new Set(chips.map(button => Math.round(button.getBoundingClientRect().top))).size === 1 && chips.every(button => Math.abs(button.getBoundingClientRect().height - 26) <= 1), 'the chips are one row of 26 px pills');
      const pressed = chips.filter(button => button.getAttribute('aria-pressed') === 'true');
      require(pressed.length === 1 && pressed[0].dataset.libFilter === (pages ? 'pages' : 'all'), `the ${pages ? 'pages' : 'all'} chip is the one pressed`);
      require(chips.every(button => button.getBoundingClientRect().right <= panel.getBoundingClientRect().right) && panel.scrollWidth <= panel.clientWidth + 1, 'the four chips fit the panel');
      if (pages) {
        const line = body.querySelector('.lib-filters + .mp-empty');
        require(line && line.textContent === '還沒有頁面' && !body.querySelector('.lib-row, .lib-card'), `the chip of a kind with nothing is one quiet line (${line?.textContent})`);
        require(line.getBoundingClientRect().top >= body.querySelector('.lib-filters').getBoundingClientRect().bottom && getComputedStyle(line).color !== getComputedStyle(pressed[0]).color, 'the line stands under the chips, quieter than the pressed chip');
      } else {
        const rows = [...body.querySelectorAll('.lib-row')], kinds = new Set(rows.map(row => row.querySelector('.lib-icon').dataset.kind));
        require(rows.length === 5 && [...kinds].every(kind => ['image', 'video', 'audio'].includes(kind)) && !body.querySelector('.mp-empty'), `全部 lists the five pictures, video and audio (${rows.length})`);
      }
    } else if (name === 'member-panel-library-open') {
      const opened = window.__look.state?.openedLibraryFile ?? window.__look.openedLibraryFile;
      require(opened?.id === 'delivered-file:bundle' && opened.member_id === 1, `the delivered file opens by its Library handle, never a path (${JSON.stringify(opened)})`);
      require(visible(document.querySelector('.media-lightbox img')), 'a picture opens large');
    } else if (name === 'member-panel-library-empty') {
      const body = panel.querySelector('.mb-tab-body'), chips = [...body.querySelectorAll('.lib-filters [data-lib-filter]')];
      require(body.querySelector('.lib-filters + .mp-empty')?.textContent === '還沒有檔案或頁面' && !body.querySelector('.lib-row'), 'library has one empty sentence');
      require(chips.map(button => button.textContent).join() === '全部,頁面,媒體,檔案', 'an empty Library still has the four chips');
    } else if (name === 'member-panel-computer-live') {
      require(visible(panel.querySelector('iframe')), 'the existing stream is visible');
      const open = panel.querySelector('[data-desktop="enlarge"]'), screen = panel.querySelector('.desktop-screen').getBoundingClientRect(), cover = open.getBoundingClientRect(), caption = panel.querySelector('.desktop-caption');
      require(visible(open) && Math.abs(cover.width - screen.width) <= 2 && Math.abs(cover.height - screen.height) <= 2, 'the whole preview is the button that opens the larger view');
      require(getComputedStyle(open.querySelector('.desktop-open-pill')).opacity === '0', 'the Open pill shows only under the pointer');
      require(!visible(caption), 'no caption stands under the screen');
    } else if (name === 'member-panel-computer-docker-stopped') {
      // The engine failure is not said on the screen; the screen is the press that starts Docker Desktop.
      require(!shownText(panel).includes('Docker Desktop') &&!visible(panel.querySelector('[data-desktop="retry"]')) && !visible(panel.querySelector('[data-desktop-location]')), 'neither Docker Desktop nor a recovery button is drawn');
      require(visible(panel.querySelector('[data-desktop="enlarge"]')) && !panel.querySelector('[data-desktop="enlarge"]').hasAttribute('data-asleep'), 'the whole screen is the press that starts Docker');
      require(!window.__look.calls.some(call => call.params?.start_docker), 'reading never starts Docker');
    } else if (name === 'member-panel-computer-docker-missing') {
      require(!panel.querySelector('[data-act="docker-download"]'), 'a missing installation draws no download button');
    } else if (name === 'member-panel-computer-remote') {
      require(!shownText(panel.querySelector('.desktop-screen')).includes('studio-mini'), 'a remote failure does not write the host on the screen');
      require(visible(panel.querySelector('.desktop-location-header [data-computer-location]')), 'the location control still names where the computer lives');
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
    // Nothing is written over a computer that is not showing its screen: the wallpaper alone, and the
    // state stays in the panel's data. The one press that starts it is the cover, which is the screen itself.
    const panel = document.querySelector('.desktop-panel'), screen = panel?.querySelector('.desktop-screen');
    require(visible(screen), 'the computer screen is shown');
    // The fake core answers an absent Docker when the scene sets no computer, as the real core does without Docker.
    const state = window.__look.data.desktop ?? { state: 'absent' };
    const phase = expectedDesktopState(state);
    require(panel.dataset.desktopState === phase, `the panel keeps its state in data (${panel.dataset.desktopState} vs ${phase})`);
    requireBareScreen(screen);
    require(!visible(panel.querySelector('.computer-lifecycle-state')) && !visible(panel.querySelector('.desktop-caption')), 'neither the header nor a caption says the state in words');
    const location = document.querySelector('.desktop-location-header [data-computer-location]');
    require(visible(location), 'the location control stays on the header row');
    const cover = panel.querySelector('[data-desktop="enlarge"]'), bounds = screen.getBoundingClientRect();
    if (['starting', 'building', 'preparing'].includes(phase)) require(!visible(cover), 'a computer that is getting ready is not pressable');
    else {
      const box = cover.getBoundingClientRect();
      require(visible(cover) && Math.abs(box.width - bounds.width) <= 2 && Math.abs(box.height - bounds.height) <= 2, 'the whole screen is the one press that starts the computer');
      require(cover.hasAttribute('data-asleep') === (phase === 'stopped' && state.image !== false), 'only a sleeping computer is the wake press');
    }
    require(Math.abs(bounds.height - bounds.width * 900 / 1280) <= 2, 'the bare screen keeps the running screen proportions');
    return {check:name};
  }  if (name.startsWith("app-update-")) {
    const section = document.querySelector("[data-updates]");
    require(visible(section) && section.textContent.includes("1.1.0"), "new version is visible");
    require(section.textContent.includes("改善更新安裝"), "release notes remain readable");
    require(visible(section.querySelector('[data-act="update-install"]')), "a framed install action is visible");
    if (name === "app-update-ready") require(section.textContent.includes("更新已驗證"), "verified state is explicit");
    require(section.querySelector('[data-k="auto-update"]').getAttribute("aria-checked") === (name === "app-update-auto" ? "true" : "false"), "auto updates are opt-in");
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
    require(!document.querySelector('[data-det="routine-add"]'), 'no plus: a routine is asked of the member in the conversation, as the line says');
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
  if (['reaction-picker','reaction-row','reaction-not-approval','room-thread-open','room-thread-chip','slack-draft'].includes(name)) {
    const calls = window.__look.calls, data = window.__look.data;
    require(!document.querySelector('.conversation-event-line[data-reaction]'), 'metadata adds no centered event line');
    require([...document.querySelectorAll('[data-reaction]')].every(button => button.getAttribute('aria-pressed') === 'true' && button.getAttribute('aria-label')?.includes(button.dataset.reaction)), 'selected reactions are named pressed toggles');
    if (name === 'reaction-picker') {
      const menu = document.querySelector('#app-popover');
      require(visible(menu) && ['👍','😂','👎','❤','🎉'].every(emoji=>menu.textContent.includes(emoji)), 'one compact pill of the five available reactions');
    }
    if (name === 'reaction-row') require(document.querySelector('.tn[data-id="8201"] [data-reaction="👍"]') && document.querySelectorAll('.tn[data-id="8201"] [data-reaction]').length === 1, 'the one saved reaction appears on the bubble of its message');
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
    require(thread.querySelector('[data-id="8101"] .chat-message .routine-run-link')?.textContent.includes('範例晨間筆記摘要'), 'routine name belongs to the reply');
    require(getComputedStyle(thread.querySelector('[data-id="8102"] .message-actions:has(.rerun)')).opacity === '1', 'latest failed action is visible without hover');
    return {check:name,...count};
  }
  if (name === 'computer-header-layout') {
    const header = document.querySelector('.desktop-location-header');
    require(visible(header), 'the member panel header is visible');
    // The state word shows only once the computer runs; before that the header keeps location and overflow.
    const running = ['member', 'owner', 'connecting'].includes(document.querySelector('.desktop-panel')?.dataset.desktopState);
    const selectors = ['.computer-lifecycle-state', '[data-computer-location]', '[data-computer-menu]'];
    require(!!visible(header.querySelector('.computer-lifecycle-state')) === running, 'the header names the state only while the computer runs');
    const nodes = selectors.map(selector => header.querySelector(selector)).filter(node => visible(node) && (node.matches('button') || node.textContent.trim()));
    require(nodes.length === (running ? 3 : 2) && visible(document.querySelector('[data-det="gear"]')) && visible(document.querySelector('[data-det="close"]')), 'computer controls stay in their tab while the gear and close remain available');
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
    // Nothing says the state in words, face or header; the panel keeps it in data and the screen is bare.
    const phase = name.slice('computer-state-'.length), panel = document.querySelector('.mb-det');
    const dataState = {sleeping:'stopped', waking:'preparing', updating:'preparing', repairing:'preparing'}[phase];
    require(panel.querySelector('.desktop-panel')?.dataset.desktopState === dataState, `the panel keeps the ${phase} state in data`);
    require(!visible(panel.querySelector('.computer-lifecycle-state')), 'the header does not name the computer state');
    requireBareScreen(panel.querySelector('.desktop-screen'), `the ${phase} screen`);
    const words = {sleeping:'電腦在休眠',waking:'正在喚醒',updating:'正在更新',repairing:'正在修復'};
    require(!shownText(panel).includes(words[phase]), 'no sentence says the computer state');
    return {check:name};
  }
  if (name === 'computer-wake-line') {
    const lines = [...document.querySelectorAll('.chat-message[data-reply="true"]')].filter(line => line.textContent.includes('喚醒了電腦'));
    require(lines.length === 1 && lines[0].textContent.trim() === '小晴為了開網頁喚醒了電腦', `the conversation says who woke the computer and why, once (${lines.map(line => line.textContent.trim())})`);
    require(visible(lines[0]) && lines[0].scrollWidth <= lines[0].clientWidth + 1, 'the line is a normal message and fits its column');
    require(!document.querySelector('.toast, [role="alert"]:not([hidden])'), 'no toast and no alert says it');
    require(!window.__look.calls.some(call => call.method === 'computer.lifecycle'), 'saying so performs no maintenance');
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
    const command = repair.querySelector('code')?.textContent ?? '';
    require(visible(repair) && repair.textContent.includes('終端機') && command.startsWith('ssh studio-mini ') && command.includes('~/.zshenv'), 'host health says where to run the exact repair command, and the command reaches the remote host as pasted');
    require(!/core\/src|docker build|專案資料夾/.test(repair.textContent), 'no repair asks for a build from the app project sources');
    require(visible(repair.querySelector('[data-act="copy-code"]')), 'repair command uses the shared copy control');
    require(window.__look.calls.some(call => call.method === 'computer.viewer_status' && call.params.check_host && call.params.alias === 'studio-mini'), 'checks the selected alias through the existing owner RPC');
    return {check:name};
  }
  if (name === 'member-delete-ask') {
    // Grok Bot's dialog and nothing more (owner, 2026-11-11): the member's name, one sentence, Cancel and Delete. A member's
    // computer is removed by the app on its own, so the question never mentions it, whether the member has one or not.
    const dialog = document.querySelector('.mb-dialog.mb-confirm');
    require(visible(dialog), 'the delete question is open');
    const title = dialog.querySelector('h2').textContent;
    require(window.__look.data.members.some(person => title === `刪除「${person.name}」？`), `the title names the member (${title})`);
    const sentences = [...dialog.querySelectorAll('p')].map(node => node.textContent);
    require(sentences.length === 1 && sentences[0] === '永久刪除這位成員和對話紀錄，無法復原。', `one sentence says the member and its conversation go for good (${sentences.join(' | ')})`);
    const buttons = [...dialog.querySelectorAll('button')].filter(visible).map(button => button.textContent.trim());
    require(buttons.join('|') === '取消|刪除', `two buttons, Cancel then Delete (${buttons.join('|')})`);
    require(!dialog.querySelector('.row, .tg, [role="switch"], [role="checkbox"], input, select, textarea, [data-remove-computer]'), 'no row, switch or field stands in the question');
    require(!/電腦|主機|工作檔案|登入狀態|Docker|computer/i.test(dialog.textContent), 'nothing is said about a computer');
    require(!window.__look.calls.some(call => call.method === 'members.delete'), 'asking performs no deletion');
    return {check:name, title};
  }
  if (name === 'desktop-stream') {
    const frame = document.querySelector('iframe[data-desktop-stream]');
    require(visible(frame) && frame.contentDocument?.defaultView.__desktopConnections === 1, 'the existing viewer is connected before enlargement');
    window.__look.desktopStream = { frame, document: frame.contentDocument, opens: window.__look.calls.filter(call => call.method === 'computer.viewer_open').length, closes: window.__look.calls.filter(call => call.method === 'computer.viewer_close').length };
    return {check:name};
  }
  if (name === 'desktop-watch' || name === 'desktop-watch-collapse' || name === 'desktop-watch-retake') {
    const panel = document.querySelector('.desktop-panel'), calls = window.__look.calls;
    // An earlier take-over (desktop-watch-retake) has asked the core for the lease; every other watch has not.
    if (name !== 'desktop-watch-retake') require(!calls.some(call => call.method === 'computer.viewer_control'), 'watching never changes owner control');
    if (name === 'desktop-watch-collapse') {
      require(!panel.hasAttribute('data-expanded'), 'Esc returns to conversation');
      const before = window.__look.desktopStream, frame = document.querySelector('iframe[data-desktop-stream]');
      require(before && calls.filter(call => call.method === 'computer.viewer_open').length === before.opens && calls.filter(call => call.method === 'computer.viewer_close').length === before.closes && frame === before.frame && frame.contentDocument === before.document, 'collapse keeps the same stream without opening, closing or reloading');
    } else {
      require(document.documentElement.hasAttribute('data-desktop-watch'), 'watch mode is enlarged');
      const bounds = panel.getBoundingClientRect();
      require(Math.abs(bounds.right - innerWidth) <= 2 && bounds.left <= 2, 'the larger view fills the whole window');
      require(getComputedStyle(document.querySelector('#nav')).visibility === 'hidden', 'the sidebar steps away under the larger view');
      const collapse = document.querySelector('.window-chrome > [data-desktop="collapse"]'), strip = document.querySelector('.window-chrome').getBoundingClientRect();
      require(visible(collapse) && collapse.getBoundingClientRect().bottom <= strip.bottom + 1 && collapse.getBoundingClientRect().right <= document.querySelector('.window-controls').getBoundingClientRect().left + 1, 'fold back sits beside the window buttons');
      const dock = panel.querySelector('.desktop-dock'), screenBox = panel.querySelector('.desktop-screen').getBoundingClientRect();
      require(visible(dock) && Math.abs((dock.getBoundingClientRect().left + dock.getBoundingClientRect().right) / 2 - innerWidth / 2) <= 2 && dock.getBoundingClientRect().top >= screenBox.bottom, 'one pill sits centred below the screen');
      require(Math.abs(screenBox.width / screenBox.height - 1280 / 900) < 0.03, 'the screen keeps its own proportions');
      // Watching is view-only whoever holds the lease, so the pill never says 你正在控制 here (owner, 2026-11-13:
      // 「明明顯示我正在控制，但我根本就沒辦法控制」).
      require(dock.querySelector('.desktop-mode-label').textContent === '觀看中', 'the pill says the owner is watching');
      // Grok Bot's two states: watching offers Take control; in control offers Stop (which hands the computer back).
      const take = dock.querySelector('[data-desktop="take"]'), stopControl = dock.querySelector('[data-desktop="return"]');
      require(!visible(stopControl), 'watching offers no Stop of control');
      // Whoever the core says holds the lease: the owner can take over whenever the pill watches (owner, 2026-11-14:
      // 「為什麼我沒辦法接手啊 ? 理論上不管甚麼時候我都應該要可以接手」, a picture of 觀看中 with no button).
      require(visible(take) && take.textContent === '接手控制' && !take.disabled, 'watching the pill offers Take control');
      if (name === 'desktop-watch-retake') {
        require(panel.dataset.desktopState === 'owner', `the core still keeps the lease of the earlier take-over (${panel.dataset.desktopState})`);
        require(calls.filter(call => call.method === 'computer.viewer_control' && call.params.held === true).length === 1
          && calls.filter(call => call.method === 'computer.viewer_control' && call.params.held === false).length === 1, 'one earlier take and one failed give-back');
        require(visible(panel.querySelector('.desktop-error')), 'the failed take says so under the screen');
      }
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
    const row = document.querySelector('[data-row="output-folder"]');
    require(visible(row) && !row.querySelector('input, textarea'), "R-COLLEAGUE-06: the output folder is a picker, with no typed field");
    const chosen = row.querySelector('[data-act="output-pick"]'), name_ = row.querySelector('.output-name'), path = row.querySelector('.output-path');
    require(visible(chosen) && name_?.textContent === 'Deliveries', "the button names the chosen folder");
    require(visible(path) && path.textContent === 'C:\\Owner\\Deliveries', "the whole path stands under the row name");
    require(row.querySelectorAll('button').length === 1, "the folder is changed with its one button (R-UI-56: no clear button standing open)");
    const box = row.getBoundingClientRect(), pick = chosen.getBoundingClientRect();
    require(pick.right <= box.right + 0.5 && path.getBoundingClientRect().right <= pick.left, "the path never runs under the button");
    return { check: name, button: Math.round(pick.width) };
  }
  if (name.startsWith("skills-") || ["growing-skills", "member-shared-source"].includes(name)) {
    for (const label of document.querySelectorAll('[data-skill-provenance], .mp-resource p, .ms-meta, .cs-linked .ds, .cs-page .cs-desc')) {
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
      const quote = scroll.querySelector('button.message-quote');
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
    require(!pane.textContent.includes('S2-03'), "R-TEXT-02: a stage code is never in what the meeting shows");
    if (name === "room-meeting-report") {
      reports[0].querySelector('[data-room-act="artifact-open"]').click();
      require(window.__look.openedTeamFile === 'task-artifact:42:501', "the file press reaches the native artifact resolver");
    }
    if (name === "room-meeting-board") {
      const board = document.querySelector('#app-popover [data-room-board]');
      require(board && board.textContent.includes('成果檢查') && board.textContent.includes('每個階段由一位成員負責'), "the board retains status and pinned decisions");
      require(!board.textContent.includes('S2-03'), "R-TEXT-02: the board names work by its title, never by its stage code");
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
      // The stage reaches the window's top under the header: a row left there ran under the name pill and a press on it opened the details instead.
      const press = row.querySelector('button').getBoundingClientRect(), hit = document.elementFromPoint(press.left + press.width / 2, press.top + press.height / 2);
      const crowded = [...host.querySelectorAll(':scope > .page-head button, :scope > .page-head h1')].filter(visible).filter(item => { const box = item.getBoundingClientRect(); return box.bottom > press.top && box.top < press.bottom && box.right > press.left && box.left < press.right; });
      require(!crowded.length && row.contains(hit), `the row stands below the top row, so a press on it lands on it (under it: ${crowded.map(item => item.className || item.localName).join(', ') || 'nothing'}; hit ${hit?.className || hit?.localName})`);
      const composer = host.querySelector('.composer').getBoundingClientRect();
      require(Math.abs(press.left - composer.left) <= 2 && Math.abs(press.right - composer.right) <= 2, `the row has the thread's sides (${press.left}-${press.right} vs composer ${composer.left}-${composer.right})`);
      if (name === "owner-question-pending-many") require(visible(document.querySelector('[role="menu"]')) && row.textContent.includes('2'), "a counted row opens the shared question list");
    }
    return { check: name, cards: cards.length };
  }
  if (name.startsWith("raphael-open-")) {
    const scroller = document.querySelector('.page-agent .mb-chat .ra-scroll'), divider = scroller.querySelector('.thread-new');
    const timeline = window.__look.timeline, run = name.slice("raphael-open-".length);
    const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const latest = document.querySelector('.page-agent .mb-chat .conversation-latest');
    require(divider && timeline.length, "the unread line is drawn and the thread was seen");
    require(window.__look.calls.some(call => call.method === "members.list") && !window.__look.errors.length, "the roster was read and nothing failed");
    // The first place seen is the one it stays at: no sample after the first is higher up (a scroll position that only clamps
    // as the thread gets shorter keeps its distance from the bottom).
    require(timeline.every((place, index) => index === 0 || !(place.top < timeline[index - 1].top - 1 && place.bottom > timeline[index - 1].bottom + 1)), `the view never moved up after it was first seen (${JSON.stringify(timeline.slice(0, 6))})`);
    if (run === "long") {
      const top = divider.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      require(top >= 0 && top <= 40 && bottom > 80, "a run longer than one viewport starts at its line");
      require(timeline.every(place => place.bottom > 80), "the bottom was never shown on the way to the line");
      return { check: name, top, bottom, places: timeline.length };
    }
    const newest = run === "short" ? "7001" : "7035";
    require(scroller.querySelector(`.tn[data-id="${newest}"]`) && Number(scroller.dataset.windowLater) === 0, "the newest turn is mounted: the tail of the thread is not cut off");
    if (run === "short") {
      require(timeline[0].bottom <= 2 && bottom <= 2, "a short run opens at the bottom, and was never seen anywhere else");
      require(!visible(latest), "the latest button does not show at the bottom");
    } else if (bottom <= 2) require(!visible(latest), "the latest button does not show at the bottom");
    return { check: name, bottom, places: timeline.length };
  }
  if (name === "owner-question-order") {
    const thread = document.querySelector('.page-agent .mb-chat .thread'), card = thread.querySelector('[data-owner-question]');
    const replies = [...thread.querySelectorAll('[data-seq]')], computer = thread.querySelector('[data-computer-card]');
    require(card && replies.length === 2 && computer, "a turn with two replies, the computer's card and a question");
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (card.dataset.cardState === "asked") {
      require(replies.every(reply => before(reply, card)) && before(computer, card), "a question that waits stands after the replies and the computer's card");
      const last = thread.lastElementChild.getBoundingClientRect();
      require(card.getBoundingClientRect().bottom <= last.bottom + 1, "it is the last thing of the thread");
    } else {
      require(card.dataset.cardState === "answered", "the question is answered");
      require(before(card, replies[0]) && before(card, computer), "an answered question stands where it was asked, before the replies it led to and the computer's card");
      require(!replies.some(reply => before(reply, card)), "no reply stands before it");
      const boxes = [card, replies[0], replies[1]].map(node => node.getBoundingClientRect());
      require(boxes[0].bottom <= boxes[1].top + 1 && boxes[1].bottom <= boxes[2].top + 1, "the card and the replies read down the thread in that order");
    }
    return { check: name, state: card.dataset.cardState };
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
      // The owner's picture is all that shows: nothing stands on it while the computer starts.
      requireBareScreen(image.parentElement, 'the screen over the owner picture');
    }
    return {check:name};
  }  if (name.startsWith('desktop-boot') || name.startsWith('desktop-period-')) {
    const panel = document.querySelector('.desktop-panel');
    const screen = name === 'desktop-boot-inline' ? document.querySelector('[data-card-desktop-screen], [data-card-screen]') : panel.querySelector('.desktop-screen');
    const wallpaper = screen.querySelector('.desktop-wallpaper');
    require(visible(wallpaper), 'the full wallpaper fills the screen');
    require(getComputedStyle(wallpaper).objectPosition === '50% 100%', 'the slimes at the bottom stay in view');
    require(getComputedStyle(wallpaper).opacity === '1' && getComputedStyle(screen.querySelector('.desktop-placeholder')).backgroundColor === 'rgba(0, 0, 0, 0)', 'nothing dims the picture');
    // No status pill, stage, face or progress: a getting-ready computer is the wallpaper alone, and its state stays in data.
    requireBareScreen(screen, 'the booting screen');
    require(!screen.querySelector('.desktop-preparation, .desktop-stage, .desktop-first-build, progress'), 'no preparation markup is written');
    if (name !== 'desktop-boot-inline') {
      require(['starting', 'building', 'preparing'].includes(panel.dataset.desktopState), `the panel keeps the booting state in data (${panel.dataset.desktopState})`);
      require(!visible(panel.querySelector('[data-desktop="enlarge"]')) && !visible(panel.querySelector('.computer-lifecycle-state')), 'a computer that is getting ready is not pressable and not named in the header');
    }
    const box = screen.getBoundingClientRect();
    if (!panel.hasAttribute('data-expanded') && name !== 'desktop-boot-inline') require(Math.abs(box.width / box.height - 1280 / 900) < .02, 'boot retains the running desktop aspect ratio');
    if (name.startsWith('desktop-period-')) require(wallpaper.getAttribute('src') === `/wallpapers/${name.slice('desktop-period-'.length)}.svg`, 'the fixed fixture hour selects its expected period');
    return {check:name};
  }  if(name === "daily-newest") {const reads=window.__look.calls.filter(call=>call.method==='agent.history.list'&&!call.params?.member_id&&call.params?.conversation_id!==undefined);require(reads.length>0&&reads.every(call=>call.params.conversation_id===77),'the newest standard conversation (not the default one, not the quick questions) is the one read');require(document.querySelector('.conversation-caption').hidden,'the header names only the member while a standard conversation is open (R-UI-103)');return {check:name,reads:reads.map(call=>call.params.conversation_id)};}
  if(name === "daily-copy") {const copied={"zh-TW":"已複製",en:"Copied",ja:"コピーしました"}[document.documentElement.lang];const tick=[...document.querySelectorAll('.thread button, .cn-setup-dialog button, .au-routine-dialog button')].find(el=>el.getAttribute('aria-label')===copied);require(tick&&tick.querySelector('svg'),'the pressed copy control displays its tick and copied name');require(tick.scrollWidth<=tick.clientWidth,'copied words fit in the fixed button width');return {check:name};}
  if(name === "daily-footer-hover") {
    // The pointer is on the Connections button: nothing more shows under it, in the list (it says its own words) or on the rail
    // (owner, 2026-11-12; there its tooltip also covered the microphone, Home and the composer's edge).
    const pill=document.querySelector('#nav .sidebar-apps'),tips=[...document.querySelectorAll('[role="tooltip"]')].filter(visible);
    require(pill.matches(':hover'),'the pointer is on the Connections pill');
    const rail=document.documentElement.hasAttribute('data-sidebar-collapsed');
    require(tips.length===0&&!pill.hasAttribute('data-tooltip')&&!pill.hasAttribute('title')&&pill.getAttribute('aria-label'),`nothing shows under the pointer over the Connections button: ${tips.map(tip=>tip.textContent)}`);
    require(rail?!visible(pill.querySelector('.nav-t')):visible(pill.querySelector('.nav-t')),'the list shows its words, the rail its icon alone');
    return {check:name,tips:tips.length};}
  if(name === "daily-marks") {
    // The rail of faces (a window under 860px) has no room for marks: the Connections button is an icon there, with no tooltip, and still the door to the same dialog.
    if(document.documentElement.hasAttribute('data-sidebar-collapsed')){const door=document.querySelector('#nav .sidebar-apps[data-connect-apps]'),box=door.getBoundingClientRect();require(visible(door)&&Math.abs(box.width-36)<1&&Math.abs(box.height-36)<1&&door.getAttribute('aria-label')&&!door.hasAttribute('data-tooltip')&&!visible(door.querySelector('.nav-t'))&&![...door.querySelectorAll('.sidebar-app-marks .mono')].some(visible),'on the rail the Connections door is a 36px icon with no tooltip and no marks');return {check:name,rail:true};}
    require(document.querySelectorAll('.sidebar-app-marks .mono').length===3,'three connected known apps show bare marks');return {check:name};}
  if(name === "daily-draft-member" || name === "daily-draft-room") {const input=document.querySelector(name.endsWith('room')?'#room-message':'.page-agent .mb-chat:not([hidden]) .cmp-input');require(input.value==='Unfinished sample draft','navigation restores this composer words');require(input.selectionStart===input.value.length,'caret returns to the end');return {check:name};}
  if (name === "group-live-line") {
    const row = document.querySelector('.au-room-thinking');
    require(visible(row?.querySelector('.live-action')), 'the working member has a visible action');
    require(row.querySelector('.live-action').textContent === '正在讀取 sample.md', 'tool words beat public progress in a group');
    require(row.querySelector('.av').getBoundingClientRect().width === 28, 'the group shares the 28px live face');
    return {check:name};
  }
  if (name === "message-action-tooltip") {
    // Beside a reply only icons stay in sight (reply, react, ⋯), and the time lives in the thread's dividers (timeline.ts messageActionsHTML, 2026-11-06),
    // so the tip under the pointer names an icon and never repeats a word that is already on screen.
    const control = document.querySelector('.ra .chat-message[data-reply] .message-actions [data-act="reply-message"]');
    const tips = [...document.querySelectorAll('[role="tooltip"]')].filter(visible);
    require(control?.matches(':hover'), "the pointer is on the reply icon");
    require(tips.length === 1 && tips[0].textContent === control.dataset.tooltip && control.dataset.tooltip.length > 0, `one tooltip names the icon: ${tips.map(tip => tip.textContent)}`);
    require(!control.hasAttribute('title') && control.innerText.trim() === '', "the icon shows no word of its own and keeps no native title beside the tip");
    require(!document.querySelector('.ra .chat-message[data-reply] .message-actions time'), "a message's actions hold no time");
    const box = tips[0].getBoundingClientRect(), anchor = control.getBoundingClientRect();
    require(box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 0 && box.bottom <= innerHeight - 8, "the tooltip stays inside the viewport");
    require(box.bottom <= anchor.top + 2 || box.top >= anchor.bottom - 2, "the tooltip does not cover its icon");
    return { check: name, tip: tips[0].textContent };
  }
  if (name.startsWith("presence-") || name.startsWith("transcript-") || name.startsWith("event-routine-") || name.startsWith("event-calendar-") || name === "sidebar-row-time" || name === "sidebar-group-author") {
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
      // A face of the rail is named before its action; the header's face is not in the rail.
      const nameFirst = name !== "presence-hover-action" && document.documentElement.hasAttribute("data-sidebar-collapsed");
      const member = window.__look.data.members.find(member => member.id === 1);
      require(tips.length === 1 && tips[0].textContent === `${nameFirst ? member.name + "\n" : ""}Comparing sample sources`, "one open tooltip follows the public action, with the rail name first");
      const box = tips[0].getBoundingClientRect(), chrome = document.querySelector('.window-chrome').getBoundingClientRect();
      require(box.left >= 8 && box.right <= innerWidth - 8 && box.top >= chrome.bottom + 8 && box.bottom <= innerHeight - 8, "the complete tooltip stays inside the viewport and clear of window controls");
      if (name === "presence-sidebar-hover" && innerWidth < 860) {
        const add = document.querySelector('[data-col="add"]'), control = add.getBoundingClientRect();
        require(control.top >= chrome.bottom && add.contains(document.elementFromPoint(control.x + control.width / 2, control.y + control.height / 2)), "the rail's add button stays below the chrome and receives pointer input");
      }
      if (name === "presence-hover-action") {
        const face = [...document.querySelectorAll('.mb-head .av')].find(visible), control = face.closest('button');
        require(box.top >= face.getBoundingClientRect().bottom + 6, "the header tooltip opens below the avatar");
        require(!document.documentElement.hasAttribute('data-keys') && getComputedStyle(control).outlineStyle === 'none', "pointer hover adds no keyboard focus ring");
        require(getComputedStyle(control).borderColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(control).boxShadow === 'none', "pointer hover adds no ring-like border or shadow");
      }
    }
    // The header's face is a picture since 2026-11-11 (R-SLIME-01): the wait shows on the member's row, the only place it moves.
    if (name === "presence-blocked-stays") {
      require(document.querySelector('.mb-list [data-member="1"] .slime')?.dataset.state === "blocked", "owner waiting remains blocked after refresh");
      require(document.querySelector('.mb-pill-face .slime-surface')?.hasAttribute('data-slime-still'), "the header's face stands still while the member waits");
    }
    if (name === "presence-waiting-colleague") {
      require(document.querySelector('.mb-list [data-member="1"] .slime')?.dataset.state === "waiting", "a colleague wait keeps its own silhouette");
      require(document.querySelector('.mb-pill-face .slime-surface')?.hasAttribute('data-slime-still'), "the header's face stands still while the member waits");
    }
    if (name === "transcript-working") {
      const live = turn.querySelector('.live-presence');
      require(visible(live) && live.querySelector('.av, .avatar').getBoundingClientRect().width === 28, "the live avatar is 28px");
      require(visible(live.querySelector('.live-action')), "the current action is visible beside the avatar");
      require(!turn.querySelector('.think, .work-time, .work-latest'), "no text dots or ticking line");
      require(live.dataset.tooltip === window.__look.data.presenceSample.progress, "public progress is the hover");
    }
    if (name === "transcript-action-long") {
      const line = turn.querySelector('.live-action'), live = line.closest('.live-presence');
      require(visible(line) && getComputedStyle(line).whiteSpace === 'nowrap' && getComputedStyle(line).textOverflow === 'ellipsis', 'one action stays on one line');
      require(live.dataset.tooltip === line.textContent && line.textContent.startsWith('正在搜尋範例'), 'hover keeps the whole action');
      if (innerWidth <= 720) require(line.scrollWidth > line.clientWidth, 'a long line really ellipsizes at 720px');
      require(!turn.querySelector('.work-time, .work-latest, .think'), 'the action has no timer or text dots');
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
    if (name === "event-routine-find") {
      require(turn.querySelector('.event-line mark')?.textContent === window.__look.data.presenceSample.routine, "find marks the public receipt title");
      require(!turn.textContent.includes('"type"') && !turn.textContent.includes('"created"'), "transport metadata stays out of thread selection");
    }
    if (name === "event-routine-find-group") require(turn.querySelector('[data-event-group]')?.open && visible(turn.querySelector('.handoff-detail mark.is-current')), "the selected receipt is visible in the retained open group");
    if (name === "event-calendar-line") require(turn.querySelector('.work-body[hidden] [data-act="open-calendar-event"][data-event="1"][data-date="2026-10-24"]'), "the collapsed calendar receipt keeps its inspection target");
    if (name === "sidebar-row-time") {
      const row = document.querySelector('.side [data-member="1"]');
      require(!row.querySelector('.mb-row-t i') && !row.querySelector('time'), "the name and one line, without a role pill or a time");
      require(!visible(row.parentElement.querySelector('.mb-more')), "no ⋯ shows under the pointer: a right click opens the row's menu");
      const pair = [...document.querySelectorAll('.side .mb-item')].find(item => visible(item) && item.nextElementSibling?.matches('.mb-item') && !item.querySelector('.mb-tile'));
      const rows = pair ? [pair, pair.nextElementSibling].map(item => item.querySelector('.nav.mb-row').getBoundingClientRect()) : [];
      require(rows.length < 2 || (Math.abs(rows[0].height - 54) <= 1 && Math.abs(rows[1].top - rows[0].top - 58) <= 1), `rows are 54 px tall and 58 px apart, Grok Bot's air (${rows.map(box => Math.round(box.top) + '/' + Math.round(box.height)).join(' ')})`);
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
      // No computer button in the header: a still dot beside the name says the computer works.
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
      if (name === 'level-off') {
        const screen = desktop.querySelector('.desktop-screen'), cover = desktop.querySelector('[data-desktop="enlarge"]');
        require(visible(desktop.querySelector('.desktop-wallpaper')) && !desktop.querySelector('iframe'), 'the sleeping screen keeps its wallpaper');
        requireBareScreen(screen, 'the sleeping screen');
        require(!visible(desktop.querySelector('.desktop-caption')) && !visible(desktop.querySelector('.computer-lifecycle-state')), 'neither a caption nor a header word names the sleeping state');
        require(visible(cover) && cover.hasAttribute('data-asleep') && getComputedStyle(cover.querySelector('.desktop-open-pill')).display === 'none', 'the whole screen wakes the computer, with no pill');
        const box = screen.getBoundingClientRect();
        require(Math.abs(box.height - box.width * 900 / 1280) <= 2, 'the sleeping screen keeps the running screen proportions instead of stretching');
      }
    } else if (name === 'level-gear') {
      require(visible(document.querySelector('.ms-pane .ms-face')) && visible(document.querySelector('.ms-pane #ms-name')) && visible(document.querySelector('.ms-pane [data-ms="back"]')), 'identity and Back are on the settings page the gear opens');
      // The page takes the conversation's place and the panel folds away until it is left (R-PANEL-05); this check
      // still asked for the panel beside the page and had failed since the page became one of its own.
      require(!visible(panel) && panel.querySelector('[data-det="gear"]') && !panel.querySelector('[data-tab="routines"], [data-tab="settings"]'), 'the panel folds away while the settings page is open; it keeps its gear and has no settings tab');
    } else if (name === 'level-routine') {
      // A routine opens to read; its switch stays on its row and its member changes the rest (owner, 2026-11-09).
    } else if (name === 'level-strip') {
      const strip = document.querySelector('.window-chrome'), stripStyle = getComputedStyle(strip);
      require(strip.getBoundingClientRect().left === 0 && stripStyle.borderTopLeftRadius === '0px' && stripStyle.backgroundColor === getComputedStyle(panel).backgroundColor, 'the window strip reads as one surface with the bar');
    } else if (name === 'level-takeover' || name === 'level-menu') {
      const frame = desktop.querySelector('iframe'), dock = desktop.querySelector('.desktop-dock');
      require(desktop.hasAttribute('data-expanded') && visible(frame) && visible(dock), 'the same stream fills the window above its one pill');
      require(dock.textContent.includes('你正在控制') && dock.querySelector('[data-desktop="return"]')?.textContent === '停止' && visible(dock.querySelector('[data-desktop="return"]')), 'the pill says the owner is in control and offers Stop, which hands the computer back');
      const box = frame.getBoundingClientRect();
      require(Math.abs(box.width / box.height - 1280 / 900) < 0.03 && (box.width >= innerWidth - 96 || box.height >= innerHeight - 160), 'the screen fills the window at its own proportions');
      require(!document.querySelector('.side, [data-sidebar="open"]')?.checkVisibility({visibilityProperty:true}), 'takeover leaves no sidebar entry above its bar');
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
    const hide = document.querySelector('#app-popover [data-pick="hide"]');
    require(visible(hide) && hide.querySelectorAll('svg').length === 1 && !hide.hasAttribute('aria-haspopup'), "Hide has only its action icon, and no submenu or page behind it");
    const box = hide.getBoundingClientRect();
    require(box.top >= 0 && box.bottom <= innerHeight, `the action under review is inside the screenshot (${box.top}, ${box.bottom}; height ${innerHeight})`);
    return { check: name };
  }
  if (name === "menu-anchor-return") {
    // The ⋯ that a real press went to is the one drawn open; a row's own ⋯ is never drawn, so the press is on a visible one.
    const menu = document.getElementById('app-popover'), anchor = document.querySelector('[data-overflow][aria-expanded="true"]');
    require(visible(menu) && visible(anchor), "the real press on a drawn ⋯ keeps its menu open");
    const box = menu.getBoundingClientRect(), control = anchor.getBoundingClientRect();
    require(Math.abs(box.right - control.right) <= 1 && Math.abs(box.top - control.bottom - 4) <= 1, `a fresh press returns the menu beneath its own control (menu right ${box.right}, top ${box.top}; control right ${control.right}, bottom ${control.bottom})`);
    return { check: name };
  }
  if (name === "menu-settings-redraw") {
    const anchor = document.querySelector('.sel[data-k="retention"]'), menu = document.getElementById('app-popover');
    require(visible(menu) && anchor.getAttribute('aria-expanded') === 'true', "the replacement control keeps its open menu");
    require(menu.querySelector('[data-value="7"][aria-checked="true"]'), "the refreshed choice keeps its check");
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
    // R-UI-73: a child opens on the right and flips left only when the right has no room. The member menu opens beside the 88 px rail, so
    // at the 720 px minimum window a 262 px child fits on the right: the side follows the room, not the width of the window.
    if (name === "submenu-flip") {
      const room = innerWidth - 7 - main.right >= box.width;
      require(room ? box.left >= main.right - 1 : box.right <= main.left + 1, `the child opens ${room ? "right" : "left"} (${Math.round(innerWidth - 7 - main.right)} px of room for ${Math.round(box.width)})`);
    }
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
        // A key shows what it names: a bar chart's is a filled swatch in the bar's own colour, a line's a stroke (2026-11-11).
        if (card.matches('.message-chart')) {
          const bars = card.querySelector('rect.chart-series-0'), swatch = card.querySelector('.chart-key-0');
          if (bars) {
            const mark = getComputedStyle(swatch, '::before'), bar = getComputedStyle(bars);
            require(mark.backgroundColor === bar.fill && parseFloat(mark.height) >= 6 && mark.borderTopStyle !== 'dashed', `a bar chart's key is a swatch of the bar's colour: ${mark.backgroundColor} ${mark.height} ${mark.borderTopStyle} against ${bar.fill}`);
          }
        }
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
    if (name === 'moving-routine-rows') {
      // When it runs, as rows: 重複 one dropdown, the start, the time and only the row its choice needs, every word in sight
      const rows = [...form.querySelectorAll('.au-rows > .au-row')];
      require(rows.length >= 3 && visible(form.querySelector('.au-rows [data-dlg="kind-menu"]')) && !form.querySelector('[data-dlg="kind"]'), "重複 is one dropdown on the first row, never a row of chips");
      const box = form.getBoundingClientRect();
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        require(r.left >= box.left - 1 && r.right <= box.right + 1, "a row stays inside the dialog");
        for (const words of row.querySelectorAll('.au-row-label, .sel > span, .btn, .au-days .btn')) {
          require(words.scrollWidth <= words.clientWidth + 1, `no words are cut: ${words.textContent.trim()}`);
          const w = words.getBoundingClientRect();
          require(w.right <= r.right + 1 && w.left >= r.left - 1, `${words.textContent.trim()} stays in its row`);
        }
      }
      const prompt = form.querySelector('#au-prompt');
      require(prompt.scrollHeight <= prompt.clientHeight + 2, "the instructions show whole, with no scroll inside the box");
      require(!form.querySelector('.is-reserved, .au-repeat-options'), "no empty reserved space");
      return { check: name, rows: rows.length };
    }
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
      if (proof?.total === 210) {
        // The group's ⋯ is not drawn (a right click on the row opens its menu: owner, 2026-11-06), so its header tool row is the search button alone.
        // R-TOP-01 (owner, 2026-11-12): the head keeps the pane's side inset on both sides, and where the pane reaches the window's edge its tool
        // ends 14 px short of the window's buttons; where a side thread stands at the right the tool ends the head at the pane's own edge.
        const room = document.querySelector('.au-room-pane'), head = room.querySelector(':scope > .page-head').getBoundingClientRect(), pane = room.getBoundingClientRect();
        const search = document.querySelector('[data-room-search]'), menu = document.querySelector('[data-room-menu]');
        const box = search.getBoundingClientRect(), heading = room.querySelector('.au-room-heading').getBoundingClientRect();
        const controls = document.querySelector('.window-controls').getBoundingClientRect(), tools = room.querySelector('.page-head .ra-tools'), reserve = parseFloat(getComputedStyle(tools).marginRight);
        require(visible(search) && search.closest('.page-head .ra-tools') && getComputedStyle(menu).display === 'none', 'group search stands alone in the shared header tool row; the menu is the row\'s right click');
        require(Math.abs((head.left - pane.left) - (pane.right - head.right)) <= 1, `the head keeps one inset on both sides (${head.left - pane.left} / ${pane.right - head.right})`);
        if (reserve > 0) require(Math.abs(controls.left - box.right - 14) <= 2, `group search ends 14 px short of the window's buttons (${controls.left - box.right})`);
        else require(Math.abs(box.right - head.right) <= 1, `group search ends the head where a side thread stands at the right (${head.right - box.right} short)`);
        require(Math.abs(box.top + box.height / 2 - (heading.top + heading.height / 2)) <= 2, 'group search shares the heading\'s line');
      }
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
  if (["work-messaging", "work-pairing"].includes(name)) {
    const sections = document.querySelectorAll('.mb-panel-suggest [data-msg-kind]');
    require(sections.length === 3, "all three channels are in Raphael's panel");
    const slackMark = document.querySelector('[data-msg-kind=slack] .msg-name .logo-mono');
    const slackFills = [...(slackMark?.querySelectorAll('svg path') ?? [])].map(path => path.getAttribute('fill')?.toUpperCase());
    require(visible(slackMark) && slackMark.querySelector('svg path')?.getAttribute('d').startsWith('M5.042 15.165')
      && new Set(slackFills).size === 4 && ['#E01E5A', '#36C5F0', '#2EB67D', '#ECB22E'].every(fill => slackFills.includes(fill)),
    'Slack uses its real mark in its four official colours in both themes (R-UI-97)');
    if (name === 'work-messaging') {
      // Set up in the conversation: no token is typed into the panel.
      require(!document.querySelector('.mb-det input[type=password]'), 'no token field in the panel');
      for (const kind of ['slack', 'discord']) require(visible(document.querySelector(`.mb-panel-suggest [data-intent=setup-${kind}]`)), `${kind} not set up is one row with 設定`);
      const asks = window.__look.calls.filter(call => call.command === 'agent_ask_text');
      require(asks.length === 1 && asks[0].intent === 'setup-slack' && asks[0].text.includes('Slack') && !asks[0].memberId, "設定 asks Raphael in his conversation with the setup intent beside the words, once for two presses");
      // While he works on it the button is busy: a spinner and no second press.
      const busy = document.querySelector('.mb-panel-suggest [data-intent=setup-slack]');
      require(busy.disabled && busy.getAttribute('aria-busy') === 'true' && visible(busy.querySelector('.spin')), 'the pressed 設定 is busy with a spinner');
      require(!document.querySelector('.mb-panel-suggest [data-intent=setup-discord]').disabled, 'the other platforms stay pressable');
    }
    if (name === 'work-pairing') {
      require(document.querySelector('[data-msg-kind=slack] [data-code=SL1234]') && document.querySelector('[data-msg-kind=discord] [data-code=DC1234]'), 'pairing codes stay with their own platform');
      require(!window.__look.calls.some(call => String(call.method ?? '').endsWith('.approve')), 'viewing never approves a pairing');
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
    // The @ menu is one list of a fixed height that scrolls (owner, 2026-11-14); every other completion fits without an inner scrollbar.
    const scrolls = menu.classList.contains('menu-scroll');
    if (!scrolls) require(menu.scrollHeight <= menu.clientHeight + 1 && getComputedStyle(menu).overflowY !== 'auto', 'all rows fit without an inner scrollbar');
    const rows = [...menu.querySelectorAll('[data-value]')], values = rows.map(row => row.dataset.value);
    const heads = [...menu.querySelectorAll('.menu-head')].map(head => head.textContent);
    const painted = [...menu.querySelectorAll('button')].filter(row => !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(row).backgroundColor));
    require(painted.length <= 1, 'pointer and keyboard never paint two active rows');
    require(painted.every(row => row.classList.contains('is-active')), 'the painted row is the keyboard selection');
    require(!menu.querySelector('.menu-head[tabindex], .menu-head[role="option"]'), 'headings are not options or focus targets');
    require(document.activeElement === input, 'completion keeps the input focus');
    for (const row of rows) {
      if (!scrolls) require(row.getBoundingClientRect().top >= box.top && row.getBoundingClientRect().bottom <= box.bottom, 'every option is visible');
      require(!row.querySelector('.ck'), 'completion shares the ordinary row without a check column');
      if (row.dataset.value?.startsWith('Notebook')) {
        const tag = row.querySelector('.mtag')?.textContent ?? null;
        const expected = row.dataset.value === 'Notebook 00' ? '需要登入' : row.dataset.value === 'Notebook 01' ? '需要金鑰' : null;
        require(tag === expected, 'services only tag sign-in or key requirements');
      }
    }
    if (name === 'completion-mentions' || name === 'completion-group') {
      // The @ menu is Grok Bot's (owner, 2026-11-13): no headings; the other members, then the apps; what each row is stands quietly at its right.
      require(heads.length === 0, 'the @ menu has no group headings');
      const kinds = rows.map(row => row.querySelector('.mtrail')?.textContent);
      require(kinds.every(kind => kind === '成員' || kind === '應用程式') && kinds.indexOf('應用程式') >= kinds.lastIndexOf('成員'), 'members first, then apps, each saying which it is at the right');
      require(!values.includes('所有人') && window.__look.data.groups.every(group => !values.includes(group.name)), 'no group and no everyone in the @ menu');
      if (name === 'completion-mentions') require(!values.includes(window.__look.data.members[0].name), 'the conversation never offers its own member');
      const services = values.filter(value => value.startsWith('Notebook'));
      require(services.length === 32 && services.slice(0, 5).join('|') === [31,30,29,28,27].map(i=>`Notebook ${i}`).join('|'), 'every service is on the one list, the most recent ready ones first');
      require(new Set(services.slice(-2)).size === 2 && services.slice(-2).every(value => ['Notebook 00', 'Notebook 01'].includes(value)), 'the services that need a sign-in or a key come last');
      require(!menu.querySelector('.menu-action, .menu-sep') && !menu.textContent.includes('顯示全部'), 'there is no show-all row and no page buttons');
      const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--h-menu'));
      require(scrolls && getComputedStyle(menu).overflowY === 'auto' && menu.scrollHeight > menu.clientHeight + 1 && menu.scrollTop === 0, 'the list is longer than its menu and starts at the top');
      require(box.height <= unit * 7.5 + 8 + 2 + 1 && box.height >= unit * 5, `the menu has a fixed maximum height (${box.height}px)`);
      const edge = rows.find(row => row.getBoundingClientRect().bottom > box.bottom - 4);
      require(edge && edge.getBoundingClientRect().top < box.bottom - 4, 'the row cut at the foot says the list goes on');
      if (name === 'completion-group') {
        const data = window.__look.data, allowed = data.rooms.find(room => room.id === 1).member_ids;
        require(data.members.filter(member => !allowed.includes(member.id)).every(member => !values.includes(member.name)) && data.groups.every(group => !values.includes(group.name)), 'group membership limits mentions');
      }
    } else if (name === 'completion-filtered') {
      require(values.length === 8 && heads.length === 0, 'aliases filter the apps with eight results and no heading');
    } else if (name === 'completion-scrolled' || name === 'completion-arrows') {
      // More apps than fit: the wheel (or the arrow keys) takes the one list to its end, where the services that need a sign-in or a key are, with their tags.
      const inside = row => row.getBoundingClientRect().top >= box.top && row.getBoundingClientRect().bottom <= box.bottom + 0.5;
      const last = rows.at(-1), first = rows[0];
      require(heads.length === 0 && input.value === '@' && !menu.querySelector('.menu-action'), 'the menu is still one list of the same words, with no show-all row');
      require(menu.scrollTop > 0 && Math.abs(menu.scrollTop + menu.clientHeight - menu.scrollHeight) <= 1.5, 'the list is at its end');
      require(last.dataset.value === 'Notebook 00' && inside(last) && last.querySelector('.mtag')?.textContent === '需要登入', 'the last app is whole in view with its tag');
      require(rows.slice(-4).some(row => row.querySelector('.mtag')?.textContent === '需要金鑰') && !inside(first), 'the key tag is within reach and the first member has scrolled away');
      if (name === 'completion-arrows') require(last.classList.contains('is-active') && input.getAttribute('aria-activedescendant') === last.id && document.activeElement === input, 'the arrow key carried the highlight to the last row and the focus stayed in the field');
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
      // A known source wears its mark, never the plug of a source nobody drew (owner, 2026-11-11).
      const openrouter = menu.querySelector('[data-source="openrouter"] > .mono');
      require(openrouter && /logo-(art|mono)/.test(openrouter.className) && !openrouter.querySelector('svg.i'), 'OpenRouter has its own mark in the source list');
    } else if (name === 'media-models-codex') {
      const menu = document.querySelector('.model-chooser');
      const marks = {
        'the source list': menu.querySelector('[data-source="codex"] > .mono'),
        'the head of its models': menu.querySelector('.mc-pane-head > .mono'),
        'its row': menu.querySelector('.mc-row[data-model="@codex:gpt-image-2"] .mono'),
      };
      for (const [place, mark] of Object.entries(marks)) {
        require(mark && visible(mark) && /logo-(art|mono)/.test(mark.className), `Codex has a maker's mark in ${place}`);
        require(!mark.querySelector('svg.i'), `${place} draws no plug and no robot for Codex`);
        const box = mark.getBoundingClientRect();
        require(box.width >= 14 && box.height >= 14, `${place} draws the mark at a readable size`);
      }
      const drawings = Object.values(marks).map(mark => mark.innerHTML);
      require(new Set(drawings).size === 1, "all three places draw the same mark");
      const openrouter = menu.querySelector('[data-source="openrouter"] > .mono');
      require(openrouter && openrouter.innerHTML !== drawings[0], "it is OpenAI's mark and not OpenRouter's");
      require(menu.querySelector('.mc-pane-head h3').textContent.trim() === 'Codex', 'the head names Codex');
      // A subscription is not an API priced by the token: its own heading, a head that says it is included, no price on the row.
      const heading = source => source.closest('section').querySelector('h3').textContent.trim();
      require(heading(menu.querySelector('[data-source="codex"]')) !== heading(menu.querySelector('[data-source="openrouter"]')) && heading(menu.querySelector('[data-source="codex"]')) !== 'API', 'Codex stands under a heading of its own, not under API');
      require(!/按量計費|每百萬/.test(menu.querySelector('.mc-pane-head').textContent) && /訂閱/.test(menu.querySelector('.mc-pane-head p').textContent), 'the head says it is included in the subscription');
      const codexRow = menu.querySelector('.mc-row[data-model="@codex:gpt-image-2"]');
      require(!codexRow.querySelector('.mc-price') && !/價格未知/.test(codexRow.textContent), 'the row has no price');
    } else if (name === 'media-models-repair') {
      require(['image-model', 'video-model'].includes(document.activeElement?.dataset.k), 'repair focuses the exact model control');
    }
    require(!window.__look.calls.some(c => c.method === 'settings.set' && ['image_model','video_model'].includes(c.params.key)), 'viewing or repair never chooses a paid model');
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
    if (note?.classList.contains('is-repair')) {
      // The member's reply says what is missing; under it the note is only the repair (R-UI-02, R-UI-120).
      const reply = [...note.closest('.tn').querySelectorAll('.chat-message[data-reply]')].find(visible);
      require(visible(reply) && /模型/.test(reply.textContent) && /費用/.test(reply.textContent), 'the reply names the model to choose and its separate bill');
      require(reply.getBoundingClientRect().bottom <= note.getBoundingClientRect().top + 1 && note.querySelectorAll('button').length === 1, 'one repair comes after the reply');
    } else {
      require(visible(note) && /供應商/.test(note.textContent) && /畫圖|影片/.test(note.textContent), 'the visible notice names the capability and provider');
      require(/尚未選擇.*模型/.test(note.textContent) && /API 費用/.test(note.textContent) && /不會自動/.test(note.textContent), 'the notice explains the explicit choice and separate bill without choosing');
    }
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
  if (name === 'computer-foot-layout') {
    // The owner, 2026-11-13: the failed demonstration's line started at the window's edge over the screen and was cut,
    // its two buttons floated in the far corner and the file changes ran along the top-left. Everything about the
    // computer sits in one foot directly under the screen (or the box that takes its place), inside its span.
    const panel = document.querySelector('.desktop-panel[data-expanded]');
    require(panel, 'the larger view is open');
    const stage = [...panel.querySelectorAll('.desktop-screen, .desktop-review, .desktop-checkpoints')].find(visible);
    require(stage, 'the screen or the box in its place is shown');
    const s = stage.getBoundingClientRect(), round = box => [box.left, box.top, box.right, box.bottom].map(Math.round).join(',');
    require(Math.abs(stage.getBoundingClientRect().width / s.height - 1280 / 900) < 0.02, `${stage.className} keeps the screen's proportions (${round(s)})`);
    require(Math.abs((s.left + s.right) / 2 - innerWidth / 2) <= 2, `${stage.className} is centred in the window (${round(s)})`);
    const items = [...panel.querySelectorAll('.desktop-notes > *, .desktop-dock > *, .desktop-actions')].filter(visible);
    require(items.some(item => item.matches('.desktop-mode')) || panel.hasAttribute('data-files-only'), 'the pill is under the screen');
    for (const item of items) {
      const box = item.getBoundingClientRect(), label = `${item.className || item.dataset.desktop} (${round(box)} under ${round(s)})`;
      require(box.left >= s.left - 1 && box.right <= s.right + 1, `${label} stays inside the screen's width`);
      require(box.top >= s.bottom - 1 && box.bottom <= innerHeight + 1, `${label} sits under the screen, inside the window`);
      require(item.scrollWidth <= item.clientWidth + 1, `${label} is not cut`);
    }
    for (const [index, item] of items.entries()) for (const other of items.slice(index + 1)) {
      const a = item.getBoundingClientRect(), b = other.getBoundingClientRect();
      require(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, `${item.className || item.dataset.desktop} and ${other.className || other.dataset.desktop} do not overlap`);
    }
    if (items.length) require(Math.min(...items.map(item => item.getBoundingClientRect().top)) - s.bottom <= 24, 'the foot follows the screen directly');
    const dock = panel.querySelector('.desktop-dock');
    if (visible(dock)) require(Math.abs((dock.getBoundingClientRect().left + dock.getBoundingClientRect().right) / 2 - (s.left + s.right) / 2) <= 2, `the pill is on the screen's centre line (${round(dock.getBoundingClientRect())} under ${round(s)})`);
    const notes = [...panel.querySelectorAll('.desktop-notes > p')].filter(visible);
    require(notes.every(note => getComputedStyle(note).textAlign === 'center'), 'each line under the screen is centred');
    return {check: name, stage: round(s), items: items.map(item => `${item.className || item.dataset.desktop}:${round(item.getBoundingClientRect())}`)};
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
    } else if (name === 'teach-failed') {
      const notice = panel.querySelector('.desktop-error');
      require(visible(notice) && notice.getAttribute('role') === 'alert' && notice.textContent.startsWith('示範未完成'), 'the failure is said in one line');
      require(panel.querySelector('[data-desktop="teach"]').textContent === '審閱示範' && visible(panel.querySelector('[data-desktop="discard-teach"]')), 'review and discard stay offered');
      require(actions.includes('stop') && !actions.includes('save'), 'a failed draft publishes nothing');
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
      const list = document.querySelector('.mb-rts');
      require(visible(list) && list.textContent.includes('Gmail') && list.textContent.includes('client@example.com') && list.textContent.includes('上次檢查'), 'the panel shows readable trigger rows');
      require(visible(list.querySelector('[data-det="routine-toggle"]')), 'each routine keeps its own switch');
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
    const noteScope = name === 'missing-vision' ? '#svc-dialog .missing-note' : name === 'missing-search' ? '.turn-prerequisites .missing-note' : '.missing-note';
    const note = [...document.querySelectorAll(noteScope)].find(visible);
    if (name === 'missing-provider-repair') {
      require(visible(document.querySelector('#pv-dialog')), 'provider repair opens the existing provider card');
      require(document.activeElement === document.querySelector('#pv-dialog [data-pv="replace"]'), 'provider repair focuses its credential action');
    } else if (name === 'missing-card-repair') {
      require(visible(document.querySelector('#conn-key')), 'the shared card opens the existing Composio key field');
      require(document.querySelector('.cs-key-form .note')?.textContent.includes('專案設定 › API 金鑰'), 'the form says where to obtain the project key before typing it');
    } else if (name.endsWith('-repair')) {
      const field = document.querySelector('#svc-url');
      require(visible(field), 'repair reaches the existing exact field');
      require(document.querySelector('[data-pane="tools"][aria-current="page"]'), 'service repairs open the shared Tools pane');
    } else if (name === 'missing-model-list') {
      require(visible(document.querySelector('[data-dlg="reload"]')), 'the empty account offers a real reload');
      require(document.querySelector('.mc-list').textContent.includes('重新讀取'), 'the reason names reloading in visible words');
    } else if (note?.classList.contains('is-repair')) {
      // Under a reply that says what is missing, the note is only its one repair, after the reply (R-UI-02, R-UI-120).
      const reply = [...note.closest('.tn').querySelectorAll('.chat-message[data-reply]')].find(visible);
      require(visible(reply) && reply.textContent.trim().length > 4, 'the reply says what is missing in visible words');
      require(note.querySelectorAll('button').length === 1 && note.textContent.trim() === '開啟設定', 'under it, only the one repair');
      require(reply.getBoundingClientRect().bottom <= note.getBoundingClientRect().top + 1, 'the repair comes after the reply');
      if (name === 'missing-card') {
        const card = note.closest('.conversation-card');
        require(card && (card.textContent.match(/設定 › 連接 › 商店/g) ?? []).length === 1, 'the card names its existing repair form once, with one action');
      }
    } else {
      require(visible(note) && note.textContent.length > 20, 'the reason is visible text');
      require(!note.querySelector('[title]'), 'no reason depends on a hover title');
      if (name === 'missing-search') require(note.textContent.includes('尚未設定 SearXNG 網址') && note.querySelectorAll('button').length === 1, 'the step says address, not key, with one action');
      if (name === 'missing-card') require(note.textContent.includes('設定 › 連接 › 商店') && note.querySelectorAll('button').length === 1, 'the card names its existing repair form with one action');
      if (name === 'missing-vision') require(document.querySelector('[data-svc="use"]').disabled && note.textContent.includes('回答模型無法讀取圖片'), 'same-as-answer says why it cannot be used');
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
      if (name.endsWith('failed')) {
        require(document.querySelector('.cmp-input').value==='Please review the project note.' && visible(document.querySelector('.composer-failure [data-card-retry]')), 'failure keeps the draft and retry beside the composer');
        const failed=document.querySelector('.composer-failure'), card=failed.querySelector('.conversation-card'), field=document.querySelector('.cmp-field')??document.querySelector('.cmp-input');
        require(failed.querySelectorAll('.card-status.is-failed').length===1 && !failed.querySelector('.card-failure p'), 'the failure is said once, in the status: no sentence repeats it');
        const box=card.getBoundingClientRect(), row=field.getBoundingClientRect();
        require(Math.abs(box.left-row.left)<=8, `the failed card starts where the field starts, never centred between gutters (card ${Math.round(box.left)}, field ${Math.round(row.left)})`);
      }
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
      // A card that hands the computer to the owner is as wide as the conversation (R-PANEL-09); every other is at most 480 px.
      require(box.width <= 480.5 || card.matches('.computer-card:is([data-work-state="waiting_control"], [data-card-state="control"])'), `card width is at most 480px: ${box.width}`);
      const draftHost = card.closest('.draft-panel');
      if (draftHost) require(parseFloat(getComputedStyle(draftHost).borderTopWidth) === 0 && parseFloat(getComputedStyle(draftHost).paddingLeft) === 0, 'the draft host adds no second card frame');
      if (card.matches('[data-owner-question][data-card-state="asked"]')) {
        const close = card.querySelector('[data-owner-answer="cancel"]');
        require(!pill, 'a waiting question uses its title without a redundant status pill');
        require(close?.parentElement?.matches('.card-head') && close === close.parentElement.lastElementChild, 'question close follows the heading at the far right');
        require(Math.abs(close.getBoundingClientRect().right - (box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth))) < 1.5, 'question close aligns with the right padding');
      } else if (card.matches('[data-owner-question][data-card-state="answered"]') && card.querySelector('.question-answer-line')) {
        // An answered question is its title and one row: the check at the row's right says what a pill said.
        require(!pill && !card.querySelector(':scope > .card-head > .card-close'), 'an answered question has no pill and no ×');
      } else if (card.matches('[data-member-template],[data-template-connection][data-connected="false"]')) {
        require(!pill, 'a template and its unconnected requests have no invented status');
      } else {
        require(pill && pill.textContent.trim(), 'status always has a word');
        // A failed card's × closes the head at the right; otherwise the status does. A × in the head
        // is always shown: a page card's hidden one (until 2026-11-10) was taken by the shared failure of a link the page
        // could not open, which was then left with no × to put it away.
        const close = card.querySelector(':scope > .card-head > .card-close');
        if (close) require(visible(close), "a × in the card's head is shown");
        const end = close ?? pill;
        require(Math.abs(end.getBoundingClientRect().right - (box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth))) < 1.5, 'the head ends at the right padding');
        if (end !== pill) require(pill.getBoundingClientRect().right <= end.getBoundingClientRect().left + 1, 'the status stands just before the ×');
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
      if (card.matches('.task-result,[data-owner-question],[data-permission-card],[data-secret-card],[data-connector]')) require(!taskLine || taskLine.hidden || !visible(taskLine), 'the card replaces a duplicate task state line');
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
          // The row stands at the card's right with the primary rightmost (owner, 2026-11-10: 卡片的按鈕盡量放在右側), measured
          // against the card's own right padding, not the row: a row its parent had shrunk to its buttons left a failed
          // page's 再試一次 at the card's left and still passed (2026-11-10).
          // A failed page's empty state (R-PAGE-02, 2026-11-11) centres its 再試一次 with the words that say what failed.
          if (row.matches('.card-actions') && !row.closest('.pg-failed')) {
            const end = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth), right = pri.getBoundingClientRect().right;
            require(Math.abs(right - end) <= 1 && buttons.every(button => button.getBoundingClientRect().right <= right + 0.5), `the card's buttons stand at its right, the primary rightmost (${Math.round(end - right)} px)`);
          }
        }
      }
      // A card's text buttons stand at the field height, and an answer's button as tall as the field beside it (R-UI-17; the
      // judge on 6e2ca315: 送出回答 was 22 px beside a 30 px field). The token is read, so a change of it moves the rule.
      const fieldHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue?.('--h-field')) || 30;
      for (const button of [...card.querySelectorAll('.card-actions .btn:not(.icon),.question-submit .btn:not(.icon)')].filter(visible))
        require(button.getBoundingClientRect().height >= fieldHeight - 0.5, `a card's text button stands at the field height: ${button.textContent.trim()} is ${button.getBoundingClientRect().height} px against ${fieldHeight}`);
      for (const row of [...card.querySelectorAll('.question-submit')].filter(visible)) {
        const field = row.querySelector('input,textarea'), button = row.querySelector('button');
        if (!field || !button || !visible(button)) continue;
        const a = field.getBoundingClientRect(), b = button.getBoundingClientRect();
        // One line: the field and its button are one height with one centre. Longer, the button stays at the foot of the field.
        if (a.height <= parseFloat(getComputedStyle(document.documentElement).getPropertyValue?.('--h-field') || 30) + 1) require(Math.abs(a.height - b.height) <= 2 && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 2, `the answer field and its button share one height and centre: ${a.height} px at ${Math.round(a.top)} against ${b.height} px at ${Math.round(b.top)}`);
        else require(Math.abs(a.bottom - b.bottom) <= 8, `a longer answer keeps its button at the foot of the field`);
      }
      require(card.scrollWidth <= card.clientWidth + 1, 'card never scrolls sideways');
    }
    return {check:name,cards:cards.length};
  }
  if (name.startsWith("question-card-")) {
    // The question card in its new shape (owner, 2026-11-11): rows with hairlines, a letter badge, grey lines, the own-answer row, and the one collapsed row.
    const card = document.querySelector('[data-owner-question="owner-choice"]'), calls = window.__look.calls.filter(call => call.method === "owner_questions.answer");
    require(visible(card) && card.classList.contains("permission-card"), "the shared question card is visible");
    const box = card.getBoundingClientRect(), column = card.parentElement.getBoundingClientRect();
    require(box.width <= 480.5 && box.left >= column.left - 1 && box.right <= column.right + 1, "the card fits its column and is at most 480 px wide");
    const rows = [...card.querySelectorAll('.question-choice')].filter(visible), line = card.querySelector('.question-answer-line');
    const composer = [...document.querySelectorAll('.cmp-input')].find(visible);
    const waitingWords = "輸入你的回答，或聊點別的";
    const requireRows = () => {
      require(rows.length >= 1, "the card has rows");
      rows.forEach((row, index) => {
        const badge = row.querySelector('[data-choice-letter]'), words = row.querySelector('.question-words');
        require(badge && words && badge.getBoundingClientRect().right <= words.getBoundingClientRect().left, `row ${index} has its badge before its words`);
        require(row.scrollWidth <= row.clientWidth + 1 && row.getBoundingClientRect().height >= 36, `row ${index} is not clipped and is at least 36 px tall`);
        require(Math.abs(badge.getBoundingClientRect().left - rows[0].querySelector('[data-choice-letter]').getBoundingClientRect().left) < 1, "every badge stands in one column");
      });
      const inside = [...card.querySelectorAll('.question-choices > *')].filter(visible);
      inside.slice(0, -1).forEach(node => require(parseFloat(getComputedStyle(node).borderBottomWidth) >= 1, "a hairline stands between the rows"));
    };
    const requireCollapsed = words => {
      require(!card.querySelector('.card-status') && !card.querySelector('[data-owner-option],[data-owner-skip],[data-owner-answer],textarea,[data-card-disclosure]'), "the answered card keeps its title and one row only");
      require(card.dataset.cardState === "answered" && card.querySelectorAll('.question-answer-line').length === 1, "one collapsed row under the title");
      const text = line.querySelector('.question-answer-text'), mark = line.querySelector('svg'), lb = line.getBoundingClientRect(), tb = text.getBoundingClientRect(), mb = mark.getBoundingClientRect();
      if (words) require(text.textContent === words, `the row says ${words}: ${text.textContent}`);
      require(visible(mark) && mb.left >= tb.right - 1 && lb.right - mb.right <= 16 && lb.right - mb.right >= 8, `the check stands at the right of the row (${Math.round(lb.right - mb.right)} px from its edge)`);
      require(getComputedStyle(text).color !== getComputedStyle(card.querySelector('.card-title')).color, "the answer is in the quiet colour, the title in the strong one");
      const well = line.parentElement.getBoundingClientRect();
      require((lb.height >= 34 && lb.height <= 46) || line.getAttribute('aria-expanded') === 'true', `the collapsed row is one line tall (${lb.height})`);
      require(well.bottom <= box.bottom - 10 && well.left >= box.left + 10, "the row sits inside the card's padding");
    };
    const asked = () => card.dataset.cardState === "asked";
    if (name === "question-card-described") {
      require(asked(), "the card waits");
      require(card.querySelector('.card-body').textContent === "選最重要的一個。", "the grey line stands under the title");
      const notes = [...card.querySelectorAll('.question-note')].filter(visible);
      require(notes.length === 2 && notes.every(note => note.getBoundingClientRect().top > note.parentElement.firstElementChild.getBoundingClientRect().bottom - 2), "two rows carry a second grey line under their words");
      const wordsSize = getComputedStyle(rows[1].querySelector('.question-words > span')).fontSize, noteSize = getComputedStyle(notes[0]).fontSize;
      require(parseFloat(noteSize) < parseFloat(wordsSize), `the grey line is smaller than the words (${noteSize} against ${wordsSize})`);
      require(getComputedStyle(notes[0]).color !== getComputedStyle(rows[1].querySelector('.question-words > span')).color, "the grey line is in the quiet colour");
      requireRows();
      require([...card.querySelectorAll('[data-choice-letter]')].map(node => node.textContent).join('') === "ABCDE" && card.querySelector('[data-owner-skip]').textContent.includes("略過"), "the skip row is lettered after the four options");
      require(visible(card.querySelector('textarea')) && !visible(card.querySelector('[data-owner-answer="text"]')), "the own-answer row shows its field and no pill yet");
    } else if (name === "question-card-skipped") {
      requireCollapsed("已略過");
      require(calls.length === 1 && calls[0].params.skip === true && !('answer' in calls[0].params), "a skip is sent as a skip, not as words or a cancel");
    } else if (name.startsWith("question-card-multiple-") || name.startsWith("question-card-room-")) {
      const state = name.split('-').pop();
      if (state === "answered") {
        requireCollapsed("星期一、星期三");
        require(calls.length === 1 && JSON.stringify(calls[0].params.answer) === JSON.stringify(["星期一", "星期三"]), "the chosen labels are sent once, as a list");
      } else {
        require(asked() && card.dataset.ownerMultiple === "true", "a several-choice card waits");
        require(card.querySelector('.card-body').textContent === "可複選", "the grey line says it takes several");
        requireRows();
        const submit = card.querySelector('[data-owner-answer="choices"]');
        require(visible(submit) && getComputedStyle(submit).backgroundColor === 'rgb(255, 255, 255)', "the submit is the white primary");
        const end = box.right - parseFloat(getComputedStyle(card).paddingRight) - parseFloat(getComputedStyle(card).borderRightWidth);
        require(Math.abs(submit.getBoundingClientRect().right - end) <= 1, "the submit stands at the card's right");
        require(!card.querySelector('[data-owner-answer="text"]') && calls.length === 0, "nothing is sent while rows are marked");
        const chosen = [...card.querySelectorAll('[aria-checked="true"]')];
        if (state === "chosen") {
          require(chosen.length === 2 && !submit.disabled, "two rows are marked and the submit is enabled");
          chosen.forEach(row => { const badge = row.querySelector('[data-choice-letter]'); require(visible(badge.querySelector('svg')) && !visible(badge.querySelector('span')), "a chosen row shows a check in its badge, not its letter"); });
          require(getComputedStyle(chosen[0].querySelector('[data-choice-letter]')).backgroundColor !== getComputedStyle(rows[1].querySelector('[data-choice-letter]')).backgroundColor, "a chosen badge differs from an unchosen one");
        } else require(chosen.length === 0 && submit.disabled, "no row is marked and the submit waits");
      }
      if (name.startsWith("question-card-room-")) require(card.closest('.au-room-pane'), "the same card stands in the room");
      if (name === "question-card-room-asked") require(composer.placeholder === waitingWords, `the room's composer says ${waitingWords}: ${composer.placeholder}`);
    } else if (name === "question-card-long-typed") {
      const field = card.querySelector('textarea'), pill = card.querySelector('[data-owner-answer="text"]'), lh = parseFloat(getComputedStyle(field).lineHeight);
      const fb = field.getBoundingClientRect(), pb = pill.getBoundingClientRect();
      require(visible(pill) && !pill.disabled, "the pill appears once something is typed");
      require(field.clientHeight >= lh * 2.5 && field.clientHeight <= lh * 3 + 12, `the field grew to three lines (${field.clientHeight} px for ${lh} px lines)`);
      require(field.scrollHeight <= field.clientHeight + 2, "three lines show whole, with no inner scroll");
      require(fb.right <= pb.left && Math.abs(pb.bottom - fb.bottom) <= 8, "the pill stands at the right of the field, at its foot");
      const end = box.right - parseFloat(getComputedStyle(card).paddingRight) - parseFloat(getComputedStyle(card).borderRightWidth);
      require(pb.right <= end + 0.5 && end - pb.right <= 10, "the pill ends at the row's right padding");
      require(calls.length === 0, "typing sends nothing");
    } else if (name === "question-card-long-answered" || name === "question-card-long-open") {
      requireCollapsed();
      const text = line.querySelector('.question-answer-text');
      if (name === "question-card-long-answered") {
        require(line.getAttribute('aria-expanded') === "false" && text.scrollWidth > text.clientWidth + 1 && getComputedStyle(text).textOverflow === "ellipsis" && getComputedStyle(text).whiteSpace === "nowrap", "a long answer is one line ending in an ellipsis");
      } else {
        require(line.getAttribute('aria-expanded') === "true" && text.scrollWidth <= text.clientWidth + 1 && text.getBoundingClientRect().height > parseFloat(getComputedStyle(text).lineHeight) * 1.5, "pressed, the whole words show");
      }
      require(calls.length === 1 && typeof calls[0].params.answer === "string" && calls[0].params.answer.length > 40, "the whole typed words were sent");
    } else if (name === "question-card-composer-waiting") {
      require(asked() && composer.placeholder === waitingWords, `the composer says ${waitingWords}: ${composer.placeholder}`);
    } else if (name === "question-card-composer-after") {
      require(card.dataset.cardState === "answered" && composer.placeholder && composer.placeholder !== waitingWords, `the composer returns to its usual words: ${composer.placeholder}`);
    } else if (name === "question-card-closed") {
      const sent = window.__look.calls.filter(call => call.command === "agent_ask_text");
      require(card.dataset.cardState === "cancelled" && card.querySelector('.card-status')?.textContent.trim() === "未回答", "the card shows closed, not answered");
      require(!card.querySelector('.question-answer-line,[data-owner-option],textarea') && calls.length === 0, "a closed card has no row, no controls and was never answered");
      require(sent.length === 1 && sent[0].text === "先看看今天的行事曆", "the words went as an ordinary message");
      require(document.querySelector('.page-agent .thread').textContent.includes("好，先不處理這個問題。"), "the member answered the message");
      require(composer.placeholder && composer.placeholder !== waitingWords, "the composer returned to its usual words");
    }
    return { check: name, state: card.dataset.cardState };
  }
  if (name.startsWith("owner-question-")) {
    const card = document.querySelector('[data-owner-question="owner-choice"]');
    require(visible(card) && card.classList.contains("permission-card"), "the shared card is visible");
    const waiting = ["owner-question-asked", "owner-question-typed", "owner-question-background", "owner-question-room"].includes(name);
    require(card.dataset.cardState === (waiting ? "asked" : name === "owner-question-cancelled" ? "cancelled" : "answered"), "the persisted state is shown");
    if (name === "owner-question-cancelled") require(card.querySelector('.card-status.is-ready') && !card.querySelector('[data-card-disclosure]'), 'a cancelled question has a neutral decision and no redundant disclosure');
    if (!waiting && name !== "owner-question-cancelled") require(card.querySelector('.question-answer-line') && !card.querySelector('.card-status'), 'an answered question is its title and one row, with no pill');
    const asked = card.querySelector(".card-title");
    require(getComputedStyle(asked).whiteSpace !== "nowrap" && asked.scrollWidth <= asked.clientWidth + 1, "the whole question shows, wrapped, never cut to one line");
    require(card.querySelectorAll("[data-owner-option]").length === (waiting ? 4 : 0), "choices are real buttons only while waiting");
    require(!card.querySelector("select"), "a short list needs no dropdown");
    const box = card.getBoundingClientRect(), column = card.parentElement.getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "the question fits its reply column");
    for (const control of [...card.querySelectorAll("button,input,textarea")].filter(visible)) {
      const bounds = control.getBoundingClientRect();
      require(bounds.left >= box.left && bounds.right <= box.right + 1 && bounds.bottom <= box.bottom + 1, "every answer control fits the card");
    }
    const field = card.querySelector("[data-owner-answer-input]");
    if (field) {
      require(field.classList.contains("mb-fin") && field.tagName === "TEXTAREA" && field.rows === 1, "the answer uses the shared form field, one line to start with");
      require(field.scrollHeight <= field.clientHeight + 2, "the answer field has no inner scroll");
      const submit = card.querySelector('[data-owner-answer="text"]');
      // The pill appears at the right of the own-answer row once something is typed (Grok Bot's card, 2026-11-11).
      require(visible(submit) === !!field.value.trim(), 'the answer primary shows once something is typed, and not before');
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
  if (name === "local-command-setting-gone") {
    // Owner, 2026-11-14: only a quick question reaches this PC, so Settings has no control for local commands, in any words.
    const pane = document.querySelector('.modal-scrim');
    require(visible(pane.querySelector('[data-pane][aria-current="page"]')), 'Safety is open');
    require(!pane.querySelector('[data-k="local-commands"]'), 'there is no local commands control');
    require(!/本機指令|Local commands|Ask every time|每次詢問/.test(pane.textContent), `no word of it is left in Safety: ${pane.textContent.slice(0, 120)}`);
    const last = [...pane.querySelectorAll('.sgroup')].at(-1);
    require(visible(last) && last.querySelectorAll('.slist > *').length >= 1, 'the computer section still has its row (the apps always allowed, or the note that there are none)');
    return {check:name};
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
    require(!card.querySelector('[data-act="local-settings"], [data-act="manage-local"]'), 'the card has no way into a setting: there is none to manage (owner, 2026-11-14)');
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
    // A section of 一般, on a rounded card: the card holds the inner padding of its rows.
    const edge=card.getBoundingClientRect();
    require(parseFloat(getComputedStyle(card).borderTopLeftRadius)>=12&&getComputedStyle(card).backgroundColor!=='rgba(0, 0, 0, 0)',"appearance is a rounded card");
    for(const row of card.querySelectorAll('.row')){
      const label=row.querySelector('.lbl').getBoundingClientRect(), picker=row.querySelector('.sel').getBoundingClientRect();
      require(label.left-edge.left>=12&&edge.right-picker.right>=4,"settings rows keep the card's inner padding");
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
      require(visible(dialog?.querySelector('.diagram-view svg')) && dialog.querySelector('.mb-dlg-head [data-dlg="close"]'), "expanded diagram uses the shared accessible dialog");
      require(!dialog.querySelector('.mb-dlg-act'), "its × closes it, with no 「關閉」 at its foot");
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
    // The sidebar holds no page buttons (the account menu is the way to dictation, the calendar and the settings): the open conversation is the
    // one selected row, and away from the conversation page none is.
    const rows = [...document.querySelectorAll('#nav .nav[aria-current="true"]')];
    const chat = !document.querySelector('.page-agent').hidden;
    require(rows.length === (chat ? 1 : 0), `only the open conversation is selected (none away from it), found ${rows.length}`);
    if (chat) require(rows[0].matches('[data-member], [data-room]'), "chat selects only its conversation");
    return chat ? rows[0].getAttribute('data-member') ?? rows[0].getAttribute('data-room') : null;
  };
  // Records the sidebar's geometry (no judgement): width, row pitch, the highlight's box, type sizes, the foot and how many rows fit.
  if (name === "sidebar-metrics") {
    const nav = document.getElementById("nav"), scroll = nav.querySelector(".mb-scroll"), foot = nav.querySelector(".side-foot"), top = nav.querySelector(".mb-top");
    const around = nav.getBoundingClientRect(), box = element => { const r = element.getBoundingClientRect(); return { left: Math.round((r.left - around.left) * 10) / 10, top: Math.round(r.top * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 }; };
    const rows = [...nav.querySelectorAll(".mb-row:not(.mb-tile)")].filter(visible);
    const items = rows.map(row => row.closest(".mb-item, .au-room-row"));
    const pitches = items.slice(1).map((item, index) => Math.round((item.getBoundingClientRect().top - items[index].getBoundingClientRect().top) * 10) / 10);
    const first = rows[0], nameEl = first?.querySelector("b"), preview = first?.querySelector(".mb-row-p");
    const area = scroll.getBoundingClientRect(), fitting = rows.filter(row => { const r = row.getBoundingClientRect(); return r.top >= area.top - 1 && r.bottom <= area.bottom + 1; }).length;
    const label = nav.querySelector(".mb-ghead .mb-gname");
    const gap = label && label.closest(".mb-sec").previousElementSibling;
    return { check: name, width: Math.round(around.width * 10) / 10, rail: document.documentElement.hasAttribute("data-sidebar-collapsed"),
      row: first && box(first), pitch: pitches.slice(0, 6), face: first && box(first.querySelector(".av, .room-avatar")), nameSize: nameEl && getComputedStyle(nameEl).fontSize, nameLine: nameEl && getComputedStyle(nameEl).lineHeight,
      previewSize: preview && getComputedStyle(preview).fontSize, previewLine: preview && getComputedStyle(preview).lineHeight, nameBox: nameEl && box(nameEl), previewBox: preview && box(preview),
      foot: foot && box(foot), top: top && box(top), list: box(scroll), rowsFitting: fitting, rowsTotal: rows.length,
      label: label && { box: box(label), size: getComputedStyle(label).fontSize, head: box(label.closest(".mb-ghead")), section: box(label.closest(".mb-sec")), gapAbove: gap ? Math.round((label.closest(".mb-sec").getBoundingClientRect().top - gap.getBoundingClientRect().bottom) * 10) / 10 : null },
      main: box(document.getElementById("main")), controls: [...nav.querySelectorAll(".mb-top > *, .side-foot .btn, .side-foot .nav, .side-foot .sidebar-foot-row > *")].filter(visible).map(el => ({ c: el.className.split(" ").slice(0, 3).join("."), ...box(el) })) };
  }
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
    const compact = matchMedia("(max-width: 859px)").matches;
    require(document.querySelectorAll(".mb-col").length === 1 && column, "one global conversation list");
    if (!compact && !document.documentElement.hasAttribute('data-sidebar-collapsed')) {
      // The window's top-left corner, above the sidebar's list, moves the window like the caption;
      // its search and add buttons still press.
      const corner = document.elementFromPoint(12, 12), gap = document.elementFromPoint(40, 24);
      require(corner?.closest('[data-window-drag]') && gap?.closest('[data-window-drag]') && !gap.closest('button'), "the top-left corner moves the window");
      const search = nav.querySelector('[data-col="search"]'), s = search.getBoundingClientRect();
      require(document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2)?.closest('[data-col="search"]'), "the corner's buttons still press");
    }
    require(!document.querySelector('[data-go="team"], .team-page, [data-col="collapse"], .nav-apps, [data-go="automations"]'), "retired navigation and icon rails are absent");
    const header=nav.querySelector('.mb-top');
    const rail=document.documentElement.hasAttribute('data-sidebar-collapsed');
    require(!nav.querySelector('.brand, .app-icon, [data-sidebar="collapse"]')&&nav.querySelector('.sidebar-foot-row > .sidebar-account'),'no brand and no fold button (the edge drags); the owner\'s face stands in the foot');
    if(!compact){const edge=nav.querySelector(':scope > .side-edge'),box=edge?.getBoundingClientRect(),side=nav.getBoundingClientRect();require(edge&&edge.getAttribute('role')==='separator'&&getComputedStyle(edge).cursor==='col-resize'&&Math.abs(box.right-side.right)<1&&box.width<=8&&getComputedStyle(edge,'::after').content==='none','the list has a draggable edge at its right, with no handle drawn');}
    const pair=[...nav.querySelectorAll('[data-col]')];
    require(pair.map(button=>button.dataset.col).join()==='search,add'&&!column.querySelector('input'),'search then plus, with no field standing in the list');
    // The rail has no search (owner, 2026-11-12 23:25): only the plus stands in its foot.
    if(rail)require(!visible(pair[0])&&visible(pair[1])&&pair[1].closest('.side-foot'),'the rail shows the plus alone, and no search');
    for(const button of pair.filter(visible)){const box=button.getBoundingClientRect(),style=getComputedStyle(button);require(Math.abs(box.width-36)<1&&Math.abs(box.height-36)<1&&parseFloat(style.borderRadius)>=18&&style.backgroundColor!=='rgba(0, 0, 0, 0)'&&style.borderTopColor==='rgba(0, 0, 0, 0)','search and plus are 36px soft round buttons with no frame');}
    if(!rail&&pair.every(visible))require(pair.every(button=>button.parentElement===header)&&Math.abs(pair[0].getBoundingClientRect().top-pair[1].getBoundingClientRect().top)<1&&pair[1].getBoundingClientRect().right>pair[0].getBoundingClientRect().right,'search and plus stand side by side in the top row');
    // The foot is one row: the owner's face (the account menu) and the Connect apps pill (its own dialog, R-UI-111); no page button anywhere (R-SIDE-01).
    require(nav.querySelector('.sidebar-foot-row > .sidebar-apps[data-connect-apps]')&&nav.querySelector('.sidebar-foot-row > .sidebar-account[aria-haspopup="menu"]')&&!nav.querySelector('[data-go]'),'the foot is the face (it opens the account menu) and the Connect apps pill, and the sidebar holds no page buttons');
    for(const button of nav.querySelectorAll('.btn.icon:not([data-col]), .side-foot .nav:not(.sidebar-account)'))if(visible(button)&&!visible(button.querySelector('.nav-t'))){const box=button.getBoundingClientRect(),corner=parseFloat(getComputedStyle(button).borderRadius);require(corner>0&&corner<Math.min(box.width,box.height)/2,`sidebar buttons are rounded squares, never circles (${button.className})`);}
    require(nav.querySelector('.sidebar-account .owner-face')&&nav.querySelector('.sidebar-account').getAttribute('aria-label'),'account has its own face and accessible name');
    require(!nav.querySelector('.sidebar-account > svg.i')&&visible(nav.querySelector('.sidebar-account .owner-face'))&&!nav.querySelector('.sidebar-account-name')&&nav.querySelector('.sidebar-account').textContent.trim()==='','the account is its face alone, without a gear or a name beside it');
    require(!nav.querySelector('.au-rooms-section .mb-ghead, [data-room-new], .mb-sec[data-group="none"] .mb-ghead'),'only owner-created sections have headings');
    require(getComputedStyle(nav.querySelector('.side-foot')).borderTopWidth==='0px','footer has no separator');
    // The list is always on screen: a rail of faces under 860 px (no menu button, drawer or scrim), else 348 px wide as Grok Bot's
    // (less on a window under 952 px, so that the conversation keeps 604 px), or the width it was dragged to.
    require(!document.querySelector('.sidebar-toggle, .sidebar-close, .sidebar-scrim, [data-sidebar="open"]'), "there is no menu button, drawer or scrim");
    const dragged = Number(localStorage.getItem('raphael.sidebar.width')) || 0;
    const listWidth = rail ? 88 : dragged ? Math.min(dragged, Math.max(240, innerWidth - 604)) : Math.min(348, innerWidth - 604);
    require(Math.abs(nav.getBoundingClientRect().width - listWidth) < 1 && Math.abs(main.getBoundingClientRect().left - listWidth) < 1, `the list keeps its width: ${nav.getBoundingClientRect().width} not ${listWidth}`);
    if (compact) require(rail && !nav.inert && !main.inert, "a narrow window shows the rail of faces, and nothing is inert");
    const chief = column.querySelector('.mb-chief');
    require(chief && chief.querySelector('b') && chief.querySelector('.av'), "the top member shows its face and name");
    if(chief)require(!document.querySelector('.mb-star'),'no member carries a star');
    if(chief&&!rail&&!chief.matches('.mb-tile'))require(Math.abs(chief.querySelector('.av').getBoundingClientRect().width-40)<1&&chief.querySelector('.mb-row-main'),'an unpinned top member is an ordinary row');
    for(const row of column.querySelectorAll('.mb-row')){
      const time=row.querySelector('time');
      if(time&&!row.parentElement.matches(':hover, :focus-within'))require(getComputedStyle(time).opacity!=='0','row time stands beside the name until hover or focus swaps it for the overflow');
    }
    return { check:name, compact, folders:column.querySelectorAll('.mb-sec').length };
  }
  // ---- The sidebar's foot and the account menu (owner, 2026-11-12 evening, R-SIDE-01): the face and the Connections pill on one row, as Grok Bot's ----
  const footBox = el => el.getBoundingClientRect();
  const footNear = (a, b, message) => require(Math.abs(a - b) <= 1, `${message}: ${Math.round(a * 10) / 10} not ${Math.round(b * 10) / 10}`);
  const footRail = () => document.documentElement.hasAttribute('data-sidebar-collapsed');
  if(name==='foot-rest'){
    // The foot at rest, both shapes: the list's one row (measured by sidebar-air) or the rail's column; the app opens on a conversation, so no Home
    // and no page button of the foot's remain.
    const nav=document.getElementById('nav'),account=nav.querySelector('.sidebar-account'),pill=nav.querySelector('.sidebar-apps');
    require(!document.querySelector('.page-home, .ho-hero, .sidebar-home, .sidebar-dictation, #nav [data-go]'),'Home, the house and the microphone are gone from the foot and the page');
    require(account.tagName==='BUTTON'&&account.getAttribute('aria-label')&&account.getAttribute('aria-haspopup')==='menu'&&account.getAttribute('aria-expanded')==='false'&&visible(account.querySelector('.owner-face')),"the face is a real button named by the owner, opening a menu");
    require(!document.querySelector('#app-popover'),'no menu stands open at rest');
    if(footRail()){
      footNear(footBox(account).width,36,'the rail\'s face is 36px');footNear(footBox(pill).width,36,'the rail\'s apps icon is 36px');
      require(visible(pill.querySelector('.sidebar-apps-icon .i'))&&!visible(pill.querySelector('.nav-t'))&&!visible(pill.querySelector('.sidebar-app-marks')),'the rail\'s apps button is an icon alone');
      require(pill.getAttribute('aria-label')&&!pill.hasAttribute('title')&&!pill.hasAttribute('data-tooltip'),'its name is accessible only, with no tooltip echo');
      require(footBox(pill).bottom<=footBox(account).top,'the apps icon stands above the face');
    } else checkRendered('sidebar-air',context);
    return {check:name,rail:footRail(),face:Math.round(footBox(account).width),pill:[Math.round(footBox(pill).width),Math.round(footBox(pill).height)]};
  }
  if(name==='foot-account-menu'){
    const nav=document.getElementById('nav'),account=nav.querySelector('.sidebar-account'),menu=document.getElementById('app-popover');
    require(menu&&menu.classList.contains('account-menu')&&menu.getAttribute('role')==='menu'&&visible(menu),'the account menu is open');
    require(account.getAttribute('aria-expanded')==='true'&&account.getAttribute('aria-controls')==='app-popover','the face says it holds the menu open');
    const rows=[...menu.querySelectorAll('button[role="menuitem"]')],m=footBox(menu),a=footBox(account);
    require(rows.length===4&&rows.map(row=>row.dataset.account.replace('usage-settings','usage')).join()==='usage,dictation,calendar,settings','four rows: 用量, 聽寫, 行事曆, 設定');
    const icons=rows.map(row=>row.querySelector('.ck svg')?.innerHTML??'');
    require(icons.every(Boolean)&&new Set(icons).size===4,'a Lucide icon on every row, and no two rows share one');
    const sep=[...menu.querySelectorAll('.menu-sep')];
    require(sep.length===1&&sep[0].previousElementSibling===rows[2]&&sep[0].nextElementSibling===rows[3]&&footBox(sep[0]).height<=1.5,'one hairline, between 行事曆 and 設定');
    require(rows.every(row=>visible(row)&&row.querySelector('.mt').scrollWidth<=row.querySelector('.mt').clientWidth+1&&!row.hasAttribute('title')),'every row\'s words show whole, with no tooltip');
    require(m.left>=0&&m.right<=innerWidth&&m.top>=0&&m.bottom<=innerHeight,'the menu lies inside the window');
    if(footRail()){
      const bar=nav.getBoundingClientRect();
      require(m.left>=bar.right+4&&m.left<=bar.right+16&&Math.abs(m.bottom-a.bottom)<=2,`on the rail the menu opens beside the whole rail (left ${Math.round(m.left)}, rail ends ${Math.round(bar.right)}), ending where the face ends`);
      require(![...nav.querySelectorAll('[data-col], .sidebar-apps')].some(el=>{const r=footBox(el);return r.width>0&&r.left<m.right&&r.right>m.left&&r.top<m.bottom&&r.bottom>m.top;}),'on the rail the menu covers no button of it');
    } else {
      footNear(m.left,a.left,'the menu\'s left edge is the face\'s');
      require(m.bottom<=a.top-2&&m.bottom>=a.top-8,'the menu opens above the face');
    }
    const usage=rows[0],chevron=usage.querySelector(':scope > svg.i');
    require(!usage.querySelector('.account-used')&&!/\d\s*%/.test(usage.textContent),'用量 has no number: one provider\'s figure under the bare word would read as everyone\'s');
    require(!!chevron===usage.hasAttribute('aria-haspopup'),'用量 has its chevron when it has a submenu, and neither otherwise');
    if(chevron)require(visible(chevron)&&footBox(chevron).right<=m.right-4&&footBox(chevron).right>=m.right-16,'the chevron ends the row');
    require(rows.slice(1).every(row=>!row.hasAttribute('aria-haspopup')&&!row.querySelector(':scope > svg.i')),'the other rows are plain');
    const tokens=(()=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--menu)';document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;})();
    require(getComputedStyle(menu).backgroundColor===tokens,'the menu wears the app\'s menu token');
    require(menu.contains(document.activeElement)||!!document.getElementById('app-submenu')?.contains(document.activeElement),'the focus is in the menu or its submenu');
    return {check:name,rail:footRail(),chevron:!!chevron,menu:[Math.round(m.left),Math.round(m.top),Math.round(m.width),Math.round(m.height)]};
  }
  if(name==='foot-usage-submenu'||name==='foot-usage-owner'){
    const menu=document.getElementById('app-popover'),sub=document.getElementById('app-submenu');
    require(menu&&sub&&visible(sub)&&sub.classList.contains('account-usage'),'the usage submenu is open beside the menu');
    const row=menu.querySelector('[data-account="usage"]'),r=footBox(row),s=footBox(sub),m=footBox(menu);
    require(row.getAttribute('aria-expanded')==='true','the row says its submenu is open');
    require(s.left>=m.right-2&&s.left<=m.right+12||s.right<=m.left+2,'the submenu stands at the menu\'s edge');
    require(s.top<=r.bottom&&s.bottom>=r.top,'and level with its row');
    // One block for every provider the owner uses, in a stable order: the subscriptions as the reading gives them, the ChatGPT sign-in, then OpenRouter (the mock core's data, read here).
    // A provider whose usage cannot be read keeps its block and says so; none shows a number that was not read.
    const data=window.__look.data,key=data.status.openrouter;
    const expected=[...data.allowances.brains.map(brain=>brain.id),...(data.chatgpt?.signed_in&&data.chatgpt.plan_scope_granted!==false?['chatgpt']:[]),...(key.state!=='no_key'&&key.state!=='unknown'?['openrouter']:[])];
    const blocks=[...sub.querySelectorAll('.account-window')],manage=sub.querySelector('[data-account="manage"]');
    require(expected.length>=2&&blocks.length===expected.length,`a block for each of the ${expected.length} providers (${expected.join(', ')}), not only the tightest (${blocks.length})`);
    require(blocks.map(block=>block.dataset.provider).join()===expected.join(),`in the stable order ${expected.join(', ')}: ${blocks.map(block=>block.dataset.provider).join(', ')}`);
    const words={claude:'Claude',codex:'Codex',gemini:'Antigravity',chatgpt:'ChatGPT',openrouter:'OpenRouter'};
    blocks.forEach((block,at)=>{
      const name1=block.querySelector('.account-window-name'),used=block.querySelector('.account-window-used'),reset=block.querySelector('.account-window-reset'),r1=footBox(block),state=block.dataset.state;
      require(name1.textContent.trim().split(' ')[0]===words[block.dataset.provider],`block ${at} names its own provider: ${name1.textContent}`);
      require(visible(name1)&&visible(used)&&used.textContent.trim().length>0,`block ${at}: its name and the words at its right: ${block.textContent}`);
      if(state==='percent')require(/\d+\s*%/.test(used.textContent)&&reset&&/\d/.test(reset.textContent)&&visible(reset),`block ${at}: a window with its number and when it resets: ${block.textContent}`);
      if(state==='reset')require(!/\d/.test(used.textContent)&&!reset,`block ${at}: a window that has reset keeps no stale number and no reset line: ${block.textContent}`);
      if(state==='unreadable')require(!/\d/.test(used.textContent)&&!reset,`block ${at}: a provider that cannot be read shows no number: ${block.textContent}`);
      if(state==='spend')require(/\d/.test(used.textContent)&&!/%/.test(used.textContent),`block ${at}: OpenRouter's own spend, not a percentage: ${block.textContent}`);
      require(footBox(used).right>=r1.right-16&&footBox(used).left>footBox(name1).left,`block ${at}: the words stand at the right of the name`);
      require(name1.scrollWidth<=name1.clientWidth+1&&used.scrollWidth<=used.clientWidth+1&&footBox(used).right<=s.right,`block ${at}: its words show whole inside the submenu`);
      if(at)require(r1.top>=footBox(blocks[at-1]).bottom-1,`block ${at} stands under the one before it`);
    });
    if(name==='foot-usage-owner'){
      // The owner's own mix, 2026-11-14: Codex live, Claude whose reported window has reset, the ChatGPT sign-in, OpenRouter.
      require(blocks.map(block=>`${block.dataset.provider}:${block.dataset.state}`).join()==='codex:percent,claude:reset,chatgpt:unreadable,openrouter:spend',`the four providers say what each knows: ${blocks.map(block=>`${block.dataset.provider}:${block.dataset.state}`).join()}`);
      require(/65\s*%/.test(blocks[0].textContent),`Codex reads 65% used: ${blocks[0].textContent}`);
    }
    require(visible(manage)&&manage.textContent.trim().length>0&&sub.querySelectorAll('.menu-sep').length===1&&sub.querySelector('.menu-sep').nextElementSibling===manage&&footBox(blocks.at(-1)).bottom<=footBox(sub.querySelector('.menu-sep')).top+1,'a hairline after the last block, then 管理用量');
    require(s.left>=0&&s.right<=innerWidth&&s.bottom<=innerHeight&&s.top>=0,'the submenu lies inside the window');
    return {check:name,sub:[Math.round(s.left),Math.round(s.top),Math.round(s.width),Math.round(s.height)],words:sub.textContent};
  }
  if(name==='foot-usage-none'){
    const menu=document.getElementById('app-popover'),row=menu.querySelector('[data-account="usage-settings"]');
    require(row&&!row.hasAttribute('aria-haspopup')&&!row.querySelector('.account-used')&&!row.querySelector(':scope > svg.i'),'with no window known 用量 has no number, no chevron and no submenu');
    require(!document.getElementById('app-submenu'),'and opens none');
    return {check:name};
  }
  if(name==='foot-pill-hover'){
    // The pointer is on the pill: its marks fan out like a hand of cards (Grok Bot's measured values, named on the pill): the outer ones move 3px
    // away from the middle one and turn 8deg outward, the middle one lifts 1.5px, all grow to 1.1; transform only, the fill may change.
    const pill=document.querySelector('#nav .sidebar-apps');
    require(pill.matches(':hover'),'the pointer is on the pill');
    const style=getComputedStyle(pill),value=key=>style.getPropertyValue(key).trim();
    const spread=parseFloat(value('--marks-spread')),lift=parseFloat(value('--marks-lift')),scale=parseFloat(value('--marks-scale')),turn=parseFloat(value('--marks-turn'));
    require(spread===3&&lift===1.5&&scale===1.1&&turn===8&&value('--marks-time-in')==='180ms'&&value('--marks-ease-in')==='ease-out'&&value('--marks-time-out')==='280ms'&&value('--marks-ease-out')==='ease-in-out','the hover\'s values are named custom properties on the pill (3px, 1.5px, 1.1, 8deg, 180ms ease-out in, 280ms ease-in-out out)');
    const marks=[...pill.querySelectorAll('.sidebar-app-mark:not([hidden])')];
    if(footRail()){require(marks.every(mark=>!visible(mark)),'the rail has no marks to move');return {check:name,rail:true};}
    require(marks.length>=2,'two or more marks show');
    const moved=marks.map(mark=>{const m=new DOMMatrixReadOnly(getComputedStyle(mark).transform);return {x:m.e,y:m.f,scale:Math.hypot(m.a,m.b),turn:Math.atan2(m.b,m.a)*180/Math.PI};});
    marks.forEach((mark,at)=>{
      const place=at-(marks.length-1)/2,shift=place*spread,up=lift*(1-Math.abs(place)),angle=place*turn;
      require(Math.abs(moved[at].x-shift)<0.2&&Math.abs(moved[at].y+up)<0.2&&Math.abs(moved[at].scale-scale)<0.01&&Math.abs(moved[at].turn-angle)<0.3,`mark ${at} moves ${shift}px, lifts ${up}px, turns ${angle}deg and grows to ${scale}: ${JSON.stringify(moved[at])}`);
      require(getComputedStyle(mark).transitionProperty==='transform'&&getComputedStyle(mark).transitionDuration==='0.18s'&&getComputedStyle(mark).transitionTimingFunction==='ease-out','only the transform moves, in 180ms ease-out');
    });
    require(marks.length%2===0||Math.abs(moved[(marks.length-1)/2].x)<0.2&&Math.abs(moved[(marks.length-1)/2].turn)<0.3,'the middle mark only lifts');
    // The tiles have fanned apart: a thin gap opens between neighbours (Grok Bot's, about 1px).
    const boxes=marks.map(mark=>mark.getBoundingClientRect());
    require(boxes.slice(1).every((r,i)=>r.left-boxes[i].right>=-0.5&&Math.abs(r.left-boxes[i].right)<=4),'the tiles fan out from the strip with thin gaps, not overlapping');
    return {check:name,moved};
  }
  if(name==='foot-pill-reduced'){
    const pill=document.querySelector('#nav .sidebar-apps');
    require(matchMedia('(prefers-reduced-motion: reduce)').matches,'the window asks for reduced motion');
    require(pill.matches(':hover')||footRail(),'the pointer is on the pill');
    require([...pill.querySelectorAll('.sidebar-app-mark')].every(mark=>getComputedStyle(mark).transform==='none'&&getComputedStyle(mark).transitionDuration==='0s'),'no mark moves under the pointer when motion is reduced');
    return {check:name};
  }
  if(name==='foot-pill-still'){
    // Away from the pill every mark is in its place.
    const pill=document.querySelector('#nav .sidebar-apps');
    require(!pill.matches(':hover'),'the pointer is away from the pill');
    require([...pill.querySelectorAll('.sidebar-app-mark')].every(mark=>getComputedStyle(mark).transform==='none'),'every mark stands in its place away from the pill');
    return {check:name};
  }
  if(name.startsWith('foot-account-focus-')){
    // Keyboard: the focus stands on the row (by its place in the menu), or on 管理用量 in the submenu.
    const want=name.slice('foot-account-focus-'.length),menu=document.getElementById('app-popover'),rows=[...menu.querySelectorAll('button[role="menuitem"]')];
    if(want==='manage')require(document.activeElement===document.querySelector('#app-submenu [data-account="manage"]'),'the focus is on 管理用量 in the submenu');
    else require(document.activeElement===rows[Number(want)],`the focus is on row ${want}: ${document.activeElement?.className} ${document.activeElement?.textContent}`);
    return {check:name};
  }
  if(name==='foot-account-keys'){
    // Escape closed the menu and gave the focus back to the face that opened it.
    const account=document.querySelector('#nav .sidebar-account');
    require(!document.getElementById('app-popover')&&!document.getElementById('app-submenu'),'Escape closed the menu');
    require(document.activeElement===account&&account.getAttribute('aria-expanded')==='false','the focus is back on the face, which says the menu is closed');
    return {check:name};
  }
  if(name==='foot-account-outside'){
    require(!document.getElementById('app-popover')&&!document.getElementById('app-submenu'),'a press outside closed the menu and its submenu');
    require(document.querySelector('#nav .sidebar-account').getAttribute('aria-expanded')==='false','the face says it is closed');
    return {check:name};
  }
  if(name==='sidebar-tile'){
    const tile=document.querySelector('#nav .mb-pinned .mb-tile');
    require(tile,'a pinned member is a tile');
    const box=tile.getBoundingClientRect(),face=tile.querySelector(':scope > .av').getBoundingClientRect(),label=tile.querySelector(':scope > b').getBoundingClientRect();
    // On the rail of faces a pinned member is a face like the others, on its own 54px square.
    if(document.documentElement.hasAttribute('data-sidebar-collapsed')){require(Math.abs(face.width-36)<1&&Math.abs(box.width-54)<1&&Math.abs(face.left+face.width/2-(box.left+box.width/2))<1,'on the rail a pinned member is a 36px face centred on its 54px square');return {check:name,face:face.width};}
    require(face.width>=64&&Math.abs(face.left+face.width/2-(box.left+box.width/2))<1,'the tile has a larger centered face');
    require(label.top>=face.bottom&&Math.abs(label.left+label.width/2-(box.left+box.width/2))<1,'the name is centered below the face');
    return {check:name,face:face.width};
  }
  if(name==='chat-setup-cards'){
    const bot=document.querySelector('[data-secret-card="card-slack"]'),pair=document.querySelector('[data-pairing-card="pair-1"]'),tpl=document.querySelector('[data-template-card-id="tpl-1"]');
    require(visible(bot)&&bot.querySelector('input[type=password][data-secret-input]')&&bot.querySelector('[data-act="bot-link"][data-platform="slack"]'),"the bot card has where to make the bot and one masked field");
    require(!bot.innerHTML.includes('xoxb')&&!bot.querySelector('input')?.value,"no token in the markup");
    require(pair&&pair.querySelector('.code')?.textContent==='SL7Q2K'&&pair.querySelector('[data-act="pairing-allow"]')&&pair.querySelector('[data-act="pairing-deny"]'),"the pairing card shows its code with Allow and Deny");
    require(tpl&&tpl.querySelector('[data-act="template-view"]')&&tpl.querySelector('[data-act="template-save"]')&&tpl.querySelector('[data-act="template-publish"]')&&tpl.textContent.includes('Gmail'),"the template card says what it brings and can be viewed, saved or published");
    return {check:name};
  }
  if(name==='voice-flyer-emblem'){
    const flyer=document.querySelector('.ra-flyer'),canvas=flyer?.querySelector('canvas.ra-flyer-emblem');
    require(visible(flyer)&&canvas&&!flyer.querySelector('img'),"the voice flyer draws the emblem live on a canvas, not a picture of it");
    const a=flyer.getBoundingClientRect(),b=canvas.getBoundingClientRect();
    require(Math.abs((a.left+a.right)/2-(b.left+b.right)/2)<=1&&Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<=1,"the emblem is centred in the flyer");
    return {check:name,canvas:Math.round(b.width)};
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
    require(document.documentElement.hasAttribute('data-sidebar-collapsed')&&Math.abs(nav.getBoundingClientRect().width-88)<1,'the list is an 88px rail of faces');
    require(!compact||!visible(nav.querySelector('.side-edge')),'a narrow window has no edge to drag');
    require(!visible(nav.querySelector('.sidebar-apps .nav-t'))&&!visible(nav.querySelector('.sidebar-app-marks')),'the rail shows no names, words or marks');
    const faces=[...nav.querySelectorAll('.mb-row > .av, .mb-row > .room-avatar')].filter(visible);
    require(faces.length>0&&faces.every(face=>{const box=face.getBoundingClientRect();return Math.abs(box.left+box.width/2-44)<1&&Math.abs(box.width-36)<1;}),'every face is 36px and centered in the rail');
    require([...nav.querySelectorAll('.mb-item .btn.mb-more, .au-room-row .btn.au-room-more')].every(button=>getComputedStyle(button).display==='none'),'the rail draws no ⋯ over a face; a right click opens its menu');
    require(!visible(nav.querySelector('[data-col="search"]'))&&!nav.querySelector('.side-foot [data-col="search"]'),'the rail has no search button');
    const add=nav.querySelector('.side-foot [data-col="add"]').getBoundingClientRect(),apps=nav.querySelector('.sidebar-apps').getBoundingClientRect(),owner=nav.querySelector('.sidebar-account').getBoundingClientRect();
    require(add.bottom<=apps.top&&apps.bottom<=owner.top,'the plus, then the apps icon, then the owner, in a column in the rail');
    return {check:name,faces:faces.length};
  }
  // The rail of faces and the full list as Grok Bot's (owner, 2026-11-12): measured, at every width.
  if(name==='sidebar-air'){
    const nav=document.getElementById('nav'),scroll=nav.querySelector('.mb-scroll'),narrow=matchMedia('(max-width: 859px)').matches;
    const box=el=>el.getBoundingClientRect(),near=(a,b,message)=>require(Math.abs(a-b)<=1,message+`: ${Math.round(a*10)/10} not ${b}`);
    const rows=[...nav.querySelectorAll('.mb-row:not(.mb-tile)')].filter(visible);
    require(rows.length>=4,'the list shows its rows');
    const items=rows.map(row=>row.closest('.mb-item, .au-room-row'));
    const pairs=items.map((item,i)=>[item,items[i+1]]).filter(([a,b])=>b&&a.parentElement===b.parentElement);
    if(narrow){
      // A rail of faces: no words at all, the face 36px on a 54px square, the open one lit, the list scrolls, the foot in a column.
      require(document.documentElement.hasAttribute('data-sidebar-collapsed')&&document.documentElement.hasAttribute('data-sidebar-narrow'),'a narrow window is the rail');
      near(box(nav).width,88,'the rail is 88px wide');
      require(!document.querySelector('.sidebar-toggle')&&!nav.inert,'no menu button hides it');
      for(const row of rows){
        require([...row.querySelectorAll('b, .mb-row-p, .mb-row-t, .mb-row-main')].every(part=>part.getBoundingClientRect().width<=1),'a face carries no name or preview');
        near(box(row).width,54,'a face stands on a 54px square');near(box(row).height,54,'a face stands on a 54px square');
        const face=row.querySelector(':scope > .av, :scope > .room-avatar');near(box(face).width,36,'the face is 36px');
        near(box(face).left+18,box(nav).left+44,'the face is centred in the rail');
      }
      const open=rows.filter(row=>row.getAttribute('aria-current')==='true');
      require(open.length===1&&getComputedStyle(open[0]).backgroundColor!=='rgba(0, 0, 0, 0)'&&parseFloat(getComputedStyle(open[0]).borderTopLeftRadius)>=8,'the open conversation stands on a lit rounded square');
      require(rows.every(row=>row===open[0]||getComputedStyle(row).backgroundColor==='rgba(0, 0, 0, 0)'||row.matches(':hover')),'only the open one is lit');
      for(const dot of nav.querySelectorAll('.mb-row .mb-dot')){
        if(!visible(dot))continue;
        const row=dot.closest('.mb-row'),face=row.querySelector(':scope > .av, :scope > .room-avatar'),d=box(dot),f=box(face);
        require(d.left>=f.right-d.width-4&&d.top<=f.top+d.height&&d.right<=box(row).right,"the unread dot sits on the face's corner");
      }
      require(nav.scrollWidth<=nav.clientWidth+1&&scroll.scrollWidth<=scroll.clientWidth+1,'the rail has no horizontal overflow');
      require(['auto','scroll'].includes(getComputedStyle(scroll).overflowY),'the list scrolls when it is long');
      const pitch=pairs.map(([a,b])=>box(b).top-box(a).top);
      require(pitch.length>0&&pitch.every(d=>Math.abs(d-58)<=1),`faces are 58px apart: ${pitch}`);
      const foot=nav.querySelector('.side-foot'),parts=['[data-col="add"]','.sidebar-apps','.sidebar-account'].map(sel=>foot.querySelector(sel));
      require(parts.every(visible)&&!foot.querySelector('[data-col="search"]'),"the plus, the Connections icon and the account's face are all in the rail's foot, and there is no search");
      require(parts.every(el=>box(el).left>=box(nav).left&&box(el).right<=box(nav).right),'the foot fits the rail');
      require(box(parts[0]).top<box(parts[1]).top&&box(parts[1]).top<box(parts[2]).top,'the foot is a column: the plus, then the apps, then the account');
      require(!visible(foot.querySelector('.nav-t'))&&visible(foot.querySelector('.sidebar-apps-icon .i'))&&parts[1].getAttribute('aria-label')&&!parts[1].hasAttribute('title')&&!parts[1].hasAttribute('data-tooltip'),'the foot has icons only, and the apps icon is named without a tooltip');
      require(box(foot).bottom<=innerHeight&&box(scroll).height>=3*58,`the faces keep room above the foot: ${box(scroll).height}`);
      return {check:name,narrow:true,faces:rows.length,foot:Math.round(box(foot).height)};
    }
    // The full list: 54px highlights 58px apart, 12px in from the list's edges, the name 14px over a 13px line.
    const first=rows[0],n=box(nav);
    near(box(first).height,54,'a highlight is 54px tall');
    near(box(first).left-n.left,12,"a highlight is 12px in from the list's left edge");
    near(n.right-box(first).right,12,"a highlight is 12px in from the list's right edge");
    require(parseFloat(getComputedStyle(first).borderTopLeftRadius)===12,"a highlight has Grok Bot's 12px corners");
    require(pairs.length>0&&pairs.every(([a,b])=>Math.abs(box(b).top-box(a).top-58)<=1),`rows are 58px apart: ${pairs.map(([a,b])=>box(b).top-box(a).top)}`);
    const name14=first.querySelector('b'),line13=first.querySelector('.mb-row-p');
    require(getComputedStyle(name14).fontSize==='14px'&&getComputedStyle(line13).fontSize==='13px','the name is 14px and its line 13px');
    const face=first.querySelector(':scope > .av, :scope > .room-avatar');
    near(box(face).top+box(face).height/2,box(first).top+box(first).height/2,'the face is centred on the taller row');
    const label=nav.querySelector('.mb-ghead .mb-gname');
    if(label){
      require(getComputedStyle(label).fontSize==='13px',"a folder's label is 13px");
      const section=label.closest('.mb-sec'),prev=section.previousElementSibling,centre=box(label).top+box(label).height/2;
      if(prev)near(centre-box(prev).bottom,26,'a label stands 26px under the row above it');
      near(box(section.querySelector('.mb-row')).top-centre,18,'a label stands 18px over its first row');
    }
    // The foot is one row at every width of the list (owner, 2026-11-12 evening, R-SIDE-01, as Grok Bot's): the face 32px, then the pill 36px tall and
    // fully round on --surface-2 taking the rest of the row, its words whole on one line. The pill says its own words, so it has no tooltip.
    const foot=nav.querySelector('.side-foot'),account=foot.querySelector('.sidebar-account'),pill=foot.querySelector('.sidebar-apps'),words=pill.querySelector('.nav-t');
    const middle=el=>box(el).top+box(el).height/2,fill=getComputedStyle(pill).backgroundColor,surface=(()=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--surface-2)';document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;})();
    near(box(account).width,32,"the face is 32px");near(box(account).height,32,"the face is 32px");
    near(box(pill).height,36,'the pill is 36px tall');
    require(parseFloat(getComputedStyle(pill).borderTopLeftRadius)>=18&&getComputedStyle(pill).borderTopWidth==='0px'&&fill===surface,`the pill is fully round, unframed, on --surface-2 (${fill} / ${surface})`);
    require(Math.abs(box(account).left-n.left-12)<=1&&Math.abs(box(pill).left-box(account).right-8)<=1&&Math.abs(n.right-12-box(pill).right)<=1,'the face, 8px, then the pill to the foot\'s right edge, 12px in from the list');
    near(middle(account),middle(pill),"the face and the pill share one row, centred on each other");
    require(foot.querySelectorAll('.sidebar-foot-row').length===1&&[...foot.querySelectorAll('.sidebar-foot-row > *')].length===2,'the row holds only the face and the pill');
    require(visible(words)&&words.scrollWidth<=words.clientWidth+1&&box(words).height<parseFloat(getComputedStyle(words).lineHeight)*1.5,"the pill's words stand whole on one line, never cut");
    const tiles=[...pill.querySelectorAll('.sidebar-app-mark:not([hidden])')].filter(visible);
    for(const mark of tiles)require(box(mark).right<=box(pill).right-12+1&&box(mark).left>=box(words).right,'a mark that shows lies whole inside the pill, after its words');
    // The words and the marks are one group, centred in the pill, the marks right after the words; the words are not bold.
    const group=[box(words).left,tiles.length?box(tiles[tiles.length-1]).right:box(words).right];
    require(Math.abs((group[0]-box(pill).left)-(box(pill).right-group[1]))<=Math.max(8,tiles.length?4:12),`the words and the marks are centred together in the pill (${Math.round(group[0]-box(pill).left)} left, ${Math.round(box(pill).right-group[1])} right)`);
    require(parseInt(getComputedStyle(words).fontWeight)<=500,'the words are regular or medium, not bold');
    if(tiles.length){
      const white=(()=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--photo-mark)';document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;})();
      require(tiles.every(tile=>getComputedStyle(tile).backgroundColor===white&&Math.abs(box(tile).height-16)<=1&&parseFloat(getComputedStyle(tile).borderTopLeftRadius)>=3),'each mark sits on its own white tile, 16px tall with rounded corners, in both themes');
      require(tiles.slice(1).every((tile,i)=>Math.abs(box(tile).left-box(tiles[i]).right)<=0.5),'at rest the tiles touch edge to edge, one strip');
    }
    require(!pill.hasAttribute('data-tooltip')&&!pill.hasAttribute('title'),'nothing shows under the pointer over the pill');
    return {check:name,narrow:false,rows:rows.length,pitch:pairs.slice(0,3).map(([a,b])=>box(b).top-box(a).top),foot:Math.round(box(foot).height),width:Math.round(n.width)};
  }
  // A dragged row (sidebar-drag-row): dimmed in its place, with one line over the row it will land before.
  if(name==='sidebar-drag-line'){
    const line=document.querySelector('.mb-drop-line'),dragged=document.querySelector('#nav .is-dragged'),target=document.querySelector('#nav [data-member-item="4"]');
    require(line&&!line.hidden&&visible(line)&&dragged&&target,'a dragged row is dimmed and its landing line shows');
    const l=line.getBoundingClientRect(),t=target.getBoundingClientRect(),nav=document.getElementById('nav').getBoundingClientRect();
    require(Math.abs(l.top+l.height/2-t.top)<=1.5&&l.left>=nav.left&&l.right<=nav.right&&l.width>200,`the line stands over the row it lands before: ${l.top} ${t.top}`);
    require(getComputedStyle(dragged).opacity==='0.4'&&Math.abs(dragged.getBoundingClientRect().height-54)<=1,'the dragged row is dimmed and keeps its 54px');
    return {check:name,line:Math.round(l.top)};
  }
  // The rail's + opens the sidebar's own menu.
  if(name==='sidebar-add-menu'){
    const add=document.querySelector('#nav [data-col="add"]'),menu=document.querySelector('#app-popover');
    require(visible(add)&&add.getAttribute('aria-expanded')==='true'&&visible(menu)&&menu.querySelector('[data-pick="member"]')&&menu.querySelector('[data-pick="group"]')&&menu.querySelector('[data-pick="group-chat"]'),'the + opens the same menu');
    const m=menu.getBoundingClientRect();
    require(m.left>=0&&m.right<=innerWidth&&m.top>=0&&m.bottom<=innerHeight,'the menu stays inside the window');
    return {check:name,left:Math.round(m.left)};
  }
  // Every way the member search opens (the button, Ctrl+Shift+F, the palette, the rail) puts the same card in the middle of the window, and typing never moves it.
  if(name==='search-card-middle'||name==='sidebar-search-typed'){
    const card=document.querySelector('#app-popover.side-search'),input=card?.querySelector('.side-search-input');
    require(visible(card)&&document.activeElement===input,'the card is open with the keys in its field');
    const box=card.getBoundingClientRect();
    const chrome=document.getElementById('window-chrome')?.getBoundingClientRect().bottom??0;
    require(Math.abs(box.left+box.width/2-innerWidth/2)<=2&&box.width<=560&&box.left>=12&&box.right<=innerWidth-12,`the card stands in the middle of the window, across (${Math.round(box.left)}..${Math.round(box.right)} of ${innerWidth})`);
    require(box.top>=chrome+8-0.5&&box.bottom<=innerHeight-8+0.5&&(Math.abs(box.top+box.height/2-innerHeight/2)<=2||box.top<=chrome+8.5||box.bottom>=innerHeight-8.5),`the card stands in the middle of the window, down, and inside it (${Math.round(box.top)}..${Math.round(box.bottom)} of ${innerHeight})`);
    if(name==='sidebar-search-typed'){
      const before=window.__sidebarSearchBox;
      require(!before||['left','top','width','height'].every(side=>Math.abs(box[side]-before[side])<=0.5),'typing in the field never moves or resizes the card (a window under 860px has no button to take a first reading from; it is centred again after typing)');
      require(card.querySelectorAll('.side-search-rows > .side-search-row').length>=1&&visible(card.querySelector('.side-search-new')),'the words found a member and 新增成員 stays at the foot');
    }
    return {check:name,box:{x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width),height:Math.round(box.height)},viewport:[innerWidth,innerHeight]};
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
    // The member search is a card in the middle of the window over a dimmed page.
    const card=document.querySelector('#app-popover.side-search'),input=card?.querySelector('.side-search-input');
    require(visible(card)&&document.activeElement===input,'search opens its card with the keys in its field');
    const box=card.getBoundingClientRect();
    const chrome=document.getElementById('window-chrome')?.getBoundingClientRect().bottom??0;
    require(Math.abs(box.left+box.width/2-innerWidth/2)<=2&&box.width<=560&&box.left>=12&&box.right<=innerWidth-12,`the card stands in the middle of the window, across (${Math.round(box.left)}..${Math.round(box.right)} of ${innerWidth})`);
    require(box.top>=chrome+8-0.5&&box.bottom<=innerHeight-8+0.5&&(Math.abs(box.top+box.height/2-innerHeight/2)<=2||box.top<=chrome+8.5||box.bottom>=innerHeight-8.5),`the card stands in the middle of the window, down, and inside it (${Math.round(box.top)}..${Math.round(box.bottom)} of ${innerHeight})`);
    window.__sidebarSearchBox=box.toJSON();
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
    // The member list is dragged by its edge between a rail and about 400 px.
    if (matchMedia('(max-width: 859px)').matches) return {check:name,compact:true};
    const nav = document.querySelector('#nav'), width = nav.getBoundingClientRect().width, stored = Number(localStorage.getItem('raphael.sidebar.width'));
    require(!document.documentElement.hasAttribute('data-sidebar-collapsed') && width >= 240 && width <= 400, "the list is open, between 240 and 400 px");
    require(Math.abs(width - stored) <= 1 && Math.abs(width - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'))) <= 1, "the width the edge was let go at is the list's, and is kept");
    require(width > 348, "the list is wider than its default");
    const main = document.querySelector('#main').getBoundingClientRect();
    require(Math.abs(main.left - width) <= 2, "the conversation starts where the list ends");
    require(!document.querySelector('[data-sidebar="collapse"]') && visible(nav.querySelector('.mb-top [data-col="search"]')), "no fold button, and search stands at the top of the wider list");
    return {check:name, width:Math.round(width)};
  }
  // The details panel dragged as wide as it goes beside the conversation: the panel gives way, so the conversation keeps its 386px
  // (what it had beside the old 296px list and a 440px panel at 1120px) and the composer keeps all its controls (R-UI-110).
  if (name === "panel-widest") {
    const nav = document.getElementById('nav').getBoundingClientRect(), panel = document.querySelector('.page-agent .mb-det').getBoundingClientRect();
    const pane = document.querySelector('.page-agent .mb-chat').getBoundingClientRect(), composer = document.querySelector('.page-agent .composer')?.getBoundingClientRect();
    const widths = { sidebar: Math.round(nav.width), pane: Math.round(pane.width), composer: composer && Math.round(composer.width), panel: Math.round(panel.width) };
    if (innerWidth >= 1120) {
      require(pane.width >= 385.5, `the conversation keeps 386px: ${JSON.stringify(widths)}`);
      require(panel.width >= 299.5 && panel.width <= 720, `the panel keeps its own range: ${JSON.stringify(widths)}`);
      require(Math.abs(nav.width - Math.min(348, innerWidth - 604)) < 1, `the list gave way last, not first: ${JSON.stringify(widths)}`);
    }
    return { check: name, ...widths };
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
  if (name === "reading-place-before" || name === "reading-place-kept") {
    // The details panel dragged wider rewraps the conversation without moving what is read.
    const scroller = [...document.querySelectorAll('.page-agent .ra-scroll')].find(visible);
    const top = scroller.getBoundingClientRect().top, items = [...scroller.querySelectorAll('.thread > li')];
    if (name === "reading-place-before") {
      require(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 40, "the view is in the middle of the conversation");
      const item = items.find(li => li.getBoundingClientRect().bottom > top);
      window.__readingPlace = { index: items.indexOf(item), offset: item.getBoundingClientRect().top - top, width: scroller.clientWidth };
      return { check: name };
    }
    const was = window.__readingPlace, panel = document.querySelector('.page-agent .mb-det:not([hidden])');
    if (panel && getComputedStyle(panel).position !== 'absolute') require(scroller.clientWidth < was.width - 50, `the conversation got narrower: ${was.width} -> ${scroller.clientWidth}`);
    const offset = items[was.index].getBoundingClientRect().top - top;
    require(Math.abs(offset - was.offset) <= 2, `the message at the top stays where it was: ${Math.round(was.offset)} -> ${Math.round(offset)}`);
    return { check: name, moved: Math.round(offset - was.offset) };
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
      // Held open for the picture: its real-time window (1.5 s) ended before the 1920 capture (2026-11-11).
      import('/src/shared/cancel-gesture.ts').then(({ cancelGesture }) => clearTimeout(cancelGesture().timer));
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
  if (name === "link-chips") {
    // As inline source chips: each link once, in the words, with no row of cards under the reply.
    const reply = [...document.querySelectorAll('.thread .chat-message[data-reply]')].filter(visible).at(-1);
    const chips = [...reply.querySelectorAll('a.link-chip')];
    require(chips.length === 2 && !document.querySelector('.preview-card, .preview-cards'), `two link chips and no cards: ${chips.length}`);
    const line = parseFloat(getComputedStyle(reply.querySelector('.message-text')).lineHeight) || 26;
    for (const chip of chips) {
      const mark = chip.querySelector('.link-mark svg, .link-mark img'), box = chip.getBoundingClientRect(), icon = mark?.getBoundingClientRect();
      require(visible(mark) && Math.round(icon.width) === 16, "each chip leads with the site's mark at 16 px");
      require(box.height <= line * 1.25, `a chip sits on the line of the words (${box.height} of ${line})`);
      require(getComputedStyle(chip).color === getComputedStyle(document.documentElement).getPropertyValue('--link').trim() || getComputedStyle(chip).color !== getComputedStyle(reply.querySelector('.message-text')).color, "a chip is in the link colour");
    }
    require(chips[0].querySelector('.link-name').textContent === "127.0.0.1:5173", `an address of this machine says itself once: ${chips[0].textContent}`);
    require(chips[1].dataset.linkState === "ready" && !chips[1].querySelector('.link-name').textContent.includes("http"), `a bare public address says the page's title once read: ${chips[1].textContent}`);
    return { check: name, names: chips.map(chip => chip.textContent) };
  }
  if (name === "link-hover") {
    const chip = document.querySelector('.thread .chat-message[data-reply] a.link-chip[data-link-title]'), card = document.querySelector('.link-hover');
    require(visible(card) && card.getAttribute('role') === 'tooltip' && card.querySelector('.preview-title').textContent.trim(), "the page's preview shows under the pointer");
    const c = card.getBoundingClientRect(), k = chip.getBoundingClientRect();
    require(c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, "the preview stays in the window");
    require(c.top >= k.bottom || c.bottom <= k.top, "the preview stands beside its chip, covering none of it");
    // A card of its own width, never as wide as a whole description: each line that is longer ends in an ellipsis
    // (owner, 2026-11-09: 「可以就用 .. 就好 不會有人真的看完所有 Description」).
    require(c.width <= 401, `the preview keeps its own width (${Math.round(c.width)} px)`);
    for (const line of card.querySelectorAll('.preview-meta > span')) {
      const style = getComputedStyle(line);
      require(line.getBoundingClientRect().right <= c.right && style.whiteSpace === "nowrap" && style.textOverflow === "ellipsis", "each line stays inside it, cut with an ellipsis");
    }
    return { check: name };
  }
  if (name === "owner-bubble-tinted" || name === "owner-bubble-neutral" || name === "owner-bubble-dark-words") {
    const bubble = [...document.querySelectorAll('.owner-message .bubble')].find(visible);
    const style = getComputedStyle(bubble), chat = bubble.closest('.mb-chat');
    const channel = value => value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
    const light = color => { const [r, g, b] = color.match(/[\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const [a, b] = [light(style.backgroundColor), light(style.color)], ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // R-UI-81: white words hold a 3.4:1 minimum contrast on a coloured bubble; dark words read at 4.5:1.
    require(ratio >= (b > a ? 3.39 : 4.5), `the words read on the bubble: ${ratio}`);
    // A character nearly white takes dark words and keeps its own colour. The scene once named a slime whose id had since become
    // Raphael's blue, so it showed white words on blue under the title "dark words" and no check noticed (2026-11-11).
    if (name === "owner-bubble-dark-words") require(b < a, `a nearly white character takes dark words on its own colour: ${style.color} on ${style.backgroundColor}`);
    // As slim as Grok Bot's 36 px pill (owner, 2026-11-09: 「我們的太胖了」): one line is a 38 px pill.
    const box = bubble.getBoundingClientRect(), lines = Math.round((box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight));
    if (lines === 1) require(box.height <= 40 && parseFloat(style.borderTopLeftRadius) >= box.height / 2 - 1, `a one-line message is a slim pill (${Math.round(box.height)} px, radius ${style.borderTopLeftRadius})`);
    const probe = document.createElement('i'); probe.style.background = 'var(--bubble)'; document.documentElement.append(probe);
    const neutral = getComputedStyle(probe).backgroundColor; probe.remove();
    if (name === "owner-bubble-neutral") {
      require(style.backgroundColor === neutral, `this conversation stays neutral: ${style.backgroundColor}`);
    } else {
      require(style.backgroundColor !== neutral, "the owner's bubble wears the member's colour");
      for (const link of bubble.querySelectorAll('.message-link, .btn.message-expand')) require(getComputedStyle(link).color === style.color, "a link and the expand control take the bubble's words colour");
      require(chat && chat.dataset.memberBubble !== undefined, "the colour comes from the member's conversation");
      // Raphael is the first blue slime, and his conversation wears its blue like any member's (R-UI-81).
      if (document.querySelector('.mb-chat [data-member="0"][aria-current="true"], .side .mb-chief[aria-current="true"]')) {
        const [r, g, b] = style.backgroundColor.match(/\d+/g).map(Number);
        require(b > r + 80 && b > g, `Raphael's own conversation wears his blue: ${style.backgroundColor}`);
      }
    }
    return {check:name,background:style.backgroundColor,ratio:Number(ratio.toFixed(2))};
  }
  if (name === "member-switch" || name === "member-switch-light" || name === "member-switch-off" || name === "switch-neutral") {
    // A switch that is on wears the member's colour in the member's own places (its panel and its settings page), as the owner's bubble
    // does in its conversation (owner, 2026-11-12); everywhere else (the Settings dialog, Home, the store) it is as it was.
    const token = (prop, value) => { const probe = document.createElement('i'); probe.style[prop] = value; document.body.append(probe); const out = getComputedStyle(probe)[prop]; probe.remove(); return out; };
    const channel = value => value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
    const light = color => { const [r, g, b] = color.match(/[\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const ratio = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
    const knobOf = node => getComputedStyle(node, '::after').backgroundColor;
    if (name === "switch-neutral") {
      const switches = [...document.querySelectorAll('.modal-scrim .tg[aria-checked="true"]')].filter(visible);
      require(switches.length > 0, "the Settings dialog shows a switch that is on");
      for (const node of switches) {
        require(!node.closest('[data-member-switch]'), "the Settings dialog is no member's place");
        require(getComputedStyle(node).backgroundColor === token('backgroundColor', 'var(--accent)') && knobOf(node) === token('backgroundColor', 'var(--on-accent)'), `a switch outside a member's places keeps the accent (${getComputedStyle(node).backgroundColor}, knob ${knobOf(node)})`);
      }
      return { check: name, switches: switches.length };
    }
    const chat = document.querySelector('.mb-chat');
    // The colour comes from the conversation: its bubble's, and the accent its send button wears (agent.ts drawFaces).
    const inChat = (prop, value) => { const probe = document.createElement('i'); probe.style[prop] = value; chat.append(probe); const out = getComputedStyle(probe)[prop]; probe.remove(); return out; };
    const dark = document.documentElement.dataset.theme === 'dark';
    const bubbleColour = inChat('backgroundColor', 'var(--member-bubble)'), accentColour = inChat('backgroundColor', 'var(--member-accent)');
    require(bubbleColour !== 'rgba(0, 0, 0, 0)' && accentColour !== 'rgba(0, 0, 0, 0)', "the conversation has the member's colour (the one its bubble and send button wear)");
    // On the white theme the track is the owner's bubble, on the black one the lighter colour that stands off the panel.
    const colour = dark ? accentColour : bubbleColour;
    const places = [...document.querySelectorAll('.mb-det, .ms-pane')].filter(visible);
    require(places.length > 0, "the member's panel or settings page is open");
    const on = places.flatMap(place => [...place.querySelectorAll('.tg[aria-checked="true"]')]).filter(visible);
    const off = places.flatMap(place => [...place.querySelectorAll('.tg[aria-checked="false"]')]).filter(visible);
    if (name === "member-switch-off") require(on.length === 0 && off.length > 0, "only switches that are off are shown here");
    else require(on.length > 0, "a switch that is on is shown in the member's place");
    for (const node of on) {
      const style = getComputedStyle(node), knob = knobOf(node);
      require(node.closest('[data-member-switch]'), "the place carries the member's colour");
      require(style.backgroundColor === colour && style.borderTopColor === accentColour, `a switch that is on wears the member's colour (${style.backgroundColor} with ${style.borderTopColor}, wanted ${colour} with ${accentColour})`);
      // The knob is white on a colour white stands 3:1 off, dark on a light one (a yellow or white-ish slime), and always stands off the track.
      const white = token('backgroundColor', 'var(--on-tint-light)'), wanted = ratio(white, colour) >= 3 ? white : token('backgroundColor', 'var(--on-tint-dark)');
      require(knob === wanted && ratio(knob, colour) >= 3, `the knob stands off the colour (${knob} on ${colour}: ${ratio(knob, colour).toFixed(2)})`);
      // The black theme's colour stands off its panel; the white theme's outline does (`memberAccent` holds 3:1 off white, the panel is #f7f7f7).
      const panel = getComputedStyle(node.closest('.mb-det, .ms-pane')).backgroundColor;
      if (panel !== 'rgba(0, 0, 0, 0)') require(ratio(accentColour, panel) >= 2.7, `the colour stands off its surface (${ratio(accentColour, panel).toFixed(2)})`);
      if (name === "member-switch-light") require(light(knob) < 0.1, `a light slime's knob is dark (${knob} on ${colour})`);
    }
    for (const node of off) {
      const style = getComputedStyle(node);
      require(style.backgroundColor === 'rgba(0, 0, 0, 0)' && knobOf(node) === token('backgroundColor', 'var(--text-2)') && style.borderTopColor === token('borderTopColor', 'var(--text-3)'), `a switch that is off keeps its look (${style.backgroundColor}, knob ${knobOf(node)})`);
    }
    return { check: name, on: on.length, off: off.length, colour, knob: on[0] ? knobOf(on[0]) : null };
  }
  if (name === "sidebar-folded") {
    // The rail of faces on a narrow window has no folder headings to press.
    if (matchMedia('(max-width: 859px)').matches) return {check:name,compact:true};
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
      const slot=document.documentElement.hasAttribute('data-sidebar-collapsed')?36:40;
      require(Math.abs(box.width-slot)<1&&Math.abs(box.height-slot)<1,'composite stays in the sidebar avatar slot');
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
    // The sidebar's rows carry no time on screen (R-UI-77); the row still knows its latest message's moment.
    const time = row.querySelector('time');
    require(!time || time.dateTime === new Date(last.created).toISOString(), "that room's own row keeps its latest message time");
    return {check:name, preview:row.querySelector('.mb-row-p').textContent, datetime:time?.dateTime ?? null};
  }
  if (name === "sidebar-unread") {
    // The sidebar's rows show no time (R-UI-77): new messages keep their unread dot.
    require(document.querySelector('.mb-col .mb-dot.is-unread') && ![...document.querySelectorAll('.mb-col time')].some(visible), "new messages keep their unread dot, with no time on screen");
    require(document.querySelector('.au-room-row [data-room="1"] .mb-dot.is-unread'), "the unread room has its own unread marker");
    require(document.querySelector('.mb-col .room-avatar > .av'), "room list uses actual member faces");
    return {check:name};
  }
  if (name === "owner-avatar") {
    require(document.querySelector('[data-owner-photo] .owner-face'), "account exposes the shared photo picker");
    return {check:name};
  }
  if (name === "avatar-crop-frame" || name === "avatar-crop-held") {
    const dialog = document.querySelector('.av-crop'), stage = dialog?.querySelector('.av-crop-view'), frame = stage?.querySelector('.av-crop-frame'), img = stage?.querySelector('img');
    require(visible(dialog) && visible(frame) && img, "the crop dialog shows the whole picture and its frame");
    require(!dialog.querySelector('input[type="range"]'), "no zoom slider: the wheel and the frame's corners zoom");
    require(frame.querySelectorAll('.av-crop-corner').length === 4, "the frame has its four corners");
    const s = stage.getBoundingClientRect(), f = frame.getBoundingClientRect(), p = img.getBoundingClientRect();
    require(Math.abs(f.width - f.height) < 0.5, "the frame is square");
    // The picture shows in a circle, so the dim leaves a circle the size of the frame.
    const ring = stage.querySelector('.av-crop-ring'), r = ring?.getBoundingClientRect();
    require(visible(ring) && getComputedStyle(ring).borderRadius !== '0px' && Math.abs(r.left - f.left) < 0.5 && Math.abs(r.width - f.width) < 0.5, "the frame shows the circle the picture will be cut to");
    require(f.left >= s.left && f.top >= s.top && f.right <= s.right && f.bottom <= s.bottom, "the frame stays inside the stage");
    require(p.left <= f.left + 0.5 && p.top <= f.top + 0.5 && p.right >= f.right - 0.5 && p.bottom >= f.bottom - 0.5, "the picture covers the whole frame");
    const thirds = getComputedStyle(ring.querySelector('.av-crop-grid')).opacity;
    if (name === "avatar-crop-frame") {
      require(thirds === "0", "the thirds hide while nothing is held");
      require(f.width < Math.min(p.width, p.height) - 20, "a corner drag made the frame smaller");
      require(p.left < f.left - 5, "a left-button drag moved the picture under the frame");
    } else require(stage.hasAttribute('data-pressed') && thirds === "1", "the thirds show while the left button is held");
    return { check: name, frame: Math.round(f.width) };
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
      // Absent Docker is a bare wallpaper: no reason, no download button; the screen is the press.
      require(visible(panel)&&visible(panel.querySelector('.desktop-screen')),'the absent computer keeps its panel and screen');
      requireBareScreen(panel.querySelector('.desktop-screen'),'the absent computer screen');
      require(!panel.querySelector('[data-act="docker-download"]'),'absent Docker draws no download button');
      require(!shownText(panel).includes('Docker'),'absent Docker is not explained in words');
      require(visible(panel.querySelector('[data-desktop="enlarge"]')),'the whole screen is the press that tries again');
      require(visible(document.querySelector('.desktop-location-header [data-computer-location]')),'the location control stays so the owner can choose another computer');
      require(!calls.some(call=>call.method==='computer.viewer_open'),'reading the missing state never starts a computer');
      return {check:name};
    }
    require(panel.closest('.mb-det') && (visible(panel) || visible(frame) || name==='computer-takeover-done' || name==='desktop-handback') && ![...document.querySelectorAll('[role="dialog"]')].some(visible), 'computer uses the existing viewer in its panel or card');
    const screenHit=panel.querySelector('[data-desktop="enlarge"]');
    if(frame&&!screenHit.hidden)require(getComputedStyle(screenHit).backgroundColor==='rgba(0, 0, 0, 0)','screen click target stays transparent including hover');
    const events=document.querySelectorAll('[data-desktop-work]');
    // A member working at its computer adds nothing to the conversation (owner, 2026-11-11); only a handoff the owner must act on is a card.
    if(name==='computer-panel')require(events.length===0&&!document.querySelector('.conversation-event-line [data-i="monitor"], [data-desktop-slot]:not(:empty)'),'a working computer draws no line or card in the conversation');
    else if(name.startsWith('computer-'))require(events.length===1&&events[0].matches('.conversation-card')&&events[0].closest('.tn')?.dataset.id==='2','one work presentation belongs to the private turn');
    if(name==='computer-takeover'){
      require(panel.querySelector('.desktop-request').textContent.includes('登入'),'request sits above the live screen');
      // R-PANEL-09 (owner, 2026-11-13: 「你這個畫面這麼小，我根本看不到登入的畫面」): the handoff card is as wide as the
      // conversation and its screen keeps the computer's proportions, the stream filling it with no dark bars.
      const card=events[0], column=card.closest('.ra-col')??card.parentElement, screen=card.querySelector('[data-card-desktop-screen]');
      const inner=column.getBoundingClientRect().width-parseFloat(getComputedStyle(column).paddingLeft)-parseFloat(getComputedStyle(column).paddingRight);
      const cardBox=card.getBoundingClientRect(), screenBox=screen.getBoundingClientRect(), frameBox=frame.getBoundingClientRect();
      require(cardBox.width>=inner-2,`the handoff card fills the conversation (${Math.round(cardBox.width)} of ${Math.round(inner)})`);
      require(Math.abs(screenBox.width/screenBox.height-1280/900)<0.02,`the card's screen keeps the computer's proportions (${Math.round(screenBox.width)}x${Math.round(screenBox.height)})`);
      require(frame.closest('[data-card-desktop-screen]')===screen&&frameBox.width>=screenBox.width-4&&frameBox.height>=screenBox.height-4,'the stream fills the card screen with no bars');
    }
    if(name==='computer-takeover-owner') {
      // The card's 接手 opened the larger view; its pill offers 我完成了, which gives the request back (R-PANEL-09).
      const done=panel.querySelector('[data-desktop="return"]');
      require(visible(done)&&done.textContent==='我完成了'&&panel.querySelector('.desktop-mode-label').textContent==='你正在控制', 'the pill says the owner is in control and offers one explicit done');
      require(panel.hasAttribute('data-expanded') && frame.closest('.desktop-panel .desktop-screen'), 'owner input is in the larger view, not a small card');
      require(frame.contentDocument.defaultView.__desktopAcceptedKeys > 0, 'synthetic keyboard input reaches the RFB surface');
      require(!calls.some(call => JSON.stringify(call.params ?? {}).includes('synthetic-owner-input')), 'owner input never enters an RPC');
    }
    if(name==='computer-takeover-done')require(calls.filter(call=>call.method==='computer.viewer_control'&&!call.params.held&&call.params.takeover==='private-takeover-request').length===1,'one explicit handback with the current nonce');
    if(name==='computer-takeover-owner'||name==='desktop-owner'){
      require(panel.dataset.interactive==='true'&&getComputedStyle(frame).pointerEvents==='auto','click enables input in place');
      // Only the pill under the screen says who holds it; the screen carries no badge of its own (owner, 2026-11-13:
      // 「明明下方就有顯示我正在控制的，為什麼左邊還要再顯示一次？」).
      const saying=[...document.querySelectorAll('body *')].filter(node=>node.childElementCount===0&&visible(node)&&node.textContent.trim()==='你正在控制');
      require(saying.length<=1&&!document.querySelector('.desktop-owner'),`你正在控制 shows once (${saying.length})`);
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
        // At its own proportions the screen fills the window's width, or, in a wide window, its height.
        const shown=frame.getBoundingClientRect(), room=innerHeight-(document.querySelector('.window-chrome')?.getBoundingClientRect().bottom??32)-64;
        require(shown.width>innerWidth*0.9||shown.height>room*0.9,`expanded screen fills the window's width or height (${Math.round(shown.width)}x${Math.round(shown.height)})`);
      }
    if(name==='desktop-offline'){
      require(!frame,'offline screen has no blank frame');
      // No state is written over an offline screen: preparation shows no stage, face or progress.
      requireBareScreen(panel.querySelector('.desktop-screen'), 'the offline screen');
      require(!visible(panel.querySelector('[data-desktop="retry"]')) && !visible(panel.querySelector('.computer-lifecycle-state')), 'no recovery button or header word is drawn');
      if(['starting','building','preparing'].includes(panel.dataset.desktopState)) require(!visible(panel.querySelector('[data-desktop="enlarge"]')) && !panel.querySelector('progress, .desktop-preparation'), 'a computer that is getting ready is not pressable and writes no progress');
      else if (panel.dataset.desktopState === 'stopped') require(visible(panel.querySelector('[data-desktop="enlarge"][data-asleep]')), 'a sleeping screen wakes with a press on the screen itself');
      else require(visible(panel.querySelector('[data-desktop="enlarge"]')) && !panel.querySelector('[data-desktop="enlarge"]').hasAttribute('data-asleep'),'a failure is started again with a press on the screen itself');
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
  if (["settings-owner", "settings-tools", "settings-draft-grouped"].includes(name)) {
    if (name === 'settings-owner') {
      require(visible(document.querySelector('[data-owner="owner_name"]')) && !document.querySelector('#agent-city') && !document.querySelector('[data-mem-space], [data-pane="memory"]'), "the owner's profile stands, no tab of Settings shows memory (owner, 2026-11-11), and no weather city is asked for");
      require(!document.querySelector('[data-act="rerun-guide"]') && ![...document.querySelectorAll('.modal-body button, .modal-body h2')].some(el => /導覽/.test(el.textContent)), "General has no way back into the guide (owner, 2026-11-14)");
    }
    else if (name === 'settings-tools') require(document.querySelector('[data-pane="tools"]')?.getAttribute('aria-current') === 'page' && !document.querySelector('[data-pane="agent"]'), "legacy agent pane resolves to Tools");
    else if (name === 'settings-draft-grouped') require(!!document.querySelector('.ms-pane .ms-list [data-ms="draft"]') && document.querySelectorAll('.ms-pane [data-ms="draft"]').length === 1, 'the draft switch is one row of the page, in the list with the group');
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
    // The download button was removed with every other word over the screen.
    require(document.querySelectorAll('[data-act="docker-download"]').length === 0, "no Docker download button is drawn");
    requireBareScreen(document.querySelector('.desktop-panel .desktop-screen'), 'the absent computer screen');
    require(visible(document.querySelector('.desktop-panel [data-desktop="enlarge"]')), "the screen itself is the press that tries again");
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
    // An inherited skill opens in its view read only, with the same readable origin as everywhere.
    const pane = document.querySelector('.ms-pane'), text = pane.querySelector('#ms-skill-text'), meta = pane.querySelector('.ms-meta');
    require(visible(meta) && meta.textContent.includes('共享 · ~/.codex/skills/source-check') && !meta.textContent.includes('local:'), "the skill's view uses the same readable source label");
    require(visible(text) && text.disabled && !pane.querySelector('[data-ms="skill-save"], [data-ms="skill-more"]'), "inherited skills remain editable only in the library");
    return { check: name };
  }
  if (name === "growing-skills") {
    const pane = document.querySelector('.ms-pane');
    require(pane.textContent.includes("2026/10/29"), "skill dates follow the Chinese UI rather than the browser locale");
    const editor = pane.querySelector('#ms-skill-text');
    require(visible(editor) && editor.value.includes("## Verification"), "the actual saved skill opens in the member settings page");
    require(pane.textContent.includes("自行學會"), "learned provenance and date are shown");
    const meta = pane.querySelector('.ms-meta');
    require(meta.textContent.split('自行學會').length === 2 && meta.textContent.includes('自行學會 · 2026/10/29'), "a learned skill has exactly one localized origin and date line");
    const calls = window.__look.calls;
    require(calls.some(c => c.method === "members.skills.read"), "opening reads the real skill boundary");
    require(!calls.some(c => c.method === "members.skills.update" || c.method === "members.skills.delete"), "reading the editor never mutates skills");
    return { check: name };
  }
  if (name === "skill-deleted-final") {
    // Owner, 2026-11-14: 「復原上次變更這個都可以拿掉啊，這個沒有什麼意義，就直接拿掉就好了 所有地方的」. The delete asked twice, went through the
    // same owner boundary, and nothing in the list offers to bring the skill back.
    const pane = document.querySelector('.ms-pane'), calls = window.__look.calls;
    require(calls.some(c => c.method === "members.skills.delete" && c.params.id === 31), "Raphael deletes the skill through the same owner boundary");
    require(!calls.some(c => c.method === "members.skills.update" && "undo" in c.params), "no call asks the core to restore a skill");
    require(!pane.querySelector('[data-ms="skill-open"][data-id="31"]') && pane.querySelector('[data-ms="skill-open"][data-id="32"]'), "the deleted skill is gone and the shared one stays");
    require(!pane.querySelector('[data-ms="skill-undo"]') && !/復原|undo/i.test(pane.textContent), "the list has no way to bring the skill back");
    return { check: name };
  }
  if (name === "confirm-menu-label" || name === "confirm-menu-asks") {
    // R-UI-56: the item in the ⋯ names what it destroys, and its first press only asks.
    const item = document.querySelector('#app-popover [data-confirm-item]');
    require(visible(item) && item.classList.contains("danger"), "the ⋯ opens a danger item");
    require(document.querySelector('[data-overflow][aria-expanded="true"]'), "the menu belongs to a ⋯ button");
    require(/^確定/.test(item.textContent.trim()) === (name === "confirm-menu-asks"), `the item says ${item.textContent.trim()}`);
    const destroying = ["secrets.clear_openrouter_key", "history.clear", "agent.history.clear"];
    require(!window.__look.calls.some(call => destroying.includes(call.method)), "nothing is destroyed before the second press");
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
  if (name === "onboarding-welcome") {
    // The welcome shows: Raphael's emblem, his name, and an ask being typed with his 告。 answer
    // instead of a slogan, the language at the card's top left, and one wide black pill, centred in the fixed card.
    const card = document.querySelector('.ob-card').getBoundingClientRect();
    const canvas = document.querySelector('.ob-emblem canvas.ob-emb'), title = document.querySelector('.ob-col > h2');
    require(visible(canvas) && canvas.width > 0, "Raphael's emblem is on the welcome");
    require(title && title.textContent.trim().length > 0 && parseFloat(getComputedStyle(title).fontSize) >= 28, "his name is the headline");
    const mark = title.querySelector('.ob-wm'), markStyle = mark && getComputedStyle(mark);
    require(visible(mark) && mark.getBoundingClientRect().width >= 200 && `${markStyle.maskImage} ${markStyle.webkitMaskImage}`.includes("wordmark.svg"),
      "his name is the one wordmark 智慧之王ラファエル, the same in every language");
    const promise = document.querySelector('.ob-demo-ask'), reply = document.querySelector('.ob-demo-reply');
    require(visible(promise) && promise.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1, "an ask is typed under the name");
    require(!document.querySelector('.ob-line'), "no slogan under the name");
    require(reply && document.querySelector('.ob-sr')?.textContent.trim().length > 0, "his answer has its place, and a reader hears what the team does");
    const language = document.querySelector('.ob-lang .lang-btn'), corner = language.getBoundingClientRect();
    require(visible(language) && corner.left - card.left <= 24 && corner.top - card.top <= 24 && !document.querySelector('.ob-col .lang-btn, .ob-col .sel'), "the language waits at the card's top left, out of the column");
    require(!document.querySelector('.ob-aside, .ob-say, .ob-floaters, .ob-top, [data-ob="back"], .ob-bar-steps'), "the welcome has no side, no slimes floating, no way back and no progress bar");
    const centre = card.left + card.width / 2;
    for (const [what, element] of [["the emblem", canvas], ["the name", title], ["the typed ask", promise], ["the primary pill", document.querySelector('.ob-actions > .btn.pri')]]) {
      const box = element.getBoundingClientRect();
      require(Math.abs(box.left + box.width / 2 - centre) <= 2, `${what} is centred in the card`);
      require(box.left >= card.left && box.right <= card.right && box.top >= card.top && box.bottom <= card.bottom + 1, `${what} stays inside the card`);
    }
    const pill = document.querySelector('.ob-actions > .btn.pri'), box = pill.getBoundingClientRect();
    // The guide keeps its own wide pills instead of the shared button height.
    require(box.width >= 240 && box.height >= 40 && parseFloat(getComputedStyle(pill).borderTopLeftRadius) >= box.height / 2 - 1, "the one button is a wide pill");
    // The welcome's one pill is 360 px wide, or what a narrow card leaves it.
    const foot = document.querySelector('.ob-foot'), footStyle = getComputedStyle(foot), room = foot.getBoundingClientRect().width - parseFloat(footStyle.paddingLeft) - parseFloat(footStyle.paddingRight);
    require(Math.abs(box.width - Math.min(360, room)) <= 1, `the welcome's pill is 360 px wide, or its room (${Math.round(box.width)} px of ${Math.round(Math.min(360, room))})`);
    require(!document.querySelector('.ob-foot .ob-pair'), "the welcome's row is its own, not a step's pair");
    const ink = getComputedStyle(pill).backgroundColor, text = getComputedStyle(document.body).color;
    require(ink !== 'rgba(0, 0, 0, 0)' && ink !== getComputedStyle(document.querySelector('.ob-card')).backgroundColor, `the pill is the solid accent, not the card's colour (${ink} on ${text})`);
    const drawn = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let at = 3; at < drawn.length; at += 4) if (drawn[at] > 8) inked++;
    require(inked > 40, `the emblem is drawn on its canvas (${inked} pixels)`);
    return { check: name, inked };
  }
  // A step's foot (owner, 2026-11-11 evening, of two worded pills at the row's ends: 「改成集中在中間這邊好不好？然後 icon 改
  // 一下…不一定要寫字，can 用兩個三角形之類的」; a left and a right button since 「我要的是左右 button」, one row since 「上下堆疊
  // 會造成我們畫面有些空間比較緊」): two round buttons together in the middle, the way back at the left and the way on at the
  // right, each a filled triangle that points where it goes. The last step's way on is a check: it finishes.
  const requireStepPair = (card, last) => {
    const rowEl = document.querySelector('.ob-foot .ob-actions');
    const buttons = [...rowEl.querySelectorAll(':scope > .btn')].filter(visible);
    require(rowEl.classList.contains('ob-pair') && buttons.length === 2 && document.querySelectorAll('.ob-foot .btn').length === 2, `the foot holds two buttons and nothing else (${buttons.length})`);
    const [back, primary] = buttons, left = back.getBoundingClientRect(), ink = primary.getBoundingClientRect();
    require(back.dataset.ob === "back" && primary.dataset.ob === "next" && primary.matches('.pri') && !back.matches('.pri'), "the way back comes first and is the quiet one, the primary after it");
    // No words: each is a drawing alone, so each is named for assistive tech and says the same in its tooltip, in the
    // screen language. The last step's primary finishes: 開始使用 on a first run, 完成 when the guide was opened again.
    const names = last ? ["開始使用", "完成"] : ["下一步"];
    for (const [button, wanted] of [[back, ["上一步"]], [primary, names]]) {
      require(button.matches('.btn.icon') && !button.textContent.trim() && button.querySelectorAll(':scope > svg.i').length === 1, `${wanted[0]} is a drawing alone, with no words`);
      require(wanted.includes(button.getAttribute('aria-label')) && button.getAttribute('title') === button.getAttribute('aria-label'), `it is named ${wanted.join(" or ")} for assistive tech and in its tooltip (${button.getAttribute('aria-label')})`);
    }
    // The drawing: one filled triangle on both, the way back's turned round, each pointing away from the other. The last
    // step's way on is a check, a line and not a filled shape.
    const drawing = button => button.querySelector(':scope > svg.i'), filled = button => !['none', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(drawing(button)).fill);
    const flipped = button => new DOMMatrixReadOnly(getComputedStyle(drawing(button)).transform).a < 0;
    require(back.matches('.ob-tri') && filled(back) && flipped(back), "the way back is a filled triangle that points left");
    if (last) require(!primary.matches('.ob-tri') && !filled(primary) && drawing(primary).innerHTML !== drawing(back).innerHTML, "the last step's way on is a check, not a triangle");
    else require(primary.matches('.ob-tri') && filled(primary) && !flipped(primary) && drawing(primary).innerHTML === drawing(back).innerHTML, "the way on is the same filled triangle, pointing right");
    for (const button of buttons) {
      const mark = drawing(button).getBoundingClientRect(), box = button.getBoundingClientRect();
      require(Math.abs(mark.width - 20) <= .5 && Math.abs(mark.height - 20) <= .5, `the drawing is 20 px (${mark.width} x ${mark.height})`);
      require(Math.abs((mark.left + mark.right) / 2 - (box.left + box.right) / 2) <= 1 && Math.abs((mark.top + mark.bottom) / 2 - (box.top + box.bottom) / 2) <= 1, "the drawing's box is in the middle of its circle");
      // A circle: as wide as tall, a comfortable target, round all the way.
      require(Math.abs(box.width - box.height) <= .5 && box.width >= 44 && box.width <= 56 && parseFloat(getComputedStyle(button).borderTopLeftRadius) >= box.width / 2 - 1, `it is a circle of a comfortable size (${Math.round(box.width)} x ${Math.round(box.height)})`);
    }
    // Together in the middle: one size, on one line, a small gap between them, and the pair centred in the card. It is
    // the same on every step, so neither button moves from step to step.
    require(Math.abs(left.width - ink.width) <= .5 && Math.abs((left.top + left.bottom) / 2 - (ink.top + ink.bottom) / 2) <= 1, `the two are one size on one line (${Math.round(left.width)} and ${Math.round(ink.width)})`);
    const gap = ink.left - left.right;
    require(gap >= 8 && gap <= 16, `the two stand together, a small gap between them (${Math.round(gap)} px)`);
    require(Math.abs((left.left + ink.right) / 2 - (card.left + card.width / 2)) <= 1, `the pair is centred in the card (${Math.round((left.left + ink.right) / 2 - card.left - card.width / 2)} px off)`);
    // The colours: the way on is a circle of the solid accent with the accent's ink; the way back has a quiet surface of
    // its own. Neither has an edge to see, in the dark theme least of all.
    const cardSurface = getComputedStyle(document.querySelector('.ob-card')).backgroundColor;
    const token = value => { const probe = document.createElement('i'); probe.style.backgroundColor = `var(${value})`; document.body.append(probe); const colour = getComputedStyle(probe).backgroundColor; probe.remove(); return colour; };
    const quiet = getComputedStyle(back).backgroundColor, solid = getComputedStyle(primary).backgroundColor;
    // The pointer may still rest on it from the press that brought the step: then it is the accent's own step under the pointer.
    require([token('--accent'), token('--accent-hover'), token('--accent-pressed')].includes(solid) && getComputedStyle(primary).color === token('--on-accent'), `the way on is the solid accent with its ink (${solid}, ${getComputedStyle(primary).color})`);
    require(!['rgba(0, 0, 0, 0)', 'transparent'].includes(quiet) && quiet !== solid && quiet !== cardSurface, `the way back keeps a quiet surface of its own (${quiet})`);
    for (const button of buttons) require(['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(button).borderTopColor), "a round button has no edge");
    // The foot is one control and its padding tall, and the content ends where it begins.
    const foot = document.querySelector('.ob-foot'), footBox = foot.getBoundingClientRect(), footStyle = getComputedStyle(foot);
    const pad = parseFloat(footStyle.paddingTop) + parseFloat(footStyle.paddingBottom);
    require(footBox.height <= ink.height + pad + 1, `the foot is one control plus its padding tall (${Math.round(footBox.height)} px, a control ${Math.round(ink.height)} + ${Math.round(pad)})`);
    require(document.querySelector('.ob-body').getBoundingClientRect().bottom <= footBox.top + 1, "the content area ends where the foot begins");
    require(!!(back.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING), "the way back comes before the primary in the tab order");
    require(ink.bottom <= card.bottom && left.bottom <= card.bottom && left.left >= card.left && ink.right <= card.right, "both stay inside the card");
    return { back: left, ink };
  };
  if (name === "onboarding-back-hover" || name === "onboarding-back-focus") {
    // The way back of a step's pair (owner, 2026-11-11): a round button on a quiet grey of its own, one step lighter under
    // the pointer, with no edge; the keyboard shows the app's usual ring on it, and it comes before the primary.
    const back = document.querySelector('.ob-foot [data-ob="back"]');
    const token = value => { const probe = document.createElement('i'); probe.style.backgroundColor = `var(${value})`; document.body.append(probe); const colour = getComputedStyle(probe).backgroundColor; probe.remove(); return colour; };
    require(visible(back) && back.matches('.ob-pair > .btn.icon.ob-prev') && back.getAttribute('aria-label') === "上一步", "the step's foot has its round way back, named 上一步");
    if (name === "onboarding-back-hover") {
      const style = getComputedStyle(back);
      require(back.matches(':hover'), "the pointer is on the way back");
      require(style.backgroundColor === token('--pressed') && token('--pressed') !== token('--hover'), `the way back is one step lighter under the pointer (${style.backgroundColor})`);
      require(['rgba(0, 0, 0, 0)', 'transparent'].includes(style.borderTopColor) && style.color === token('--text'), `no edge appears under the pointer and its triangle keeps its ink (${style.borderTopColor}, ${style.color})`);
      require(!document.documentElement.hasAttribute('data-keys') && style.outlineStyle === 'none', "the pointer adds no keyboard ring");
    } else {
      const style = getComputedStyle(back);
      require(document.activeElement === back && document.documentElement.hasAttribute('data-keys'), "Shift+Tab from the primary lands on the way back, by the keyboard");
      require(style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 && style.outlineColor !== 'rgba(0, 0, 0, 0)', `the way back shows the app's focus ring (${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor})`);
      require(style.backgroundColor === token('--hover'), "the way back rests on its quiet grey");
      require(parseFloat(style.borderTopLeftRadius) >= back.getBoundingClientRect().height / 2 - 1, "the ring follows the circle");
    }
    return { check: name };
  }
  if (name === "onboarding-tools" || name === "onboarding-services" || name === "onboarding-abilities") {
    // Each first-run choice is one calm centred column in one card of a designed size: a title with two small slimes
    // floating by it, the choice as tiles in a grid of three (rows for the abilities), one wide black pill and, beside
    // it, a round arrow for the way back (owner, 2026-11-07, after Grok Bot's first run; the arrow since 2026-11-11).
    const title = document.querySelector('.ob-col > h2');
    require(title && parseFloat(getComputedStyle(title).fontSize) >= 28, "the headline is large");
    const card = document.querySelector('.ob-card').getBoundingClientRect();
    require(card.width <= 1082 && card.height <= 722, `the guide is one card of a designed size, not the whole window (${Math.round(card.width)} x ${Math.round(card.height)})`);
    require(Math.abs((card.left + card.right) / 2 - innerWidth / 2) <= 2, "the card sits in the middle of the window");
    require(!document.querySelector('.ob-bar-steps, .ob-aside, .ob-say, .ob-top'), "there is no progress bar, no side and no bar above the column");
    require(!document.querySelector('.ob-sub'), "a choice has no line of purpose under its headline");
    const floaters = [...document.querySelectorAll('.ob-floaters .slime-surface')];
    require(document.querySelector('.ob-floaters')?.getAttribute('aria-hidden') === 'true', "the floating slimes are decoration only");
    if (innerWidth > 640) {
      require(floaters.length === 3 && floaters.every(visible), "three of the team's characters float by the title");
      const words = title.getBoundingClientRect();
      for (const slime of floaters) {
        const at = slime.getBoundingClientRect(), titleText = document.createRange();
        titleText.selectNodeContents(title);
        const ink = titleText.getBoundingClientRect();
        require(at.right <= ink.left + 1 || at.left >= ink.right - 1 || at.bottom <= ink.top + 1 || at.top >= ink.bottom - 1, "a floating slime never sits on the words of the title");
        require(at.left >= card.left && at.right <= card.right && at.top >= card.top && at.bottom <= words.bottom + 40, "a floating slime stays in the card, by the title");
      }
    }
    const items = [...document.querySelectorAll(name === "onboarding-abilities" ? '.svc-item' : '.ob-tile:not([data-item^="provider:"]):not([data-item="composio"])')].filter(visible);
    const searched = !!document.querySelector('#ob-find')?.value.trim();
    items.forEach(item => { item.dataset.item ??= item.dataset.id; });
    const expected = { "onboarding-tools": ["chatgpt", "claude", "codex", "openrouter", "gemini"], "onboarding-abilities": ["search", "read", "vision", "pdf"] }[name];
    if (name === "onboarding-tools") {
      // A store: a search box, 熱門 first and the same for everyone, then every other tool by kind.
      const find = document.querySelector('.ob-find input#ob-tools-find');
      require(find && visible(find) && find.getAttribute('aria-label'), "a search box is above the tools");
      const groups = [...document.querySelectorAll('[data-ob-group]')].map(group => group.dataset.obGroup);
      require(groups[0] === "popular" && groups.includes("accounts"), `熱門 comes first, then the kinds (${groups.join(", ")})`);
      const popular = [...document.querySelectorAll('[data-ob-group="popular"] .ob-tile')].map(item => item.dataset.item);
      require(popular.slice(0, 4).join() === "chatgpt,claude,codex,openrouter", `熱門 is ChatGPT, Claude Code, Codex and OpenRouter first (${popular.join(", ")})`);
      if (!document.querySelector('#ob-key-input')) require(!document.querySelector('.ob-tile.wide'), "no tile is wider than the others while nothing is being typed");
    }
    if (expected) require(JSON.stringify(items.map(item => item.dataset.item)) === JSON.stringify(expected), `the items are ${expected.join(", ")}: ${items.map(item => item.dataset.item).join(", ")}`);
    else if (searched) require(items.length >= 1, "a search shows what it finds");
    else require(items.length >= 3 && items.length <= 18 && (!window.__look.data.composioConfigured || items.some(item => item.dataset.item === "gmail")), "the popular services of the store are offered as a grid");
    const column = document.querySelector('.ob-col').getBoundingClientRect();
    const tiles = name === "onboarding-abilities" ? [] : [...document.querySelectorAll('.ob-tile:not([data-item^="provider:"])')].filter(visible);
    // Each tile is one row, as a store's app is:
    // its mark in a square, its name over one line, its control on the right, centred.
    for (const item of tiles) {
      const box = item.getBoundingClientRect(), label = item.querySelector('.ob-tx').getBoundingClientRect(), nm = item.querySelector('.ob-tx .nm'), ds = item.querySelector('.ob-tx .ds'), control = item.querySelector('.ob-ctl'), wide = item.classList.contains('wide');
      const mark = item.querySelector('.ob-ic').getBoundingClientRect();
      require(box.left >= column.left - 1 && box.right <= column.right + 1, `${item.dataset.item} stays inside the column`);
      require(nm.scrollWidth <= nm.clientWidth + 1, `${item.dataset.item} shows its whole name`);
      require(mark.right <= label.left + 1 && Math.abs(mark.width - 36) <= 1 && Math.abs(mark.height - 36) <= 1, `${item.dataset.item} has its mark in its square before its name`);
      const entry = item.classList.contains('entry');
      if (!entry) require(Math.abs((mark.top + mark.bottom) / 2 - (box.top + box.bottom) / 2) <= 2, `${item.dataset.item} centres its mark`);
      // A status may wrap in its tile in a long language; every other line stays one line.
      if (!wide && !ds?.querySelector('.st')) {
        require(box.height <= 64, `${item.dataset.item} is one row (${Math.round(box.height)} px)`);
        if (ds) require(ds.getBoundingClientRect().height <= parseFloat(getComputedStyle(ds).lineHeight) + 1, `${item.dataset.item} keeps its line on one line`);
      }
      if (control && visible(control)) {
        const side = control.getBoundingClientRect();
        require(side.left >= box.left - 1 && side.right <= box.right + 1 && side.bottom <= box.bottom + 1 && side.top >= box.top - 1, `${item.dataset.item} keeps its control inside its tile`);
        // A key or an address being typed has its fields under its words, from the same left edge.
        if (entry) require(side.top >= label.bottom - 1 && Math.abs(side.left - label.left) <= 1 && label.width >= Math.min(240, box.width / 2), `${item.dataset.item} has its fields under its words, which keep their width`);
        else {
          require(side.left >= label.right - 1, `${item.dataset.item} keeps its control on the right of its name`);
          require(Math.abs((side.top + side.bottom) / 2 - (box.top + box.bottom) / 2) <= 2, `${item.dataset.item} centres its control`);
        }
      }
      if (item.classList.contains('on') && !wide) require(visible(item.querySelector('.ob-ctl .ob-tick')) && item.querySelector('.ob-tick').getAttribute('aria-label'), `${item.dataset.item} shows its check, and says what it means`);
    }
    const narrow = tiles.filter(item => !item.classList.contains('wide'));
    const lefts = new Set(narrow.map(item => Math.round(item.getBoundingClientRect().left)));
    // Three to a row where the column has room for tiles of at least 256 px, fewer in a narrow window.
    const columns = Math.min(3, Math.max(1, Math.floor((column.width + 8) / 264)));
    if (narrow.length >= columns) require(lefts.size === columns, `the tiles stand in a grid of ${columns} columns (${lefts.size})`);
    if (name === "onboarding-services") {
      const find = document.querySelector('.ob-find input#ob-find');
      require(find && visible(find) && find.getAttribute('aria-label'), "a search box is above the tiles");
      const first = tiles[0];
      require(!first || find.getBoundingClientRect().bottom <= first.getBoundingClientRect().top, "the search box is above the first tile");
      for (const on of document.querySelectorAll('[data-ob-services] .ob-tile.on')) {
        require(!on.querySelector('button'), `${on.dataset.item} is connected and has nothing left to press`);
      }
      if (!searched) require(document.querySelector('button.ob-tile[data-ob="conn-login"]'), "a service that is not connected is one whole button");
      for (const login of document.querySelectorAll('button.ob-tile[data-ob="conn-login"]')) {
        require(visible(login.querySelector('.ob-ctl .ob-get')), `${login.dataset.item} says on its right what pressing it does`);
      }
    }
    if (name === "onboarding-abilities") {
      // The same rows as Settings › 工具: what each uses now, its switch and the way to its choice of service.
      for (const item of items) {
        const box = item.getBoundingClientRect();
        require(box.left >= column.left - 1 && box.right <= column.right + 1, `${item.dataset.id} stays inside the column`);
        require(item.querySelector('.svc-now')?.textContent.trim() && item.querySelector('[data-svc="toggle"]') && item.querySelector('[data-svc="open"]'), `${item.dataset.id} says what it uses, has its switch and opens its choice`);
      }
      require(document.querySelector('[data-svc="toggle"][data-id="read"]').getAttribute('aria-checked') === 'false', "a switch that was pressed turned off");
    }
    requireStepPair(card, name === "onboarding-abilities");
    // Every word of a tile stays inside it, in every language.
    for (const tile of document.querySelectorAll('.ob-tile')) {
      const t = tile.getBoundingClientRect();
      for (const part of tile.querySelectorAll('.nm, .ds, .st, .ob-ctl > *')) {
        const p = part.getBoundingClientRect();
        require(p.right <= t.right + 1 && p.left >= t.left - 1, `${part.textContent.trim().slice(0, 24)} stays inside its tile`);
      }
    }
    return { check: name, items: items.length, columns: lefts.size, headline: getComputedStyle(title).fontSize };
  }
  if (name === "chat-usage-limit") {
    // A plan's usage limit leads with its Manage usage, under the failed reply's words (OpenAI's guidance).
    const button = document.querySelector('.chat-message[data-reply] > .turn-usage > button[data-act="manage-usage"]');
    require(visible(button) && button.textContent.trim() === "管理用量", "the failed reply offers 管理用量");
    const words = button.closest(".chat-message").querySelector(".ans").getBoundingClientRect(), box = button.getBoundingClientRect();
    require(box.top >= words.bottom - 1 && Math.abs(box.left - words.left) <= 2, "it stands under the reply's words, at their left edge");
    require(document.querySelectorAll('[data-act="manage-usage"]').length === 1, "only the failed reply carries it");
    return { check: name };
  }
  if (name.startsWith("chat-cli-signin")) {
    // A reply that failed for want of its subscription CLI's sign-in (R-CLI-SIGNIN-01/02): the core's one sentence that names the tool
    // and the true cause, and under it the one button that mends it, where the owner is. Never the old sentence that named two causes.
    const reply = document.querySelector('.chat-message[data-reply]'), strip = reply?.querySelector(':scope > .turn-signin');
    require(visible(reply) && visible(strip), "the failed reply carries its sign-in strip");
    require(!document.body.textContent.includes("還沒登入或缺少金鑰") && !document.body.textContent.includes("設定 › 連接"), "the generic sentence that named two causes and a page is gone");
    const words = reply.querySelector(".message-text");
    const sentence = words.textContent.trim();
    require(/^(Claude Code|Codex CLI|Antigravity) (的登入已過期|還沒登入|還沒安裝)。$/.test(sentence), `one sentence that names the tool and its cause: ${sentence}`);
    require(!/[A-Za-z_]+_[a-z]+|\/login|OAuth|401/.test(sentence), "no code and no raw output in the sentence");
    const buttons = [...strip.querySelectorAll("button")].filter(visible);
    const box = strip.getBoundingClientRect(), text = reply.querySelector(".ans").getBoundingClientRect();
    require(box.top >= text.bottom - 1 && Math.abs(box.left - text.left) <= 2, "it stands under the reply's words, at their left edge");
    require(buttons.every(button => button.classList.contains("btn") && button.classList.contains("sm")), "its buttons are the app's small buttons");
    require(buttons.every(button => button.getBoundingClientRect().height <= 30 && button.getBoundingClientRect().width <= 140), "each button is sized to its words");
    require(document.querySelectorAll(".turn-signin").length === 1 && !document.querySelector("[data-missing-repair]"), "one strip, and no second 開啟設定 beside it");
    const cause = document.querySelector("[data-cause]")?.dataset.cause;
    const note = strip.querySelector(".signin-note");
    const phase = strip.dataset.phase ?? "idle";
    if (name === "chat-cli-signin") {
      const [button] = buttons;
      const expected = { expired: "重新登入", signed_out: "登入" }[cause];
      if (sentence.endsWith("還沒安裝。")) {
        require(buttons.length === 1 && button.dataset.act === "cli-install" && button.textContent.trim() === "安裝說明", `a CLI that is not there offers its install guide: ${button?.textContent}`);
      } else {
        require(buttons.length === 1 && button.dataset.act === "cli-signin" && button.textContent.trim() === expected, `exactly one button, ${expected}: ${buttons.map(b => b.textContent)}`);
        require(sentence.endsWith(cause === "expired" ? "的登入已過期。" : "還沒登入。"), `the sentence and the button name the same cause (${cause})`);
      }
      require(!note && phase === "idle", "nothing but the button until it is pressed");
    } else if (name === "chat-cli-signin-waiting") {
      require(note?.textContent.trim() === "請在開啟的視窗完成登入", `the waiting line: ${note?.textContent}`);
      require(buttons.length === 1 && buttons[0].dataset.act === "cli-signin-cancel" && buttons[0].textContent.trim() === "取消", "only 取消 while the window is open");
      const started = window.__look.calls.filter(call => call.method === "brains.cli_login" && call.params.again === true);
      require(started.length >= 1 && started.every(call => call.params.id === "claude"), "the CLI's own sign-in was started for that CLI, again");
    } else if (name === "chat-cli-signin-stopped") {
      require(note?.textContent.trim() === "沒有完成登入", `a window closed first says so: ${note?.textContent}`);
      require(buttons.length === 1 && buttons[0].dataset.act === "cli-signin" && buttons[0].textContent.trim() === "重新登入", "and the button is usable again");
      require(!window.__look.calls.some(call => call.command === "agent_ask_text"), "nothing was sent again");
    } else if (name === "chat-cli-signin-done") {
      require(note?.textContent.trim() === "已登入，正在重新送出", `a finished sign-in says the question goes again: ${note?.textContent}`);
      require(buttons.length === 0, "no button while it is sent");
      const asked = window.__look.calls.filter(call => call.command === "agent_ask_text");
      require(asked.length === 1, `the question went again exactly once (${asked.length})`);
    }
    return { check: name, sentence, phase, buttons: buttons.map(button => button.textContent.trim()) };
  }
  if (name === "onboarding-composio") {
    // Without Composio its card comes first across the step, and the apps under it are the ones that need none.
    const card = document.querySelector('.ob-composio [data-item="composio"]'), grid = document.querySelector('[data-ob-services]');
    const column = document.querySelector('.ob-col').getBoundingClientRect();
    require(visible(card) && card.classList.contains('wide'), "Composio is one card across the step");
    const box = card.getBoundingClientRect();
    require(Math.abs(box.left - column.left) <= 1 && Math.abs(box.right - column.right) <= 1, "its card spans the column");
    require(box.bottom <= grid.getBoundingClientRect().top, "its card comes before the apps");
    require(box.top >= document.querySelector('#ob-find').getBoundingClientRect().bottom, "its card is under the search box");
    const title = document.querySelector('[data-ob-services-title]');
    require(title?.textContent.trim() === "不用 Composio 也能連接", `the apps under it are named as needing no Composio: ${title?.textContent}`);
    const field = card.querySelector('#ob-composio-input');
    if (field) {
      require(field.type === "password" && visible(card.querySelector('[data-ob="composio-paste"]')) && visible(card.querySelector('[data-ob="composio-cancel"]')), "its key is typed in the card, masked, with 貼上 and 取消");
      require(card.querySelector('.ds').textContent.includes("API Keys"), "while the key is typed the card says where to find it");
    } else {
      const open = card.querySelector('[data-ob="composio-open"]');
      require(visible(open) && open.textContent.trim() === "連接", "its card has 連接 on its right");
    }
    return { check: name, entering: !!field };
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
  if (name === "quota-warning-before") {
    window.__quotaCallsBefore = window.__look.calls.length;
    return { check: name, calls: window.__quotaCallsBefore };
  }
  if (name === "quota-warning" || name === "quota-warning-weekly") {
    // R-QUOTA-01: one toast names the subscription, its window, what is left and when it resets; words only.
    const notes = [...document.querySelectorAll(".toast .quota-warning")].filter(visible);
    require(notes.length === 1, `one toast says it: ${notes.length}`);
    const note = notes[0], box = note.closest(".toast").getBoundingClientRect();
    const expected = name === "quota-warning" ? "Codex（5 小時）額度只剩 8%，13:15 重設" : "Claude（每週 · Opus）額度只剩 8%，10/27 08:00 重設";
    require(note.textContent === expected, `which subscription, what is left and when it resets: ${note.textContent}`);
    require(note.getAttribute("role") === "status", "it is read out as a status");
    require(box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5, `the toast is inside the window: ${JSON.stringify(box)}`);
    // Reading the catalogue of models moves nothing; on a loaded machine the composer's own read of it lands after the mark.
    const moved = window.__look.calls.slice(window.__quotaCallsBefore ?? 0)
      .filter(call => call.method !== "models.catalog" && (["members.update", "settings.set"].includes(call.method) || /model/i.test(`${call.method ?? ""} ${call.command ?? ""}`)));
    require(moved.length === 0, `no model, member or setting moves: ${JSON.stringify(moved)}`);
    return { check: name, text: note.textContent, width: Math.round(box.width), height: Math.round(box.height) };
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
    // The link shows its whole address in the link colour, never a shortened name.
    require(chip && visible(chip) && chip.textContent.startsWith("https://x.com/someone/status/") && chip.textContent.endsWith("sample-project-status-notes") && !chip.textContent.includes("…"), `the link stands as its whole address: ${chip?.textContent}`);
    require(input.value.includes(chip.textContent) && input.value.includes("這是用來測試的範例"), "the field holds the whole address and the words");
    const probe = document.createElement("i"); probe.style.color = "var(--link)"; document.documentElement.append(probe);
    const link = getComputedStyle(probe).color; probe.remove();
    require(getComputedStyle(chip).color === link && link !== getComputedStyle(mirror).color, `the address is in the link colour: ${getComputedStyle(chip).color} / ${link}`);
    require(getComputedStyle(input).color !== getComputedStyle(mirror).color, "only the copy is painted");
    require(Math.abs(input.scrollHeight - mirror.scrollHeight) <= 1, `the field and its copy wrap alike: ${input.scrollHeight} / ${mirror.scrollHeight}`);
    require(mirror.scrollWidth <= mirror.clientWidth + 1, `the address wraps inside the field: ${mirror.scrollWidth} / ${mirror.clientWidth}`);
    return { check: name, name: chip.textContent, height: input.scrollHeight };
  }
  if (name === "composer-link-sent") {
    const sent = window.__look.calls.filter(call => call.command === "agent_ask_text").at(-1);
    require(sent?.text?.includes("ref_src=twsrc") && sent.text.startsWith("https://x.com/someone/status/"), `the whole address goes out: ${sent?.text}`);
    require(document.querySelector(".composer .cmp-mirror .url-chip") === null, "the field is empty again");
    require(sent.text.startsWith("https://x.com/someone/status/") && sent.text.endsWith("這是用來測試的範例") && sent.text.includes("sample-project-status-notes"), `the link goes out whole, with the words after it: ${sent?.text}`);
    return { check: name };
  }
  if (name === "room-link-sent") {
    const sent = window.__look.calls.filter(call => call.method === "rooms.send").at(-1);
    require(sent?.params.text.includes("ref_src=twsrc") && sent.params.text.startsWith("https://x.com/someone/status/"), `the whole address goes out: ${sent?.params.text}`);
    const probe = document.createElement("i"); probe.style.color = "var(--link)"; document.documentElement.append(probe);
    const link = getComputedStyle(probe).color; probe.remove();
    const shown = [...document.querySelectorAll(".au-room-message .message-link")].filter(visible).at(-1);
    // A link is a chip in the words (R-UI-82): its site, or its page's title once read, over the whole address it opens.
    require(shown && shown.matches(".link-chip") && shown.dataset.url.includes("ref_src=twsrc") && shown.dataset.url.startsWith("https://x.com/someone/status/") && shown.querySelector(".link-name")?.textContent.trim(),
      `the group's message links the whole address as a chip: ${shown?.textContent} → ${shown?.dataset.url}`);
    require(getComputedStyle(shown).color === link, `in the link colour: ${getComputedStyle(shown).color} / ${link}`);
    return { check: name };
  }
  if (name === "room-composer-files") {
    const chips = [...document.querySelectorAll(".au-room-pane .composer .cmp-chip")];
    require(chips.length === 2, `both files are on the composer: ${chips.length}`);
    for (const chip of chips) {
      const thumb = chip.querySelector("img.cmp-thumb");
      require(thumb?.complete && thumb.naturalWidth > 0, "each shows its picture");
      require(chip.querySelector(".chip-x")?.getAttribute("aria-label"), "each can be taken off");
      // Only the picture: no name or size, and its remove button inside it.
      require(chip.textContent.trim() === "", `a picture prints no name or size: ${chip.textContent.trim()}`);
      const box = chip.getBoundingClientRect(), x = chip.querySelector(".chip-x").getBoundingClientRect();
      require(x.left >= box.left && x.right <= box.right && x.top >= box.top && x.bottom <= box.bottom, "its remove button sits inside the picture");
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
  if (name === "chat-pairing-bottom") {
    // A later code follows the talk: the last turn of the thread, its card drawn though the turn has no words.
    const turns = [...document.querySelectorAll('.page-agent .thread > li.tn')].filter(visible);
    require(turns.at(-1)?.querySelector('[data-pairing-card="pair-late"]'), "the later pairing card is the last thing in the conversation");
    require(visible(turns.at(-1).querySelector('[data-pairing-card="pair-late"] [data-act="pairing-allow"]')), "it can be allowed there");
    require(!turns.at(-1).querySelector('.me'), "no empty owner bubble above it");
    const field = document.querySelector('.page-agent .composer textarea, .page-agent .composer [contenteditable]');
    require(field?.getAttribute('placeholder') === "關於 Slack 的設定，直接問我", `the field asks about the Slack setup that waits: ${field?.getAttribute('placeholder')}`);
    return { check: name };
  }
  if (name === "guide-window-fixed") {
    // The guide's window is its card, fixed; the language dropdown stands without a label.
    const calls = window.__look.windowCalls ?? [], size = JSON.stringify(calls.find(call => call.command === "set_size")?.args ?? {});
    require(document.documentElement.dataset.windowFixed === "true", "the window is fixed while the guide is up");
    require(size.includes("1080") && size.includes("752"), `the window is asked to be the card under the control strip: ${size}`);
    require(calls.some(call => call.command === "set_resizable" && call.args.value === false), "it cannot be resized");
    require(calls.some(call => call.command === "set_maximizable" && call.args.value === false), "it cannot be maximized");
    require(!visible(document.querySelector('[data-window-action="maximize"]')), "no maximize button while it is fixed");
    require(!document.querySelector(".ob-lang-label") && document.querySelector(".ob-lang .lang-btn"), "the language button stands alone at the top left");
    return { check: name };
  }
  if (name === "history-sent-to") {
    // Speech sent to a member is kept with the dictations and says who it went to.
    const metas = [...document.querySelectorAll(".hrow .meta")].map(meta => meta.textContent.trim());
    require(metas.includes("傳給 拉斐爾"), `a spoken message names who it went to: ${metas.join(" | ")}`);
    require(metas.includes("notepad"), "a dictation still names its program");
    return { check: name };
  }
  if (name === "room-picture-opened") {
    const card = document.querySelector(".media-lightbox .lb-card"), large = card?.querySelector(".lb-img"), close = card?.querySelector(".lb-close");
    require(large?.complete && large.naturalWidth > 0, "the picture opens large");
    // Only the picture, with its close button inside it.
    require(!card.querySelector(".lb-head, .lb-title, h2"), "no bar above the picture");
    const picture = large.getBoundingClientRect(), x = close.getBoundingClientRect();
    require(x.left >= picture.left && x.right <= picture.right && x.top >= picture.top && x.bottom <= picture.bottom, "the close button sits inside the picture");
    require(picture.width >= Math.min(large.naturalWidth, innerWidth * 0.5) - 1, `the picture is not shrunk: ${Math.round(picture.width)} of ${large.naturalWidth}`);
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
    // Conversations have no search field since each member has one; the first block sets the inset.
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
  if(name === "dictation-layout") {
    const cards=[...document.querySelectorAll('.page-overview .icard')].map(el=>el.getBoundingClientRect()), keys=document.querySelector('.keys-card').getBoundingClientRect(), activity=document.querySelector('.activity').getBoundingClientRect();
    require(cards.length===4 && Math.abs(cards[0].top-cards[1].top)<1 && cards[2].top>cards[0].bottom && Math.abs(cards[2].top-cards[3].top)<1,"dictation stats form a 2 by 2 grid");
    // Side by side the heatmap is the wide band under the totals and the shortcuts (R-UI-06); stacked, it follows the totals.
    require(Math.abs(activity.right-(keys.left>cards[1].right?keys.right:cards[1].right))<1,"activity spans the page's content to its right edge");
    if(keys.left>cards[1].right) require(Math.abs(keys.top-cards[0].top)<1 && Math.abs(keys.bottom-cards[2].bottom)<1 && activity.top>=Math.max(cards[2].bottom,keys.bottom) && Math.abs(activity.left-cards[0].left)<1,"shortcuts stand beside the totals and end with them, and the heatmap runs under both");
    else require(activity.top>=cards[2].bottom && keys.top>=activity.bottom,"narrow order is stats, activity, shortcuts");
    return {check:name,columns:keys.left>cards[1].right?2:1};
  }
  if(name === "thread-measure") {
    const composer=[...document.querySelectorAll('.page-agent .composer')].find(el=>visible(el)&&!el.closest('[hidden]')), cap=parseFloat(getComputedStyle(composer).maxWidth);
    require(cap===960,"thread and composer use the shared 30-space 960px measure, the shared column");
    require(composer.getBoundingClientRect().width<=cap+1,"composer respects its measure");
    if(innerWidth<1440) require(!document.querySelector('.page-agent[data-det="open"]'),"details start collapsed before they crowd the thread");
    return {check:name,width:composer.getBoundingClientRect().width,cap};
  }
  if (name === "thread-edges") {
    // R-UI-45: a conversation's column starts and ends where its composer does, at every window size (the judge on
    // 2d5e3cf8: at 720 the messages began at 20 px and the composer at 32). The column is the thread, the search field over
    // it and the members' conversation laid over it; the owner's last mark (a bubble, or the owner's face in a group's side
    // thread) ends at the composer's right edge and a reply begins at its left. A group's side thread keeps the same rule.
    // In the group itself the faces hang in the gutter beside the column (2026-11-11; the judge on 6e2ca315 read the face's
    // slot as the messages starting 32 px inside the composer), so there the words and cards (`.ra-body`) and the owner's
    // bubble are measured, and each face must stand beside the column, inside the scroll, never over it or cut by it.
    const shown = element => visible(element) && !element.closest('[hidden]');
    const round = value => Math.round(value * 10) / 10;
    const edges = [];
    const align = (where, composer, column, scope = column) => {
      const dock = composer.getBoundingClientRect(), box = column.getBoundingClientRect();
      require(Math.abs(box.left - dock.left) <= 1 && Math.abs(box.right - dock.right) <= 1, `${where} spans the composer's edges: ${round(box.left)}-${round(box.right)} against ${round(dock.left)}-${round(dock.right)}`);
      const hung = column.matches('.ra-col') && !!column.querySelector('.au-room-thread');
      const owner = [...scope.querySelectorAll(hung ? '.me .bubble' : '.me .bubble, .me > .owner-face')].filter(shown).map(element => element.getBoundingClientRect().right);
      const replies = [...scope.querySelectorAll('.ra')].filter(shown).map(element => element.getBoundingClientRect().left);
      if (owner.length) require(Math.abs(Math.max(...owner) - dock.right) <= 1, `${where}: the owner's messages end at the composer's right edge (${round(Math.max(...owner))} against ${round(dock.right)})`);
      if (replies.length) require(Math.abs(Math.min(...replies) - dock.left) <= 1, `${where}: replies begin at the composer's left edge (${round(Math.min(...replies))} against ${round(dock.left)})`);
      if (hung) {
        const words = [...scope.querySelectorAll('.ra > .ra-body')].filter(shown).map(element => element.getBoundingClientRect().left), edge = column.closest('.ra-scroll').getBoundingClientRect();
        if (words.length) require(Math.abs(Math.min(...words) - dock.left) <= 1, `${where}: words and cards begin at the composer's left edge (${round(Math.min(...words))} against ${round(dock.left)})`);
        for (const face of [...scope.querySelectorAll('.ra > .ra-face')].filter(shown)) {
          const at = face.getBoundingClientRect();
          require(at.right <= dock.left + 0.5 && at.left >= edge.left - 0.5, `${where}: a member's face hangs in the left gutter, inside the scroll (${round(at.left)}-${round(at.right)} against ${round(edge.left)}-${round(dock.left)})`);
        }
        for (const face of [...scope.querySelectorAll('.me > .owner-face')].filter(shown)) {
          const at = face.getBoundingClientRect();
          require(at.left >= dock.right - 0.5 && at.right <= edge.right + 0.5, `${where}: the owner's face hangs in the right gutter, inside the scroll (${round(at.left)}-${round(at.right)} against ${round(dock.right)}-${round(edge.right)})`);
        }
      }
      edges.push({ where, left: round(box.left), right: round(box.right), composer: [round(dock.left), round(dock.right)], owner: owner.length, replies: replies.length, hung });
    };
    for (const stage of document.querySelectorAll('.ra-stage')) {
      const composer = stage.querySelector(':scope > .ra-dock > .composer');
      if (!shown(stage) || !shown(composer)) continue;
      const chat = stage.parentElement, thread = stage.querySelector(':scope > .ra-scroll > .ra-col');
      const find = chat.querySelector(':scope > .ra-find'), peer = chat.querySelector(':scope > .peer-chat .peer-thread');
      if (shown(thread)) align("the thread", composer, thread);
      if (shown(find)) align("the search field", composer, find);
      if (shown(peer)) align("the members' conversation", composer, peer);
    }
    for (const pane of document.querySelectorAll('.room-side-thread')) {
      const composer = pane.querySelector(':scope > .room-thread-dock > .composer'), scroll = pane.querySelector(':scope > .room-side-scroll');
      const column = [...(scroll?.children ?? [])].find(shown);
      if (shown(composer) && column) align("the side thread", composer, column, scroll);
    }
    return { check: name, edges };
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
    // Connect apps on its own uses its dialog's whole width; a settings pane keeps the 640 px measure.
    const host=document.querySelector('.modal-body'), style=getComputedStyle(host), measure=host.closest('[data-standalone]')?Infinity:640, right=host.getBoundingClientRect().left+parseFloat(style.paddingLeft)+Math.min(measure,host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
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
  if (name === "cancel-armed" || name === "cancel-cleared") {
    const button = document.querySelector('[data-cancel-armed="true"]');
    if(name === "cancel-cleared") { require(!button,"other input clears the gesture");return {check:name}; }
    require(visible(button),"the targeted Stop is visibly armed");
    // The armed Escape lasts 1.5 s of real time, less than a capture of a large window under load took: the 1920 picture of
    // a passing check showed a Stop that was no longer armed (2026-11-11). Hold the window open for the picture.
    import('/src/shared/cancel-gesture.ts').then(({ cancelGesture }) => clearTimeout(cancelGesture().timer));
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
      for (const selector of ['.cs-apps .cs-chips', '.cs-results']) {
        const control = settings.querySelector(selector);
        if (visible(control)) require(Math.abs(control.getBoundingClientRect().right - edge.right) <= 1, `settings toolbar shares the content right edge: ${selector}`);
      }
    }
    for (const grid of document.querySelectorAll('.cs-apps .cs-grid')) {
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
    const limits = { word: 10 * space, card: 12 * space, reading: 20 * space, thread: 30 * space, page: 3 * 12 * space + 2 * gap + 2 * space, workspace: 55 * space };
    const groups = [
      ['word', '.wrow'],
      // The details panel's rows follow the panel's width: the panel's drag bounds them.
      ['card', '.cs-card:not([data-standalone] .cs-card), .run-tile, .au-occurrence, .icard, .keys-card:not(.page-overview .keys-card)'],
      // A store row in Connect apps on its own is one of two columns in a wide dialog: a reading line.
      ['reading', '.card:not(.activity):not(.keys-card), .row:not([data-standalone] .cs-box .row), .list, .slist, .hist-top, .hrow, .cs-item, [data-standalone] .cs-card, .mb-row, .mb-rt, .conversation-row, .ask-card, .bgq-card'],
      ['thread', '.ra-col, .composer'],
      // Connected apps are two columns of short rows: the list is a page-wide grid, each row a reading line.
      ['page', '.page:not(.page-agent), .modal, .page-overview .keys-card, .cs-list'],
      ['workspace', '.au-page'],
    ];
    const measurements = [];
    for (const [kind, selector] of groups) for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || element.closest('[hidden]')) continue;
      // Everything in the details panel is as wide as the panel; the panel's drag bounds keep it sane.
      if (element.closest('.mb-det')) continue;
      let scale = 1;
      const width = element.getBoundingClientRect().width / scale;
      measurements.push({ kind, class: element.className, width: Math.round(width * 100) / 100, max: limits[kind] });
    }
    const violations = measurements.filter(item => item.width > item.max + 1);
    require(violations.length === 0, `stretched content: ${JSON.stringify(violations)}`);
    return { check: name, limits, measurements };
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
      // A file's type badge is its own name's extension (「PDF」), the owner's, not interface copy.
      if (!text || !visible(element) || element.closest('[hidden], [inert], script, style, input, textarea, .message-text, .mb-preview, .mb-pv, .attachment-icon')) continue;
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
    // One conversation per member: Raphael's panel has his conversation and his quick questions, nothing to add.
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
    require(reactions.map(button => button.dataset.lead).join(" ") === "👍 😂 👎 ❤️ 🎉 +" && reactions.every(visible), "The five quick reactions and the slot for every emoji stand above the items");
    require(reactions[0].getBoundingClientRect().bottom <= menu.querySelector('[data-pick]').getBoundingClientRect().top + 1, "the reactions come first");
    return { check: name, picks };
  }
  if (name === "reaction-bar") {
    const bar = document.querySelector('#app-popover.reaction-bar');
    require(visible(bar), "the quick bar is open");
    const slots = [...bar.querySelectorAll('[data-quick]')];
    require(slots.map(slot => slot.dataset.quick).join(" ") === "👍 😂 👎 ❤️ 🎉 +", "five quick reactions in the fixed order, then every emoji");
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
    require(box.width >= 280 && box.width <= 320 && box.height <= 360, "the card measures about 300 by 340 px");
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
  if (name === "composer-voice-attachment") {
    // One press on the voice button sends the recording and everything the composer held (owner, 2026-11-14): the picture and the words go to
    // the recording before its key ends it, and the composer is empty afterwards, as after a typed send.
    const calls = window.__look.calls, handed = calls.filter(call => call.command === "agent_voice_composed"), keys = calls.filter(call => call.command === "window_hotkey" && ["agent_down", "agent_up"].includes(call.kind));
    require(handed.length === 1, `the composer was handed over once: ${handed.length}`);
    const [composed] = handed;
    require(composed.text === "Look at this picture" && Array.isArray(composed.attachments) && composed.attachments.length === 1 && composed.attachments[0].mime.startsWith("image/") && typeof composed.attachments[0].data === "string" && composed.attachments[0].data.length > 0, `the words and the picture went with the recording: ${JSON.stringify({ ...composed, attachments: (composed.attachments ?? []).map(file => [file.name, file.mime]) })}`);
    require(keys.length >= 1 && calls.indexOf(composed) < calls.indexOf(keys.at(-1)), "they were handed over before the key ended the recording");
    require(keys.every(call => call.conversationId === composed.conversationId && (call.memberId ?? 0) === (composed.memberId ?? 0)), "the key and the composer name the same conversation");
    require(!calls.some(call => call.command === "agent_ask_text"), "no second, typed message was sent");
    const form = [...document.querySelectorAll('.composer')].find(visible);
    require(form.querySelector('textarea').value === "" && !form.querySelector('.cmp-chip'), "the composer is empty, as after a typed send");
    return { check: name, member: composed.memberId ?? 0, conversation: composed.conversationId, files: composed.attachments.length };
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
    if(name==='p04-blocked'){const chat=document.querySelector('.peer-chat'),task=window.__look.data.roomHandoffs[0],lines=[...(chat?.querySelectorAll('.peer-line')??[])];require(visible(chat)&&chat.querySelector('.peer-state')?.textContent.includes('缺少驗收所需的檔案'),'missing artifact reason is actionable');require(lines[0]?.dataset.peerFrom===String(task.from_member_id)&&lines[0].querySelector('.message-text')?.textContent===task.request,"the request is only ever the delegating member's own message");}
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
      // The apps are the connected ones of the same inventory (a switched-off connection is not one the member can use).
      const apps = data.managedConnectors.filter(app => app.enabled && app.status === "ACTIVE").map(app => app.name || "Google");
      require(apps.length > 0 && apps.every(app => menu.textContent.includes(app)), "apps come from the same snapshot");
      require(!menu.querySelector('.menu-head') && !data.servers.some(app => menu.textContent.includes(app.name)), "no heading, and no connection that is switched off");
      const rows = [...menu.querySelectorAll('button')], row = label => rows.find(item => item.querySelector('.mt').textContent === label);
      for (const item of rows) require(visible(item.querySelector('.mlead > *')), `${item.textContent} leads with a face or a mark`);
      require(row(data.members[1].name)?.querySelector('.mlead .av'), "a bot shows its member face");
      require(row(data.members[1].name)?.querySelector('.mtrail')?.textContent === "成員", "a bot says it is a member at the right");
      for (const app of apps) {
        require(row(app)?.querySelector('.mlead .mono'), `${app} shows its connection mark`);
        require(row(app).querySelector('.mtrail')?.textContent === "應用程式", `${app} says it is an app at the right`);
      }
      const columns = selector => rows.map(item => item.querySelector(selector).getBoundingClientRect().left);
      for (const selector of ['.mlead', '.mt']) require(Math.max(...columns(selector)) - Math.min(...columns(selector)) <= 1, `${selector} aligns in one column`);
    }
    // The members are one list of rows: a chosen one is pressed with its check on the right.
    if (name === "p02-picker") {
      const chosen = [...document.querySelectorAll('.room-list .room-row[aria-pressed="true"]')];
      require(chosen.length === 2 && chosen.every(row => visible(row.querySelector('.room-row-mark'))), "Raphael and the selected colleague are chosen rows with their check");
      require(!document.querySelector('.room-picked'), "no separate list of picked names");
    }
    // A routing fallback is the room's own business: no line about it in the room.
    if (name === "p02-fallback") require(!document.body.textContent.includes("預設成員回覆"), "no line tells the owner about a routing fallback");
    if (name === "p02-blocked") {
      const lines = eventLines(3), rows = [...document.querySelectorAll('.au-room-thread > li')];
      require(lines.every(line => line.closest('.au-room-thread > li.room-intent-blocked')), "blocked replies are lines of the thread");
      require(!document.querySelector('.au-room-controls')?.textContent.trim(), "nothing about blocked replies sits above the composer");
      const at = selector => rows.indexOf(document.querySelector(selector)?.closest('li'));
      const blocked = rows.filter(row => row.matches('.room-intent-blocked')).map(row => rows.indexOf(row));
      require(blocked[0] === at('[data-room-message="2"]') + 1 && blocked[1] === at('[data-room-message="7"]') + 1 && blocked[2] === blocked[1] + 1, "each blocked reply stands where its exchange stopped");
      require(lines[0].textContent === "小森 未能回覆：請求太頻繁而被限流" && lines[1].textContent === "小晴 未能回覆：已停止", "blocked replies name the member and why in the window language");
    }
    // A reply that does not finish is a status line, never words in a member's or the chief's mouth (2026-11-10).
    if (name === "p02-reply-status") {
      const lines = eventLines(2), rows = [...document.querySelectorAll('.au-room-thread > li')];
      require(lines.every(line => line.closest('.au-room-thread > li.room-intent-blocked')), "unfinished replies are lines of the thread");
      require(lines[0].textContent === "小森 未能回覆：太久沒有進展" && lines[1].textContent === "小晴 未能回覆：沒有給出回答",
        "each line says why in words, never 「發生錯誤」");
      const at = selector => rows.indexOf(document.querySelector(selector)?.closest('li'));
      const blocked = rows.filter(row => row.matches('.room-intent-blocked')).map(row => rows.indexOf(row));
      require(blocked[0] === at('[data-room-message="2"]') + 1 && blocked[1] === at('[data-room-message="7"]') + 1, "each line stands where its exchange stopped");
      require(rows.filter(row => row.querySelector('.ra')).length === 1, "only the reply that came is a member's bubble");
      require(!document.querySelector('.au-room-wrapup'), "no one sums the failures up in the chief's name");
    }
    if (name === "p02-meeting-event") {
      // The day divider is no longer an event line; the meeting stays one line (an exchange).
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
    require(!/[{}]|"[A-Za-z_]+"\s*:/.test(document.querySelector('.mb-chat, .page-agent')?.textContent ?? ""), "no raw JSON is shown");
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
    // Colleague exchanges and a meeting the chief opened each use one centred line (R-UI-101).
    // Other public notices fold into the reply's work.
    const nodes = eventLines(2), lines = nodes.map(line => line.textContent);
    const historic = window.__look.data.turns.find(turn => turn.id === 1).messages.find(message => message.kind === 'event' && message.seq !== 99);
    const body = document.querySelector('.tn[data-id="1"] .work-body[hidden]');
    require(lines[0].includes("3 則訊息") && lines[1].includes("已開啟會議 產品方向討論") && body?.textContent.includes(historic.text), 'colleague exchanges and the meeting stay outside collapsed work, other notices fold');
    require(document.querySelector('[data-handoff-group] .event-state')?.textContent === "進行中", "the exchanges' line shows the one state of the unfinished exchange (R-UI-72)");
    return { check: name, lines };
  }
  if (name.startsWith("handoff-group")) {
    const groups = [...document.querySelectorAll('[data-handoff-group]')].filter(visible);
    require(groups.length === (name === "handoff-group-room" ? 3 : 1), "only consecutive exchanges fold together");
    for (const group of groups) {
      const line = group.querySelector('.event-line'), box = line.getBoundingClientRect(), column = line.closest('.ra-col').getBoundingClientRect();
      require(group.matches('button[data-act="peer-chat"]'), "the exchanges' line is a button that opens their conversation");
      require(Math.abs(box.left + box.width / 2 - column.left - column.width / 2) < 2, "exchange group is centred");
      require(box.left >= column.left - 1 && box.right <= column.right + 1, "names stay inside the conversation column");
      require(!line.querySelector('.i'), "no disclosure chevron");
    }
    const group = groups[0], summary = group, words = summary.textContent;
    require(!document.querySelector('.handoff-detail:not(.exchange-detail)'), "what was said waits in the members' conversation, not under the line");
    if (name === "handoff-group-open") {
      const chat = document.querySelector('.mb-chat > .peer-chat');
      require(group === window.__handoffGroup, "the same line survives arriving data");
      require(chat && chat === window.__peerChat && visible(chat), "the open conversation between members stays open as work arrives");
      require(chat.querySelector('[data-peer-key="850"]'), "the arriving exchange joins the open conversation");
      require(document.querySelector('.tn[data-id="1"] .me') === window.__handoffOwner && document.querySelector('.tn[data-id="1"] .ra') === window.__handoffAnswer, "new work leaves the question and answer nodes untouched");
      require(words.includes("15 則訊息"), "new work updates the count");
      require(visible(chat.querySelector('.peer-line .message-text')) && visible(chat.querySelector('.handoff-files')), "the requests, answers and files are readable in the conversation");
    }
    if (name === "handoff-group-room") {
      // A room takes nobody's side (owner, 2026-11-09): a line names both members, one pair in a row folds into one
      // line, and work a member handed itself is a line of its own that opens the member's conversation.
      require(groups.every(item => item.querySelectorAll('.event-person').length === 2), "a room's exchange line names both members");
      require(words.startsWith("拉斐爾") && words.includes("Ada") && words.includes("3 則訊息"), `the same pair in a row is one line (${words})`);
      const own = [...document.querySelectorAll('.au-room-thread .own-work-event')].filter(visible);
      require(own.length === 1 && own[0].matches('button[data-room-act="private-work"]:not([data-act]):not([data-handoff-group])'), "own work is its own line, never a conversation between members");
      require(own[0].textContent.startsWith("Ben 的私人工作") && own[0].querySelector('.event-state')?.textContent === "等待你回答 · 1 項", "own work names its member and its state");
      const line = own[0].querySelector('.event-line'), box = line.getBoundingClientRect(), column = line.closest('.ra-col').getBoundingClientRect();
      require(Math.abs(box.left + box.width / 2 - column.left - column.width / 2) < 2 && box.left >= column.left - 1 && box.right <= column.right + 1, "own work line is centred in the column");
    }
    if (name === "handoff-group-done") require(!summary.querySelector('.event-state'), "done has no state words");
    if (name === "handoff-group-many") require(summary.querySelectorAll('.event-person').length === 3 && words.includes("其他 3 位"), "three people and a remainder");
    if (name === "handoff-group") {
      require(words.includes("13 則訊息"), "the count is every message said, repeated people included");
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
    const asked = window.__look.calls.filter(call => call.method === "members.delete");
    require(asked.length === 1 && JSON.stringify(asked[0].params) === '{"id":2}', "the core is asked once to delete that member, and nothing else is sent with it");    require(!window.__look.data.members.some(item => item.id === 2) && !document.querySelector('[data-member="2"]'), "the member is gone from the team and the list");
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
    require(JSON.stringify(calls[0].params.edits) === JSON.stringify([{ before: "Please use Sample Too", after: "Please use SampleToolX" }]), "dictation evidence reaches the shared native tracker unchanged");
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
    const chip = document.querySelector(`[data-room-message="${id}"] .room-quote`);
    require(visible(chip), 'source chip is visible');
    require((chip.querySelector('.quote-author') ?? chip.querySelector('.quote-text')).textContent === (name === 'room-reply-owner' ? '你' : name === 'room-reply-peer' ? '小晴' : '來源訊息已無法取得'), 'the quote names the source the server gave');
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
    // Each member has one conversation (2026-11-06, 3cd7fa91, R-UI-86 retired): Raphael's main one is the first row and the one a window opens,
    // and his quick questions wait in the second, named only when the owner picks it.
    const rows = [...document.querySelectorAll('.mb-det [data-conversation-open]')];
    require(rows.length === 2, `Raphael's details list his main conversation and his quick questions: ${rows.length}`);
    const [main, quick] = rows;
    require(main.dataset.conversationOpen !== "4" && main.textContent.includes("主要對話"), "the main conversation is the first row");
    require(main.getAttribute('aria-current') === "true" && quick.getAttribute('aria-current') === "false", "the window has the main conversation open, never the quick questions");
    require(quick.dataset.conversationOpen === "4" && quick.textContent.includes("快速提問"), "the quick questions follow, with the window-language title");
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
    // The model stays recorded in the reply's closed work detail (R-UI-120: the detail is never opened from the reply).
    const meta = turn.querySelector('.work-meta')?.textContent ?? "";
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
  if (name.startsWith("overlay-locale-")) {
    const locale = name.slice("overlay-locale-".length);
    require(document.documentElement.lang === locale, "native settings select the subtitle locale");
    const line = document.querySelector(".subs.on .sub-line");
    require(visible(line) && line.textContent.startsWith("《"), "localized production subtitle is visible");
    const bounds = line.getBoundingClientRect(), style = getComputedStyle(line);
    require(bounds.height <= 2 * parseFloat(style.lineHeight) + 1, "localized subtitle occupies at most two lines");
    require(bounds.left >= 0 && bounds.right <= innerWidth + 1, "localized subtitle stays within the window");
    const expected = {ko: "Malgun Gothic", th: "Leelawadee UI", de: "Inter"}[locale];
    require(style.fontFamily.includes(expected), "subtitle uses its installed script font fallback");
    return { check: name, locale, text: line.textContent, font: style.fontFamily };
  }
  if (name === "overlay-pages") {
    const line = document.querySelector(".subs.on .sub-line"), text = line?.textContent ?? "";
    require(text.startsWith("《答。1. 建立範例帳號") && !text.endsWith("》"), "the first page of the answer is on screen, the rest to come");
    require(!/https?:|www\.|\]\(|example\.test/.test(text), "the corner writes no address or link");
    const box = line.getBoundingClientRect(), height = parseFloat(getComputedStyle(line).lineHeight);
    require(box.height <= 2 * height + 1, `a page is two lines at most (${Math.round(box.height / height)})`);
    // The real window is the emblem's canvas and 40 px over it (overlay.rs `place`); the page must stay inside it.
    const canvas = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--c"));
    require(innerHeight - box.top <= canvas + 40, "the page stays inside the overlay window");
    return { check: name, text };
  }
  if (name === "overlay-held-answer") {
    const line = document.querySelector(".subs.on .sub-line");
    require(visible(line) && line.textContent === "《答。台北現在二十四度。》", "the held answer is the line in the corner");
    require(!visible(document.querySelector("#progress")) || !/\d+ %/.test(document.querySelector("#progress").textContent), "the dictation's percentage is gone before the answer");
    require(!visible(document.querySelector("#ask")) && !visible(document.querySelector("#overlay-stop")), "an answer to read has no buttons");
    return { check: name, text: line.textContent };
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
    // The app's one delete dialog, Grok Bot's (owner, 2026-11-12): a small box, the title over one sentence, then one row of two
    // buttons of the same width that fill the box, Cancel then a red Delete; no × and no line inside; the focus on Cancel.
    const dialogs = [...document.querySelectorAll('.mb-dialog.mb-confirm')];
    const dialog = dialogs.at(-1);
    require(visible(dialog) && dialog.classList.contains('mb-delete'), "the delete confirmation is the shared delete dialog");
    const px = value => parseFloat(value) || 0;
    const token = (prop, name) => { const probe = document.createElement('i'); probe.style[prop] = `var(${name})`; document.body.append(probe); const value = getComputedStyle(probe)[prop]; probe.remove(); return value; };
    const buttons = [...dialog.querySelectorAll('.mb-dlg-act .btn')];
    require(buttons.map(button => button.dataset.dlg).join('|') === 'cancel|delete', "Cancel precedes Delete visually and in keyboard order");
    require(document.activeElement === buttons[0], "Cancel receives initial focus, so Enter never deletes");
    require(visible(document.getElementById(dialog.getAttribute('aria-describedby'))), "the irreversible-action description is announced");
    // No ×, no rule line: nothing inside the box but the buttons draws a border, and the head and the footer have none.
    require(!dialog.querySelector('[data-dlg="close"], .btn.icon'), "no × in the box");
    const lines = [...dialog.querySelectorAll('*')].filter(node => !node.closest('.btn') && ['Top', 'Right', 'Bottom', 'Left'].some(side => px(getComputedStyle(node)[`border${side}Width`]) > 0));
    require(lines.length === 0, `no line inside the box (${lines.map(node => node.className || node.tagName).join(', ')})`);
    require(!dialog.querySelector('hr, [role="separator"]'), "no separator element");
    // The box: 320 px wide (less in a narrower window), centred in the window.
    const box = dialog.getBoundingClientRect(), style = getComputedStyle(dialog);
    require(Math.abs(box.width - Math.min(320, innerWidth - 2 * px(getComputedStyle(dialog.parentElement).paddingLeft))) <= 1, `the box is 320 px wide (${box.width})`);
    require(box.left >= 0 && box.right <= innerWidth && Math.abs((box.left + box.right) / 2 - innerWidth / 2) <= 2, "the box is centred in the window");
    // One row of two equal buttons that fill the box's inner width.
    const [cancel, remove] = buttons.map(button => button.getBoundingClientRect());
    const inner = { left: box.left + px(style.borderLeftWidth) + px(style.paddingLeft), right: box.right - px(style.borderRightWidth) - px(style.paddingRight) };
    require(Math.abs(cancel.width - remove.width) <= 1, `the two buttons are the same width (${cancel.width} and ${remove.width})`);
    require(Math.abs(cancel.top - remove.top) <= 0.5 && Math.abs(cancel.height - remove.height) <= 0.5, "the two buttons are one row of one height");
    require(Math.abs(cancel.left - inner.left) <= 1 && Math.abs(remove.right - inner.right) <= 1 && remove.left >= cancel.right, `the buttons fill the box (${cancel.left}..${remove.right} in ${inner.left}..${inner.right})`);
    require(Math.abs(cancel.height - px(token('height', '--h-field'))) <= 0.5, `the buttons take the field height (${cancel.height})`);
    require(buttons.every(button => px(getComputedStyle(button).borderTopLeftRadius) >= cancel.height / 2), "both buttons have fully rounded ends");
    // Delete is red with white words, at the right; Cancel is the quiet button colour.
    const [cancelStyle, removeStyle] = buttons.map(button => getComputedStyle(button));
    require(removeStyle.backgroundColor === token('backgroundColor', '--close') && removeStyle.color === token('color', '--on-close'), `Delete is the danger red with white words (${removeStyle.backgroundColor} on ${removeStyle.color})`);
    require(cancelStyle.backgroundColor === token('backgroundColor', '--float-ctl'), `Cancel is the control colour of a floating surface (${cancelStyle.backgroundColor})`);
    // The words: a title and one sentence in the ordinary text colour.
    const title = dialog.querySelector('h2'), sentences = [...dialog.querySelectorAll('.mb-dlg-body p')];
    require(sentences.length === 1 && getComputedStyle(sentences[0]).color === token('color', '--text'), "one sentence in the ordinary text colour");
    require(px(getComputedStyle(title).fontSize) <= px(token('fontSize', '--fs-sm')) + 0.5, "the title is a compact heading");
    require(title.getBoundingClientRect().bottom <= sentences[0].getBoundingClientRect().top + 1 && sentences[0].getBoundingClientRect().bottom <= cancel.top, "the title, the sentence and the buttons stand in that order");
    // A sentence of two lines or more runs to the box's right edge: no line-balancing that leaves half the box empty
    // (owner, 2026-11-12: 「為什麼字會卡在左邊」). Its longest line takes at least three quarters of the inner width.
    const words = document.createRange();
    words.selectNodeContents(sentences[0]);
    const runs = [...words.getClientRects()].filter(rect => rect.width > 0), tops = new Set(runs.map(rect => Math.round(rect.top)));
    const longest = Math.max(...[...tops].map(top => { const line = runs.filter(rect => Math.round(rect.top) === top); return Math.max(...line.map(rect => rect.right)) - Math.min(...line.map(rect => rect.left)); }));
    require(tops.size < 2 || longest >= 0.75 * (inner.right - inner.left), `the sentence fills the box's width (longest line ${Math.round(longest)} of ${Math.round(inner.right - inner.left)} px over ${tops.size} lines)`);
    return { check: name, sentenceLines: tops.size, longestLine: Math.round(longest), width: box.width, height: box.height, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(px),
      titleSize: px(getComputedStyle(title).fontSize), titleToSentence: sentences[0].getBoundingClientRect().top - title.getBoundingClientRect().bottom,
      sentenceToButtons: cancel.top - sentences[0].getBoundingClientRect().bottom, buttonHeight: cancel.height, cancelWidth: cancel.width, deleteWidth: remove.width, gap: remove.left - cancel.right };
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
  if (name === "room-contained-scroll") {
    const main = document.querySelector(".main"), thread = document.querySelector(".au-room-pane .ra-scroll"), composer = document.querySelector(".au-room-pane .ra-dock .composer");
    // The escaped name only lands outside the main area when the thread is taller than the window.
    require(thread.scrollHeight > innerHeight + 200, "the room thread is taller than the window");
    require(document.querySelectorAll(".au-room-pane .room-quote").length >= 3, "the latest messages carry reply quotes");
    require(main.scrollTop === 0 && main.scrollHeight <= main.clientHeight + 1, `the main area stays put (scrollTop ${main.scrollTop}, height ${main.scrollHeight} in ${main.clientHeight})`);
    require(Math.abs(thread.scrollTop + thread.clientHeight - thread.scrollHeight) <= 2, "the wheel reached the end of the thread itself");
    require(innerHeight - composer.getBoundingClientRect().bottom < 48, "the composer stays at the bottom of the window");
    // A screen-reader name is placed absolutely; its box must be the thread, or it escapes the clip and stretches the main area.
    for (const author of document.querySelectorAll(".au-room-pane .au-room-author")) require(!author.offsetParent || author.offsetParent === thread || thread.contains(author.offsetParent), "a room author's name stays inside the thread it scrolls with");
    return { check: name, main: { scrollTop: main.scrollTop, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight }, thread: { scrollTop: Math.round(thread.scrollTop), scrollHeight: thread.scrollHeight, clientHeight: thread.clientHeight } };
  }
  if (name === "room-discussion") {
    require(document.querySelectorAll('.room-quote').length >= 3, "multiple replies quote their colleagues");
    require(document.querySelector('.au-room-thread').textContent.includes('我不同意'), "members can disagree");
    require(visible(document.querySelector('.au-room-crown')), "Raphael has the chief badge");
    const crown = document.querySelector('.au-room-crown').getBoundingClientRect();
    const face = document.querySelector('.au-room-crown').parentElement.getBoundingClientRect();
    require(crown.right <= face.right && crown.left >= face.left, "the chief badge stays inside its participant slot");
    // Messages carry face, name and reply chip only; roles stay with the faces of the header and the member column.
    require(document.querySelectorAll('.au-room-participant[data-tooltip*=" · "]').length === 3, "header faces name each member and role");
    require(!document.querySelector('.au-room-meta, .au-room-reply'), "no tag line above a message: whom it answers is quoted in its bubble");
    // Each message is led by its face alone; the name is for screen readers and the face's tooltip.
    require([...document.querySelectorAll('.au-room-message .au-room-author')].every(author => author.getBoundingClientRect().width <= 1 && author.textContent.trim()), "no name line above a message, but a name for screen readers");
    require([...document.querySelectorAll('.au-room-message .ra-face')].every(face => face.dataset.tooltip), "a message's face names its member on hover");
    // The face is small and stands at the lower left of the member's words, as Grok Bot's group (owner, 2026-11-10).
    for (const face of document.querySelectorAll('.au-room-message .ra > .ra-face')) {
      const bubble = face.closest('.ra').querySelector('.ans, .bubble');
      if (!bubble) continue;
      const bubbles = [...face.closest('.ra').querySelectorAll('.ans, .bubble')].filter(visible);
      const last = bubbles[bubbles.length - 1] ?? bubble;
      const f = face.getBoundingClientRect(), b = bubble.getBoundingClientRect(), l = last.getBoundingClientRect();
      require(f.width <= 28 && f.right <= b.left + 1, `a message's face is small and beside its words (${Math.round(f.width)} px)`);
      require(Math.abs(f.bottom - l.bottom) <= 8 && f.top >= b.top - 1, "a message's face stands at the lower left of its words, by its last bubble");
      // Whom it answers opens that bubble, as a quote does in a private conversation (2026-11-09: 「回覆 小晴」 above it said too little).
      const quote = bubble.querySelector('.room-quote');
      if (quote) require(bubble.firstElementChild === quote && quote.querySelector('.quote-author')?.textContent.trim() && quote.getBoundingClientRect().left >= b.left, "its reply quote opens the bubble with the source's name");
    }
    return { check: name, replyQuotes: document.querySelectorAll('.room-quote').length };
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
    // Each choice shows its full label in its row.
    const words = document.querySelector('[data-responder] .sel > span');
    require(words && words.scrollWidth <= words.clientWidth + 1, `the default responder shows its whole choice: ${words?.textContent}`);
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
    const quote = document.querySelector('[data-room-message="3"] .room-quote');
    require(visible(quote) && quote.querySelector('.quote-author').textContent === "小晴" && quote.querySelector('.quote-text')?.textContent.trim(), "the reply quotes whom it answers, with their words");
    require(quote.getBoundingClientRect().right <= innerWidth, "the reply quote fits the viewport");
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
    // A group chat takes nobody's side: its receipt names both members of the exchange; the asker's own
    // conversation names the colleague (2026-11-09).
    const inRoom = !!event.closest('.au-room-thread');
    require(event.textContent.startsWith(inRoom ? '拉斐爾和小晴 之間的' : '與 小晴 的'), `the receipt names ${inRoom ? "both members" : "its assignee"} (${event.textContent})`);
    require(visible(event.querySelector('.av')), "the compact line includes the member face");
    eventLines(1);
    require(task.ready_at_ms === task.created_at_ms && task.dispatch_policy === 'immediate', "source dates do not schedule work");
    const chat = document.querySelector('.mb-chat > .peer-chat');
    if (name === "p03-handoff-expanded") {
      const lines = [...chat.querySelectorAll('.peer-line')];
      require(visible(chat) && lines.length === 2, "the line opens the conversation: what was sent and the answer");
      require(lines[0].dataset.peerFrom === String(task.from_member_id) && lines[0].querySelector('.message-text')?.textContent === task.request, "the conversation shows what was asked, from who asked it");
      require(lines[1].dataset.peerFrom === String(task.member_id) && visible(lines[1].querySelector('.message-text')), "the conversation shows the persisted result from the member");
      require(chat.querySelector('.handoff-files')?.textContent === "上線驗收報告.html", "the conversation names the produced file, not its digest");
      require(!/#\d|digest|fixture-report/.test(chat.textContent), "the conversation shows no internal ids");
    } else require(!chat, "the members' conversation opens only from its line");
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
  if (name === "mention-menu-signin-pick") {
    // Pressing an app that is not signed in is a way to its sign-in, not an address: the typed @ goes, the connect dialog opens.
    const composer = [...document.querySelectorAll('.composer textarea')].find(visible);
    require(composer && composer.value === "請用 ", `no address is left in the words: ${JSON.stringify(composer?.value)}`);
    require(!document.querySelector('#app-popover[data-team-mentions]'), "the menu is closed");
    require(visible(document.querySelector('.modal-scrim[data-standalone="connections"] .modal-body .cs')), "the dialog of the apps is open");
    return { check: name, words: composer.value };
  }
  if (name.startsWith("mention-menu-")) {
    // The @ menu is Grok Bot's (owner, 2026-11-13): 360 px, rows of the menu's height, a 16 px face or logo, the name, what is wrong with it,
    // and at the right edge what it is; no heading, no group, no everyone, and the conversation's own member is not in it.
    const data = window.__look.data, composer = [...document.querySelectorAll('.composer textarea, #room-message')].find(visible);
    const menu = document.querySelector('#app-popover[data-team-mentions]');
    require(composer && visible(menu), "the field and the @ menu are on screen");
    const box = menu.getBoundingClientRect(), rows = [...menu.querySelectorAll('[data-value]')], values = rows.map(row => row.dataset.value);
    const token = property => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property));
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;border:1px solid;background:var(--float);border-color:var(--float-edge)';
    document.body.append(probe);
    const wanted = { background: getComputedStyle(probe).backgroundColor, edge: getComputedStyle(probe).borderTopColor };
    probe.remove();
    const look = getComputedStyle(menu);
    require(look.backgroundColor === wanted.background, `the menu stands on --float (${look.backgroundColor} versus ${wanted.background})`);
    require(look.borderTopColor === wanted.edge, "the menu has the --float-edge line");
    require(Math.abs(box.width - Math.min(360, innerWidth - 16)) <= 1, `the menu is 360 px wide, or the window's width less its margins: ${box.width}`);
    require(box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 8 && box.bottom <= innerHeight - 8, "the menu stays inside the window");
    require(menu.scrollHeight <= menu.clientHeight + 1, "the rows fit without an inner scrollbar");
    require(!menu.querySelector('.menu-head, .menu-sep'), "no heading and no group");
    require(!values.includes('所有人') && data.groups.every(group => !values.includes(group.name)), "no group and no everyone");
    require(rows.length > 0 && rows[0].classList.contains('is-active') && rows[0].getAttribute('aria-selected') === 'true', "the first row is the highlighted one");
    require(document.activeElement === composer, "the field keeps the focus");
    const inRoom = name === "mention-menu-room", unit = token('--h-menu');
    if (!inRoom) require(!values.includes(data.members[0].name), "the conversation's own member is not in its menu");
    const kinds = rows.map(row => row.querySelector('.mtrail')?.textContent);
    require(kinds.every(kind => kind === '成員' || kind === '應用程式') && kinds.indexOf('應用程式') >= kinds.lastIndexOf('成員'), "the members come first, then the apps, each saying which it is");
    const trailRights = [];
    for (const row of rows) {
      const frame = row.getBoundingClientRect(), lead = row.querySelector('.mlead'), mark = lead?.firstElementChild, label = row.querySelector('.mt'), tag = row.querySelector('.mtag'), trail = row.querySelector('.mtrail');
      require(Math.abs(frame.height - unit) <= 1, `${row.dataset.value} is a row of the menu's height (${frame.height} versus ${unit})`);
      require(lead && Math.abs(lead.getBoundingClientRect().width - 16) <= 0.5 && visible(mark) && mark.getBoundingClientRect().width <= 16.5 && mark.getBoundingClientRect().height <= 16.5, `${row.dataset.value} leads with a 16 px mark`);
      require(label.scrollWidth <= label.clientWidth + 1, `${row.dataset.value} is not cut`);
      require(label.getBoundingClientRect().left >= lead.getBoundingClientRect().right, "the name follows the mark");
      if (tag) require(tag.getBoundingClientRect().left >= label.getBoundingClientRect().right - 0.5 && tag.getBoundingClientRect().right <= trail.getBoundingClientRect().left, "what is wrong stands right after the name, before the word at the right");
      require(trail.getBoundingClientRect().left >= (tag ?? label).getBoundingClientRect().right - 0.5, "the word at the right stands after the name");
      const pad = parseFloat(getComputedStyle(row).paddingRight);
      require(Math.abs(trail.getBoundingClientRect().right - (frame.right - pad)) <= 1.5, "the word stands at the row's right edge");
      trailRights.push(trail.getBoundingClientRect().right);
      for (const part of [label, trail, ...(tag ? [tag] : [])]) {
        const edges = part.getBoundingClientRect();
        require(edges.top >= frame.top - 0.5 && edges.bottom <= frame.bottom + 0.5, "text stays inside its row");
      }
      if (trail.textContent === '應用程式' && lead.querySelector('.logo-mono[style]')) require(getComputedStyle(lead.querySelector('.logo-mono')).color !== getComputedStyle(label).color, "a brand mark keeps its colour");
    }
    require(Math.max(...trailRights) - Math.min(...trailRights) <= 1, "the words at the right line up");
    const row = value => rows.find(item => item.dataset.value === value);
    if (name === "mention-menu-filter") require(values.join('|') === 'Notion' && kinds[0] === '應用程式', `「@no」 finds Notion (${values})`);
    if (name === "mention-menu-signin" || name === "mention-menu-room") {
      require(row('Notion')?.querySelector('.mtag')?.textContent === '需要登入', "Notion says 需要登入 after its name");
      require(rows.filter(item => item.querySelector('.mtag')).length === 1, "only the app that needs it says so");
    }
    if (name === "mention-menu-room") {
      const allowed = data.rooms.find(room => room.id === 1).member_ids;
      require(data.members.filter(member => !allowed.includes(member.id)).every(member => !values.includes(member.name)), "a group's menu lists only its members");
    }
    if (name === "mention-menu-open") require(!rows.some(item => item.querySelector('.mtag')) && values.includes('Notion'), "an app that is signed in has no tag");
    return { check: name, rows: values, width: box.width, rowHeight: unit };
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
      // The mark leans 3 px left of the @ it covers (agent.css `.mention-ico`, owner 2026-11-07), so it keeps air before the name.
      require(markBox.left >= box.left - 3.5 && markBox.right <= nameRange.getBoundingClientRect().left + 1, `${chipText(chip)}: the mark stands before its name inside the chip (mark ${markBox.left}..${markBox.right}, chip from ${box.left}, name from ${nameRange.getBoundingClientRect().left})`);
      require(markBox.width >= 10 && markBox.width <= 18 && Math.abs(markBox.height - markBox.width) <= 2, `${chipText(chip)}: the mark is a small square (${markBox.width} x ${markBox.height})`);
      require(style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.boxShadow === 'none' && parseFloat(style.borderTopWidth) === 0, `${chipText(chip)}: the logo and the name alone, with no frame or fill`);
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
      // A row that draws no ⋯ has the menu in the row, 16 px in (context-menu.ts).
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
      const near = draft.getBoundingClientRect(), grid = document.querySelector('.au-page:not([hidden]) .au-calendar-scroll').getBoundingClientRect();
      // A slot of the day view can be too wide for either side on the calendar: then the form stands over its start, with a bounded overlay, and never over the rail or the sidebar.
      const sideFits = near.right + 8 + box.width <= innerWidth - 8 || near.left - 8 - box.width >= grid.left;
      if (sideFits) require(box.left >= near.right - 1 || box.right <= near.left + 1, "it stands beside the slot, not over it");
      else require(box.left >= grid.left - 1, "a slot too wide for a side keeps the form over its start, on the calendar, never over the rail or the sidebar");
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
    if (name === "calendar-google-failed") require(/讀不到/.test(words) && /連結應用程式/.test(notice.querySelector('[data-calendar-go]')?.textContent ?? "") && !notice.querySelector('[data-calendar-dismiss]'), "a failed read says so and names where to check");
    require(!rail.querySelector('[data-source="google"]'), "no row for a calendar that is not read");
    require(document.querySelector('.au-page .cal-chip.is-own'), "own events always show");
    return { check: name };
  }
  // A busy day (R-UI-144): the all-day band folds to three rows and counts the rest; 「還有 N 個」 opens it in place to every item, 「收合」 folds it again.
  if (name === "calendar-more-focus") {
    const toggle = document.activeElement;
    require(toggle?.dataset.au === "all-day-toggle", "the keyboard stays on the button it pressed, whichever way the band went");
    return { check: name, words: toggle.textContent, expanded: toggle.getAttribute('aria-expanded') };
  }
  if (name === "calendar-more-month") {
    const cell = document.querySelector('[data-month-day="2026-10-24"] .cal-more:not([hidden])');
    require(visible(cell) && /^還有 \d+ 個$/.test(cell.textContent) && cell.dataset.au === "open-day", "a month's day that does not fit counts the rest and opens that day");
    require(!document.querySelector('#app-popover [role], .au-month-more, .au-day-list'), "no second list over the month");
    return { check: name, words: cell.textContent };
  }
  if (name.startsWith("calendar-more-")) {
    const scroll = document.querySelector('.au-page:not([hidden]) .au-calendar-scroll'), band = scroll.querySelector('.au-all-day-row'), head = scroll.querySelector('.au-grid-head');
    const columns = [...band.querySelectorAll('.au-all-day[data-all-day]')], chips = [...band.querySelectorAll('.au-bar:not(.au-draft) .au-all-day-event')];
    const toggles = [...band.querySelectorAll('[data-au="all-day-toggle"]')], open = head.classList.contains('is-open');
    const gap = parseFloat(getComputedStyle(band).rowGap), pitch = parseFloat(getComputedStyle(band).gridTemplateRows.split(' ')[0]) + gap;
    const overlapping = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    // The items the data holds for a day, and the ones the band draws against its column.
    const dayOf = column => { const [y, m, d] = column.dataset.allDay.split('-').map(Number); return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()]; };
    const expected = column => { const [from, to] = dayOf(column); return window.__look.data.home.calendar_events.filter(item => (item.all_day || item.end_ms - item.at_ms >= 86_400_000) && item.at_ms < to && item.end_ms > from); };
    const standing = column => { const box = column.getBoundingClientRect(); return chips.filter(chip => { const b = chip.getBoundingClientRect(); return b.left < box.right - 1 && b.right > box.left + 1; }); };
    const state = { rows: Number(band.dataset.rows), hoursTop: scroll.querySelector('.au-hours').offsetTop, bandHeight: band.offsetHeight, slot: scroll.querySelector('.au-slot').getBoundingClientRect().height };
    require(columns.length >= 1 && columns.every(column => expected(column).length >= standing(column).length), "the band draws nothing the data does not hold");
    require(band.scrollHeight <= band.clientHeight + 1 && getComputedStyle(band).overflowY === 'visible' && getComputedStyle(head).overflowY === 'visible', "the band has no scrollbar of its own");
    for (const chip of chips) { const box = chip.getBoundingClientRect(), edge = band.getBoundingClientRect(); require(box.bottom <= edge.bottom + 1 && box.height > 0, "no chip of the band is cut off by its edge"); }
    for (const [index, chip] of chips.entries()) for (const other of chips.slice(index + 1)) require(!overlapping(chip.getBoundingClientRect(), other.getBoundingClientRect()), "no two chips of the band overlap");
    for (const toggle of toggles) {
      require(toggle.tagName === 'BUTTON' && !toggle.disabled && toggle.tabIndex >= 0 && visible(toggle) && toggle.getAttribute('aria-controls') === band.id, "the toggle is a real button a keyboard reaches, and it names what it opens");
      require(toggle.getBoundingClientRect().bottom <= band.getBoundingClientRect().bottom + 1 && toggle.scrollWidth <= toggle.clientWidth + 1, "the toggle stands whole inside the band");
      for (const chip of chips) require(!overlapping(toggle.getBoundingClientRect(), chip.getBoundingClientRect()), "the toggle covers no chip");
    }
    if (open) {
      require(toggles.length === 1 && toggles[0].getAttribute('aria-expanded') === 'true' && toggles[0].textContent === '收合', "an open band has one button, 「收合」, saying it is expanded");
      for (const column of columns) {
        const wanted = expected(column), seen = new Set(standing(column).map(chip => chip.dataset.entry));
        require(wanted.length === seen.size && wanted.every(item => seen.has(item.id)), `every item of ${column.dataset.allDay} is in the band: ${seen.size} of ${wanted.length}`);
      }
      // Every chip is in the document and, once scrolled to, whole and under the pointer (the day names that stay on top do not cover it).
      const port = scroll.getBoundingClientRect(), top = port.top + Math.max(...[...head.querySelectorAll('.au-day-head')].map(day => day.getBoundingClientRect().height));
      for (const chip of chips) {
        chip.scrollIntoView({ block: 'center' });
        const box = chip.getBoundingClientRect(), at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        require(box.top >= top - 1 && box.bottom <= port.bottom + 1 && at?.closest('.au-all-day-event') === chip, "every item can be scrolled to and pressed: " + chip.textContent);
      }
      scroll.scrollTop = 0;
      // A month's count lands on the open day with no folded band before it to compare with.
      const before = window.__look.calendarMore, growth = before ? state.bandHeight - before.bandHeight : 0;
      if (before) {
        require(Math.abs(state.hoursTop - before.hoursTop - growth) <= 1 && Math.abs((state.rows - before.rows) * pitch - growth) <= 1, "the hours moved down by what the band grew");
        require(Math.abs(state.slot - before.slot) <= .5, "opening the band moves the hours and never resizes them");
      }
      // The first timed event is still there: scrolled to it, it is whole under the day names; the last hour is at the end.
      const events = [...scroll.querySelectorAll('.au-day-col > .au-event:not(.au-draft)')].sort((a, b) => a.offsetTop - b.offsetTop);
      require(events.length > 0, "the scene has a timed event");
      scroll.scrollTop += events[0].getBoundingClientRect().top - top - 8;
      const box = events[0].getBoundingClientRect();
      require(box.top >= top - 1 && box.bottom <= port.bottom + 1, "the first timed event can be scrolled to under the day names");
      scroll.scrollTop = scroll.scrollHeight;
      require(scroll.querySelector('.au-slot[data-hour="23"]').getBoundingClientRect().bottom <= port.bottom + 1, "the last hour of the day can be scrolled to");
      scroll.scrollTop = 0;
      return { check: name, items: chips.length, rows: state.rows, growth };
    }
    // Folded: three rows at most, each day's button says how many are left and nothing else is hidden.
    require(!band.querySelector('[data-au="open-day"]'), "the band's count is no link to the day it already shows");
    require(new Set(chips.map(chip => chip.closest('.au-bar').style.gridRow)).size <= 3, "a folded band draws three rows at most");
    for (const toggle of toggles) {
      const column = columns.find(item => item.dataset.allDay === toggle.dataset.date), words = toggle.textContent.match(/^還有 (\d+) 個$/);
      require(column && words && toggle.getAttribute('aria-expanded') === 'false', "a folded band's button counts what is left and says it is not expanded");
      require(Number(words[1]) === expected(column).length - standing(column).length, `the button counts the hidden items: ${words[1]} for ${expected(column).length - standing(column).length}`);
    }
    for (const column of columns) require((expected(column).length > standing(column).length) === toggles.some(toggle => toggle.dataset.date === column.dataset.allDay), "a day with items left has a button, a day without has none");
    if (name === "calendar-more-folded") window.__look.calendarMore = state;
    else {
      const before = window.__look.calendarMore;
      require(before && state.rows === before.rows && Math.abs(state.hoursTop - before.hoursTop) <= 1 && Math.abs(state.bandHeight - before.bandHeight) <= 1, "folded again, the band and the hours are where they were");
    }
    return { check: name, toggles: toggles.map(toggle => toggle.textContent), chips: chips.length, rows: state.rows };
  }
  // A new event's draft and the ghost of a drag say their time from start to end where the chip has room for it, and their start alone where it has not (R-UI-142); the whole range then stands in the tooltip.
  if (name === "calendar-draft-time") {
    const times = [...document.querySelectorAll('.au-page:not([hidden]) .au-draft time')].filter(visible);
    require(times.length > 0, "the scene has a draft with a time");
    const range = /^\d{2}:\d{2} – \d{2}:\d{2}$/, start = /^\d{2}:\d{2}$/;
    for (const time of times) {
      const chip = time.closest('.cal-chip'), words = time.textContent;
      require(time.scrollWidth <= time.clientWidth + 1 && time.getBoundingClientRect().right <= chip.getBoundingClientRect().right, `the draft's time is whole in its chip: ${words}`);
      if (range.test(words)) require(!chip.title, "a draft that has room for the range has no tooltip repeating it");
      else require(start.test(words) && range.test(chip.title) && chip.title.startsWith(words), "a draft too narrow for the range says its start and holds the range in its tooltip");
    }
    return { check: name, words: times.map(time => time.textContent) };
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
    require(!document.querySelector('#nav [aria-current="page"]'), "no sidebar entry stands for the calendar: it is opened from the account menu");
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
    // No raw JSON and no sentence of another language on a card of the owner's (owner, 2026-11-11: 「不用這麼複雜」; the standing
    // rules of one language and no raw JSON): no block of code, no brace or quoted key, and every line has a word of 中文.
    require(!card.querySelector('pre:not([hidden])') && !/[{}]|"[A-Za-z_]+"\s*:/.test(card.textContent), "the card shows no JSON");
    const lines = (details.textContent || "").split("\n").map(line => line.trim()).filter(Boolean);
    require(lines.every(line => /[\u3400-\u9fff]/.test(line)), `no line is in another language than the owner's: ${lines.find(line => !/[\u3400-\u9fff]/.test(line))}`);
    require(!/\bID\b/.test(card.textContent), "the card names its target and shows no ID");
    require(!yes.matches('[data-hold]') && !yes.querySelector('.ask-fill'), "the yes has no hold: one press answers");
    if (card.closest('.ask-card-host')?.dataset.tier === 'T3') {
      require(card.querySelector('[data-card-disclosure]').getAttribute('aria-expanded') === 'true' && visible(details), "what cannot be undone is read open, not behind 顯示");
    }
    require(yes.textContent.trim() === "允許" && no.textContent.trim() === "拒絕", "approval uses explicit allow and deny words");
    require(yes.getBoundingClientRect().right <= box.right && yes.getBoundingClientRect().bottom <= innerHeight, "approval action fits the card");
    // 允許 is the first Tab stop and stands rightmost, 拒絕 to its left, as every card's buttons do (R-CARD-01, owner
    // 2026-11-10); this asked for 允許 at the left until 2026-11-10.
    require(yes.compareDocumentPosition(no) & Node.DOCUMENT_POSITION_FOLLOWING && no.getBoundingClientRect().right <= yes.getBoundingClientRect().left, "允許 comes first and stands at the right of 拒絕");
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
  if (name === "admin-delete-many") {
    const cards = [...document.querySelectorAll('.ask-card')].filter(visible);
    require(cards.length === 1, `three changes are one card (${cards.length})`);
    const card = cards[0], details = card.querySelector('.ask-q');
    const lines = details.textContent.split("\n").map(line => line.trim()).filter(Boolean);
    require(lines.length === 4 && lines.slice(0, 3).every(line => /「.+」$/.test(line) && /[\u3400-\u9fff]/.test(line)), `a line each, in the owner's language: ${lines}`);
    require(lines[0].includes("工程師") && lines[1].includes("架構師") && lines[2].includes("Raphael macOS 版規劃"), "each change names its target");
    require(card.querySelector('.card-body.cc-state').textContent.includes("3"), "the card says how many changes it asks for");
    require(card.querySelectorAll('.ask-yes').length === 1 && card.querySelectorAll('.ask-no').length === 1, "one yes and one no");
    require(!card.querySelector('pre:not([hidden])') && !/[{}]|\bID\b/.test(card.textContent), "no JSON and no ID");
    const box = card.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, "the card stands inside the window");
    return { check: name, lines };
  }
  if (name === "admin-answered-once") {
    const answers = window.__look.calls.filter(call => call.command === 'agent_question_answer');
    require(answers.length === 1 && answers[0].approved === true, `one press is one answer (${answers.length})`);
    require(![...document.querySelectorAll('.ask-card-host')].some(visible), "the card settled");
    require(!document.querySelector('.ask-card [data-hold]'), "nothing waited for a hold");
    return { check: name };
  }
  if (name === "member-draft" || name === "member-draft-edit") {
    const panel = [...document.querySelectorAll('.draft-panel')].find(visible);
    require(panel, "draft panel is visible");
    require(![...document.querySelectorAll('.ask-card')].some(visible), "plain ask card is hidden when draft panel is shown");
    const box = panel.getBoundingClientRect();
    require(box.top >= 0 && box.bottom <= innerHeight, "draft panel fits the viewport");
    // The folder's name is one small pill that hugs its field: stretched across the card it showed a narrow white field lost in a grey bar (2026-11-11).
    for (const pill of panel.querySelectorAll('.draft-group-pill')) {
      const field = pill.querySelector('input').getBoundingClientRect(), whole = pill.getBoundingClientRect();
      require(whole.width <= field.width + 56, `the folder pill hugs its field: ${Math.round(whole.width)} wide around a ${Math.round(field.width)} field`);
    }
    const cards = [...panel.querySelectorAll('.draft-card')].filter(visible);
    const confirmBtn = panel.querySelector('[data-draft-act="confirm"]');
    const cancelBtn = panel.querySelector('[data-draft-act="cancel"]');
    require(visible(confirmBtn) && visible(cancelBtn), "confirm and cancel buttons are visible");
    // The primary is the first Tab stop and stands rightmost, 取消 to its left (R-CARD-01, owner 2026-11-10).
    require(confirmBtn.compareDocumentPosition(cancelBtn) & Node.DOCUMENT_POSITION_FOLLOWING && cancelBtn.getBoundingClientRect().right <= confirmBtn.getBoundingClientRect().left, "the primary comes first and stands at the right of 取消");
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
  if (name === "page-card" || name === "page-collapsed" || name === "page-collapsed-two") {
    // A page in a conversation is a card of one fixed height: its title row and only the top of the page, clipped, soft at the cut,
    // nothing in it to press or scroll; the card is one control that opens the page whole (owner, 2026-11-11: a page shown whole
    // made the conversation one very long block).
    const cards = [...document.querySelectorAll(".pg-card")].filter(visible);
    require(cards.length === (name === "page-collapsed-two" ? 2 : 1), `${cards.length} page cards in sight`);
    const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--h-page-peek"));
    require(peek >= 120 && peek <= 200, `the preview is a modest height: ${peek}px`);
    const heights = [];
    for (const card of cards) {
      const body = card.querySelector(".pg-body"), frame = body.querySelector("iframe"), clip = body.getBoundingClientRect(), box = card.getBoundingClientRect();
      require(frame?.getAttribute("sandbox") === "allow-scripts allow-forms", "the page runs sandboxed with an opaque origin");
      require(body.dataset.state === "ready", "the page has loaded");
      require(Math.abs(clip.height - peek) <= 0.5 && getComputedStyle(body).overflow === "hidden", `the preview is ${peek}px and clips (${clip.height})`);
      // Behind the clip the frame is as tall as the page says, from the page's own top, so there is no scrollbar and the cut is the clip.
      const inner = frame.getBoundingClientRect(), said = parseFloat(card.style.getPropertyValue("--pg-h"));
      require(Math.abs(inner.top - clip.top) <= 0.5 && Math.abs(inner.height - said) <= 1.5 && inner.width >= clip.width - 1, `the frame shows the top of the page at its own height (${Math.round(inner.height)} of ${said})`);
      // Nothing in it can be pressed, focused or scrolled: it is inert, takes no pointer, and what is under the pointer is the preview.
      require(frame.hasAttribute("inert") && getComputedStyle(frame).pointerEvents === "none", "the page in the card is inert and takes no pointer");
      const x = clip.left + clip.width / 2, y = clip.top + Math.min(clip.height, innerHeight - clip.top) / 2;
      if (y > clip.top && y < innerHeight) require(document.elementFromPoint(x, y)?.closest(".pg-body") === body, "a press in the preview reaches the card, not the page");
      // One control with the page's name, reached by Tab; no expand button of its own under the page.
      const title = card.querySelector(".card-title").textContent;
      require(body.getAttribute("role") === "button" && body.tabIndex === 0 && body.getAttribute("aria-label")?.includes(title), `the preview is one focusable control named with the page: ${body.getAttribute("aria-label")}`);
      require(![...card.querySelectorAll(".card-actions, .btn.icon, .pg-expand")].some(visible), "no button under the preview");
      // The cut fades into the card's own surface, so there is no edge to it, light or dark.
      const fade = getComputedStyle(body, "::after"), surface = getComputedStyle(card).backgroundColor;
      require(fade.backgroundImage.startsWith("linear-gradient") && fade.backgroundImage.includes(surface) && fade.backgroundImage.includes("rgba(0, 0, 0, 0)"), `the cut fades into the card's surface ${surface}: ${fade.backgroundImage}`);
      require(Math.abs(parseFloat(fade.height) - 56) <= 1 && fade.pointerEvents === "none", "the fade is soft and takes no press");
      // Inside the reply, and the title row as a card's own: its title and the status chip on one line.
      const line = card.closest(".tn, [data-key]");
      if (line) { const room = line.getBoundingClientRect(); require(box.left >= room.left && box.right <= room.right + 1, "the page card stays inside the reply"); }
      const chip = card.querySelector(".card-status").getBoundingClientRect(), head = card.querySelector(".card-title").getBoundingClientRect();
      require(Math.abs((chip.top + chip.bottom) / 2 - (head.top + head.bottom) / 2) <= 3 && chip.right <= box.right, "the title and its chip stand on one line");
      heights.push(Math.round(box.height * 10) / 10);
    }
    require(new Set(heights).size === 1, `every page card is as tall as the others: ${heights}`);
    require(document.documentElement.scrollWidth <= innerWidth, "nothing runs out sideways");
    return { check: name, cards: heights.length, card: heights[0], peek };
  }
  // A page opens in the conversation's place (owner, 2026-11-11: 「直接顯示在對話裡，它就是會直接替代掉對話，就是內部的顯示器的感覺，它不會再
  // 打開一個 dialog，然後可能左上角會變成返回上頁」): the same frame, the thread hidden under it, the composer below, the way back the round
  // arrow at the header's top left, and no dialog, scrim or × anywhere.
  if (name === "page-inplace" || name === "page-opened-whole" || name === "page-expanded") {
    const pane = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible), stage = pane.querySelector(":scope > .ra-stage");
    const view = stage.querySelector(":scope > .pgv"), box = view?.querySelector(".pgv-frame-box"), frame = box?.querySelector("iframe");
    require(stage.classList.contains("is-page") && stage.dataset.pageKind === "page" && view && !view.hidden, "the page is open in the conversation's place");
    require(frame && document.querySelectorAll(".pg-frame").length === 1 && !pane.querySelector(".pg-card .pg-body iframe"), "the same page moved: one frame, none left in the card");
    require(!frame.hasAttribute("inert") && getComputedStyle(frame).pointerEvents !== "none", "the page works where it stands open");
    require(![...document.querySelectorAll(".mb-scrim, .mb-dialog, .modal-scrim, .pg-view-dialog, .pg-view")].some(layer => !layer.closest("[hidden]")) && !view.querySelector("[data-dlg], .modal-x, .btn"), "no dialog, no scrim and no × anywhere");
    const scroller = stage.querySelector(":scope > .ra-scroll"), dock = stage.querySelector(":scope > .ra-dock"), composer = dock.querySelector(".composer");
    require(getComputedStyle(scroller).visibility === "hidden", "the thread is out of sight under it");
    require(composer && visible(composer) && !composer.closest("[hidden]"), "the composer stays below the page");
    const back = pane.querySelector(".mb-head [data-page-back]"), head = pane.querySelector(":scope > .mb-head").getBoundingClientRect(), arrow = back?.getBoundingClientRect();
    require(back && visible(back) && !back.hidden, "the way back is in the header");
    require(back.classList.contains("icon") && back.getAttribute("aria-label") === "返回" && back.textContent.trim() === "" && back.querySelector("svg"), "a left arrow named 返回, no word on it");
    require(Math.round(arrow.width) === 36 && Math.round(arrow.height) === 36 && parseFloat(getComputedStyle(back).borderRadius) >= 18 && /^rgb\(/.test(getComputedStyle(back).backgroundColor), "the window edge's soft round button, 36 px, on its solid surface");
    // Under 860 px the list is the rail beside the pane: the row starts at the pane's own edge, with nothing reserved for a menu button.
    const lead = parseFloat(getComputedStyle(back.parentElement).marginLeft) || 0;
    require(arrow.left - head.left <= 12 + lead && arrow.top >= head.top - 1 && arrow.bottom <= head.bottom + 1, `at the header's top left (${Math.round(arrow.left - head.left)} px in)`);
    const search = pane.querySelector('.mb-head [data-act="search"]');
    require(!search || !visible(search), "the thread's search waits where the arrow stands");
    require(!pane.querySelector(":scope > .ra-find") || !visible(pane.querySelector(":scope > .ra-find")), "and so does its bar");
    const who = pane.querySelector(".mb-head .conversation-trigger .mb-pill, .mb-head .au-room-heading");
    require(who && visible(who) && who.textContent.trim().length > 0, "the header still says whose conversation it is");
    const share = pane.querySelector('.mb-head [data-act="share-member"]');
    require(!share || !visible(share), "the member's share waits while a page stands in the thread's place");
    require(!pane.querySelector(".mb-head [data-page-act]"), "and an HTML page has no button of its own there");
    // The page's title in sight, and the page as wide as the composer's column, rounded, between the header and the composer.
    const title = view.querySelector(".pgv-title"), column = composer.getBoundingClientRect(), shown = box.getBoundingClientRect();
    const card = pane.querySelector(".pg-card .card-title")?.textContent;
    require(title && visible(title) && title.textContent === card, `the page's title is in sight: ${title?.textContent}`);
    const titled = title.getBoundingClientRect();
    require(titled.left >= column.left - 1 && titled.right <= column.right + 1 && title.scrollWidth <= title.clientWidth + 1, `the title is not cut and stays in the column: ${Math.round(titled.left)}-${Math.round(titled.right)} in ${Math.round(column.left)}-${Math.round(column.right)}, ${title.scrollWidth} of ${title.clientWidth}`);
    const dbg = el => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return `${el.className}:${Math.round(r.left)}-${Math.round(r.right)} pad ${c.paddingLeft}/${c.paddingRight} mw ${c.maxWidth} w ${c.width} box ${c.boxSizing}`; };
    require(Math.abs(shown.left - column.left) <= 1 && Math.abs(shown.right - column.right) <= 1, `the page is as wide as the composer: ${Math.round(shown.left)}-${Math.round(shown.right)} and ${Math.round(column.left)}-${Math.round(column.right)} [${[view, view.querySelector(".pgv-body"), view.querySelector(".pgv-page"), box, dock, composer].map(dbg).join(" | ")}]`);
    require(shown.top >= head.bottom && shown.bottom <= dock.getBoundingClientRect().top + 1, "the page stands between the header and the composer");
    require(parseFloat(getComputedStyle(box).borderRadius) >= 12 && getComputedStyle(box).borderTopWidth === "0px", "its corners are rounded and nothing is drawn around it");
    require(shown.height >= 200, `the page has room to be read: ${Math.round(shown.height)} px`);
    require(view.querySelector(".pgv-status")?.hidden !== false || name !== "page-inplace", "nothing waits under the page before anything is sent");
    require(document.documentElement.scrollWidth <= innerWidth, "nothing runs out sideways");
    return { check: name, width: Math.round(shown.width), height: Math.round(shown.height) };
  }
  // The thread where it was (member-settings-place-*, the same measure): taken before the page opens, compared after the arrow.
  if (name === "page-inplace-before" || name === "page-inplace-kept") {
    const pane = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible), scroller = pane.querySelector(".ra-scroll"), stage = pane.querySelector(":scope > .ra-stage");
    const top = scroller.getBoundingClientRect().top, items = [...scroller.querySelectorAll(".thread > li")];
    if (name === "page-inplace-before") {
      require(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 40, "the thread is read higher up, not at its bottom");
      const item = items.find(li => li.getBoundingClientRect().bottom > top + 4), frame = scroller.querySelector(".pg-card iframe");
      require(frame, "the card holds its frame");
      window.__pagePlace = { index: items.indexOf(item), offset: item.getBoundingClientRect().top - top, scrollTop: scroller.scrollTop, frame, loads: 0 };
      frame.addEventListener("load", () => { window.__pagePlace.loads++; });
      return { check: name, index: window.__pagePlace.index };
    }
    const was = window.__pagePlace;
    require(!stage.classList.contains("is-page") && stage.querySelector(":scope > .pgv").hidden, "the page is put away");
    require(getComputedStyle(scroller).visibility === "visible", "the thread is in sight again");
    const offset = items[was.index].getBoundingClientRect().top - top;
    require(Math.abs(offset - was.offset) <= 2 && Math.abs(scroller.scrollTop - was.scrollTop) <= 2, `the thread is where it was: ${Math.round(was.offset)} -> ${Math.round(offset)} px`);
    const frame = scroller.querySelector(".pg-card .pg-body > iframe");
    require(frame === was.frame && frame.hasAttribute("inert"), "the card holds the same frame as before, inert again");
    require(was.loads === 0, `the page did not reload: ${was.loads} loads`);
    const arrow = pane.querySelector(".mb-head [data-page-back]"), search = pane.querySelector('.mb-head [data-act="search"]');
    require(!arrow || arrow.hidden || !visible(arrow), "the arrow is gone");
    require(!search || getComputedStyle(search).display !== "none", "the search is back");
    require(![...document.querySelectorAll(".mb-scrim, .mb-dialog")].some(layer => !layer.closest("[hidden]")), "no dialog was ever opened");
    return { check: name, moved: Math.round(offset - was.offset), moveBefore: typeof Element.prototype.moveBefore === "function" };
  }
  // A page changed while it stands open (core `update_page`): the sampler runs from before the change to after it, so a frame that
  // closed, blinked out or a view that shut would show as a sample (owner, 2026-11-11: nothing closes, flashes or jumps).
  if (name === "page-watch") {
    const stage = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible).querySelector(":scope > .ra-stage");
    const watch = window.__pageWatch = { samples: 0, bad: [], on: true, frames: new Set(), loads: 0 };
    const tick = () => {
      if (!watch.on) return;
      const view = stage.querySelector(":scope > .pgv"), shown = [...stage.querySelectorAll(".pgv-frame-box > iframe")].filter(frame => frame.style.visibility !== "hidden");
      shown.forEach(frame => watch.frames.add(frame));
      watch.samples++;
      if (!stage.classList.contains("is-page") || !view || view.hidden || shown.length !== 1) watch.bad.push({ at: watch.samples, page: stage.classList.contains("is-page"), shown: shown.length });
      requestAnimationFrame(tick);
    };
    tick();
    return { check: name };
  }
  if (name === "page-inplace-updated") {
    const pane = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible), stage = pane.querySelector(":scope > .ra-stage"), watch = window.__pageWatch;
    watch.on = false;
    require(watch.samples > 20, `the page was watched through the change (${watch.samples} frames)`);
    require(watch.bad.length === 0, `one page in sight at every frame, the view never shut: ${JSON.stringify(watch.bad.slice(0, 3))}`);
    require(watch.frames.size === 2, `the old page and the changed page took turns in place: ${watch.frames.size} frames seen`);
    require(stage.classList.contains("is-page") && stage.dataset.pageKind === "page", "the page is still open");
    require(document.querySelectorAll(".pg-frame").length === 1, "one frame, the old one gone");
    const cards = [...pane.querySelectorAll(".pg-card")];
    require(cards.length === 1 || (cards.length === 2 && cards[0].dataset.page !== cards[1].dataset.page), `the conversation keeps one card for the page: ${cards.map(card => card.dataset.page)}`);
    require(cards.every(card => card.dataset.pageRev === "2"), "its card is the changed page's revision");
    const open = stage.querySelector(".pgv-title");
    require(open && visible(open), "the title stays in sight");
    return { check: name, samples: watch.samples };
  }
  // The owner speaks with a page open in the thread's place (voice-mode.ts, page-view.css; owner, 2026-11-14: 「拉菲爾大師還是會顯示在最前面，
  // 他永遠是最前面的」): the thread, and the "hearing" line in it, is hidden under the page, so the flyer is the only sign he is heard.
  if (name === "voice-over-page-listening" || name === "voice-over-page-hearing" || name === "voice-over-page-gone") {
    const pane = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible), stage = pane.querySelector(":scope > .ra-stage");
    const view = stage.querySelector(":scope > .pgv"), dock = stage.querySelector(":scope > .ra-dock"), composer = dock.querySelector(".composer"), flyer = stage.querySelector(":scope > .ra-flyer");
    require(stage.classList.contains("is-page") && visible(view), "a page stands in the thread's place");
    const frame = view.querySelector("iframe"), frameBox = view.querySelector(".pgv-frame-box");
    require(visible(frame), "the page's own frame is drawn");
    if (name === "voice-over-page-gone") {
      require(!flyer && !stage.classList.contains("is-voice") && !composer.querySelector(".vm-away"), "when it ends the flyer is gone and the button is its own again");
      require(composer.dataset.taskState === "idle", `the composer is at rest: ${composer.dataset.taskState}`);
      return { check: name };
    }
    require(visible(flyer), "the flyer is drawn in front of the page");
    const canvas = flyer.querySelector("canvas.ra-flyer-emblem");
    require(canvas && visible(canvas) && !flyer.querySelector("img"), "it is the live emblem, the one the voice mode always draws");
    const box = flyer.getBoundingClientRect(), page = frameBox.getBoundingClientRect(), field = composer.getBoundingClientRect(), main = stage.getBoundingClientRect();
    require(Math.round(box.width) === 132 && Math.round(box.height) === 132, `at its own size: ${box.width} x ${box.height}`);
    require(box.left >= main.left - 1 && box.right <= main.right + 1 && box.top >= page.top - 1, "inside the stage and over the page");
    require(box.bottom <= field.top + 1, `it does not cover the composer: ${Math.round(box.bottom)} against ${Math.round(field.top)}`);
    require(Math.abs((box.left + box.right) / 2 - (main.left + main.right) / 2) <= 2, "in the middle of the stage");
    // Nothing paints over it: with the flyer made hit-testable for a moment, the point at its centre and at four points of its ring is the flyer.
    const was = flyer.style.pointerEvents;
    flyer.style.pointerEvents = "auto";
    const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2, reach = 44;
    const hits = [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]].map(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy));
    flyer.style.pointerEvents = was;
    require(hits.every(hit => hit && (hit === flyer || flyer.contains(hit))), `the top layer at its centre and ring is the flyer: ${hits.map(hit => hit?.className || hit?.tagName)}`);
    // It takes no pointer, so the page scrolls and works under it.
    require(getComputedStyle(flyer).pointerEvents === "none", "it takes no pointer over the page");
    require(document.elementFromPoint(cx, cy) !== flyer && !flyer.contains(document.elementFromPoint(cx, cy)), "a pointer over it reaches what is under it");
    const scroll = stage.querySelector(":scope > .ra-scroll");
    require(getComputedStyle(scroll).visibility === "hidden", "the thread, and the hearing line in it, is hidden under the page: this is the only sign");
    if (name === "voice-over-page-listening") {
      require(composer.dataset.taskState === "recording", `the composer is recording: ${composer.dataset.taskState}`);
      return { check: name, flyer: [Math.round(box.left), Math.round(box.top)] };
    }
    require(composer.dataset.taskState === "ack", `the words are being heard: ${composer.dataset.taskState}`);
    const line = scroll.querySelector('[data-key="hearing"]');
    require(line && getComputedStyle(line).visibility === "hidden", "the thread's own hearing line is there and cannot be seen");
    require(!composer.querySelector(".vm-away"), "the button is the slot's again, with the hand to stop");
    return { check: name, flyer: [Math.round(box.left), Math.round(box.top)] };
  }
  // The same page asked to change from under it: what the member does shows under the page, then its reply (page-view.ts).
  if (name === "page-inplace-working" || name === "page-inplace-answered") {
    const pane = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible), stage = pane.querySelector(":scope > .ra-stage");
    const view = stage.querySelector(":scope > .pgv"), status = view.querySelector(".pgv-status"), dock = stage.querySelector(":scope > .ra-dock"), box = view.querySelector(".pgv-frame-box");
    require(stage.classList.contains("is-page") && !view.hidden, "the page stays open while the member answers");
    require(visible(status) && !status.hidden, "something shows under the page");
    const line = status.firstElementChild.getBoundingClientRect(), column = dock.querySelector(".composer").getBoundingClientRect();
    const row = status.getBoundingClientRect();
    require(row.top >= box.getBoundingClientRect().bottom - 1 && row.bottom <= dock.getBoundingClientRect().top + 1, "it stands between the page and the composer");
    require(line.left >= column.left - 1 && line.right <= column.right + 1 && line.height <= 40, `one line in the column: ${Math.round(line.height)} px`);
    require(!view.querySelector("button, .btn"), "no button for it, no sentence that explains it");
    if (name === "page-inplace-working") {
      const live = status.querySelector(".live-presence .live-action");
      require(live && live.textContent.trim().length > 0 && !/[{}]/.test(live.textContent), `the member's own line while it works: ${live?.textContent}`);
      const told = window.__look.viewing;
      require(told.length === 1 && told[0] === "page-news", `the core was told which page is open before the message went: ${JSON.stringify(told)}`);
      const asked = window.__look.calls.filter(call => call.command === "agent_ask_text");
      require(asked.length === 1 && asked[0].memberId === 1 && asked[0].text === "把最後一題改成問今天的新聞", `the message went to the member: ${JSON.stringify(asked.map(call => call.text))}`);
      return { check: name, line: live.textContent };
    }
    const reply = status.querySelector(".pgv-reply");
    require(reply && !status.querySelector(".live-action") && reply.textContent === "好了，最後一題改成問今天的新聞，其他沒有動。", `its first words: ${reply?.textContent}`);
    require(reply.scrollWidth <= reply.clientWidth + 1 || getComputedStyle(reply).textOverflow === "ellipsis", "one line, cut with an ellipsis if long");
    // The whole reply is in the thread, one arrow away.
    const said = [...pane.querySelectorAll(".ra-scroll .message-text")].some(text => text.textContent.includes("好了，最後一題改成問今天的新聞"));
    require(said, "the whole reply is in the thread behind it");
    return { check: name };
  }
  // Escape goes back, and a draft in the composer is neither lost nor cleared by it.
  if (name === "page-inplace-escaped") {
    const pane = [...document.querySelectorAll(".page-agent .mb-chat")].find(visible), stage = pane.querySelector(":scope > .ra-stage");
    const input = pane.querySelector(".composer .cmp-input");
    require(!stage.classList.contains("is-page") && stage.querySelector(":scope > .pgv").hidden, "Escape went back to the conversation");
    require(input.value === "還沒送出的草稿", `the draft is as it was: ${input.value}`);
    require(!window.__look.calls.some(call => call.command === "agent_ask_text" || call.command === "agent_stop"), "nothing was sent or stopped");
    return { check: name };
  }
  if (name === "page-placed" || name === "page-appended") {
    const input = [...document.querySelectorAll('.composer .cmp-input')].find(visible);
    const note = input?.closest('.composer').querySelector('.cmp-page-note');
    const expected = `${name === "page-appended" ? "我原本的草稿\n" : ""}把輕量後背包加入購物車`;
    require(input?.value === expected, "page text is a draft, preserving every existing word");
    require(document.activeElement === input, "the conversation composer has focus");
    require(visible(note) && note.textContent === "這段文字來自頁面，確認後再送出", "one localized note identifies page text before sending");
    require(note.getBoundingClientRect().height <= parseFloat(getComputedStyle(note).lineHeight) * 1.2, "the note stays on one line");
    // The page stays open and the composer, in sight under it, holds the words (owner, 2026-11-11: a page is the conversation's place, not a dialog).
    const open = document.querySelector('.page-agent .ra-stage.is-page');
    require(![...document.querySelectorAll('.mb-scrim, .pg-view')].some(layer => !layer.closest('[hidden]')), "no dialog is over the page");
    if (open) require(!open.querySelector(':scope > .pgv').hidden && visible(input), "the page stays open with the composer under it");
    // What stands under the thread grew with the placed text: the thread was at its bottom and stays there, so the last card is
    // whole above the composer (R-UI-21, R-CARD-11; the judge on page-buy dark and page-expand-place light).
    const thread = [...document.querySelectorAll('.page-agent .mb-chat .ra-scroll')].find(visible), cards = thread ? [...thread.querySelectorAll('.pg-card')] : [];
    if (cards.length && !open) {
      const card = cards.at(-1).getBoundingClientRect(), field = input.closest('.composer').getBoundingClientRect(), port = thread.getBoundingClientRect();
      require(card.bottom <= field.top - 4, `the last card ends above the composer with its gap (${Math.round(card.bottom)} against ${Math.round(field.top)})`);
      require(card.bottom <= port.bottom + 0.5 && thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 2, "the thread stays at its bottom as the composer grows");
    }
    require(!window.__look.calls.some(call => call.command === "agent_ask_text" || ["rooms.send", "owner_questions.answer"].includes(call.method)), "a page never sends an owner message or answers a question");
    return { check: name, text: input.value, note: note.textContent };
  }
  if (name === "composer-grows-before" || name === "composer-grows-keeps-bottom") {
    // The composer grows under a thread whose last item is a card: the thread stays at its bottom and the card stays whole.
    const field = [...document.querySelectorAll('.page-agent .mb-chat .composer')].find(visible), thread = [...document.querySelectorAll('.page-agent .mb-chat .ra-scroll')].find(visible);
    const card = [...thread.querySelectorAll('.pg-card')].at(-1);
    require(field && thread && card, "a thread with a card and its composer");
    if (name === "composer-grows-before") { window.__composerGrows = field.getBoundingClientRect().height; return { check: name, height: window.__composerGrows }; }
    const grown = field.getBoundingClientRect().height - window.__composerGrows;
    require(grown >= 40, `the typed lines made the composer taller (${Math.round(grown)} px)`);
    require(card.getBoundingClientRect().bottom <= field.getBoundingClientRect().top - 4, "the last card ends above the grown composer with its gap");
    require(thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 2, "the thread stays at its bottom");
    return { check: name, grown };
  }
  if (name === "page-spoke") {
    const asked = window.__look.calls.filter(call => call.command === "agent_ask_text");
    require(asked.length === 1 && JSON.stringify(asked[0]).includes("把輕量後背包加入購物車"), "only the owner's send submits the placed text once");
    require(![...document.querySelectorAll('.cmp-page-note')].some(visible), "the submitted draft no longer shows a page note");
    return { check: name };
  }
  if (name.startsWith("page-document")) {
    // A document-style report (owner, 2026-11-14, after Grok Bot's Tokyo list; report-page.ts): a large title, one line of summary, a box that
    // lists the sections, notes with an icon, tables with a dropdown, tabs, figures at the right and a column of links.
    const view = document.querySelector(".page-agent .rp-view");
    require(view && visible(view), "the document is open in the conversation's place");
    const scroller = view.querySelector(":scope > .rp-scroll"), doc = view.querySelector(".rp-doc");
    require(scroller.scrollWidth <= scroller.clientWidth + 1, "nothing runs out sideways");
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const tokens = dark ? { link: "rgb(122, 174, 245)", text: "rgb(245, 245, 245)" } : { link: "rgb(31, 99, 209)", text: "rgb(10, 10, 10)" };
    const column = scroller.clientWidth - parseFloat(getComputedStyle(scroller).paddingLeft) - parseFloat(getComputedStyle(scroller).paddingRight);
    const title = view.querySelector(".rp-title");
    require(title.textContent === "東京行程候選清單" && Math.abs(parseFloat(getComputedStyle(title).fontSize) - (column <= 640 ? 26.4 : 31.9)) < 0.2, `a large title: ${getComputedStyle(title).fontSize} in ${Math.round(column)} px`);
    const sub = view.querySelector(".rp-sub");
    require(sub.classList.contains("is-summary") && sub.textContent === "46 個景點、39 間餐廳、15 間咖啡甜點、11 個購物點，用篩選慢慢挑。", "one line of the member's summary under the title");
    require(!doc.textContent.includes("只寫有紀錄的事實") && getComputedStyle(sub).color === tokens.text, "it takes the place of the promise, in the text's own colour");
    // The contents are a box with a list in it (a column of its own beside a page 960 px wide).
    const toc = view.querySelector("nav.rp-toc"), links = [...toc.querySelectorAll("ul > li > a")];
    require(links.map(link => link.textContent).join("|") === "景點／體驗|餐廳|參考來源" && toc.querySelector(".rp-toc-h")?.textContent === "本頁內容", "the box says 本頁內容 over three sections");
    require(links.every((link, index) => index === 0 || link.getBoundingClientRect().top > links[index - 1].getBoundingClientRect().bottom - 2), "a list down the page, not a row of chips");
    const aside = getComputedStyle(toc).position === "sticky", box = toc.getBoundingClientRect(), body = view.querySelector(".rp-body").getBoundingClientRect();
    if (aside) require(box.left >= body.right, "beside the page it is its own column");
    else {
      require(parseFloat(getComputedStyle(toc).borderTopLeftRadius) >= 12 && getComputedStyle(toc).boxShadow !== "none" && getComputedStyle(toc).paddingLeft !== "0px", "above the page it is a box");
      require(box.bottom <= body.top && Math.abs(box.width - doc.getBoundingClientRect().width) <= 1, `a box as wide as the page, above its sections: ${Math.round(box.width)} and ${Math.round(doc.getBoundingClientRect().width)}`);
    }
    // Notes: an icon and a heading in the tone's colour on a tint of it; the three tones are three colours.
    const notes = [...view.querySelectorAll(".rp-note")];
    require(notes.map(note => note.dataset.tone).join() === "info,warn,ok" && notes.every(visible), "three notes: info, warn and ok");
    const tones = notes.map(note => getComputedStyle(note.querySelector(":scope > svg.i")).color);
    require(new Set(tones).size === 3 && tones[0] === tokens.link, `each tone is its own colour, info the link's blue: ${tones}`);
    require(getComputedStyle(notes[0].querySelector("b")).color === tones[0] && getComputedStyle(notes[0]).backgroundColor !== "rgba(0, 0, 0, 0)", "the heading takes the tone's colour on a tint of it");
    require(notes.every(note => note.getBoundingClientRect().width >= body.width - 1), "a note is as wide as the page's sections");
    // The first table: a dropdown with its label, tabs for its groups, figures at the right, a link on every row.
    const table = view.querySelector(".rp-sec[data-kind=table] .rp-table-box"), grid = table.querySelector("table");
    const dropdown = table.querySelector(".rp-filter button.sel[data-report-filter]");
    require(dropdown && table.querySelector(".rp-filter-l")?.textContent === "區域" && dropdown.getAttribute("aria-label") === "區域", "a dropdown named 區域");
    require(table.querySelectorAll('.tabs [role="tab"]').length === 8 && table.querySelectorAll("tbody tr").length >= 1, "tabs for the groups, and the rows");
    const figures = [...grid.querySelectorAll("th[data-num]")];
    require(figures.map(head => head.textContent).join("|") === "門票（日圓）|從大塚（分）", `two columns of figures: ${figures.map(head => head.textContent)}`);
    if (getComputedStyle(grid).display !== "block" && grid.getBoundingClientRect().width > 560) {
      require(figures.every(head => ["right", "end"].includes(getComputedStyle(head).textAlign)) && [...grid.querySelectorAll("td[data-num]")].every(cell => ["right", "end"].includes(getComputedStyle(cell).textAlign)), "figures are set at the right");
    }
    const anchors = [...grid.querySelectorAll("td a.rp-link")];
    require(anchors.length === 12 && anchors.every(anchor => anchor.href.startsWith("https://") && getComputedStyle(anchor).color === tokens.link && getComputedStyle(anchor).textDecorationLine === "underline"), "twelve links, in the link's blue and underlined");
    require(grid.getBoundingClientRect().right <= table.getBoundingClientRect().right + 1, "the table stays inside the page");
    if (name === "page-document-menu") {
      const menu = document.querySelector(".menu");
      require(menu && visible(menu), "the dropdown's values are open");
      const values = [...menu.querySelectorAll(".menu-choice")].map(item => item.dataset.value);
      require(values.length === 9 && values[0] === "" && values.includes("原宿"), `全部 and the eight areas: ${values}`);
      const at = menu.getBoundingClientRect(), from = dropdown.getBoundingClientRect();
      require(at.left >= 0 && at.right <= innerWidth && at.bottom <= innerHeight + 1 && Math.abs(at.left - from.left) <= 8, "the menu hangs from the dropdown and is whole on screen");
      return { check: name, values: values.length };
    }
    if (name === "page-document-filter") {
      const shown = [...grid.querySelectorAll("tbody tr")].filter(row => !row.hidden).map(row => row.firstElementChild.textContent);
      require(shown.join("|") === "明治神宮 Meiji Jingu" && dropdown.textContent === "原宿", `one row of 原宿 in 經典名勝: ${shown}`);
      require(table.querySelector('.tabs [aria-selected="true"]')?.dataset.reportTab === "g0" && !grid.querySelector(".rp-none"), "the tab is the one chosen");
      return { check: name };
    }
    require(table.querySelector('.tabs [aria-selected="true"]')?.dataset.reportTab === "all" && dropdown.textContent === "全部", "it opens on every row");
    const calls = window.__look.calls.filter(call => call.command === "report_save");
    require(calls.length === 0, "nothing is saved by looking");
    return { check: name, column: Math.round(column), aside };
  }
  if (name === "page-base") {
    // An HTML page that writes no style of its own, opened in the conversation's place: its frame is the composer's column (the frame's own
    // measures are `checkFrame`).
    const stage = document.querySelector(".page-agent .ra-stage"), frame = stage.querySelector(".pgv-frame-box iframe");
    require(stage.classList.contains("is-page") && frame && visible(frame), "the page is open in the conversation's place");
    const composer = stage.querySelector(".ra-dock .composer").getBoundingClientRect(), box = frame.getBoundingClientRect();
    require(Math.abs(box.left - composer.left) <= 2 && Math.abs(box.right - composer.right) <= 2 && box.height > 300, `as wide as the composer: ${Math.round(box.width)} and ${Math.round(composer.width)}`);
    return { check: name, width: Math.round(box.width) };
  }
  if (name.startsWith("page-dashboard")) {
    // Raphael's daily overview (owner, 2026-11-14; report-chart.ts): today's figures and every kind of chart on one report,
    // in the conversation's place, at every width and in both themes, and in the file it is saved as.
    const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    if (name === "page-dashboard-card") {
      const link = document.querySelector('.page-agent .pg-link[data-page="page-dashboard"]');
      require(link && visible(link) && link.querySelector(".me-file-t")?.textContent === "每日總覽｜11 月 14 日" && link.querySelector("small")?.textContent === "頁面", "the overview's link card: its title and 「頁面」");
      const line = link.closest(".tn, [data-key]");
      require(line?.textContent.includes("早安。今天的總覽好了"), "a few words of what the routine did, with the card");
      return { check: name };
    }
    const file = name === "page-dashboard-file";
    const root = file ? document.body : document.querySelector(".page-agent .rp-view");
    require(root, "the overview is open");
    if (file) {
      require(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content === "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'", "nothing in the file runs or loads");
      require(!document.querySelector("script, iframe, img, button, [tabindex], .rc-tip"), "nothing to run, focus or float in the file");
      require(document.documentElement.scrollWidth <= innerWidth, "nothing runs out sideways");
    } else {
      const page = root.querySelector(":scope > .rp-scroll");
      require(page.scrollWidth <= page.clientWidth + 1, "nothing runs out sideways");
    }
    require(root.querySelector(".rp-title")?.textContent === "每日總覽｜11 月 14 日", "its title");
    // Ten titles: the contents stand beside the page where it is wide enough, and are left out above it where it is not.
    const toc = root.querySelector(".rp-toc"), aside = toc && visible(toc);
    require(toc?.hasAttribute("data-many") && (!aside || toc.getBoundingClientRect().left >= root.querySelector(".rp-body").getBoundingClientRect().right), "the long contents only beside the page");
    const sections = [...root.querySelectorAll(".rp-sec")];
    require(sections.length === 10, `ten sections: ${sections.length}`);
    const titleOf = section => section.querySelector(".rp-h2")?.textContent ?? section.id;
    // Every tile and every part of a chart stays inside its own section, and no word of a chart covers another.
    for (const section of sections) {
      const box = section.getBoundingClientRect();
      for (const item of section.querySelectorAll(".rc *, .rs-tile")) {
        const rect = item.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        require(rect.left >= box.left - 1 && rect.right <= box.right + 1, `${item.getAttribute("class") || item.tagName} stays inside 「${titleOf(section)}」: ${Math.round(rect.left)}-${Math.round(rect.right)} in ${Math.round(box.left)}-${Math.round(box.right)}`);
      }
      const words = [...section.querySelectorAll(".rc-xl, .rc-cap, .rc-tick, .rc-end, .rc-li, .rc-unit, .rc-name, .rc-val, .rc-pn, .rc-pv, .rc-ps")].filter(visible);
      words.forEach((a, index) => words.slice(index + 1).forEach(b => require(!overlaps(a.getBoundingClientRect(), b.getBoundingClientRect()), `「${a.textContent}」 and 「${b.textContent}」 do not cover each other in 「${titleOf(section)}」`)));
      for (const cut of section.querySelectorAll(".rs-value b, .rs-name > span:first-child, .rc-xl, .rc-name, .rc-pn")) require(cut.scrollWidth <= cut.clientWidth + 1, `「${cut.textContent}」 is written whole`);
    }
    // A pair of half sections stands side by side where the page holds two columns of at least 304 px, else one above the other.
    const body = root.querySelector(".rp-body"), wide = body.getBoundingClientRect().width >= 640;
    for (const [a, b] of [[1, 2], [3, 4], [6, 7]]) {
      const one = sections[a].getBoundingClientRect(), two = sections[b].getBoundingClientRect();
      require(sections[a].dataset.span === "half" && sections[b].dataset.span === "half", `「${titleOf(sections[a])}」 and 「${titleOf(sections[b])}」 are a pair`);
      require(wide ? Math.abs(one.top - two.top) <= 1 && two.left >= one.right + 16 : two.top >= one.bottom - 1, `「${titleOf(sections[a])}」 and 「${titleOf(sections[b])}」 stand ${wide ? "side by side" : "one above the other"}`);
    }
    for (const index of [0, 5, 8, 9]) require(Math.abs(sections[index].getBoundingClientRect().width - body.getBoundingClientRect().width) <= 1, `「${titleOf(sections[index])}」 takes the page's width`);
    // The tiles: six figures, as many to a row as fit, the change with its arrow, the recent values as a little line.
    const tiles = [...sections[0].querySelectorAll(".rs-tile")];
    require(tiles.length === 6 && tiles.every(visible), "six tiles");
    require(tiles.map(tile => tile.querySelector(".rs-value b").textContent).join("|") === "24|80|3|23,412|14|11/12", "each tile's value");
    const up = tiles[3].querySelector('.rs-delta[data-dir="up"]'), arrow = up && getComputedStyle(up, "::before");
    require(arrow && arrow.borderBottomWidth === "5px" && arrow.borderBottomColor === getComputedStyle(up).color && tiles[3].querySelector(".rs-spark svg path"), "a change that goes up has its arrow, in the words' colour, and the recent values their line");
    const rows = new Map();
    for (const tile of tiles) { const box = tile.getBoundingClientRect(); rows.set(Math.round(box.top), [...(rows.get(Math.round(box.top)) ?? []), Math.round(box.height)]); }
    require([...rows.values()].every(heights => new Set(heights).size === 1), `tiles of a row share their height: ${JSON.stringify([...rows.values()])}`);
    if (name === "page-dashboard" || file) {
      // The weather: an area over the day and columns with each hour's value written on them, no axis needed there.
      const area = root.querySelector('[data-report-chart="1"]'), rain = root.querySelector('[data-report-chart="2"]');
      require(area.querySelector(".rc-area") && area.querySelector(".rc-line") && area.querySelectorAll(".rc-dot").length === 1 && area.querySelector(".rc-end")?.textContent === "20", "the temperature: an area, its line and its last value");
      require(rain.querySelectorAll(".rc-band").length === 9 && !rain.querySelector(".rc-y") && [...rain.querySelectorAll(".rc-cap")].map(cap => cap.textContent).join() === "10,10,20,40,80,80,60,30,20", "the rain: nine columns, each value on its column, no axis");
      const heights = [...rain.querySelectorAll(".rc-bar")].map(bar => bar.getBoundingClientRect().height);
      require(Math.abs(heights[4] / heights[0] - 8) < 0.2, `a column's height follows its value: ${heights.map(Math.round)}`);
      require(rain.querySelectorAll(".rc-xl").length <= 9, "the hours along the bottom");
    }
    if (name === "page-dashboard-projects") {
      const chart = root.querySelector('[data-report-chart="5"]');
      require([...chart.querySelectorAll(".rc-cap")].map(cap => cap.textContent).join("|") === "14|6|22|92|0", "each status's total on its column");
      require([...chart.querySelectorAll(".rc-li")].map(item => item.textContent).join("|") === "Claude|Codex|主人|拉斐爾", "the owners in the legend");
      // Three owners are not members, so Raphael takes the fourth chart colour too, not his own blue beside the first.
      const keys = [...chart.querySelectorAll(".rc-legend .rc-key")].map(key => getComputedStyle(key).backgroundColor);
      const token = name => { const probe = document.createElement("span"); probe.style.background = `var(${name})`; chart.append(probe); const colour = getComputedStyle(probe).backgroundColor; probe.remove(); return colour; };
      require(keys.join("|") === ["--chart-1", "--chart-2", "--chart-3", "--chart-4"].map(token).join("|"), `the chart colours in their order: ${keys}`);
      const done = chart.querySelector('.rc-band[data-i="3"]');
      require(done.querySelectorAll(".rc-bar").length === 3 && done.querySelectorAll(".rc-bar.is-top").length === 1, "a column is its owners' parts one on another, rounded at its top only");
      const tip = chart.querySelector(".rc-tip"), view = root.getBoundingClientRect(), box = tip?.getBoundingClientRect();
      require(tip && visible(tip) && box.left >= view.left && box.right <= view.right && box.top >= view.top, "the box of values shows inside the page");
      require(tip.querySelector(".rc-tt")?.textContent === "等待回覆" && [...tip.querySelectorAll(".rc-tv")].map(value => value.textContent).join("|") === "6 件|1 件|14 件|1 件|22 件", `who has how many waiting, and the total: ${tip.textContent}`);
      require(chart.querySelector('.rc-band[data-i="2"]').classList.contains("is-on"), "the column pointed at stands out");
      return { check: name };
    }
    if (name === "page-dashboard-lines") {
      const chart = root.querySelector('[data-report-chart="6"]');
      require(chart.querySelectorAll(".rc-line").length === 4 && chart.querySelectorAll(".rc-dot:not(.rc-hover)").length === 3, "three lines, one of them in two stretches around its gap, each with its last point");
      require(chart.querySelector(".rc-cross") && chart.querySelectorAll(".rc-hover").length >= 2, "a hairline down the plot and each line's point there");
      const tip = chart.querySelector(".rc-tip");
      require(tip && visible(tip) && tip.querySelectorAll(".rc-tr").length === 3, "the box names each line with its value");
      return { check: name };
    }
    if (name === "page-dashboard-lower" || file) {
      const ring = root.querySelector('[data-report-chart="7"]');
      require(ring.querySelectorAll(".rc-part").length === 4 && ring.querySelector(".rc-mid b")?.textContent === "200" && ring.querySelector(".rc-mid small")?.textContent === "萬元", "a ring of four parts with the whole in its middle");
      require([...ring.querySelectorAll(".rc-ps")].map(share => share.textContent).join("|") === "42%|35%|15%|8%", "each part's share beside its name");
      const bars = root.querySelector('[data-report-chart="8"]');
      require(bars.querySelectorAll(".rc-row").length === 4 && [...bars.querySelectorAll(".rc-val")].map(value => value.textContent).join() === "21,11,16,8", "a bar for each member, its total at its end");
      const widths = [...bars.querySelectorAll(".rc-track")].map(track => [...track.children].reduce((sum, part) => sum + part.getBoundingClientRect().width, 0));
      require(Math.abs(widths[0] / widths[3] - 21 / 8) < 0.15, `a bar's length follows its total: ${widths.map(Math.round)}`);
      require(root.querySelectorAll(".rp-sec:last-child .rp-dot").length === 4, "the members' routines, each with its colour");
    }
    return { check: name, wide };
  }
  if (name.startsWith("page-report-file")) {
    // A report's saved file opened on its own (the `saved-file` step): the app's drawing in its reader's theme, nothing of the app.
    const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    require(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content === "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'", "nothing in the file runs or loads");
    require(!document.querySelector("script, iframe, img, button, .page-agent, .rp-view, .tabs"), "nothing of the app comes with it, and its table has no tabs");
    require(document.title === "團隊總覽報告" && document.querySelector(".rp-title")?.textContent === "團隊總覽報告", "its title");
    const dark = matchMedia("(prefers-color-scheme: dark)").matches, page = getComputedStyle(document.body);
    require(page.backgroundColor === (dark ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)") && page.color === (dark ? "rgb(245, 245, 245)" : "rgb(10, 10, 10)"), `its reader's ${dark ? "dark" : "light"} theme: ${page.color} on ${page.backgroundColor}`);
    require(document.documentElement.scrollWidth <= innerWidth, "nothing runs out sideways");
    const team = document.querySelector(".rp-sec[data-kind=team]"), drawings = [...team.querySelectorAll(".rp-team-at")].filter(visible);
    require(drawings.length === 1, "one drawing of the team shows, the one its width holds");
    const draw = drawings[0].querySelector(".rp-team-draw"), box = draw.getBoundingClientRect(), column = team.getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, `the drawing fits its column: ${Math.round(box.width)} in ${Math.round(column.width)}`);
    if (name === "page-report-file") {
      const sub = document.querySelector(".rp-sub")?.textContent ?? "";
      require(/^資料截至 \d{4}\/\d\d\/\d\d \d\d:\d\d · 只寫有紀錄的事實$/.test(sub), `the time its data is from: ${sub}`);
      const toc = [...document.querySelectorAll(".rp-toc a")].map(entry => entry.textContent);
      require(toc.join("|") === "重點發現|總覽表|分工與協作", `its contents: ${toc}`);
      const words = [...document.querySelectorAll(".rp-items .rp-st")].map(word => getComputedStyle(word).color);
      require(words.length === 4 && new Set(words).size === 4, "four status words, each in its own colour");
      require(document.querySelectorAll(".rp-table tbody tr").length === 4 && ![...document.querySelectorAll(".rp-table tbody tr")].some(row => row.hidden), "every row of the table, as 全部 shows them");
      return { check: name, team: Math.round(box.width) };
    }
    const top = team.getBoundingClientRect().top;
    require(top >= 0 && top <= 48 || innerHeight + scrollY >= document.documentElement.scrollHeight - 1, `the contents brought the team to the top (${Math.round(top)} px)`);
    const nodes = [...draw.querySelectorAll(".rp-node")].map(node => ({ node, box: node.getBoundingClientRect() }));
    require(nodes.length === 5, "one box for each of the five");
    nodes.forEach((a, index) => nodes.slice(index + 1).forEach(b => require(!overlaps(a.box, b.box), "no box over another")));
    const labels = [...draw.querySelectorAll(".rp-lab")].map(label => label.getBoundingClientRect());
    require(labels.length === 6 && draw.querySelectorAll(".rp-lines > path").length === 6, "six arrows, each saying what passes along it");
    labels.forEach((label, index) => {
      nodes.forEach(({ box: node }) => require(!overlaps(label, node), "no label over a box"));
      labels.slice(index + 1).forEach(other => require(!overlaps(label, other), "no label over another"));
    });
    require(new Set(nodes.map(({ node }) => getComputedStyle(node, "::before").backgroundColor)).size === 5, "each one's own colour down the left of its box");
    return { check: name, team: Math.round(box.width), height: Math.round(box.height) };
  }
  if (name.startsWith("page-report")) {
    const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const view = document.querySelector(".page-agent .rp-view"), stage = document.querySelector(".page-agent .ra-stage");
    const scroller = stage.querySelector(":scope > .ra-scroll"), link = document.querySelector(".page-agent .pg-link");
    const frame = stage.querySelector(":scope > .pgv");
    if (name === "page-report-card") {
      require(link?.tagName === "BUTTON" && link.classList.contains("attachment-file"), "the report is the reply's file card, a real button");
      require(link.querySelector(".me-file-t")?.textContent === "團隊總覽報告" && link.querySelector("small")?.textContent === "頁面", "its title and 「頁面」");
      require(link.querySelector("svg.i"), "with the page's icon");
      require(!document.querySelector(".page-agent .pg-card") && !(frame && !frame.hidden), "no frame, and nothing opens until it is pressed");
      const line = link.closest(".tn, [data-key]").getBoundingClientRect(), box = link.getBoundingClientRect();
      require(box.left >= line.left && box.right <= line.right + 1, "the card stays inside the reply");
      // The file card's own measure: at least 56 px, as tall as its two lines of words.
      require(getComputedStyle(link).minHeight === "56px" && box.height >= 56 && box.height <= 60, `the file card's height: ${box.height}`);
      return { check: name, width: Math.round(box.width) };
    }
    require(view, "the report view exists");
    if (name === "page-report-closed") {
      require(frame.hidden && !stage.classList.contains("is-page"), "the report is put away");
      const arrow = document.querySelector('.page-agent .mb-head [data-page-back]');
      require(!arrow || arrow.hidden || !visible(arrow), "the arrow is gone");
      const member = document.querySelector('.page-agent .mb-head [data-act="share-member"]');
      require(!member || member.hidden || visible(member), "the conversation header's share is back");
      require(!document.querySelector('.page-agent .mb-head [data-page-act]'), "the report's button left with the report");
      require(getComputedStyle(scroller).visibility === "visible", "the thread is in sight again");
      require(document.activeElement === link, "the focus is back on the card that opened it");
      const box = link.getBoundingClientRect(), area = scroller.getBoundingClientRect();
      require(box.top >= area.top && box.bottom <= area.bottom, "the card is where it was, in sight");
      return { check: name };
    }
    require(!frame.hidden && stage.classList.contains("is-page") && stage.dataset.pageKind === "report", "the report is open in the conversation's place");
    require(![...document.querySelectorAll(".mb-scrim, .mb-dialog")].some(layer => !layer.closest("[hidden]")), "no dialog, no scrim");
    // The way back is the conversation header's round arrow at its top left, the same one an HTML page has; no × over the report.
    const back = document.querySelector('.page-agent .mb-head [data-page-back]'), arrowBox = back?.getBoundingClientRect(), headBox = document.querySelector('.page-agent .mb-chat:not([hidden]) > .mb-head').getBoundingClientRect();
    require(back && visible(back) && back.getAttribute("aria-label") === "返回" && Math.round(arrowBox.width) === 36 && Math.round(arrowBox.height) === 36 && arrowBox.left - headBox.left <= 12 + (parseFloat(getComputedStyle(back.parentElement).marginLeft) || 0), "the arrow named 返回 at the header's top left, the window edge's round button");
    require(!view.querySelector(".rp-close, [data-report-act=close], .rp-top, .btn"), "nothing floats over the report: no × and no button");
    // 存成檔案 stands where a thread's share stands (owner, 2026-11-12: its place and look as Grok Bot's share): first of the header's
    // tools at its top right, the window edge's round button, level with the arrow, drawn as a file and not as the member's share.
    const save = document.querySelector('.page-agent .mb-chat:not([hidden]) > .mb-head .ra-tools > [data-page-act]'), saveBox = save?.getBoundingClientRect();
    require(save && visible(save) && save === save.parentElement.firstElementChild && save.getAttribute("aria-label") === "存成檔案" && save.textContent.trim() === "" && save.querySelector("svg"), "one button named 存成檔案 leads the header's tools, no word on it");
    require(Math.round(saveBox.width) === 36 && Math.round(saveBox.height) === 36 && parseFloat(getComputedStyle(save).borderRadius) >= 18, "the window edge's soft round button, 36 px");
    require(Math.abs((saveBox.top + saveBox.bottom) - (arrowBox.top + arrowBox.bottom)) <= 2 && headBox.right - saveBox.right < headBox.width / 4, "in the header's row, level with the arrow, at its right");
    const drawnAs = button => [...(button?.querySelectorAll("svg path") ?? [])].map(path => path.getAttribute("d")).join(" ");
    const memberShare = document.querySelector('.page-agent .mb-head [data-act="share-member"]');
    require(drawnAs(save) && drawnAs(save) !== drawnAs(memberShare), "its icon is not the one that shares a member");
    require(!memberShare || !visible(memberShare), "the member's share waits: one button in that place");
    require(getComputedStyle(scroller).visibility === "hidden", "the thread is out of sight under it");
    const dock = stage.querySelector(":scope > .ra-dock"), composer = dock.querySelector(".composer");
    require(composer && visible(composer), "the member's composer stays below the report");
    require(view.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 1, "the report ends where the composer begins");
    // The report stands for the thread: its column starts and ends where the composer does, and so do its tools (R-UI-45,
    // the judge on the first Share run: the × ended past the composer at every width).
    const column = composer.getBoundingClientRect(), doc = view.querySelector(".rp-doc").getBoundingClientRect();
    require(Math.abs(doc.left - column.left) <= 1 && Math.abs(doc.right - column.right) <= 1, `the report's column is the composer's: ${Math.round(doc.left)}-${Math.round(doc.right)} and ${Math.round(column.left)}-${Math.round(column.right)}`);
    const page = view.querySelector(":scope > .rp-scroll");
    require(page.scrollWidth <= page.clientWidth + 1, "nothing runs out sideways");
    require(getComputedStyle(page).maskImage.includes("gradient"), "what scrolls away fades before the header, as the thread does");
    if (name === "page-report-open") {
      require(document.querySelector(".rp-title")?.textContent === "團隊總覽報告", "its title");
      const sub = document.querySelector(".rp-sub")?.textContent ?? "";
      require(/^資料截至 \d{4}\/\d\d\/\d\d \d\d:\d\d · 只寫有紀錄的事實$/.test(sub), `the time its data is from, and that it states recorded facts only: ${sub}`);
      const toc = [...document.querySelectorAll(".rp-toc a")].map(entry => entry.textContent);
      require(toc.join("|") === "重點發現|總覽表|分工與協作", `its contents: ${toc}`);
      require(visible(document.querySelector(".rp-callout")), "the summary box above the findings");
      const words = [...document.querySelectorAll(".rp-items .rp-st")].map(word => getComputedStyle(word).color);
      require(words.length === 4 && new Set(words).size === 4, "four status words, each in its own colour");
      return { check: name, toc };
    }
    if (name === "page-report-shared") {
      const saves = window.__look.calls.filter(call => call.command === "report_save");
      require(saves.length === 1 && saves[0].id === "page-report", "one press saved the report on screen, once");
      const file = saves[0].html;
      require(file.startsWith(`<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';`), "the file starts with its policy");
      require(!/<script|<iframe|<img|<button|data-report-tab/.test(file), "nothing in it runs, and its table has no tabs");
      require(file.includes("<title>團隊總覽報告</title>") && (file.match(/class="rp-team-at"/g) ?? []).length === 3, "its title, and the team drawn for each width it may be read at");
      // Both themes' words, as the window's stylesheet holds them, and the page's own rules (report-page.css).
      require(/^[^]*?<style>:root\{[^}]*--content:#ffffff;/.test(file) && /prefers-color-scheme: dark\)\{:root\{[^}]*--content:#0a0a0a;/.test(file), "the light theme's words and the dark theme's");
      require(file.includes('.rp-st[data-tone="ok"]') && !/<style>[^<]*<(?!\/style>)/.test(file), "the page's own rules, with no tag in them");
      const toast = [...document.querySelectorAll(".toast")].at(-1)?.textContent;
      require(toast === "已存到「下載」", `it says where the file went: ${toast}`);
      require(document.activeElement?.closest(".rp-view") || document.activeElement?.matches("[data-page-act]") || document.activeElement === document.body, "the focus stays with the report or its button");
      return { check: name, bytes: file.length };
    }
    if (name === "page-report-team") {
      const team = document.querySelector(".rp-sec[data-kind=team]"), top = team.getBoundingClientRect().top, from = page.getBoundingClientRect().top;
      require(top >= from + 32 && top <= from + 48 || page.scrollTop + page.clientHeight >= page.scrollHeight - 1, "the contents brought the team to where the title stands, clear of the fade");
      const draw = team.querySelector(".rp-team-draw"), box = draw.getBoundingClientRect(), column = team.getBoundingClientRect();
      require(box.left >= column.left - 1 && box.right <= column.right + 1, "the diagram fits its column");
      const nodes = [...draw.querySelectorAll(".rp-node")].map(node => ({ node, box: node.getBoundingClientRect() }));
      require(nodes.length === 5, "one box for each of the five");
      nodes.forEach((a, index) => nodes.slice(index + 1).forEach(b => require(!overlaps(a.box, b.box), "no box over another")));
      const labels = [...draw.querySelectorAll(".rp-lab")].map(label => label.getBoundingClientRect());
      require(labels.length === 6 && draw.querySelectorAll(".rp-lines > path").length === 6, "six arrows, each saying what passes along it");
      labels.forEach((label, index) => {
        nodes.forEach(({ box: node }) => require(!overlaps(label, node), "no label over a box"));
        labels.slice(index + 1).forEach(other => require(!overlaps(label, other), "no label over another"));
      });
      require(new Set(nodes.map(({ node }) => getComputedStyle(node, "::before").backgroundColor)).size === 5, "each one's own colour down the left of its box");
      require([...draw.querySelectorAll(".rp-node b")].map(name => name.textContent).join("|") === "Sam|拉斐爾|紫苑|小晴|小森", "the owner and the members by their names");
      require([...team.querySelectorAll(".rp-notes dt")].map(term => term.textContent).join("|") === "重複|缺口", "overlaps and gaps under the diagram");
      return { check: name, width: Math.round(box.width), height: Math.round(box.height) };
    }
    if (name === "page-report-tab") {
      const rows = [...document.querySelectorAll(".rp-table tbody tr")];
      require(rows.map(row => row.hidden).join() === "true,true,false,true", "only 語言學習's row is shown");
      require(document.querySelector('.rp-table-box [data-report-tab="g1"]').getAttribute("aria-selected") === "true", "its tab is the chosen one");
      const tabs = [...document.querySelectorAll(".rp-table-box [data-report-tab]")].map(tab => tab.textContent.replace(/\d+$/, ""));
      require(tabs.join("|") === "全部|專案工作|語言學習|其他", `the groups as tabs: ${tabs}`);
      return { check: name };
    }
  }
  if (name === "page-gone") {
    const failed = document.querySelector(".pg-failed");
    require(failed && !failed.hidden, "the page that failed shows it");
    // What failed comes first, in the card's body line, then what it knows of the page in a well where the page stood
    // (the judge read the page's words alone, beside 未能完成, as a success, 2026-11-10).
    const said = failed.firstElementChild, well = failed.querySelector(".card-well");
    require(said?.matches('.card-body[role="alert"]') && said.textContent.includes("這個頁面打不開"), "it says first that the page cannot open");
    require(well && visible(well) && well.textContent.includes("NT$ 1,280"), "then what it knows of the page, in a well");
    require(failed.querySelector('[data-page-act="retry"]'), "and offers to try again");
    require(document.querySelector(".pg-body").hidden, "no empty box is left");
    // An empty state of the card (owner, 2026-11-11): the words, what it knows and 再試一次 stand together, centred in the
    // area the preview has, with no blank gap between them or under the title row.
    const card = failed.closest(".pg-card"), area = failed.getBoundingClientRect();
    const retry = failed.querySelector('[data-page-act="retry"]').getBoundingClientRect();
    const stack = [said, well, failed.querySelector('[data-page-act="retry"]')].map(node => node.getBoundingClientRect());
    const centre = box => box.left + box.width / 2;
    for (const [what, box] of [["words", stack[0]], ["well", stack[1]], ["retry", stack[2]]]) {
      require(Math.abs(centre(box) - (area.left + area.width / 2)) <= 1, `the ${what} are centred across the card (${Math.round(centre(box) - (area.left + area.width / 2))} px)`);
    }
    const above = stack[0].top - area.top, under = area.bottom - retry.bottom;
    require(Math.abs(above - under) <= 1.5, `the stack is centred in the area (${Math.round(above)} px above, ${Math.round(under)} px under)`);
    require(stack[1].top - stack[0].bottom <= 16 && stack[2].top - stack[1].bottom <= 16, "the words, the well and the retry stand together, no blank gap between them");
    // It stands where the preview does, directly under the title row, and the card is as tall as one that is ready.
    const body = card.querySelector(".pg-body"), height = () => card.getBoundingClientRect().height;
    body.hidden = false; failed.hidden = true;
    const ready = { top: body.getBoundingClientRect().top, height: height() };
    body.hidden = true; failed.hidden = false;
    require(Math.abs(area.top - ready.top) <= 0.5, `the empty state stands where the preview does (${area.top} against ${ready.top})`);
    require(Math.abs(height() - ready.height) <= 0.5, `the failed card is as tall as a ready one (${height()} against ${ready.height})`);
    const mark = card.querySelector(":scope > .card-head > [data-card-failed-close]");
    mark.style.display = "none";
    require(Math.abs(height() - ready.height) <= 0.5, "the × in the heading makes the card no taller");
    mark.style.display = "";
    require(![...card.querySelectorAll(":scope > .card-actions")].some(visible), "the failed page has no expand row");
    // As tall as the preview it stands for, so a card that fails moves nothing in the thread (owner, 2026-11-11).
    const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--h-page-peek"));
    require(Math.abs(area.height - peek) <= 0.5, `the failed area is as tall as the preview (${area.height} against ${peek})`);
    // R-UI-117: a failed card is put away by the × in its heading.
    const close = card.querySelector(":scope > .card-head > [data-card-failed-close]");
    require(close && visible(close), "the × that puts it away is in its heading");
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
    // Each row keeps the height of its two lines: a long list never squeezes them onto each other (owner, 2026-11-09).
    const rows = [...list.querySelectorAll(".cb-row")];
    const squeezed = rows.filter(row => row.scrollHeight > row.clientHeight + 1).length;
    const overlapping = rows.slice(1).filter((row, i) => row.getBoundingClientRect().top < rows[i].getBoundingClientRect().bottom - 0.5).length;
    require(!squeezed && !overlapping, `every model row holds its name and price apart (${squeezed} squeezed, ${overlapping} overlapping)`);
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
    // The button stands at the composer's left, so the card begins at the button and runs inward: right-aligned to it, the card
    // reached out over the sidebar (2026-11-11).
    const popover = document.querySelector("#app-popover").getBoundingClientRect(), box = document.querySelector(".composer").getBoundingClientRect();
    require(popover.left >= box.left - 1, `the card stays over the conversation: it begins at ${Math.round(popover.left)}, the composer at ${Math.round(box.left)}`);
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
  if (name === "chooser-claude") {
    const pane = document.querySelector(".model-chooser .mc-pane"), list = pane.querySelector(".mc-list"), rows = [...list.querySelectorAll(".mc-row")];
    const shown = rows.map(row => row.querySelector(".mc-model-line strong").textContent.trim());
    require(rows.length >= 8, `Claude Code has many models, not three: ${rows.length}`);
    require(shown.every(text => /^Claude (Opus|Fable|Sonnet|Haiku) \d+(\.\d+)?$/.test(text)), `every model says its version: ${shown.join(", ")}`);
    require(new Set(shown).size === shown.length, "no two rows share a name");
    require(rows.every(row => /^cli:claude:claude-[a-z0-9-]+$/.test(row.dataset.model)), "each row is the exact model it runs, never an alias");
    require(shown.slice(0, 4).join() === "Claude Opus 5.5,Claude Fable 5.2,Claude Sonnet 5.5,Claude Haiku 5.5", `the CLI's own four come first, in its order: ${shown.slice(0, 4)}`);
    require(shown.indexOf("Claude Opus 4.8") > shown.indexOf("Claude Opus 5"), "older models follow, the newest of a family first");
    const box = list.getBoundingClientRect();
    require(rows.every(row => { const strong = row.querySelector("strong"); return strong.scrollWidth <= strong.clientWidth + 1; }), "every name is whole, none cut with an ellipsis");
    require(rows.every(row => row.getBoundingClientRect().left >= box.left - 1 && row.getBoundingClientRect().right <= box.right + 1), "every row is inside the list");
    require(list.scrollWidth <= list.clientWidth + 1 && pane.scrollWidth <= pane.clientWidth + 1, "nothing scrolls sideways");
    require(rows.filter(row => row.getAttribute("aria-checked") === "true").length <= 1, "no more than one model is checked");
    const row = rows[0], strong = row.querySelector("strong");
    window.__claudeRow = { height: Math.round(row.getBoundingClientRect().height), name: getComputedStyle(strong).fontSize + getComputedStyle(strong).fontWeight,
      parts: [...row.children].map(part => part.className.split(" ")[0]).join(), mark: !!row.querySelector(".mono svg, .mono img, svg") };
    return { check: name, rows: rows.length };
  }
  if (name === "chooser-claude-style") {
    const was = window.__claudeRow, row = document.querySelector(".model-chooser .mc-list .mc-row"), strong = row.querySelector("strong");
    require(was, "the Claude Code list was measured first");
    const now = { height: Math.round(row.getBoundingClientRect().height), name: getComputedStyle(strong).fontSize + getComputedStyle(strong).fontWeight,
      parts: [...row.children].map(part => part.className.split(" ")[0]).join(), mark: !!row.querySelector(".mono svg, .mono img, svg") };
    require(was.parts === now.parts && was.name === now.name && was.mark === now.mark, `a Claude Code row is made as a Codex row: ${JSON.stringify(was)} / ${JSON.stringify(now)}`);
    require(Math.abs(was.height - now.height) <= 2, `and as tall (${was.height} / ${now.height} px)`);
    return { check: name };
  }
  if (name === "composer-claude-alias") {
    const face = document.querySelector(".composer .cmp-model .mp-tname")?.textContent.trim();
    require(face === "Claude Haiku 5.5", `a member saved as 「haiku」 reads the model it is on: ${face}`);
    require(window.__look.data.members.find(member => member.id === 3).model === "cli:claude:haiku", "and is still saved with its alias");
    return { check: name };
  }
  if (name === "composer-claude-alias-row") {
    const row = document.querySelector('.cb-menu [data-model="cli:claude:claude-haiku-5-5"]');
    require(row?.getAttribute("aria-checked") === "true", "the row of the model its alias is, is the one checked");
    require(document.querySelectorAll('.cb-menu .cb-list [aria-checked="true"]').length === 1, "and only that one");
    require(!document.querySelector('.cb-menu [data-model="cli:claude:haiku"]'), "no row stands for the alias itself");
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
  if (["member-maker", "member-maker-box", "member-maker-tab", "member-maker-chosen", "member-maker-taken"].includes(name)) {
    // 新增成員 is one small dialog over the dimmed window, as Grok Bot's Create New Bot (owner, 2026-11-11): the large slime, the name
    // directly under it, the shared tabbed picker, 取消 and 建立. The numbers are Grok Bot's 440 x 582 dialog and its 56 px pitch, scaled to the picker.
    const dialog = document.querySelector(".cr-dialog"), scrim = dialog.closest(".mb-scrim");
    const faceBox = dialog.querySelector(".cr-face"), face = faceBox.querySelector("svg.slime"), nameField = dialog.querySelector("#mb-new-name");
    const picker = dialog.querySelector(".cr-picker"), tabs = [...picker.querySelectorAll('[role="tab"]')], panels = picker.querySelector(".mb-slime-panels");
    const foot = dialog.querySelector(".mb-dlg-act"), cancel = foot.querySelector('[data-dlg="cancel"]'), start = foot.querySelector('[data-dlg="create"]');
    const box = element => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n * 10) / 10); };
    if (name === "member-maker-box") {
      window.__look.makerBox = { dialog: box(dialog), face: box(faceBox), name: box(nameField), picker: box(picker), panels: box(panels), tabs: tabs.map(box), foot: box(foot) };
      window.__look.makerFace = face.outerHTML;
      return { check: name };
    }
    const whole = dialog.getBoundingClientRect(), bodyBox = dialog.querySelector(".mb-dlg-body").getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(dialog.querySelector(".mb-dlg-body")).paddingLeft);
    require(!scrim.classList.contains("store-scrim") && scrim.getBoundingClientRect().width >= innerWidth - 1, "it stands over the whole window, not in the place of the conversation");
    require(getComputedStyle(scrim).backgroundColor !== "rgba(0, 0, 0, 0)", "the window behind it is dimmed");
    const cx = (whole.left + whole.right) / 2, padTop = parseFloat(getComputedStyle(scrim).paddingTop), padBottom = parseFloat(getComputedStyle(scrim).paddingBottom);
    const cy = (whole.top + whole.bottom) / 2, areaCy = (padTop + innerHeight - padBottom) / 2;
    require(Math.abs(cx - innerWidth / 2) <= 1.5 && Math.abs(cy - areaCy) <= 1.5, `it is centred over the window (${Math.round(cx)},${Math.round(cy)} of ${innerWidth / 2},${areaCy})`);
    require(whole.width >= 300 && whole.width <= 441, `about as wide as Grok Bot's 440, and no wider than its picker needs (${Math.round(whole.width)} px)`);
    require(whole.height <= 600 || innerHeight < 700, `no taller than about 600 px (${Math.round(whole.height)} px in a ${innerHeight} px window)`);
    require(whole.top >= 0 && whole.bottom <= innerHeight && whole.left >= 0 && whole.right <= innerWidth, "the whole dialog stands in the window");
    // Nothing scrolls inside it.
    for (const part of [dialog, dialog.querySelector(".mb-dlg-body"), panels, picker]) require(part.scrollHeight <= part.clientHeight + 1 && part.scrollWidth <= part.clientWidth + 1, `nothing scrolls inside (.${part.className.split(" ")[0]} ${part.scrollHeight} of ${part.clientHeight})`);
    // The order: head, large slime, name, tabs, grid, footer, each directly under the one before.
    const head = dialog.querySelector(".mb-dlg-head"), order = [head, faceBox, nameField, picker.querySelector(".mb-slime-tabs"), panels, foot].map(part => part.getBoundingClientRect());
    order.slice(1).forEach((below, at) => require(below.top >= order[at].bottom - 1, `the order is head, slime, name, tabs, grid, footer (part ${at + 1} starts above part ${at} ends)`));
    require(head.querySelector("h2").textContent.trim() === "新增成員" && visible(head.querySelector('[data-dlg="close"]')), "the title at the left and the × at the right");
    require(head.querySelector("h2").getBoundingClientRect().left < head.querySelector('[data-dlg="close"]').getBoundingClientRect().left, "the title is left of the ×");
    // The preview is large and in the middle; the name is directly under it and centred.
    const f = face.getBoundingClientRect();
    require(f.width >= 80 && f.width <= 110 && Math.abs((f.left + f.right) / 2 - cx) <= 2, `the slime is large (${Math.round(f.width)} px), in the middle`);
    const n = nameField.getBoundingClientRect();
    require(n.top - faceBox.getBoundingClientRect().bottom <= 16, `the name field is directly under the slime (${Math.round(n.top - faceBox.getBoundingClientRect().bottom)} px)`);
    require(getComputedStyle(nameField).textAlign === "center" && nameField.placeholder === "名字" && nameField.maxLength === 16, "centred text, a placeholder in the window's language, the member name length");
    require(Math.abs(n.left - (bodyBox.left + pad)) <= 1 && Math.abs(n.right - (bodyBox.right - pad)) <= 1, "the name field fills the body's inner width");
    require(dialog.querySelectorAll("input, textarea").length === 1 && !dialog.querySelector('img, input[type="file"], [data-dlg="templates"], [data-tab], [data-pick]'), "it asks only for a name: no template button, no store tab, no pictures");
    // The tabs fill the dialog's inner width: nothing blank at their right, six slimes across.
    const first = tabs[0].getBoundingClientRect(), last = tabs[tabs.length - 1].getBoundingClientRect();
    require(tabs.length === 6 && tabs.every(tab => visible(tab) && Math.abs(tab.getBoundingClientRect().top - first.top) <= 1), "six tabs in one row");
    require(Math.abs(first.left - n.left) <= 2 && Math.abs(last.right - n.right) <= 2, `the tabs reach both inner edges as the name field does (${Math.round(first.left - n.left)} and ${Math.round(last.right - n.right)} px)`);
    const open = [...picker.querySelectorAll("[data-slime-group]")].filter(panel => getComputedStyle(panel).visibility !== "hidden" && !panel.hasAttribute("inert"));
    require(open.length === 1 && open[0].dataset.slimeGroup === picker.querySelector('[role="tab"][aria-selected="true"]').dataset.slimeTab, "only the chosen tab's slimes show");
    const shown = [...open[0].querySelectorAll("button")], cells = shown.map(button => button.getBoundingClientRect());
    require(shown.length > 0 && shown.every(visible), "the open group's slimes are all there");
    require(new Set(cells.map(cell => Math.round(cell.left))).size === Math.min(6, shown.length), "six slimes across");
    require(cells.every(cell => cell.left >= n.left - 8 && cell.right <= n.right + 8), "the grid stays inside the dialog's inner edges");
    require(picker.querySelectorAll('[aria-pressed="true"]').length === 1, "exactly one slime is chosen");
    require(getComputedStyle(picker).position === "static" && getComputedStyle(picker).boxShadow === "none", "the picker lost the popover's chrome inside the dialog");
    // The footer: 取消 then 建立 at the right, as every dialog (R-UI-27).
    const c = cancel.getBoundingClientRect(), s = start.getBoundingClientRect();
    require(c.right <= s.left && Math.abs(s.right - (whole.right - pad)) <= 1.5 && Math.abs(c.height - s.height) <= 0.5 && cancel.textContent.trim() === "取消" && start.textContent.trim() === "建立", "取消 then 建立 at the right of the footer, one height");
    require(!document.querySelector(".mb-scrim ~ .mb-scrim") && document.querySelectorAll(".cr-dialog").length === 1, "one dialog");
    if (name === "member-maker") {
      require(start.disabled && !cancel.disabled && document.activeElement === nameField, "the name has the focus and there is nothing to press yet");
      require(picker.querySelector('[role="tab"][aria-selected="true"]').dataset.slimeTab === "colors", "it opens on the group of the slime that is chosen");
    } else if (name === "member-maker-tab") {
      const before = window.__look.makerBox, same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 0.6);
      require(before, "the dialog was measured before the press");
      require(same(box(dialog), before.dialog) && same(box(faceBox), before.face) && same(box(nameField), before.name) && same(box(picker), before.picker) && same(box(panels), before.panels) && same(box(foot), before.foot), "a tab press moved and resized nothing");
      require(tabs.every((tab, i) => same(box(tab), before.tabs[i])), "no tab moved");
      require(picker.querySelector('[role="tab"][aria-selected="true"]').dataset.slimeTab === "characters", "the pressed tab is the chosen one");
      require(face.outerHTML === window.__look.makerFace, "a tab changes no slime: the large one is as it was");
    } else if (name === "member-maker-chosen") {
      require(!start.disabled, "a name makes 建立 pressable");
      require(picker.querySelector('[data-slime-character="shion"]').getAttribute("aria-pressed") === "true" && picker.querySelectorAll('[data-slime-color][aria-pressed="true"]').length === 0, "one slime is chosen");
      require(face.outerHTML !== window.__look.makerFace, "the large slime follows the one pressed");
      const parts = [...face.querySelectorAll("path")].filter(part => part.getBoundingClientRect().width && getComputedStyle(part).visibility !== "hidden").map(part => part.getBoundingClientRect());
      require(parts.length > 0 && getComputedStyle(face).clipPath === "none", "the chosen slime is painted whole");
      for (let el = face.parentElement; el && el !== dialog; el = el.parentElement) {
        const seen = getComputedStyle(el), bounds = el.getBoundingClientRect(), reserve = Number(seen.overflowClipMargin.match(/([\d.]+)px/)?.[1] ?? 0);
        require(el.matches(".mb-dlg-body") || (seen.clipPath === "none" && (seen.overflow === "visible" || parts.every(part => part.left >= bounds.left - reserve && part.right <= bounds.right + reserve && part.top >= bounds.top - reserve && part.bottom <= bounds.bottom + reserve))), `nothing cuts the slime's wings and horns (.${el.className})`);
      }
    } else {
      // member-maker-taken: refused where it was typed, with the name kept and nothing made.
      require(nameField.value === "小森" && nameField.getAttribute("aria-invalid") === "true" && document.activeElement === nameField, "the name stays, marked, with the focus");
      const said = dialog.querySelector(".field-error");
      require(visible(said) && said.textContent.includes("小森") && said.getBoundingClientRect().top >= nameField.getBoundingClientRect().bottom - 1 && said.getBoundingClientRect().bottom <= picker.getBoundingClientRect().top + 1, "why is said in the dialog, between the name and the picker");
      require(!window.__look.calls.some(call => call.method === "members.create"), "nothing was made");
    }
    return { check: name, width: Math.round(whole.width), height: Math.round(whole.height) };
  }
  if (name === "member-maker-closed") {
    require(!document.querySelector(".cr-dialog, .mb-scrim"), "the dialog is gone");
    require(!window.__look.calls.some(call => call.method === "members.create"), "nothing was made");
    require(visible(document.querySelector(".composer .cmp-input")) || visible(document.getElementById("nav")), "the app is as it was behind it");
    return { check: name };
  }
  if (name === "member-maker-made") {
    const made = window.__look.calls.filter(call => call.method === "members.create");
    require(made.length === 1 && made[0].params.name === "哥布達" && made[0].params.avatar === "slime:gobta" && made[0].params.greet === true, "the member is made once, with its slime, and asked to greet");
    require(!document.querySelector(".cr-dialog, .mb-scrim"), "the dialog closed at once");
    require(visible(document.querySelector(".composer .cmp-input")), "its conversation is open");
    const greeting = [...document.querySelectorAll(".page-agent .ra-body")].filter(visible);
    require(greeting.length === 1 && greeting[0].textContent.includes("哥布達"), "it speaks first, in its own words");
    const card = greeting[0].querySelector('[data-owner-question][data-card-state="asked"]');
    require(visible(card) && card.textContent.includes("你想先讓我接手哪一件事？") && card.querySelectorAll("[data-owner-option]").length === 4, "and asks what to take on first on one question card, with four options");
    require(visible(card.querySelector("[data-owner-answer-input]")), "the owner may answer in their own words");
    require(![...document.querySelectorAll(".page-agent .owner-message")].some(visible), "nothing is put in the owner's mouth");
    require(!visible(document.querySelector(".page-agent .work-toggle")), "no steps are claimed for what it said");
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
    // A blink of a small slime lands on whole rows of its eye strip at every closing step.
    const blinkStrips = [...document.querySelectorAll(".mb-row .slime-loop.has-blink .slime-blink-cels")];
    require(blinkStrips.length > 0, "a thinking slime in the list blinks through its eye strip");
    for (const strip of blinkStrips) {
      const blink = strip.getAnimations().find(running => running.animationName === "slime-loop-blink");
      require(blink, "the blink runs as its own animation");
      const timing = blink.effect.getTiming(), period = Number(timing.duration), delay = Number(timing.delay) || 0, was = blink.currentTime;
      const row = strip.offsetHeight / Number(getComputedStyle(strip).getPropertyValue("--loop-rows"));
      const turns = Math.ceil(Math.abs(delay) / period) + 1;
      blink.pause();
      for (const [at, rows] of [[.0875, 1], [.095, 2], [.125, 3], [.5, 0]]) {
        blink.currentTime = delay + period * (turns + at);
        const moved = -new DOMMatrix(getComputedStyle(strip).transform).f;
        require(Math.abs(moved - rows * row) < 0.5, `a blink step lands on row ${rows} (moved ${moved.toFixed(2)}px, a row is ${row.toFixed(2)}px)`);
      }
      blink.currentTime = was; blink.play();
    }
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
    // One drawing at a time: while the vector stands in for the strips of the new state it is the only one painted, and when
    // the strips show the vector is gone (2026-11-11: the strips of an error showed at 320 ms over the vector, two horns).
    for (const face of document.querySelectorAll(".look-slime-board .mb-av-slime")) {
      const svg = face.querySelector("svg.slime"), surface = svg?.closest(".slime-surface");
      if (!svg || !surface) continue;
      const shown = node => { const css = getComputedStyle(node); return css.display !== "none" && css.visibility !== "hidden" && Number(css.opacity) > 0; };
      const strips = [...surface.querySelectorAll(":scope > .slime-loop:not([data-slime-loading])")].filter(shown);
      require(!(strips.length && shown(svg)), `two drawings of the slime are painted at once in ${face.closest(".look-slime-board > div").textContent.slice(0, 3)} (${face.textContent.trim()}, ${svg.dataset.state})`);
    }
    return { check: name, rows: document.querySelectorAll(".look-slime-board > div").length };
  }
  // ---------- 連結應用程式 as Grok Bot's Connect Apps (R-APPS-01, R-APPS-02) and one colour for everything that floats (R-FLOAT-01) ----------
  const colourOf = (prop, tokenName) => { const probe = document.createElement('i'); probe.style[prop] = `var(${tokenName})`; document.body.append(probe); const out = getComputedStyle(probe)[prop]; probe.remove(); return out; };
  const connectModal = () => document.querySelector('.modal-scrim[data-standalone="connections"] .modal');
  if (name === "icon-colours") {
    // The owner's colours on the tile (Simple Icons' hex of each brand; "black" = black in its official form; "multi" = drawn in several colours).
    const official = { notion: "black", github: "black", googledrive: "multi", gmail: "multi", googlecalendar: "multi", linear: "#5E6AD2", figma: "multi", spotify: "#1ED760", discord: "#5865F2", slack: "multi",
      todoist: "#E44332", obsidian: "#7C3AED", atlassian: "#0052CC", cloudflare: "#F38020", sentry: "#362D59", stripe: "#635BFF", n8n: "#EA4B71", zapier: "#FF4F00", paypal: "#002991", webflow: "#146EF5",
      wix: "#0C6EFC", netlify: "#00C7B7", neon: "#00E599", prisma: "#2D3748", airtable: "multi", calendly: "#006BFF", posthog: "black", postman: "#FF6C37", sanity: "#F03E2F", bitly: "#EE6123",
      telegram: "#26A5E4", openrouter: "black", brave: "#FB542B", searxng: "#3050FF" };
    const rgb = hex => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
    const seen = [];
    for (const card of document.querySelectorAll('.cs-card')) {
      const id = card.querySelector('[data-conn="open-store"]').dataset.id.replace(/^mark-/, '');
      const want = official[id];
      if (!want) continue;
      const tile = card.querySelector('.cs-tile'), mark = tile.querySelector('.mono');
      require(visible(tile) && getComputedStyle(tile).backgroundColor === 'rgb(255, 255, 255)', `${id} stands on the white tile`);
      seen.push(id);
      if (mark.matches('.logo-art')) { require(mark.querySelector('img.logo'), `${id}'s own full-colour logo is shown`); continue; }
      const fills = [...mark.querySelectorAll('path')].map(path => getComputedStyle(path).fill);
      if (want === 'multi') { require(new Set(fills).size > 2, `${id} is drawn in several colours (${[...new Set(fills)]})`); continue; }
      const colour = getComputedStyle(mark).color;
      if (want === 'black') {
        const [r, g, b] = colour.match(/\d+/g).map(Number);
        require(Math.max(r, g, b) < 60 && fills.every(fill => fill === 'currentcolor' || fill === colour || fill === 'rgb(10, 10, 10)'), `${id} is black on the tile (${colour})`);
      } else require(colour === rgb(want) && fills.every(fill => fill === colour), `${id} is ${want} on the tile, not ${colour} (${[...new Set(fills)]})`);
    }
    require(seen.length === Object.keys(official).length, `every mark of the set was checked (${seen.length} of ${Object.keys(official).length}: missing ${Object.keys(official).filter(id => !seen.includes(id))})`);
    return { check: name, marks: seen.length };
  }
  if (name === "float-cards") {
    // Inside a floating surface an inner card stands apart the Grok Bot way (R-FLOAT-02): the surface's own colour with a 1 px edge, or the control fill for a
    // control. Never a near-identical grey without an edge, never a darker hole. Controls (buttons, fields, switches) are told from the surface by their fill.
    const channels = value => { const m = value.match(/[\d.]+/g)?.map(Number); return m && m.length >= 3 ? { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } : null; };
    const lum = ({ r, g, b }) => [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
    const dark = document.documentElement.dataset.theme === 'dark';
    // A dialog is the middle layer and a card on it the lightest (owner, 2026-11-14): a box standing on the dialog is the card colour with its hairline, never a grey of its own.
    const dialogRgb = colourOf('backgroundColor', '--dialog'), cardRgb = colourOf('backgroundColor', '--float');
    const surfaces = [...document.querySelectorAll('.menu:not(.cb-menu), .cb-card, .mb-dialog, .modal, .au-pop, .cs-dialog, .av-crop')].filter(node => visible(node) && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)');
    require(surfaces.length > 0, "something floats in this picture");
    const control = 'button, input, textarea, select, .btn, .sel, .field, .tab, .tg, .mb-fin, .mail-in, [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"], .mc-range, .mc-track, .emoji-find, .chip, .cs-chip, kbd, .cs-cap';
    const selected = '[aria-pressed="true"], [aria-selected="true"], [aria-current], [aria-checked="true"], [data-on="true"], .is-selected, .is-active, .active, .on, [data-selected]';
    const bad = [];
    const seen = new Set();
    for (const root of surfaces) for (const node of root.querySelectorAll('*')) {
      if (seen.has(node) || node.namespaceURI === 'http://www.w3.org/2000/svg' || !visible(node)) continue;
      seen.add(node);
      if (surfaces.includes(node) || node.matches(':hover')) continue;
      const style = getComputedStyle(node), fill = channels(style.backgroundColor), box = node.getBoundingClientRect();
      if (!fill || fill.a < 0.5 || box.width < 36 || box.height < 24 || node.matches('img, canvas, video, iframe, progress, .cs-tile, .cs-mini, .av, .mono, .logo, [class*="slime"], .scrim, .mb-scrim, .modal-scrim, .cs-scrim, .owner-photo-edit, .trust, .ca-alert, .problem-notice, [role="alert"], [role="status"]')) continue;
      if (node.closest('svg, .toast, [class*="slime"], .av, .cr-preview, .av-crop-view, .desktop-screen, .tpl-art, .mp-thumb')) continue;
      let under = node.parentElement, ground = null;
      while (under && !ground) { const c = channels(getComputedStyle(under).backgroundColor); if (c && c.a >= 0.5) ground = c; else under = under.parentElement; }
      // what stands inside a control (the owner's photo disc in its button) is part of it
      if (!ground || (under && under.matches(control))) continue;
      const edge = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) >= 1 && style[`border${side}Style`] !== 'none' && (channels(style[`border${side}Color`])?.a ?? 0) >= 0.3 && ratio(channels(style[`border${side}Color`]), fill) > 1.08)
        || /inset 0px 0px 0px 1px/.test(style.boxShadow);
      const c = ratio(fill, ground), darker = lum(fill) < lum(ground) - 0.0005, isControl = node.matches(control);
      if (node.matches(selected)) continue;
      const groundRgb = `rgb(${ground.r}, ${ground.g}, ${ground.b})`;
      const onDialog = groundRgb === dialogRgb, onCard = groundRgb === cardRgb;
      // a darker hole (in the dark theme) and, in either theme, the dialog's own colour dug into a card
      const hole = (dark && darker && c > 1.03 && !node.matches('input, textarea, .field, .mb-fin, .mail-in, select, .mc-range')) || (onCard && style.backgroundColor === dialogRgb);
      if (onDialog && !isControl && style.backgroundColor === cardRgb && edge) continue;
      // a card is the surface itself with an edge (c ~ 1): any grey between is the near-identical one; a control is told from what it stands on by its fill
      const same = isControl ? (c < 1.06 && !edge) : (c < 1.02 ? !edge : c < 1.45);
      if (hole || same) bad.push(`${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]} ${Math.round(box.width)}x${Math.round(box.height)} ${style.backgroundColor} on ${ground.r},${ground.g},${ground.b} (${c.toFixed(2)}${hole ? ', darker' : ''})`);
    }
    require(bad.length === 0, `${bad.length} inner element(s) lose their background or stand as a near-identical grey without an edge: ${bad.slice(0, 14).join(' | ')}`);
    return { check: name, surfaces: surfaces.length };
  }
  if (name === "dialog-layers") {
    // Three layers (owner, 2026-11-14: 「最外層最深 ( dialog 外 )，再來是內層，再來是內容」): the window under the scrim, the dialog and its nav, a card on it, each lighter than the one outside it, in both themes.
    const channels = value => { const m = value.match(/[\d.]+/g)?.map(Number); return m && m.length >= 3 ? { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } : null; };
    const lum = ({ r, g, b }) => [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
    const hex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const scrim = [...document.querySelectorAll('.modal-scrim')].find(visible);
    const dialog = scrim?.querySelector('.modal');
    require(visible(dialog), "a dialog is open");
    const dim = channels(getComputedStyle(scrim).backgroundColor), page = channels(getComputedStyle(document.querySelector('.main')).backgroundColor);
    require(dim && page && dim.a > 0 && dim.a < 1, "the window is dimmed by the scrim, not hidden");
    const outside = { r: page.r * (1 - dim.a), g: page.g * (1 - dim.a), b: page.b * (1 - dim.a) };
    const middle = channels(getComputedStyle(dialog).backgroundColor);
    require(middle.a === 1 && getComputedStyle(dialog).backgroundColor === colourOf('backgroundColor', '--dialog'), `the dialog is the middle layer, --dialog (${getComputedStyle(dialog).backgroundColor})`);
    const nav = dialog.querySelector('.modal-nav');
    if (visible(nav)) require(['rgba(0, 0, 0, 0)', 'transparent', getComputedStyle(dialog).backgroundColor].includes(getComputedStyle(nav).backgroundColor), `the nav is the dialog's own colour (${getComputedStyle(nav).backgroundColor})`);
    // the lightest layer is a card (a settings group, an app's information box); the list of apps in 連結應用程式 has none and shows the dialog with the controls on it
    const card = [...dialog.querySelectorAll('.slist, .cs-box')].find(visible) ?? null;
    require(card || !visible(nav), "a settings pane shows its groups as cards");
    const control = card ? null : [...dialog.querySelectorAll('.cs-connect, .cs-chip:not([aria-pressed="true"])')].find(visible) ?? null;
    // the order of lightness, outside < dialog < card, with room enough to be seen (the card's hairline carries the rest in the light theme)
    require(lum(outside) < lum(middle) && ratio(outside, middle) >= 1.05, `outside ${hex(outside)} is darker than the dialog ${hex(middle)} (${ratio(outside, middle).toFixed(2)})`);
    let lightest = null;
    if (card) {
      lightest = channels(getComputedStyle(card).backgroundColor);
      require(lightest.a === 1 && getComputedStyle(card).backgroundColor === colourOf('backgroundColor', '--float'), `the card is --float (${getComputedStyle(card).backgroundColor})`);
      require(getComputedStyle(card).borderTopColor === colourOf('borderTopColor', '--float-edge') && parseFloat(getComputedStyle(card).borderTopWidth) === 1, "the card has its hairline");
      require(lum(middle) < lum(lightest) && ratio(middle, lightest) >= 1.05, `outside ${hex(outside)} < dialog ${hex(middle)} < card ${hex(lightest)} (${ratio(middle, lightest).toFixed(2)})`);
    } else if (control) {
      lightest = channels(getComputedStyle(control).backgroundColor);
      require(getComputedStyle(control).backgroundColor === colourOf('backgroundColor', '--float-ctl') && ratio(middle, lightest) >= 1.05, `a control on the dialog is --float-ctl and is told from it (${getComputedStyle(control).backgroundColor})`);
    }
    return { check: name, outside: hex(outside), dialog: hex(middle), lightest: lightest ? hex(lightest) : null, lightestIs: card ? 'card' : control ? 'control (this list has no card)' : 'none (this list has no card)' };
  }
  if (name === "float-surface") {
    // Whatever floats in this picture stands on the floating surface and its edge, and a control on it is filled with the control colour.
    const surface = colourOf('backgroundColor', '--float'), dialogLayer = colourOf('backgroundColor', '--dialog'), edge = colourOf('borderTopColor', '--float-edge'), control = colourOf('backgroundColor', '--float-ctl');
    const found = [...document.querySelectorAll('.menu:not(.cb-menu), .cb-card, .mb-dialog, .modal, .au-pop, .cs-dialog, .av-crop, .link-hover')].filter(node => visible(node) && (getComputedStyle(node).position !== 'static' || node.matches('.cb-card, .mb-dialog, .cs-dialog, .av-crop')));
    require(found.length > 0, "something floats in this picture");
    // A dialog stands on the middle layer; a menu, a popover and a card on the lightest one.
    for (const node of found) {
      const style = getComputedStyle(node), layer = node.matches('.mb-dialog, .modal, .cs-dialog, .av-crop, .menu.side-search') ? dialogLayer : surface;
      require(style.backgroundColor === layer, `${node.className.split(' ')[0]} stands on the ${layer === dialogLayer ? 'dialog' : 'card'} layer (${style.backgroundColor}, not ${layer})`);
      require(style.borderTopColor === edge && parseFloat(style.borderTopWidth) === 1, `${node.className.split(' ')[0]} has the floating edge (${style.borderTopColor} ${style.borderTopWidth})`);
    }
    // A text button standing on the surface is filled with the control colour (its frame), unless it is the primary or a bare icon.
    const buttons = found.flatMap(node => [...node.querySelectorAll('.btn:not(.pri):not(.icon):not(.danger)')]).filter(button => visible(button) && button.textContent.trim() && !button.matches('.cs-main, .cs-have, .mc-source, .gr, .cs-viewall, [role="menuitem"]'));
    for (const button of buttons) require(getComputedStyle(button).backgroundColor !== surface || parseFloat(getComputedStyle(button).borderTopWidth) >= 1, `a button on a floating surface is told from it by its fill, ${control} (${button.textContent.trim()})`);
    return { check: name, surfaces: found.map(node => node.className.split(' ')[0]), buttons: buttons.length };
  }
  if (name === "connections-empty") {
    const view = connectModal()?.querySelector('.cs-apps');
    require(visible(view) && !view.querySelector('[data-conn="connected"]'), "with nothing connected the chip of the connected apps is not there");
    require(view.querySelectorAll('.cs-card').length > 0, "the one view still offers apps to connect");
    return { check: name };
  }
  if (name === "connect-apps-view" || name === "connect-apps-scrolled") {
    const modal = connectModal(), view = modal?.querySelector('.cs-apps'), frame = modal.getBoundingClientRect();
    require(visible(view), "the one view of the apps is open");
    const results = view.querySelector('.cs-results');
    const title = view.querySelector('.cs-top h1'), chip = view.querySelector('[data-conn="connected"]'), close = modal.querySelector('.modal-x');
    require(visible(title) && title.textContent.trim() === '連結應用程式', "the title is at the top left");
    require(!view.querySelector('[role="tab"], [data-conn="tab"], .tabs, .cs-store-pages'), "there are no tabs and no pages");
    require(!/\d{3,}/.test(view.textContent.replace(/Acme Ledger \d+|\d+ 個已連結/g, '')), "no count of the catalogue is shown");
    const search = view.querySelector('#conn-search');
    const chips = view.querySelector('.cs-chips');
    if (name === "connect-apps-scrolled") {
      require(results.scrollTop > 0, `the list was scrolled (${results.scrollTop})`);
      // The top row, the search and the chips stand still while only the list scrolls under them.
      for (const node of [title, search, ...[...chips.children].filter(child => !child.hidden)]) {
        const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        require(box.top >= frame.top && node.contains(hit), "the title, the search and the chips stay put while the list scrolls");
      }
      return { check: name, scrollTop: results.scrollTop };
    }
    require(visible(chip) && /\d/.test(chip.textContent) && chip.querySelectorAll('.cs-mini').length >= 1 && chip.querySelectorAll('.cs-mini').length <= 4 && chip.querySelectorAll('.cs-mini').length === Math.min(4, Number(chip.textContent.match(/\d+/)[0])), `a chip of up to four marks, exactly the connected apps its number counts (${chip?.textContent.trim()}, ${chip.querySelectorAll('.cs-mini').length} marks)`);
    require(close && chip.getBoundingClientRect().right <= close.getBoundingClientRect().left - 4, "the chip stands clear of the dialog's ✕");
    require(search.getAttribute('placeholder') === '搜尋應用程式' && visible(view.querySelector('[data-k="conn-add"]')), "the search over the whole catalog, and 新增 beside it");
    const shown = [...chips.children].filter(child => !child.hidden);
    require(getComputedStyle(chips).flexWrap === 'nowrap' && chips.scrollWidth <= chips.clientWidth + 1, `the chips never wrap or scroll (${chips.scrollWidth} in ${chips.clientWidth})`);
    require(shown.every(child => Math.abs(child.getBoundingClientRect().top - shown[0].getBoundingClientRect().top) <= 1), "every chip is on one row");
    const all = chips.querySelector('[data-conn="store-group"][data-id=""]'), other = chips.querySelector('[data-conn="store-group"]:not([data-id=""]):not([hidden])');
    require(all.getAttribute('aria-pressed') === 'true' && getComputedStyle(all).backgroundColor === colourOf('backgroundColor', '--float-sel') && getComputedStyle(all).color === colourOf('color', '--float-on-sel'), "全部 is chosen: a light fill with dark words");
    require(getComputedStyle(other).backgroundColor === colourOf('backgroundColor', '--float-ctl'), "an unchosen chip is filled with the control colour of a floating surface");
    require(visible(chips.querySelector('[data-k="conn-more"]')), "更多 holds the rest");
    const heads = [...view.querySelectorAll('.cs-sec > .cs-sec-head h2')].map(node => node.textContent);
    require(heads[0] === '為你推薦' && heads.length >= 3, `為你推薦 and then a section for each category (${heads})`);
    const tile = view.querySelector('.cs-card .cs-tile'), box = tile.getBoundingClientRect();
    require(getComputedStyle(tile).backgroundColor === 'rgb(255, 255, 255)' && Math.round(box.width) === 40 && Math.round(box.height) === 40 && parseFloat(getComputedStyle(tile).borderTopLeftRadius) > 4, "the mark stands on a white rounded tile of 40 px");
    const connect = view.querySelector('.cs-card [data-conn="join"]'), connectBox = connect.getBoundingClientRect(), connectStyle = getComputedStyle(connect);
    require(connectStyle.backgroundColor === colourOf('backgroundColor', '--float-ctl') && parseFloat(connectStyle.borderTopLeftRadius) >= connectBox.height / 2 && connect.textContent.trim() === '連結', "連結 is a round button filled with the control colour");
    require(connectBox.height === 26 && connectBox.width < 120, `its height is the control token and its width hugs its words (${connectBox.width}x${connectBox.height})`);
    const done = view.querySelector('.cs-card .cs-state');
    require(done && !done.closest('.cs-card').querySelector('button.cs-connect') && done.textContent.includes('已連結'), "a connected app says 已連結 in quiet words and has no button");
    const surface = getComputedStyle(modal);
    require(surface.backgroundColor === colourOf('backgroundColor', '--dialog') && surface.borderTopColor === colourOf('borderTopColor', '--float-edge'), "the dialog stands on the dialog layer and its edge");
    const body = modal.querySelector('.modal-body');
    require(body.scrollWidth <= body.clientWidth + 1 && results.scrollWidth <= results.clientWidth + 1, "the dialog never scrolls sideways");
    require(results.getBoundingClientRect().bottom <= frame.bottom + 1 && results.getBoundingClientRect().top > chips.getBoundingClientRect().bottom - 1, "the list scrolls between the chips and the dialog's lower edge");
    return { check: name, chips: shown.length, sections: heads.length };
  }
  if (name === "connect-apps-category") {
    const view = connectModal().querySelector('.cs-apps'), chips = view.querySelector('.cs-chips');
    const chosen = chips.querySelector('[aria-pressed="true"]');
    require(chosen.dataset.id === 'productivity' && getComputedStyle(chosen).backgroundColor === colourOf('backgroundColor', '--float-sel'), "the chosen chip is a light fill with dark words");
    require(!view.querySelector('.cs-sec') && view.querySelectorAll('.cs-results > .cs-body > .cs-grid').length === 1, "a chosen category is one list, with no sections");
    const rows = [...view.querySelectorAll('.cs-card')];
    require(rows.length > 0 && rows.length <= 48 + 6, `its apps are listed, a screenful at a time (${rows.length})`);
    require(!/\d{3,}/.test(view.querySelector('.cs-results').textContent.replace(/Acme Ledger \d+/g, '')), "no count is shown");
    return { check: name, rows: rows.length };
  }
  if (name === "connect-apps-more") {
    const view = connectModal().querySelector('.cs-apps'), more = view.querySelector('[data-k="conn-more"]'), menu = document.querySelector('#app-popover');
    require(visible(menu) && more.getAttribute('aria-expanded') === 'true', "更多 opens a menu");
    const items = [...menu.querySelectorAll('button')].map(node => node.textContent.trim());
    const standing = [...view.querySelectorAll('.cs-chips [data-conn="store-group"]:not([hidden])')].map(node => node.textContent.trim());
    const hidden = [...view.querySelectorAll('.cs-chips [data-conn="store-group"][hidden]')].map(node => node.textContent.trim());
    require(items.length > 0 && JSON.stringify(items) === JSON.stringify(hidden), `it offers exactly the categories that are not in the row (${items} / ${hidden})`);
    require(!items.some(item => standing.includes(item)), "no category is in both");
    const style = getComputedStyle(menu);
    require(style.backgroundColor === colourOf('backgroundColor', '--float') && style.borderTopColor === colourOf('borderTopColor', '--float-edge'), "the menu stands on the floating surface");
    return { check: name, items: items.length };
  }
  if (name === "connect-apps-search") {
    const view = connectModal().querySelector('.cs-apps'), query = view.querySelector('#conn-search').value;
    require(query.length > 0 && !view.querySelector('.cs-sec'), "the search's results take the place of the sections");
    const rows = [...view.querySelectorAll('.cs-card')];
    require(rows.length > 0 && rows.every(row => row.querySelector('[data-conn="open-store"]')), "the results are rows of the whole catalog");
    require(!view.querySelector('.cs-chips [aria-pressed="true"]'), "no chip is chosen while there is a search");
    return { check: name, rows: rows.length, query };
  }
  if (name === "connect-apps-connected") {
    const view = connectModal().querySelector('.cs-connected'), back = view?.querySelector('[data-conn="back"]');
    require(visible(view) && visible(back) && back.tagName === 'BUTTON' && back.getAttribute('aria-label') === '返回', "the connected list has a back chevron at the top left");
    require(!view.querySelector('.cs-chips, #conn-search') && view.querySelector('.cs-top-t')?.textContent === '已連結', "it is the list alone, under its own title");
    const rows = [...view.querySelectorAll('.cs-linked')];
    require(rows.length > 0 && rows.every(row => visible(row.querySelector('.cs-tile')) && row.querySelector('[role="switch"]')), "each row has its tile, its name and its switch");
    const heads = [...view.querySelectorAll('.cs-body > .cs-sec > .cs-sec-head h2')].map(node => node.textContent);
    require(heads[0] === '應用程式' && heads[heads.length - 1] === '已關閉' && !heads.includes('尚未連結') , `the connected first, then 已關閉 for what is switched off (${heads})`);
    const offRows = [...view.querySelectorAll('.cs-body > .cs-sec:last-child .cs-linked')];
    require(offRows.length > 0 && offRows.every(row => row.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false'), "every row under 已關閉 is switched off, and keeps its switch");
    const edge = connectModal().querySelector('.modal-body').getBoundingClientRect().left;
    require(back.getBoundingClientRect().left - edge <= 40, "the chevron stands at the top left");
    return { check: name, rows: rows.length };
  }
  if (name === "connect-back") {
    const modal = connectModal(), back = modal.querySelector('.cs-back'), close = modal.querySelector('.modal-x'), content = modal.querySelector('.cs');
    require(visible(back) && visible(close) && back.matches('button[data-conn="back"]'), "the back chevron and the dialog's ✕ are both real buttons on screen");
    const a = back.getBoundingClientRect(), x = close.getBoundingClientRect(), centreY = (a.top + a.bottom) / 2, centreX = (a.left + a.right) / 2;
    require(Math.round(a.width) === Math.round(x.width) && Math.round(a.height) === Math.round(x.height) && a.width >= 30, `the back chevron is the ✕'s own size, not smaller (${a.width}x${a.height} against ${x.width}x${x.height})`);
    require(parseFloat(getComputedStyle(back).borderTopLeftRadius) >= a.height / 2, "it is round");
    require(Math.abs(centreY - (x.top + x.bottom) / 2) <= 1, `it stands on the ✕'s line (${centreY} against ${(x.top + x.bottom) / 2})`);
    const misses = [[a.left + 3, centreY], [a.right - 3, centreY], [centreX, a.top + 3], [centreX, a.bottom - 3], [centreX, centreY]].filter(([px, py]) => { const hit = document.elementFromPoint(px, py); return !(hit && (hit === back || back.contains(hit))); });
    require(misses.length === 0, `a press anywhere on its 36 px lands on it (${misses.length} points did not)`);
    const glyph = back.querySelector('svg.i').getBoundingClientRect();
    require(Math.round(glyph.width) === 18 && Math.abs(glyph.left - content.getBoundingClientRect().left) <= 3, `its glyph is 18 px and stands on the content's left edge (${glyph.left} against ${content.getBoundingClientRect().left})`);
    return { check: name, size: [a.width, a.height], close: [x.width, x.height] };
  }
  if (name === "connect-app-from-row") {
    const modal = connectModal(), page = modal.querySelector('.cs-page');
    require(visible(page) && page.querySelector('h2.big')?.textContent === 'Notion', "a press on a connected row opened that app's page");
    require(visible(page.querySelector('.cs-head .cs-state')) && visible(page.querySelector('.cs-tools')), "the page is the one the main view's row opens: its connected state and its tools");
    return { check: name };
  }
  if (name === "connected-rows") {
    const modal = connectModal(), list = modal.querySelector('.cs-connected'), rows = [...list.querySelectorAll('.cs-linked')];
    require(visible(list) && !modal.querySelector('.cs-page') && rows.length >= 3, "the list is on screen and no app's page opened from a press on a switch");
    const notion = list.querySelector('.cs-linked[data-id="composio:notion"] [role="switch"]');
    require(notion.getAttribute('aria-checked') === 'true', "the switch only turned the app off and on");
    const main = list.querySelector('.cs-linked:nth-child(2) .cs-main'), style = getComputedStyle(main);
    require(main.matches(':hover') && style.backgroundColor === colourOf('backgroundColor', '--float-hover') && style.cursor === 'pointer', `a row under the pointer has the pointer and the hover fill of the floating surface (${style.backgroundColor}, ${style.cursor})`);
    require(getComputedStyle(main.closest('.cs-linked')).cursor === 'pointer', "the whole row has the pointer");
    const box = main.getBoundingClientRect(), tile = main.querySelector('.cs-tile').getBoundingClientRect(), text = main.querySelector('.tx').getBoundingClientRect();
    require(tile.left - box.left >= 6 && box.right - text.right >= 6 && tile.top - box.top >= 6 && box.bottom - tile.bottom >= 6, `the fill stands 6 px or more clear of the words and the mark (${tile.left - box.left}, ${box.right - text.right})`);
    const switchBox = main.closest('.cs-linked').querySelector('[role="switch"]').getBoundingClientRect();
    require(switchBox.left - box.right >= 8, `the fill stops 8 px or more before the switch (${switchBox.left - box.right})`);
    return { check: name, rows: rows.length };
  }
  if (name === "owner-list") {
    // The owner's own list of 2026-11-14: the seven apps of his picture, all on, under no heading, with no app's page over them.
    const modal = connectModal(), list = modal.querySelector('.cs-connected'), rows = [...(list?.querySelectorAll('.cs-linked') ?? [])];
    require(visible(list) && !modal.querySelector('.cs-page') && list.querySelector('.cs-top-t')?.textContent === '已連結', "the connected list is on screen, under its own title, and no app's page is over it");
    require(!list.querySelector('.cs-sec-head'), "the list has no section heading");
    const names = rows.map(row => row.querySelector('.nm').textContent).sort().join(',');
    require(names === ['Gmail', 'GitHub', 'Google Calendar', 'Google Drive', 'Hugging Face', 'Mobbin MCP', 'Notion'].sort().join(','), `the rows are the seven apps of his picture (${names})`);
    require(rows.every(row => row.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true' && visible(row.querySelector('.ds')) && visible(row.querySelector('.cs-tile'))), "every row has its tile, its line and a switch that is on");
    return { check: name, rows: rows.length };
  }
  if (name === "app-state-press") {
    // 「✓ 已連結」 of the one view's row: under the pointer, the pointer says it can be pressed, and what a press lands on is the row.
    const modal = connectModal(), state = modal.querySelector('.cs-card .cs-state'), card = state?.closest('.cs-card');
    require(state && visible(state) && state.textContent.includes('已連結'), "a connected row of the one view says 已連結");
    require(getComputedStyle(state).cursor === 'pointer' && card.querySelector('[data-conn="open-store"]'), "the words have the pointer, and the row has the page to open");
    const box = state.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    require(hit && card.contains(hit) && !hit.closest('[data-conn="join"]'), "a press on the words lands in the row, not on another control");
    return { check: name };
  }
  if (name === "app-row-hover") {
    const modal = connectModal(), row = modal.querySelector('.cs-card .cs-main:hover');
    require(row && visible(row), "a row of the main view is under the pointer");
    const style = getComputedStyle(row), box = row.getBoundingClientRect(), tile = row.querySelector('.cs-tile').getBoundingClientRect(), text = row.querySelector('.tx').getBoundingClientRect();
    require(style.backgroundColor === colourOf('backgroundColor', '--float-hover') && style.cursor === 'pointer', `a row under the pointer has the pointer and the hover fill of the floating surface, as a connected row has (${style.backgroundColor}, ${style.cursor})`);
    require(tile.left - box.left >= 6 && box.right - text.right >= 6 && tile.top - box.top >= 6 && box.bottom - tile.bottom >= 6, `the fill stands 6 px or more clear of the words and the mark (${tile.left - box.left}, ${box.right - text.right})`);
    const join = row.parentElement.querySelector('.cs-connect, .cs-state');
    require(!join || join.getBoundingClientRect().left - box.right >= 8, "the fill stops 8 px or more before the 連結 button");
    return { check: name };
  }
  if (name === "connect-app-oauth" || name === "connect-app-key" || name === "connect-app-connected") {
    const modal = connectModal(), page = modal.querySelector('.cs-page'), back = page.querySelector('[data-conn="back"]'), close = modal.querySelector('.modal-x');
    require(visible(page) && !page.querySelector('.cs-top') && visible(back) && back.tagName === 'BUTTON', "an app's page has a bare back chevron and no title row");
    require(page.querySelector('.cs-vh')?.getBoundingClientRect().width <= 2, "the dialog's title is for a screen reader only");
    require(visible(close) && close.getBoundingClientRect().top < page.querySelector('.cs-head').getBoundingClientRect().top, "the dialog's bare ✕ stands at the top right");
    const head = page.querySelector('.cs-head'), tile = head.querySelector('.cs-tile.lg'), tileBox = tile.getBoundingClientRect(), nameNode = head.querySelector('h2.big');
    require(Math.round(tileBox.width) === 56 && Math.round(tileBox.height) === 56 && getComputedStyle(tile).backgroundColor === 'rgb(255, 255, 255)', "the mark is on a white rounded tile of 56 px");
    require(nameNode.getBoundingClientRect().left > tileBox.right && Math.abs((nameNode.getBoundingClientRect().top + nameNode.getBoundingClientRect().bottom) - (tileBox.top + tileBox.bottom)) <= 4, "the name is beside the tile");
    const join = head.querySelector('[data-conn="join"]'), state = head.querySelector('.cs-state');
    if (name === "connect-app-connected") {
      require(!join && visible(state) && state.textContent.includes('已連結'), "a connected app shows its connected state in the place of 連結");
      require(visible(head.querySelector('[data-k="cs-dlg-enable"]')) && visible(head.querySelector('[data-conn="server-menu"]')), "with its switch and its ⋯ in that same place");
      require([...page.querySelectorAll('h3')].some(node => node.textContent === '工具') && visible(page.querySelector('.cs-tools')), "its tools are in a bordered card under 工具");
    } else {
      require(join && join.className.includes('pri') && join.textContent.trim() === '連結' && getComputedStyle(join).backgroundColor === colourOf('backgroundColor', '--accent'), "a white round 連結 button (the primary)");
      require(parseFloat(getComputedStyle(join).borderTopLeftRadius) >= join.getBoundingClientRect().height / 2 && !page.textContent.includes('Share') && !page.textContent.includes('分享'), "it is fully round, and there is no Share");
      require(!page.querySelector('.cs-tools'), "tools are known only for a connected app, so there is no 工具 card");
    }
    const info = page.querySelector('.cs-info'), rows = [...(info?.querySelectorAll('.cs-info-row') ?? [])];
    require(visible(info) && rows.length >= 2 && [...page.querySelectorAll('h3')].some(node => node.textContent === '資訊'), "a bordered card of information under 資訊");
    require(rows.every(row => Math.round(row.getBoundingClientRect().height) === 38 && row.querySelector('.k').getBoundingClientRect().left < row.querySelector('.v').getBoundingClientRect().left), "its rows are 38 px, the label at the left and the value at the right");
    const border = getComputedStyle(info);
    require(parseFloat(border.borderTopWidth) === 1 && border.borderTopColor === colourOf('borderTopColor', '--float-edge') && parseFloat(border.borderTopLeftRadius) > 4, "the card has a 1 px edge on the dialog surface, rounded");
    const facts = Object.fromEntries(rows.map(row => [row.querySelector('.k').textContent, row.querySelector('.v').textContent]));
    if (name === "connect-app-oauth") require(facts['登入方式'] === 'OAuth' && facts['類別'] && facts['提供者'], `the facts we have: ${JSON.stringify(facts)}`);
    if (name === "connect-app-key") require(facts['登入方式'] === 'API 金鑰' && visible(page.querySelector('.cs-needs')), `the key page says how it signs in, once (${JSON.stringify(facts)})`);
    const body = modal.querySelector('.modal-body');
    require(body.scrollWidth <= body.clientWidth + 1, "the page never scrolls sideways");
    return { check: name, facts };
  }
  if (name === "connections-recommended") {
    const section = document.querySelector('.cs-apps .cs-sec');
    require(visible(section) && section.querySelector('h2').textContent === '為你推薦', "為你推薦 stands first under the chips");
    const cards = [...section.querySelectorAll('.cs-card')];
    require(cards.length > 0 && cards.length <= 6, `a few well-known apps (${cards.length})`);
    require(cards.every(card => visible(card.querySelector('.cs-tile')) && card.querySelector('[data-conn="join"]')?.tagName === 'BUTTON'), "each with its mark on its tile and a 連結 button in place");
    const names = cards.map(card => card.querySelector('.nm').textContent);
    require(!names.includes('Notion') && !names.includes('Gmail'), `nothing already there is recommended: ${names}`);
    return { check: name, cards: cards.length };
  }
  if (name === "member-face-hover") {
    const face = document.querySelector('.mb-panel-identity [data-det="avatar"]'), pencil = face.querySelector('.mb-face-pencil');
    require(face.matches(':hover') && getComputedStyle(pencil).opacity === '1' && visible(pencil.querySelector('svg.i')), "the pencil shows under the pointer");
    const a = face.getBoundingClientRect(), b = pencil.getBoundingClientRect(), icon = pencil.querySelector('svg.i').getBoundingClientRect();
    // The face itself dims along its own outline.
    const slime = face.querySelector(':scope > .av');
    require(/brightness\(0\.5\)/.test(getComputedStyle(slime).filter), "the whole face dims along its outline");
    require(b.width <= a.width / 2 + 1 && Math.abs((b.left + b.right) / 2 - (a.left + a.right) / 2) <= 1 && Math.abs((icon.left + icon.right) / 2 - (a.left + a.right) / 2) <= 1, "a small round chip with the pencil stands in the middle of the face, never a circle over all of it");
    require(icon.width === 20, "a 20px pencil");
    return { check: name };
  }
  if (name === "slime-picker") {
    const menu = document.querySelector(".mb-avpop");
    require(menu && menu.querySelector('[data-slime-character="shion"]').getAttribute("aria-pressed") === "true", "the menu stays open on the chosen slime");
    require(menu.querySelectorAll('[aria-pressed="true"]').length === 1, "nothing else looks chosen");
    require(window.__look.data.members.find(row => row.id === 1)?.avatar === "slime:shion", "the member keeps it");
    // The slimes alone: no tab that draws a picture (R-UI-116, owner 2026-11-09); its tabs are the kinds of slime (owner, 2026-11-11).
    require(!menu.querySelector('[data-avp-tab], [data-avp-pane], textarea, input'), "the picker is the slimes alone, with no 生成");
    require(menu.querySelector('[role="tab"][aria-selected="true"]')?.dataset.slimeTab === "characters", "it stands on the group of the chosen slime");
    const whole = menu.getBoundingClientRect();
    require(whole.top >= 0 && whole.bottom <= innerHeight && whole.left >= 0 && whole.right <= innerWidth, `the whole picker stands in the window (${Math.round(whole.bottom)} of ${innerHeight})`);
    require(menu.scrollHeight <= menu.clientHeight + 1, "the picker has no scroll of its own");
    // No ring stays on the chosen one, and the picker stands under the middle of the face.
    // A copy of the chosen slime away from the pointer shows its own look, not the hover the click left behind.
    const chosen = menu.querySelector('[data-slime-character="shion"]').cloneNode(true);
    chosen.style.position = "fixed"; chosen.style.left = "-400px"; chosen.style.top = "0"; menu.append(chosen);
    const style = getComputedStyle(chosen);
    const probe = document.createElement("i"); probe.style.background = "var(--accent-soft)"; menu.append(probe);
    const chosenFill = getComputedStyle(probe).backgroundColor; probe.remove();
    const look = { shadow: style.boxShadow, fill: style.backgroundColor }; chosen.remove();
    require(look.shadow === "none" && look.fill !== chosenFill, `no ring or chosen fill on the chosen slime: ${look.shadow} / ${look.fill}`);
    const face = document.querySelector('.mb-panel-identity [data-det="avatar"]').getBoundingClientRect(), box = menu.getBoundingClientRect();
    const centred = Math.abs((box.left + box.right) / 2 - (face.left + face.right) / 2) <= 2 || box.left <= 9 || box.right >= innerWidth - 9;
    require(box.top >= face.bottom - 1 && centred, `the picker is under the middle of the face: face ${Math.round(face.left)}-${Math.round(face.right)}, menu ${Math.round(box.left)}-${Math.round(box.right)}`);
    return { check: name };
  }
  if (name === "slime-picker-shape" || name === "slime-picker-box" || name === "slime-picker-tab") {
    // The picker is a row of tabs above the open group's slimes, one size for every group (owner, 2026-11-11: 「上面會有一些 tab、
    // button 之類的，然後可以選擇」; a control just pressed never moves).
    const menu = document.querySelector(".mb-avpop");
    require(menu, "the picker is open");
    const tabs = [...menu.querySelectorAll('[role="tab"]')], panels = menu.querySelector(".mb-slime-panels");
    const box = element => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n * 10) / 10); };
    if (name === "slime-picker-box") {
      window.__look.pickerBox = { menu: box(menu), panels: box(panels), tabs: tabs.map(box) };
      return { check: name };
    }
    // 角色 is the story's characters alone; the archetypes from the red oni onward have the tab after it (owner, 2026-11-11).
    require(tabs.map(tab => tab.dataset.slimeTab).join() === "characters,fantasy,animals,nature,everyday,colors" && menu.querySelector('[role="tablist"]'), `the groups are tabs of one tablist (${tabs.map(tab => tab.dataset.slimeTab).join()})`);
    require(menu.querySelectorAll('[data-slime-group="characters"] button').length === 24 && menu.querySelector('[data-slime-group="fantasy"] button')?.dataset.slimeCharacter === "oni-red", "角色 holds the story's 24 characters, and the red oni leads the next tab");
    require(tabs.filter(tab => tab.getAttribute("aria-selected") === "true").length === 1, "exactly one tab is chosen");
    require(tabs.every(tab => visible(tab)) && tabs.every(tab => Math.abs(tab.getBoundingClientRect().top - tabs[0].getBoundingClientRect().top) <= 1), "the tabs stand in one row");
    require(tabs.every(tab => tab.getBoundingClientRect().bottom <= panels.getBoundingClientRect().top + 1), "the tabs are above the slimes");
    const whole = menu.getBoundingClientRect();
    require(whole.top >= 0 && whole.bottom <= innerHeight && whole.left >= 0 && whole.right <= innerWidth, `the picker stands inside the window (${Math.round(whole.bottom)} of ${innerHeight})`);
    require(tabs.every(tab => tab.getBoundingClientRect().right <= whole.right + 1) || menu.querySelector("[data-chip-row][data-more-after], [data-chip-row][data-more-before]"), "the tabs fit the picker, or the chip row scrolls with its arrows");
    const open = [...menu.querySelectorAll("[data-slime-group]")].filter(panel => getComputedStyle(panel).visibility !== "hidden" && !panel.hasAttribute("inert"));
    require(open.length === 1 && open[0].dataset.slimeGroup === menu.querySelector('[role="tab"][aria-selected="true"]').dataset.slimeTab, "only the chosen tab's slimes show");
    // A closed group's panel being hidden is not enough: a rule that makes a slime's own parts visible (reduced motion had one)
    // shows them through the open group, one drawing on another. Every drawn part of every closed group is out of sight.
    const leaking = [...menu.querySelectorAll('[data-slime-group]:not([data-active]) :is(button, svg, svg *)')].filter(part => getComputedStyle(part).visibility !== "hidden");
    require(leaking.length === 0, `nothing of a closed group shows through the open one (${leaking.length} parts of ${[...new Set(leaking.map(part => part.closest('[data-slime-group]').dataset.slimeGroup))].join()} do)`);
    require(!menu.querySelector("h1, h2, h3, h4"), "no heading inside the grid: the tab says it");
    const shown = [...open[0].querySelectorAll("button")];
    require(shown.length > 0 && shown.every(visible), "the group's slimes are all there");
    // As wide as its row of tabs and no wider (owner, 2026-11-11: 「不要設計的這麼寬 上面 tab 右邊不要有空白」): the last tab
    // ends at the picker's edge, and so does the grid under it.
    const tabsPad = parseFloat(getComputedStyle(menu.querySelector('.mb-slime-tabs')).paddingRight), lastTab = tabs[tabs.length - 1].getBoundingClientRect();
    require(menu.querySelector("[data-chip-row][data-more-after]") || Math.abs((whole.right - lastTab.right) - (tabs[0].getBoundingClientRect().left - whole.left)) <= 1.5, `nothing is left blank at the right of the tabs: the row ends as far from the right edge as it starts from the left (${Math.round(whole.right - lastTab.right)} and ${Math.round(tabs[0].getBoundingClientRect().left - whole.left)} px)`);
    require(whole.width <= 521, `the picker is no wider than its tabs need (${Math.round(whole.width)} px)`);
    const cells = shown.map(button => button.getBoundingClientRect()), columns = new Set(cells.map(cell => Math.round(cell.left))).size;
    require(cells.every(cell => cell.left >= whole.left + 1 && cell.right <= whole.right - 1), "the slimes stay inside the picker");
    require(shown[0].matches('[data-slime-color]') ? columns === 6 : columns === Math.min(6, shown.length), `the slimes and the colours stand six across (${columns})`);
    require(whole.right - Math.max(...cells.map(cell => cell.right)) <= 28 || shown.length < 6, `the grid reaches the picker's right edge as the tabs do (${Math.round(whole.right - Math.max(...cells.map(cell => cell.right)))} px short)`);
    require(whole.width <= 320 || document.documentElement.lang !== "zh-TW", `six two-character tabs make a picker about as wide as Grok Bot's 298 (${Math.round(whole.width)} px)`);
    require(panels.scrollHeight <= panels.clientHeight + 1, `the largest group fits without scrolling (${panels.scrollHeight} of ${panels.clientHeight})`);
    if (name === "slime-picker-tab") {
      const before = window.__look.pickerBox;
      require(before, "the picker was measured before the press");
      const same = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) <= 0.6);
      require(same(box(menu), before.menu), `the picker did not move or change size: ${box(menu)} / ${before.menu}`);
      require(same(box(panels), before.panels), "the place of the slimes did not change");
      require(tabs.every((tab, i) => same(box(tab), before.tabs[i])), "no tab moved");
      require(menu.querySelector('[role="tab"][aria-selected="true"]').dataset.slimeTab === "animals", "the pressed tab is the chosen one");
      require(shown.every(button => button.getAttribute("aria-pressed") === "false"), "the face that is now is not in this group, so none is marked");
    }
    return { check: name, tabs: tabs.length, slimes: shown.length };
  }
  if (name === "conversation-picker") {
    const list = document.querySelector("#app-popover .conversation-menu-list");
    require(visible(list), "conversation list is visible");
    require(list.scrollWidth <= list.clientWidth + 1, `list overflows: ${list.scrollWidth} > ${list.clientWidth}`);
    const button = list.querySelector("[data-conversation-new]"), box = button.getBoundingClientRect(), parent = list.getBoundingClientRect();
    require(box.left >= parent.left && box.right <= parent.right + 1, "new conversation button fits inside the list");
    return { check: name, width: list.clientWidth, scrollWidth: list.scrollWidth };
  }
  if (name === "connectors-only") {
    // Connect apps lists connectors only. Skills belong to each member and are managed in that member's panel.
    const body = document.querySelector('.cs-body');
    require(visible(body) && body.querySelector('.cs-linked'), "the connectors are listed");
    require(!document.querySelector('[data-skills-section], [data-conn="skill-discover"], [data-conn^="skill-"], [data-conn^="set-"], [data-conn^="marketplace-"], .cs-skill, [data-library-skill], [data-skill-set]'), "no skills section, import button, skill row or plugin set");
    const text = document.querySelector('.modal-scrim .modal-body').textContent;
    require(!/技能|Skills|スキル/.test(text), `no word of skills in the dialog: ${text.slice(0, 80)}`);
    return { check: name, rows: body.querySelectorAll('.cs-linked').length };
  }
  if (name === "apps-count") {
    // The one number is the core's, on the chip at the top right of the view (the list of the connected is behind it): the roster's and the rows' agree.
    const rows = document.querySelectorAll('.modal-scrim .cs-body > .cs-sec:first-child .cs-linked, .modal-scrim .cs-body > .cs-grid > .cs-linked').length;
    const chip = document.querySelector('.modal-scrim [data-conn="connected"] .cs-have-t');
    return window.__TAURI_INTERNALS__.invoke("core_call", {method:"members.list",params:{}}).then(({team_context:roster})=>{
      require(!document.querySelector('.nav-apps'), "Settings alone contains the connected app count");
      // On the list of the connected the chip is replaced by a back chevron: the number is on the view, so this reads the roster against the rows alone.
      if (chip) require(chip.textContent.trim() === `${roster.connected} 個已連結`, `the chip says the roster's count (${chip.textContent})`);
      require(rows === roster.connected, `the connected rows are the roster's count (${rows} of ${roster.connected})`);
      return {check:name,count:roster.connected,apps:roster.apps.length};
    });
  }
  if (name === "apps-unreadable") {
    const chip = document.querySelector('.modal-scrim [data-conn="connected"] .cs-have-t');
    require(!chip || chip.textContent.trim() === "已連結", "Settings states an unknown count without inventing a number");
    require(!/\d/.test(document.querySelector('.modal-scrim .cs-top')?.textContent ?? ""), "no number is on the top row");
    return window.__TAURI_INTERNALS__.invoke("core_call",{method:"members.list",params:{}}).then(({team_context:roster})=>{
      require(roster.connected === null && roster.inventory_state !== "complete", "the roster states no number either");
      return {check:name,state:roster.inventory_state};
    });
  }
  if (name === "connections-dialog-actions") {
    const dialog = document.querySelector('.cs-page');
    const buttons = [...(dialog?.querySelectorAll('.action-row button') ?? [])];
    require(visible(dialog) && buttons.length > 0, "the page has its action row");
    for (const button of buttons) {
      // The page scrolls inside the dialog: an action below the fold is brought into view before it is pressed.
      button.scrollIntoView?.({ block: 'center' });
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
    require(document.querySelector('.cs-page .note[role="alert"]')?.textContent.includes('Composio 尚未允許這個應用程式登入，請重試連結。'), "a toolkit refusal has dedicated actionable copy on the app's page");
    require(![...document.querySelectorAll('.toast')].some(node => node.textContent.includes('Composio 尚未允許')), "the sign-in refusal never covers the page as a toast");
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
    const dialog = document.querySelector(".modal-scrim .cs-page");
    require(visible(dialog) && dialog.querySelectorAll('[data-conn="enable"]').length === 1, "the app's page has its one switch");
    require(dialog.querySelector('[data-conn="enable"]').getAttribute("aria-checked") === "true", "the app stays enabled independently of tools");
    const kinds = [...dialog.querySelectorAll('[data-conn="kind"]')];
    require(kinds.length === 2 && kinds[0].dataset.kind === 'write' && kinds[1].dataset.kind === 'read', "both kinds are reachable above the folded list");
    require(kinds[0].getAttribute('aria-checked') === 'false' && kinds[1].getAttribute('aria-checked') === 'true', "kind switches reflect their own tools only");
    require(!dialog.querySelector('[data-conn="tool"]'), "individual switches remain folded");
    require(dialog.querySelector('[data-k="cs-count"]')?.textContent.includes("30/46"), "one line says how many tools are on");
    const calls = window.__look.calls.filter(call => call.method === 'integrations.set_tools_enabled' && call.params.id === 'github');
    require(calls.length === 3 && calls[0].params.tools.length === 16 && calls[0].params.enabled && calls[1].params.tools.length === 30 && calls[1].params.enabled && !calls[2].params.enabled, "each kind changes in a single bulk RPC");
    require(!window.__look.calls.some(call => call.method === 'integrations.set_tool_enabled' || call.method === 'integrations.set_enabled'), "kind switches never rewrite the app or loop through per-tool RPCs");
    return { check: name };
  }
  if (name === "connector-tools") {
    // An app's page: the account it is signed in with, N of its M tools on with a switch for each, and its actions flush with the dialog's edge.
    const dialog = document.querySelector(".modal-scrim .cs-page"), switches = [...(dialog?.querySelectorAll('[data-conn="tool"]') ?? [])];
    require(visible(dialog) && switches.length > 0, "the app's page and the switches of its tools are visible");
    require(dialog.querySelectorAll(".cs-acct").length > 0, "the account it is signed in with is listed");
    const on = switches.filter(node => node.getAttribute("aria-checked") === "true").length, count = dialog.querySelector('[data-k="cs-count"]')?.textContent ?? "";
    require(count.includes(`${on}/${switches.length}`), `the page says "${count}" while ${on} of ${switches.length} tools are on`);
    const calls = window.__look.calls.filter(call => call.method === 'connectors.set_tools' && call.params.id === 'composio:notion');
    require(calls.length === 4 && calls.every(call => !('enabled' in call.params)), "managed kind switches only update disabled_tools");
    require(calls[0].params.disabled_tools.length === 3 && calls[1].params.disabled_tools.length === 0 && calls[2].params.disabled_tools.length === 6 && calls[3].params.disabled_tools.length === 0, "write and read permissions change independently and return on");
    return { check: name, on, tools: switches.length };
  }
  if (name === "settings-shell") {
    const modal = document.querySelector(".modal"), close = modal?.querySelector(".modal-x");
    require(visible(modal) && visible(close), "settings and its close control are visible");
    require(getComputedStyle(modal).borderTopLeftRadius === "12px", "settings uses the dialog radius rather than a pill");
    const box = close.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    require(close === hit || close.contains(hit), "rounded corners do not clip the close control");
    // The settings: flat tabs, no group names, no search and no line under a tab's name; seven
    // since 記憶 left 一般 for a tab of its own.
    const scrim = modal.closest('.modal-scrim');
    if (!scrim.hasAttribute('data-standalone')) {
      // Six since the memory tab went (owner, 2026-11-11: memory is not shown anywhere).
      require(scrim.querySelectorAll('.modal-nav [data-pane]').length === 6 && !scrim.querySelector('.nav-group, #set-search, [data-pane="memory"]'), "six tabs sit flat, with no group names and no search");
      require(!scrim.querySelector('.set-purpose'), "a tab is its name alone, with no line under it");
    }
    return { check: name, radius: getComputedStyle(modal).borderTopLeftRadius };
  }
  if (name === "sidebar-hidden-folder-closed" || name === "sidebar-hidden-folder") if (matchMedia('(max-width: 859px)').matches) return {check:name,compact:true};
  if (name === "sidebar-hidden-folder-closed") {
    // R-UI-112: the folder starts closed, so hidden members stay hidden until its header is pressed.
    const folder = document.querySelector('.side .mb-hidden');
    require(visible(folder) && folder.dataset.open === 'false', 'the hidden folder starts closed');
    require(folder.querySelector('.mb-gbody').hasAttribute('inert') && folder.querySelector('[data-group-fold]').getAttribute('aria-expanded') === 'false', 'a closed folder is out of the keyboard\'s way');
    const body = folder.querySelector('.mb-gbody').getBoundingClientRect(), head = folder.querySelector('.mb-ghead').getBoundingClientRect();
    require(body.height < 1 && folder.getBoundingClientRect().height <= head.height + parseFloat(getComputedStyle(folder.querySelector('.mb-ghead')).marginBottom) + 1, `no hidden member or group chat shows while it is closed: ${body.height}`);
    return { check: name };
  }
  if (name === "sidebar-hidden-folder") {
    // R-UI-112: the members and group chats taken off the list wait in one folder at its end.
    const folder = document.querySelector('.side .mb-hidden'), sections = [...document.querySelectorAll('.side .mb-list > .mb-sec')];
    require(visible(folder) && sections[sections.length - 1] === folder, 'the hidden folder is the last folder of the list');
    require(folder.querySelector('.mb-gname')?.textContent === '隱藏的成員', 'the folder is named like any other');
    require(visible(folder.querySelector('[data-member="2"]')) && !document.querySelector('.side .mb-sec:not(.mb-hidden) [data-member="2"]'), 'the hidden member waits only there');
    require(visible(folder.querySelector('[data-hidden-rooms] [data-room="1"]')) && !document.querySelector('.au-rooms-section [data-room="1"]'), 'the hidden group chat waits there too, not with the others');
    require(document.querySelector('#app-popover [data-pick="hide"]')?.textContent.includes('取消隱藏'), 'a right click offers to bring the member back');
    require(!document.querySelector('[data-hidden-members]'), 'Settings keeps no list of its own');
    return { check: name };
  }
  if (name === "header-pill") {
    const trigger = document.querySelector('.mb-chat .conversation-trigger'), pill = trigger.querySelector('.mb-pill'), go = pill.querySelector('.mb-pill-go');
    const style = getComputedStyle(pill), box = pill.getBoundingClientRect();
    require(Math.abs(box.height - 40) <= 1 && parseFloat(style.borderTopLeftRadius) >= 20, 'the face and name sit in one 40 px pill');
    const surface = getComputedStyle(pill, '::before');
    require(surface.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(surface.right) === 0 && getComputedStyle(trigger).backgroundColor === 'rgba(0, 0, 0, 0)', "the pill's surface lights and reaches the › under the pointer, not the button around it");
    require(Math.abs(go.getBoundingClientRect().width - 16) <= 1 && getComputedStyle(go).opacity === '1', 'a › shows in the pill under the pointer');
    return { check: name, pill: Math.round(box.width) };
  }
  if (name === "message-hugs-bubble") {
    // R-UI-104: a message is its bubble and the actions beside it; the room to their side is the thread's.
    const message = document.querySelector('.tn[data-id="8201"] .chat-message[data-reply]'), bubble = message.querySelector(':scope > .ans'), actions = message.querySelector(':scope > .message-actions');
    const box = message.getBoundingClientRect(), b = bubble.getBoundingClientRect(), a = actions.getBoundingClientRect();
    require(b.height > 120, 'the fixture reply runs over several lines');
    require(a.left - b.right >= 0 && a.left - b.right <= 8, `the actions stand against the bubble (${Math.round(a.left - b.right)} px away)`);
    require(box.right <= a.right + 1, `the message ends with its actions (${Math.round(box.right)} vs ${Math.round(a.right)})`);
    const room = document.elementFromPoint(Math.min(innerWidth - 24, a.right + 120), b.top + b.height / 2);
    require(!room || !message.contains(room), 'the room beside the message is not part of it');
    return { check: name, message: Math.round(box.width), bubble: Math.round(b.width) };
  }
  if (name === "dictation-heat-press") {
    // A day says its words when pressed, never under the pointer.
    const day = document.querySelector('.heat [data-date="2026-10-24"]'), tip = document.querySelector('.heat-tip');
    require(!document.querySelector('.heat title'), "no day shows a title under the pointer");
    require(visible(tip) && /10 月 24 日.*字/.test(tip.textContent) && day.classList.contains('is-picked'), "the pressed day shows its words above it and is outlined");
    const tipBox = tip.getBoundingClientRect(), dayBox = day.getBoundingClientRect();
    require(tipBox.bottom <= dayBox.top + 1 || tipBox.top >= dayBox.bottom - 1, "the words stand beside the day, never over it");
    require(!document.querySelector('.heat [role="button"], .heat [tabindex]'), 'no day is a button');
    require(visible(document.querySelector('.page-overview .heat')) && !visible(document.querySelector('.day-row')) && document.querySelector('.page-overview:not([hidden])'), 'pressing a day leaves the grid as it was: no history opened');
    return { check: name };
  }
  if (name === "dictation-navigation") {
    const nav = document.querySelector('.dictation-nav [role="tablist"]'), tabs = [...nav.querySelectorAll('[role="tab"]')];
    const active = tabs.filter(tab => tab.getAttribute("aria-selected") === "true");
    // The app's one tab component, as the panel's and 模型與用量's.
    require(nav.matches(".tabs.plain") && tabs.every(tab => tab.matches(".tab")), "the tabs are the shared tabs() pills");
    require((nav.getAttribute("aria-orientation") ?? "horizontal") === "horizontal" && active.length === 1, "one selected horizontal tab");
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
    const desktop = document.querySelector('.dictation-content').clientWidth >= 700;
    require(boxes[0].top === boxes[1].top && boxes[2].top > boxes[0].bottom && boxes[2].top === boxes[3].top, "totals keep two by two rows at every width");
    for (const card of cards) require(getComputedStyle(card).borderTopWidth === '1px' && getComputedStyle(card).backgroundColor !== 'rgba(0, 0, 0, 0)', "each total has its own card surface");
    const activity = document.querySelector('.page-overview .activity').getBoundingClientRect();
    const shortcuts = document.querySelector('.page-overview .keys-card').getBoundingClientRect();
    require(activity.top >= boxes[3].bottom, "activity follows the totals");
    require(desktop ? shortcuts.left >= boxes[1].right && activity.top >= shortcuts.bottom && Math.abs(activity.right - shortcuts.right) < 1 : shortcuts.top >= activity.bottom && Math.abs(shortcuts.width - activity.width) < 1, "side by side the heatmap runs under totals and shortcuts; compact windows order totals, full-width activity, then full-width shortcuts");
    require(document.querySelector('.heat rect.h1, .heat rect.h2, .heat rect.h3, .heat rect.h4').getBoundingClientRect().width >= 17, "activity days retain larger readable cells");
    return { check: name, desktop, cardWidth: boxes[0].width };
  }
  if (name === "conversation-design") {
    const bubble = document.querySelector(".bubble"), answer = document.querySelector('[data-reply] > .ans');
    for (const element of [bubble, answer]) {
      require(visible(element), "owner and assistant messages are visible");
      const style = getComputedStyle(element);
      require(style.fontSize === "15px" && style.lineHeight === "22px", "messages use 15px type on a 22px line");
      // A one-line bubble is a pill, as Grok Bot's (dev/u-bubble, 2026-11-10): half its line plus its padding.
      const pill = parseFloat(style.lineHeight) / 2 + parseFloat(style.paddingTop);
      require(Math.abs(parseFloat(style.borderTopLeftRadius) - pill) <= 1, `messages are pills: radius ${style.borderTopLeftRadius}, half a line plus padding ${pill}px`);
    }
    require(getComputedStyle(answer).borderTopWidth === "0px", "assistant bubble has no decorative border");
    plainWords();
    const column = document.querySelector(".mb-col");
    if (visible(column)) {
      const rows = [...column.querySelectorAll(".mb-row[data-member]")], first = rows[0];
      require(first.dataset.member === "0", "Raphael is first");
      if (!column.classList.contains("is-collapsed")) {
        // 40 px faces in the list, 36 px on the rail of faces.
        const face = document.documentElement.hasAttribute("data-sidebar-collapsed") ? 36 : 40;
        require(Math.abs(first.querySelector(".av").getBoundingClientRect().width - face) < 1, "the chief shares the conversation avatar size");
        for (const row of rows.slice(1)) require(Math.abs(row.querySelector(".av").getBoundingClientRect().width - face) < 1, `other members share ${face}px faces`);
      }
    }
    return { check: name, sidebarVisible: visible(column), fontSize: getComputedStyle(bubble).fontSize };
  }
  if (name === "member-column") return checkRendered("sidebar-shell");
  // Primary is a display position; the room's coordinator remains identity 0.
  if (name === "member-menu") {
    // The grouped row menu: groups split by hairlines, the destructive item last and red.
    const menu = document.querySelector('#app-popover');
    require(visible(menu), "the member's menu is open");
    const shape = [...menu.children].map(node => node.matches('[role="separator"]') ? "|" : node.dataset.pick).join(" ");
    require(shape === "pin move unread | edit | export-template | hide delete", `the menu is grouped: ${shape}`);
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
  if (name === "sidebar-tile-menu") {
    // A pinned tile's menu reads as Grok Bot's pinned bot (owner, 2026-11-11): unpin and unread, then the rest, then 換成其他成員 last after a line.
    const menu = document.querySelector('#app-popover');
    require(visible(menu), "the tile's menu is open");
    require(document.querySelector('.mb-pinned [data-member-item="3"]'), "the member whose tile it is stands among the tiles");
    const shape = [...menu.children].map(node => node.matches('[role="separator"]') ? "|" : node.dataset.pick).join(" ");
    require(shape === "pin unread | edit | export-template | hide delete | replace-pinned", `the tile's menu is grouped as Grok's pinned bot: ${shape}`);
    const items = [...menu.querySelectorAll('[data-pick]')];
    require(items.every(item => visible(item.querySelector('.ck svg.i')) && item.querySelector('.mt').textContent.trim() !== ""), "every row has its own icon and a label");
    require(items.at(-1).dataset.pick === "replace-pinned" && items.at(-1).previousElementSibling.matches('[role="separator"]'), "換成其他成員 is last, after a hairline");
    require(items.at(-2).classList.contains("danger") && !items.at(-1).classList.contains("danger"), "刪除 stays red and 換成其他成員 is not");
    for (const line of menu.querySelectorAll('[role="separator"]')) {
      const box = line.getBoundingClientRect();
      require(box.height >= 1 && box.height <= 9 && box.width > menu.getBoundingClientRect().width * 0.7, "each hairline spans the menu");
    }
    require(!menu.querySelector('[data-pick="move"]') && !/ID/i.test(menu.textContent), "no 移到分組 and no id on a tile's menu");
    const box = menu.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu is inside the viewport");
    require(window.__look.calls.every(call => call.method !== "members.update"), "opening the menu writes nothing");
    return { check: name, shape };
  }
  if (name === "sidebar-tile-picker" || name === "sidebar-tile-replaced") {
    const data = window.__look.data, writes = window.__look.calls.filter(call => call.method === "members.update");
    const tiles = () => [...document.querySelectorAll('.mb-pinned [data-member-item]')].map(item => Number(item.dataset.memberItem));
    if (name === "sidebar-tile-picker") {
      const dialog = document.querySelector('.mb-dialog.mb-primary-picker');
      require(visible(dialog), "the member picker is open");
      const title = dialog.querySelector('h2').textContent.trim();
      require(title !== "" && dialog.querySelector('[role="group"]').getAttribute('aria-label') === title, "it is titled by the action and its list is named by the title");
      const choices = [...dialog.querySelectorAll('.mb-chat-choice')];
      const ids = choices.map(button => Number(button.dataset.id));
      require(choices.length >= 3 && choices.every(button => button.tagName === 'BUTTON' && visible(button)), "the members are real buttons");
      require(ids.every(id => id !== 0 && !data.members.find(member => member.id === id).pinned), "only members that are not pinned are offered, and not Raphael");
      require(!dialog.querySelector('.mb-dlg-act, [role="radio"], .mb-chat-choice svg.i'), "no 設為主要, no radio and no check: one press answers");
      require(visible(dialog.querySelector('[data-primary-search]')), "the search is there");
      const box = dialog.getBoundingClientRect();
      require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the window is inside the viewport");
      for (const button of choices) {
        const b = button.getBoundingClientRect();
        require(b.left >= box.left && b.right <= box.right && b.height >= 40, `${button.textContent.trim()} is a whole row inside the window`);
      }
      require(writes.length === 0 && tiles().join() === "0,3,1", "nothing is written before a member is pressed");
      return { check: name, choices: choices.length };
    }
    require(!document.querySelector('.mb-primary-picker, .mb-dialog'), "the picker closed on the press, with no question");
    require(writes.length === 2 && writes[0].params.id === 4 && writes[0].params.pinned === true && writes[1].params.id === 3 && writes[1].params.pinned === false, "the member chosen is pinned, then the old one is unpinned");
    require(!("group_id" in writes[1].params) && !("position" in writes[1].params), "the old member's folder and place are not touched");
    require(tiles().join() === "0,4,1", `the member chosen stands exactly in the old tile's place: ${tiles()}`);
    require(document.querySelector('.mb-sec [data-member="3"]') && !document.querySelector('.mb-pinned [data-member="3"]'), "the old member is back in its folder as a row");
    require(document.querySelector('.mb-pinned [data-member="4"].mb-tile') && !document.querySelector('.mb-sec [data-member="4"]'), "the new member is a tile and no longer a row");
    return { check: name, tiles: tiles() };
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
        // The default responder's choice shows its full label in its row.
        const words = document.querySelector('[data-responder] .sel > span');
        if (words) require(words.scrollWidth <= words.clientWidth + 1, `the default responder shows its whole choice: ${words.textContent}`);
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
      require(visible(document.querySelector('.ms-pane .ms-face')) && !document.querySelector('.ms-pane .mb-star'), "the selected member's page remains available without a star");
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
    // The top row, the search and the chips stand still while only the list scrolls under them (as Grok Bot's search row does).
    const pane = document.querySelector('.modal-body'), frame = document.querySelector('.modal').getBoundingClientRect();
    const controls = [document.querySelector('.cs-top h1'), document.querySelector('#conn-search'), ...[...document.querySelectorAll('.cs-chips > :not([hidden])')]];
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      require(box.top >= frame.top && box.bottom <= frame.bottom && control.contains(hit), "the title, the search and the chips stay visible while the list scrolls");
    }
    const results = document.querySelector('.cs-results');
    require(results && results.scrollTop > 0 && pane.scrollTop === 0, "only the list scrolls");
    return { check: name, scrollTop: results.scrollTop, controls: controls.length };
  }
  if (name === "connections-form-edges" || name === "connections-form-end") {
    const grid = document.querySelector('.cs-form .add-grid'), port = grid.getBoundingClientRect();
    const last = document.querySelector('#conn-limit'), edge = last.getBoundingClientRect().right;
    if (name === "connections-form-edges") {
      // The form is the whole tab (no bar, so no 新增 above it since 2026-11-07): its only actions are the footer's, and the last one ends where the fields end.
      const actions = [...document.querySelectorAll('.add-acts button')];
      require(actions.length === 3 && !document.querySelector('[data-k="conn-add"]'), `the form has its three footer actions and no add menu above it: ${actions.length}`);
      const rights = actions.map(button => button.getBoundingClientRect().right);
      require(Math.abs(Math.max(...rights) - edge) <= 1, `footer actions end at the form field right edge: fields ${edge}, actions ${rights.join(', ')}`);
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
    require(visible(document.querySelector('#conn-search')) && document.querySelectorAll('.cs-chips [data-conn="store-group"]').length === 10, "search and the categories stay reachable");
    return { check: name };
  }
  if (["plugins-store-groups", "plugins-store-search", "plugins-store-category"].includes(name)) {
    const groups = document.querySelector('.cs-chips'), style = getComputedStyle(groups);
    const shown = [...groups.children].filter(chip => !chip.hidden);
    require(style.flexWrap === 'nowrap' && style.overflowX === 'hidden', "category chips stand on one row that never wraps and never scrolls sideways");
    require(groups.scrollWidth <= groups.clientWidth + 1, `the chips fit their row (${groups.scrollWidth} in ${groups.clientWidth})`);
    require(shown.every(chip => Math.abs(chip.getBoundingClientRect().top - shown[0].getBoundingClientRect().top) <= 1), "every category chip shares one row");
    const more = groups.querySelector('[data-k="conn-more"]');
    require(visible(more) && more.getAttribute('aria-haspopup') === 'menu', "更多 holds the categories that are not in the row");
    const rows = [...document.querySelectorAll('.cs-card')];
    const ids = rows.map(row => row.querySelector('[data-conn="open-store"]').dataset.id);
    require(new Set(ids).size === rows.length || document.querySelector('.cs-sec'), "each app appears once in a list");
    require(rows.length <= 130, "sections and lists keep the DOM bounded");
    require(!document.querySelector('[data-k="conn-category"]'), "provider categories do not become a dropdown");
    require(document.querySelectorAll('.cs-chips [data-conn="store-group"]').length === 10, "nine categories and 全部 are available");
    require(window.__look.calls.filter(c => c.method === 'connectors.catalog').every(c => !c.params?.search && !c.params?.category && !c.params?.cursor), "query and category changes search the complete local index");
    if (name === "plugins-store-search") require(rows.length === 1 && rows[0].textContent.includes('360'), "search reaches the last app across categories");
    if (name === "plugins-store-category") require(document.querySelector('[data-conn="store-group"][data-id="productivity"]').getAttribute('aria-pressed') === 'true' && !document.querySelector('.cs-sec'), "the chosen category stays pressed and lists its apps without sections");
    return { check: name, rows: rows.length, ids };
  }
  if (name === "store-group-focus") {
    const groups = document.querySelector('.cs-chips'), chip = document.activeElement;
    require(groups?.contains(chip) && chip.matches('[data-conn="store-group"]'), "keyboard focus reaches a category chip");
    const frame = groups.getBoundingClientRect(), box = chip.getBoundingClientRect();
    require(box.left >= frame.left - 1 && box.right <= frame.right + 1 && chip.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)), "the focused category is fully visible and clickable");
    return { check: name, category: chip.dataset.id };
  }
  if (name === "store-group-end") {
    const groups = document.querySelector('.cs-chips'), frame = groups.getBoundingClientRect();
    const chosen = groups.querySelector('[aria-pressed="true"]'), box = chosen.getBoundingClientRect();
    require(chosen.dataset.id && document.activeElement === chosen, "keyboard selection retains the chosen category and its focus after the list is drawn again");
    require(box.left >= frame.left - 1 && box.right <= frame.right + 1 && chosen.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)), "the chosen category is fully visible and reachable");
    return { check: name, chosen: chosen.dataset.id };
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
    require(rows.length > 0, "the view has app rows");
    const add = [...document.querySelectorAll('.cs-card [data-conn="join"]')];
    require(add.length > 0 && add.every(button => button.className === add[0].className && button.className === 'btn cs-connect'), "every 連結 button has the same class list");
    for (const row of rows) {
      const [main, action] = row.children;
      require(row.className === 'cs-card' && row.children.length === 2, "every app row has the same two slots");
      require(main.tagName === 'BUTTON' && main.className === 'btn cs-main' && main.dataset.conn === 'open-store', "every source uses the same page button");
      require(main.children.length === 2 && main.children[0].className === 'cs-tile' && main.children[1].className === 'tx', "every row has the same tile and text structure");
      const [title, summary] = main.children[1].children;
      // A row is the tile and the name; the line under it only says that a sign-in waits.
      require(title.tagName === 'SPAN' && title.className === 'nm' && (!summary || summary.classList.contains('wait')), "a row's line is only its waiting sign-in");
      require(action.matches('button.btn.cs-connect[data-conn="join"], button.btn.cs-connect[data-conn="cancel-login"], span.cs-state'), "every state stays in the one action slot");
      const style = window.getComputedStyle(row);
      require(style.display === 'flex' && !row.querySelector('.need'), "every row is one line with nothing it would have to explain");
      const frame = row.getBoundingClientRect();
      require([main, action, title].filter(visible).every(node => {
        const box = node.getBoundingClientRect();
        return box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
      }), "names and actions fit inside their row");
    }
    return { check: name, rows: rows.length };
  }
  if (name === "typo-mention") {
    const first = document.querySelector('#app-popover[data-team-mentions] [data-value]');
    require(visible(first) && first.dataset.value === "Notion", `「@notoin」 finds Notion first (${first?.dataset.value})`);
    return { check: name };
  }
  // One row at the top of a conversation (owner, 2026-11-12, after Grok Bot, measured: the pill's centre 30 px from the window's top, the round
  // buttons level with it and ending 14 px short of the window's buttons, the thread passing under the row): the header is the window's top
  // row, nothing but it stands above the thread, the tools never meet the window's three buttons, and the empty parts of the row still move
  // the window while the pill and the buttons still press. The numbers are returned so that a run shows them.
  if (name === "conversation-top-row") {
    const pane = [...document.querySelectorAll(".page-agent > .mb-chat")].find(visible), head = pane?.querySelector(":scope > .mb-head");
    require(pane && visible(head), "a conversation with its header is on screen");
    const stage = pane.querySelector(":scope > .ra-stage"), scroller = stage.querySelector(":scope > .ra-scroll"), find = pane.querySelector(":scope > .ra-find");
    const controls = document.querySelector(".window-chrome .window-controls").getBoundingClientRect(), box = element => element.getBoundingClientRect();
    const page = box(pane), row = box(head), mid = element => box(element).top + box(element).height / 2;
    const who = head.querySelector(".conversation-trigger .mb-pill, .au-room-heading b, .au-room-heading");
    require(visible(who), "the header names whose conversation it is");
    const pillY = Math.round(mid(who));
    require(Math.abs(pillY - 30) <= 2, `the pill's centre is 30 px from the window's top, as Grok Bot's: ${pillY}`);
    require(row.top <= 1 && row.height <= 62, `the header is the window's top row: it starts at ${Math.round(row.top)} and is ${Math.round(row.height)} px high`);
    // A button that keeps its place without showing (a room's search while a page stands in the thread's place) is not pressed.
    const buttons = [...head.querySelectorAll(".btn.icon")].filter(button => visible(button) && getComputedStyle(button).visibility !== "hidden");
    for (const button of buttons) require(Math.abs(mid(button) - pillY) <= 2, `a round button is level with the pill: ${Math.round(mid(button))} and ${pillY} (${button.getAttribute("aria-label")})`);
    const findOpen = !!find && visible(find);
    require(box(stage).top <= 1 || findOpen, `nothing but the row stands above the thread: the stage starts at ${Math.round(box(stage).top)}`);
    require(!findOpen || box(find).top >= row.bottom - 1, "the search bar stands under the row, not over it");
    const lead = parseFloat(getComputedStyle(scroller).paddingTop), visibleThread = getComputedStyle(scroller).visibility !== "hidden";
    require(!visibleThread || findOpen || lead >= row.bottom - box(scroller).top - 1, `the first message stands clear of the row: ${Math.round(lead)} px of padding under a row ending at ${Math.round(row.bottom)}`);
    require(!visibleThread || /linear-gradient/.test(getComputedStyle(scroller).maskImage), "what scrolls up fades out under the row");
    const first = [...scroller.querySelectorAll(".thread > li")].find(visible);
    // No tool meets the window's buttons: it ends 14 px short of them where the pane reaches the window's edge, and at its pane's edge where another pane stands to its right.
    const tools = buttons.filter(button => button.closest(".ra-tools")), edge = tools.length ? Math.max(...tools.map(button => box(button).right)) : null;
    const reaches = page.right >= innerWidth - 1 && !pane.classList.contains("has-side-thread") && !(pane.closest(".page-agent")?.dataset.det === "open" && !pane.classList.contains("au-room-pane") && innerWidth >= 1120);
    if (edge !== null && reaches) require(Math.abs(controls.left - edge - 14) <= 2, `the tools end 14 px short of the window's buttons, as Grok Bot's: ${Math.round(controls.left - edge)} (${Math.round(edge)} and ${Math.round(controls.left)})`);
    for (const button of tools) { const b = box(button); require(b.right <= page.right + 1, "a tool stays inside its pane"); }
    // What the pointer reaches: the pill and every button press; the empty stretch of the row moves the window. Under 1120 px an open
    // details panel lies over the chat with a dim over its header: nothing of the row presses, and the scrim's top row moves the window. A
    // group's side thread lies over the pane's right under 1100 px, with its own row (its header moves the window too).
    const at = (x, y) => document.elementFromPoint(x, y);
    const dimmed = (pane.closest(".page-agent")?.dataset.det === "open" && !pane.classList.contains("au-room-pane") && innerWidth < 1120)
      || (pane.classList.contains("has-side-thread") && innerWidth < 1100);
    require(head.hasAttribute("data-window-drag"), "the header's empty stretch moves the window");
    if (dimmed && !pane.classList.contains("au-room-pane")) {
      const rowBox = box(pane.closest(".page-agent").querySelector(".mb-det-scrim-row")), grab = at(Math.round(page.left + 40), 14);
      require(grab?.matches(".mb-det-scrim-row[data-window-drag]") && rowBox.height >= 59 && rowBox.top <= 1, `the dimmed row is draggable through the scrim's top row: ${grab?.className}`);
    }
    if (dimmed) return { check: name, pillY, rowTop: Math.round(row.top), rowHeight: Math.round(row.height), stageTop: Math.round(box(stage).top), threadHeight: Math.round(scroller.clientHeight), dimmed };
    for (const target of [who.closest("button") ?? who, ...buttons]) {
      const b = box(target), hit = at(b.left + b.width / 2, b.top + 6);
      const why = () => { const root = document.documentElement; return `${hit?.className}; the strip's drag cell takes pointer events: ${getComputedStyle(document.querySelector(".window-drag")).pointerEvents}; layout ${root.dataset.windowLayout}, modal ${root.dataset.windowModal}, sidebar open ${root.hasAttribute("data-sidebar-open")}, header ${!!document.querySelector(".main > .page-agent:not([hidden]) > .mb-chat:not([hidden]) > .mb-head")}, settings page ${!!document.querySelector(".page-agent > .ms-pane:not([hidden])")}, dialog ${!!document.querySelector(".mb-scrim:not(.store-scrim)")}`; };
      require(hit && target.contains(hit) && !hit.closest(".window-chrome"), `the pointer reaches ${target.getAttribute("aria-label") ?? target.className} at the top of the row (${why()})`);
    }
    const gapX = (() => { const a = box(who.closest("button") ?? who); return (a.right + (buttons.filter(b => box(b).left > a.right)[0]?.getBoundingClientRect().left ?? a.right + 40)) / 2; })();
    const empty = at(gapX, 14);
    require(empty?.closest(".mb-head") === head && !empty.closest("button"), `an empty part of the row is the header's own, under no strip of the window: ${empty?.className}`);
    return { check: name, pillY, rowTop: Math.round(row.top), rowHeight: Math.round(row.height), stageTop: Math.round(box(stage).top), threadHeight: Math.round(scroller.clientHeight), firstMessageTop: first ? Math.round(box(first).top) : null, toolsGap: edge === null ? null : Math.round(controls.left - edge), findOpen };
  }
  // The details panel reaches the window's top: its own head is its top row, its round buttons level with the window's, its last one 14 px short of them.
  if (name === "details-top-row") {
    const panel = document.querySelector(".mb-det:not([hidden])"), head = panel?.querySelector(":scope > .mb-det-head");
    require(visible(panel) && visible(head), "the details panel is open");
    const controls = document.querySelector(".window-chrome .window-controls").getBoundingClientRect(), box = element => element.getBoundingClientRect();
    require(Math.abs(box(panel).top) <= 1 && box(head).top <= 1 && Math.abs(box(head).height - 60) <= 2, `the panel's head is its top row: ${Math.round(box(head).top)} and ${Math.round(box(head).height)} px high`);
    const buttons = [...head.querySelectorAll(".btn.icon")].filter(visible);
    require(buttons.length >= 2, "the panel's gear and close stand in its row");
    for (const button of buttons) require(Math.abs(box(button).top + box(button).height / 2 - 30) <= 2, `a panel button is level with the window's buttons' row, 30 px from the top: ${Math.round(box(button).top + box(button).height / 2)}`);
    const last = Math.max(...buttons.map(button => box(button).right));
    require(Math.abs(controls.left - last - 14) <= 2, `the panel's last button ends 14 px short of the window's buttons: ${Math.round(controls.left - last)}`);
    require(head.hasAttribute("data-window-drag"), "the panel's row moves the window");
    for (const button of buttons) { const b = box(button), hit = document.elementFromPoint(b.left + b.width / 2, b.top + 6); require(hit && button.contains(hit), `the pointer reaches the panel's ${button.getAttribute("aria-label")} at the top of the row`); }
    const scroll = panel.querySelector(":scope > .mb-det-scroll");
    require(box(scroll).top >= box(head).bottom - 1, "the panel's contents start under its row");
    return { check: name, rowHeight: Math.round(box(head).height), closeGap: Math.round(controls.left - last) };
  }
  // The thread read higher up has messages under the row; they fade (the mask) and the pill and buttons stay on their own opaque surfaces.
  if (name === "conversation-top-row-scrolled") {
    const pane = [...document.querySelectorAll(".page-agent > .mb-chat")].find(visible), head = pane.querySelector(":scope > .mb-head"), scroller = pane.querySelector(":scope > .ra-stage > .ra-scroll");
    const row = head.getBoundingClientRect(), lines = [...scroller.querySelectorAll(".thread > li")].filter(visible);
    require(scroller.scrollTop > 0 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 40, "the thread is read higher up");
    require(lines.some(line => line.getBoundingClientRect().top < row.bottom - 8 && line.getBoundingClientRect().bottom > row.top + 8), "a message passes under the row");
    const mask = getComputedStyle(scroller).maskImage;
    require(/linear-gradient/.test(mask) && /rgba\(0, 0, 0, 0\)|transparent/.test(mask), `what reaches the row fades out: ${mask}`);
    for (const button of [...head.querySelectorAll(".btn.icon")].filter(visible)) {
      const style = getComputedStyle(button);
      require(/^rgb\(/.test(style.backgroundColor) && style.opacity === "1", `a header button stands on its own opaque surface: ${style.backgroundColor}`);
    }
    const pillSurface = getComputedStyle(head.querySelector(".conversation-trigger .mb-pill") ?? head, "::before");
    require(!head.querySelector(".conversation-trigger .mb-pill") || /^rgb\(/.test(pillSurface.backgroundColor), `the pill stands on its own opaque surface: ${pillSurface.backgroundColor}`);
    return { check: name, under: lines.filter(line => line.getBoundingClientRect().top < row.bottom).length };
  }
  if (name === "conversation-top-row-wheel-before") {
    const scroller = [...document.querySelectorAll(".page-agent > .mb-chat")].find(visible).querySelector(":scope > .ra-stage > .ra-scroll");
    require(scroller.scrollHeight - scroller.clientHeight > 120, "the thread is long enough to turn");
    window.__rowWheel = scroller.scrollTop;
    return { check: name, top: Math.round(scroller.scrollTop) };
  }
  if (name === "conversation-top-row-wheel") {
    const scroller = [...document.querySelectorAll(".page-agent > .mb-chat")].find(visible).querySelector(":scope > .ra-stage > .ra-scroll");
    require(scroller.scrollTop < window.__rowWheel - 100, `a wheel over the header moved the thread up: ${Math.round(window.__rowWheel)} -> ${Math.round(scroller.scrollTop)}`);
    return { check: name, moved: Math.round(window.__rowWheel - scroller.scrollTop) };
  }
  if (name === "conversation-share") {
    const head = document.querySelector('.mb-chat .mb-head'), share = head?.querySelector('[data-act="share-member"]'), search = head?.querySelector('[data-act="search"]');
    require(visible(share) && share.closest('.ra-tools'), "share is a visible tool of the conversation header");
    const h = head.getBoundingClientRect(), s = share.getBoundingClientRect();
    require(h.right - s.right < h.width / 4, "share sits at the header's right");
    if (visible(search)) require(search.getBoundingClientRect().left - h.left < h.width / 4, "search sits opposite, at the left");
    require(!document.querySelector('.mb-det [data-act="share-member"], .mb-det [data-det="share"]'), "share left the panel");
    return { check: name };
  }
  if (name === "conversation-share-menu") {
    const item = document.querySelector('#app-popover .menu-action');
    require(visible(item) && item.textContent.trim().length > 0, "share opens one plain choice that says what it does");
    // Sharing saves a file or prepares a publish request on GitHub; there is no link to share (owner, 2026-11-11).
    require(/檔案/.test(item.textContent) && /GitHub/.test(item.textContent) && !/連結|link/i.test(item.textContent), `the choice says a file is saved or a request is prepared, and promises no link: ${item.textContent.trim()}`);
    // The card is drawn for what it does (owner, 2026-11-12, after Grok Bot's Create a copy): its mark is the member's own face twice,
    // the copy behind and above the one that is, and it hangs under the button with its right edge on the button's.
    const faces = [...item.querySelectorAll(".mmark .share-faces > *")];
    require(faces.length === 2 && faces.every(visible) && !item.querySelector(".ck, [data-presence-member]"), "its mark is the member's face twice, a drawing that takes no presence, and no stock icon");
    const behind = faces[0].getBoundingClientRect(), front = faces[1].getBoundingClientRect();
    const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    require(behind.right > front.right && behind.top < front.top && behind.width < front.width && overlaps(behind, front), "the copy stands behind: smaller, up and to the right, the two overlapping");
    const card = item.closest(".menu").getBoundingClientRect(), opener = document.querySelector('.mb-chat .mb-head [data-act="share-member"]').getBoundingClientRect(), row = item.getBoundingClientRect();
    require(card.top >= opener.bottom && Math.abs(card.right - opener.right) <= 2, `the card hangs under the button, right edges together: ${Math.round(card.right)} and ${Math.round(opener.right)}`);
    const words = item.querySelector(".mtd").getBoundingClientRect(), mark = item.querySelector(".mmark").getBoundingClientRect();
    require(Math.abs((mark.top + mark.bottom) - (row.top + row.bottom)) <= 2 && words.left - mark.right >= 8, "the mark is centred on its row, clear of the words");
    return { check: name };
  }
  if (name === "store-google") {
    const card = document.querySelector('[data-conn="open-store"][data-id="google"]')?.closest('.cs-card');
    require(card && card.textContent.includes("Google（私人連接）"), "the owner's own Google has its row");
    require(card.querySelector('.logo-art, .logo-mono, svg') && !card.querySelector('.need'), "it wears Gmail's mark and asks nothing it would have to explain on its row");
    require(card.querySelector('[data-conn="join"]'), "it is connected from its row like any app");
    return { check: name };
  }
  if (name === "store-google-in-chat") {
    const text = document.querySelector('.page-agent:not([hidden]) .composer textarea')?.value ?? "";
    require(text === "幫我連接我自己的 Google 帳號", `the owner's words are in the composer (${text})`);
    require(!window.__look.calls.some(call => /^connectors\.(connect|google\.)/.test(call.method) || call.method === "integrations.card_connect"), "nothing was connected from the store");
    return { check: name };
  }
  if (name === "store-n8n") {
    const card = document.querySelector('[data-conn="open-store"][data-id="n8n"]')?.closest('.cs-card');
    require(card?.querySelector('.logo-mono svg path'), "n8n carries its own mark, not the generic plug");
    // What it needs is said in the conversation it is set up in, not on its row (owner, 2026-11-09).
    require(card && !card.querySelector('.need'), "its row asks nothing it would have to explain");
    require(card?.querySelector('[data-conn="join"]'), "it is connected from its row like any app");
    return { check: name };
  }
  if (name === "plugins-store") {
    const cards = [...document.querySelectorAll('.cs-card')];
    const ids = cards.map(card => card.querySelector('[data-conn="open-store"]')?.dataset.id);
    require(!document.querySelector('.cs-apps [data-conn="tab"], .cs-apps [role="tab"], .cs-apps .cs-store-pages'), "there are no tabs and no pages: the apps are one view");
    require(document.querySelector('.cs-results .cs-sec') && document.querySelector('.cs-results .cs-sec h2').textContent === '為你推薦', "the view starts with 為你推薦 and its sections");
    require(!/\b\d{3,}\b/.test([...document.querySelectorAll('.cs-apps h2, .cs-chips, .cs-top')].map(node => node.textContent).join(' ')), "no count of the catalogue is anywhere on the view");
    require(window.__look.calls.some(c => c.method === 'integrations.catalog'), "built-in catalog uses the real IPC boundary");
    require(!document.querySelector('#conn-key'), "key form does not replace the view");
    if (window.__look.data.composioConfigured) {
      require(document.querySelector('.cs-chips'), "all catalog sources share the category chips");
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
  if (name === "usage-owner-cards") {
    // The same mix as the account menu's blocks (R-SIDE-02): one card for each provider, and a window that has reset keeps no stale number or bar.
    const panel = document.querySelector('#models-panel-usage'), cards = [...panel.querySelectorAll('.run-allowance .run-subscription')].filter(visible);
    const named = cards.map(card => card.querySelector('h4').textContent.trim());
    require(named.join() === 'Codex,Claude,ChatGPT,OpenRouter', `a card for each of the four providers, in order: ${named.join()}`);
    const [codex, claude, chatgpt, openrouter] = cards;
    require(/35%/.test(codex.textContent) && codex.querySelector('[role="progressbar"]'), `Codex has its live window and bar: ${codex.textContent}`);
    require(!claude.querySelector('[role="progressbar"]') && !/\d\s*%/.test(claude.textContent) && /已重置|Reset/.test(claude.textContent), `Claude's window has reset: it says so, with no stale number or bar: ${claude.textContent}`);
    require(chatgpt.dataset.allowance === 'chatgpt' && chatgpt.querySelector('[data-run-act="chatgpt-usage"]'), 'ChatGPT keeps its card and the button to its own page');
    require(openrouter.dataset.allowance === 'openrouter' && /3\.21/.test(openrouter.textContent) && !/%/.test(openrouter.textContent), `OpenRouter says this month's use of the key: ${openrouter.textContent}`);
    return { check: name, cards: named };
  }
  if (name === "usage-plain") {
    // Plain usage summary: what each subscription has left, then the key and what was spent.
    const panel = document.querySelector('#models-panel-usage');
    require(visible(panel), "the usage tab is open");
    require(!panel.querySelector('svg.ua-chart, .ua-chart, .run-tiles, .run-tile, .run-bill, .run-groups, table, [data-range], [data-run-act="export"], [data-run-act="period"], .foot'), "no periods, charts, breakdowns, tiles, exports or footnotes");
    const rows = ["raphael-spend", "openrouter-key"].map(row => panel.querySelector(`[data-row="${row}"]`));
    require(rows.every(visible) && !panel.querySelector('[data-row="openrouter-usage"]'), "this month's spending of the app and the key show; the key's own usage is a card above them, not a row");
    const spend = rows[0], bar = spend.querySelector('.spend-bar i'), limit = window.__look.data.status.spend.limit_usd;
    if (limit > 0) {
      require(visible(spend.querySelector('.spend-bar')) && bar, "the spending has a bar against the monthly limit");
      const [r, g, b] = getComputedStyle(bar).backgroundColor.match(/[\d.]+/g).map(Number);
      require(Math.max(r, g, b) - Math.min(r, g, b) > 60, `the bar is a member's colour, not black or white: rgb(${r}, ${g}, ${b})`);
    }
    // No refresh anywhere: opening Settings reads the allowances (`usage-open-*`), so nothing stands beside the tab's name.
    const heading = document.querySelector('.set-content > #set-title'), page = heading?.parentElement, first = page?.querySelector('.models-page');
    require(heading && first, "the tab's name stands alone above its views");
    const beside = [...page.children].slice(0, [...page.children].indexOf(first)).filter(child => child !== heading);
    require(!document.querySelector('[data-act="models-refresh"], .models-refresh, .set-head') && beside.every(child => !child.matches('button') && !child.querySelector('button')), "no refresh button or icon beside the tab's name");
    const refreshes = [...page.querySelectorAll('button')].filter(button => visible(button) && /refresh|reload|重新整理|重新讀取|更新/i.test(`${button.getAttribute('aria-label') ?? ''} ${button.textContent} ${button.dataset.act ?? ''} ${button.dataset.runAct ?? ''}`));
    require(refreshes.length === 0, `no button on the tab refreshes anything (${refreshes.map(button => button.getAttribute('aria-label') || button.textContent.trim()).join(', ')})`);
    const cards = [...panel.querySelectorAll('.run-subscription')].filter(visible), allowance = panel.querySelector('.run-allowance');
    const subscriptions = window.__look.data.allowances.brains.length;
    if (subscriptions) {
      require(cards.length >= subscriptions && spend.compareDocumentPosition(allowance) & Node.DOCUMENT_POSITION_FOLLOWING && allowance.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING, "spending leads, each subscription has a card below it, then the key");
      for (const track of panel.querySelectorAll('.run-allowance .run-bar-track')) {
        const fill = track.querySelector('i'), box = track.getBoundingClientRect();
        require(box.width > 0 && box.height === 7 && fill.getBoundingClientRect().height === 7, "allowance bars keep their visible height");
      }
    } else require(!visible(allowance), "with no subscription the allowance section stands aside");
    return { check: name, cards: cards.length };
  }
  if (name.startsWith("usage-open-")) {
    // Settings reads the allowances each time it opens, on whatever tab and unseen: asked for once at the opening, the
    // numbers already on their tab, a reading that finds the same numbers touches nothing, a new number replaces the old
    // in the same card, and no busy state or message is ever drawn.
    // Only the Settings' own readings count (they go through the usage card, usage-analytics.ts): the account menu that
    // Settings is opened from reads the allowances too, at its own opening (R-SIDE-02); the scene traces each call's origin.
    const stage = name.slice("usage-open-".length), asked = () => window.__look.calls.filter(call => call.method === "usage.allowances" && String(call.from ?? "").includes("usage-analytics")).length;
    const root = () => document.querySelector('.usage-analytics'), keep = () => (window.__lookUsage ??= { touched: 0, busy: false });
    const count = (state, records) => {
      for (const record of records) {
        state.touched++;
        if (record.type === 'attributes' && record.attributeName === 'aria-busy' && (record.oldValue === 'true' || record.target.getAttribute('aria-busy') === 'true')) state.busy = true;
      }
    };
    const watched = () => { const state = keep(); count(state, state.observer?.takeRecords() ?? []); return state; };
    if (stage === "general") {
      require(visible(document.querySelector('.modal-scrim [data-pane="general"][aria-current="page"]')) && !document.querySelector('[data-models-tab]'), "Settings is open on 一般, not on the allowances' tab");
      require(window.__look.calls.some(call => call.from), "the scene traces where each call comes from");
      require(!document.querySelector('[data-act="models-refresh"]'), "no refresh button exists");
      // Settings asks at its opening, before its first tab is drawn; the account menu it was opened from asked on its own (api.ts ASKED_AGAIN: no earlier answer stands in for it).
      return (async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        require(asked() === 1, `the allowances were asked for once, at the opening (${asked()}; all readings: ${JSON.stringify(window.__look.calls.filter(call => call.method === "usage.allowances").map(call => String(call.from).split(" < ").slice(3, 6).join(" < ")))})`);
        return { check: name, asked: asked() };
      })();
    }
    if (stage === "arm") {
      require(asked() === 1, `reaching the tab asks for nothing more (${asked()})`);
      const area = root(), card = area?.querySelector('.run-subscription');
      require(visible(area) && card && area.getAttribute('aria-busy') === 'false', "the numbers are on the tab as it opens, none being waited for");
      const state = keep();
      state.card = card; state.html = area.innerHTML; state.touched = 0; state.busy = false; state.text = card.textContent;
      state.observer?.disconnect();
      state.observer = new MutationObserver(records => count(state, records));
      state.observer.observe(area, { attributes: true, attributeOldValue: true, childList: true, characterData: true, subtree: true });
      return { check: name, asked: asked() };
    }
    if (stage === "lower") {
      // The next reading finds another number: the first window of the first subscription has less left.
      const window0 = window.__look.data.allowances.brains[0].windows[0];
      window0.remaining_percent = Math.max(0, window0.remaining_percent - 10);
      return { check: name, remaining: window0.remaining_percent };
    }
    if (stage !== "same" && stage !== "changed") throw new Error(`${name}: unknown stage`);
    return (async () => {
      // The reading has answered (the mock stamps the end of each call), and the page has had a moment to draw it.
      const answered = () => window.__look.calls.filter(call => call.method === "usage.allowances").every(call => call.t1 !== undefined);
      for (let waited = 0; waited < 3000 && !(answered() && asked() >= (stage === "same" ? 2 : 3)); waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
      await new Promise(resolve => setTimeout(resolve, 150));
      const state = watched(), area = root();
      require(visible(area) && state.card && area.contains(state.card), "the card the numbers were shown in is still on the page");
      if (stage === "same") {
        require(asked() === 2, `the next opening asked again (${asked()})`);
        require(state.touched === 0 && area.innerHTML === state.html, `a reading that found the same numbers touched nothing (${state.touched} changes)`);
      } else {
        require(asked() === 3, `the opening after asked again (${asked()})`);
        require(state.card.textContent !== state.text && /\d+%/.test(state.card.textContent) && state.touched > 0, "the new number replaced the old in the same card");
        require(!state.busy && area.getAttribute('aria-busy') === 'false', "no busy state was drawn while it read");
      }
      require(!document.querySelector('.toast'), "nothing was said about the reading");
      return { check: name, asked: asked(), touched: state.touched };
    })();
  }
  if (name === "overlay-percentage") {
    const caption = document.querySelector("#progress");
    require(visible(caption) && /^\u300a \d+ % \u300b$/.test(caption.textContent), "original percentage caption is visible");
    require(Number(caption.textContent.match(/\d+/)[0]) > 0, "native progress advances beyond the initial zero");
    require(!document.body.textContent.includes("Transcribing") && !document.body.textContent.includes("\u8f49\u9304\u4e2d"), "elapsed-time captions are absent");
    return { check: name, caption: caption.textContent };
  }
  if (name.startsWith("member-settings-place-")) {
    const scroller = document.querySelector('.page-agent .mb-chat .ra-scroll');
    const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const markOffset = () => { const mark = scroller.querySelector('.tn[data-id="300035"]'); return mark ? mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top : NaN; };
    if (name === "member-settings-place-before") {
      require(bottom > 200 && scroller.scrollTop > 200, "the thread is read in the middle");
      window.__settingsPlace = scroller.scrollTop;
      window.__settingsMark = markOffset();
      window.__settingsHeight = scroller.scrollHeight;
      return { check: name, top: scroller.scrollTop };
    }
    if (name === "member-settings-place-kept") {
      // The turn that was read stands where it stood: turns mounted above it move scrollTop, not the view.
      require(Math.abs(markOffset() - window.__settingsMark) <= 2 && bottom > 100, `the turn read is where it was (offset ${Math.round(window.__settingsMark)} -> ${Math.round(markOffset())}; top ${Math.round(window.__settingsPlace)} -> ${Math.round(scroller.scrollTop)}; height ${window.__settingsHeight} -> ${scroller.scrollHeight})`);
      return { check: name, top: scroller.scrollTop };
    }
    require(bottom <= 2 && scroller.scrollTop > 200, "the thread is back at its bottom, and it scrolls");
    require(!visible(document.querySelector('.page-agent .mb-chat .conversation-latest')), "the latest button does not show");
    return { check: name, bottom };
  }
  if (name.startsWith("member-settings")) {
    const pane = document.querySelector(".ms-pane");
    const chat = document.querySelector(".page-agent .mb-chat");
    const view = pane.dataset.view;
    const raphael = !pane.querySelector("#ms-name");
    // The details panel folds away while the page is open and comes back as it was once the page is left.
    if (name === "member-settings-back") {
      require(!visible(pane) && visible(chat) && visible(chat.querySelector(".composer")), "the conversation is where the page was");
      require(visible(document.querySelector(".mb-det")), "the details panel that was open comes back with the conversation");
      return { check: name };
    }
    require(visible(pane) && !visible(chat), "the page takes the conversation's place");
    require(!visible(document.querySelector(".mb-det")), "the details panel folds away while the settings page is open");
    const scroller = pane.querySelector(".ms-scroll"), body = pane.querySelector(".ms-body");
    require(scroller.scrollWidth <= scroller.clientWidth + 1 && pane.scrollWidth <= pane.clientWidth + 1, "nothing overflows sideways");
    require(body.getBoundingClientRect().width <= 20 * 32 + 200 + 1, "the page is a reading page and its column of kinds");
    const back = pane.querySelector('[data-ms="back"]');
    require(visible(back) && back.classList.contains("icon") && back.textContent.trim() === "" && back.querySelector("svg.i"), "the way back is an arrow icon with no words");
    const cover = pane.querySelector(".ms-cover"), face = pane.querySelector(".ms-face");
    // The way back stands at the page's top left, on the cover: a soft round edge button whose surface is solid, so it is
    // seen on any picture, at rest and under the pointer (owner, 2026-11-11: 「放回圖片裡面…要有背景。Hover 上去的時候不要消失」).
    const arrow = back.getBoundingClientRect(), paneBox = pane.getBoundingClientRect();
    const solid = value => { const parts = value.match(/[\d.]+/g)?.map(Number) ?? []; return /^rgb/.test(value) && parts.length >= 3 && (parts.length === 3 || parts[3] === 1); };
    require(arrow.left >= paneBox.left + 4 && arrow.left <= paneBox.left + 24 && arrow.top >= paneBox.top && arrow.top <= paneBox.top + 48, `the way back stands at the page's top left (${Math.round(arrow.left - paneBox.left)}, ${Math.round(arrow.top - paneBox.top)})`);
    require(Math.round(arrow.width) === 36 && Math.round(arrow.height) === 36 && parseFloat(getComputedStyle(back).borderTopLeftRadius) >= 18, `the way back is a round edge button (${Math.round(arrow.width)} x ${Math.round(arrow.height)})`);
    require(solid(getComputedStyle(back).backgroundColor), `the way back has a solid surface (${getComputedStyle(back).backgroundColor})`);
    if (view === "main") {
      const edge = cover.getBoundingClientRect(), mark = face.getBoundingClientRect();
      // Once the page has scrolled (a long field opened low on a short window) the arrow stands on its own band and the cover has gone under it.
      if (!pane.hasAttribute("data-scrolled")) {
        require(arrow.top >= edge.top && arrow.bottom <= edge.bottom, "the way back is on the cover");
        require(arrow.bottom <= mark.top || arrow.right <= mark.left, "the way back is clear of the face");
      }
      const change = cover.querySelector('[data-ms="cover"]');
      // At rest the two share one surface; under the pointer an edge button is a step lighter, as everywhere.
      if (change && !back.matches(":hover") && !change.matches(':hover, [aria-expanded="true"]')) require(getComputedStyle(change).backgroundColor === getComputedStyle(back).backgroundColor, "the cover's two icons share one surface");
    }
    if (name === "member-settings-back-hover") {
      // Under the pointer it once went clear and was lost in the picture.
      require(back.matches(":hover"), "the pointer is on the way back");
      require(visible(cover.querySelector("img.ms-cover-img")), "the owner's picture is behind it");
      require(solid(getComputedStyle(back).backgroundColor), `under the pointer the way back keeps a solid surface (${getComputedStyle(back).backgroundColor})`);
      return { check: name };
    }
    if (name === "member-settings-cover-picture") {
      // The owner's picture fills the cover and stays put: no picture in the app can be dragged out of the window (R-UI-119).
      const img = cover.querySelector("img.ms-cover-img"), box = img?.getBoundingClientRect(), edge = cover.getBoundingClientRect();
      require(visible(img) && img.complete && img.naturalWidth > 0, "the owner's picture is drawn as the cover");
      require(Math.abs(box.width - edge.width) <= 1 && Math.abs(box.height - edge.height) <= 1, "the picture fills the cover");
      require(getComputedStyle(img).getPropertyValue("-webkit-user-drag") === "none", "the cover's picture cannot be dragged out of the window");
      const loose = [...document.images].filter(image => getComputedStyle(image).getPropertyValue("-webkit-user-drag") !== "none");
      require(loose.length === 0, `no picture on the page can be dragged (${loose.map(image => image.className || image.src.slice(0, 40)).join(", ")})`);
      require(visible(face) && face.getBoundingClientRect().bottom > edge.bottom + 8, "the face still crosses the cover's lower edge");
      // Every icon on the picture keeps its own soft surface, so it reads on any photo in either theme (owner, 2026-11-09).
      const bare = value => /^(transparent|rgba\(0, 0, 0, 0\))$/.test(value);
      const change = cover.querySelector('[data-ms="cover"]');
      require(visible(change) && !bare(getComputedStyle(change).backgroundColor), `the cover's icon has its round surface on the picture (${getComputedStyle(change).backgroundColor})`);
      const controls = document.querySelector(".window-controls");
      if (controls && visible(controls)) require(!bare(getComputedStyle(controls).backgroundColor), "the window's own buttons have a surface on the picture");
      return { check: name };
    }
    if (name === "member-settings-cover") {
      // Its menu: the patterns as small covers in the member's colour, then a picture from this PC.
      const menu = document.querySelector("#app-popover"), swatches = [...menu.querySelectorAll(".ms-swatch")];
      require(visible(menu) && swatches.length === 5 && swatches.every(visible), "the cover's menu shows its five patterns");
      require(swatches.filter(swatch => swatch.getAttribute("aria-checked") === "true").length === 1, "the cover in use is marked");
      for (const swatch of swatches) {
        const preview = swatch.querySelector(".ms-cover"), box = preview.getBoundingClientRect(), style = getComputedStyle(preview);
        // A swatch is drawn: it fills its button (a menu's row styles once squeezed it to nothing) and shows its pattern.
        require(swatch.getAttribute("aria-label") && box.width >= 40 && box.height >= 28, `${swatch.dataset.cover}: the small cover fills its swatch (${Math.round(box.width)} x ${Math.round(box.height)})`);
        require(/gradient/.test(style.backgroundImage) || (swatch.dataset.cover === "plain" && style.backgroundColor !== "rgba(0, 0, 0, 0)"), `${swatch.dataset.cover}: the small cover shows its pattern in the member's colour`);
      }
      const tops = new Set(swatches.map(swatch => Math.round(swatch.getBoundingClientRect().top)));
      require(tops.size === 1, "the patterns stand in one row");
      require(visible(menu.querySelector('[data-cover-act="upload"]')), "a picture from this PC is offered");
      const box = menu.getBoundingClientRect();
      require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu stays in the window");
      return { check: name };
    }
    if (view === "main") {
      const edge = cover.getBoundingClientRect(), mark = face.getBoundingClientRect();
      require(visible(cover) && edge.height >= 96 && /gradient/.test(getComputedStyle(cover).backgroundImage), "a cover with a gradient and its pattern");
      require(visible(face) && mark.top < edge.bottom - 8 && mark.bottom > edge.bottom + 8 && mark.width >= 80, "the face is large and crosses the cover's lower edge");
      require(face.querySelector(".mb-face-pencil svg.i") && face.getAttribute("aria-haspopup") === "menu", "the face edits with a pencil and opens the picker");
      const change = cover.querySelector('[data-ms="cover"]'), button = change?.getBoundingClientRect();
      require(visible(change) && change.classList.contains("icon") && change.textContent.trim() === "" && change.getAttribute("aria-haspopup") === "menu", "the cover changes from one round icon");
      require(button.right <= edge.right && button.bottom <= edge.bottom && button.left > mark.right, "the cover's icon sits at its lower right, clear of the face");
      // The kinds of settings in a column on the left.
      const nav = pane.querySelector(".ms-nav"), content = pane.querySelector(".ms-content");
      const kinds = [...nav.querySelectorAll('[data-ms="cat"]')].filter(visible);
      // The same kinds for every member, Raphael too, in the owner's order (owner, 2026-11-09).
      const expectedKinds = ["tools", "skills", "soul", "notify"];
      require(kinds.map(item => item.dataset.cat).join() === expectedKinds.join(), `the kinds are ${expectedKinds.join()} (${kinds.map(item => item.dataset.cat).join()})`);
      const chosen = kinds.filter(item => item.getAttribute("aria-current") === "page");
      require(chosen.length === 1, "one kind is chosen");
      const category = chosen[0].dataset.cat;
      require(content.dataset.cat === category, "only the chosen kind is shown beside the column");
      require(!pane.querySelector('.member-msg, [data-cat="routines"], [data-cat="messaging"]'), "what the panel beside the page shows (routines, messaging) is not here");
      // No memory anywhere (owner, 2026-11-11: 「都不要讓我們看到記憶」): not a kind, not a card, not a word.
      require(!pane.querySelector('[data-cat="memory"], [data-mem-space], [data-mem-section], .mem-entry, .ms-memory') && !pane.textContent.includes("記憶"), "the page shows no memory");
      const wide = pane.getBoundingClientRect().width > 680;
      const navBox = nav.getBoundingClientRect(), contentBox = content.getBoundingClientRect();
      if (wide) {
        require(navBox.right <= contentBox.left + 1 && Math.abs(navBox.top - contentBox.top) <= 2, "the column of kinds stands on the left of the chosen kind");
        require(kinds.every(item => item.querySelector("svg.i")), "each kind has its icon, as Settings' own");
        const lefts = new Set(kinds.map(item => Math.round(item.getBoundingClientRect().left)));
        require(lefts.size === 1, "the kinds stand in one column");
      } else {
        require(navBox.bottom <= contentBox.top + 1, "a narrow page puts the kinds in a row above the chosen kind");
        const rows = new Set(kinds.map(item => Math.round(item.getBoundingClientRect().top)));
        require(rows.size <= 3 && rows.size < kinds.length, `a narrow page's kinds are pills that wrap, not a tall list (${rows.size} rows)`);
      }
      for (const item of kinds) require(item.querySelector("span").scrollWidth <= item.querySelector("span").clientWidth + 1, `${item.dataset.cat} shows its whole name`);
      const expected = { soul: ["ms-personality", "ms-instructions"], skills: ["ms-skills", "ms-commands"], tools: ["ms-tools", "ms-draft"], notify: ["ms-notify"] }[category];
      const sections = [...pane.querySelectorAll(".ms-section[data-k]")].filter(visible).map(section => section.dataset.k);
      require(sections.join() === expected.join(), `${category} shows ${expected.join()} (${sections.join()})`);
      for (const section of pane.querySelectorAll(".ms-section[data-k]")) {
        const list = section.querySelector(".ms-list"), head = section.querySelector(".ms-head");
        require(visible(list) && getComputedStyle(list).backgroundColor !== "rgba(0, 0, 0, 0)", `${section.dataset.k} is a tinted list`);
        // A kind with one section needs no name over it: the column says it.
        if (expected.length > 1 && category !== "tools") require(visible(head) && head.querySelector("h2").textContent.trim(), `${section.dataset.k} has its name over the list`);
        else require(!head || !head.querySelector("h2"), `${section.dataset.k} does not repeat the kind's name`);
        if (head?.querySelector("h2")) require(head.querySelector("h2").getBoundingClientRect().left > list.getBoundingClientRect().left, `${section.dataset.k}: the name starts inside the list's edge`);
        require(list.scrollHeight <= list.clientHeight + 1 && getComputedStyle(list).overflowY === "visible", `${section.dataset.k} does not scroll inside`);
      }
      // No word-buttons where an icon says it: edits, adds and menus are icons, the rest are rows or switches.
      const words = [...pane.querySelectorAll(".ms-section button.btn, .ms-id button.btn")].filter(button => visible(button) && !button.matches(".icon, .ms-open, .mb-face-edit, .ms-add .btn.sm, [data-missing-repair]"));
      require(words.length === 0, `no text buttons: ${words.map(button => button.textContent.trim()).join("|")}`);
      require(![...pane.querySelectorAll("button")].some(button => visible(button) && /^(編輯|Edit|編集)$/.test(button.textContent.trim())), "no 編輯 button");
      for (const edit of pane.querySelectorAll('[data-ms="edit"]')) require(visible(edit.querySelector("svg.i")), "a long field ends in its pencil");
      if (category === "tools") {
        // Each app the member may use with its own mark, so what it is given is read at a glance (owner, 2026-11-09).
        const apps = [...pane.querySelectorAll(".ms-row.ms-app")];
        require(apps.length > 0 && apps.every(row => visible(row.querySelector(".mono")) && row.querySelector('[data-ms="tool"][role="switch"]')), "the member's connections are rows with their mark and a switch");
        for (const row of apps) {
          const mark = row.querySelector(".mono").getBoundingClientRect(), label = row.querySelector(".ms-label").getBoundingClientRect();
          require(mark.right <= label.left && Math.abs((mark.top + mark.bottom) / 2 - (label.top + label.bottom) / 2) < 4, `${row.textContent.trim()}: its mark stands before its name, centred with it`);
        }
        // A known app shows its own logo, never the plug: Mobbin's M, white on the dark theme (owner, 2026-11-10).
        const mobbin = apps.find(row => row.textContent.includes("Mobbin"));
        if (mobbin) {
          const logo = [...mobbin.querySelectorAll(".mono img.logo")].find(visible);
          require(logo && /^data:image\/svg/.test(logo.src) && logo.complete && logo.naturalWidth > 0, "Mobbin shows its own mark, not the plug");
        }
        const draft = pane.querySelector('[data-k="ms-draft"] [data-ms="draft"]');
        require(visible(draft) && draft.getAttribute("role") === "switch", "the drafts switch stands under the apps");
      }
      if (category === "notify") {
        const switches = [...pane.querySelectorAll('[data-k="ms-notify"] [role="switch"]')];
        require(switches.length === 1 && visible(switches[0]), "notifications are one switch");
      }
      if (raphael) {
        require(visible(pane.querySelector(".ms-static")) && !pane.querySelector("#ms-name, #ms-role"), "Raphael's name is not typed here");
      } else {
        const memberName = pane.querySelector("#ms-name"), role = pane.querySelector("#ms-role");
        require(visible(memberName) && visible(role) && memberName.getBoundingClientRect().left <= face.getBoundingClientRect().left + 8, "the name and the role are in place under the face");
        require(getComputedStyle(memberName).borderTopColor === "rgba(0, 0, 0, 0)" || getComputedStyle(memberName).borderTopWidth === "1px", "the name is a bare field until it is pointed at");
      }
      require(!pane.querySelector('[data-det="hide"], [data-ms="hide"]') && !/從側欄隱藏|Hide from sidebar/.test(pane.textContent), "hiding from the sidebar is not here");
    } else {
      require(!visible(cover) && !visible(face), "a view of its own has no cover");
      require(visible(pane.querySelector(".ms-subhead .ms-title")), "a view has its own title");
    }
    if (name === "member-settings-field") {
      const box = pane.querySelector("#ms-personality");
      require(visible(box) && document.activeElement === box, "the box opens in place and has the keyboard");
      require(box.closest(".ms-list") && !box.closest("button"), "the box stands in the section's list");
      require(box.getBoundingClientRect().width > 200, "the box is as wide as its list");
    }
    if (name.startsWith("member-settings-persona-")) {
      // The personality and the instructions (owner, 2026-11-12: 「我不是很喜歡這個個性的欄位的 UI UX」) are one kind of thing, so
      // one kind of quiet row: its words whole with a pencil, or one line of what could stand there; a press makes it a field.
      const stage = name.slice("member-settings-persona-".length);
      const stored = window.__look.data.members.find(item => item.id === 1);
      const fields = ["personality", "instructions"];
      const slot = field => pane.querySelector(`.ms-section[data-k="ms-${field}"]`);
      const rowOf = field => slot(field).querySelector('[data-ms="edit"]');
      const fieldOf = field => slot(field).querySelector("textarea");
      const here = field => rowOf(field) ?? fieldOf(field);
      const at = element => element.getBoundingClientRect();
      const lineOf = element => parseFloat(getComputedStyle(element).lineHeight);
      const edited = stage === "editing" ? "personality" : stage === "editing-long" ? "instructions" : null;
      require(pane.querySelector('.ms-content[data-cat="soul"]') && fields.every(field => visible(slot(field))), "the kind holds the personality and the instructions");
      // No box until a row is pressed (owner: 「一個巨大的空框」): at most the one field that was pressed is a textarea.
      const boxes = [...pane.querySelectorAll("textarea")].filter(visible).map(item => item.id);
      require(boxes.join() === (edited ? `ms-${edited}` : ""), `textareas on the page: ${boxes.join() || "none"}`);
      // The two are one kind: the same box edges, one left edge and one right edge, inset as the other kinds' rows are in their cards.
      const [first, second] = fields.map(here);
      require(visible(first) && visible(second) && Math.abs(at(first).left - at(second).left) <= 0.5 && Math.abs(at(first).right - at(second).right) <= 0.5, "the two share one left edge and one right edge");
      for (const field of fields) {
        const list = slot(field).querySelector(".ms-list"), pad = parseFloat(getComputedStyle(list).paddingLeft), mine = at(here(field));
        require(Math.abs(mine.left - (at(list).left + pad)) <= 0.5 && Math.abs(mine.right - (at(list).right - pad)) <= 0.5, `${field}: its row or field fills its card inside the card's padding`);
      }
      for (const field of fields.filter(item => item !== edited)) {
        const row = rowOf(field), label = row?.querySelector(".ms-label");
        require(row && row.tagName === "BUTTON" && visible(label), `${field} is a row you press`);
        const words = (stored[field] ?? "").trim(), style = getComputedStyle(label), line = lineOf(label);
        require(label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1, `${field}: its words are not cut`);
        require(style.whiteSpace === "pre-wrap" && style.textOverflow !== "ellipsis" && style.overflowY === "visible", `${field}: its words wrap, a line break of the owner's stays, nothing is ellipsised`);
        require(at(label).width <= parseFloat(style.maxWidth) + 1, `${field}: its lines are no wider than ${style.maxWidth}`);
        require(at(row).height >= at(label).height, `${field}: its row holds all its words`);
        const pencil = row.querySelector("svg.i");
        require(visible(pencil) && Math.abs((at(pencil).top + at(pencil).bottom) / 2 - (at(label).top + line / 2)) <= 1.5 && at(pencil).right <= at(row).right, `${field}: the pencil stands at the right, level with the first line`);
        if (words) {
          require(label.textContent === words && !label.classList.contains("is-empty"), `${field}: the row says the words as they are`);
          require(Math.round(at(label).height / line) >= words.split("\n").length, `${field}: every line of it shows`);
          require(style.color === getComputedStyle(row).color, `${field}: its words are in the text colour`);
        } else {
          // Nothing written: one quiet line in the secondary colour, what could stand there, a pencil, no box.
          require(label.classList.contains("is-empty") && label.textContent.trim() && !label.textContent.includes("\n"), `${field}: one quiet line of what could stand here`);
          require(Math.round(at(label).height / line) === 1 && Math.abs(at(row).height - 44) <= 1, `${field}: the empty state is one line (${Math.round(at(row).height)} px)`);
          require(style.color === getComputedStyle(slot(field).querySelector("h2")).color, `${field}: the line is in the secondary colour, as the heading`);
        }
        if (!words.includes("\n") && words && at(label).height <= line * 1.2) require(Math.abs(at(row).height - 44) <= 1, `${field}: a one-line row is as tall as the other kinds' rows`);
      }
      require(fields.every(field => slot(field).querySelector(".ms-head h2")?.textContent.trim() && !slot(field).querySelector(".ms-head small, .ms-head p, .ms-note")), "each heading is its name alone, with no small print");
      if (edited) {
        const input = fieldOf(edited), other = fields.find(field => field !== edited), style = getComputedStyle(input), line = lineOf(input);
        require(document.activeElement === input, "the field has the keyboard");
        require(style.resize === "none" && !input.matches("[rows]:not([rows='1'])"), "the field has no grip of its own");
        require(input.scrollHeight <= input.clientHeight + 1, "no scrollbar inside the field");
        // Its words stand exactly where the row's words stood, in the same type: nothing moves under the pointer.
        const label = rowOf(other).querySelector(".ms-label");
        require(Math.abs(at(input).left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - at(label).left) <= 0.5, "the words in the field stand where a row's words stand");
        require(style.fontSize === getComputedStyle(label).fontSize && style.lineHeight === getComputedStyle(label).lineHeight, "the field is set in the row's own type");
        // As tall as its words: a whole number of lines plus the row's own measure, and it grows and shrinks with them.
        const frame = 44 - line, lines = (at(input).height - frame) / line;
        require(Math.abs(lines - Math.round(lines)) < 0.05 && Math.round(lines) >= input.value.split("\n").length, `the field is as tall as its words (${lines.toFixed(2)} lines)`);
        if (stage === "editing") require(Math.round(lines) === 2, `two typed lines are two lines tall (${lines.toFixed(2)})`);
        if (stage === "editing-long") require(Math.round(lines) >= 20, `twenty lines open whole (${lines.toFixed(2)})`);
        const before = at(input).height, kept = input.value;
        input.value = kept + "\n一\n二\n三";
        const grown = at(input).height;
        input.value = kept;
        require(grown >= before + 2.9 * line && Math.abs(at(input).height - before) <= 1, "the field grows by the lines added to it and comes back with them");
      }
      if (stage === "saved") {
        const label = rowOf("personality").querySelector(".ms-label");
        require(stored.personality.trim() !== "" && label.textContent === stored.personality.trim(), "the row is back with the words that were saved");
        // Saved without a word, as the name and the role are: no note, no badge, and the pencil is back.
        require(![...document.querySelectorAll(".toast")].some(visible), "nothing is said once it has saved");
        require(!pane.querySelector(".spin, [aria-busy]") && visible(rowOf("personality").querySelector("svg.i")), "nothing is still being saved and the pencil is back");
        require(window.__look.calls.some(call => call.method === "members.update" && call.params?.personality === stored.personality), "it was saved");
      }
      if (stage === "escape") {
        const label = rowOf("instructions").querySelector(".ms-label");
        require(label.textContent === stored.instructions.trim(), "the old words are back");
        require(!window.__look.calls.some(call => call.method === "members.update" && call.params?.instructions !== undefined), "nothing was saved");
        require(![...document.querySelectorAll(".toast")].some(visible), "and nothing said");
      }
      // Beside the other kinds: the same cards, the same inset, the same headings and the same distances (not while a field is open:
      // leaving the kind would leave it).
      if (!edited && stage !== "saved") {
        const measure = () => {
          const lists = [...pane.querySelectorAll(".ms-content .ms-list")].filter(visible), heads = [...pane.querySelectorAll(".ms-content .ms-head h2")].filter(visible);
          const list = lists[0], row = list.querySelector(".ms-row, .ms-open"), style = getComputedStyle(list), h2 = heads[0] ? getComputedStyle(heads[0]) : null;
          return { left: at(list).left, right: at(list).right, rowLeft: at(row).left, rowRight: at(row).right, rowTop: at(row).top - at(list).top,
            card: [style.backgroundColor, style.borderTopLeftRadius, style.padding].join(" "),
            title: h2 ? [h2.fontSize, h2.fontWeight, h2.color, h2.lineHeight].join(" ") : "", titleLeft: heads[0] ? at(heads[0]).left - at(list).left : 0,
            titleGap: heads[0] ? at(list).top - at(heads[0]).bottom : 0, between: heads[1] ? at(heads[1]).top - at(lists[0]).bottom : 0 };
        };
        const mine = measure();
        const others = Object.fromEntries(["tools", "skills", "notify"].map(id => { pane.querySelector(`.ms-nav [data-cat="${id}"]`).click(); return [id, measure()]; }));
        pane.querySelector('.ms-nav [data-cat="soul"]').click();
        require(pane.querySelector('.ms-content[data-cat="soul"]') && measure().left === mine.left, "the kind is as it was after looking at the others");
        for (const [id, other] of Object.entries(others)) for (const key of ["left", "right", "rowLeft", "rowRight", "rowTop", "card"]) {
          require(typeof other[key] === "string" ? other[key] === mine[key] : Math.abs(other[key] - mine[key]) <= 0.5, `beside ${id}: ${key} is ${mine[key]}, there ${other[key]}`);
        }
        for (const key of ["title", "titleLeft", "titleGap", "between"]) {
          require(typeof others.skills[key] === "string" ? others.skills[key] === mine[key] : Math.abs(others.skills[key] - mine[key]) <= 0.5, `beside skills: the headings' ${key} is ${mine[key]}, there ${others.skills[key]}`);
        }
      }
      return { check: name, stage };
    }
    if (name === "member-settings-skill") {
      const text = pane.querySelector("#ms-skill-text");
      require(view === "skill" && visible(text) && text.value.length > 10, "the skill's text is in its own view");
      require(visible(pane.querySelector('[data-ms="skill-save"]')) && visible(pane.querySelector('[data-ms="skill-more"]')), "save is the one text button; deleting waits in the menu");
    }
    if (name === "member-settings-command") {
      require(view === "command" && ["#ms-command-name", "#ms-command-description", "#ms-command-template"].every(selector => visible(pane.querySelector(selector))), "the command's three fields");
      require(visible(pane.querySelector('[data-ms="command-save"]')), "the command has its save");
    }
    return { check: name, view };
  }
  if (name === "routine-view") {
    // A routine to read (routine-view.ts): its name, when it runs, who runs it and its instructions; no field, no footer.
    const dialog = document.querySelector(".mb-dialog.rv-dialog");
    require(visible(dialog) && dialog.querySelector("h2").textContent.trim(), "the routine opens with its name");
    require(visible(dialog.querySelector(".rv-when p")) && visible(dialog.querySelector(".rv-prompt")), "when it runs and its instructions are there to read");
    require(!dialog.querySelector('input, textarea, select, [role="switch"], .mb-dlg-act, [data-dlg="save"], [data-dlg="delete"]'), "nothing in it is a field, a switch or a button but its ×");
    const box = dialog.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the dialog stays in the window");
    require(!document.querySelector('.mb-det [data-det="routine-add"]'), "the panel has no plus: a routine is made in the conversation");
    return { check: name };
  }
  if (name === "routine-view-failed") {
    // A run that did not work is said as one beside its reason, and the dialog stays a thing to read.
    const dialog = document.querySelector(".mb-dialog.rv-dialog");
    const status = dialog?.querySelector(".rv-status.is-failed");
    require(visible(status) && status.textContent.trim().length > 4, "the failed run is told in words");
    require(visible(status.querySelector(".st.err .dot.err")), "the failed state has its dot, not colour alone");
    require(!dialog.querySelector('input, textarea, select, [role="switch"], .mb-dlg-act'), "nothing in it is a field or a switch");
    const box = status.getBoundingClientRect(), outer = dialog.getBoundingClientRect();
    require(box.left >= outer.left && box.right <= outer.right + 1, "the reason stays inside the dialog");
    return { check: name };
  }
  if (name === "routine-running") {
    // A routine's run shows the same working line as a turn the owner asked, and its instructions are no message of the owner's.
    const line = document.querySelector('.tn[data-live="true"]');
    require(visible(line), "the running routine is a live line of the thread");
    const action = line.querySelector(".live-presence .live-action");
    require(visible(action) && action.textContent.trim(), "the working line says what it is doing");
    require(!line.querySelector(".owner-message"), "a routine's instructions are not drawn as the owner's message");
    const box = line.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth, "the line stays in the window");
    return { check: name };
  }
  if (name === "reply-measure") {
    // Every part of a reply has one measure, the reading column (owner, 2026-11-09: 「寬度一樣」): a part holding a table
    // or code fills it, plain words grow up to it, and none runs past it.
    const probe = document.createElement("div"); probe.style.cssText = "position:absolute;visibility:hidden;width:var(--layout-reading-max)";
    document.body.append(probe); const measure = probe.getBoundingClientRect().width; probe.remove();
    // A room draws its members' words in its own thread; a private conversation marks each part of a reply.
    const parts = [...document.querySelectorAll(".thread .chat-message[data-reply], :is(.au-room-thread, .room-side-thread) .ra .chat-message")].filter(visible);
    require(parts.length > 0, "the reply has parts to measure");
    for (const part of parts) {
      const body = [...part.querySelectorAll(":scope > .ans, :scope > .rich-block")].filter(visible);
      for (const element of body) require(element.getBoundingClientRect().width <= measure + 1, `a reply part is no wider than the reading column (${Math.round(element.getBoundingClientRect().width)} > ${Math.round(measure)})`);
      const rich = part.querySelector(":scope > .rich-block");
      if (rich && visible(rich)) {
        // Its actions keep their column beside it (R-UI-104), out of a narrow window's room.
        const actions = part.querySelector(":scope > .message-actions");
        const reserve = actions ? actions.getBoundingClientRect().width + (parseFloat(getComputedStyle(part).columnGap) || 0) : 0;
        const room = part.parentElement.getBoundingClientRect().width - reserve, width = rich.getBoundingClientRect().width;
        require(width >= Math.min(measure, room) - 2, `a part holding a table or code fills the reading column (${Math.round(width)} of ${Math.round(Math.min(measure, room))})`);
      }
    }
    return { check: name, measure: Math.round(measure) };
  }
  if (name === "store-in-chat") {
    // More than a sign-in or one key is set up in the conversation (owner, 2026-11-09): 加入 leaves for it with the owner's words.
    const box = document.querySelector(".page-agent:not([hidden]) .composer textarea");
    require(visible(box) && /^幫我連接 \S/.test(box.value), `the composer holds the owner's words to connect it (${box?.value})`);
    require(!document.querySelector(".cn-setup-dialog, #conn-url"), "no form was opened");
    require(!window.__look.calls.some(call => /^(integrations\.(add|connect)|connectors\.connect)$/.test(call.method)), "nothing was connected before the member is asked");
    return { check: name };
  }
  if (name === "routine-asked") {
    // The calendar fills in nothing itself: the dropped member's conversation opens with the owner's words (owner, 2026-11-09).
    const box = document.querySelector(".page-agent:not([hidden]) .composer textarea");
    require(visible(box) && /09:00/.test(box.value) && box.value.length > 6, `the member's composer holds the words for a routine at that time (${box?.value})`);
    require(!document.querySelector(".mb-dialog"), "no editor opened");
    require(!window.__look.calls.some(call => call.method === "routines.create"), "nothing was created before the member is asked");
    return { check: name };
  }
  if (name === "routine-row-hover") {
    // The whole row lights under the pointer, its switch inside the lit surface (owner, 2026-11-09).
    const row = document.querySelector(".mb-det .mb-routine-row"), toggle = row.querySelector('[role="switch"]');
    const lit = getComputedStyle(row).backgroundColor;
    require(!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(lit), `the row is lit under the pointer (${lit})`);
    const button = row.querySelector(".mb-rt");
    require(/^(transparent|rgba\(0, 0, 0, 0\))$/.test(getComputedStyle(button).backgroundColor), "the words' button draws no surface of its own");
    const r = row.getBoundingClientRect(), s = toggle.getBoundingClientRect();
    require(s.left >= r.left && s.right <= r.right - 2 && s.top >= r.top && s.bottom <= r.bottom, "the switch stands inside the lit row");
    return { check: name };
  }
  if (name === "member-details") {
    const panel = document.querySelector(".mb-det"), title = document.querySelector(".conversation-trigger");
    require(visible(panel), "details panel is visible");
    require(title.getAttribute("aria-expanded") === "true", "title reflects the panel state");
    require(title.getAttribute("aria-controls") === panel.id && !title.hasAttribute("aria-haspopup"), "title controls details without a popup");
    // The › that slides in under the pointer (R-UI-77) points at the panel; a dropdown glyph would promise a menu.
    require([...title.querySelectorAll(".i")].every(icon => icon.closest(".mb-pill-face, .mb-pill-go")), "title has no dropdown glyph outside its member avatar");
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
  if (name === "overlay-emblem-gold" || name === "overlay-emblem-angry") {
    // The rune band, sampled where the letters stand: gold for a report, red while he refuses.
    const canvas = document.querySelector('#emblem'), ctx = canvas.getContext('2d'), side = canvas.width, c = side / 2;
    const R = side / 1.3 / 2, data = ctx.getImageData(0, 0, side, side).data, picked = [];
    for (let a = 0; a < 360; a += 1.5) for (let r = 0.82; r <= 0.98; r += 0.02) {
      const x = Math.round(c + Math.cos(a * Math.PI / 180) * r * R), y = Math.round(c + Math.sin(a * Math.PI / 180) * r * R), i = (y * side + x) * 4;
      if (data[i + 3] > 200) picked.push([data[i], data[i + 1], data[i + 2]]);
    }
    require(picked.length > 120, `the rune band is drawn (${picked.length} opaque samples)`);
    const [r, g, b] = [0, 1, 2].map(k => picked.reduce((sum, p) => sum + p[k], 0) / picked.length);
    if (name === "overlay-emblem-gold") require(r > 200 && g > 120 && b < 110 && r - g < 110, `the runes are vivid gold and orange: rgb(${[r, g, b].map(Math.round)})`);
    else require(r > 180 && g < 110 && b < 110, `the runes are red while he refuses: rgb(${[r, g, b].map(Math.round)})`);
    return { check: name, rgb: [r, g, b].map(Math.round), samples: picked.length };
  }
  if (name === "peer-chat") {
    // The conversation between members: in place of the thread and composer, the pill 「A ⇄ B」,
    // every exchange between those two under faces and coloured names, day dividers, and 「關閉對話」 (R-UI-72).
    const chat = document.querySelector('.mb-chat:not([hidden]) > .peer-chat'), column = chat?.parentElement;
    require(visible(chat), "the line opened the conversation");
    const box = chat.getBoundingClientRect(), whole = column.getBoundingClientRect(), head = column.querySelector('.mb-head').getBoundingClientRect(), composer = column.querySelector('.composer').getBoundingClientRect();
    require(box.top <= head.top + 1 && box.bottom >= composer.bottom && Math.abs(box.left - whole.left) < 1 && Math.abs(box.right - whole.right) < 1, `it covers the member's header, the thread and the composer: ${[box.top, box.bottom, head.top, composer.bottom].map(Math.round)}`);
    require(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.peer-chat') === chat, "nothing of the thread shows through it");
    const raphael = window.__look.data.members.find(member => member.id === 0).name;
    const pill = chat.querySelector('.peer-pill'), pillBox = pill.getBoundingClientRect();
    require(chat.getAttribute('aria-label') === `${raphael} ⇄ 小晴` && pill.textContent === `${raphael}小晴` && visible(pill.querySelector('.peer-swap svg')), "the pill names both sides around ⇄");
    require(pill.querySelectorAll('.av').length === 2, "the pill carries both faces");
    require(Math.abs(pillBox.left + pillBox.width / 2 - box.left - box.width / 2) < 2 && pillBox.top - box.top < 24, "the pill is centred at the top");
    const lines = [...chat.querySelectorAll('.peer-line')];
    require(lines.map(line => line.dataset.peerFrom).join() === "0,1,0,1", `both days of their exchanges, oldest first: ${lines.map(line => line.dataset.peerFrom)}`);
    require(chat.querySelectorAll('.peer-thread > .day').length === 2, "a divider for each day");
    require(!chat.textContent.includes("小森") && !chat.textContent.includes(window.__look.data.peerChatSample.otherRequest), "an exchange with another member is not theirs");
    require(lines.every(line => visible(line.querySelector('.ra-face .av')) && visible(line.querySelector('.peer-who'))), "every message has its speaker's face and name");
    const colour = getComputedStyle(lines[1].querySelector('.peer-who')).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    require(Math.max(...colour) - Math.min(...colour) > 40, `小晴's name is in her colour, not grey: rgb(${colour})`);
    require(visible(lines[3].querySelector('.ans .message-text')) && lines[3].textContent.includes(window.__look.data.peerChatSample.result), "today's answer is readable in a bubble");
    const close = chat.querySelector('.peer-close'), closeBox = close.getBoundingClientRect();
    require(visible(close) && document.activeElement === close, "Close chat is shown and takes the focus");
    require(Math.abs(closeBox.left + closeBox.width / 2 - box.left - box.width / 2) < 2 && box.bottom - closeBox.bottom < 48, "Close chat sits centred where the composer was");
    const scroll = chat.querySelector('.peer-scroll');
    require(scroll.scrollWidth <= scroll.clientWidth + 1 && chat.scrollWidth <= chat.clientWidth + 1, "nothing scrolls sideways");
    return { check: name, lines: lines.length };
  }
  if (name === "peer-chat-closed") {
    const line = document.querySelector('[data-handoff="61"]');
    require(!document.querySelector('.peer-chat') && !document.querySelector('.mb-chat[data-peer-open]'), "Close chat removes the conversation");
    require(visible(document.querySelector('.mb-chat:not([hidden]) .composer')) && document.activeElement === line, "the thread, its composer and the focus on the line come back");
    return { check: name };
  }
  if (name === "bot-ask-centred" || name === "bot-ask-expanded") {
    const event = document.querySelector('[data-handoff="x71"]');
    const [line] = eventLines(1);
    require(line.textContent === "與 小晴 的 2 則訊息", `the asker's line names the colleague and counts the messages: ${line.textContent}`);
    require(visible(line.querySelector('.av')) && !event.closest('.chat-message'), "one faced line outside the messages");
    const chat = document.querySelector('.mb-chat > .peer-chat');
    if (name === "bot-ask-expanded") {
      const said = [...chat.querySelectorAll('.peer-line .message-text')].map(text => text.textContent);
      require(visible(chat) && said[0]?.includes("下週上市的新品代號是多少？"), "it opens on the question that was sent");
      require(said[1]?.includes("NX-2026"), "and on the answer that came back");
      require(!/#\d|x71/.test(chat.textContent), "no internal ids");
    } else require(!chat, "the conversation opens only from the line");
    return { check: name, open: !!chat };
  }
  if (name === "bot-message-from" || name === "bot-exchange-count" || name === "bot-exchange-expanded") {
    // What a colleague handed over: one centred line 「與 小森 的 N 則訊息」 where the owner's words would be, the
    // same line the asker's side shows; it opens the two members' conversation, never a box under it.
    // Two exchanges with the same colleague in a row are that one line, its count covering both.
    const lines = [...document.querySelectorAll('.exchange-event')].filter(visible);
    require(lines.length === 1, `the colleague's two exchanges are one line (${lines.length})`);
    const event = lines[0], words = event.textContent.trim();
    require(event.matches('button[data-act="peer-chat"]'), "the line is a button that opens their conversation");
    require(/^與 小森 的 \d+ 則訊息/.test(words), `the line names the colleague and counts the messages: ${words}`);
    require(visible(event.querySelector('.av')), "the line carries the asker's face");
    require(document.querySelector('.tn[data-id="2"]').getBoundingClientRect().bottom <= event.getBoundingClientRect().top, "it sits where it came, after the member's own earlier turn");
    require(!document.querySelector('.tn[data-id="71"] .me'), "a colleague's request is never an owner bubble");
    const chat = document.querySelector('.mb-chat:not([hidden]) > .peer-chat');
    if (name === "bot-exchange-expanded") require(visible(chat) && [...chat.querySelectorAll('.peer-line')].filter(visible).length >= 1, "it opens the conversation on what was asked");
    else require(!chat, "the conversation opens only from the line");
    return { check: name, words };
  }
  if (name === "plugins-store-needs") {
    // A row is as plain as Grok Bot's: the mark, the name, 連結. What an app asks for is on its page (R-APPS-02), and no 連結 is dead.
    for (const slug of ["acme-ledger", "parcel-desk", "orbit-ads"]) {
      const open = document.querySelector(`[data-conn="open-store"][data-id="${slug}"]`);
      require(open, `${slug} is in the view`);
      require(!open.querySelector('.sub, .need') && !/API 金鑰|開發者/.test(open.closest('.cs-card').textContent), `${slug}'s row says nothing of what it asks`);
      const join = open.closest('.cs-card').querySelector('[data-conn="join"]');
      require(join && !join.disabled && !join.hasAttribute('title'), `${slug}'s 連結 is a live button with nothing hidden in a hover title`);
    }
    const dead = [...document.querySelectorAll('.cs-card [data-conn="join"]')].filter(button => button.disabled);
    require(dead.length === 0, `no 連結 in the view is disabled (${dead.length})`);
    return { check: name, rows: 3 };
  }
  if (name === "plugins-store-needs-page") {
    const line = document.querySelector('.cs-page .cs-needs'), join = document.querySelector('.cs-page [data-conn="join"]');
    require(visible(line) && line.textContent.includes("API 金鑰") && line.textContent.includes("Acme Ledger"), `the page says what the app needs (${line?.textContent})`);
    const way = [...document.querySelectorAll('.cs-page .cs-info-row')].find(row => row.querySelector('.k').textContent === '登入方式');
    require(way?.querySelector('.v').textContent === 'API 金鑰', "its 登入方式 row says API 金鑰");
    require(join && !join.disabled && join.textContent.includes("連結"), "連結 on the page is live");
    return { check: name, words: line.textContent };
  }
  if (name === "setup-added") {
    const key = "zk-look-0123456789", calls = window.__look.calls;
    require(!document.querySelector('.cn-setup-dialog'), "the form closed once the app was added");
    const sent = calls.filter(call => call.method === "connectors.connect");
    require(sent.length === 1 && sent[0].params.fields.generic_api_key === key && sent[0].params.toolkit === "acme-ledger", "the key crossed one call, connectors.connect, and no other");
    require(!JSON.stringify(calls.filter(call => call.method !== "connectors.connect")).includes(key) && !document.body.textContent.includes(key), "the key is on no page text and in no other call");
    require(visible(document.querySelector('.cs-card:has([data-conn="open-store"][data-id="acme-ledger"]) .cs-state')), "the app is connected: its row says so");
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
      require(dialog.querySelector('.cn-lead').textContent.includes("API 金鑰") && dialog.querySelector('.cn-keep').textContent.includes("Composio"), "it says what is needed and that Composio keeps it");
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
      require(dialog.querySelector('.cn-lead').textContent.includes("開發者應用程式") && dialog.querySelector('.cn-keep').textContent.includes("Client ID"), "it says the service needs the owner's own developer app");
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
      const footer = action.filter(button => button.closest('footer')), close = card.querySelector('.card-head [data-card-failed-close]');
      require(footer.length === 1 && footer[0].dataset.act === "card-settings" && footer[0].textContent.trim() === "開啟連接設定", "the card offers the place to add it");
      require(visible(close) && !close.textContent.trim(), "a local close is the × at its top right, with no 「關閉」 under it");
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
  if (name.startsWith("connector-cause-")) {
    // A card that did not connect says why in its own sentence, never only 「沒有連上」, and offers a retry only where it can help.
    const kind = name.split("-")[2], card = [...document.querySelectorAll('.connector-card')].find(visible);
    require(card && card.dataset.cardState === "failed", "the card failed");
    require(card.getBoundingClientRect().width <= 481 && card.scrollWidth <= card.clientWidth + 1, "the card fits its column");
    const footer = [...card.querySelectorAll('footer button')].filter(visible), sentence = card.querySelector('.cc-state')?.textContent.trim() ?? "";
    const words = { busy: "另一個連線還在進行", refused: "服務拒絕了這次連線：This project may not add Gmail", unknown: "無法判斷為什麼沒有連上" }[kind];
    require(sentence.includes(words), `the card says the cause (${sentence})`);
    require(sentence !== "沒有連上" && !/[{}]|Traceback|[a-z]+_[a-z]+/.test(sentence), "no bare failure, JSON, trace or machine word on the card's face");
    if (kind === "refused") require(footer.length === 0, "no retry where pressing again cannot help");
    else require(footer.length === 1 && footer[0].dataset.act === "card-connect" && footer[0].textContent.trim() === "再試一次", "one retry");
    require(visible(card.querySelector('.card-head [data-card-failed-close]')), "a failed card is put away with the ×");
    if (kind === "unknown") {
      const fold = card.querySelector('.card-disclosure'), detail = fold?.querySelector('.card-detail');
      require(fold && fold.textContent.includes("詳細資料") && detail, "the short reason is folded under 詳細資料");
      if (name.endsWith("-open")) require(!detail.hidden && visible(detail) && detail.textContent.trim() === "protocol · HTTP 502", "opened, it shows the short technical reason");
      else require(detail.hidden && !card.querySelector('.cc-state').textContent.includes("HTTP"), "closed, the card's face has no technical reason");
    }
    return { check: name, sentence };
  }
  if (name.startsWith("connector-google-")) {
    // The owner's own Google, at each step of its card: steps and text to copy, the two fields, the one button, the account.
    const step = name.slice("connector-google-".length), secret = "zk-look-0123456789", calls = window.__look.calls;
    const card = document.querySelector('[data-connector="card-google"]');
    require(visible(card) && card.classList.contains("connector-card"), "the Google card is visible");
    require(card.getBoundingClientRect().width <= 481 && card.scrollWidth <= card.clientWidth + 1, "the card fits its column");
    const state = card.querySelector('.cc-state')?.textContent.trim() ?? "", footer = [...card.querySelectorAll('footer button')].filter(visible);
    const sent = calls.filter(call => call.method === "integrations.card_connect");
    require(!document.body.textContent.includes(secret), "the secret is on no page text");
    require(!JSON.stringify(calls.filter(call => call.method !== "integrations.card_connect")).includes(secret), "no call but the card's own carries the secret");
    const fields = [...card.querySelectorAll('[data-setup-field]')], id = fields.find(field => field.dataset.setupField === "client_id"), key = fields.find(field => field.dataset.setupField === "client_secret");
    if (["steps", "filled"].includes(step)) {
      require(id?.type === "text" && key?.type === "password", "the Client ID is plain and the Client secret masked");
      const steps = [...card.querySelectorAll('.cn-steps li')], detail = card.querySelector('.card-detail');
      require(steps.length === 5 && steps.every(visible) && !detail.hidden, "five numbered steps, open");
      const copies = [...card.querySelectorAll('[data-dlg="copy"]')].filter(visible);
      require(copies.length === 2 && copies[0].dataset.copy.includes("auth/gmail.modify") && copies[0].dataset.copy.includes("auth/calendar.events") && copies[1].dataset.copy === "http://127.0.0.1", "the scopes and the return address are text to copy");
      const scopes = card.querySelector('textarea[readonly]');
      require(visible(scopes) && scopes.scrollHeight <= scopes.clientHeight + 1 && scopes.value.split("\n").length === 2, "the scopes show whole, with no inner scrollbar");
      require(visible(card.querySelector('input[readonly][value="http://127.0.0.1"]')), "the return address shows");
      const submit = card.querySelector('[data-inline-submit]');
      require(visible(submit) && submit.textContent.trim() === "連接 Google" && submit.classList.contains("pri"), "one primary button: 連接 Google");
      require(visible(card.querySelector('.card-shield')), "storage is explained");
      require(sent.length === 0, "nothing was sent before 連接 Google");
    }
    if (step === "steps") require(id.value === "" && key.value === "" && state.includes("不經過 Composio") && footer.length === 0, "empty fields and the lead; the button is in the form");
    if (step === "filled") require(id.value === "look-client-id.apps.googleusercontent.com" && key.value === secret, "both are typed, the secret masked");
    if (step === "authorizing") {
      require(card.dataset.cardState === "authorizing" && state.includes("等你在瀏覽器登入"), `the card waits for the browser (${state})`);
      require(sent.length === 1 && sent[0].params.id === "card-google" && sent[0].params.fields.client_secret === secret && sent[0].params.fields.client_id === "look-client-id.apps.googleusercontent.com", "both crossed the one call, integrations.card_connect");
      require(fields.length === 0 && footer.length === 1 && footer[0].dataset.act === "card-cancel", "the form is gone and Cancel is the one action");
    }
    if (step === "connected") {
      require(card.dataset.cardState === "connected" && state === "已連結 · owner@example.test · 7 個工具", `which account, and the tools (${state})`);
      require(sent.length === 1 && fields.length === 0, "one call, and no form is left");
    }
    if (step === "kept") {
      require(card.dataset.cardState === "failed" && state.includes("你拒絕了授權"), `the cause is said (${state})`);
      require(fields.length === 0 && footer.length === 1 && footer[0].dataset.act === "card-connect" && footer[0].textContent.trim() === "連接 Google", "no fields, and one button signs in again");
    }
    if (step === "rejected") {
      require(card.dataset.cardState === "failed" && state.includes("Google 沒有接受這組 Client ID 或 Client secret"), `the cause is said (${state})`);
      require(fields.length === 2 && id.value === "" && key.value === "" && footer.length === 0, "both fields are asked for again, empty");
    }
    return { check: name, state };
  }
  if (name === "connector-server-sent") {
    // An app on the owner's own server (n8n): its address and token leave in the card's one call (connection-setup.ts).
    const token = "zk-look-0123456789", card = document.querySelector('[data-connector="card-n8n"]');
    const sent = window.__look.calls.filter(call => call.method === "integrations.card_connect");
    require(card?.dataset.cardState === "connected", "the card follows the core to connected");
    require(sent.length === 1 && sent[0].params.id === "card-n8n" && sent[0].params.fields.url === "https://flows.example.test/mcp-server/http" && sent[0].params.fields.token === token,
      "the address and the token cross one call, integrations.card_connect");
    require(!JSON.stringify(window.__look.calls.filter(call => call.method !== "integrations.card_connect")).includes(token), "no other call carries the token");
    require(!document.body.textContent.includes(token) && !(document.querySelector('.composer textarea')?.value ?? "").includes(token), "the token is on no page text and was not typed into the chat");
    return { check: name };
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
    // An app the catalog has no logo for draws the generic plug, never another brand's mark (R-UI-28).
    require(visible(mark) && mark.querySelector('svg.logo path, img.logo, svg.i'), "R-UI-34: the app's own catalog or bundled mark, or the generic plug");
    if (name === 'connector-key' || name === 'connector-app') require(!mark.querySelector('img.logo'), "an app without a catalog logo draws the generic plug");
    // Since 2026-11-08 a known app draws its bundled mark first (service-mark.ts entryIcon); either is Slack's own.
    if (name.startsWith('connector-slack')) require(mark.querySelector('svg.logo path') || mark.querySelector('img.logo')?.getAttribute('src') === window.__look.data.pluginCatalog.find(app => app.slug === 'slack').logo, "the card shows Slack's own mark: the bundled drawing or exactly the store's catalog logo");
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
      "connector-key": ["pending", "需要你的 API 金鑰", "填入金鑰", true],
      "connector-app": ["pending", "需要你自己的開發者應用程式", "設定開發者應用程式", true],
      "connector-server": ["pending", "需要自己的伺服器", "填入金鑰", true],
      "connector-reconnected": ["connected", "已重新連結 · 2 個工具", null, false],
    }[name];
    require(expected, `no expectation for ${name}`);
    const [state, words, action, primary] = expected;
    if (!words) require(status?.textContent.trim(), "a pending card explains why connecting helps");
    require(card.dataset.cardState === state && (!words || said === words), `${app}'s card reads "${words}" (${card.dataset.cardState}: "${said}")`);
    const connectButton = card.querySelector('[data-act="card-connect"],[data-act="card-cancel"]');
    if (action === null) require(card.querySelector('.card-actions button:disabled'), 'connected card keeps its checked disabled button');
    else if (['connector-key','connector-app','connector-server'].includes(name)) require(card.querySelector('[data-inline-setup]'), 'setup fields belong to the card');
    else require(connectButton?.textContent.trim() === action && connectButton.classList.contains('pri') === primary, 'the connection action matches the state');
    if (name === "connector-server") {
      const fields = [...card.querySelectorAll('[data-setup-field]')];
      require(fields.map(field => field.dataset.setupField).join() === "url,token" && fields[0].type === "text" && fields[1].type === "password", "the address is plain and the token is masked, both in the card");
      require(visible(card.querySelector('[data-inline-submit]')) && !document.querySelector('.cn-setup-dialog'), "one save inside the card and no modal");
    }
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
      // The × in its heading puts the failed card away (R-UI-117); it is no action of the card's, so it is not counted.
      const actions = buttons.filter(button => !button.closest('.card-head'));
      require(!card.querySelector('input') && actions.some(button => button.dataset.act === "card-resume" && button.textContent.trim() === "再試一次") && actions[0].classList.contains('pri'), "no field is asked again: one primary 再試一次");
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
    // The preference to write mail as a draft first is a switch row of the member settings page.
    const toggle = document.querySelector('.ms-pane [data-ms="draft"]');
    require(visible(toggle) && toggle.getAttribute('role') === 'switch' && toggle.classList.contains('tg'), "the draft preference is a real switch");
    require(toggle.getAttribute('aria-checked') === 'false', "this member was set to send mail itself, so the switch is off");
    const row = toggle.closest('.ms-row');
    // Slack drafts follow the same rule as mail since 1.2.
    require(row.querySelector('.ms-label').textContent === "郵件與 Slack 先擬成草稿，由我傳送", `the switch says what it does: ${row.querySelector('.ms-label').textContent}`);
    require(row.querySelector('p, small') === null, "one line, no hint paragraph under it");
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
  if (name.startsWith("press-through-scrim-")) {
    // A press on a dialog's scrim closes that dialog and is spent: what lies behind it is not pressed, focused or opened.
    return (async () => {
      // On a window narrower than 860 px the sidebar is a rail under the dialog and the scene has nothing outside the dialog to press: its step is left out.
      if ((name === "press-through-scrim-settings" || name === "press-through-scrim-connect-apps") && matchMedia("(max-width: 859px)").matches) return { check: name, skipped: "narrow" };
      await new Promise(resolve => setTimeout(resolve, 450));
      const behind = document.querySelector('.mb-col [data-member="1"]');
      const current = document.querySelector('.mb-col [data-member][aria-current="true"]')?.dataset.member;
      if (name !== "press-through-scrim-model-chooser") {
        require(current === '0', `the member behind the scrim was not opened: the open one is ${current}`);
        require(!behind || (document.activeElement !== behind && !behind.contains(document.activeElement)), "the member behind the scrim did not take the focus");
        require(!document.querySelector('.modal-scrim:not([hidden]), .cr-dialog, .mb-dialog, .cs-scrim'), "the dialog closed with the press");
        require(!document.querySelector('#app-popover'), "the control behind the scrim did not open its menu or card");
      }
      if (name === "press-through-scrim-delete") require(window.__look.data.members.some(row => row.id === 2) && document.querySelector('.mb-col [data-member="2"]'), "nothing was deleted");
      if (name === "press-through-scrim-member-maker") require(!window.__look.calls.some(call => /^members\.(create|add)/.test(call.method ?? "")), "nobody was made");
      if (name === "press-through-scrim-model-chooser") {
        require(!document.querySelector('.model-chooser'), "the chooser closed with the press");
        require(document.querySelector('.modal-scrim:not([hidden])') && document.querySelector('.modal-scrim [data-pane="models"][aria-current="page"]'), "Settings stayed open on its own tab: the tab behind the scrim was not pressed");
      }
      return { check: name };
    })();
  }
  if (name.startsWith("press-through-")) {
    // R-UI-121 (owner, 2026-11-11): one press closes what was open AND acts on what was pressed. The scene pressed once; what the
    // press did must already be true, so this waits only for the page to draw it (and never presses again).
    const leftOpen = () => document.querySelector('#app-popover, .mb-avpop, .cb-menu, .mb-scrim, .cs-scrim, .modal-scrim:not([hidden])');
    const currentMember = () => document.querySelector('.mb-col [data-member][aria-current="true"]')?.dataset.member;
    const rows = window.__look.data.members;
    const until = async (ready, what) => {
      const end = performance.now() + 3000;
      while (!ready()) {
        if (performance.now() > end) throw new Error(`${name}: ${what}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    const opened = async (id) => {
      await until(() => currentMember() === String(id), `the press on member ${id} did not open that member (the open one is ${currentMember()})`);
      const named = rows.find(row => row.id === id)?.name;
      await until(() => document.querySelector('.mb-pill-t')?.textContent === named, `the conversation shows ${document.querySelector('.mb-pill-t')?.textContent}, not ${named}`);
      require(!leftOpen(), `what was open went with the same press (${leftOpen()?.className})`);
    };
    return (async () => {
      if (name === "press-through-avatar-picker") await opened(2);
      else if (name === "press-through-row-menu") await opened(1);
      else if (name === "press-through-right-click") {
        await until(() => document.querySelector('#app-popover'), "the right click on the other row left no menu");
        require(document.querySelectorAll('#app-popover').length === 1, "one menu is open, not two");
        require(document.querySelector('.mb-col [data-member-more="1"][aria-expanded="true"]') && !document.querySelector('.mb-col [data-member-more="2"][aria-expanded="true"]'),
          "the open menu is the pressed row's, and the first row's menu is gone");
      } else if (name === "press-through-page-frame") {
        // The page is another document, so the app sees no pointer event of the press: it knows only that the focus went into the frame.
        await until(() => !document.querySelector('.cb-menu, #app-popover'), "the press inside the page left the model card open");
        const frame = document.querySelector('.pgv-frame-box iframe:not([inert])');
        require(frame && document.activeElement === frame, "the page is still open and has the press");
        require(document.querySelector('.composer .cmp-model .mp-trigger')?.getAttribute('aria-expanded') !== "true", "the model button no longer says its card is open");
      } else if (name === "press-through-model-menu") {
        await until(() => document.querySelector('.conversation-trigger[aria-expanded="true"]') && document.querySelector('.mb-det:not([hidden])'), "the press on the header button did not open the details");
        require(!document.querySelector('.cb-menu, #app-popover'), "the model menu went with the same press");
      } else throw new Error(`no expectation for ${name}`);
      return { check: name };
    })();
  }
  if (name.startsWith("opener-toggle-")) {
    // R-UI-124 (owner, 2026-11-11): the control that opened a thing is its toggle. The scene opened it once, then pressed that
    // control again with the real mouse (`press-opener`); the thing must be closed and have been opened exactly once, counted as it happened.
    const until = async (ready, what) => {
      const end = performance.now() + 3000;
      while (!ready()) {
        if (performance.now() > end) throw new Error(`${name}: ${what}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 700));
    if (["opener-toggle-row-menu", "opener-toggle-row-again", "opener-toggle-keyboard"].includes(name)) return (async () => {
      const watch = window.__look.watch, menus = () => document.querySelectorAll("#app-popover");
      require(watch, "the scene watched nothing");
      if (name === "opener-toggle-row-menu") {
        // A left press on the row whose right click opened the menu: the row is not the menu's opener, so the press goes through (R-UI-121).
        await until(() => document.querySelector('.mb-col [data-member][aria-current="true"]')?.dataset.member === "2", "the left press on the same row did not open that member");
        await settle();
        require(!menus().length, "the menu is still open after the press on its row");
        require(watch.opens === 1, `the menu was opened ${watch.opens} times`);
      } else if (name === "opener-toggle-row-again") {
        // A right click is not a close gesture: on the same row it takes the menu to the new point, one menu, opened twice.
        await until(() => watch.opens === 2, `a second right click on the row left ${watch.opens} openings`);
        await settle();
        require(menus().length === 1 && document.querySelector('.mb-col [data-member-more="2"][aria-expanded="true"]'), "one menu is open, the row's");
        require(watch.opens === 2, `the menu was opened ${watch.opens} times`);
      } else {
        require(watch.opens === 2, `Enter opened it once and Space once (${watch.opens} openings): the presses on the open menu's opener only close it`);
        await settle();
        require(!menus().length && document.querySelector('#nav [data-col="add"][aria-expanded="false"]'), "the menu is closed and stays closed");
        require(document.activeElement === document.querySelector('#nav [data-col="add"]'), "the focus is on the opener");
      }
      return { check: name, opens: watch.opens };
    })();
    return (async () => {
      const watch = window.__look.watch, pressed = window.__look.pressedOpener;
      require(watch && pressed, "the scene watched nothing or pressed nothing");
      const open = () => document.querySelector(watch.gone);
      if (!pressed.pressed) {
        // Only a layout may keep the control out of reach (a drawer that closed behind the first press): never a wide window.
        require(innerWidth < 860, `the opener could not be pressed in a wide window: ${pressed.reason}`);
        require(open() && watch.opens === 1, "an opener that cannot be reached leaves the thing open once");
        return { check: name, skipped: pressed.reason, width: innerWidth };
      }
      require(!watch.over || (watch.over === "scrim") === pressed.overScrim, `the press ${pressed.overScrim ? "landed on a scrim" : "landed on the control itself"}, the scene meant ${watch.over}`);
      const end = performance.now() + 3000;
      while (open()) {
        if (performance.now() > end) throw new Error(`${name}: the second press on the opener left it open (${watch.gone}), pressed at ${pressed.hit}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Closed is not enough: a close that is followed by an opening is the loop. Wait past a fade and a late redraw.
      await new Promise(resolve => setTimeout(resolve, 700));
      require(!open(), `it closed and opened again (${watch.gone})`);
      require(watch.opens === 1, `it was opened ${watch.opens} times, once by the first press and not again by the second`);
      return { check: name, opens: watch.opens, pressedAt: pressed.hit, overScrim: pressed.overScrim, width: innerWidth };
    })();
  }
  if (name === "message-edit-open" || name === "message-edit-armed" || name === "message-edit-sent") {
    // R-UI-148: the owner's message is edited in its own place; the composer is not touched and what is sent is the composer's own edit.
    const turn = document.querySelector('.tn[data-id="8201"]'), composerField = document.querySelector('.cmp-input');
    require(composerField && composerField.value === '', 'the composer keeps its own (empty) draft: nothing of the message went into it');
    if (name === "message-edit-sent") {
      const words = "改過的說法：請整理這份範例研究摘要，並列出三個重點。";
      const asks = window.__look.calls.filter(call => call.command === 'agent_ask_text');
      require(asks.length === 1 && asks[0].replaceTurnId === 8201 && asks[0].text === words && asks[0].memberId === 1, 'Enter asks once, with the edited words and the message it replaces, as the composer\'s edit did');
      require(!document.querySelector('[data-edit-input], .msg-editor') && !document.querySelector('.tn[data-id="8201"]'), 'the editor is gone with the message it replaced');
      const bubbles = [...document.querySelectorAll('.thread .owner-message .bubble')];
      require(bubbles.length === 1 && bubbles[0].querySelector('.message-text').textContent.trim() === words && visible(bubbles[0]), 'the edited message stands in its bubble, once');
      require(!document.querySelector('.tn.is-pending'), 'nothing is left waiting beside it');
      return { check: name, bubble: Math.round(bubbles[0].getBoundingClientRect().width) };
    }
    const field = turn.querySelector('[data-edit-input]'), box = turn.querySelector('.msg-editor'), me = turn.querySelector('.me');
    require(visible(field) && visible(box), 'the bubble is an editor');
    require(document.activeElement === field && (name === "message-edit-armed" || field.selectionStart === field.value.length && field.selectionEnd === field.value.length), 'the field has the focus, the caret after its words');
    require(!turn.querySelector('.owner-message .bubble') && !turn.querySelector('.owner-message .message-actions'), 'the editor takes the bubble\'s place: no bubble and no actions beside it');
    const b = box.getBoundingClientRect(), m = me.getBoundingClientRect();
    require(Math.abs(b.right - m.right) <= 1, `the editor ends where the bubble ended (${Math.round(b.right)} vs ${Math.round(m.right)})`);
    require(b.width <= m.width && b.width >= Math.min(m.width * .6, 300), `the editor is as wide as the bubble's column (${Math.round(b.width)} of ${Math.round(m.width)})`);
    require(field.scrollWidth <= field.clientWidth + 1 && field.scrollHeight <= field.clientHeight + 1, 'all of the words are in view');
    const buttons = [...box.querySelectorAll('.msg-editor-actions .btn')].filter(visible);
    require(buttons.length === 2 && buttons[1].classList.contains('pri') && !buttons[1].disabled, 'Cancel and, last, the primary Send, ready');
    const [cancel, send] = buttons.map(button => button.getBoundingClientRect());
    require(cancel.right <= send.left && Math.abs(cancel.height - send.height) < .5 && Math.abs(send.height - 30) < .5, `Cancel and Send are the thread cards' buttons: 30 px (${Math.round(cancel.height)} px high)`);
    const pad = parseFloat(getComputedStyle(box).paddingRight);
    require(Math.abs(send.right - (b.right - 1 - pad)) <= 1.5, 'Send stands at the right edge of the editor');
    require(!document.querySelector('.tn.is-pending'), 'nothing was sent');
    if (name === "message-edit-armed") {
      const armed = buttons[0];
      require(armed.dataset.cancelArmed === 'true' && armed.dataset.cancelHint && document.activeElement === field && field.isConnected, 'the first Escape arms Cancel with its hint and leaves the editor open');
    } else {
      require(!buttons[0].dataset.cancelArmed, 'Cancel is not armed');
    }
    return { check: name, editor: Math.round(b.width), height: Math.round(b.height), words: field.value.length };
  }
  throw new Error(`Unknown rendered check: ${name}`);
}

/**
 * Browser assertions run inside a page frame (the `frame-check` step): a member's HTML page is another origin, so the app's own checks
 * cannot read it. Self-contained, as `checkRendered` is: it is sent to the frame as text.
 */
export function checkFrame(name) {
  const require = (condition, message) => { if (!condition) throw new Error(`${name}: ${message}`); };
  const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  // The words of the theme the page is given (core agent/pages.py THEME), as colours.
  const words = dark ? { bg: "rgb(10, 10, 10)", fg: "rgb(245, 245, 245)", surface: "rgb(22, 22, 22)", muted: "rgb(153, 153, 153)", link: "rgb(122, 174, 245)", line: "rgb(38, 38, 38)" }
    : { bg: "rgb(255, 255, 255)", fg: "rgb(10, 10, 10)", surface: "rgb(247, 247, 247)", muted: "rgb(89, 89, 89)", link: "rgb(31, 99, 209)", line: "rgb(235, 235, 235)" };
  if (name === "page-base") {
    // An HTML page that writes no style of its own is drawn by the app's base style (core agent/page_style.py, R-PAGE-06): the owner's
    // Grok Bot page, in type, table, note, contents box, tabs, cards and figures; and its one rule of its own (h3) wins over it.
    const body = style("body");
    require(body.backgroundColor === words.bg && body.color === words.fg, `the theme's page: ${body.color} on ${body.backgroundColor}`);
    require(body.lineHeight === "24px" && body.fontSize === "15px", `readable type, 15 px on 1.6: ${body.fontSize} / ${body.lineHeight}`);
    require(style("h1").fontSize === "32px" && style("h1").fontWeight === "600" && style("h2").fontSize === "22px", `a 32 px title and 22 px sections: ${style("h1").fontSize}, ${style("h2").fontSize}`);
    require(style("h3").fontSize === "19px", `the page's own rule wins over the base's 17 px: ${style("h3").fontSize}`);
    require(style("p").maxWidth === "660px", `a line stays readable: ${style("p").maxWidth}`);
    require(document.documentElement.getBoundingClientRect().width <= 1120.5 && document.documentElement.scrollWidth <= innerWidth + 1, "a sensible width, nothing runs out sideways");
    const table = style("table"), head = style("th"), cell = style("td");
    require(table.borderTopWidth === "1px" && table.borderTopColor === words.line && table.borderTopLeftRadius === "12px", "a table with a hairline outline and round corners");
    require(head.backgroundColor === words.surface && head.fontWeight === "600" && cell.borderBottomWidth === "1px", "a header row on the surface, hairlines between rows");
    const narrow = innerWidth <= 720;
    require(table.display === (narrow ? "block" : "table") && (!narrow || table.overflowX === "auto"), `${narrow ? "scrolls inside itself" : "fills the page"} at ${innerWidth} px: ${table.display}`);
    const numbers = [...document.querySelectorAll(".num")];
    require(numbers.length === 12 && numbers.every(item => ["right", "end"].includes(getComputedStyle(item).textAlign)), "figures marked num are set at the right, head and cells");
    require(style("td.num").fontVariantNumeric.includes("tabular-nums"), "figures line up");
    require(style("td a").color === words.link && style("td a").textDecorationLine === "underline", "links are the theme's blue");
    const info = style(".callout.info");
    require(info.borderTopLeftRadius === "12px" && info.backgroundColor !== "rgba(0, 0, 0, 0)" && info.backgroundColor !== words.surface, `a note on a tint: ${info.backgroundColor}`);
    require(style(".callout.info strong").color === words.link && style(".callout.info", "::before").content === '"i"' && style(".callout.warn", "::before").content === '"!"', "info's mark is an i in the link's blue and warn's a !");
    require(style(".callout.warn", "::before").color !== style(".callout.info", "::before").color, "warn is not info's colour");
    const toc = style(".toc"), items = [...document.querySelectorAll(".toc li a")];
    require(toc.borderTopWidth === "1px" && toc.borderTopLeftRadius === "12px" && items.length === 3 && items.every(link => getComputedStyle(link).fontWeight === "600"), "a boxed 「本頁內容」 list");
    require(items.every((link, index) => index === 0 || link.getBoundingClientRect().top > items[index - 1].getBoundingClientRect().bottom - 2), "its entries are one under another");
    const on = style(".chips .on"), other = style(".chips button:not(.on)");
    require(style(".chips").display === "flex" && on.fontWeight === "600" && on.borderBottomColor === words.fg && other.color === words.muted && other.backgroundColor === "rgba(0, 0, 0, 0)", "tabs: the chosen word bold and underlined, the others quiet and flat");
    const cards = style(".cards"), tracks = cards.gridTemplateColumns.split(" ").length, room = document.querySelector(".cards").getBoundingClientRect().width;
    require(cards.display === "grid" && tracks === Math.max(1, Math.min(3, Math.floor((room + 16) / 256))) && style(".cards > div").backgroundColor === words.surface, `cards in a grid that fills the width: ${tracks} columns in ${Math.round(room)} px`);
    require(style(".kpis b").fontSize === "28px" && style(".kpis").display === "grid", "figures in tiles of large numbers");
    require(style("blockquote").borderInlineStartWidth === "3px" && style("code").backgroundColor === words.surface, "a quote with its rule, code on the surface");
    return { check: name, dark, width: innerWidth, table: table.display, tracks };
  }
  throw new Error(`Unknown frame check: ${name}`);
}
