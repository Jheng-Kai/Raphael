import { visibilityGate, windowVisible } from "./window-visibility";
// Telegram, in the 訊息平台 tab of Settings: Raphael can be reached from a phone. It is drawn with the
// rows of every other tab, name on the left and controls on the right. Connected, it is one row (the
// mark, the bot, a dot for its state, a switch) that opens on a row for each pairing code and each
// person who may talk to her; before it is set up, a row with a way to BotFather and a row with the
// token field. `messagingHTML` draws it from a snapshot (pure, so its rules can be tested without a
// browser); `createMessaging` holds the state and does what the buttons say, through the core. The
// bot token is typed here, sent to the core once and dropped: it is kept in the vault and never comes
// back to this page. Words are kept to what cannot be shown: errors, the codes and the confirmation
// of 中斷連線; every icon button says what it does in its label and tooltip.

import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { openActions } from "./member-column";
import { monogram, serviceIconSVG } from "./service-icons";
import { iconHTML } from "./service-mark";
import { DISCONNECT_CONFIRM_MS, actionRow, btn, esc, fieldHTML, ico, iconButton, note, row, st, tg, toaster } from "./ui";

/** How often a connected bot is asked who is waiting to pair. */
const POLL_MS = 3000;
/** Fixed setup links, also allowlisted by commands.rs. */
export const BOTFATHER_URL = "https://t.me/BotFather";
const SETUP_URLS = { telegram: BOTFATHER_URL, slack: "https://api.slack.com/apps", discord: "https://discord.com/developers/applications" };

export interface TelegramStatus {
  connected: boolean;
  enabled: boolean;
  running: boolean;
  /** Why the latest poll failed: unauthorized, network, conflict, rate_limited. */
  error: string | null;
  bot: { username: string | null } | null;
  allowed: { user_id: string; name: string }[];
  pending: { code: string; name: string; expires_in_s: number }[];
}

export type MessagingKind = "telegram" | "slack" | "discord";
const title = (kind: MessagingKind): string => ({ telegram: "Telegram", slack: "Slack", discord: "Discord" })[kind];
const words = (key: MessageKey, kind: MessagingKind): string => tr(key).split("Telegram").join(title(kind));

export interface MessagingView {
  kind?: MessagingKind;
  /** The token field's id: a member's own bot (member panel) has its own, beside Raphael's in Settings. */
  tokenId?: string;
  channels?: Partial<Record<MessagingKind, MessagingView>>;
  status: TelegramStatus | "loading" | "failed";
  token: string;
  connecting: boolean;
  /** Why the token was refused, as a message key. */
  tokenError: MessageKey | null;
  confirmingDisconnect: boolean;
  busy: boolean;
  /** The reader opened or closed the pairing and the people; null: as the state suggests. */
  expanded: boolean | null;
}

/** A view of nothing read yet. */
export const emptyMessagingView = (): MessagingView => ({
  status: "loading", token: "", connecting: false, tokenError: null, confirmingDisconnect: false, busy: false, expanded: null,
});

const tr = t as unknown as (key: MessageKey) => string;

/** The pairing and the people are open when someone waits, or before anyone may talk to her. */
export const isExpanded = (v: MessagingView, s: TelegramStatus): boolean => v.expanded ?? (s.pending.length > 0 || s.allowed.length === 0);

/** The state of a connected bot: a dot that names itself, and the words only for a fault. */
function state(s: TelegramStatus, kind: MessagingKind): { dot: "ok" | "warn" | "err" | "idle"; label: string; fault: boolean } {
  if (!s.enabled) return { dot: "idle", label: t("msg.tg.off"), fault: false };
  if (s.error === "unauthorized") return { dot: "err", label: words("msg.tg.revoked", kind), fault: true };
  if (s.error === "conflict") return { dot: "warn", label: t("msg.tg.conflict"), fault: true };
  if (s.error) return { dot: "warn", label: t("msg.tg.offline"), fault: true };
  return { dot: "ok", label: t("msg.tg.on"), fault: false };
}

const mark = (kind: MessagingKind): string => kind === "telegram" ? `<span class="mono md logo-mono msg-mark" aria-hidden="true">${serviceIconSVG(kind)}</span>` : iconHTML(title(kind), kind, "md");
const dotHTML = (dot: string, label: string): string => `<span class="dot ${dot}" role="img" aria-label="${esc(label)}" title="${esc(label)}"></span>`;

/** The name of the group's first row: the mark, the bot (or Telegram) and a dot for its state. */
const headName = (name: string, dot: string, kind: MessagingKind): string => `<span class="msg-name">${mark(kind)}<span class="msg-bot">${esc(name)}</span>${dot}</span>`;

function setupRows(v: MessagingView, kind: MessagingKind): string[] {
  const field = fieldHTML(t("msg.tg.tokenHint"), v.token, {
    id: v.tokenId ?? (kind === "telegram" ? "msg-token" : `msg-token-${kind}`),
    type: "password",
    label: t("msg.tg.token"),
    invalid: v.tokenError !== null,
    disabled: v.connecting,
  });
  const tokenRow = actionRow({ cls: "msg-token", secondary: field, primary: { label: esc(v.connecting ? t("msg.tg.checking") : t("msg.tg.connect")), attrs: ` data-msg="connect"${v.connecting ? " disabled" : ""}` } });
  const botfather = btn(`${ico("bot")}<span>BotFather</span>${ico("link")}`, "", ` data-msg="botfather" title="${esc(t("msg.tg.step1"))}"`);
  const setupLink = btn(`<span>${esc(t("msg.createBot"))}</span>${ico("link")}`, "", ' data-msg="setup-link"');
  return [
    row(headName(title(kind), dotHTML("idle", t("msg.tg.notSet")), kind), "", kind === "telegram" ? botfather : setupLink, { cls: "msg-head" }),
    note(esc(kind === "telegram" ? t("msg.tg.step1") : kind === "slack" ? t("msg.slack.setup") : t("msg.discord.setup")).replace(/im:read|im:history|chat:write|files:read|files:write/g, scope => `<code>${scope}</code>`)),
    row(esc(t("msg.tg.token")), "", tokenRow, { cls: "msg-token-row" }),
    ...(v.tokenError ? [note(st("err", words(v.tokenError, kind)), ' role="alert"')] : []),
  ];
}

function detailRows(v: MessagingView, s: TelegramStatus): string[] {
  const off = v.busy ? " disabled" : "";
  const pending = s.pending.map((p) => {
    const who = p.name || t("msg.tg.someone");
    const minutes = Math.max(1, Math.ceil(p.expires_in_s / 60));
    return row(
      `<span class="msg-pair"><span class="code msg-code">${esc(p.code)}</span><span class="msg-who">${esc(who)}</span>` +
        `<span class="msg-mins num" title="${esc(t("msg.tg.pendingLead", { p0: who, p1: minutes }))}">${ico("clock")}${esc(t("msg.tg.minutes", { p0: minutes }))}</span></span>`,
      "",
      iconButton("x", t("msg.tg.rejectCode", { p0: p.code }), ` data-msg="reject" data-code="${esc(p.code)}"${off}`) +
        iconButton("check", t("msg.tg.approveCode", { p0: p.code }), ` data-msg="approve" data-code="${esc(p.code)}"${off}`, "pri"),
      { cls: "msg-sub" },
    );
  });
  const people = s.allowed.map((u) => {
    const name = u.name || String(u.user_id);
    return row(
      `<span class="msg-pair"><span class="msg-avatar" aria-hidden="true">${monogram(name)}</span><span class="msg-who" title="${esc(String(u.user_id))}">${esc(name)}</span></span>`,
      "",
      iconButton("more", t("members.more", { p0: name }), ` data-msg="user-menu" data-user="${u.user_id}" aria-haspopup="menu" aria-expanded="false"${off}`),
      { cls: "msg-sub" },
    );
  });
  return [...pending, ...people];
}

/** Telegram: its rows, 中斷連線 as the last of them, then under the card the one line before anyone has paired. */
export function messagingHTML(v: MessagingView): string {
  const kind = v.kind ?? "telegram";
  if (v.channels) return messagingHTML({ ...v, channels: undefined }) + (["slack", "discord"] as const).map(name => messagingHTML({ ...(v.channels?.[name] ?? emptyMessagingView()), kind: name })).join("");
  const group = (rows: string[], after = ""): string =>
    `<section class="sgroup msg" data-msg-section data-msg-kind="${kind}" aria-label="${title(kind)}"><div class="slist">${rows.join("")}</div>${after}</section>`;
  if (v.status === "loading") {
    return group([row(headName(title(kind), "", kind), "", `<span class="spin" role="status" aria-label="${esc(t("conn.loading"))}"></span>`, { cls: "msg-head" })]);
  }
  if (v.status === "failed") return group([row(headName(title(kind), "", kind), "", "", { cls: "msg-head" }), note(st("err", words("msg.loadFailed", kind)), ' role="alert"')]);
  if (!v.status.connected) return group(setupRows(v, kind));
  const s = v.status;
  const { dot, label, fault } = state(s, kind);
  const open = isExpanded(v, s);
  const bot = s.bot?.username ? `@${s.bot.username}` : words("msg.tg.bot", kind);
  const badge = s.pending.length ? `<span class="msg-badge num" title="${esc(t("msg.tg.pairing"))}">${s.pending.length}</span>` : "";
  const head = row(
    // The mark says the platform; the name is the bot.
    // The whole name is the button that opens the details, with no arrow, and the switch stands alone on the right,
    // in line with the 「設定」 buttons under it.
    `<button type="button" class="btn msg-open" data-msg="expand" aria-expanded="${open}">${headName(bot, dotHTML(dot, label) + badge, kind)}</button>`,
    "",
    tg(s.enabled, words("msg.tg.switch", kind), ` data-msg="enable"${v.busy ? " disabled" : ""}`),
    { cls: "msg-head" },
  );
  // 中斷連線 is a row of the card like any other setting, never a button left under it.
  const disconnect = row(
    esc(words("msg.tg.disconnectTitle", kind)),
    esc(t("msg.tg.disconnectAbout")),
    actionRow({ destructive: { label: esc(v.confirmingDisconnect ? t("msg.tg.disconnectConfirm") : t("msg.tg.disconnect")), kind: "sm", attrs: ` data-msg="disconnect"${v.busy ? " disabled" : ""}` } }),
    {},
  );
  const rows = [head, ...(fault ? [note(st(dot === "err" ? "err" : "warn", label), ' role="alert"')] : []), ...(open ? [...detailRows(v, s), disconnect] : [])];
  // Before anyone has paired there is nothing to show but how to begin: the one line that says it.
  const waiting = open && !s.pending.length && !s.allowed.length ? `<p class="foot">${esc(t("msg.tg.waitingLead", { p0: bot }).split("Telegram").join(title(kind)))}</p>` : "";
  return group(rows, waiting);
}

/**
 * The bots of a member's panel: a connected one is its card as above; the others are one row each,
 * the platform and 「設定」, which opens the member's conversation where it sets the bot up with the owner (chat-ask.ts).
 * No token field is drawn on the panel.
 */
/** A panel button the member is still working on: a spinner, and no second press (chat-ask.ts). */
export const busySetupButton = (label: string, attrs: string, busy: boolean): string =>
  btn((busy ? `<span class="spin" aria-hidden="true"></span>` : "") + esc(label), "sm", attrs + (busy ? ' disabled aria-busy="true"' : ""));

export function chatChannelsHTML(views: readonly (readonly [MessagingKind, MessagingView])[], busy: (intent: `setup-${MessagingKind}`) => boolean = () => false): string {
  const connected = ([, v]: readonly [MessagingKind, MessagingView]): boolean => typeof v.status === "object" && v.status.connected;
  const setUp = views.filter(connected).map(([kind, v]) => messagingHTML({ ...v, kind })).join("");
  const rows = views.filter((entry) => !connected(entry)).map(([kind, v]) =>
    row(headName(title(kind), "", kind), "", v.status === "loading" ? `<span class="spin" role="status" aria-label="${esc(t("conn.loading"))}"></span>` : busySetupButton(t("members.setUp"), ` data-det="setup" data-intent="setup-${kind}" data-k="det-setup:${kind}" aria-label="${esc(`${t("members.setUp")} ${title(kind)}`)}"`, busy(`setup-${kind}`)), { cls: "msg-head", attrs: ` data-msg-kind="${kind}"` }));
  return setUp + (rows.length ? `<section class="sgroup msg msg-chat-setup"><div class="slist">${rows.join("")}</div></section>` : "");
}

// ---------- state ----------

export interface MessagingHost {
  visible(): boolean;
  redraw(): void;
}

export interface Messaging {
  view(): MessagingView;
  load(): Promise<void>;
  click(target: Element): boolean;
  input(input: HTMLInputElement): boolean;
  key(e: KeyboardEvent): boolean;
  /** The panel is closed or leaves the tab: forget the draft token and stop asking. */
  reset(): void;
}

export function createMessaging(host: MessagingHost): Messaging {
  const channels = Object.fromEntries((["telegram", "slack", "discord"] as const).map(kind => [kind, createChannelMessaging(host, kind)])) as Record<MessagingKind, Messaging>;
  const chosen = (el: Element | null): Messaging => channels[(el?.closest?.<HTMLElement>("[data-msg-kind]")?.dataset.msgKind ?? "telegram") as MessagingKind] ?? channels.telegram;
  return {
    view: () => ({ ...channels.telegram.view(), channels: { slack: channels.slack.view(), discord: channels.discord.view() } }),
    load: async () => { await Promise.all(Object.values(channels).map(channel => channel.load())); },
    click: el => chosen(el).click(el), input: el => chosen(el).input(el), key: event => chosen(event.target as Element | null).key(event),
    reset: () => Object.values(channels).forEach(channel => channel.reset()),
  };
}

type ConnectReply = Awaited<ReturnType<typeof api.telegramConnect>>;
/** What a channel asks the core: Raphael's Telegram, his Slack or Discord, or one member's own Telegram bot. */
interface ChannelOps {
  status(): Promise<TelegramStatus>;
  connect(token: string): Promise<ConnectReply>;
  setEnabled(on: boolean): Promise<TelegramStatus>;
  approve(code: string): Promise<{ approved: boolean; status: TelegramStatus }>;
  reject(code: string): Promise<TelegramStatus>;
  removeUser(userId: string): Promise<TelegramStatus>;
  disconnect(): Promise<TelegramStatus>;
}

function raphaelOps(kind: MessagingKind): ChannelOps {
  // Read at the moment of the call, as before: a channel is made with the panel, long before it asks anything.
  if (kind === "telegram") return {
    status: () => api.telegramStatus(), connect: (token) => api.telegramConnect(token), setEnabled: (on) => api.telegramSetEnabled(on),
    approve: (code) => api.telegramApprove(code), reject: (code) => api.telegramReject(code), removeUser: (user) => api.telegramRemoveUser(user),
    disconnect: () => api.telegramDisconnect(),
  };
  const call = <T>(method: string, params?: object): Promise<T> => api.messagingCall<T>(kind, method, params);
  return {
    status: () => call("status"), connect: (token) => call("connect", { token }), setEnabled: (enabled) => call("set_enabled", { enabled }),
    approve: (code) => call("approve", { code }), reject: (code) => call("reject", { code }), removeUser: (user_id) => call("remove_user", { user_id }),
    disconnect: () => call("disconnect"),
  };
}

/**
 * A member's own bot on one platform, in its panel, through `messaging.member.*`; messages to it
 * land in the member's own conversation. Telegram sends no platform, as the core first knew it.
 */
export function createMemberChannel(host: MessagingHost, memberId: () => number, kind: MessagingKind = "telegram"): Messaging {
  const on = kind === "telegram" ? undefined : kind;
  return createChannelMessaging(host, kind, {
    status: () => api.memberMessagingStatus(memberId(), on), connect: (token) => api.memberMessagingConnect(memberId(), token, on),
    setEnabled: (enabled) => api.memberMessagingSetEnabled(memberId(), enabled, on), approve: (code) => api.memberMessagingApprove(memberId(), code, on),
    reject: (code) => api.memberMessagingReject(memberId(), code, on), removeUser: (user) => api.memberMessagingRemoveUser(memberId(), user, on),
    disconnect: () => api.memberMessagingDisconnect(memberId(), on),
  }, kind === "telegram" ? "msg-token-member" : `msg-token-member-${kind}`);
}
export const createMemberTelegram = (host: MessagingHost, memberId: () => number): Messaging => createMemberChannel(host, memberId, "telegram");

/** Raphael's own bot on one platform, in his panel (Settings no longer holds it). */
export const createRaphaelChannel = (host: MessagingHost, kind: MessagingKind): Messaging => createChannelMessaging(host, kind);

function createChannelMessaging(host: MessagingHost, kind: MessagingKind, ops: ChannelOps = raphaelOps(kind), ownTokenId?: string): Messaging {
  const tokenId = ownTokenId ?? (kind === "telegram" ? "msg-token" : `msg-token-${kind}`);
  let status: MessagingView["status"] = "loading";
  let token = "";
  let connecting = false;
  let tokenError: MessageKey | null = null;
  let confirming = false;
  let busy = false;
  let expanded: boolean | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let poller: ReturnType<typeof setInterval> | undefined;
  let loads = 0;

  const redraw = (): void => {
    if (host.visible()) host.redraw();
  };
  const view = (): MessagingView => ({ status, token, connecting, tokenError, confirmingDisconnect: confirming, busy, expanded, ...(ownTokenId ? { tokenId } : {}) });

  const poll = visibilityGate(() => void refresh(), () => poller !== undefined && host.visible());

  function schedule(): void {
    clearInterval(poller);
    poller = undefined;
    // Only a connected bot has anything to wait for; a field being typed in is never redrawn.
    if (typeof status === "object" && status.connected && status.enabled) poller = setInterval(poll.run, POLL_MS);
  }

  /** Takes a new status; the page is drawn again only if something changed. */
  function take(next: TelegramStatus): void {
    const shape = (s: TelegramStatus): string => JSON.stringify({ ...s, pending: s.pending.map((p) => [p.code, p.name]) });
    const same = typeof status === "object" && shape(status) === shape(next);
    status = next;
    schedule();
    if (!same) redraw();
  }

  async function refresh(): Promise<void> {
    if (!host.visible() || !windowVisible()) return;
    const mine = ++loads;
    try {
      const next = await ops.status();
      if (mine === loads && !busy && next && typeof next === "object") take(next);
    } catch {
      // a poll that fails is tried again; the state on screen stays
    }
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    try {
      const next = await ops.status();
      if (mine !== loads) return;
      // A core too old to know the method answers nothing: that is a failed read, never a crash of the card.
      if (!next || typeof next !== "object") throw new Error("no status");
      status = next;
      schedule();
    } catch {
      if (mine !== loads) return;
      if (typeof status !== "object") status = "failed";
    }
    redraw();
  }

  async function connect(): Promise<void> {
    if (connecting || !token.trim()) {
      if (!token.trim()) {
        tokenError = "msg.tg.needToken";
        redraw();
      }
      return;
    }
    connecting = true;
    tokenError = null;
    redraw();
    try {
      const reply = await ops.connect(token.trim());
      if (reply.ok) {
        token = ""; // it is in the vault now: nothing of it stays on this page
        status = reply.status;
        schedule();
        toaster.info(t("msg.tg.connected", { p0: reply.status.bot?.username ? `@${reply.status.bot.username}` : title(kind) }));
      } else {
        tokenError = reply.reason === "network" ? "msg.tg.networkError" : "msg.tg.badToken";
      }
    } catch (err) {
      toaster.info(describeError(err));
    }
    connecting = false;
    redraw();
  }

  async function act(work: () => Promise<TelegramStatus | null>): Promise<void> {
    busy = true;
    redraw();
    try {
      const next = await work();
      if (next) {
        status = next;
        schedule();
      }
    } catch (err) {
      toaster.info(describeError(err));
    }
    busy = false;
    redraw();
  }

  function click(target: Element): boolean {
    const button = target.closest<HTMLElement>("[data-msg]");
    if (!button) return false;
    switch (button.dataset.msg) {
      case "setup-link":
        void api.openLink(SETUP_URLS[kind]).catch((err) => toaster.info(describeError(err)));
        return true;
      case "botfather":
        void api.openLink(BOTFATHER_URL).catch((err) => toaster.info(describeError(err)));
        return true;
      case "connect":
        void connect();
        return true;
      case "expand":
        if (typeof status === "object") {
          expanded = !isExpanded(view(), status);
          redraw();
        }
        return true;
      case "enable":
        if (typeof status === "object") {
          const on = !status.enabled;
          void act(() => ops.setEnabled(on));
        }
        return true;
      case "approve": {
        const code = button.dataset.code ?? "";
        void act(async () => {
          const reply = await ops.approve(code);
          if (!reply.approved) toaster.info(t("msg.tg.codeGone"));
          return reply.status;
        });
        return true;
      }
      case "reject":
        void act(() => ops.reject(button.dataset.code ?? ""));
        return true;
      case "user-menu": {
        const user = button.dataset.user ?? "";
        const name = (typeof status === "object" ? status.allowed.find((u) => String(u.user_id) === user)?.name : "") || user;
        openActions(button, [{ id: "remove", label: t("msg.tg.removeUser", { p0: name }), icon: "trash" }], () => void act(() => ops.removeUser(user)));
        return true;
      }
      case "disconnect":
        if (!confirming) {
          confirming = true;
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(() => {
            confirming = false;
            redraw();
          }, DISCONNECT_CONFIRM_MS);
          redraw();
          return true;
        }
        clearTimeout(confirmTimer);
        confirming = false;
        void act(async () => {
          const next = await ops.disconnect();
          toaster.info(words("msg.tg.disconnected", kind));
          return next;
        });
        return true;
    }
    return false;
  }

  function input(el: HTMLInputElement): boolean {
    if (el.id !== tokenId) return false;
    token = el.value;
    if (tokenError) {
      // Taken off the page in place: drawing it again would drop the focus from the field.
      tokenError = null;
      el.closest(".msg")?.querySelectorAll(".note[role=alert]").forEach((n) => n.remove());
      el.closest("label")?.removeAttribute("data-invalid");
    }
    return true;
  }

  function key(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (e.key !== "Enter" || el?.id !== tokenId) return false;
    e.preventDefault();
    void connect();
    return true;
  }

  function reset(): void {
    clearTimeout(confirmTimer);
    clearInterval(poller);
    poller = undefined;
    confirming = false;
    token = "";
    tokenError = null;
    expanded = null;
    loads++;
  }

  return { view, load, click, input, key, reset };
}
