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

it("form checks count the active conversation without hidden private replies", () => {
  const browser = new Window(), doc = browser.document;
  const card = kind => `<section class="message-${kind}"><button data-rich-act="copy-source"></button>${kind === "chart" ? `<svg>${'<circle><title>Value: 3</title></circle>'.repeat(6)}</svg>` : ""}</section>`;
  doc.body.innerHTML = `<div class="page-agent"><section class="mb-chat" hidden>${card("forecast")}</section><section class="mb-chat"><div class="au-room-message">${["forecast", "board", "chart"].map(card).join("")}</div></section></div>`;
  vi.stubGlobal("document", doc);
  try { expect(() => checkRendered("form-room")).not.toThrow(); }
  finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
