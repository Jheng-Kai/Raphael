import { Channel, invoke } from "@tauri-apps/api/core";
import { learnedPill, type LearnedNotice } from "./learned";
import { reportMouseRegions } from "./mouse-regions";
import { t } from "../main/i18n";

const mouse = reportMouseRegions(document.body, report => invoke("floating_controls", { ...report }), "#learned-pill, .learned-undo");
const pill = learnedPill(document.querySelector<HTMLElement>("#learned-pill")!, {
  layout: (token, width, height) => invoke("learned_layout", { token, width, height }),
  finish: (token, undo) => invoke("learned_finish", { token, undo }),
});
const channel = new Channel<LearnedNotice>();
channel.onmessage = notice => { mouse.reset(notice.revision ?? 0); pill.show(notice); };
void invoke("learned_subscribe", { channel }).catch(() => {
  document.querySelector<HTMLElement>("#learned-pill")!.textContent = t("missing.learned");
});
