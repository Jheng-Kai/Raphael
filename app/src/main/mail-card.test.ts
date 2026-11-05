// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { carryMail, mailCardHTML, mailCardsHTML, mailDirty, mailErrorText, mailHandedLineHTML, mailHandedLinesHTML, readMail } from "./mail-card";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, MailDraftCard, MailDraftHanded } from "./types";

afterEach(() => {
  setLocale("zh-TW");
  document.body.innerHTML = "";
});

const draft = (over: Partial<MailDraftCard> = {}): MailDraftCard => ({
  id: "dr1", mode: "card", state: "draft", version: 1, digest: "a".repeat(64), from: { key: "mcp:gmail/send_email", name: "Gmail" },
  senders: [{ key: "mcp:gmail/send_email", name: "Gmail" }, { key: "mcp:work/send", name: "Work mail" }], to: "mei@example.com", cc: "",
  subject: "週四下午三點的會議", body: "您好，\n週四下午三點可以開會。", offer: null, error: null, holder_id: 1, author_name: "", ...over,
});
const handed = (over: Partial<MailDraftHanded> = {}): MailDraftHanded => ({ id: "dr1", mode: "handed", state: "draft", holder_id: 2, holder_name: "焦媽媽", ...over });

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 9, created_at_ms: 0, question: "幫我回信給小美", route: "answer", prefix: "答", text: "草稿放在這裡了，請看一下。", detail: null, status: "done", source: "app", steps: [], task: null, ...over,
});

const FACE = (id: number, size = 18): string => `<i class="face" data-face="${id}" data-size="${size}"></i>`;
const LOOK: TurnLook = { face: () => "<i></i>", memberFace: FACE };
// The words as read: a tag is a space.
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const actions = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]);
const mount = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
};

test("Slack shares editable draft controls, names confirmation and stays out of rooms", () => {
  const slack = draft({kind:"slack",to:"#research",subject:"",from:{key:"mcp:slack/send",name:"Slack"},senders:[{key:"mcp:slack/send",name:"Slack"}]});
  const host = mount(mailCardHTML(slack));
  expect(host.textContent).toContain("需要你確認");
  expect(host.querySelector('[data-mail-field="to"]')?.getAttribute("inputmode")).toBeNull();
  expect(host.querySelector('[data-mail-field="subject"]')).toBeNull();
  expect(actions(host.innerHTML)).toEqual(expect.arrayContaining(["mail-send","mail-discard"]));
  expect(mailCardsHTML(turn({scope:"room",drafts:[slack]}))).toBe("");
  expect(mailCardsHTML(turn({scope:"room",drafts:[draft()]}))).toContain("郵件草稿");
  expect(visible(mailCardHTML({...slack,senders:[]}))).toContain("連接 Slack");
  expect(visible(mailCardHTML({...slack,state:"discarded"}))).toContain("沒有傳送訊息");
});

describe("an email card", () => {
  test("shows sender, recipient, subject and body, with the primary Send first", () => {
    const html = mailCardHTML(draft());
    expect(visible(html)).toContain("郵件草稿 可以傳送 寄件者 Gmail 收件者 主旨 您好， 週四下午三點可以開會。 傳送 捨棄");
    const host = mount(html);
    expect(host.querySelector<HTMLInputElement>('[data-mail-field="to"]')!.value).toBe("mei@example.com");
    expect(host.querySelector('[data-mail-field="cc"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[data-mail-field="subject"]')!.value).toBe("週四下午三點的會議");
    expect(host.querySelector<HTMLTextAreaElement>('[data-mail-field="body"]')!.value).toBe("您好，\n週四下午三點可以開會。");
    expect(host.querySelectorAll("input:disabled, textarea:disabled")).toHaveLength(0);
    expect(actions(html)).toEqual(["mail-from", "mail-send", "mail-discard"]);
    expect(html).toContain('class="btn sm" data-act="mail-discard" data-mail="dr1"');
    expect(html).toContain('class="btn sm pri" data-act="mail-send" data-mail="dr1"');
    // The card holds the digest of the version it shows; that is the one 傳送 sends.
    expect(host.querySelector<HTMLElement>("[data-mail-card]")!.dataset.digest).toBe("a".repeat(64));
  });

  test("the sender is a dropdown of the apps that send mail, never a native select", () => {
    const html = mailCardHTML(draft());
    expect(html).not.toContain("<select");
    const host = mount(html);
    const control = host.querySelector<HTMLButtonElement>('[data-act="mail-from"]')!;
    expect(control.classList.contains("sel")).toBe(true);
    expect(control.getAttribute("aria-haspopup")).toBe("menu");
    expect(control.dataset.via).toBe("mcp:gmail/send_email");
    expect(JSON.parse(host.querySelector<HTMLElement>("[data-mail-card]")!.dataset.senders!)).toEqual(draft().senders);
    // With no app that sends mail the card says so, and can not send.
    const none = mount(mailCardHTML(draft({ senders: [], from: { key: "", name: "" } })));
    expect(none.querySelector('[data-act="mail-from"]')).toBeNull();
    expect(visible(none.innerHTML)).toContain("沒有可以寄信的應用程式，請先連接信箱");
    expect(none.querySelector<HTMLButtonElement>('[data-act="mail-send"]')!.disabled).toBe(true);
  });

  test("keeps version identity without a technical disclosure on an editable draft", () => {
    const host = mount(mailCardHTML(draft({ version: 2, author_name: "佳佳" })));
    expect(host.querySelector("[data-mail-card]")!.getAttribute("data-version")).toBe("2");
    expect(host.querySelector("[data-mail-card]")!.getAttribute("data-digest")).toBe(draft().digest);
    expect(host.querySelector("[data-card-disclosure]")).toBeNull();
  });

  test("a handed draft names its author directly without a disclosure", () => {
    const host = mount(mailCardHTML(draft({ author_name: "佳佳" })));
    expect(host.querySelector(".card-body.cc-state")?.textContent).toBe("來自 佳佳 的草稿");
    expect(host.querySelector("[data-card-disclosure]")).toBeNull();
    expect(host.querySelector("[data-mail-card]")!.getAttribute("data-digest")).toBe(draft().digest);
  });

  test("asks whether a colleague may send it with a choice card: 不用 then the primary 可以", () => {
    const html = mailCardHTML(draft({ offer: { member_id: 2, name: "焦媽媽" } }), LOOK);
    expect(visible(html)).toContain("這封回信可以交給焦媽媽寄嗎？ 等你回答 可以 不用");
    expect(actions(html).slice(-2)).toEqual(["mail-handover-yes", "mail-handover-no"]);
    expect(html).not.toContain('data-face="2"');
    expect(html).toContain('class="btn sm pri" data-act="mail-handover-yes"');
    // The choice is the question's and nothing else: it carries no field and no send.
    expect(html).not.toContain("mail-send\" data-mail=\"dr1\" data-offer");
    expect(visible(mailCardHTML(draft({ offer: null })))).not.toContain("可以交給");
  });

  test("a draft that was sent or discarded is one quiet line and keeps no field", () => {
    const sent = mailCardHTML(draft({ state: "sent", to: "a@example.com, b@example.com" }));
    expect(visible(sent)).toContain("週四下午三點的會議 完成 顯示內容 已傳送給 a@example.com +1");
    expect(sent).toContain('card-status is-done');
    expect(sent).not.toContain("<input");
    expect(actions(sent)).toEqual([]);
    const dropped = mailCardHTML(draft({ state: "discarded" }));
    expect(visible(dropped)).toContain("已捨棄，沒有寄出任何東西");
    expect(dropped).not.toContain("<textarea");
    expect(actions(dropped)).toEqual([]);
  });

  test("a discarded draft has a short status and keeps the full explanation in its details", () => {
    for (const [locale, status, explanation] of [
      ["zh-TW", "已捨棄", "已捨棄，沒有寄出任何東西"],
      ["en", "Discarded", "Discarded; nothing was sent"],
      ["ja", "破棄済み", "破棄しました。何も送信していません"],
    ] as const) {
      setLocale(locale);
      const host = mount(mailCardHTML(draft({ state: "discarded" })));
      expect(host.querySelector(".card-status")!.textContent!.trim()).toBe(status);
      expect(host.querySelector(".card-detail")!.textContent).toContain(explanation);
    }
  });

  test("while it is being sent its fields are still and it has no action", () => {
    const host = mount(mailCardHTML(draft({ state: "sending" })));
    expect(host.querySelectorAll("input:not(:disabled), textarea:not(:disabled)")).toHaveLength(0);
    expect(host.querySelector(".card-status.is-waiting i")).not.toBeNull();
    expect(visible(host.innerHTML)).toContain("傳送中…");
    expect(host.querySelectorAll("button:not([disabled])")).toHaveLength(0);
  });

  test("says why it was not sent, in words, and a failed one waits for an edit", () => {
    const kinds: [string, string][] = [
      ["invalid_recipient", "收件者的信箱格式不正確"], ["cc_unsupported", "這個寄件者不能加副本"], ["empty", "主旨和內文都要寫"],
      ["forbidden", "你的安全規則不允許寄出這封信"], ["no_sender", "沒有可以寄信的應用程式，請先連接信箱"], ["something_new", "沒有傳送成功"],
    ];
    for (const [error, words] of kinds) expect(mailErrorText(draft({ error }))).toBe(words);
    expect(mailErrorText(draft())).toBe("");
    expect(mailErrorText(draft({ state: "failed", error: "interrupted" }))).toContain("上次傳送中斷");
    const failed = mount(mailCardHTML(draft({ state: "failed", error: "error" })));
    expect(visible(failed.innerHTML)).toContain("請先確認信件是否已寄出，若確定未寄出，修改草稿後再傳送。");
    expect(failed.querySelector<HTMLInputElement>('[data-mail-field="to"]')!.disabled).toBe(false);
    expect(failed.querySelector<HTMLButtonElement>('[data-act="mail-send"]')!.disabled).toBe(false);
  });

  test("speaks only the window's language", () => {
    setLocale("en");
    expect(visible(mailCardHTML(draft({ cc: "copy@example.invalid", offer: { member_id: 2, name: "Jiao" } })))).toContain("Email draft Ready to send From Gmail To Cc Subject 您好， 週四下午三點可以開會。 Send Discard Can Jiao send this reply? Waiting for your answer Yes No");
    setLocale("ja");
    expect(visible(mailCardHTML(draft({ cc: "copy@example.invalid" })))).toContain("メールの下書き 送信できます 差出人 Gmail 宛先 Cc 件名 您好， 週四下午三點可以開會。 送信 破棄");
  });

  test("escapes what the member wrote", () => {
    const host = mount(mailCardHTML(draft({ subject: '"><script>alert(1)</script>', body: "</textarea><b>x</b>", to: '"><img src=x>' })));
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelectorAll("b")).toHaveLength(1); // the card's own title, not the member's markup
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[data-mail-field="subject"]')!.value).toBe('"><script>alert(1)</script>');
    expect(host.querySelector<HTMLTextAreaElement>('[data-mail-field="body"]')!.value).toBe("</textarea><b>x</b>");
  });
});

describe("a draft in a turn", () => {
  test("the card is below the reply, and the line of a draft handed on is centred outside it", () => {
    const html = turnHTML(turn({ drafts: [draft()] }), emptyTimelineState(), false, LOOK);
    expect(html).toContain('data-mail-card="dr1"');
    expect(html).not.toContain("data-mail-handed");
    const line = turnHTML(turn({ drafts: [handed()] }), emptyTimelineState(), false, LOOK);
    expect(line).toContain('data-mail-handed="dr1"');
    expect(visible(line.slice(line.indexOf("data-mail-handed"), line.indexOf('<div class="ra'))).replace(/^[^>]*>\s*/, "")).toBe("已轉交給 焦媽媽");
    // The line is before the reply's block (outside `.ra-body`), the face of the colleague before the name.
    expect(line.indexOf("data-mail-handed")).toBeLessThan(line.indexOf('<div class="ra'));
    expect(line).toContain('data-face="2" data-size="18"');
    expect(mailCardsHTML(turn({ drafts: [handed()] }), LOOK)).toBe("");
    expect(mailHandedLinesHTML(turn({ drafts: [draft()] }), LOOK)).toBe("");
    expect(mailHandedLineHTML(handed({ holder_name: "A<b>" }), "")).toContain("A&lt;b&gt;");
  });

  test("a draft handed to this chat is a card: what the carrier turn is told is for the model, not the page", () => {
    const carrier = turn({ question: "", route: "draft", source: "draft", prefix: "", text: "佳佳把一封郵件草稿「週四」交給你，等主人編輯後寄出。", drafts: [draft({ author_name: "佳佳" })] });
    const html = turnHTML(carrier, emptyTimelineState(), false, LOOK);
    expect(html).toContain('data-mail-card="dr1"');
    expect(visible(html)).not.toContain("交給你");
    expect(html).not.toContain("owner-message");
  });
});

describe("what the owner types", () => {
  test("is read from the fields, and is dirty only while it differs from the version shown", () => {
    const host = mount(mailCardHTML(draft({ cc: "copy@example.invalid" })));
    const card = host.querySelector<HTMLElement>("[data-mail-card]")!;
    expect(mailDirty(card)).toBe(false);
    expect(readMail(card)).toEqual({ to: "mei@example.com", cc: "copy@example.invalid", subject: "週四下午三點的會議", body: "您好，\n週四下午三點可以開會。", via: "mcp:gmail/send_email" });
    card.querySelector<HTMLInputElement>('[data-mail-field="cc"]')!.value = "boss@example.com";
    expect(mailDirty(card)).toBe(true);
    expect(readMail(card).cc).toBe("boss@example.com");
    card.querySelector<HTMLInputElement>('[data-mail-field="cc"]')!.value = "copy@example.invalid";
    expect(mailDirty(card)).toBe(false);
    card.querySelector<HTMLElement>('[data-act="mail-from"]')!.dataset.via = "mcp:work/send";
    expect(mailDirty(card)).toBe(true);
    expect(readMail(card).via).toBe("mcp:work/send");
  });

  test("goes from the old card to the one drawn again, with the cursor, and nothing else does", () => {
    const before = mount(mailCardHTML(draft()));
    const typed = before.querySelector<HTMLTextAreaElement>('[data-mail-field="body"]')!;
    typed.value = "您好，\n週四下午三點可以開會。\n請準時。";
    const subject = before.querySelector<HTMLInputElement>('[data-mail-field="subject"]')!;
    subject.focus();
    subject.value = "週四會議（改）";
    subject.setSelectionRange(3, 5);
    // The core made a version of it and the card is drawn again: the subject it kept differs from what is typed.
    const after = mount(mailCardHTML(draft({ version: 2, digest: "b".repeat(64), subject: "週四會議" })));
    const restore = carryMail(before, after);
    expect(after.querySelector<HTMLTextAreaElement>('[data-mail-field="body"]')!.value).toBe("您好，\n週四下午三點可以開會。\n請準時。");
    expect(after.querySelector<HTMLInputElement>('[data-mail-field="subject"]')!.value).toBe("週四會議（改）");
    expect(after.querySelector<HTMLInputElement>('[data-mail-field="to"]')!.value).toBe("mei@example.com");
    restore();
    const fresh = after.querySelector<HTMLInputElement>('[data-mail-field="subject"]')!;
    expect(document.activeElement).toBe(fresh);
    expect([fresh.selectionStart, fresh.selectionEnd]).toEqual([3, 5]);
    // The card of a sent draft takes nothing: its fields are gone.
    const sent = mount(mailCardHTML(draft({ state: "sent" })));
    carryMail(before, sent)();
    expect(sent.querySelector("input")).toBeNull();
  });
});
