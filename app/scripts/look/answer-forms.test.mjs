import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { checkRendered } from "./checks.mjs";
import { sceneLatinNames } from "./runner.mjs";
import { auditDocument } from "./audit.mjs";

it("keeps installed tunnel product names while still flagging untranslated controls", () => {
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<button>Tailscale Funnel</button><button>Cloudflare Tunnel</button><button>ngrok</button><button>Save</button>';
  for (const element of doc.querySelectorAll('*')) element.getBoundingClientRect = () => ({left:0,top:0,right:120,bottom:32,width:120,height:32});
  try {
    const audit = auditDocument(doc, {width:1120,height:900}, [], sceneLatinNames({steps:[]}, "zh-TW", {}));
    expect(audit.mixedLanguage.map(item => item.word)).toEqual(["Save"]);
  } finally {browser.happyDOM.abort();}
});

it.each(["owner", "greeting"])("the shared %s question heading needs a close action and no duplicate status", kind => {
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = `<section class="conversation-card" data-${kind}-question="sample" data-card-state="asked"><header class="card-head"><h3>Question</h3><button data-${kind}-answer="cancel">Close</button></header></section>`;
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => ({left:0,right:480,width:480,height:50});
  }
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({paddingRight:"0",borderRightWidth:"0",overflowY:"visible"}));
  try {
    expect(() => checkRendered("card-shell")).not.toThrow();
    doc.querySelector('button').remove();
    expect(() => checkRendered("card-shell")).toThrow("question close follows");
  } finally {vi.unstubAllGlobals(); browser.happyDOM.abort();}
});

it.each(['data-member-template', 'data-template-connection="gmail" data-connected="false"'])("a template request has no invented card status (%s)", attrs => {
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = `<section class="conversation-card" ${attrs}><header class="card-head"><b>Recipe</b></header></section>`;
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => ({left:0,right:480,width:480,height:50});
  }
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({paddingRight:"0",borderRightWidth:"0",overflowY:"visible"}));
  try {
    expect(() => checkRendered("card-shell")).not.toThrow();
    doc.querySelector('header').insertAdjacentHTML('beforeend', '<span class="card-status">Ready</span>');
    expect(() => checkRendered("card-shell")).toThrow("no invented status");
    doc.querySelector('.card-status').remove();
    doc.querySelector('.conversation-card').removeAttribute('data-member-template');
    doc.querySelector('.conversation-card').dataset.connected = 'true';
    expect(() => checkRendered("card-shell")).toThrow("status always has a word");
  } finally {vi.unstubAllGlobals(); browser.happyDOM.abort();}
});

it("a × in a card's head is always shown and ends the head at the right padding", () => {
  // A page card's hidden × (until 2026-11-10) was taken by the shared failure of a link the page could not open.
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<section class="conversation-card"><header class="card-head"><b>Page</b><span class="card-status">Failed</span><button class="card-close"></button></header></section>';
  const places = { "card-status": { left: 400, right: 450 }, "card-close": { left: 456, right: 480 } };
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => ({ left: 0, right: 480, width: 480, height: 50, ...places[element.className] });
  }
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({ paddingRight: "0", borderRightWidth: "0", overflowY: "visible" }));
  try {
    expect(() => checkRendered("card-shell")).not.toThrow();
    doc.querySelector('.card-close').checkVisibility = () => false;
    expect(() => checkRendered("card-shell")).toThrow("a × in the card's head is shown");
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("a card's buttons stand at the card's right padding, not only at the end of their own row", () => {
  // A failed page's 再試一次 stood at the card's left in a row its parent had shrunk to the button, and passed (2026-11-10).
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<section class="conversation-card"><header class="card-head"><b>Page</b><span class="card-status">Failed</span></header><div class="card-actions"><button class="btn pri">Retry</button></div></section>';
  const places = { "card-status": { left: 400, right: 480 }, "card-actions": { left: 0, right: 80 }, "btn pri": { left: 0, right: 80 } };
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => ({ left: 0, right: 480, width: 480, height: 50, ...places[element.className] });
  }
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({ paddingRight: "0", borderRightWidth: "0", overflowY: "visible", backgroundColor: "rgb(255, 255, 255)" }));
  try {
    expect(() => checkRendered("card-shell")).toThrow("the card's buttons stand at its right");
    places["card-actions"] = { left: 0, right: 480 };
    places["btn pri"] = { left: 400, right: 480 };
    expect(() => checkRendered("card-shell")).not.toThrow();
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("a question's answer button stands at the field height and shares the field's row (R-UI-17)", () => {
  // The judge on 6e2ca315: 送出回答 was 22 px tall beside a 30 px field, and 28 px was read for both card buttons.
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<section class="conversation-card" data-owner-question="q" data-card-state="asked"><header class="card-head"><h3>Question</h3><button data-owner-answer="cancel"></button></header>' +
    '<div class="question-submit"><input class="mb-fin"><button class="btn sm pri">Send</button></div></section>';
  const places = { INPUT: { top: 0, bottom: 30, height: 30 }, BUTTON: { top: 0, bottom: 22, height: 22 } };
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => ({ left: 0, right: 480, width: 480, top: 0, bottom: 50, height: 50, ...(element.matches('.question-submit *') ? places[element.tagName] : {}) });
  }
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', () => ({ paddingRight: '0', borderRightWidth: '0', overflowY: 'visible', backgroundColor: 'rgb(255, 255, 255)', getPropertyValue: () => '30px' }));
  try {
    expect(() => checkRendered('card-shell')).toThrow(/a card's text button stands at the field height: Send is 22 px against 30/);
    places.BUTTON = { top: 0, bottom: 30, height: 30 };
    expect(() => checkRendered('card-shell')).not.toThrow();
    places.BUTTON = { top: 4, bottom: 36, height: 32 };
    expect(() => checkRendered('card-shell')).toThrow(/share one height and centre/);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("a page made larger keeps its × outside the page, above its top right corner (2026-11-11)", () => {
  // The × once lay over the page's own top right corner (8 px in), so whatever a page drew there was covered.
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<section class="pg-card"><b class="card-title">Page</b></section><div class="mb-scrim"><div class="mb-dialog pg-view-dialog" aria-labelledby="t">' +
    '<div class="mb-dlg-head"><h2 id="t">Page</h2><button data-dlg="close"></button></div><div class="mb-dlg-body"><div class="pg-view" style="--pg-h:300px"><iframe></iframe></div></div></div></div>';
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const places = { "pg-card": rect(20, 20, 420, 200), "mb-dialog pg-view-dialog": rect(100, 200, 700, 500), "pg-view": rect(100, 200, 700, 500), h2: rect(100, 200, 101, 201), button: rect(664, 156, 700, 192) };
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => places[element.className || element.tagName.toLowerCase()] ?? (element.tagName === "IFRAME" ? rect(100, 200, 700, 500) : rect(0, 0, 10, 10));
  }
  const tokens = { "--sp-2": "8px", "--window-controls-height": "32px" };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('innerHeight', 900); vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('getComputedStyle', () => ({ borderRadius: '999px', backgroundColor: 'rgb(31, 31, 31)', getPropertyValue: name => tokens[name] ?? '' }));
  try {
    expect(checkRendered('page-expanded').height).toBe(300);
    places.button = rect(664, 208, 700, 244);
    expect(() => checkRendered('page-expanded')).toThrow(/the × stands above the page's top edge/);
    places.button = rect(656, 156, 692, 192);
    expect(() => checkRendered('page-expanded')).toThrow(/right-aligned with the page/);
    places.button = rect(664, 16, 700, 52); places["mb-dialog pg-view-dialog"] = rect(100, 60, 700, 360); places["pg-view"] = rect(100, 60, 700, 360); places.iframe = rect(100, 60, 700, 360);
    expect(() => checkRendered('page-expanded')).toThrow(/inside the window, under its caption strip/);
  } finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});

it("form checks count the active conversation without hidden private replies", () => {
  const browser = new Window(), doc = browser.document;
  const card = kind => `<section class="message-${kind}"><button data-rich-act="copy-source"></button>${kind === "chart" ? `<svg>${'<circle><title>Value: 3</title></circle>'.repeat(6)}</svg>` : ""}</section>`;
  doc.body.innerHTML = `<div class="page-agent"><section class="mb-chat" hidden>${card("forecast")}</section><section class="mb-chat"><div class="au-room-message">${["forecast", "board", "chart"].map(card).join("")}</div></section></div>`;
  vi.stubGlobal("document", doc);
  try { expect(() => checkRendered("form-room")).not.toThrow(); }
  finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
