// @vitest-environment happy-dom
// Our own players (owner, 2026-11-15, R-MEDIA-01): what the browser never draws, and what our controls do.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { audioPlayerHTML, bindPlayer, clock, videoPlayerHTML } from "./media-player";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

test("no page draws the browser's own media player", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  const drawn = walk(import.meta.dirname).filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .filter(path => /<(?:video|audio)\b[^>]*\scontrols\b|\.controls\s*=\s*true/.test(readFileSync(path, "utf8")));
  expect(drawn).toEqual([]);
});

/** A player in the page whose element plays and pauses as a real one would announce it. */
function mount(html: string): { player: HTMLElement; media: HTMLMediaElement } {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const player = host.querySelector<HTMLElement>(".mp")!, media = player.querySelector<HTMLMediaElement>("video,audio")!;
  let paused = true, time = 0, duration = 60;
  Object.defineProperty(media, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(media, "duration", { configurable: true, get: () => duration, set: (value: number) => { duration = value; } });
  Object.defineProperty(media, "currentTime", { configurable: true, get: () => time, set: (value: number) => { time = value; media.dispatchEvent(new Event("timeupdate")); } });
  Object.defineProperty(media, "buffered", { configurable: true, get: () => ({ length: 1, start: () => 0, end: () => 30 }) });
  vi.spyOn(media, "play").mockImplementation(async () => { paused = false; media.dispatchEvent(new Event("play")); });
  vi.spyOn(media, "pause").mockImplementation(() => { paused = true; media.dispatchEvent(new Event("pause")); });
  bindPlayer(player);
  media.dispatchEvent(new Event("loadedmetadata"));
  return { player, media };
}
const press = (target: Element, key: string): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

test("a video and a sound draw none of the browser's controls: no download, picture-in-picture, casting or full screen of its own", () => {
  for (const html of [videoPlayerHTML(' data-attachment="x"', "tour.mp4"), audioPlayerHTML(' data-attachment="x"', "memo.m4a")]) {
    const host = document.createElement("div");
    host.innerHTML = html;
    const media = host.querySelector("video,audio")!;
    expect(media.hasAttribute("controls")).toBe(false);
    expect(media.getAttribute("controlslist")).toBe("nodownload nofullscreen noremoteplayback noplaybackrate");
    expect(media.hasAttribute("disablepictureinpicture") && media.hasAttribute("disableremoteplayback")).toBe(true);
  }
  const video = document.createElement("div");
  video.innerHTML = videoPlayerHTML("", "tour.mp4");
  expect([...video.querySelectorAll<HTMLElement>(".mp-bar [data-mp-act]")].map(button => button.dataset.mpAct)).toEqual(["toggle", "mute", "rate", "full"]);
  expect(video.querySelector(".mp-bar .mp-seek") && video.querySelector(".mp-bar .mp-time") && video.querySelector(".mp-bar .mp-volume")).toBeTruthy();
  const sound = document.createElement("div");
  sound.innerHTML = audioPlayerHTML("", "memo.m4a");
  expect([...sound.querySelectorAll<HTMLElement>("[data-mp-act]")].map(button => button.dataset.mpAct)).toEqual(["toggle", "mute", "rate"]);
});

test("a press on the picture, Space and the button play and pause a video", async () => {
  const { player, media } = mount(videoPlayerHTML("", "tour.mp4"));
  const video = media as HTMLVideoElement;
  video.click(); await Promise.resolve();
  expect(media.paused).toBe(false);
  expect(player.hasAttribute("data-playing") && player.hasAttribute("data-started")).toBe(true);
  press(video, " ");
  expect(media.paused).toBe(true);
  press(player.querySelector(".mp-seek")!, "k"); await Promise.resolve();
  expect(media.paused).toBe(false);
  player.querySelector<HTMLElement>('[data-mp-act="toggle"]')!.click();
  expect(media.paused).toBe(true);
  // Space on another button presses that button, as the keyboard always does.
  const mute = player.querySelector<HTMLElement>('[data-mp-act="mute"]')!;
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  mute.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

test("the scrubber shows what was played and what is loaded, its time, and moves the video", () => {
  const { player, media } = mount(videoPlayerHTML("", "tour.mp4"));
  media.currentTime = 15;
  const seek = player.querySelector<HTMLInputElement>(".mp-seek")!;
  expect(seek.disabled).toBe(false);
  expect(seek.value).toBe("250");
  expect(seek.style.getPropertyValue("--mp-played")).toBe("25.00%");
  expect(seek.style.getPropertyValue("--mp-loaded")).toBe("50.00%");
  expect(player.querySelector(".mp-time")!.textContent).toBe("0:15 / 1:00");
  expect(player.querySelector(".mp-length")!.textContent).toBe("1:00");
  seek.value = "750"; seek.dispatchEvent(new Event("input"));
  expect(media.currentTime).toBe(45);
  press(media, "ArrowLeft");
  expect(media.currentTime).toBe(40);
  press(media, "ArrowRight");
  expect(media.currentTime).toBe(45);
  expect(clock(3725)).toBe("1:02:05");
});

test("sound is muted from its button and M, with the volume beside it", () => {
  const { player, media } = mount(audioPlayerHTML("", "memo.m4a"));
  const mute = player.querySelector<HTMLElement>('[data-mp-act="mute"]')!;
  mute.click(); media.dispatchEvent(new Event("volumechange"));
  expect(media.muted).toBe(true);
  expect(mute.getAttribute("aria-pressed")).toBe("true");
  expect(mute.getAttribute("aria-label")).toBe("取消靜音");
  press(player, "m"); media.dispatchEvent(new Event("volumechange"));
  expect(media.muted).toBe(false);
  const volume = player.querySelector<HTMLInputElement>(".mp-volume")!;
  volume.value = "0.4"; volume.dispatchEvent(new Event("input")); media.dispatchEvent(new Event("volumechange"));
  expect(media.volume).toBeCloseTo(0.4);
  expect(volume.style.getPropertyValue("--mp-level")).toBe("40%");
});

test("one player plays at a time: another that starts pauses it", async () => {
  const first = mount(audioPlayerHTML("", "one.m4a")), second = mount(audioPlayerHTML("", "two.m4a"));
  first.player.querySelector<HTMLElement>('[data-mp-act="toggle"]')!.click(); await Promise.resolve();
  second.player.querySelector<HTMLElement>('[data-mp-act="toggle"]')!.click(); await Promise.resolve();
  expect(first.media.paused).toBe(true);
  expect(second.media.paused).toBe(false);
});

test("the speed is chosen from the app's menu, the current one checked", () => {
  const { player, media } = mount(audioPlayerHTML("", "memo.m4a"));
  const rate = player.querySelector<HTMLElement>('[data-mp-act="rate"]')!;
  rate.click();
  const choices = [...document.querySelectorAll<HTMLElement>("#app-popover .menu-choice")];
  expect(choices.map(choice => choice.dataset.value)).toEqual(["0.5", "0.75", "1", "1.25", "1.5", "2"]);
  expect(choices.find(choice => choice.getAttribute("aria-checked") === "true")?.dataset.value).toBe("1");
  choices[4]!.click(); media.dispatchEvent(new Event("ratechange"));
  expect(media.playbackRate).toBe(1.5);
  expect(rate.textContent).toBe("1.5×");
  expect(rate.getAttribute("aria-label")).toBe("播放速度 1.5×");
});

test("full screen is the lightbox with the same video where it was, and leaving it gives the time back", () => {
  const { player, media } = mount(videoPlayerHTML(' src="http://raphael-media.localhost/clip.mp4"', "tour.mp4"));
  media.currentTime = 12;
  player.querySelector<HTMLElement>('[data-mp-act="full"]')!.click();
  const box = document.querySelector<HTMLElement>('.media-lightbox[role="dialog"]')!;
  const large = box.querySelector<HTMLVideoElement>(".lb-video .mp video")!;
  expect(large.getAttribute("src")).toBe("http://raphael-media.localhost/clip.mp4");
  expect(large.hasAttribute("controls")).toBe(false);
  expect(box.querySelector('.lb-video [data-mp-act="full"]')!.getAttribute("aria-label")).toBe("結束全螢幕");
  Object.defineProperty(large, "currentTime", { configurable: true, writable: true, value: 20 });
  box.querySelector<HTMLElement>('[data-lb="close"]')!.click();
  expect(document.querySelector(".media-lightbox")).toBeNull();
  expect(media.currentTime).toBe(20);
});
