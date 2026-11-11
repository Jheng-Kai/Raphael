// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { avatarHTML, cleanCrop, cropStyle, currentAvatar, loadAvatar, onAvatarChange, readAvatar, setAvatar } from "./avatar";
import { cropDialog, frameCrop, moveCrop, resizeCrop, startView, zoomCrop } from "./avatar-settings";
import { openDialog } from "./member-dialogs";
import { pictureRect } from "../overlay/emblem";
import { setLocale, t } from "./i18n";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

afterEach(() => setAvatar(null));

/** The open dialog's picture, as if a `w` × `h` file had loaded. */
function loaded(w: number, h: number): HTMLElement {
  const img = document.querySelector<HTMLImageElement>(".av-crop-view img")!;
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  img.dispatchEvent(new Event("load"));
  return document.querySelector<HTMLElement>(".av-crop-view")!;
}

test("a language change translates the open crop dialog without losing its crop", async () => {
  const result = cropDialog(PNG);
  const stage = loaded(400, 200);
  stage.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
  setLocale("en");
  expect(document.querySelector("#av-crop-title")!.textContent).toBe(t("settings.avatar"));
  expect(stage.getAttribute("aria-label")).toBe(t("settings.avatarFrame"));
  expect(document.querySelector('[data-act="crop-done"]')!.textContent).toBe(t("settings.avatarDone"));
  document.querySelector<HTMLElement>('[data-act="crop-done"]')!.click();
  const crop = (await result)!;
  expect(crop.zoom).toBeCloseTo(1.08);
  expect(crop.x).toBeCloseTo(0.5);
  expect(crop.y).toBeCloseTo(0.5);
  setLocale("zh-TW");
});

describe("Raphael's face", () => {
  test("the emblem of the theme: both pictures, the stylesheet shows one; the larger file for a larger face", () => {
    const small = avatarHTML({ size: 26 });
    expect(small).toContain('style="--av:26px"');
    expect(small).toContain('<img class="em-l" src="/brand/app-emblem-light-64.webp"');
    expect(small).toContain('<img class="em-d" src="/brand/app-emblem-dark-64.webp"');
    expect(small).toContain('aria-hidden="true"');
    expect(avatarHTML({ size: 132 })).toContain("app-emblem-light-128.webp");
    // while he thinks or listens, and on the empty page, the turning loop
    expect(avatarHTML({ size: 26, loop: true })).toContain('src="/brand/app-emblem-dark-loop.webp"');
  });

  test("theme alternatives defer loading until visible instead of fetching a discarded hidden emblem", () => {
    for (const size of [26, 132]) for (const loop of [false, true]) {
      const face = document.createElement("div");
      face.innerHTML = avatarHTML({ size, loop, avatar: null });
      const pictures = [...face.querySelectorAll("img")];
      expect(pictures).toHaveLength(2);
      expect(pictures.map(image => image.loading)).toEqual(["lazy", "lazy"]);
    }
  });

  test("the person's picture, in a circle, cut as they chose; the same still or moving", () => {
    setAvatar({ url: PNG, crop: { x: 0.25, y: 0.5, zoom: 2 } });
    const html = avatarHTML({ size: 34, loop: true, cls: "x" });
    expect(html).toContain('class="av av-custom x"');
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('style="object-position:25% 50%;transform-origin:25% 50%;transform:scale(2)"');
    expect(html).not.toContain("emblem");
    // a page may ask for the emblem whatever is in force
    expect(avatarHTML({ size: 34, avatar: null })).toContain("app-emblem");
  });

  test("only a data URL of the four kinds is a picture; anything else is the emblem", () => {
    expect(readAvatar({ url: PNG, crop: { x: 0.1, y: 0.2, zoom: 1.5 } })).toEqual({ url: PNG, crop: { x: 0.1, y: 0.2, zoom: 1.5 } });
    for (const url of [
      "https://example.com/a.png",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      'data:image/png;base64,AAAA" onerror="x',
      "data:text/html;base64,PGI+",
    ]) {
      expect(readAvatar({ url, crop: { x: 0.5, y: 0.5, zoom: 1 } }), url).toBeNull();
    }
    expect(readAvatar(null)).toBeNull();
    expect(readAvatar("x")).toBeNull();
  });

  test("a crop is kept in range; what is not a number is the middle, unenlarged", () => {
    expect(cleanCrop({ x: -1, y: 2, zoom: 9 })).toEqual({ x: 0, y: 1, zoom: 4 });
    expect(cleanCrop({ x: Number.NaN, zoom: 0.5 })).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(cleanCrop(null)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(cropStyle({ x: 1 / 3, y: 0, zoom: 1.23456 })).toBe("object-position:33.3% 0%;transform-origin:33.3% 0%;transform:scale(1.235)");
  });

  test("every place that shows him hears the change; a picture that cannot be read is the emblem", async () => {
    const heard = vi.fn();
    const stop = onAvatarChange(heard);
    await loadAvatar(async () => ({ url: PNG, crop: { x: 0.5, y: 0.5, zoom: 1 } }));
    expect(currentAvatar()?.url).toBe(PNG);
    await loadAvatar(async () => {
      throw new Error("no app");
    });
    expect(currentAvatar()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    setAvatar(null);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("the crop dialog", () => {
  // A wide picture, 400 × 200, fitted in the 320 px stage with 16 px of air: 288 × 144 at (16, 88).
  const W = 400, H = 200;

  test("it opens on the whole picture with the frame over its middle square, which is the uncut picture", () => {
    const view = startView(W, H);
    expect(view).toMatchObject({ s: 0.72, ox: 16, oy: 88, f: 144, fx: 88, fy: 88 });
    expect(frameCrop(view, W, H)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });

  test("the circle shows exactly what the frame showed: the cut maps back onto the same rectangle", () => {
    let view = startView(W, H);
    view = zoomCrop(view, 1.6, 120, 140, W, H);
    view = moveCrop(view, -25, 12, W, H);
    view = resizeCrop(view, "se", view.fx + 100, view.fy + 100, W, H);
    const rect = pictureRect(W, H, view.f, frameCrop(view, W, H));
    expect(rect.x).toBeCloseTo(view.ox - view.fx);
    expect(rect.y).toBeCloseTo(view.oy - view.fy);
    expect(rect.w).toBeCloseTo(W * view.s);
    expect(rect.h).toBeCloseTo(H * view.s);
  });

  test("a drag moves the picture as far as the pointer, and never uncovers the frame", () => {
    const view = startView(W, H);
    expect(moveCrop(view, -30, 0, W, H).ox).toBeCloseTo(-14);
    expect(frameCrop(moveCrop(view, -5000, 0, W, H), W, H).x).toBe(1);
    expect(frameCrop(moveCrop(view, 5000, 0, W, H), W, H).x).toBe(0);
    // the frame covers the picture's full height, so it cannot move up or down
    expect(moveCrop(view, 0, 40, W, H).oy).toBe(88);
  });

  test("the wheel zooms about the pointer, never below the frame nor past the most enlargement", () => {
    const view = startView(W, H);
    const closer = zoomCrop(view, 2, view.fx, view.fy, W, H);
    expect(closer.fx - closer.ox).toBeCloseTo((view.fx - view.ox) * 2);
    expect(frameCrop(zoomCrop(view, 0.1, 160, 160, W, H), W, H).zoom).toBe(1);
    expect(frameCrop(zoomCrop(view, 100, 160, 160, W, H), W, H).zoom).toBe(4);
  });

  test("a corner resizes the square frame about the opposite corner, inside the picture and never tiny", () => {
    const view = startView(W, H);
    const smaller = resizeCrop(view, "se", 180, 200, W, H);
    expect(smaller).toMatchObject({ fx: 88, fy: 88, f: 112 });
    const nw = resizeCrop(view, "nw", 150, 140, W, H);
    expect(nw.fx + nw.f).toBe(232);
    expect(nw.fy + nw.f).toBe(232);
    expect(nw.f).toBe(92);
    // outward it stops at the picture's edge, inward at 64 px
    expect(resizeCrop(view, "se", 400, 400, W, H).f).toBe(144);
    expect(resizeCrop(view, "se", 90, 90, W, H).f).toBe(64);
  });

  test("only the left button moves the picture; the thirds show while it is held", async () => {
    document.body.innerHTML = "";
    const done = cropDialog(PNG);
    const stage = loaded(W, H);
    const press = (button: number) => stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button, pointerId: 1, clientX: 100, clientY: 100 }));
    press(2);
    expect(stage.hasAttribute("data-pressed")).toBe(false);
    press(0);
    expect(stage.hasAttribute("data-pressed")).toBe(true);
    stage.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 70, clientY: 100 }));
    stage.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(stage.hasAttribute("data-pressed")).toBe(false);
    expect(document.querySelector<HTMLElement>(".av-crop-view img")!.style.left).toBe("-14px");
    expect(document.querySelector(".av-crop-zoom, input[type=range]")).toBeNull();
    document.querySelector<HTMLElement>('[data-act="crop-done"]')!.click();
    expect((await done)!.x).toBeGreaterThan(0.5);
  });

  test("traps Tab focus inside the crop dialog and Escape closes only the crop dialog when stacked over another dialog", async () => {
    document.body.innerHTML = "";
    const under = openDialog({ title: "Under", body: '<input id="u">', actions: {}, onAct: () => {} });
    const done = cropDialog(PNG);
    const stage = document.querySelector<HTMLElement>(".av-crop-view")!;
    const doneBtn = document.querySelector<HTMLButtonElement>('[data-act="crop-done"]')!;
    expect(document.activeElement).toBe(doneBtn);
    doneBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(stage);
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(doneBtn);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await done).toBeNull();
    expect(under.el.isConnected).toBe(true);
    under.close();
  });

  test("crop drags ending outside keep the crop open; an outside press cancels only the crop", async () => {
    document.body.innerHTML = "";
    const under = openDialog({ title: "Under", body: '<input id="u">', actions: {}, onAct: () => {} });
    const done = cropDialog(PNG);
    const press = (start: Element, end = start) => {
      start.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }));
      end.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }));
      end.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    };
    const scrim = document.querySelector(".av-crop-scrim")!;
    press(document.querySelector(".av-crop h2")!, scrim);
    expect(document.querySelector(".av-crop")).not.toBeNull();
    // The crop's scrim hides the dialog under it, so the press is spent on the crop alone.
    press(scrim); expect(await done).toBeNull();
    expect(under.el.isConnected).toBe(true); expect(document.activeElement).toBe(under.el.querySelector("input"));
    under.close();
  });
});
