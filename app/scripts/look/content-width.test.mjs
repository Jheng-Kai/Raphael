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

it("keeps Home's lead across the page and its three sections side by side at one width", () => {
  const browser = new Window();
  const doc = browser.document;
  doc.documentElement.style.setProperty('--sp-6', '32px');
  doc.documentElement.style.setProperty('--sp-5', '24px');
  doc.body.innerHTML = '<section class="page-home" style="padding:32px"><section class="ho-hero"></section><div class="ho-board">' + '<section class="ho-sec"></section>'.repeat(3) + '</div></section>';
  const page = doc.querySelector('.page-home'), hero = page.firstElementChild, sections = [...page.querySelectorAll('.ho-sec')];
  const measure = (element, width, top) => { element.getBoundingClientRect = () => ({ width, height: 100, top, bottom: top + 100 }); };
  measure(page, 1264, 0); measure(hero, 384, 32);
  sections.forEach(section => measure(section, 384, 300));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('innerWidth', 1180);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('content-width')).toThrow(/hero spans/);
    measure(hero, 1200, 32);
    expect(checkRendered('content-width').home).toEqual({ heroWidth: 1200, available: 1200, columns: 3 });
    measure(sections[2], 300, 300);
    expect(() => checkRendered('content-width')).toThrow(/share their width/);
    measure(sections[2], 384, 300); measure(sections[0], 384, 32);
    expect(() => checkRendered('content-width')).toThrow(/hero leads/);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
