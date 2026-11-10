import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { checkRendered } from "./checks.mjs";

it("rejects the store toolbar and Add action having different content edges", () => {
  const browser = new Window(), doc = browser.document;
  doc.documentElement.style.setProperty('--sp-6', '32px');
  doc.documentElement.style.setProperty('--sp-5', '24px');
  doc.body.innerHTML = '<div class="modal-scrim"><div class="set-content"><div class="set-head"><h1>Connections</h1><button>Add</button></div><div class="cs cs-store"><div class="cs-find"><label class="field"></label></div><div class="cs-store-groups"></div><div class="cs-results"><div class="cs-grid" style="grid-template-columns:640px"><div class="cs-card"></div></div></div></div></div></div>';
  const measure = (element, left, right) => { element.getBoundingClientRect = () => ({ left, right, width: right - left, height: 32 }); };
  const content = doc.querySelector('.set-content'), heading = doc.querySelector('.set-head'), action = doc.querySelector('button'), store = doc.querySelector('.cs'), search = doc.querySelector('.field'), groups = doc.querySelector('.cs-store-groups');
  [content, heading, store, search, groups].forEach(element => measure(element, 297, 937));
  measure(action, 903, 977);
  const results = doc.querySelector('.cs-results'), grid = doc.querySelector('.cs-grid'), card = doc.querySelector('.cs-card');
  [results, grid, card].forEach(element => measure(element, 297, 937));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('content-width')).toThrow(/header action shares/);
    measure(action, 863, 937);
    measure(search, 297, 900);
    expect(() => checkRendered('content-width')).toThrow(/toolbar shares/);
    measure(search, 297, 937);
    measure(results, 297, 900);
    expect(() => checkRendered('content-width')).toThrow(/toolbar shares/);
    measure(results, 297, 937); measure(card, 297, 681);
    expect(() => checkRendered('content-width')).toThrow(/store rows fill/);
    measure(card, 297, 937);
    // The general short-card check still applies; use a realistic two-column track.
    grid.style.gridTemplateColumns = '312px 312px'; measure(card, 297, 609);
    expect(() => checkRendered('content-width')).not.toThrow();
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("rejects the owner's stretched dictionary geometry on 97fa61bd", () => {
  const browser = new Window();
  browser.document.documentElement.style.setProperty('--sp-6', '32px');
  browser.document.documentElement.style.setProperty('--sp-5', '24px');
  browser.document.body.innerHTML = '<div class="wrow"></div><section class="icard"></section><div class="slist"></div>';
  const [word, stat, list] = browser.document.body.children;
  const measure = (element, width) => { element.getBoundingClientRect = () => ({ width, height: 64 }); };
  measure(word, 694); measure(stat, 384); measure(list, 640);
  vi.stubGlobal('document', browser.document);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('content-width')).toThrow(/wrow.*694.*320/);
    measure(word, 320); measure(stat, 618);
    expect(() => checkRendered('content-width')).toThrow(/icard.*618.*384/);
    measure(stat, 384);
    expect(checkRendered('content-width').measurements).toHaveLength(3);
    measure(list, 900);
    expect(() => checkRendered('content-width')).toThrow(/list.*900.*640/);
    list.hidden = true;
    expect(checkRendered('content-width').measurements).toHaveLength(2);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("rejects the judge's 720 thread inset on 2d5e3cf8: the column starts and ends where its composer does", () => {
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<section class="mb-chat"><div class="ra-find" hidden></div><div class="ra-stage"><div class="ra-scroll"><div class="ra-col"><ol class="thread">' +
    '<li class="tn"><div class="me"><div class="chat-message owner-message"><div class="bubble"></div></div></div></li><li class="tn"><div class="ra"></div></li>' +
    '</ol></div></div><div class="ra-dock"><form class="composer"></form></div></div><div class="peer-chat"><div class="peer-scroll"><ol class="peer-thread"><li class="tn peer-line"><div class="ra"></div></li></ol></div></div></section>' +
    '<aside class="room-side-thread"><div class="room-side-scroll"><div class="room-thread-origin"><div class="ra"></div></div><ol class="thread"></ol></div><div class="room-thread-dock"><form class="composer"></form></div></aside>';
  const measure = (element, left, right) => { element.getBoundingClientRect = () => ({ left, right, width: right - left, top: 0, bottom: 40, height: 40 }); };
  const $ = selector => doc.querySelector(selector);
  measure($('.ra-stage'), 0, 720); measure($('.ra-dock .composer'), 32, 688);
  // What the judge saw: the messages at 20 px, the composer at 32.
  measure($('.ra-col'), 20, 700); measure($('.bubble'), 500, 700); measure($('.thread .ra'), 20, 300);
  measure($('.peer-chat'), 0, 720); measure($('.peer-thread'), 32, 688); measure($('.peer-line .ra'), 32, 400);
  measure($('.room-side-thread'), 720, 1160); measure($('.room-side-scroll'), 720, 1160); measure($('.room-thread-origin'), 744, 1136); measure($('.room-thread-origin .ra'), 744, 900); measure($('.room-thread-dock .composer'), 744, 1136);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('thread-edges')).toThrow(/the thread spans the composer's edges: 20-700 against 32-688/);
    measure($('.ra-col'), 32, 688);
    expect(() => checkRendered('thread-edges')).toThrow(/owner's messages end at the composer's right edge \(700 against 688\)/);
    measure($('.bubble'), 488, 688);
    expect(() => checkRendered('thread-edges')).toThrow(/replies begin at the composer's left edge \(20 against 32\)/);
    measure($('.thread .ra'), 32, 300);
    measure($('.peer-thread'), 28, 692);
    expect(() => checkRendered('thread-edges')).toThrow(/the members' conversation spans/);
    measure($('.peer-thread'), 32, 688);
    measure($('.room-thread-dock .composer'), 732, 1148);
    expect(() => checkRendered('thread-edges')).toThrow(/the side thread spans/);
    measure($('.room-thread-dock .composer'), 744, 1136);
    expect(checkRendered('thread-edges').edges.map(edge => [edge.where, edge.owner, edge.replies])).toEqual([["the thread", 1, 1], ["the members' conversation", 0, 1], ["the side thread", 0, 1]]);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("rejects the judge's room inset on 6e2ca315: a group's words and cards begin and end where its composer does, its faces hang in the gutter", () => {
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<section class="mb-chat au-room-pane"><div class="ra-stage"><div class="ra-scroll"><div class="ra-col"><ol class="thread au-room-thread">' +
    '<li class="tn"><div class="me"><span class="owner-face"></span><div class="chat-message owner-message"><div class="bubble"></div></div></div></li>' +
    '<li class="tn"><div class="ra"><span class="ra-face"></span><div class="ra-body"></div></div></li></ol></div></div><div class="ra-dock"><form class="composer"></form></div></div></section>';
  const measure = (element, left, right) => { element.getBoundingClientRect = () => ({ left, right, width: right - left, top: 0, bottom: 40, height: 40 }); };
  const $ = selector => doc.querySelector(selector);
  // 720 wide: the composer and the column at 32-688, the scroll the whole pane, so the gutter is the 32 px beside them.
  measure($('.ra-stage'), 0, 720); measure($('.ra-scroll'), 0, 720); measure($('.ra-dock .composer'), 32, 688); measure($('.ra-col'), 32, 688);
  measure($('.bubble'), 488, 688); measure($('.owner-face'), 692, 712); measure($('.ra'), 32, 688); measure($('.ra-body'), 64, 400); measure($('.ra-face'), 8, 28);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    // What the judge saw: the face's slot made the words begin 32 px inside the composer.
    expect(() => checkRendered('thread-edges')).toThrow(/words and cards begin at the composer's left edge \(64 against 32\)/);
    measure($('.ra-body'), 32, 400);
    measure($('.ra-face'), -4, 16);
    expect(() => checkRendered('thread-edges')).toThrow(/a member's face hangs in the left gutter, inside the scroll \(-4-16 against 0-32\)/);
    measure($('.ra-face'), 8, 28);
    measure($('.owner-face'), 668, 688);
    expect(() => checkRendered('thread-edges')).toThrow(/the owner's face hangs in the right gutter/);
    measure($('.owner-face'), 692, 712);
    expect(checkRendered('thread-edges').edges.map(edge => [edge.where, edge.owner, edge.replies, edge.hung])).toEqual([["the thread", 1, 1, true]]);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("keeps Home's lead across the page and its two panels side by side at one width", () => {
  const browser = new Window();
  const doc = browser.document;
  doc.documentElement.style.setProperty('--sp-6', '32px');
  doc.documentElement.style.setProperty('--sp-5', '24px');
  doc.body.innerHTML = '<section class="page-home" style="padding:32px"><section class="ho-hero"></section><div class="ho-board"><div class="ho-stats"></div><div class="ho-panels">' + '<section class="ho-sec"></section>'.repeat(2) + '</div></div></section>';
  const page = doc.querySelector('.page-home'), hero = page.firstElementChild, sections = [...page.querySelectorAll('.ho-sec')];
  const measure = (element, width, top) => { element.getBoundingClientRect = () => ({ width, height: 100, top, bottom: top + 100 }); };
  measure(page, 1264, 0); measure(hero, 384, 32);
  sections.forEach(section => measure(section, 584, 300));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('innerWidth', 1180);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('content-width')).toThrow(/hero spans/);
    measure(hero, 1200, 32);
    expect(checkRendered('content-width').home).toEqual({ heroWidth: 1200, available: 1200, columns: 2 });
    measure(sections[1], 500, 300);
    expect(() => checkRendered('content-width')).toThrow(/share a width/);
    measure(sections[1], 584, 300); measure(sections[0], 584, 32);
    expect(() => checkRendered('content-width')).toThrow(/hero leads/);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
