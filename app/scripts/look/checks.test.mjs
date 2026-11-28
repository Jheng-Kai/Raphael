import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { checkRendered } from "./checks.mjs";

it("reports each shifted scroll container and the app root's position", () => {
  const browser = new Window();
  const doc = browser.document;
  doc.body.innerHTML = '<div class="wbody"><nav id="nav"></nav><main id="main"></main></div>';
  const app = doc.querySelector(".wbody");
  let appRootY = 0;
  app.getBoundingClientRect = () => ({ top: appRootY });
  Object.defineProperty(doc, "scrollingElement", { value: doc.documentElement });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", browser);
  const check = () => checkRendered("page-unshifted");
  try {
    expect(check()).toEqual({ check: "page-unshifted", windowY: 0, documentTop: 0, bodyTop: 0, appTop: 0, mainTop: 0, navTop: 0, appRootY: 0 });
    for (const [element, property, report] of [
      [browser, "scrollY", "windowY"], [doc.scrollingElement, "scrollTop", "documentTop"], [doc.body, "scrollTop", "bodyTop"],
      [app, "scrollTop", "appTop"], [doc.getElementById("main"), "scrollTop", "mainTop"], [doc.getElementById("nav"), "scrollTop", "navTop"],
    ]) {
      Object.defineProperty(element, property, { value: 60, configurable: true });
      expect(check).toThrow(`${report}=60`);
      Object.defineProperty(element, property, { value: 0 });
    }
    appRootY = -60;
    expect(check).toThrow("appRootY=-60");
  } finally {
    vi.unstubAllGlobals();
    browser.happyDOM.abort();
  }
});

it.each(["keys", "apps"])("hit-tests the dim at the window edges of the %s step", step => {
  // The keys step dims everything; the Connect apps step, once opened, lights the whole dialog while the person reads.
  const highlightsSearch = step === "apps";
  const browser = new Window();
  const doc = browser.document;
  Object.defineProperties(doc.documentElement, {
    clientWidth: { value: 720 },
    clientHeight: { value: 600 },
  });
  doc.documentElement.style.setProperty("--float", "rgb(240, 240, 240)");
  doc.documentElement.style.setProperty("--raphael-color", "rgb(61, 181, 255)");
  doc.body.innerHTML = `
    <nav id="nav"><div class="sidebar-conversations"></div><button class="sidebar-account"></button></nav>
    <main id="main"></main>
    ${highlightsSearch ? '<div class="modal-scrim" data-standalone="connections"><div class="modal"><input id="conn-search"><button>Telegram Connect</button></div></div>' : ""}
    <div class="window-chrome" id="window-chrome">
      <div class="window-drag"></div>
      <div class="window-controls"><button class="window-button"><svg></svg></button></div>
    </div>
    <div class="tour" data-mode="step" data-step="${step}" data-state="${highlightsSearch ? "see" : "do"}" data-dim="${highlightsSearch ? "spot" : "all"}">
      <div class="tour-catch" style="--scrim: rgba(0, 0, 0, 0.5); background-color: rgba(0, 0, 0, 0.5); opacity: 1; pointer-events: auto"></div>
      <div class="tour-spot" style="pointer-events: none; animation-name: none; border-radius: 12px; outline-width: 2px; outline-style: solid; outline-color: rgb(61, 181, 255); outline-offset: 0px; box-shadow: 0 0 8px blue" ${highlightsSearch ? "" : "hidden"}></div>
      <div class="tour-ground">
        <div class="tour-slime"><div class="slime-surface" style="--slime-color: #3db5ff"><div class="slime-body"></div></div></div>
        <div class="tour-glow" style="background-image: radial-gradient(black, transparent); opacity: 0.5"></div>
      </div>
      <div class="tour-bubble" role="dialog" aria-label="Tour" style="background-color: var(--float)">
        <div class="tour-head">
          <h2 class="tour-title">${highlightsSearch ? "Connect apps" : "Call me anytime"}</h2>
          <button class="btn icon close-button" data-tour="close" aria-label="End tour"><svg></svg></button>
        </div>
        <p class="tour-text">Raphael's guided tour</p>
        <span class="tour-count" role="img" aria-label="Step ${highlightsSearch ? 4 : 10} of 10">${Array.from({ length: 10 }, (_, index) =>
          `<span class="tour-dot"${index === (highlightsSearch ? 3 : 9) ? " data-current" : ""}></span>`).join("")}</span>
        ${highlightsSearch ? '<div class="tour-foot"><div class="tour-buttons"><button class="btn sm pri" data-tour="gotIt">Got it</button></div></div>' : ""}
        <div class="tour-keys"><kbd>Alt</kbd><kbd>R</kbd></div>
      </div>
    </div>`;
  const measure = (selector, left, top, width, height) => {
    for (const element of doc.querySelectorAll(selector)) {
      element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
    }
  };
  measure(".window-chrome", 0, 0, 720, 38);
  measure(".sidebar-account", 8, 550, 30, 30);
  measure("#conn-search", 0, 8, 88, 200);
  measure(".tour-spot", 0, 8, 710, 470);
  measure(".modal", 0, 8, 710, 470);
  measure(".modal button", 570, 100, 120, 45);
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
  const check = () => checkRendered(highlightsSearch ? "tour-step-4-seen" : "tour-step-10");
  const hits = new Map(highlightsSearch ? [["0.25,38.5", doc.body], ["355,48", doc.querySelector(".modal")], ["355,243", doc.querySelector(".modal")]] : []);
  doc.elementFromPoint = (x, y) => {
    if (Math.round(x) >= doc.documentElement.clientWidth || Math.round(y) >= doc.documentElement.clientHeight) return null;
    return hits.get(`${x},${y}`) ?? dim;
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("getComputedStyle", browser.getComputedStyle.bind(browser));
  try {
    if (highlightsSearch) {
      expect(check().pressable).toBe(2);
      measure(".modal button", 320, 150, 120, 45);
      expect(check).toThrow("the bubble clears the pressable element Telegram Connect");
      // Standing on the dialog is allowed only while it leaves no strip for the group, and the dialog keeps its place.
      const bubble = doc.querySelector(".tour-bubble");
      bubble.dataset.side = "inside";
      expect(check).toThrow("Raphael stands on the dialog only when no strip round it holds the group");
      measure(".modal", 0, 8, 710, 560);
      measure(".tour-spot", 0, 8, 710, 560);
      hits.set("355,288", doc.querySelector(".modal"));
      expect(check().side).toBe("inside");
      doc.querySelector(".modal-scrim").style.paddingTop = "120px";
      expect(check).toThrow("the dialog keeps its own place");
      doc.querySelector(".modal-scrim").style.paddingTop = "";
      delete bubble.dataset.side;
      measure(".modal", 0, 8, 710, 470);
      measure(".tour-spot", 0, 8, 710, 470);
      measure(".modal button", 570, 100, 120, 45);
    }
    expect(check().dimPoints).toEqual([
      [0.25, 0.25], [719.25, 0.25],
      ...(highlightsSearch ? [] : [[0.25, 38.5]]), [719.25, 38.5],
      [0.25, 599.25], [719.25, 599.25], ...(highlightsSearch ? [] : [[360, 300]]),
    ]);
    for (const [x, y, uncovered] of [
      [0.25, 0.25, dragStrip],
      [719.25, 0.25, captionGlyph],
      ...(highlightsSearch ? [] : [[0.25, 38.5, doc.body]]),
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
