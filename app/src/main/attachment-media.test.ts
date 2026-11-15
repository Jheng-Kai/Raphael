// @vitest-environment happy-dom
import { attachmentSource } from "./api";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAttachmentMedia } from "./attachment-media";
import { sentFileHTML } from "./attachments";
import { resetMediaCache } from "./media-cache";

vi.mock("./api", () => ({ attachmentSource: vi.fn(async (id: string) => `http://raphael-media.localhost/${id}`) }));

/** happy-dom decodes nothing: a picture that decodes at once and has a size, as a real one does. */
class DecodedImage { src = ""; naturalWidth = 4; naturalHeight = 3; decode = async (): Promise<void> => {}; }
beforeEach(() => { vi.stubGlobal("IntersectionObserver", undefined); vi.stubGlobal("Image", DecodedImage); resetMediaCache(); vi.mocked(attachmentSource).mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("a stored picture comes by its id from the media protocol, once a session, and a thread opened again draws it at once", async () => {
  const id = "a".repeat(32) + ".png", url = `http://raphael-media.localhost/${id}`;
  const thread = (): HTMLElement => { const root = document.createElement("div"); root.innerHTML = `<button data-attachment="${id}"><img data-attachment="${id}"></button>`; document.body.append(root); return root; };
  const read = vi.fn();
  const first = thread(), media = createAttachmentMedia(first, read);
  media.sync();
  await settle();
  expect(first.querySelector("img")!.getAttribute("src")).toBe(url);
  expect(media.source(first.querySelector("button")!)).toBe(url);
  media.sync(); await settle();
  // No base64 crosses IPC, and the shell is asked once.
  expect(read).not.toHaveBeenCalled();
  expect(attachmentSource).toHaveBeenCalledTimes(1);
  media.reset(); first.remove();
  // Another conversation (or the same one opened again) sets the URL it already has, in the same frame, asking nothing.
  const again = thread(), next = createAttachmentMedia(again, read);
  next.sync();
  expect(again.querySelector("img")!.getAttribute("src")).toBe(url);
  expect(attachmentSource).toHaveBeenCalledTimes(1);
});

test("two threads that ask for the same picture at the same time ask the shell once", async () => {
  const id = "e".repeat(32) + ".png";
  let answer!: (url: string) => void;
  vi.mocked(attachmentSource).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const roots = [0, 1].map(() => { const root = document.createElement("div"); root.innerHTML = `<img data-attachment="${id}">`; return root; });
  for (const root of roots) createAttachmentMedia(root, vi.fn()).sync();
  answer(`http://raphael-media.localhost/${id}`);
  await settle();
  expect(attachmentSource).toHaveBeenCalledTimes(1);
  for (const root of roots) expect(root.querySelector("img")!.getAttribute("src")).toBe(`http://raphael-media.localhost/${id}`);
});

test("a stored copy the protocol does not serve is read once as a Blob instead", async () => {
  const id = "f".repeat(32) + ".bin";
  vi.mocked(attachmentSource).mockRejectedValueOnce(new Error("attachment unavailable"));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stored-image");
  const root = document.createElement("div");
  root.innerHTML = `<img data-attachment="${id}">`;
  const read = vi.fn().mockResolvedValue({ mime: "image/png", data: btoa("image") });
  createAttachmentMedia(root, read).sync();
  await settle();
  expect(root.querySelector("img")!.getAttribute("src")).toBe("blob:stored-image");
  createAttachmentMedia(root, read).sync();
  await settle();
  expect(read).toHaveBeenCalledTimes(1);
});

test("a response from an old thread cannot populate media in the new one", async () => {
  const root = document.createElement("div");
  root.innerHTML = `<img data-attachment="${"b".repeat(32)}.png">`;
  let finish!: (url: string) => void;
  vi.mocked(attachmentSource).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const media = createAttachmentMedia(root, vi.fn());
  media.sync(); media.reset();
  finish("http://raphael-media.localhost/old");
  await settle();
  expect(root.querySelector("img")!.hasAttribute("src")).toBe(false);
});

test("our sound row plays, pauses, seeks and follows its duration and playback", async () => {
  const root = document.createElement("div");
  root.innerHTML = sentFileHTML({ name: "voice.wav", mime: "audio/wav", preview: "data:audio/wav;base64,AA==" });
  const audio = root.querySelector("audio")!;
  let paused = true;
  Object.defineProperty(audio, "duration", { configurable: true, value: 90 });
  Object.defineProperty(audio, "paused", { configurable: true, get: () => paused });
  const play = vi.spyOn(audio, "play").mockImplementation(async () => { paused = false; audio.dispatchEvent(new Event("play")); });
  const pause = vi.spyOn(audio, "pause").mockImplementation(() => { paused = true; audio.dispatchEvent(new Event("pause")); });
  const media = createAttachmentMedia(root, vi.fn()); media.sync(); media.sync();
  audio.dispatchEvent(new Event("loadedmetadata"));
  const button = root.querySelector<HTMLButtonElement>('[data-mp-act="toggle"]')!;
  const range = root.querySelector<HTMLInputElement>(".mp-seek")!;
  expect(range.disabled).toBe(false);
  button.click(); await Promise.resolve();
  expect(play).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-label")).toBe("暫停");
  audio.currentTime = 30; audio.dispatchEvent(new Event("timeupdate"));
  expect(root.querySelector(".mp-time")!.textContent).toBe("0:30 / 1:30");
  range.value = "500"; range.dispatchEvent(new Event("input"));
  expect(audio.currentTime).toBe(45);
  button.click(); expect(pause).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-label")).toBe("播放");
  media.reset(); expect(pause).toHaveBeenCalledTimes(2);
});

test("removed media are stopped when the timeline redraws", () => {
  const root = document.createElement("div"); root.innerHTML = "<video></video>";
  const pause = vi.spyOn(root.querySelector("video")!, "pause").mockImplementation(() => {});
  const media = createAttachmentMedia(root, vi.fn()); media.sync();
  root.replaceChildren(); media.sync();
  expect(pause).toHaveBeenCalledTimes(1);
});

test("lazy loading watches the visible sound row rather than its hidden media element", async () => {
  let intersect!: IntersectionObserverCallback;
  const observe = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = observe;
    unobserve() {}
    disconnect() {}
  });
  const root = document.createElement("div");
  root.innerHTML = sentFileHTML({ id: `${"c".repeat(32)}.wav`, name: "voice.wav", mime: "audio/wav" });
  const media = createAttachmentMedia(root, vi.fn()); media.sync();
  const pill = root.querySelector(".attachment-audio")!;
  expect(observe).toHaveBeenCalledWith(pill);
  expect(attachmentSource).not.toHaveBeenCalled();
  intersect([{ isIntersecting: true, target: pill } as IntersectionObserverEntry], {} as IntersectionObserver);
  await settle();
  expect(root.querySelector("audio")!.getAttribute("src")).toBe(`http://raphael-media.localhost/${"c".repeat(32)}.wav`);
});

test("a picture drawn again takes the copy already loaded at once and never stands empty", async () => {
  // The first picture is shown once it is decoded, never as an empty box between its name and itself (R-FOLLOW-01).
  let decodedNow!: () => void;
  const decode = vi.fn(() => new Promise<void>(resolve => { decodedNow = resolve; }));
  vi.stubGlobal("Image", class extends DecodedImage { decode = decode; });
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersect = callback; } observe() {} unobserve() {} disconnect() {} });
  const id = `${"e".repeat(32)}.png`;
  const root = document.createElement("div");
  root.innerHTML = sentFileHTML({ id, name: "office.png", mime: "image/png" });
  document.body.append(root);
  const url = `http://raphael-media.localhost/${id}`;
  const read = vi.fn();
  const media = createAttachmentMedia(root, read); media.sync();
  const picture: Element = root.querySelector("img")!;
  intersect([{ isIntersecting: true, target: picture } as IntersectionObserverEntry], {} as IntersectionObserver);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(decode).toHaveBeenCalledOnce();
  expect(root.querySelector("img")!.hasAttribute("src")).toBe(false);
  decodedNow();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(root.querySelector("img")!.getAttribute("src")).toBe(url);
  // Its line is drawn again (the words beside it changed) before the thread's picture reported its load: the new picture has
  // its copy in the same task, before any observer.
  root.innerHTML = sentFileHTML({ id, name: "office.png", mime: "image/png" });
  media.sync();
  expect(root.querySelector("img")!.getAttribute("src")).toBe(url);
  expect(attachmentSource).toHaveBeenCalledOnce();
  expect(read).not.toHaveBeenCalled();
});
