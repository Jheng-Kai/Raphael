// A picture a member sends is a message of its own, as a text bubble is (R-UI-156): the same actions
// stand beside it, a reply quotes it and Copy puts the picture itself on the clipboard.
import { fileKind, fileMime } from "./attachments";
import type { TurnAttachment } from "./types";

const STORED_ID = /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/;

/** The stored file of `kind` a member's media message carries (its `{attachment}`), or null. */
function mediaFile(text: string, kind: "image" | "video"): TurnAttachment | null {
  try {
    const file = JSON.parse(text)?.attachment;
    if (!file || typeof file.id !== "string" || !STORED_ID.test(file.id) || typeof file.name !== "string" || typeof file.mime !== "string" || fileKind(file.mime) !== kind) return null;
    return { id: file.id, name: file.name, mime: file.mime, ...(typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0 ? { size: file.size } : {}) };
  } catch { return null; }
}

/** The stored picture a member's media message carries (its `{attachment}`, an image the window draws), or null. */
export const mediaPicture = (text: string): TurnAttachment | null => mediaFile(text, "image");

/**
 * The stored video a member's media message carries, or null. A video is a message of its own as a picture is (owner,
 * 2026-11-15, R-MEDIA-02): react and reply beside it, its reaction on its corner, its ⋯ with 回覆; no Copy, as no clipboard
 * takes a video.
 */
export const mediaVideo = (text: string): TurnAttachment | null => mediaFile(text, "video");

/**
 * What a reply to a picture quotes: a link to its stored file, in the form a model writes and the core reads
 * (`[name](attachment:<id>)`). It names the picture in no interface language, and the member can tell which one it is.
 */
export const pictureQuote = (file: Pick<TurnAttachment, "id" | "name">): string => `[${file.name.replace(/[[\]\n]/g, "")}](attachment:${file.id})`;

/** The stored file a quote names, when its words are only such a link to a file of `kind`; otherwise null. */
function quotedFile(text: string, kind: "image" | "video"): { id: string; name: string } | null {
  const match = /^\[([^\]\n]*)\]\(attachment:([a-f0-9]{32}\.[a-z0-9]{1,12})\)$/.exec(text.trim());
  return match && fileKind(fileMime({ name: match[2]!, type: "" })) === kind ? { id: match[2]!, name: match[1]! } : null;
}
/** The stored picture a quote names, when its words are only such a link to an image; otherwise null. */
export const quotedPicture = (text: string): { id: string; name: string } | null => quotedFile(text, "image");
/** The stored video a quote names, when its words are only such a link to a video; otherwise null. */
export const quotedVideo = (text: string): { id: string; name: string } | null => quotedFile(text, "video");

/** The stored id of the picture a control stands beside: the picture of its message. */
export const pictureIdAt = (control: HTMLElement): string | undefined =>
  control.closest(".chat-message")?.querySelector<HTMLElement>(".attachment-picture[data-attachment]")?.dataset.attachment;

/**
 * Puts a stored picture itself on the clipboard, as PNG, the one image type the async clipboard takes everywhere. The item
 * is handed over at once with the picture still on its way, so the press that asked for it is the gesture that counts.
 */
export async function copyPicture(read: () => Promise<{ mime: string; data: string }>): Promise<void> {
  if (typeof ClipboardItem !== "function" || typeof navigator.clipboard?.write !== "function") throw new Error("no image clipboard");
  const png = read().then(file => pngOf(new Blob([Uint8Array.from(atob(file.data), c => c.charCodeAt(0))], { type: file.mime })));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** The picture as PNG: a PNG as it is, any other image drawn once onto a canvas. */
async function pngOf(picture: Blob): Promise<Blob> {
  if (picture.type === "image/png") return picture;
  const bitmap = await createImageBitmap(picture);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(png => png ? resolve(png) : reject(new Error("no png")), "image/png"));
}
