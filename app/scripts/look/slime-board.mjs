import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { transpileModule } from "typescript";

/** The actually painted cel, rather than its hidden vector fallback or another cell in the sheet. */
export function paintedSlime(svg) {
  const surface=svg.closest('.slime-surface');
  const fallback=()=>({body:svg.querySelector('.slime-body'),eyes:svg.querySelector('.slime-eyes'),marks:[...svg.querySelectorAll('.slime-mark')]});
  const bodyStrip=surface.querySelector('.slime-loop-body .slime-cels');
  if(bodyStrip && getComputedStyle(bodyStrip.parentElement).display!=='none' && getComputedStyle(bodyStrip.parentElement).visibility!=='hidden'){
    const frame=bodyStrip.parentElement.clientWidth, index=Math.round(-new DOMMatrix(getComputedStyle(bodyStrip).transform).e/frame);
    const props=bodyStrip.querySelector('.slime-prop-cels');
    const row=props?Math.round(-new DOMMatrix(getComputedStyle(props).transform).f/frame):0;
    const bodyCell=(props??bodyStrip).firstElementChild.children[row*12+index];
    const eye=surface.querySelector('.slime-eye-cels'), blink=surface.querySelector('.slime-blink-cels');
    const eyeIndex=Math.round(-new DOMMatrix(getComputedStyle(eye.parentElement).transform).e/frame);
    const count=bodyStrip.parentElement.classList.contains('has-blink')?4:1;
    const gazeIndex=Math.round(-new DOMMatrix(getComputedStyle(eye).transform).f/(frame*count));
    const blinkIndex=Math.round(-new DOMMatrix(getComputedStyle(blink).transform).f/frame);
    const eyeCell=blink.firstElementChild.children[(gazeIndex*12+eyeIndex)*count+blinkIndex];
    return {body:bodyCell.querySelector('.slime-cel-body'),eyes:eyeCell.matches('.slime-cel-eye')?eyeCell:eyeCell.querySelector('.slime-cel-eye'),marks:[...bodyCell.querySelectorAll('.slime-mark')]};
  }
  return fallback();
}

// Pictures of the real slime: its own code and stylesheet in the running app, held at chosen moments, so that sharpness and motion can be judged in stills.

export async function baseline(page, revision) {
  if (!/^[a-f0-9]{7,40}$/.test(revision)) throw new Error("A slime baseline must be a commit ID");
  const read = file => execFileSync("git", ["show", `${revision}:app/src/main/${file}`], { cwd: import.meta.dirname, encoding: "utf8", windowsHide: true });
  const source = read("slime.ts").replace(/^import .*;\r?\n/gm, "");
  const code = transpileModule(`const t = (key) => key;\n${source}`, { compilerOptions: { target: 99, module: 99 } }).outputText;
  return page.evaluate(async (code, css) => {
    const old = await import(`data:text/javascript;base64,${btoa(code)}`);
    window.__slimeBaseline = {slimeSVG:old.slimeSVG,handOver:old.handOver};
    const styles = [...document.querySelectorAll('style[data-vite-dev-id$="/slime.css"]')];
    styles.forEach(style => { style.disabled = true; });
    const sheet = document.createElement("style"); sheet.textContent = css; document.head.append(sheet);
    const faces = [...document.querySelectorAll("svg.slime")].map(svg => {
      const html = (svg.closest(".slime-surface") ?? svg).outerHTML, state = svg.dataset.state;
      const member = window.__look?.data.members.find(member => member.id === Number(svg.dataset.slimeMember));
      const now = svg.querySelector('[fill="#554177"]') ? new Date(2026, 9, 31) : svg.querySelector('[fill="#C94250"]') ? new Date(2026, 11, 25) : new Date(2000, 5, 1);
      (svg.closest(".slime-surface") ?? svg).outerHTML = old.slimeSVG(old.parseSlime(member?.avatar) ?? { color: "sky" }, { state, delay: parseFloat(svg.style.getPropertyValue("--slime-delay")) || 0, now });
      return html;
    });
    [...document.querySelectorAll("svg.slime")].forEach((svg, index) => {
      const original = document.createElement("div"); original.innerHTML = faces[index];
      for(const name of ['--slime-color','--slime-tempo']) {
        const value=original.querySelector('svg.slime').style.getPropertyValue(name);
        // Revisions before the shared surface drew a bare svg.
        svg.style.setProperty(name,value);svg.closest('.slime-surface')?.style.setProperty(name,value);
      }
      svg.dataset.lookAt = original.querySelector("svg.slime").dataset.lookAt ?? "700";
    });
    window.__slimeRestore = () => {
      [...document.querySelectorAll("svg.slime")].forEach((svg, index) => { (svg.closest('.slime-surface') ?? svg).outerHTML = faces[index]; });
      sheet.remove(); styles.forEach(style => { style.disabled = false; });
      delete window.__slimeBaseline;
    };
  }, code, read("slime.css"));
}

/** Runs in the page. `rows` are `{ label, cells: [{ size, slime, state, at, then, after, caption, hat, icon }] }`: a cell draws `slime` in `state` held `at` ms into its motion, and with `then` changes state there and is held `after` ms later. */
export async function slimeBoard(rows, columns = 1) {
  const { slimeSVG, handOver } = await import("/src/main/slime.ts");
  const { ico } = await import("/src/main/ui.ts");
  const offSeason = new Date(2000, 5, 1), hats = new Date(2026, 9, 31);
  const hold = (svg, at) => { for (const running of (svg.closest(".slime-surface") ?? svg).getAnimations({ subtree: true })) { running.pause(); running.currentTime = at; } };
  const board = document.createElement("div");
  board.className = "look-slime-board";
  board.style.cssText = `position:fixed;inset:0;z-index:100000;overflow:hidden;display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));align-content:start;gap:6px;padding:8px;background:var(--content);color:var(--text-3);font-size:11px;line-height:12px`;
  board.innerHTML = rows.map(({ label, cells, paddingTop = 0 }) => `<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px;padding-top:${paddingTop}px"><span style="flex:none;width:44px;color:var(--text-2)">${label ?? ""}</span>${cells.map(cell =>
    `<span style="display:grid;justify-items:center;gap:2px;flex:none">${cell.icon ? ico("search").replace('<svg ', `<svg style="width:${cell.size}px;height:${cell.size}px" `) : `<span class="av mb-av mb-av-slime" style="--av:${cell.size}px${cell.height ? `;height:${cell.height}px` : ""}">${slimeSVG(cell.slime, { now: cell.hat ? hats : offSeason, state: cell.state })}</span>`}${cell.caption === undefined ? "" : `<small style="height:12px;font-size:10px">${cell.caption}</small>`}</span>`).join("")}</div>`).join("");
  document.body.append(board);
  const svgs = [...board.querySelectorAll("svg.slime")], cells = rows.flatMap(row => row.cells.filter(cell => !cell.icon));
  for (const [index, svg] of svgs.entries()) {
    const cell = cells[index];
    svg.dataset.lookAt = String(cell.then ? cell.after ?? 0 : cell.at ?? 700);
    if (cell.at === undefined) continue;
    hold(svg, cell.at);
    if (cell.then) {
      handOver(svg, cell.then);
      await new Promise(requestAnimationFrame);
      hold(svg, cell.after ?? 0);
    }
  }
  await new Promise(requestAnimationFrame);
  return { check: "slime-board", slimes: svgs.length };
}

/** Sample each loop and its keyframe boundaries, including the group's non-square grid cell. */
export function slimeParts() {
  const failures = [];
  let samples = 0;
  for (const svg of document.querySelectorAll('.look-slime-board svg.slime')) {
    const surface = svg.closest('.slime-surface'), host = surface.parentElement;
    // The eyes easing toward the pointer (slime-follow.ts) answer the pointer; they are no resting animation (R-UI-99).
    const animations = surface.getAnimations({subtree: true}).filter(animation => !animation.effect?.target?.matches?.('.slime-follow'));
    const state = svg.dataset.state, size = host.getBoundingClientRect().width;
    if (surface.querySelector('.slime-drop, .slime-bubble, .slime-cel-prop')) failures.push({state, size, part: 'detached droplet or bubble'});
    if (['idle', 'sleeping'].includes(state) && animations.length) failures.push({state, size, part: 'resting animation'});
    const saved = animations.map(animation => [animation, animation.currentTime]);
    animations.forEach(animation => animation.pause());
    const times = new Set([0]);
    for (const animation of animations) {
      const {duration, delay} = animation.effect.getTiming();
      for (let frame = 0; frame <= 128; frame++) times.add(Math.max(0, delay + duration * frame / 128));
      for (const frame of animation.effect.getKeyframes()) for (const delta of [-1, 0, 1]) times.add(Math.max(0, delay + duration * frame.computedOffset + delta));
    }
    for (const at of times) {
      animations.forEach(animation => { animation.currentTime = at; });
      const drawn=globalThis.__lookPaintedSlime?.(svg);
      const body = drawn?.body ?? svg.querySelector('.slime-body');
      const eyes = drawn?.eyes ?? svg.querySelector('.slime-eyes');
      const b = body.getBoundingClientRect(), e = eyes.getBoundingClientRect();
      const fail = (part, box) => failures.push({state, size, at, part, body: b.toJSON(), box: box.toJSON()});
      if (getComputedStyle(body).visibility === 'hidden') fail('missing body', b);
      if (getComputedStyle(eyes).visibility !== 'hidden' && (e.left < b.left - b.width * .08 || e.right > b.right + b.width * .08 || e.top < b.top - b.height * .08 || e.bottom > b.bottom + b.height * .08)) fail('eyes', e);
      for (const mark of drawn?.marks ?? svg.querySelectorAll('.slime-mark')) {
        const h = mark.getBoundingClientRect();
        if (getComputedStyle(mark).visibility !== 'hidden' && (h.left < b.left - b.width * .18 || h.right > b.right + b.width * .18 || h.top < b.top - b.height * .8 || h.bottom < b.top - b.height * .1 || h.bottom > b.top + b.height * .55)) fail('hat', h);
      }
      samples++;
      if (failures.length >= 8) break;
    }
    saved.forEach(([animation, at]) => { animation.currentTime = at; });
    if (failures.length >= 8) break;
  }
  if (failures.length) throw Object.assign(new Error(`Slime parts separate: ${JSON.stringify(failures)}`), {assertion: {check: 'slime-parts', samples, failures}});
  return {check: 'slime-parts', samples};
}

export function holdStaticPose(scope) {
  const poses = new Map();
  for (const svg of document.querySelectorAll(`${scope} svg.slime`)) {
    for (const animation of (svg.closest(".slime-surface") ?? svg).getAnimations({ subtree: true })) {
      const part = animation.effect.target, style = getComputedStyle(part);
      const names = [...new Set(animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))].filter(name => !["offset", "computedOffset", "easing", "composite"].includes(name));
      const properties = poses.get(part) ?? [];
      for (const name of names) properties.push([name, style.getPropertyValue(name)]);
      // Registered animation variables may be absent from getKeyframes; retain their resolved SVG paint.
      properties.push(["fill-opacity", style.fillOpacity], ["stroke-opacity", style.strokeOpacity]);
      poses.set(part, properties);
    }
  }
  for (const [part, properties] of poses) {
    part.style.setProperty("animation", "none", "important");
    part.style.setProperty("transition", "none", "important");
    for (const [name, value] of properties) if (value) part.style.setProperty(name, value, "important");
  }
}

/** Compare against a genuinely static pose: pausing alone can retain a resampled animation raster. */
export async function slimeSharp(page, scope = ".look-slime-board", evidence, revision) {
  if (revision) await baseline(page, revision);
  const clip = await page.evaluate(scope => { const { x, y, width, height } = document.querySelector(scope).getBoundingClientRect(); return { x, y, width, height }; }, scope);
  const shot = async () => Buffer.from(await page.screenshot({ type: "png", clip })).toString("base64");
  const each = (scope, act) => { for (const svg of document.querySelectorAll(`${scope} svg.slime`)) for (const running of (svg.closest(".slime-surface") ?? svg).getAnimations({ subtree: true })) act(running, svg); };
  await page.evaluate(`(${each})(${JSON.stringify(scope)}, (running, svg) => { running.currentTime = Number(svg.dataset.lookAt ?? 700); running.playbackRate = 1e-7; running.play(); })`);
  await new Promise(resolve => setTimeout(resolve, 900));
  const moving = await shot();
  const sampled = await page.evaluate(scope => [...document.querySelectorAll(`${scope} svg.slime`)].map(svg => ({
    size: svg.getBoundingClientRect().width,
    body: getComputedStyle(svg.querySelector(".slime-body") ?? svg.firstElementChild).animationName,
    strip: svg.closest(".slime-surface")?.querySelector('.slime-idle-body,.slime-loop-body') ? getComputedStyle(svg.closest(".slime-surface").querySelector('.slime-idle-body,.slime-loop-body')).display : 'none',
    animations: (svg.closest(".slime-surface") ?? svg).getAnimations({ subtree: true }).map(a => [a.animationName, a.effect.target.className.baseVal ?? a.effect.target.className]),
  })), scope);
  await page.evaluate(holdStaticPose, scope);
  await new Promise(resolve => setTimeout(resolve, 300));
  const still = await shot();
  const regions = await page.evaluate(scope => {
    const outer = document.querySelector(scope).getBoundingClientRect();
    return [...document.querySelectorAll(`${scope} svg.slime`)].map(svg => {
      const r = svg.getBoundingClientRect();
      const colors = [...svg.querySelectorAll("path, circle")].flatMap(part => {
        const s = getComputedStyle(part);
        return [s.fill, s.stroke].filter(color => color.startsWith("rgb(")).map(color => color.match(/\d+/g).slice(0, 3).map(Number));
      });
      return { x: r.x - outer.x, y: r.y - outer.y, width: r.width, height: r.height, state: svg.dataset.state, colors };
    });
  }, scope);
  const difference = await page.evaluate(async (first, second, regions) => {
    const read = async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width };
    };
    const [firstImage, secondImage] = await Promise.all([read(first), read(second)]);
    const a = firstImage.data, b = secondImage.data, points = [];
    let pixels = 0, worst = 0;
    for (let i = 0; i < a.length; i += 4) {
      const gap = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (gap > 16) { pixels++; if (points.length < 40) points.push([i / 4 % firstImage.width, Math.floor(i / 4 / firstImage.width), gap]); }
      worst = Math.max(worst, gap);
    }
    const softened = (data, region) => {
      const corner = (Math.floor(region.y + region.height - 2) * firstImage.width + Math.ceil(region.x)) * 4;
      const palette = [...region.colors, [...data.slice(corner, corner + 3)]];
      let count = 0;
      for (let y = Math.ceil(region.y); y < Math.floor(region.y + region.height); y++) for (let x = Math.ceil(region.x); x < Math.floor(region.x + region.width); x++) {
        const i = (y * firstImage.width + x) * 4;
        if (palette.every(color => Math.max(...color.map((value, channel) => Math.abs(data[i + channel] - value))) > 8)) count++;
      }
      return count;
    };
    const edges = regions.map(region => ({ size: region.width, state: region.state, moving: softened(a, region), static: softened(b, region) }));
    return { pixels, worst, points, edges };
  }, moving, still, regions);
  if (evidence) {
    await writeFile(`${evidence}-moving.png`, Buffer.from(moving, "base64"));
    await writeFile(`${evidence}-static.png`, Buffer.from(still, "base64"));
    const enlarged = await page.evaluate(async (a, b, height) => {
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      const images = await Promise.all([a, b].map(async data => { const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode(); return img; }));
      canvas.width = images[0].width * 4; canvas.height = height * 8;
      ctx.imageSmoothingEnabled = false;
      images.forEach((img, index) => ctx.drawImage(img, 0, 0, img.width, height, 0, index * height * 4, img.width * 4, height * 4));
      return canvas.toDataURL("image/png").split(",")[1];
    }, moving, still, Math.ceil(Math.max(...regions.map(region => region.y + region.height))) + 4);
    await writeFile(`${evidence}-pixels.png`, Buffer.from(enlarged, "base64"));
  }
  if (revision) await page.evaluate(() => window.__slimeRestore());
  if (difference.edges.some(edge => edge.moving > edge.static * 1.05 + 2)) throw Object.assign(new Error(`A moving slime has a wider soft edge than its static pose (R-UI-63): ${JSON.stringify(difference.edges)}`), { assertion: { check: "slime-sharp", ...difference, sampled } });
  return { check: "slime-sharp", ...difference };
}

/** What a sidebar of slimes costs while nothing else happens: percent of a core, for the page's main thread and for the whole browser. */
export async function idleCost(page, seconds, revision) {
  if (revision) await baseline(page, revision);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const client = await page.createCDPSession(), browser = await page.browser().target().createCDPSession();
  await client.send("Performance.enable");
  const main = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  const cpu = async () => (await browser.send("SystemInfo.getProcessInfo")).processInfo.reduce((sum, process) => sum + process.cpuTime, 0);
  const before = await main(), cpuBefore = await cpu();
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  const after = await main(), cpuAfter = await cpu();
  const percent = name => Number(((after[name] - before[name]) / seconds * 100).toFixed(1));
  const layers = await page.evaluate(() => document.querySelectorAll("svg.slime").length);
  const avatarNodes = await page.evaluate(() => [...document.querySelectorAll('svg.slime')].reduce((count,svg)=>count+(svg.closest('.slime-surface') ?? svg).querySelectorAll('*').length,0));
  await client.detach(); await browser.detach();
  if (revision) await page.evaluate(() => window.__slimeRestore());
  return { check: "idle-cost", revision: revision ?? "working-tree", seconds, slimes: layers, avatarNodes, mainThread: percent("TaskDuration"), style: percent("RecalcStyleDuration"), layout: percent("LayoutDuration"), script: percent("ScriptDuration"), browser: Number(((cpuAfter - cpuBefore) / seconds * 100).toFixed(1)) };
}

/** A hover wiggles a slime, the wiggle finishes after the pointer has gone, and a press squashes it until it is let go, with the control standing still. */
export async function slimePointer(page, selector) {
  const row = await page.waitForSelector(selector, { visible: true });
  const box = await row.boundingBox();
  const read = () => row.evaluate(host => {
    const svg = host.querySelector("svg.slime"), rect = host.getBoundingClientRect();
    const scale = getComputedStyle(svg.closest(".slime-surface")).scale;
    return { delighted: svg.classList.contains("is-delighted"), scale, top: rect.top, height: rect.height };
  });
  const rest = await read();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise(resolve => setTimeout(resolve, 80));
  const hovering = await read();
  if (!hovering.delighted) throw new Error("A slime under the pointer does not react");
  await page.mouse.move(0, 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!(await read()).delighted) throw new Error("The wiggle stops when the pointer leaves, instead of finishing");
  await new Promise(resolve => setTimeout(resolve, 800));
  if ((await read()).delighted) throw new Error("The wiggle never ends");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await new Promise(resolve => setTimeout(resolve, 200));
  const pressed = await read();
  const squash = pressed.scale.split(" ").map(Number);
  if (!(squash[0] > 1.05 && squash[1] < 0.95)) throw new Error(`A press does not squash the slime: scale ${pressed.scale}`);
  if (Math.abs(pressed.top - rest.top) > 1 || Math.abs(pressed.height - rest.height) > 1) throw new Error("A pressed control moved");
  await row.evaluate(host => host.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); }, { capture: true, once: true }));
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 900));
  const released = await read();
  if (!["none", "1", "1 1"].includes(released.scale)) throw new Error(`A released slime does not come back: scale ${released.scale}`);
  await row.dispose();
  return { check: "slime-pointer", pressed: pressed.scale };
}
