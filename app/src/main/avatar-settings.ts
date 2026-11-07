// Changing Raphael's picture, from his details panel on the 拉斐爾 page (member-details.ts), the
// same place as every member's: 「從電腦選…」 opens the file dialog of Windows from the app
// (`avatar_pick`: PNG, JPG, WebP or GIF; the page never learns where the file was), then a small
// dialog with the whole picture and a square frame over it; 完成 keeps a copy of it in the app's
// local folder with that cut (`avatar_save`). 還原 deletes the copy, and Raphael is his emblem again
// (`avatar_clear`). A moving picture keeps moving: the copy is the file itself, and the cut is a crop
// drawn over it (`AvatarCrop`), not a new image. The owner's own photo uses the same dialog.

import { onLocaleChange, t } from "./i18n";
import { isTopLayer, registerDismissal } from "./dismissals";

import * as api from "./api";
import { type AvatarCrop, ZOOM_MAX, cleanCrop, loadAvatar } from "./avatar";
import { describeError } from "./format";
import { actionRow, btn, esc, toaster } from "./ui";

/** The square the picture is laid out in, in px, and the air around the picture inside it. */
const STAGE_PX = 320;
const STAGE_PAD = 16;
/** The frame never gets smaller than this, nor closer to the stage's edge than its corners need. */
const FRAME_MIN = 64;
const EDGE_GAP = 6;

/**
 * What the dialog shows, in px of its stage: the picture enlarged `s` times with its top left at
 * `ox`, `oy`, and the square frame of side `f` with its top left at `fx`, `fy`.
 */
export interface CropView { s: number; ox: number; oy: number; fx: number; fy: number; f: number }
export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/** The whole picture `w` × `h` fitted in the stage, the frame over the largest square of it in the middle. */
export function startView(w: number, h: number, stage = STAGE_PX, pad = STAGE_PAD): CropView {
  const s = Math.min((stage - 2 * pad) / w, (stage - 2 * pad) / h);
  const ox = (stage - w * s) / 2, oy = (stage - h * s) / 2;
  const f = Math.min(w, h) * s;
  return { s, ox, oy, f, fx: (stage - f) / 2, fy: (stage - f) / 2 };
}

/**
 * The cut the frame shows, as `AvatarCrop` keeps it: the frame covers a square of `c` picture px,
 * so the picture is enlarged `min(w, h) / c` times, and its left edge sits `x` of the way along the
 * room the picture leaves beside the square (the same for `y`).
 */
export function frameCrop(v: CropView, w: number, h: number): AvatarCrop {
  if (w <= 0 || h <= 0 || v.s <= 0) return cleanCrop(null);
  const c = v.f / v.s;
  const left = (v.fx - v.ox) / v.s, top = (v.fy - v.oy) / v.s;
  return cleanCrop({ zoom: Math.min(w, h) / c, x: w - c > 1e-6 ? left / (w - c) : 0.5, y: h - c > 1e-6 ? top / (h - c) : 0.5 });
}

/** The picture always lies under the whole frame: a move that would uncover it stops at the edge. */
function covered(v: CropView, w: number, h: number): CropView {
  return { ...v, ox: clamp(v.ox, v.fx + v.f - w * v.s, v.fx), oy: clamp(v.oy, v.fy + v.f - h * v.s, v.fy) };
}

/** A drag of `dx`, `dy` px moves the picture under the frame, as far as the pointer. */
export function moveCrop(v: CropView, dx: number, dy: number, w: number, h: number): CropView {
  return covered({ ...v, ox: v.ox + dx, oy: v.oy + dy }, w, h);
}

/** The wheel enlarges the picture `factor` times about the pointer at `px`, `py`: never smaller than the frame, never past ZOOM_MAX. */
export function zoomCrop(v: CropView, factor: number, px: number, py: number, w: number, h: number): CropView {
  const least = v.f / Math.min(w, h);
  const s = clamp(v.s * factor, least, least * ZOOM_MAX);
  const k = s / v.s;
  return covered({ ...v, s, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k }, w, h);
}

/**
 * A drag of one corner to `px`, `py` resizes the frame about the opposite corner, kept square, inside
 * the picture and the stage; the picture stays where it is.
 */
export function resizeCrop(v: CropView, corner: Corner, px: number, py: number, w: number, h: number, stage = STAGE_PX): CropView {
  const west = corner.endsWith("w"), north = corner.startsWith("n");
  const ax = west ? v.fx + v.f : v.fx, ay = north ? v.fy + v.f : v.fy;
  const left = Math.max(EDGE_GAP, v.ox), top = Math.max(EDGE_GAP, v.oy);
  const right = Math.min(stage - EDGE_GAP, v.ox + w * v.s), bottom = Math.min(stage - EDGE_GAP, v.oy + h * v.s);
  const room = Math.max(0, Math.min(west ? ax - left : right - ax, north ? ay - top : bottom - ay));
  const least = Math.min(room, Math.max(FRAME_MIN, (v.s * Math.min(w, h)) / ZOOM_MAX));
  const f = clamp(Math.max(Math.abs(px - ax), Math.abs(py - ay)), least, room);
  return { ...v, f, fx: west ? ax - f : ax, fy: north ? ay - f : ay };
}

/** The crop dialog for the picture `url`: resolves with the cut chosen, or null when it is left. */
export function cropDialog(url: string): Promise<AvatarCrop | null> {
  return new Promise((resolve) => {
    let view: CropView | null = null;
    const scrim = document.createElement("div");
    scrim.className = "av-crop-scrim";
    const corners = (["nw", "ne", "sw", "se"] as const).map((corner) => `<span class="av-crop-corner" data-corner="${corner}"></span>`).join("");
    scrim.innerHTML =
      `<div class="av-crop" role="dialog" aria-modal="true" aria-labelledby="av-crop-title" style="--stage:${STAGE_PX}px">` +
      `<h2 id="av-crop-title">${esc(t("settings.avatar"))}</h2>` +
      `<div class="av-crop-view" tabindex="0" aria-label="${esc(t("settings.avatarFrame"))}">` +
      `<img src="${esc(url)}" alt="" draggable="false"><div class="av-crop-frame" hidden><span class="av-crop-grid"></span>${corners}</div></div>` +
      actionRow({ cls: "av-crop-act", secondary: btn(esc(t("common.cancel")), "", ' data-act="crop-cancel"'), primary: { label: esc(t("settings.avatarDone")), attrs: ' data-act="crop-done"' } }) +
      `</div>`;
    const stage = scrim.querySelector<HTMLElement>(".av-crop-view")!;
    const img = stage.querySelector("img")!;
    const frame = stage.querySelector<HTMLElement>(".av-crop-frame")!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let stopOutside = (): void => {};
    let stopLocale = (): void => {};
    const size = (): [number, number] => [img.naturalWidth, img.naturalHeight];
    const draw = (): void => {
      if (!view) return;
      const [w, h] = size();
      img.style.cssText = `left:${view.ox}px;top:${view.oy}px;width:${w * view.s}px;height:${h * view.s}px`;
      frame.style.cssText = `left:${view.fx}px;top:${view.fy}px;width:${view.f}px;height:${view.f}px`;
      frame.hidden = false;
    };
    const start = (): void => {
      const [w, h] = size();
      if (w <= 0 || h <= 0) return;
      view = startView(w, h);
      draw();
    };
    const chosen = (): AvatarCrop => (view ? frameCrop(view, ...size()) : cleanCrop(null));
    const close = (result: AvatarCrop | null): void => {
      stopOutside();
      stopLocale();
      scrim.remove();
      document.removeEventListener("keydown", onKey, true);
      opener?.focus();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!isTopLayer(scrim.querySelector(".av-crop"))) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close(null);
      } else if (e.key === "Tab") {
        const stops = [...scrim.querySelectorAll<HTMLElement>('[tabindex="0"], button:not(:disabled)')];
        if (stops.length === 0) return;
        const first = stops[0]!;
        const last = stops[stops.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !active || !scrim.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !active || !scrim.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // The left button only: a press on a corner resizes the frame, anywhere else moves the picture.
    // While it is held the frame shows its thirds.
    let held: { corner: Corner | null; x: number; y: number } | null = null;
    const local = (e: PointerEvent | WheelEvent): [number, number] => {
      const box = stage.getBoundingClientRect();
      return [e.clientX - box.left, e.clientY - box.top];
    };
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !view) return;
      e.preventDefault();
      stage.setPointerCapture?.(e.pointerId);
      const corner = (e.target as Element).closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined;
      held = { corner: corner ?? null, x: e.clientX, y: e.clientY };
      stage.dataset.pressed = "";
    });
    stage.addEventListener("pointermove", (e) => {
      if (!held || !view) return;
      const [w, h] = size();
      if (held.corner) view = resizeCrop(view, held.corner, ...local(e), w, h);
      else view = moveCrop(view, e.clientX - held.x, e.clientY - held.y, w, h);
      held = { ...held, x: e.clientX, y: e.clientY };
      draw();
    });
    const drop = (): void => {
      held = null;
      delete stage.dataset.pressed;
    };
    stage.addEventListener("pointerup", drop);
    stage.addEventListener("pointercancel", drop);
    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!view) return;
        view = zoomCrop(view, e.deltaY < 0 ? 1.08 : 1 / 1.08, ...local(e), ...size());
        draw();
      },
      { passive: false },
    );
    // From the keyboard: the arrows move the picture, + and - zoom it about the frame's middle.
    stage.addEventListener("keydown", (e) => {
      if (!view) return;
      const [w, h] = size();
      const step = e.shiftKey ? 32 : 8;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const middle: [number, number] = [view.fx + view.f / 2, view.fy + view.f / 2];
      if (moves[e.key]) view = moveCrop(view, ...moves[e.key]!, w, h);
      else if (e.key === "+" || e.key === "=") view = zoomCrop(view, 1.08, ...middle, w, h);
      else if (e.key === "-") view = zoomCrop(view, 1 / 1.08, ...middle, w, h);
      else return;
      e.preventDefault();
      draw();
    });
    img.addEventListener("load", start);
    scrim.addEventListener("click", (e) => {
      const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "crop-cancel") close(null);
      else if (act === "crop-done") close(chosen());
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(scrim);
    if (img.complete) start();
    stopLocale = onLocaleChange(() => {
      scrim.querySelector("h2")!.textContent = t("settings.avatar");
      stage.setAttribute("aria-label", t("settings.avatarFrame"));
      scrim.querySelector('[data-act="crop-cancel"]')!.textContent = t("common.cancel");
      scrim.querySelector('[data-act="crop-done"]')!.textContent = t("settings.avatarDone");
    });
    stopOutside = registerDismissal(scrim.querySelector<HTMLElement>(".av-crop")!, () => close(null));
    scrim.querySelector<HTMLElement>('[data-act="crop-done"]')!.focus();
  });
}

/** 從電腦選…: the file dialog, the crop dialog, then the copy kept. */
export async function changeRaphaelAvatar(): Promise<void> {
  let url: string | null;
  try {
    url = await api.avatarPick();
  } catch (err) {
    toaster.info(describeError(err));
    return;
  }
  if (url === null) return; // the dialog was closed
  const crop = await cropDialog(url);
  if (crop === null) return;
  try {
    await api.avatarSave(crop);
  } catch (err) {
    toaster.info(describeError(err));
    return;
  }
  await loadAvatar(api.avatarGet);
}

/** 還原: the copy is deleted and Raphael is his emblem. */
export async function resetRaphaelAvatar(): Promise<void> {
  try {
    await api.avatarClear();
  } catch (err) {
    toaster.info(describeError(err));
    return;
  }
  await loadAvatar(api.avatarGet);
}
