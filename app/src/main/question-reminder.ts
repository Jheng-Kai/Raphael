// Someone needs the owner's answer and the owner is elsewhere in the app. The overlay says so while the app is not in front; here,
// a toast says it once with a way there. The row in the sidebar keeps saying it for as long as it waits.
import * as api from "./api";
import { openGroupChat } from "./group-chats";
import { t } from "./i18n";
import { openMemberThread } from "./team-navigation";
import type { AppContext } from "./types";
import { btn, esc, toaster } from "./ui";

interface Waiting { id: string; member_id: number; member_name?: string; room_id?: number | null }

/** Long enough for the card of the place on screen to have been read and drawn. */
const SETTLE_MS = 500;

const onScreen = (id: string): boolean => {
  const card = document.querySelector<HTMLElement>(`[data-bgq-card="${CSS.escape(id)}"], [data-owner-question="${CSS.escape(id)}"]`);
  return !!card && card.offsetParent !== null;
};

export function mountQuestionReminder(app: AppContext): void {
  const told = new Set<string>();
  let first = true, timer: ReturnType<typeof setTimeout> | null = null;
  const check = async (): Promise<void> => {
    let waiting: Waiting[];
    try { ({ waiting } = await api.core<{ waiting: Waiting[] }>("background.waiting.list")); }
    catch { return; } // a core starting up has nothing to remind of yet
    const open = new Set(waiting.map(item => item.id));
    for (const id of told) if (!open.has(id)) told.delete(id);
    for (const item of waiting) {
      if (told.has(item.id)) continue;
      told.add(item.id);
      // What was already waiting when the app opened is in the sidebar.
      if (first || onScreen(item.id)) continue;
      const place = item.room_id ? ` data-question-room="${item.room_id}"` : ` data-question-member="${item.member_id}"`;
      toaster.notice(() => `<span>${esc(t("reminder.waiting", { p0: item.member_name || t("agent.title") }))}</span>${btn(esc(t("reminder.open")), "sm", place)}`);
    }
    first = false;
  };
  app.onEvent(event => {
    if (event.type !== "WorkerChanged" && event.type !== "AgentTurn") return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void check(); }, SETTLE_MS);
  });
  document.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-question-room], [data-question-member]");
    if (!button) return;
    if (button.dataset.questionRoom) void openGroupChat(Number(button.dataset.questionRoom));
    else openMemberThread(app, Number(button.dataset.questionMember));
    button.closest(".toast")?.remove();
  });
  void check();
}
