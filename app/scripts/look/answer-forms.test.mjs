import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { checkRendered } from "./checks.mjs";

it("form checks count the active conversation without hidden private replies", () => {
  const browser = new Window(), doc = browser.document;
  const card = kind => `<section class="message-${kind}"><button data-rich-act="copy-source"></button>${kind === "chart" ? `<svg>${'<circle><title>Value: 3</title></circle>'.repeat(6)}</svg>` : ""}</section>`;
  doc.body.innerHTML = `<div class="page-agent"><section class="mb-chat" hidden>${card("forecast")}</section><section class="mb-chat"><div class="au-room-message">${["forecast", "board", "chart"].map(card).join("")}</div></section></div>`;
  vi.stubGlobal("document", doc);
  try { expect(() => checkRendered("form-room")).not.toThrow(); }
  finally { vi.unstubAllGlobals(); browser.happyDOM.abort(); }
});
