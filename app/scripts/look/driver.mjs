import { assertStableClick, stableSnapshot, stableControls } from "./stable-click.mjs";
import { checkRendered } from "./checks.mjs";
import { idleCost, slimeBoard, slimeParts, slimePointer, slimeSharp } from "./slime-board.mjs";
import { eventStorm } from "./event-storm.mjs";

export function finiteMotionSettled() {
  return document.getAnimations().every(animation => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity ||
    // This is the notification's lifetime, not its entrance; capture the success while it is visible.
    (animation.animationName === "toast-count" && animation.effect?.target?.matches(".toast-bar")));
}

/** Wait for real entrance transitions without changing their paint measurements or infinite activity indicators. */
/** A hand reaches a page's button from outside the frame: the app hears the pointer up to its edge, and nothing after that. */
export async function pressInFrame(page, element) {
  await element.scrollIntoView();
  const box = await element.boundingBox(), owner = await page.$(".pg-frame");
  const edge = await owner.boundingBox();
  await owner.dispose();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(edge.x - 20, y);
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
}

async function waitForPageFrame(page) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const frame = page.frames().find(item => item !== page.mainFrame() && item.url().startsWith("data:text/html"));
    if (frame) return frame;
    if (Date.now() > deadline) throw new Error("No page frame appeared");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function settleMotion(page) {
  try { await page.waitForFunction(finiteMotionSettled, { timeout: 5000 }); }
  catch (error) {
    const pending = await page.evaluate(() => document.getAnimations().filter(animation =>
      animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity
    ).map(animation => ({ name: animation.animationName ?? "transition", target: animation.effect?.target?.outerHTML,
      currentTime: animation.currentTime, timing: animation.effect?.getTiming() })));
    throw new Error(`Motion did not settle: waiting for finite entrance animations; pending=${JSON.stringify(pending)}`, { cause: error });
  }
}

export async function decodeVisibleImages() {
  await document.fonts.ready;
  await Promise.all([...document.images].filter(image => {
    const box = image.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  }).map(image => image.decode().catch(() => {})));
}

export function findVisibleElement(selector) {
  return [...document.querySelectorAll(selector)].find(element => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  }) ?? null;
}

export async function perform(page, step, evidenceDirectory) {
  let stableAssertion;
  // A collapsed work section can precede the visible reply with the same selector.
  const visible = async selector => {
    const inDrawer = await page.evaluate(selector => matchMedia("(max-width: 859px)").matches && !document.documentElement.hasAttribute("data-sidebar-open") && [...document.querySelectorAll(selector)].some(el => el.closest("#nav")), selector);
    if (inDrawer) await page.click('[data-sidebar="open"]');
    try { return (await page.waitForFunction(findVisibleElement, { timeout: 6000 }, selector)).asElement(); }
    catch (error) { throw new Error(`No visible match: ${selector}`, { cause: error }); }
  };
  const click = async selector => {
    for (let attempt = 0; ; attempt++) {
      const element = await visible(selector);
      try { await element.click(); return; }
      catch (error) {
        // A production redraw can replace a menu between lookup and pointer dispatch.
        // Retry only pre-dispatch stale/unclickable handles; never replay app errors.
        if (attempt >= 2 || !/Node is detached|Node is either not clickable or not an Element/.test(error.message)) throw error;
      } finally { await element.dispose(); }
    }
  };
  const fill = async (selector, text) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const element = await visible(selector);
      try {
        const filled = await element.evaluate((input, value) => {
          if (!input.isConnected) return false;
          input.focus();
          if (!input.isConnected) return false;
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }, text);
        if (filled) return;
      } finally { await element.dispose(); }
    }
    throw new Error(`Field was replaced before input: ${selector}`);
  };
  // Measure the real event through its next painted frame, excluding automation transport time.
  if (step.measure) await page.evaluate(({ selector, action, measure }) => {
    window.__raphaelPaint = new Promise(resolve => {
      document.addEventListener(action === "type" ? "input" : "click", function capture(event) {
        if (!event.target.closest(selector)) return;
        document.removeEventListener(action === "type" ? "input" : "click", capture, true);
        const start = performance.now(), tasks = [];
        performance.mark("look-paint-start");
        const observer = new PerformanceObserver(list => tasks.push(...list.getEntries()));
        observer.observe({ type: "longtask" });
        const finish = () => requestAnimationFrame(() => requestAnimationFrame(() => {
          tasks.push(...observer.takeRecords()); observer.disconnect();
          performance.mark("look-paint-end");
          resolve({ startTime: start, durationMs: performance.now() - start,
            longTasks: tasks.filter(task => task.startTime + task.duration > start).map(task => ({ start: task.startTime, duration: task.duration })),
            domNodes: document.querySelectorAll('[data-cs-body] *').length, cards: document.querySelectorAll('.cs-card').length });
        }));
        const ready = () => {
          if (!measure.readySelector || document.querySelector(measure.readySelector) || performance.now() - start > 2000) finish();
          else requestAnimationFrame(ready);
        };
        ready();
      }, true);
    });
  }, step);
  switch (step.action) {
    case "menu-wheel": {
      await page.evaluate(() => {
        window.__menuWheelTrusted = false;
        document.addEventListener('wheel', event => { window.__menuWheelTrusted = event.isTrusted; }, { capture: true, once: true });
      });
      const viewport = page.viewport();
      await page.mouse.move(viewport.width - 20, viewport.height - 180);
      await page.mouse.wheel({ deltaY: 260 });
      await page.waitForFunction(() => window.__menuWheelTrusted && !document.querySelector('#app-popover, #app-submenu'), { timeout: 1800 });
      break;
    }
    case "menu-resize": {
      const viewport = page.viewport();
      try {
        await page.setViewport({ ...viewport, width: viewport.width - 40 });
        await page.waitForFunction(() => !document.querySelector('#app-popover, #app-submenu'), { timeout: 1800 });
      } finally { await page.setViewport(viewport); }
      break;
    }
    case "menu-edge": {
      const row = await page.$eval('.mb-col [data-member-item="1"]', el => { const box = el.getBoundingClientRect(); return { x: box.right - 6, y: box.top + box.height / 2 }; });
      await page.mouse.click(row.x, row.y, { button: "right" });
      await page.waitForSelector('#app-popover [data-pick="move"]', { visible: true });
      break;
    }
    case "menu-work-storm": {
      const before = await page.evaluate(() => ['app-popover', 'app-submenu'].map(id => {
        const el = document.getElementById(id); return { x: el.offsetLeft, y: el.offsetTop };
      }));
      await page.evaluate(() => {
        window.__menuParent = document.getElementById('app-popover'); window.__menuChild = document.getElementById('app-submenu');
        window.__look.data.members.find(member => member.id === 1).preview = window.__look.data.handoffGroupSample.answer;
        window.__look.emit({ type: "MembersChanged" });
        for (let i = 0; i < 20; i++) window.__look.emit({ type: "WorkerChanged", task_id: 42, state: "running", running: true });
        document.dispatchEvent(new Event('scroll'));
      });
      await new Promise(resolve => setTimeout(resolve, 700));
      const stable = await page.evaluate(before => {
        const child = document.getElementById('app-submenu');
        return child === window.__menuChild && document.getElementById('app-popover') === window.__menuParent &&
          ['app-popover', 'app-submenu'].every((id, index) => {
            const el = document.getElementById(id); return el.offsetLeft === before[index].x && el.offsetTop === before[index].y;
          });
      }, before);
      if (!stable) throw new Error("Work redraw moved or closed a menu");
      break;
    }
    case "menu-settings-redraw": {
      const before = await page.$eval('#app-popover', el => ({ x: el.offsetLeft, y: el.offsetTop }));
      await page.evaluate(() => {
        window.__menuSettingAnchor = document.querySelector('.sel[data-k="local-commands"]');
        window.__look.data.settings.local_commands_mode = "never";
        window.__look.emit({ type: "SettingsChanged" });
      });
      await page.waitForFunction(() => document.querySelector('.sel[data-k="local-commands"]') !== window.__menuSettingAnchor &&
        document.querySelector('#app-popover [data-value="never"][aria-checked="true"]'));
      const stable = await page.$eval('#app-popover', (el, at) => el.offsetLeft === at.x && el.offsetTop === at.y, before);
      if (!stable) throw new Error("Settings redraw moved its open menu");
      break;
    }
    case "menu-diagonal": {
      const boxes = await page.evaluate(() => {
        const row = document.querySelector('#app-popover [data-pick="move"]').getBoundingClientRect(), child = document.querySelector('#app-submenu').getBoundingClientRect();
        return { row: { left: row.left, right: row.right, top: row.top, bottom: row.bottom }, child: { left: child.left, right: child.right, top: child.top, bottom: child.bottom } };
      });
      const start = { x: boxes.row.left + 20, y: (boxes.row.top + boxes.row.bottom) / 2 };
      const end = { x: boxes.child.left + 20, y: boxes.child.bottom - 15 };
      await page.mouse.move(start.x, start.y);
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(start.x + (end.x - start.x) * i / 12, start.y + (end.y - start.y) * i / 12);
        await new Promise(resolve => setTimeout(resolve, 12));
        if (!await page.$('#app-submenu')) throw new Error('A diagonal trip closed the submenu');
      }
      break;
    }
    case "handoff-arrival": {
      await page.evaluate(() => {
        window.__handoffGroup = document.querySelector('[data-handoff-group]');
        window.__handoffReceipt = document.querySelector('[data-handoff="800"]');
        window.__handoffOwner = document.querySelector('.tn[data-id="1"] .me');
        window.__handoffAnswer = document.querySelector('.tn[data-id="1"] .ra');
        const turn = window.__look.data.turns.find(turn => turn.id === 1);
        turn.handoffs.push({ ...turn.handoffs[0], task_id: 850, work_turn_id: 950 });
        for (let i = 0; i < 20; i++) window.__look.emit({ type: "WorkerChanged", task_id: 850, state: "running", running: true });
      });
      await page.waitForFunction(() => document.querySelector('[data-handoff="850"]'), { timeout: 5000 });
      break;
    }
    case "reload":
      await page.reload({waitUntil:"networkidle0",timeout:20000});
      await page.waitForSelector('.page-home:not([hidden]) .ho-hero',{visible:true,timeout:10000});
      break;
    case 'polish-caption': {
      const dialog = await page.$('.mb-dialog') ?? await page.$('.modal-scrim:not([hidden]) .modal');
      const before = await page.evaluate(() => window.__look.calls.length);
      for (const action of ['minimize', 'maximize', 'close']) {
        const selector = `[data-window-action="${action}"]`;
        if (!await page.$eval(selector, el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })) throw new Error('caption is covered');
        await click(selector);
      }
      if (!await page.$eval('[data-window-drag]', el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })) throw new Error('caption drag area is covered');
      await click('[data-window-drag]');
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      const result = await page.evaluate(before => {
        const calls = window.__look.calls.slice(before).map(c=>c.command);
        const once = method => calls.filter(c=>c===`plugin:window|${method}`).length===1;
        window.__polishCaption = ['minimize','toggle_maximize','close','start_dragging'].every(once);
        return window.__polishCaption;
      }, before);
      if (!result || !await dialog.evaluate(el=>el.isConnected && !el.closest('[hidden]'))) throw new Error('caption action was intercepted or dismissed the dialog');
      await page.mouse.click(4, 100);
      await page.waitForFunction(el => !el.isConnected || !!el.closest('[hidden]'), {timeout:2000}, dialog);
      await dialog.dispose();
      if (step.kind === 'settings') await click('#nav [data-go="settings"]');
      else if (step.kind === 'member') { await perform(page, {action:'open-details'}, evidenceDirectory); await click('[data-det="edit"]'); }
      else await click('[data-act="data-clear"][data-what="dictation"]');
      await page.evaluate(() => { window.__polishCaptionOutside = true; });
      break;
    }
    case 'polish-search': {
      const bar = '.ra-find:not([hidden])';
      const value = () => page.$eval(`${bar} .ra-find-count`, el=>el.textContent);
      const expectCount = async expected => {
        await page.waitForFunction(expected => [...document.querySelectorAll('.ra-find:not([hidden]) .ra-find-count')].some(el=>el.textContent===expected), {timeout:6000}, expected);
      };
      await expectCount(`${step.total}/${step.total}`);
      const field = await visible(`${bar} .ra-find-input`);
      const geometry = () => page.$$eval(`${bar} button`, buttons=>buttons.map(el=>{const b=el.getBoundingClientRect();return [b.x,b.y,b.width,b.height];}));
      const before = await geometry();
      await field.focus(); await page.keyboard.press('Enter'); await expectCount(`1/${step.total}`);
      await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift'); await expectCount(`${step.total}/${step.total}`);
      await click(`${bar} [data-find="previous"]`); await expectCount(`${step.total-1}/${step.total}`);
      await click(`${bar} [data-find="next"]`); await expectCount(`${step.total}/${step.total}`);
      const offset = () => page.evaluate(() => {
        const mark=document.querySelector('mark.is-current'); return mark?.closest('.ra-scroll, .au-room-scroll')?.scrollTop;
      });
      const top = await offset();
      await field.focus(); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('needl');
      await expectCount(`${step.total}/${step.total}`);
      if (await offset() !== top) throw new Error('typing moved the conversation');
      await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('absent-word');
      await page.waitForFunction(() => !document.querySelector('mark[data-find-match]') && [...document.querySelectorAll('.ra-find:not([hidden]) .ra-find-count')].some(el=>el.textContent && !el.textContent.includes('/') && !el.textContent.includes('…')), {timeout:6000});
      if (!await page.$eval(`${bar} .ra-find-count`, el=>el.scrollWidth<=el.clientWidth+1)) throw new Error('no-match words are clipped');
      const after = await geometry();
      if (JSON.stringify(before)!==JSON.stringify(after)) throw new Error('search controls moved as the count changed');
      await page.keyboard.press('Escape');
      if (await page.evaluate(() => !!document.querySelector('.ra-find:not([hidden])') || !!document.querySelector('mark[data-find-match]'))) throw new Error('Escape left search highlights');
      const reopen = await visible(step.total===210 ? '[data-room-search]' : '.page-agent [data-act="search"]'); await reopen.click(); await reopen.dispose();
      await field.focus(); await page.keyboard.type('needle'); await expectCount(`${step.total}/${step.total}`);
      const anchor = await page.evaluateHandle(() => document.querySelector('mark.is-current').closest('.chat-message'));
      const closeTop = await anchor.evaluate(el=>el.getBoundingClientRect().top);
      await click(`${bar} [data-find="close"]`);
      const closedTop = await anchor.evaluate(el=>el.getBoundingClientRect().top); await anchor.dispose();
      if (Math.abs(closeTop-closedTop)>1 || await page.$('mark[data-find-match]')) throw new Error('closing changed the location or left highlights');
      await click(step.total===210 ? '[data-room-search]' : '.page-agent [data-act="search"]');
      await field.focus(); await page.keyboard.type('needle'); await expectCount(`${step.total}/${step.total}`);
      await field.dispose();
      await page.evaluate(total=>{window.__polishSearch={total,wrap:true,stable:true,noMatch:true,closedInPlace:true};},step.total);
      if (await value()!==`${step.total}/${step.total}`) throw new Error('newest word was not restored');
      break;
    }
    case "viewport": await page.setViewport({width:step.width,height:step.height,deviceScaleFactor:1}); break;
    case "window-control": {
      const selector = `[data-window-action="${step.control}"]`;
      if (step.restore) {
        await click(selector);
        await page.waitForSelector(`${selector}[aria-pressed="true"]`);
      }
      await page.mouse.move(0, 100);
      const element = await visible(selector);
      const measure = () => element.evaluate(button => {
        const box = button.getBoundingClientRect(), style = getComputedStyle(button);
        const glyph = [...button.querySelectorAll('svg')].find(svg => getComputedStyle(svg).display !== 'none').getBoundingClientRect();
        const strip = button.parentElement.getBoundingClientRect();
        const color = token => { const probe = document.createElement('span'); probe.style.color = `var(${token})`; button.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; };
        return { background: style.backgroundColor, color: style.color, radius: parseFloat(style.borderRadius),
          x: glyph.x + glyph.width / 2, y: glyph.y + glyph.height / 2,
          centerX: box.x + box.width / 2, centerY: box.y + box.height / 2,
          marginTop: box.top - strip.top, marginBottom: strip.bottom - box.bottom,
          hover: color('--hover'), pressed: color('--pressed'), close: color('--close'), onClose: color('--on-close'),
          title: button.title, label: button.getAttribute('aria-label') };
      });
      const rest = await measure();
      await element.hover();
      await new Promise(resolve => setTimeout(resolve, 160));
      const hovered = await measure();
      if (hovered.background !== (step.control === 'close' ? hovered.close : hovered.hover) || hovered.radius <= 0) throw new Error('Caption hover needs a rounded token surface');
      if (Math.abs(hovered.centerX - hovered.x) > .5 || Math.abs(hovered.centerY - hovered.y) > .5 || Math.abs(rest.x - hovered.x) > .5 || Math.abs(rest.y - hovered.y) > .5) throw new Error('Caption glyph moved or is not centered');
      if (hovered.marginTop < 3 || Math.abs(hovered.marginTop - hovered.marginBottom) > .5) throw new Error('Caption hover needs even inner margins');
      if (!hovered.label || hovered.title !== hovered.label) throw new Error('Caption tooltip and accessible label must remain');
      if (step.control === 'close') {
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        const luminance = value => rgb(value).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        const a = luminance(hovered.background), b = luminance(hovered.color);
        if ((Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 4.5 || hovered.color !== hovered.onClose) throw new Error('Close glyph must contrast with its error surface');
      }
      if (step.hoverOnly) {
        if (!await page.evaluate(() => document.documentElement.dataset.windowModal === 'true' && !!document.querySelector('.modal-scrim:not([hidden])'))) throw new Error('Caption hover must preserve the open settings modal');
        await element.dispose();
        return { check: "window-control", control: step.control, hovered, modal: true };
      }
      // Release away from the caption so this assertion never minimizes or closes the page.
      await page.mouse.down();
      let pressed;
      try { await new Promise(resolve => setTimeout(resolve, 160)); pressed = await measure(); }
      finally { await page.mouse.move(0, 100); await page.mouse.up(); }
      if (pressed.background !== (step.control === 'close' ? pressed.close : pressed.pressed)) throw new Error('Caption press needs the pressed token');
      await page.keyboard.press('Tab'); await element.focus();
      const focus = await element.evaluate(button => { const style = getComputedStyle(button); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }; });
      if (focus.style === 'none' || focus.width < 2) throw new Error('Caption keyboard focus needs a visible ring');
      await element.evaluate(button => button.blur());
      await element.hover(); await new Promise(resolve => setTimeout(resolve, 160));
      await element.dispose();
      return { check: "window-control", control: step.control, restore: !!step.restore, hovered, pressed, focus };
    }
    case "frame-wait":
    case "frame-click": {
      // A page in the conversation runs in its own origin, so reaching it needs the frame, and a press must be a real one.
      const frame = await waitForPageFrame(page);
      const element = await frame.waitForSelector(step.selector, { visible: true, timeout: 10000 });
      if (step.action === "frame-click") {
        await pressInFrame(page, element);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      await element.dispose();
      break;
    }
    case "main-event": {
      // Replay only the existing native event boundary; navigation and cards remain real.
      await page.evaluate(event => window.__look.emit(event), step.event);
      break;
    }
    case "overlay-event": {
      await page.evaluate(event => window.__look.overlayChannel.onmessage(event), step.event);
      break;
    }
    case "dictation-paste": {
      await page.focus(step.selector);
      await page.keyboard.type(step.text);
      // Only the existing native event boundary is synthetic; the composer is real.
      await page.evaluate(text => window.__look.emit({ type: "DictationPasted", text }), step.text);
      break;
    }
    case "calendar-tools": {
      if (await page.evaluate(() => document.querySelector('[data-au="tools"]').getBoundingClientRect().width > 0)) await click('[data-au="tools"]');
      break;
    }
    case "calendar-date": {
      // The rail's month where it stands; at a narrow width it is in the drawer, which a date closes again.
      if (await page.evaluate(() => document.querySelector('[data-au="tools"]').getBoundingClientRect().width > 0)) await click('[data-au="tools"]');
      await click(`[data-mini-date="${step.date}"]`);
      break;
    }
    case "member-column": {
      if (step.collapsed) throw new Error("Icon strips were removed; use sidebar drawer scenes");
      if (await page.evaluate(() => matchMedia("(max-width: 859px)").matches && !document.documentElement.hasAttribute("data-sidebar-open"))) await page.click('[data-sidebar="open"]');
      break;
    }
    case "settle-motion":
      await settleMotion(page);
      break;
    case "freeze-motion":
      // Every animation held `at` ms in, also on elements drawn again later, so a moving frame is the same each run.
      await page.addStyleTag({ content: `*, *::before, *::after { animation-delay: -${Number(step.at)}ms !important; animation-play-state: paused !important; }` });
      break;
    case "slime-board": return await page.evaluate(slimeBoard, step.rows, step.columns);
    case "slime-parts": return await page.evaluate(slimeParts);
    case "slime-sharp": {
      const revision = process.env.LOOK_SLIME_BASELINE;
      return await slimeSharp(page, undefined, evidenceDirectory && `${evidenceDirectory}/sharp-${revision ?? "current"}-${await page.evaluate(() => document.documentElement.dataset.theme)}-${page.viewport().width}`, revision);
    }
    case "slime-pointer": return await slimePointer(page, step.selector);
    case "idle-cost": return await idleCost(page, step.seconds, step.revision);
    case "event-storm": return await eventStorm(page, step);
    case "advance-time":
      // Advance the shared fixed clock, then let production timers observe it.
      await page.evaluate(ms => { window.__look.now = Date.now() + ms; }, step.ms);
      await new Promise(resolve => setTimeout(resolve, 100));
      break;
    case "icon-interactions": {
      const element = await visible(step.selector);
      const state = () => element.evaluate(button => {
        const style = getComputedStyle(button), color = document.createElement("span").style;
        color.color = style.getPropertyValue("--accent-icon");
        return { background: style.backgroundColor, color: style.color, accent: color.color, outline: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      try {
        await element.hover();
        await new Promise(resolve => setTimeout(resolve, 200));
        const hover = await state();
        await page.mouse.down();
        let active;
        try {
          await new Promise(resolve => setTimeout(resolve, 200));
          active = await state();
        } finally { await page.mouse.move(0, 0); await page.mouse.up(); }
        if ([hover, active].some(value => value.background !== "rgba(0, 0, 0, 0)")) throw new Error("Icon hover/active must remain transparent");
        if (active.color !== active.accent) throw new Error("Pressed icon must use the accent color");
        await page.keyboard.press("Tab");
        await element.focus();
        const focus = await state();
        if (focus.outline === "none" || parseFloat(focus.outlineWidth) < 2) throw new Error("Keyboard icon focus needs a visible ring");
        return { check: "icon-interactions", hover, active, focus };
      } finally { await element.dispose(); }
    }
    case "open-details":
      await visible(".conversation-trigger");
      // Exercise the title from a closed state at every width, including the default wide panel.
      if (await page.$('.conversation-trigger[aria-expanded="true"]')) await click('.mb-det [data-det="close"]');
      await click(".conversation-trigger");
      await visible('.mb-det:not([hidden])');
      break;
    case "close-details": {
      const scrim = await page.$('.mb-det-scrim');
      const box = await scrim?.boundingBox();
      if (box) await page.mouse.click(box.x + 4, box.y + 80);
      else await click('.conversation-trigger');
      await scrim?.dispose();
      break;
    }
    case "check": return page.evaluate(checkRendered, step.name);
    case "slider-stop": {
      // A real press along the track, where the browser puts the thumb's centre for that stop.
      const element = await visible(step.selector);
      const { at, stops } = await element.evaluate((range, level) => {
        const levels = range.dataset.levels.split(",");
        return { at: level === "last" ? levels.findLastIndex(Boolean) : levels.indexOf(level), stops: levels.length };
      }, step.level);
      const box = await element.boundingBox();
      await page.mouse.click(box.x + 8 + (box.width - 16) * (at / (stops - 1)), box.y + box.height / 2);
      await element.dispose();
      break;
    }
    case "click-position": {
      const element = await visible(step.selector);
      try {
        await element.scrollIntoView();
        const box = await element.boundingBox();
        await page.mouse.click(box.x + box.width * step.x, box.y + box.height * step.y);
        const destination = await visible(step.expect);
        await destination.dispose();
        return { check: "surface-navigation", selector: step.selector, x: step.x, y: step.y, destination: step.expect };
      } finally { await element.dispose(); }
    }
    case "surface-interactions": {
      const element = await visible(step.selector);
      try {
        await element.scrollIntoView();
        const measure = () => element.evaluate(button => {
          const style = getComputedStyle(button), surface = getComputedStyle(button.parentElement);
          const color = token => { const probe = document.createElement('span'); probe.style.color = `var(${token})`; button.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; };
          const visual = [button.parentElement, ...button.parentElement.querySelectorAll('*')].map(node => {
            const box = node.getBoundingClientRect(), css = getComputedStyle(node);
            return [box.x, box.y, box.width, box.height, css.color, node === button.parentElement ? "" : css.borderColor, css.borderWidth, css.boxShadow, css.transform];
          });
          return { background: surface.backgroundColor, border: surface.borderColor, layer: style.backgroundColor, hoverEdge: color('--hover-edge'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth), visual };
        });
        await page.mouse.move(0, 100);
        await new Promise(resolve => setTimeout(resolve, 180));
        const normal = await measure();
        const box = await element.boundingBox();
        await page.mouse.move(box.x + box.width * .98, box.y + box.height * .02);
        await new Promise(resolve => setTimeout(resolve, 180));
        const hovered = await measure();
        await page.evaluate(checkRendered, 'home-hover-content', { normal, hovered });
        await page.mouse.down();
        let pressed;
        try { await new Promise(resolve => setTimeout(resolve, 180)); pressed = await measure(); }
        finally { await page.mouse.move(0, 100); await page.mouse.up(); }
        if (pressed.background !== normal.background || pressed.layer !== 'rgba(0, 0, 0, 0)') throw new Error('Whole block press preserves its background and transparent target');
        await element.focus();
        const pointer = await measure();
        if (pointer.outline !== 'none' && pointer.width > 0) throw new Error('Pointer focus must not show a keyboard ring');
        await page.keyboard.press('Tab'); await element.focus();
        const focus = await measure();
        if (focus.outline === 'none' || focus.width < 2) throw new Error('Whole block keyboard focus needs a visible ring');
        if (step.hoverOnly) { await element.evaluate(button => button.blur()); await element.hover(); }
        return { check: "surface-interactions", selector: step.selector, hovered, pressed, pointer, focus };
      } finally { await element.dispose(); }
    }
    case "stable-click":
    case "click": {
      const enabled = step.action === "stable-click" || await page.evaluate(({ selector, selectors }) => [...document.querySelectorAll(selector)].some(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && node.matches(selectors) && !node.closest('#nav, .page-home')), { selector: step.selector, selectors: stableControls });
      if (!enabled) { await click(step.selector); break; }
      const target = await visible(step.selector);
      await target.evaluate(node => node.scrollIntoView({ block: "nearest", inline: "nearest" }));
      await target.dispose();
      const before = await page.evaluate(stableSnapshot, step.selector);
      await click(step.selector);
      for (const action of step.then ?? []) await perform(page, action);
      if (step.ready) await visible(step.ready);
      await new Promise(resolve => setTimeout(resolve, 150));
      await settleMotion(page);
      const after = await page.evaluate(stableSnapshot, step.selector, before.map(item => item.selector));
      try { stableAssertion = assertStableClick(before, after); }
      catch (error) { error.assertion = { check: "stable-click", selector: step.selector, before, after, failed: true }; throw error; }
      break;
    }
    case "upload": {
      const input = await page.$(step.selector);
      if (!input) throw new Error(`No file input: ${step.selector}`);
      try { await input.uploadFile(step.path); } finally { await input.dispose(); }
      break;
    }
    case "clipboard-paste": case "file-drop": {
      if (step.action === "clipboard-paste") await page.focus(step.selector);
      await page.$eval(step.selector, (element, { action, name, image, text, hold }) => {
        // One opaque pixel, a real picture for the composer to show and the look to load.
        const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
        const transfer = new DataTransfer(), file = image ?? name;
        if (file) transfer.items.add(new File([bytes], file, { type: "image/png" }));
        if (text) transfer.setData("text/plain", text);
        if (action === "clipboard-paste") { element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })); return; }
        for (const type of hold ? ["dragenter", "dragover"] : ["dragenter", "dragover", "drop"]) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }, step);
      break;
    }
    case "type": await fill(step.selector, step.text); break;
    case "hover": { const element = await visible(step.selector); await element.hover(); await element.dispose(); break; }
    case "wait": { const element = await visible(step.selector); await element.dispose(); break; }
    case "wait-text":
      try {
        await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].some(element =>
          element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && element.textContent.includes(text)),
        { timeout: 6000 }, { selector: step.selector, text: step.text });
      } catch (error) { throw new Error(`Text did not appear: ${step.selector}: ${step.text}`, { cause: error }); }
      break;
    case "wait-gone":
      // A result that is an absence (an uninstalled app's row, a closed dialog): the selector no longer matches anything.
      try { await page.waitForFunction(selector => !document.querySelector(selector), { timeout: 6000 }, step.selector); }
      catch (error) { throw new Error(`Still present: ${step.selector}`, { cause: error }); }
      break;
    case "require":
      if (!await page.$(step.selector)) throw new Error(`Unavailable in this checkout: ${step.reason} (${step.selector})`);
      break;
    case "key":
      if (step.ctrl) await page.keyboard.down("Control");
      if (step.shift) await page.keyboard.down("Shift");
      try { await page.keyboard.press(step.key); } finally {
        if (step.shift) await page.keyboard.up("Shift");
        if (step.ctrl) await page.keyboard.up("Control");
      }
      break;
    case "wheel": {
      const element = await visible(step.selector);
      try {
        const box = await element.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 3;
        let deltaY = step.deltaY ?? 0;
        if (step.reveal) {
          const target = await visible(step.reveal);
          try { const rect = await target.boundingBox(); deltaY = Math.max(0, rect.y + rect.height + (step.marginBottom ?? 0) - box.y - box.height); }
          finally { await target.dispose(); }
        }
        await page.mouse.move(x, y);
        if (step.ctrl) await page.keyboard.down('Control');
        try { await page.mouse.wheel({ deltaY, deltaX: step.deltaX ?? 0 }); }
        finally { if (step.ctrl) await page.keyboard.up('Control'); }
        await new Promise(resolve => setTimeout(resolve, 100));
      } finally { await element.dispose(); }
      break;
    }
    case "home-day": {
      const calendar = await visible('.ho-calendar');
      const expanded = await calendar.evaluate(node => getComputedStyle(node).getPropertyValue('--home-calendar-expanded').trim() === '1');
      await calendar.dispose();
      await click(`[data-home-select="${step.date}"]`);
      const day = await visible(`.au-day-col[data-day="${step.date}"]`); await day.dispose();
      return {check:'home-day-selection',expanded,date:step.date,opened:true};
    }
    case "touch-swipe": {
      const element = await visible(step.selector), client = await page.createCDPSession();
      try {
        await element.scrollIntoView();
        const box = await element.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step.dx * i / 8, y, id: 1 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await new Promise(resolve => setTimeout(resolve, 450));
      } finally { await client.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await client.detach(); await element.dispose(); }
      break;
    }
    case "pointer-drag": {
      const element = await visible(step.selector);
      try {
        const box = await element.boundingBox();
        const x = box.x + box.width * (step.x ?? 0.5), y = box.y + box.height * (step.y ?? 0.5);
        const before = await element.evaluate(node => node.getBoundingClientRect().toJSON());
        await page.mouse.move(x, y); await page.mouse.down({ button: step.button ?? "left" });
        try { await page.mouse.move(x + step.dx, y + step.dy, { steps: 12 }); }
        finally { await page.mouse.up({ button: step.button ?? "left" }); }
        if (step.expectMenuClosed && await page.$('#app-popover')) throw new Error('A pointer drag must not open a menu');
        if (step.expectMoved) {
          const after = await element.evaluate(node => node.getBoundingClientRect().toJSON());
          if (Math.abs(after.x - before.x - step.dx) > 1 || Math.abs(after.y - before.y - step.dy) > 1) throw new Error('The group did not follow the pointer');
        }
      } finally { await element.dispose(); }
      break;
    }
    case "right-click": {
      // A real press of the right button in the middle of the element; the page's own `contextmenu` follows it. Where it was is kept for the check.
      const element = await visible(step.selector);
      try {
        await element.scrollIntoView();
        const box = await element.boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.click(point.x, point.y, { button: "right" });
        await page.evaluate(at => { window.__look.pointer = at; }, point);
      } finally { await element.dispose(); }
      break;
    }
    case "focus": await page.focus(step.selector); break;
    case "ime": {
      // The browser's own input-method path (the one WebView2 uses): it makes compositionstart/update and the composing `input`
      // events from a composition, and `insertText` commits it. A commit that arrives after the field lost its composition (a focus
      // change finishes one) inserts its text again, which is how an input method that is not waited for types a character twice.
      const element = await visible(step.selector), client = await page.createCDPSession();
      try {
        await element.focus();
        await element.evaluate(field => {
          const log = window.__imeLog = [];
          for (const type of ["compositionstart", "compositionupdate", "compositionend", "input", "focus", "blur"])
            field.addEventListener(type, event => log.push({ type, data: event.data ?? null, composing: event.isComposing ?? null, value: field.value }), true);
        });
        for (const part of step.sequence) {
          if (part.compose !== undefined) await client.send("Input.imeSetComposition", { text: part.compose, selectionStart: part.compose.length, selectionEnd: part.compose.length });
          else await client.send("Input.insertText", { text: part.commit });
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      } finally { await client.detach(); await element.dispose(); }
      break;
    }
    case "conversation-position": {
      const element = await visible('.ra-scroll');
      await element.evaluate((node, position) => node.scrollTo({ top: position === "up" ? Math.max(1, (node.scrollHeight - node.clientHeight) / 2) : node.scrollHeight, behavior: "instant" }), step.position);
      await element.dispose(); break;
    }
    case "scroll": { const element = await visible(step.selector); await element.evaluate((element, block) => element.scrollIntoView({ block, inline: "nearest", behavior: "instant" }), step.block ?? "end"); await element.dispose(); break; }
    case "wait-scroll-end": {
      const element = await visible(step.selector);
      try { await page.waitForFunction(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1, { timeout: 6000 }, element); }
      finally { await element.dispose(); }
      break;
    }
    case "member": await click(`.mb-col [data-member="${step.id}"]`); break;
    case "room": await click(`[data-room="${step.id}"]`); break;
    case "new-room": await click('[data-col="add"]'); await click('#app-popover [data-pick="group-chat"]'); break;
    case "room-row-menu": { const more = await visible(`[data-room-more="${step.id}"]`); try { await more.hover(); await more.click(); } finally { await more.dispose(); } break; }
    case "rooms-menu": await visible(".mb-col [data-room]"); break;
    case "search":
      await fill(".mb-find-input", step.text); break;
    case "drop": case "drag-start": case "drag-over":
      { const element = await visible(step.selector);
      await element.evaluate((element, options) => {
        const transfer = new DataTransfer();
        transfer.setData("application/x-raphael-member", String(options.memberId ?? element.dataset.memberItem));
        element.dispatchEvent(new DragEvent(options.action === "drop" ? "drop" : options.action === "drag-over" ? "dragover" : "dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }, step);
      await element.dispose(); }
      break;
    case "disable-abilities":
      await visible("#ob [data-ability]");
      while (await page.$('#ob [data-ability][aria-checked="true"]')) await click('#ob [data-ability][aria-checked="true"]');
      break;
    default: throw new Error(`Unknown scene action: ${step.action}`);
  }
  // Let event handlers, microtasks and popover positioning finish between declarative actions.
  await new Promise(resolve => setTimeout(resolve, 100));
  if (step.measure) {
    const measured = await page.evaluate(() => window.__raphaelPaint);
    const assertion = { check: step.measure.name, ...measured, budgetMs: step.measure.budgetMs };
    const reject = message => { const error = new Error(message); error.assertion = assertion; throw error; };
    if (step.measure.enforce !== false) {
      if (measured.durationMs > step.measure.budgetMs) reject(`${step.measure.name}: ${measured.durationMs.toFixed(1)}ms exceeds ${step.measure.budgetMs}ms event-to-paint budget`);
      if (step.measure.maxLongTaskMs && measured.longTasks.some(task => task.duration > step.measure.maxLongTaskMs)) reject(`${step.measure.name}: long task exceeds ${step.measure.maxLongTaskMs}ms: ${JSON.stringify(measured.longTasks)}`);
    }
    return { ...assertion, ...(stableAssertion ? { stableClick: stableAssertion } : {}) };
  }
  return stableAssertion;
}
