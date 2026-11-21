// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { type DiagramZoom, type ZoomBox, fitView, keepInStage, mountDiagramZoom, panBy, wheelFactor, zoomAt, zoomLimits } from "./diagram-zoom";
import { replyContentHTML } from "./message-content";
import { mountRichContent } from "./message-rich";
import { setLocale, t } from "./i18n";
vi.mock("./message-diagram", () => ({ renderDiagram: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200"><text>Alpha</text></svg>') }));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); setLocale("zh-TW"); });

/** A chart three times wider than tall in a stage it fits by its width. */
const BOX: ZoomBox = { width: 1200, height: 400, stageWidth: 1000, stageHeight: 600 };

function mounted(): { stage: HTMLElement; svg: SVGSVGElement; zoom: DiagramZoom; buttons: Record<string, HTMLButtonElement> } {
  const stage = document.createElement("div");
  stage.innerHTML = '<div class="diagram-pan"><svg viewBox="0 0 1200 400"></svg></div>';
  const head = document.createElement("div");
  head.innerHTML = ["zoom-out", "zoom-in", "zoom-reset"].map(act => `<button type="button" data-dlg="${act}"></button>`).join("");
  Object.defineProperties(stage, { clientWidth: { value: BOX.stageWidth }, clientHeight: { value: BOX.stageHeight } });
  document.body.append(head, stage);
  const zoom = mountDiagramZoom(stage, head);
  const buttons = Object.fromEntries([...head.querySelectorAll<HTMLButtonElement>("button")].map(button => [button.dataset.dlg!, button]));
  return { stage, svg: stage.querySelector("svg")!, zoom, buttons };
}
const pointer = (stage: HTMLElement, type: string, x: number, y: number, button = 0, pointerId = 1): PointerEvent => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, pointerId });
  stage.dispatchEvent(event);
  return event;
};
const close = (a: number, b: number): void => expect(a).toBeCloseTo(b, 6);

test("the larger diagram starts fitted in the middle of its view, and zooms from a quarter to four times that size", () => {
  const fit = fitView(BOX);
  close(fit.scale, (1000 - 48) / 1200);
  close(fit.x, (1000 - 1200 * fit.scale) / 2);
  close(fit.y, (600 - 400 * fit.scale) / 2);
  const [least, most] = zoomLimits(BOX);
  close(least, fit.scale / 4);
  close(most, fit.scale * 4);
  close(zoomAt(fit, BOX, 1000, 500, 300).scale, most);
  close(zoomAt(fit, BOX, 0.001, 500, 300).scale, least);
  // A very large chart still zooms to twice its own size, where its words read; a small one is fitted at most at twice it.
  expect(zoomLimits({ ...BOX, width: 12000 })[1]).toBe(2);
  expect(fitView({ ...BOX, width: 100, height: 50 }).scale).toBe(2);

  const { stage, svg, zoom, buttons } = mounted();
  expect(stage.dataset.zoom).toBe("100");
  expect(Number.parseFloat(svg.style.width)).toBeCloseTo(1200 * fit.scale, 4);
  expect(Number.parseFloat(svg.style.height)).toBeCloseTo(400 * fit.scale, 4);
  for (let press = 0; press < 12; press++) zoom.act("zoom-in");
  expect(stage.dataset.zoom).toBe("400");
  expect(buttons["zoom-in"]!.disabled).toBe(true);
  expect(buttons["zoom-out"]!.disabled).toBe(false);
  for (let press = 0; press < 20; press++) zoom.act("zoom-out");
  expect(stage.dataset.zoom).toBe("25");
  expect(buttons["zoom-out"]!.disabled).toBe(true);
  expect(buttons["zoom-in"]!.disabled).toBe(false);
  expect(zoom.act("close")).toBe(false);
});

test("the wheel zooms about the pointer, a pinch follows the fingers, and a sideways scroll moves the chart across", () => {
  close(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }), 1.2);
  close(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false }), 1 / 1.2);
  close(wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false }), 1.2);
  close(wheelFactor({ deltaY: -100 * Math.log(1.1), deltaMode: 0, ctrlKey: true }), 1.1);
  close(wheelFactor({ deltaY: -10_000, deltaMode: 0, ctrlKey: false }), 1.25);

  const { stage, zoom } = mounted();
  const before = zoom.view(), at = [300, 200] as const;
  // happy-dom's WheelEvent carries no pointer position: it is given as a browser's would be.
  const wheelAt = (init: WheelEventInit): WheelEvent => Object.defineProperties(new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }), { clientX: { value: at[0] }, clientY: { value: at[1] } });
  const wheel = wheelAt({ deltaY: -100 });
  stage.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  const after = zoom.view();
  close(after.scale, before.scale * 1.2);
  // The point of the chart under the pointer stays under it.
  close((at[0] - after.x) / after.scale, (at[0] - before.x) / before.scale);
  close((at[1] - after.y) / after.scale, (at[1] - before.y) / before.scale);
  stage.dispatchEvent(wheelAt({ deltaX: 50 }));
  close(zoom.view().x, after.x - 50);
  close(zoom.view().scale, after.scale);
});

test("dragging with the left, middle or right button moves the chart with the pointer, and some of it always stays in view", () => {
  const { stage, zoom } = mounted();
  zoom.act("zoom-in");
  for (const button of [0, 1, 2]) {
    const before = zoom.view();
    expect(pointer(stage, "pointerdown", 500, 300, button, 10 + button).defaultPrevented).toBe(true);
    expect(stage.hasAttribute("data-dragging")).toBe(true);
    pointer(stage, "pointermove", 520, 310, button, 10 + button);
    pointer(stage, "pointermove", 530, 320, button, 10 + button);
    pointer(stage, "pointerup", 530, 320, button, 10 + button);
    expect(stage.hasAttribute("data-dragging")).toBe(false);
    close(zoom.view().x, before.x + 30);
    close(zoom.view().y, before.y + 20);
    expect(stage.querySelector<HTMLElement>(".diagram-pan")!.style.transform).toBe(`translate(${zoom.view().x}px, ${zoom.view().y}px)`);
  }
  // A move after the button came up drags nothing; the right button opens no menu and the middle one starts no scrolling.
  const still = zoom.view();
  pointer(stage, "pointermove", 900, 500);
  expect(zoom.view()).toEqual(still);
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  stage.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  const middle = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
  stage.dispatchEvent(middle);
  expect(middle.defaultPrevented).toBe(true);

  const fit = fitView(BOX), width = 1200 * fit.scale, height = 400 * fit.scale;
  const far = panBy(fit, BOX, 10_000, 10_000), back = panBy(fit, BOX, -10_000, -10_000);
  close(far.x, BOX.stageWidth - 48); close(far.y, BOX.stageHeight - 48);
  close(back.x, 48 - width); close(back.y, 48 - height);
  expect(keepInStage(fit, BOX)).toEqual(fit);
});

test("a double press, the reset control and the 0 key put the chart back fitted, and the arrows and + - move and zoom it", () => {
  const { stage, zoom } = mounted();
  const fit = fitView(BOX);
  const moveAway = (): void => {
    zoom.act("zoom-in"); zoom.act("zoom-in");
    pointer(stage, "pointerdown", 400, 300); pointer(stage, "pointermove", 460, 260); pointer(stage, "pointerup", 460, 260);
    expect(zoom.view()).not.toEqual(fit);
  };
  moveAway();
  stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  expect(zoom.view()).toEqual(fit);
  expect(stage.dataset.zoom).toBe("100");
  moveAway();
  expect(zoom.act("zoom-reset")).toBe(true);
  expect(zoom.view()).toEqual(fit);
  moveAway();
  const key = (value: string, shiftKey = false): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    return event;
  };
  expect(key("0").defaultPrevented).toBe(true);
  expect(zoom.view()).toEqual(fit);
  key("ArrowRight"); close(zoom.view().x, fit.x + 40);
  key("ArrowDown", true); close(zoom.view().y, fit.y + 120);
  key("+"); expect(stage.dataset.zoom).toBe("125");
  key("-"); expect(stage.dataset.zoom).toBe("100");
  expect(key("a").defaultPrevented).toBe(false);
});

test("pressing the chart opens the larger view: −, + and reset before the ×, and one line under it that says how to use it in the window's language", async () => {
  for (const [locale, hint] of [["zh-TW", "滾輪縮放，按住拖曳移動，雙擊重設"], ["en", "Scroll to zoom, drag to move, double-click to reset"]] as const) {
    setLocale(locale);
    const root = document.createElement("div"); document.body.append(root);
    root.style.setProperty("--panel", "#161616");
    root.innerHTML = replyContentHTML(`\`\`\`mermaid\nflowchart LR\n  ${locale.replace("-", "")} --> Larger\n\`\`\``);
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
    vi.spyOn(root.querySelector(".message-code")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 40));
    mountRichContent(root);
    await vi.waitFor(() => expect(root.querySelector('.diagram-view[data-rich-act="open-diagram"] svg')).not.toBeNull());
    const view = root.querySelector<HTMLElement>(".diagram-view")!;
    view.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50 }));
    view.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 50, clientY: 50, detail: 1 }));

    const dialog = document.querySelector<HTMLElement>(".mb-dialog.rich-view-dialog.diagram-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("h2")!.textContent).toBe(t("chat.diagram"));
    const head = [...dialog.querySelectorAll<HTMLButtonElement>(".mb-dlg-head button")];
    expect(head.map(button => button.dataset.dlg)).toEqual(["zoom-out", "zoom-in", "zoom-reset", "close"]);
    expect(head.map(button => button.getAttribute("aria-label"))).toEqual([t("chat.diagramZoomOut"), t("chat.diagramZoomIn"), t("chat.diagramZoomReset"), t("common.close")]);
    const line = dialog.querySelector<HTMLElement>(".diagram-hint")!;
    expect(line.textContent).toBe(hint);
    expect(line.hasAttribute("title")).toBe(false);
    expect(dialog.querySelectorAll("[title]").length).toBe(head.length);
    const stage = dialog.querySelector<HTMLElement>(".diagram-stage")!;
    expect(stage.getAttribute("aria-describedby")).toBe(line.id);
    expect(stage.querySelector(".diagram-pan > svg")).not.toBeNull();
    // The chart stands on the conversation's panel it was drawn on, not on the dialog's lighter one.
    expect(stage.style.getPropertyValue("--diagram-ground")).toBe("#161616");
    expect(document.activeElement).toBe(stage);
    // A dialog that only shows something keeps no footer (R-UI-117); its head's controls reach the view.
    expect(dialog.querySelector(".mb-dlg-act")).toBeNull();
    dialog.querySelector<HTMLButtonElement>('[data-dlg="zoom-in"]')!.click();
    expect(stage.dataset.zoom).toBe("125");
    expect(document.querySelector(".diagram-dialog")).not.toBeNull();
    // Escape leaves it as before.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.querySelector(".diagram-dialog")).toBeNull();
  }
});
