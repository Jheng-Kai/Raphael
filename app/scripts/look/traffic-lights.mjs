// macOS draws its traffic lights (close, minimize, zoom) over the top left of the main window's page
// (tauri.macos.conf.json: `titleBarStyle: Overlay` and `trafficLightPosition`). Chrome draws none, so on a
// Mac a scene of the main window draws them where macOS does, and no control may lie under them.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The buttons as macOS 26 lays them out with tao's inset (`inset_traffic_lights`): 14 px across, 23 px
// from one left edge to the next, and the top 9 px above the configured y (the buttons keep their
// place in a title bar container that is `y` taller than a button).
const BUTTON = 14, STEP = 23, TOP_ABOVE_Y = 9;

/** Where the lights are in the main window, from the macOS window config. */
export function trafficLights(app) {
  const config = JSON.parse(readFileSync(join(app, "src-tauri/tauri.macos.conf.json"), "utf8"));
  const { x, y } = config.app.windows.find(window => window.label === "main").trafficLightPosition;
  const top = y - TOP_ABOVE_Y;
  return { left: x, top, right: x + 2 * STEP + BUTTON, bottom: top + BUTTON, step: STEP, size: BUTTON };
}

/**
 * In the page: the controls, faces and words that are on top under the lights (with 4 px of air), as
 * short descriptions. A dialog's dim over a control hides it, so only what is on top at a point counts.
 */
export function coveredByTrafficLights(lights) {
  const air = 4, found = new Set();
  const describe = element => `${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}${element.classList.length ? "." + [...element.classList].slice(0, 3).join(".") : ""}`;
  const interactive = "button, a[href], input, textarea, select, [role=button], [role=link], [role=tab], [contenteditable=true], .av";
  for (let x = lights.left - air; x <= lights.right + air; x += 2) {
    for (let y = Math.max(0, lights.top - air); y <= lights.bottom + air; y += 2) {
      const top = document.elementFromPoint(x, y);
      if (!top || top === document.documentElement || top === document.body) continue;
      const control = top.closest(interactive);
      if (control) { found.add(describe(control)); continue; }
      const words = [...top.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (words) {
        const range = document.createRange(); range.selectNodeContents(top);
        if ([...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) found.add(describe(top));
      }
    }
  }
  return [...found];
}

/** In the page: draws the three lights where macOS puts them, for the screenshot. */
export function drawTrafficLights(lights) {
  const strip = document.createElement("div");
  strip.dataset.lookNative = "traffic-lights";
  strip.setAttribute("aria-hidden", "true");
  strip.style.cssText = `position:fixed;left:${lights.left}px;top:${lights.top}px;z-index:2147483647;display:flex;gap:${lights.step - lights.size}px;pointer-events:none`;
  for (const colour of ["#ff5f57", "#febc2e", "#28c840"]) {
    const light = document.createElement("i");
    light.style.cssText = `display:block;width:${lights.size}px;height:${lights.size}px;border-radius:50%;background:${colour};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.2)`;
    strip.append(light);
  }
  document.body.append(strip);
}
