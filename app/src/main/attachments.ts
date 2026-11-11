// Shared presentation for composer files and the stored copies in a sent message.
import { t } from "./i18n";
import type { TurnAttachment } from "./types";
import { esc, ico, iconButton } from "./ui";
import * as api from "./api";

/** Shared with the core. Large files cross IPC only as bounded chunks and stored IDs. */
export const ATTACH_MAX = 20;
export const FILE_MAX_BYTES = 250 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
export const TOTAL_MAX_BYTES = ATTACH_MAX * VIDEO_MAX_BYTES;
export const attachmentLimit = (mime: string): number => mime.startsWith("video/") ? VIDEO_MAX_BYTES : FILE_MAX_BYTES;
export function attachRefusal(count: number, mime: string, size: number, total = 0): "count" | "size" | "total" | "empty" | null {
  if (count >= ATTACH_MAX) return "count";
  if (size <= 0) return "empty";
  if (size > attachmentLimit(mime)) return "size";
  if (size + total > TOTAL_MAX_BYTES) return "total";
  return null;
}

export async function readComposerFile(file: File, mime: string, current: () => boolean = () => true): Promise<import("./types").WireAttachment> {
  if (file.size <= 4 * 1024 * 1024) return { name: file.name, mime, data: base64Of(new Uint8Array(await file.arrayBuffer())) };
  const { token } = await api.core<{ token: string }>("attachments.upload", { action: "begin", name: file.name, mime, size: file.size });
  try {
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      if (!current()) throw new Error("cancelled");
      const data = base64Of(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()));
      await api.core("attachments.upload", { action: "append", token, offset, data });
    }
    if (!current()) throw new Error("cancelled");
    return await api.core<import("./types").WireAttachment>("attachments.upload", { action: "finish", token });
  } catch (error) {
    await api.core("attachments.upload", { action: "abort", token }).catch(() => {});
    throw error;
  }
}

/** `bytes` in base64, a slice at a time (a whole PDF at once is too long an argument list). */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  const SLICE = 0x8000;
  for (let at = 0; at < bytes.length; at += SLICE) binary += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  return btoa(binary);
}

const EXTENSIONS: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", html: "text/html", htm: "text/html", csv: "text/csv", json: "application/json",
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac",
};
export function fileMime(file: { name: string; type: string }): string {
  const type = file.type.trim().toLowerCase().split(";")[0];
  if (type === "image/jpg") return "image/jpeg";
  return type && type !== "application/octet-stream" ? type : EXTENSIONS[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}
export function fileKind(mime: string): "image" | "video" | "audio" | "file" {
  // SVG is a document, not trusted image markup.
  if (/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(mime)) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
export function fileSize(size?: number): string {
  if (size === undefined) return "";
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${Math.ceil(size / 1024)} KB` : `${size} B`;
}
export function fileIcon(file: Pick<TurnAttachment, "name" | "mime">): string {
  const kind = fileKind(file.mime);
  if (kind !== "file") return ico(kind === "audio" ? "mic" : kind === "video" ? "play" : "image");
  const ext = file.name.split(".").pop()?.toUpperCase().slice(0, 6) ?? "";
  return `<span class="attachment-icon">${ico(/^(DOCX|XLSX|PPTX|PDF)$/.test(ext) ? "book" : "file")}<small>${esc(ext)}</small></span>`;
}
/** A draft card's inside: a picture is only its thumbnail, which opens it large, with the remove button inside it; another file shows its type icon, name and size. The caller fills in the thumbnail from
 *  the draft's own bytes. */
export function draftFileHTML(file: { name: string; mime: string; size?: number }, removeAttrs: string): string {
  if (fileKind(file.mime) === "image") return `<button type="button" class="btn cmp-pic" data-act="attachment-image" aria-label="${esc(file.name)}">` +
    `<img class="cmp-thumb" alt="" width="56" height="56"></button><button type="button" class="chip-x" ${removeAttrs}>${ico("x")}</button>`;
  return `<span class="cmp-tile">${fileIcon(file)}</span>` +
    `<span class="attachment-name"><span class="cmp-chip-t">${esc(file.name)}</span><small>${esc(fileSize(file.size))}</small></span>` +
    `<button type="button" class="chip-x" ${removeAttrs}>${ico("x")}</button>`;
}
export function sentFileHTML(file: TurnAttachment): string {
  const kind = fileKind(file.mime);
  const id = typeof file.id === "string" && /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/.test(file.id) ? file.id : "";
  const source = file.preview && /^data:(image\/(png|jpeg|webp|gif|avif|bmp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]*$/.test(file.preview) ? file.preview : "";
  const attrs = id ? ` data-attachment="${esc(id)}"${(file.size ?? 0) > 4 * 1024 * 1024 ? ' data-stream-file="true"' : ""}` : "";
  const src = source ? ` src="${esc(source)}"` : "";
  const open = id ? iconButton("external", t("agent.openFile"), ` data-act="attachment-open" data-id="${esc(id)}"`, "attachment-open") : "";
  if ((id || source) && kind === "image") return `<div class="me-file attachment-image"><button type="button" class="btn attachment-picture" data-act="attachment-image"${attrs} aria-label="${esc(file.name)}"><img${src} alt="${esc(file.name)}"${attrs}></button></div>`;
  if ((id || source) && kind === "video") return `<div class="me-file attachment-video"><video${src}${attrs} controls preload="metadata" playsinline aria-label="${esc(file.name)}"></video>${open}</div>`;
  if ((id || source) && kind === "audio") return `<div class="me-file attachment-audio"><audio${src}${attrs} preload="metadata"></audio>` +
    iconButton("play", t("agent.cmd.playPause"), ' data-audio-toggle aria-pressed="false"', "attachment-play") +
    `<span class="attachment-audio-body"><span class="attachment-name"><span class="me-file-t">${esc(file.name)}</span></span><input type="range" min="0" max="100" step="0.1" value="0" disabled data-audio-progress aria-label="${esc(t("agent.audioProgress"))}"><small data-audio-time>0:00 / 0:00</small></span>${open}</div>`;
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toUpperCase() : "";
  const details = [fileSize(file.size), ext].filter(Boolean).join(" · ");
  return `<button type="button" class="btn me-file attachment-file"${id ? ` data-act="attachment-open" data-id="${esc(id)}"` : " disabled"} aria-label="${esc(t("agent.openFile"))}: ${esc(file.name)}">${fileIcon(file)}<span class="attachment-name"><span class="me-file-t">${esc(file.name)}</span><small>${esc(details)}${id ? "" : ` · ${esc(t("missing.attachment"))}`}</small></span></button>`;
}

/** A depth counter keeps child crossings from dismissing the thread's drop target. */
export function mountFileDrop(target: HTMLElement, overlay: HTMLElement, add: (files: File[]) => void): () => void {
  let depth = 0;
  const reset = (): void => { depth = 0; overlay.hidden = true; };
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const enter = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
  };
  const over = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    overlay.hidden = false;
  };
  const leave = (e: DragEvent): void => {
    if (!hasFiles(e) && !depth) return;
    if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) { depth = Math.max(0, depth - 1); return; }
    if (--depth <= 0) reset();
  };
  const drop = (e: DragEvent): void => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) { e.preventDefault(); add(files); }
    reset();
  };
  target.addEventListener("dragenter", enter);
  target.addEventListener("dragover", over);
  target.addEventListener("dragleave", leave);
  target.addEventListener("drop", drop);
  window.addEventListener("dragend", reset);
  window.addEventListener("drop", reset);
  window.addEventListener("blur", reset);
  return reset;
}

/** Files dragged onto a whole conversation go to its composer, under a sign that stops above `control`. */
export function mountStageDrop(stage: HTMLElement, control: () => HTMLElement, add: (files: File[]) => void): { measure(): void; reset(): void } {
  const overlay = document.createElement("div");
  overlay.className = "attachment-drop";
  overlay.hidden = true;
  overlay.setAttribute("role", "status");
  overlay.innerHTML = `${ico("file")}<span></span>`;
  stage.append(overlay);
  const measure = (): void => {
    const label = overlay.querySelector("span")!, words = t("agent.dropFiles");
    if (label.textContent !== words) label.textContent = words;
    overlay.style.bottom = `${Math.max(12, stage.getBoundingClientRect().bottom - control().getBoundingClientRect().top + 12)}px`;
  };
  stage.addEventListener("dragenter", measure, true);
  stage.addEventListener("dragover", measure, true);
  return { measure, reset: mountFileDrop(stage, overlay, add) };
}

/** Intercept large text in capture, before mention shortening can put it in the field. */
export function bindFilePaste(input: HTMLTextAreaElement, add: (files: File[]) => void, fit: () => void, names: () => readonly string[] = () => []): void {
  const reserved = new Set<string>();
  input.addEventListener("composer-draft-restored", () => reserved.clear());
  input.addEventListener("paste", e => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    const words = e.clipboardData?.getData("text/plain") ?? "";
    const long = words.length >= 2000 || words.split(/\r\n?|\n/).length >= 40;
    if (!long && pasted.length === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (long) {
      const base = t("agent.pastedText"), used = new Set([...names(), ...reserved]);
      let name = base;
      for (let number = 2; used.has(name); number++) name = base.replace(/\.txt$/, ` ${number}.txt`);
      reserved.add(name);
      pasted.push(new File([words], name, { type: "text/plain" }));
    } else if (words) {
      input.setRangeText(words, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
      fit();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    add(pasted);
  }, true);
}
