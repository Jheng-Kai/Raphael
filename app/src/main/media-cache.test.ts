// @vitest-environment happy-dom
// Stored attachments are immutable, so the window asks for each id once a session and keeps what it drew (R-MEDIA-03).
import { attachmentSource } from "./api";
import { beforeEach, expect, test, vi } from "vitest";
import { adoptPicture, isKept, keepDecoded, knownMediaUrl, mediaUrl, resetMediaCache } from "./media-cache";

vi.mock("./api", () => ({ attachmentSource: vi.fn(async (id: string) => `http://raphael-media.localhost/${id}`) }));
beforeEach(() => { resetMediaCache(); vi.mocked(attachmentSource).mockClear(); });

const ID = (n: number): string => `${n.toString(16).padStart(32, "0")}.png`;
const picture = (width: number, height: number): HTMLImageElement => {
  const image = new Image();
  Object.defineProperty(image, "naturalWidth", { value: width });
  Object.defineProperty(image, "naturalHeight", { value: height });
  return image;
};

test("an id's URL is asked of the shell once a session, whoever asks and however often", async () => {
  const answers = await Promise.all([mediaUrl(ID(1)), mediaUrl(ID(1)), mediaUrl(ID(1))]);
  expect(new Set(answers)).toEqual(new Set([`http://raphael-media.localhost/${ID(1)}`]));
  expect(await mediaUrl(ID(1))).toBe(answers[0]);
  expect(knownMediaUrl(ID(1))).toBe(answers[0]);
  expect(attachmentSource).toHaveBeenCalledTimes(1);
  // A path or a malformed id never reaches the shell.
  await expect(mediaUrl("C:/secret.png")).rejects.toThrow();
  expect(attachmentSource).toHaveBeenCalledTimes(1);
});

test("a failed ask is not remembered: the next one asks again", async () => {
  vi.mocked(attachmentSource).mockRejectedValueOnce(new Error("attachment unavailable"));
  await expect(mediaUrl(ID(2))).rejects.toThrow();
  expect(knownMediaUrl(ID(2))).toBeUndefined();
  expect(await mediaUrl(ID(2))).toBe(`http://raphael-media.localhost/${ID(2)}`);
});

test("pictures kept decoded are bounded by count and by decoded size, the oldest going first", () => {
  for (let n = 0; n < 125; n++) keepDecoded(ID(n), picture(10, 10));
  expect(isKept(ID(0))).toBe(false);
  expect(isKept(ID(124))).toBe(true);
  // Four 4096 x 4096 pictures are 256 MB decoded: the oldest of them goes.
  for (let n = 200; n < 204; n++) keepDecoded(ID(n), picture(4096, 4096));
  expect(isKept(ID(200))).toBe(false);
  expect(isKept(ID(203))).toBe(true);
  // A picture that has not decoded is not kept.
  keepDecoded(ID(300), picture(0, 0));
  expect(isKept(ID(300))).toBe(false);
});

test("a picture just sent is drawn from its own bytes under its stored id, without asking the shell, within a bound", async () => {
  const url = `data:image/png;base64,${"A".repeat(16)}`;
  adoptPicture(ID(1), url, picture(10, 10));
  expect(knownMediaUrl(ID(1))).toBe(url);
  expect(isKept(ID(1))).toBe(true);
  expect(await mediaUrl(ID(1))).toBe(url);
  expect(attachmentSource).not.toHaveBeenCalled();
  // One that has not decoded, an id already known and a malformed id are left as they are.
  adoptPicture(ID(2), url, picture(0, 0));
  expect(knownMediaUrl(ID(2))).toBeUndefined();
  adoptPicture(ID(1), "data:image/png;base64,B", picture(10, 10));
  expect(knownMediaUrl(ID(1))).toBe(url);
  adoptPicture("C:/secret.png", url, picture(10, 10));
  expect(knownMediaUrl("C:/secret.png")).toBeUndefined();
  // Past 48 MiB of data URLs the oldest is asked for as any other id again.
  const big = `data:image/png;base64,${"A".repeat(30 * 1024 * 1024)}`;
  adoptPicture(ID(3), big, picture(10, 10));
  adoptPicture(ID(4), big.slice(0, -1), picture(10, 10));
  expect(knownMediaUrl(ID(3))).toBeUndefined();
  expect(isKept(ID(3))).toBe(false);
  expect(knownMediaUrl(ID(4))).toBeDefined();
  expect(await mediaUrl(ID(3))).toBe(`http://raphael-media.localhost/${ID(3)}`);
});
