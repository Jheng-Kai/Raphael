import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { mountDesktopTimeline } from "../../src/main/desktop-timeline";
import { memberAccent } from "../../src/main/owner-bubble";
import { slimeCharactersHTML, slimeColorOf, slimeColorsHTML } from "../../src/main/slime";
import { auditDocument, failedChecks } from "./audit.mjs";
import { checkRendered } from "./checks.mjs";
import { scenes } from "./scenes/index.mjs";
import { LATIN_NAMES, needsDesktopFixture, sceneLatinNames } from "./runner.mjs";
import { slimeParts } from "./slime-board.mjs";

describe("rendered look checks", () => {
  it("rejects short event actions, inline labels and misaligned confirmation", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<div class="au-event-fields"><label>Channel<input id="au-event-value" class="mb-fin" value="C012345"></label><label>Contains<input id="au-event-contains" class="mb-fin" value="&lt;@U012345&gt;"></label><button data-dlg="event-check">Check</button></div>';
    browser.__look = {calls:[{method:'routines.list',params:{contains:'<@U012345>',value:'C012345'}}]};
    let actionHeight = 36, actionBottom = 100, labelBottom = 56;
    for (const input of browser.document.querySelectorAll('input')) input.getBoundingClientRect = () => ({top:64,bottom:100,height:36});
    browser.document.querySelector('button').getBoundingClientRect = () => ({height:actionHeight,bottom:actionBottom});
    browser.document.createRange = () => ({selectNodeContents() {},setEndBefore() {},getBoundingClientRect:()=>({bottom:labelBottom})});
    vi.stubGlobal('document',browser.document); vi.stubGlobal('window',browser);
    try {
      expect(() => checkRendered('routine-trigger-slack')).not.toThrow();
      actionHeight = 26; expect(() => checkRendered('routine-trigger-slack')).toThrow('share the control height'); actionHeight = 36;
      labelBottom = 90; expect(() => checkRendered('routine-trigger-slack')).toThrow('above their fields'); labelBottom = 56;
      actionBottom = 108; expect(() => checkRendered('routine-trigger-slack')).toThrow('aligns with the fields');
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });

  it("rejects recipe frontmatter, raw service ids and an unfolded default skill", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<div class="template-preview"><div class="tpl-row" data-tpl-skill><div class="tpl-row-t"><b>Check sources</b><span>Check before publishing</span><div class="card-disclosure"><button data-card-disclosure aria-expanded="false"></button><div class="card-detail" hidden>Keep this body.</div></div></div></div><div data-template-connection="gmail"><b class="card-title">Gmail</b></div></div>';
    vi.stubGlobal('document',browser.document);
    try {
      expect(() => checkRendered('template-content')).not.toThrow();
      const detail = browser.document.querySelector('.card-detail');
      detail.textContent = '---\nname: Check sources\ndescription: Check before publishing\n---\nKeep this body.';
      expect(() => checkRendered('template-content')).toThrow('omits frontmatter'); detail.textContent = 'Keep this body.';
      const title = browser.document.querySelector('.card-title');
      title.textContent = 'gmail'; expect(() => checkRendered('template-content')).toThrow('catalogue display names'); title.textContent = 'Gmail';
      detail.hidden = false; expect(() => checkRendered('template-content')).toThrow('disclosure state');
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });

  it("rejects split text edges, mismatched controls and centered location values", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<div class="computer-location-popover"><p class="computer-location-purpose">Shared scope</p><div class="lbl"><div class="t">Computer location</div></div><button class="sel"><span>Local</span></button><label class="field"><input></label></div>';
    let lineLeft = 100, fieldLeft = 100, fieldRight = 300, textInset = 13, textAlign = "left";
    const rect = (left = 100, right = 300) => ({ left, right, width: right - left, height: 34 });
    for (const element of browser.document.querySelectorAll("*")) { element.checkVisibility = () => true; element.getBoundingClientRect = () => element.matches('.field') ? rect(fieldLeft, fieldRight) : rect(); }
    browser.document.createRange = () => {
      let element;
      return { selectNodeContents(node) { element = node; }, getClientRects: () => [rect(), rect(element.matches('.t') ? lineLeft : 100)], getBoundingClientRect: () => rect(100 + textInset) };
    };
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("getComputedStyle", () => ({ textAlign, borderLeftWidth: "1px", paddingLeft: "12px" }));
    try {
      expect(() => checkRendered("host-settings-layout")).not.toThrow();
      lineLeft = 118; expect(() => checkRendered("host-settings-layout")).toThrow("one left edge"); lineLeft = 100;
      fieldLeft = 102; expect(() => checkRendered("host-settings-layout")).toThrow("one left edge"); fieldLeft = 100;
      fieldRight = 290; expect(() => checkRendered("host-settings-layout")).toThrow("right edge"); fieldRight = 300;
      textAlign = "center"; expect(() => checkRendered("host-settings-layout")).toThrow("left-aligned"); textAlign = "left";
      textInset = 50; expect(() => checkRendered("host-settings-layout")).toThrow("left-aligned");
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });
  it("rejects words, a face or a recovery button drawn over an absent computer's wallpaper", () => {
    // An offline computer shows its wallpaper alone and the whole screen is the one press that starts it.
    const browser = new Window();
    const markup = extra => `<header class="desktop-location-header"><button data-computer-location>This computer</button></header><section class="desktop-panel"><div class="desktop-screen"><img class="desktop-wallpaper"><div class="desktop-placeholder">${extra}</div><button data-desktop="enlarge"><span class="desktop-open-pill">Open</span></button></div></section>`;
    browser.__look = { calls: [] };
    const run = extra => {
      browser.document.body.innerHTML = markup(extra);
      for (const element of browser.document.querySelectorAll("*")) {
        element.checkVisibility = () => !element.matches(".desktop-open-pill");
        element.getBoundingClientRect = () => ({ width: 120, height: 32 });
      }
      return () => checkRendered("desktop-absent");
    };
    vi.stubGlobal("window", browser); vi.stubGlobal("document", browser.document); vi.stubGlobal("NodeFilter", browser.NodeFilter);
    vi.stubGlobal("getComputedStyle", () => ({ color: "rgb(240, 240, 240)", backgroundColor: "rgb(23, 23, 23)" }));
    try {
      expect(run("")).not.toThrow();
      expect(run('<div class="desktop-message">Docker Desktop is missing</div>')).toThrow("carries no words");
      expect(run('<div class="desktop-boot-face"></div>')).toThrow("draws no face");
      expect(run('<button data-act="docker-download"></button>')).toThrow("draws no face, progress, sentence or recovery button");
      expect(run('<button data-desktop="retry">Retry</button>')).toThrow("carries no words");
      expect(run('<button class="other"></button>')).toThrow("no button but its own cover");
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });  it("accepts a typed host name as data while still rejecting untranslated controls", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button data-computer-location><span>studio-mini</span></button><button>Save</button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 32, width: 120, height: 32 });
    const scene = { fixture: {}, steps: [{ action: "type", selector: "#computer-ssh-alias", text: "studio-mini" }] };
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], sceneLatinNames(scene, "zh-TW", {}));
    expect(result.mixedLanguage.map(item => item.word)).toEqual(["Save"]);
  });
  it("accepts the complete 1Password brand while still rejecting an untranslated Password label", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>從 1Password 匯入</p><label>Password</label>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 32, width: 120, height: 32 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], sceneLatinNames({ fixture: {}, steps: [] }, "zh-TW", {}));
    expect(result.mixedLanguage.map(item => [item.tag, item.word])).toEqual([["label", "Password"]]);
  });
  it("rejects permission field labels taller than one line", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<div class="permission-card"><div class="card-field"><span>Connected app</span><span>Long action details</span></div></div>';
    const label = browser.document.querySelector('.card-field > span');
    label.checkVisibility = () => true;
    let height = 20;
    label.getBoundingClientRect = () => ({ width: 100, height });
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "20px" }));
    try {
      expect(checkRendered("permission-detail-label")).toEqual({ check: "permission-detail-label", labels: 1 });
      height = 40;
      expect(() => checkRendered("permission-detail-label")).toThrow("one line");
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });
  it.each(["idle", "sleeping"])("rejects detached props and animations on a resting %s slime", state => {
    const browser = new Window();
    browser.document.body.innerHTML = `<div class="look-slime-board"><span><span class="slime-surface"><svg class="slime" data-state="${state}"><path class="slime-body"/><path class="slime-eyes"/></svg></span></span></div>`;
    const box = { x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40, toJSON() { return {}; } };
    for (const element of browser.document.querySelectorAll("*")) element.getBoundingClientRect = () => box;
    const surface = browser.document.querySelector(".slime-surface");
    surface.getAnimations = () => [];
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
    try {
      expect(slimeParts()).toEqual({ check: "slime-parts", samples: 1 });
      const bubble = browser.document.createElement("circle");
      bubble.className = "slime-bubble";
      surface.append(bubble);
      expect(() => slimeParts()).toThrow("detached droplet or bubble");
      bubble.remove();
      surface.getAnimations = () => [{ currentTime: 0, pause() {}, effect: { getTiming: () => ({ duration: 5600, delay: 0 }), getKeyframes: () => [] } }];
      expect(() => slimeParts()).toThrow("resting animation");
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });
  it("moves the pointer to a board label and settles finite delight before checking idle costumes", () => {
    const steps = scenes.find(scene => scene.name === "slime-characters-at-rest").steps;
    const board = steps.findIndex(step => step.action === "slime-board");
    expect(steps.slice(board + 1, board + 4)).toEqual([
      { action: "hover", selector: ".look-slime-board > div > span:first-child" },
      { action: "settle-motion" },
      { action: "check", name: "slime-marks-at-rest" },
    ]);
  });
  it("checks resting costumes on the board without inspecting the hidden compact sidebar", () => {
    const browser = new Window();
    const face = '<span class="slime-surface" data-state="idle"><svg class="slime"><g class="slime-marks"><path d="M0 0L1 1"/></g></svg></span>';
    browser.document.body.innerHTML = `<aside style="visibility:hidden">${face}</aside><div class="look-slime-board">${face.repeat(24)}</div>`;
    for (const element of browser.document.querySelectorAll("*")) {
      element.getBoundingClientRect = () => ({ width: 40, height: 40 });
      element.checkVisibility = () => true;
      element.getAnimations = () => [];
    }
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("getComputedStyle", element => ({ visibility: element.style.visibility || (element.closest("aside") ? "hidden" : "visible") }));
    try {
      expect(checkRendered("slime-marks-at-rest")).toEqual({ check: "slime-marks-at-rest", surfaces: 24, marked: 24 });
      browser.document.querySelector("aside .slime-surface").getAnimations = () => [{ playState: "running" }];
      expect(() => checkRendered("slime-marks-at-rest")).not.toThrow();
      const mark = browser.document.querySelector(".look-slime-board path");
      mark.style.visibility = "hidden";
      expect(() => checkRendered("slime-marks-at-rest")).toThrow("the resting vector wears its costume");
      mark.style.visibility = "visible";
      browser.document.querySelector(".look-slime-board .slime-surface").getAnimations = () => [{ playState: "running" }];
      expect(() => checkRendered("slime-marks-at-rest")).toThrow("idle has no running animation");
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });
  it("requires a rounded square latest button with its own opaque surface, centred just above the composer (R-UI-98, R-UI-105)", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<div><div class="ra-scroll" style="scrollbar-width:none"></div><button class="conversation-latest" style="border:1px solid gray;border-radius:8px;background:white"></button></div><form class="composer"></form>';
    const scroll = browser.document.querySelector(".ra-scroll"), latest = browser.document.querySelector("button"), composer = browser.document.querySelector(".composer");
    let width = 32, left = 84;
    for (const element of [scroll, latest]) {
      element.checkVisibility = () => true;
      element.getBoundingClientRect = () => ({ width, height: 32, left, top: 520, bottom: 552 });
    }
    composer.checkVisibility = () => true;
    composer.getBoundingClientRect = () => ({ width: 200, height: 80, left: 0, top: 564, bottom: 644 });
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("getComputedStyle", element => browser.getComputedStyle(element));
    try {
      expect(() => checkRendered("conversation-up")).not.toThrow();
      for (const radius of ["16px", "0px"]) {
        latest.style.borderRadius = radius;
        expect(() => checkRendered("conversation-up")).toThrow("rounded square button (R-UI-98)");
      }
      latest.style.borderRadius = "8px"; width = 40;
      expect(() => checkRendered("conversation-up")).toThrow("rounded square button (R-UI-98)");
      width = 32; latest.style.backgroundColor = "rgba(0, 0, 0, 0)";
      expect(() => checkRendered("conversation-up")).toThrow("latest has its own opaque surface");
      latest.style.backgroundColor = "white"; left = 150;
      expect(() => checkRendered("conversation-up")).toThrow("latest sits centred just above the composer");
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });
  it("requires an event check button to match the scope control height and baseline", () => {
    const browser=new Window();
    browser.document.body.innerHTML='<section class="au-routine-dialog"><button data-dlg="trigger">Event</button><label><input id="au-event-value"></label><button data-dlg="event-check">Check event</button></section>';
    for(const element of browser.document.querySelectorAll('*')) element.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:40,width:100,height:30});
    const button=browser.document.querySelector('[data-dlg="event-check"]');
    button.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:78,width:100,height:68});
    let labelBottom=8;
    browser.document.createRange=()=>({selectNodeContents(){},setEndBefore(){},getBoundingClientRect:()=>({bottom:labelBottom})});
    vi.stubGlobal('document',browser.document);
    try {
      expect(()=>checkRendered('moving-event-input')).toThrow('event scope and check share the control height');
      button.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:40,width:100,height:30});
      expect(()=>checkRendered('moving-event-input')).not.toThrow();
      labelBottom=24;
      expect(()=>checkRendered('moving-event-input')).toThrow('event scope label stays above its input');
      labelBottom=8;
      button.getBoundingClientRect=()=>({left:10,top:15,right:110,bottom:45,width:100,height:30});
      expect(()=>checkRendered('moving-event-input')).toThrow('event scope and check share a baseline');
      button.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:40,width:100,height:30});
      expect(()=>checkRendered('moving-event-input')).not.toThrow();
    } finally {vi.unstubAllGlobals();browser.happyDOM.abort();}
  });
  it("accepts exact webhook signature syntax while still rejecting untranslated controls", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>HMAC-SHA256 X-Raphael-Signature: sha256=abc</p><button>Save</button>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({left:10,top:10,right:310,bottom:40,width:300,height:30});
    expect(auditDocument(window.document,{width:1120,height:900},[],LATIN_NAMES.map(name=>name.toLowerCase())).mixedLanguage.map(item=>item.word)).toEqual(['abc','Save']);
    window.happyDOM.abort();
  });
  it("rejects month intervals clipped by their containing chip", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<section class="au-page"><h1>Month</h1><div class="au-month-view"><button class="cal-chip is-rhythm"><span class="cal-chip-copy"><small>Every 3 hours</small></span></button></div></section>';
    for (const element of browser.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({left:0,top:0,right:60,bottom:20,width:60,height:20});
    const copy=browser.document.querySelector('.cal-chip-copy'), interval=copy.querySelector('small');
    copy.getBoundingClientRect=()=>({left:0,top:0,right:42,bottom:20,width:42,height:20});
    interval.getBoundingClientRect=()=>({left:0,top:0,right:49,bottom:20,width:49,height:20});
    Object.defineProperty(interval,'clientWidth',{value:49});Object.defineProperty(interval,'scrollWidth',{value:49});
    vi.stubGlobal('document',browser.document);
    try {
      expect(()=>checkRendered('calendar-remember-copy')).toThrow('the whole month interval stays inside its chip');
      copy.getBoundingClientRect=()=>({left:0,top:0,right:60,bottom:20,width:60,height:20});
      expect(()=>checkRendered('calendar-remember-copy')).not.toThrow();
    } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
  });
  it("measures login field rows while allowing room for the password lock", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<section data-secret-card="card-login"><span class="field"><input data-login-user value="owner"></span><span class="field"><input data-secret-input type="password"></span><button data-act="card-save">Save</button></section>';
    const card = browser.document.querySelector('section'), user = card.querySelector('[data-login-user]'), password = card.querySelector('[data-secret-input]');
    const rectangle = (top, width) => ({top, bottom:top + 30, width, height:30});
    card.getBoundingClientRect = () => rectangle(0, 240);
    user.getBoundingClientRect = () => rectangle(30, 220);
    password.getBoundingClientRect = () => rectangle(90, 197);
    user.parentElement.getBoundingClientRect = () => rectangle(30, 220);
    password.parentElement.getBoundingClientRect = () => rectangle(90, 220);
    vi.spyOn(browser.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({measureText:() => ({width:100})}));
    browser.__look = {calls:[]};
    vi.stubGlobal('document', browser.document); vi.stubGlobal('window', browser); vi.stubGlobal('getComputedStyle', () => ({font:'14px sans-serif'}));
    try {
      expect(checkRendered('login-private').check).toBe('login-private');
      user.getBoundingClientRect = () => rectangle(30, 90);
      expect(() => checkRendered('login-private')).toThrow('without clipping the account');
    } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); browser.happyDOM.abort(); }
  });
  it("file scenes bind their own viewer without another selected desktop scene", () => {
    const files = scenes.filter(scene => scene.name.startsWith('computer-file-'));
    expect(files).toHaveLength(5);
    for (const scene of files) expect(needsDesktopFixture([scene]), scene.name).toBe(true);
    expect(needsDesktopFixture([{name:'sidebar', fixture:{}}])).toBe(false);
    expect(needsDesktopFixture([{name:'desktop-owner', fixture:{}}])).toBe(true);
    expect(needsDesktopFixture([{name:'card-sheet', fixture:{cardDeck:true}}])).toBe(true);
  });
  it("treats file paths and diff contents as owner data while still checking checkpoint controls", () => {
    const window = new Window();
    window.document.body.innerHTML = '<section class="checkpoint"><summary>/home/cua/team/report.md</summary><pre><code><span>+ report.title</span></code></pre><ul class="checkpoint-uncovered"><li>Workspace / backup.key</li></ul><button>Save</button><p>files.missing</p></section>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({left:10,top:10,right:310,bottom:40,width:300,height:30});
    const result = auditDocument(window.document, {width:1120,height:900}, ['report','files'], []);
    expect(result.missingI18nKeys.map(item => item.key)).toEqual(['files.missing']);
    expect(result.mixedLanguage.map(item => item.word)).toEqual(['Save']);
    window.happyDOM.abort();
  });
  it("rejects a control that something else stands over, and lets a layer fixed to the window stand over the page", () => {
    const win = new Window();
    win.document.body.innerHTML = '<main><button id="under"><span>Open</span></button><div id="panel">card</div><div id="drawer" style="position:absolute;z-index:3">drawer</div></main><div id="menu" style="position:fixed">menu</div><div id="dim" class="mb-det-scrim"></div>';
    const rect = { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
    for (const element of win.document.querySelectorAll('*')) element.getBoundingClientRect = () => rect;
    const found = cover => {
      win.document.elementFromPoint = () => cover && win.document.getElementById(cover);
      return auditDocument(win.document, { width: 1120, height: 900 }, [], []).productRules.filter(item => item.rule === 'R-UI-145');
    };
    const hit = found('panel');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ tag: 'button', reason: expect.stringContaining('div') });
    expect(found('under')).toEqual([]);
    expect(found(null)).toEqual([]);
    win.document.elementFromPoint = () => win.document.querySelector('#under span');
    expect(auditDocument(win.document, { width: 1120, height: 900 }, [], []).productRules.filter(item => item.rule === 'R-UI-145')).toEqual([]);
    expect(found('menu')).toEqual([]);
    expect(found('drawer')).toEqual([]);
    expect(found('dim')).toEqual([]);
    win.happyDOM.abort();
  });
  it("does not call a row covered when only a sliver of it is left in the box it scrolled out of, and still rejects a row that is in view (R-UI-145)", () => {
    const win = new Window();
    win.document.body.innerHTML = '<div id="menu" style="overflow-y:auto"><button id="out">09:00</button><button id="in">09:15</button></div>';
    const box = (top, bottom) => ({ left: 0, top, right: 100, bottom, width: 100, height: bottom - top });
    const rects = { menu: box(100, 300), out: box(72, 100.8), in: box(100.8, 128.8) };
    for (const element of win.document.querySelectorAll('*')) element.getBoundingClientRect = () => rects[element.id] ?? box(0, 0);
    win.document.elementFromPoint = () => win.document.getElementById('in');
    const covered = () => auditDocument(win.document, { width: 1120, height: 900 }, [], []).productRules.filter(item => item.rule === 'R-UI-145').map(item => item.text);
    expect(covered()).toEqual([]);
    rects.out = box(80, 108);
    expect(covered()).toEqual(['09:00']);
    win.happyDOM.abort();
  });
  it("lets a pane's top row stand over what scrolls under it, and still rejects a covered control of the row itself", () => {
    const win = new Window();
    win.document.body.innerHTML = '<section><header id="row" data-window-drag><span id="pill">name</span><button id="tool">Share</button></header><div id="panel">card</div><ol><li><button id="file">Open file</button></li></ol></section>';
    const rect = { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
    for (const element of win.document.querySelectorAll('*')) element.getBoundingClientRect = () => rect;
    const found = cover => {
      win.document.elementFromPoint = () => win.document.getElementById(cover);
      return auditDocument(win.document, { width: 1120, height: 900 }, [], []).productRules.filter(item => item.rule === 'R-UI-145').map(item => item.text);
    };
    // The thread's file card has scrolled under the row: the row, or its pill, stands there on purpose.
    expect(found('row')).toEqual([]);
    // A part of the row over the thread's file card is the row doing its work; over the row's own button it is a finding.
    expect(found('pill')).toEqual(['Share']);
    // Anything else over the row's own button, or over the thread's, is still a finding.
    expect(found('panel')).toEqual(['Share', 'Open file']);
    win.happyDOM.abort();
  });
  it("completion checks reject a lost alias result and an inner scrollbar", () => {
    const win = new Window();
    win.document.body.innerHTML = `<div class="composer"><textarea></textarea></div><div id="app-popover" style="position:fixed;overflow-y:hidden">${Array.from({length:8},(_,i)=>`<button style="background:transparent" data-value="Notebook ${i}">Notebook ${i}</button>`).join('')}</div>`;
    win.__look = {};
    const rect = {left:100,right:300,top:100,bottom:300,width:200,height:200};
    for (const el of win.document.querySelectorAll('*')) el.getBoundingClientRect = () => rect;
    win.document.querySelector('textarea').focus();
    vi.stubGlobal('window', win); vi.stubGlobal('document', win.document);
    vi.stubGlobal('innerWidth',1120); vi.stubGlobal('innerHeight',800); vi.stubGlobal('getComputedStyle',win.getComputedStyle.bind(win));
    try {
      expect(checkRendered('completion-filtered').values).toHaveLength(8);
      const noisy = win.document.createElement('span'); noisy.className = 'mtag'; noisy.textContent = '已連結';
      win.document.querySelector('[data-value="Notebook 2"]').append(noisy);
      expect(() => checkRendered('completion-filtered')).toThrow('only tag sign-in or key');
      noisy.remove();
      const active = win.document.querySelector('button');
      active.style.backgroundColor = 'black';
      expect(() => checkRendered('completion-filtered')).toThrow('keyboard selection');
      active.classList.add('is-active');
      expect(checkRendered('completion-filtered').values).toHaveLength(8);
      active.style.backgroundColor = 'transparent';
      win.document.querySelector('button').remove();
      expect(() => checkRendered('completion-filtered')).toThrow('eight results');
      win.document.querySelector('#app-popover').style.overflowY = 'auto';
      expect(() => checkRendered('completion-filtered')).toThrow('inner scrollbar');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });
  it("teaching scenes wait for visible results and check owner publication explicitly", () => {
    const teaching = scenes.filter(scene => scene.name.startsWith('desktop-teach-'));
    expect(teaching).toHaveLength(7);
    for (const scene of teaching) {
      expect(scene.steps.some(step => step.action === 'check' && step.name.startsWith('teach-'))).toBe(true);
      for (const step of scene.steps.filter(step => step.action === 'wait')) {
        expect(step.selector.replaceAll(':not([hidden])','')).not.toContain('[hidden]');
      }
    }
  });
  it("waits for the conversation after handing back and hiding the compact panel", () => {
    const handback = scenes.find(scene => scene.name === 'desktop-handback');
    expect(handback.steps.at(-2)).toEqual({action:'wait',selector:'.page-agent:not(:has(.desktop-panel[data-expanded])) .composer'});
  });
  it("checks a teaching trial against its member conversation after an earlier viewer opened", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<section class="desktop-panel"></section><div class="composer"></div>';
    browser.document.querySelector('.desktop-panel').getBoundingClientRect = () => ({width:300,height:300});
    browser.document.querySelector('.composer').getBoundingClientRect = () => ({width:300,height:100});
    browser.__look = {calls:[
      {method:'computer.viewer_open',params:{member_id:0,conversation_id:1}},
      {method:'computer.viewer_open',params:{member_id:1,conversation_id:11}},
      {method:'computer.teach',params:{action:'start',session:'member-viewer'}},
      {method:'computer.teach',params:{action:'stop',session:'member-viewer'}},
      {method:'computer.teach',params:{action:'save',member_id:1,text:'## Procedure'}},
      {command:'agent_ask_text',memberId:1,conversationId:11,text:'checked-report 第二季報告'},
    ]};
    const previous = {document:globalThis.document,window:globalThis.window};
    globalThis.document = browser.document; globalThis.window = browser;
    try {
      expect(checkRendered('teach-try').actions).toEqual(['start','stop','save']);
      browser.document.querySelector('.desktop-panel').hidden = true;
      browser.document.querySelector('.desktop-panel').getBoundingClientRect = () => ({width:0,height:0});
      expect(checkRendered('teach-try').actions).toEqual(['start','stop','save']);
      browser.__look.calls.at(-1).conversationId = 12;
      expect(() => checkRendered('teach-try')).toThrow('the trial stays in the demonstrated member conversation');
    } finally { globalThis.document = previous.document; globalThis.window = previous.window; browser.happyDOM.abort(); }
  });
  it("checks the takeover sidebar's CSS visibility rather than its reserved box", () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<button data-sidebar="open" style="visibility:hidden">Sidebar</button><aside class="mb-det"><section class="desktop-panel" data-expanded><div class="desktop-takeover-bar"></div><div class="desktop-shell"><iframe></iframe><div class="desktop-foot"><div class="desktop-bar"><div class="desktop-dock"><span class="desktop-mode-label">你正在控制</span><button data-desktop="return">停止</button></div></div></div></div></section></aside>';
    for (const element of browser.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({width:720,height:40});
    const frame = browser.document.querySelector('iframe');
    frame.getBoundingClientRect = () => ({width:700,height:492});
    Object.defineProperty(frame, 'contentWindow', {value:{__desktopConnections:1}});
    browser.__look = {calls:[{method:'computer.viewer_open',params:{member_id:1}}]};
    const previous = {document:globalThis.document,window:globalThis.window,innerWidth:globalThis.innerWidth};
    globalThis.document = browser.document; globalThis.window = browser; globalThis.innerWidth = 720;
    try {
      expect(checkRendered('level-takeover').check).toBe('level-takeover');
      browser.document.querySelector('[data-sidebar]').style.visibility = 'visible';
      expect(() => checkRendered('level-takeover')).toThrow('takeover leaves no sidebar entry');
    } finally { Object.assign(globalThis, previous); browser.happyDOM.abort(); }
  });
  it("keeps the WAV format name while still rejecting an English interface word", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>WAV</p><button>Save</button>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({left: 10, top: 10, right: 310, bottom: 40, width: 300, height: 30});
    expect(auditDocument(window.document, {width: 1120, height: 900}, [], LATIN_NAMES.map(name => name.toLowerCase())).mixedLanguage.map(item => item.word)).toEqual(["Save"]);
    window.happyDOM.abort();
  });
  it("accepts read-only calendar details and rejects an unexpected edit action", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="au-pop-detail"><p class="au-pop-time">10:00</p><p class="au-pop-from">Google Calendar</p></div>';
    const measure = () => {
      for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 310, bottom: 210, width: 300, height: 200 });
    };
    measure();
    vi.stubGlobal('document', window.document); vi.stubGlobal('innerWidth', 1120); vi.stubGlobal('innerHeight', 900);
    try {
      expect(() => checkRendered('calendar-detail-read')).not.toThrow();
      window.document.querySelector('.au-pop-detail').insertAdjacentHTML('beforeend', '<button data-pop="edit">Edit</button>');
      measure();
      expect(() => checkRendered('calendar-detail-read')).toThrow('only an own event');
      expect(() => checkRendered('calendar-detail-own')).toThrow('only an own event');
    } finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("checks the native cross-origin framebuffer from inside its viewer", () => {
    const window = new Window();
    window.innerWidth = 1280; window.innerHeight = 900;
    window.document.body.innerHTML = '<div id="noVNC_container"><canvas width="1280" height="900"></canvas></div>';
    window.document.body.style.backgroundColor = 'rgb(23, 23, 23)';
    const canvas = window.document.querySelector('canvas');
    canvas.getBoundingClientRect = () => new window.DOMRect(0, 0, 1280, 900);
    window.document.elementFromPoint = () => canvas;
    vi.stubGlobal('document', window.document);
    try {
      expect(checkRendered('desktop-frame').check).toBe('desktop-frame');
      window.document.body.style.backgroundColor = 'white';
      expect(() => checkRendered('desktop-frame')).toThrow('viewer gutters');
    } finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("checks the same framebuffer after its iframe moves into the conversation card", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="desktop-shell" hidden style="background:rgb(23,23,23)"></div><section class="conversation-card"><header class="card-head">Computer</header><div data-card-desktop-screen><iframe></iframe></div></section>';
    const frame = window.document.querySelector('iframe'), win = new Window(), doc = win.document;
    Object.defineProperty(frame, 'contentDocument', {value:doc});
    doc.body.style.backgroundColor = 'rgb(23,23,23)';
    doc.body.innerHTML = `<div id="noVNC_container"><canvas width="${win.innerWidth}" height="${win.innerHeight}"></canvas></div>`;
    const canvas = doc.querySelector('canvas');
    canvas.getBoundingClientRect = () => new win.DOMRect(0,0,win.innerWidth,win.innerHeight);
    doc.elementFromPoint = () => canvas;
    for (const element of window.document.querySelectorAll('section,header,[data-card-desktop-screen],iframe')) element.getBoundingClientRect = () => new window.DOMRect(0,0,480,270);
    vi.stubGlobal('document',window.document); vi.stubGlobal('getComputedStyle',window.getComputedStyle.bind(window));
    try {
      expect(checkRendered('desktop-frame').check).toBe('desktop-frame');
      doc.body.style.backgroundColor = 'white';
      expect(() => checkRendered('desktop-frame')).toThrow('viewer gutters');
    } finally { vi.unstubAllGlobals(); window.happyDOM.abort(); win.happyDOM.abort(); }
  });
  it("checks remote host settings without entering the computer panel contract", () => {
    const window = new Window();
    window.document.body.innerHTML = '<input id="computer-ssh-alias" value="studio-mini"><button data-k="computer-host"></button>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ width: 100, height: 34 });
    window.__look = { calls: [{ method: 'settings.set', params: { key: 'computer_ssh_alias', value: 'studio-mini' } }] };
    vi.stubGlobal('document', window.document); vi.stubGlobal('window', window);
    try { expect(() => checkRendered('host-settings-remote')).not.toThrow(); }
    finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("does not mistake a fallback card's action glyph for a rendered Mermaid diagram", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="page-agent"><section class="rich-block message-diagram"><header><button><svg></svg></button></header><div class="diagram-view"></div><pre>unfinished</pre><p class="rich-note">Still writing</p></section></div>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ right: 110, width: 100, height: 40 });
    vi.stubGlobal('document', window.document); vi.stubGlobal('innerWidth', 1120);
    try {
      expect(() => checkRendered('rich-fallback')).not.toThrow();
      window.document.querySelector('.diagram-view').innerHTML = '<svg></svg>';
      expect(() => checkRendered('rich-fallback')).toThrow('keeps source');
    } finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("measures SVG overflow at its CSS container and allows only rich code's local horizontal scroll", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="page-agent"><div class="chat-message"><div class="rich-block message-code"><pre style="overflow-x:auto">long command</pre></div><svg><text>Diagram</text></svg></div></div>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40 });
    const text = window.document.querySelector('text'), pre = window.document.querySelector('pre');
    for (const node of [text, pre]) {
      Object.defineProperty(node, 'clientWidth', { value: 100 });
      Object.defineProperty(node, 'scrollWidth', { value: 300 });
    }
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).horizontalOverflow.elements).toEqual([]);
    vi.stubGlobal('document', window.document); vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
    try { expect(() => checkRendered('message-no-inner-scroll')).not.toThrow(); }
    finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("treats diagram labels and code languages as authored content while still checking rich actions", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="message-diagram"><span class="rich-language">bash</span><div class="diagram-view"><svg><text>Review sources</text></svg></div><button>Copy</button></div><button>Load image</button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Copy", "Load", "image"]);
  });
  it("does not read a link's address as words of the page", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p><a class="message-link">x.com/someone/status/1</a></p><div><span class="mention-chip url-chip">x.com/someone/status/2</span></div><button>Copy</button><p>Settings</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Copy", "Settings"]);
  });

  it("treats dictation previews as owner text while still checking their labels and actions", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="modal-body"><div class="data-record"><div class="data-record-text" aria-label="Save">Checking two sources</div><button>Copy</button></div></div><p>Settings</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Save", "Copy", "Settings"]);
  });
  it("treats exact conversation search highlights as owner text while still checking labels and controls", () => {
    const window = new Window();
    window.document.body.innerHTML = '<ol class="thread"><li class="message-text"><mark data-find-match="0" aria-label="Copy">needle</mark></li></ol><mark data-find-match="1">Settings</mark><button>Save</button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Copy", "Settings", "Save"]);
  });
  it("keeps authored code intact while still checking its interface controls for translation", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="message-code"><pre><code><span class="hljs-comment"># Print a summary</span>const ready = true;</code></pre><button>Copy</button></div><p>Settings</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Copy", "Settings"]);
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).rawMarkdown).toEqual([]);
  });
  it.each([["zh-TW", "拉斐爾的快速提問"], ["en", "Raphael's quick question"], ["ja", "ラファエルのクイック質問"]])("quick model purpose uses its current localized row label in %s without a helper paragraph", (locale, purpose) => {
    const win = new Window();
    win.document.documentElement.lang = locale;
    win.document.body.innerHTML = `<div data-row="quick-model"><div class="t">${purpose}</div><button class="mp-trigger"><span class="mp-tname">GPT</span><span class="mp-source">Codex</span></button><span data-price="quick-model">Subscription</span></div>`;
    win.document.querySelector('.mp-trigger').getBoundingClientRect = () => ({ width: 200, height: 60 });
    vi.stubGlobal('document', win.document);
    try {
      expect(() => checkRendered('quick-model-row')).not.toThrow();
      win.document.querySelector('.t').textContent = 'Model';
      expect(() => checkRendered('quick-model-row')).toThrow('row label');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });
  it("allows the Docker brand in localized unavailable states and still rejects untranslated actions", () => {
    const win = new Window();
    win.document.body.innerHTML = '<p class="desktop-status">Docker 目前無法使用</p><p>需要 Docker Desktop。</p><button>Take control</button><button>Desktop</button>';
    for (const element of win.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 });
    const findings = auditDocument(win.document, { width: 1120, height: 900 }, [], LATIN_NAMES.map(name => name.toLowerCase())).mixedLanguage;
    const words = findings.map(item => item.word);
    expect(words).not.toContain("Docker");
    expect(words).toContain("Take");
    expect(findings.filter(item => item.word === "Desktop").map(item => item.text)).toEqual(["Desktop"]);
  });
  it("rejects machine diagnostics in failure replies and sidebar previews, including Markdown italics", () => {
    const win = new Window();
    const natural = "要連上 Gmail，還需要 Composio 金鑰：請到設定 › 連接 貼上它。";
    win.document.body.innerHTML = `<div class="tn"><div class="ra"><div class="chat-message" data-expandable>${natural}</div></div></div><div class="mb-col"><div data-member="1" aria-current="true"><span class="mb-row-p">${natural}</span></div></div>`;
    const reply = win.document.querySelector('.chat-message'), preview = win.document.querySelector('.mb-row-p');
    for (const element of [reply, preview]) element.getBoundingClientRect = () => ({ width: 200, height: 40 });
    vi.stubGlobal('document', win.document);
    try {
      expect(checkRendered('failure-owner-copy').preview).toBe(natural);
      for (const element of [reply, preview]) {
        for (const token of ['auth_expired', '(auth<em>expired</em>)', ';', 'not_configured']) {
          element.innerHTML = `${natural} ${token}`;
          expect(() => checkRendered('failure-owner-copy')).toThrow('exposes no machine diagnostic');
        }
        element.textContent = natural;
      }
      preview.remove();
      expect(() => checkRendered('failure-owner-copy')).toThrow('sidebar preview are visible');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });
  it("checks every dialog footer button and accepts hits on its children", () => {
    const win = new Window();
    win.document.body.innerHTML = '<div class="cs-page"><div class="action-row"><button><span>Retry</span></button><button>Done</button></div></div><div class="toast">Saved</div>';
    const buttons = [...win.document.querySelectorAll('button')];
    win.document.querySelector('.cs-page').getBoundingClientRect = () => ({ width: 400, height: 300 });
    buttons.forEach((button, i) => { button.getBoundingClientRect = () => ({ left: 20 + i * 100, top: 200, width: 80, height: 32 }); });
    win.document.elementFromPoint = vi.fn(x => x < 100 ? buttons[0].firstElementChild : buttons[1]);
    vi.stubGlobal('document', win.document);
    try {
      expect(checkRendered('connections-dialog-actions')).toEqual({ check: 'connections-dialog-actions', buttons: 2 });
      expect(win.document.elementFromPoint.mock.calls).toEqual([[60, 216], [160, 216]]);
      win.document.elementFromPoint = x => x < 100 ? buttons[0] : win.document.querySelector('.toast');
      expect(() => checkRendered('connections-dialog-actions')).toThrow('footer action "Done" is covered');
      win.document.elementFromPoint = () => win.document.querySelector('.toast');
      expect(() => checkRendered('connections-dialog-actions')).toThrow('footer action "Retry" is covered');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });

  it("rejects a mixed connection switch while allowing binary permissions", () => {
    const win = new Window(), previous = { window: globalThis.window, document: globalThis.document };
    try {
      globalThis.window = win; globalThis.document = win.document;
      win.document.body.innerHTML = '<div class="cs"><button role="switch" aria-checked="mixed"></button></div>';
      expect(() => checkRendered("connections-binary")).toThrow("never have a mixed");
      win.document.querySelector('button').setAttribute('aria-checked', 'false');
      expect(checkRendered("connections-binary")).toEqual({ check: "connections-binary", switches: 1 });
    } finally { globalThis.window = previous.window; globalThis.document = previous.document; win.happyDOM.abort(); }
  });

  it("rejects an emblem masquerading as Stop after a roster repaint", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="page-agent"><form class="composer" data-task-state="running"><button class="cmp-voice" aria-label="停止"><span class="av"></span></button><button class="cmp-send"></button></form></div>';
    const voice = window.document.querySelector('.cmp-voice');
    voice.getBoundingClientRect = () => ({ width: 32, height: 32 });
    vi.stubGlobal('document', window.document);
    try {
      expect(() => checkRendered('composer-stop-slot')).toThrow(/Stop is drawn/);
      voice.innerHTML = '<svg></svg>';
      voice.querySelector('svg').getBoundingClientRect = () => ({ width: 20, height: 20 });
      expect(checkRendered('composer-stop-slot').state).toBe('running');
      voice.classList.add('vm-away');
      expect(() => checkRendered('composer-stop-slot')).toThrow(/animation/);
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects known English interface labels while preserving user content and brands", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button>Save</button><button>Raphael</button><p class="message-text">Save</p><button hidden>Cancel</button>';
    // A browser gives a hidden button no box; the DOM double does not, so say it (R-UI-140 asks for the box).
    for (const element of window.document.querySelectorAll('*')) { element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }); if (element.hidden) element.getClientRects = () => []; }
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], null, ['Save', 'Cancel', 'Raphael']);
    expect(result.productRules.map(item => item.rule)).toEqual(['R-UI-14']);
  });
  it("keeps an authored conversation title even when it matches an English interface label", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button class="conversation-trigger" aria-label="Project"><span class="conversation-caption">Project</span></button><button class="conversation-open"><span>Project</span></button><button>Save</button>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], null, ['Project', 'Save']);
    expect(result.productRules.map(item => item.text)).toEqual(['Save']);
  });
  const productAudit = html => {
    const window = new Window();
    window.document.body.innerHTML = html;
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    return { window, audit: () => auditDocument(window.document, { width: 1120, height: 900 }, []) };
  };
  it("checks repair text over the desktop placeholder without auditing streamed pixels (R-UI-52)", () => {
    const { window, audit } = productAudit('<div class="desktop-screen"><div class="missing-note"><button class="btn" style="border:1px solid gray;color:rgb(238,238,238);background-color:rgb(255,255,255)">Repair</button></div></div>');
    expect(audit().productRules).toContainEqual(expect.objectContaining({rule:'R-UI-52'}));
    window.document.querySelector('button').style.backgroundColor = 'rgb(21,21,21)';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-52')).toEqual([]);
  });
  it("rejects text that vanishes at rest or under the pointer (R-UI-52)", () => {
    const { window, audit } = productAudit('<div style="background-color:rgb(30,30,30)"><button class="vanish" style="color:rgb(245,245,245)">Show all</button><p class="dim" style="color:rgb(10,10,10)">Link</p></div><style>.vanish:hover{background-color:rgb(245,245,245)}</style>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-52').map(item => item.class)).toEqual(['dim', 'vanish']);
    window.document.querySelector('.dim').style.color = 'rgb(245,245,245)';
    window.document.querySelector('style').textContent = '.vanish:hover{background-color:rgba(245,245,245,.14)}';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-52')).toEqual([]);
  });
  it("reads a hover inside :is() as a hover, so a later clear fill overrides a general one (R-UI-52)", () => {
    const { audit } = productAudit('<div style="background-color:rgb(255,255,255)"><button class="btn stop" style="color:rgb(120,90,250)">Stop</button></div><style>.btn:hover:not(:disabled){background-color:rgb(120,90,250)}.btn.stop:is(:hover, :active):not(:disabled){background-color:transparent}</style>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-52')).toEqual([]);
  });
  it.each(["light", "dark"])("keeps the computer takeover preview icon readable on hover for every member colour in %s (R-UI-52)", theme => {
    const window = new Window();
    // happy-dom leaves colours and background-image: initial authored; the browser resolves RGB and none.
    const resolvedRGB = css => css.replace(/#[0-9a-f]{6}\b/gi, hex => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(",")})`).replace(/\btransparent\b/g, "rgba(0,0,0,0)");
    const css = ["styles", "agent", "card", "desktop-viewer"].map(name => readFileSync(new URL(`../../src/main/${name}.css`, import.meta.url), "utf8").replace(/^@import .+$/gm, "")).join("\n");
    window.document.documentElement.dataset.theme = theme;
    window.document.head.innerHTML = `<style>${resolvedRGB(css)}</style>`;
    const picker = window.document.createElement("div");
    picker.innerHTML = slimeCharactersHTML(null, value => value) + slimeColorsHTML(null, value => value);
    const colours = [...picker.querySelectorAll("button")].map(button => slimeColorOf({ id: 1, avatar: button.dataset.slimeCharacter ? `slime:${button.dataset.slimeCharacter}` : `slime:color:${button.dataset.slimeColor}` }));
    expect(colours.length).toBeGreaterThan(20);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("Element", window.Element);
    try {
      // Reuse one real preview: accumulating every colour in the document makes
      // each style invalidation and hover-selector audit revisit all earlier previews.
      const chat = window.document.createElement("div");
      chat.className = "page-agent mb-chat";
      chat.dataset.memberBubble = theme;
      chat.innerHTML = '<div data-desktop-slot="2"></div>';
      window.document.body.append(chat);
      mountDesktopTimeline(chat, () => "Member").update({ state: "running", ready: true, control: "member", works: [{ id: "private-computer-task", turn_id: 2, state: "waiting_control", tool: "get_desktop_state", reason: "sign_in" }] });
      chat.replaceChildren(chat.querySelector("[data-card-desktop-screen]"));
      chat.firstElementChild.style.backgroundImage = "none";
      for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
      const button = chat.querySelector('[data-card-desktop-screen] > button[data-card-desktop="take"]');
      expect(button.className).toBe("btn");
      expect(button.textContent).toBe("");
      for (const colour of colours) {
        chat.style.setProperty("--member-accent", memberAccent(colour));
        expect(window.getComputedStyle(button.querySelector("svg.i")).color, colour).toBe("rgb(240, 240, 240)");
        const failures = auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-52" && item.class === "btn");
        expect(failures, colour).toEqual([]);
      }
    } finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  // It audits every member colour in four stylesheets: about 3 s alone, past the 5 s default when the whole suite runs.
  }, 30000);
  it("rejects a disabled control whose reason exists only in a title (R-UI-69)", () => {
    const { window, audit } = productAudit('<div><button disabled title="Needs an API key">Add</button></div>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-69')).toHaveLength(1);
    window.document.querySelector('button').insertAdjacentHTML('afterend', '<p hidden>Needs an API key</p>');
    window.document.querySelector('p').getBoundingClientRect = window.document.querySelector('button').getBoundingClientRect;
    expect(audit().productRules.filter(item => item.rule === 'R-UI-69')).toHaveLength(1);
    window.document.querySelector('p').hidden = false;
    expect(audit().productRules.filter(item => item.rule === 'R-UI-69')).toEqual([]);
  });
  it("rejects a light in the colour of the words it passes over (R-UI-55)", () => {
    const { window, audit } = productAudit('<span class="shimmer" style="background-image:linear-gradient(90deg,rgb(9,9,9),rgb(9,9,9))">x</span>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-55')).toHaveLength(1);
    window.document.querySelector('.shimmer').style.backgroundImage = 'linear-gradient(90deg,rgba(9,9,9,0.4),rgb(9,9,9))';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-55')).toEqual([]);
  });
  it("checks the painted masked shimmer and still rejects a missing mask or a flat light (R-UI-55)", () => {
    const { window, audit } = productAudit('<span class="shimmer">Sample<span class="shimmer-mask" style="mask-image:url(data:image/svg+xml,sample)"></span></span>');
    const read=window.getComputedStyle.bind(window);
    let gradient='linear-gradient(90deg,rgba(9,9,9,0),rgb(9,9,9))';
    const styles=vi.spyOn(window,'getComputedStyle').mockImplementation((element,pseudo)=>pseudo==='::after' ? {backgroundImage:gradient} : read(element));
    try {
      expect(audit().productRules.filter(item=>item.rule==='R-UI-55')).toEqual([]);
      gradient='linear-gradient(90deg,rgb(9,9,9),rgb(9,9,9))';
      expect(audit().productRules.filter(item=>item.rule==='R-UI-55')).toHaveLength(1);
      gradient='linear-gradient(90deg,rgba(9,9,9,0),rgb(9,9,9))';
      window.document.querySelector('.shimmer-mask').style.maskImage='none';
      expect(audit().productRules.filter(item=>item.rule==='R-UI-55')).toHaveLength(1);
    } finally { styles.mockRestore(); window.happyDOM.abort(); }
  });
  it("rejects a scrollbar outside a wide page (R-UI-62)", () => {
    const { window, audit } = productAudit('<div class="mb-det-scroll" style="overflow-y:auto">x</div><div class="main" style="overflow-y:auto">y</div>');
    for (const element of window.document.querySelectorAll('.mb-det-scroll, .main')) {
      Object.defineProperty(element, 'offsetWidth', { value: 200 });
      Object.defineProperty(element, 'clientWidth', { value: 190, configurable: true });
    }
    expect(audit().productRules.filter(item => item.rule === 'R-UI-62').map(item => item.class)).toEqual(['mb-det-scroll']);
    Object.defineProperty(window.document.querySelector('.mb-det-scroll'), 'clientWidth', { value: 200 });
    expect(audit().productRules.filter(item => item.rule === 'R-UI-62')).toEqual([]);
    window.document.querySelector('.main').innerHTML = '<section class="page-agent">x</section>';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-62').map(item => item.class)).toEqual(['main']);
  });
  it("rejects a main area that scrolls under an open conversation, even with an overlay scrollbar (R-UI-62)", () => {
    const { window, audit } = productAudit('<div class="main" style="overflow-y:auto"><section class="page-agent">x</section></div>');
    const main = window.document.querySelector('.main');
    Object.defineProperty(main, 'clientHeight', { value: 800 });
    Object.defineProperty(main, 'scrollHeight', { value: 1781, configurable: true });
    expect(audit().productRules.filter(item => item.rule === 'R-UI-62').map(item => item.reason)).toEqual(['A conversation scrolls inside itself, yet the main area around it scrolls 981px']);
    Object.defineProperty(main, 'scrollHeight', { value: 800, configurable: true });
    expect(audit().productRules.filter(item => item.rule === 'R-UI-62')).toEqual([]);
    main.querySelector('.page-agent').hidden = true;
    Object.defineProperty(main, 'scrollHeight', { value: 1781 });
    expect(audit().productRules.filter(item => item.rule === 'R-UI-62')).toEqual([]);
  });
  it("rejects a slime on a fraction of a pixel (R-UI-63)", () => {
    const { window, audit } = productAudit('<span class="mb-av-slime" style="overflow:visible"><svg></svg></span>');
    const slime = window.document.querySelector(".mb-av-slime");
    const sized = (width, height) => { slime.getBoundingClientRect = () => ({ width, height, left: 10, top: 10, right: 10 + width, bottom: 10 + height, x: 10, y: 10 }); };
    sized(27.67, 27.67);
    expect(audit().productRules.filter(item => item.rule === "R-UI-63")).toHaveLength(1);
    sized(28, 28);
    expect(audit().productRules.filter(item => item.rule === "R-UI-63")).toEqual([]);
  });
  it("rejects a crop on a slime (R-UI-54)", () => {
    const { window, audit } = productAudit('<span class="mb-av-slime" style="overflow:hidden"><svg></svg></span>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-54')).toHaveLength(1);
    window.document.querySelector('.mb-av-slime').style.overflow = 'visible';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-54')).toEqual([]);
    const face = window.document.querySelector('.mb-av-slime');
    face.style.overflow = 'clip';
    face.style.setProperty('overflow-clip-margin', '100px');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-54')).toEqual([]);
    face.style.setProperty('overflow-clip-margin', '99px');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-54')).toHaveLength(1);
  });
  it("rejects words that hug the edge of a hover fill (R-UI-53)", () => {
    const { window, audit } = productAudit('<div class="row" style="color:rgb(10,10,10);background-color:rgb(255,255,255)">Quick questions</div><style>.row:hover{background-color:rgb(230,230,230)}</style>');
    const row = window.document.querySelector('.row');
    row.getBoundingClientRect = () => ({ left: 20, top: 10, right: 220, bottom: 50, width: 200, height: 40 });
    const inset = px => { window.Range.prototype.getClientRects = () => [{ left: 20 + px, right: 120 + px }]; };
    inset(2);
    expect(audit().productRules.filter(item => item.rule === 'R-UI-53').map(item => item.class)).toEqual(['row']);
    inset(8);
    expect(audit().productRules.filter(item => item.rule === 'R-UI-53')).toEqual([]);
  });
  it("rejects a second dots style in the conversation", () => {
    const { window, audit } = productAudit('<section class="page-agent"><p class="ans thinking"><span class="think"></span></p></section>');
    expect(audit().productRules).toContainEqual(expect.objectContaining({ rule: 'R-UI-38', reason: 'Conversation waiting must use the shared work line' }));
    window.document.querySelector('.ans').remove();
    expect(audit().productRules).toEqual([]);
  });
  it("checks visible primary calendar choices without counting the hidden responsive copy", () => {
    const window = new Window();
    window.document.body.innerHTML = '<nav id="nav"><button class="mb-chief"></button></nav><aside hidden><button data-drag-member="0"></button><button data-drag-member="1"></button></aside><div><button data-drag-member="1"></button><button data-drag-member="0"></button></div>';
    for (const element of window.document.querySelectorAll('div button')) element.getBoundingClientRect = () => ({ width: 100, height: 30 });
    window.__look = { data: { primaryId: 1, members: [{ id: 0 }, { id: 1 }] }, calls: [] };
    vi.stubGlobal('document', window.document); vi.stubGlobal('window', window);
    try {
      expect(checkRendered('primary-calendar').members).toEqual([1, 0]);
      window.document.querySelector('div').innerHTML = '<button data-drag-member="0"></button><button data-drag-member="1"></button>';
      for (const element of window.document.querySelectorAll('div button')) element.getBoundingClientRect = () => ({ width: 100, height: 30 });
      expect(() => checkRendered('primary-calendar')).toThrow(/exchange/);
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects mismatched adjacent import heights and schedule widths (R-UI-17)", () => {
    const { window, audit } = productAudit('<div class="mp-add"><input><button class="btn" style="border:1px solid gray">Import</button></div><label class="au-field"><button class="sel">End</button><input class="mb-fin"></label>');
    const input = window.document.querySelector('.mp-add input');
    input.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 54, width: 100, height: 44 });
    const count = window.document.querySelector('.mb-fin');
    count.getBoundingClientRect = () => ({ left: 10, top: 10, right: 128, bottom: 40, width: 118, height: 30 });
    expect(audit().productRules.filter(item => item.rule === 'R-UI-17')).toHaveLength(2);
    input.getBoundingClientRect = count.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("lets short dictionary entries add columns instead of treating them as long choices", () => {
    const { audit } = productAudit('<div class="wgrid"><div class="wrow"></div><div class="wrow"></div><div class="wrow"></div></div>');
    expect(audit().productRules).toEqual([]);
  });
  it("gives sidebar icon controls no surface of their own", () => {
    const { audit } = productAudit('<nav id="nav"><div class="mb-top"><button class="btn icon mb-tool" data-col="other" style="background:#fff;border:1px solid #888"></button></div></nav>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-16', 'R-UI-18']);
  });
  it("allows the specified round sidebar action surface while rejecting unrelated icon surfaces", () => {
    const { audit } = productAudit('<nav class="side"><button class="btn icon sidebar-tool" style="border:0;background:gray"></button></nav><button class="btn icon" style="border:0;background:gray"></button>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-16')).toHaveLength(1);
  });
  it("lets the guide's round arrow keep the grey surface of the pill it replaced, and no other icon (R-UI-16)", () => {
    const { audit } = productAudit('<div class="ob-foot"><div class="action-row ob-actions"><button class="btn icon ob-back" style="border:0;background:gray"></button><button class="btn pri" style="border:1px solid gray">Next</button></div></div><button class="btn icon" style="border:0;background:gray"></button>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-16')).toHaveLength(1);
  });
  it("rejects icon surfaces, incorrect glyph sizing and off-center icons (R-UI-16/19)", () => {
    const { window, audit } = productAudit('<button class="btn icon" style="border:0;background:gray"><svg class="i"></svg></button>');
    const button = window.document.querySelector('button'), glyph = button.firstElementChild;
    glyph.getBoundingClientRect = () => ({ left: 10, top: 10, right: 24, bottom: 24, width: 14, height: 14 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-16', 'R-UI-19', 'R-UI-19']);
    button.style.background = 'transparent';
    glyph.getBoundingClientRect = () => ({ left: 52, top: 17, right: 68, bottom: 33, width: 16, height: 16 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects screen actions that inherit light text on a light button (R-UI-22)", () => {
    const { window, audit } = productAudit('<div class="desktop-screen"><button class="btn" data-desktop="retry" style="border:1px solid gray;color:rgb(240,240,240);background:rgb(255,255,255)">Open</button></div>');
    expect(audit().productRules.some(rule => rule.rule === 'R-UI-22')).toBe(true);
    window.document.querySelector('button').style.backgroundColor = 'rgb(23,23,23)';
    expect(audit().productRules.some(rule => rule.rule === 'R-UI-22')).toBe(false);
  });
  it("rejects low-contrast selected dates, including hover overrides (R-UI-22)", () => {
    const { window, audit } = productAudit('<div class="au-month-grid"><button class="btn" aria-pressed="true" style="border:0;color:rgb(30,30,30);background:rgb(40,40,40)">28</button></div>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-22']);
    window.document.querySelector('button').style.color = 'white';
    expect(audit().productRules).toEqual([]);
  });
  it("rejects repeated settings subtitles and wrapped shortcut rows (R-UI-02/17)", () => {
    const { window, audit } = productAudit('<div class="modal-body"><p class="purpose">Settings description</p></div><div class="page-overview"><div class="kc-row"><span class="kc-name">Ask</span><span class="kc-keys">Right Alt + Space</span></div></div>');
    window.document.querySelector('.kc-keys').getBoundingClientRect = () => ({ left: 10, top: 45, right: 110, bottom: 75, width: 100, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-02', 'R-UI-17']);
  });
  it("keeps a gap between the model source scrollport and its footer action (R-UI-17)", () => {
    const { window, audit } = productAudit('<aside><div class="mc-source-list"></div><button class="btn" style="border:1px solid gray">Connect</button></aside>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-17']);
    window.document.querySelector('button').getBoundingClientRect = () => ({ left: 10, top: 48, right: 110, bottom: 78, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects a clipped selected model source (R-UI-01)", () => {
    const { window, audit } = productAudit('<div class="mc-source-list"><button class="btn mc-source" aria-pressed="true">OpenRouter</button></div>');
    const selected = window.document.querySelector('button');
    selected.getBoundingClientRect = () => ({ left: 10, top: 30, right: 110, bottom: 60, width: 100, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-01']);
    selected.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects small onboarding headlines and narrow primary actions (R-UI-37)", () => {
    const { window, audit } = productAudit('<div class="ob-col"><h2 style="font-size:20px">Welcome</h2></div><div class="ob-actions"><button class="btn pri" style="border:1px solid gray">Start</button></div>');
    window.document.querySelector('.ob-actions').getBoundingClientRect = () => ({ left: 10, top: 10, right: 410, bottom: 40, width: 400, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-37', 'R-UI-37']);
    window.document.querySelector('h2').style.fontSize = '28px';
    window.document.querySelector('button').getBoundingClientRect = () => ({ left: 10, top: 10, right: 410, bottom: 40, width: 400, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("holds an onboarding step's two round buttons together in the middle, the way back at the left of the primary (R-UI-37)", () => {
    const { window, audit } = productAudit('<div class="ob-foot"><div class="action-row ob-actions ob-pair"><button class="btn icon ob-prev" aria-label="Back" title="Back" style="border:0"></button><button class="btn icon pri ob-go" aria-label="Next" title="Next" style="border:0"></button></div></div>');
    const foot = window.document.querySelector('.ob-foot'), [back, primary] = window.document.querySelectorAll('button');
    foot.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 84, width: 1000, height: 84 });
    back.getBoundingClientRect = () => ({ left: 446, top: 12, right: 494, bottom: 60, width: 48, height: 48 });
    primary.getBoundingClientRect = () => ({ left: 506, top: 12, right: 554, bottom: 60, width: 48, height: 48 });
    // Two circles of one size, side by side in the middle: a primary as wide as its drawing is right here, since only the
    // welcome's pill fills its row.
    expect(audit().productRules).toEqual([]);
    // One at each end of the row is the foot of 2026-11-11 afternoon that the owner sent back.
    back.getBoundingClientRect = () => ({ left: 50, top: 12, right: 98, bottom: 60, width: 48, height: 48 });
    primary.getBoundingClientRect = () => ({ left: 902, top: 12, right: 950, bottom: 60, width: 48, height: 48 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-37']);
    // A wide pill beside a small circle is the foot of that morning.
    back.getBoundingClientRect = () => ({ left: 320, top: 12, right: 364, bottom: 56, width: 44, height: 44 });
    primary.getBoundingClientRect = () => ({ left: 372, top: 12, right: 680, bottom: 56, width: 308, height: 44 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-37']);
  });
  it("keeps an onboarding choice's control on the right of its name, inside its card (R-UI-35)", () => {
    const { window, audit } = productAudit('<div class="ob-item"><span class="ob-tx">Notion</span><span class="ob-ctl"><button class="btn" style="border:1px solid gray">Sign in</button></span></div>');
    const rect = (left, right, top = 0, bottom = 72) => () => ({ left, right, top, bottom, width: right - left, height: bottom - top });
    const item = window.document.querySelector('.ob-item');
    item.getBoundingClientRect = rect(0, 400);
    item.querySelector('.ob-tx').getBoundingClientRect = rect(40, 260, 20, 52);
    item.querySelector('.ob-ctl').getBoundingClientRect = rect(200, 380, 20, 52);
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-35']);
    item.querySelector('.ob-ctl').getBoundingClientRect = rect(280, 380, 20, 52);
    expect(audit().productRules).toEqual([]);
    item.querySelector('.ob-ctl').getBoundingClientRect = rect(280, 420, 20, 52);
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-35']);
  });
  it("rejects duplicate custom and native tooltips", () => {
    const { audit } = productAudit('<button data-tooltip="Save" title="Save">Save</button><button data-tooltip="Open"><svg><title>Open</title></svg></button><button title="Native">Native</button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-26', 'R-UI-26']);
  });
  it("rejects visible row destruction but permits overflow menus", () => {
    const { audit } = productAudit('<div class="mp-resource"><button class="danger">Delete</button></div><div role="menu"><div class="mp-resource"><button class="danger">Delete</button></div></div><div class="mp-resource" hidden><button class="danger">Delete</button></div>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-11')).toHaveLength(1);
  });
  it("rejects a button that destroys standing open on a page (R-UI-56)", () => {
    const rule = html => productAudit(html).audit().productRules.filter(item => item.rule === 'R-UI-56').map(item => item.text || item.tag);
    // In the open: the words a clear, a delete or a removal goes by, on a word button or an icon's label, in each language.
    expect(rule('<section class="mem"><div class="action-row"><button class="btn danger">全部清除</button></div></section>')).toEqual(['全部清除']);
    expect(rule('<div class="row"><button class="btn danger">確定清除？</button></div>')).toEqual(['確定清除？']);
    expect(rule('<div class="row"><button class="btn icon" aria-label="移除 小晴"></button></div><div class="row"><button class="btn icon" aria-label="Delete Paraformer"></button></div>')).toHaveLength(2);
    expect(rule('<div class="row"><button class="btn">Clear all</button></div><div class="row"><button class="btn">すべて消去</button></div><div class="row"><button class="btn">音声入力の履歴を削除</button></div>')).toHaveLength(3);
    // The ⋯ and the menu it opens are where they belong, and the Settings window is still a page.
    expect(rule('<div class="row"><button class="btn icon" data-overflow aria-label="「共同記憶」的選項"></button></div><div class="menu" role="menu"><button role="menuitem" class="danger">全部清除</button></div>')).toEqual([]);
    expect(rule('<div class="modal" role="dialog"><div class="row"><button class="btn danger">清除</button></div></div>')).toEqual(['清除']);
    // A dialog about one thing, a model's own question, what is being composed, and words that destroy nothing.
    for (const allowed of [
      '<div class="mb-dialog" role="dialog"><button class="btn danger">刪除例行任務</button></div>',
      '<div class="cs-dialog" role="dialog"><button class="btn danger">移除</button></div>',
      '<div class="lm-row"><div class="lm-confirm"><button class="btn danger">刪除</button></div></div>',
      '<div class="composer"><button class="chip-x" aria-label="移除檔案"></button></div>',
      '<section class="draft-panel"><button class="btn icon" aria-label="移除 紫苑"></button></section>',
      '<button class="mp-star" aria-label="Remove from favourites: Luna"></button>',
      '<div class="row"><button class="btn">從最愛移除</button></div>',
      '<div class="row"><button class="btn">Clearly a longer label</button></div>',
      '<div class="row"><button class="btn">刪除舊檔案的每週例行任務，以及把整理好的結果寄給主人</button></div>',
      '<div class="row" hidden><button class="btn danger">清除</button></div>',
    ]) expect(rule(allowed), allowed).toEqual([]);
  });
  it("permits only the counted Settings Data heading actions requested by R-MP-02", () => {
    const rule = html => productAudit(html).audit().productRules.filter(item => item.rule === 'R-UI-56');
    const heading = what => `<section class="data-section"><div class="data-heading"><h2>Records</h2><button class="btn" data-act="data-clear" data-what="${what}">Delete all</button></div></section>`;
    expect(rule(`<div class="modal-body">${heading('dictation')}${heading('conversation')}</div>`)).toEqual([]);
    expect(rule(heading('dictation'))).toHaveLength(1);
    expect(rule(`<div class="modal-body">${heading('other')}</div>`)).toHaveLength(1);
    expect(rule('<div class="modal-body"><button data-act="data-clear" data-what="dictation">Delete all</button></div>')).toHaveLength(1);
  });
  it("rejects a ⋯ that a right click on its row does not reach (R-UI-44)", () => {
    const { window, audit } = productAudit('<div class="row"><button class="btn icon" data-overflow aria-label="更多"></button></div>');
    expect(audit().productRules).toEqual([]);
    const orphan = { tag: "button", id: "", class: "btn icon", text: "更多" };
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], null, [], [orphan]);
    expect(result.productRules.map(item => item.rule)).toEqual(["R-UI-44"]);
    expect(failedChecks({ ...result, runtimeErrors: [] })).toBe(true);
  });
  it("permits the scoped floating latest action without relaxing ordinary icon rules", () => {
    const { audit } = productAudit('<div class="page-agent"><div class="ra-stage"><button class="btn icon conversation-latest" style="border:1px solid gray;background:white"></button></div></div>' +
      '<div class="peer-chat"><button class="btn icon conversation-latest peer-latest" style="border:1px solid gray;background:white"></button></div><button class="btn icon conversation-latest" style="border:1px solid gray;background:white"></button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-16', 'R-UI-18']);
  });
  it("checks text frames and bare icon borders", () => {
    const { audit } = productAudit('<button class="btn" style="border: none">Save</button><button class="btn icon" style="border: 1px solid red">X</button><button class="btn" style="border: 1px solid red">Cancel</button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-18', 'R-UI-18']);
  });
  it("allows a quiet routine inspection link only inside its reply origin", () => {
    const { audit } = productAudit('<div class="chat-message"><div class="routine-origin"><button class="btn routine-run-link" data-act="open-routine" style="border:0">Sample routine</button></div></div><button class="btn routine-run-link" data-act="open-routine" style="border:0">Save</button>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-18').map(item => item.text)).toEqual(['Save']);
  });
  it("allows a soft pending-question row only in its conversation container", () => {
    const { audit } = productAudit('<div class="pending-questions"><button class="btn sm pending-question" style="border:0">待回答</button></div><button class="btn pending-question" style="border:0">Save</button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-18']);
  });
  it("allows the owner's quiet Today navigation only inside its arrow group", () => {
    const { audit } = productAudit('<div class="au-date-nav"><button class="btn au-today" style="border:0">Today</button></div><button class="btn au-today" style="border:0">Save</button>');
    expect(audit().productRules.map(item=>item.rule)).toEqual(['R-UI-18']);
  });
  it("checks rendered primary and destructive action positions", () => {
    const { window, audit } = productAudit('<div class="mb-dialog"><div class="action-row"><button class="pri">Save</button><span class="action-destructive"><button>Delete</button></span></div></div>');
    const primary = window.document.querySelector('.pri');
    primary.getBoundingClientRect = () => ({ left: 0, top: 10, right: 50, bottom: 40, width: 50, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-27', 'R-UI-27']);
  });
  it("holds the guide's row to the rule: the way back at the left of the primary passes and a stack over it does not", () => {
    const { window, audit } = productAudit('<div class="ob-foot"><div class="action-row ob-actions ob-pair"><button class="btn icon ob-prev" aria-label="Back" title="Back" style="border:0"></button><button class="btn icon pri ob-go" aria-label="Next" title="Next" style="border:0"></button></div></div>');
    const [back, primary] = window.document.querySelectorAll('button');
    window.document.querySelector('.ob-foot').getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 84, width: 1000, height: 84 });
    back.getBoundingClientRect = () => ({ left: 446, top: 12, right: 494, bottom: 60, width: 48, height: 48 });
    primary.getBoundingClientRect = () => ({ left: 506, top: 12, right: 554, bottom: 60, width: 48, height: 48 });
    expect(audit().productRules.map(item => item.rule)).not.toContain('R-UI-27');
    back.getBoundingClientRect = () => ({ left: 0, top: 50, right: 300, bottom: 90, width: 300, height: 40 });
    primary.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 });
    expect(audit().productRules.map(item => item.rule)).toContain('R-UI-27');
  });
  it("distinguishes date choices and navigation from ordinary text actions", () => {
    const { audit } = productAudit('<div class="au-month-grid"><button class="btn" style="border:0">25</button></div><button class="btn mb-panel-back" style="border:0">Members</button><button class="btn mc-source" style="border:0">Provider</button><button class="btn cs-main" style="border:0">Notion service details</button><button class="btn ho-row" style="border:0">Dentist</button><button class="btn conversation-new" style="border:0">New conversation</button>');
    expect(audit().productRules.map(item => item.text)).toEqual(['New conversation']);
  });
  it.each(scenes.filter(scene => scene.name.endsWith("composer-learn")))("keeps $name correction data distinct from untranslated UI", scene => {
    const window = new Window(), { before, after } = scene.fixture.dictationText;
    expect(scene.steps.find(step => step.action === "dictation-paste").text).toBe(before);
    expect(scene.steps.find(step => step.action === "type").text).toBe(after);
    window.document.body.innerHTML = `<p>${after}</p><p>SampleToolX</p><button>Message</button>`;
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const allowed = Object.values(scene.fixture.dictationText).flatMap(text => text.match(/[A-Za-z]{2,}/g) ?? []).map(word => word.toLowerCase());
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], allowed).mixedLanguage.map(item => item.word)).toEqual(["Message"]);
  });
  it.each(["# Heading", "## Heading", "Text\n  ### Heading", "- [ ] Pending", "**bold**", "```js\ncode\n```"])("rejects visible raw Markdown: %s", text => {
    const window = new Window();
    const paragraph = window.document.createElement("p");
    paragraph.textContent = text; window.document.body.append(paragraph);
    paragraph.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }), runtimeErrors: [] };
    expect(result.rawMarkdown).toHaveLength(1);
    expect(result.rawMarkdown[0].text).toBe(text);
    expect(failedChecks(result)).toBe(true);
  });
  it("ignores rendered formatting, ordinary hashes, hidden text and Markdown outside a scrollport", () => {
    const window = new Window();
    window.document.body.innerHTML = '<h3>Conclusion</h3><p><strong>Owner</strong>: next step, issue #123, color #fff</p><div hidden>### Hidden</div><div style="overflow-y:auto"><p id="offscreen">**older**</p></div>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    window.document.querySelector("#offscreen").getBoundingClientRect = () => ({ left: 10, top: 200, right: 100, bottom: 230, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }).rawMarkdown).toEqual([]);
  });
  it("permits Markdown inside an editor field but still rejects it in the text beside the field", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea id="skill-text">---\nname: weekly\n---\n# Weekly\n\n- [ ] one\n**bold**</textarea><p>## Heading</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }).rawMarkdown.map(item => item.text)).toEqual(["## Heading"]);
  });
  it("does not translate user-entered textarea data but still audits its UI attributes", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="Message">C:/Work/Team notes</textarea><textarea aria-label="名稱">User supplied text</textarea>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Message"]);
  });
  it("treats an IANA time-zone id as an identifier, not as English copy", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>台北 · Asia/Taipei</p><p>America/Argentina/Buenos_Aires</p><p>Asia required</p><p>Europe</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Asia", "required", "Europe"]);
  });
  it("allows complete product names without allowing their ordinary English words", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>Claude Code</p><p>claude code</p><p>Code required</p><p>Claude Coder</p><p>KEY=value</p><p>value required</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], ["claude", "claude code", "key=value"]).mixedLanguage.map(item => item.word)).toEqual(["Code", "required", "Coder", "value"]);
  });
  it("allows the exact external Composio menu path while rejecting English settings labels", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>Composio「Settings → Project Settings → API Keys」</p><button>Settings</button><button>API Keys</button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], LATIN_NAMES.map(name => name.toLowerCase())).mixedLanguage.map(item => item.word)).toEqual(["Settings", "Keys"]);
  });
  it("allows the exact command-template token while rejecting input used as English prose", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="指令範本；以 {input} 代入後續文字"></textarea><p>input required</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["input", "required"]);
  });
  it("allows protocol names while still rejecting English prose beside technical examples", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="Authorization=Bearer ..."></textarea><textarea placeholder=\'{"mcpServers": {}}\'></textarea><p>Send request</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], ["authorization", "bearer", "mcpservers"]);
    expect(result.mixedLanguage.map(item => item.word)).toEqual(["Send", "request"]);
  });
  it("rejects interface copy left in English in a Chinese window, allowing data and product names", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="Message 紫苑"></textarea><button aria-label="問拉斐爾">Google Calendar</button><p>Finance 已建立</p><a href="#">研究訪談摘要.pdf</a>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }, [], ["google", "calendar", "finance"]), runtimeErrors: [] };
    expect(result.mixedLanguage.map(item => item.word)).toEqual(["Message"]);
    expect(failedChecks(result)).toBe(true);
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).mixedLanguage).toEqual([]);
  });
  it("rejects non-finite durations in visible work summaries", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button class="work-toggle">已處理 NaN 秒</button><div hidden><span class="step-ms">Infinity</span></div>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }, []), runtimeErrors: [] };
    expect(result.invalidDurations).toHaveLength(1);
    expect(failedChecks(result)).toBe(true);
  });
  it("reports visible raw translation keys and native controls, ignoring hidden pages", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>members.missingLabel</p><select><option>One</option></select><input type="time"><div hidden><select></select><p>settings.hidden</p></div>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, ["members", "settings"]);
    expect(result.missingI18nKeys.map(item => item.key)).toEqual(["members.missingLabel"]);
    expect(result.nativeControls.map(item => item.tag)).toEqual(["select", "input"]);
  });

  it("fails an element with the hidden attribute that a stylesheet draws anyway (R-UI-140)", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div id="tab" hidden style="display:flex"><span>Slimes</span></div><div id="closed" hidden><p id="inner" hidden style="display:block">Inner</p></div><div id="held" hidden style="display:flex"></div>';
    const box = { left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 };
    for (const element of window.document.querySelectorAll("*")) { element.getBoundingClientRect = () => box; element.getClientRects = () => []; }
    // Only the drawn one has a box: `inner` sits in a hidden parent and `held` is hidden yet its own rule is overridden with no box in the tree.
    window.document.getElementById("tab").getClientRects = () => [box];
    const drawn = auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-140");
    expect(drawn.map(item => item.id)).toEqual(["tab"]);
    window.document.getElementById("tab").style.display = "none";
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-140")).toEqual([]);
  });

  it("fails a settings card whose rows are laid out two ways (R-UI-144)", () => {
    const window = new Window();
    const rowHTML = (name, cls = "") => `<div class="row ${cls}" id="${name}"><div class="lbl">L</div><div class="ctl">C</div></div>`;
    window.document.body.innerHTML = `<div class="slist">${rowHTML("a")}${rowHTML("b")}${rowHTML("m", "row-model")}</div>`;
    const place = (selector, rect) => { window.document.querySelector(selector).getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }); };
    const beside = id => { place(`#${id}`, { left: 0, top: 0, right: 400, bottom: 60 }); place(`#${id} .lbl`, { left: 0, top: 10, right: 168, bottom: 30 }); place(`#${id} .ctl`, { left: 168, top: 10, right: 400, bottom: 40 }); };
    const stacked = id => { place(`#${id}`, { left: 0, top: 0, right: 400, bottom: 90 }); place(`#${id} .lbl`, { left: 0, top: 10, right: 168, bottom: 30 }); place(`#${id} .ctl`, { left: 40, top: 40, right: 400, bottom: 70 }); };
    place(".slist", { left: 0, top: 0, right: 400, bottom: 300 });
    const faults = () => auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-144").map(item => item.id);
    beside("a"); stacked("b"); stacked("m");
    expect(faults()).toEqual(["b"]);
    beside("b");
    expect(faults()).toEqual([]);
    stacked("a"); stacked("b");
    expect(faults()).toEqual([]);
  });

  it("fails a truncated title left less room than one letter (R-UI-143)", () => {
    const window = new Window();
    window.document.body.innerHTML = '<b class="title" style="text-overflow:ellipsis;font-size:12px">專案筆記</b>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const title = window.document.querySelector("b");
    const reasons = () => auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-143");
    Object.defineProperty(title, "scrollWidth", { value: 48, configurable: true });
    Object.defineProperty(title, "clientWidth", { value: 9, configurable: true });
    expect(reasons()).toHaveLength(1);
    Object.defineProperty(title, "clientWidth", { value: 30, configurable: true });
    expect(reasons()).toEqual([]);
  });

  it("fails a calendar chip whose time is cut by the chip's edge (R-UI-142)", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button class="cal-chip"><div class="cal-chip-copy"><time>11:00</time><b>Visit</b></div></button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const time = window.document.querySelector("time");
    const reasons = () => auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-142");
    Object.defineProperty(time, "clientWidth", { value: 24, configurable: true });
    Object.defineProperty(time, "scrollWidth", { value: 31, configurable: true });
    expect(reasons()).toHaveLength(1);
    Object.defineProperty(time, "scrollWidth", { value: 24, configurable: true });
    expect(reasons()).toEqual([]);
  });

  it("fails a caption strip that is a block of another colour than the surface just below it (R-UI-141)", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="window-chrome"></div><div id="page"></div><div id="panel"></div>';
    const rects = { ".window-chrome": { left: 296, top: 0, right: 1920, bottom: 32, width: 1624, height: 32 }, "#page": { left: 296, top: 32, right: 1920, bottom: 1080, width: 1624, height: 1048 }, "#panel": { left: 1460, top: 0, right: 1920, bottom: 1080, width: 460, height: 1080 } };
    for (const [selector, rect] of Object.entries(rects)) window.document.querySelector(selector).getBoundingClientRect = () => rect;
    window.document.querySelector("#page").style.backgroundColor = "rgb(10, 10, 10)";
    window.document.querySelector("#panel").style.backgroundColor = "rgb(0, 0, 0)";
    const strip = () => auditDocument(window.document, { width: 1920, height: 1080 }, []).productRules.filter(item => item.rule === "R-UI-141");
    const stack = { under: ["#page"], over: ["#panel", "#page"] };
    // The panel shows at the strip's right end while the page lies below the strip: a black block over a page of another colour.
    window.document.elementsFromPoint = (x, y) => (y < 32 && x >= 1460 ? stack.over : stack.under).map(selector => window.document.querySelector(selector));
    expect(strip().map(item => item.rule)).toEqual(["R-UI-141"]);
    // Where the strip is the page's own surface (the fix), nothing stands apart.
    window.document.elementsFromPoint = () => [window.document.querySelector("#page")];
    expect(strip()).toEqual([]);
    // Under a dialog's dim the strip has no surface of its own: a bright one over the dim is a broken layer.
    window.document.body.insertAdjacentHTML("beforeend", '<div class="mb-scrim"></div>');
    const scrim = window.document.querySelector(".mb-scrim");
    window.document.querySelector(".window-chrome").style.backgroundColor = "rgb(255, 255, 255)";
    // A scrim that is kept closed dims nothing, so the strip's own surface is no fault.
    scrim.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    expect(strip()).toEqual([]);
    scrim.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 });
    expect(strip().map(item => item.rule)).toEqual(["R-UI-141"]);
    window.document.querySelector(".window-chrome").style.backgroundColor = "transparent";
    expect(strip()).toEqual([]);
  });

  it("leaves a message whose edge lies within the strip's height: a thread passes under the strip (R-UI-141)", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="window-chrome"></div><div id="page"><div id="scroll" style="overflow-y: auto"><div id="bubble"></div></div></div>';
    const rects = { ".window-chrome": { left: 348, top: 0, right: 1120, bottom: 32, width: 772, height: 32 }, "#page": { left: 348, top: 0, right: 1120, bottom: 900, width: 772, height: 900 }, "#scroll": { left: 348, top: 0, right: 1120, bottom: 770, width: 772, height: 770 }, "#bubble": { left: 391, top: 9, right: 830, bottom: 152, width: 439, height: 143 } };
    for (const [selector, rect] of Object.entries(rects)) window.document.querySelector(selector).getBoundingClientRect = () => rect;
    window.document.querySelector("#page").style.backgroundColor = "rgb(255, 255, 255)";
    window.document.querySelector("#bubble").style.backgroundColor = "rgb(247, 247, 247)";
    const strip = () => auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-141");
    const at = selectors => selectors.map(selector => window.document.querySelector(selector));
    // The bubble's top edge (y = 9) lies between the two samples, in the scroller that reaches under the strip.
    window.document.elementsFromPoint = (x, y) => at(y < 9 ? ["#scroll", "#page"] : ["#bubble", "#scroll", "#page"]);
    expect(strip()).toEqual([]);
    // The same colours with no scroller around the bubble are a block of another colour under the strip.
    window.document.querySelector("#scroll").style.overflowY = "visible";
    expect(strip().map(item => item.rule)).toEqual(["R-UI-141"]);
  });

  it("leaves the window buttons their backing over a picture: a cover the owner chose is no surface to compare (R-UI-141)", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="window-chrome"><div class="window-controls"></div></div><div id="page"><img id="cover"></div>';
    const rects = { ".window-chrome": { left: 348, top: 0, right: 1120, bottom: 32, width: 772, height: 32 }, ".window-controls": { left: 982, top: 0, right: 1120, bottom: 32, width: 138, height: 32 }, "#page": { left: 348, top: 0, right: 1120, bottom: 900, width: 772, height: 900 }, "#cover": { left: 348, top: 0, right: 1120, bottom: 176, width: 772, height: 176 } };
    for (const [selector, rect] of Object.entries(rects)) window.document.querySelector(selector).getBoundingClientRect = () => rect;
    window.document.querySelector("#page").style.backgroundColor = "rgb(10, 10, 10)";
    window.document.querySelector(".window-controls").style.backgroundColor = "rgba(10, 10, 10, 0.72)";
    const strip = () => auditDocument(window.document, { width: 1120, height: 900 }, []).productRules.filter(item => item.rule === "R-UI-141");
    const at = selectors => selectors.map(selector => window.document.querySelector(selector));
    // The buttons' backing stands over the cover picture at the strip's right end, and the bare picture just below it.
    window.document.elementsFromPoint = (x, y) => at(y < 32 && x >= 982 ? [".window-controls", "#cover", "#page"] : ["#cover", "#page"]);
    expect(strip()).toEqual([]);
    // The same kind of backing over a plain surface, with no picture under it, is still a block of its own colour.
    window.document.querySelector(".window-controls").style.backgroundColor = "rgba(200, 200, 200, 0.72)";
    window.document.elementsFromPoint = (x, y) => at(y < 32 && x >= 982 ? [".window-controls", "#page"] : ["#page"]);
    expect(strip().map(item => item.rule)).toEqual(["R-UI-141"]);
  });

  it("distinguishes explicit provider JSON paths from untranslated keys elsewhere", () => {
    const window = new Window();
    window.document.body.innerHTML = '<code data-json-paths>data.issue.id · event.data.title · members.missingLabel</code><p>data.issue.id</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, ["data", "event", "members"]).missingI18nKeys.map(item => item.key)).toEqual(["members.missingLabel", "data.issue.id"]);
  });
  it("fails horizontal overflow and reports controls outside the viewport", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button id="outside">Save</button>';
    const button = window.document.querySelector("button");
    button.getBoundingClientRect = () => ({ left: 1100, top: 10, right: 1200, bottom: 40, width: 100, height: 30 });
    Object.defineProperty(window.document.documentElement, "scrollWidth", { value: 1200 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }, []), runtimeErrors: [] };
    expect(result.outsideViewport.map(item => item.id)).toEqual(["outside"]);
    expect(result.horizontalOverflow.document).toBe(true);
    expect(failedChecks(result)).toBe(true);
  });
  it("keeps what is below the fold of a document that scrolls as a whole, as a saved report, but never in the app's still body", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p id="below">Team</p><button id="aside">Save</button>';
    window.document.querySelector("#below").getBoundingClientRect = () => ({ left: 10, top: 1400, right: 300, bottom: 1430, width: 290, height: 30 });
    window.document.querySelector("#aside").getBoundingClientRect = () => ({ left: 1100, top: 10, right: 1200, bottom: 40, width: 100, height: 30 });
    Object.defineProperty(window.document.documentElement, "scrollHeight", { value: 2000 });
    Object.defineProperty(window.document.documentElement, "clientHeight", { value: 900 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).outsideViewport.map(item => item.id)).toEqual(["aside"]);
    window.document.body.style.overflow = "hidden";
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).outsideViewport.map(item => item.id)).toEqual(["below", "aside"]);
  });
  it("excludes content deliberately outside a scrolling container", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div style="overflow-y: auto"><button>Older item</button></div>';
    const container = window.document.querySelector("div"), button = window.document.querySelector("button");
    container.getBoundingClientRect = () => ({ left: 10, top: 10, right: 300, bottom: 100, width: 290, height: 90 });
    button.getBoundingClientRect = () => ({ left: 10, top: 910, right: 200, bottom: 940, width: 190, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).outsideViewport).toEqual([]);
  });
  it("does not call a native input visible when it is outside its scrollport", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div style="overflow-y: auto"><input type="time" aria-label="settings.offscreen"></div>';
    const container = window.document.querySelector("div"), input = window.document.querySelector("input");
    container.getBoundingClientRect = () => ({ left: 10, top: 10, right: 300, bottom: 100, width: 290, height: 90 });
    input.getBoundingClientRect = () => ({ left: 10, top: 200, right: 200, bottom: 230, width: 190, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, ["settings"]);
    expect(result.nativeControls).toEqual([]);
    expect(result.missingI18nKeys).toEqual([]);
  });
});


it("rejects divergent store add classes, row markup and card styling", () => {
  const browser = new Window();
  // The apps of the one view: a row is the mark on its tile and the name, and at the right 連結 (or its state); nothing it would have to explain.
  const row = `<div class="cs-card" style="display:flex"><button class="btn cs-main" data-conn="open-store"><span class="cs-tile"></span><span class="tx"><span class="nm">App</span></span></button><button class="btn cs-connect" data-conn="join">連結</button></div>`;
  browser.document.body.innerHTML = row + row;
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = browser.document; globalThis.window = browser;
  try {
    expect(checkRendered("plugins-store-rows")).toEqual({ check: "plugins-store-rows", rows: 2 });
    const first = browser.document.querySelector('.cs-card');
    const tx = first.querySelector('.tx');
    tx.insertAdjacentHTML('beforeend', '<span class="sub">What the app does</span>');
    expect(() => checkRendered("plugins-store-rows")).toThrow("only its waiting sign-in");
    tx.querySelector('.sub').remove();
    tx.insertAdjacentHTML('beforeend', '<span class="sub wait">…</span>');
    expect(checkRendered("plugins-store-rows").rows).toBe(2);
    tx.querySelector('.sub').remove();
    first.querySelector('.nm').insertAdjacentHTML('beforeend', '<b class="need">Needs a key</b>');
    expect(() => checkRendered("plugins-store-rows")).toThrow("nothing it would have to explain");
    first.querySelector('.need').remove();
    first.style.display = 'grid';
    expect(() => checkRendered("plugins-store-rows")).toThrow("one line with nothing it would have to explain");
    first.style.display = 'flex';
    const second = browser.document.querySelectorAll('.cs-card')[1];
    const add = second.querySelector('[data-conn="join"]');
    add.classList.add('pri');
    expect(() => checkRendered("plugins-store-rows")).toThrow("same class list");
    add.classList.remove('pri');
    const main = second.querySelector('.cs-main');
    const oldMain = browser.document.createElement('div'); oldMain.className = 'cs-main';
    oldMain.innerHTML = main.innerHTML; main.replaceWith(oldMain);
    expect(() => checkRendered("plugins-store-rows")).toThrow("same page button");
    oldMain.replaceWith(main);
    const mark = second.querySelector('.cs-tile');
    mark.className = 'ic';
    expect(() => checkRendered("plugins-store-rows")).toThrow("same tile and text structure");
    mark.className = 'cs-tile';
    add.getBoundingClientRect = () => new browser.DOMRect(0, 0, 64, 80);
    second.getBoundingClientRect = () => new browser.DOMRect(0, 0, 320, 64);
    expect(() => checkRendered("plugins-store-rows")).toThrow("fit inside their row");
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; browser.happyDOM.abort(); }
});

it("allows only the shared card quiet exit to be frameless while rejecting ordinary text actions", () => {
 const browser = new Window(); browser.document.body.innerHTML='<section class="conversation-card"><footer class="card-actions"><button class="btn card-quiet">Skip</button></footer></section><button class="btn card-quiet">Delete</button>';
 for(const element of browser.document.querySelectorAll('*')) element.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:40,width:100,height:30});
 const result=auditDocument(browser.document,{width:1120,height:900},[],null);
 const frames=result.productRules.filter(rule=>rule.rule==='R-UI-18'); expect(frames.map(rule=>rule.text)).toEqual(['Delete']); browser.happyDOM.abort();
});

it("waits for the card's takeover to become interactive in the larger view and returns through its pill (R-PANEL-09)", () => {
  for (const name of ['desktop-takeover-owner', 'desktop-takeover-done']) {
    const scene = scenes.find(scene => scene.name === name);
    expect(scene.steps.some(step => step.action === 'click' && step.selector === '[data-card-desktop=take].pri')).toBe(true);
    expect(scene.steps.some(step => step.action === 'wait' && step.selector?.startsWith('.desktop-panel[data-expanded][data-interactive="true"]'))).toBe(true);
    expect(scene.steps.some(step => step.selector?.includes('data-desktop="expand"'))).toBe(false);
  }
  const typing = scenes.find(scene => scene.name === 'desktop-takeover-owner');
  expect(typing.steps.some(step => step.action === 'desktop-owner-typing')).toBe(true);
  const done = scenes.find(scene => scene.name === 'desktop-takeover-done');
  expect(done.steps.some(step => step.selector === '[data-desktop="return"]')).toBe(true);
});

it("dispatches task room, file-view and restore assertions through the shared rendered check", () => {
  const browser = new Window(); browser.document.body.innerHTML='<section data-task-result="950">+1 −1</section><section class="desktop-checkpoints"></section>';
  browser.document.querySelector('.desktop-checkpoints').getBoundingClientRect=()=>({width:300,height:300});
  browser.__look={calls:[{method:'computer.checkpoints',params:{action:'restore',review_token:'a'.repeat(64)}}]};
  const previous={document:globalThis.document,window:globalThis.window}; globalThis.document=browser.document; globalThis.window=browser;
  try { for (const name of ['card-task-room','card-task-files','card-task-restored']) expect(checkRendered(name)).toEqual({check:name}); }
  finally { globalThis.document=previous.document; globalThis.window=previous.window; browser.happyDOM.abort(); }
});

it("requires every card disclosure to add visible text rather than repeat its face", () => {
  const browser=new Window();
  browser.document.body.innerHTML='<section class="conversation-card"><p>Already visible</p><div class="card-disclosure"><button data-card-disclosure aria-expanded="false">Show</button><div class="card-detail" hidden></div></div></section>';
  for(const node of browser.document.querySelectorAll('*')) node.getBoundingClientRect=()=>({width:100,height:30});
  const previous={document:globalThis.document,window:globalThis.window};globalThis.document=browser.document;globalThis.window=browser;
  try {
    expect(()=>checkRendered("card-disclosures")).toThrow("adds visible text");
    const detail=browser.document.querySelector(".card-detail");detail.textContent="Already visible";
    expect(()=>checkRendered("card-disclosures")).toThrow("adds visible text");
    detail.textContent="A previously hidden file path";
    expect(checkRendered("card-disclosures")).toEqual({check:"card-disclosures"});
    expect(detail.hidden).toBe(true);
  } finally {globalThis.document=previous.document;globalThis.window=previous.window;browser.happyDOM.abort();}
});

it("captures the typed owner answer before submitting, including its enabled primary", () => {
  const typed = scenes.find(scene => scene.name === "owner-question-typed");
  expect(typed).toBeDefined();
  expect(typed.steps.some(step => step.action === "type" && step.selector === "[data-owner-answer-input]")).toBe(true);
  expect(typed.steps.some(step => step.action === "check" && step.name === "owner-question-typed")).toBe(true);
  expect(typed.steps.some(step => step.action === "click" && step.selector === '[data-owner-answer="text"]')).toBe(false);
});
