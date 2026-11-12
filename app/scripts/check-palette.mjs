// Report every theme token and WCAG contrast from the actual CSS, without dependencies.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/main/styles.css", import.meta.url), "utf8");
const overlayCss = readFileSync(new URL("../src/overlay/overlay.css", import.meta.url), "utf8");
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
const light = tokens(css.match(/:root\s*\{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1]) };
const luminance = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Unsupported contrast color: ${hex}`);
  const values = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};
const ratio = (a, b) => {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  const result = (high + 0.05) / (low + 0.05);
  if (!Number.isFinite(result)) throw new Error(`Invalid contrast pair: ${a}, ${b}`);
  return result;
};
const surfaces = ["side", "content", "panel", "surface-2", "menu", "btn", "key", "hover", "pressed", "selected", "accent-soft"];
const report = {};
for (const [theme, palette] of Object.entries({ light, dark })) {
  const contrast = {};
  for (const [label, token] of Object.entries({ body: "text", secondary: "text-2", muted: "text-3", links: "accent-text" })) {
    const measured = surfaces.map((surface) => ({ surface, ratio: ratio(palette[token], palette[surface]) }));
    const worst = measured.reduce((a, b) => a.ratio < b.ratio ? a : b);
    contrast[label] = { foreground: palette[token], onPage: +ratio(palette[token], palette.content).toFixed(2), onPanel: +ratio(palette[token], palette.panel).toFixed(2), minimum: +worst.ratio.toFixed(2), worstSurface: worst.surface };
    if (worst.ratio < 4.5) process.exitCode = 1;
  }
  const fills = ["accent", "accent-hover", "accent-pressed"];
  const minimum = Math.min(...fills.map((fill) => ratio(palette["on-accent"], palette[fill])));
  contrast["on-accent"] = { foreground: palette["on-accent"], fill: palette.accent, ratio: +ratio(palette["on-accent"], palette.accent).toFixed(2), minimum: +minimum.toFixed(2) };
  if (minimum < 4.5) process.exitCode = 1;
  contrast.toast = { normal: +ratio(palette["toast-action"], palette.text).toFixed(2), hover: +ratio(palette["toast-action"], palette["toast-hover"]).toFixed(2) };
  contrast.captionClose = +ratio(palette["on-close"], palette.close).toFixed(2);
  if (contrast.captionClose < 4.5) process.exitCode = 1;
  // The delete dialog's Delete button (members.css `.mb-delete`): white words on the app's solid red, and the red against the dialog's surface.
  contrast.deleteButton = { words: contrast.captionClose, onPanel: +ratio(palette.close, palette.panel).toFixed(2) };
  if (contrast.deleteButton.onPanel < 3) process.exitCode = 1;
  if (Math.min(...Object.values(contrast.toast)) < 4.5) process.exitCode = 1;
  contrast.destructive = Object.fromEntries(["panel", "btn", "menu", "danger-hover", "danger-pressed"].map(surface => [surface, +ratio(palette.err, palette[surface]).toFixed(2)]));
  if (Object.values(contrast.destructive).some(value => value < 4.5)) process.exitCode = 1;
  for (const token of ["hover", "pressed", "hover-edge", "scroll-hover", "toast-hover"]) {
    const channels = palette[token].slice(1).match(/../g).map(value => parseInt(value, 16));
    if (Math.max(...channels) - Math.min(...channels) > 12) throw new Error(`Non-neutral interaction token: ${theme}/${token}`);
  }
  contrast.sendIcon = Object.fromEntries(["panel", "hover", "pressed"].map(surface => [surface, +ratio(palette["accent-icon"], palette[surface]).toFixed(2)]));
  if (Object.values(contrast.sendIcon).some(value => value < 3)) process.exitCode = 1;
  contrast.computerActive = Object.fromEntries(["side", "content", "hover", "pressed"].map(surface => [surface, +ratio(palette["computer-active"], palette[surface]).toFixed(2)]));
  if (Object.values(contrast.computerActive).some(value => value < 3)) process.exitCode = 1;
  report[theme] = { tokens: palette, contrast };
}
// Overlay confirmations reuse the app's opaque panel and button palette in both themes.
if (!/\.ask-card\s*\{[^}]*background:\s*var\(--panel\)/.test(overlayCss)) throw new Error("Overlay confirmation must use the shared opaque panel");
report.overlay = { surface:"panel", buttons:"btn / pri", contrast:Object.fromEntries(Object.entries(report).filter(([name])=>name!=="overlay").map(([name,value])=>[name,{title:+ratio(value.tokens.text,value.tokens.panel).toFixed(2),details:+ratio(value.tokens["text-2"],value.tokens.panel).toFixed(2),primary:+ratio(value.tokens["on-accent"],value.tokens.accent).toFixed(2)}])) };
if (Object.values(report.overlay.contrast).some(values=>Object.values(values).some(value=>value<4.5))) process.exitCode=1;
console.log(JSON.stringify(report, null, 2));
