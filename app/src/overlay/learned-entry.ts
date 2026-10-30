import { Channel, invoke } from "@tauri-apps/api/core";
import { learnedPill, type LearnedNotice } from "./learned";

const pill = learnedPill(document.querySelector<HTMLElement>("#learned-pill")!, {
  layout: (token, width, height) => invoke("learned_layout", { token, width, height }),
  finish: (token, undo) => invoke("learned_finish", { token, undo }),
});
const channel = new Channel<LearnedNotice>();
channel.onmessage = notice => pill.show(notice);
void invoke("learned_subscribe", { channel }).catch(() => console.warn("Learned word notice is unavailable"));
