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

it("a page open in the conversation's place has the arrow at the header's top left, the composer's column and no dialog (2026-11-11)", () => {
  // The × once stood outside a dialog's page (2026-11-11); the page now replaces the conversation and the header's arrow goes back.
  const browser = new Window(), doc = browser.document;
  doc.body.innerHTML = '<div class="page-agent"><section class="mb-chat"><div class="mb-head"><span class="mb-head-l"><button class="icon" data-page-back aria-label="返回"><svg></svg></button></span>' +
    '<span class="conversation-trigger"><span class="mb-pill">小晴</span></span></div>' +
    '<div class="ra-stage is-page" data-page-kind="page"><div class="ra-scroll"></div><div class="pgv"><div class="pgv-body"><div class="pgv-page"><h2 class="pgv-title">輕量後背包</h2><div class="pgv-frame-box"><iframe class="pg-frame"></iframe></div></div></div><div class="pgv-status" hidden></div></div>' +
    '<div class="ra-dock"><div class="composer"></div></div></div><section class="pg-card"><b class="card-title">輕量後背包</b></section></section></div>';
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const places = { "mb-head": rect(300, 20, 1100, 60), icon: rect(310, 22, 346, 58), "mb-pill": rect(600, 22, 700, 58), "pgv-title": rect(340, 70, 700, 100), "composer": rect(340, 800, 1060, 880),
    "pgv-frame-box": rect(340, 110, 1060, 780), "pg-frame": rect(340, 110, 1060, 780), "ra-dock": rect(300, 790, 1100, 890) };
  for (const element of doc.querySelectorAll('*')) {
    element.checkVisibility = () => true;
    element.getBoundingClientRect = () => places[element.className || element.tagName.toLowerCase()] ?? rect(0, 0, 10, 10);
  }
  vi.stubGlobal('document', doc);
  vi.stubGlobal('innerHeight', 900); vi.stubGlobal('innerWidth', 1100);
  vi.stubGlobal('getComputedStyle', element => ({ visibility: element.className === "ra-scroll" ? "hidden" : "visible", pointerEvents: "auto", borderRadius: element.className === "pgv-frame-box" ? "16px" : "999px", borderTopWidth: "0px", backgroundColor: "rgb(31, 31, 31)", getPropertyValue: () => "" }));
  try {
    expect(checkRendered('page-inplace').width).toBe(720);
    // A dialog over the page, the arrow far from the header's left, a page narrower than the composer's column: each is refused.
    doc.body.insertAdjacentHTML("beforeend", '<div class="mb-scrim"></div>');
    expect(() => checkRendered('page-inplace')).toThrow(/no dialog, no scrim and no ×/);
    doc.querySelector(".mb-scrim").remove();
    places.icon = rect(700, 22, 736, 58);
    expect(() => checkRendered('page-inplace')).toThrow(/at the header's top left/);
    places.icon = rect(310, 22, 346, 58);
    places["pgv-frame-box"] = rect(380, 110, 1020, 780);
    expect(() => checkRendered('page-inplace')).toThrow(/as wide as the composer/);
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
