// @vitest-environment happy-dom
// The dialogs of the members (member-dialogs.ts): the question before
// a delete, the routine the core offers, and a group's places.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { confirmDelete, editSources, offerRoutine, pictureType, pickPicture } from "./member-dialogs";
import { registerDismissal } from "./dismissals";
import type { MemberGroup } from "./types";
import { setLocale } from "./i18n";

const GROUPS: MemberGroup[] = [
  { id: 1, name: "專案", position: 0, sources: [{ kind: "github", ref: "example/app" }] },
  { id: 2, name: "學習", position: 1, sources: [] },
];

beforeEach(() => {
  document.body.innerHTML = "";
});

test('computer data removal names the host and remains unchecked until the owner chooses it', async () => {
  const remove = vi.fn();
  const answer = confirmDelete('Sample', {computerHost:'studio-mini', removeComputer:remove});
  const checkbox = document.querySelector<HTMLButtonElement>('[data-remove-computer]')!;
  expect(checkbox.matches('.tg[role="switch"][aria-checked="false"]')).toBe(true);
  expect(checkbox.closest('.row')?.textContent).toContain('studio-mini');
  expect(checkbox.getAttribute('aria-label')).toContain('Sample');
  document.querySelector<HTMLButtonElement>('[data-dlg="delete"]')!.click();
  expect(await answer).toBe(true); expect(remove).toHaveBeenCalledWith(false);
});

test('computer removal is chosen through the shared switch without closing the dialog', async () => {
  const remove = vi.fn();
  const answer = confirmDelete('小晴', {computerHost:'mac-mini', removeComputer:remove});
  const control = document.querySelector<HTMLButtonElement>('[data-remove-computer]')!;
  control.click();
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(document.querySelector('.mb-dialog')?.textContent).toContain('在 mac-mini 上');
  expect(remove).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-dlg="delete"]')!.click();
  expect(await answer).toBe(true); expect(remove).toHaveBeenCalledWith(true);
});

test("a language change dismisses a translated confirmation before it can show stale actions", async () => {
  const result = confirmDelete("Project");
  expect(document.querySelector(".mb-confirm")).not.toBeNull();
  setLocale("en");
  expect(document.querySelector(".mb-confirm")).toBeNull();
  expect(await result).toBe(false);
  setLocale("zh-TW");
});

describe("a picture", () => {
  test("the owner file chooser stays inside Settings instead of dismissing its modal", () => {
    document.body.innerHTML = '<section class="modal-scrim"><div class="modal"></div></section>';
    const panel = document.querySelector<HTMLElement>(".modal")!, close = vi.fn();
    const stop = registerDismissal(panel, close);
    try {
      pickPicture(() => {});
      expect(panel.querySelector('input[type="file"]')).not.toBeNull();
      expect(close).not.toHaveBeenCalled();
    } finally { stop(); }
  });
});

test("a picture of the PC is a PNG, JPG, WebP or GIF", () => {
  expect(pictureType({ name: "a.png", type: "image/png" })).toBe("image/png");
  expect(pictureType({ name: "a.JPG", type: "" })).toBe("image/jpeg");
  expect(pictureType({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
  expect(pictureType({ name: "a.exe", type: "" })).toBeNull();
});

test("a delete is asked first: 刪除 says yes, 取消 no", async () => {
  const yes = confirmDelete("文書");
  expect(document.querySelector(".mb-dialog h2")!.textContent).toBe("刪除「文書」？");
  expect([...document.querySelectorAll(".mb-dlg-act .btn")].map((b) => b.textContent)).toEqual(["取消", "刪除"]);
  const dialog = document.querySelector<HTMLElement>(".mb-dialog")!;
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("此操作無法復原。");
  expect(dialog.querySelector('[data-dlg="delete"]')?.classList.contains("pri")).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('[data-dlg="cancel"]'));
  document.querySelector<HTMLElement>('[data-dlg="delete"]')!.click();
  expect(await yes).toBe(true);
  const no = confirmDelete("文書");
  document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
  expect(await no).toBe(false);
});

test("the routine the core offers is the owner's to take: 加入 says yes, 不用 no", async () => {
  const offer = { title: "每天早上的進度", prompt: "看進度", schedule: { kind: "daily" as const, time: "09:00" } };
  const yes = offerRoutine(offer);
  expect(document.querySelector(".mb-dialog h2")!.textContent).toBe("加入例行任務？");
  expect(document.querySelector(".mb-offer-t")!.textContent).toBe("每天早上的進度每天 09:00");
  expect(document.querySelector(".mb-offer-t .routine-sentence strong")?.textContent).toBe("每天");
  expect([...document.querySelectorAll(".mb-dlg-act .btn")].map((b) => b.textContent)).toEqual(["不用", "加入"]);
  document.querySelector<HTMLElement>('[data-dlg="yes"]')!.click();
  expect(await yes).toBe(true);
  const no = offerRoutine(offer);
  document.querySelector<HTMLElement>('[data-dlg="no"]')!.click();
  expect(await no).toBe(false);
  const left = offerRoutine(offer);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(await left).toBe(false);
});

test("a group's places: added by what is typed, taken off by their ×, kept with 儲存", async () => {
  const done = editSources(GROUPS[0]);
  const input = document.querySelector<HTMLInputElement>("#mb-source")!;
  input.value = "https://github.com/example/other";
  document.querySelector<HTMLElement>('[data-dlg="add"]')!.click();
  input.value = "not a place";
  document.querySelector<HTMLElement>('[data-dlg="add"]')!.click();
  expect([...document.querySelectorAll(".mb-chip")].map((c) => c.textContent)).toEqual(["example/app", "example/other"]);
  document.querySelector<HTMLElement>('[data-dlg="drop"][data-i="0"]')!.click();
  document.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
  expect(await done).toEqual([{ kind: "github", ref: "example/other" }]);
});
