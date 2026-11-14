// @vitest-environment happy-dom
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

test("pictures and video have no visible filename, size, or separate information card", () => {
  for (const attachment of [image, video]) {
    const root = parse(sentFileHTML(attachment));
    expect(root.querySelector(".attachment-info,.attachment-name,.me-file-t")).toBeNull();
    // A video's only words are its own player's: the time and the speed (R-MEDIA-01).
    root.querySelectorAll(".mp-time, .mp-length, .mp-rate").forEach(node => node.remove());
    expect(root.textContent).toBe("");
  }
  const player = parse(sentFileHTML(video));
  expect(player.querySelector("video[controls]")).toBeNull();
  expect(player.querySelector('.mp[data-mp="video"] [data-mp-act="toggle"]')).not.toBeNull();
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
  expect(sound.querySelector('.attachment-audio [data-mp-act="toggle"]')).not.toBeNull();
  expect(sound.querySelector('input[type="range"].mp-seek')).not.toBeNull();
  expect(sound.querySelector(".mp-time")).not.toBeNull();
  expect(sound.querySelector("audio[controls]")).toBeNull();
  expect(sound.querySelectorAll(".attachment-name")).toHaveLength(1);
  const document = parse(sentFileHTML(file));
  expect(document.querySelector("button.attachment-file[data-act='attachment-open']")).not.toBeNull();
  expect(document.textContent).toContain("2 KB · PDF");
});
