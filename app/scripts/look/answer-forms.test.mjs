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

it("form checks count the active conversation without hidden private replies", () => {
  const browser = new Window(), doc = browser.document;
  const card = kind => `<section class="message-${kind}"><button data-rich-act="copy-source"></button>${kind === "chart" ? `<svg>${'<circle><title>Value: 3</title></circle>'.repeat(6)}</svg>` : ""}</section>`;
  doc.body.innerHTML = `<div class="page-agent"><section class="mb-chat" hidden>${card("forecast")}</section><section class="mb-chat"><div class="au-room-message">${["forecast", "board", "chart"].map(card).join("")}</div></section></div>`;
  vi.stubGlobal("document", doc);
  try { expect(() => checkRendered("form-room")).not.toThrow(); }
  finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
