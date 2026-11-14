// Our own players for a stored video or sound (owner, 2026-11-15: 「我看到你影片好像是用系統 default 的嗎？因為它旁邊是可以下載的。
// 那我覺得不要用系統 default 的比較好，我們就直接自己增加一些 custom 的東西」). The browser draws no control of its own: no
// download, picture-in-picture, casting or native menu; saving a file stays where the app offers it. A video plays and pauses
// on its picture, on Space and on its button; it has a scrubber with what is loaded and what was played, its time, sound,
// speed and the app's own full screen (the lightbox). A sound has the same controls in one compact row.
import { t } from "./i18n";
import { openLightbox } from "./media-lightbox";
import { esc, ico, iconButton, openMenu, toaster } from "./ui";

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Seconds an arrow key moves a player. */
const STEP = 5;
/** How long the controls of a playing video stay after the pointer last moved over it. */
const QUIET_MS = 2500;
/** No native controls, download, full screen, casting or picture-in-picture on the element itself; its metadata (length, first
 *  frame) loads unless the caller says otherwise. */
const QUIET = ` playsinline disablepictureinpicture disableremoteplayback controlslist="nodownload nofullscreen noremoteplayback noplaybackrate"`;
const elementAttributes = (media: string): string => `${/\spreload=/.test(media) ? "" : ' preload="metadata"'}${QUIET}`;

/** `m:ss`, or `h:mm:ss` from an hour. */
export function clock(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600), minutes = Math.floor((value % 3600) / 60), rest = String(value % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
const rateLabel = (rate: number): string => `${rate}×`;

/** The sound the owner last chose, for every player of this session. */
const sound = { volume: 1, muted: false };
/** The one player that plays: another that starts pauses it. */
let playing: HTMLMediaElement | null = null;

const seekHTML = (): string =>
  `<input type="range" class="mp-seek" min="0" max="1000" step="1" value="0" disabled aria-label="${esc(t("player.position"))}" aria-valuetext="0:00 / 0:00">`;
const volumeHTML = (): string =>
  `<span class="mp-vol">${iconButton("volume", t("player.mute"), ' data-mp-act="mute" aria-pressed="false"', "mp-btn")}` +
  `<input type="range" class="mp-volume" min="0" max="1" step="0.05" value="1" aria-label="${esc(t("player.volume"))}"></span>`;
const rateHTML = (): string =>
  `<button type="button" class="btn mp-rate num" data-mp-act="rate" aria-haspopup="menu" aria-label="${esc(t("player.speed", { p0: rateLabel(1) }))}">${rateLabel(1)}</button>`;

/**
 * A video with our controls. `media` holds the element's own attributes (`src`, `data-attachment`), `extra` what stands on
 * it besides (the open button of an owner's file). `full` is the player of the full screen itself: its button leaves it.
 */
export function videoPlayerHTML(media: string, name: string, extra = "", full = false): string {
  return `<div class="me-file attachment-video mp" data-mp="video">` +
    `<video${media}${elementAttributes(media)} tabindex="-1" aria-label="${esc(name)}"></video>` +
    `<span class="mp-big" aria-hidden="true">${ico("play")}</span>` +
    `<span class="mp-length num" aria-hidden="true"></span>` +
    `<div class="mp-bar">` +
    iconButton("play", t("player.play"), ' data-mp-act="toggle"', "mp-btn mp-play") + seekHTML() +
    `<span class="mp-time num" aria-hidden="true">0:00 / 0:00</span>` + volumeHTML() + rateHTML() +
    iconButton(full ? "shrink" : "open", t(full ? "player.exitFullScreen" : "player.fullScreen"), ' data-mp-act="full"', "mp-btn") +
    `</div>${extra}</div>`;
}

/** A sound with the same controls in one compact row: play, its name over the scrubber and time, sound and speed. */
export function audioPlayerHTML(media: string, name: string, extra = ""): string {
  return `<div class="me-file attachment-audio mp" data-mp="audio"><audio${media}${elementAttributes(media)}></audio>` +
    iconButton("play", t("player.play"), ' data-mp-act="toggle"', "mp-btn mp-play attachment-play") +
    `<span class="attachment-audio-body"><span class="attachment-name"><span class="me-file-t">${esc(name)}</span></span>` + seekHTML() +
    `<small class="mp-time num" aria-hidden="true">0:00 / 0:00</small></span>` + volumeHTML() + rateHTML() + extra + `</div>`;
}

const bound = new WeakSet<HTMLElement>();
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Binds every player under `root` that is not bound yet; a player is bound once, however often its thread draws. */
export function bindPlayers(root: ParentNode): void {
  for (const player of root.querySelectorAll<HTMLElement>(".mp")) bindPlayer(player);
}

export function bindPlayer(player: HTMLElement): void {
  if (bound.has(player)) return;
  const media = player.querySelector<HTMLMediaElement>("video,audio");
  const seek = player.querySelector<HTMLInputElement>(".mp-seek");
  const time = player.querySelector<HTMLElement>(".mp-time");
  if (!media || !seek || !time) return;
  bound.add(player);
  const video = media instanceof HTMLVideoElement ? media : null;
  const volume = player.querySelector<HTMLInputElement>(".mp-volume");
  const length = player.querySelector<HTMLElement>(".mp-length");
  let scrubbing = false;
  media.volume = sound.volume;
  media.muted = sound.muted;

  const duration = (): number => (Number.isFinite(media.duration) ? media.duration : 0);
  const update = (): void => {
    const total = duration(), now = media.currentTime;
    let loaded = 0;
    for (let index = 0; index < media.buffered.length; index++) if (media.buffered.start(index) <= now + 0.5) loaded = Math.max(loaded, media.buffered.end(index));
    seek.disabled = total <= 0;
    if (!scrubbing) seek.value = String(total > 0 ? Math.round((now / total) * 1000) : 0);
    seek.style.setProperty("--mp-played", `${total > 0 ? (Number(seek.value) / 10).toFixed(2) : 0}%`);
    seek.style.setProperty("--mp-loaded", `${total > 0 ? Math.min(100, (loaded / total) * 100).toFixed(2) : 0}%`);
    const words = `${clock(now)} / ${clock(total)}`;
    if (time.textContent !== words) time.textContent = words;
    seek.setAttribute("aria-valuetext", words);
    if (length) length.textContent = total > 0 ? clock(total) : "";
    const paused = media.paused;
    for (const button of player.querySelectorAll<HTMLElement>('[data-mp-act="toggle"]')) {
      const label = t(paused ? "player.play" : "player.pause");
      if (button.getAttribute("aria-label") !== label) {
        button.innerHTML = ico(paused ? "play" : "pause");
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
      }
    }
    player.toggleAttribute("data-playing", !paused);
    player.toggleAttribute("data-ended", media.ended);
    if (!paused) player.setAttribute("data-started", "");
    const mute = player.querySelector<HTMLElement>('[data-mp-act="mute"]');
    const silent = media.muted || media.volume === 0;
    if (mute && mute.getAttribute("aria-pressed") !== String(silent)) {
      mute.innerHTML = ico(silent ? "volumeOff" : "volume");
      mute.setAttribute("aria-pressed", String(silent));
      const label = t(silent ? "player.unmute" : "player.mute");
      mute.setAttribute("aria-label", label);
      mute.setAttribute("title", label);
    }
    if (volume) {
      if (document.activeElement !== volume) volume.value = String(media.muted ? 0 : media.volume);
      volume.style.setProperty("--mp-level", `${Math.round(Number(volume.value) * 100)}%`);
    }
    const rate = player.querySelector<HTMLElement>('[data-mp-act="rate"]');
    if (rate && rate.textContent !== rateLabel(media.playbackRate)) {
      rate.textContent = rateLabel(media.playbackRate);
      rate.setAttribute("aria-label", t("player.speed", { p0: rateLabel(media.playbackRate) }));
    }
  };
  const toggle = (): void => {
    if (!media.paused) { media.pause(); return; }
    if (media.ended) media.currentTime = 0;
    void media.play().catch(() => { update(); if (media.error) toaster.info(t("agent.fileUnavailable")); });
  };
  const jump = (seconds: number): void => {
    const total = duration();
    if (total > 0) media.currentTime = Math.min(total, Math.max(0, media.currentTime + seconds));
  };
  const wake = (): void => {
    clearTimeout(timers.get(player));
    player.removeAttribute("data-bar-hidden");
    if (!video || media.paused) return;
    timers.set(player, setTimeout(() => {
      // Not while the pointer's choice is open (the speed menu) or the keyboard is in the controls.
      if (!media.paused && !player.matches(":focus-within") && !player.querySelector('[aria-expanded="true"]')) player.setAttribute("data-bar-hidden", "");
    }, QUIET_MS));
  };

  for (const event of ["loadedmetadata", "durationchange", "timeupdate", "progress", "pause", "ended", "volumechange", "ratechange", "error", "emptied", "seeked"]) media.addEventListener(event, update);
  media.addEventListener("play", () => {
    if (playing && playing !== media && !playing.paused) playing.pause();
    playing = media;
    update();
    wake();
  });
  media.addEventListener("pause", () => { if (playing === media) playing = null; wake(); });
  // A video at rest shows its first frame, not an empty box: the browser decodes a frame once it is asked for one.
  if (video) video.addEventListener("loadedmetadata", () => { if (video.paused && video.currentTime === 0 && !player.hasAttribute("data-started")) video.currentTime = 0.001; });
  seek.addEventListener("pointerdown", () => { scrubbing = true; });
  const release = (): void => { if (scrubbing) { scrubbing = false; update(); } };
  seek.addEventListener("pointerup", release);
  seek.addEventListener("pointercancel", release);
  seek.addEventListener("change", release);
  seek.addEventListener("input", () => {
    const total = duration();
    if (total > 0) media.currentTime = (Number(seek.value) / 1000) * total;
    seek.style.setProperty("--mp-played", `${(Number(seek.value) / 10).toFixed(2)}%`);
  });
  volume?.addEventListener("input", () => {
    media.volume = Number(volume.value);
    media.muted = media.volume === 0;
    sound.volume = media.volume || sound.volume;
    sound.muted = media.muted;
  });
  video?.addEventListener("click", () => { video.focus({ preventScroll: true }); toggle(); });
  video?.addEventListener("dblclick", event => { event.preventDefault(); openFull(player); });
  player.addEventListener("pointermove", wake);
  player.addEventListener("focusin", wake);
  player.addEventListener("click", event => {
    const act = (event.target as Element).closest<HTMLElement>("[data-mp-act]");
    if (!act || !player.contains(act)) return;
    event.stopPropagation();
    switch (act.dataset.mpAct) {
      case "toggle": toggle(); break;
      case "mute": {
        const silent = !(media.muted || media.volume === 0);
        if (!silent && media.volume === 0) media.volume = sound.volume || 1;
        media.muted = silent;
        sound.muted = silent;
        break;
      }
      case "rate":
        openMenu(act, RATES.map(rate => ({ value: String(rate), label: rateLabel(rate) })), String(media.playbackRate), value => { media.playbackRate = Number(value); wake(); });
        break;
      case "full": openFull(player); break;
    }
  });
  player.addEventListener("keydown", event => {
    const target = event.target as HTMLElement;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const onButton = target.closest("button") !== null;
    let handled = true;
    switch (event.key) {
      // On a button, Space presses that button; anywhere else in the player it plays and pauses.
      case " ": case "k": case "K": if (onButton && event.key === " ") handled = false; else toggle(); break;
      case "ArrowLeft": if (target === volume) handled = false; else jump(-STEP); break;
      case "ArrowRight": if (target === volume) handled = false; else jump(STEP); break;
      case "m": case "M": media.muted = !media.muted; sound.muted = media.muted; break;
      case "f": case "F": if (video) openFull(player); else handled = false; break;
      default: handled = false;
    }
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  });
  update();
}

/** Whether `player` is the one in the full screen. */
const isFull = (player: HTMLElement): boolean => player.closest(".media-lightbox") !== null;

/**
 * The app's own full screen: the lightbox with the same video, where it was, as it was (playing or not, its sound and speed).
 * Leaving it (its button, Escape, a press outside) puts the time back on the player in the thread, which plays on if it did.
 */
function openFull(player: HTMLElement): void {
  const video = player.querySelector("video");
  if (!video) return;
  if (isFull(player)) { player.closest<HTMLElement>(".media-lightbox")?.querySelector<HTMLElement>('[data-lb="close"]')?.click(); return; }
  const src = video.currentSrc || video.getAttribute("src");
  if (!src) return;
  const was = { time: video.currentTime, playing: !video.paused, rate: video.playbackRate };
  video.pause();
  const name = video.getAttribute("aria-label") ?? "";
  let large: HTMLVideoElement | null = null;
  const card = openLightbox(player.querySelector<HTMLElement>('[data-mp-act="full"]') ?? player, name,
    videoPlayerHTML(` src="${esc(src)}"`, name, "", true), {
      cls: "lb-video",
      onClose: () => {
        if (!large) return;
        const playOn = !large.paused;
        video.currentTime = large.currentTime;
        video.playbackRate = large.playbackRate;
        large.pause();
        large.removeAttribute("src");
        large.load();
        if (playOn && video.isConnected) void video.play().catch(() => {});
      },
    });
  const inner = card.querySelector<HTMLElement>(".mp")!;
  large = inner.querySelector("video");
  if (!large) return;
  large.playbackRate = was.rate;
  inner.setAttribute("data-started", "");
  large.addEventListener("loadedmetadata", () => {
    large!.currentTime = was.time;
    if (was.playing) void large!.play().catch(() => {});
  }, { once: true });
  bindPlayer(inner);
  large.focus({ preventScroll: true });
}
