import { assertStableClick, stableSnapshot, stableControls } from "./stable-click.mjs";
import { checkRendered } from "./checks.mjs";

export function finiteMotionSettled() {
  return document.getAnimations().every(animation => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity ||
    // This is the notification's lifetime, not its entrance; capture the success while it is visible.
    (animation.animationName === "toast-count" && animation.effect?.target?.matches(".toast-bar")));
}

/** Wait for real entrance transitions without changing their paint measurements or infinite activity indicators. */
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

export async function perform(page, step) {
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
    const element = await visible(selector);
    await element.evaluate((input, value) => { input.focus(); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }, text);
    await element.dispose();
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
    case "member-picker": await click('[data-col="add"]'); await click('#app-popover [data-pick="conversation"]'); break;
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
      if (step.shift) await page.keyboard.down("Shift");
      try { await page.keyboard.press(step.key); } finally { if (step.shift) await page.keyboard.up("Shift"); }
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
      if (!expanded) {
        const selected = await visible(`.ho-agenda[data-selected-day="${step.date}"]`); await selected.dispose();
        const block = await visible('.ho-calendar');
        await block.scrollIntoView();
        if (step.open) { const box = await block.boundingBox(); await page.mouse.click(box.x + 6, box.y + 6); }
        await block.dispose();
      }
      if (expanded || step.open) { const day = await visible(`.au-day-col[data-day="${step.date}"]`); await day.dispose(); }
      return {check:'home-day-selection',expanded,date:step.date,opened:expanded || Boolean(step.open)};
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
    case "conversation-position": {
      const element = await visible('.ra-scroll');
      await element.evaluate((node, position) => node.scrollTo({ top: position === "up" ? Math.max(1, (node.scrollHeight - node.clientHeight) / 2) : node.scrollHeight, behavior: "instant" }), step.position);
      await element.dispose(); break;
    }
    case "scroll": { const element = await visible(step.selector); await element.evaluate(element => element.scrollIntoView({ block: "end", inline: "nearest" })); await element.dispose(); break; }
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
      if(await page.$eval('.mb-find',element=>element.hidden))await click('[data-col="search"]');
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
