import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { checkRendered } from "./checks.mjs";

it.each(["keys", "team"])("hit-tests the dim at the window edges of the %s step", step => {
  const highlightsTeam = step === "team";
  const browser = new Window();
  const doc = browser.document;
  Object.defineProperties(doc.documentElement, {
    clientWidth: { value: 720 },
    clientHeight: { value: 600 },
  });
  doc.documentElement.style.setProperty("--float", "rgb(240, 240, 240)");
  doc.body.innerHTML = `
    <nav id="nav"><div class="sidebar-conversations"></div><button class="sidebar-account"></button></nav>
    <main id="main"></main>
    <div class="window-chrome" id="window-chrome">
      <div class="window-drag"></div>
      <div class="window-controls"><button class="window-button"><svg></svg></button></div>
    </div>
    <div class="tour" data-mode="step" data-step="${step}" data-state="look" data-dim="${highlightsTeam ? "spot" : "all"}">
      <div class="tour-catch" style="--scrim: rgba(0, 0, 0, 0.5); background-color: rgba(0, 0, 0, 0.5); opacity: 1; pointer-events: auto"></div>
      <div class="tour-spot" style="pointer-events: none; border-radius: 12px" ${highlightsTeam ? "" : "hidden"}></div>
      <div class="tour-ground">
        <div class="tour-slime"><div class="slime-surface" style="--slime-color: #3db5ff"><div class="slime-body"></div></div></div>
        <div class="tour-glow" style="background-image: radial-gradient(black, transparent); opacity: 0.5"></div>
      </div>
      <div class="tour-bubble" role="dialog" aria-label="Tour" style="background-color: var(--float)">
        <div class="tour-head">
          <h2 class="tour-title">${highlightsTeam ? "Your team" : "Call me anytime"}</h2>
          <button class="btn icon close-button" data-tour="close" aria-label="End tour"><svg></svg></button>
        </div>
        <p class="tour-text">Raphael's guided tour.</p>
        <span class="tour-count" role="img" aria-label="Step ${highlightsTeam ? 5 : 7} of 7">${Array.from({ length: 7 }, (_, index) =>
          `<span class="tour-dot"${index === (highlightsTeam ? 4 : 6) ? " data-current" : ""}></span>`).join("")}</span>
        <div class="tour-keys"><kbd>Alt</kbd><kbd>R</kbd></div>
        <button data-tour="back">Back</button>
        <button class="pri" data-tour="${highlightsTeam ? "next" : "done"}">${highlightsTeam ? "Next" : "Done"}</button>
      </div>
    </div>`;
  const measure = (selector, left, top, width, height) => {
    for (const element of doc.querySelectorAll(selector)) {
      element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
    }
  };
  measure(".window-chrome", 0, 0, 720, 38);
  measure(".sidebar-account", 8, 550, 30, 30);
  measure(".sidebar-conversations, .tour-spot", 0, 8, 88, 200);
  measure(".tour-catch", 0, 0, 720, 600);
  measure(".tour-bubble", 300, 100, 160, 90);
  measure(".tour-ground", 300, 200, 80, 64);
  measure(".tour-slime", 308, 200, 64, 64);
  measure(".slime-body", 318, 215, 44, 35);
  measure(".tour-glow", 304, 245, 72, 14);
  measure(".tour-bubble button, kbd", 310, 140, 24, 24);
  browser.__look = { data: { device: { agent_keys: ["Alt+R"] } } };
  const dim = doc.querySelector(".tour-catch");
  const captionGlyph = doc.querySelector(".window-button svg");
  const dragStrip = doc.querySelector(".window-drag");
  const check = () => checkRendered(`tour-step-${step}-look`);
  const hits = new Map(highlightsTeam ? [["0.25,38.5", doc.body], ["44,108", doc.body]] : []);
  doc.elementFromPoint = (x, y) => {
    if (Math.round(x) >= doc.documentElement.clientWidth || Math.round(y) >= doc.documentElement.clientHeight) return null;
    return hits.get(`${x},${y}`) ?? dim;
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("getComputedStyle", browser.getComputedStyle.bind(browser));
  try {
    expect(check().dimPoints).toEqual([
      [0.25, 0.25], [719.25, 0.25],
      ...(highlightsTeam ? [] : [[0.25, 38.5]]), [719.25, 38.5],
      [0.25, 599.25], [719.25, 599.25], [360, 300],
    ]);
    for (const [x, y, uncovered] of [
      [0.25, 0.25, dragStrip],
      [719.25, 0.25, captionGlyph],
      ...(highlightsTeam ? [] : [[0.25, 38.5, doc.body]]),
      [719.25, 38.5, doc.body],
      [719.25, 599.25, doc.body],
    ]) {
      hits.set(`${x},${y}`, uncovered);
      expect(check).toThrow(`the dim covers window point (${x}, ${y})`);
      hits.delete(`${x},${y}`);
    }
  } finally {
    vi.unstubAllGlobals();
    browser.happyDOM.abort();
  }
});
