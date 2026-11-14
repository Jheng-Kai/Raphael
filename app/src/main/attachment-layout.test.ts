// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { sentFileHTML } from "./attachments";
import { pendingTurnHTML } from "./timeline";

const image = { id: `${"a".repeat(32)}.png`, name: "photo.png", mime: "image/png", size: 2048 };
const video = { id: `${"b".repeat(32)}.mp4`, name: "movie.mp4", mime: "video/mp4", size: 4096 };
const audio = { id: `${"c".repeat(32)}.wav`, name: "voice.wav", mime: "audio/wav", size: 4096 };
const file = { id: `${"d".repeat(32)}.pdf`, name: "report.pdf", mime: "application/pdf", size: 2048 };
const parse = (html: string) => { const root = document.createElement("div"); root.innerHTML = html; return root; };

test("owner media precedes the separate text bubble, with visual media in a grid", () => {
  const root = parse(pendingTurnHTML("Caption", "app", { face: () => "" }, [file, image, audio, video]));
  const owner = root.querySelector(".owner-content")!;
  expect(owner).not.toBeNull();
  expect(owner.querySelector(".bubble .me-files")).toBeNull();
  expect([...owner.children].map(node => node.className)).toEqual(["me-files", "bubble"]);
  expect(owner.querySelectorAll(".attachment-grid > .me-file")).toHaveLength(2);
  expect(owner.querySelector(".bubble .message-text")!.textContent).toBe("Caption");
  expect(parse(pendingTurnHTML("", "app", { face: () => "" }, [image])).querySelector(".bubble")).toBeNull();
});

const picture = (n: number) => ({ id: `${n.toString(16).padStart(2, "0").repeat(16)}.png`, name: `shot-${n}.png`, mime: "image/png", size: 2048 });
const pictures = (count: number) => Array.from({ length: count }, (_, index) => picture(index + 1));

test("several pictures the owner sent stand side by side as thumbnails that open large, and one keeps its own size", () => {
  const one = parse(pendingTurnHTML("Caption", "app", { face: () => "" }, pictures(1)));
  expect(one.querySelector(".attachment-thumbs")).toBeNull();
  expect(one.querySelectorAll(".attachment-grid:not(.is-multiple) > .attachment-image")).toHaveLength(1);
  for (const count of [2, 3, 4, 12]) {
    const root = parse(pendingTurnHTML("Caption", "app", { face: () => "" }, pictures(count)));
    const files = root.querySelector(".owner-content > .me-files")!;
    expect([...files.children].map(node => node.className)).toEqual(["attachment-thumbs"]);
    const thumbs = [...files.querySelectorAll<HTMLButtonElement>(".attachment-thumbs > .attachment-image > button.attachment-picture[data-act='attachment-image']")];
    expect(thumbs.map(button => button.getAttribute("aria-label"))).toEqual(pictures(count).map(item => item.name));
    expect(thumbs.every(button => button.querySelector(`img[data-attachment="${button.dataset.attachment}"]`))).toBe(true);
    expect(root.querySelector(".attachment-grid")).toBeNull();
    expect([...root.querySelector(".owner-content")!.children].map(node => node.className)).toEqual(["me-files", "bubble"]);
  }
});

test("pictures sent with a video, documents and words: the pictures' row, the video, the files, then the bubble", () => {
  const root = parse(pendingTurnHTML("Caption", "app", { face: () => "" }, [file, picture(1), audio, picture(2), video, picture(3)]));
  const files = root.querySelector(".me-files")!;
  expect([...files.children].map(node => node.className)).toEqual(["attachment-thumbs", "attachment-grid", "btn me-file attachment-file", "me-file attachment-audio"]);
  expect(files.querySelectorAll(".attachment-thumbs > .attachment-image")).toHaveLength(3);
  expect(files.querySelectorAll(".attachment-grid > .attachment-video")).toHaveLength(1);
  // A picture whose stored copy is gone is named as a file, never an empty thumbnail.
  const gone = parse(pendingTurnHTML("", "app", { face: () => "" }, [picture(1), picture(2), { name: "lost.png", mime: "image/png" }]));
  expect(gone.querySelectorAll(".attachment-thumbs > .attachment-image")).toHaveLength(2);
  expect(gone.querySelector(".me-files > .attachment-file:disabled")?.textContent).toContain("lost.png");
});

test("the thumbnails are squares of one token size in rows that wrap at the bubble's right edge", () => {
  const css = readFileSync("src/main/agent.css", "utf8");
  expect(css).toContain(".attachment-thumbs { display: flex; flex-wrap: wrap; justify-content: flex-end;");
  expect(css).toContain(".attachment-thumbs > .attachment-image { flex: none; width: var(--pa-pic); height: var(--pa-pic);");
  expect(css).toMatch(/--pa-pic: calc\(4 \* var\(--sp-5\)\);/);
  expect(css).toContain(".attachment-thumbs .attachment-picture img { height: 100%; max-height: none; object-fit: cover; }");
});

test("pictures and video have no visible filename, size, or separate information card", () => {
  for (const attachment of [image, video]) {
    const root = parse(sentFileHTML(attachment));
    expect(root.querySelector(".attachment-info,.attachment-name,.me-file-t")).toBeNull();
    expect(root.textContent).toBe("");
  }
  expect(parse(sentFileHTML(video)).querySelector("video[controls]")).not.toBeNull();
});

test("a quote stays at the top of the text bubble below the owner's media", () => {
  const root = parse(pendingTurnHTML("Question", "app", { face: () => "" }, [image], {
    id: "pending", time: 1000, quote: { text: "Selected passage", author: "You" },
  }));
  const owner = root.querySelector(".owner-content")!;
  expect([...owner.children].map(node => node.className)).toEqual(["me-files", "bubble"]);
  expect(owner.querySelector(".bubble")!.firstElementChild?.className).toBe("message-quote");
  expect(owner.querySelector(".bubble .message-quote")!.textContent).toBe("YouSelected passage");
  expect(owner.querySelector(".bubble .message-text")!.textContent).toBe("Question");
});

test("audio has one pill with controls; documents open from their whole card", () => {
  const sound = parse(sentFileHTML(audio));
  expect(sound.querySelector(".attachment-audio [data-audio-toggle]")).not.toBeNull();
  expect(sound.querySelector('input[type="range"]')).not.toBeNull();
  expect(sound.querySelector("[data-audio-time]")).not.toBeNull();
  expect(sound.querySelector("audio[controls]")).toBeNull();
  expect(sound.querySelectorAll(".attachment-name")).toHaveLength(1);
  const document = parse(sentFileHTML(file));
  expect(document.querySelector("button.attachment-file[data-act='attachment-open']")).not.toBeNull();
  expect(document.textContent).toContain("2 KB · PDF");
});
