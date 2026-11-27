// Self-contained so the same checks run in Chromium and in the DOM contract tests.
// `latinAllowed` (lower-case words, names or syntax) enables the Chinese window's language check: any other
// Latin word in visible text, a placeholder, an aria-label or a title is interface copy left in English.
// `overflowOrphans` is the runner's list (it asks the page's context-menu.ts) of the ⋯ buttons that no row of the app's table
// reaches with a right click: each is a violation of R-UI-44.
export function auditDocument(doc = document, viewport = { width: innerWidth, height: innerHeight }, namespaces = [], latinAllowed = null, englishUI = [], overflowOrphans = []) {
  const win = doc.defaultView;
  // An icon button has no words, so its accessible name says which one a finding means.
  const describe = element => ({ tag: element.tagName.toLowerCase(), id: element.id, class: typeof element.className === "string" ? element.className : "", text: element.textContent?.trim().slice(0, 100), ...(element.getAttribute?.("aria-label") ? { label: element.getAttribute("aria-label") } : {}) });
  const visible = element => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
      if (parent.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return true;
  };
  // Content outside a scrollport is intentionally offscreen. Inspect its container instead. A document that scrolls as a
  // whole (a report saved as a file) is its own scrollport up and down; the app's body never scrolls, so nothing changes there.
  const root = doc.scrollingElement ?? doc.documentElement;
  const bodyStyle = win.getComputedStyle(doc.body);
  const pageScrolls = !/hidden|clip/.test(bodyStyle.overflowY || bodyStyle.overflow) && root.scrollHeight > root.clientHeight + 1;
  const clipped = element => {
    const box = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent), rect = parent.getBoundingClientRect();
      const x = /auto|scroll|hidden|clip/.test(style.overflowX || style.overflow);
      const y = /auto|scroll|hidden|clip/.test(style.overflowY || style.overflow);
      if ((x && (box.left < rect.left - 1 || box.right > rect.right + 1)) || (y && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1))) return true;
    }
    return pageScrolls && (box.top < -1 || box.bottom > viewport.height + 1);
  };
  const onScreen = element => {
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(viewport.width, box.right), bottom = Math.min(viewport.height, box.bottom);
    for (let parent = element.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX || style.overflow)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (/auto|scroll|hidden|clip/.test(style.overflowY || style.overflow)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
    return right > left && bottom > top;
  };
  // The part of an element a person can see: clipped by the window and by every scrollport or clip above it.
  const shownRect = element => {
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(viewport.width, box.right), bottom = Math.min(viewport.height, box.bottom);
    for (let parent = element.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX || style.overflow)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (/auto|scroll|hidden|clip/.test(style.overflowY || style.overflow)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
    return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
  };
  const PRESSABLE = 'button, a[href], input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]';
  const NEVER_COVERED_EXEMPT = '.window-resize';
  // A layer is fixed to the window, or is positioned with a z-index of its own (the compact drawer over the conversation): it is
  // drawn over the page on purpose, and so is the dim that goes with it.
  const fixedLayer = node => {
    for (let n = node; n && n !== doc.body; n = n.parentElement) {
      const style = win.getComputedStyle(n);
      if (style.position === 'fixed' || (style.position === 'absolute' && /^[1-9]\d*$/.test(style.zIndex)) || /(?:^|[\s-])scrim(?:$|[\s-])/.test(typeof n.className === 'string' ? n.className : '')) return n;
    }
    return null;
  };
  // What stands over the point (x, y) of a control that is not the control, a part of it or the label around it, and is not a layer fixed to the window
  // that does not itself hold the control.
  const coverOf = (element, x, y) => {
    const top = doc.elementFromPoint?.(x, y);
    if (!top || top === element || element.contains(top) || top.contains(element)) return null;
    if ([...(element.labels ?? [])].some(label => label === top || label.contains(top))) return null;
    // R-TOP-01: a pane's top row (the conversation header on the window's own row, a panel's, a side thread's) stands over what
    // scrolls under it and fades there. What has scrolled under the row is covered on purpose; a control of the row itself is not.
    const row = top.closest?.('[data-window-drag]');
    if (row && !row.contains(element)) return null;
    // R-PAGE-11: an open page runs under the composer, which floats over it at the window's foot; the page scrolls its last line clear
    // above it. What has scrolled under the composer's row is covered on purpose, as under the top row; a control of the row itself is not.
    const foot = top.closest?.('.ra-stage.is-page > .ra-dock');
    if (foot && !foot.contains(element)) return null;
    // R-UI-182: a long Settings page scrolls under its header (the way back, the title, the close), which stays at the top. What has
    // scrolled under that header is covered on purpose; a control of the header itself is not.
    const head = top.closest?.('.modal-scrim .modal-body :is(.set-content > .set-head, .cs > .cs-top, .cs-page > .cs-head, .skl-page > .skl-pack, .skl-page > .set-head, .vault-page > .set-head)');
    if (head && !head.contains(element)) return null;
    const layer = fixedLayer(top);
    return layer && !layer.contains(element) ? null : top;
  };
  // R-UI-56: what clears, deletes or removes waits in a ⋯ and the right click of its row. Keep the places it may stand explicit:
  // the menu itself; a dialog about that one thing, which confirms or edits it (the red confirmation dialog included, never a
  // question that replaces a row or a button in its own place), and a vault entry's own page, which does the same; what is
  // being composed (a message's attachments and quote, Raphael's member drafts, and the formatting bar over the words, whose strike and
  // remove-link act on the words being written); and a favourite's star, which destroys nothing.
  const destroyWords = /^(?:確定)?(?:全部)?(?:清除|刪除|移除)|^(?:clear|delete|remove)\b|消去|削除/i;
  const destroyMayStand = '[role="menu"], .menu, .cs-dialog, .mb-dialog, .vault-page, .skl-page, .modal-scrim:not([data-standalone]) :is(.rules-row, [data-row="project-folder"]), .composer, .cmp-fmt, .draft-panel, .mp-star';
  const destroysInTheOpen = button => {
    const name = (button.getAttribute('aria-label') || button.textContent).trim();
    // R-MP-02 names these two counted, confirmed Settings actions explicitly.
    const dataHeading = button.matches('.modal-body .data-section > .data-heading > button[data-act="data-clear"]:is([data-what="dictation"], [data-what="conversation"])');
    return name.length <= 24 && destroyWords.test(name) && !button.closest(destroyMayStand) && !dataHeading;
  };
  // An IANA time-zone id ("Asia/Taipei") is an identifier, like a file name or a URL: the Chinese row names the city and
  // then shows the id the setting stores (zoneLabel in timezones.ts), so the id is not English copy.
  const IANA_ZONE_ID = /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?/g;
  const outsideViewport = [], horizontalOverflow = [], missingI18nKeys = [], nativeControls = [], invalidDurations = [], mixedLanguage = [], rawMarkdown = [], productRules = [], clippedText = [];
  const markdownPattern = /(?:^|\r?\n)[\t ]*(?:#{1,6}(?:[\t ]|$)|-\s+\[[ xX]\])|\*\*[^*\r\n]+\*\*|`{3,}/;
  // A textarea holds the document its owner is editing (a private skill's SKILL.md), so Markdown there is data, not unrendered copy.
  const checkMarkdown = element => {
    if (element.closest("textarea, .message-code pre, .checkpoint pre code, .diagram-view")) return;
    for (const node of element.childNodes) if (node.nodeType === 3 && markdownPattern.test(node.textContent))
      rawMarkdown.push({ ...describe(element), text: node.textContent.trim().slice(0, 200) });
  };
  if (visible(doc.body) && onScreen(doc.body)) checkMarkdown(doc.body);
  const allowed = latinAllowed && new Set(latinAllowed), seenWords = new Set();
  const phrases = latinAllowed?.filter(name => /\s|=|\d/.test(name)) ?? [];
  const productPattern = phrases.length ? new RegExp(`\\b(?:${phrases.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi") : null;
  const keyPattern = /\b([a-z][A-Za-z0-9]*\.[A-Za-z0-9_.-]+)\b/g;
  const seenKeys = new Set();
  for (const element of doc.body.querySelectorAll("*")) {
    if (!visible(element)) continue;
    const box = element.getBoundingClientRect(), style = win.getComputedStyle(element);
    const description = describe(element);
    if (!element.matches(".window-resize") && !clipped(element) && (box.left < -1 || box.top < -1 || box.right > viewport.width + 1 || box.bottom > viewport.height + 1))
      outsideViewport.push({ ...description, bounds: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } });
    // SVG uses viewBox coordinates, so text clientWidth and scrollWidth are not CSS overflow measurements.
    // KaTeX keeps the equation's MathML in a clipped one-pixel box for screen readers: it is not overflow.
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg' && !element.closest?.('.katex-mathml') && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && !/auto|scroll|hidden|clip/.test(style.overflowX || style.overflow))
      horizontalOverflow.push({ ...description, width: element.clientWidth, scrollWidth: element.scrollWidth });
    if (!onScreen(element)) continue;
    // Not a failure: words that a box cuts off without an ellipsis or a line clamp, for the person reading the pictures to look at.
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg' && box.width > 2 && box.height > 2 && [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) {
      const cutX = /hidden|clip/.test(style.overflowX) && style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + 1;
      const cutY = /hidden|clip/.test(style.overflowY) && !(parseInt(style.webkitLineClamp, 10) > 0) && element.scrollHeight > element.clientHeight + 1;
      if (cutX || cutY) clippedText.push({ ...description, cut: cutX ? `x ${element.scrollWidth}>${element.clientWidth}` : `y ${element.scrollHeight}>${element.clientHeight}` });
    }
    // R-UI-145: a control that is drawn answers a press. Something else standing on it (a panel that stayed in the layout under the
    // open one, a card that grew over its neighbour) is a defect even when every "is it hidden" question says no: it was found
    // by a person looking at a picture (the slimes of every closed tab drawn over the open tab's).
    // A layer that is fixed to the window (a menu, a dialog, a scrim, a toast, the window's own buttons) is meant to stand over the
    // page, so it may cover what is behind it; anything else may not stand over a control.
    if (element.matches(PRESSABLE) && box.width >= 6 && box.height >= 6 && !element.closest(NEVER_COVERED_EXEMPT)) {
      const rect = shownRect(element);
      // A row of a list that has scrolled out of its box leaves a sliver at the edge (a menu's 09:00 under 09:15, 1px of it in the box's padding): a control with less than 6px of itself in view is not one a press can land on.
      if (rect && rect.width >= 6 && rect.height >= 6) {
        const at = [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]].map(([x, y]) => [rect.left + rect.width * x, rect.top + rect.height * y]);
        const covers = at.map(([x, y]) => coverOf(element, x, y)).filter(Boolean);
        // The centre alone is enough; the corners only count when most of them are covered, so a rounded edge is not a finding.
        const centre = coverOf(element, at[0][0], at[0][1]);
        if (centre || covers.length >= 3) productRules.push({ ...description, rule: 'R-UI-145', reason: `A control is covered by ${(() => { const o = describe(centre || covers[0]); return `<${o.tag}${o.class ? ' class="' + o.class + '"' : ''}> "${(o.text || '').slice(0, 40)}"`; })()}` });
      }
    }
    // The conversation between members has the same jump-to-latest edge button as a conversation (peer-chat.ts).
    const floatingLatest =element.matches(".page-agent .ra-stage > button.conversation-latest, .peer-chat > button.conversation-latest");
    // The sidebar's icons and the buttons on the window's edges are soft round buttons;
    // so is an icon that floats on a picture (the lightbox's close, a member page's way back and its cover's change), which needs its own surface,
    // and so are the guide's foot's round buttons: a step's pair, the way back on a quiet grey and
    // the way on a circle of the accent.
    const sidebarAction = element.matches(".side .btn.icon, .page-agent .mb-det-head .btn.icon, .page-agent .mb-head :is(.ra-tools, .mb-head-l, .room-picker) .btn.icon, :is(.mb-dlg-head, .cs-dlg-head, .room-side-thread > header, .desktop-panel[data-expanded] .desktop-dock) .btn.icon, .btn.icon.close-button, .ob-foot .ob-pair > .btn.icon, .ms-cover > .btn.icon.ms-cover-btn, .ms-bar > .btn.icon.ms-back");
    const violation = (rule, reason) => productRules.push({ ...description, rule, reason });
    // R-UI-181: a row of a scrolling list is as tall as what it holds. A list capped in height with more rows than it shows
    // sized them down to their buttons' min-height, and each row's face and words ran over the next one's.
    if (element.matches('button') && !/auto|scroll|hidden|clip/.test(style.overflowY) && element.parentElement && /auto|scroll/.test(win.getComputedStyle(element.parentElement).overflowY)) {
      const parts = [...element.children].filter(child => visible(child) && !['absolute', 'fixed'].includes(win.getComputedStyle(child).position)).map(child => child.getBoundingClientRect());
      const spill = Math.max(0, ...parts.map(part => Math.max(box.top - part.top, part.bottom - box.bottom)));
      if (spill > 1) violation('R-UI-181', `A row of a scrolling list is shorter than what it holds: its content runs ${Math.round(spill)}px past its edge`);
    }
    if (element.matches('button:disabled[title], [aria-disabled="true"][title]')) {
      const title = element.getAttribute('title')?.trim();
      const label = element.getAttribute('aria-label')?.trim() || element.textContent.trim();
      const context = element.parentElement;
      const visibleText = node => node.nodeType === 3 ? node.textContent : node.nodeType === 1 && visible(node) && onScreen(node) ? [...node.childNodes].map(visibleText).join('') : '';
      const text = context ? visibleText(context).trim() : '';
      if (title && title !== label && !text.includes(title)) violation('R-UI-69', 'A disabled control explains its reason only in a hover title');
    }
    if (element.matches('.page-agent .ans.thinking')) violation('R-UI-38', 'Conversation waiting must use the shared work line');
    // A message hugs its bubble and the actions beside it: empty room to its side is no part of it, so a
    // pointer or a right click there shows nothing.
    if (element.matches('.chat-message') && box.width > 0) {
      // The parts' margin boxes (a file card keeps a small margin) side by side with the actions and the gap between.
      const spans = [...element.children].map(child => {
        const rect = child.getBoundingClientRect(), own = win.getComputedStyle(child);
        return rect.width ? [rect.left - (parseFloat(own.marginLeft) || 0), rect.right + (parseFloat(own.marginRight) || 0)] : null;
      }).filter(Boolean);
      // Actions with no width yet (shown on hover) still keep their track's gap.
      const resting = element.querySelector(':scope > .message-actions')?.getBoundingClientRect().width === 0 ? parseFloat(style.columnGap) || 0 : 0;
      const allowed = (spans.length ? Math.max(...spans.map(span => span[1])) - Math.min(...spans.map(span => span[0])) : 0) + resting;
      const parts = [...element.children].map(child => `${child.className.split(' ')[0] || child.tagName}:${Math.round(child.getBoundingClientRect().left - box.left)}+${Math.round(child.getBoundingClientRect().width)}`).join(' ');
      if (box.width > allowed + 2) violation('R-UI-104', `A message is wider than its bubble and actions: ${Math.round(box.width)} > ${Math.round(allowed)} (${parts})`);
    }
    const scrollbar = element.offsetWidth - element.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0);
    if (['auto', 'scroll'].includes(style.overflowY) && scrollbar > 1 && !element.matches('.main, .modal-body, .cs-results, .cs-form .add-grid')) violation('R-UI-62', 'A scrollbar takes room from a narrow part; only a wide page shows one');
    if (element.matches('.main') && scrollbar > 1 && element.querySelector(':scope > .page-agent:not([hidden])')) violation('R-UI-62', 'A conversation never scrolls the main area, so it keeps no strip for a scrollbar');
    // An overlay scrollbar takes no width, so the height says it as well: a node that escaped a thread's clip
    // once stretched the area under a long room and the wheel scrolled the whole conversation away.
    else if (element.matches('.main') && element.scrollHeight > element.clientHeight + 1 && element.querySelector(':scope > .page-agent:not([hidden])')) violation('R-UI-62', `A conversation scrolls inside itself, yet the main area around it scrolls ${element.scrollHeight - element.clientHeight}px`);
    if (element.matches('.mb-av-slime') && style.overflow !== 'visible') {
      const reserve = Number(style.overflowClipMargin?.match(/([\d.]+)px/)?.[1] ?? 0);
      if (style.overflow !== 'clip' || reserve < Math.max(box.width, box.height)) violation('R-UI-54', 'A crop cuts the horns and wings of a slime');
    }
    if (element.matches('.mb-av-slime') && (box.width % 1 || box.height % 1)) violation('R-UI-63', `A slime on a fraction of a pixel is drawn soft: ${box.width} x ${box.height}`);
    if (element.matches('.shimmer')) {
      const mask=element.querySelector(':scope > .shimmer-mask'), image=mask && win.getComputedStyle(mask).maskImage;
      const light=image && image!=='none' ? win.getComputedStyle(mask,'::after').backgroundImage : style.backgroundImage;
      if (new Set(light.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? []).size < 2) violation('R-UI-55', 'A light passing over words in the colour of the words shows nothing');
    }
    if (element.matches('button.btn.icon')) {
      const bandToggleActive = element.matches('.au-all-day-row > .au-band-toggle:is(:hover, :active):not(:disabled)');
      if (!floatingLatest && !sidebarAction && !bandToggleActive && !element.matches('.btn.back-button[data-nav-back]') && !['transparent', 'rgba(0, 0, 0, 0)', ''].includes(style.backgroundColor)) violation('R-UI-16', 'Icon action has a background surface');
      const glyph = element.querySelector(':scope > svg.i');
      if (glyph) {
        const rect = glyph.getBoundingClientRect();
        // Lucide's icons: 16 px, 18 on the round edge buttons (1.5 px lines), 20 where a larger one is meant (R-UI-19).
        const sizes = element.matches('.cmp-send') ? [32] : [16, 18, 20];
        // CSS zoom scales glyphs too; compare their shared size before scaling.
        let zoom = 1;
        for (let parent = element; parent; parent = parent.parentElement) {
          const parentStyle = win.getComputedStyle(parent);
          zoom *= parseFloat(parentStyle.zoom) || 1;
        }
        if (!sizes.some(size => Math.abs(rect.width / zoom - size) <= .5 && Math.abs(rect.height / zoom - size) <= .5)) violation('R-UI-19', 'Action glyph does not use the shared icon sizes');
        if (Math.abs(rect.left + rect.width / 2 - box.left - box.width / 2) > 1 || Math.abs(rect.top + rect.height / 2 - box.top - box.height / 2) > 1) violation('R-UI-19', 'Action glyph is not centered');
      }
    }
    // R-UI-143: a title cut down to less than a letter and its ellipsis shows half a glyph (a month's chip with a Google mark).
    if (style.textOverflow === 'ellipsis' && element.clientWidth >= 4 && element.scrollWidth > element.clientWidth + 1 && element.clientWidth < (parseFloat(style.fontSize) || 12) && /\S/.test(element.textContent ?? '')) violation('R-UI-143', `A truncated text is left ${element.clientWidth}px, less than one letter: a cut glyph`);
    // R-UI-142: a time that a chip is too narrow for is not drawn half ("11:(" in the second lane of an hour with two events); an overflow:hidden
    // box does not show up as horizontal overflow, so ask the box itself.
    if (element.matches('.cal-chip time') && element.scrollWidth > element.clientWidth + 1) violation('R-UI-142', `A chip's time is cut by the chip's edge: ${element.scrollWidth}px of text in ${element.clientWidth}px`);
    // A dim over a dialog covers all of it: a part left bright reads as a broken layer.
    if (element.matches('.cs-scrim')) {
      const box = element.getBoundingClientRect(), dialog = element.closest('.modal')?.getBoundingClientRect();
      if (dialog && (Math.abs(box.left - dialog.left) > 2 || Math.abs(box.right - dialog.right) > 2)) violation('R-UI-111', 'The dim over a dialog leaves part of it uncovered');
    }
    if (element.matches('.au-month-grid .btn[aria-pressed="true"], .desktop-screen [data-desktop="retry"]')) {
      const luminance = value => {
        const rgb = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (rgb?.length !== 3) return null;
        return rgb.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      if (foreground !== null && background !== null && (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) < 4.5)
        violation('R-UI-22', element.matches('[data-desktop="retry"]') ? 'Screen action has insufficient text contrast' : 'Selected date has insufficient text contrast');
    }
    if (element.matches('.mp-add')) {
      const controls = [...element.children].filter(child => visible(child) && child.matches('input, .btn'));
      if (controls.length > 1 && Math.max(...controls.map(child => child.getBoundingClientRect().height)) - Math.min(...controls.map(child => child.getBoundingClientRect().height)) > 1)
        violation('R-UI-17', 'Adjacent import controls have different heights');
    }
    if (element.matches('.au-field')) {
      const controls = [...element.children].filter(child => visible(child) && child.matches('.sel, .mb-fin, .btn'));
      if (controls.length > 1 && controls.some(child => Math.abs(child.getBoundingClientRect().width - controls[0].getBoundingClientRect().width) > 1))
        violation('R-UI-17', 'Schedule controls in one column have different widths');
    }
    if (element.matches('.page-overview .kc-row')) {
      const label = element.querySelector('.kc-name'), keys = element.querySelector('.kc-keys');
      if (label && keys && Math.abs(label.getBoundingClientRect().top + label.getBoundingClientRect().height / 2 - keys.getBoundingClientRect().top - keys.getBoundingClientRect().height / 2) > 2)
        violation('R-UI-17', 'Shortcut label and keys wrap onto separate rows');
    }
    if (element.matches('.modal-body .purpose')) violation('R-UI-02', 'Settings subtitle repeats the pane purpose');
    if (element.matches('.ob-col > h2') && parseFloat(style.fontSize) < 28) violation('R-UI-37', 'Onboarding needs a large headline');
    // The welcome's one pill fills its row. A step has two round buttons together in the middle of the foot:
    // the way back at the left of the primary, one size, neither at an edge of the card.
    if (element.matches('.ob-actions:not(.ob-pair) > .btn.pri') && box.width < element.parentElement.getBoundingClientRect().width * .6)
      violation('R-UI-37', 'Onboarding primary action must fill the action row');
    if (element.matches('.ob-actions.ob-pair')) {
      const [back, primary] = [element.querySelector(':scope > .btn:not(.pri)'), element.querySelector(':scope > .btn.pri')].map(button => button?.getBoundingClientRect());
      const foot = element.parentElement.getBoundingClientRect();
      if (!back || !primary || back.right > primary.left || primary.left - back.right > 24 || Math.abs(back.width - 36) > 1 || Math.abs(back.height - 36) > 1
        || Math.abs(primary.width - 48) > 1 || Math.abs(primary.height - 48) > 1 || Math.abs((back.top + back.bottom) / 2 - (primary.top + primary.bottom) / 2) > 1
        || Math.abs((back.left + primary.right) / 2 - (foot.left + foot.right) / 2) > 2)
        violation('R-UI-37', 'Onboarding step needs its two round buttons together in the middle, the way back at the left of the primary');
    }
    if (element.matches('.ob-item')) {
      const text = element.querySelector(':scope > .ob-tx'), control = element.querySelector(':scope > .ob-ctl');
      if (text && control && visible(control)) {
        const label = text.getBoundingClientRect(), side = control.getBoundingClientRect();
        if (side.left < label.right - 1 || side.right > box.right + 1 || side.top < box.top - 1 || side.bottom > box.bottom + 1)
          violation('R-UI-35', 'An onboarding choice keeps its control on the right of its name, inside its card');
      }
    }
    if (element.matches('.mc-source-list')) {
      const selected = element.querySelector('.mc-source[aria-pressed="true"]');
      if (selected && visible(selected)) {
        const row = selected.getBoundingClientRect();
        if (row.top < box.top - 1 || row.bottom > box.bottom + 1)
          violation('R-UI-01', 'Selected model source is clipped by its scrollport');
      }
      const footer = element.nextElementSibling;
      if (footer && visible(footer) && footer.getBoundingClientRect().top - box.bottom < 7)
        violation('R-UI-17', 'Model source action touches the final source row');
    }
    // A language's own name marked with its lang ("English" among the spoken languages) is that language's text, not English
    // interface copy; text marked as the window's own language is checked like any other.
    const marked = englishUI.length ? element.closest('[lang]') : null;
    const ownLanguage = Boolean(marked && marked !== doc.documentElement && !/^zh(?:-|$)/i.test(marked.getAttribute('lang') ?? ''));
    if (englishUI.length && !ownLanguage && element.closest('button, label, input, textarea, h1, h2, h3, [role="tab"], [role="menuitem"], .nav') && !element.closest('.message-text, .ans, .txt, .conversation-caption, .conversation-open, .owner-data') && !element.matches('.conversation-trigger')) {
      const copy = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim());
      for (const attribute of ['aria-label', 'placeholder', 'title']) if (element.hasAttribute(attribute)) copy.push(element.getAttribute(attribute).trim());
      const productOrKeyName = /^(?:Raphael|OpenRouter|OpenAI|ChatGPT|Codex|Claude|Gemini|Antigravity|GitHub|Telegram|Google|Google Calendar|Notion|MCP|PDF|CLI|Right Alt|Alt|Ctrl|Esc)$/;
      if (copy.some(value => !productOrKeyName.test(value) && englishUI.includes(value))) violation('R-UI-14', 'English interface copy in a zh-TW window');
    }
    if (element.matches('[data-tooltip], [aria-describedby]')) {
      const custom = element.hasAttribute('data-tooltip') || (element.getAttribute('aria-describedby') ?? '').split(/\s+/).some(id => doc.getElementById(id)?.getAttribute('role') === 'tooltip');
      if (custom && (element.hasAttribute('title') || element.querySelector('svg title'))) violation('R-UI-26', 'Custom and native tooltip coexist');
    }
    if (element.matches('button.danger, button[data-row-action="delete"], button[data-row-action="rename"]') && !element.closest('[role="menu"], .menu, .action-row, .set-head, .modal-scrim:not([data-standalone]) :is(.rules-row, [data-row="project-folder"])') && element.closest('.mp-resource, .mb-routine, .mb-tool-row, .au-room-row, .mem-row, .rule-row, .rules-row, .word-row, .wrow, .history-row, .hrow, .mb-rt, .row, [role="listitem"]'))
      violation('R-UI-11', 'Visible list-row delete or rename action');
    if (element.matches('button') && destroysInTheOpen(element)) violation('R-UI-56', 'A button that clears, deletes or removes stands open on the page');
    if (element.matches('button.btn')) {
      // Navigation cards, list choices and disclosures are not text action buttons; an event line
      // that opens its room navigates like the sidebar's room rows, and so does the count of a line of messages between
      // members (「2 則訊息」), the words that open their conversation, and a package's name in Team skills, which opens its page.
      // Pending question rows reveal their card.
      // Keep this inventory explicit: ordinary action buttons never opt out by an attribute.
      // Browser tabs choose the page shown in the viewer, like segmented navigation.
      const navigation = element.matches('.host-browser-strip .btn.host-browser-tab-button, .pending-questions > .pending-question, .conversation-trigger, .conversation-open, .mb-panel-row, .mb-panel-back, .ms-open, .mb-det .mb-rt, .mb-chat-choice, .mc-source, .room-row, .cs-open, .cs-main, .skl-open, .skl-doc-open, .cs-have, .cs-viewall, .au-room-row > .btn:first-child, .event-open, .event-count, .menu-reactions .reaction, .reaction-bar .reaction, .ho-row, .ho-stat, .lib-row, .tpr-row, .au-edit, .cal-chip, .cal-more, .au-day-num, .au-date-nav > .au-today, .steps-sum, .task-sum, .desktop-panel .desktop-screen > .btn.desktop-open') || element.closest('.mb-col, .au-month-grid, .au-drag-members, .au-segment, .mc-segments') || element.hasAttribute('aria-expanded') || element.matches('.conversation-card > .card-actions > .card-quiet');
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style[`border${side}Color`]) && !['none', 'hidden'].includes(style[`border${side}Style`]));
      if (!floatingLatest && element.classList.contains('icon') && hasBorder) violation('R-UI-18', 'Icon button has a visible border');
      const routineNavigation = element.matches('.chat-message .routine-origin > button.routine-run-link[data-act="open-routine"]');
      const dockerSetupInChat = element.matches('.desktop-docker-setup > button.desktop-docker-help[data-docker-help]');
      // A provider's dialog: the page where a key is made (on the key field's label line) and 再新增一個 are plain blue words, as the
      // app's inline links are (R-PROV-EDITOR-01); every other action of the dialog is a framed button.
      const providerLink = element.matches('.pv-dialog .pv-label-row > button.pv-link[data-pv="docs"], .pv-dialog .pv-setup > button.pv-link[data-pv="another"]');
      // On a floating surface (R-FLOAT-01) a control is framed by its fill (`--float-ctl`), like the chips and 「Connect」 buttons.
      const filledOnFloat = !!element.closest('.modal, .mb-dialog, .cs-dialog, .au-pop, .cb-card, .menu') && !/rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor);
      if (!navigation && !routineNavigation && !dockerSetupInChat && !providerLink && !element.matches(".queued-actions > .btn:is([data-act=cancel-message], [data-act=send-now])") && !element.classList.contains('icon') && element.textContent.trim() && !hasBorder && !filledOnFloat) violation('R-UI-18', 'Text action button has no frame');
    }
    // The guide's row follows the rule like any other: its round arrow (or ×) is at the left of the black
    // primary, not stacked above it, so nothing in the guide is exempt.
    if (element.matches('.action-row')) {
      const buttons = [...element.querySelectorAll('button')].filter(visible);
      const primary = buttons.find(button => button.matches('.pri'));
      if (primary && buttons.some(button => button !== primary && button.getBoundingClientRect().right > primary.getBoundingClientRect().left + 1)) violation('R-UI-27', 'Primary action is not rightmost');
      const destructive = buttons.find(button => button.closest('.action-destructive'));
      if (destructive && buttons.some(button => button !== destructive && button.getBoundingClientRect().left < destructive.getBoundingClientRect().right - 1)) violation('R-UI-27', 'Destructive action is not leftmost');
    }
    checkMarkdown(element);
    if (element.matches('.work-time, .work-toggle, .step-ms') && /\b(?:NaN|Infinity)\b/.test(element.textContent)) invalidDurations.push(description);
    // The browser's own media player is a native control too: every video and sound plays in ours (R-MEDIA-01).
    if (element.matches('select,input[type="time"],video[controls],audio[controls]')) nativeControls.push(description);
    // Owner-authored text is data; labels, titles and placeholders remain UI copy. So is the name of a file a member
    // delivered (its Library's rows).
    // A secret's name, as its member wrote it (OPENROUTER_API_KEY), is a name, not copy to translate.
    const authored = element.matches(".key-context .key-name, .cs-info-row .v, .modal-body .data-record > .data-record-text, .project-path, .ms-path, .owner-data, .template-path, .lib-title, .thread :is(.message-text, .message-code code, .message-table td, .message-table th) mark[data-find-match]") || element.closest("textarea, .checkpoint summary, .checkpoint pre code, .checkpoint-uncovered li");
    const strings = authored ? [] : [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent);
    // Project controls carry the owner's paths, names and Git refs in accessible labels.
    for (const attribute of ["aria-label", "title", "placeholder"]) if (element.hasAttribute(attribute) && !element.matches(".cmp-work, [data-act=project-menu]")) strings.push(element.getAttribute(attribute));
    for (const value of strings) for (const match of value.matchAll(keyPattern)) {
      // Explicit JSON path examples are provider field names, not untranslated catalogue keys.
      if (element.matches('code[data-json-paths]') && /^(?:data|event)\./.test(match[1])) continue;
      if (element.matches(".skl-import-hint") && match[1] === "skills.sh") continue;
      // A file name in a path (…\daily-japanese-template.html) is not a catalogue key: a key never follows a separator.
      if (/[\\/_-]/.test(value[match.index + match[0].indexOf(match[1]) - 1] ?? "")) continue;
      if (!namespaces.includes(match[1].split(".")[0]) || seenKeys.has(match[1])) continue;
      seenKeys.add(match[1]); missingI18nKeys.push({ ...description, key: match[1] });
    }
    // The literal command-template token is syntax in every locale, not English copy; so is a service's sign-in code.
    if (allowed && !element.closest('.cmp-input, .message-link, .url-chip, .local-command, .message-code pre code, .msg .note code, .bot-scopes code, .mb-row-p, .rich-language, .message-diagram .diagram-view svg, .rich-view-dialog .diagram-view svg, .dl-code')) for (const value of strings) {
      let copy = productPattern ? value.replace(productPattern, "") : value;
      if (element.matches('[data-skl="pick-file"]')) copy = copy.replace(/\.(?:zip|tar\.gz|tgz|md)\b/g, "");
      for (const [word] of copy.replace(/\{input\}/g, "").replace(keyPattern, "").replace(IANA_ZONE_ID, "").replace(/https?:\/\/\S+|\S+\.(?:pdf|png|jpe?g|txt|md|csv|exe|com|dev|io)\b/gi, "").matchAll(/[A-Za-z]{2,}/g)) {
        if (allowed.has(word.toLowerCase()) || seenWords.has(word)) continue;
        seenWords.add(word); mixedLanguage.push({ ...description, word });
      }
    }
  }
  for (const orphan of overflowOrphans) productRules.push({ ...orphan, rule: 'R-UI-44', reason: 'A ⋯ button that a right click on its row does not reach' });
  // R-UI-140: the loop above skips what `hidden` hides, so it cannot see a hidden thing that is drawn anyway (a stylesheet rule that
  // sets `display`, such as one for reduced motion, beats the hidden attribute: the slimes of every closed tab of a
  // picker were drawn over the open tab's). Ask the element itself, not the attribute.
  for (const element of doc.body.querySelectorAll('[hidden]')) {
    if (element.namespaceURI === 'http://www.w3.org/2000/svg' || element.getAttribute('hidden') === 'until-found') continue;
    const style = win.getComputedStyle(element);
    // The viewer keeps its layout box so its remote canvas can size itself before the first draw.
    if (element.matches('iframe[data-desktop-stream]') && style.visibility === 'hidden') continue;
    const { display } = style;
    // Inside another hidden thing an element keeps its own computed display but has no box, so the box is the test.
    if (display !== 'none' && (display === 'contents' ? element.parentElement?.getClientRects().length : element.getClientRects().length)) productRules.push({ ...describe(element), rule: 'R-UI-140', reason: `An element with the hidden attribute is drawn (display: ${display})` });
  }
  // R-UI-52: text and icons stay readable on their surface, at rest and under the pointer.
  const parsed = value => {
    const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
    const srgb = /^color\(srgb ([^)]+)\)$/.exec(value);
    if (!rgb && !srgb) return null;
    const parts = (rgb ?? srgb)[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    const scale = srgb ? 255 : 1;
    return { r: parts[0] * scale, g: parts[1] * scale, b: parts[2] * scale, a: parts[3] ?? 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const luminance = ({ r, g, b }) => [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // The solid colour behind an element, or null when a picture lies under it.
  const backdrop = element => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const color = parsed(style.backgroundColor);
      if (color && color.a > 0) { layers.push(color); if (color.a === 1) break; }
    }
    if (!layers.length || layers[layers.length - 1].a < 1) return null;
    return layers.reduceRight((below, top) => over(top, below));
  };
  // R-UI-144: the rows of one settings card are laid out one way. A control that does not fit beside its label drops under it; when that
  // happens to one row of a card while the next keeps its control beside its label, the card reads as two layouts (the language row under the
  // microphone row of 聽寫與快捷鍵 at 720 wide). A model row stacks by design at a narrow width and is left out.
  for (const list of doc.querySelectorAll('.slist')) {
    if (!visible(list) || !onScreen(list)) continue;
    const rows = [...list.querySelectorAll(':scope > .row:not(.row-model)')].filter(row => visible(row) && row.querySelector(':scope > .lbl') && row.querySelector(':scope > .ctl')).map(row => {
      const label = row.querySelector(':scope > .lbl').getBoundingClientRect(), control = row.querySelector(':scope > .ctl').getBoundingClientRect();
      return { row, stacked: control.left < label.right - 1 && control.top >= label.top + 4 };
    });
    if (rows.some(item => item.stacked) && rows.some(item => !item.stacked)) {
      for (const { row } of rows.filter(item => item.stacked)) productRules.push({ ...describe(row), rule: 'R-UI-144', reason: 'A row of a settings card drops its control under its label while another row of the same card keeps its control beside its label' });
    }
  }
  // R-UI-141: the caption strip is no block of a colour of its own. Over a conversation it is transparent so the right panel can reach the
  // window's top, and a page laid over that conversation (the new member's) that starts below the strip left a bar of the panel's colour
  // across the top of a wide window (seen at 1920 wide). Ask the pixels: the surface under the strip is the surface
  // just below it, wherever both are a large surface. A dialog's dim, a menu or the lightbox covers the strip by design.
  const chromeBar = doc.querySelector('.window-chrome');
  // A scrim the page keeps closed (a hidden settings modal) dims nothing: only a drawn one counts.
  // The details panel over a narrow window dims the conversation with a scrim of its own (.mb-det-scrim), whose top row lies over the strip.
  const DIMS = '.mb-scrim:not(.cr-scrim), .modal-scrim, .cs-scrim, .sidebar-scrim, .mb-det-scrim, .menu.side-search';
  const dimmed = chromeBar && [...doc.querySelectorAll(DIMS)].some(visible);
  // Under a dialog's dim the strip is dimmed with everything else, so it has no surface of its own: a bright strip over a dimmed window
  // (the new member's page under a template preview) reads as a broken layer. A dim that itself lies over the strip dims it
  // too, whatever the strip's own colour: only a strip that stands above the dim stays bright.
  if (chromeBar && dimmed && doc.documentElement.dataset.desktopExpanded === undefined) {
    const own = parsed(win.getComputedStyle(chromeBar).backgroundColor), bar = chromeBar.getBoundingClientRect();
    const under = typeof doc.elementFromPoint === 'function' && [bar.left + 24, (bar.left + bar.right) / 2].every(x => {
      const top = doc.elementFromPoint(x, bar.top + 3);
      return !!top && !chromeBar.contains(top) && !!top.closest(DIMS);
    });
    if (own && own.a > 0 && !under) productRules.push({ ...describe(chromeBar), rule: 'R-UI-141', reason: 'A dialog dims the window but the caption strip keeps a surface of its own, so it stays bright over the dim' });
  }
  if (chromeBar && !dimmed && typeof doc.elementsFromPoint === 'function' && doc.documentElement.dataset.windowModal !== 'true' && !doc.querySelector('.media-lightbox')) {
    const bar = chromeBar.getBoundingClientRect();
    const surfaceAt = (x, y) => {
      const layers = [];
      let big = null, owner = null;
      for (const element of doc.elementsFromPoint(x, y)) {
        // A picture is no surface to compare: over a member's cover picture the window buttons keep a backing of their own, so that
        // they can be read on whatever the owner chose (member-settings.css).
        if (element.localName === 'img') return null;
        const style = win.getComputedStyle(element);
        if (style.backgroundImage && style.backgroundImage !== 'none') return null;
        const color = parsed(style.backgroundColor);
        if (!color || color.a <= 0) continue;
        layers.push(color);
        const rect = element.getBoundingClientRect();
        if (color.a === 1) { big = rect.width >= 160 && rect.height >= 120; owner = element; break; }
      }
      if (!big) return null;
      surfaceAt.owner = owner;
      return layers.reduceRight((below, top) => over(top, below));
    };
    // A thread scrolls under the strip and fades out there: the edge of a message or card that happens to lie within the strip's height
    // is content passing under it, not a block of the strip's own colour. The strip's own surface is never inside a scroller that
    // reaches under it, so a surface that belongs to a scroller standing at the other sample too is skipped.
    const scrollerOf = element => {
      for (let node = element; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) if (['auto', 'scroll'].includes(win.getComputedStyle(node).overflowY)) return node;
      return null;
    };
    const apart = [];
    for (let x = bar.left + 24; x < bar.right - 24; x += 48) {
      const top = surfaceAt(x, bar.top + 3), topOwner = surfaceAt.owner, below = surfaceAt(x, bar.bottom + 4), belowOwner = surfaceAt.owner;
      if (!top || !below || Math.max(Math.abs(top.r - below.r), Math.abs(top.g - below.g), Math.abs(top.b - below.b)) < 2) continue;
      const topStack = doc.elementsFromPoint(x, bar.top + 3), belowStack = doc.elementsFromPoint(x, bar.bottom + 4);
      const topScroller = scrollerOf(topOwner), belowScroller = scrollerOf(belowOwner);
      if ((belowScroller && topStack.includes(belowScroller)) || (topScroller && belowStack.includes(topScroller))) continue;
      apart.push(Math.round(x));
    }
    if (apart.length) productRules.push({ ...describe(chromeBar), rule: 'R-UI-141', reason: `The caption strip is a block of another colour than the surface just below it, at x = ${apart.join(', ')}` });
  }
  const hasText = element => [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
  const marks = element => [...(hasText(element) ? [element] : []), ...element.querySelectorAll("*")].filter(node => (hasText(node) || node.matches("svg.i")) && visible(node));
  const quiet = element => element.closest(":disabled, [aria-disabled='true'], [inert], .message-code") ||
    element.closest('.desktop-screen') && !element.closest('.missing-note');
  const unreadable = (foreground, background) => foreground && background && foreground.a > 0.1 && ratio(over(foreground, background), background) < 3;
  const seenContrast = new Set();
  const reportContrast = (key, element, state) => {
    if (seenContrast.has(key)) return;
    seenContrast.add(key);
    productRules.push({ ...describe(element), rule: "R-UI-52", reason: `Text or icon is unreadable ${state}` });
  };
  for (const element of doc.body.querySelectorAll("*")) {
    if (!hasText(element) || element.matches("script, style, option") || !visible(element) || !onScreen(element) || quiet(element)) continue;
    const background = backdrop(element);
    if (unreadable(parsed(win.getComputedStyle(element).color), background)) reportContrast(`rest:${element.className}`, element, "at rest");
  }
  const specificity = selector => [(selector.match(/#[\w-]+/g) ?? []).length, (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!not|is|where)[\w-]+/g) ?? []).length, (selector.replace(/\[[^\]]+\]|\.[\w-]+|#[\w-]+|:[\w-]+/g, " ").match(/[a-z][\w-]*/gi) ?? []).length];
  const beats = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return true; };
  const hovered = new Map();
  const collect = rules => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        if (!rule.media || win.matchMedia(rule.media.mediaText).matches) collect(rule.cssRules);
        continue;
      }
      if (!rule.selectorText?.includes(":hover")) continue;
      const fill = rule.style.backgroundColor || rule.style.background, ink = rule.style.color;
      if (!fill && !ink) continue;
      for (const selector of rule.selectorText.split(/,(?![^(]*\))/)) {
        if (!selector.includes(":hover")) continue;
        let matches;
        // `:is(*)` stands where `:hover` was, so `x:is(:hover, :active)` stays a valid selector for x.
        try { matches = doc.querySelectorAll(selector.replace(/:hover/g, ":is(*)").trim()); } catch { continue; }
        const weight = specificity(selector);
        for (const element of matches) {
          const entry = hovered.get(element) ?? {};
          if (fill && (!entry.fill || beats(weight, entry.fill.weight))) entry.fill = { value: fill, weight, selector };
          if (ink && (!entry.ink || beats(weight, entry.ink.weight))) entry.ink = { value: ink, weight };
          hovered.set(element, entry);
        }
      }
    }
  };
  for (const sheet of doc.styleSheets ?? []) { try { collect(sheet.cssRules); } catch { /* A sheet from elsewhere cannot be read. */ } }
  const resolved = (element, property, value) => {
    const probe = doc.createElement("i");
    probe.style.display = "none";
    probe.style[property] = value;
    if (!probe.style[property]) return null;
    element.append(probe);
    const color = parsed(win.getComputedStyle(probe)[property]);
    probe.remove();
    return color;
  };
  for (const [element, { fill, ink }] of hovered) {
    if (!fill || !visible(element) || !onScreen(element) || quiet(element)) continue;
    const surface = resolved(element, "backgroundColor", fill.value.split(/\s+(?![^(]*\))/)[0]);
    const below = element.parentElement && backdrop(element.parentElement);
    if (!surface || !below) continue;
    const background = over(surface, below);
    const forced = ink && resolved(element, "color", ink.value);
    for (const mark of marks(element)) {
      const foreground = mark === element && forced ? forced : forced && win.getComputedStyle(mark).color === win.getComputedStyle(element).color ? forced : parsed(win.getComputedStyle(mark).color);
      // A mark on a surface of its own (a tick in its box) does not sit on the hover fill.
      let onOwnSurface = false;
      for (let node = mark; node && node !== element; node = node.parentElement) if (parsed(win.getComputedStyle(node).backgroundColor)?.a > 0.5) onOwnSurface = true;
      if (onOwnSurface) continue;
      if (unreadable(foreground, background)) { reportContrast(`hover:${fill.selector}`, element, `under the pointer (${fill.selector.trim()})`); break; }
    }
  }
  // R-UI-157: a row that opens something and holds a switch is one control to the eye: under the pointer the fill is the row's and the switch stands on it. A fill on the row's button
  // alone, with the switch beside it, fails on every scene that shows such a row.
  const lit = fill => !!fill && !/^(?:transparent|none|rgba\(0, 0, 0, 0\))$/.test(fill.value.trim());
  for (const row of doc.body.querySelectorAll('*')) {
    const main = [...row.children].find(child => child.matches('button.btn:not(.tg):not(.icon)'));
    const toggle = main && [...row.children].find(child => child.matches('.tg'));
    if (!toggle || !visible(row) || !visible(main) || !visible(toggle) || !onScreen(row)) continue;
    if (lit(hovered.get(main)?.fill) && !lit(hovered.get(row)?.fill))
      productRules.push({ ...describe(main), rule: 'R-UI-157', reason: `The row's button lights alone under the pointer, its switch outside the fill (${hovered.get(main).fill.selector.trim()})` });
  }
  // R-UI-178: measure visible controls, including when CSS reorders the markup. A switch drawn inside a menu button
  // belongs to that button. A control in a different vertical row or clipped out of view cannot compete with the switch.
  // A named row bounds its control group, even when a grid places another row beside it.
  const shown = element => visible(element) && onScreen(element);
  const centreY = box => box.top + box.height / 2;
  const centreX = box => box.left + box.width / 2;
  for (const toggle of doc.querySelectorAll(".tg")) {
    if (!shown(toggle)) continue;
    const box = toggle.getBoundingClientRect();
    for (let row = toggle.parentElement; row && row !== doc.body; row = row.parentElement) {
      const style = win.getComputedStyle(row);
      const singleLine = style.display.includes("flex") && !style.flexDirection.startsWith("column");
      const grid = style.display.includes("grid");
      const namedRow = row.matches('[role="row"], .row, [data-row]');
      if (row === toggle.parentElement || singleLine || grid || namedRow) {
        // A dialog's close ends its header (R-UI-179): it is the dialog's, not one of the row's controls beside the switch.
        const controls = [...row.querySelectorAll(PRESSABLE)].filter(control => !control.contains(toggle) && !toggle.contains(control) && shown(control)
          && !control.matches(".close-button"));
        const after = controls.find(control => {
          const rect = control.getBoundingClientRect();
          return centreX(rect) > centreX(box) + 1 && Math.abs(centreY(rect) - centreY(box)) < Math.max(rect.height, box.height) / 2;
        });
        if (after) {
          productRules.push({ ...describe(toggle), rule: "R-UI-178", reason: `A control stands to the right of the switch (${describe(after).label ?? describe(after).class})` });
          break;
        }
      }
      if (grid || namedRow || row.matches(`${PRESSABLE}, header, form, section, [role="dialog"]`) || style.flexDirection.startsWith("column")) break;
    }
  }
  // R-UI-179: a header's close and back use the same rim, square bounds and centre line; without a back, the close shares the title's.
  const headerSelector = 'header, [role="banner"], .mb-dlg-head, .cs-dlg-head, .mb-det-head, .dialog-header, .modal-header, [data-dialog-header]';
  const frame = button => {
    const style = win.getComputedStyle(button);
    return [style.borderTopLeftRadius, style.borderTopWidth, style.borderTopStyle, style.borderTopColor, style.boxShadow];
  };
  for (const header of doc.querySelectorAll(headerSelector)) {
    if (!shown(header)) continue;
    const title = [...header.querySelectorAll('h1, h2, h3, [role="heading"], .card-title')].find(shown);
    // A plain way back (chevron and title words, no circle) is not a round control to match.
    const back = [...header.querySelectorAll(".back-button:not(.back-link)")].find(shown);
    const controls = [...header.querySelectorAll('button, [role="button"], a[href]')].filter(shown);
    const closes = controls.filter(control => control.matches(".close-button") || /^[×✕✖✗]$/.test(control.textContent.trim())
      || control.querySelector('svg path[d="M18 6 6 18"]'));
    const report = (element, reason) => productRules.push({ ...describe(element), rule: "R-UI-179", reason });
    for (const close of closes) {
      const box = close.getBoundingClientRect(), rim = frame(close);
      if (!close.matches("button.close-button") || !close.querySelector("svg")
        || Math.abs(box.width - 36) > 1 || Math.abs(box.height - 36) > 1 || parseFloat(rim[0]) < box.height / 2
        || (!rim[4] || rim[4] === "none") && (!parseFloat(rim[1]) || rim[2] === "none" || !parsed(rim[3])?.a)) {
        report(close, "The header close is missing its shared round button or frame");
      }
      const other = back?.getBoundingClientRect();
      if (other && (Math.abs(box.width - other.width) > 1 || Math.abs(box.height - other.height) > 1
        || frame(back).some((value, i) => value !== rim[i]) || Math.abs(centreY(box) - centreY(other)) > 1)) {
        report(close, "The header close and back differ in size, frame or vertical centre");
      }
      // A page with a way back keeps its back button alone on the first row, level with the close; the title is below.
      if (!other && title && Math.abs(centreY(box) - centreY(title.getBoundingClientRect())) > 1)
        report(close, "The header close does not share the title's vertical centre");
    }
    if (header.closest('[role="dialog"], dialog')) {
      for (const node of [header, ...header.querySelectorAll("*")]) {
        if (node.closest('button, [role="button"], a[href]') || !shown(node)) continue;
        if ([...node.childNodes].some(child => child.nodeType === 3 && /^[×✕✖✗]$/.test(child.textContent.trim())))
          report(node, "A bare close glyph stands in a dialog header");
      }
    }
  }
  // R-UI-53: a hover fill keeps its words off its edges. Measured at rest, so every row of every scene counts.
  const HOVER_TEXT_GAP = 6, HOVER_ROW_MIN = 80;
  for (const [element, { fill }] of hovered) {
    if (!fill || /^(?:transparent|none)$/.test(fill.value.trim()) || !visible(element) || !onScreen(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width < HOVER_ROW_MIN || element.matches("input, textarea")) continue;
    let left = Infinity, right = -Infinity;
    const range = doc.createRange(), walker = doc.createTreeWalker(element, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !visible(node.parentElement)) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects?.() ?? []) {
        let end = rect.right;
        // An ellipsis ends where its box ends, not where the whole sentence would.
        for (let parent = node.parentElement; parent && parent !== element; parent = parent.parentElement)
          if (/hidden|clip/.test(win.getComputedStyle(parent).overflowX)) end = Math.min(end, parent.getBoundingClientRect().right);
        left = Math.min(left, rect.left); right = Math.max(right, end);
      }
    }
    if (left === Infinity) continue;
    const cutOff = element.scrollWidth > element.clientWidth + 1;
    if (left - box.left < HOVER_TEXT_GAP || (!cutOff && box.right - right < HOVER_TEXT_GAP))
      productRules.push({ ...describe(element), rule: "R-UI-53", reason: `Words ${Math.round(left - box.left)}px and ${Math.round(box.right - right)}px from the edges of a hover fill (${fill.selector.trim()})` });
  }
  // Not a failure: in the dark theme, a bright border or a large bright surface, for the person reading the pictures to look at.
  const lightEdges = [];
  if (doc.documentElement.dataset.theme === 'dark') {
    for (const element of doc.body.querySelectorAll('*')) {
      if (element.namespaceURI === 'http://www.w3.org/2000/svg' || !visible(element) || !onScreen(element)) continue;
      if (element.closest('.toast, svg, img, canvas, video, iframe, [class*="slime"], .mono, .logo')) continue;
      const style = win.getComputedStyle(element), box = element.getBoundingClientRect();
      if (box.width < 12 || box.height < 12) continue;
      const edge = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({ w: parseFloat(style[`border${side}Width`]), c: parsed(style[`border${side}Color`]), s: style[`border${side}Style`] }))
        .find(item => item.w > 0 && item.s !== 'none' && item.c && item.c.a > 0.3 && luminance(item.c) > 0.45);
      const fill = parsed(style.backgroundColor);
      if (edge) lightEdges.push({ ...describe(element), what: 'border' });
      else if (fill && fill.a > 0.5 && luminance(fill) > 0.5 && box.width * box.height > 600) lightEdges.push({ ...describe(element), what: 'surface' });
    }
  }
  const documentWidth = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth);
  return { horizontalOverflow: { document: documentWidth > viewport.width + 1, documentWidth, viewportWidth: viewport.width, elements: horizontalOverflow }, outsideViewport, missingI18nKeys, nativeControls, invalidDurations, mixedLanguage, rawMarkdown, productRules, clippedText, lightEdges };
}

export function failedChecks(result) {
  return result.runtimeErrors.length > 0 || result.horizontalOverflow.document || result.horizontalOverflow.elements.length > 0 || result.outsideViewport.length > 0 || result.missingI18nKeys.length > 0 || result.nativeControls.length > 0 || (result.invalidDurations?.length ?? 0) > 0 || (result.mixedLanguage?.length ?? 0) > 0 || (result.rawMarkdown?.length ?? 0) > 0 || (result.productRules?.length ?? 0) > 0;
}
