import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { checkRendered } from "./checks.mjs";

it("rejects the owner's stretched dictionary and Home geometry on 97fa61bd", () => {
  const browser = new Window();
  browser.document.documentElement.style.setProperty('--sp-6', '32px');
  browser.document.documentElement.style.setProperty('--sp-5', '24px');
  browser.document.body.innerHTML = '<div class="wrow"></div><section class="ho-card"></section><div class="cs-list"></div>';
  const [word, home, list] = browser.document.body.children;
  const measure = (element, width) => { element.getBoundingClientRect = () => ({ width, height: 64 }); };
  measure(word, 694); measure(home, 384); measure(list, 640);
  vi.stubGlobal('document', browser.document);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('content-width')).toThrow(/wrow.*694.*320/);
    measure(word, 320); measure(home, 618);
    expect(() => checkRendered('content-width')).toThrow(/ho-card.*618.*384/);
    measure(home, 384);
    expect(checkRendered('content-width').measurements).toHaveLength(3);
    measure(list, 900);
    expect(() => checkRendered('content-width')).toThrow(/list.*900.*640/);
    list.hidden = true;
    expect(checkRendered('content-width').measurements).toHaveLength(2);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("measures team cards before the owner's canvas zoom", () => {
  const browser = new Window();
  browser.document.documentElement.style.setProperty('--sp-6', '32px');
  browser.document.documentElement.style.setProperty('--sp-5', '24px');
  browser.document.body.innerHTML = '<div class="team-board" style="transform:scale(1.5)"><div class="team-member"></div></div>';
  const board = browser.document.querySelector('.team-board'), card = board.firstElementChild;
  board.getBoundingClientRect = () => ({ width: 1760 * 1.5, height: 900 });
  card.getBoundingClientRect = () => ({ width: 384 * 1.5, height: 200 });
  vi.stubGlobal('document', browser.document);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  vi.stubGlobal('DOMMatrix', class { constructor() { this.a = 1.5; } });
  try {
    expect(checkRendered('content-width').measurements.map(item => item.width)).toEqual([384, 1760]);
    card.getBoundingClientRect = () => ({ width: 600 * 1.5, height: 200 });
    expect(() => checkRendered('content-width')).toThrow(/team-member.*600.*384/);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("keeps Home's lead across the grid and fills every summary row", () => {
  const browser = new Window();
  const doc = browser.document;
  doc.documentElement.style.setProperty('--sp-6', '32px');
  doc.documentElement.style.setProperty('--sp-5', '24px');
  doc.body.innerHTML = '<section class="page-home" style="padding:32px"><section class="ho-hero"></section>' + '<section class="ho-card"></section>'.repeat(6) + '</section>';
  const page = doc.querySelector('.page-home'), hero = page.firstElementChild, cards = [...page.querySelectorAll('.ho-card')];
  const measure = (element, width, top) => { element.getBoundingClientRect = () => ({ width, height: 100, top, bottom: top + 100 }); };
  measure(page, 1264, 0); measure(hero, 384, 32);
  cards.forEach((card, i) => measure(card, 384, 156 + Math.floor(i / 3) * 124));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', browser.getComputedStyle.bind(browser));
  try {
    expect(() => checkRendered('content-width')).toThrow(/hero spans/);
    measure(hero, 1200, 32);
    expect(checkRendered('content-width').home).toEqual({ heroWidth: 1200, available: 1200, columns: 3, rows: [3, 3] });
    measure(cards[5], 384, 404);
    expect(() => checkRendered('content-width')).toThrow(/rows fill/);
    measure(cards[5], 384, 280); measure(cards[0], 384, 32);
    expect(() => checkRendered('content-width')).toThrow(/hero leads/);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
